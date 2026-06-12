# wsstats

wsstats is a small project to visualize certain low-frequency time series data. View it at <https://wsstats.github.io>.

It visualizes data from the data.json file, which has the following format:

[
  {"timestamp": "2024-09-14T21:00:00", "value": 3},
  {"timestamp": "2024-09-15T19:00:00", "value": 4},
  {"timestamp": "2024-10-05T17:00:00", "value": 1}
]

You can use wsstats to visualize your own data by cloning this repo and replacing the default data.json with your own. Then, serve wsstats locally, e.g. by running `python -m http.server` in the root directory.
