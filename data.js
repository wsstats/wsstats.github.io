/* global luxon */

import { bucket, pad2, parseTs } from "./utils.js";

const { DateTime } = luxon;

/**
 * Compute per-month aggregate stats based on daily buckets in the date range.
 * Days present in the range but absent from the data count as 0.
 * @param {Array}  filtered  — already range-filtered raw entries
 * @param {string} fromVal   — "YYYY-MM-DD" or ""
 * @param {string} toVal     — "YYYY-MM-DD" or ""
 * @returns {Array<Object>}
 */
export function computeMonthlyStats(filtered, fromVal, toVal) {
    const dailyMap = bucket(filtered, "daily");

    const allDays = [...dailyMap.keys()].sort();
    const startDate = DateTime.fromISO(fromVal || (allDays[0] ?? null));
    const endDate = DateTime.fromISO(toVal || (allDays[allDays.length - 1] ?? null));
    if (!startDate.isValid || !endDate.isValid) return [];

    const rows = [];
    let monthStart = startDate.startOf("month");
    const lastMonth = endDate.startOf("month");

    while (monthStart.toMillis() <= lastMonth.toMillis()) {
        const monthEnd = monthStart.endOf("month");

        const rangeStart = monthStart.toMillis() >= startDate.toMillis() ? monthStart : startDate;
        const rangeEnd = monthEnd.toMillis() <= endDate.toMillis() ? monthEnd : endDate;

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
            mean, sd, median, mode, modeCount: maxFreq,
            min: sorted[0], minCount: freq.get(sorted[0]),
            max: sorted[n - 1], maxCount: freq.get(sorted[n - 1]),
            total,
        });

        monthStart = monthStart.plus({ months: 1 });
    }

    return rows;
}

/**
 * Compute per-month stats of inter-event time gaps (hours).
 * Each gap is attributed to the year/month of the later event.
 * @param {Array} filtered — range-filtered raw entries
 * @returns {Array<Object>}
 */
export function computeGapStats(filtered) {
    if (filtered.length < 2) return [];

    const sorted = [...filtered].sort((a, b) =>
        parseTs(a.timestamp).toMillis() - parseTs(b.timestamp).toMillis()
    );

    const byMonth = new Map();
    for (let i = 1; i < sorted.length; i++) {
        const prev = parseTs(sorted[i - 1].timestamp);
        const curr = parseTs(sorted[i].timestamp);
        const gapHours = curr.diff(prev, "hours").hours;
        const key = `${curr.year}-${pad2(curr.month)}`;
        if (!byMonth.has(key)) {
            byMonth.set(key, { year: curr.year, month: curr.toFormat("LLLL"), gaps: [] });
        }
        byMonth.get(key).gaps.push(gapHours);
    }

    const rows = [];
    for (const [, { year, month, gaps }] of [...byMonth.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
        const n = gaps.length;
        const mean = gaps.reduce((a, b) => a + b, 0) / n;
        const variance = gaps.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
        const sd = Math.sqrt(variance);

        const sortedGaps = [...gaps].sort((a, b) => a - b);
        const median = n % 2 === 1
            ? sortedGaps[Math.floor(n / 2)]
            : (sortedGaps[n / 2 - 1] + sortedGaps[n / 2]) / 2;

        const freq = new Map();
        for (const v of gaps) {
            const r = Math.round(v * 10) / 10;
            freq.set(r, (freq.get(r) ?? 0) + 1);
        }
        let mode = gaps[0], maxFreq = 0;
        for (const [v, f] of freq) {
            if (f > maxFreq || (f === maxFreq && v < mode)) { mode = v; maxFreq = f; }
        }
        const minGap = sortedGaps[0];
        const maxGap = sortedGaps[n - 1];
        const minCount = sortedGaps.filter(v => v === minGap).length;
        const maxCount = sortedGaps.filter(v => v === maxGap).length;

        rows.push({ year, month, mean, sd, median, mode, modeCount: maxFreq, min: minGap, minCount, max: maxGap, maxCount, total: n + 1 });
    }
    return rows;
}
