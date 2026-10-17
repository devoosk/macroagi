"""CLI: python -m simulate [--design current|redesign] [--sweep] (run from the repo root)."""

from __future__ import annotations

import argparse
import time
from dataclasses import replace
from pathlib import Path

from . import params as P
from .line import load
from .output import upsert_design, write_event_log
from .reliability import describe, op_reliability
from .simulate import SimOptions, SimResult, simulate
from .sweep import required_reliability, sweep
from .validate import validate

DATA = Path('app/public/data')


def pct(x: float) -> str:
    return f'{x * 100:6.1f}%'


def sanity_table(title: str, r: SimResult) -> None:
    print(f'\n== {title} ==')
    print('station  name                      bays   util  blocked  starved  cycles')
    for s in r.stats:
        print(f'{s.id:<8} {s.name[:25]:<25} {s.bays:>4} {pct(s.utilisation)} {pct(s.blocked)} {pct(s.starved)} {s.cycles:>7}')
    print(
        f'throughput: {r.throughput_per_hour:.2f} units/h  '
        f'(completed {r.completed}, test failures {r.failures}, robot failures {r.robot_failures})'
    )


def main() -> None:
    ap = argparse.ArgumentParser(prog='python -m simulate')
    ap.add_argument('--design', choices=['current', 'redesign'], default='current')
    ap.add_argument('--line', type=Path, help='line JSON (default: line.json or line_redesign_1.json)')
    ap.add_argument('--base-line', type=Path, default=DATA / 'line.json', help='current line, for human fallback times')
    ap.add_argument('--out', type=Path, default=DATA)
    ap.add_argument('--events', help='event log file name (default: events_<design>.json)')
    ap.add_argument('--seed', type=int, default=P.LOG_SEED)
    ap.add_argument('--sweep', action='store_true', help='run the reliability sweep and update results.json')
    ap.add_argument('--shifts', type=int, default=P.SWEEP_SHIFTS)
    ap.add_argument('--processes', type=int)
    args = ap.parse_args()

    current = args.design == 'current'
    line_path = args.line or DATA / ('line.json' if current else 'line_redesign_1.json')
    line = load(line_path)
    if current:
        robot = {
            'robot_stations': P.NAIVE_ROBOT['robot_stations'],
            'fail_multiplier': P.NAIVE_ROBOT['fail_multiplier']['value'],
            'recovery': P.NAIVE_ROBOT['recovery']['value'],
        }
        robot_note = (
            f"naive robots dropped into {'/'.join(robot['robot_stations'])} without fixtures or fallback "
            f"({robot['fail_multiplier']:g}x failure rate, {robot['recovery']:g} s recovery)"
        )
        log_opts = SimOptions(seed=args.seed, duration=P.LOG_DURATION, warmup=P.WARMUP)
        events_name = args.events or 'events_current.json'
    else:
        base = load(args.base_line)
        robot = {
            'fail_multiplier': P.REDESIGN_ROBOT['fail_multiplier']['value'],
            'recovery': P.REDESIGN_ROBOT['recovery']['value'],
            'human_ops': base.operations,
        }
        robots = [st for st in line.chain if st.staff == 'robot']
        if all(st.fallback for st in robots):
            robot_note = f"human fallback station per robot cell ({robot['recovery']:g} s robot reset)"
        else:
            missing = '/'.join(st.id for st in robots if not st.fallback)
            robot_note = f"no fallback station at {missing}: the cell stops {robot['recovery']:g} s per failure"
            print(f'warning: {robot_note}')
        shared = [f'{st.id}+{st.shared_with}' for st in robots if st.shared_with]
        if shared:
            print(f"warning: shared mobile robots ({', '.join(shared)}) are simulated as one robot per station")
        predicted = op_reliability(line)
        log_opts = SimOptions(
            seed=args.seed, duration=P.LOG_DURATION, warmup=P.WARMUP, op_reliability=predicted, **robot
        )
        events_name = args.events or line_path.name.replace('line_', 'events_', 1)

    r = simulate(line, log_opts)
    problems = validate(r.log, line)
    if problems:
        raise SystemExit('event log failed validation:\n  ' + '\n  '.join(problems[:20]))
    path = write_event_log(args.out / events_name, r.log)
    sanity_table(f'{line.id} (seed {args.seed}, {P.WARMUP}s warm-up + {P.LOG_DURATION - P.WARMUP}s)', r)
    print(f'events: {len(r.log["events"])} -> {path}')

    if not args.sweep:
        return
    shift = SimOptions(seed=0, duration=P.WARMUP + P.SHIFT['value'], warmup=P.WARMUP, record=False)
    hours = P.SHIFT['value'] / 3600
    t0 = time.time()
    if current:
        # The current line as it runs today has no robots: its throughput is the mean over all shifts.
        base_pt = sweep(line, shift, [1.0], args.shifts, processes=args.processes)[0]
        tp = base_pt['throughput']
        tp['source'] = tp['source'] + ', as staffed today (no robots)'
    points = sweep(
        line,
        replace(shift, **robot),
        shifts=args.shifts,
        processes=args.processes,
        source=f'simulate/ SimPy: mean of {args.shifts} x {hours:g} h shifts, seeds '
        f'{P.SWEEP_SEED0}-{P.SWEEP_SEED0 + args.shifts - 1}, {robot_note}',
    )
    if not current:
        # Throughput at the success rates the capability model predicts for each robot op.
        pred = sweep(line, replace(shift, op_reliability=predicted, **robot), [1.0], args.shifts, processes=args.processes)[0]
        tp = pred['throughput']
        tp['source'] = tp['source'] + f', {robot_note}, {describe(line)}'
    req = required_reliability(points)
    print(f'\nreliability sweep ({args.shifts} shifts x {len(points)} points, {time.time() - t0:.1f}s)')
    print('  r        throughput   95% CI')
    for p in points:
        lo, hi = p['ci95']
        print(f"  {p['reliability']:.3f}   {p['throughput']['value']:8.2f}   [{lo:.2f}, {hi:.2f}]")
    print(f'  required reliability ({P.PLATEAU_SHARE:.0%} of plateau): {req}')

    design = {
        'design': line.id,
        'throughput': tp,
        'requiredReliability': {
            'value': req,
            'source': f'simulate/ sweep: {robot_note}; {P.PLATEAU_SHARE:.0%} of plateau',
        },
        'sweep': points,
    }
    if current:
        design['capex'] = {'value': 0, 'source': 'estimate (existing line)'}
    print(f'results -> {upsert_design(args.out / "results.json", design)}')


if __name__ == '__main__':
    main()
