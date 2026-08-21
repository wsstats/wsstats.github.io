# wsstats

wsstats is a small project to visualize certain low-frequency time series data. View it at <https://wsstats.github.io>.

It visualizes data from the data.json file, which has the following format:

```json
[
  {"timestamp": "2024-09-14T21:00:00"},
  {"timestamp": "2024-09-15T19:00:00"},
  {"timestamp": "2024-10-05T17:00:00"}
]
```

Each entry represents a single event. Multiple events at the same time are recorded as separate entries.

An entry may optionally include a `window`, marking the timestamp as an uncertain guess and giving
the `start`/`end` bounds of the time range the event actually occurred in:

```json
{"timestamp": "2024-09-14T21:00:00", "window": {"start": "2024-09-14T18:00:00", "end": "2024-09-14T23:00:00"}}
```

The timestamp is still used as the best-guess time everywhere except the activity heatmap, which
marks the guessed timestamp's cell in yellow and outlines the full window with a border to
visualize the uncertainty.

You can use wsstats to visualize your own data by cloning this repo and replacing the default data.json with your own. Then, serve wsstats locally, e.g. by running `python -m http.server` in the root directory.
