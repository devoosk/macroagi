// Standalone preview for the workers workstream (preview-workers.html).
// URL params:
//   ?verb=screw&phase=0.4   single worker, frozen at phase (omit phase to loop)
//   &view=cctv|fp|front|side|grid   camera (grid = all 11 verbs)
//   &seed=<lookSeed> &tool=<ToolKind> &cycle=<n> &t=<simTime> &quality=demo|capture
// The preview owns a clock (allowed here only); Worker itself is a pure function of props.
import { StrictMode, useEffect, useMemo, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { create } from 'zustand'
import type { ToolKind } from '../../contracts/types'
import { getAnchor } from '../../lib/anchors'
import { Worker } from './Worker'
import { defaultRack, defaultToolFor, type WorkerVerb } from './pose'

const VERBS: WorkerVerb[] = ['pick', 'place', 'insert', 'screw', 'connect', 'braze', 'inspect', 'walk', 'search', 'idle', 'blocked']
const SEEDS = ['ana', 'bo', 'carlos', 'dmitri', 'eli', 'fatima', 'gus', 'hana', 'ivo', 'jun', 'kai', 'lea', 'mo', 'nia']
const PERIOD: Partial<Record<WorkerVerb, number>> = { walk: 12, search: 22 }

const q = new URLSearchParams(window.location.search)
const qVerb = q.get('verb') as WorkerVerb | null
const qPhase = q.get('phase')
const qView = q.get('view') ?? (qVerb ? 'cctv' : 'grid')
const qSeed = q.get('seed')
const qTool = q.get('tool') as ToolKind | null
const qCycle = Number(q.get('cycle') ?? 0)
const qT = q.get('t')
const qQuality = q.get('quality') === 'demo' ? 'demo' : 'capture'
const frozen = qPhase !== null

/** Store-like time value: the only clock in the preview. */
const useClock = create<{ t: number; set: (t: number) => void }>((set) => ({ t: 0, set: (t) => set({ t }) }))

function PreviewClock() {
  useFrame((_, dt) => {
    if (frozen) return
    const s = useClock.getState()
    s.set(s.t + Math.min(dt, 0.1))
  })
  return null
}

function Ready() {
  const n = useRef(0)
  useFrame(() => {
    n.current++
    if (n.current === 8) (window as unknown as { __ready: boolean }).__ready = true
  })
  return null
}

function Env() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl)
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    ;(scene as unknown as { environmentIntensity: number }).environmentIntensity = 0.35
    return () => {
      env.dispose()
      pm.dispose()
    }
  }, [gl, scene])
  return null
}

const steel = new THREE.MeshStandardMaterial({ color: '#8d949b', roughness: 0.45, metalness: 0.7 })
const belt = new THREE.MeshStandardMaterial({ color: '#25282b', roughness: 0.85 })
const unitMat = new THREE.MeshStandardMaterial({ color: '#d7dade', roughness: 0.4, metalness: 0.3 })
const binMat = new THREE.MeshStandardMaterial({ color: '#2f63b5', roughness: 0.6 })
const rackMat = new THREE.MeshStandardMaterial({ color: '#d0661f', roughness: 0.5, metalness: 0.3 })
const shelfMat = new THREE.MeshStandardMaterial({ color: '#6b7178', roughness: 0.6, metalness: 0.4 })

function Bin({ p, s = [0.36, 0.2, 0.3] }: { p: [number, number, number]; s?: [number, number, number] }) {
  const [w, h, d] = s
  return (
    <group position={p}>
      <mesh material={binMat} position={[0, -h / 2 + 0.01, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.02, d]} />
      </mesh>
      {[
        [0, 0, d / 2, w, h, 0.015],
        [0, 0, -d / 2, w, h * 0.7, 0.015],
        [w / 2, 0, 0, 0.015, h, d],
        [-w / 2, 0, 0, 0.015, h, d],
      ].map(([x, y, z, a, b, c], i) => (
        <mesh key={i} material={binMat} position={[x, y - (i === 1 ? h * 0.15 : 0), z]} castShadow receiveShadow>
          <boxGeometry args={[a, b, c]} />
        </mesh>
      ))}
    </group>
  )
}

