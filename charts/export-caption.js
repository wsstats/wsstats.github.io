import { BUCKET_TYPES } from "../utils.js";

export const CAPTION_STYLE = {
    padding: 8,
    titleFont: "bold 14px system-ui, sans-serif",
    titleColor: "#111827",
    settingsFont: "11px system-ui, sans-serif",
    settingsColor: "#555555",
    titleLineHeight: 18,
    settingsLineHeight: 15,
    separator: " · ",
};

/** Label text without the nested input's own content. */
function labelText(label) {
    return label.textContent.replace(/\s+/g, " ").trim();
}

function globalSettings() {
    const out = [];
    const from = document.getElementById("date-from")?.value;
    const to = document.getElementById("date-to")?.value;
    if (from || to) out.push(`${from || "start"} → ${to || "end"}`);

    const active = BUCKET_TYPES.find(t => document.getElementById(`bucket-${t}`)?.checked);
    if (active) out.push(labelText(document.querySelector(`label[for="bucket-${active}"]`)));
    return out;
}

/** Reads title and active control values straight from a chart's header markup. */
export function buildChartCaption(headerEl) {
    const title = headerEl?.querySelector(".chart-title")?.textContent.trim() ?? "";
    const settings = globalSettings();
    if (!headerEl) return { title, settings };

    // A control is only meaningful while the toggle preceding it is on.
    let groupEnabled = true;
    for (const label of headerEl.querySelectorAll("label")) {
        const input = label.querySelector("input");
        if (!input) continue;
        if (input.type === "checkbox") {
            groupEnabled = input.checked;
            if (input.checked) settings.push(labelText(label));
        } else if (groupEnabled && input.value !== "") {
            settings.push(`${labelText(label)}: ${input.value}`);
        }
    }
    return { title, settings };
}

function wrap(ctx, parts, maxWidth) {
    const lines = [];
    let line = "";
    for (const part of parts) {
        const candidate = line ? line + CAPTION_STYLE.separator + part : part;
        if (line && ctx.measureText(candidate).width > maxWidth) {
            lines.push(line);
            line = part;
        } else {
            line = candidate;
        }
    }
    if (line) lines.push(line);
    return lines;
}

/**
 * Draws the caption at the top of ctx and returns the height it occupies in CSS pixels.
 * Pass measureOnly to compute the height before sizing the export canvas.
 */
export function drawCaption(ctx, caption, width, measureOnly = false) {
    const { padding, titleLineHeight, settingsLineHeight } = CAPTION_STYLE;
    const maxWidth = width - padding * 2;
    let y = padding;

    if (caption.title) {
        ctx.font = CAPTION_STYLE.titleFont;
        if (!measureOnly) {
            ctx.fillStyle = CAPTION_STYLE.titleColor;
            ctx.textBaseline = "top";
            ctx.fillText(caption.title, padding, y, maxWidth);
        }
        y += titleLineHeight;
    }

    ctx.font = CAPTION_STYLE.settingsFont;
    for (const line of wrap(ctx, caption.settings, maxWidth)) {
        if (!measureOnly) {
            ctx.fillStyle = CAPTION_STYLE.settingsColor;
            ctx.textBaseline = "top";
            ctx.fillText(line, padding, y, maxWidth);
        }
        y += settingsLineHeight;
    }

    return y + padding;
}
