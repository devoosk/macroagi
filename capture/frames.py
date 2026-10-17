"""Frame discovery and batching.

Frame contract (see CLAUDE.md): `<frames_dir>/<camId>/<t>.png`, where t is the integer
sim second zero-padded to 6 digits, plus `<camId>/manifest.json` with
`{cam, kind, station, fps, from, to, width, height}`.
"""
from __future__ import annotations

import io
import json
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

from PIL import Image


@dataclass(frozen=True)
class Camera:
    id: str
    kind: str  # "cctv" | "fpv"
    station: str
    fps: float
    dir: Path

    @property
    def step(self) -> float:
        return 1.0 / self.fps


@dataclass(frozen=True)
class Frame:
    cam: Camera
    t: float
    path: Path


@dataclass(frozen=True)
class Window:
    cam: Camera
    index: int
    frames: Tuple[Frame, ...]

    @property
    def t0(self) -> float:
        return self.frames[0].t

    @property
    def t1(self) -> float:
        """Exclusive end of the last slot."""
        return self.frames[-1].t + self.cam.step

    @property
    def center(self) -> float:
        return (self.t0 + self.t1) / 2


def discover(frames_dir: Path, cams: Optional[Sequence[str]] = None) -> List[Camera]:
    """All cameras under frames_dir that have a manifest, optionally filtered by id."""
    out = []
    for manifest in sorted(Path(frames_dir).glob("*/manifest.json")):
        m = json.loads(manifest.read_text())
        cam = Camera(
            id=m.get("cam", manifest.parent.name).replace(":", "_"),
            kind=m["kind"],
            station=m["station"],
            fps=float(m.get("fps", 1)),
            dir=manifest.parent,
        )
        if cams is None or cam.id in cams:
            out.append(cam)
    if cams is not None:
        missing = set(cams) - {c.id for c in out}
        if missing:
            raise FileNotFoundError(f"no manifest for cameras: {sorted(missing)} in {frames_dir}")
    return out


def frame_time(path: Path, fps: float) -> float:
    """File stem is the integer frame index at the camera's fps (sim seconds at 1 fps)."""
    return int(path.stem) / fps


def list_frames(cam: Camera, t_from: Optional[float] = None, t_to: Optional[float] = None) -> List[Frame]:
    frames = []
    for p in sorted(cam.dir.glob("*.png")):
        if not p.stem.isdigit():
            continue
        t = frame_time(p, cam.fps)
        if (t_from is None or t >= t_from) and (t_to is None or t < t_to):
            frames.append(Frame(cam, t, p))
    return frames


def make_windows(frames: Sequence[Frame], size: int = 8, overlap: int = 2) -> List[Window]:
    """Fixed-size windows sliding by size - overlap. The last window is aligned to the end."""
    if size < 1 or not 0 <= overlap < size:
        raise ValueError("need size >= 1 and 0 <= overlap < size")
    if not frames:
        return []
    cam = frames[0].cam
    stride = size - overlap
    starts = list(range(0, max(len(frames) - size, 0) + 1, stride))
    if starts[-1] + size < len(frames):
        starts.append(len(frames) - size)
    return [Window(cam, i, tuple(frames[s : s + size])) for i, s in enumerate(starts)]


def encode_frame(path: Path, max_width: int = 768, quality: int = 85) -> bytes:
    """Downscaled JPEG bytes for the VLM. Deterministic for identical input."""
    with Image.open(path) as im:
        im = im.convert("RGB")
        if im.width > max_width:
            h = round(im.height * max_width / im.width)
            im = im.resize((max_width, h), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=quality, optimize=False)
        return buf.getvalue()
