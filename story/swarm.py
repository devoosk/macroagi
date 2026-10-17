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

import random

import networkx as nx

from capability import ROBOTS
from optimize.costs import HORIZON_MONTHS, HUMAN_STATION_COST, PEAK_TOLERANCE
from optimize.generator import Candidates, Option, candidates
from optimize.model import TIME_SCALE

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

    def score(self, design: dict, bays: dict | None = None, decouple=None) -> dict:
        c = self.c
        bays = bays or c.bays
        decouple = c.decouple.values() if decouple is None else decouple
        at = {}
        for o, (s, opt) in design.items():
            if s is not None:
                at.setdefault(s, []).append((o, opt))
        why = None
        for a, b in self.hard:
            sa, sb = design[a][0], design[b][0]
            if sa is not None and sb is not None and self.idx[sa] > self.idx[sb]:
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
            if s is not None and s != self.home[o] and o in c.moves:
                levers.add(c.moves[o])
        cost = sum(round(c.levers[lid].cost) for lid in levers)
        people = 0
        for s, t in staff.items():
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


def build_swarm(line: dict, solvers: list[tuple[str, dict]], floor: float, fleet=None,
                n_random: int = 1500, n_mut: int = 600, seed: int = 7) -> tuple[dict, list[str]]:
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
    for name, d in solvers:
        des, wc = design_from_file(d, line, floor, fleet)
        r = Scorer(line, wc).score(des)
        obj = d["design"]["objective"]["value"]
        log.append(f"{name}: cost {r['cost']} (solver objective {obj}) rate {r['rate']} people {r['people']} ok={r['ok']}")
        if not r["ok"]:
            raise SystemExit(f"{name} scores infeasible ({r['why']}): story scorer disagrees with optimize/model.py")
        winners.append({"design": d["id"], "file": name, "cost": r["cost"], "rate": r["rate"],
                        "people": r["people"], "solverObjective": obj})
        bases.append(des)

    rng = random.Random(seed)
    points = []
    for _ in range(n_random):
        points.append({**sc.score(random_design(rng, c, home)), "near": 0})
    for k, base in enumerate(bases, start=1):
        for _ in range(n_mut):
            points.append({**sc.score(mutate(rng, base, c)), "near": k})
    for w in winners:
        points.append({"cost": w["cost"], "rate": w["rate"], "people": w["people"], "ok": True, "why": None,
                       "near": 0, "winner": w["file"]})

    ok = [p for p in points if p["ok"] and "winner" not in p]
    best = min(w["cost"] for w in winners)
    cheaper = sum(p["cost"] < best for p in ok)
    log.append(f"{len(points)} points, {len(ok)} ok ({len(ok) / len(points):.0%}); "
               f"ok points cheaper than the best solver design: {cheaper}")
    for why in ("order", "mixed_station", "robot_type", "takt"):
        log.append(f"  why={why}: {sum(p['why'] == why for p in points)}")
    swarm = {"evaluated": len(points), "points": points, "current": cur, "winners": winners,
             "rateNote": RATE_NOTE, "seed": seed}
    return swarm, log
