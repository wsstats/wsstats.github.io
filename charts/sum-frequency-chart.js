/* global Chart */

import { bucketKey, parseTs } from "../utils.js";
import { getSubperiodSlots } from "./chart-utils.js";
import { heatmapPlugin } from "./heatmap-plugin.js";

export function renderSumFrequencyChart(oldChart, canvas, filtered, bucketType) {
    if (oldChart) oldChart.destroy();
    if (filtered.length === 0) return null;

    const { slotIndex, labels: xLabels, title: xTitle, sumTitle: yTitle } = getSubperiodSlots(bucketType);
    const nX = xLabels.length;
    const subSums = new Map();
    const subSlots = new Map();
    for (const { timestamp } of filtered) {
        const dt = parseTs(timestamp);
        const outerKey = bucketKey(dt, bucketType);
        const slot = slotIndex(dt);
        const key = `${outerKey}|${slot}`;
        subSums.set(key, (subSums.get(key) ?? 0) + 1);
        subSlots.set(key, slot);
    }

    const slotDistrib = Array.from({ length: nX }, () => new Map());
    for (const [key, sum] of subSums) {
        const slot = subSlots.get(key);
        const distribution = slotDistrib[slot];
        distribution.set(sum, (distribution.get(sum) ?? 0) + 1);
    }

    const allSumValues = new Set();
    for (const distribution of slotDistrib) {
        for (const sum of distribution.keys()) allSumValues.add(sum);
    }
    const yValues = [...allSumValues].sort((a, b) => a - b);
    const nY = yValues.length;
    if (nY === 0) return null;
    const sumToIndex = new Map(yValues.map((value, index) => [value, index]));

    const cells = Array.from({ length: nX }, () => new Array(nY).fill(0));
    let maxCount = 0;
    for (let xi = 0; xi < nX; xi++) {
        for (const [sum, count] of slotDistrib[xi]) {
            const yi = sumToIndex.get(sum);
            cells[xi][yi] = count;
            if (count > maxCount) maxCount = count;
        }
    }

    const points = [];
    for (let xi = 0; xi < nX; xi++) {
        for (let yi = 0; yi < nY; yi++) {
            if (cells[xi][yi] > 0) points.push({ x: xi, y: yi, count: cells[xi][yi] });
        }
    }

    return new Chart(canvas, {
        type: "scatter",
        data: {
            datasets: [{
                data: points,
                pointRadius: 0,
                pointHitRadius: 12,
            }],
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "nearest", intersect: true },
            plugins: {
                legend: { display: false },
                heatmap: { cells: points, nX, nY, maxCount },
                tooltip: {
                    callbacks: {
                        label(ctx) {
                            const { x: xi, y: yi, count } = ctx.raw;
                            const xLabel = bucketType === "daily" ? `${xLabels[xi]}:00` : xLabels[xi];
                            return `${xLabel}, sum=${yValues[yi]}: ${count} period${count !== 1 ? "s" : ""}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    type: "linear",
                    min: -0.5,
                    max: nX - 0.5,
                    title: { display: true, text: xTitle, font: { size: 11 } },
                    afterBuildTicks(scale) {
                        scale.ticks = Array.from({ length: nX }, (_, index) => ({ value: index }));
                    },
                    ticks: {
                        autoSkip: true,
                        maxRotation: 45,
                        font: { size: 11 },
                        callback(value) { return xLabels[value] ?? ""; },
                    },
                    grid: { color: "rgba(0,0,0,0.05)" },
                },
                y: {
                    type: "linear",
                    min: -0.5,
                    max: nY - 0.5,
                    title: { display: true, text: yTitle, font: { size: 11 } },
                    afterBuildTicks(scale) {
                        scale.ticks = yValues.map((_, index) => ({ value: index }));
                    },
                    ticks: {
                        font: { size: 11 },
                        callback(value) {
                            const label = yValues[Math.round(value)];
                            return label !== undefined ? label : "";
                        },
                    },
                    grid: { color: "rgba(0,0,0,0.07)" },
                },
            },
        },
        plugins: [heatmapPlugin],
    });
}