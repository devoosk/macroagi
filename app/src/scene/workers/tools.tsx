import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { ToolKind } from '../../contracts/types'
import { M } from './body'
import { box, cone, cyl, geo, mat, sphere } from './geo'
import { TOOL_GEOM, type PartKind } from './pose'
import type { Side, V3 } from './rig'

// Tool and part models in the tool frame: grip at the origin, +y toward the thumb, -z forward.

const C = {
  body: () => mat('#2b2e33', { roughness: 0.45 }),
  accent: () => mat('#d9531e', { roughness: 0.45 }),
  rubber: () => mat('#17181a', { roughness: 0.85 }),
  steel: () => mat('#b8bec4', { roughness: 0.25, metalness: 1 }),
  brass: () => mat('#c79a4a', { roughness: 0.3, metalness: 1 }),
  copper: () => mat('#c27a4c', { roughness: 0.32, metalness: 1 }),
  yellow: () => mat('#e2b91f', { roughness: 0.45 }),
  red: () => mat('#b3261e', { roughness: 0.5 }),
  blue: () => mat('#2a5aa8', { roughness: 0.5 }),
  grey: () => mat('#6b7178', { roughness: 0.5 }),
  hose: () => mat('#22262b', { roughness: 0.7 }),
  hoseRed: () => mat('#8e1f1a', { roughness: 0.65 }),
  window: () => mat('#140c0c', { roughness: 0.1, metalness: 0.3 }),
  card: () => mat('#b48f5c', { roughness: 0.92 }),
  tape: () => mat('#c9b48a', { roughness: 0.4 }),
  grey2: () => mat('#5d646d', { roughness: 0.55 }),
}
const X = Math.PI / 2

/** Additive unlit mesh with a per-instance material (opacity animates without new materials). */
function Glow({ g, color, opacity, p, s }: { g: THREE.BufferGeometry; color: string; opacity: number; p?: V3; s?: V3 }) {
  return (
    <mesh geometry={g} position={p} scale={s} renderOrder={3}>
      <meshBasicMaterial color={color} transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  )
}

/** Rotation that turns a +y cylinder to lie along -z. */
const ALONG_Z: V3 = [X, 0, 0]

function TorqueDriver({ spin, seg }: { spin: number; seg: number }) {
  const tip = TOOL_GEOM.driverTip
  return (
    <group>
      {/* grip (raked) */}
      <group rotation={[-0.2, 0, 0]}>
        <M g={box(0.034, 0.115, 0.046)} m={C.body()} p={[0, -0.005, 0.004]} />
        <M g={box(0.036, 0.08, 0.02)} m={C.rubber()} p={[0, -0.005, 0.025]} />
      </group>
      {/* trigger */}
      <M g={box(0.012, 0.03, 0.012)} m={C.accent()} p={[0, 0.032, -0.028]} />
      {/* motor housing */}
      <M g={cyl(0.031, 0.031, 0.15, seg)} m={C.body()} p={[0, tip[1], -0.02]} r={ALONG_Z} />
      <M g={sphere(seg)} m={C.body()} p={[0, tip[1], 0.055]} s={[0.031, 0.031, 0.02]} />
      <M g={cyl(0.0315, 0.0315, 0.05, seg, true)} m={C.accent()} p={[0, tip[1], 0.025]} r={ALONG_Z} />
      {[0, 1, 2].map((i) => (
        <M key={i} g={box(0.0335, 0.004, 0.022)} m={C.rubber()} p={[0, tip[1] + 0.024, 0.03 - i * 0.008]} r={[0, 0, 0]} s={[1, 1, 0.3]} />
      ))}
      {/* gearbox + chuck (spinning) + bit */}
      <M g={cyl(0.025, 0.028, 0.035, seg)} m={C.rubber()} p={[0, tip[1], -0.112]} r={ALONG_Z} />
      <group position={[0, tip[1], -0.148]} rotation={[0, 0, spin]}>
        <M g={cyl(0.015, 0.018, 0.035, 6)} m={C.steel()} r={ALONG_Z} />
        <M g={cyl(0.0035, 0.0035, 0.055, 6)} m={C.steel()} p={[0, 0, -0.04]} r={ALONG_Z} />
      </group>
      {/* battery */}
      <M g={box(0.062, 0.042, 0.095)} m={C.body()} p={[0, -0.085, -0.004]} />
      <M g={box(0.064, 0.012, 0.097)} m={C.accent()} p={[0, -0.06, -0.004]} />
    </group>
  )
}

