"""python -m graph.score <line_v2.json> <line.json> [-o graph_score.json]

Scores the rebuilt graph against the hidden ground truth. The only module in
graph/ that reads the true line.
"""

import argparse
import json
from pathlib import Path

import networkx as nx
import numpy as np
from scipy.optimize import linear_sum_assignment


def _cost(a: dict, b: dict) -> float:
    pa, pb = set(a["parts"]), set(b["parts"])
    jac = len(pa & pb) / len(pa | pb) if pa | pb else 1.0
    return (a["station"] != b["station"]) + (a["verb"] != b["verb"]) + (1 - jac)


def match(inferred: dict, truth: dict) -> dict[str, str]:
    """Inferred op id -> true op id (Hungarian on station, verb and parts)."""
    inf, tru = inferred["operations"], truth["operations"]
    if not inf or not tru:
        return {}
    cost = np.array([[_cost(a, b) for b in tru] for a in inf])
    rows, cols = linear_sum_assignment(cost)
    return {inf[r]["id"]: tru[c]["id"] for r, c in zip(rows, cols) if cost[r, c] <= 1.0}


def _graph(line: dict) -> nx.DiGraph:
    g = nx.DiGraph()
    g.add_nodes_from(o["id"] for o in line["operations"])
    g.add_edges_from((e["from"], e["to"], {"type": e["type"]}) for e in line["edges"])
    return g


def score(inferred: dict, truth: dict) -> dict:
    m = match(inferred, truth)
    true_ops = {o["id"]: o for o in truth["operations"]}
    inf_ops = {o["id"]: o for o in inferred["operations"]}
    gi, gt = _graph(inferred), _graph(truth)
    ci, ct = nx.transitive_closure(gi), nx.transitive_closure(gt)
    back = {t: i for i, t in m.items()}
    station = {o["id"]: o["station"] for o in truth["operations"]}

    def scope(a, b):
        return "within_station" if station[a] == station[b] else "cross_station"

    recall = {"within_station": [0, 0], "cross_station": [0, 0]}
    type_hits, type_n, hard_as_soft = 0, 0, 0
    for e in truth["edges"]:
        a, b = e["from"], e["to"]
        bucket = recall[scope(a, b)]
        bucket[1] += 1
        if a not in back or b not in back:
            continue
        if e["type"] == "soft" and gi.has_edge(back[b], back[a]):
            a, b = b, a  # a soft edge's direction is just the more common order
        if ci.has_edge(back[a], back[b]):
            bucket[0] += 1
        if gi.has_edge(back[a], back[b]):
            type_n += 1
            got = gi.edges[back[a], back[b]]["type"]
            type_hits += got == e["type"]
            hard_as_soft += e["type"] == "hard" and got == "soft"
    precise = sum(1 for e in inferred["edges"]
                  if e["from"] in m and e["to"] in m and ct.has_edge(m[e["from"]], m[e["to"]]))

    errs = []
    for i, t in m.items():
        for v, tm in true_ops[t]["time"].items():
            if v in inf_ops[i]["time"]:
                tv = tm["mean"]["value"]
                errs.append(abs(inf_ops[i]["time"][v]["mean"]["value"] - tv) / tv)

    def ratio(a, b):
        return round(a / b, 3) if b else None

    src = "scored against hidden ground truth line.json"
    total_true = sum(b[1] for b in recall.values())
    return {
        "operationRecall": {"value": ratio(len(m), len(true_ops)), "source": src},
        "operationPrecision": {"value": ratio(len(m), len(inf_ops)), "source": src},
        "verbAccuracy": {"value": ratio(sum(inf_ops[i]["verb"] == true_ops[t]["verb"] for i, t in m.items()), len(m)), "source": src},
        "timeMeanAbsPctError": {"value": round(float(np.mean(errs)), 3) if errs else None, "source": src},
        "edgeRecall": {"value": ratio(sum(b[0] for b in recall.values()), total_true), "source": src},
        "edgeRecallWithinStation": {"value": ratio(*recall["within_station"]), "source": src},
        "edgeRecallCrossStation": {"value": ratio(*recall["cross_station"]), "source": src},
        "edgePrecision": {"value": ratio(precise, len(inferred["edges"])), "source": src},
        "edgeTypeAccuracy": {"value": ratio(type_hits, type_n), "source": src},
        "trueHardPredictedSoft": {"value": hard_as_soft, "source": src},
        "matching": m,
    }


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m graph.score")
    p.add_argument("inferred", type=Path)
    p.add_argument("truth", type=Path)
    p.add_argument("-o", "--out", type=Path)
    a = p.parse_args()
    s = score(json.loads(a.inferred.read_text()), json.loads(a.truth.read_text()))
    text = json.dumps(s, indent=2) + "\n"
    if a.out:
        a.out.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
