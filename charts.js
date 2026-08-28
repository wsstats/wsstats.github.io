/* global luxon, Chart */

import { bucket, fillGaps, cumsum, bucketKey, parseKey, parseTs, todBucketHour } from "./utils.js";
import { heatmapPlugin, typeBackgroundPlugin, milestoneLinesPlugin, cumsumFocusPlugin } from "./plugins.js";

const { DateTime } = luxon;

//  Constants

export const BUCKET_TYPES = ["daily", "weekly", "monthly"];

const TOD_HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));

// Key color stops across the 24-hour cycle; interpolated to produce a smooth gradient.
const _TOD_COLOR_STOPS = [
    { h: 0, r: 30, g: 58, b: 138 },  // midnight
    { h: 6, r: 6, g: 213, b: 217 },  // dawn
    { h: 9, r: 34, g: 197, b: 94 },  // morning
    { h: 12, r: 234, g: 179, b: 8 },  // midday
    { h: 15, r: 249, g: 115, b: 22 },  // afternoon
    { h: 18, r: 239, g: 68, b: 68 },  // evening
    { h: 21, r: 124, g: 58, b: 237 },  // night
    { h: 24, r: 30, g: 58, b: 138 },  // back to midnight
];

function _todColor(hour, alpha) {
    const h = hour + 0.5;  // sample the midpoint of the hour
    let lo = _TOD_COLOR_STOPS[0];
    let hi = _TOD_COLOR_STOPS[_TOD_COLOR_STOPS.length - 1];
    for (let i = 0; i < _TOD_COLOR_STOPS.length - 1; i++) {
        if (h >= _TOD_COLOR_STOPS[i].h && h < _TOD_COLOR_STOPS[i + 1].h) {
            lo = _TOD_COLOR_STOPS[i];
            hi = _TOD_COLOR_STOPS[i + 1];
            break;
        }
    }
    const t = (h - lo.h) / (hi.h - lo.h);
    const r = Math.round(lo.r + t * (hi.r - lo.r));
    const g = Math.round(lo.g + t * (hi.g - lo.g));
    const b = Math.round(lo.b + t * (hi.b - lo.b));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const TOD_COLORS = TOD_HOURS.map((_, i) => ({
    bg: _todColor(i, 0.65),
    border: _todColor(i, 0.9),
}));

//  Time-of-day stacked area / bar chart (chart1)

/** Running total of `filtered` aligned to `labels` (one value per bucket, carried forward). */
function _alignedCumsum(filtered, labels, finestType) {
    const dailyMap = bucket(filtered, "daily");

    if (finestType === "daily") {
        let acc = 0;
        return labels.map(dayKey => {
            const v = dailyMap.get(dayKey);
            if (v != null) acc += v;
            return acc;
        });
    }

    const cumsumArr = cumsum(dailyMap);
    const dailyCumsumMap = new Map(
        [...dailyMap.keys()].map((k, i) => [k, cumsumArr[i]])
    );
    let lastCs = 0;
    return labels.map(bucketLabel => {
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

/**
 * Bucket indices at which the running total first reaches each successive multiple of `step`.
 * Buckets aggregate several days, so the total can jump past a multiple — the line is placed at
 * the first bucket equalling or exceeding it, and skipped multiples share that bucket.
 * Each mark carries `days`, the gap to the previous milestone's bucket (or to the start of the
 * range for the first one).
 */
function _milestoneMarks(cumsumAligned, step, labels, finestType) {
    if (!(step > 0)) return [];
    const marks = [];
    let next = step;
    let prevIndex = 0;
    for (let i = 0; i < cumsumAligned.length; i++) {
        while (cumsumAligned[i] >= next) {
            const days = Math.round(
                parseKey(labels[i], finestType).diff(parseKey(labels[prevIndex], finestType), "days").days
            );
            marks.push({ index: i, value: next, days });
            prevIndex = i;
            next += step;
        }
    }
    return marks;
}

/**
 * @param {Chart|null} oldChart
 * @param {HTMLCanvasElement} canvas
 * @param {Array} filtered
 * @param {string[]} activeBuckets
 * @param {boolean} showTypeBg — shade each bucket's background by its dominant record type
 * @param {boolean} showMilestones — draw a vertical line each time the running total gains `milestoneStep`
 * @returns {Chart|null}
 */
export function renderTodChart(oldChart, canvas, filtered, activeBuckets, showCumsum, showBars = false, showTypeBg = false, showMilestones = false, milestoneStep = 20) {
    if (oldChart) oldChart.destroy();

    const finestType = activeBuckets[0];
    const finestSparse = bucket(filtered, finestType);
    if (finestSparse.size === 0) return null;

    const finestFilled = fillGaps(finestSparse, finestType);
    let labels = [...finestFilled.keys()];

    const todMaps = new Map(TOD_HOURS.map(t => [t, new Map()]));
    const typeCountsByBucket = new Map();
    for (const { timestamp, type } of filtered) {
        const dt = parseTs(timestamp);
        const dk = bucketKey(dt, finestType);
        const tk = todBucketHour(dt);
        const sub = todMaps.get(tk);
        sub.set(dk, (sub.get(dk) ?? 0) + 1);

        if (type == null) continue;
        if (!typeCountsByBucket.has(dk)) typeCountsByBucket.set(dk, new Map());
        const typeCounts = typeCountsByBucket.get(dk);
        typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    }

    // Most frequent type per bucket; ties keep whichever type was seen first.
    let dominantTypes = labels.map(key => {
        const typeCounts = typeCountsByBucket.get(key);
        if (!typeCounts) return null;
        let best = null, bestCount = -1;
        for (const [t, c] of typeCounts) {
            if (c > bestCount) { best = t; bestCount = c; }
        }
        return best;
    });

    const datasets = TOD_HOURS.map((tod, i) => {
        const c = TOD_COLORS[i];
        const todMap = todMaps.get(tod);
        const ds = {
            label: tod,
            data: labels.map(lbl => todMap.get(lbl) ?? 0),
            backgroundColor: showBars ? _todColor(i, 0.9) : c.bg,
        };
        if (showBars) {
            ds.borderWidth = 0;
        } else {
            ds.borderColor = c.border;
            ds.borderWidth = 1;
            ds.fill = true;
            ds.tension = 0.3;
            ds.pointRadius = labels.length > 60 ? 0 : 2;
        }
        return ds;
    });

    const cumsumAligned = (showCumsum || showMilestones)
        ? _alignedCumsum(filtered, labels, finestType)
        : null;
    const milestones = showMilestones ? _milestoneMarks(cumsumAligned, milestoneStep, labels, finestType) : [];

    if (showCumsum) {
        datasets.push({
            type: "line",
            label: "Cumulative",
            data: cumsumAligned,
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

    // Single-bucket: duplicate the sole data point so each series renders as a
    // horizontal line with a filled area beneath it rather than a lone dot.
    if (!showBars && labels.length === 1) {
        labels = [labels[0], labels[0]];
        dominantTypes = [dominantTypes[0], dominantTypes[0]];
        for (const ds of datasets) {
            ds.data = [ds.data[0], ds.data[0]];
        }
    }

    const scales = {
        x: {
            ...(showBars && { stacked: true }),
            ticks: {
                maxRotation: 45,
                autoSkip: true,
                font: { size: 11 },
                // Suppress the repeated right-hand tick added for the single-bucket case.
                ...(!showBars && { callback(val, i) { return (i === 1 && labels[0] === labels[1]) ? "" : labels[i]; } }),
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
            // intersect: false so the background (which can span above/below the actual bars/line) is hoverable too.
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                typeBackground: { enabled: showTypeBg, types: dominantTypes },
                milestoneLines: { enabled: showMilestones, marks: milestones },
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
                            const h = ctx.dataset.label;
                            const hNext = String((+h + 1) % 24).padStart(2, "0");
                            return `${h}:00\u2013${hNext}:00: ${ctx.parsed.y}`;
                        },
                        footer(tooltipItems) {
                            const total = tooltipItems.reduce((sum, item) => {
                                if (item.dataset.yAxisID === "y2") return sum;
                                return sum + (item.parsed.y || 0);
                            }, 0);
                            const lines = [`Total: ${total}`];
                            const domType = showTypeBg ? dominantTypes[tooltipItems[0]?.dataIndex] : null;
                            if (domType != null) lines.push(`Dominant type: ${domType}`);
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

//  Inter-arrival box-and-whisker plot (chart3)

/**
 * @param {Chart|null} oldChart
 * @param {HTMLCanvasElement} canvas
 * @param {Array} filtered
 * @param {string[]} activeBuckets
 * @param {boolean} showMax
 * @param {boolean} showMean
 * @param {boolean} showMedian
 * @returns {Chart|null}
 */
export function renderInterarrivalChart(oldChart, canvas, filtered, activeBuckets, showMax, showMean, showMedian) {
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

    const datasets = [{
        label: "Inter-event gap (h)",
        data: labels.map(lbl => gapsByBucket.get(lbl) ?? null),
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
        const statData = labels.map(lbl => {
            const gaps = gapsByBucket.get(lbl);
            if (!gaps || gaps.length === 0) return { max: null, mean: null, median: null };
            const s = [...gaps].sort((a, b) => a - b);
            const mid = Math.floor(s.length / 2);
            return {
                max: s[s.length - 1],
                mean: gaps.reduce((acc, v) => acc + v, 0) / gaps.length,
                median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2,
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
            data: statData.map(d => d.max),
            borderColor: "rgb(239, 68, 68)",
        });

        if (showMean) datasets.push({
            ...lineBase,
            label: "Mean",
            data: statData.map(d => d.mean),
            borderColor: "rgb(234, 179, 8)",
        });

        if (showMedian) datasets.push({
            ...lineBase,
            label: "Median",
            data: statData.map(d => d.median),
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
                        title(tooltipItems) {
                            const label = tooltipItems[0]?.label ?? "";
                            const dt = parseKey(label, finestType);
                            if (finestType === "daily") return `${dt.toFormat("ccc")}, ${label}`;
                            if (finestType === "weekly") return `${label} (${dt.toFormat("ccc dd MMM")})`;
                            return label;
                        },
                        label(ctx) {
                            const v = ctx.parsed;
                            if (ctx.dataset.type === "line") {
                                if (v.y == null) return null;
                                return `${ctx.dataset.label}: ${v.y.toFixed(1)} h`;
                            }
                            if (!v || v.median == null) return null;
                            const lines = [];
                            if (!showMedian) lines.push(`Median: ${v.median.toFixed(1)} h`);
                            if (!showMean) lines.push(`Mean: ${v.mean.toFixed(1)} h`);
                            lines.push(`IQR: ${v.q1.toFixed(1)} – ${v.q3.toFixed(1)} h`);
                            lines.push(`Range: ${v.min.toFixed(1)} – ${v.max.toFixed(1)} h`);
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

//  Activity intensity over time heatmap (chart2)

/**
 * Compute the [start, end) millisecond range of every sub-slot in one outer bucket column.
 * Built per column (rather than per cell) so the Luxon work is shared by all cells in it.
 * @returns {Array<{s: number, e: number}|null>} nY entries; null for slots the column lacks.
 */
function buildRowRanges(finestType, outerKey, nY) {
    const base = parseKey(outerKey, finestType).startOf("day");
    const unit = finestType === "daily" ? "hours" : "days";
    const limit = finestType === "monthly" ? Math.min(nY, base.daysInMonth) : nY;
    const row = new Array(nY).fill(null);
    let start = base;
    for (let yi = 0; yi < limit; yi++) {
        const end = base.plus({ [unit]: yi + 1 });
        row[yi] = { s: start.toMillis(), e: end.toMillis() };
        start = end;
    }
    return row;
}

/** First index of the ascending array `arr` whose value is > `v`. */
function upperBound(arr, v) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] <= v) lo = mid + 1; else hi = mid;
    }
    return lo;
}

/** First index of the ascending array `arr` whose value is >= `v`. */
function lowerBound(arr, v) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] < v) lo = mid + 1; else hi = mid;
    }
    return lo;
}

/** Outline a window's region: emit its outer edges as a flat [x0,y0,x1,y1,…] list in cell-index space. */
function regionBorders(region, nY, out) {
    const inRegion = new Set(region.map(([xi, yi]) => xi * nY + yi));
    for (const [xi, yi] of region) {
        if (!inRegion.has((xi - 1) * nY + yi))
            out.push(xi - 0.5, yi - 0.5, xi - 0.5, yi + 0.5);
        if (!inRegion.has((xi + 1) * nY + yi))
            out.push(xi + 0.5, yi - 0.5, xi + 0.5, yi + 0.5);
        if (yi === 0 || !inRegion.has(xi * nY + yi - 1))
            out.push(xi - 0.5, yi - 0.5, xi + 0.5, yi - 0.5);
        if (yi === nY - 1 || !inRegion.has(xi * nY + yi + 1))
            out.push(xi - 0.5, yi + 0.5, xi + 0.5, yi + 0.5);
    }
}

/** Format a window's [start, end) range for display, including dates only if it spans days. */
function formatWindowRange(wStart, wEnd) {
    const fmt = wStart.hasSame(wEnd, "day") ? "HH:mm" : "dd/MM HH:mm";
    return `${wStart.toFormat(fmt)}\u2013${wEnd.toFormat(fmt)}`;
}

/**
 * @param {Chart|null} oldChart
 * @param {HTMLCanvasElement} canvas
 * @param {Array} filtered
 * @param {string[]} activeBuckets
 * @param {boolean} showWindows — overlay cells touched by an uncertainty window
 * @returns {Chart|null}
 */
export function renderIntensityChart(oldChart, canvas, filtered, activeBuckets, showWindows = true) {
    if (oldChart) oldChart.destroy();
    if (filtered.length === 0) return null;

    const finestType = activeBuckets[0];

    // X-axis: one column per outer bucket (day / week / month)
    const outerFilled = fillGaps(bucket(filtered, finestType), finestType);
    const xLabels = [...outerFilled.keys()];
    const xLabelIdx = new Map(xLabels.map((k, i) => [k, i]));
    const nX = xLabels.length;

    // Y-axis: finer sub-bucket within each outer period
    let ySlotFn, yLabels, yTitle, xTitle;
    if (finestType === "daily") {
        ySlotFn = dt => dt.hour;
        yLabels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
        yTitle = "Hour of day";
        xTitle = "Day";
    } else if (finestType === "weekly") {
        ySlotFn = dt => dt.weekday - 1;  // 0 = Mon … 6 = Sun
        yLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        yTitle = "Day of week";
        xTitle = "Week";
    } else {
        ySlotFn = dt => dt.day - 1;      // 0 = 1st … 30 = 31st
        yLabels = Array.from({ length: 31 }, (_, i) => String(i + 1));
        yTitle = "Day of month";
        xTitle = "Month";
    }

    const nY = yLabels.length;

    // Accumulate value sums into cells[xi][yi]; certainCells counts exact (non-windowed, or
    // window-fits-in-cell) events, used to detect cells that mix exact and guessed timestamps.
    const cells = Array.from({ length: nX }, () => new Array(nY).fill(0));
    const certainCells = Array.from({ length: nX }, () => new Array(nY).fill(0));
    // windowCells: 0 = none, 1 = within a window's span, 2 = the guessed timestamp of a window
    const windowCells = Array.from({ length: nX }, () => new Array(nY).fill(0));
    let maxCount = 0;

    // Column boundaries in millis, used to narrow a window's overlap scan to the columns it can touch.
    const outerStartMs = xLabels.map(k => parseKey(k, finestType).startOf("day").toMillis());
    const rowCache = new Array(nX);
    const rowRanges = xi => rowCache[xi] ?? (rowCache[xi] = buildRowRanges(finestType, xLabels[xi], nY));

    // Windows fully contained within their own guess cell add no uncertainty at this bucket
    // granularity (e.g. a several-hour window within one weekly/monthly cell) — treat as certain.
    // Identical windows are shared, so their region is computed only once.
    const overlayWindows = [];
    const uniqueWindows = new Map(); // "start|end" -> { wStartMs, wEndMs }
    for (const { timestamp, window } of filtered) {
        const dt = parseTs(timestamp);
        const xi = xLabelIdx.get(bucketKey(dt, finestType));
        if (xi === undefined) continue;
        const yi = ySlotFn(dt);
        cells[xi][yi] += 1;
        if (cells[xi][yi] > maxCount) maxCount = cells[xi][yi];

        if (!window) {
            certainCells[xi][yi] += 1;
            continue;
        }

        const wStart = parseTs(window.start);
        const wEnd = parseTs(window.end);
        const wStartMs = wStart.toMillis();
        const wEndMs = wEnd.toMillis();
        const guessRange = rowRanges(xi)[yi];
        const fitsInCell = guessRange && wStartMs >= guessRange.s && wEndMs <= guessRange.e;
        if (fitsInCell) {
            certainCells[xi][yi] += 1;
        } else {
            const key = `${window.start}|${window.end}`;
            if (!uniqueWindows.has(key)) uniqueWindows.set(key, { wStartMs, wEndMs });
            overlayWindows.push({ xi, yi, key, label: formatWindowRange(wStart, wEnd) });
        }
    }

    const windowBorders = [];
    if (showWindows) {
        for (const uw of uniqueWindows.values()) {
            const region = [];
            const firstX = Math.max(0, upperBound(outerStartMs, uw.wStartMs) - 1);
            const lastX = lowerBound(outerStartMs, uw.wEndMs) - 1;
            for (let xi = firstX; xi <= lastX; xi++) {
                const row = rowRanges(xi);
                for (let yi = 0; yi < nY; yi++) {
                    const range = row[yi];
                    if (!range) continue;
                    if (range.s < uw.wEndMs && range.e > uw.wStartMs) {
                        windowCells[xi][yi] = Math.max(windowCells[xi][yi], 1);
                        region.push([xi, yi]);
                    }
                }
            }
            regionBorders(region, nY, windowBorders);
        }
        for (const { xi, yi } of overlayWindows) {
            windowCells[xi][yi] = 2;
        }
    }

    // Collect every guessed window's label per cell, since a cell can hold multiple guesses.
    const guessLabels = new Map(); // "xi,yi" -> label[]
    for (const { xi, yi, label } of overlayWindows) {
        const key = `${xi},${yi}`;
        if (!guessLabels.has(key)) guessLabels.set(key, []);
        guessLabels.get(key).push(label);
    }

    // Sparse list of the only cells the heatmap plugin has to paint, so its draw pass
    // does not rescan the full nX*nY grid on every render.
    const drawCells = [];
    const points = [];
    for (let xi = 0; xi < nX; xi++) {
        for (let yi = 0; yi < nY; yi++) {
            const count = cells[xi][yi];
            const windowState = windowCells[xi][yi];
            if (count > 0 || windowState > 0) {
                points.push({
                    x: xi, y: yi, count, windowState,
                    guessLabels: windowState === 2 ? guessLabels.get(`${xi},${yi}`) : undefined,
                });
            }
            if (count > 0) {
                const guess = showWindows && windowState === 2;
                drawCells.push({
                    x: xi, y: yi, count, guess,
                    mixed: guess && certainCells[xi][yi] > 0,
                });
            }
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
                heatmap: {
                    cells: drawCells, nX, nY, maxCount,
                    windowBorders: showWindows ? windowBorders : undefined,
                },
                tooltip: {
                    // Suppress the tooltip only for cells shaded purely by a window's span with no actual event in them.
                    filter: item => !(item.raw.windowState === 1 && item.raw.count === 0),
                    callbacks: {
                        label(ctx) {
                            const { x: xi, y: yi, count, windowState, guessLabels } = ctx.raw;
                            let suffix = "";
                            if (windowState === 2) {
                                const uniqueLabels = [...new Set(guessLabels)];
                                const guessWord = guessLabels.length === 1 ? "guess" : "guesses";
                                const windowWord = uniqueLabels.length === 1 ? "window" : "windows";
                                suffix = ` (${guessLabels.length} ${guessWord}, ${windowWord} ${uniqueLabels.join(", ")})`;
                            }
                            return `${xLabels[xi]}, ${yLabels[yi]}: ${count}${suffix}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    type: "linear",
                    min: -0.5,
                    max: nX - 0.5,
                    title: { display: false },
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
                    title: { display: true, text: yTitle, font: { size: 11 } },
                    afterBuildTicks(scale) {
                        scale.ticks = yLabels.map((_, i) => ({ value: i }));
                    },
                    ticks: {
                        font: { size: 11 },
                        callback(val) {
                            const v = yLabels[Math.round(val)];
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

//  Sum-frequency heatmap (chart4)

export function renderSumFrequencyChart(oldChart, canvas, filtered, activeBuckets) {
    if (oldChart) oldChart.destroy();
    if (filtered.length === 0) return null;

    const finestType = activeBuckets[0];

    // X-axis: time slot within each outer period
    let slotFn, xLabels, xTitle, yTitle;
    if (finestType === "daily") {
        slotFn = dt => dt.hour;
        xLabels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
        xTitle = "Hour of day";
        yTitle = "Hourly sum";
    } else if (finestType === "weekly") {
        slotFn = dt => dt.weekday - 1;  // 0 = Mon … 6 = Sun
        xLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        xTitle = "Day of week";
        yTitle = "Daily sum";
    } else {
        slotFn = dt => dt.day - 1;      // 0 = 1st … 30 = 31st
        xLabels = Array.from({ length: 31 }, (_, i) => String(i + 1));
        xTitle = "Day of month";
        yTitle = "Daily sum";
    }

    const nX = xLabels.length;

    // Step 1: accumulate value sum per (outer-period, slot)
    const subSums = new Map();   // "<outerKey>|<slot>" -> sum
    const subSlots = new Map();  // "<outerKey>|<slot>" -> slot index
    for (const { timestamp } of filtered) {
        const dt = parseTs(timestamp);
        const outerKey = bucketKey(dt, finestType);
        const slot = slotFn(dt);
        const k = `${outerKey}|${slot}`;
        subSums.set(k, (subSums.get(k) ?? 0) + 1);
        subSlots.set(k, slot);
    }

    // Step 2: for each slot, build frequency distribution of sub-bucket sums
    const slotDistrib = Array.from({ length: nX }, () => new Map());
    for (const [k, sum] of subSums) {
        const slot = subSlots.get(k);
        const distrib = slotDistrib[slot];
        distrib.set(sum, (distrib.get(sum) ?? 0) + 1);
    }

    // Y-axis: sorted unique sum values across all slots
    const allSumValues = new Set();
    for (const distrib of slotDistrib) {
        for (const sum of distrib.keys()) allSumValues.add(sum);
    }
    const yValues = [...allSumValues].sort((a, b) => a - b);
    const nY = yValues.length;
    if (nY === 0) return null;
    const sumToIdx = new Map(yValues.map((v, i) => [v, i]));

    // cells[xi][yi] = count of outer periods where slot xi summed to yValues[yi]
    const cells = Array.from({ length: nX }, () => new Array(nY).fill(0));
    let maxCount = 0;
    for (let xi = 0; xi < nX; xi++) {
        for (const [sum, count] of slotDistrib[xi]) {
            const yi = sumToIdx.get(sum);
            cells[xi][yi] = count;
            if (count > maxCount) maxCount = count;
        }
    }

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
                heatmap: { cells: points, nX, nY, maxCount },
                tooltip: {
                    callbacks: {
                        label(ctx) {
                            const { x: xi, y: yi, count } = ctx.raw;
                            const xLabel = finestType === "daily" ? `${xLabels[xi]}:00` : xLabels[xi];
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
                    title: { display: true, text: yTitle, font: { size: 11 } },
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

//  Event clustering scatter chart (chart5)

/**
 * @param {Chart|null} oldChart
 * @param {HTMLCanvasElement} canvas
 * @param {Array} filtered
 * @param {string[]} activeBuckets
 * @param {number} minEvents — minimum run length to count as a cluster
 * @param {number} maxGapMinutes — maximum gap between consecutive events within a cluster
 * @returns {Chart|null}
 */
export function renderClusterChart(oldChart, canvas, filtered, activeBuckets, minEvents, maxGapMinutes) {
    if (oldChart) oldChart.destroy();
    if (filtered.length === 0) return null;

    const finestType = activeBuckets[0];
    const sparse = bucket(filtered, finestType);
    if (sparse.size === 0) return null;
    const labels = [...fillGaps(sparse, finestType).keys()];

    const sorted = [...filtered].sort((a, b) =>
        parseTs(a.timestamp).toMillis() - parseTs(b.timestamp).toMillis()
    );

    const timestampsByBucket = new Map();
    for (const { timestamp } of sorted) {
        const dt = parseTs(timestamp);
        const key = bucketKey(dt, finestType);
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

    const points = labels.map((lbl, i) => ({ x: i, y: clusterCounts.get(lbl) ?? 0 }));

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
                            const i = Math.round(items[0].parsed.x);
                            return labels[i] ?? "";
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
                        callback(val) { return labels[Math.round(val)] ?? ""; },
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