function Screwdriver({ seg }: { seg: number }) {
  const tip = TOOL_GEOM.screwdriverTip
  return (
    <group>
      <M g={cyl(0.017, 0.015, 0.11, seg)} m={C.red()} p={[0, 0.0, 0]} />
      <M g={cyl(0.012, 0.017, 0.03, seg)} m={C.rubber()} p={[0, 0.07, 0]} />
      <M g={sphere(seg)} m={C.red()} p={[0, -0.055, 0]} s={[0.016, 0.012, 0.016]} />
      <M g={cyl(0.0035, 0.0035, tip[1] - 0.085, 8)} m={C.steel()} p={[0, (tip[1] + 0.085) / 2, 0]} />
    </group>
  )
}

function Torch({ flame, flicker, seg }: { flame: number; flicker: number; seg: number }) {
  const tip = TOOL_GEOM.torchTip
  const f = flame * flicker
  return (
    <group>
      <M g={cyl(0.017, 0.016, 0.14, seg)} m={C.brass()} p={[0, -0.015, 0]} />
      <M g={cyl(0.019, 0.019, 0.018, seg)} m={C.rubber()} p={[0, -0.085, 0]} />
      {/* valve knobs */}
      <M g={cyl(0.012, 0.012, 0.012, seg)} m={C.red()} p={[0.024, -0.07, 0]} r={[0, 0, X]} />
      <M g={cyl(0.012, 0.012, 0.012, seg)} m={C.blue()} p={[-0.024, -0.07, 0]} r={[0, 0, X]} />
      {/* mixer + tube + bent nozzle */}
      <M g={cyl(0.012, 0.016, 0.04, seg)} m={C.brass()} p={[0, 0.05, 0]} />
      <M g={cyl(0.006, 0.006, 0.3, 10)} m={C.copper()} p={[0, tip[1], -0.15]} r={ALONG_Z} />
      <M g={sphere(10)} m={C.brass()} p={[0, tip[1], -0.005]} s={0.012} />
      <M g={cyl(0.0045, 0.007, 0.04, 10)} m={C.brass()} p={[0, tip[1], tip[2] + 0.02]} r={ALONG_Z} />
      {f > 0.01 && (
        <group position={tip} rotation={[-X, 0, 0]} scale={[1, 1, 1]}>
          {/* cones: base at the nozzle, apex outward (+y here = -z in the tool frame) */}
          <Glow g={cone(1, 1, 12)} color="#d8ecff" opacity={0.95 * f} p={[0, 0.02, 0]} s={[0.006, 0.04, 0.006]} />
          <Glow g={cone(1, 1, 14)} color="#3f7bff" opacity={0.7 * f} p={[0, 0.05 * (0.9 + 0.1 * flicker), 0]} s={[0.014, 0.1 * (0.9 + 0.1 * flicker), 0.014]} />
          <Glow g={cone(1, 1, 14)} color="#ff8a2a" opacity={0.35 * f} p={[0, 0.085 * flicker, 0]} s={[0.026, 0.17 * flicker, 0.026]} />
          <Glow g={sphere(10)} color="#ffb15a" opacity={0.22 * f} p={[0, 0.075, 0]} s={[0.024, 0.07, 0.024]} />
          <pointLight color="#ffb070" intensity={3 * f} distance={2.5} decay={2} position={[0, 0.06, 0]} />
          <pointLight color="#7aa8ff" intensity={1 * f} distance={1.4} decay={2} position={[0, 0.02, 0]} />
        </group>
      )}
    </group>
  )
}

