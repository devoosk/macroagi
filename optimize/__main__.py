"""python -m optimize <line.json> [-o outdir] [--floor 0.90] [--fleet a,b] [--scenarios]

Writes line_redesign_1..3.json (1 = cheapest) next to line.json by default.
--fleet limits the rental catalogue to some robot types. --scenarios also writes
one best design per demo fleet (line_scenario_<name>.json) to compare robot mixes.
"""

import argparse
import json
from pathlib import Path

from .costs import FLOOR
from .export import export
from .search import best_designs

SCENARIOS = {
    "arms_only": ["cobot_arm", "industrial_arm", "scara", "dual_arm"],
    "humanoids_only": ["humanoid"],
    "mixed": None,  # the whole catalogue
}


def _summary(path: Path, d: dict) -> str:
    s = d["design"]
    fleet = ", ".join(f"{f['count']}x {f['robot']}" for f in s["fleet"]) or "no robots"
    return (f"{path.name}: {s['bundle']} human={s['humanStations']} robot={s['robotStations']} ({fleet}) "
            f"capex={s['capex']['value']} rent/month={s['rentPerMonth']['value']} objective={s['objective']['value']}")


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m optimize")
    p.add_argument("line", type=Path)
    p.add_argument("-o", "--out", type=Path)
    p.add_argument("--floor", type=float, default=FLOOR["value"])
    p.add_argument("--fleet", help="comma-separated robot types from capability/robots.json")
    p.add_argument("--scenarios", action="store_true")
    args = p.parse_args()
    line = json.loads(args.line.read_text())
    outdir = args.out or args.line.parent
    fleet = args.fleet.split(",") if args.fleet else None

    designs = best_designs(line, args.floor, fleet=fleet)
    if not designs:
        raise SystemExit("no feasible redesign: check takt against station loads")
    for rank, (c, sol) in enumerate(designs, start=1):
        d = export(line, c, sol, rank)
        path = outdir / f"line_redesign_{rank}.json"
        path.write_text(json.dumps(d, indent=2) + "\n")
        print(_summary(path, d))

    if args.scenarios:
        for name, f in SCENARIOS.items():
            best = best_designs(line, args.floor, n=1, fleet=f)
            if not best:
                print(f"{name}: no feasible design")
                continue
            d = export(line, *best[0], 1)
            d["id"], d["name"] = f"{line['id']}_scenario_{name}", f"{line['name']} scenario {name.replace('_', ' ')}"
            path = outdir / f"line_scenario_{name}.json"
            path.write_text(json.dumps(d, indent=2) + "\n")
            print(_summary(path, d))


if __name__ == "__main__":
    main()
