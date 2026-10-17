"""Seeded SimPy simulation of a serial line with finite buffers.

Event semantics match tools/gen/simulate.ts, which the renderer and playback rely on:
- Station bays are servers. Each bay's state is the last of start / end / blocked / starved at that bay.
  `start` puts the unit at the bay; between `end` and the bay's next event the unit is still at the bay
  (`blocked` makes that explicit). After that the unit is in the buffer until its `start` downstream.
- The buffer between chain stations i and i+1 holds bufferAfter[i] + bufferBefore[i+1] units
  (0 = coupled line: a finished unit waits in its bay until a downstream bay takes it).
- The first station has unlimited raw material (never starved); variants are drawn from the mix.
- Ops inside a station run sequentially in a random topological order over the hard edges between
  that station's ops, redrawn every cycle, so soft-edge pairs vary between cycles.
- A test op with failRate: at the leak test the unit emits `failed` (leak station) then `rework`
  (brazing station, no bay) and joins brazing's priority rework queue; at any other test station it
  emits `failed` + `rework` at that bay and is re-tested in place.
- Robot stations: each op fails with p = (1 - reliability) * fail_multiplier.
  Without a fallback (current line) the op then takes `recovery` extra seconds, with no extra event.
  With a fallback station (redesign) the robot bay emits `op_end`, `failed`, `end`, the unit goes to the
  fallback station's queue, a person redoes the failed op and the rest at human times, and the unit
  rejoins the line in the robot station's output buffer. The robot bay spends `recovery` seconds
  resetting before it takes the next unit.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

import simpy

from .handoff import Handoff
from .line import Line, Operation, Station

INF = float('inf')


@dataclass
class SimOptions:
    seed: int
    #: Total simulated time, seconds (includes warm-up).
    duration: float
    #: Stats ignore [0, warmup). The log starts from an empty line at t = 0.
    warmup: float
    record: bool = True
    robot_reliability: float = 0.98
    fail_multiplier: float = 1.0
    recovery: float = 30.0
    #: Override which stations are robot-staffed (used for naive automation of the current line).
    robot_stations: list[str] | None = None
    #: Per-operation robot success rate; falls back to robot_reliability (see capability_stub).
    op_reliability: dict[str, float] | None = None
    #: Human versions of robot ops, for fallback stations. Defaults to the op itself.
    human_ops: dict[str, Operation] | None = None


@dataclass
class StationStats:
    id: str
    name: str
    bays: int
    utilisation: float
    blocked: float
    starved: float
    cycles: int


@dataclass
class SimResult:
    stats: list[StationStats]
    completed: int
    throughput_per_hour: float
    failures: int
    robot_failures: int
    log: dict | None = None


@dataclass
class Unit:
    id: str
    variant: str


@dataclass
class Bay:
    index: int
    state: str = 'idle'
    since: float = 0.0
    busy: float = 0.0
    blocked: float = 0.0
    starved: float = 0.0


@dataclass
class SimStation:
    st: Station
    bays: list[Bay]
    ops: list[Operation]
    #: Hard predecessors inside the station.
    preds: dict[str, list[str]]
    fail_op: Operation | None
    robot: bool
    cycles: int = 0
    inp: Handoff | None = None
    out: Handoff | None = None
    last: bool = False


def r3(t: float) -> float | int:
    v = round(t * 1000) / 1000
    return int(v) if v == int(v) else v


class Sim:
    def __init__(self, line: Line, opts: SimOptions):
        self.line = line
        self.o = opts
        self.env = simpy.Environment()
        self.rand = random.Random(f'sim:{line.id}:{opts.seed}')
        self.events: list[tuple[float, int, dict]] = []
        self.seq = 0
        self.unit_counter = 0
        self.completed = 0
        self.failures = 0
        self.robot_failures = 0
        self.variant_ops = {v.id: v.operations for v in line.variants}
        self.mix = [(v.id, v.mix) for v in line.variants]
        self.mix_total = sum(w for _, w in self.mix)

        robot_ids = set(opts.robot_stations) if opts.robot_stations is not None else None
        self.stations: dict[str, SimStation] = {}
        for st in line.stations:
            ops = [line.operations[i] for i in st.operations if i in line.operations]
            ids = {o.id for o in ops}
            preds: dict[str, list[str]] = {o.id: [] for o in ops}
            for a, b in line.hard_edges:
                if a in ids and b in ids:
                    preds[b].append(a)
            robot = st.id in robot_ids if robot_ids is not None else st.staff == 'robot'
            self.stations[st.id] = SimStation(
                st=st,
                bays=[Bay(i) for i in range(st.bays)],
                ops=ops,
                preds=preds,
                fail_op=next((o for o in ops if o.fail_rate > 0), None),
                robot=robot and not st.offline,
            )

        chain = [self.stations[s.id] for s in line.chain]
        for i in range(len(chain) - 1):
            a, b = chain[i], chain[i + 1]
            buf = Handoff(self.env, a.st.buffer_after + b.st.buffer_before)
            a.out = buf
            b.inp = buf
        chain[-1].last = True
        for s in self.stations.values():
            if s.st.offline:
                s.inp = Handoff(self.env, INF)
        self.chain = chain
        self.brazing = next((s for s in chain if s.st.kind == 'brazing'), None)
        self.leak = next((s for s in chain if s.st.kind == 'evacuation_leak_test'), None)

        for s in self.stations.values():
            for b in s.bays:
                if s.st.offline:
                    proc = self.fallback_bay(s, b)
                else:
                    proc = self.chain_bay(s, b)
                self.env.process(proc)

    # --- helpers -----------------------------------------------------------------------------

    def emit(self, u: Unit | None, s: SimStation, event: str, extra: dict | None = None, bay: Bay | None = None):
        t = self.env.now
        if not self.o.record or t > self.o.duration:
            return
        e = {
            'unit': u.id if u else '',
            'variant': u.variant if u else '',
            'station': s.st.id,
            'event': event,
            'time': r3(t),
        }
        if bay is not None and len(s.bays) > 1:
            e['bay'] = bay.index
        if extra:
            e.update(extra)
        self.events.append((e['time'], self.seq, e))
        self.seq += 1

    def set_state(self, b: Bay, state: str, t: float | None = None):
        t = self.env.now if t is None else t
        lo = max(b.since, self.o.warmup)
        hi = min(t, self.o.duration)
        if hi > lo:
            if b.state == 'busy':
                b.busy += hi - lo
            elif b.state == 'blocked':
                b.blocked += hi - lo
            elif b.state == 'starved':
                b.starved += hi - lo
        b.state = state
        b.since = t

    def new_unit(self) -> Unit:
        r = self.rand.random() * self.mix_total
        variant = self.mix[-1][0]
        for vid, w in self.mix:
            if r < w:
                variant = vid
                break
            r -= w
        self.unit_counter += 1
        return Unit(f'U{self.unit_counter:04d}', variant)

    def sample(self, mean: float, sd: float) -> float:
        """Lognormal with the given mean and sd."""
        if mean <= 0:
            return 0.0
        if sd <= 0:
            return mean
        s2 = math.log(1 + (sd * sd) / (mean * mean))
        return self.rand.lognormvariate(math.log(mean) - s2 / 2, math.sqrt(s2))

    def draw_order(self, s: SimStation, variant: str) -> list[Operation]:
        """Random topological order over the hard edges of this station's ops for this variant."""
        allowed = self.variant_ops.get(variant)
        ops = [o for o in s.ops if allowed is None or o.id in allowed]
        ids = {o.id for o in ops}
        done: set[str] = set()
        out: list[Operation] = []
        while len(out) < len(ops):
            ready = [
                o for o in ops if o.id not in done and all(p in done or p not in ids for p in s.preds[o.id])
            ]
            pick = ready[int(self.rand.random() * len(ready))]
            done.add(pick.id)
            out.append(pick)
        return out

    def fail_prob(self, op: Operation) -> float:
        r = (self.o.op_reliability or {}).get(op.id, self.o.robot_reliability)
        return min(1.0, max(0.0, (1 - r) * self.o.fail_multiplier))

    def take(self, s: SimStation, b: Bay):
        """Get the next unit for this bay, emitting `starved` if it has to wait."""
        if s.inp is None:
            return self.new_unit()
        ev = s.inp.get()
        if ev.triggered:
            return ev.value
        self.set_state(b, 'starved')
        self.emit(None, s, 'starved', bay=b)
        return (yield ev)

    def pass_on(self, s: SimStation, b: Bay, u: Unit, out: Handoff | None, last: bool):
        """Hand the finished unit downstream, emitting `blocked` if it has to wait."""
        if last:
            if self.env.now >= self.o.warmup:
                self.completed += 1
        else:
            ev = out.put(u)
            if not ev.triggered:
                self.set_state(b, 'blocked')
                self.emit(u, s, 'blocked', bay=b)
                yield ev
        self.set_state(b, 'idle')

    # --- processes ---------------------------------------------------------------------------

    def chain_bay(self, s: SimStation, b: Bay):
        env = self.env
        fallback = self.stations.get(s.st.fallback) if s.st.fallback else None
        while True:
            u = yield from self.take(s, b)
            while True:
                self.set_state(b, 'busy')
                self.emit(u, s, 'start', bay=b)
                diverted = False
                order = self.draw_order(s, u.variant)
                for k, op in enumerate(order):
                    tm = op.time_for(u.variant)
                    d = self.sample(tm.mean, tm.sd)
                    failed = s.robot and self.rand.random() < self.fail_prob(op)
                    if failed:
                        self.robot_failures += 1
                        if fallback is None:
                            d += self.o.recovery
                    self.emit(u, s, 'op_start', {'operation': op.id}, bay=b)
                    yield env.timeout(d)
                    self.emit(u, s, 'op_end', {'operation': op.id}, bay=b)
                    if failed and fallback is not None:
                        self.emit(u, s, 'failed', bay=b)
                        self.emit(u, s, 'end', bay=b)
                        fallback.inp.put((u, order[k:], s))
                        diverted = True
                        break
                if diverted:
                    yield env.timeout(self.o.recovery)
                    self.set_state(b, 'idle')
                    break

                self.emit(u, s, 'end', bay=b)
                if env.now >= self.o.warmup:
                    s.cycles += 1
                fo = s.fail_op
                if fo is not None and self.rand.random() < fo.fail_rate:
                    self.failures += 1
                    self.emit(u, s, 'failed', bay=b)
                    if s is self.leak and self.brazing is not None:
                        self.emit(u, self.brazing, 'rework')
                        self.brazing.inp.put_priority(u)
                        self.set_state(b, 'idle')
                        break
                    self.emit(u, s, 'rework', bay=b)
                    continue
                yield from self.pass_on(s, b, u, s.out, s.last)
                break

    def fallback_bay(self, s: SimStation, b: Bay):
        env = self.env
        human = self.o.human_ops or {}
        while True:
            u, ops, origin = yield from self.take(s, b)
            self.set_state(b, 'busy')
            self.emit(u, s, 'start', bay=b)
            for op in ops:
                tm = human.get(op.id, op).time_for(u.variant)
                self.emit(u, s, 'op_start', {'operation': op.id}, bay=b)
                yield env.timeout(self.sample(tm.mean, tm.sd))
                self.emit(u, s, 'op_end', {'operation': op.id}, bay=b)
            self.emit(u, s, 'end', bay=b)
            if env.now >= self.o.warmup:
                s.cycles += 1
            yield from self.pass_on(s, b, u, origin.out, origin.last)

    # --- run ---------------------------------------------------------------------------------

    def run(self) -> SimResult:
        o = self.o
        self.env.run(until=o.duration)
        for s in self.stations.values():
            for b in s.bays:
                self.set_state(b, b.state, o.duration)
        span = o.duration - o.warmup
        stats = []
        for s in self.stations.values():
            n = len(s.bays) * span

            def share(k: str) -> float:
                return sum(getattr(b, k) for b in s.bays) / n

            stats.append(
                StationStats(s.st.id, s.st.name, len(s.bays), share('busy'), share('blocked'), share('starved'), s.cycles)
            )
        log = None
        if o.record:
            self.events.sort(key=lambda x: (x[0], x[1]))
            log = {'line': self.line.id, 'seed': o.seed, 'duration': o.duration, 'events': [e for _, _, e in self.events]}
        return SimResult(
            stats=stats,
            completed=self.completed,
            throughput_per_hour=self.completed / span * 3600,
            failures=self.failures,
            robot_failures=self.robot_failures,
            log=log,
        )


def simulate(line: Line, opts: SimOptions) -> SimResult:
    return Sim(line, opts).run()
