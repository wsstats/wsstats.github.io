//  Shared plugin state

let heatmapCfg = null;

export function setHeatmapCfg(cfg) {
    heatmapCfg = cfg;
}

//  heatmapPlugin

/**
 * Custom plugin: renders the heatmap cells for chart4.
 * Reads config from the module-level heatmapCfg variable.
 */
export const heatmapPlugin = {
    id: "heatmap",
    beforeDatasetsDraw(chart) {
        if (!heatmapCfg) return;
        const { cells, nX, nY, maxCount } = heatmapCfg;
        if (!maxCount) return;

        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        const ctx = chart.ctx;

        const cellW = nX > 1
            ? Math.abs(xScale.getPixelForValue(1) - xScale.getPixelForValue(0))
            : xScale.width;
        const cellH = nY > 1
            ? Math.abs(yScale.getPixelForValue(1) - yScale.getPixelForValue(0))
            : yScale.height;

        ctx.save();
        ctx.beginPath();
        ctx.rect(xScale.left, yScale.top, xScale.width, yScale.height);
        ctx.clip();

        for (let xi = 0; xi < nX; xi++) {
            for (let yi = 0; yi < nY; yi++) {
                const count = cells[xi][yi];
                if (count === 0) continue;

                const t = maxCount > 1 ? Math.log(count) / Math.log(maxCount) : 1;
                const alpha = 0.12 + 0.83 * t;
                const cx = xScale.getPixelForValue(xi);
                const cy = yScale.getPixelForValue(yi);

                ctx.fillStyle = `rgba(37, 99, 235, ${alpha.toFixed(3)})`;
                ctx.fillRect(cx - cellW / 2, cy - cellH / 2, cellW, cellH);
                ctx.strokeStyle = "rgba(0,0,0,0.07)";
                ctx.lineWidth = 0.5;
                ctx.strokeRect(cx - cellW / 2, cy - cellH / 2, cellW, cellH);
            }
        }

        ctx.restore();
    },
};
