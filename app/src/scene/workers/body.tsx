import * as THREE from 'three'
import type { WorkerLook } from './look'
import { box, cyl, glass, lathe, limb, mat, sphere, strap, torus } from './geo'
import { RIG, palmSide, type Side, type V3 } from './rig'

// Body meshes, each attached to one bone (see Worker.tsx). Units: rig metres (1.75 m reference).

export interface BodyMats {
  skin: THREE.Material
  skinShade: THREE.Material
  hair: THREE.Material
  shirt: THREE.Material
  outer: THREE.Material
  stripe: THREE.Material
  sleeve: THREE.Material
  trousers: THREE.Material
  trouserAccent: THREE.Material
  shoes: THREE.Material
  shoeAccent: THREE.Material
  sole: THREE.Material
  gloves: THREE.Material
  glovePalm: THREE.Material
  cap: THREE.Material
  belt: THREE.Material
  metal: THREE.Material
  dark: THREE.Material
  eyeWhite: THREE.Material
  iris: THREE.Material
  lens: THREE.Material
  frame: THREE.Material
}

export function bodyMats(l: WorkerLook): BodyMats {
  const hiVis = l.top === 'vest'
  return {
    skin: mat(l.skin, { roughness: 0.62 }),
    skinShade: mat(l.skinShade, { roughness: 0.7 }),
    hair: mat(l.hair, { roughness: 0.9 }),
    shirt: mat(l.shirt, { roughness: 0.88 }),
    outer: hiVis ? mat(l.outer, { roughness: 0.7, emissive: l.outer, emissiveIntensity: 0.12 }) : mat(l.outer, { roughness: 0.85 }),
    stripe: mat(l.stripe, { roughness: 0.3, metalness: 0.5 }),
    sleeve: l.top === 'jacket' ? mat(l.outer, { roughness: 0.85 }) : mat(l.shirt, { roughness: 0.88 }),
    trousers: mat(l.trousers, { roughness: 0.9 }),
    trouserAccent: mat(l.trouserAccent, { roughness: 0.85 }),
    shoes: mat(l.shoes, { roughness: 0.55 }),
    shoeAccent: mat(l.shoeAccent, { roughness: 0.5 }),
    sole: mat('#151515', { roughness: 0.9 }),
    gloves: mat(l.gloves, { roughness: 0.95 }),
    glovePalm: mat(l.glovePalm, { roughness: 0.6 }),
    cap: mat(l.capColor, { roughness: 0.5 }),
    belt: mat('#231d18', { roughness: 0.6 }),
    metal: mat('#9aa1a8', { roughness: 0.3, metalness: 0.9 }),
    dark: mat('#1a1614', { roughness: 0.8 }),
    eyeWhite: mat('#e9e4dc', { roughness: 0.3 }),
    iris: mat('#2a1d14', { roughness: 0.2 }),
    lens: glass(l.glassesTint),
    frame: mat('#2a2d31', { roughness: 0.4 }),
  }
}

interface MProps {
  g: THREE.BufferGeometry
  m: THREE.Material
  p?: V3
  s?: V3 | number
  r?: V3
}
/** Small mesh helper. */
export function M({ g, m, p, s, r }: MProps) {
  const sc: V3 | undefined = typeof s === 'number' ? [s, s, s] : s
  return <mesh geometry={g} material={m} position={p} scale={sc} rotation={r} castShadow receiveShadow />
}

// ------------------------------------------------------------------ torso
const RIB_PROFILE: [number, number][] = [
  [0.13, -0.11],
  [0.148, -0.05],
  [0.16, 0.03],
  [0.166, 0.11],
  [0.16, 0.17],
  [0.135, 0.205],
  [0.09, 0.228],
  [0.055, 0.24],
  [0.02, 0.245],
  [0.0005, 0.246],
]
const VEST_UP_PROFILE: [number, number][] = [
  [0.152, -0.13],
  [0.162, -0.06],
  [0.172, 0.03],
  [0.177, 0.11],
  [0.17, 0.17],
  [0.145, 0.205],
  [0.11, 0.222],
  [0.098, 0.226],
]
const VEST_LOW_PROFILE: [number, number][] = [
  [0.166, -0.085],
  [0.168, 0.0],
  [0.168, 0.1],
  [0.164, 0.17],
]

