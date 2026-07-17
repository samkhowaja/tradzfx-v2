import subprocess, os
# load .env.local
dotenv = {}
with open('.env.local') as f:
    for line in f:
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            dotenv[k.strip()] = v.strip()
os.environ.update(dotenv)

import psycopg2
conn = psycopg2.connect(
    host=os.environ.get('TM_DB_HOST','localhost'),
    port=int(os.environ.get('TM_DB_PORT','5432')),
    dbname=os.environ.get('TM_DB_NAME','tradzfx_v2'),
    user=os.environ.get('TM_DB_USER','postgres'),
    password=os.environ.get('TM_DB_PASSWORD','')
)
cur=conn.cursor()

# bias direction 30d backtest window
cur.execute("SELECT direction,count(*)::int as n FROM features_bias WHERE symbol='XAUUSD' AND tf='15m' AND ts>='2026-06-13' AND ts<='2026-07-13' GROUP BY direction ORDER BY n DESC")
print('bias@15m 30d:', cur.fetchall())

cur.execute("SELECT count(*)::int FROM features_bias WHERE symbol='XAUUSD' AND tf='15m' AND ts>='2026-06-13' AND ts<='2026-07-13'")
print('total bias@15m 30d:', cur.fetchone()[0])

# order_block is_fresh
cur.execute("SELECT is_fresh,count(*)::int as n FROM features_order_block WHERE symbol='XAUUSD' AND tf='15m' AND ts>='2026-06-13' GROUP BY is_fresh")
print('ob is_fresh:', cur.fetchall())

# order_block count in window
cur.execute("SELECT count(*)::int FROM features_order_block WHERE symbol='XAUUSD' AND tf='15m' AND ts>='2026-06-13'")
print('ob total in window:', cur.fetchone()[0])

# ifvg fresh with fill>=0.3
cur.execute("SELECT count(*)::int FROM features_ifvg WHERE symbol='XAUUSD' AND tf='5m' AND ts>='2026-06-13' AND fill_pct>=0.3 AND is_fresh=true")
print('ifvg 5m fresh fill>=0.3:', cur.fetchone()[0])

cur.execute("SELECT count(*)::int FROM features_ifvg WHERE symbol='XAUUSD' AND tf='5m' AND ts>='2026-06-13'")
print('ifvg total in window:', cur.fetchone()[0])

cur.close()
conn.close()
