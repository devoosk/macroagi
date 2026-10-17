"""Graph rebuilt from synthetic VLM segments (graph.synth -> graph.build), plus the
per-segment sparks for the capture animation."""

import re
import statistics
from collections import defaultdict
from itertools import combinations

import networkx as nx

from graph.build import MIN_N, ORDER_TOL, PARALLEL_SHARE, SOFT_MINORITY, _key, assign_visits, build, catalogue_from_line, clean
from graph.score import score
from graph.synth import synth_segments


def _clusters(segments_doc: dict, line_v2: dict) -> tuple[dict, dict]:
    """Replays graph.build's clustering (clean, visits, (station, verb, parts, nth)) to get the
    builder's own segment -> operation assignment. Returns (visits, op -> [(visit, segment)])."""
    segs = clean(segments_doc["segments"])
    assign_visits(segs)
    visits = defaultdict(list)
    for s in segs:
        visits[s["visit"]].append(s)
    for v in visits.values():
        v.sort(key=lambda s: s["start"])
    op_of = {}
    for o in line_v2["operations"]:
        m = re.search(r" \((\d+)\)$", o["name"])
        op_of[(o["station"], o["verb"], tuple(o["parts"]), int(m.group(1)) if m else 1)] = o["id"]
    members = defaultdict(list)
    for vid, v in visits.items():
        count = defaultdict(int)
        for s in v:
            count[_key(s)] += 1
            op = op_of.get((*_key(s), count[_key(s)]))
            if op:
                s["_node"] = op
                members[op].append((vid, s))
    return visits, members


def _layout(line_v2: dict, types=("hard", "soft")) -> dict[str, tuple[float, float]]:
    g = nx.DiGraph()
    g.add_nodes_from(o["id"] for o in line_v2["operations"])
    g.add_edges_from((e["from"], e["to"]) for e in line_v2["edges"] if e["type"] in types)
    layer = {}
    for n in nx.topological_sort(g):
        layer[n] = max((layer[p] + 1 for p in g.predecessors(n)), default=0)
    top = max(layer.values()) or 1
    order = {o["id"]: i for i, o in enumerate(line_v2["operations"])}  # builder orders by station, then time
    by_layer = defaultdict(list)
    for n, k in layer.items():
        by_layer[k].append(n)
    out = {}
    for k, ns in by_layer.items():
        ns.sort(key=order.get)
        for i, n in enumerate(ns):
            out[n] = (round(k / top, 4), round((i + 1) / (len(ns) + 1), 4))
    return out


def _edges(line_v2: dict, members: dict) -> list[dict]:
    by_visit = defaultdict(dict)
    for op, ms in members.items():
        for vid, s in ms:
            by_visit[vid][op] = s
    counts = {}
    station_ops = defaultdict(list)
    for o in line_v2["operations"]:
        station_ops[o["station"]].append(o["id"])
    for ops in station_ops.values():
        for a, b in combinations(ops, 2):
            ab = ba = ov = 0
            for segs in by_visit.values():
                if a in segs and b in segs:
                    sa, sb = segs[a], segs[b]
                    if sa["end"] <= sb["start"] + ORDER_TOL:
                        ab += 1
                    elif sb["end"] <= sa["start"] + ORDER_TOL:
                        ba += 1
                    else:
                        ov += 1
            counts[a, b], counts[b, a] = (ab, ba, ov), (ba, ab, ov)
    out, seen = [], set()
    for e in line_v2["edges"]:
        ab, ba, _ = counts.get((e["from"], e["to"]), (0, 0, 0))
        out.append({"from": e["from"], "to": e["to"], "type": e["type"], "nab": ab, "nba": ba, "redundant": False,
                    "scope": "within_station" if (e["from"], e["to"]) in counts else "cross_station"})
        seen |= {(e["from"], e["to"]), (e["to"], e["from"])}
    # Within-station pairs the builder saw in order but dropped as implied by other edges.
    for (a, b), (ab, ba, ov) in sorted(counts.items()):
        n = ab + ba + ov
        if (a, b) in seen or n == 0 or ov >= PARALLEL_SHARE * n or ab < ba or (ab == ba and a > b):
            continue
        soft = ba and ba / (ab + ba) >= SOFT_MINORITY and n >= MIN_N
        out.append({"from": a, "to": b, "type": "soft" if soft else "hard", "nab": ab, "nba": ba,
                    "redundant": True, "scope": "within_station"})
        seen |= {(a, b), (b, a)}
    return out


def build_graph(events: dict, line: dict, t0: float, seed: int = 1) -> tuple[dict, list[dict], dict]:
    segments_doc = synth_segments(events, line, seed=seed, noise=True)
    line_v2, evidence = build(segments_doc, catalogue_from_line(line), [])
    visits, members = _clusters(segments_doc, line_v2)
    pos, hpos = _layout(line_v2), _layout(line_v2, ("hard",))
    nodes = []
    for o in line_v2["operations"]:
        durs = [s["end"] - s["start"] for _, s in members[o["id"]]]
        mean = statistics.fmean(durs)
        sd = statistics.stdev(durs) if len(durs) > 1 else 0.0
        nodes.append({"id": o["id"], "station": o["station"], "verb": o["verb"], "name": o["name"],
                      "meanTime": round(mean, 2), "cv": round(sd / mean, 4) if mean else 0.0, "n": len(durs),
                      "gx": pos[o["id"]][0], "gy": pos[o["id"]][1],
                      "hx": hpos[o["id"]][0], "hy": hpos[o["id"]][1]})
    s = score(line_v2, line)
    graph = {"nodes": nodes, "edges": _edges(line_v2, members),
             "score": {k: v["value"] for k, v in s.items() if k != "matching"},
             "droppedClusters": len(evidence["droppedClusters"]), "segments": len(segments_doc["segments"])}

    t1 = events["duration"]
    sparks = []
    for v in visits.values():
        for seg in v:
            if seg["start"] >= t0 and seg.get("_node"):
                sparks.append({"st": seg["station"], "t": round((seg["start"] - t0) / (t1 - t0), 5),
                               "node": seg["_node"], "verb": seg["verb"], "dur": seg["end"] - seg["start"]})
    sparks.sort(key=lambda x: (x["t"], x["st"], x["node"]))
    meta = {"segmentsSource": segments_doc["source"], "window": [t0, t1]}
    return graph, sparks, meta