export function Pelvis({ l, m, seg }: { l: WorkerLook; m: BodyMats; seg: number }) {
  const b = l.build
  return (
    <group>
      <M g={sphere(seg)} m={m.trousers} p={[0, -0.035, 0.005]} s={[0.158 * b, 0.12, 0.116 * b + l.belly * 0.4]} />
      <M g={cyl(1, 1, 0.038, seg, true)} m={m.belt} p={[0, 0.03, 0]} s={[0.157 * b, 1, 0.113 * b + l.belly * 0.5]} />
      <M g={box(0.05, 0.034, 0.012)} m={m.metal} p={[0, 0.03, -(0.113 * b + l.belly * 0.5) - 0.003]} />
    </group>
  )
}

export function Abdomen({ l, m, seg }: { l: WorkerLook; m: BodyMats; seg: number }) {
  const b = l.build
  const dz = 0.105 * b + l.belly
  const vest = l.top === 'vest'
  const zsc = (0.112 * b + l.belly) / 0.168
  return (
    <group>
      <M g={sphere(seg)} m={vest ? m.shirt : m.outer} p={[0, 0.05, -l.belly * 0.4]} s={[0.15 * b, 0.135, dz]} />
      {vest && (
        <group scale={[b, 1, zsc]} position={[0, 0.0, -l.belly * 0.3]}>
          <M g={lathe('vestlow', VEST_LOW_PROFILE, seg)} m={m.outer} />
          <M g={cyl(0.1705, 0.1705, 0.03, seg, true)} m={m.stripe} p={[0, -0.03, 0]} />
          <M g={cyl(0.1705, 0.1705, 0.03, seg, true)} m={m.stripe} p={[0, 0.06, 0]} />
        </group>
      )}
    </group>
  )
}

export function Chest({ l, m, seg }: { l: WorkerLook; m: BodyMats; seg: number }) {
  const b = l.build
  const vest = l.top === 'vest'
  const zs = 0.66
  // Front surface z at a given x on the vest ellipse (for front straps).
  const strapZ = (x: number) => -0.177 * zs * b * Math.sqrt(Math.max(0, 1 - (x / (0.177 * b)) ** 2)) - 0.004
  return (
    <group>
      <group scale={[b, 1, zs * b]}>
        <M g={lathe('rib', RIB_PROFILE, seg)} m={vest ? m.shirt : m.outer} />
        {vest && <M g={lathe('vestup', VEST_UP_PROFILE, seg)} m={m.outer} />}
        {!vest && <M g={cyl(0.1675, 0.1675, 0.028, seg, true)} m={m.stripe} p={[0, 0.06, 0]} />}
      </group>
      {vest &&
        ([-1, 1] as const).map((sd) => (
          <mesh key={sd} geometry={strap(`v${b.toFixed(3)}`, -strapZ(0.078 * b) + 0.003, 0.155, 0.07, -0.12, 0.034)} material={m.stripe} position={[sd * 0.078 * b, 0, 0]} castShadow />
        ))}
      {!vest && <M g={box(0.008, 0.3, 0.006)} m={m.dark} p={[0, 0.05, -0.166 * zs * b - 0.002]} />}
      {/* collar */}
      <M g={torus(0.058, 0.014, seg)} m={vest ? m.shirt : m.outer} p={[0, 0.225, 0.004]} r={[Math.PI / 2 + 0.25, 0, 0]} s={[1, 1, 1]} />
      {/* trapezius/shoulder slopes */}
      {([-1, 1] as const).map((sd) => (
        <M key={sd} g={sphere(seg)} m={vest ? m.outer : m.outer} p={[sd * 0.105 * b, 0.19, 0.005]} s={[0.085 * b, 0.045, 0.075 * b]} r={[0, 0, sd * -0.32]} />
      ))}
    </group>
  )
}

export function NeckMesh({ m, seg }: { m: BodyMats; seg: number }) {
  return <M g={limb(0.05, 0.054, 0.12, seg)} m={m.skin} p={[0, 0.115, 0.008]} />
}

