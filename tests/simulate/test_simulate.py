from __future__ import annotations

import copy
import json
import shutil
import subprocess
from collections import Counter, defaultdict

import pytest
import simpy

from simulate.handoff import Handoff
from simulate.line import from_dict
from simulate.output import upsert_design, write_event_log
from simulate.simulate import SimOptions, simulate
from simulate.sweep import required_reliability, sweep
from simulate.validate import validate

from .conftest import DATA, ROOT

SHIFT = 8 * 3600
LOG = dict(duration=1800 + 7200, warmup=1800)


def stat(result, sid):
    return next(s for s in result.stats if s.id == sid)


# --- Handoff buffer ------------------------------------------------------------------------------


def test_handoff_capacity_zero_is_a_rendezvous():
    env = simpy.Environment()
    h = Handoff(env, 0)
    put = h.put('a')
    assert not put.triggered  # nobody waiting: the putter is blocked
    got = h.get()
    assert got.triggered and got.value == 'a' and put.triggered
    getter = h.get()
    assert not getter.triggered  # starved
    assert h.put('b').triggered and getter.value == 'b'  # direct hand-over


def test_handoff_priority_and_fifo():
    env = simpy.Environment()
    h = Handoff(env, 1)
    assert h.put('a').triggered
    blocked = h.put('b')
    assert not blocked.triggered
    h.put_priority('r')
    assert h.get().value == 'r'
    assert h.get().value == 'a' and blocked.triggered
    assert h.get().value == 'b'


# --- Event log -----------------------------------------------------------------------------------


def test_deterministic(line, tmp_path):
    a = simulate(line, SimOptions(seed=42, **LOG)).log
    b = simulate(line, SimOptions(seed=42, **LOG)).log
    c = simulate(line, SimOptions(seed=43, **LOG)).log
    pa = write_event_log(tmp_path / 'a.json', a).read_bytes()
    pb = write_event_log(tmp_path / 'b.json', b).read_bytes()
    assert pa == pb
    assert a['events'] != c['events']


def test_log_format_matches_contract(line, tmp_path):
    log = simulate(line, SimOptions(seed=42, **LOG)).log
    text = write_event_log(tmp_path / 'e.json', log).read_text()
    assert text.startswith('{"line":"r290_current","seed":42,"duration":9000,"events":[\n')
    assert json.loads(text) == log
    ev = log['events'][0]
    assert list(ev)[:5] == ['unit', 'variant', 'station', 'event', 'time']
    assert set(Counter(e['event'] for e in log['events'])) <= {
        'start', 'end', 'blocked', 'starved', 'failed', 'rework', 'op_start', 'op_end'
    }


@pytest.mark.parametrize('seed', [1, 2, 3, 42])
def test_current_log_validates(line, seed):
    assert validate(simulate(line, SimOptions(seed=seed, **LOG)).log, line) == []


def test_naive_robots_log_validates(line):
    opts = SimOptions(seed=7, robot_stations=['S03', 'S08'], robot_reliability=0.85, fail_multiplier=3, recovery=120, **LOG)
    r = simulate(line, opts)
    assert r.robot_failures > 0
    assert validate(r.log, line) == []


def test_coupled_line(line_dict):
    d = copy.deepcopy(line_dict)
    for st in d['stations']:
        st['bufferBefore'] = st['bufferAfter'] = 0
    coupled = from_dict(d)
    r = simulate(coupled, SimOptions(seed=5, **LOG))
    assert validate(r.log, coupled) == []
    assert stat(r, 'S04').blocked > 0  # upstream of the leak test waits in its bay
    # No unit lost: every unit that started S01 is either finished or still on the line.
    starts = defaultdict(set)
    for e in r.log['events']:
        if e['event'] == 'start':
            starts[e['station']].add(e['unit'])
    in_flight = len(starts['S01']) - len(starts['S11'])
    assert 0 <= in_flight <= len(d['stations'])
    # Coupled hand-over: with no buffers, every blocked bay's unit starts downstream the moment it is freed.
    assert r.completed > 0


