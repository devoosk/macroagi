import copy

import networkx as nx

from capability import ROBOTS

from .costs import HORIZON_MONTHS, HUMAN_STATION_COST
from .generator import Candidates, used_levers
from .model import Solution

ROBOT_SD_FACTOR = 0.4  # robots repeat more tightly than people (estimate, as in tools/gen)


def export(line: dict, c: Candidates, sol: Solution, rank: int) -> dict:
    """A redesign in the Line schema, with a `design` summary for item 7."""
    out = copy.deepcopy(line)
    out["id"] = f"{line['id']}_redesign_{rank}"
    out["name"] = f"{line['name']} redesign {rank} ({sol.bundle})"
    # Hard edges first, then the current listing order.
    pos = {o["id"]: i for i, o in enumerate(line["operations"])}
    g = nx.DiGraph()
    g.add_nodes_from(pos)
    g.add_edges_from((e["from"], e["to"]) for e in line["edges"] if e["type"] == "hard" and e["from"] in pos and e["to"] in pos)
    order = list(nx.lexicographical_topological_sort(g, key=pos.get))
    gone = {o for o, s in sol.station.items() if s is None}

    for op in out["operations"]:
        opt = sol.choice[op["id"]]
        op["mode"] = opt.mode
        if opt.mode != "eliminated":
            op["station"] = sol.station[op["id"]]
        if opt.mode == "robot":
            # The simulator reads op times, so robot ops carry the robot time.
            for v, t in op["time"].items():
                t["mean"] = {"value": round(opt.time[v], 2), "source": "capability: human mean x robot time factor"}
                t["sd"] = {"value": round(t["sd"]["value"] * ROBOT_SD_FACTOR, 2), "source": "estimate"}
    for st in out["stations"]:
        sid = st["id"]
        st["operations"] = [o for o in order if sol.station.get(o) == sid]
        st["staff"] = "robot" if sid in sol.robot_stations else "human" if sid in sol.human_stations else "empty"
        if sid in sol.robot:
            st["robot"] = sol.robot[sid]
            mate = next((b if a == sid else a for a, b in sol.shared if sid in (a, b)), None)
            if mate:
                st["sharedWith"] = mate
        st["bays"] = c.bays[sid]
        if sid in c.decouple:
            st["bufferBefore"] = max(st["bufferBefore"], 2)
            st["bufferAfter"] = max(st["bufferAfter"], 2)
    hard = [(e["from"], e["to"]) for e in line["edges"] if e["type"] == "hard"]
    for st in out["stations"]:
        seq = st["operations"]
        for a, b in hard:
            if a in seq and b in seq and seq.index(a) > seq.index(b):
                raise ValueError(f"{st['id']}: {a} after {b} breaks a hard edge")
    for v in out["variants"]:
        v["operations"] = [o for o in v["operations"] if o not in gone]
    add_fallback(out)

    levers = used_levers(c, sol.choice, [lid for lid in sol.used if lid in c.moves.values()])
    # Keep the line's lever catalogue; add any generated levers this design uses.
    known = {lv["id"] for lv in line.get("levers", [])}
    out["levers"] = list(line.get("levers", [])) + [lv for lv in levers if lv["id"] not in known]
    out["appliedLevers"] = [lv["id"] for lv in levers]
    fleet = robot_fleet(c, sol)
    lever_capex = sum(lv["cost"]["value"] for lv in levers)
    integration = sum(n * ROBOTS[t]["integration"] for t, n in fleet.items())
    rent = sum(n * ROBOTS[t]["rentPerMonth"] for t, n in fleet.items())
    out["design"] = {
        "stages": stages(line, c, sol),
        "bundle": sol.bundle,
        "humanStations": len(sol.human_stations),
        "robotStations": len(sol.robot_stations),
        "fleet": [{"robot": t, "name": ROBOTS[t]["name"], "count": n,
                   "rentPerMonth": {"value": ROBOTS[t]["rentPerMonth"], "source": "estimate (demo rental catalogue)"}}
                  for t, n in fleet.items()],
        "capex": {"value": lever_capex + integration,
                  "source": f"estimate (levers {lever_capex} + robot integration {integration})"},
        "rentPerMonth": {"value": rent, "source": "estimate (demo rental catalogue)"},
        "objective": {"value": sol.objective, "source": "estimate",
                      "note": f"human station {HUMAN_STATION_COST['value']} per bay + robot rent x {HORIZON_MONTHS} "
                              "months + integration + lever costs, EUR over 3 years"},
    }
    return out


def robot_fleet(c: Candidates, sol: Solution) -> dict[str, int]:
    """Robots to rent per type: one per bay, a shared mobile robot counted once."""
    n: dict[str, int] = {}
    for s, t in sol.robot.items():
        n[t] = n.get(t, 0) + c.bays[s]
    for a, _ in sol.shared:
        n[sol.robot[a]] -= 1
    return dict(sorted(n.items()))


def stages(line: dict, c: Candidates, sol: Solution) -> list[dict]:
    """Migration stages (types.ts MigrationStage), lowest risk first: remove waste,
    then split test stations, then robot cells. Each ends at a gate to pass first."""
    home = {o["id"]: o["station"] for o in line["operations"]}
    waste = sorted({home[o] for o, opt in sol.choice.items() if opt.mode == "eliminated"}
                   | {home[o] for o, st in sol.station.items() if st and st != home[o]}
                   | {st for o, st in sol.station.items() if st and st != home[o]})
    units_h = round(3600 / line["takt"]["value"], 1)
    out = [
        ("Remove walk and search", waste,
         "No walk or search seen at these stations for one week; kit accuracy at least 99.5%"),
        ("Parallel test bays with decoupling buffers", sorted(c.decouple),
         f"Split test stations hold {units_h} units/h for one shift"),
        ("Robot cells", list(sol.robot_stations),
         "Each robot cell holds the required reliability from the sweep for one week, with human fallback"),
    ]
    return [{"id": f"M{i}", "name": n, "stations": st, "gate": g}
            for i, (n, st, g) in enumerate([x for x in out if x[1]], start=1)]


FALLBACK_ID = "FB"


def add_fallback(line: dict) -> None:
    """One off-line human fallback station shared by all robot cells: a unit whose robot op
    fails is finished there by a person and rejoins the line (plan step 4)."""
    line["stations"] = [s for s in line["stations"] if s["id"] != FALLBACK_ID]
    robots = [s for s in line["stations"] if s["staff"] == "robot"]
    for s in line["stations"]:
        s.pop("fallback", None)
    if not robots:
        return
    for s in robots:
        s["fallback"] = FALLBACK_ID
    xs = sorted(s["x"] for s in robots)
    line["stations"].append({
        "id": FALLBACK_ID, "name": "Robot fallback", "kind": robots[0]["kind"], "operations": [],
        "staff": "human", "x": xs[len(xs) // 2], "y": -4.0, "rot": 0, "bufferBefore": 2, "bufferAfter": 0, "bays": 1,
        "offline": True,
    })
