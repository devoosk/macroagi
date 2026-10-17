import { useMemo, useState } from 'react'
import type { Line, Station } from '../../contracts/types'
import { formatHMS } from '../theme'
import { capabilityRows, euros, flowStations, resultFor, type StudioData } from './data'

// Every visual takes `p`, the step's progress 0..1, and is a pure function of (data, p).

const W = 680
const H = 380
const INK = '#1a1a1a'
const GREY = '#a3a7ab'
const MUTED = '#6b7075'
const LINE = 'rgba(26,26,26,0.1)'
const WASTE_VERBS = new Set(['walk', 'search'])

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3)
/** Local progress of a sub-animation that runs from `a` to `b` within the step. */
const span = (p: number, a: number, b: number) => ease((p - a) / (b - a))

function Svg({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg className="mx-viz-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="mx-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="#fff" />
          <line x1="0" y1="0" x2="0" y2="4" stroke={INK} strokeWidth="1.6" />
        </pattern>
      </defs>
      {children}
    </svg>
  )
}

/* ---------------------------------------------------------------- 1. capture */

export function CaptureViz({ data, p }: { data: StudioData; p: number }) {
  const stations = flowStations(data.current)
  const segs = data.segments?.segments ?? []
  const cov = Object.values(data.segments?.coverage ?? {})
  const t0 = cov.length ? Math.min(...cov.map((c) => c[0])) : Math.min(...segs.map((s) => s.start))
  const t1 = cov.length ? Math.max(...cov.map((c) => c[1])) : Math.max(...segs.map((s) => s.end))
  const tNow = t0 + (t1 - t0) * ease(p * 1.1)
  const L = 112
  const R = W - 168
  const top = 22
  const rowH = (H - top - 34) / stations.length
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (R - L)
  const seen = segs.filter((s) => s.start < tNow)
  const tally = new Map<string, number>()
  for (const s of seen) tally.set(s.verb, (tally.get(s.verb) ?? 0) + 1)
  const verbs = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  const maxN = Math.max(1, ...verbs.map((v) => v[1]))
  const ticks = Array.from({ length: 5 }, (_, i) => t0 + ((t1 - t0) * i) / 4)

  return (
    <Svg label="Labelled actions per station over the captured footage">
      {stations.map((s, i) => {
        const y = top + i * rowH
        return (
          <g key={s.id}>
            <text x={0} y={y + rowH / 2 + 3.5} className="mx-viz-id">{s.id}</text>
            <text x={30} y={y + rowH / 2 + 3.5} className="mx-viz-label">{s.name.length > 14 ? s.name.slice(0, 13) + '…' : s.name}</text>
            <rect x={L} y={y + 3} width={R - L} height={rowH - 6} rx={3} fill="rgba(26,26,26,0.035)" />
          </g>
        )
      })}
      {seen.map((s, i) => {
        const row = stations.findIndex((st) => st.id === s.station)
        if (row < 0) return null
        const waste = WASTE_VERBS.has(s.verb)
        const x0 = x(s.start)
        const w = Math.max(1.5, x(Math.min(s.end, tNow)) - x0 - 1)
        return (
          <rect
            key={i}
            x={x0}
            y={top + row * rowH + 5}
            width={w}
            height={rowH - 10}
            rx={2}
            fill={waste ? 'url(#mx-hatch)' : INK}
            fillOpacity={waste ? 1 : 0.3 + 0.6 * s.confidence}
          >
            <title>{`${s.station} ${s.verb} ${formatHMS(s.start)}–${formatHMS(s.end)} · confidence ${(s.confidence * 100).toFixed(0)}%`}</title>
          </rect>
        )
      })}
      {p < 1 && <line x1={x(tNow)} x2={x(tNow)} y1={top - 6} y2={H - 30} stroke={INK} strokeWidth={1.5} />}
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={H - 14} textAnchor="middle" className="mx-viz-tick">{formatHMS(t).slice(3)}</text>
      ))}
      <g transform={`translate(${R + 24}, ${top})`}>
        <text className="mx-viz-eyebrow">ACTIONS SEEN</text>
        {verbs.map(([v, n], i) => (
          <g key={v} transform={`translate(0, ${18 + i * 24})`}>
            <text y={10} className="mx-viz-label">{v}{WASTE_VERBS.has(v) ? ' · waste' : ''}</text>
            <text x={136} y={10} textAnchor="end" className="mx-viz-num">{n}</text>
            <rect y={15} width={136 * (n / maxN)} height={3} rx={1.5} fill={WASTE_VERBS.has(v) ? 'url(#mx-hatch)' : INK} />
          </g>
        ))}
      </g>
    </Svg>
  )
}

