"""Per-station load and blocked/starved shares from line.json and the current event log."""

from collections import defaultdict

STATE_EVENTS = ("start", "end", "blocked", "starved")


def station_loads(line: dict) -> dict[str, float]:
    """Mix-weighted human load per station (all bays together), seconds per unit."""
    ops = {o["id"]: o for o in line["operations"]}
    return {s["id"]: sum(v["mix"]["value"] * ops[o]["time"][v["id"]]["mean"]["value"]
                         for v in line["variants"] for o in s["operations"] if o in v["operations"])
            for s in line["stations"]}


def state_shares(events: dict, t0: float) -> dict[str, dict[str, float]]:
    """Share of [t0, duration] each station spends blocked / starved, averaged over its bays.
    A station (or bay) is in the state of its last start/end/blocked/starved row."""
    t1 = events["duration"]
    state, since = {}, {}
    acc = defaultdict(lambda: defaultdict(float))  # (station, bay) -> state -> seconds
    for e in sorted(events["events"], key=lambda e: e["time"]):
        if e["event"] not in STATE_EVENTS:
            continue
        key = (e["station"], e.get("bay"))
        if key in state:
            a, b = max(since[key], t0), min(e["time"], t1)
            if b > a:
                acc[key][state[key]] += b - a
        state[key], since[key] = e["event"], e["time"]
    for key, st in state.items():
        a = max(since[key], t0)
        if t1 > a:
            acc[key][st] += t1 - a
    out = defaultdict(lambda: {"blocked": 0.0, "starved": 0.0, "n": 0})
    for (station, _), d in acc.items():
        o = out[station]
        o["blocked"] += d["blocked"] / (t1 - t0)
        o["starved"] += d["starved"] / (t1 - t0)
        o["n"] += 1
    return {s: {"blocked": o["blocked"] / o["n"], "starved": o["starved"] / o["n"]} for s, o in out.items()}


def build_stations(line: dict, events: dict, t0: float, n_top: int = 3) -> list[dict]:
    takt = line["takt"]["value"]
    loads = station_loads(line)
    shares = state_shares(events, t0)
    rows = []
    for i, s in enumerate(sorted(line["stations"], key=lambda s: (s["x"], s["y"], s["id"]))):
        bays = s.get("bays", 1)
        sh = shares.get(s["id"], {"blocked": 0.0, "starved": 0.0})
        rows.append({"id": s["id"], "name": s.get("name", s["id"]), "kind": s["kind"], "x": s["x"], "order": i,
                     "bays": bays, "load": round(loads[s["id"]] / bays, 2),
                     "loadRatio": round(loads[s["id"]] / (takt * bays), 4),
                     "blockedShare": round(sh["blocked"], 4), "starvedShare": round(sh["starved"], 4)})
    top = {r["id"] for r in sorted(rows, key=lambda r: -r["loadRatio"])[:n_top]}
    for r in rows:
        r["bottleneck"] = r["id"] in top or r["loadRatio"] > 1
    return rows
