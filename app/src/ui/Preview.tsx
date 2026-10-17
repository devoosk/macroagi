/**
 * Standalone preview for the playback + demo UI workstream (app/preview-ui.html).
 * Simple box stations stand in for the real Factory.
 *   ?data=fixture (default) | synthetic     ?view=single (default) | split     ?t=<sim seconds>  ?play=0
 */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas } from '@react-three/fiber'
import { Grid } from '@react-three/drei'
import type { Line } from '../contracts/types'
import { loadEvents, loadLine } from '../lib/data'
import { isCapture } from '../lib/mode'
import { hash01 } from '../lib/rng'
import { PlaybackClock } from '../playback/PlaybackClock'
import { getIndex, stateAt } from '../playback/index'
import { lineBounds, stationAnchor, unitAnchor } from '../playback/layout'
import { makeSyntheticLine, makeSyntheticLog } from '../playback/synthetic'
import { usePlayback, type DesignKey } from '../playback/store'
import type { WorkerVerb } from '../playback/types'
import { CameraBar } from './CameraBar'
import { CameraDirector } from './CameraDirector'
import { useDirector } from './director'
import { SplitView } from './SplitView'
import { StateOverlay3D } from './StateOverlay3D'
import { StationStatusBar } from './StationStatusBar'
import { Transport } from './Transport'
import './ui.css'

const params = new URLSearchParams(window.location.search)
const dataMode = params.get('data') === 'synthetic' ? 'synthetic' : 'fixture'
const view = params.get('view') === 'split' ? 'split' : 'single'

async function loadAll(): Promise<void> {
  const s = usePlayback.getState()
  if (dataMode === 'synthetic') {
    const cur = makeSyntheticLine()
    const red = makeSyntheticLine({ redesign: true })
    s.load('current', cur, makeSyntheticLog(cur, { seed: 11, duration: 7200, interArrival: 52 }))
    s.load('redesign', red, makeSyntheticLog(red, { seed: 11, duration: 7200, interArrival: 52 }))
  } else {
    const [line, log] = await Promise.all([loadLine(), loadEvents()])
    s.load('current', line, log)
    // Stand-in redesign: the same log, flagged with applied levers so badges show.
    const red: Line = { ...line, appliedLevers: line.levers.map((l) => l.id) }
    s.load('redesign', red, log)
  }
  const t = Number(params.get('t'))
  if (Number.isFinite(t) && t > 0) s.setTime(t)
  s.setSpeed(dataMode === 'synthetic' ? 60 : 10)
  s.setPlaying(params.get('play') !== '0')
}

const VERB_COLORS: Partial<Record<WorkerVerb, string>> = {
  idle: '#6b7280',
  blocked: '#f5a524',
  braze: '#ff7a3d',
  screw: '#9fd3ff',
  inspect: '#c4b5fd',
  connect: '#86efac',
  place: '#fde68a',
  pick: '#fcd34d',
  insert: '#a7f3d0',
  search: '#fca5a5',
  walk: '#e5e7eb',
}