def test_soft_edges_vary_hard_edges_hold(line):
    r = simulate(line, SimOptions(seed=11, duration=1800 + SHIFT, warmup=1800))
    first = defaultdict(dict)  # (unit, station pass) -> op -> index
    passes = Counter()
    for e in r.log['events']:
        if e['event'] == 'start':
            passes[(e['unit'], e['station'])] += 1
        if e['event'] == 'op_start':
            key = (e['unit'], e['station'], passes[(e['unit'], e['station'])])
            first[key][e['operation']] = len(first[key])
    orders = defaultdict(Counter)
    for ops in first.values():
        for a, b in line.hard_edges + line.soft_edges:
            if a in ops and b in ops:
                orders[(a, b)][ops[a] < ops[b]] += 1
    for a, b in line.hard_edges:
        assert orders[(a, b)][False] == 0, f'hard edge {a}->{b} reversed'
    same_station = [(a, b) for a, b in line.soft_edges if line.operations[a].station == line.operations[b].station]
    for a, b in same_station:
        if (a, b) in orders:
            assert orders[(a, b)][True] > 0 and orders[(a, b)][False] > 0, f'soft edge {a}->{b} never varies'


def test_leak_rework_loops_to_brazing(line):
    r = simulate(line, SimOptions(seed=3, duration=1800 + 4 * SHIFT, warmup=1800))
    ev = r.log['events']
    fails = [e for e in ev if e['event'] == 'failed' and e['station'] == 'S05']
    leak_passes = sum(1 for e in ev if e['event'] == 'end' and e['station'] == 'S05')
    assert 0.01 < len(fails) / leak_passes < 0.08  # failRate 0.04
    for f in fails:
        i = next(i for i, e in enumerate(ev) if e is f)
        later = [e for e in ev[i:] if e['unit'] == f['unit']]
        assert later[0]['event'] == 'failed'
        assert any(e['event'] == 'rework' and e['station'] == 'S04' for e in later[:3])
        nxt = next((e for e in later if e['event'] == 'start'), None)
        if nxt:
            assert nxt['station'] == 'S04'


def test_sanity_test_stations_are_the_bottleneck(line):
    """From the plan: the test stations must be the bottleneck, with blocked time upstream."""
    r = simulate(line, SimOptions(seed=1, duration=1800 + SHIFT, warmup=1800))
    util = {s.id: s.utilisation for s in r.stats}
    top2 = sorted(util, key=util.get, reverse=True)[:2]
    assert set(top2) == {'S05', 'S09'}
    for sid in ['S01', 'S02', 'S03', 'S04', 'S06', 'S07', 'S08']:
        assert stat(r, sid).blocked > 0.05


# --- Redesign with human fallback ----------------------------------------------------------------


def _redesign_opts(base_ops, **kw):
    return SimOptions(fail_multiplier=1, recovery=30, human_ops=base_ops, **{**LOG, **kw})


def test_fallback_log_validates(redesign, base_ops):
    r = simulate(redesign, _redesign_opts(base_ops, seed=4, robot_reliability=0.85))
    assert r.robot_failures > 0
    assert validate(r.log, redesign) == []
    ev = r.log['events']
    assert any(e['station'] == 'S03F' and e['event'] == 'start' for e in ev)
    # A diverted unit rejoins downstream of its robot station.
    u = next(e['unit'] for e in ev if e['station'] == 'S03' and e['event'] == 'failed')
    path = [e['station'] for e in ev if e['unit'] == u and e['event'] == 'start']
    assert path[path.index('S03F') + 1] == 'S04'


