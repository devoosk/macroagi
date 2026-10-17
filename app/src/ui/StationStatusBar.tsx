import type { CSSProperties } from 'react'
import { isCapture } from '../lib/mode'
import { completedAt, stateAt, utilisationAt } from '../playback/index'
import { usePlayback, type DesignKey } from '../playback/store'
import { useDirector } from './director'
import { useDesign } from './hooks'
import { LEVER_LABELS, STATE_COLORS, STATE_LABELS, stationLevers } from './theme'
import './ui.css'

export interface StationStatusBarProps {
  design?: DesignKey
  /** Called after a chip click (the camera director is told to fly there regardless). */
  onSelect?: (station: string) => void
  /** Label in the left KPI block. */
  title?: string
  /** Flag the highest-utilisation station as the bottleneck after this much sim time (s). */
  bottleneckAfter?: number
  style?: CSSProperties
  className?: string
}

/** Compact row of station chips: state colour, bay dots, utilisation so far, lever and bottleneck tags. */
export function StationStatusBar({ design = 'current', onSelect, title = 'Line', bottleneckAfter = 600, style, className }: StationStatusBarProps) {
  const t = usePlayback((s) => s.simTime)
  const d = useDesign(design)
  const selected = useDirector((s) => (s.mode === 'station' ? s.station : undefined))
  if (isCapture || !d) return null
  const { line, index } = d
  const state = stateAt(index, t)
  const utils = line.stations.map((s) => utilisationAt(index, s.id, t))
  const maxU = Math.max(...utils)
  const bottleneck = t >= bottleneckAfter && maxU > 0 ? line.stations[utils.indexOf(maxU)]?.id : undefined
  const done = completedAt(index, t)
  const rate = t > 60 ? (done / t) * 3600 : 0

  return (
    <div className={`mx-root mx-panel mx-status ${className ?? ''}`} style={style}>
      <div className="mx-status-head">
        <div className="mx-eyebrow">{title}</div>
        <div className="mx-status-kpi mx-mono">
          {done}
          <small>units</small>
        </div>
        <div className="mx-eyebrow" style={{ letterSpacing: '0.04em', textTransform: 'none' }}>
          <span className="mx-mono" style={{ color: 'var(--mx-text)' }}>{rate.toFixed(1)}</span> / h · {state.units.length} WIP
        </div>
      </div>
      <div className="mx-chips">
        {line.stations.map((s, i) => {
          const st = state.stations[s.id] ?? 'idle'
          const bays = (s.bays ?? 1) > 1 ? Object.keys(state.bays).filter((k) => k.startsWith(`${s.id}#`)) : []
          const levers = stationLevers(line, s.id)
          const u = utils[i]
          return (
            <button
              key={s.id}
              className="mx-chip"
              data-state={st}
              data-selected={selected === s.id}
              style={{ ['--mx-chip-color' as string]: STATE_COLORS[st] }}
              onClick={() => {
                useDirector.getState().flyTo(s.id)
                onSelect?.(s.id)
              }}
              title={`${s.id} ${s.name}: ${STATE_LABELS[st]} · ${(u * 100).toFixed(0)}% utilised${levers.length ? ' · ' + levers.map((l) => l.type).join(', ') : ''}`}
            >
              {bottleneck === s.id && <span className="mx-chip-tag">BOTTLENECK</span>}
              {levers.length > 0 && <span className="mx-chip-tag" data-kind="lever">{LEVER_LABELS[levers[0].type]}{levers.length > 1 ? ` +${levers.length - 1}` : ''}</span>}
              <div className="mx-chip-top">
                <span className="mx-chip-id">{s.id}</span>
                {bays.length > 0 ? (
                  <span className="mx-bays">
                    {bays.map((k) => (
                      <i key={k} style={{ background: STATE_COLORS[state.bays[k]] }} />
                    ))}
                  </span>
                ) : (
                  <span className="mx-chip-state">{STATE_LABELS[st]}</span>
                )}
              </div>
              <div className="mx-chip-name">{s.name}</div>
              <div className="mx-chip-util">
                <div className="mx-chip-bar">
                  <div style={{ width: `${u * 100}%`, background: bottleneck === s.id ? STATE_COLORS.blocked : undefined }} />
                </div>
                <span className="mx-chip-pct">{(u * 100).toFixed(0)}%</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
