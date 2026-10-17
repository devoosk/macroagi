"""A real design sampler for the swarm shot: random designs and mutations of the three
solver designs, each scored with the rules of optimize/model.py.

A design is {op: (station | None, Option)}. Rules, checked in this order (first one
violated is `why`): hard precedence over the transitive closure, eliminated ops exempt
("order"); a station is all-human or all-robot ("mixed_station") of one robot type
("robot_type"); mixed-model takt per station: every variant <= takt x peak tolerance x bays
and the mix-weighted load <= takt x bays ("takt"). Mobile-robot sharing is ignored.
Cost is the solver objective: human station cost per bay + (robot rent x horizon months +
integration) per bay + every lever used, each paid once (decouple always, regroup when an
op leaves its station).
"""

import math
import random

import networkx as nx

from capability import ROBOTS
from optimize.costs import HORIZON_MONTHS, HUMAN_STATION_COST, PEAK_TOLERANCE
from optimize.generator import Candidates, Option, candidates
from optimize.model import TIME_SCALE
from optimize.rebuild import BAY_COST, MAX_BAYS, fixed_groups

RATE_NOTE = ("units/h capacity proxy: min over used stations of 3600 x bays / mix-weighted station load "
             "(no cap at 3600/takt; ignores blocking, starving and robot failures)")


class Scorer:
    def __init__(self, line: dict, c: Candidates):
        self.line, self.c = line, c
        self.idx = {s: i for i, s in enumerate(c.stations)}
        ops = {o["id"] for o in line["operations"]}
        self.hard = sorted(nx.transitive_closure(nx.DiGraph(
            [(e["from"], e["to"]) for e in line["edges"] if e["type"] == "hard" and e["from"] in ops and e["to"] in ops])).edges)
        self.home = {o["id"]: o["station"] for o in line["operations"]}
        self.takt = round(line["takt"]["value"] * TIME_SCALE)
        self.peak = round(line["takt"]["value"] * PEAK_TOLERANCE["value"] * TIME_SCALE)
        self.mix = {v["id"]: round(v["mix"]["value"] * 1000) for v in line["variants"]}
        self.mixf = {v["id"]: v["mix"]["value"] for v in line["variants"]}
        self.var_ops = {v["id"]: set(v["operations"]) for v in line["variants"]}
        self.unit = {t: round(ROBOTS[t]["rentPerMonth"] * HORIZON_MONTHS + ROBOTS[t]["integration"]) for t in ROBOTS}
        self.groups = fixed_groups(line)

    def score_rebuild(self, rb: tuple[dict, dict, list[str]]) -> dict:
        design, bays, order = rb
        return self.score(design, bays, order=order, rebuild=True)

    def score(self, design: dict, bays: dict | None = None, decouple=None, order: list[str] | None = None,
              rebuild: bool = False) -> dict:
        """order: station ids in line order (default: the line's stations). rebuild=True uses
        optimize/rebuild.py's cost rules: each extra bay costs BAY_COST, no decouple/regroup
        levers, and fixed-equipment groups must sit alone in one station each ("order")."""
        c = self.c
        idx = {s: i for i, s in enumerate(order)} if order else self.idx
        bays = bays or c.bays
        decouple = () if rebuild else c.decouple.values() if decouple is None else decouple
        at = {}
        for o, (s, opt) in design.items():
            if s is not None:
                at.setdefault(s, []).append((o, opt))
        why = None
        for a, b in self.hard:
            sa, sb = design[a][0], design[b][0]
            if sa is not None and sb is not None and idx[sa] > idx[sb]:
                why = "order"
                break
        if rebuild and why is None:
            for g in self.groups:
                s = {design[o][0] for o in g}
                if len(s) > 1 or None in s or len(at[next(iter(s))]) != len(g):
                    why = "order"
                    break
        staff = {}
        for s, lst in at.items():
            modes = {opt.mode for _, opt in lst}
            robots = {opt.robot for _, opt in lst if opt.mode == "robot"}
            if why is None and len(modes) > 1:
                why = "mixed_station"
            if why is None and len(robots) > 1:
                why = "robot_type"
            staff[s] = sorted(robots)[0] if "robot" in modes and "human" not in modes else None
        rate = float("inf")
        for s, lst in at.items():
            load = {v: sum(round(opt.time.get(v, 0) * TIME_SCALE) for o, opt in lst if o in self.var_ops[v])
                    for v in self.mix}
            if why is None and (any(x > self.peak * bays[s] for x in load.values())
                                or sum(self.mix[v] * x for v, x in load.items()) > self.takt * bays[s] * sum(self.mix.values())):
                why = "takt"
            avg = sum(self.mixf[v] * x for v, x in load.items()) / TIME_SCALE
            if avg > 0:
                rate = min(rate, 3600 * bays[s] / avg)
        levers = set(decouple)
        for o, (s, opt) in design.items():
            levers.update(opt.levers)
            if not rebuild and s is not None and s != self.home[o] and o in c.moves:
                levers.add(c.moves[o])
        if rebuild:
            levers = {lid for lid in levers if c.levers[lid].type not in ("regroup", "decouple")}
        cost = sum(round(c.levers[lid].cost) for lid in levers)
        people = 0
        for s, t in staff.items():
            if rebuild:
                cost += round(BAY_COST["value"]) * (bays[s] - 1)
            if t is None:
                cost += round(HUMAN_STATION_COST["value"] * bays[s])
                people += bays[s]
            else:
                cost += self.unit[t] * bays[s]
        return {"cost": cost, "rate": round(rate, 2), "people": people, "ok": why is None, "why": why}