function Crimper({ squeeze, seg }: { squeeze: number; seg: number }) {
  const jaw = TOOL_GEOM.crimperJaw
  const open = (1 - squeeze) * 0.32
  return (
    <group>
      {/* head with jaws */}
      <M g={box(0.012, 0.05, 0.05)} m={C.steel()} p={[0, jaw[1], jaw[2]]} />
      <M g={box(0.013, 0.012, 0.03)} m={C.grey()} p={[0, jaw[1] + 0.02, jaw[2] - 0.03]} />
      {/* fixed handle */}
      <group position={[0, jaw[1] - 0.02, 0.0]}>
        <M g={limb(0.011, 0.009, 0.17, seg)} m={C.red()} p={[0, 0, 0.012]} />
      </group>
      {/* moving handle */}
      <group position={[0, jaw[1] - 0.02, -0.012]} rotation={[-open, 0, 0]}>
        <M g={limb(0.011, 0.009, 0.17, seg)} m={C.yellow()} p={[0, 0, -0.012]} />
      </group>
      <M g={cyl(0.006, 0.006, 0.016, 8)} m={C.steel()} p={[0, jaw[1] - 0.02, 0]} r={[0, 0, X]} />
    </group>
  )
}

function Scanner({ scan, seg }: { scan: number; seg: number }) {
  const n = TOOL_GEOM.scannerNose
  return (
    <group>
      <group rotation={[-0.25, 0, 0]}>
        <M g={box(0.03, 0.1, 0.038)} m={C.yellow()} p={[0, -0.01, 0.006]} />
        <M g={box(0.032, 0.06, 0.016)} m={C.rubber()} p={[0, -0.01, 0.024]} />
      </group>
      <M g={box(0.046, 0.05, 0.12)} m={C.yellow()} p={[0, n[1], -0.05]} />
      <M g={box(0.05, 0.056, 0.02)} m={C.rubber()} p={[0, n[1], n[2] + 0.008]} />
      <M g={box(0.04, 0.03, 0.004)} m={C.window()} p={[0, n[1], n[2] - 0.003]} />
      <M g={box(0.012, 0.022, 0.012)} m={C.rubber()} p={[0, 0.028, -0.026]} />
      {scan > 0.01 && (
        <group position={[n[0], n[1], n[2] - 0.004]}>
          {/* fan of red light to a line at ~0.32 m */}
          <Glow g={fanGeo()} color="#ff2020" opacity={0.22 * scan} />
          <Glow g={box(0.11, 0.0025, 0.002)} color="#ff3030" opacity={0.95 * scan} p={[0, 0, -0.32]} />
        </group>
      )}
      {void seg}
    </group>
  )
}

const fanGeo = () =>
  geo('scanfan', () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.012, 0, 0, 0.012, 0, 0, 0.055, 0, -0.32, -0.012, 0, 0, 0.055, 0, -0.32, -0.055, 0, -0.32], 3))
    g.computeVertexNormals()
    return g
  })

function Sniffer({ seg }: { seg: number }) {
  const t = TOOL_GEOM.snifferTip
  return (
    <group>
      <M g={cyl(0.017, 0.015, 0.13, seg)} m={C.grey2()} p={[0, -0.02, 0]} />
      <M g={cyl(0.018, 0.018, 0.02, seg)} m={C.yellow()} p={[0, 0.04, 0]} />
      <M g={sphere(seg)} m={C.grey2()} p={[0, t[1], 0.0]} s={0.019} />
      <M g={cyl(0.005, 0.006, -t[2] - 0.03, 10)} m={C.rubber()} p={[0, t[1], (t[2] + 0.0) / 2]} r={ALONG_Z} />
      <M g={cyl(0.003, 0.004, 0.035, 8)} m={C.steel()} p={[0, t[1], t[2] + 0.017]} r={ALONG_Z} />
    </group>
  )
}

