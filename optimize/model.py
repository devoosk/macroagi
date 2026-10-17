"""CP-SAT: assign every operation a station and an option (human, robot with levers,
eliminated) so hard precedence holds, every variant fits takt and each station is
all-robot or all-human; minimise station cost plus lever cost."""

from dataclasses import dataclass

from ortools.sat.python import cp_model

from .costs import HUMAN_STATION_COST, PEAK_TOLERANCE, ROBOT_CELL_COST
from .generator import Candidates, Option

TIME_SCALE = 10  # 0.1 s


@dataclass
class Solution:
    bundle: str
    objective: int
    station: dict[str, str | None]  # op -> station (None if eliminated)
    choice: dict[str, Option]
    robot_stations: list[str]
    human_stations: list[str]
    used: list[str]  # lever ids the solution pays for


def solve(line: dict, c: Candidates, forbid: list[set[str]] = ()) -> Solution | None:
    """forbid: robot-station sets from earlier solutions, to force a different design."""
    m = cp_model.CpModel()
    ops = [o["id"] for o in line["operations"]]
    idx = {s: i for i, s in enumerate(c.stations)}
    r = {s: m.new_bool_var(f"r_{s}") for s in c.stations}
    u = {s: m.new_bool_var(f"u_{s}") for s in c.stations}
    z = {}  # (op, station, option index) -> bool
    for o in ops:
        for s in c.allowed[o]:
            for k, opt in enumerate(c.options[o]):
                if opt.mode != "eliminated":
                    z[o, s, k] = m.new_bool_var(f"z_{o}_{s}_{k}")
    e = {(o, k): m.new_bool_var(f"e_{o}_{k}") for o in ops
         for k, opt in enumerate(c.options[o]) if opt.mode == "eliminated"}

    for o in ops:
        m.add_exactly_one([v for (oo, _, _), v in z.items() if oo == o] + [v for (oo, _), v in e.items() if oo == o])

    for (o, s, k), v in z.items():
        m.add_implication(v, u[s])
        if c.options[o][k].mode == "robot":
            m.add_implication(v, r[s])
        else:
            m.add_implication(v, r[s].Not())
    for s in c.stations:
        m.add_implication(r[s], u[s])

    pos = {o: sum(idx[s] * v for (oo, s, _), v in z.items() if oo == o) for o in ops}
    gone = {o: sum(v for (oo, _), v in e.items() if oo == o) for o in ops}
    for edge in line["edges"]:
        if edge["type"] == "hard" and edge["from"] in pos and edge["to"] in pos:
            a, b = edge["from"], edge["to"]
            # Only binding when neither end is eliminated. Same-station order is kept by export.
            big = len(c.stations)
            m.add(pos[a] <= pos[b] + big * (gone[a] + gone[b]))

    # Mixed-model takt: the mix-weighted load fits takt and no variant exceeds takt x peak tolerance.
    takt = round(line["takt"]["value"] * TIME_SCALE)
    peak = round(line["takt"]["value"] * PEAK_TOLERANCE["value"] * TIME_SCALE)
    mix = {v["id"]: round(v["mix"]["value"] * 1000) for v in line["variants"]}
    for s in c.stations:
        weighted = []
        for var in line["variants"]:
            load = [round(c.options[o][k].time.get(var["id"], 0) * TIME_SCALE) * v
                    for (o, ss, k), v in z.items() if ss == s and o in var["operations"]]
            m.add(sum(load) <= peak * c.bays[s])
            weighted += [mix[var["id"]] * x for x in load]
        m.add(sum(weighted) <= takt * c.bays[s] * sum(mix.values()))

    # A lever instance is paid once, however many operations use it.
    use = {lid: m.new_bool_var(f"use_{lid}") for lid in c.levers}
    for (o, s, k), v in z.items():
        for lid in c.options[o][k].levers:
            m.add_implication(v, use[lid])
    for (o, k), v in e.items():
        for lid in c.options[o][k].levers:
            m.add_implication(v, use[lid])
    for lid in c.decouple.values():
        m.add(use[lid] == 1)
    home = {o["id"]: o["station"] for o in line["operations"]}
    for (o, s, k), v in z.items():
        if s != home[o] and o in c.moves:
            m.add_implication(v, use[c.moves[o]])

    for prev in forbid:
        # At least one station must change robot/human status.
        m.add(sum(r[s].Not() if s in prev else r[s] for s in c.stations) >= 1)

    human_cost = HUMAN_STATION_COST["value"]
    robot_cost = ROBOT_CELL_COST["value"]
    obj = []
    for s in c.stations:
        h = m.new_bool_var(f"h_{s}")
        m.add(h >= u[s] - r[s])
        obj += [round(human_cost * c.bays[s]) * h, round(robot_cost * c.bays[s]) * r[s]]
    obj += [round(c.levers[lid].cost) * u for lid, u in use.items()]
    # Tie-breaker: move as few operations as possible from their current station.
    tie = sum(v for (o, s, _), v in z.items() if s != home[o])
    m.minimize(sum(obj) * 1000 + tie)

    solver = cp_model.CpSolver()
    solver.parameters.num_workers = 1
    solver.parameters.random_seed = 0
    solver.parameters.max_time_in_seconds = 30
    status = solver.solve(m)
    if status == cp_model.INFEASIBLE:
        return None
    if status != cp_model.OPTIMAL:
        # A merely feasible answer depends on timing, which would break determinism.
        raise RuntimeError(f"CP-SAT did not prove optimality for bundle {c.bundle} ({solver.status_name(status)})")

    station, choice = {}, {}
    for (o, s, k), v in z.items():
        if solver.value(v):
            station[o], choice[o] = s, c.options[o][k]
    for (o, k), v in e.items():
        if solver.value(v):
            station[o], choice[o] = None, c.options[o][k]
    return Solution(
        bundle=c.bundle,
        objective=round(solver.objective_value) // 1000,
        station=station,
        choice=choice,
        robot_stations=[s for s in c.stations if solver.value(r[s])],
        human_stations=[s for s in c.stations if solver.value(u[s]) and not solver.value(r[s])],
        used=[lid for lid, x in use.items() if solver.value(x)],
    )