/** Box-station stand-in scene for one design. */
function PreviewScene({ design, syncKey }: { design: DesignKey; syncKey?: string }) {
  const t = usePlayback((s) => s.simTime)
  const line = usePlayback((s) => s.lines[design])
  const log = usePlayback((s) => s.logs[design])
  if (!line || !log) return null
  const state = stateAt(getIndex(line, log), t)
  const [x0, x1] = lineBounds(line)
  const variants = new Map(line.variants.map((v) => [v.id, v.kw]))
  return (
    <>
      <color attach="background" args={['#0d1014']} />
      <fog attach="fog" args={['#0d1014', 40, 140]} />
      <hemisphereLight args={['#dbe8ff', '#2a2f38', 1.4]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[x0 + 10, 18, 10]} intensity={2.6} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={20} shadow-camera-bottom={-20} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow position={[(x0 + x1) / 2, 0, 0]}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#2a2f37" roughness={0.9} metalness={0.02} />
      </mesh>
      <Grid position={[0, 0.002, 0]} infiniteGrid cellSize={1} sectionSize={4.5} cellColor="#2c323c" sectionColor="#3a4452" fadeDistance={70} cellThickness={0.6} sectionThickness={1} />
      {/* conveyor */}
      <mesh position={[(x0 + x1) / 2, 0.35, 0]} receiveShadow castShadow>
        <boxGeometry args={[x1 - x0 + 2, 0.08, 0.7]} />
        <meshStandardMaterial color="#2b313a" metalness={0.6} roughness={0.4} />
      </mesh>
      {line.stations.map((s) => {
        const n = s.bays ?? 1
        return Array.from({ length: n }, (_, b) => {
          const [x, , z] = stationAnchor(line, s.id, n > 1 ? b : undefined)
          const key = n > 1 ? `${s.id}#${b}` : s.id
          const w = state.workers[key] ?? state.workers[s.id]
          const bob = w.operation ? Math.sin(w.phase * Math.PI * 6 + hash01(key, w.cycle) * 6) * 0.05 : 0
          const robot = s.staff === 'robot'
          return (
            <group key={key} position={[x, 0, z]} rotation-y={s.rot}>
              <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
                <boxGeometry args={[2, 0.9, 1.2]} />
                <meshStandardMaterial color="#5d6776" metalness={0.25} roughness={0.55} />
              </mesh>
              <mesh position={[0, 0.91, 0]} receiveShadow>
                <boxGeometry args={[2.04, 0.03, 1.24]} />
                <meshStandardMaterial color="#8d97a6" metalness={0.4} roughness={0.35} />
              </mesh>
              {/* worker / robot stand-in */}
              <group position={[0, 0, -1.15]}>
                <mesh position={[0, 0.9 + bob, 0]} castShadow>
                  {robot ? <cylinderGeometry args={[0.22, 0.3, 1.5, 16]} /> : <capsuleGeometry args={[0.22, 1.0, 6, 12]} />}
                  <meshStandardMaterial color={robot ? '#e8a33a' : isCapture ? '#7b8494' : VERB_COLORS[w.verb] ?? '#9ca3af'} roughness={0.55} />
                </mesh>
                {!robot && (
                  <mesh position={[0, 1.78 + bob, 0]} castShadow>
                    <sphereGeometry args={[0.17, 16, 12]} />
                    <meshStandardMaterial color="#e2c7a6" roughness={0.7} />
                  </mesh>
                )}
                {w.verb === 'braze' && (
                  <pointLight position={[0.3, 1.1, 0.5]} color="#ff9b4a" intensity={2 + 2 * Math.abs(Math.sin(w.phase * 40))} distance={3} />
                )}
              </group>
            </group>
          )
        })
      })}
      {state.units.map((u) => {
        const [x, , z] = unitAnchor(line, u)
        const kw = variants.get(u.variant) ?? 9
        const sz = 0.45 + kw * 0.025
        const travelling = u.motion === 'transit'
        return (
          <group key={u.unit} position={[x, (travelling ? 0.39 : 0.92) + sz / 2, z]}>
            <mesh castShadow>
              <boxGeometry args={[sz * 1.3, sz, sz * 0.7]} />
              <meshStandardMaterial color={u.reworks > 0 ? '#c9b8a0' : '#d9dde3'} metalness={0.3} roughness={0.45} />
            </mesh>
            {u.stage >= 3 && (
              <mesh position={[0, 0, sz * 0.36]} rotation-x={Math.PI / 2}>
                <cylinderGeometry args={[sz * 0.32, sz * 0.32, 0.02, 24]} />
                <meshStandardMaterial color="#1f2937" metalness={0.5} roughness={0.4} />
              </mesh>
            )}
          </group>
        )
      })}
      <StateOverlay3D line={line} state={state} />
      <CameraDirector design={design} syncKey={syncKey} />
    </>
  )
}

function ViewSwitch() {
  if (isCapture) return null
  const link = (k: string, v: string) => {
    const p = new URLSearchParams(window.location.search)
    p.set(k, v)
    return `?${p.toString()}`
  }
  return (
    <div className="mx-root mx-panel" style={{ position: 'absolute', left: 16, top: view === 'split' ? 'auto' : 112, bottom: view === 'split' ? 104 : 'auto', zIndex: 20, display: 'flex', gap: 8, padding: 6, alignItems: 'center' }}>
      <span className="mx-eyebrow" style={{ padding: '0 6px' }}>View</span>
      <div className="mx-seg">
        <a className="mx-btn" data-active={view === 'single'} href={link('view', 'single')} style={{ textDecoration: 'none', fontFamily: 'var(--mx-font)' }}>Single</a>
        <a className="mx-btn" data-active={view === 'split'} href={link('view', 'split')} style={{ textDecoration: 'none', fontFamily: 'var(--mx-font)' }}>Split</a>
      </div>
      <span className="mx-eyebrow" style={{ padding: '0 6px' }}>Data</span>
      <div className="mx-seg">
        <a className="mx-btn" data-active={dataMode === 'fixture'} href={link('data', 'fixture')} style={{ textDecoration: 'none', fontFamily: 'var(--mx-font)' }}>Fixture</a>
        <a className="mx-btn" data-active={dataMode === 'synthetic'} href={link('data', 'synthetic')} style={{ textDecoration: 'none', fontFamily: 'var(--mx-font)' }}>Synthetic 2 h</a>
      </div>
    </div>
  )
}

export function Preview() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    loadAll().then(() => setReady(true))
  }, [])
  if (!ready) return null
  return (
    <div className="mx-root" style={{ position: 'fixed', inset: 0, background: 'var(--mx-bg)' }}>
      {view === 'split' ? (
        <SplitView renderScene={(d) => <PreviewScene design={d} syncKey="preview" />} canvasProps={{ shadows: true, dpr: [1, 2] }} />
      ) : (
        <>
          <Canvas shadows dpr={[1, 2]} camera={{ position: [4, 8, 14], fov: 45 }} style={{ position: 'absolute', inset: 0 }}>
            <PlaybackClock />
            <PreviewScene design="current" />
          </Canvas>
          <StationStatusBar title={usePlayback.getState().lines.current?.name ?? 'Line'} />
          <CameraBar />
        </>
      )}
      <ViewSwitch />
      <Transport />
    </div>
  )
}

// Handles for scripted screenshots.
Object.assign(window, { __playback: usePlayback, __director: useDirector })

const el = document.getElementById('preview-root')
if (el) createRoot(el).render(<StrictMode><Preview /></StrictMode>)
