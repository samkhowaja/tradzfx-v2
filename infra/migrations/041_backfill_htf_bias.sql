-- Higher-timeframe bias backfill helper.
--
-- The live engine only emits features_htf_bias for timestamps it runs. Historical
-- rows must be backfilled before PIT backtests can use HTF-bias predicates.
-- This function computes the weighted consensus from fresh features_order_block
-- and features_structure rows at or above the requested feature timeframe.

CREATE OR REPLACE FUNCTION backfill_htf_bias(
    p_symbol TEXT,
    p_since  TIMESTAMPTZ DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
    v_tf          TEXT;
    v_target_tfs  TEXT[] := ARRAY['15m', '1h', '4h', '1d'];
    v_inserted    BIGINT := 0;
    v_batch       BIGINT := 0;
BEGIN
    FOREACH v_tf IN ARRAY v_target_tfs LOOP
        WITH tf_meta(tf, weight, ord) AS (
            VALUES
                ('15m', 0.5, 1),
                ('1h',  1.0, 2),
                ('4h',  2.0, 3),
                ('1d',  3.0, 4)
        ),
        targets AS (
            SELECT
                b.symbol,
                b.tf      AS feature_tf,
                b.ts,
                m.ord     AS feature_ord
            FROM features_bias b
            JOIN tf_meta m ON m.tf = b.tf
            WHERE b.symbol = p_symbol
              AND b.tf = v_tf
              AND (p_since IS NULL OR b.ts >= p_since)
        ),
        latest_ob AS (
            SELECT DISTINCT ON (t.symbol, t.feature_tf, t.ts, tm.tf)
                t.symbol,
                t.feature_tf,
                t.ts,
                tm.tf,
                tm.weight,
                ob.ob_kind
            FROM targets t
            CROSS JOIN tf_meta tm
            LEFT JOIN LATERAL (
                SELECT ob_kind
                FROM features_order_block
                WHERE symbol = t.symbol
                  AND tf = tm.tf
                  AND ts <= t.ts
                  AND (mitigated_at IS NULL OR mitigated_at > t.ts)
                  AND (invalidated_at IS NULL OR invalidated_at > t.ts)
                ORDER BY ts DESC
                LIMIT 1
            ) ob ON TRUE
            WHERE tm.ord >= t.feature_ord
        ),
        latest_st AS (
            SELECT DISTINCT ON (t.symbol, t.feature_tf, t.ts, tm.tf)
                t.symbol,
                t.feature_tf,
                t.ts,
                tm.tf,
                tm.weight,
                st.direction,
                st.event_type
            FROM targets t
            CROSS JOIN tf_meta tm
            LEFT JOIN LATERAL (
                SELECT direction, event_type
                FROM features_structure
                WHERE symbol = t.symbol
                  AND tf = tm.tf
                  AND ts <= t.ts
                  AND (invalidated_at IS NULL OR invalidated_at > t.ts)
                ORDER BY ts DESC
                LIMIT 1
            ) st ON TRUE
            WHERE tm.ord >= t.feature_ord
        ),
        contrib AS (
            SELECT
                COALESCE(ob.symbol, st.symbol)     AS symbol,
                COALESCE(ob.feature_tf, st.feature_tf) AS feature_tf,
                COALESCE(ob.ts, st.ts)             AS ts,
                COALESCE(ob.tf, st.tf)             AS tf,
                COALESCE(ob.weight, st.weight)     AS weight,
                COALESCE(CASE
                    WHEN ob.ob_kind = 'bullish' THEN ob.weight
                    WHEN ob.ob_kind = 'bearish' THEN -ob.weight
                    ELSE 0
                END, 0) AS ob_contrib,
                COALESCE(CASE
                    WHEN st.direction = 'bullish' THEN st.weight
                    WHEN st.direction = 'bearish' THEN -st.weight
                    ELSE 0
                END, 0) AS st_contrib,
                CASE
                    WHEN ob.ob_kind IS NOT NULL THEN
                        ob.tf || ' ' || ob.ob_kind || ' OB'
                    ELSE NULL
                END AS ob_reason,
                CASE
                    WHEN st.direction IS NOT NULL THEN
                        st.tf || ' ' || st.direction || ' ' || st.event_type
                    ELSE NULL
                END AS st_reason
            FROM latest_ob ob
            FULL OUTER JOIN latest_st st
                ON ob.symbol = st.symbol
               AND ob.feature_tf = st.feature_tf
               AND ob.ts = st.ts
               AND ob.tf = st.tf
        ),
        scored AS (
            SELECT
                symbol,
                feature_tf AS tf,
                ts,
                SUM(ob_contrib + st_contrib) AS score,
                COALESCE(
                    STRING_AGG(
                        COALESCE(ob_reason, '') || CASE WHEN ob_reason IS NOT NULL AND st_reason IS NOT NULL THEN ', ' ELSE '' END || COALESCE(st_reason, ''),
                        ', '
                        ORDER BY tf
                    ),
                    ''
                ) AS reason_parts
            FROM contrib
            GROUP BY symbol, feature_tf, ts
        ),
        inserted AS (
            INSERT INTO features_htf_bias (
                symbol, tf, ts, direction, confidence, state, score,
                reason, engine_ver, input_hash
            )
            SELECT
                s.symbol,
                s.tf,
                s.ts,
                CASE
                    WHEN s.score > 0 THEN 'bullish'
                    WHEN s.score < 0 THEN 'bearish'
                    ELSE 'neutral'
                END AS direction,
                CASE
                    WHEN ABS(s.score) >= 3.0 THEN 90
                    WHEN ABS(s.score) >= 1.0 THEN 70
                    ELSE 0
                END AS confidence,
                CASE
                    WHEN ABS(s.score) >= 3.0 THEN 'READY'
                    WHEN ABS(s.score) >= 1.0 THEN 'SOFT_WARN'
                    ELSE 'BLOCK'
                END AS state,
                s.score,
                CASE
                    WHEN s.reason_parts = '' THEN
                        CASE
                            WHEN s.score > 0 THEN 'bullish'
                            WHEN s.score < 0 THEN 'bearish'
                            ELSE 'neutral'
                        END || ' ' ||
                        CASE
                            WHEN ABS(s.score) >= 3.0 THEN 'READY'
                            WHEN ABS(s.score) >= 1.0 THEN 'SOFT_WARN'
                            ELSE 'BLOCK'
                        END ||
                        ' (score=' || s.score::text || '): no fresh HTF context'
                    ELSE
                        CASE
                            WHEN s.score > 0 THEN 'bullish'
                            WHEN s.score < 0 THEN 'bearish'
                            ELSE 'neutral'
                        END || ' ' ||
                        CASE
                            WHEN ABS(s.score) >= 3.0 THEN 'READY'
                            WHEN ABS(s.score) >= 1.0 THEN 'SOFT_WARN'
                            ELSE 'BLOCK'
                        END ||
                        ' (score=' || s.score::text || '): ' || s.reason_parts
                END AS reason,
                '1.0.0' AS engine_ver,
                'backfill' AS input_hash
            FROM scored s
            ON CONFLICT (symbol, tf, ts) DO UPDATE SET
                direction  = EXCLUDED.direction,
                confidence = EXCLUDED.confidence,
                state      = EXCLUDED.state,
                score      = EXCLUDED.score,
                reason     = EXCLUDED.reason,
                engine_ver = EXCLUDED.engine_ver,
                input_hash = EXCLUDED.input_hash
            RETURNING 1
        )
        SELECT COUNT(*) INTO v_batch FROM inserted;

        v_inserted := v_inserted + COALESCE(v_batch, 0);
    END LOOP;

    RETURN v_inserted;
END;
$$ LANGUAGE plpgsql;
