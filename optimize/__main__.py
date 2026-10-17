"""python -m optimize <line.json> [-o outdir] [--floor 0.90]

Writes line_redesign_1..3.json (1 = cheapest) next to line.json by default.
"""

import argparse
import json
from pathlib import Path

from .costs import FLOOR
from .export import export
from .search import best_designs


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m optimize")
    p.add_argument("line", type=Path)
    p.add_argument("-o", "--out", type=Path)
    p.add_argument("--floor", type=float, default=FLOOR["value"])
    args = p.parse_args()
    line = json.loads(args.line.read_text())
    outdir = args.out or args.line.parent
    designs = best_designs(line, args.floor)
    if not designs:
        raise SystemExit("no feasible redesign: check takt against station loads")
    for rank, (c, sol) in enumerate(designs, start=1):
        d = export(line, c, sol, rank)
        path = outdir / f"line_redesign_{rank}.json"
        path.write_text(json.dumps(d, indent=2) + "\n")
        print(f"{path}: {sol.bundle} human={d['design']['humanStations']} robot={d['design']['robotStations']} "
              f"levers={len(d['appliedLevers'])} capex={d['design']['capex']['value']} objective={sol.objective}")


if __name__ == "__main__":
    main()
