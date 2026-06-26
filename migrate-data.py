import json
from datetime import datetime, timedelta
from collections import defaultdict

INPUT = "data.json"
OUTPUT = "data.json"

with open(INPUT, "r") as f:
    entries = json.load(f)

# Group by timestamp, summing values for duplicates
grouped = defaultdict(int)
for entry in entries:
    grouped[entry["timestamp"]] += entry["value"]

# Expand: each group produces `value` entries offset by 10 minutes each
result = []
for ts_str in sorted(grouped.keys()):
    total = grouped[ts_str]
    base = datetime.fromisoformat(ts_str)
    for i in range(total):
        result.append({"timestamp": (base + timedelta(minutes=10 * i)).isoformat()})

with open(OUTPUT, "w") as f:
    json.dump(result, f, indent=2)

print(f"Done. {len(entries)} input entries -> {len(result)} output entries.")
