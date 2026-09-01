/* global Chart */

import { bucket, bucketKey, cumsum, fillGaps, pad2, parseKey, parseTs } from "../utils.js";
import { formatBucketTitle } from "./chart-utils.js";
import { cumsumFocusPlugin, milestoneLinesPlugin, typeBackgroundPlugin } from "./tod-plugins.js";

const HOURS = Array.from({ length: 24 }, (_, index) => pad2(index));
const COLOR_STOPS = [
    { hour: 0, red: 30, green: 58, blue: 138 },
    { hour: 6, red: 6, green: 213, blue: 217 },
    { hour: 9, red: 34, green: 197, blue: 94 },
    { hour: 12, red: 234, green: 179, blue: 8 },
    { hour: 15, red: 249, green: 115, blue: 22 },
    { hour: 18, red: 239, green: 68, blue: 68 },
    { hour: 21, red: 124, green: 58, blue: 237 },
    { hour: 24, red: 30, green: 58, blue: 138 },
];

function hourColor(hour, alpha) {
    const sample = hour + 0.5;
    let low = COLOR_STOPS[0];
    let high = COLOR_STOPS[COLOR_STOPS.length - 1];
    for (let index = 0; index < COLOR_STOPS.length - 1; index++) {
        if (sample >= COLOR_STOPS[index].hour && sample < COLOR_STOPS[index + 1].hour) {
            low = COLOR_STOPS[index];
            high = COLOR_STOPS[index + 1];
            break;
        }
    }
    const ratio = (sample - low.hour) / (high.hour - low.hour);
    const red = Math.round(low.red + ratio * (high.red - low.red));
    const green = Math.round(low.green + ratio * (high.green - low.green));
    const blue = Math.round(low.blue + ratio * (high.blue - low.blue));
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const HOUR_COLORS = HOURS.map((_, index) => ({
    background: hourColor(index, 0.65),
    border: hourColor(index, 0.9),
}));

function alignedCumsum(filtered, labels, bucketType) {
    const dailyMap = bucket(filtered, "daily");
    if (bucketType === "daily") {
        let total = 0;
        return labels.map(dayKey => {
            const value = dailyMap.get(dayKey);
            if (value != null) total += value;
            return total;
        });
    }

    const cumulativeValues = cumsum(dailyMap);
    const dailyCumsum = new Map(
        [...dailyMap.keys()].map((key, index) => [key, cumulativeValues[index]])
    );
    let lastCumulative = 0;
    return labels.map(label => {
        let periodMaximum = null;
        for (const [dayKey, cumulative] of dailyCumsum) {
            if (bucketKey(parseKey(dayKey, "daily"), bucketType) === label) {
                if (periodMaximum === null || cumulative > periodMaximum) periodMaximum = cumulative;
            }
        }
        if (periodMaximum !== null) lastCumulative = periodMaximum;
        return lastCumulative;
    });
}

function milestoneMarks(cumulativeValues, step, labels, bucketType) {
    if (!(step > 0)) return [];
    const marks = [];
    let next = step;
    let previousIndex = 0;
    for (let index = 0; index < cumulativeValues.length; index++) {
        while (cumulativeValues[index] >= next) {
            const days = Math.round(
                parseKey(labels[index], bucketType)
                    .diff(parseKey(labels[previousIndex], bucketType), "days").days
            );
            marks.push({ index, value: next, days });
            previousIndex = index;
            next += step;
        }
    }
    return marks;
}

export function renderTodChart(
    oldChart,
    canvas,
    filtered,
    bucketType,
    showCumsum,
    showBars = false,
    showTypeBackground = false,
    showMilestones = false,
    milestoneStep = 20
) {
    if (oldChart) oldChart.destroy();
    const sparse = bucket(filtered, bucketType);
    if (sparse.size === 0) return null;

    let labels = [...fillGaps(sparse, bucketType).keys()];
    const hourMaps = new Map(HOURS.map(hour => [hour, new Map()]));
    const typeCountsByBucket = new Map();
    for (const { timestamp, type } of filtered) {
        const dt = parseTs(timestamp);
        const bucketLabel = bucketKey(dt, bucketType);
        const hour = pad2(dt.hour);
        const hourMap = hourMaps.get(hour);
        hourMap.set(bucketLabel, (hourMap.get(bucketLabel) ?? 0) + 1);

        if (type == null) continue;
        if (!typeCountsByBucket.has(bucketLabel)) typeCountsByBucket.set(bucketLabel, new Map());
        const typeCounts = typeCountsByBucket.get(bucketLabel);
        typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    }

    let dominantTypes = labels.map(label => {
        const typeCounts = typeCountsByBucket.get(label);
        if (!typeCounts) return null;
        let dominantType = null;
        let dominantCount = -1;
        for (const [type, count] of typeCounts) {
            if (count > dominantCount) {
                dominantType = type;
                dominantCount = count;
            }
        }
        return dominantType;
    });

    const datasets = HOURS.map((hour, index) => {
        const colors = HOUR_COLORS[index];
        const hourMap = hourMaps.get(hour);
        const dataset = {
            label: hour,
            data: labels.map(label => hourMap.get(label) ?? 0),
            backgroundColor: showBars ? hourColor(index, 0.9) : colors.background,
        };
        if (showBars) {
            dataset.borderWidth = 0;
        } else {
            dataset.borderColor = colors.border;
            dataset.borderWidth = 1;
            dataset.fill = true;
            dataset.tension = 0.3;
            dataset.pointRadius = labels.length > 60 ? 0 : 2;
        }
        return dataset;
    });

    const cumulativeValues = showCumsum || showMilestones
        ? alignedCumsum(filtered, labels, bucketType)
        : null;
    const milestones = showMilestones
        ? milestoneMarks(cumulativeValues, milestoneStep, labels, bucketType)
        : [];

    if (showCumsum) {
        datasets.push({
            type: "line",
            label: "Cumulative",
            data: cumulativeValues,
            borderColor: "rgba(239, 68, 68, 0.9)",
            backgroundColor: "transparent",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.4,
            fill: false,
            yAxisID: "y2",
            order: -1,
        });
    }

    if (!showBars && labels.length === 1) {
        labels = [labels[0], labels[0]];
        dominantTypes = [dominantTypes[0], dominantTypes[0]];
        for (const dataset of datasets) dataset.data = [dataset.data[0], dataset.data[0]];
    }

    const scales = {
        x: {
            ...(showBars && { stacked: true }),
            ticks: {
                maxRotation: 45,
                autoSkip: true,
                font: { size: 11 },
                ...(!showBars && {
                    callback(value, index) {
                        return index === 1 && labels[0] === labels[1] ? "" : labels[index];
                    },
                }),
            },
            grid: { color: "rgba(0,0,0,0.05)" },
        },
        y: {
            stacked: true,
            beginAtZero: true,
            title: { display: true, text: "Sum", font: { size: 11 } },
            grid: { color: "rgba(0,0,0,0.07)" },
            ticks: { font: { size: 11 } },
        },
    };
    if (showCumsum) {
        scales.y2 = {
            position: "right",
            beginAtZero: true,
            title: { display: true, text: "Cumulative", font: { size: 11 } },
            grid: { drawOnChartArea: false },
            ticks: { font: { size: 11 } },
        };
    }

    return new Chart(canvas, {
        type: showBars ? "bar" : "line",
        data: { labels, datasets },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                typeBackground: { enabled: showTypeBackground, types: dominantTypes },
                milestoneLines: { enabled: showMilestones, marks: milestones },
                tooltip: {
                    mode: "index",
                    intersect: false,
                    itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
                    callbacks: {
                        title(items) {
                            return formatBucketTitle(items[0]?.label ?? "", bucketType);
                        },
                        label(ctx) {
                            if (ctx.dataset.yAxisID === "y2") return `Cumulative: ${ctx.parsed.y}`;
                            if (!ctx.parsed.y) return null;
                            const hour = ctx.dataset.label;
                            const nextHour = pad2((+hour + 1) % 24);
                            return `${hour}:00–${nextHour}:00: ${ctx.parsed.y}`;
                        },
                        footer(items) {
                            const total = items.reduce((sum, item) => {
                                if (item.dataset.yAxisID === "y2") return sum;
                                return sum + (item.parsed.y || 0);
                            }, 0);
                            const lines = [`Total: ${total}`];
                            const dominantType = showTypeBackground
                                ? dominantTypes[items[0]?.dataIndex]
                                : null;
                            if (dominantType != null) lines.push(`Dominant type: ${dominantType}`);
                            return lines;
                        },
                    },
                },
            },
            scales,
        },
        plugins: [typeBackgroundPlugin, milestoneLinesPlugin, cumsumFocusPlugin],
    });
}