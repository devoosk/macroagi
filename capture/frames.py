"""Frame discovery and batching.

Frame contract (see CLAUDE.md), as written by app/scripts/export-frames.ts:
`<frames_dir>/<camDir>/<t>.jpg` plus `<camDir>/manifest.json` with
`{camera, type: "cctv"|"fp", station, fps, from, to, width, height, frames: [{t, file}]}`.
The manifest's frame list is authoritative; without one, file stems are read as sim seconds.
"""
from __future__ import annotations

import io
import json
from dataclasses import dataclass
from pathlib import Path
import re
from typing import List, Optional, Sequence, Tuple

from PIL import Image


@dataclass(frozen=True)
class Camera:
    id: str
    kind: str  # "cctv" | "fpv"
    station: str
    fps: float
    dir: Path
    # (t, file name) from the manifest; empty means scan the directory.
    listed: Tuple[Tuple[float, str], ...] = ()

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


KINDS = {"cctv": "cctv", "fp": "fpv", "fpv": "fpv"}


def cam_dir_name(cam_id: str) -> str:
    return cam_id.replace(":", "_")


def discover(frames_dir: Path, cams: Optional[Sequence[str]] = None) -> List[Camera]:
    """All cameras under frames_dir that have a manifest, optionally filtered by id.

    Ids are directory names (`cctv_S05`, `fp_S05`, `cctv_S05#1`); `cams` may use either
    that form or the app's `cctv:S05` form.
    """
    wanted = None if cams is None else {cam_dir_name(c) for c in cams}
    out = []
    for manifest in sorted(Path(frames_dir).glob("*/manifest.json")):
        m = json.loads(manifest.read_text())
        kind = m.get("type", m.get("kind"))
        if kind not in KINDS:
            raise ValueError(f"{manifest}: unknown camera type {kind!r}")
        cam = Camera(
            id=cam_dir_name(m.get("camera", m.get("cam", manifest.parent.name))),
            kind=KINDS[kind],
            station=m["station"],
            fps=float(m.get("fps", 1)),
            dir=manifest.parent,
            listed=tuple((float(f["t"]), f["file"]) for f in m.get("frames", [])),
        )
        if wanted is None or cam.id in wanted:
            out.append(cam)
    if wanted is not None:
        missing = wanted - {c.id for c in out}
        if missing:
            raise FileNotFoundError(f"no manifest for cameras: {sorted(missing)} in {frames_dir}")
    return out


FRAME_NAME = re.compile(r"^(\d{6,})(?:-(\d{3}))?$")


def frame_time(path: Path) -> Optional[float]:
    """Stem `000120` or `000120-500` -> sim seconds (120.0, 120.5); None if not a frame."""
    m = FRAME_NAME.match(path.stem)
    if not m:
        return None
    return int(m.group(1)) + (int(m.group(2)) / 1000 if m.group(2) else 0.0)


def list_frames(cam: Camera, t_from: Optional[float] = None, t_to: Optional[float] = None) -> List[Frame]:
    if cam.listed:
        pairs = [(t, cam.dir / f) for t, f in cam.listed]
    else:
        files = [p for p in cam.dir.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png")]
        pairs = [(frame_time(p), p) for p in files if frame_time(p) is not None]
    return [
        Frame(cam, t, p)
        for t, p in sorted(pairs)
        if (t_from is None or t >= t_from) and (t_to is None or t < t_to)
    ]


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
