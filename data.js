/* global luxon */

import { bucket, bucketKey, parseKey, nextBucketKey, parseTs, pad2 } from "./utils.js";

const { DateTime } = luxon;

/** Human-readable row label for a period, given its (unclipped) start/end DateTimes. */
function periodLabel(bucketType, periodStart, periodEnd) {
    if (bucketType === "monthly") return periodStart.toFormat("LLLL");
    if (bucketType === "weekly") return `W${pad2(periodStart.weekNumber)}, ${periodStart.toFormat("LLL d")}–${periodEnd.toFormat("LLL d")}`;
    return periodStart.toFormat("LLL d"); // daily
}

/** Consecutive inter-event gaps, ordered by timestamp and attributed to the later event. */
export function computeInterarrivalGaps(filtered) {
    const sorted = [...filtered].sort((a, b) =>
        parseTs(a.timestamp).toMillis() - parseTs(b.timestamp).toMillis()
    );

    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
        const previous = parseTs(sorted[i - 1].timestamp);
        const current = parseTs(sorted[i].timestamp);
        gaps.push({ previous, current, hours: current.diff(previous, "hours").hours });
    }
    return gaps;
}

/**
 * Compute per-period aggregate stats based on daily buckets in the date range.
 * Days present in the range but absent from the data count as 0.
 * @param {Array}  filtered   — already range-filtered raw entries
 * @param {string} bucketType — "daily" | "weekly" | "monthly"
 * @param {string} fromVal    — "YYYY-MM-DD" or ""
 * @param {string} toVal      — "YYYY-MM-DD" or ""
 * @returns {Array<Object>}
 */
export function computePeriodStats(filtered, bucketType, fromVal, toVal) {
    const dailyMap = bucket(filtered, "daily");

    const allDays = [...dailyMap.keys()].sort();
    const startDate = DateTime.fromISO(fromVal || (allDays[0] ?? null));
    const endDate = DateTime.fromISO(toVal || (allDays[allDays.length - 1] ?? null));
    if (!startDate.isValid || !endDate.isValid) return [];

    const rows = [];
    let key = bucketKey(startDate, bucketType);
    const lastKey = bucketKey(endDate, bucketType);

    while (key <= lastKey) {
        const periodStart = parseKey(key, bucketType);
        const periodEnd = bucketType === "monthly" ? periodStart.endOf("month")
            : bucketType === "weekly" ? periodStart.plus({ days: 6 })
                : periodStart; // daily

        const rangeStart = periodStart.toMillis() >= startDate.toMillis() ? periodStart : startDate;
        const rangeEnd = periodEnd.toMillis() <= endDate.toMillis() ? periodEnd : endDate;

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
        let maxFreq = 0;
        for (const [, f] of freq) { if (f > maxFreq) maxFreq = f; }
        const modes = [...freq.entries()].filter(([, f]) => f === maxFreq).map(([v]) => v).sort((a, b) => a - b);

        rows.push({
            year: periodStart.year,
            label: periodLabel(bucketType, periodStart, periodEnd),
            mean, sd, median, modes, modeCount: maxFreq,
            min: sorted[0], minCount: freq.get(sorted[0]),
            max: sorted[n - 1], maxCount: freq.get(sorted[n - 1]),
            total,
        });

        key = nextBucketKey(key, bucketType);
    }

    return rows;
}

/**
 * Compute per-period stats of inter-event time gaps (hours).
 * Each gap is attributed to the period of the later event.
 * @param {Array}  filtered   — range-filtered raw entries
 * @param {string} bucketType — "daily" | "weekly" | "monthly"
 * @returns {Array<Object>}
 */
export function computeGapStats(filtered, bucketType) {
    if (filtered.length < 2) return [];

    const byPeriod = new Map();
    for (const { current, hours } of computeInterarrivalGaps(filtered)) {
        const key = bucketKey(current, bucketType);
        if (!byPeriod.has(key)) {
            const periodStart = parseKey(key, bucketType);
            const periodEnd = bucketType === "monthly" ? periodStart.endOf("month")
                : bucketType === "weekly" ? periodStart.plus({ days: 6 })
                    : periodStart; // daily
            byPeriod.set(key, { year: periodStart.year, label: periodLabel(bucketType, periodStart, periodEnd), gaps: [] });
        }
        byPeriod.get(key).gaps.push(hours);
    }

    const rows = [];
    for (const [, { year, label, gaps }] of [...byPeriod.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
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
        let maxFreq = 0;
        for (const [, f] of freq) { if (f > maxFreq) maxFreq = f; }
        const modes = [...freq.entries()].filter(([, f]) => f === maxFreq).map(([v]) => v).sort((a, b) => a - b);
        const minGap = sortedGaps[0];
        const maxGap = sortedGaps[n - 1];
        const minCount = sortedGaps.filter(v => v === minGap).length;
        const maxCount = sortedGaps.filter(v => v === maxGap).length;

        rows.push({ year, label, mean, sd, median, modes, modeCount: maxFreq, min: minGap, minCount, max: maxGap, maxCount, total: n });
    }
    return rows;
}