/** `claude:claude-sonnet-5-5:medium` → `Claude Sonnet 5.5`. */
function modelName(id: string): string {
  const m = /claude-([a-z]+)-(\d+)-(\d+)/.exec(id)
  return m ? `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id
}

export function captureCaption(data: StudioData) {
  const segs = data.segments
  if (!segs) return 'No camera labels found.'
  const cams = new Set(segs.cameraSegments.map((s) => s.cam)).size
  const cov = Object.values(segs.coverage)
  const min = cov.length ? Math.round((Math.max(...cov.map((c) => c[1])) - Math.min(...cov.map((c) => c[0]))) / 60) : 0
  const waste = segs.segments.filter((s) => WASTE_VERBS.has(s.verb)).length
  return `${segs.segments.length} actions labelled by ${modelName(segs.model)} from ${cams} cameras over ${min} min of footage. ${waste} of them are walking or searching: waste a redesign can remove.`
}

/* ------------------------------------------------------------- 2. process graph */

interface Node {
  id: string
  x: number
  y: number
  station: number
}

function graphLayout(line: Line) {
  const stations = flowStations(line)
  const L = 30
  const colW = (W - L * 2) / stations.length
  const mid = H / 2 - 8
  const nodes = new Map<string, Node>()
  stations.forEach((s, i) => {
    const ops = s.operations
    ops.forEach((o, j) => nodes.set(o, { id: o, x: L + colW * (i + 0.5), y: mid + (j - (ops.length - 1) / 2) * 46, station: i }))
  })
  // Ops in no station (eliminated in a redesign) sit under their original station.
  for (const o of line.operations) {
    if (nodes.has(o.id)) continue
    const i = stations.findIndex((s) => s.id === o.station)
    nodes.set(o.id, { id: o.id, x: L + colW * (i + 0.5), y: mid + 90, station: i })
  }
  return { stations, nodes, colW, L }
}

const NODE_W = 40
const NODE_H = 20

function edgePath(a: Node, b: Node) {
  if (a.station === b.station) {
    const x = a.x + NODE_W / 2 + 2
    return `M ${x} ${a.y} C ${x + 12} ${a.y}, ${x + 12} ${b.y}, ${x} ${b.y}`
  }
  const x0 = a.x + NODE_W / 2
  const x1 = b.x - NODE_W / 2
  const dx = Math.max(12, (x1 - x0) / 2)
  return `M ${x0} ${a.y} C ${x0 + dx} ${a.y}, ${x1 - dx} ${b.y}, ${x1} ${b.y}`
}

export function GraphViz({ data, p }: { data: StudioData; p: number }) {
  const { stations, nodes, colW, L } = useMemo(() => graphLayout(data.current), [data.current])
  const edges = data.current.edges
  const verb = new Map(data.current.operations.map((o) => [o.id, o.verb]))
  return (
    <Svg label="Process graph: operations by station, hard and soft precedence edges">
      {stations.map((s, i) => (
        <g key={s.id} opacity={span(p, i / stations.length / 3, i / stations.length / 3 + 0.15)}>
          <rect x={L + colW * i + 3} y={36} width={colW - 6} height={H - 100} rx={4} fill="rgba(26,26,26,0.03)" />
          <text x={L + colW * (i + 0.5)} y={28} textAnchor="middle" className="mx-viz-id">{s.id}</text>
        </g>
      ))}
      {edges.map((e, i) => {
        const a = nodes.get(e.from)
        const b = nodes.get(e.to)
        if (!a || !b) return null
        const k = span(p, 0.3 + (0.45 * i) / edges.length, 0.42 + (0.45 * i) / edges.length)
        const hard = e.type === 'hard'
        return (
          <path
            key={i}
            d={edgePath(a, b)}
            fill="none"
            stroke={hard ? INK : MUTED}
            strokeWidth={hard ? 1.4 : 1.2}
            strokeDasharray={hard ? `${k * 400} 400` : '4 3'}
            opacity={hard ? 0.75 : k * 0.9}
          />
        )
      })}
      {[...nodes.values()].map((n) => {
        const k = span(p, n.station / stations.length / 3 + 0.05, n.station / stations.length / 3 + 0.2)
        const waste = WASTE_VERBS.has(verb.get(n.id) ?? '')
        return (
          <g key={n.id} opacity={k} transform={`translate(${n.x - NODE_W / 2}, ${n.y - NODE_H / 2})`}>
            <rect width={NODE_W} height={NODE_H} rx={NODE_H / 2} fill={waste ? 'url(#mx-hatch)' : '#fff'} stroke={INK} strokeWidth={1.2} />
            <text x={NODE_W / 2} y={13.5} textAnchor="middle" className="mx-viz-node" style={waste ? { paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 } : undefined}>{n.id}</text>
            <title>{data.current.operations.find((o) => o.id === n.id)?.name}</title>
          </g>
        )
      })}
      <g transform={`translate(${L}, ${H - 26})`} className="mx-viz-label">
        <line x1={0} x2={22} y1={-4} y2={-4} stroke={INK} strokeWidth={1.4} />
        <text x={30} y={0}>hard: physically required</text>
        <line x1={190} x2={212} y1={-4} y2={-4} stroke={MUTED} strokeWidth={1.2} strokeDasharray="4 3" />
        <text x={220} y={0}>soft: today's habit, free to reorder</text>
        <rect x={440} y={-11} width={22} height={13} rx={6.5} fill="url(#mx-hatch)" stroke={INK} />
        <text x={470} y={0}>walk / search (waste)</text>
      </g>
    </Svg>
  )
}

export function graphCaption(data: StudioData) {
  const hard = data.current.edges.filter((e) => e.type === 'hard').length
  const soft = data.current.edges.length - hard
  return `${data.current.operations.length} operations across ${flowStations(data.current).length} stations. ${hard} orderings are physically required; ${soft} are only habit, so the redesign is free to change them.`
}

/* ----------------------------------------------------------- 3. capability */

const FLOOR = 0.9

export function CapabilityViz({ data, p }: { data: StudioData; p: number }) {
  const rows = useMemo(() => capabilityRows(data), [data])
  const L = 176
  const R = W - 64
  const top = 34
  const rowH = (H - top - 24) / Math.max(1, rows.length)
  const lo = 0.4
  const x = (v: number) => L + ((clamp(v, lo, 1) - lo) / (1 - lo)) * (R - L)
  return (
    <Svg label="Robot success range per operation, today and with a design lever, against the 90% floor">
      <g className="mx-viz-label" transform={`translate(${L}, 12)`}>
        <rect y={-4} width={14} height={3} rx={1.5} fill={GREY} />
        <text x={20} y={0}>best robot, task as today</text>
        <rect x={170} y={-4} width={14} height={3} rx={1.5} fill={INK} />
        <text x={190} y={0}>with a design lever</text>
      </g>
      {[0.4, 0.6, 0.8, 1].map((v) => (
        <g key={v}>
          <line x1={x(v)} x2={x(v)} y1={top - 6} y2={H - 22} stroke={LINE} />
          <text x={x(v)} y={H - 8} textAnchor="middle" className="mx-viz-tick">{v * 100}%</text>
        </g>
      ))}
      <line x1={x(FLOOR)} x2={x(FLOOR)} y1={top - 10} y2={H - 22} stroke={INK} strokeDasharray="3 3" />
      <text x={x(FLOOR) + 4} y={top - 4} className="mx-viz-tick" style={{ fill: INK }}>floor 90%</text>
      {rows.map((r, i) => {
        const y = top + i * rowH + rowH / 2
        const k = span(p, (i / rows.length) * 0.6, (i / rows.length) * 0.6 + 0.25)
        const bar = (g: { p05: number; mean: number; p95: number }, color: string, dy: number) => (
          <g transform={`translate(0, ${dy})`}>
            <rect x={x(g.p05)} y={-1.5} width={Math.max(2, (x(g.p95) - x(g.p05)) * k)} height={3} rx={1.5} fill={color} />
            <circle cx={x(lo) + (x(g.mean) - x(lo)) * k} r={2.6} fill={color} stroke="#fff" strokeWidth={1} />
          </g>
        )
        return (
          <g key={r.op} transform={`translate(0, ${y})`} opacity={0.25 + 0.75 * k}>
            <text x={0} y={3.5} className="mx-viz-id">{r.op}</text>
            <text x={28} y={3.5} className="mx-viz-label">{r.name.length > 25 ? r.name.slice(0, 24) + '…' : r.name}</text>
            {r.waste ? (
              <text x={x(lo)} y={3.5} className="mx-viz-label" style={{ fontStyle: 'italic' }}>waste: eliminate, don't automate</text>
            ) : (
              <>
                {r.today && bar(r.today, GREY, -2.2)}
                {r.lever && bar(r.lever, INK, 2.2)}
                {!r.today && !r.lever && <text x={x(lo)} y={3.5} className="mx-viz-label">no rentable robot can do this</text>}
              </>
            )}
            {r.mode && r.mode !== 'human' && k > 0.9 && (
              <g transform={`translate(${W - 56}, -7)`}>
                <rect width={52} height={14} rx={7} fill={r.mode === 'robot' ? INK : 'none'} stroke={INK} />
                <text x={26} y={10} textAnchor="middle" className="mx-viz-tag" style={{ fill: r.mode === 'robot' ? '#fff' : INK }}>
                  {r.mode === 'robot' ? 'ROBOT' : 'REMOVED'}
                </text>
              </g>
            )}
            <title>
              {[
                `${r.op} ${r.name}`,
                r.today && `today ${(r.today.p05 * 100).toFixed(0)}–${(r.today.p95 * 100).toFixed(0)}% (mean ${(r.today.mean * 100).toFixed(0)}%)`,
                r.lever && `with ${r.lever.lever}: ${(r.lever.p05 * 100).toFixed(0)}–${(r.lever.p95 * 100).toFixed(0)}% (mean ${(r.lever.mean * 100).toFixed(0)}%)`,
              ]
                .filter(Boolean)
                .join('\n')}
            </title>
          </g>
        )
      })}
    </Svg>
  )
}

export function capabilityCaption(data: StudioData) {
  const rows = capabilityRows(data)
  const waste = rows.filter((r) => r.waste).length
  const robot = rows.filter((r) => r.mode === 'robot').length
  const lifted = rows.filter((r) => r.lever && r.today && r.lever.mean >= FLOOR && r.today.mean < FLOOR).length
  return `Every operation scored for robot success as a range, not a guess. ${waste} are waste to remove, ${lifted} only clear the floor after a design change, and ${robot} go to robots in the chosen design.`
}

/* ------------------------------------------------------------- 4. optimise */

function StationStrip({ line, highlight = 1 }: { line: Line; highlight?: number }) {
  return (
    <div className="mx-strip">
      {flowStations(line).map((s: Station) => (
        <div key={s.id} className="mx-strip-st" title={`${s.id} ${s.name}${s.staff === 'robot' ? ` · ${s.robot ?? 'robot'}` : ''}${(s.bays ?? 1) > 1 ? ` · ${s.bays} bays` : ''}`}>
          {Array.from({ length: Math.max(1, s.bays ?? 1) }, (_, b) => (
            <i key={b} data-robot={s.staff === 'robot' && highlight > 0.5} />
          ))}
          <span>{s.id.replace(/^S0?/, '')}</span>
        </div>
      ))}
    </div>
  )
}

export function OptimiseViz({ data, p }: { data: StudioData; p: number }) {
  const cur = resultFor(data, data.current)
  return (
    <div className="mx-designs">
      <div className="mx-design" data-shown="true" data-baseline="true">
        <div className="mx-design-rank">
          <span className="mx-eyebrow">Today</span>
          <b>Current</b>
        </div>
        <StationStrip line={data.current} />
        <div className="mx-design-stats">
          <span><b className="mx-mono">{flowStations(data.current).length}</b> stations</span>
          <span><b className="mx-mono">0</b> robots</span>
          <span><b className="mx-mono">{cur ? cur.throughput.value.toFixed(1) : '–'}</b> units/h</span>
          <span><b className="mx-mono">–</b> 3 yr</span>
        </div>
      </div>
      {data.designs.map((d, i) => {
        const r = resultFor(data, d)
        const robots = d.design?.fleet.reduce((n, f) => n + f.count, 0) ?? flowStations(d).filter((s) => s.staff === 'robot').length
        const shown = p > 0.08 + i * 0.2
        const chosen = i === 0 && p > 0.78
        return (
          <div key={d.id} className="mx-design" data-shown={shown} data-chosen={chosen}>
            <div className="mx-design-rank">
              <span className="mx-eyebrow">{chosen ? 'Chosen' : `Rank ${r?.rank ?? i + 1}`}</span>
              <b>{d.design?.mode === 'rebuild' ? 'Rebuild' : 'Rebalance'}</b>
            </div>
            <StationStrip line={d} highlight={shown ? 1 : 0} />
            <div className="mx-design-stats">
              <span><b className="mx-mono">{flowStations(d).length}</b> stations</span>
              <span><b className="mx-mono">{robots}</b> robots</span>
              <span><b className="mx-mono">{r ? r.throughput.value.toFixed(1) : '–'}</b> units/h</span>
              <span><b className="mx-mono">{r?.cost3y ? euros(r.cost3y.value) : '–'}</b> 3 yr</span>
            </div>
          </div>
        )
      })}
      <div className="mx-strip-key">
        <span><i data-robot="true" /> robot cell</span>
        <span><i /> human station</span>
        <span><i /><i /> parallel bays</span>
      </div>
    </div>
  )
}

export function optimiseCaption(data: StudioData) {
  const rebuild = data.designs.some((d) => d.design?.mode === 'rebuild')
  return rebuild
    ? 'CP-SAT rebalanced today’s stations, then rebuilt the line from scratch: any station count, order and robot type that hard precedence and takt allow. Ranked by throughput, then 3-year cost.'
    : 'CP-SAT assigned every operation a station and a mode under takt and precedence, across lever bundles, and ranked the distinct designs by throughput, then 3-year cost.'
}

/* ------------------------------------------------------------- 5. simulate */

export function SimulateViz({ data, p }: { data: StudioData; p: number }) {
  const cur = resultFor(data, data.current)
  const red = data.designs[0] && resultFor(data, data.designs[0])
  const [hover, setHover] = useState<number | null>(null)
  if (!cur || !red) return <div className="mx-viz-empty">No simulation results found.</div>
  const series = [
    { key: 'current', name: 'Current line + robots dropped in', r: cur, color: GREY },
    { key: 'redesign', name: 'Redesign', r: red, color: INK },
  ]
  const all = series.flatMap((s) => s.r.sweep)
  const x0 = Math.min(...all.map((d) => d.reliability))
  const yMax = Math.ceil((Math.max(...all.map((d) => d.throughput.value)) * 1.15) / 5) * 5
  const L = 44
  const R = W - 150
  const top = 16
  const B = H - 34
  const x = (v: number) => L + ((v - x0) / (1 - x0)) * (R - L)
  const y = (v: number) => B - (v / yMax) * (B - top)
  const path = (pts: { reliability: number; throughput: { value: number } }[]) =>
    pts.map((d, i) => `${i ? 'L' : 'M'} ${x(d.reliability).toFixed(1)} ${y(d.throughput.value).toFixed(1)}`).join(' ')
  const reveal = ease(p / 0.75)
  const yTicks = Array.from({ length: yMax / 5 + 1 }, (_, i) => i * 5).filter((v) => v % 10 === 0)
  const xs = [...new Set(all.map((d) => d.reliability))].sort((a, b) => a - b)
  const near = hover === null ? null : xs.reduce((a, b) => (Math.abs(b - hover) < Math.abs(a - hover) ? b : a))

  return (
    <Svg label="Throughput against robot reliability, current line with robots dropped in versus the redesign">
      <clipPath id="mx-reveal">
        <rect x={0} y={0} width={L + (R - L) * reveal + 2} height={H} />
      </clipPath>
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={L} x2={R} y1={y(v)} y2={y(v)} stroke={LINE} />
          <text x={L - 8} y={y(v) + 3.5} textAnchor="end" className="mx-viz-tick">{v}</text>
        </g>
      ))}
      <text x={L - 8} y={top - 4} textAnchor="end" className="mx-viz-tick">units/h</text>
      {[0.8, 0.85, 0.9, 0.95, 1].filter((v) => v >= x0).map((v) => (
        <text key={v} x={x(v)} y={B + 16} textAnchor="middle" className="mx-viz-tick">{(v * 100).toFixed(0)}%</text>
      ))}
      <text x={R} y={B + 30} textAnchor="end" className="mx-viz-tick">robot reliability (success per attempt)</text>
      <g clipPath="url(#mx-reveal)">
        {series.map((s) => (
          <g key={s.key}>
            {s.r.sweep.some((d) => d.ci95) && (
              <path
                d={`${s.r.sweep.map((d, i) => `${i ? 'L' : 'M'} ${x(d.reliability)} ${y(d.ci95?.[1] ?? d.throughput.value)}`).join(' ')} ${[...s.r.sweep].reverse().map((d) => `L ${x(d.reliability)} ${y(d.ci95?.[0] ?? d.throughput.value)}`).join(' ')} Z`}
                fill={s.color}
                opacity={0.15}
              />
            )}
            <path d={path(s.r.sweep)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
      </g>
      {series.map((s) => {
        const req = s.r.requiredReliability.value
        const pt = s.r.sweep.reduce((a, b) => (Math.abs(b.reliability - req) < Math.abs(a.reliability - req) ? b : a))
        const k = span(p, 0.7, 0.95)
        return (
          <g key={s.key} opacity={k}>
            <line x1={x(req)} x2={x(req)} y1={y(pt.throughput.value)} y2={B} stroke={s.color} strokeDasharray="3 3" />
            <circle cx={x(req)} cy={y(pt.throughput.value)} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2} />
          </g>
        )
      })}
      {series.map((s) => {
        const last = s.r.sweep[s.r.sweep.length - 1]
        return (
          <g key={s.key} opacity={span(p, 0.55, 0.8)} transform={`translate(${R + 10}, ${y(last.throughput.value)})`}>
            <text y={-2} className="mx-viz-label" style={{ fill: INK, fontWeight: 600 }}>{s.key === 'redesign' ? 'Redesign' : 'Current line'}</text>
            <text y={11} className="mx-viz-tick">{s.key === 'redesign' ? 'fixtures, kits, fallback' : 'robots dropped in'}</text>
            <text y={23} className="mx-viz-tick">needs ≥ {(s.r.requiredReliability.value * 100).toFixed(0)}% reliable</text>
          </g>
        )
      })}
      {near !== null && (
        <g pointerEvents="none">
          <line x1={x(near)} x2={x(near)} y1={top} y2={B} stroke={INK} strokeOpacity={0.3} />
          {series.map((s) => {
            const d = s.r.sweep.find((q) => q.reliability === near)
            return d ? <circle key={s.key} cx={x(near)} cy={y(d.throughput.value)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} /> : null
          })}
          <g transform={`translate(${Math.min(x(near) + 10, R - 150)}, ${top + 6})`}>
            <rect width={150} height={52} rx={5} fill={INK} />
            <text x={10} y={16} className="mx-viz-tip">{(near * 100).toFixed(1)}% reliable</text>
            {series.map((s, i) => {
              const d = s.r.sweep.find((q) => q.reliability === near)
              return (
                <text key={s.key} x={10} y={32 + i * 13} className="mx-viz-tip" style={{ fontWeight: 400 }}>
                  {s.key === 'redesign' ? 'Redesign' : 'Current'}: {d ? d.throughput.value.toFixed(1) : '–'} units/h
                </text>
              )
            })}
          </g>
        </g>
      )}
      <rect
        x={L}
        y={top}
        width={R - L}
        height={B - top}
        fill="transparent"
        onPointerMove={(e) => {
          const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
          const sx = ((e.clientX - box.left) / box.width) * W
          setHover(x0 + ((sx - L) / (R - L)) * (1 - x0))
        }}
        onPointerLeave={() => setHover(null)}
      />
    </Svg>
  )
}

export function simulateStats(data: StudioData, p: number) {
  const cur = resultFor(data, data.current)
  const red = data.designs[0] && resultFor(data, data.designs[0])
  if (!cur || !red) return null
  const k = span(p, 0.2, 0.9)
  const a = cur.throughput.value
  const b = red.throughput.value
  return { now: a, next: a + (b - a) * k, gain: (b / a - 1) * 100, rel: red.requiredReliability.value }
}

/* ---------------------------------------------------------------- 6. build */

export function BuildViz({ data, p }: { data: StudioData; p: number }) {
  const d = data.designs[0]
  if (!d) return null
  const robots = flowStations(d).filter((s) => s.staff === 'robot')
  const removed = d.operations.filter((o) => o.mode === 'eliminated').length
  const bays = flowStations(d).filter((s) => (s.bays ?? 1) > 1)
  const fallbacks = d.stations.filter((s) => s.offline).length
  return (
    <div className="mx-build">
      <div className="mx-build-row" style={{ opacity: 1 - span(p, 0.1, 0.5) * 0.6 }}>
        <span className="mx-eyebrow">Today</span>
        <StationStrip line={data.current} />
      </div>
      <div className="mx-build-arrow" style={{ opacity: span(p, 0.1, 0.35) }}>↓</div>
      <div className="mx-build-row" style={{ opacity: span(p, 0.2, 0.5) }}>
        <span className="mx-eyebrow">Redesign</span>
        <StationStrip line={d} highlight={span(p, 0.3, 0.6)} />
      </div>
      <div className="mx-build-facts" style={{ opacity: span(p, 0.45, 0.75) }}>
        <span><b className="mx-mono">{flowStations(data.current).length} → {flowStations(d).length}</b> stations</span>
        <span><b className="mx-mono">{robots.length}</b> robot cells</span>
        <span><b className="mx-mono">{bays.reduce((n, s) => n + (s.bays ?? 1), 0)}</b> test bays</span>
        <span><b className="mx-mono">{removed}</b> waste steps removed</span>
        {fallbacks > 0 && <span><b className="mx-mono">{fallbacks}</b> human fallback station{fallbacks > 1 ? 's' : ''}</span>}
      </div>
    </div>
  )
}
