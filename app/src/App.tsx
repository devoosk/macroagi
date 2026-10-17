import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import type { EventLog, Line } from './contracts/types'
import { captureLighting } from './capture/cameras'
import { CaptureRoot } from './capture/CaptureRig'
import { loadEvents, loadLine } from './lib/data'
import { captureCam, isCapture } from './lib/mode'
import { PlaybackClock } from './playback/PlaybackClock'
import { usePlayback, type DesignKey } from './playback/store'
import { FactoryEffects } from './scene/environment'
import { Factory } from './scene/Factory'
import { CameraBar, CameraDirector, SplitView, StationStatusBar, Transport } from './ui'

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
      try {
        const [rl, rlog] = await Promise.all([loadLine('line_redesign_1'), loadEvents('events_redesign_1')])
        out.redesign = { line: rl, log: rlog }
      } catch {
        // Redesign data is optional; split view hides without it.
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
    </>
  )
}

export default function App() {
  const data = useLoadedDesigns()
  const [split, setSplit] = useState(params.get('view') === 'split')
  if (!data?.current) return null

  if (isCapture) {
    const d = data[captureDesign] ?? data.current
    return <CaptureApp line={d.line} log={d.log} />
  }

  const canSplit = !!data.redesign
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {split && canSplit ? (
        <SplitView
          headerTop={88}
          canvasProps={{ shadows: true, camera: { fov: 40, near: 0.1, far: 400 } }}
          renderScene={(d) => <DemoScene design={d} data={data[d]!} syncKey="split" />}
        />
      ) : (
        <Canvas shadows camera={{ position: [20, 14, 26], fov: 40, near: 0.1, far: 400 }} style={{ position: 'absolute', inset: 0 }}>
          <PlaybackClock />
          <DemoScene design="current" data={data.current} />
        </Canvas>
      )}
      <StationStatusBar title={data.current.line.name} />
      {!split && <CameraBar />}
      <Transport />
      {canSplit && (
        <button
          onClick={() => setSplit((v) => !v)}
          style={{ position: 'absolute', right: 16, bottom: 96, padding: '8px 14px', background: '#1d232b', color: '#e6edf3', border: '1px solid #3a4452', borderRadius: 6, cursor: 'pointer', font: '600 13px system-ui' }}
        >
          {split ? 'Single view' : 'Current vs redesign'}
        </button>
      )}
    </div>
  )
}
