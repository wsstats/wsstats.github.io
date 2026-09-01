/** Stroke diagonal stripes inside a cell that mixes exact and guessed timestamps. */
function drawStripes(ctx, x, y, width, height, color) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    const gap = 10;
    const diagonal = width + height;
    for (let offset = -diagonal; offset < diagonal; offset += gap) {
        ctx.beginPath();
        ctx.moveTo(x + offset, y);
        ctx.lineTo(x + offset + height, y + height);
        ctx.stroke();
    }
    ctx.restore();
}

export const heatmapPlugin = {
    id: "heatmap",
    beforeDatasetsDraw(chart) {
        const config = chart.options.plugins?.heatmap;
        if (!config) return;
        const { cells, nX, nY, maxCount, windowBorders } = config;
        if (!maxCount) return;

        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        const ctx = chart.ctx;
        const cellWidth = nX > 1
            ? Math.abs(xScale.getPixelForValue(1) - xScale.getPixelForValue(0))
            : xScale.width;
        const cellHeight = nY > 1
            ? Math.abs(yScale.getPixelForValue(1) - yScale.getPixelForValue(0))
            : yScale.height;

        ctx.save();
        ctx.beginPath();
        ctx.rect(xScale.left, yScale.top, xScale.width, yScale.height);
        ctx.clip();

        const logMax = maxCount > 1 ? Math.log(maxCount) : 0;
        for (const { x: xi, y: yi, count, guess, mixed } of cells) {
            const x = xScale.getPixelForValue(xi) - cellWidth / 2;
            const y = yScale.getPixelForValue(yi) - cellHeight / 2;
            const intensity = logMax ? Math.log(count) / logMax : 1;

            if (mixed) {
                const alpha = 0.12 + 0.83 * intensity;
                ctx.fillStyle = `rgba(37, 99, 235, ${alpha.toFixed(3)})`;
                ctx.fillRect(x, y, cellWidth, cellHeight);
                drawStripes(ctx, x, y, cellWidth, cellHeight, "rgba(234, 179, 8, 0.85)");
            } else {
                const alpha = guess ? 0.45 + 0.5 * intensity : 0.12 + 0.83 * intensity;
                const rgb = guess ? "234, 179, 8" : "37, 99, 235";
                ctx.fillStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
                ctx.fillRect(x, y, cellWidth, cellHeight);
            }
            ctx.strokeStyle = "rgba(0,0,0,0.07)";
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x, y, cellWidth, cellHeight);
        }

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