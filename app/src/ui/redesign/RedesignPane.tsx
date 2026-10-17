import { useEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import type { Line } from '../../contracts/types'
import { loadStudioData, type StudioData } from './data'
import {
  BuildViz,
  CapabilityViz,
  CaptureViz,
  GraphViz,
  OptimiseViz,
  SimulateViz,
  capabilityCaption,
  captureCaption,
  graphCaption,
  optimiseCaption,
  simulateStats,
} from './steps'
import '../ui.css'

export type RedesignPhase = 'idle' | 'running' | 'review' | 'done'

interface RedesignFlow {
  phase: RedesignPhase
  setPhase: (p: RedesignPhase) => void
}

/** Where the right pane is: empty launcher, the analysis sequence, or the 3D redesign. */
export const useRedesignFlow = create<RedesignFlow>((set) => ({
  phase: new URLSearchParams(window.location.search).get('redesign') === 'done' ? 'done' : 'idle',
  setPhase: (phase) => set({ phase }),
}))

interface Step {
  key: string
  title: string
  /** Seconds in autoplay. */
  dur: number
  caption: (d: StudioData) => string
  render: (d: StudioData, p: number) => ReactNode
}

const STEPS: Step[] = [
  { key: 'capture', title: 'Capture', dur: 4, caption: captureCaption, render: (d, p) => <CaptureViz data={d} p={p} /> },
  { key: 'graph', title: 'Process graph', dur: 3.6, caption: graphCaption, render: (d, p) => <GraphViz data={d} p={p} /> },
  { key: 'capability', title: 'Robot capability', dur: 4, caption: capabilityCaption, render: (d, p) => <CapabilityViz data={d} p={p} /> },
  { key: 'optimise', title: 'Optimise', dur: 4, caption: optimiseCaption, render: (d, p) => <OptimiseViz data={d} p={p} /> },
  {
    key: 'simulate',
    title: 'Simulate',
    dur: 4.4,
    caption: () => 'Each design runs through the SimPy line simulator across robot reliability, with a human fallback station catching robot failures.',
    render: (d, p) => <SimulateViz data={d} p={p} />,
  },
  {
    key: 'build',
    title: 'Build',
    dur: 2.6,
    caption: () => 'The chosen design becomes the new line.',
    render: (d, p) => <BuildViz data={d} p={p} />,
  },
]

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * Real-time progress (0..1) of the current step. This is UI animation in the demo
 * view only, not scene state, so it runs on wall-clock time.
 */
function useStepProgress(step: number, running: boolean, dur: number) {
  const [p, setP] = useState(0)
  const start = useRef(0)
  useEffect(() => {
    if (reducedMotion()) {
      setP(1)
      return
    }
    setP(0)
    start.current = performance.now()
    let raf = 0
    const tick = () => {
      const v = Math.min(1, (performance.now() - start.current) / (dur * 1000))
      setP(v)
      if (v < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [step, running, dur])
  return p
}

/** Right pane before the redesign exists: a launcher, then the analysis sequence. */
export function RedesignPane({ current }: { current: Line }) {
  const phase = useRedesignFlow((s) => s.phase)
  const setPhase = useRedesignFlow((s) => s.setPhase)
  const [data, setData] = useState<StudioData>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (phase === 'idle' || data) return
    loadStudioData(current).then(setData, (e) => setError(String(e)))
  }, [phase, current, data])

  if (phase === 'idle') {
    return (
      <div className="mx-root mx-launch">
        <div className="mx-launch-inner">
          <div className="mx-eyebrow">Proposed</div>
          <h2>Redesign this line for robots</h2>
          <button className="mx-btn mx-btn-primary" onClick={() => setPhase('running')}>
            Redesign
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </button>
          <ol className="mx-launch-steps">
            {STEPS.map((s, i) => (
              <li key={s.key}>
                <span className="mx-mono">{String(i + 1).padStart(2, '0')}</span>
                {s.title}
              </li>
            ))}
          </ol>
        </div>
      </div>
    )
  }
  if (error) return <div className="mx-root mx-launch"><p className="mx-viz-empty">Could not load the analysis data: {error}</p></div>
  if (!data) return <div className="mx-root mx-launch"><p className="mx-eyebrow">Loading analysis…</p></div>
  return <Studio data={data} autoplay={phase === 'running'} onDone={() => setPhase('done')} />
}

function Studio({ data, autoplay, onDone }: { data: StudioData; autoplay: boolean; onDone: () => void }) {
  const [step, setStep] = useState(0)
  const s = STEPS[step]
  const p = useStepProgress(step, autoplay, s.dur)
  const last = step === STEPS.length - 1

  useEffect(() => {
    if (!autoplay || p < 1) return
    // Hold the finished frame briefly so each result can be read.
    const t = setTimeout(() => (last ? onDone() : setStep(step + 1)), reducedMotion() ? 2500 : 700)
    return () => clearTimeout(t)
  }, [autoplay, p, last, step, onDone])

  const stats = s.key === 'simulate' ? simulateStats(data, p) : null
  const total = STEPS.reduce((n, x) => n + x.dur, 0)
  const done = STEPS.slice(0, step).reduce((n, x) => n + x.dur, 0) + s.dur * p

  return (
    <div className="mx-root mx-studio">
      <ol className="mx-studio-rail">
        {STEPS.map((x, i) => (
          <li key={x.key}>
            <button
              data-state={i < step ? 'done' : i === step ? 'active' : 'todo'}
              disabled={autoplay}
              onClick={() => setStep(i)}
              aria-current={i === step ? 'step' : undefined}
            >
              <span className="mx-mono">{String(i + 1).padStart(2, '0')}</span>
              {x.title}
            </button>
          </li>
        ))}
      </ol>
      <div className="mx-studio-head" key={s.key}>
        <div>
          <div className="mx-eyebrow">Step {step + 1} of {STEPS.length}</div>
          <h3>{s.title}</h3>
          <p>{s.caption(data)}</p>
        </div>
        {stats && (
          <div className="mx-studio-hero">
            <div className="mx-eyebrow">Throughput</div>
            <div className="mx-studio-hero-n mx-mono">
              {stats.next.toFixed(1)}
              <small>units/h</small>
            </div>
            <div className="mx-studio-hero-sub">
              from <span className="mx-mono">{stats.now.toFixed(1)}</span> today
              {p > 0.85 && <span className="mx-delta" data-sign="+">+{stats.gain.toFixed(0)}%</span>}
            </div>
          </div>
        )}
      </div>
      <div className="mx-studio-viz">{s.render(data, p)}</div>
      <div className="mx-studio-foot">
        <div className="mx-studio-progress" aria-hidden>
          <div style={{ width: `${(done / total) * 100}%` }} />
        </div>
        {autoplay ? (
          <button className="mx-btn" onClick={onDone}>Skip to redesign</button>
        ) : (
          <>
            <button className="mx-btn" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
            {last ? (
              <button className="mx-btn mx-btn-primary" onClick={onDone}>Show redesign</button>
            ) : (
              <button className="mx-btn mx-btn-primary" onClick={() => setStep(step + 1)}>Next</button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** Small control over the 3D redesign: reopen the analysis or start over. */
export function RedesignControls() {
  const setPhase = useRedesignFlow((s) => s.setPhase)
  return (
    <div className="mx-root mx-panel mx-redesign-ctl">
      <button className="mx-btn" onClick={() => setPhase('review')}>Analysis</button>
      <button className="mx-btn" onClick={() => setPhase('running')} title="Replay the redesign sequence">Replay</button>
    </div>
  )
}
