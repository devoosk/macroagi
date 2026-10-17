import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { FactoryEffects, FactoryEnvironment, QUALITY_PRESETS, type Quality } from './index'

/**
 * Standalone preview: /preview-environment.html
 * Query: ?q=demo|capture  &fx=0 (no post)  &view=wide|eye|cctv|rack|ceiling|far|cut  &cut=1 (cutaway)  &seed=<lightSeed>
 */
const params = new URLSearchParams(window.location.search)
const quality: Quality = params.get('q') === 'capture' ? 'capture' : 'demo'
const fxOn = params.get('fx') !== '0'
const view = params.get('view') ?? 'wide'
const lightSeed = params.get('seed') ?? 0
const cutaway = params.get('cut') === '1'

const VIEWS: Record<string, { pos: [number, number, number]; target: [number, number, number]; fov: number }> = {
  wide: { pos: [-11.5, 5.6, 12], target: [22, 0.5, -4], fov: 62 },
  cut: { pos: [-12, 24, 32], target: [22, 0, -3], fov: 45 },
  eye: { pos: [-4, 1.65, 3.2], target: [20, 1.3, -0.5], fov: 60 },
  cctv: { pos: [22.5, 6.8, 6.5], target: [22.5, 0.6, -1.0], fov: 62 },
  rack: { pos: [30, 2.0, -6.5], target: [20, 1.8, -13], fov: 60 },
  ceiling: { pos: [10, 2, 8], target: [18, 8.5, -2], fov: 70 },
  far: { pos: [52, 3, 9], target: [20, 1.5, -2], fov: 55 },
}

/** Placeholder station boxes along the line. */
function Stations() {
  const xs = Array.from({ length: 11 }, (_, i) => i * 4.5)
  return (
    <group>
      {xs.map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.4, 0.9, 1.2]} />
            <meshStandardMaterial color="#8a9096" roughness={0.6} metalness={0.2} />
          </mesh>
          <mesh position={[0, 1.6, -0.5]} castShadow>
            <boxGeometry args={[2.4, 1.4, 0.1]} />
            <meshStandardMaterial color="#6f767d" roughness={0.6} metalness={0.2} />
          </mesh>
        </group>
      ))}
      <mesh position={[22.5, 0.75, 0]} castShadow receiveShadow>
        <boxGeometry args={[48, 0.08, 0.6]} />
        <meshStandardMaterial color="#3d4247" roughness={0.5} metalness={0.5} />
      </mesh>
    </group>
  )
}

/** Exposes frame stats on window.__envStats (draw calls, triangles, fps) for the screenshot script. */
function Stats() {
  const gl = useThree((s) => s.gl)
  const frames = useRef(0)
  const t0 = useRef(0)
  useEffect(() => {
    gl.info.autoReset = false
  }, [gl])
  useFrame(() => {
    const now = performance.now()
    if (!t0.current) t0.current = now
    frames.current++
    const w = window as unknown as { __envStats?: object; __envReady?: boolean }
    w.__envStats = {
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      fps: (frames.current * 1000) / Math.max(1, now - t0.current),
      frames: frames.current,
    }
    if (frames.current > 20) w.__envReady = true
    gl.info.reset()
  })
  return null
}

function Preview() {
  const v = VIEWS[view] ?? VIEWS.wide
  return (
    <Canvas
      shadows
      dpr={QUALITY_PRESETS[quality].dpr}
      camera={{ position: v.pos, fov: v.fov, near: 0.1, far: 300 }}
      gl={{ antialias: !fxOn, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
    >
      <color attach="background" args={['#9aa3ab']} />
      <FactoryEnvironment quality={quality} lightSeed={lightSeed} cutaway={cutaway} />
      <Stations />
      {fxOn && <FactoryEffects quality={quality} />}
      <OrbitControls target={v.target} makeDefault />
      <Stats />
    </Canvas>
  )
}

createRoot(document.getElementById('root')!).render(<Preview />)