function Coupler({ seg }: { seg: number }) {
  const t = TOOL_GEOM.couplerTip
  return (
    <group>
      <M g={cyl(0.016, 0.016, 0.07, seg)} m={C.brass()} p={[0, 0, -0.03]} r={ALONG_Z} />
      <M g={cyl(0.019, 0.019, 0.02, 12)} m={C.brass()} p={[0, 0, t[2] + 0.025]} r={ALONG_Z} />
      <M g={cyl(0.01, 0.012, 0.02, seg)} m={C.steel()} p={[0, 0, t[2] + 0.008]} r={ALONG_Z} />
      <M g={cyl(0.013, 0.015, 0.05, seg)} m={C.hoseRed()} p={[0, 0, 0.03]} r={ALONG_Z} />
    </group>
  )
}

function Strapper({ squeeze, seg }: { squeeze: number; seg: number }) {
  return (
    <group>
      <M g={cyl(0.016, 0.016, 0.1, seg)} m={C.rubber()} p={[0, 0, 0]} />
      <M g={box(0.06, 0.06, 0.2)} m={C.grey()} p={[0, 0.08, -0.06]} />
      <M g={box(0.064, 0.02, 0.06)} m={C.accent()} p={[0, 0.115, -0.12]} />
      <group position={[0, 0.11, 0.03]} rotation={[0.3 - squeeze * 0.5, 0, 0]}>
        <M g={box(0.018, 0.012, 0.14)} m={C.steel()} p={[0, 0, 0.07]} />
      </group>
    </group>
  )
}

export function ToolModel({ kind, fx, flicker, seg }: { kind: ToolKind; fx: { spin: number; flame: number; scan: number; squeeze: number }; flicker: number; seg: number }) {
  switch (kind) {
    case 'torque_driver':
      return <TorqueDriver spin={fx.spin} seg={seg} />
    case 'screwdriver':
      return <Screwdriver seg={seg} />
    case 'torch':
      return <Torch flame={fx.flame} flicker={flicker} seg={seg} />
    case 'crimper':
      return <Crimper squeeze={fx.squeeze} seg={seg} />
    case 'scanner':
      return <Scanner scan={fx.scan} seg={seg} />
    case 'hose':
      return <Coupler seg={seg} />
    case 'strapper':
      return <Strapper squeeze={fx.squeeze} seg={seg} />
    default:
      return null
  }
}

/** The sniffer wand is the 'hose' tool when inspecting. */
export function InspectHoseTool({ seg }: { seg: number }) {
  return <Sniffer seg={seg} />
}

// ------------------------------------------------------------------ parts
function limb(r1: number, r2: number, l: number, seg: number) {
  return geo(`tlimb:${r1}:${r2}:${l}:${seg}`, () => {
    const g = new THREE.CapsuleGeometry((r1 + r2) / 2, l, 4, seg)
    g.translate(0, -l / 2, 0)
    return g
  })
}

const pipeGeo = () =>
  geo('pipe-u', () => {
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.07, 0),
      new THREE.Vector3(0, 0.08, 0),
      new THREE.Vector3(0, 0.15, -0.04),
      new THREE.Vector3(0, 0.16, -0.12),
      new THREE.Vector3(0, 0.12, -0.2),
      new THREE.Vector3(0, 0.0, -0.22),
    ])
    return new THREE.TubeGeometry(c, 40, 0.0065, 10, false)
  })

