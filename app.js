/* global luxon, Chart */

"use strict";

const { DateTime } = luxon;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const dateFrom = document.getElementById("date-from");
const dateTo = document.getElementById("date-to");
const cumsumBox = document.getElementById("cumsum-toggle");
const emptyMsg = document.getElementById("empty-msg");
const canvas = document.getElementById("chart");
const canvas2 = document.getElementById("chart2");

// ── State ────────────────────────────────────────────────────────────────────
let rawData = [];  // [{timestamp: string, value: number}, ...]
let chart = null;
let chart2 = null;
let spanningBarsCfg = [];  // shared with spanningBarsPlugin

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse ISO timestamp string → Luxon DateTime (local-time, no zone shift). */
function parseTs(ts) {
    return DateTime.fromISO(ts);
}

/** Left-pad a number to 2 digits. */
function pad2(n) {
    return String(n).padStart(2, "0");
}

/** Build a bucket key from a DateTime for the given bucket type. */
function bucketKey(dt, type) {
    if (type === "daily") return dt.toISODate();                            // "2026-06-08"
    if (type === "weekly") return `${dt.weekYear}-W${pad2(dt.weekNumber)}`; // "2026-W23"
    if (type === "monthly") return `${dt.year}-${pad2(dt.month)}`;          // "2026-06"
    throw new Error(`Unknown bucket type: ${type}`);
}

/**
 * Aggregate filtered entries into a sorted Map<key, sum>.
 * @param {Array}  entries  — filtered raw data
 * @param {string} type     — "daily" | "weekly" | "monthly"
 * @returns {Map<string, number>}
 */
function bucket(entries, type) {
    const map = new Map();
    for (const { timestamp, value } of entries) {
        const key = bucketKey(parseTs(timestamp), type);
        map.set(key, (map.get(key) ?? 0) + value);
    }
    // Sort keys lexicographically (ISO formats sort correctly as strings)
    return new Map([...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1));
}

/**
 * Compute cumulative sum over an ordered Map's values.
 * @param {Map<string, number>} dailyMap
 * @returns {number[]}
 */
function cumsum(dailyMap) {
    let acc = 0;
    return [...dailyMap.values()].map(v => (acc += v));
}

/** Convert a bucket key back to a representative Luxon DateTime. */
function parseKey(key, type) {
    if (type === "daily") return DateTime.fromISO(key);
    if (type === "weekly") {
        const [y, w] = key.split("-W");
        return DateTime.fromObject({ weekYear: +y, weekNumber: +w, weekday: 1 });
    }
    if (type === "monthly") return DateTime.fromISO(key + "-01");
    throw new Error(`Unknown bucket type: ${type}`);
}

/** Return the next bucket key immediately following `key`. */
function nextBucketKey(key, type) {
    if (type === "daily")
        return DateTime.fromISO(key).plus({ days: 1 }).toISODate();
    if (type === "weekly") {
        const [y, w] = key.split("-W");
        const dt = DateTime.fromObject({ weekYear: +y, weekNumber: +w, weekday: 1 }).plus({ weeks: 1 });
        return `${dt.weekYear}-W${pad2(dt.weekNumber)}`;
    }
    if (type === "monthly")
        return DateTime.fromISO(key + "-01").plus({ months: 1 }).toFormat("yyyy-MM");
    throw new Error(`Unknown bucket type: ${type}`);
}

/**
 * Fill gaps in a sorted bucket map so every period between the first and last
 * key is present; absent periods receive null as their value.
 * @param {Map<string, number>} map
 * @param {string} type
 * @returns {Map<string, number|null>}
 */
function fillGaps(map, type) {
    if (map.size === 0) return map;
    const filled = new Map();
    const keys = [...map.keys()];
    const last = keys[keys.length - 1];
    let cur = keys[0];
    while (cur <= last) {
        filled.set(cur, map.has(cur) ? map.get(cur) : null);
        cur = nextBucketKey(cur, type);
    }
    return filled;
}

