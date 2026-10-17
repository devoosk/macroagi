"""Frames -> windows -> labeller -> merge -> fuse -> segments.json.

This module and everything it imports see pixels only: they must never open line.json
or an event log (enforced by tests/test_guard.py).
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, List, Optional, Sequence

from .frames import discover, list_frames, make_windows
from .fuse import fuse_station, group_by_station
from .merge import merge_camera
from .prompt import PROMPT_VERSION
from .segments import slot_key, slotmap_to_segments


def label_footage(
    frames_dir: Path,
    labeller,
    cams: Optional[Sequence[str]] = None,
    t_from: Optional[float] = None,
    t_to: Optional[float] = None,
    window: int = 8,
    overlap: int = 2,
    workers: int = 4,
    gap_tol: float = 1.0,
    min_dur: float = 1.0,
    idle_conf: float = 0.5,
) -> dict:
    cameras = discover(frames_dir, cams)
    if not cameras:
        raise FileNotFoundError(f"no cameras with a manifest under {frames_dir}")

    jobs = []
    for cam in cameras:
        for w in make_windows(list_frames(cam, t_from, t_to), window, overlap):
            jobs.append(w)

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        answers = list(pool.map(labeller.label, jobs))

    per_cam: Dict[str, list] = {c.id: [] for c in cameras}
    for w, raw in zip(jobs, answers):
        per_cam[w.cam.id].append((w, raw))

    slotmaps = {c.id: merge_camera(per_cam[c.id], idle_conf) for c in cameras}

    camera_segments = []
    for cam in cameras:
        camera_segments += slotmap_to_segments(slotmaps[cam.id], cam.id, cam.station, cam.step, gap_tol, min_dur)

    segments = []
    coverage = {}
    for station, cams_at in group_by_station(cameras).items():
        fused = fuse_station([(c, slotmaps[c.id]) for c in cams_at])
        step = min(c.step for c in cams_at)
        segments += slotmap_to_segments(fused, "+".join(c.id for c in cams_at), station, step, gap_tol, min_dur)
        if fused:
            coverage[station] = [min(fused), slot_key(max(fused) + step), step]

    return {
        "model": labeller.name,
        "promptVersion": PROMPT_VERSION,
        "framesDir": str(frames_dir),
        "coverage": coverage,
        "segments": [s.to_json() for s in sorted(segments, key=lambda s: (s.station, s.start))],
        "cameraSegments": [s.to_json() for s in sorted(camera_segments, key=lambda s: (s.cam, s.start))],
    }


def summary(log: dict) -> List[str]:
    lines = [f"{len(log['segments'])} fused segments, {len(log['cameraSegments'])} camera segments"]
    for station, (a, b, _) in log["coverage"].items():
        n = sum(1 for s in log["segments"] if s["station"] == station)
        lines.append(f"  {station}: {n} segments over t={a:g}..{b:g}s")
    return lines