// ------------------------------------------------------------------ head
export function Head({ l, m, seg, lite = false }: { l: WorkerLook; m: BodyMats; seg: number; lite?: boolean }) {
  const hs = seg + 8
  const hair = l.hairStyle
  const capCovers = l.headwear !== 'none'
  return (
    <group>
      {/* cranium, jaw, chin */}
      <M g={sphere(hs)} m={m.skin} p={[0, 0.098, 0.004]} s={[0.09, 0.112, 0.104]} />
      <M g={sphere(hs)} m={m.skin} p={[0, 0.045, -0.032]} s={[0.077, 0.074, 0.08]} />
      <M g={sphere(seg)} m={m.skin} p={[0, 0.0, -0.068]} s={[0.034, 0.03, 0.03]} />
      {/* brow ridge */}
      <M g={sphere(seg)} m={m.skin} p={[0, 0.103, -0.084]} s={[0.07, 0.018, 0.026]} />
      {/* eye sockets and eyes */}
      {([-1, 1] as const).map((sd) => (
        <group key={sd}>
          <M g={sphere(seg)} m={m.skinShade} p={[sd * 0.033, 0.085, -0.093]} s={[0.019, 0.012, 0.008]} />
          {!lite && <M g={sphere(10)} m={m.eyeWhite} p={[sd * 0.033, 0.085, -0.096]} s={[0.011, 0.0075, 0.006]} />}
          {!lite && <M g={sphere(8)} m={m.iris} p={[sd * 0.033, 0.085, -0.1005]} s={0.0042} />}
          {!lite && <M g={sphere(8)} m={m.hair} p={[sd * 0.034, 0.1025, -0.1045]} s={[0.017, 0.0035, 0.004]} r={[0, 0, sd * -0.12]} />}
          {/* ear */}
          <M g={sphere(seg)} m={m.skinShade} p={[sd * 0.09, 0.078, 0.004]} s={[0.012, 0.028, 0.019]} />
          {/* cheek */}
          {!lite && <M g={sphere(seg)} m={m.skin} p={[sd * 0.044, 0.058, -0.074]} s={[0.026, 0.022, 0.02]} />}
        </group>
      ))}
      {/* nose */}
      <M g={sphere(seg)} m={m.skin} p={[0, 0.07, -0.106]} s={[0.013, 0.027, 0.016]} r={[-0.35, 0, 0]} />
      <M g={sphere(seg)} m={m.skinShade} p={[0, 0.053, -0.11]} s={[0.016, 0.009, 0.01]} />
      {/* mouth */}
      <M g={sphere(10)} m={m.skinShade} p={[0, 0.032, -0.104]} s={[0.021, 0.0045, 0.006]} />
      {/* facial hair */}
      {l.facialHair === 'beard' && <M g={sphere(hs, Math.PI)} m={m.hair} p={[0, 0.034, -0.036]} s={[0.081, 0.064, 0.082]} />}
      {l.facialHair === 'stubble' && <M g={sphere(hs)} m={m.skinShade} p={[0, 0.04, -0.034]} s={[0.0785, 0.07, 0.0805]} />}
      {(l.facialHair === 'moustache' || l.facialHair === 'beard') && <M g={sphere(10)} m={m.hair} p={[0, 0.043, -0.108]} s={[0.026, 0.007, 0.008]} />}
      {/* hair */}
      {hair !== 'bald' && (
        <group rotation={[0.42, 0, 0]} position={[0, 0.1, 0.012]}>
          <M g={sphere(hs, Math.PI * (hair === 'buzz' ? 0.5 : 0.56))} m={m.hair} s={hair === 'buzz' ? [0.0915, 0.1075, 0.1065] : hair === 'crop' ? [0.096, 0.122, 0.11] : [0.095, 0.115, 0.109]} />
        </group>
      )}
      {hair === 'bald' && !capCovers && (
        <group rotation={[0.9, 0, 0]} position={[0, 0.07, 0.02]}>
          <M g={torus(0.09, 0.012, seg, Math.PI)} m={m.hair} r={[0, 0, Math.PI]} s={[1, 0.85, 1]} />
        </group>
      )}
      {hair === 'ponytail' && <M g={limb(0.024, 0.012, 0.13, seg)} m={m.hair} p={[0, 0.09, 0.108]} r={[0.35, 0, 0]} />}
      {hair === 'bun' && <M g={sphere(seg)} m={m.hair} p={[0, 0.14, 0.098]} s={0.038} />}
      {/* headwear */}
      {l.headwear === 'bumpcap' && (
        <group position={[0, 0.112, 0.006]}>
          <M g={sphere(hs, Math.PI * 0.5)} m={m.cap} s={[0.1, 0.098, 0.112]} />
          <M g={box(0.01, 0.008, 0.15)} m={m.cap} p={[0, 0.094, 0.01]} />
          <M g={cyl(0.1, 0.1, 0.006, hs, false, Math.PI / 2, Math.PI)} m={m.cap} p={[0, 0.003, -0.05]} s={[0.9, 1, 0.78]} r={[-0.08, 0, 0]} />
          <M g={cyl(1, 1, 0.014, hs, true)} m={m.dark} p={[0, 0.006, 0]} s={[0.1005, 1, 0.1125]} />
        </group>
      )}
      {l.headwear === 'beanie' && (
        <group position={[0, 0.11, 0.008]} rotation={[0.18, 0, 0]}>
          <M g={sphere(hs, Math.PI * 0.52)} m={m.cap} s={[0.099, 0.115, 0.112]} />
          <M g={cyl(1, 1.02, 0.032, hs, true)} m={m.cap} p={[0, 0.012, 0]} s={[0.102, 1, 0.115]} />
        </group>
      )}
      {/* safety glasses */}
      <group position={[0, 0.086, -0.012]}>
        <mesh geometry={cyl(0.102, 0.1, 0.036, 24, true, Math.PI - 0.98, 1.96)} material={m.lens} renderOrder={2} />
        <M g={cyl(0.103, 0.103, 0.006, 24, true, Math.PI - 0.98, 1.96)} m={m.frame} p={[0, 0.019, 0]} />
        {([-1, 1] as const).map((sd) => (
          <M key={sd} g={box(0.004, 0.006, 0.09)} m={m.frame} p={[sd * 0.091, 0.015, 0.035]} r={[0, sd * 0.12, 0]} />
        ))}
      </group>
    </group>
  )
}

