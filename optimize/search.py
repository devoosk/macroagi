"""Solve each lever bundle, keep the best distinct designs."""

from .generator import BUNDLES, Candidates, candidates
from .model import Solution, solve


def _key(sol: Solution) -> tuple:
    levers = sorted((o, opt.levers) for o, opt in sol.choice.items() if opt.levers)
    return tuple(sol.robot_stations), tuple(levers), tuple(sorted(sol.station.items(), key=str))


def _changes_line(line: dict, sol: Solution) -> bool:
    return bool(sol.robot_stations) or any(opt.mode != "human" for opt in sol.choice.values()) or any(
        sol.station[o["id"]] != o["station"] for o in line["operations"])


def best_designs(line: dict, floor: float, n: int = 3) -> list[tuple[Candidates, Solution]]:
    found: dict[tuple, tuple[Candidates, Solution]] = {}
    for bundle in BUNDLES:
        c = candidates(line, bundle, floor)
        sol = solve(line, c)
        if sol and _changes_line(line, sol) and _key(sol) not in found:
            found[_key(sol)] = (c, sol)
    ranked = sorted(found.values(), key=lambda cs: (cs[1].objective, cs[1].bundle))
    if not ranked:
        return []
    # Too few distinct designs: ask the richest bundle for different robot-station sets.
    c = candidates(line, list(BUNDLES)[-1], floor)
    forbid = [set(s.robot_stations) for _, s in ranked]
    while len(ranked) < n:
        sol = solve(line, c, forbid)
        if sol is None or not _changes_line(line, sol):
            break
        forbid.append(set(sol.robot_stations))
        ranked.append((c, sol))
    ranked.sort(key=lambda cs: (cs[1].objective, cs[1].bundle))
    return ranked[:n]
