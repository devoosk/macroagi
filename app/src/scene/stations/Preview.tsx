import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { Station, StationKind, Variant } from '../../contracts/types'
import type { StationState } from '../../playback/store'
import { ConveyorLine, ProceduralEnvironment, StationModel } from './index'
import { ProductUnit, STAGE_ORDER, UnitsOnLine, type UnitOnLine } from '../units'

/**
 * Standalone preview for the station + product workstream (preview-stations.html).
 * URL params: t=<simTime>, cam=x,y,z, look=x,y,z, play=1, state=<StationState for all>, quality=capture
 */

const params = new URLSearchParams(window.location.search)
const num3 = (s: string | null): [number, number, number] | undefined => {
  if (!s) return undefined
  const v = s.split(',').map(Number)
  return v.length === 3 && v.every((x) => Number.isFinite(x)) ? (v as [number, number, number]) : undefined
}

const SPACING = 4.5
const stations: Station[] = STAGE_ORDER.map((kind, i) => ({
  id: `S${String(i + 1).padStart(2, '0')}`,
  name: kind,
  kind,
  operations: [],
  staff: kind === 'compressor_mount' ? 'robot' : 'human',
  x: i * SPACING,
  y: 0,
  rot: 0,
  bufferBefore: kind === 'brazing' ? 3 : 1,
  bufferAfter: 1,
  bays: kind === 'run_test' ? 2 : 1,
}))

const variants: Variant[] = [6, 9, 12].map((kw) => ({ id: `V${kw}`, name: `${kw} kW`, kw, mix: { value: 1 / 3, source: 'estimate' }, operations: [] }))

const forcedState = params.get('state') as StationState | null
function stateFor(kind: StationKind): StationState {
  if (forcedState) return forcedState
  if (kind === 'eol_inspection') return 'blocked'
  if (kind === 'kitting') return 'starved'
  return 'working'
}

const units: UnitOnLine[] = stations.map((s, i) => ({ unit: `U${i}`, variant: variants[i % 3].id, station: s.id, travel: 0 }))

function CameraRig() {
  const { camera } = useThree()
  useEffect(() => {
    const c = num3(params.get('cam'))
    if (c) camera.position.set(...c)
  }, [camera])
  return null
}

function Clock({ t, setT, play }: { t: number; setT: (t: number) => void; play: boolean }) {
  useFrame((_, dt) => {
    if (play) setT(t + dt)
  })
  return null
}

function Ready() {
  const [n, setN] = useState(0)
  useFrame(({ gl }) => {
    if (n < 30) setN(n + 1)
    else {
      const w = window as unknown as { __ready?: boolean; __info?: unknown }
      w.__ready = true
      w.__info = { calls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures }
    }
  })
  return null
}

function Preview() {
  const [t, setT] = useState(Number(params.get('t') ?? 12.3))
  const [play, setPlay] = useState(params.get('play') === '1')
  const quality = params.get('quality') === 'capture' ? 'capture' : 'demo'
  const look = num3(params.get('look')) ?? [22.5, 0.8, 0]
  const showUi = params.get('ui') !== '0'
  const gallery = useMemo(() => Array.from({ length: 11 }, (_, s) => ({ s, kw: [6, 9, 12][s % 3] })), [])
  return (
    <>
      <Canvas shadows camera={{ position: [10, 9, 16], fov: 40, near: 0.05, far: 300 }} gl={{ antialias: true, preserveDrawingBuffer: true }} dpr={[1, 2]}>
        <color attach="background" args={['#20242a']} />
        <fog attach="fog" args={['#20242a', 45, 120]} />
        <hemisphereLight args={['#f4f7ff', '#5a5650', 0.9]} />
        <ambientLight intensity={0.25} />
        <directionalLight
          position={[30, 26, 18]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[4096, 4096]}
          shadow-camera-left={-35}
          shadow-camera-right={35}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
          shadow-camera-near={1}
          shadow-camera-far={120}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
        />
        <directionalLight position={[-12, 10, 20]} intensity={0.6} />
        <ProceduralEnvironment />
        <CameraRig />
        <Clock t={t} setT={setT} play={play} />
        <Ready />
        {/* plain floor (environment workstream owns the real one) */}
        <mesh rotation-x={-Math.PI / 2} position={[22.5, 0, 2]} receiveShadow>
          <planeGeometry args={[80, 30]} />
          <meshStandardMaterial color="#8d9196" roughness={0.75} />
        </mesh>
        {stations.map((s) => (
          <group key={s.id} position={[s.x, 0, s.y]} rotation={[0, s.rot, 0]}>
            <StationModel station={s} state={stateFor(s.kind)} simTime={t} quality={quality} />
          </group>
        ))}
        <ConveyorLine stations={stations} />
        <UnitsOnLine stations={stations} units={units} variants={variants} simTime={t} />
        {/* stage gallery: one unit per stage on stands, in front of the line */}
        {gallery.map(({ s, kw }) => (
          <group key={s} position={[s * 4.5, 0, 6]}>
            <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
              <boxGeometry args={[1.5, 0.8, 0.8]} />
              <meshStandardMaterial color="#5b6168" roughness={0.6} />
            </mesh>
            <group position={[0, 0.8, 0]}>
              <ProductUnit kw={kw} stage={s} fanSpin={t * 3} seed={`G${s}`} />
            </group>
          </group>
        ))}
        <OrbitControls target={new THREE.Vector3(...look)} makeDefault />
      </Canvas>
      {showUi && (
        <div style={{ position: 'fixed', left: 12, bottom: 12, color: '#ddd', font: '12px system-ui', background: '#0008', padding: 8, borderRadius: 6 }}>
          <button onClick={() => setPlay(!play)}>{play ? 'pause' : 'play'}</button>{' '}
          <input type="range" min={0} max={120} step={0.1} value={t} onChange={(e) => setT(Number(e.target.value))} style={{ width: 300 }} /> t={t.toFixed(1)}
        </div>
      )}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
)
