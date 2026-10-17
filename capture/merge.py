"""Stitch per-window VLM answers for one camera into a single slot map.

Each window votes on every slot it covers: the label of the segment covering the slot,
or idle when the window reported nothing there. Where windows overlap, the higher
confidence wins and ties go to the window whose centre is nearer the slot (frames near
a window's edges have less context).
"""
from __future__ import annotations

from typing import Dict, List, Sequence, Tuple

from .frames import Window
from .segments import IDLE_LABEL, Label, SlotMap, make_label, slot_key

# One VLM segment, in frame timestamps: covers frames start_t..end_t inclusive.
RawSegment = dict


def window_slots(window: Window, raw: Sequence[RawSegment], idle_conf: float) -> SlotMap:
    slots: SlotMap = {slot_key(f.t): (IDLE_LABEL, idle_conf) for f in window.frames}
    for seg in raw:
        label: Label = make_label(seg["verb"], seg.get("parts", []))
        conf = float(seg.get("confidence", 1.0))
        for f in window.frames:
            k = slot_key(f.t)
            if seg["start_t"] - 1e-6 <= f.t <= seg["end_t"] + 1e-6:
                # Two segments on the same frame: keep the more confident one.
                if slots[k][0] == IDLE_LABEL or conf > slots[k][1]:
                    slots[k] = (label, conf)
    return slots


def resolve_windows(results: Sequence[Tuple[Window, Sequence[RawSegment]]], idle_conf: float = 0.5) -> SlotMap:
    best: Dict[float, Tuple[Tuple[float, float, int], Label, float]] = {}
    for window, raw in results:
        for t, (label, conf) in window_slots(window, raw, idle_conf).items():
            # Rank: confidence, then centrality, then earlier window for determinism.
            rank = (conf, -abs(t + window.cam.step / 2 - window.center), -window.index)
            if t not in best or rank > best[t][0]:
                best[t] = (rank, label, conf)
    return {t: (label, conf) for t, (_, label, conf) in sorted(best.items())}


def merge_camera(results: Sequence[Tuple[Window, Sequence[RawSegment]]], idle_conf: float = 0.5) -> SlotMap:
    if not results:
        return {}
    return resolve_windows(sorted(results, key=lambda r: r[0].index), idle_conf)


def all_times(slotmaps: List[SlotMap]) -> List[float]:
    return sorted({t for m in slotmaps for t in m})
