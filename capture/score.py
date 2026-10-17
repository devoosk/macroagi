"""Score segments.json against the hidden ground truth (event log + line.json).

Metrics, per station and overall:
- slot verb accuracy: share of slots (idle included) whose predicted verb matches the truth
- active verb accuracy: the same, over slots where the worker is really doing something
- parts P/R/F1: micro-averaged over active slots where something was predicted
- segment P/R/F1: one-to-one matching at IoU >= threshold with the same verb
- operation recovery: share of operations with at least one instance matched on verb and parts
- verb confusion matrix (rows = truth, columns = prediction), in slots
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Sequence, Tuple

from .groundtruth import GtInterval
from .segments import IDLE, IDLE_LABEL, Segment, segments_to_slotmap, slot_key


def iou(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    inter = max(0.0, min(a[1], b[1]) - max(a[0], b[0]))
    union = max(a[1], b[1]) - min(a[0], b[0])
    return inter / union if union > 0 else 0.0


def slot_times(start: float, end: float, step: float) -> List[float]:
    n = int(round((end - start) / step))
    return [slot_key(start + i * step) for i in range(n)]


def match(preds: Sequence[Segment], gts: Sequence[GtInterval], threshold: float, need_parts: bool) -> List[Tuple[int, int, float]]:
    """Greedy one-to-one matching by IoU, highest first. Returns (pred idx, gt idx, iou)."""
    pairs = []
    for i, p in enumerate(preds):
        for j, g in enumerate(gts):
            if p.verb != g.verb or (need_parts and p.parts != g.label[1]):
                continue
            v = iou((p.start, p.end), (g.start, g.end))
            if v >= threshold:
                pairs.append((v, i, j))
    used_p, used_g, out = set(), set(), []
    for v, i, j in sorted(pairs, key=lambda x: (-x[0], x[1], x[2])):
        if i not in used_p and j not in used_g:
            used_p.add(i)
            used_g.add(j)
            out.append((i, j, v))
    return out


def prf(tp: int, n_pred: int, n_true: int) -> Dict[str, float]:
    p = tp / n_pred if n_pred else 0.0
    r = tp / n_true if n_true else 0.0
    return {"precision": p, "recall": r, "f1": 2 * p * r / (p + r) if p + r else 0.0}


class Tally:
    def __init__(self):
        self.slots = self.verb_ok = self.active = self.active_ok = 0
        self.parts_tp = self.parts_fp = self.parts_fn = 0
        self.n_pred = self.n_gt = self.seg_tp = 0
        self.boundary_err: List[float] = []
        self.ops_seen: set = set()
        self.ops_found: set = set()
        self.confusion: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

    def add(self, other: "Tally") -> None:
        for k in ("slots", "verb_ok", "active", "active_ok", "parts_tp", "parts_fp", "parts_fn", "n_pred", "n_gt", "seg_tp"):
            setattr(self, k, getattr(self, k) + getattr(other, k))
        self.boundary_err += other.boundary_err
        self.ops_seen |= other.ops_seen
        self.ops_found |= other.ops_found
        for t, row in other.confusion.items():
            for p, n in row.items():
                self.confusion[t][p] += n

    def report(self) -> dict:
        # No parts predicted or expected at all (e.g. a pure inspect station): not applicable.
        parts = None
        if self.parts_tp + self.parts_fp + self.parts_fn:
            parts = prf(self.parts_tp, self.parts_tp + self.parts_fp, self.parts_tp + self.parts_fn)
        return {
            "slots": self.slots,
            "slotVerbAccuracy": self.verb_ok / self.slots if self.slots else 0.0,
            "activeVerbAccuracy": self.active_ok / self.active if self.active else 0.0,
            "parts": parts,
            "segments": {**prf(self.seg_tp, self.n_pred, self.n_gt), "predicted": self.n_pred, "truth": self.n_gt},
            "meanBoundaryError": sum(self.boundary_err) / len(self.boundary_err) if self.boundary_err else None,
            "operationRecovery": len(self.ops_found) / len(self.ops_seen) if self.ops_seen else 0.0,
            "operationsSeen": sorted(self.ops_seen),
            "operationsRecovered": sorted(self.ops_found),
        }


def score_stream(preds: List[Segment], gts: List[GtInterval], start: float, end: float, step: float, threshold: float) -> Tally:
    """Score one prediction stream against the truth for one station over [start, end)."""
    tally = Tally()
    gts = [
        GtInterval(g.station, max(g.start, start), min(g.end, end), g.operation, g.unit, g.label)
        for g in gts
        if g.end > start and g.start < end
    ]
    preds = [p for p in preds if p.end > start and p.start < end]
    times = slot_times(start, end, step)
    pred_slots = segments_to_slotmap(preds, times)

    for t in times:
        truth = [g.label for g in gts if g.start <= t < g.end] or [IDLE_LABEL]
        pred = pred_slots[t][0]
        tally.slots += 1
        tally.confusion[truth[0][0]][pred[0]] += 1
        ok = pred[0] in {lb[0] for lb in truth}
        tally.verb_ok += ok
        if truth[0] != IDLE_LABEL:
            tally.active += 1
            tally.active_ok += ok
            if pred[0] != IDLE:
                ref = next((lb for lb in truth if lb[0] == pred[0]), truth[0])
                tally.parts_tp += len(set(pred[1]) & set(ref[1]))
                tally.parts_fp += len(set(pred[1]) - set(ref[1]))
                tally.parts_fn += len(set(ref[1]) - set(pred[1]))

    matched = match(preds, gts, threshold, need_parts=False)
    tally.n_pred, tally.n_gt, tally.seg_tp = len(preds), len(gts), len(matched)
    for i, j, _ in matched:
        tally.boundary_err += [abs(preds[i].start - gts[j].start), abs(preds[i].end - gts[j].end)]

    tally.ops_seen = {g.operation for g in gts}
    tally.ops_found = {gts[j].operation for _, j, _ in match(preds, gts, threshold, need_parts=True)}
    return tally


def score(log: dict, gts: List[GtInterval], which: str = "segments", threshold: float = 0.5) -> dict:
    preds = [Segment.from_json(d) for d in log[which]]
    by_station: Dict[str, List[GtInterval]] = defaultdict(list)
    for g in gts:
        by_station[g.station].append(g)

    # One stream per (station, cam): fused output has one cam per station.
    streams: Dict[Tuple[str, str], List[Segment]] = defaultdict(list)
    for p in preds:
        streams[(p.station, p.cam)].append(p)
    for station in log["coverage"]:
        if not any(s == station for s, _ in streams):
            streams[(station, "none")] = []

    total = Tally()
    per_stream = {}
    for (station, cam), segs in sorted(streams.items()):
        start, end, step = log["coverage"][station]
        t = score_stream(sorted(segs, key=lambda s: s.start), by_station.get(station, []), start, end, step, threshold)
        per_stream[f"{station}/{cam}"] = t.report()
        total.add(t)

    overall = total.report()
    overall["confusion"] = {t: dict(sorted(row.items())) for t, row in sorted(total.confusion.items())}
    return {"which": which, "iouThreshold": threshold, "overall": overall, "streams": per_stream}


def format_table(result: dict) -> str:
    def row(name: str, r: dict) -> str:
        parts = f"{r['parts']['f1']:>6.1%}" if r["parts"] else f"{'n/a':>6}"
        return (
            f"{name:<28} {r['slotVerbAccuracy']:>6.1%} {r['activeVerbAccuracy']:>6.1%} {parts} "
            f"{r['segments']['precision']:>6.1%} {r['segments']['recall']:>6.1%} {r['operationRecovery']:>6.1%}"
        )

    lines = [f"{'stream':<28} {'slot':>6} {'active':>6} {'partsF1':>6} {'segP':>6} {'segR':>6} {'ops':>6}"]
    lines += [row(k, v) for k, v in result["streams"].items()]
    lines.append(row("OVERALL", result["overall"]))
    return "\n".join(lines)