const WIRE_COLORS = ['#b3261e', '#1f4fa8', '#1d1d1d', '#e0c21c', '#2e7d32', '#d9d9d9']
const harnessGeo = (i: number) =>
  geo(`harness:${i}`, () => {
    const a = (i / WIRE_COLORS.length) * Math.PI * 2
    const o = (k: number) => new THREE.Vector3(Math.cos(a) * 0.006 * k, 0, Math.sin(a) * 0.006 * k)
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.02, 0).add(o(1)),
      new THREE.Vector3(0, -0.05, 0.01).add(o(1)),
      new THREE.Vector3(0.0, -0.16, 0.05).add(o(1.4)),
      new THREE.Vector3(0.0, -0.22, 0.14).add(o(1.8)),
      new THREE.Vector3(0.0, -0.2, 0.24).add(o(2)),
    ])
    return new THREE.TubeGeometry(c, 24, 0.0032, 6, false)
  })

export function PartModel({ kind, side, seg }: { kind: PartKind; side: Side; seg: number }) {
  const ps = side === 1 ? -1 : 1
  switch (kind) {
    case 'box':
      return (
        <group position={[ps * 0.1, 0, 0]}>
          <M g={box(0.19, 0.13, 0.16)} m={C.card()} />
          <M g={box(0.192, 0.004, 0.05)} m={C.tape()} p={[0, 0.065, 0]} />
          <M g={box(0.05, 0.11, 0.004)} m={C.grey2()} p={[0.03, 0, -0.081]} />
        </group>
      )
    case 'pipe':
      return <mesh geometry={pipeGeo()} material={C.copper()} castShadow />
    case 'harness':
      return (
        <group>
          {WIRE_COLORS.map((c, i) => (
            <mesh key={i} geometry={harnessGeo(i)} material={mat(c, { roughness: 0.5 })} castShadow />
          ))}
          <M g={box(0.03, 0.024, 0.016)} m={mat('#e8e6df', { roughness: 0.4 })} p={[0, 0.03, 0]} />
          <M g={box(0.024, 0.03, 0.014)} m={C.rubber()} p={[0, -0.2, 0.25]} r={[0.4, 0, 0]} />
        </group>
      )
    case 'plug':
      return (
        <group>
          <M g={box(0.028, 0.03, 0.022)} m={mat('#e8e6df', { roughness: 0.4 })} p={[0, 0.02, -0.005]} />
          <M g={box(0.018, 0.012, 0.012)} m={C.steel()} p={[0, 0.04, -0.005]} />
          <M g={cyl(0.007, 0.007, 0.08, seg)} m={C.rubber()} p={[0, -0.03, 0.0]} />
        </group>
      )
    case 'screw':
    default:
      return <M g={cyl(0.004, 0.004, 0.02, 8)} m={C.steel()} p={[0, 0.03, 0]} />
  }
}

/** Flexible hose as a sagging tube between two station-frame points. */
export function Hose({ from, to, dir, color = '#22262b', radius = 0.007, quality }: { from: V3; to: V3; dir: V3; color?: string; radius?: number; quality: 'demo' | 'capture' }) {
  const key = [...from, ...to, ...dir].map((v) => v.toFixed(3)).join(',')
  const g = useMemo(() => {
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    const d = new THREE.Vector3(...dir).normalize()
    const span = a.distanceTo(b)
    const p1 = a.clone().addScaledVector(d, 0.12)
    const mid = a.clone().lerp(b, 0.5)
    mid.y = Math.min(a.y, b.y) - 0.25 * span - 0.1
    if (mid.y < radius) mid.y = radius
    const p3 = b.clone().lerp(mid, 0.3)
    p3.y = Math.max(radius, b.y)
    const c = new THREE.CatmullRomCurve3([a, p1, mid, p3, b])
    return new THREE.TubeGeometry(c, quality === 'capture' ? 48 : 28, radius, quality === 'capture' ? 8 : 6, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, radius, quality])
  useEffect(() => () => g.dispose(), [g])
  return <mesh geometry={g} material={mat(color, { roughness: 0.7 })} castShadow />
}
