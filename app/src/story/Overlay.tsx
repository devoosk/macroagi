import type { CSSProperties, ReactNode } from 'react'
import { useT } from './clock'
import type { Loaded } from './data'
import { useSwarm } from './Swarm'
import { FONT, T, ease, lerp, night, pulse, seg } from './theme'

const ink = (t: number, a = 1) => {
  const v = Math.round(lerp(26, 255, night(t)))
  return `rgba(${v},${v},${v},${a})`
}

const label: CSSProperties = { fontSize: 12, fontWeight: 500, letterSpacing: '0.16em', textTransform: 'uppercase' }

/** MicroAGI-style headline: lowercase, tight, words reveal from grey to ink. */
function Headline({ text, at, until, size = 64, style }: { text: string; at: number; until: number; size?: number; style?: CSSProperties }) {
  const t = useT()
  if (t < at - 0.1 || t > until + 0.6) return null
  const out = 1 - seg(t, until, until + 0.5)
  return (
    <div style={{ fontSize: size, fontWeight: 500, letterSpacing: '-0.04em', lineHeight: 1.02, maxWidth: '16em', ...style }}>
      {text.split(' ').map((w, i) => {
        const k = ease(seg(t, at + i * 0.09, at + i * 0.09 + 0.45))
        return (
          <span key={i} style={{ color: ink(t, (0.18 + 0.82 * k) * out), display: 'inline-block', transform: `translateY(${(1 - k) * 0.25}em)` }}>
            {w}&nbsp;
          </span>
        )
      })}
    </div>
  )
}

/** Small uppercase layer label, like "LAYER / 02" on the Atlas page. */
function Layer({ n, name, w }: { n: string; name: string; w: readonly [number, number] }) {
  const t = useT()
  const k = pulse(t, w[0], w[1], 0.4)
  if (k <= 0) return null
  return (
    <div style={{ ...label, color: ink(t, 0.7 * k), position: 'absolute', left: 48, top: 112 }}>
      layer / {n} &nbsp;·&nbsp; {name}
    </div>
  )
}

const fmt = (x: number, d = 0) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })

function Stat({ big, small, k, t }: { big: ReactNode; small: string; k: number; t: number }) {
  return (
    <div style={{ opacity: k, transform: `translateY(${(1 - k) * 16}px)`, flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 46, fontWeight: 500, letterSpacing: '-0.04em', color: ink(t), whiteSpace: 'nowrap' }}>{big}</div>
      <div style={{ ...label, color: ink(t, 0.55), marginTop: 6 }}>{small}</div>
    </div>
  )
}

/** Two tracks in the style of MicroAGI's "with us / without us" timeline: units flow twice as fast on the redesign. */
function Tracks({ today, gaia, t, k }: { today: number; gaia: number; t: number; k: number }) {
  const row = (name: string, rate: number, solid: boolean, y: number) => {
    const n = 7
    return (
      <g transform={`translate(0 ${y})`}>
        <text x={0} y={5} fontSize={22} fontWeight={500} letterSpacing="-0.03em" fill={ink(t, solid ? 1 : 0.4)} fontFamily={FONT}>
          {name}
        </text>
        <line x1={110} x2={110 + 620 * k} y1={0} y2={0} stroke={ink(t, solid ? 0.9 : 0.35)} strokeWidth={solid ? 1.5 : 1} strokeDasharray={solid ? undefined : '2 5'} />
        {k > 0.98 &&
          Array.from({ length: n }, (_, i) => {
            const p = ((t - T.results[0]) * rate * 0.045 + i / n) % 1
            return <rect key={i} x={110 + p * 620 - 4} y={-4} width={8} height={8} fill={ink(t, solid ? 1 : 0.35)} />
          })}
      </g>
    )
  }
  return (
    <svg width={760} height={110} style={{ overflow: 'visible' }}>
      {row('today', today, false, 25)}
      {row('gaia', gaia, true, 80)}
    </svg>
  )
}

