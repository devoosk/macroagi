from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

import pytest
from PIL import Image

from capture.frames import Window
from capture.groundtruth import load_ground_truth

REPO = Path(__file__).resolve().parents[2]
# Frozen 3-station fixture so unit tests stay small and independent of the live data.
FIXTURES = Path(__file__).parent / "fixtures"
EVENTS = FIXTURES / "events_current.json"
LINE = FIXTURES / "line.json"
APP_DATA = REPO / "app" / "public" / "data"


def frame_name(t: float) -> str:
    """Mirror of frameName() in app/scripts/capture-lib.ts."""
    whole = int(t + 1e-9)
    ms = round((t - whole) * 1000)
    return f"{whole:06d}" + (f"-{ms:03d}" if ms else "") + ".jpg"


def write_camera(root: Path, cam: str, kind: str, station: str, times: Iterable[float], fps: float = 1, listed: bool = True) -> Path:
    """Write frames + manifest the way app/scripts/export-frames.ts does (kind "fpv" is written as "fp")."""
    d = root / cam.replace(":", "_")
    d.mkdir(parents=True)
    times = list(times)
    frames = []
    for i, t in enumerate(times):
        # Pixel content varies per frame so cache keys differ.
        Image.new("RGB", (32, 24), (i % 256, (i * 7) % 256, 90)).save(d / frame_name(t), quality=95)
        frames.append({"t": t, "file": frame_name(t)})
    manifest = {
        "camera": cam.replace("_", ":", 1),
        "type": "fp" if kind == "fpv" else kind,
        "station": station,
        "fps": fps,
        "from": times[0],
        "to": times[-1] + 1 / fps,
        "width": 32,
        "height": 24,
    }
    if listed:
        manifest["frames"] = frames
    (d / "manifest.json").write_text(json.dumps(manifest))
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
        write_camera(root, f"fp_{station}", "fpv", station, range(duration))
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
