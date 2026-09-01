/* global Chart */

import { bucket, bucketKey, fillGaps } from "../utils.js";
import { computeInterarrivalGaps } from "../data.js";
import { formatBucketTitle } from "./chart-utils.js";

export function renderInterarrivalChart(oldChart, canvas, filtered, bucketType, showMax, showMean, showMedian) {
    if (oldChart) oldChart.destroy();
    if (filtered.length < 2) return null;

    const gapsByBucket = new Map();
    for (const { current, hours } of computeInterarrivalGaps(filtered)) {
        const key = bucketKey(current, bucketType);
        if (!gapsByBucket.has(key)) gapsByBucket.set(key, []);
        gapsByBucket.get(key).push(hours);
    }

    const labels = [...fillGaps(bucket(filtered, bucketType), bucketType).keys()];
    const totalGaps = [...gapsByBucket.values()].reduce((sum, gaps) => sum + gaps.length, 0);
    const datasets = [{
        label: "Inter-event gap (h)",
        data: labels.map(label => gapsByBucket.get(label) ?? null),
        backgroundColor: "rgba(99, 102, 241, 0.2)",
        borderColor: "rgba(99, 102, 241, 0.9)",
        borderWidth: 1,
        medianColor: "rgba(99, 102, 241, 1.0)",
        itemRadius: totalGaps > 1000 ? 0 : 4,
        itemBackgroundColor: "rgba(99, 102, 241, 0.55)",
        itemBorderColor: "rgba(99, 102, 241, 0.9)",
        itemBorderWidth: 0,
        outlierRadius: 3,
        outlierBackgroundColor: "rgba(239, 68, 68, 0.6)",
        outlierBorderColor: "rgba(239, 68, 68, 0.9)",
    }];

    if (showMax || showMean || showMedian) {
        const statData = labels.map(label => {
            const gaps = gapsByBucket.get(label);
            if (!gaps?.length) return { max: null, mean: null, median: null };
            const sorted = [...gaps].sort((a, b) => a - b);
            const middle = Math.floor(sorted.length / 2);
            return {
                max: sorted[sorted.length - 1],
                mean: gaps.reduce((sum, value) => sum + value, 0) / gaps.length,
                median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
            };
        });

        const lineBase = {
            type: "line",
            borderWidth: 3,
            pointRadius: 2,
            fill: false,
            tension: 0.3,
            spanGaps: true,
            backgroundColor: "transparent",
            order: -1,
        };

        if (showMax) datasets.push({
            ...lineBase,
            label: "Max",
            data: statData.map(data => data.max),
            borderColor: "rgb(239, 68, 68)",
        });
        if (showMean) datasets.push({
            ...lineBase,
            label: "Mean",
            data: statData.map(data => data.mean),
            borderColor: "rgb(234, 179, 8)",
        });
        if (showMedian) datasets.push({
            ...lineBase,
            label: "Median",
            data: statData.map(data => data.median),
            borderColor: "rgb(34, 197, 94)",
        });
    }

    return new Chart(canvas, {
        type: "boxplot",
        data: { labels, datasets },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: true },
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: "index",
                    intersect: true,
                    callbacks: {
                        title(items) {
                            return formatBucketTitle(items[0]?.label ?? "", bucketType);
                        },
                        label(ctx) {
                            const value = ctx.parsed;
                            if (ctx.dataset.type === "line") {
                                if (value.y == null) return null;
                                return `${ctx.dataset.label}: ${value.y.toFixed(1)} h`;
                            }
                            if (!value || value.median == null) return null;
                            const lines = [];
                            if (!showMedian) lines.push(`Median: ${value.median.toFixed(1)} h`);
                            if (!showMean) lines.push(`Mean: ${value.mean.toFixed(1)} h`);
                            lines.push(`IQR: ${value.q1.toFixed(1)} – ${value.q3.toFixed(1)} h`);
                            lines.push(`Range: ${value.min.toFixed(1)} – ${value.max.toFixed(1)} h`);
                            return lines;
                        },
                    },
                },
            },
            scales: {
                x: {
                    ticks: { maxRotation: 45, autoSkip: true, font: { size: 11 } },
                    grid: { color: "rgba(0,0,0,0.05)" },
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: "Inter-event gap (h)", font: { size: 11 } },
                    grid: { color: "rgba(0,0,0,0.07)" },
                    ticks: { font: { size: 11 } },
                },
            },
        },
    });
}