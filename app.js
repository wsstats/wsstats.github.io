/* global luxon, Chart */

import { bucket } from "./utils.js";
import {
    BUCKET_TYPES,
    renderTodChart,
    renderInterarrivalChart,
    renderIntensityChart,
} from "./charts.js";
import { renderTable, renderGapTable } from "./tables.js";

const { DateTime } = luxon;

// DOM refs
const dateFrom = document.getElementById("date-from");
const dateTo = document.getElementById("date-to");
const cumsumBox = document.getElementById("cumsum-toggle");
const emptyMsg = document.getElementById("empty-msg");
const canvas2 = document.getElementById("chart2");
const canvas3 = document.getElementById("chart3");
const canvas4 = document.getElementById("chart4");

//  State
let rawData = [];  // [{timestamp: string, value: number}, ...]
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
    canvas2.style.visibility = isEmpty ? "hidden" : "visible";

    renderTable(filtered, fromVal, toVal);
    renderGapTable(filtered);
    chart2 = renderTodChart(chart2, canvas2, filtered, activeBuckets, cumsumBox.checked);
    chart3 = renderInterarrivalChart(chart3, canvas3, filtered, activeBuckets);
    chart4 = renderIntensityChart(chart4, canvas4, filtered, activeBuckets);
}

//  Initialise

async function init() {
    const resp = await fetch("data.json");
    if (!resp.ok) throw new Error(`Failed to load data.json: ${resp.status}`);
    rawData = await resp.json();

    if (rawData.length === 0) {
        emptyMsg.hidden = false;
        canvas2.style.visibility = "hidden";
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
