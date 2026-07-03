/* global luxon, Chart */

import { bucket } from "./utils.js";
import {
    BUCKET_TYPES,
    renderTodChart,
    renderInterarrivalChart,
    renderIntensityChart,
    renderSumFrequencyChart,
} from "./charts.js";
import { renderTable, renderGapTable } from "./tables.js";

const { DateTime } = luxon;

// DOM refs
const dateFrom = document.getElementById("date-from");
const dateTo = document.getElementById("date-to");
const cumsumBox = document.getElementById("cumsum-toggle");
const gapMaxBox = document.getElementById("gap-max-toggle");
const gapMeanBox = document.getElementById("gap-mean-toggle");
const gapMedianBox = document.getElementById("gap-median-toggle");
const emptyMsg = document.getElementById("empty-msg");
const canvas1 = document.getElementById("chart1");
const canvas2 = document.getElementById("chart2");
const canvas3 = document.getElementById("chart3");
const canvas4 = document.getElementById("chart4");

//  State
let rawData = [];  // [{timestamp: string, value: number}, ...]
let chart1 = null;
let chart2 = null;
let chart3 = null;
let chart4 = null;

//  Helpers

/** Returns the selected bucket type as a single-element array; falls back to daily. */
function getActiveBuckets() {
    return [BUCKET_TYPES.find(t =>
        document.getElementById(`bucket-${t}`).checked
    ) ?? "daily"];
}

//  Render

function render() {
    const fromVal = dateFrom.value;
    const toVal = dateTo.value;

    const filtered = rawData.filter(({ timestamp }) => {
        const day = timestamp.slice(0, 10); // "YYYY-MM-DD"
        return (!fromVal || day >= fromVal) && (!toVal || day <= toVal);
    });

    const activeBuckets = getActiveBuckets();
    const finestType = activeBuckets[0];

    const isEmpty = bucket(filtered, finestType).size === 0;
    emptyMsg.hidden = !isEmpty;
    canvas1.style.visibility = isEmpty ? "hidden" : "visible";

    renderTable(filtered, fromVal, toVal);
    renderGapTable(filtered);
    chart1 = renderTodChart(chart1, canvas1, filtered, activeBuckets, cumsumBox.checked);
    updateFavicon();
    chart2 = renderIntensityChart(chart2, canvas2, filtered, activeBuckets);
    chart3 = renderSumFrequencyChart(chart3, canvas3, filtered, activeBuckets);
    chart4 = renderInterarrivalChart(chart4, canvas4, filtered, activeBuckets, gapMaxBox.checked, gapMeanBox.checked, gapMedianBox.checked);
}

function updateFavicon() {
    const SIZE = 32;
    const offscreen = document.createElement("canvas");
    offscreen.width = SIZE;
    offscreen.height = SIZE;
    const ctx = offscreen.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(canvas1, 0, 0, SIZE, SIZE);
    document.getElementById("favicon").href = offscreen.toDataURL("image/png");
}

//  Initialise

async function init() {
    const resp = await fetch("data.json");
    if (!resp.ok) throw new Error(`Failed to load data.json: ${resp.status}`);
    rawData = await resp.json();

    if (rawData.length === 0) {
        emptyMsg.hidden = false;
        canvas1.style.visibility = "hidden";
        return;
    }

    // Set default date range to full extent of data
    const days = rawData.map(d => d.timestamp.slice(0, 10)).sort();
    dateFrom.value = days[0];
    dateTo.value = days[days.length - 1];

    const updatedLabel = document.getElementById("updated-label");
    if (updatedLabel) updatedLabel.textContent = `Data last updated: ${days[days.length - 1]}`;

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
    gapMaxBox.addEventListener("change", render);
    gapMeanBox.addEventListener("change", render);
    gapMedianBox.addEventListener("change", render);

    // Info panel toggle
    document.querySelector("main").addEventListener("click", e => {
        const btn = e.target.closest(".info-btn");
        if (btn) {
            const container = btn.closest(".chart-container");
            const panel = container.querySelector(".info-panel");
            const isOpen = panel.classList.contains("info-panel--open");
            // Close all panels first
            document.querySelectorAll(".info-panel--open").forEach(p => {
                p.classList.remove("info-panel--open");
                p.closest(".chart-container").querySelector(".info-btn").setAttribute("aria-expanded", "false");
            });
            if (!isOpen) {
                panel.classList.add("info-panel--open");
                btn.setAttribute("aria-expanded", "true");
            }
            return;
        }
    });
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") {
            document.querySelectorAll(".info-panel--open").forEach(p => {
                p.classList.remove("info-panel--open");
                p.closest(".chart-container").querySelector(".info-btn").setAttribute("aria-expanded", "false");
            });
        }
    });

    document.querySelectorAll('input[name="bucket"]').forEach(r =>
        r.addEventListener("change", e => {
            if (e.target.checked) {
                document.querySelectorAll('input[name="bucket"]').forEach(other => {
                    if (other !== e.target) other.checked = false;
                });
            } else {
                e.target.checked = true; // prevent unchecking the last active
            }
            render();
        })
    );
}

init().catch(err => {
    console.error(err);
    emptyMsg.textContent = "Error loading data.";
    emptyMsg.hidden = false;
    canvas2.style.visibility = "hidden";
});

//  Chart resize handles

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

// PNG export buttons
function copyChartToPng(canvas, btn) {
    const tmp = document.createElement("canvas");
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    const ctx = tmp.getContext("2d");
    ctx.fillStyle = "#ffffff"; // white background
    ctx.fillRect(0, 0, tmp.width, tmp.height);
    ctx.drawImage(canvas, 0, 0);
    tmp.toBlob(blob => {
        navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(() => {
            const prev = btn.textContent;
            btn.textContent = "✓";
            btn.classList.add("export-btn--copied");
            setTimeout(() => {
                btn.textContent = prev;
                btn.classList.remove("export-btn--copied");
            }, 1500);
        }).catch(err => { console.error("Failed to copy chart to clipboard:", err); });
    });
}

document.querySelectorAll(".export-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const canvas = document.getElementById(btn.dataset.canvas);
        if (canvas) copyChartToPng(canvas, btn);
    });
});
