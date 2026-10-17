"""Perfect segments built from the ground truth. For checking the scorer and for building
the Capture tab before real labels exist. Never feed these to anything scored as VLM output."""
from __future__ import annotations

import json
from pathlib import Path

from collections import defaultdict

from .groundtruth import load_ground_truth
from .label import assign_visits
from .segments import Segment


def oracle_log(events_path: Path, line_path: Path, step: float = 1.0) -> dict:
    gts = load_ground_truth(events_path, line_path)
    stations = sorted({g.station for g in gts})
    log = json.loads(Path(events_path).read_text())
    duration = float(log["duration"])
    # True unit arrivals per (station, bay): what a perfect camera would report.
    arrivals = defaultdict(list)
    for e in log["events"]:
        if e["event"] == "start":
            arrivals[(e["station"], e.get("bay"))].append(float(e["time"]))
    streams = defaultdict(list)
    for g in gts:
        cam = f"oracle:{g.station}" + (f"#{g.bay}" if g.bay is not None else "")
        streams[(g.station, g.bay)].append(
            Segment(cam, g.station, g.start, g.end, g.label[0], g.label[1], 1.0, bay=g.bay, unit_size=g.unit_size, tool=g.tool)
        )
    segments = [s for key, segs in sorted(streams.items(), key=lambda kv: (kv[0][0], kv[0][1] or 0))
                for s in assign_visits(segs, 3.0, arrivals[key])]
    return {
        "source": "oracle (ground truth)",
        "fps": 1 / step,
        "model": "oracle",
        "promptVersion": "oracle",
        "framesDir": "",
        "coverage": {s: [0.0, duration, step] for s in stations},
        "segments": [s.to_json() for s in segments],
        "cameraSegments": [],
    }
