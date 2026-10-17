import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { isCapture } from '../lib/mode'
import { eventDensity, type PlaybackIndex } from '../playback/index'
import { usePlayback, type DesignKey } from '../playback/store'
import { useDesign } from './hooks'
import { REWORK, STATE_COLORS, formatHMS } from './theme'
import './ui.css'

export const SPEEDS = [1, 10, 60] as const

export interface TransportProps {
  /** Which loaded log feeds the density strip and failure bands. Default 'current'. */
  design?: DesignKey
  /** Seek step for arrow keys (s); shift multiplies by 6. */
  step?: number
  /** Attach global keyboard shortcuts (space, arrows, 1/2/3, Home/End, L). Default true. */
  keyboard?: boolean
  style?: CSSProperties
  className?: string
}

/** Play/pause, speed, hh:mm:ss readout and a scrubber with event density, failure bands and rework ticks. */
export function Transport({ design = 'current', step = 10, keyboard = true, style, className }: TransportProps) {
  const simTime = usePlayback((s) => s.simTime)
  const playing = usePlayback((s) => s.playing)
  const speed = usePlayback((s) => s.speed)
  const loop = usePlayback((s) => s.loop)
  const storeDuration = usePlayback((s) => s.duration)
  const d = useDesign(design)
  const duration = storeDuration || d?.index.duration || 0

  useTransportKeys(keyboard && !isCapture, step)
  if (isCapture) return null

  const pct = duration > 0 ? Math.min(1, simTime / duration) : 0
  const st = usePlayback.getState()
  return (
    <div className={`mx-root mx-panel mx-transport ${className ?? ''}`} style={style} role="toolbar" aria-label="Playback">
      <button className="mx-btn mx-btn-play" onClick={st.togglePlaying} title={playing ? 'Pause (space)' : 'Play (space)'} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? (
          <svg width="16" height="16" viewBox="0 0 16 16"><rect x="3" y="2" width="3.6" height="12" rx="1" fill="currentColor" /><rect x="9.4" y="2" width="3.6" height="12" rx="1" fill="currentColor" /></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 2.2v11.6a.8.8 0 0 0 1.2.7l9.4-5.8a.8.8 0 0 0 0-1.4L5.2 1.5A.8.8 0 0 0 4 2.2z" fill="currentColor" /></svg>
        )}
      </button>
      <div className="mx-time">
        <div className="mx-time-now" aria-live="off">{formatHMS(simTime)}</div>
        <div className="mx-time-total">/ {formatHMS(duration)} · SIM</div>
      </div>
      <Scrubber index={d?.index} duration={duration} pct={pct} />
      <div className="mx-transport-right">
        <div className="mx-legend" aria-hidden>
          <span><i style={{ background: STATE_COLORS.failed }} />Failure</span>
          <span><i style={{ background: REWORK, clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }} />Rework</span>
        </div>
        <div className="mx-seg" role="group" aria-label="Speed">
          {SPEEDS.map((s, i) => (
            <button key={s} className="mx-btn" data-active={speed === s} onClick={() => st.setSpeed(s)} title={`×${s} (${i + 1})`}>
              ×{s}
            </button>
          ))}
        </div>
        <button className="mx-btn" data-active={loop} onClick={() => st.setLoop(!loop)} title="Loop (L)" aria-label="Loop">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 7V6a2.5 2.5 0 0 1 2.5-2.5h8M11 1.5l2 2-2 2M13.5 9v1a2.5 2.5 0 0 1-2.5 2.5H3M5 14.5l-2-2 2-2" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function Scrubber({ index, duration, pct }: { index?: PlaybackIndex; duration: number; pct: number }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const bins = Math.max(40, Math.min(600, Math.floor(width / 3)))
  const density = useMemo(() => (index ? eventDensity(index, bins) : undefined), [index, bins])

  // Static strip: density bars + failure bands + rework ticks. Redrawn only on resize / new log.
  useEffect(() => {
    const c = canvas.current
    if (!c || !width) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = width
    const H = 30
    c.width = Math.round(W * dpr)
    c.height = Math.round(H * dpr)
    const g = c.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)
    if (!index || !density || duration <= 0) return
    const x = (t: number) => (t / duration) * W
    for (const [a, b] of index.failureBands) {
      g.fillStyle = 'rgba(255,69,58,0.22)'
      g.fillRect(x(a), 0, Math.max(2, x(b) - x(a)), H)
      g.fillStyle = STATE_COLORS.failed
      g.fillRect(x(a), H - 3, Math.max(2, x(b) - x(a)), 3)
    }
    let max = 1
    for (const v of density) max = Math.max(max, v)
    const bw = W / density.length
    const grad = g.createLinearGradient(0, 4, 0, H)
    grad.addColorStop(0, 'rgba(160,190,220,0.55)')
    grad.addColorStop(1, 'rgba(160,190,220,0.10)')
    g.fillStyle = grad
    for (let i = 0; i < density.length; i++) {
      const h = Math.sqrt(density[i] / max) * (H - 8)
      g.fillRect(i * bw + 0.5, H - 3 - h, Math.max(1, bw - 1), h)
    }
    g.fillStyle = REWORK
    for (const t of index.reworkTimes) {
      const px = Math.round(x(t)) + 0.5
      g.fillRect(px - 0.75, 0, 1.5, 7)
      g.beginPath()
      g.moveTo(px - 3, 0)
      g.lineTo(px + 3, 0)
      g.lineTo(px, 4)
      g.fill()
    }
  }, [index, density, duration, width])

  const timeAt = useCallback(
    (clientX: number) => {
      const el = wrap.current
      if (!el || duration <= 0) return 0
      const r = el.getBoundingClientRect()
      return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration
    },
    [duration],
  )

  const drag = useRef<{ wasPlaying: boolean } | null>(null)
  const onDown = (e: React.PointerEvent) => {
    const s = usePlayback.getState()
    drag.current = { wasPlaying: s.playing }
    s.setPlaying(false)
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    s.setTime(timeAt(e.clientX))
  }
  const onMove = (e: React.PointerEvent) => {
    const t = timeAt(e.clientX)
    setHover(t)
    if (drag.current) usePlayback.getState().setTime(t)
  }
  const onUp = () => {
    if (drag.current?.wasPlaying) usePlayback.getState().setPlaying(true)
    drag.current = null
  }

  const ticks = useMemo(() => tickMarks(duration, width), [duration, width])

  return (
    <div
      ref={wrap}
      className="mx-scrub"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => setHover(null)}
      role="slider"
      aria-label="Sim time"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(pct * duration)}
    >
      <div className="mx-scrub-track">
        <canvas ref={canvas} />
        <div className="mx-scrub-elapsed" style={{ width: `${pct * 100}%` }} />
        {hover !== null && duration > 0 && <div className="mx-scrub-hover" style={{ left: `${(hover / duration) * 100}%` }} />}
      </div>
      <div className="mx-scrub-head" style={{ left: `${pct * 100}%` }} />
      {hover !== null && duration > 0 && (
        <div className="mx-scrub-tip" style={{ left: `${(hover / duration) * 100}%` }}>
          {formatHMS(hover)}
        </div>
      )}
      <div className="mx-ticks">
        {ticks.map((t) => (
          <span key={t} className="mx-tick" style={{ left: `${(t / duration) * 100}%` }}>
            {tickLabel(t, duration)}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Tick label: h:mm for logs of an hour or more, m:ss otherwise. */
export function tickLabel(t: number, duration: number): string {
  const s = Math.round(t)
  if (duration >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Nice tick positions (s) for the scrubber. */
export function tickMarks(duration: number, width: number): number[] {
  if (duration <= 0 || width <= 0) return []
  const target = Math.max(2, Math.floor(width / 90))
  const steps = [10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400]
  const stepS = steps.find((s) => duration / s <= target) ?? 28800
  const out: number[] = []
  for (let t = stepS; t < duration - stepS * 0.3; t += stepS) out.push(t)
  return out
}

/** Global shortcuts: space play/pause, ←/→ seek (shift = ×6), 1/2/3 speed, Home/End, L loop. */
export function useTransportKeys(enabled = true, step = 10) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const s = usePlayback.getState()
      const seek = (dt: number) => s.setTime(Math.min(s.duration || Infinity, Math.max(0, s.simTime + dt)))
      switch (e.key) {
        case ' ':
          s.togglePlaying()
          break
        case 'ArrowRight':
          seek(step * (e.shiftKey ? 6 : 1))
          break
        case 'ArrowLeft':
          seek(-step * (e.shiftKey ? 6 : 1))
          break
        case '1':
        case '2':
        case '3':
          s.setSpeed(SPEEDS[Number(e.key) - 1])
          break
        case 'Home':
          s.setTime(0)
          break
        case 'End':
          s.setTime(s.duration)
          break
        case 'l':
        case 'L':
          s.setLoop(!s.loop)
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, step])
}
