import copy

from .costs import HUMAN_STATION_COST, ROBOT_CELL_COST
from .generator import Candidates, lever_instances
from .model import Solution


def export(line: dict, c: Candidates, sol: Solution, rank: int) -> dict:
    """A redesign in the Line schema, with a `design` summary for item 7."""
    out = copy.deepcopy(line)
    out["id"] = f"{line['id']}_redesign_{rank}"
    out["name"] = f"{line['name']} redesign {rank} ({sol.bundle})"
    order = [o["id"] for o in line["operations"]]
    gone = {o for o, s in sol.station.items() if s is None}

    for op in out["operations"]:
        opt = sol.choice[op["id"]]
        op["mode"] = opt.mode
        if opt.mode != "eliminated":
            op["station"] = sol.station[op["id"]]
    for st in out["stations"]:
        sid = st["id"]
        st["operations"] = [o for o in order if sol.station.get(o) == sid]
        st["staff"] = "robot" if sid in sol.robot_stations else "human" if sid in sol.human_stations else "empty"
        st["bays"] = c.bays[sid]
        if sid in c.decoupled:
            st["bufferBefore"] = max(st["bufferBefore"], 2)
            st["bufferAfter"] = max(st["bufferAfter"], 2)
    for v in out["variants"]:
        v["operations"] = [o for o in v["operations"] if o not in gone]

    levers = lever_instances(line, c, sol.choice)
    out["levers"] = levers
    out["appliedLevers"] = [lv["id"] for lv in levers]
    capex = sum(lv["cost"]["value"] for lv in levers) + sum(
        ROBOT_CELL_COST["value"] * c.bays[s] for s in sol.robot_stations)
    out["design"] = {
        "bundle": sol.bundle,
        "humanStations": len(sol.human_stations),
        "robotStations": len(sol.robot_stations),
        "capex": {"value": capex, "source": "estimate"},
        "objective": {"value": sol.objective, "source": "estimate",
                      "note": f"human station {HUMAN_STATION_COST['value']} + robot cell "
                              f"{ROBOT_CELL_COST['value']} per bay, plus lever costs, EUR over 3 years"},
    }
    return out
