/* global luxon */

import { bucket, parseTs } from "./utils.js";
import { computeMonthlyStats, computeGapStats } from "./data.js";

const { DateTime } = luxon;

// ── Monthly stats table ───────────────────────────────────────────────────────

export function renderTable(filtered, fromVal, toVal) {
    const container = document.getElementById("stats-table-container");
    const tbody = document.querySelector("#stats-table tbody");
    const rows = computeMonthlyStats(filtered, fromVal, toVal);

    tbody.innerHTML = "";
    if (rows.length === 0) {
        container.hidden = true;
        return;
    }

    // Group rows by year (preserving order)
    const rowsByYear = new Map();
    for (const row of rows) {
        if (!rowsByYear.has(row.year)) rowsByYear.set(row.year, []);
        rowsByYear.get(row.year).push(row);
    }
    const multiYear = rowsByYear.size > 1;

    const allDailyMap = bucket(filtered, "daily");
    const allKeys = [...allDailyMap.keys()].sort();
    const startDt = DateTime.fromISO(fromVal || allKeys[0]);
    const endDt = DateTime.fromISO(toVal || allKeys[allKeys.length - 1]);

    for (const [year, yearRows] of rowsByYear) {
        for (let i = 0; i < yearRows.length; i++) {
            const row = yearRows[i];
            const tr = document.createElement("tr");
            const yearCell = i === 0
                ? `<td class="col-label" rowspan="${yearRows.length}">${year}</td>`
                : "";
            tr.innerHTML =
                yearCell +
                `<td class="col-label">${row.month}</td>` +
                `<td>${row.mean.toFixed(1)} ± ${row.sd.toFixed(1)}</td>` +
                `<td>${row.median.toFixed(1)}</td>` +
                `<td>${row.mode} <span class="count">(×${row.modeCount})</span></td>` +
                `<td>${row.min} <span class="count">(×${row.minCount})</span></td>` +
                `<td>${row.max} <span class="count">(×${row.maxCount})</span></td>` +
                `<td>${row.total}</td>`;
            tbody.appendChild(tr);
        }

        if (multiYear && startDt.isValid && endDt.isValid) {
            const yearStart = DateTime.max(startDt.startOf("day"), DateTime.fromObject({ year, month: 1, day: 1 }));
            const yearEnd = DateTime.min(endDt.startOf("day"), DateTime.fromObject({ year, month: 12, day: 31 }));
            const yValues = [];
            let d = yearStart;
            while (d.toMillis() <= yearEnd.toMillis()) {
                yValues.push(allDailyMap.get(d.toISODate()) ?? 0);
                d = d.plus({ days: 1 });
            }
            if (yValues.length > 0) {
                const yn = yValues.length;
                const yTotal = yValues.reduce((a, b) => a + b, 0);
                const yMean = yTotal / yn;
                const yVar = yValues.reduce((s, v) => s + (v - yMean) ** 2, 0) / yn;
                const ySd = Math.sqrt(yVar);
                const ySorted = [...yValues].sort((a, b) => a - b);
                const yMedian = yn % 2 === 1
                    ? ySorted[Math.floor(yn / 2)]
                    : (ySorted[yn / 2 - 1] + ySorted[yn / 2]) / 2;
                const yFreq = new Map();
                for (const v of yValues) yFreq.set(v, (yFreq.get(v) ?? 0) + 1);
                let yMode = yValues[0], yModeCount = 0;
                for (const [v, f] of yFreq) {
                    if (f > yModeCount || (f === yModeCount && v < yMode)) { yMode = v; yModeCount = f; }
                }
                const yMin = ySorted[0];
                const yMax = ySorted[yn - 1];
                const tr = document.createElement("tr");
                tr.className = "year-total-row";
                tr.innerHTML =
                    `<td class="col-label" colspan="2">${year} total</td>` +
                    `<td>${yMean.toFixed(1)} ± ${ySd.toFixed(1)}</td>` +
                    `<td>${yMedian.toFixed(1)}</td>` +
                    `<td>${yMode} <span class="count">(×${yModeCount})</span></td>` +
                    `<td>${yMin} <span class="count">(×${yFreq.get(yMin)})</span></td>` +
                    `<td>${yMax} <span class="count">(×${yFreq.get(yMax)})</span></td>` +
                    `<td>${yTotal}</td>`;
                tbody.appendChild(tr);
            }
        }
    }

    // ── Total row ──
    if (rows.length > 1 && startDt.isValid && endDt.isValid) {
        const allValues = [];
        let d = startDt.startOf("day");
        const lastDay = endDt.startOf("day");
        while (d.toMillis() <= lastDay.toMillis()) {
            allValues.push(allDailyMap.get(d.toISODate()) ?? 0);
            d = d.plus({ days: 1 });
        }
        const n = allValues.length;
        const total = allValues.reduce((a, b) => a + b, 0);
        const mean = total / n;
        const variance = allValues.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
        const sd = Math.sqrt(variance);
        const sortedAll = [...allValues].sort((a, b) => a - b);
        const median = n % 2 === 1
            ? sortedAll[Math.floor(n / 2)]
            : (sortedAll[n / 2 - 1] + sortedAll[n / 2]) / 2;
        const freq = new Map();
        for (const v of allValues) freq.set(v, (freq.get(v) ?? 0) + 1);
        let mode = allValues[0], maxFreq = 0;
        for (const [v, f] of freq) {
            if (f > maxFreq || (f === maxFreq && v < mode)) { mode = v; maxFreq = f; }
        }
        const minVal = sortedAll[0];
        const maxVal = sortedAll[n - 1];
        const tr = document.createElement("tr");
        tr.className = "total-row";
        tr.innerHTML =
            `<td class="col-label" colspan="2">Total</td>` +
            `<td>${mean.toFixed(1)} ± ${sd.toFixed(1)}</td>` +
            `<td>${median.toFixed(1)}</td>` +
            `<td>${mode} <span class="count">(×${freq.get(mode)})</span></td>` +
            `<td>${minVal} <span class="count">(×${freq.get(minVal)})</span></td>` +
            `<td>${maxVal} <span class="count">(×${freq.get(maxVal)})</span></td>` +
            `<td>${total}</td>`;
        tbody.appendChild(tr);
    }

    container.hidden = false;
}

