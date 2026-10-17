"""Fuse the CCTV and first-person views of one station into one slot map.

Per slot, every camera casts a weighted vote for its label. The first-person view sees
hands, tools and parts, so it is trusted more on *what* is happening; the high CCTV view
sees the whole station, so it is trusted more on *whether* anything is happening
(idle votes), which is what sets segment boundaries.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Sequence, Tuple

from .frames import Camera
from .segments import IDLE_LABEL, Label, SlotMap

DEFAULT_WEIGHTS: Dict[Tuple[str, bool], float] = {
    ("fpv", True): 0.9,  # (camera kind, label is active)
    ("fpv", False): 0.6,
    ("cctv", True): 0.6,
    ("cctv", False): 1.0,
}


def fuse_station(
    views: Sequence[Tuple[Camera, SlotMap]],
    weights: Dict[Tuple[str, bool], float] = DEFAULT_WEIGHTS,
) -> SlotMap:
    if len(views) == 1:
        return dict(views[0][1])
    times = sorted({t for _, m in views for t in m})
    out: SlotMap = {}
    for t in times:
        scores: Dict[Label, float] = defaultdict(float)
        total = 0.0
        for cam, m in views:
            if t not in m:
                continue
            label, conf = m[t]
            w = weights.get((cam.kind, label != IDLE_LABEL), 1.0) * conf
            scores[label] += w
            total += w
        if not scores:
            continue
        # Highest score; ties prefer an active label, then a stable label order.
        label = max(scores, key=lambda lb: (scores[lb], lb != IDLE_LABEL, lb))
        out[t] = (label, scores[label] / total if total else 0.0)
    return out


def group_by_station(cams: Sequence[Camera]) -> Dict[str, List[Camera]]:
    out: Dict[str, List[Camera]] = defaultdict(list)
    for c in cams:
        out[c.station].append(c)
    return dict(sorted(out.items()))
