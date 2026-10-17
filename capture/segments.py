"""Segment type and slot helpers shared by merge, fuse, score and the oracle.

Time model: a frame at time t stands for the slot [t, t + step), step = 1 / fps.
A segment covers every slot with start <= t < end.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

IDLE = "idle"

# (verb, sorted parts). IDLE_LABEL means nobody is doing a vocabulary action.
Label = Tuple[str, Tuple[str, ...]]
IDLE_LABEL: Label = (IDLE, ())

# Slot time -> (label, confidence).
SlotMap = Dict[float, Tuple[Label, float]]


def make_label(verb: str, parts) -> Label:
    return (verb, tuple(sorted(set(parts))))


@dataclass(frozen=True)
class Segment:
    cam: str
    station: str
    start: float
    end: float
    verb: str
    parts: Tuple[str, ...]
    confidence: float

    @property
    def label(self) -> Label:
        return (self.verb, self.parts)

    def to_json(self) -> dict:
        return {
            "cam": self.cam,
            "station": self.station,
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "verb": self.verb,
            "parts": list(self.parts),
            "confidence": round(self.confidence, 3),
        }

    @staticmethod
    def from_json(d: dict) -> "Segment":
        return Segment(
            cam=d["cam"],
            station=d["station"],
            start=float(d["start"]),
            end=float(d["end"]),
            verb=d["verb"],
            parts=tuple(sorted(d.get("parts", []))),
            confidence=float(d.get("confidence", 1.0)),
        )


def slot_key(t: float) -> float:
    """Normalise float slot times so dict lookups are stable."""
    return round(t, 3)


def slotmap_to_segments(
    slots: SlotMap,
    cam: str,
    station: str,
    step: float,
    gap_tol: float = 0.0,
    min_dur: float = 0.0,
) -> List[Segment]:
    """Run-length encode a slot map into non-idle segments.

    Idle gaps of at most `gap_tol` seconds between two runs with the same label are
    filled; runs shorter than `min_dur` are dropped.
    """
    runs: List[list] = []  # [start, end, label, [confidences]]
    for t in sorted(slots):
        label, conf = slots[t]
        if runs and runs[-1][2] == label and abs(runs[-1][1] - t) < step / 2:
            runs[-1][1] = slot_key(t + step)
            runs[-1][3].append(conf)
        else:
            runs.append([t, slot_key(t + step), label, [conf]])

    active = [r for r in runs if r[2] != IDLE_LABEL]
    merged: List[list] = []
    for r in active:
        if merged and merged[-1][2] == r[2] and r[0] - merged[-1][1] <= gap_tol + 1e-9:
            merged[-1][1] = r[1]
            merged[-1][3].extend(r[3])
        else:
            merged.append([r[0], r[1], r[2], list(r[3])])

    return [
        Segment(cam, station, start, end, label[0], label[1], sum(confs) / len(confs))
        for start, end, label, confs in merged
        if end - start >= min_dur - 1e-9
    ]


def segments_to_slotmap(segments: List[Segment], times: List[float]) -> SlotMap:
    """Inverse of slotmap_to_segments over the given slot times (overlaps: highest confidence wins)."""
    out: SlotMap = {slot_key(t): (IDLE_LABEL, 1.0) for t in times}
    best: Dict[float, float] = {}
    for s in segments:
        for t in times:
            if s.start <= t < s.end and s.confidence > best.get(slot_key(t), -1):
                best[slot_key(t)] = s.confidence
                out[slot_key(t)] = (s.label, s.confidence)
    return out


def write_segment_log(path: Path, log: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(log, indent=2, sort_keys=False) + "\n")


def read_segment_log(path: Path) -> dict:
    return json.loads(Path(path).read_text())