// ── Inter-event gap stats table ───────────────────────────────────────────────

export function renderGapTable(filtered) {
    const container = document.getElementById("gap-table-container");
    const tbody = document.querySelector("#gap-table tbody");
    const rows = computeGapStats(filtered);

    tbody.innerHTML = "";
    if (rows.length === 0) {
        container.hidden = true;
        return;
    }

    // Group rows by year (preserving order)
    const rowsByYear = new Map();
    for (const row of rows) {
        if (!rowsByYear.has(row.year)) rowsByYear.set(row.year, []);
        rowsByYear.get(row.year).push(row);
    }
    const multiYear = rowsByYear.size > 1;

    const sortedFull = [...filtered].sort((a, b) =>
        parseTs(a.timestamp).toMillis() - parseTs(b.timestamp).toMillis()
    );
    const allGaps = [];
    const gapsByYear = new Map();
    for (let i = 1; i < sortedFull.length; i++) {
        const prev = parseTs(sortedFull[i - 1].timestamp);
        const curr = parseTs(sortedFull[i].timestamp);
        const gapH = curr.diff(prev, "hours").hours;
        allGaps.push(gapH);
        if (multiYear) {
            const yr = curr.year;
            if (!gapsByYear.has(yr)) gapsByYear.set(yr, []);
            gapsByYear.get(yr).push(gapH);
        }
    }

    for (const [year, yearRows] of rowsByYear) {
        for (let i = 0; i < yearRows.length; i++) {
            const row = yearRows[i];
            const tr = document.createElement("tr");
            const yearCell = i === 0
                ? `<td class="col-label" rowspan="${yearRows.length}">${year}</td>`
                : "";
            tr.innerHTML =
                yearCell +
                `<td class="col-label">${row.month}</td>` +
                `<td>${row.mean.toFixed(1)} ± ${row.sd.toFixed(1)}</td>` +
                `<td>${row.median.toFixed(1)}</td>` +
                `<td>${row.mode.toFixed(1)} <span class="count">(×${row.modeCount})</span></td>` +
                `<td>${row.min.toFixed(1)} <span class="count">(×${row.minCount})</span></td>` +
                `<td>${row.max.toFixed(1)} <span class="count">(×${row.maxCount})</span></td>` +
                `<td>${row.total}</td>`;
            tbody.appendChild(tr);
        }

        if (multiYear) {
            const yGaps = gapsByYear.get(year) ?? [];
            if (yGaps.length > 0) {
                const yn = yGaps.length;
                const yMean = yGaps.reduce((a, b) => a + b, 0) / yn;
                const yVar = yGaps.reduce((s, v) => s + (v - yMean) ** 2, 0) / yn;
                const ySd = Math.sqrt(yVar);
                const ySorted = [...yGaps].sort((a, b) => a - b);
                const yMedian = yn % 2 === 1
                    ? ySorted[Math.floor(yn / 2)]
                    : (ySorted[yn / 2 - 1] + ySorted[yn / 2]) / 2;
                const yFreq = new Map();
                for (const v of yGaps) {
                    const r = Math.round(v * 10) / 10;
                    yFreq.set(r, (yFreq.get(r) ?? 0) + 1);
                }
                let yMode = yGaps[0], yModeCount = 0;
                for (const [v, f] of yFreq) {
                    if (f > yModeCount || (f === yModeCount && v < yMode)) { yMode = v; yModeCount = f; }
                }
                const yMin = ySorted[0];
                const yMax = ySorted[yn - 1];
                const yMinCount = ySorted.filter(v => v === yMin).length;
                const yMaxCount = ySorted.filter(v => v === yMax).length;
                const tr = document.createElement("tr");
                tr.className = "year-total-row";
                tr.innerHTML =
                    `<td class="col-label" colspan="2">${year} total</td>` +
                    `<td>${yMean.toFixed(1)} ± ${ySd.toFixed(1)}</td>` +
                    `<td>${yMedian.toFixed(1)}</td>` +
                    `<td>${yMode.toFixed(1)} <span class="count">(×${yModeCount})</span></td>` +
                    `<td>${yMin.toFixed(1)} <span class="count">(×${yMinCount})</span></td>` +
                    `<td>${yMax.toFixed(1)} <span class="count">(×${yMaxCount})</span></td>` +
                    `<td>${yn + 1}</td>`;
                tbody.appendChild(tr);
            }
        }
    }

    // ── Total row ──
    if (rows.length > 1 && allGaps.length > 0) {
        const n = allGaps.length;
        const mean = allGaps.reduce((a, b) => a + b, 0) / n;
        const variance = allGaps.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
        const sd = Math.sqrt(variance);
        const sortedGaps = [...allGaps].sort((a, b) => a - b);
        const median = n % 2 === 1
            ? sortedGaps[Math.floor(n / 2)]
            : (sortedGaps[n / 2 - 1] + sortedGaps[n / 2]) / 2;
        const freq = new Map();
        for (const v of allGaps) {
            const r = Math.round(v * 10) / 10;
            freq.set(r, (freq.get(r) ?? 0) + 1);
        }
        let mode = allGaps[0], maxFreq = 0;
        for (const [v, f] of freq) {
            if (f > maxFreq || (f === maxFreq && v < mode)) { mode = v; maxFreq = f; }
        }
        const minGap = sortedGaps[0];
        const maxGap = sortedGaps[n - 1];
        const minCount = sortedGaps.filter(v => v === minGap).length;
        const maxCount = sortedGaps.filter(v => v === maxGap).length;
        const tr = document.createElement("tr");
        tr.className = "total-row";
        tr.innerHTML =
            `<td class="col-label" colspan="2">Total</td>` +
            `<td>${mean.toFixed(1)} ± ${sd.toFixed(1)}</td>` +
            `<td>${median.toFixed(1)}</td>` +
            `<td>${mode.toFixed(1)} <span class="count">(×${maxFreq})</span></td>` +
            `<td>${minGap.toFixed(1)} <span class="count">(×${minCount})</span></td>` +
            `<td>${maxGap.toFixed(1)} <span class="count">(×${maxCount})</span></td>` +
            `<td>${n + 1}</td>`;
        tbody.appendChild(tr);
    }

    container.hidden = false;
}