// ── Chart render ──────────────────────────────────────────────────────────────

// Bucket types ordered finest → coarsest
const BUCKET_TYPES = ["daily", "weekly", "monthly"];

const BUCKET_COLORS = {
    daily: { bg: "rgba(59, 130, 246, 0.7)", border: "rgba(59, 130, 246, 1)" },
    weekly: { bg: "rgba(245, 158, 11, 0.5)", border: "rgba(245, 158, 11, 0.9)" },
    monthly: { bg: "rgba(16, 185, 129, 0.4)", border: "rgba(16, 185, 129, 0.85)" },
};
// Higher order → drawn first (behind); lower order → drawn on top
const BUCKET_ORDER_N = { daily: 1, weekly: 2, monthly: 3 };
const BUCKET_LABEL = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

// ── Time-of-day buckets ───────────────────────────────────────────────────────

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

function todBucket(dt) {
    const h = dt.hour;
    if (h < 6) return "00–06";
    if (h < 9) return "06–09";
    if (h < 12) return "09–12";
    if (h < 15) return "12–15";
    if (h < 18) return "15–18";
    if (h < 21) return "18–21";
    return "21–24";
}

/**
 * Custom plugin: draws coarse-bucket bars as full-width spanning rectangles.
 * Each bar covers from the left edge of the first fine label in its period to
 * the right edge of the last, so adjacent bars touch with no artificial gap.
 * Config lives on chart.config._spanningBarsCfg:
 *   Array<{ bg, border, coarseMap: Map<string,number>, fineToCoarseKey: string[] }>
 * Uses beforeDatasetsDraw so coarse bars sit behind the finest dataset.
 */
const spanningBarsPlugin = {
    id: "spanningBars",
    beforeDatasetsDraw(chart) {
        const cfgList = spanningBarsCfg;
        if (!cfgList || !cfgList.length) return;

        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        const ctx = chart.ctx;
        const fineLabels = chart.data.labels;
        const n = fineLabels.length;
        if (!n) return;

        // Pixel width of one fine-bucket slot
        const slotWidth = n > 1
            ? xScale.getPixelForValue(fineLabels[1]) - xScale.getPixelForValue(fineLabels[0])
            : xScale.width;
        const halfSlot = slotWidth / 2;
        const baseY = yScale.getPixelForValue(0);

        ctx.save();
        ctx.beginPath();
        ctx.rect(xScale.left, yScale.top, xScale.width, yScale.height);
        ctx.clip();

        // cfgList is ordered coarsest first so coarser bars render behind finer ones
        for (const { bg, border, coarseMap, fineToCoarseKey } of cfgList) {
            // Group fine-label indices by coarse key
            const indicesByCoarse = new Map();
            for (let i = 0; i < fineToCoarseKey.length; i++) {
                const ck = fineToCoarseKey[i];
                if (!indicesByCoarse.has(ck)) indicesByCoarse.set(ck, []);
                indicesByCoarse.get(ck).push(i);
            }

            for (const [coarseKey, indices] of indicesByCoarse) {
                const val = coarseMap.get(coarseKey);
                if (val == null) continue;

                const leftPx = xScale.getPixelForValue(fineLabels[indices[0]]) - halfSlot;
                const rightPx = xScale.getPixelForValue(fineLabels[indices[indices.length - 1]]) + halfSlot;
                const topPx = yScale.getPixelForValue(val);
                const y0 = Math.min(topPx, baseY);
                const h = Math.abs(baseY - topPx);
                const w = rightPx - leftPx;

                ctx.fillStyle = bg;
                ctx.fillRect(leftPx, y0, w, h);
                ctx.strokeStyle = border;
                ctx.lineWidth = 1;
                ctx.strokeRect(leftPx, y0, w, h);
            }
        }
        ctx.restore();
    },
};

