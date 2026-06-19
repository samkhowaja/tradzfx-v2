import { registerOverlay, OverlayMode } from "klinecharts";

/**
 * Compact Long/Short trade-plan overlay for klinecharts v9.
 *
 * Expects 3 points in this order:
 *   0: entry (also sets the vertical decision line)
 *   1: stop loss
 *   2: take profit
 *
 * extendData: { side: "long" | "short", rr: number }
 *
 * Instead of stretching lines across the entire chart (which clutters the view
 * when the plan is far from current price), the overlay draws a short plan
 * box anchored at the entry candle and clipped to the visible viewport.
 */
registerOverlay({
  name: "tradePlan",
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: true,
  mode: OverlayMode.WeakMagnet,
  modeSensitivity: 8,
  createPointFigures: ({ coordinates, bounding, overlay }) => {
    if (coordinates.length < 3) return [];

    const entry = coordinates[0];
    const sl = coordinates[1];
    const tp = coordinates[2];
    const side = (overlay.extendData?.side ?? "long") as "long" | "short";
    const rr = Number(overlay.extendData?.rr ?? 0);

    const longColor = "#34d399";
    const shortColor = "#fb7185";
    const entryColor = side === "long" ? longColor : shortColor;

    // Keep the plan box compact: ~35% of the visible chart width, capped at 280px.
    const planWidth = Math.min(bounding.width * 0.35, 280);
    let x1 = entry.x;
    let x2 = entry.x + planWidth;

    // Fully off-screen horizontally -> don't draw anything.
    if (x2 <= 0 || x1 >= bounding.width) return [];

    x1 = Math.max(0, x1);
    x2 = Math.min(bounding.width, x2);
    if (x2 <= x1) return [];

    const minY = Math.min(sl.y, tp.y);
    const maxY = Math.max(sl.y, tp.y);

    return [
      // SL risk zone fill
      {
        type: "polygon",
        attrs: {
          coordinates: [
            { x: x1, y: entry.y },
            { x: x2, y: entry.y },
            { x: x2, y: sl.y },
            { x: x1, y: sl.y },
          ],
        },
        styles: { style: "fill", color: "rgba(251, 113, 133, 0.10)" },
      },
      // TP reward zone fill
      {
        type: "polygon",
        attrs: {
          coordinates: [
            { x: x1, y: entry.y },
            { x: x2, y: entry.y },
            { x: x2, y: tp.y },
            { x: x1, y: tp.y },
          ],
        },
        styles: { style: "fill", color: "rgba(52, 211, 153, 0.10)" },
      },
      // Entry line
      {
        type: "line",
        attrs: {
          coordinates: [
            { x: x1, y: entry.y },
            { x: x2, y: entry.y },
          ],
        },
        styles: { style: "solid", color: entryColor, size: 1.5 },
      },
      // SL line
      {
        type: "line",
        attrs: {
          coordinates: [
            { x: x1, y: sl.y },
            { x: x2, y: sl.y },
          ],
        },
        styles: { style: "dashed", color: shortColor, size: 1, dashedValue: [5, 4] },
      },
      // TP line
      {
        type: "line",
        attrs: {
          coordinates: [
            { x: x1, y: tp.y },
            { x: x2, y: tp.y },
          ],
        },
        styles: { style: "dashed", color: longColor, size: 1, dashedValue: [5, 4] },
      },
      // Vertical decision line at entry candle (only if visible)
      ...(entry.x >= 0 && entry.x <= bounding.width
        ? [
            {
              type: "line" as const,
              attrs: {
                coordinates: [
                  { x: entry.x, y: minY },
                  { x: entry.x, y: maxY },
                ],
              },
              styles: { style: "solid" as const, color: "rgba(129, 140, 248, 0.35)", size: 1 },
            },
          ]
        : []),
      // Labels
      {
        type: "text",
        attrs: { x: x1 + 4, y: entry.y - 6, text: "ENTRY", align: "left", baseline: "bottom" },
        styles: { color: entryColor, size: 10, backgroundColor: "rgba(5, 5, 7, 0.85)" },
      },
      {
        type: "text",
        attrs: { x: x1 + 4, y: sl.y + 6, text: "SL", align: "left", baseline: "top" },
        styles: { color: shortColor, size: 10, backgroundColor: "rgba(5, 5, 7, 0.85)" },
      },
      {
        type: "text",
        attrs: { x: x1 + 4, y: tp.y - 6, text: "TP", align: "left", baseline: "bottom" },
        styles: { color: longColor, size: 10, backgroundColor: "rgba(5, 5, 7, 0.85)" },
      },
      // Side + RR badge near the entry candle
      {
        type: "text",
        attrs: {
          x: x1 + 6,
          y: side === "long" ? tp.y - 6 : sl.y + 6,
          text: `${side.toUpperCase()} 1:${rr.toFixed(1)}R`,
          align: "left",
          baseline: side === "long" ? "bottom" : "top",
        },
        styles: { color: "#f6f6f8", size: 10, backgroundColor: "rgba(5, 5, 7, 0.9)" },
      },
    ];
  },
  performEventPressedMove: ({ points, performPointIndex, performPoint }) => {
    // Dragging any point moves the whole plan vertically (keep RR relationships)
    if (
      performPoint?.value != null &&
      performPointIndex != null &&
      points.length >= 3 &&
      points[performPointIndex]?.value != null
    ) {
      const delta = performPoint.value - (points[performPointIndex].value as number);
      for (const p of points) {
        if (p.value != null) p.value += delta;
      }
    }
  },
});