def design_from_file(d: dict, line: dict, floor: float, fleet=None) -> tuple[dict, Candidates]:
    """A solver design (line_solver_<n>.json) as {op: (station, Option)} on its own bundle's options."""
    c = candidates(line, d["design"]["bundle"], floor, fleet)
    robot = {s["id"]: s.get("robot") for s in d["stations"]}
    out = {}
    for op in d["operations"]:
        mode = op["mode"]
        st = None if mode == "eliminated" else op["station"]
        want = robot.get(st) if mode == "robot" else None
        opt = next(x for x in c.options[op["id"]] if x.mode == mode and x.robot == want)
        out[op["id"]] = (st, opt)
    return out, c


def _pick(rng: random.Random, opts: list[Option], staff) -> Option:
    elim = [o for o in opts if o.mode == "eliminated"]
    if elim:
        return elim[0]
    fit = [o for o in opts if (o.mode == "human" if staff is None else o.robot == staff)]
    return rng.choice(fit) if fit and rng.random() < 0.9 else rng.choice(opts)


def random_design(rng: random.Random, c: Candidates, home: dict) -> dict:
    staff = {s: None if rng.random() < 0.5 else rng.choice(c.fleet) for s in c.stations}
    out = {}
    for o, opts in c.options.items():
        allowed = c.allowed[o]
        st = home[o] if rng.random() < 0.6 or len(allowed) == 1 else rng.choice(allowed)
        opt = _pick(rng, opts, staff[st])
        out[o] = (None if opt.mode == "eliminated" else st, opt)
    return out


def mutate(rng: random.Random, base: dict, c: Candidates) -> dict:
    d = dict(base)
    for _ in range(rng.choice([1, 1, 2, 2, 3, 4])):
        if rng.random() < 0.5:  # restaff a whole station
            s = rng.choice(c.stations)
            staff = None if rng.random() < 0.4 else rng.choice(c.fleet)
            for o, (st, _) in list(d.items()):
                if st == s:
                    d[o] = (s, _pick(rng, c.options[o], staff))
        else:  # move or re-option one op
            o = rng.choice(sorted(c.options))
            if not any(x.mode != "eliminated" for x in c.options[o]):
                continue
            st = rng.choice(c.allowed[o])
            opt = rng.choice([x for x in c.options[o] if x.mode != "eliminated"])
            d[o] = (st, opt)
    return d


def rebuild_from_file(d: dict, c: Candidates) -> tuple[dict, dict, list[str]]:
    """line_rebuild_<n>.json as (design, bays, station order) on the B4 options (rebuild uses the same)."""
    st = {s["id"]: s for s in d["stations"] if not s.get("offline")}
    order = sorted(st, key=lambda s: (st[s]["x"], s))
    out = {}
    for op in d["operations"]:
        mode = op["mode"]
        s = None if mode == "eliminated" else op["station"]
        want = st[s].get("robot") if mode == "robot" else None
        out[op["id"]] = (s, next(x for x in c.options[op["id"]] if x.mode == mode and x.robot == want))
    return out, {s: st[s].get("bays", 1) for s in order}, order


