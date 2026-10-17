from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

import pytest
from PIL import Image

from capture.frames import Window
from capture.groundtruth import load_ground_truth

REPO = Path(__file__).resolve().parents[2]
EVENTS = REPO / "app" / "public" / "data" / "events_current.json"
LINE = REPO / "app" / "public" / "data" / "line.json"


def write_camera(root: Path, cam: str, kind: str, station: str, times: Iterable[int], fps: float = 1) -> Path:
    d = root / cam
    d.mkdir(parents=True)
    times = list(times)
    for t in times:
        # Pixel content varies with t so cache keys differ per frame.
        Image.new("RGB", (32, 24), (t % 256, (t * 7) % 256, 90)).save(d / f"{int(t * fps):06d}.png")
    (d / "manifest.json").write_text(
        json.dumps({"cam": cam, "kind": kind, "station": station, "fps": fps, "from": times[0], "to": times[-1] + 1, "width": 32, "height": 24})
    )
    return d


@pytest.fixture
def gts():
    return load_ground_truth(EVENTS, LINE)


@pytest.fixture
def duration() -> int:
    return int(json.loads(EVENTS.read_text())["duration"])


@pytest.fixture
def footage(tmp_path, gts, duration):
    """CCTV + FPV frames for every fixture station over the whole log."""
    root = tmp_path / "frames"
    for station in sorted({g.station for g in gts}):
        write_camera(root, f"cctv_{station}", "cctv", station, range(duration))
        write_camera(root, f"fpv_{station}", "fpv", station, range(duration))
    return root


def truth_answer(gts):
    """A fake VLM that answers perfectly from ground truth. Test-only."""

    def fn(window: Window):
        out = []
        for g in gts:
            if g.station != window.cam.station:
                continue
            ts = [f.t for f in window.frames if g.start <= f.t < g.end]
            if ts:
                out.append({"start_t": ts[0], "end_t": ts[-1], "verb": g.label[0], "parts": list(g.label[1]), "confidence": 0.9})
        return out

    return fn