/** Returns selected bucket types sorted finest → coarsest; falls back to daily. */
function getActiveBuckets() {
    const sel = BUCKET_TYPES.filter(t =>
        document.getElementById(`bucket-${t}`).checked
    );
    return sel.length > 0 ? sel : ["daily"];
}

function render() {
    const fromVal = dateFrom.value;
    const toVal = dateTo.value;

    // Filter raw data by date range (compare date strings — ISO sorts correctly)
    const filtered = rawData.filter(({ timestamp }) => {
        const day = timestamp.slice(0, 10); // "YYYY-MM-DD"
        return (!fromVal || day >= fromVal) && (!toVal || day <= toVal);
    });

    // Active bucket types, finest first
    const activeBuckets = getActiveBuckets();
    const finestType = activeBuckets[0];

    // Build sparse bucket map for each active type
    const sparseMaps = new Map(activeBuckets.map(t => [t, bucket(filtered, t)]));

    // Gap-fill the finest map: every period between first and last gets a label;
    // absent periods have null values which Chart.js renders as empty slots.
    const finestFilled = fillGaps(sparseMaps.get(finestType), finestType);
    const labels = [...finestFilled.keys()];
    const finestData = [...finestFilled.values()];

    // Empty state
    const isEmpty = sparseMaps.get(finestType).size === 0;
    emptyMsg.hidden = !isEmpty;
    canvas.style.visibility = isEmpty ? "hidden" : "visible";
    if (isEmpty) {
        if (chart) { chart.destroy(); chart = null; }
        renderTable(filtered, fromVal, toVal);
        renderTod(filtered);
        return;
    }

    // ── datasets ─────────────────────────────────────────────────────────────

    const datasets = [];
    spanningBarsCfg = [];   // reset; plugin reads this directly

    // Finest-bucket bars: barPercentage 1.0 so present bars are immediately adjacent;
    // absent (null) periods produce visible gaps naturally.
    {
        const c = BUCKET_COLORS[finestType];
        datasets.push({
            type: "bar",
            label: BUCKET_LABEL[finestType],
            data: finestData,
            backgroundColor: c.bg,
            borderColor: c.border,
            borderWidth: 1,
            barPercentage: 1.0,
            categoryPercentage: 1.0,
            yAxisID: "y",
            order: BUCKET_ORDER_N[finestType],
        });
    }

    // Coarser buckets: phantom dataset (all-null, for legend swatch only);
    // actual bars are drawn by spanningBarsPlugin as full-width spanning rects.
    // Iterate coarsest → finest so the plugin draws them in that order.
    for (const type of [...activeBuckets].slice(1).reverse()) {
        const c = BUCKET_COLORS[type];
        const coarseMap = sparseMaps.get(type);
        const coarseIdx = spanningBarsCfg.length;  // index this entry will occupy

        datasets.push({
            type: "bar",
            label: BUCKET_LABEL[type],
            data: new Array(labels.length).fill(null),
            backgroundColor: c.bg,
            borderColor: c.border,
            borderWidth: 1,
            yAxisID: "y",
            order: BUCKET_ORDER_N[type],
            _coarseIdx: coarseIdx,
        });

        // Pre-compute fine-label → coarse-key mapping once for the plugin.
        const fineToCoarseKey = labels.map(fl =>
            bucketKey(parseKey(fl, finestType), type)
        );
        spanningBarsCfg.push({ bg: c.bg, border: c.border, coarseMap, fineToCoarseKey });
    }

    // Cumulative line
    const showCumsum = cumsumBox.checked;
    if (showCumsum) {
        const dailyMap = bucket(filtered, "daily");
        const cumsumArr = cumsum(dailyMap);
        let cumsumAligned;

        if (finestType === "daily") {
            // Carry the running total forward across gap-filled absent days.
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
                return lastCs; // carry forward across gap-filled absent periods
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
            yAxisID: "y2",
            order: 0,
        });
    }

    // ── scales ───────────────────────────────────────────────────────────────

    // y-max must account for all active bucket maps, not just the finest,
    // because coarse bars are drawn by the plugin outside Chart.js data range.
    const allValues = [...sparseMaps.values()]
        .flatMap(m => [...m.values()])
        .filter(v => v != null);
    const yMax = allValues.length > 0 ? Math.max(...allValues) : 0;

    const scales = {
        x: {
            ticks: { maxRotation: 45, autoSkip: true, font: { size: 11 } },
            grid: { color: "rgba(0,0,0,0.05)" },
        },
        y: {
            position: "left",
            beginAtZero: true,
            suggestedMax: yMax,
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

    // ── chart ────────────────────────────────────────────────────────────────

    if (chart) {
        chart.destroy();
        chart = null;
    }

    const chartConfig = {
        type: "bar",
        data: { labels, datasets },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            grouped: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: {
                    display: activeBuckets.length > 1 || showCumsum,
                    position: "top",
                    labels: { font: { size: 11 }, boxWidth: 14 },
                },
                tooltip: {
                    mode: "index",
                    intersect: false,
                    callbacks: {
                        title(tooltipItems) {
                            const label = tooltipItems[0]?.label ?? "";
                            const dt = parseKey(label, finestType);
                            if (finestType === "daily") return `${dt.toFormat("ccc")}, ${label}`;
                            if (finestType === "weekly") return `${label} (${dt.toFormat("ccc dd MMM")})`;
                            return label; // monthly
                        },
                        label(ctx) {
                            const coarseIdx = ctx.dataset._coarseIdx;
                            if (coarseIdx != null) {
                                const cfg = spanningBarsCfg[coarseIdx];
                                const coarseKey = cfg.fineToCoarseKey[ctx.dataIndex];
                                const val = cfg.coarseMap.get(coarseKey);
                                if (val == null) return null;
                                return `${ctx.dataset.label}: ${val}`;
                            }
                            const v = ctx.parsed.y;
                            if (v == null) return null;
                            return `${ctx.dataset.label}: ${v}`;
                        },
                    },
                },
            },
            scales,
        },
        plugins: [spanningBarsPlugin],
    };

    chart = new Chart(canvas, chartConfig);
    renderTable(filtered, fromVal, toVal);
    renderTod(filtered);
    syncChartLayouts();
}

