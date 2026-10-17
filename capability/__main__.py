"""python -m capability <line.json> [-o capability.json]

Writes the prior table and, per operation, the baseline estimate plus one row
per applicable single lever type, for the app to show.
"""

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from .levers import LEVER_COSTS
from .model import PRIORS, Estimate, applicable_levers, estimate


def _row(e: Estimate) -> dict:
    f = asdict(e.features)
    f.pop("levers")
    return {
        "operation": e.operation,
        "levers": list(e.levers),
        "mean": round(e.mean, 4),
        "p05": round(e.p05, 4),
        "p95": round(e.p95, 4),
        "alpha": None if e.alpha is None else round(e.alpha, 3),
        "beta": None if e.beta is None else round(e.beta, 3),
        "timeFactor": {k: round(v, 3) for k, v in e.time_factor.items()},
        "robotTime": {k: round(v, 2) for k, v in e.robot_time.items()},
        "waste": e.waste,
        "eliminated": e.eliminated,
        "features": f,
        "reasons": e.reasons,
        "source": e.source,
    }


def build(line: dict) -> dict:
    priors = [
        {"verb": verb, "presentation": pres, "mean": m, "concentration": n,
         "timeFactor": PRIORS["timeFactor"]["byVerb"][verb], "source": PRIORS["source"]}
        for verb, row in PRIORS["success"].items() for pres, (m, n) in row.items()
    ]
    rows = []
    for op in line["operations"]:
        rows.append(_row(estimate(op, line)))
        for lever in applicable_levers(op, line):
            rows.append(_row(estimate(op, line, [lever])))
    return {"line": line["id"], "version": PRIORS["version"], "priors": priors,
            "leverCosts": LEVER_COSTS, "operations": rows}


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m capability")
    p.add_argument("line", type=Path)
    p.add_argument("-o", "--out", type=Path)
    args = p.parse_args()
    out = args.out or args.line.with_name("capability.json")
    out.write_text(json.dumps(build(json.loads(args.line.read_text())), indent=2) + "\n")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
