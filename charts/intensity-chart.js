/* global Chart */

import { bucket, bucketKey, fillGaps, parseKey, parseTs } from "../utils.js";
import { getSubperiodSlots } from "./chart-utils.js";
import { heatmapPlugin } from "./heatmap-plugin.js";

function buildRowRanges(bucketType, outerKey, rowCount) {
    const base = parseKey(outerKey, bucketType).startOf("day");
    const unit = bucketType === "daily" ? "hours" : "days";
    const limit = bucketType === "monthly" ? Math.min(rowCount, base.daysInMonth) : rowCount;
    const row = new Array(rowCount).fill(null);
    let start = base;
    for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
        const end = base.plus({ [unit]: rowIndex + 1 });
        row[rowIndex] = { start: start.toMillis(), end: end.toMillis() };
        start = end;
    }
    return row;
}

function upperBound(values, target) {
    let low = 0;
    let high = values.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (values[middle] <= target) low = middle + 1;
        else high = middle;
    }
    return low;
}

function lowerBound(values, target) {
    let low = 0;
    let high = values.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (values[middle] < target) low = middle + 1;
        else high = middle;
    }
    return low;
}

function addRegionBorders(region, rowCount, output) {
    const inRegion = new Set(region.map(([column, row]) => column * rowCount + row));
    for (const [column, row] of region) {
        if (!inRegion.has((column - 1) * rowCount + row))
            output.push(column - 0.5, row - 0.5, column - 0.5, row + 0.5);
        if (!inRegion.has((column + 1) * rowCount + row))
            output.push(column + 0.5, row - 0.5, column + 0.5, row + 0.5);
        if (row === 0 || !inRegion.has(column * rowCount + row - 1))
            output.push(column - 0.5, row - 0.5, column + 0.5, row - 0.5);
        if (row === rowCount - 1 || !inRegion.has(column * rowCount + row + 1))
            output.push(column - 0.5, row + 0.5, column + 0.5, row + 0.5);
    }
}

function formatWindowRange(start, end) {
    const format = start.hasSame(end, "day") ? "HH:mm" : "dd/MM HH:mm";
    return `${start.toFormat(format)}–${end.toFormat(format)}`;
}

