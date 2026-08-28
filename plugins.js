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

//  typeBackgroundPlugin

// Muted, mutually distinct hues cycled by record type so any integer type value gets a stable colour.
const TYPE_BG_PALETTE = [
    "99, 102, 241",   // indigo
    "236, 72, 153",   // pink
    "16, 185, 129",   // emerald
    "245, 158, 11",   // amber
    "59, 130, 246",   // blue
    "168, 85, 247",   // purple
    "239, 68, 68",    // red
    "20, 184, 166",   // teal
    "234, 179, 8",    // yellow
];

/** Muted, low-opacity background colour for a given record type. */
export function typeBgColor(type, alpha = 0.14) {
    const idx = ((type % TYPE_BG_PALETTE.length) + TYPE_BG_PALETTE.length) % TYPE_BG_PALETTE.length;
    return `rgba(${TYPE_BG_PALETTE[idx]}, ${alpha})`;
}

/**
 * Custom plugin: shades the full plot height behind each x-axis bucket with the colour of its
 * dominant record type. Bands are contiguous (no gaps) and drawn before datasets so bars/lines
 * render on top. Reads config from chart.options.plugins.typeBackground.
 */
export const typeBackgroundPlugin = {
    id: "typeBackground",
    beforeDatasetsDraw(chart) {
        const cfg = chart.options.plugins?.typeBackground;
        if (!cfg?.enabled) return;
        const { types } = cfg;
        if (!types?.length) return;

        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        const ctx = chart.ctx;
        const n = types.length;

        // Boundary between bucket i-1 and i; the first/last band extends to the plot edges.
        const boundary = i => {
            if (i <= 0) return xScale.left;
            if (i >= n) return xScale.right;
            return (xScale.getPixelForValue(i - 1) + xScale.getPixelForValue(i)) / 2;
        };

        ctx.save();
        ctx.beginPath();
        ctx.rect(xScale.left, yScale.top, xScale.width, yScale.height);
        ctx.clip();

        for (let i = 0; i < n; i++) {
            if (types[i] == null) continue;
            const x0 = boundary(i);
            const x1 = boundary(i + 1);
            ctx.fillStyle = typeBgColor(types[i]);
            ctx.fillRect(x0, yScale.top, x1 - x0, yScale.height);
        }

        ctx.restore();
    },
};

//  milestoneLinesPlugin

/**
 * Custom plugin: draws a labelled vertical line at each bucket where the running total first
 * reached a milestone. Reads config from chart.options.plugins.milestoneLines.
 */
export const milestoneLinesPlugin = {
    id: "milestoneLines",
    afterDatasetsDraw(chart) {
        const cfg = chart.options.plugins?.milestoneLines;
        if (!cfg?.enabled) return;
        const { marks } = cfg;
        if (!marks?.length) return;

        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        const ctx = chart.ctx;

        ctx.save();
        ctx.beginPath();
        ctx.rect(xScale.left, yScale.top, xScale.width, yScale.height);
        ctx.clip();
        ctx.strokeStyle = "rgba(17, 24, 39, 0.55)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.font = "10px sans-serif";
        ctx.fillStyle = "rgba(17, 24, 39, 0.75)";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        // Milestones sharing a bucket draw the same line; label it with the highest value reached
        // there and the gap back to the previous distinct bucket.
        const byIndex = new Map();
        for (const { index, value, days } of marks) {
            const entry = byIndex.get(index);
            if (entry) entry.value = value;
            else byIndex.set(index, { value, days });
        }

        for (const [index, { value, days }] of byIndex) {
            const x = Math.round(xScale.getPixelForValue(index)) + 0.5;
            ctx.beginPath();
            ctx.moveTo(x, yScale.top);
            ctx.lineTo(x, yScale.bottom);
            ctx.stroke();
            ctx.fillText(String(value), x + 3, yScale.top + 2);
            ctx.fillText(`+${days}d`, x + 3, yScale.top + 13);
        }

        ctx.restore();
    },
};

