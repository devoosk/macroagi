"""Build line.json v2 from segments.json and a parts/variants/stations catalogue.

Never reads line.json operations or edges, nor event logs: only what the
cameras saw, plus the BOM and station registry a plant would hand over.
"""

import statistics
from collections import defaultdict
from itertools import combinations

import networkx as nx

MIN_SHARE = 0.30  # an op must appear in this share of a station's visits
MIN_N = 5  # pairs seen fewer times default to hard and are flagged for review
SOFT_MINORITY = 0.10
PARALLEL_SHARE = 0.50
ORDER_TOL = 1.0  # seconds
SIZES = ["small", "medium", "large"]
TOOL_FOR_VERB = {"screw": "torque_driver", "braze": "torch", "connect": "crimper", "inspect": "scanner"}


def catalogue_from_line(line: dict) -> dict:
    """What a plant hands over without any process knowledge: BOM, variants, station registry."""
    return {
        "parts": line["parts"],
        "variants": [{k: v[k] for k in ("id", "name", "kw", "mix")} for v in line["variants"]],
        "stations": [{k: s[k] for k in ("id", "name", "kind", "x", "y", "rot")} for s in line["stations"]],
    }


def clean(segments: list[dict]) -> list[dict]:
    """Merge neighbouring same-label segments in a visit; drop sub-second blips."""
    out = []
    for s in sorted(segments, key=lambda s: (s["station"], s.get("visit", ""), s["start"])):
        prev = out[-1] if out else None
        if (prev and prev["station"] == s["station"] and prev.get("visit") == s.get("visit")
                and (prev["verb"], sorted(prev["parts"])) == (s["verb"], sorted(s["parts"]))
                and s["start"] - prev["end"] <= 1.0):
            prev["end"] = max(prev["end"], s["end"])
        else:
            out.append(dict(s))
    return [s for s in out if s["end"] - s["start"] >= 1.0]


def assign_visits(segments: list[dict], gap: float = 3.0) -> None:
    """Visits from idle gaps when the capture didn't see units enter and leave."""
    by_station = defaultdict(list)
    for s in segments:
        if not s.get("visit"):
            by_station[s["station"]].append(s)
    for station, segs in by_station.items():
        k, last = 0, None
        for s in sorted(segs, key=lambda s: s["start"]):
            if last is None or s["start"] - last > gap:
                k += 1
            s["visit"], last = f"{station}#gap{k}", max(last or 0, s["end"])


def _key(s: dict) -> tuple:
    return (s["station"], s["verb"], tuple(sorted(s["parts"])))


