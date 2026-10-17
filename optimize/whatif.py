"""python -m optimize.whatif <line.json> [-o humanoid_sweep.json]

"If humanoids got this much cheaper and faster, would they win?" Re-solves the
mixed-fleet design over a grid of humanoid rent and speed, and records how many
humanoids the best design rents and what it costs.
"""

import argparse
import json
from pathlib import Path

from capability import ROBOTS, robot_overrides

from .costs import FLOOR
from .export import export
from .search import best_designs

RENT_FACTORS = [1.0, 0.75, 0.5, 0.35, 0.25]
SPEED_FACTORS = [1.0, 0.8, 0.6, 0.45]  # x today's humanoid time; lower is faster
PRECISIONS = ["medium", "tight"]  # today's hands, then hands as precise as a SCARA


def sweep(line: dict, floor: float = FLOOR["value"]) -> dict:
    base = dict(ROBOTS["humanoid"])
    points = []
    for precision in PRECISIONS:
      for rent in RENT_FACTORS:
        for speed in SPEED_FACTORS:
            spec = {"rentPerMonth": round(base["rentPerMonth"] * rent), "timeScale": round(base["timeScale"] * speed, 3),
                    "precision": precision}
            what = {"humanoidRentPerMonth": spec["rentPerMonth"], "humanoidTimeScale": spec["timeScale"],
                    "humanoidPrecision": precision}
            with robot_overrides({"humanoid": spec}):
                best = best_designs(line, floor, n=1)
                d = export(line, *best[0], 1)
            fleet = {f["robot"]: f["count"] for f in d["design"]["fleet"]}
            points.append({
                "rentFactor": rent, "speedFactor": speed, **what,
                "humanoids": fleet.get("humanoid", 0),
                "otherRobots": sum(n for t, n in fleet.items() if t != "humanoid"),
                "humanStations": d["design"]["humanStations"],
                "sharedStations": [[s["id"], s["sharedWith"]] for s in d["stations"] if s.get("sharedWith")][::2],
                "objective": d["design"]["objective"],
                "rentPerMonth": d["design"]["rentPerMonth"],
                "fleet": d["design"]["fleet"],
            })
    wins = [p for p in points if p["humanoids"] > p["otherRobots"]]
    # The smallest change that makes humanoids the main robot: least precision, then highest rent and time.
    first = min(wins, key=lambda p: (PRECISIONS.index(p["humanoidPrecision"]), -p["rentFactor"] * p["speedFactor"]), default=None)
    return {
        "line": line["id"],
        "robot": "humanoid",
        "base": {"rentPerMonth": base["rentPerMonth"], "timeScale": base["timeScale"], "precision": base["precision"]},
        "source": "estimate (demo rental catalogue, optimize CP-SAT per grid point)",
        "points": points,
        "breakEven": first and {k: first[k] for k in ("rentFactor", "speedFactor", "humanoidRentPerMonth", "humanoidTimeScale", "humanoidPrecision")},
    }


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m optimize.whatif")
    p.add_argument("line", type=Path)
    p.add_argument("-o", "--out", type=Path)
    a = p.parse_args()
    out = a.out or a.line.with_name("humanoid_sweep.json")
    res = sweep(json.loads(a.line.read_text()))
    out.write_text(json.dumps(res, indent=2) + "\n")
    for precision in PRECISIONS:
        print(f"precision {precision}: rent \\ speed " + " ".join(f"{s:>9}" for s in SPEED_FACTORS))
        for rent in RENT_FACTORS:
            row = [p for p in res["points"] if p["rentFactor"] == rent and p["humanoidPrecision"] == precision]
            print(f"{rent:>30} " + " ".join(f"{p['humanoids']:>2}/{p['otherRobots']}/{p['humanStations']:<3}" for p in row))
    print(f"humanoids/other robots/human stations per point; break-even: {res['breakEven']}; wrote {out}")


if __name__ == "__main__":
    main()
