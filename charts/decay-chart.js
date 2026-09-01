/* global luxon, Chart */

import { parseTs } from "../utils.js";

const { DateTime } = luxon;

const MAX_SAMPLES = 3000;
const MIN_SAMPLES = 200;

const TICK_FORMATS = {
    daily: "dd/MM HH:mm",
    weekly: "dd MMM",
    monthly: "MMM yyyy",
};

/**
 * Event decay: every event adds 1 unit to an abstract variable that decays with the given
 * half-life. Only the shape matters, so the series is normalised to its own peak.
 */
export function renderDecayChart(oldChart, canvas, filtered, bucketType, halfLifeMinutes, fromVal, toVal, scale = 1) {
    if (oldChart) oldChart.destroy();
    if (filtered.length === 0 || !(halfLifeMinutes > 0)) return null;

    const halfLifeMs = halfLifeMinutes * 60 * 1000;
    const times = Float64Array.from(filtered, ({ timestamp }) => parseTs(timestamp).toMillis());
    times.sort();

    const rangeStart = fromVal ? DateTime.fromISO(fromVal).startOf("day").toMillis() : Infinity;
    const start = Math.min(rangeStart, DateTime.fromMillis(times[0]).startOf("day").toMillis());
    const rangeEnd = toVal ? DateTime.fromISO(toVal).endOf("day").toMillis() : 0;
    const end = Math.max(rangeEnd, times[times.length - 1] + halfLifeMs, start + halfLifeMs);

    const sampleCount = Math.max(MIN_SAMPLES, Math.min(MAX_SAMPLES, Math.round(canvas.clientWidth * 2) || 1500));
    const step = (end - start) / sampleCount;
    const values = new Float64Array(sampleCount);

    // One pass over cells and events: each sample is the peak reached inside its cell, or the
    // decayed level at the cell end when the cell holds no event. This keeps spikes visible even
    // when the range spans years and a cell is far wider than the half-life.
    let eventIndex = 0;
    let level = 0;
    let lastEventTime = start;
    let peakLevel = 0;
    for (let cell = 0; cell < sampleCount; cell++) {
        const cellEnd = start + (cell + 1) * step;
        let cellPeak = 0;
        while (eventIndex < times.length && times[eventIndex] < cellEnd) {
            const time = times[eventIndex];
            level = eventIndex === 0 ? 1 : level * 2 ** (-(time - lastEventTime) / halfLifeMs) + 1;
            lastEventTime = time;
            if (level > cellPeak) cellPeak = level;
            eventIndex++;
        }
        values[cell] = cellPeak > 0
            ? cellPeak
            : level * 2 ** (-(cellEnd - lastEventTime) / halfLifeMs);
        if (cellPeak > peakLevel) peakLevel = cellPeak;
    }
    if (peakLevel <= 0) return null;

    const points = new Array(sampleCount);
    const yMax = scale > 0 ? scale : 1;
    const factor = yMax / peakLevel;
    for (let cell = 0; cell < sampleCount; cell++) {
        points[cell] = { x: start + (cell + 1) * step, y: values[cell] * factor };
    }

    const tickFormat = TICK_FORMATS[bucketType] ?? TICK_FORMATS.daily;

    return new Chart(canvas, {
        type: "line",
        data: {
            datasets: [{
                label: "Decayed activity",
                data: points,
                borderColor: "rgba(99, 102, 241, 0.9)",
                backgroundColor: "rgba(99, 102, 241, 0.15)",
                borderWidth: 1.5,
                pointRadius: 0,
                pointHitRadius: 6,
                tension: 0,
                fill: "origin",
            }],
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "nearest", axis: "x", intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title(items) {
                            return DateTime.fromMillis(items[0].parsed.x).toFormat("ccc dd LLL yyyy HH:mm");
                        },
                        label(ctx) { return `Level: ${ctx.parsed.y.toFixed(yMax >= 10 ? 1 : 3)}`; },
                    },
                },
            },
            scales: {
                x: {
                    type: "linear",
                    min: start,
                    max: end,
                    ticks: {
                        autoSkip: true,
                        maxTicksLimit: 12,
                        maxRotation: 45,
                        font: { size: 11 },
                        callback(value) { return DateTime.fromMillis(value).toFormat(tickFormat); },
                    },
                    grid: { color: "rgba(0,0,0,0.05)" },
                },
                y: {
                    min: 0,
                    max: yMax,
                    title: { display: true, text: "Decayed activity (normalised)", font: { size: 11 } },
                    ticks: { font: { size: 11 } },
                    grid: { color: "rgba(0,0,0,0.07)" },
                },
            },
        },
    });
}