// ── Sync chart x-axis alignment ───────────────────────────────────────────────

/**
 * After both charts are rendered, equalise their left/right margins so the
 * x-axes are pixel-aligned despite one chart having an extra y2 axis.
 */
function syncChartLayouts() {
    if (!chart || !chart2) return;
    const ca = chart.chartArea;
    const ca2 = chart2.chartArea;
    if (!ca || !ca2) return;

    const targetLeft = Math.max(ca.left, ca2.left);
    const targetRight = Math.max(chart.width - ca.right, chart2.width - ca2.right);

    const padL1 = Math.round(targetLeft - ca.left);
    const padR1 = Math.round(targetRight - (chart.width - ca.right));
    const padL2 = Math.round(targetLeft - ca2.left);
    // Chart.js's internal axis padding is not fully reflected in chartArea.right;
    // add a small correction when chart has a right-side y2 axis.
    const y2Extra = chart.scales.y2 ? 16 : 0;
    const padR2 = Math.round(targetRight - (chart2.width - ca2.right)) + y2Extra;

    if (padL1 > 0 || padR1 > 0) {
        chart.config.options.layout = { padding: { left: padL1, right: padR1 } };
        chart.update("none");
    }
    if (padL2 > 0 || padR2 > 0) {
        chart2.config.options.layout = { padding: { left: padL2, right: padR2 } };
        chart2.update("none");
    }
}

// ── Monthly stats table ───────────────────────────────────────────────────────

