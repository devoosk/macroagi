"""Perfect segments built from the ground truth. For checking the scorer and for building
the Capture tab before real labels exist. Never feed these to anything scored as VLM output."""
from __future__ import annotations

import json
from pathlib import Path

from .groundtruth import load_ground_truth
from .segments import Segment


def oracle_log(events_path: Path, line_path: Path, step: float = 1.0) -> dict:
    gts = load_ground_truth(events_path, line_path)
    duration = float(json.loads(Path(events_path).read_text())["duration"])
    stations = sorted({g.station for g in gts})
    segments = [Segment("oracle", g.station, g.start, g.end, g.label[0], g.label[1], 1.0) for g in gts]
    return {
        "model": "oracle",
        "promptVersion": "oracle",
        "framesDir": "",
        "coverage": {s: [0.0, duration, step] for s in stations},
        "segments": [s.to_json() for s in segments],
        "cameraSegments": [],
    }
