"""CP-SAT: assign every operation a station and an option (human, a rented robot type
with levers, eliminated) so hard precedence holds, every variant fits takt and each
station is all-human or one robot type. A mobile robot (humanoid) may serve two
neighbouring stations. Minimise people, robot rent and integration, and lever cost."""

from dataclasses import dataclass

from ortools.sat.python import cp_model

from capability import ROBOTS

from .costs import HORIZON_MONTHS, HUMAN_STATION_COST, MOVE_TIME, PEAK_TOLERANCE
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
    robot: dict[str, str]  # robot station -> robot type
    shared: list[tuple[str, str]]  # neighbouring station pairs served by one mobile robot


def solve(line: dict, c: Candidates, forbid: list[set[str]] = ()) -> Solution | None:
    """forbid: robot-station sets from earlier solutions, to force a different design."""
    m = cp_model.CpModel()
    ops = [o["id"] for o in line["operations"]]
    idx = {s: i for i, s in enumerate(c.stations)}
    r = {s: m.new_bool_var(f"r_{s}") for s in c.stations}
    rt = {(s, t): m.new_bool_var(f"rt_{s}_{t}") for s in c.stations for t in c.fleet}
    for s in c.stations:
        m.add(sum(rt[s, t] for t in c.fleet) == r[s])
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
            m.add_implication(v, rt[s, c.options[o][k].robot])
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
    def load(s, var):
        return sum(round(c.options[o][k].time.get(var["id"], 0) * TIME_SCALE) * v
                   for (o, ss, k), v in z.items() if ss == s and o in var["operations"])

    total = sum(mix.values())
    for s in c.stations:
        for var in line["variants"]:
            m.add(load(s, var) <= peak * c.bays[s])
        m.add(sum(mix[var["id"]] * load(s, var) for var in line["variants"]) <= takt * c.bays[s] * total)

    # One mobile robot may serve two neighbouring single-bay stations if both loads fit one takt.
    share = {}
    move = round(MOVE_TIME["value"] * TIME_SCALE)
    for s1, s2 in zip(c.stations, c.stations[1:]):
        if c.bays[s1] != 1 or c.bays[s2] != 1:
            continue
        for t in c.fleet:
            if not ROBOTS[t]["mobile"]:
                continue
            x = share[s1, s2, t] = m.new_bool_var(f"share_{s1}_{s2}_{t}")
            m.add_implication(x, rt[s1, t])
            m.add_implication(x, rt[s2, t])
            for var in line["variants"]:
                m.add(load(s1, var) + load(s2, var) + 2 * move <= peak).only_enforce_if(x)
            m.add(sum(mix[var["id"]] * (load(s1, var) + load(s2, var) + 2 * move) for var in line["variants"])
                  <= takt * total).only_enforce_if(x)
    for s in c.stations:
        m.add(sum(x for (a, b, _), x in share.items() if s in (a, b)) <= 1)

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
    obj = []
    for s in c.stations:
        h = m.new_bool_var(f"h_{s}")
        m.add(h >= u[s] - r[s])
        obj.append(round(human_cost * c.bays[s]) * h)
    unit = {t: round(ROBOTS[t]["rentPerMonth"] * HORIZON_MONTHS + ROBOTS[t]["integration"]) for t in c.fleet}
    obj += [unit[t] * c.bays[s] * v for (s, t), v in rt.items()]
    obj += [-unit[t] * x for (_, _, t), x in share.items()]  # the shared robot is rented once
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
        robot={s: t for (s, t), v in rt.items() if solver.value(v)},
        shared=[(a, b) for (a, b, _), x in share.items() if solver.value(x)],
    )
