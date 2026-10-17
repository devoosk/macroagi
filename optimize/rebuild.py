"""Rebuild mode (docs/plans/06b-rebuild-layout.md): the station count, order and staffing
are open. The line becomes up to N slots in a row; each used slot is a human station or a
robot cell of one rented type, with 1-3 parallel bays. Any operation can go to any slot,
subject only to hard precedence. Fixed equipment (torch brazing, the test and charge rigs)
stays together as one station each, but its position is free.

The rebalance mode (model.py) is "wave one": robots where people stood. This is MacroAGI:
the line redesigned for robots.

python -m optimize.rebuild [<line.json>] [-o app/public/data] [--slots 16]
writes line_rebuild_1.json."""

import argparse
import copy
import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import networkx as nx
from ortools.sat.python import cp_model

from capability import LEVER_COSTS, ROBOTS

from .costs import FLOOR, HORIZON_MONTHS, HUMAN_STATION_COST, PEAK_TOLERANCE
from .export import ROBOT_SD_FACTOR, add_fallback
from .generator import PINNED_TOOLS, TEST_KINDS, Option, lever_catalogue, op_options, ordered_stations

TIME_SCALE = 10  # 0.1 s
MAX_BAYS = 3
PITCH = 5.0  # m between slots along the line (today's line uses 4.5-6 m)
BAY_COST = LEVER_COSTS["decouple"]  # buffers and conveyor split for each extra bay


@dataclass
class Rebuild:
    slots: list[dict]  # used slots in line order: {ops, staff, robot, bays, replaces, kind}
    choice: dict[str, Option]
    used: list[str]  # lever ids paid for
    objective: int


def fixed_groups(line: dict) -> list[list[str]]:
    """Ops on fixed equipment, one group per old station: test rigs, torch and hose stations."""
    out = []
    for s in ordered_stations(line):
        ops = [o for o in line["operations"] if o["station"] == s["id"]]
        if ops and (s["kind"] in TEST_KINDS or all(o["tool"] in PINNED_TOOLS for o in ops)):
            out.append([o["id"] for o in ops])
    return out


