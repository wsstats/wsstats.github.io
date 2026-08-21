//  heatmapPlugin

/** Stroke diagonal stripes inside the given cell rect, used to mark a cell that mixes an
 * exact timestamp with a guessed one. */
function drawStripes(ctx, x, y, w, h, color) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    const gap = 10;
    const diag = w + h;
    for (let o = -diag; o < diag; o += gap) {
        ctx.beginPath();
        ctx.moveTo(x + o, y);
        ctx.lineTo(x + o + h, y + h);
        ctx.stroke();
    }
    ctx.restore();
}

/**
 * Custom plugin: renders the heatmap cells for heatmap charts.
 * Reads config from chart.options.plugins.heatmap.
 */
export const heatmapPlugin = {
    id: "heatmap",
    beforeDatasetsDraw(chart) {
        const cfg = chart.options.plugins?.heatmap;
        if (!cfg) return;
        const { cells, nX, nY, maxCount, windowBorders } = cfg;
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

        const logMax = maxCount > 1 ? Math.log(maxCount) : 0;
        for (const { x: xi, y: yi, count, guess, mixed } of cells) {
            const rx = xScale.getPixelForValue(xi) - cellW / 2;
            const ry = yScale.getPixelForValue(yi) - cellH / 2;
            const t = logMax ? Math.log(count) / logMax : 1;

            if (mixed) {
                // Both an exact and a guessed timestamp land here — blue fill for the
                // real density, with yellow stripes marking the guess.
                const alpha = 0.12 + 0.83 * t;
                ctx.fillStyle = `rgba(37, 99, 235, ${alpha.toFixed(3)})`;
                ctx.fillRect(rx, ry, cellW, cellH);
                drawStripes(ctx, rx, ry, cellW, cellH, "rgba(234, 179, 8, 0.85)");
            } else {
                // The guessed timestamp of a window is itself uncertain — mark it yellow, not blue,
                // with a higher baseline alpha since a lone guess (count 1) should still stand out.
                const alpha = guess ? 0.45 + 0.5 * t : 0.12 + 0.83 * t;
                const rgb = guess ? "234, 179, 8" : "37, 99, 235";
                ctx.fillStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
                ctx.fillRect(rx, ry, cellW, cellH);
            }
            ctx.strokeStyle = "rgba(0,0,0,0.07)";
            ctx.lineWidth = 0.5;
            ctx.strokeRect(rx, ry, cellW, cellH);
        }

        // Each window contributes its own outline, so adjacent/overlapping windows and
        // same-time-slot windows on different days each keep a border between them.
        if (windowBorders?.length) {
            ctx.strokeStyle = "rgba(202, 138, 4, 0.55)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < windowBorders.length; i += 4) {
                ctx.moveTo(xScale.getPixelForValue(windowBorders[i]), yScale.getPixelForValue(windowBorders[i + 1]));
                ctx.lineTo(xScale.getPixelForValue(windowBorders[i + 2]), yScale.getPixelForValue(windowBorders[i + 3]));
            }
            ctx.stroke();
        }

        ctx.restore();
    },
};

