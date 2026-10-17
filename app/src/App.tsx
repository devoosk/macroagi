import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import type { EventLog, Line } from './contracts/types'
import { captureLighting } from './capture/cameras'
import { CaptureRoot } from './capture/CaptureRig'
import { loadEvents, loadLine } from './lib/data'
import { captureCam, isCapture } from './lib/mode'
import { PlaybackClock } from './playback/PlaybackClock'
import { usePlayback, type DesignKey } from './playback/store'
import { FactoryEffects, QUALITY_PRESETS } from './scene/environment'
import { Factory } from './scene/Factory'
import { CameraBar, CameraDirector, RenderStats, SplitView, StationStatusBar, Transport, statsEnabled } from './ui'
import { RedesignControls, RedesignPane, useRedesignFlow } from './ui/redesign/RedesignPane'

/**
 * Demo renderer settings: dpr capped (1.5 on high-DPI screens) and no MSAA on the drawing buffer,
 * since the effect composer already multisamples the scene and only blits to the canvas.
 */
const DEMO_GL = { dpr: QUALITY_PRESETS.demo.dpr, gl: { antialias: false, powerPreference: 'high-performance' as const } }

type Loaded = Partial<Record<DesignKey, { line: Line; log: EventLog }>>

const params = new URLSearchParams(window.location.search)
/** Which design capture mode films: `?design=redesign` (default current). */
const captureDesign: DesignKey = params.get('design') === 'redesign' ? 'redesign' : 'current'

function useLoadedDesigns() {
  const [data, setData] = useState<Loaded>()
  useEffect(() => {
    const load = async () => {
      const [line, log] = await Promise.all([loadLine('line'), loadEvents('events_current')])
      const out: Loaded = { current: { line, log } }
      // The solver's best design (optimize.compare); the tools/gen stand-in until that exists.
      for (const [l, e] of [['line_solver_1', 'events_solver_1'], ['line_redesign_1', 'events_redesign_1']]) {
        try {
          const [rl, rlog] = await Promise.all([loadLine(l), loadEvents(e)])
          out.redesign = { line: rl, log: rlog }
          break
        } catch {
          // Redesign data is optional; split view hides without it.
        }
      }
      const store = usePlayback.getState()
      for (const [k, d] of Object.entries(out) as [DesignKey, { line: Line; log: EventLog }][]) store.load(k, d.line, d.log)
      if (!isCapture) {
        // Start after the generator's warm-up so the line is full; `?t=<s>` overrides.
        store.setTime(Number(params.get('t') ?? 1800))
        store.setPlaying(params.get('play') !== '0')
      }
      setData(out)
    }
    load()
  }, [])
  return data
}

function CaptureApp({ line, log }: { line: Line; log: EventLog }) {
  const simTime = usePlayback((s) => s.simTime)
  // Lighting varies per 120 s window and camera (seeded), never per unit cycle.
  const light = captureLighting(simTime, captureCam ?? '')
  return (
    <CaptureRoot line={line}>
      <Factory line={line} log={log} lightSeed={`${captureCam}:${light.intensity.toFixed(3)}`} />
      <FactoryEffects quality="capture" grainSeed={Math.floor(simTime)} />
    </CaptureRoot>
  )
}

function DemoScene({ design, data, syncKey }: { design: DesignKey; data: { line: Line; log: EventLog }; syncKey?: string }) {
  return (
    <>
      <Factory line={data.line} log={data.log} />
      <CameraDirector design={design} syncKey={syncKey} />
      <FactoryEffects quality="demo" />
      {statsEnabled && <RenderStats label={design} />}
    </>
  )
}

export default function App() {
  const data = useLoadedDesigns()
  const [split, setSplit] = useState(params.get('view') !== 'single')
  const redesignPhase = useRedesignFlow((s) => s.phase)
  if (!data?.current) return null

  if (isCapture) {
    const d = data[captureDesign] ?? data.current
    return <CaptureApp line={d.line} log={d.log} />
  }

  const canSplit = !!data.redesign
  return (
    <div className="mx-root mx-app">
      <header className="mx-panel mx-topbar">
        <div className="mx-brand">
          <span className="mx-brand-name">MacroAGI</span>
          <span className="mx-eyebrow">{data.current.line.name}</span>
        </div>
        <div className="mx-topbar-right">
          <CameraBar />
          {canSplit && (
            <div className="mx-seg" role="group" aria-label="View">
              <button className="mx-btn" style={{ fontFamily: 'var(--mx-font)' }} data-active={split} onClick={() => setSplit(true)}>
                Current vs redesign
              </button>
              <button className="mx-btn" style={{ fontFamily: 'var(--mx-font)' }} data-active={!split} onClick={() => setSplit(false)}>
                Current only
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-stage">
        {split && canSplit ? (
          <SplitView
            canvasProps={{ ...DEMO_GL, shadows: true, camera: { fov: 40, near: 0.1, far: 400 } }}
            renderScene={(d) => <DemoScene design={d} data={data[d]!} syncKey="split" />}
            replace={{ redesign: redesignPhase !== 'done' ? <RedesignPane current={data.current.line} /> : undefined }}
            renderOverlay={(d) => (d === 'redesign' && redesignPhase === 'done' ? <RedesignControls /> : null)}
          />
        ) : (
          <div className="mx-stage-pane">
            <Canvas {...DEMO_GL} shadows camera={{ position: [20, 14, 26], fov: 40, near: 0.1, far: 400 }}>
              <PlaybackClock />
              <DemoScene design="current" data={data.current} />
            </Canvas>
          </div>
        )}
      </main>
      <footer className="mx-panel mx-dock">
        <StationStatusBar className="mx-docked" title="Current line" />
        <Transport className="mx-docked" />
      </footer>
    </div>
  )
}