// ------------------------------------------------------------------ arms
export function UpperArm({ l, m, seg }: { l: WorkerLook; m: BodyMats; seg: number }) {
  const b = l.build
  return (
    <group>
      <M g={sphere(seg)} m={l.top === 'vest' ? m.shirt : m.outer} s={[0.06 * b, 0.07, 0.06 * b]} p={[0, -0.022, 0]} />
      <M g={limb(0.057 * b, 0.045 * b, RIG.upperArmLen, seg)} m={m.sleeve} />
      {l.top === 'jacket' && <M g={cyl(0.0545 * b, 0.0525 * b, 0.03, seg, true)} m={m.stripe} p={[0, -0.13, 0]} />}
    </group>
  )
}

export function LowerArm({ l, m, seg }: { l: WorkerLook; m: BodyMats; seg: number }) {
  const b = l.build
  const rolled = l.sleeves === 'rolled' && l.top === 'vest'
  return (
    <group>
      <M g={limb(0.046 * b, 0.034 * b, RIG.lowerArmLen - 0.02, seg)} m={rolled ? m.skin : m.sleeve} />
      {rolled && <M g={cyl(0.05 * b, 0.051 * b, 0.05, seg)} m={m.sleeve} p={[0, -0.03, 0]} />}
      {/* glove cuff */}
      <M g={cyl(0.037 * b, 0.035, 0.05, seg)} m={m.gloves} p={[0, -RIG.lowerArmLen + 0.01, 0]} />
    </group>
  )
}

const FINGER_Z = [-0.027, -0.009, 0.009, 0.026]
const FINGER_LEN: [number, number][] = [
  [0.044, 0.04],
  [0.048, 0.043],
  [0.045, 0.04],
  [0.037, 0.032],
]