def solve(line: dict, n_slots: int | None = None, floor: float = FLOOR["value"], fleet=None) -> Rebuild | None:
    fleet = tuple(fleet or ROBOTS)
    n_slots = n_slots or round(len(line["stations"]) * 1.5)
    ops = {o["id"]: o for o in line["operations"]}
    catalogue = lever_catalogue(line)
    options = {o: op_options(op, line, catalogue, "B4", floor, fleet) for o, op in ops.items()}
    levers = {i.id: i for i in catalogue.values()}
    J = range(n_slots)
    cfgs = [("human", n) for n in range(1, MAX_BAYS + 1)] + [(t, n) for t in fleet for n in range(1, MAX_BAYS + 1)]

    m = cp_model.CpModel()
    a = {(j, c): m.new_bool_var(f"a_{j}_{c[0]}_{c[1]}") for j in J for c in cfgs}
    used = {j: m.new_bool_var(f"u_{j}") for j in J}
    for j in J:
        m.add(sum(a[j, c] for c in cfgs) == used[j])
    for j in J[1:]:
        m.add(used[j] <= used[j - 1])  # no gaps: used slots come first
    bays = {j: sum(c[1] * a[j, c] for c in cfgs) for j in J}
    kind_is = {(j, k): sum(a[j, c] for c in cfgs if c[0] == k) for j in J for k in ("human", *fleet)}

    z, e = {}, {}
    for o in ops:
        for k, opt in enumerate(options[o]):
            if opt.mode == "eliminated":
                e[o, k] = m.new_bool_var(f"e_{o}_{k}")
            else:
                for j in J:
                    z[o, j, k] = m.new_bool_var(f"z_{o}_{j}_{k}")
                    m.add(z[o, j, k] <= kind_is[j, opt.robot if opt.mode == "robot" else "human"])
        m.add_exactly_one([v for (oo, _, _), v in z.items() if oo == o] + [v for (oo, _), v in e.items() if oo == o])
    for j in J:  # a used slot holds at least one op
        m.add(sum(v for (_, jj, _), v in z.items() if jj == j) >= used[j])

    # Fixed equipment: each group shares one slot, and that slot holds nothing else.
    groups = fixed_groups(line)
    pinned = {o for g in groups for o in g}
    at = {(o, j): sum(v for (oo, jj, _), v in z.items() if oo == o and jj == j) for o in ops for j in J}
    for g in groups:
        for j in J:
            for o in g[1:]:
                m.add(at[o, j] == at[g[0], j])
            for o in ops:
                if o not in g:
                    m.add(at[o, j] + at[g[0], j] <= 1)

    pos = {o: sum(j * v for (oo, j, _), v in z.items() if oo == o) for o in ops}
    gone = {o: sum(v for (oo, _), v in e.items() if oo == o) for o in ops}
    hard = nx.transitive_closure(nx.DiGraph(
        [(x["from"], x["to"]) for x in line["edges"] if x["type"] == "hard" and x["from"] in ops and x["to"] in ops]))
    for p, q in sorted(hard.edges):
        m.add(pos[p] <= pos[q] + n_slots * (gone[p] + gone[q]))

    takt = round(line["takt"]["value"] * TIME_SCALE)
    peak = round(line["takt"]["value"] * PEAK_TOLERANCE["value"] * TIME_SCALE)
    mix = {v["id"]: round(v["mix"]["value"] * 1000) for v in line["variants"]}
    total = sum(mix.values())

    def load(j, var):
        return sum(round(options[o][k].time.get(var["id"], 0) * TIME_SCALE) * v
                   for (o, jj, k), v in z.items() if jj == j and o in var["operations"])

    for j in J:
        for var in line["variants"]:
            m.add(load(j, var) <= peak * bays[j])
        m.add(sum(mix[var["id"]] * load(j, var) for var in line["variants"]) <= takt * bays[j] * total)

    use = {lid: m.new_bool_var(f"use_{lid}") for lid in levers if levers[lid].type not in ("regroup", "decouple")}
    for key, v in list(z.items()) + list(e.items()):
        opt = options[key[0]][key[-1]]
        for lid in opt.levers:
            m.add_implication(v, use[lid])

    unit = {"human": round(HUMAN_STATION_COST["value"])}
    unit |= {t: round(ROBOTS[t]["rentPerMonth"] * HORIZON_MONTHS + ROBOTS[t]["integration"]) for t in fleet}
    bay_cost = round(BAY_COST["value"])
    obj = [(unit[c[0]] * c[1] + bay_cost * (c[1] - 1)) * a[j, c] for j in J for c in cfgs]
    obj += [round(levers[lid].cost) * x for lid, x in use.items()]
    # Tie-breaker: keep ops close to their old position in the line (stable, readable layouts).
    old = {s["id"]: i for i, s in enumerate(ordered_stations(line))}
    scale = (n_slots - 1) / max(1, len(old) - 1)
    tie = []
    for o in ops:
        d = m.new_int_var(0, n_slots, f"d_{o}")
        target = round(old[ops[o]["station"]] * scale)
        m.add(d >= pos[o] - target - n_slots * gone[o])
        m.add(d >= target - pos[o] - n_slots * gone[o])
        tie.append(d)
    m.minimize(sum(obj) * 1000 + sum(tie))

    solver = cp_model.CpSolver()
    solver.parameters.num_workers = 1
    solver.parameters.random_seed = 0
    solver.parameters.max_time_in_seconds = 120
    status = solver.solve(m)
    if status == cp_model.INFEASIBLE:
        return None
    if status != cp_model.OPTIMAL:
        raise RuntimeError(f"CP-SAT did not prove optimality for the rebuild ({solver.status_name(status)})")

    choice, slot_of = {}, {}
    for (o, j, k), v in z.items():
        if solver.value(v):
            choice[o], slot_of[o] = options[o][k], j
    for (o, k), v in e.items():
        if solver.value(v):
            choice[o] = options[o][k]
    kinds = {s["id"]: s["kind"] for s in line["stations"]}
    slots = []
    for j in J:
        if not solver.value(used[j]):
            continue
        cfg = next(c for c in cfgs if solver.value(a[j, c]))
        sops = [o for o in ops if slot_of.get(o) == j]
        replaces = sorted({ops[o]["station"] for o in sops}, key=old.get)
        fixed = [o for o in sops if o in pinned]
        # The kind follows fixed equipment if there is any, else the old station most ops came from.
        src = Counter(ops[o]["station"] for o in (fixed or sops)).most_common()
        kind = kinds[min(src, key=lambda sc: (-sc[1], old[sc[0]]))[0]]
        slots.append({"ops": sops, "staff": "human" if cfg[0] == "human" else "robot",
                      "robot": None if cfg[0] == "human" else cfg[0], "bays": cfg[1],
                      "replaces": replaces, "kind": kind})
    return Rebuild(slots, choice, [lid for lid, x in use.items() if solver.value(x)],
                   round(solver.objective_value) // 1000)


def export(line: dict, rb: Rebuild, n: int = 1) -> dict:
    """The rebuilt line in the Line schema: new stations C01..Cn with kind, x/y, bays, staff,
    robot type and `replaces` (the old stations their work came from)."""
    out = copy.deepcopy(line)
    out["id"] = f"{line['id']}_rebuild_{n}"
    out["name"] = f"{line['name']} rebuilt for robots"
    pos = {o["id"]: i for i, o in enumerate(line["operations"])}
    g = nx.DiGraph()
    g.add_nodes_from(pos)
    g.add_edges_from((x["from"], x["to"]) for x in line["edges"] if x["type"] == "hard" and x["from"] in pos and x["to"] in pos)
    order = list(nx.lexicographical_topological_sort(g, key=pos.get))
    sid = {o: f"C{i:02d}" for i, s in enumerate(rb.slots, start=1) for o in s["ops"]}
    gone = {o for o, opt in rb.choice.items() if opt.mode == "eliminated"}

    for op in out["operations"]:
        opt = rb.choice[op["id"]]
        op["mode"] = opt.mode
        if opt.mode != "eliminated":
            op["station"] = sid[op["id"]]
        if opt.mode == "robot":
            for v, t in op["time"].items():
                t["mean"] = {"value": round(opt.time[v], 2), "source": "capability: human mean x robot time factor"}
                t["sd"] = {"value": round(t["sd"]["value"] * ROBOT_SD_FACTOR, 2), "source": "estimate"}
    names = {s["id"]: s["name"] for s in line["stations"]}
    stations = []
    for i, s in enumerate(rb.slots, start=1):
        buf = 2 if s["bays"] > 1 else 1
        robot = s["robot"]
        name = (ROBOTS[robot]["name"] + " cell" if robot else "Human station") + ": " + " + ".join(names[r] for r in s["replaces"])
        st = {"id": f"C{i:02d}", "name": name, "kind": s["kind"],
              "operations": [o for o in order if sid.get(o) == f"C{i:02d}"],
              "staff": s["staff"], "x": round((i - 1) * PITCH, 2), "y": 0.0, "rot": 0,
              "bufferBefore": buf if i > 1 else 0, "bufferAfter": buf if i < len(rb.slots) else 0,
              "bays": s["bays"], "replaces": s["replaces"]}
        if robot:
            st["robot"] = robot
        stations.append(st)
    out["stations"] = stations
    for v in out["variants"]:
        v["operations"] = [o for o in v["operations"] if o not in gone]
    add_fallback(out)

    used = [lv for lv in line.get("levers", []) if lv["id"] in rb.used]
    out["appliedLevers"] = [lv["id"] for lv in used]
    fleet = Counter()
    for s in rb.slots:
        if s["robot"]:
            fleet[s["robot"]] += s["bays"]
    lever_capex = sum(lv["cost"]["value"] for lv in used)
    bays_capex = sum(BAY_COST["value"] * (s["bays"] - 1) for s in rb.slots)
    integration = sum(k * ROBOTS[t]["integration"] for t, k in fleet.items())
    rent = sum(k * ROBOTS[t]["rentPerMonth"] for t, k in fleet.items())
    humans = sum(s["bays"] for s in rb.slots if s["staff"] == "human")
    out["design"] = {
        "mode": "rebuild",
        "stages": stages(rb),
        "bundle": "rebuild",
        "humanStations": sum(1 for s in rb.slots if s["staff"] == "human"),
        "robotStations": sum(1 for s in rb.slots if s["staff"] == "robot"),
        "people": humans,
        "fleet": [{"robot": t, "name": ROBOTS[t]["name"], "count": k,
                   "rentPerMonth": {"value": ROBOTS[t]["rentPerMonth"], "source": "estimate (demo rental catalogue)"}}
                  for t, k in sorted(fleet.items())],
        "capex": {"value": lever_capex + bays_capex + integration,
                  "source": f"estimate (levers {lever_capex} + extra bays {bays_capex:g} + robot integration {integration})"},
        "rentPerMonth": {"value": rent, "source": "estimate (demo rental catalogue)"},
        "objective": {"value": rb.objective, "source": "estimate",
                      "note": f"human station {HUMAN_STATION_COST['value']} per bay + robot rent x {HORIZON_MONTHS} "
                              "months + integration + extra bays + lever costs, EUR over 3 years"},
    }
    return out


def stages(rb: Rebuild) -> list[dict]:
    """Rebuild in line segments, front to back: each stage swaps the old stations a run of
    new stations replaces, so the rest of the line keeps running."""
    segs: list[tuple[list[str], list[str]]] = []
    for i, s in enumerate(rb.slots, start=1):
        cid = f"C{i:02d}"
        if segs and set(s["replaces"]) & set(segs[-1][1]):
            segs[-1][0].append(cid)
            segs[-1][1].extend(r for r in s["replaces"] if r not in segs[-1][1])
        else:
            segs.append(([cid], list(s["replaces"])))
    # Merge into at most three stages of similar size.
    k = min(3, len(segs))
    size = -(-len(segs) // k)
    names = ["Front of line", "Middle of line", "Back of line"] if k == 3 else ["Front of line", "Back of line"][:k]
    out = []
    for i in range(0, len(segs), size):
        part = segs[i:i + size]
        olds = sorted({o for p in part for o in p[1]})
        out.append({"id": f"M{len(out) + 1}", "name": f"Rebuild {names[len(out)].lower()}" if k > 1 else "Rebuild line",
                    "stations": [c for p in part for c in p[0]], "replaces": olds,
                    "gate": "New stations hold takt for one week, with the human fallback station staffed"})
    return out


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m optimize.rebuild")
    p.add_argument("line", type=Path, nargs="?", default=Path("app/public/data/line.json"))
    p.add_argument("-o", "--out", type=Path, default=Path("app/public/data"))
    p.add_argument("--slots", type=int)
    p.add_argument("--floor", type=float, default=FLOOR["value"])
    a = p.parse_args()
    line = json.loads(a.line.read_text())
    rb = solve(line, a.slots, a.floor)
    if rb is None:
        raise SystemExit("rebuild: no feasible layout")
    d = export(line, rb)
    (a.out / "line_rebuild_1.json").write_text(json.dumps(d, indent=2) + "\n")
    for s in d["stations"]:
        print(s["id"], s["kind"], s["staff"], s.get("robot", ""), f"x{s['bays']}", s["operations"], s.get("replaces", ""))
    print("fleet", d["design"]["fleet"], "people", d["design"]["people"], "3y", d["design"]["objective"]["value"])


if __name__ == "__main__":
    main()
