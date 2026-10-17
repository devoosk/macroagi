"""Frames -> windows -> labeller -> merge -> fuse -> segments.json.

This module and everything it imports see pixels only: they must never open line.json
or an event log (enforced by tests/capture/test_pipeline.py).
"""
from __future__ import annotations

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from .frames import Camera, Window, discover, list_frames, make_windows
from .fuse import fuse_station, group_by_station
from .merge import RawSegment, merge_camera
from .prompt import PROMPT_VERSION
from .segments import Segment, slot_key, slotmap_to_segments
from .vlm import split_answer


def streams_for_station(cams: Sequence[Camera]) -> List[Tuple[List[Camera], Optional[int]]]:
    """Which cameras make up each output stream at one station.

    A single-bay station fuses its CCTV and first-person views into one stream. At a
    multi-bay station the overview and first-person cameras see several bays at once,
    so each per-bay CCTV camera becomes its own stream instead.
    """
    bay_cams = sorted((c for c in cams if c.bay is not None), key=lambda c: c.bay)
    if bay_cams:
        return [([c], c.bay) for c in bay_cams]
    return [(list(cams), None)]


def annotate(segments: List[Segment], raw: Sequence[Tuple[Window, Sequence[RawSegment]]]) -> List[Segment]:
    """Give each segment the tool and unit size most of its overlapping raw answers report."""
    out = []
    for s in segments:
        votes: Dict[str, Dict[str, float]] = {"tool": defaultdict(float), "unit_size": defaultdict(float)}
        for w, answers in raw:
            for r in answers:
                if r["verb"] != s.verb:
                    continue
                overlap = min(r["end_t"] + w.cam.step, s.end) - max(r["start_t"], s.start)
                if overlap <= 0:
                    continue
                for k in votes:
                    if r.get(k):
                        votes[k][r[k]] += overlap * r.get("confidence", 1.0)
        best = {k: max(sorted(v), key=v.get) if v else "" for k, v in votes.items()}
        out.append(s.with_(tool=best["tool"], unit_size=best["unit_size"] if best["unit_size"] != "none" else ""))
    return out


def cluster_times(times: Sequence[float], tol: float = 3.0) -> List[float]:
    """Collapse reports of the same event from overlapping windows/cameras into one time (the median)."""
    out: List[List[float]] = []
    for t in sorted(times):
        if out and t - out[-1][-1] <= tol:
            out[-1].append(t)
        else:
            out.append([t])
    return [sorted(c)[len(c) // 2] for c in out]


def assign_visits(segments: List[Segment], gap: float, arrivals: Sequence[float] = (), tol: float = 1.0) -> List[Segment]:
    """One visit = one unit at one stream.

    With unit arrivals seen on camera, a new visit starts at the first segment after each
    arrival. Without any, fall back to idle gaps longer than `gap` or a change of unit size.
    """
    arrivals = sorted(arrivals)
    i = 0  # next unused arrival; each arrival opens at most one visit
    out, k, last_end, size = [], 0, None, ""
    for s in sorted(segments, key=lambda s: s.start):
        if arrivals:
            new = last_end is None
            while i < len(arrivals) and arrivals[i] <= s.start + tol:
                new, i = True, i + 1
        else:
            new = last_end is None or s.start - last_end > gap or bool(s.unit_size and size and s.unit_size != size)
        if new:
            k += 1
            size = s.unit_size
        size = size or s.unit_size
        last_end = max(last_end or s.end, s.end)
        out.append(s.with_(visit=f"{s.cam}#{k}"))
    return out


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
    visit_gap: float = 3.0,
    min_conf: float = 0.0,
) -> dict:
    cameras = discover(frames_dir, cams)
    if not cameras:
        raise FileNotFoundError(f"no cameras with a manifest under {frames_dir}")

    jobs = [w for cam in cameras for w in make_windows(list_frames(cam, t_from, t_to), window, overlap)]
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        answers = list(pool.map(labeller.label, jobs))

    raw: Dict[str, list] = {c.id: [] for c in cameras}
    arrivals: Dict[str, List[float]] = {c.id: [] for c in cameras}
    for w, a in zip(jobs, answers):
        segs, arr = split_answer(a)
        # Answers the model itself doubts count as idle.
        raw[w.cam.id].append((w, [r for r in segs if r.get("confidence", 1.0) >= min_conf]))
        arrivals[w.cam.id] += arr
    slotmaps = {c.id: merge_camera(raw[c.id], idle_conf) for c in cameras}

    camera_segments = []
    for cam in cameras:
        segs = slotmap_to_segments(slotmaps[cam.id], cam.id, cam.station, cam.step, gap_tol, min_dur)
        camera_segments += annotate([s.with_(bay=cam.bay) for s in segs], raw[cam.id])

    segments, coverage = [], {}
    for station, cams_at in group_by_station(cameras).items():
        for stream, bay in streams_for_station(cams_at):
            fused = fuse_station([(c, slotmaps[c.id]) for c in stream])
            if not fused:
                continue
            step = min(c.step for c in stream)
            name = "+".join(c.id for c in stream)
            segs = slotmap_to_segments(fused, name, station, step, gap_tol, min_dur)
            segs = annotate([s.with_(bay=bay) for s in segs], [r for c in stream for r in raw[c.id]])
            seen = cluster_times([t for c in stream for t in arrivals[c.id]])
            segments += assign_visits(segs, visit_gap, seen)
            lo, hi = coverage.get(station, [min(fused), slot_key(max(fused) + step), step])[:2]
            coverage[station] = [min(lo, min(fused)), max(hi, slot_key(max(fused) + step)), step]

    fps = sorted({c.fps for c in cameras})
    return {
        "source": f"VLM {labeller.name}, prompt {PROMPT_VERSION}",
        "fps": fps[0] if len(fps) == 1 else fps,
        "model": labeller.name,
        "promptVersion": PROMPT_VERSION,
        "framesDir": str(frames_dir),
        "coverage": coverage,
        "segments": [s.to_json() for s in sorted(segments, key=lambda s: (s.station, s.bay or 0, s.start))],
        "cameraSegments": [s.to_json() for s in sorted(camera_segments, key=lambda s: (s.cam, s.start))],
    }


def summary(log: dict) -> List[str]:
    lines = [f"{len(log['segments'])} segments, {len(log['cameraSegments'])} camera segments"]
    for station, (a, b, _) in log["coverage"].items():
        segs = [s for s in log["segments"] if s["station"] == station]
        visits = len({s.get("visit") for s in segs})
        lines.append(f"  {station}: {len(segs)} segments, {visits} visits over t={a:g}..{b:g}s")
    return lines
