/* global luxon, Chart */

import { bucket, fillGaps, cumsum, bucketKey, parseKey, parseTs, todBucket } from "./utils.js";
import { setHeatmapCfg, heatmapPlugin } from "./plugins.js";

const { DateTime } = luxon;

//  Constants

export const BUCKET_TYPES = ["daily", "weekly", "monthly"];

const TOD_BUCKETS = ["00–06", "06–09", "09–12", "12–15", "15–18", "18–21", "21–24"];

const TOD_COLORS = [
    { bg: "rgba( 30,  58, 138, 0.65)", border: "rgba( 30,  58, 138, 0.9)" },  // 00-06 midnight
    { bg: "rgba(  6, 213, 217, 0.65)", border: "rgba(  6, 213, 217, 0.9)" },  // 06-09 dawn
    { bg: "rgba( 34, 197,  94, 0.65)", border: "rgba( 34, 197,  94, 0.9)" },  // 09-12 morning
    { bg: "rgba(234, 179,   8, 0.65)", border: "rgba(234, 179,   8, 0.9)" },  // 12-15 midday
    { bg: "rgba(249, 115,  22, 0.65)", border: "rgba(249, 115,  22, 0.9)" },  // 15-18 afternoon
    { bg: "rgba(239,  68,  68, 0.65)", border: "rgba(239,  68,  68, 0.9)" },  // 18-21 evening
    { bg: "rgba(124,  58, 237, 0.65)", border: "rgba(124,  58, 237, 0.9)" },  // 21-24 night
];

//  Time-of-day stacked area chart (chart2)

/**
 * @param {Chart|null} oldChart
 * @param {HTMLCanvasElement} canvas
 * @param {Array} filtered
 * @param {string[]} activeBuckets
 * @returns {Chart|null}
 */
export function renderTodChart(oldChart, canvas, filtered, activeBuckets, showCumsum) {
    if (oldChart) oldChart.destroy();

    const finestType = activeBuckets[0];
    const finestSparse = bucket(filtered, finestType);
    if (finestSparse.size === 0) return null;

    const finestFilled = fillGaps(finestSparse, finestType);
    const labels = [...finestFilled.keys()];

    const todMaps = new Map(TOD_BUCKETS.map(t => [t, new Map()]));
    for (const { timestamp, value } of filtered) {
        const dt = parseTs(timestamp);
        const dk = bucketKey(dt, finestType);
        const tk = todBucket(dt);
        const sub = todMaps.get(tk);
        sub.set(dk, (sub.get(dk) ?? 0) + value);
    }

    const datasets = TOD_BUCKETS.map((tod, i) => {
        const c = TOD_COLORS[i];
        const todMap = todMaps.get(tod);
        return {
            label: tod,
            data: labels.map(lbl => todMap.get(lbl) ?? 0),
            backgroundColor: c.bg,
            borderColor: c.border,
            borderWidth: 1,
            fill: true,
            tension: 0.3,
            pointRadius: labels.length > 60 ? 0 : 2,
        };
    });

    if (showCumsum) {
        const dailyMap = bucket(filtered, "daily");
        const cumsumArr = cumsum(dailyMap);
        let cumsumAligned;

        if (finestType === "daily") {
            let acc = 0;
            cumsumAligned = labels.map(dayKey => {
                const v = dailyMap.get(dayKey);
                if (v != null) acc += v;
                return acc;
            });
        } else {
            const dailyCumsumMap = new Map(
                [...dailyMap.keys()].map((k, i) => [k, cumsumArr[i]])
            );
            let lastCs = 0;
            cumsumAligned = labels.map(bucketLabel => {
                let periodMax = null;
                for (const [dayKey, cs] of dailyCumsumMap) {
                    if (bucketKey(DateTime.fromISO(dayKey), finestType) === bucketLabel) {
                        if (periodMax === null || cs > periodMax) periodMax = cs;
                    }
                }
                if (periodMax !== null) lastCs = periodMax;
                return lastCs;
            });
        }

        datasets.push({
            type: "line",
            label: "Cumulative",
            data: cumsumAligned,
            borderColor: "rgba(239, 68, 68, 0.9)",
            backgroundColor: "transparent",
            borderWidth: 2,
            pointRadius: 2,
            stepped: "after",
            fill: false,
            yAxisID: "y2",
            order: 0,
        });
    }

    const scales = {
        x: {
            ticks: { maxRotation: 45, autoSkip: true, font: { size: 11 } },
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
        type: "line",
        data: { labels, datasets },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: "index",
                    intersect: false,
                    itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
                    callbacks: {
                        title(tooltipItems) {
                            const label = tooltipItems[0]?.label ?? "";
                            const dt = parseKey(label, finestType);
                            if (finestType === "daily") return `${dt.toFormat("ccc")}, ${label}`;
                            if (finestType === "weekly") return `${label} (${dt.toFormat("ccc dd MMM")})`;
                            return label;
                        },
                        label(ctx) {
                            if (ctx.dataset.yAxisID === "y2") {
                                return `Cumulative: ${ctx.parsed.y}`;
                            }
                            if (!ctx.parsed.y) return null;
                            return `${ctx.dataset.label}: ${ctx.parsed.y}`;
                        },
                    },
                },
            },
            scales,
        },
    });
}

