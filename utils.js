/* global luxon */

const { DateTime } = luxon;

/** Parse ISO timestamp string → Luxon DateTime (local-time, no zone shift). */
export function parseTs(ts) {
    return DateTime.fromISO(ts);
}

/** Left-pad a number to 2 digits. */
export function pad2(n) {
    return String(n).padStart(2, "0");
}

/** Build a bucket key from a DateTime for the given bucket type. */
export function bucketKey(dt, type) {
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
export function bucket(entries, type) {
    const map = new Map();
    for (const { timestamp } of entries) {
        const key = bucketKey(parseTs(timestamp), type);
        map.set(key, (map.get(key) ?? 0) + 1);
    }
    return new Map([...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1));
}

/**
 * Compute cumulative sum over an ordered Map's values.
 * @param {Map<string, number>} dailyMap
 * @returns {number[]}
 */
export function cumsum(dailyMap) {
    let acc = 0;
    return [...dailyMap.values()].map(v => (acc += v));
}

/** Convert a bucket key back to a representative Luxon DateTime. */
export function parseKey(key, type) {
    if (type === "daily") return DateTime.fromISO(key);
    if (type === "weekly") {
        const [y, w] = key.split("-W");
        return DateTime.fromObject({ weekYear: +y, weekNumber: +w, weekday: 1 });
    }
    if (type === "monthly") return DateTime.fromISO(key + "-01");
    throw new Error(`Unknown bucket type: ${type}`);
}

/** Return the next bucket key immediately following `key`. */
export function nextBucketKey(key, type) {
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
export function fillGaps(map, type) {
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

/** Map a Luxon DateTime to one of seven time-of-day bucket labels. */
export function todBucket(dt) {
    const h = dt.hour;
    if (h < 6) return "00–06";
    if (h < 9) return "06–09";
    if (h < 12) return "09–12";
    if (h < 15) return "12–15";
    if (h < 18) return "15–18";
    if (h < 21) return "18–21";
    return "21–24";
}

/** Map a Luxon DateTime to a zero-padded hourly label ("00"–"23"). */
export function todBucketHour(dt) {
    return pad2(dt.hour);
}
