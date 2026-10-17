"""Per-operation robot success rates from the capability model (plan step 2)."""

from __future__ import annotations

from capability import estimate

from .line import Line


def op_lever_types(raw: dict, op_id: str) -> list[str]:
    """Types of the applied levers that touch this operation."""
    applied = set(raw.get('appliedLevers') or [])
    return sorted({lv['type'] for lv in raw.get('levers', []) if lv['id'] in applied and op_id in lv['operations']})


def op_reliability(line: Line) -> dict[str, float]:
    """Mean predicted success for every op on a robot station, for SimOptions.op_reliability.

    Uses the station's rented robot type (generic robot when unset) and the applied levers on each op.
    An op the robot type can't do at all gets 0, so every unit goes to the fallback.
    """
    raw = line.raw
    ops = {o['id']: o for o in raw['operations']}
    out: dict[str, float] = {}
    for st in line.chain:
        if st.staff != 'robot':
            continue
        for oid in st.operations:
            est = estimate(ops[oid], raw, op_lever_types(raw, oid), robot=st.robot)
            out[oid] = est.mean if est.feasible else 0.0
    return out


def describe(line: Line) -> str:
    robots = sorted({st.robot or 'generic' for st in line.chain if st.staff == 'robot'})
    return f"capability model v0 per op ({', '.join(robots)} robots, applied levers)"