/** Parts rack whose front face is centred at station-frame (x, z), facing the line. */
function Rack({ x, z }: { x: number; z: number }) {
  const sd = Math.sign(x) || 1
  return (
    <group position={[x + sd * 0.22, 0, z]} rotation={[0, sd > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
      {[-0.65, 0.65].map((zz) =>
        [-0.2, 0.2].map((xx) => (
          <mesh key={`${zz}${xx}`} material={rackMat} position={[zz, 0.9, xx]} castShadow>
            <boxGeometry args={[0.04, 1.8, 0.04]} />
          </mesh>
        )),
      )}
      {[0.5, 1.05, 1.5].map((y) => (
        <group key={y}>
          <mesh material={shelfMat} position={[0, y, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.34, 0.025, 0.44]} />
          </mesh>
          {[-0.42, 0, 0.42].map((zz) => (
            <Bin key={zz} p={[zz, y + 0.1, 0]} s={[0.36, 0.17, 0.36]} />
          ))}
        </group>
      ))}
    </group>
  )
}

/** Bench/conveyor proxy: work surface top at 0.85, centred at z = -0.95. */
function StationProxy({ verb, seed }: { verb: WorkerVerb; seed: string }) {
  const rack = defaultRack(seed)
  const showUnit = verb !== 'place'
  return (
    <group>
      <mesh material={belt} position={[0, 0.83, -0.95]} receiveShadow castShadow>
        <boxGeometry args={[3.2, 0.04, 0.62]} />
      </mesh>
      {[-0.33, 0.33].map((z) => (
        <mesh key={z} material={steel} position={[0, 0.79, -0.95 + z]} castShadow>
          <boxGeometry args={[3.2, 0.1, 0.05]} />
        </mesh>
      ))}
      {[-1.4, 0, 1.4].map((x) =>
        [-0.3, 0.3].map((z) => (
          <mesh key={`${x}${z}`} material={steel} position={[x, 0.37, -0.95 + z]} castShadow>
            <boxGeometry args={[0.05, 0.74, 0.05]} />
          </mesh>
        )),
      )}
      {showUnit && (
        <group position={[0, 0.85, -0.95]}>
          <mesh material={unitMat} position={[0, 0.36, -0.02]} castShadow receiveShadow>
            <boxGeometry args={[0.95, 0.72, 0.36]} />
          </mesh>
          <mesh position={[0.18, 0.36, -0.205]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.24, 0.24, 0.01, 32]} />
            <meshStandardMaterial color="#2c2f33" roughness={0.6} />
          </mesh>
          {[-0.08, 0.02].map((y) => (
            <mesh key={y} position={[-0.3, 0.28 + y, 0.18]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.009, 0.009, 0.24, 12]} />
              <meshStandardMaterial color="#c27a4c" roughness={0.3} metalness={1} />
            </mesh>
          ))}
        </group>
      )}
      {/* side bins and rear bins */}
      {[-1, 1].map((sd) => (
        <group key={sd}>
          <mesh material={steel} position={[sd * 0.88, 0.32, 0.2]} castShadow receiveShadow>
            <boxGeometry args={[0.42, 0.64, 0.4]} />
          </mesh>
          <Bin p={[sd * 0.86, 0.75, 0.2]} />
          <mesh material={steel} position={[sd * 0.55, 0.32, 0.75]} castShadow receiveShadow>
            <boxGeometry args={[0.42, 0.64, 0.36]} />
          </mesh>
          <Bin p={[sd * 0.55, 0.75, 0.74]} />
        </group>
      ))}
      {(verb === 'walk' || verb === 'search') && (
        <>
          <Rack x={rack[0]} z={rack[1]} />
        </>
      )}
    </group>
  )
}

