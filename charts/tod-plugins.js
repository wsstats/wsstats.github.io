function mutedColor(color, factor) {
    if (typeof color !== "string") return color;
    const match = color.match(/^rgba?\(([^)]+)\)$/);
    if (!match) return color;
    const channels = match[1].split(",").map(channel => channel.trim());
    const alpha = channels.length === 4 ? channels.pop() : "1";
    const [red, green, blue] = channels.map(Number);
    const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
    const muted = [red, green, blue].map(channel =>
        Math.round(channel + (luminance - channel) * factor)
    );
    return `rgba(${muted.join(", ")}, ${alpha})`;
}

export const cumsumFocusPlugin = {
    id: "cumsumFocus",
    afterEvent(chart, args) {
        const event = args.event;
        if (event.type !== "mousemove" && event.type !== "mouseout") return;

        const cumsumIndex = chart.data.datasets.findIndex(dataset => dataset.yAxisID === "y2");
        const points = cumsumIndex >= 0 ? chart.getDatasetMeta(cumsumIndex).data : [];
        let nearLine = false;
        if (event.type === "mousemove" && points.length > 1) {
            const { x, y } = event;
            const maxDistance = 10;
            for (let i = 1; i < points.length && !nearLine; i++) {
                const start = points[i - 1].getProps(["x", "y"], true);
                const end = points[i].getProps(["x", "y"], true);
                const dx = end.x - start.x;
                const dy = end.y - start.y;
                const lengthSquared = dx * dx + dy * dy;
                const projection = lengthSquared
                    ? Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared))
                    : 0;
                const closestX = start.x + projection * dx;
                const closestY = start.y + projection * dy;
                if (Math.hypot(x - closestX, y - closestY) <= maxDistance) nearLine = true;
            }
        }

        if (chart.$cumsumNearLine !== nearLine) {
            chart.$cumsumNearLine = nearLine;
            if (cumsumIndex >= 0) {
                const cumsumDataset = chart.data.datasets[cumsumIndex];
                if (cumsumDataset.$cumsumFocusBorderWidth == null) {
                    cumsumDataset.$cumsumFocusBorderWidth = cumsumDataset.borderWidth;
                }
                cumsumDataset.borderWidth = cumsumDataset.$cumsumFocusBorderWidth * (nearLine ? 1.5 : 1);
            }
            chart.data.datasets.forEach((dataset, index) => {
                if (index === cumsumIndex) return;
                if (!dataset.$cumsumFocusColors) {
                    dataset.$cumsumFocusColors = {
                        backgroundColor: dataset.backgroundColor,
                        borderColor: dataset.borderColor,
                    };
                }
                const colors = dataset.$cumsumFocusColors;
                const factor = nearLine ? 0.72 : 0;
                dataset.backgroundColor = mutedColor(colors.backgroundColor, factor);
                dataset.borderColor = mutedColor(colors.borderColor, factor);
            });
            chart.update("none");
        }
    },
    beforeDatasetsDraw(chart) {
        const cumsumIndex = chart.data.datasets.findIndex(dataset => dataset.yAxisID === "y2");
        const factor = chart.$cumsumNearLine ? 0.72 : 0;
        if (cumsumIndex >= 0) {
            const cumsumDataset = chart.data.datasets[cumsumIndex];
            const cumsumMeta = chart.getDatasetMeta(cumsumIndex);
            const borderWidth = cumsumDataset.borderWidth;
            if (cumsumMeta.dataset) cumsumMeta.dataset.options.borderWidth = borderWidth;
            for (const element of cumsumMeta.data) element.options.borderWidth = borderWidth;
        }
        chart.data.datasets.forEach((dataset, index) => {
            if (index === cumsumIndex) return;
            const colors = dataset.$cumsumFocusColors;
            if (!colors) return;
            const meta = chart.getDatasetMeta(index);
            for (const element of meta.data) {
                element.options.backgroundColor = mutedColor(colors.backgroundColor, factor);
                element.options.borderColor = mutedColor(colors.borderColor, factor);
            }
        });
    },
};

const TYPE_BACKGROUND_PALETTE = [
    "99, 102, 241",
    "236, 72, 153",
    "16, 185, 129",
    "245, 158, 11",
    "59, 130, 246",
    "168, 85, 247",
    "239, 68, 68",
    "20, 184, 166",
    "234, 179, 8",
];

function typeBackgroundColor(type, alpha = 0.14) {
    const index = ((type % TYPE_BACKGROUND_PALETTE.length) + TYPE_BACKGROUND_PALETTE.length)
        % TYPE_BACKGROUND_PALETTE.length;
    return `rgba(${TYPE_BACKGROUND_PALETTE[index]}, ${alpha})`;
}

export const typeBackgroundPlugin = {
    id: "typeBackground",
    beforeDatasetsDraw(chart) {
        const config = chart.options.plugins?.typeBackground;
        if (!config?.enabled || !config.types?.length) return;
        const { types } = config;
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        const ctx = chart.ctx;
        const count = types.length;
        const boundary = index => {
            if (index <= 0) return xScale.left;
            if (index >= count) return xScale.right;
            return (xScale.getPixelForValue(index - 1) + xScale.getPixelForValue(index)) / 2;
        };

        ctx.save();
        ctx.beginPath();
        ctx.rect(xScale.left, yScale.top, xScale.width, yScale.height);
        ctx.clip();
        for (let index = 0; index < count; index++) {
            if (types[index] == null) continue;
            const start = boundary(index);
            const end = boundary(index + 1);
            ctx.fillStyle = typeBackgroundColor(types[index]);
            ctx.fillRect(start, yScale.top, end - start, yScale.height);
        }
        ctx.restore();
    },
};

export const milestoneLinesPlugin = {
    id: "milestoneLines",
    afterDatasetsDraw(chart) {
        const config = chart.options.plugins?.milestoneLines;
        if (!config?.enabled || !config.marks?.length) return;
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
        ctx.textAlign = "right";
        ctx.textBaseline = "top";

        const byIndex = new Map();
        for (const { index, value, days } of config.marks) {
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
            ctx.fillText(String(value), x - 3, yScale.top + 2);
            ctx.fillText(`+${days}d`, x - 3, yScale.top + 13);
        }
        ctx.restore();
    },
};