// ── Shared plugin state (Option A: setter functions) ─────────────────────────

let spanningBarsCfg = [];
let heatmapCfg = null;

export function setSpanningBarsCfg(cfg) {
    spanningBarsCfg = cfg;
}

export function setHeatmapCfg(cfg) {
    heatmapCfg = cfg;
}

// ── spanningBarsPlugin ────────────────────────────────────────────────────────

/**
 * Custom plugin: draws coarse-bucket bars as full-width spanning rectangles.
 * Each bar covers from the left edge of the first fine label in its period to
 * the right edge of the last, so adjacent bars touch with no artificial gap.
 * Uses beforeDatasetsDraw so coarse bars sit behind the finest dataset.
 */
export const spanningBarsPlugin = {
    id: "spanningBars",
    beforeDatasetsDraw(chart) {
        const cfgList = spanningBarsCfg;
        if (!cfgList || !cfgList.length) return;

        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        const ctx = chart.ctx;
        const fineLabels = chart.data.labels;
        const n = fineLabels.length;
        if (!n) return;

        const slotWidth = n > 1
            ? xScale.getPixelForValue(fineLabels[1]) - xScale.getPixelForValue(fineLabels[0])
            : xScale.width;
        const halfSlot = slotWidth / 2;
        const baseY = yScale.getPixelForValue(0);

        ctx.save();
        ctx.beginPath();
        ctx.rect(xScale.left, yScale.top, xScale.width, yScale.height);
        ctx.clip();

        // cfgList is ordered coarsest first so coarser bars render behind finer ones
        for (const { bg, border, coarseMap, fineToCoarseKey } of cfgList) {
            const indicesByCoarse = new Map();
            for (let i = 0; i < fineToCoarseKey.length; i++) {
                const ck = fineToCoarseKey[i];
                if (!indicesByCoarse.has(ck)) indicesByCoarse.set(ck, []);
                indicesByCoarse.get(ck).push(i);
            }

            for (const [coarseKey, indices] of indicesByCoarse) {
                const val = coarseMap.get(coarseKey);
                if (val == null) continue;

                const leftPx = xScale.getPixelForValue(fineLabels[indices[0]]) - halfSlot;
                const rightPx = xScale.getPixelForValue(fineLabels[indices[indices.length - 1]]) + halfSlot;
                const topPx = yScale.getPixelForValue(val);
                const y0 = Math.min(topPx, baseY);
                const h = Math.abs(baseY - topPx);
                const w = rightPx - leftPx;

                ctx.fillStyle = bg;
                ctx.fillRect(leftPx, y0, w, h);
                ctx.strokeStyle = border;
                ctx.lineWidth = 1;
                ctx.strokeRect(leftPx, y0, w, h);
            }
        }
        ctx.restore();
    },
};

// ── heatmapPlugin ─────────────────────────────────────────────────────────────

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