/**
 * Compute per-month aggregate stats based on daily buckets in the date range.
 * Days present in the range but absent from the data count as 0.
 * @param {Array}  filtered  — already range-filtered raw entries
 * @param {string} fromVal   — "YYYY-MM-DD" or ""
 * @param {string} toVal     — "YYYY-MM-DD" or ""
 * @returns {Array<Object>}
 */
function computeMonthlyStats(filtered, fromVal, toVal) {
    const dailyMap = bucket(filtered, "daily");

    // Resolve range boundaries
    const allDays = [...dailyMap.keys()].sort();
    const startDate = DateTime.fromISO(fromVal || (allDays[0] ?? null));
    const endDate = DateTime.fromISO(toVal || (allDays[allDays.length - 1] ?? null));
    if (!startDate.isValid || !endDate.isValid) return [];

    const rows = [];
    let monthStart = startDate.startOf("month");
    const lastMonth = endDate.startOf("month");

    while (monthStart.toMillis() <= lastMonth.toMillis()) {
        const monthEnd = monthStart.endOf("month");

        // Clamp to selected range
        const rangeStart = monthStart.toMillis() >= startDate.toMillis() ? monthStart : startDate;
        const rangeEnd = monthEnd.toMillis() <= endDate.toMillis() ? monthEnd : endDate;

        // Enumerate every calendar day in [rangeStart, rangeEnd]
        const values = [];
        let d = rangeStart.startOf("day");
        const lastDay = rangeEnd.startOf("day");
        while (d.toMillis() <= lastDay.toMillis()) {
            values.push(dailyMap.get(d.toISODate()) ?? 0);
            d = d.plus({ days: 1 });
        }

        const n = values.length;
        const total = values.reduce((a, b) => a + b, 0);
        const mean = total / n;

        const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
        const sd = Math.sqrt(variance);

        const sorted = [...values].sort((a, b) => a - b);
        const median = n % 2 === 1
            ? sorted[Math.floor(n / 2)]
            : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;

        const freq = new Map();
        for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
        let mode = values[0], maxFreq = 0;
        for (const [v, f] of freq) {
            if (f > maxFreq || (f === maxFreq && v < mode)) { mode = v; maxFreq = f; }
        }

        rows.push({
            year: monthStart.year,
            month: monthStart.toFormat("LLLL"),
            mean, sd, median, mode,
            min: sorted[0],
            max: sorted[n - 1],
            total,
        });

        monthStart = monthStart.plus({ months: 1 });
    }

    return rows;
}

function renderTable(filtered, fromVal, toVal) {
    const container = document.getElementById("stats-table-container");
    const tbody = document.querySelector("#stats-table tbody");
    const rows = computeMonthlyStats(filtered, fromVal, toVal);

    tbody.innerHTML = "";
    if (rows.length === 0) {
        container.hidden = true;
        return;
    }

    // Count rows per year for rowspan merging
    const yearCount = {};
    for (const row of rows) yearCount[row.year] = (yearCount[row.year] || 0) + 1;
    const yearSeen = {};

    for (const row of rows) {
        const tr = document.createElement("tr");
        let yearCell = "";
        if (!yearSeen[row.year]) {
            yearSeen[row.year] = true;
            yearCell = `<td class="col-label" rowspan="${yearCount[row.year]}">${row.year}</td>`;
        }
        tr.innerHTML =
            yearCell +
            `<td class="col-label">${row.month}</td>` +
            `<td>${row.mean.toFixed(1)} ± ${row.sd.toFixed(1)}</td>` +
            `<td>${row.median.toFixed(1)}</td>` +
            `<td>${row.mode}</td>` +
            `<td>${row.min}</td>` +
            `<td>${row.max}</td>` +
            `<td>${row.total}</td>`;
        tbody.appendChild(tr);
    }
    container.hidden = false;
}

// ── Time-of-day stacked area chart ────────────────────────────────────────────