def build(segments_doc: dict, catalogue: dict, overrides: list[dict] = ()) -> tuple[dict, dict]:
    segs = clean(segments_doc["segments"])
    assign_visits(segs)
    src = segments_doc.get("source", "video")

    visits = defaultdict(list)  # visit -> segments in time order
    for s in segs:
        visits[s["visit"]].append(s)
    for v in visits.values():
        v.sort(key=lambda s: s["start"])
    station_visits = defaultdict(list)
    for vid, v in visits.items():
        station_visits[v[0]["station"]].append(vid)

    # Variant per visit from visible unit size, ranked onto variants by kW.
    variants = sorted(catalogue["variants"], key=lambda v: v["kw"])
    unknown_sizes = sorted({s["unit_size"] for s in segs if s.get("unit_size") and s["unit_size"] not in SIZES})
    seen_sizes = sorted({s.get("unit_size") for s in segs if s.get("unit_size") in SIZES}, key=SIZES.index)
    size_to_variant = ({sz: variants[round(i * (len(variants) - 1) / max(len(seen_sizes) - 1, 1))]["id"]
                        for i, sz in enumerate(seen_sizes)} if seen_sizes else {})
    visit_variant = {vid: size_to_variant.get(v[0].get("unit_size")) for vid, v in visits.items()}

    # Cluster: (station, verb, parts) plus an ordinal for repeats within one visit.
    occ = defaultdict(list)  # cluster key -> [(visit, segment)]
    for vid, v in visits.items():
        count = defaultdict(int)
        for s in v:
            count[_key(s)] += 1
            occ[(*_key(s), count[_key(s)])].append((vid, s))
    kept = {k: o for k, o in occ.items()
            if len({vid for vid, _ in o}) >= MIN_SHARE * len(station_visits[k[0]])}
    dropped = sorted(f"{k[0]} {k[1]} {'+'.join(k[2])} #{k[3]} (n={len(o)})" for k, o in occ.items() if k not in kept)

    station_order = [s["id"] for s in catalogue["stations"]]
    station_order += sorted(set(station_visits) - set(station_order))

    def offset(vid, s):
        return s["start"] - visits[vid][0]["start"]

    keys = sorted(kept, key=lambda k: (station_order.index(k[0]),
                                       statistics.median(offset(vid, s) for vid, s in kept[k])))
    op_id = {k: f"G{i + 1:02d}" for i, k in enumerate(keys)}
    parts = {p["id"]: p for p in catalogue["parts"]}

    operations, evidence_ops = [], []
    for k in keys:
        station, verb, ps, nth = k
        durs = defaultdict(list)
        for vid, s in kept[k]:
            durs[visit_variant[vid]].append(s["end"] - s["start"])
        pooled = [d for ds in durs.values() for d in ds]
        time = {}
        for v in variants:
            ds = durs.get(v["id"]) or []
            if len(ds) >= 2:
                time[v["id"]] = {"mean": {"value": statistics.fmean(ds), "source": f"{src}: n={len(ds)} cycles"},
                                 "sd": {"value": statistics.stdev(ds), "source": f"{src}: n={len(ds)} cycles"}}
            else:
                m = statistics.fmean(ds or pooled)
                tag = f"{src}: n={len(ds)} cycles" if ds else f"{src}: pooled, no {v['id']} samples"
                time[v["id"]] = {"mean": {"value": m, "source": tag}, "sd": {"value": 0.15 * m, "source": "estimate"}}
        tools = [s.get("tool") for _, s in kept[k] if s.get("tool")]
        name = f"{verb} {' + '.join(parts[p]['name'] if p in parts else p for p in ps)}".strip()
        operations.append({
            "id": op_id[k], "name": name + (f" ({nth})" if nth > 1 else ""), "verb": verb, "parts": list(ps),
            "tool": statistics.mode(tools) if tools else TOOL_FOR_VERB.get(verb, "none"),
            "time": time, "station": station,
        })
        evidence_ops.append({"operation": op_id[k], "n": len(kept[k]), "cams": sorted({s["cam"] for _, s in kept[k]}),
                             "examples": [{"cam": s["cam"], "time": s["start"]} for _, s in kept[k][:3]]})

    edges, evidence_edges = _edges(keys, kept, op_id, visits, station_order)
    for o in overrides:
        for e in edges:
            if (e["from"], e["to"]) == (o["from"], o["to"]):
                e.update(type=o["type"], evidence="engineer", confidence=1.0)

    # Takt: median gap between units arriving at the first station.
    first = next(s for s in station_order if s in station_visits)
    starts = sorted(visits[vid][0]["start"] for vid in station_visits[first])
    gaps = [b - a for a, b in zip(starts, starts[1:])]
    takt = {"value": statistics.median(gaps) if gaps else 0.0, "source": f"{src}: n={len(starts)} units"}

    stations = []
    for i, st in enumerate(c for c in catalogue["stations"] if c["id"] in station_visits):
        stations.append({**st, "operations": [o["id"] for o in operations if o["station"] == st["id"]],
                         "staff": "human", "bufferBefore": 1, "bufferAfter": 1})

    line_variants = []
    for v in variants:
        ops = []
        for k in keys:
            vv = [vid for vid in station_visits[k[0]] if visit_variant[vid] == v["id"]]
            hit = {vid for vid, _ in kept[k] if visit_variant[vid] == v["id"]}
            # An unseen variant keeps every op (pooled times) and is flagged in the evidence.
            if not vv or len(hit) >= 0.5 * len(vv):
                ops.append(op_id[k])
        line_variants.append({**v, "operations": ops})

    line = {"id": f"{segments_doc.get('line', 'line')}_v2", "name": "Rebuilt from video", "takt": takt,
            "operations": operations, "edges": edges, "parts": catalogue["parts"], "stations": stations,
            "variants": line_variants, "levers": []}
    evidence = {"operations": evidence_ops, "edges": evidence_edges, "droppedClusters": dropped,
                "lowDataEdges": sum(1 for e in evidence_edges if e["review"]),
                "unobservedVariants": [v["id"] for v in variants if v["id"] not in visit_variant.values()],
                "unknownUnitSizes": unknown_sizes}
    return line, evidence