//  Inter-arrival scatter plot (chart3)

/**
 * @param {Chart|null} oldChart
 * @param {HTMLCanvasElement} canvas
 * @param {Array} filtered
 * @param {string[]} activeBuckets
 * @returns {Chart|null}
 */
export function renderInterarrivalChart(oldChart, canvas, filtered, activeBuckets) {
    if (oldChart) oldChart.destroy();
    if (filtered.length < 2) return null;

    const finestType = activeBuckets[0];

    const sorted = [...filtered].sort((a, b) =>
        parseTs(a.timestamp).toMillis() - parseTs(b.timestamp).toMillis()
    );

    // Group gap hours by the bucket of the later event
    const gapsByBucket = new Map(); // Map<string, number[]>
    for (let i = 1; i < sorted.length; i++) {
        const prev = parseTs(sorted[i - 1].timestamp);
        const curr = parseTs(sorted[i].timestamp);
        const gapHours = curr.diff(prev, "hours").hours;
        const key = bucketKey(curr, finestType);
        if (!gapsByBucket.has(key)) gapsByBucket.set(key, []);
        gapsByBucket.get(key).push(gapHours);
    }

    const finestFilled = fillGaps(bucket(filtered, finestType), finestType);
    const labels = [...finestFilled.keys()];

    const totalGaps = [...gapsByBucket.values()].reduce((s, a) => s + a.length, 0);

    return new Chart(canvas, {
        type: "boxplot",
        data: {
            labels,
            datasets: [{
                label: "Inter-event gap (h)",
                data: labels.map(lbl => gapsByBucket.get(lbl) ?? null),
                backgroundColor: "rgba(99, 102, 241, 0.2)",
                borderColor: "rgba(99, 102, 241, 0.9)",
                borderWidth: 1,
                medianColor: "rgba(99, 102, 241, 1.0)",
                itemRadius: totalGaps > 300 ? 0 : 4,
                itemBackgroundColor: "rgba(99, 102, 241, 0.55)",
                itemBorderColor: "rgba(99, 102, 241, 0.9)",
                itemBorderWidth: 0,
                outlierRadius: 3,
                outlierBackgroundColor: "rgba(239, 68, 68, 0.6)",
                outlierBorderColor: "rgba(239, 68, 68, 0.9)",
            }],
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: "index",
                    intersect: false,
                    callbacks: {
                        title(tooltipItems) {
                            const label = tooltipItems[0]?.label ?? "";
                            const dt = parseKey(label, finestType);
                            if (finestType === "daily") return `${dt.toFormat("ccc")}, ${label}`;
                            if (finestType === "weekly") return `${label} (${dt.toFormat("ccc dd MMM")})`;
                            return label;
                        },
                        label(ctx) {
                            const v = ctx.parsed;
                            if (!v || v.median == null) return null;
                            return [
                                `Median: ${v.median.toFixed(1)} h`,
                                `Mean: ${v.mean.toFixed(1)} h`,
                                `IQR: ${v.q1.toFixed(1)} – ${v.q3.toFixed(1)} h`,
                                `Range: ${v.min.toFixed(1)} – ${v.max.toFixed(1)} h`,
                            ];
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

//  Intra-period intensity heatmap (chart4)

/**
 * @param {Chart|null} oldChart
 * @param {HTMLCanvasElement} canvas
 * @param {Array} filtered
 * @param {string[]} activeBuckets
 * @returns {Chart|null}
 */
export function renderIntensityChart(oldChart, canvas, filtered, activeBuckets) {
    if (oldChart) oldChart.destroy();
    setHeatmapCfg(null);
    if (filtered.length === 0) return null;

    const finestType = activeBuckets[0];

    let slotFn, xLabels, xTitle;
    if (finestType === "daily") {
        slotFn = dt => dt.hour;
        xLabels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
        xTitle = "Hour of day";
    } else if (finestType === "weekly") {
        slotFn = dt => dt.weekday - 1;  // 0 = Mon … 6 = Sun
        xLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        xTitle = "Day of week";
    } else {
        slotFn = dt => dt.day - 1;      // 0 = 1st … 30 = 31st
        xLabels = Array.from({ length: 31 }, (_, i) => String(i + 1));
        xTitle = "Day of month";
    }

    const nX = xLabels.length;
    const yValues = [...new Set(filtered.map(e => e.value))].sort((a, b) => a - b);
    const nY = yValues.length;
    const valueToIdx = new Map(yValues.map((v, i) => [v, i]));

    const cells = Array.from({ length: nX }, () => new Array(nY).fill(0));
    let maxCount = 0;
    for (const { timestamp, value } of filtered) {
        const xi = slotFn(parseTs(timestamp));
        const yi = valueToIdx.get(value);
        if (yi === undefined) continue;
        cells[xi][yi]++;
        if (cells[xi][yi] > maxCount) maxCount = cells[xi][yi];
    }

    setHeatmapCfg({ cells, nX, nY, maxCount, xLabels, yValues });

    const points = [];
    for (let xi = 0; xi < nX; xi++) {
        for (let yi = 0; yi < nY; yi++) {
            if (cells[xi][yi] > 0)
                points.push({ x: xi, y: yi, count: cells[xi][yi] });
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
                tooltip: {
                    callbacks: {
                        label(ctx) {
                            const { x: xi, y: yi, count } = ctx.raw;
                            return `${xLabels[xi]}, value ${yValues[yi]}: ${count} event${count !== 1 ? "s" : ""}`;
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
                        scale.ticks = Array.from({ length: nX }, (_, i) => ({ value: i }));
                    },
                    ticks: {
                        autoSkip: true,
                        maxRotation: 45,
                        font: { size: 11 },
                        callback(val) { return xLabels[val] ?? ""; },
                    },
                    grid: { color: "rgba(0,0,0,0.05)" },
                },
                y: {
                    type: "linear",
                    min: -0.5,
                    max: nY - 0.5,
                    title: { display: true, text: "Value", font: { size: 11 } },
                    afterBuildTicks(scale) {
                        scale.ticks = yValues.map((_, i) => ({ value: i }));
                    },
                    ticks: {
                        font: { size: 11 },
                        callback(val) {
                            const v = yValues[Math.round(val)];
                            return v !== undefined ? v : "";
                        },
                    },
                    grid: { color: "rgba(0,0,0,0.07)" },
                },
            },
        },
        plugins: [heatmapPlugin],
    });
}