function renderTod(filtered) {
    const activeBuckets = getActiveBuckets();
    const finestType = activeBuckets[0];

    const finestSparse = bucket(filtered, finestType);

    if (finestSparse.size === 0) {
        if (chart2) { chart2.destroy(); chart2 = null; }
        return;
    }

    const finestFilled = fillGaps(finestSparse, finestType);
    const labels = [...finestFilled.keys()];

    // Accumulate sums per (dateKey, todBucket)
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

    if (chart2) { chart2.destroy(); chart2 = null; }

    chart2 = new Chart(canvas2, {
        type: "line",
        data: { labels, datasets },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: "top",
                    labels: { font: { size: 11 }, boxWidth: 14 },
                },
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
                            return label; // monthly
                        },
                        label(ctx) {
                            if (!ctx.parsed.y) return null;
                            return `${ctx.dataset.label}: ${ctx.parsed.y}`;
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
                    stacked: true,
                    beginAtZero: true,
                    title: { display: true, text: "Sum", font: { size: 11 } },
                    grid: { color: "rgba(0,0,0,0.07)" },
                    ticks: { font: { size: 11 } },
                },
            },
        },
    });
}

// ── Initialise ────────────────────────────────────────────────────────────────

async function init() {
    const resp = await fetch("data.json");
    if (!resp.ok) throw new Error(`Failed to load data.json: ${resp.status}`);
    rawData = await resp.json();

    if (rawData.length === 0) {
        emptyMsg.hidden = false;
        canvas.style.visibility = "hidden";
        return;
    }

    // Set default date range to full extent of data
    const days = rawData.map(d => d.timestamp.slice(0, 10)).sort();
    dateFrom.value = days[0];
    dateTo.value = days[days.length - 1];

    render();

    // Wire controls
    dateFrom.addEventListener("change", render);
    dateTo.addEventListener("change", render);

    document.getElementById("btn-ytd").addEventListener("click", () => {
        const today = DateTime.now();
        dateFrom.value = today.startOf("year").toISODate();
        dateTo.value = today.toISODate();
        render();
    });
    document.getElementById("btn-qtd").addEventListener("click", () => {
        const today = DateTime.now();
        dateFrom.value = today.startOf("quarter").toISODate();
        dateTo.value = today.toISODate();
        render();
    });
    document.getElementById("btn-mtd").addEventListener("click", () => {
        const today = DateTime.now();
        dateFrom.value = today.startOf("month").toISODate();
        dateTo.value = today.toISODate();
        render();
    });
    cumsumBox.addEventListener("change", render);
    document.querySelectorAll('input[name="bucket"]').forEach(r =>
        r.addEventListener("change", () => {
            const anyChecked = BUCKET_TYPES.some(t =>
                document.getElementById(`bucket-${t}`).checked
            );
            if (!anyChecked) {
                document.getElementById("bucket-daily").checked = true;
            }
            render();
        })
    );
}

init().catch(err => {
    console.error(err);
    emptyMsg.textContent = "Error loading data.";
    emptyMsg.hidden = false;
    canvas.style.visibility = "hidden";
});

// ── Chart resize handles ──────────────────────────────────────────────────────

document.querySelectorAll(".chart-resizer").forEach(resizer => {
    resizer.addEventListener("mousedown", e => {
        e.preventDefault();
        const container = resizer.previousElementSibling;
        const startY = e.clientY;
        const startH = container.getBoundingClientRect().height;

        resizer.classList.add("dragging");
        document.body.style.userSelect = "none";
        document.body.style.cursor = "row-resize";

        function onMouseMove(e) {
            const newH = Math.max(80, startH + e.clientY - startY);
            container.style.height = newH + "px";
            const chartInst = Chart.getChart(container.querySelector("canvas"));
            if (chartInst) chartInst.resize();
        }

        function onMouseUp() {
            resizer.classList.remove("dragging");
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        }

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    });
});