def _bays_needed(sc: Scorer, lst: list[tuple[str, Option]]) -> int:
    load = {v: sum(round(opt.time.get(v, 0) * TIME_SCALE) for o, opt in lst if o in sc.var_ops[v]) for v in sc.mix}
    avg = sum(sc.mix[v] * x for v, x in load.items())
    return max(1, math.ceil(avg / (sc.takt * sum(sc.mix.values()))), math.ceil(max(load.values()) / sc.peak))


def _staff_slot(rng: random.Random, c: Candidates, ops: list[str]):
    """Human, or a robot type every op in the slot can use (sometimes any type, to explore)."""
    fits = [t for t in c.fleet if all(any(x.robot == t for x in c.options[o]) for o in ops)]
    if fits and rng.random() < 0.6:
        return rng.choice(fits)
    return rng.choice(c.fleet) if rng.random() < 0.1 else None


def _fill_slot(rng, sc, c, design, bays, sid, ops, staff):
    for o in ops:
        design[o] = (sid, _pick(rng, c.options[o], staff))
    need = _bays_needed(sc, [(o, design[o][1]) for o in ops])
    bays[sid] = min(need, MAX_BAYS) if rng.random() < 0.85 else rng.randint(1, MAX_BAYS)


def random_rebuild(rng: random.Random, sc: Scorer, c: Candidates) -> tuple[dict, dict, list[str]]:
    """Random linear extension of the hard DAG (fixed-equipment groups contracted), cut into
    6-16 slots; each fixed group is a slot of its own. Sometimes one op is swapped to a random
    slot, which can break order or staffing."""
    elim = {o for o, opts in c.options.items() if all(x.mode == "eliminated" for x in opts)}
    rep = {o: g[0] for g in sc.groups for o in g}
    group = {g[0]: g for g in sc.groups}
    nodes = sorted({rep.get(o, o) for o in c.options if o not in elim})
    g = nx.DiGraph()
    g.add_nodes_from(nodes)
    g.add_edges_from((rep.get(a, a), rep.get(b, b)) for a, b in sc.hard
                     if a not in elim and b not in elim and rep.get(a, a) != rep.get(b, b))
    indeg = {n: g.in_degree(n) for n in nodes}
    ready, topo = sorted(n for n in nodes if indeg[n] == 0), []
    while ready:
        n = ready.pop(rng.randrange(len(ready)))
        topo.append(n)
        for m in sorted(g.successors(n)):
            indeg[m] -= 1
            if indeg[m] == 0:
                ready.append(m)
    n_free = sum(1 for n in topo if n not in group)
    target = rng.randint(6, 16) - len(group)
    p_close = min(1.0, max(0.05, target / max(n_free, 1)))
    slots, cur = [], []
    for n in topo:
        if n in group:
            if cur:
                slots.append(cur)
                cur = []
            slots.append(list(group[n]))
        else:
            cur.append(n)
            if rng.random() < p_close:
                slots.append(cur)
                cur = []
    if cur:
        slots.append(cur)
    design = {o: (None, c.options[o][0]) for o in elim}
    bays, order = {}, []
    for i, ops in enumerate(slots, start=1):
        sid = f"R{i:02d}"
        order.append(sid)
        _fill_slot(rng, sc, c, design, bays, sid, ops, _staff_slot(rng, c, ops))
    if rng.random() < 0.15:
        o = rng.choice(sorted(o for o in design if design[o][0] is not None))
        s = rng.choice(order)
        design[o] = (s, design[o][1])
    return design, bays, order


def mutate_rebuild(rng: random.Random, base: tuple, sc: Scorer, c: Candidates) -> tuple[dict, dict, list[str]]:
    design, bays, order = dict(base[0]), dict(base[1]), list(base[2])
    fixed = {o for g in sc.groups for o in g}
    for _ in range(rng.choice([1, 1, 2, 2, 3])):
        at = {s: [o for o, (st, _) in design.items() if st == s] for s in order}
        free = [s for s in order if at[s] and not set(at[s]) & fixed]
        r = rng.random()
        if r < 0.35 and free:  # restaff a slot
            s = rng.choice(free)
            _fill_slot(rng, sc, c, design, bays, s, at[s], _staff_slot(rng, c, at[s]))
        elif r < 0.6:  # move one op to a neighbouring slot
            movable = sorted(o for o, (st, _) in design.items() if st is not None and o not in fixed)
            o = rng.choice(movable)
            i = order.index(design[o][0]) + rng.choice([-1, 1])
            if 0 <= i < len(order):
                design[o] = (order[i], design[o][1])
        elif r < 0.8:  # change bays
            s = rng.choice(order)
            bays[s] = min(MAX_BAYS, max(1, bays[s] + rng.choice([-1, 1])))
        else:  # merge two neighbouring free slots
            pairs = [(a, b) for a, b in zip(order, order[1:]) if a in free and b in free]
            if pairs:
                a, b = rng.choice(pairs)
                staff = next((x.robot for o in at[a] for x in [design[o][1]] if x.mode == "robot"), None)
                _fill_slot(rng, sc, c, design, bays, a, at[a] + at[b], staff)
                order.remove(b)
    return design, bays, order


