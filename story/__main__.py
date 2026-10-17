"""uv run python -m story [--data app/public/data] [-o app/public/data/story.json]

Builds story.json for the 60-second demo from line.json, events_current.json,
line_solver_{1,2,3}.json and results.json. Read-only on everything else.
"""

import argparse
import json
from pathlib import Path

from optimize.costs import FLOOR, HORIZON_MONTHS, HUMAN_STATION_COST, PEAK_TOLERANCE
from simulate.params import WARMUP

from .graph_story import build_graph
from .stations import build_stations
from .swarm import RATE_NOTE, build_swarm

GRAPH_SEED = 1
SWARM_SEED = 7


def build_story(data: Path) -> tuple[dict, list[str]]:
    line = json.loads((data / "line.json").read_text())
    events = json.loads((data / "events_current.json").read_text())
    results = json.loads((data / "results.json").read_text())
    solvers = [(f"line_solver_{i}.json", json.loads((data / f"line_solver_{i}.json").read_text())) for i in (1, 2, 3)]
    t0 = float(WARMUP)

    stations = build_stations(line, events, t0)
    graph, sparks, meta = build_graph(events, line, t0, GRAPH_SEED)
    rb_path = data / "line_rebuild_1.json"
    rebuild = (rb_path.name, json.loads(rb_path.read_text())) if rb_path.exists() else None
    swarm, log = build_swarm(line, solvers, FLOOR["value"], seed=SWARM_SEED, rebuild=rebuild)
    sim = {d["design"]: d for d in results["designs"]}
    for w in swarm["winners"]:
        if w["design"] in sim and "throughput" in sim[w["design"]]:
            w["simThroughput"] = sim[w["design"]]["throughput"]["value"]
    if line["id"] in sim:
        swarm["current"]["simThroughput"] = sim[line["id"]]["throughput"]["value"]

    ev = f"events_current.json (seed {events.get('seed')}), window t >= {t0:.0f} s (simulate/params.py WARMUP)"
    sources = {
        "takt": f"line.json takt ({line['takt']['source']})",
        "stations.load": "line.json: sum over the station's ops of variant mix x human mean time, divided by bays",
        "stations.loadRatio": "line.json: mix-weighted station load / (takt x bays)",
        "stations.blockedShare": f"{ev}: time in the last start/end/blocked/starved state, averaged over bays",
        "stations.starvedShare": f"{ev}: as blockedShare",
        "stations.bottleneck": "top 3 stations by loadRatio, plus any with loadRatio > 1",
        "stations.x": "line.json station x (m)",
        "sparks": f"graph.synth noisy segments ({meta['segmentsSource']}) from {ev}; t = (start - {t0:.0f}) / "
                  f"({meta['window'][1]:.0f} - {t0:.0f}); node = graph.build's own cluster assignment",
        "graph.nodes": "graph.build on the synthetic segments (catalogue = parts, variants, stations of line.json); "
                       "meanTime/cv/n over the segments in each cluster",
        "graph.nodes.gx": "longest-path layer over hard + soft edges, normalised to [0, 1]",
        "graph.nodes.gy": "position within the layer, ordered by station then median offset in the visit",
        "graph.nodes.hx": "as gx/gy but layered over hard edges only, so reorderable (soft) ops share a layer",
        "graph.edges": "line_v2 edges from graph.build; nab/nba = visits seen in each order (within station only); "
                       "redundant = within-station pairs seen in order that the builder dropped as implied",
        "graph.score": "graph.score against the hidden line.json",
        "swarm.points": f"story/swarm.py sampler (seed {SWARM_SEED}): random designs on optimize.generator "
                        f"candidates(line, 'B4', floor {FLOOR['value']}) plus 1-4-step mutations of line_solver_1..3 "
                        "(near 1-3); near 4 = rebuild space (optimize/rebuild.py rules: open station count and "
                        "order, 1-3 bays, fixed equipment alone): random layouts and mutations of line_rebuild_1",
        "swarm.winners": "winner 0 = line_rebuild_1.json (optimize.rebuild), 1-3 = line_solver_1..3.json "
                         "(optimize rebalance); cost re-scored here and equal to each design's objective",
        "swarm.cost": f"solver objective, EUR over 3 years: {HUMAN_STATION_COST['value']} per human bay "
                      f"({HUMAN_STATION_COST['source']}) + robot rent x {HORIZON_MONTHS} months + integration "
                      "(capability/robots.json, estimate) per bay + lever costs once (line.json levers, estimate); "
                      "rebuild-space designs pay optimize.rebuild BAY_COST per extra bay instead of decouple/regroup",
        "swarm.rate": RATE_NOTE,
        "swarm.people": "human bays in used stations",
        "swarm.ok": f"optimize/model.py rules: hard precedence (transitive), one staffing per station, mixed-model "
                    f"takt with peak tolerance {PEAK_TOLERANCE['value']} ({PEAK_TOLERANCE['source']}); "
                    "mobile-robot sharing ignored",
        "swarm.winners.simThroughput": "results.json throughput (simulate/ SimPy)",
    }
    story = {"sources": sources, "takt": line["takt"]["value"], "stations": stations, "sparks": sparks,
             "graph": graph, "swarm": swarm}
    log = [f"stations {len(stations)}, bottlenecks {[s['id'] for s in stations if s['bottleneck']]}",
           f"sparks {len(sparks)}, nodes {len(graph['nodes'])}, edges {len(graph['edges'])} "
           f"({sum(e['redundant'] for e in graph['edges'])} redundant)", *log]
    return story, log


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m story")
    p.add_argument("--data", type=Path, default=Path("app/public/data"))
    p.add_argument("-o", "--out", type=Path)
    a = p.parse_args()
    story, log = build_story(a.data)
    out = a.out or a.data / "story.json"
    out.write_text(json.dumps(story, separators=(",", ":")) + "\n")
    for line in log:
        print(line)
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