/** Gloved hand. curls: [thumb, index, middle, ring, pinky] 0..1. Palm faces local -x (right) / +x (left). */
export function Hand({ side, curls, m, seg, lite = false }: { side: Side; curls: number[]; m: BodyMats; seg: number; lite?: boolean }) {
  const ps = palmSide(side)
  const fs = Math.max(6, Math.round(seg * 0.5))
  const ang = (c: number, j: number) => ps * (0.08 + c * (j === 0 ? 1.15 : 1.25))
  return (
    <group>
      <M g={sphere(seg)} m={m.gloves} p={[0, -0.052, 0]} s={[0.022, 0.05, 0.043]} />
      <M g={sphere(seg)} m={m.glovePalm} p={[ps * 0.008, -0.056, 0]} s={[0.016, 0.046, 0.04]} />
      {lite && (
        // Demo quality: the four fingers as one mitten block (2 meshes instead of 8).
        <group position={[ps * 0.004, -0.092, 0]} rotation={[0, 0, ang((curls[1] + curls[2] + curls[3] + curls[4]) / 4, 0)]}>
          <M g={limb(0.0105, 0.0098, 0.045, fs)} m={m.glovePalm} s={[1, 1, 3.6]} />
          <group position={[0, -0.045, 0]} rotation={[0, 0, ang((curls[1] + curls[2] + curls[3] + curls[4]) / 4, 1) * 0.9]}>
            <M g={limb(0.0098, 0.009, 0.04, fs)} m={m.glovePalm} s={[1, 1, 3.4]} />
          </group>
        </group>
      )}
      {!lite && FINGER_Z.map((z, i) => {
        const c = curls[i + 1] ?? 0.3
        const [a, bLen] = FINGER_LEN[i]
        return (
          <group key={i} position={[ps * 0.004, -0.096 + Math.abs(z) * 0.18, z]} rotation={[0, 0, ang(c, 0)]}>
            <M g={limb(0.0105, 0.0098, a, fs)} m={m.glovePalm} />
            <group position={[0, -a, 0]} rotation={[0, 0, ang(c, 1) * 0.9]}>
              <M g={limb(0.0098, 0.009, bLen, fs)} m={m.glovePalm} />
            </group>
          </group>
        )
      })}
      <group position={[ps * 0.012, -0.028, -0.03]} rotation={[0.85, 0, 0]}>
        <group rotation={[0, 0, ps * (0.25 + (curls[0] ?? 0.3) * 0.75)]}>
          <M g={limb(0.0125, 0.011, 0.036, fs)} m={m.gloves} />
          <group position={[0, -0.036, 0]} rotation={[0, 0, ps * (curls[0] ?? 0.3) * 0.7]}>
            <M g={limb(0.011, 0.0098, 0.03, fs)} m={m.glovePalm} />
          </group>
        </group>
      </group>
    </group>
  )
}

// ------------------------------------------------------------------ legs
export function UpperLeg({ l, m, side, seg }: { l: WorkerLook; m: BodyMats; side: Side; seg: number }) {
  const b = l.build
  return (
    <group>
      <M g={limb(0.084 * b, 0.058 * b, RIG.upperLegLen, seg)} m={m.trousers} />
      <M g={box(0.014, 0.13, 0.1)} m={m.trouserAccent} p={[side * 0.071 * b, -0.21, 0.0]} r={[0, 0, side * -0.06]} />
      <M g={sphere(seg)} m={m.trouserAccent} p={[0, -RIG.upperLegLen + 0.005, -0.046 * b]} s={[0.05 * b, 0.068, 0.026]} />
    </group>
  )
}

export function LowerLeg({ l, m, seg }: { l: WorkerLook; m: BodyMats; seg: number }) {
  const b = l.build
  return (
    <group>
      <M g={limb(0.057 * b, 0.045 * b, RIG.lowerLegLen - 0.03, seg)} m={m.trousers} />
      <M g={cyl(0.056 * b, 0.06 * b, 0.07, seg, true)} m={m.trousers} p={[0, -RIG.lowerLegLen + 0.075, 0]} />
    </group>
  )
}

export function Foot({ m, seg }: { m: BodyMats; seg: number }) {
  return (
    <group>
      <M g={cyl(0.05, 0.054, 0.1, seg)} m={m.shoes} p={[0, 0.0, 0.008]} />
      <M g={sphere(seg)} m={m.shoes} p={[0, -0.028, -0.045]} s={[0.05, 0.044, 0.12]} />
      <M g={sphere(seg)} m={m.shoeAccent} p={[0, -0.034, -0.128]} s={[0.047, 0.034, 0.052]} />
      <M g={box(0.098, 0.022, 0.285)} m={m.sole} p={[0, -RIG.ankleH + 0.011, -0.06]} />
      <M g={box(0.01, 0.006, 0.07)} m={m.dark} p={[0, 0.018, -0.07]} r={[0.5, 0, 0]} />
    </group>
  )
}
