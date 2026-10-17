import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BoxGeometry, Color, CylinderGeometry, EdgesGeometry, LineBasicMaterial, MeshBasicMaterial, type BufferGeometry } from 'three'
import { getT } from './clock'
import { lineColor, stageColor } from './theme'

const white = new Color('#ffffff')

export interface EdgedProps {
  geometry: BufferGeometry
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
  /** 0..1 overall visibility. */
  opacity?: number
  /** 0..1: lines and faces burn white (bottleneck, winner). */
  glow?: number
  /** Faces drawn (paper fill) or lines only. */
  filled?: boolean
}

/** A line-art solid: paper (or night) faces with ink (or white) edges, like MicroAGI's isometric drawings. */
export function Edged({ geometry, position, rotation, scale, opacity = 1, glow = 0, filled = true }: EdgedProps) {
  const edges = useMemo(() => new EdgesGeometry(geometry, 20), [geometry])
  const face = useMemo(() => new MeshBasicMaterial({ transparent: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), [])
  const line = useMemo(() => new LineBasicMaterial({ transparent: true }), [])
  const o = useRef({ opacity, glow })
  o.current = { opacity, glow }
  useFrame(() => {
    const t = getT()
    stageColor(t, face.color)
    face.color.lerp(white, o.current.glow * 0.85)
    lineColor(t, line.color).lerp(white, o.current.glow)
    face.opacity = o.current.opacity
    line.opacity = o.current.opacity
    face.visible = filled && o.current.opacity > 0.01
    line.visible = o.current.opacity > 0.01
  })
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={geometry} material={face} renderOrder={1} />
      <lineSegments geometry={edges} material={line} renderOrder={2} />
    </group>
  )
}

const boxCache = new Map<string, BoxGeometry>()
/** Box geometry sitting on y = 0. Cached by size. */
export function boxGeo(w: number, h: number, d: number): BoxGeometry {
  const k = `${w}|${h}|${d}`
  let g = boxCache.get(k)
  if (!g) {
    g = new BoxGeometry(w, h, d)
    g.translate(0, h / 2, 0)
    boxCache.set(k, g)
  }
  return g
}

const cylCache = new Map<string, CylinderGeometry>()
export function cylGeo(r: number, h: number, seg = 12): CylinderGeometry {
  const k = `${r}|${h}|${seg}`
  let g = cylCache.get(k)
  if (!g) {
    g = new CylinderGeometry(r, r, h, seg)
    g.translate(0, h / 2, 0)
    cylCache.set(k, g)
  }
  return g
}

/** A small standing person in line art. */
export function Person({ position, opacity = 1, sink = 0 }: { position: [number, number, number]; opacity?: number; sink?: number }) {
  const [x, y, z] = position
  return (
    <group position={[x, y - sink * 1.6, z]}>
      <Edged geometry={boxGeo(0.22, 0.75, 0.16)} position={[-0.07, 0, 0]} opacity={opacity} />
      <Edged geometry={boxGeo(0.22, 0.75, 0.16)} position={[0.07, 0, 0]} opacity={opacity} />
      <Edged geometry={boxGeo(0.46, 0.7, 0.26)} position={[0, 0.75, 0]} opacity={opacity} />
      <Edged geometry={boxGeo(0.26, 0.28, 0.26)} position={[0, 1.5, 0]} opacity={opacity} />
    </group>
  )
}

/** A rented robot arm in line art; `phase` swings the joints. */
export function RobotArm({ position, opacity = 1, rise = 1, phase = 0, glow = 0 }: { position: [number, number, number]; opacity?: number; rise?: number; phase?: number; glow?: number }) {
  const [x, y, z] = position
  const a = Math.sin(phase) * 0.5
  return (
    <group position={[x, y - (1 - rise) * 2.2, z]}>
      <Edged geometry={cylGeo(0.32, 0.35)} opacity={opacity} glow={glow} />
      <group position={[0, 0.35, 0]} rotation={[0, a, 0]}>
        <Edged geometry={cylGeo(0.2, 0.3)} opacity={opacity} glow={glow} />
        <group position={[0, 0.3, 0]} rotation={[0, 0, -0.5 + a * 0.4]}>
          <Edged geometry={boxGeo(0.22, 1.1, 0.22)} opacity={opacity} glow={glow} />
          <group position={[0, 1.1, 0]} rotation={[0, 0, 1.6 - a * 0.6]}>
            <Edged geometry={boxGeo(0.18, 0.9, 0.18)} opacity={opacity} glow={glow} />
            <Edged geometry={boxGeo(0.34, 0.12, 0.2)} position={[0, 0.9, 0]} opacity={opacity} glow={glow} />
          </group>
        </group>
      </group>
    </group>
  )
}

/** A rented humanoid in line art: a person's shape with a visor head and joint drums. */
export function Humanoid({ position, opacity = 1, rise = 1, phase = 0, glow = 0 }: { position: [number, number, number]; opacity?: number; rise?: number; phase?: number; glow?: number }) {
  const [x, y, z] = position
  const sw = Math.sin(phase) * 0.15
  return (
    <group position={[x, y - (1 - rise) * 2.2, z]}>
      <Edged geometry={boxGeo(0.2, 0.8, 0.2)} position={[-0.12, 0, 0]} opacity={opacity} glow={glow} />
      <Edged geometry={boxGeo(0.2, 0.8, 0.2)} position={[0.12, 0, 0]} opacity={opacity} glow={glow} />
      <Edged geometry={cylGeo(0.2, 0.18)} position={[0, 0.8, 0]} opacity={opacity} glow={glow} />
      <Edged geometry={boxGeo(0.52, 0.66, 0.3)} position={[0, 0.98, 0]} opacity={opacity} glow={glow} />
      <Edged geometry={boxGeo(0.14, 0.62, 0.14)} position={[-0.35, 1.0, sw]} opacity={opacity} glow={glow} />
      <Edged geometry={boxGeo(0.14, 0.62, 0.14)} position={[0.35, 1.0, -sw]} opacity={opacity} glow={glow} />
      <Edged geometry={boxGeo(0.3, 0.3, 0.3)} position={[0, 1.7, 0]} opacity={opacity} glow={glow} />
      <Edged geometry={boxGeo(0.24, 0.06, 0.02)} position={[0, 1.83, 0.16]} opacity={opacity} glow={1} />
    </group>
  )
}

/** A guarded robot cell: base plinth, four posts and a top frame around the robot. */
export function CellGuard({ opacity = 1, glow = 0, w = 3, d = 2.6 }: { opacity?: number; glow?: number; w?: number; d?: number }) {
  const posts: [number, number][] = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]
  return (
    <>
      <Edged geometry={boxGeo(w, 0.08, d)} opacity={opacity} glow={glow} />
      {posts.map(([px, pz], i) => (
        <Edged key={i} geometry={boxGeo(0.06, 1.9, 0.06)} position={[px, 0, pz]} opacity={opacity} glow={glow} filled={false} />
      ))}
      <Edged geometry={boxGeo(w, 0.02, d)} position={[0, 1.9, 0]} opacity={opacity} glow={glow} filled={false} />
    </>
  )
}
