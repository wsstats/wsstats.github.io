import { parseKey } from "../utils.js";

export function formatBucketTitle(label, bucketType) {
    const dt = parseKey(label, bucketType);
    if (bucketType === "daily") return `${dt.toFormat("ccc")}, ${label}`;
    if (bucketType === "weekly") return `${label} (${dt.toFormat("ccc dd MMM")})`;
    return label;
}

export function getSubperiodSlots(bucketType) {
    if (bucketType === "daily") {
        return {
            slotIndex: dt => dt.hour,
            labels: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")),
            title: "Hour of day",
            sumTitle: "Hourly sum",
        };
    }
    if (bucketType === "weekly") {
        return {
            slotIndex: dt => dt.weekday - 1,
            labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
            title: "Day of week",
            sumTitle: "Daily sum",
        };
    }
    return {
        slotIndex: dt => dt.day - 1,
        labels: Array.from({ length: 31 }, (_, i) => String(i + 1)),
        title: "Day of month",
        sumTitle: "Daily sum",
    };
}