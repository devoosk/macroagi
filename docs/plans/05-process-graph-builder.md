# Item 5: Process-graph builder (`graph/`) — implementation plan

Status: built (v0) against synthetic segments. Pairs seen fewer than 5 times stay hard (the plan's risks table) and are counted in `graph_evidence.json` `lowDataEdges` and flagged `review: true`. Variant fallback without `unit_size` is pooled times, not k-means. Item 3 has not defined `segments.json` yet, so the input shape below is a proposal to reconcile with item 3. The builder works from pixels only: `line.json` and `events_*.json` are read only by `graph/score.py` (scoring) and `graph/synth.py` (test input), never by the builder.

## Inputs

1. **`segments.json`** (owned by item 3; proposal):
   ```json
   { "line": "r290", "source": "vlm:<model> frames@1fps", "fps": 1,
     "segments": [ { "cam": "cctv:S01", "station": "S01", "start": 70.0, "end": 83.0,
       "verb": "place", "parts": ["P_base"], "visit": "S01#2", "unit_size": "small", "conf": 0.8 } ] }
   ```
   `station` comes from the camera, not the VLM. `visit` (one unit's stay at a station) is optional; without it, split a station's segments on idle gaps over 3 s. `unit_size` is optional. Units are linked across stations first-in first-out; rework visits are flagged and skipped for ordering.
2. **`catalogue.json`**: parts and variants only (the same vocabulary the VLM prompt gets; BOM/ERP data a plant would hand over). Extracted from `line.json` copying only `parts` and `variants`.

## Algorithm (`graph/build.py`)

1. **Clean.** Merge neighbouring same-label segments with gaps ≤ 1 s; drop segments under 1 s.
2. **Cluster into operations.** Key = (station, verb, sorted parts); repeats within one visit get ordinals. Keep clusters seen in ≥ 30% of visits. Ids `G01..` by station, then median start offset.
3. **Variant per visit.** Map `unit_size` by rank onto variants sorted by kW. Fallback: 1-D k-means on visit duration, tagged `source: "video: variant inferred from cycle time"`.
4. **Times.** Mean and sd of durations per op and variant, `source: "video: n=34 cycles (cctv:S01)"`. n < 2: sd = 15% of mean, `estimate`. Missing variant: pooled time with a source saying so.
5. **Pairwise order within a station.** For each pair seen in the same visit count a<b, b<a, overlap (±1 s).
   - Hard: same order every time and n ≥ 5; confidence (n_ab+1)/(n+2).
   - Soft: both orders seen, minority share ≥ 10%; majority direction; confidence = min(1, 2 × minority share); evidence `video_order_variance`.
   - n < 5: hard (the risks table: low confidence defaults to hard), flagged for review.
   - Overlap in ≥ 50% of visits: parallel, no edge.
6. **Across stations.** The conveyor forces the order, so video can't tell hard from soft. Emit last ops of station k → first ops of station k+1 as hard, confidence 0.5, evidence `estimate`. Known blind spot: cross-station soft edges; scored separately.
7. **Reduce.** networkx DiGraph; break cycles by dropping the weakest soft edge; transitive reduction of the hard subgraph; drop soft edges implied by a hard path.
8. **Emit `line_v2.json`** (Line schema): stations from cameras with ops from clusters, `staff: "human"`; takt = median gap between unit arrivals at the first station; parts/variants from the catalogue; variant ops = ops seen in ≥ 50% of that variant's visits; `levers: []`. Every number sourced, deterministic.
9. **Evidence sidecar** `graph_evidence.json` for the review screen.

CLI: `uv run python -m graph segments.json --catalogue catalogue.json -o app/public/data/line_v2.json [--overrides edge_overrides.json]`. Overrides (from the review screen) set `type`, `evidence: "engineer"`, confidence 1.

## Scoring (`graph/score.py`, the only reader of ground truth)

`uv run python -m graph.score line_v2.json app/public/data/line.json -o graph_score.json`
- Match ops with the Hungarian algorithm (scipy): cost = station mismatch + verb mismatch + (1 − parts Jaccard), accept cost ≤ 1.
- Op recall/precision, verb accuracy, time error per variant.
- Edge recall/precision on reduced edges and on transitive closures; hard/soft accuracy; **true hard predicted soft** reported separately (the dangerous error); within- vs cross-station split.

## Testing before item 3 lands (`graph/synth.py`)

`uv run python -m graph.synth events_current.json --seed 1 -o segments_synth.json` turns `op_start`/`op_end` into segments with noise: ±1 s jitter, 1 fps quantisation, 5% dropped, 5% mislabelled, 3% split; unit/variant dropped. The dummy log has too few units, so tests also build a seeded toy log (~40 units, 6 ops, known hard and soft edges, soft pairs shuffled per cycle).

Tests: noiseless input recovers every op and within-station edge; with noise op recall ≥ 0.9 and no true-hard-predicted-soft; low-n pairs come out hard; output has the Line shape; the builder never opens `line.json` or event logs.

## Review screen (app side, data only)

`graph_evidence.json` per edge: from, to, type, confidence, n, n_ab, n_ba, n_overlap, within/cross station, up to 3 `(cam, time)` examples per order. Per op: n, cams, example times, dropped noise clusters. The screen writes `edge_overrides.json` and the builder reruns.

## Steps (each a commit)

1. Skeleton, toy log and synth, test scaffold.
2. Clean, cluster, visits, variants, times.
3. Order stats, classification, reduction, Line and evidence output.
4. Scoring; run on synthetic segments.
5. Switch to item 3's real `segments.json`.

New dependency: `networkx`.

## Open questions (for item 3's owner)

- Does `segments.json` carry visits and unit size?
- Is a parts/variants catalogue acceptable as "pixels only plus BOM"?
- Can the VLM see the variant (units are scaled by kW in the render)?
- Where do station kind and x/y come from (camera registry)?
- Is the cross-station soft-edge blind spot acceptable for the demo?
