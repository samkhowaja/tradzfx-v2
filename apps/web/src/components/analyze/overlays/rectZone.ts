import { registerOverlay, OverlayMode } from "klinecharts";

/**
 * Simple rectangle overlay for klinecharts v9.
 *
 * Points:
 *   0: top-left  { timestamp, value: top }
 *   1: bottom-right { timestamp, value: bottom }
 *
 * extendData: { label?: string, color: string, fillAlpha?: number }
 */
registerOverlay({
  name: "rectZone",
  totalStep: 2,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: true,
  mode: OverlayMode.Normal,
  createPointFigures: ({ coordinates, overlay }) => {
    if (coordinates.length < 2) return [];
    const topLeft = coordinates[0];
    const bottomRight = coordinates[1];
    const { x: x1, y: y1 } = topLeft;
    const { x: x2, y: y2 } = bottomRight;
    if (x2 <= x1 || y2 <= y1) return [];

    const color = (overlay.extendData?.color as string) ?? "rgba(129, 140, 248, 0.8)";
    const fillAlpha = Number(overlay.extendData?.fillAlpha ?? 0.25);
    const label = (overlay.extendData?.label as string) ?? "";

    // Parse base rgb from rgba string or fallback
    const baseColor = color.replace(/rgba?\(([^)]+)\)/, "$1").split(",").map((s) => s.trim());
    const r = baseColor[0] ?? "129";
    const g = baseColor[1] ?? "140";
    const b = baseColor[2] ?? "248";
    const fill = `rgba(${r}, ${g}, ${b}, ${fillAlpha})`;

    const figures: any[] = [
      {
        type: "polygon",
        attrs: {
          coordinates: [
            { x: x1, y: y1 },
            { x: x2, y: y1 },
            { x: x2, y: y2 },
            { x: x1, y: y2 },
          ],
        },
        styles: { style: "fill", color: fill, borderColor: color, borderSize: 1 },
      },
    ];

    if (label) {
      figures.push({
        type: "text",
        attrs: { x: x1 + 4, y: y1 - 4, text: label, align: "left", baseline: "bottom" },
        styles: { color, size: 10, backgroundColor: "rgba(5, 5, 7, 0.85)" },
      });
    }

    return figures;
  },
});