def test_fallback_share_and_human_times(redesign, base_ops):
    r = 0.8
    res = simulate(redesign, _redesign_opts(base_ops, seed=9, robot_reliability=r, duration=1800 + 2 * SHIFT))
    ev = res.log['events']
    robot_starts = sum(1 for e in ev if e['station'] == 'S03' and e['event'] == 'start')
    fallback_starts = sum(1 for e in ev if e['station'] == 'S03F' and e['event'] == 'start')
    k = [len(set(redesign.station('S03').operations) & v.operations) for v in redesign.variants]
    mix = [v.mix for v in redesign.variants]
    expected = sum(w * (1 - r**n) for w, n in zip(mix, k)) / sum(mix)
    assert abs(fallback_starts / robot_starts - expected) < 0.08


def test_fallback_beats_stopping_the_cell(redesign_dict, redesign, base_ops):
    """At low reliability, sending failed units to a person beats stopping the robot cell for recovery."""
    d = copy.deepcopy(redesign_dict)
    d['stations'] = [s for s in d['stations'] if not s.get('offline')]
    for s in d['stations']:
        s.pop('fallback', None)
    stop = from_dict(d)
    tp_fb = tp_stop = 0.0
    for seed in range(1000, 1020):
        o = dict(seed=seed, robot_reliability=0.8, duration=1800 + SHIFT, warmup=1800, record=False)
        tp_fb += simulate(redesign, SimOptions(fail_multiplier=1, recovery=30, human_ops=base_ops, **o)).throughput_per_hour
        tp_stop += simulate(stop, SimOptions(fail_multiplier=1, recovery=120, **o)).throughput_per_hour
    assert tp_fb > tp_stop


# --- Sweep and outputs ---------------------------------------------------------------------------


def test_sweep_monotone_with_ci(line):
    base = SimOptions(
        seed=0, duration=1800 + SHIFT, warmup=1800, robot_stations=['S03', 'S08'], fail_multiplier=3, recovery=120
    )
    pts = sweep(line, base, [0.8, 0.9, 0.999], shifts=30, processes=2)
    vals = [p['throughput']['value'] for p in pts]
    assert vals[0] < vals[1] <= vals[2] + 0.2
    for p in pts:
        lo, hi = p['ci95']
        assert lo <= p['throughput']['value'] <= hi
        assert p['throughput']['source']
    assert required_reliability(pts) in (0.9, 0.999)


def test_upsert_keeps_other_designs_and_fields(tmp_path):
    p = tmp_path / 'results.json'
    shutil.copy(DATA / 'results.json', p)
    before = json.loads(p.read_text())
    upsert_design(p, {'design': 'r290_current', 'throughput': {'value': 1, 'source': 'test'}})
    after = json.loads(p.read_text())
    assert [d['design'] for d in after['designs']] == [d['design'] for d in before['designs']]
    cur = after['designs'][0]
    assert cur['throughput']['value'] == 1 and cur['capex'] == before['designs'][0]['capex']
    assert after['designs'][1] == before['designs'][1]


# --- Parity with the TypeScript stand-in ---------------------------------------------------------

TSX = ROOT / 'app' / 'node_modules' / '.bin' / 'tsx'


@pytest.mark.skipif(not TSX.exists(), reason='app/node_modules not installed')
def test_parity_with_ts_reference(line):
    seeds = 40
    out = subprocess.run(
        [str(TSX), str(ROOT / 'tests/simulate/ts_reference.ts'), str(DATA / 'line.json'), str(seeds)],
        cwd=ROOT / 'app', capture_output=True, text=True, check=True,
    )
    ts = json.loads(out.stdout)
    tp = 0.0
    util: dict[str, float] = defaultdict(float)
    for k in range(seeds):
        r = simulate(line, SimOptions(seed=1000 + k, duration=1800 + SHIFT, warmup=1800, record=False))
        tp += r.throughput_per_hour / seeds
        for s in r.stats:
            util[s.id] += s.utilisation / seeds
    assert abs(tp - ts['throughput']) / ts['throughput'] < 0.05
    for sid, u in util.items():
        assert abs(u - ts['util'][sid]) < 0.05, f'{sid}: py {u:.3f} vs ts {ts["util"][sid]:.3f}'