export function renderIntensityChart(oldChart, canvas, filtered, bucketType, showWindows = true) {
    if (oldChart) oldChart.destroy();
    if (filtered.length === 0) return null;

    const outerFilled = fillGaps(bucket(filtered, bucketType), bucketType);
    const xLabels = [...outerFilled.keys()];
    const xLabelIndex = new Map(xLabels.map((key, index) => [key, index]));
    const nX = xLabels.length;
    const { slotIndex, labels: yLabels, title: yTitle } = getSubperiodSlots(bucketType);
    const nY = yLabels.length;

    const cells = Array.from({ length: nX }, () => new Array(nY).fill(0));
    const certainCells = Array.from({ length: nX }, () => new Array(nY).fill(0));
    const windowCells = Array.from({ length: nX }, () => new Array(nY).fill(0));
    let maxCount = 0;

    const outerStartMs = xLabels.map(key => parseKey(key, bucketType).startOf("day").toMillis());
    const rowCache = new Array(nX);
    const rowRanges = column => rowCache[column]
        ?? (rowCache[column] = buildRowRanges(bucketType, xLabels[column], nY));

    const overlayWindows = [];
    const uniqueWindows = new Map();
    for (const { timestamp, window } of filtered) {
        const dt = parseTs(timestamp);
        const column = xLabelIndex.get(bucketKey(dt, bucketType));
        if (column === undefined) continue;
        const row = slotIndex(dt);
        cells[column][row] += 1;
        if (cells[column][row] > maxCount) maxCount = cells[column][row];

        if (!window) {
            certainCells[column][row] += 1;
            continue;
        }

        const windowStart = parseTs(window.start);
        const windowEnd = parseTs(window.end);
        const windowStartMs = windowStart.toMillis();
        const windowEndMs = windowEnd.toMillis();
        const guessRange = rowRanges(column)[row];
        const fitsInCell = guessRange
            && windowStartMs >= guessRange.start
            && windowEndMs <= guessRange.end;
        if (fitsInCell) {
            certainCells[column][row] += 1;
        } else {
            const key = `${window.start}|${window.end}`;
            if (!uniqueWindows.has(key)) uniqueWindows.set(key, { windowStartMs, windowEndMs });
            overlayWindows.push({
                column,
                row,
                label: formatWindowRange(windowStart, windowEnd),
            });
        }
    }

    const windowBorders = [];
    if (showWindows) {
        for (const uniqueWindow of uniqueWindows.values()) {
            const region = [];
            const firstColumn = Math.max(0, upperBound(outerStartMs, uniqueWindow.windowStartMs) - 1);
            const lastColumn = lowerBound(outerStartMs, uniqueWindow.windowEndMs) - 1;
            for (let column = firstColumn; column <= lastColumn; column++) {
                const ranges = rowRanges(column);
                for (let row = 0; row < nY; row++) {
                    const range = ranges[row];
                    if (!range) continue;
                    if (range.start < uniqueWindow.windowEndMs && range.end > uniqueWindow.windowStartMs) {
                        windowCells[column][row] = Math.max(windowCells[column][row], 1);
                        region.push([column, row]);
                    }
                }
            }
            addRegionBorders(region, nY, windowBorders);
        }
        for (const { column, row } of overlayWindows) windowCells[column][row] = 2;
    }

    const guessLabels = new Map();
    for (const { column, row, label } of overlayWindows) {
        const key = `${column},${row}`;
        if (!guessLabels.has(key)) guessLabels.set(key, []);
        guessLabels.get(key).push(label);
    }

    const drawCells = [];
    const points = [];
    for (let column = 0; column < nX; column++) {
        for (let row = 0; row < nY; row++) {
            const count = cells[column][row];
            const windowState = windowCells[column][row];
            if (count > 0 || windowState > 0) {
                points.push({
                    x: column,
                    y: row,
                    count,
                    windowState,
                    guessLabels: windowState === 2 ? guessLabels.get(`${column},${row}`) : undefined,
                });
            }
            if (count > 0) {
                const guess = showWindows && windowState === 2;
                drawCells.push({
                    x: column,
                    y: row,
                    count,
                    guess,
                    mixed: guess && certainCells[column][row] > 0,
                });
            }
        }
    }

    return new Chart(canvas, {
        type: "scatter",
        data: {
            datasets: [{ data: points, pointRadius: 0, pointHitRadius: 12 }],
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "nearest", intersect: true },
            plugins: {
                legend: { display: false },
                heatmap: {
                    cells: drawCells,
                    nX,
                    nY,
                    maxCount,
                    windowBorders: showWindows ? windowBorders : undefined,
                },
                tooltip: {
                    filter: item => !(item.raw.windowState === 1 && item.raw.count === 0),
                    callbacks: {
                        label(ctx) {
                            const { x: column, y: row, count, windowState, guessLabels: labels } = ctx.raw;
                            let suffix = "";
                            if (windowState === 2) {
                                const uniqueLabels = [...new Set(labels)];
                                const guessWord = labels.length === 1 ? "guess" : "guesses";
                                const windowWord = uniqueLabels.length === 1 ? "window" : "windows";
                                suffix = ` (${labels.length} ${guessWord}, ${windowWord} ${uniqueLabels.join(", ")})`;
                            }
                            return `${xLabels[column]}, ${yLabels[row]}: ${count}${suffix}`;
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
                        scale.ticks = yLabels.map((_, index) => ({ value: index }));
                    },
                    ticks: {
                        font: { size: 11 },
                        callback(value) {
                            const label = yLabels[Math.round(value)];
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