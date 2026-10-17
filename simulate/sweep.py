"""Robot-reliability sweep: many shifts per point, run in parallel, common random numbers across points."""

from __future__ import annotations

import math
import os
from dataclasses import replace
from multiprocessing import Pool

from . import params as P
from .line import Line
from .simulate import SimOptions, simulate

_line: Line | None = None


def _init(line: Line) -> None:
    global _line
    _line = line


def _one(job: tuple[float, int, SimOptions]) -> tuple[float, float]:
    reliability, seed, base = job
    opts = replace(base, seed=seed, robot_reliability=reliability, record=False)
    return reliability, simulate(_line, opts).throughput_per_hour


def sweep(
    line: Line,
    base: SimOptions,
    reliabilities: list[float] = P.RELIABILITIES,
    shifts: int = P.SWEEP_SHIFTS,
    seed0: int = P.SWEEP_SEED0,
    source: str = '',
    processes: int | None = None,
) -> list[dict]:
    """Shift k uses seed seed0 + k at every reliability, so points differ by reliability, not noise."""
    jobs = [(r, seed0 + k, base) for r in reliabilities for k in range(shifts)]
    with Pool(processes or os.cpu_count(), initializer=_init, initargs=(line,)) as pool:
        out = pool.map(_one, jobs, chunksize=max(1, len(jobs) // (4 * (processes or os.cpu_count() or 1))))
    by_r: dict[float, list[float]] = {r: [] for r in reliabilities}
    for r, tp in out:
        by_r[r].append(tp)
    hours = (base.duration - base.warmup) / 3600
    src = source or (
        f'simulate/ SimPy: mean of {shifts} x {hours:g} h shifts, seeds {seed0}-{seed0 + shifts - 1}'
    )
    points = []
    for r in reliabilities:
        xs = by_r[r]
        mean = sum(xs) / len(xs)
        sd = math.sqrt(sum((x - mean) ** 2 for x in xs) / (len(xs) - 1)) if len(xs) > 1 else 0.0
        half = 1.96 * sd / math.sqrt(len(xs))
        points.append(
            {
                'reliability': r,
                'throughput': {'value': round(mean, 2), 'source': src},
                'ci95': [round(mean - half, 2), round(mean + half, 2)],
            }
        )
    return points


def required_reliability(points: list[dict], share: float = P.PLATEAU_SHARE) -> float:
    """Lowest swept reliability whose throughput reaches `share` of the plateau (the last point)."""
    plateau = points[-1]['throughput']['value']
    return next((p['reliability'] for p in points if p['throughput']['value'] >= share * plateau), points[-1]['reliability'])