export function Overlay({ data }: { data: Loaded }) {
  const t = useT()
  const sw = useSwarm(data.story)
  const cur = data.results.designs.find((d) => d.design.endsWith('_current')) ?? data.results.designs[0]
  const best = data.results.designs.find((d) => d.design.includes('rebuild')) ?? data.results.designs.find((d) => d.rank === 1) ?? data.results.designs[data.results.designs.length - 1]
  const wave = data.results.designs.find((d) => d.design.endsWith('solver_1'))
  const today = data.story.swarm.current
  const bestCost = best.cost3y?.value ?? data.story.swarm.winners[0].cost
  const unitDrop = 1 - bestCost / best.throughput.value / (today.cost / cur.throughput.value)
  const vsWave = wave?.cost3y ? 1 - bestCost / wave.cost3y.value : 0
  const people = (l: typeof data.line) => l.stations.filter((s) => s.staff === 'human' && !s.offline).reduce((n, s) => n + (s.bays ?? 1), 0)
  const fleet = data.redesign.design?.fleet ?? []
  const rain = seg(t, T.swarm[0] + 0.2, T.swarm[0] + 4.2)
  const res = (i: number) => ease(seg(t, T.results[0] + 0.9 + i * 0.35, T.results[0] + 1.6 + i * 0.35)) * (1 - seg(t, T.results[1], T.results[1] + 0.5))
  const cards = pulse(t, T.morph[0] + 2.6, T.results[0] + 0.4, 0.5)
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', fontFamily: FONT, color: ink(t) }}>
      {/* chrome, like microagi.ai's navigation bar */}
      <div style={{ position: 'absolute', left: 48, top: 40, fontSize: 26, letterSpacing: '-0.03em', color: ink(t) }}>
        macro<i style={{ fontFamily: 'Georgia, serif', fontWeight: 400 }}>agi</i>
      </div>
      <div style={{ ...label, position: 'absolute', right: 48, top: 36, padding: '12px 24px', border: `1px solid ${ink(t, 0.5)}`, color: ink(t) }}>gaia</div>

      <div style={{ position: 'absolute', left: 48, bottom: 64 }}>
        <Headline text="we have seen this before." at={0.5} until={3.4} />
        <Headline text="new motor. same old shafts." at={3.7} until={6.6} />
        <Headline text="robots where people stood." at={8} until={11.2} />
        <Headline text="microagi puts robots where people stood." at={T.world[0] + 5.6} until={T.world[1] + 1} size={44} style={{ marginBottom: 8 }} />
        <Headline text="gaia redesigns the world for them." at={T.world[0] + 7} until={T.world[1] + 1} size={44} />
      </div>
      {pulse(t, 4.6, 6.8, 0.4) > 0 && (
        <div style={{ position: 'absolute', right: 64, top: 140, textAlign: 'right', opacity: pulse(t, 4.6, 6.8, 0.4) }}>
          <div style={{ fontSize: 96, fontWeight: 500, letterSpacing: '-0.05em' }}>+{Math.round(40 * ease(seg(t, 4.7, 6)))} years</div>
          <div style={{ ...label, color: ink(t, 0.55) }}>until the gains came</div>
        </div>
      )}
      {pulse(t, 8, 11.2, 0.4) > 0 && <div style={{ ...label, position: 'absolute', left: 48, top: 112, color: ink(t, 0.6 * pulse(t, 8, 11.2, 0.4)) }}>wave one · robot by robot</div>}
      {pulse(t, T.turn[0], T.turn[1] + 0.6, 0.4) > 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: pulse(t, T.turn[0], T.turn[1] + 0.6, 0.4) }}>
          <div style={{ fontSize: 180, fontWeight: 500, letterSpacing: '-0.06em', lineHeight: 1 }}>gaia</div>
          <div style={{ ...label, marginTop: 18, color: ink(t, 0.6) }}>wave two · redesign the line for robots</div>
        </div>
      )}

      <Layer n="01" name="capture" w={T.feeds} />
      <Layer n="02" name="process graph" w={T.graph} />
      <Layer n="03" name="bottlenecks" w={T.focus} />
      <Layer n="04" name="optimise" w={T.swarm} />
      <Layer n="05" name="redesign" w={[T.morph[0], T.results[1]]} />

      {pulse(t, T.swarm[0], T.swarm[1], 0.4) > 0 && (
        <div style={{ position: 'absolute', right: 64, bottom: 64, textAlign: 'right', opacity: pulse(t, T.swarm[0], T.swarm[1], 0.4) }}>
          <div style={{ fontSize: 72, fontWeight: 500, letterSpacing: '-0.05em', fontVariantNumeric: 'tabular-nums' }}>{fmt(Math.round(sw.evaluated * ease(rain)))}</div>
          <div style={{ ...label, color: ink(t, 0.55) }}>line designs scored</div>
        </div>
      )}

      {cards > 0 && (
        <div style={{ position: 'absolute', left: 48, right: 48, bottom: 56, display: 'flex', gap: 16, opacity: cards }}>
          {fleet.map((f, i) => {
            const k = ease(seg(t, T.morph[0] + 2.6 + i * 0.3, T.morph[0] + 3.2 + i * 0.3))
            return (
              <div key={f.robot} style={{ flex: 1, padding: '18px 20px', border: `1px solid ${ink(t, 0.25)}`, background: 'rgba(255,255,255,0.6)', opacity: k, transform: `translateY(${(1 - k) * 14}px)` }}>
                <div style={{ ...label, color: ink(t, 0.5) }}>/0.{i + 1} / rented robot{f.count > 1 ? ` × ${f.count}` : ''}</div>
                <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.03em', marginTop: 10 }}>{f.name.toLowerCase()}</div>
                <div style={{ ...label, marginTop: 10 }}>€{fmt(f.rentPerMonth.value)} / month</div>
              </div>
            )
          })}
        </div>
      )}

      {res(0) > 0 && (
        <div style={{ position: 'absolute', left: 48, right: 48, bottom: 56 }}>
          <div style={{ opacity: res(0) }}>
            <Tracks today={cur.throughput.value} gaia={best.throughput.value} t={t} k={ease(seg(t, T.results[0] + 0.3, T.results[0] + 1.3))} />
          </div>
          <div style={{ display: 'flex', gap: 48, marginTop: 36 }}>
            <Stat t={t} k={res(1)} big={`${fmt((best.throughput.value / cur.throughput.value) * ease(res(1)), 1)}×`} small={`output · ${fmt(cur.throughput.value, 1)} → ${fmt(best.throughput.value, 1)} units / h`} />
            <Stat t={t} k={res(2)} big={`−${fmt(unitDrop * 100 * ease(res(2)))}%`} small="cost per unit · 3 years" />
            <Stat t={t} k={res(3)} big={`−${fmt(vsWave * 100 * ease(res(3)))}%`} small="vs robots where people stood" />
            <Stat t={t} k={res(4)} big={`${people(data.line)} → ${people(data.redesign)}`} small="people per shift" />
            <Stat t={t} k={res(5)} big={`€${fmt((best.rentPerMonth?.value ?? 0) / 1000, 1)}k`} small="robot rent / month · no capex risk" />
          </div>
          <div style={{ ...label, fontSize: 10, color: ink(t, 0.4), marginTop: 22, opacity: res(5) }}>simulated · 200 × 8 h shifts per design · rental prices are demo estimates</div>
        </div>
      )}

      {seg(t, T.world[1] - 1.6, T.world[1] - 0.8) > 0 && (
        <div style={{ position: 'absolute', right: 64, bottom: 64, textAlign: 'right', opacity: seg(t, T.world[1] - 1.6, T.world[1] - 0.8) }}>
          <div style={{ fontSize: 56, letterSpacing: '-0.04em' }}>
            macro<i style={{ fontFamily: 'Georgia, serif' }}>agi</i>
          </div>
          <div style={{ ...label, color: ink(t, 0.6), marginTop: 6 }}>gaia · the world of atlases</div>
        </div>
      )}
    </div>
  )
}
