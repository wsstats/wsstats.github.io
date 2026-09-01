/* global Chart */

import { bucket, bucketKey, fillGaps, parseTs } from "../utils.js";

export function renderClusterChart(oldChart, canvas, filtered, bucketType, minEvents, maxGapMinutes) {
    if (oldChart) oldChart.destroy();
    if (filtered.length === 0) return null;

    const sparse = bucket(filtered, bucketType);
    if (sparse.size === 0) return null;
    const labels = [...fillGaps(sparse, bucketType).keys()];
    const sorted = [...filtered].sort((a, b) =>
        parseTs(a.timestamp).toMillis() - parseTs(b.timestamp).toMillis()
    );

    const timestampsByBucket = new Map();
    for (const { timestamp } of sorted) {
        const dt = parseTs(timestamp);
        const key = bucketKey(dt, bucketType);
        if (!timestampsByBucket.has(key)) timestampsByBucket.set(key, []);
        timestampsByBucket.get(key).push(dt);
    }

    const maxGapMs = maxGapMinutes * 60 * 1000;
    const clusterCounts = new Map();
    for (const [key, timestamps] of timestampsByBucket) {
        let clusterCount = 0;
        let runSize = 1;
        for (let i = 1; i < timestamps.length; i++) {
            const gapMs = timestamps[i].toMillis() - timestamps[i - 1].toMillis();
            if (gapMs <= maxGapMs) {
                runSize += 1;
            } else {
                if (runSize >= minEvents) clusterCount += 1;
                runSize = 1;
            }
        }
        if (runSize >= minEvents) clusterCount += 1;
        clusterCounts.set(key, clusterCount);
    }

    const points = labels.map((label, index) => ({ x: index, y: clusterCounts.get(label) ?? 0 }));
    return new Chart(canvas, {
        type: "scatter",
        data: {
            datasets: [{
                label: "Clusters",
                data: points,
                backgroundColor: "rgba(99, 102, 241, 0.7)",
                borderColor: "rgba(99, 102, 241, 0.9)",
                pointRadius: 4,
                pointHoverRadius: 6,
            }],
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "nearest", intersect: true },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title(items) {
                            return labels[Math.round(items[0].parsed.x)] ?? "";
                        },
                        label(ctx) { return `Clusters: ${ctx.parsed.y}`; },
                    },
                },
            },
            scales: {
                x: {
                    type: "linear",
                    min: -0.5,
                    max: labels.length - 0.5,
                    title: { display: false },
                    ticks: {
                        autoSkip: true,
                        maxRotation: 45,
                        font: { size: 11 },
                        callback(value) { return labels[Math.round(value)] ?? ""; },
                    },
                    grid: { color: "rgba(0,0,0,0.05)" },
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: "Matching clusters", font: { size: 11 } },
                    ticks: { font: { size: 11 }, precision: 0 },
                    grid: { color: "rgba(0,0,0,0.07)" },
                },
            },
        },
    });
}