def _edges(keys, kept, op_id, visits, station_order):
    edges, evidence = [], []
    by_visit = defaultdict(dict)  # visit -> op -> segment
    for k in keys:
        for vid, s in kept[k]:
            by_visit[vid][op_id[k]] = s

    g = nx.DiGraph()
    g.add_nodes_from(op_id.values())
    for station in station_order:
        ops = [op_id[k] for k in keys if k[0] == station]
        for a, b in combinations(ops, 2):
            ab = ba = ov = 0
            ex = {"ab": [], "ba": []}
            for vid, segs in by_visit.items():
                if a in segs and b in segs:
                    sa, sb = segs[a], segs[b]
                    if sa["end"] <= sb["start"] + ORDER_TOL:
                        ab += 1
                        ex["ab"].append({"cam": sa["cam"], "time": sa["start"]})
                    elif sb["end"] <= sa["start"] + ORDER_TOL:
                        ba += 1
                        ex["ba"].append({"cam": sb["cam"], "time": sb["start"]})
                    else:
                        ov += 1
            n = ab + ba + ov
            if n == 0 or ov >= PARALLEL_SHARE * n:
                continue
            if ba > ab:
                a, b, ab, ba = b, a, ba, ab
                ex = {"ab": ex["ba"], "ba": ex["ab"]}
            minority = ba / (ab + ba)
            if ba and minority >= SOFT_MINORITY and n >= MIN_N:
                kind, conf, why = "soft", min(1.0, 2 * minority), "video_order_variance"
            else:
                # Same order every time, or too little data: default to hard (safe side).
                kind, conf, why = "hard", (ab + 1) / (ab + ba + 2), "video_order_variance"
            g.add_edge(a, b, type=kind, confidence=round(conf, 3), evidence=why)
            evidence.append({"from": a, "to": b, "type": kind, "n": n, "n_ab": ab, "n_ba": ba, "n_overlap": ov,
                             "scope": "within_station", "review": n < MIN_N,
                             "examples": {k: v[:3] for k, v in ex.items()}})

    # Across stations the conveyor forces the order, so video can't tell hard from soft.
    present = [s for s in station_order if any(k[0] == s for k in keys)]
    for s1, s2 in zip(present, present[1:]):
        sub1 = g.subgraph([op_id[k] for k in keys if k[0] == s1])
        sub2 = g.subgraph([op_id[k] for k in keys if k[0] == s2])
        for a in [n for n in sub1 if sub1.out_degree(n) == 0]:
            for b in [n for n in sub2 if sub2.in_degree(n) == 0]:
                g.add_edge(a, b, type="hard", confidence=0.5, evidence="estimate")
                evidence.append({"from": a, "to": b, "type": "hard", "scope": "cross_station", "review": False})

    # Break cycles at the weakest edge, preferring soft ones.
    while True:
        try:
            cycle = nx.find_cycle(g)
        except nx.NetworkXNoCycle:
            break
        weakest = min(cycle, key=lambda e: (g.edges[e[:2]]["type"] == "hard", g.edges[e[:2]]["confidence"]))
        g.remove_edge(*weakest[:2])

    hard = nx.DiGraph((u, v) for u, v, d in g.edges(data=True) if d["type"] == "hard")
    hard.add_nodes_from(g)
    reduced = nx.transitive_reduction(hard)
    for u, v, d in sorted(g.edges(data=True)):
        if d["type"] == "hard" and not reduced.has_edge(u, v):
            continue
        if d["type"] == "soft" and nx.has_path(hard, u, v):
            continue  # already implied by hard edges
        edges.append({"from": u, "to": v, **d})
    kept_pairs = {(e["from"], e["to"]) for e in edges}
    evidence = [e for e in evidence if (e["from"], e["to"]) in kept_pairs]
    return edges, evidence