def build_swarm(line: dict, solvers: list[tuple[str, dict]], floor: float, fleet=None,
                n_random: int = 1500, n_mut: int = 600, seed: int = 7,
                rebuild: tuple[str, dict] | None = None, n_rebuild: int = 250) -> tuple[dict, list[str]]:
    c = candidates(line, "B4", floor, fleet)
    sc = Scorer(line, c)
    home = sc.home
    log = []

    cur_c = candidates(line, "B0", floor, fleet)
    current = {o: (home[o], next(x for x in cur_c.options[o] if x.mode == "human")) for o in home}
    cur_bays = {s["id"]: s.get("bays", 1) for s in line["stations"]}
    cur = Scorer(line, cur_c).score(current, cur_bays, [])
    log.append(f"current line: cost {cur['cost']} rate {cur['rate']} people {cur['people']} ok={cur['ok']} ({cur['why']})")

    winners, bases = [], []
    rb_base = None
    if rebuild is not None:
        name, d = rebuild
        rb_base = rebuild_from_file(d, c)
        r = sc.score_rebuild(rb_base)
        obj = d["design"]["objective"]["value"]
        log.append(f"{name}: cost {r['cost']} (rebuild objective {obj}) rate {r['rate']} people {r['people']} ok={r['ok']}")
        if not r["ok"]:
            raise SystemExit(f"{name} scores infeasible ({r['why']}): story scorer disagrees with optimize/rebuild.py")
        winners.append({"design": d["id"], "file": name, "cost": r["cost"], "rate": r["rate"],
                        "people": r["people"], "solverObjective": obj, "mode": "rebuild"})
    for name, d in solvers:
        des, wc = design_from_file(d, line, floor, fleet)
        r = Scorer(line, wc).score(des)
        obj = d["design"]["objective"]["value"]
        log.append(f"{name}: cost {r['cost']} (solver objective {obj}) rate {r['rate']} people {r['people']} ok={r['ok']}")
        if not r["ok"]:
            raise SystemExit(f"{name} scores infeasible ({r['why']}): story scorer disagrees with optimize/model.py")
        winners.append({"design": d["id"], "file": name, "cost": r["cost"], "rate": r["rate"],
                        "people": r["people"], "solverObjective": obj, "mode": "rebalance"})
        bases.append(des)

    rng = random.Random(seed)
    points = []
    for _ in range(n_random):
        points.append({**sc.score(random_design(rng, c, home)), "near": 0})
    for k, base in enumerate(bases, start=1):
        for _ in range(n_mut):
            points.append({**sc.score(mutate(rng, base, c)), "near": k})
    if rb_base is not None:  # rebuild space: open station count, order and staffing
        for _ in range(n_rebuild):
            points.append({**sc.score_rebuild(random_rebuild(rng, sc, c)), "near": 4})
        for _ in range(n_rebuild):
            points.append({**sc.score_rebuild(mutate_rebuild(rng, rb_base, sc, c)), "near": 4})
    for i, w in enumerate(winners):
        points.append({"cost": w["cost"], "rate": w["rate"], "people": w["people"], "ok": True, "why": None,
                       "near": 0, "winner": i})

    ok = [p for p in points if p["ok"] and "winner" not in p]
    best = min(w["cost"] for w in winners)
    cheaper = sum(p["cost"] < best for p in ok)
    log.append(f"{len(points)} points, {len(ok)} ok ({len(ok) / len(points):.0%}); "
               f"ok points cheaper than the best winner: {cheaper}; "
               f"rebuild-space points {sum(p['near'] == 4 for p in points)} "
               f"({sum(p['near'] == 4 and p['ok'] for p in points)} ok)")
    for why in ("order", "mixed_station", "robot_type", "takt"):
        log.append(f"  why={why}: {sum(p['why'] == why for p in points)}")
    swarm = {"evaluated": len(points), "points": points, "current": cur, "winners": winners,
             "rateNote": RATE_NOTE, "seed": seed}
    return swarm, log
