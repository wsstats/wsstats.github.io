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
        const { cells, nX, nY, maxCount, windowCells, windowRegions, certainCells } = cfg;
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
        // Whether increasing xi/yi moves toward increasing pixel coordinates, used to
        // orient the window-border edges regardless of scale direction.
        const xIncPixel = nX > 1 ? xScale.getPixelForValue(1) > xScale.getPixelForValue(0) : true;
        const yIncPixel = nY > 1 ? yScale.getPixelForValue(1) > yScale.getPixelForValue(0) : true;

        ctx.save();
        ctx.beginPath();
        ctx.rect(xScale.left, yScale.top, xScale.width, yScale.height);
        ctx.clip();

        for (let xi = 0; xi < nX; xi++) {
            for (let yi = 0; yi < nY; yi++) {
                const count = cells[xi][yi];
                const windowState = windowCells?.[xi]?.[yi] ?? 0;
                if (count === 0 && windowState === 0) continue;

                const cx = xScale.getPixelForValue(xi);
                const cy = yScale.getPixelForValue(yi);
                const rx = cx - cellW / 2;
                const ry = cy - cellH / 2;

                if (count > 0) {
                    const t = maxCount > 1 ? Math.log(count) / Math.log(maxCount) : 1;
                    const isGuess = windowState === 2;
                    const isMixed = isGuess && (certainCells?.[xi]?.[yi] ?? 0) > 0;
                    if (isMixed) {
                        // Both an exact and a guessed timestamp land here — blue fill for the
                        // real density, with yellow stripes marking the guess.
                        const alpha = 0.12 + 0.83 * t;
                        ctx.fillStyle = `rgba(37, 99, 235, ${alpha.toFixed(3)})`;
                        ctx.fillRect(rx, ry, cellW, cellH);
                        drawStripes(ctx, rx, ry, cellW, cellH, "rgba(234, 179, 8, 0.85)");
                    } else {
                        // The guessed timestamp of a window is itself uncertain — mark it yellow, not blue,
                        // with a higher baseline alpha since a lone guess (count 1) should still stand out.
                        const alpha = isGuess ? 0.45 + 0.5 * t : 0.12 + 0.83 * t;
                        const rgb = isGuess ? "234, 179, 8" : "37, 99, 235";
                        ctx.fillStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
                        ctx.fillRect(rx, ry, cellW, cellH);
                    }
                    ctx.strokeStyle = "rgba(0,0,0,0.07)";
                    ctx.lineWidth = 0.5;
                    ctx.strokeRect(rx, ry, cellW, cellH);
                }
            }
        }

        // Outline each window's own span separately, so adjacent/overlapping windows and
        // same-time-slot windows on different days each keep a border between them.
        if (windowRegions) {
            ctx.strokeStyle = "rgba(202, 138, 4, 0.55)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (const region of windowRegions) {
                const inMask = new Set(region.map(([xi, yi]) => `${xi},${yi}`));

                for (const [xi, yi] of region) {
                    const cx = xScale.getPixelForValue(xi);
                    const cy = yScale.getPixelForValue(yi);
                    const rx = cx - cellW / 2;
                    const ry = cy - cellH / 2;

                    if (!inMask.has(`${xi - 1},${yi}`)) {
                        const edgeX = xIncPixel ? rx : rx + cellW;
                        ctx.moveTo(edgeX, ry);
                        ctx.lineTo(edgeX, ry + cellH);
                    }
                    if (!inMask.has(`${xi + 1},${yi}`)) {
                        const edgeX = xIncPixel ? rx + cellW : rx;
                        ctx.moveTo(edgeX, ry);
                        ctx.lineTo(edgeX, ry + cellH);
                    }
                    if (!inMask.has(`${xi},${yi - 1}`)) {
                        const edgeY = yIncPixel ? ry : ry + cellH;
                        ctx.moveTo(rx, edgeY);
                        ctx.lineTo(rx + cellW, edgeY);
                    }
                    if (!inMask.has(`${xi},${yi + 1}`)) {
                        const edgeY = yIncPixel ? ry + cellH : ry;
                        ctx.moveTo(rx, edgeY);
                        ctx.lineTo(rx + cellW, edgeY);
                    }
                }
            }
            ctx.stroke();
        }

        ctx.restore();
    },
};

