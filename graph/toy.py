"""A seeded toy line and event log with known hard and soft edges, for tests
until item 4's SimPy log lands. Soft pairs are reordered between cycles."""

import random


def _t(mean6: float, sd: float) -> dict:
    scale = {"V6": 1.0, "V9": 1.25, "V12": 1.5}
    return {v: {"mean": {"value": mean6 * k, "source": "estimate"}, "sd": {"value": sd, "source": "estimate"}}
            for v, k in scale.items()}


def _op(i, name, verb, parts, tool, station, mean6, sd=1.0):
    return {"id": i, "name": name, "verb": verb, "parts": parts, "tool": tool, "time": _t(mean6, sd), "station": station}


def _part(i, presentation="tray"):
    return {"id": i, "name": i, "size": [0.1, 0.1, 0.1], "mass": {"value": 1, "source": "estimate"},
            "rigidity": "rigid", "tolerance": "medium", "presentation": presentation}


def _edge(a, b, kind):
    return {"from": a, "to": b, "type": kind, "confidence": 1, "evidence": "estimate"}


def toy_line() -> dict:
    ops = [
        _op("T1", "Place base", "place", ["P_base"], "none", "S01", 10),
        _op("T2", "Screw feet", "screw", ["P_screw"], "torque_driver", "S01", 12),
        _op("T3", "Insert grommet", "insert", ["P_grommet"], "none", "S01", 8),
        _op("T4", "Braze pipe", "braze", ["P_pipe"], "torch", "S02", 15),
        _op("T6", "Connect cable", "connect", ["P_cable"], "crimper", "S02", 9),
        _op("T5", "Scan label", "inspect", [], "scanner", "S02", 5),
        _op("T7", "Leak test", "inspect", [], "hose", "S03", 25),
    ]
    edges = [
        _edge("T1", "T2", "hard"), _edge("T1", "T3", "hard"), _edge("T2", "T3", "soft"),
        _edge("T3", "T4", "hard"), _edge("T4", "T5", "hard"), _edge("T6", "T5", "hard"),
        _edge("T4", "T6", "soft"), _edge("T5", "T7", "hard"),
    ]
    stations = [
        {"id": f"S0{i}", "name": n, "kind": k, "operations": [o["id"] for o in ops if o["station"] == f"S0{i}"],
         "staff": "human", "x": 4 * (i - 1), "y": 0, "rot": 0, "bufferBefore": 1, "bufferAfter": 1}
        for i, (n, k) in enumerate([("Base", "base_frame"), ("Brazing", "brazing"), ("Leak test", "evacuation_leak_test")], 1)
    ]
    variants = [{"id": v, "name": f"{kw} kW", "kw": kw, "mix": {"value": m, "source": "estimate"},
                 "operations": [o["id"] for o in ops]} for v, kw, m in (("V6", 6, 0.4), ("V9", 9, 0.4), ("V12", 12, 0.2))]
    parts = [_part(p) for p in ("P_base", "P_screw", "P_grommet", "P_pipe", "P_cable")]
    return {"id": "toy", "name": "Toy line", "takt": {"value": 60, "source": "estimate"}, "operations": ops,
            "edges": edges, "parts": parts, "stations": stations, "variants": variants, "levers": []}


def toy_events(line: dict, units: int = 40, seed: int = 1) -> dict:
    rng = random.Random(seed)
    ops = {o["id"]: o for o in line["operations"]}
    hard = [(e["from"], e["to"]) for e in line["edges"] if e["type"] == "hard"]
    variants = [v["id"] for v in line["variants"]]
    weights = [v["mix"]["value"] for v in line["variants"]]
    free = {s["id"]: 0.0 for s in line["stations"]}
    events = []
    for n in range(units):
        unit, variant = f"U{n + 1:03d}", rng.choices(variants, weights)[0]
        t = n * line["takt"]["value"]
        for st in line["stations"]:
            sid = st["id"]
            t = max(t, free[sid])
            events.append({"unit": unit, "variant": variant, "station": sid, "event": "start", "time": t})
            todo = list(st["operations"])
            while todo:  # random order that respects hard edges within the station
                ready = [o for o in todo if not any(b == o and a in todo for a, b in hard)]
                o = rng.choice(ready)
                todo.remove(o)
                tm = ops[o]["time"][variant]
                d = max(1.0, rng.gauss(tm["mean"]["value"], tm["sd"]["value"]))
                events.append({"unit": unit, "variant": variant, "station": sid, "event": "op_start", "operation": o, "time": t})
                t += d
                events.append({"unit": unit, "variant": variant, "station": sid, "event": "op_end", "operation": o, "time": t})
            events.append({"unit": unit, "variant": variant, "station": sid, "event": "end", "time": t})
            free[sid] = t
            t += 5  # conveyor
    events.sort(key=lambda e: e["time"])
    return {"line": line["id"], "seed": seed, "duration": max(e["time"] for e in events), "events": events}
