"""Simulation parameters that line.json does not carry yet. Every number has a source."""

from __future__ import annotations

EST = 'estimate'


def S(value, source: str = EST) -> dict:
    return {'value': value, 'source': source}


#: Same window as tools/gen/generate.ts so the render sees a comparable log.
LOG_SEED = 42
WARMUP = 1800
LOG_DURATION = WARMUP + 7200

SHIFT = S(8 * 3600, 'estimate (one 8 h shift)')
SWEEP_SHIFTS = 200
SWEEP_SEED0 = 1000
RELIABILITIES = [0.8, 0.85, 0.88, 0.9, 0.92, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99, 0.995, 0.999]
#: Required reliability = lowest swept value reaching this share of the r = 0.999 plateau.
PLATEAU_SHARE = 0.97

#: Current line, naive automation: robots dropped into existing stations, no fixtures, no fallback.
NAIVE_ROBOT = {
    'robot_stations': ['S03', 'S08'],
    'fail_multiplier': S(3, 'estimate (unfixtured parts, no kitting)'),
    'recovery': S(120, 'estimate (operator walks over, clears fault, restarts cell)'),
}

#: Redesign: fixtured or kitted parts, failed units go to the human fallback station.
REDESIGN_ROBOT = {
    'fail_multiplier': S(1, 'estimate (fixtured parts)'),
    'recovery': S(30, 'estimate (cell resets while the unit moves to fallback)'),
}
