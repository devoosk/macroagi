"""python -m optimize.compare [<line.json>] [--shifts 200] [-o app/public/data]

Plan step 7: simulate every solver redesign with identical parameters, sweep robot
reliability, rank the designs, and build the migration plan one stage at a time: at
each step, simulate the line with each remaining stage added and take the one that
lifts throughput most, so every gate carries the throughput it has to hold.

Writes line_solver_<n>.json and events_solver_<n>.json, and merges the designs into
results.json (other designs, such as the current line, are left alone).
"""

import argparse
import copy
import json
from dataclasses import replace
from pathlib import Path

from simulate import params as P
from simulate.line import from_dict
from simulate.output import upsert_design, write_event_log
from simulate.reliability import describe, op_reliability
from simulate.simulate import SimOptions, simulate
from simulate.sweep import required_reliability, sweep

from .costs import FLOOR
from .export import add_fallback, export
from .search import best_designs

DATA = Path("app/public/data")


def stage_line(current: dict, design: dict, upto: int) -> dict:
    """The current line with migration stages 1..upto of `design` applied."""
    stages = design["design"]["stages"][:upto]
    changed = {s for st in stages for s in st["stations"]}
    new_ops = {o["id"]: o for o in design["operations"]}
    new_st = {s["id"]: s for s in design["stations"]}
    out = copy.deepcopy(current)
    out["id"] = f"{design['id']}_stage_{upto}"
    ops = {o["id"]: o for o in out["operations"]}
    for oid, o in ops.items():
        if o["station"] in changed or new_ops[oid].get("station") in changed:
            ops[oid].clear()
            ops[oid].update(copy.deepcopy(new_ops[oid]))
    gone = {oid for oid, o in ops.items() if o.get("mode") == "eliminated"}
    for s in out["stations"]:
        if s["id"] in changed:
            sid = s["id"]
            s.clear()
            s.update(copy.deepcopy(new_st[sid]))
        s["operations"] = [o for o in s["operations"] if o not in gone]
    placed = [o for s in out["stations"] for o in s["operations"]]
    missing = sorted(set(ops) - gone - set(placed))
    if missing or len(placed) != len(set(placed)):
        raise ValueError(f"stage {upto} of {design['id']} breaks the op assignment: missing {missing}")
    for v in out["variants"]:
        v["operations"] = [o for o in v["operations"] if o not in gone]
    applied = set(design["appliedLevers"])
    out["levers"] = design["levers"]
    out["appliedLevers"] = [lv["id"] for lv in design["levers"] if lv["id"] in applied
                            and all(ops[o].get("station") in changed or o in gone
                                    or current_station(current, o) in changed for o in lv["operations"])]
    add_fallback(out)
    return out


def current_station(line: dict, op_id: str) -> str:
    return next(o["station"] for o in line["operations"] if o["id"] == op_id)


def _robot_opts(line, base) -> tuple[dict, str]:
    robot = {"fail_multiplier": P.REDESIGN_ROBOT["fail_multiplier"]["value"],
             "recovery": P.REDESIGN_ROBOT["recovery"]["value"], "human_ops": base.operations}
    return robot, f"human fallback station ({robot['recovery']:g} s robot reset), {describe(line)}"


def throughput(raw: dict, base, shifts: int) -> dict:
    """Mean throughput over `shifts` shifts at the success rates capability predicts."""
    line = from_dict(raw)
    robot, note = _robot_opts(line, base)
    shift = SimOptions(seed=0, duration=P.WARMUP + P.SHIFT["value"], warmup=P.WARMUP, record=False,
                       op_reliability=op_reliability(line), **robot)
    pt = sweep(line, shift, [1.0], shifts)[0]
    pt["throughput"]["source"] += f", {note}"
    return pt["throughput"]


def evaluate(current: dict, design: dict, shifts: int, outdir: Path, name: str) -> dict:
    base = from_dict(current)
    line = from_dict(design)
    robot, note = _robot_opts(line, base)
    log = simulate(line, SimOptions(seed=P.LOG_SEED, duration=P.LOG_DURATION, warmup=P.WARMUP,
                                    op_reliability=op_reliability(line), **robot)).log
    write_event_log(outdir / f"events_{name}.json", log)
    shift = SimOptions(seed=0, duration=P.WARMUP + P.SHIFT["value"], warmup=P.WARMUP, record=False, **robot)
    points = sweep(line, shift, shifts=shifts, source=f"simulate/ SimPy: mean of {shifts} x 8 h shifts, {note}")
    req = required_reliability(points)

    # Re-plan the order one stage at a time: next comes the remaining stage that lifts
    # throughput most (ties: the one listed first, i.e. lower risk).
    todo, done, stages = list(design["design"]["stages"]), [], []
    while todo:
        trials = []
        for st in todo:
            trial = {**design, "design": {**design["design"], "stages": done + [st]}}
            trials.append((throughput(stage_line(current, trial, len(done) + 1), base, shifts), st))
        best = max(trials, key=lambda t: round(t[0]["value"] * 2) / 2)
        tp, st = best
        todo.remove(st)
        done.append(st)
        gate = st["gate"].replace("the required reliability from the sweep", f"{req:.0%} success")
        stages.append({**st, "id": f"M{len(done)}", "gate": f"{gate}; line holds {tp['value']:g} units/h",
                       "throughput": tp})

    return {
        "design": design["id"],
        "throughput": throughput(design, base, shifts),
        "capex": design["design"]["capex"],
        "rentPerMonth": design["design"]["rentPerMonth"],
        "cost3y": {"value": design["design"]["objective"]["value"], "source": design["design"]["objective"]["note"]},
        "requiredReliability": {"value": req, "source": f"simulate/ sweep: {note}; {P.PLATEAU_SHARE:.0%} of plateau"},
        "sweep": points,
        "stages": stages,
    }


def rank(results: list[dict]) -> list[dict]:
    """Highest throughput first (to the nearest 0.5 units/h), then lower 3-year cost (people,
    robot rent, integration and levers: the solver objective), then lower required reliability."""
    def key(r):
        return (-round(r["throughput"]["value"] * 2) / 2, r["cost3y"]["value"], r["requiredReliability"]["value"])
    ordered = sorted(results, key=key)
    for i, r in enumerate(ordered, start=1):
        r["rank"] = i
    return ordered


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m optimize.compare")
    p.add_argument("line", type=Path, nargs="?", default=DATA / "line.json")
    p.add_argument("-o", "--out", type=Path, default=DATA)
    p.add_argument("--shifts", type=int, default=P.SWEEP_SHIFTS)
    p.add_argument("--floor", type=float, default=FLOOR["value"])
    a = p.parse_args()
    current = json.loads(a.line.read_text())
    results = []
    for n, (c, sol) in enumerate(best_designs(current, a.floor), start=1):
        design = export(current, c, sol, n)
        design["id"] = f"{current['id']}_solver_{n}"
        (a.out / f"line_solver_{n}.json").write_text(json.dumps(design, indent=2) + "\n")
        results.append(evaluate(current, design, a.shifts, a.out, f"solver_{n}"))
    for r in rank(results):
        upsert_design(a.out / "results.json", r)
        stages = " -> ".join(f"{s['id']} {s['throughput']['value']:g}/h" for s in r["stages"])
        print(f"#{r['rank']} {r['design']}: {r['throughput']['value']:g} units/h, capex {r['capex']['value']}, "
              f"rent {r['rentPerMonth']['value']}/month, 3-year cost {r['cost3y']['value']}, needs {r['requiredReliability']['value']:.0%}; {stages}")


if __name__ == "__main__":
    main()