function Cell({ verb, seed, idx }: { verb: WorkerVerb; seed: string; idx: number }) {
  const t = useClock((s) => s.t)
  const period = PERIOD[verb] ?? 8
  const phase = frozen ? Number(qPhase) : (t / period) % 1
  const simTime = qT !== null ? Number(qT) : frozen ? phase * period : t
  const tool = qTool ?? defaultToolFor(verb)
  const cycle = frozen ? qCycle : qCycle + Math.floor(t / period)
  return <Worker stationId={`P${idx}`} lookSeed={seed} verb={verb} phase={phase} simTime={simTime} tool={tool} cycle={cycle} quality={qQuality} duration={period} />
}

function FirstPerson() {
  const { camera } = useThree()
  useFrame(() => {
    const a = getAnchor('head:P0')
    if (!a) return
    a.updateWorldMatrix(true, false)
    a.getWorldPosition(camera.position)
    a.getWorldQuaternion(camera.quaternion)
  })
  return null
}

/** Third-person camera that follows the worker's head anchor from the side. */
function Follow() {
  const { camera } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const a = getAnchor('head:P0')
    if (!a) return
    a.getWorldPosition(v)
    camera.position.set(v.x + 2.0, 1.5, v.z + 1.4)
    camera.lookAt(v.x, 0.95, v.z)
  })
  return null
}

function CamRig({ view, verb }: { view: string; verb: WorkerVerb }) {
  const { camera } = useThree()
  const roam = verb === 'walk' || verb === 'search'
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    if (view === 'fp') {
      cam.fov = 80
      cam.near = 0.02
    } else {
      cam.fov = 45
      cam.near = 0.05
      const [pos, tgt]: [number[], number[]] =
        view === 'front'
          ? [[0.5, 2.3, -2.6], [0, 1.0, -0.2]]
          : view === 'close'
            ? [[1.15, 1.75, -1.1], [0, 1.3, -0.2]]
          : view === 'side'
            ? [[3.0, 1.35, -0.4], [0, 1.0, -0.4]]
            : roam
              ? [[4.6, 5.2, 5.6], [0.6, 0.6, 1.2]]
              : [[2.5, 3.2, 2.1], [0, 1.0, -0.45]]
      cam.position.set(pos[0], pos[1], pos[2])
      cam.lookAt(tgt[0], tgt[1], tgt[2])
    }
    cam.updateProjectionMatrix()
  }, [camera, view, roam])
  return view === 'fp' ? <FirstPerson /> : view === 'follow' ? <Follow /> : null
}

function Scene() {
  const single = !!qVerb && qView !== 'grid'
  const cols = 4
  return (
    <>
      <color attach="background" args={['#2a2e33']} />
      <Env />
      <hemisphereLight args={['#f4f6ff', '#4a4640', 0.45]} />
      <directionalLight position={[4, 9, 5]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14} shadow-bias={-0.0004} />
      <directionalLight position={[-5, 6, -4]} intensity={0.35} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#5f6368" roughness={0.8} />
      </mesh>
      <PreviewClock />
      <Ready />
      {single ? (
        <group>
          <StationProxy verb={qVerb!} seed={qSeed ?? SEEDS[VERBS.indexOf(qVerb!) % SEEDS.length]} />
          <Cell verb={qVerb!} seed={qSeed ?? SEEDS[VERBS.indexOf(qVerb!) % SEEDS.length]} idx={0} />
          <CamRig view={qView} verb={qVerb!} />
        </group>
      ) : (
        <>
          {VERBS.map((v, i) => (
            <group key={v} position={[(i % cols) * 6.5 - 9.75, 0, Math.floor(i / cols) * 6.5 - 6]}>
              <StationProxy verb={v} seed={qSeed ?? SEEDS[i]} />
              <Cell verb={v} seed={qSeed ?? SEEDS[i]} idx={i} />
            </group>
          ))}
          <OrbitControls target={[0, 1, -1]} />
        </>
      )}
    </>
  )
}

function Preview() {
  const cam = useMemo(() => ({ position: [12, 14, 16] as [number, number, number], fov: 45 }), [])
  return (
    <Canvas shadows dpr={[1, 2]} camera={cam} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}>
      <Scene />
    </Canvas>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
)
