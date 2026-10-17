import { useMemo } from 'react'
import * as THREE from 'three'
import { M, finMat } from '../stations/lib/mats'
import { B, C, CX, CZ, Hose, Inst, Sph, Tor, customGeo, cylGeo, hexGeo, torusGeo, boxGeo, type InstItem, type V3 } from '../stations/lib/prims'
import { rng } from '../../lib/rng'

/**
 * Recognisable heat-pump components, built procedurally. Used both inside the product unit
 * and as loose parts presented at stations (racks, trays, kit carts).
 * All components are centred on their footprint with y = 0 at their base unless noted.
 */

/** Hermetic twin-rotary compressor with accumulator, terminal cover and rubber feet. */
export function Compressor({ r = 0.085, h = 0.32, withAccumulator = true, withMounts = true }: { r?: number; h?: number; withAccumulator?: boolean; withMounts?: boolean }) {
  const shellH = h - 0.05
  return (
    <group>
      {/* mounting foot plate (three-lug) */}
      <C rt={r * 1.25} h={0.008} p={[0, 0.03, 0]} m={M.compressor} seg={3} />
      {withMounts &&
        [0, 1, 2].map((i) => {
          const a = (i / 3) * Math.PI * 2 + Math.PI / 6
          const x = Math.cos(a) * r * 1.12, z = Math.sin(a) * r * 1.12
          return (
            <group key={i} position={[x, 0, z]}>
              <C rt={0.017} rb={0.02} h={0.028} p={[0, 0.014, 0]} m={M.rubber} seg={14} />
              <C rt={0.013} h={0.012} p={[0, 0.04, 0]} m={M.rubber} seg={12} />
              <C rt={0.012} h={0.004} p={[0, 0.048, 0]} m={M.galv} seg={12} />
              <group position={[0, 0.054, 0]}><mesh geometry={hexGeo(0.008, 0.008)} material={M.steel} castShadow /></group>
            </group>
          )
        })}
      {/* shell: lower body, welded seam, domed top */}
      <C rt={r} h={shellH} p={[0, 0.035 + shellH / 2, 0]} m={M.compressor} seg={36} />
      <Tor R={r} rad={0.004} p={[0, 0.035 + shellH * 0.68, 0]} r={[Math.PI / 2, 0, 0]} m={M.compressor} ts={40} />
      <Sph rad={r} p={[0, 0.035 + shellH, 0]} scale={[1, 0.45, 1]} m={M.compressor} ws={28} hs={12} />
      <Sph rad={r} p={[0, 0.035, 0]} scale={[1, 0.25, 1]} m={M.compressor} ws={28} hs={10} />
      {/* discharge stub on top */}
      <C rt={0.007} h={0.06} p={[0, 0.035 + shellH + r * 0.45 + 0.02, 0]} m={M.copper} seg={12} />
      {/* terminal cover (front) */}
      <B s={[0.07, 0.06, 0.04]} rad={0.008} p={[0, 0.035 + shellH * 0.8, r - 0.005]} m={M.plasticDark} />
      <C rt={0.01} h={0.03} p={[0.02, 0.035 + shellH * 0.8 + 0.035, r + 0.005]} m={M.rubber} seg={10} />
      {withAccumulator && (
        <group position={[r + 0.05, 0, -0.01]}>
          <C rt={0.045} h={h * 0.62} p={[0, 0.1 + h * 0.31, 0]} m={M.compressor} seg={24} />
          <Sph rad={0.045} p={[0, 0.1 + h * 0.62, 0]} scale={[1, 0.5, 1]} m={M.compressor} />
          <Sph rad={0.045} p={[0, 0.1, 0]} scale={[1, 0.5, 1]} m={M.compressor} />
          {/* bracket band to shell */}
          <Tor R={0.047} rad={0.004} p={[0, 0.1 + h * 0.4, 0]} r={[Math.PI / 2, 0, 0]} m={M.galv} />
          <B s={[0.04, 0.02, 0.006]} p={[-0.045, 0.1 + h * 0.4, 0]} m={M.galv} />
          {/* suction U-tube into shell */}
          <Hose pts={[[0, 0.07, 0], [0, 0.03, 0], [-0.04, 0.03, 0], [-0.05, 0.08, 0]]} rad={0.007} m={M.copper} tub={16} radial={8} />
          <C rt={0.007} h={0.05} p={[0, 0.1 + h * 0.62 + 0.04, 0]} m={M.copper} seg={10} />
        </group>
      )}
    </group>
  )
}

/** Four-way reversing valve: brass body, four copper stubs, black solenoid coil. Axis along X. */
export function FourWayValve({ brazed = false }: { brazed?: boolean }) {
  const joint = brazed ? M.copperDark : M.copper
  return (
    <group>
      <CX rt={0.016} h={0.12} m={M.brass} seg={20} />
      <CX rt={0.018} h={0.012} p={[0.06, 0, 0]} m={M.brass} seg={20} />
      <CX rt={0.018} h={0.012} p={[-0.06, 0, 0]} m={M.brass} seg={20} />
      {/* stubs: one up, three down */}
      <C rt={0.008} h={0.05} p={[0, 0.04, 0]} m={joint} seg={12} />
      {[-0.03, 0, 0.03].map((x) => (
        <C key={x} rt={0.007} h={0.05} p={[x, -0.04, 0]} m={joint} seg={12} />
      ))}
      {/* pilot valve and coil */}
      <CX rt={0.005} h={0.07} p={[0, 0.024, -0.016]} m={M.brass} seg={8} />
      <B s={[0.034, 0.04, 0.034]} rad={0.004} p={[0.005, 0.03, -0.035]} m={M.plasticDark} />
      <C rt={0.006} h={0.012} p={[0.005, 0.054, -0.035]} m={M.rubber} seg={8} />
    </group>
  )
}

/** Electronic expansion valve: brass body with black stepper-motor head. Vertical. */
export function EEV() {
  return (
    <group>
      <C rt={0.012} h={0.05} p={[0, 0.025, 0]} m={M.brass} seg={16} />
      <C rt={0.021} h={0.045} p={[0, 0.075, 0]} m={M.plasticDark} seg={20} />
      <C rt={0.018} h={0.006} p={[0, 0.1, 0]} m={M.plasticDark} seg={20} />
      <B s={[0.016, 0.014, 0.012]} p={[0.022, 0.08, 0]} m={M.plasticDark} />
      <CX rt={0.006} h={0.04} p={[-0.025, 0.02, 0]} m={M.copper} seg={10} />
      <C rt={0.006} h={0.04} p={[0, -0.02, 0]} m={M.copper} seg={10} />
    </group>
  )
}

/** Brazed plate heat exchanger. Plates stacked along X; ports on +X face. Centre at origin. */
export function PlateHX({ w = 0.12, h = 0.3, n = 34, ins = false }: { w?: number; h?: number; n?: number; ins?: boolean }) {
  const t = n * 0.0022 + 0.01
  const plates = useMemo<InstItem[]>(() => Array.from({ length: n }, (_, i) => ({ p: [-t / 2 + 0.005 + i * 0.0022, 0, 0] })), [n, t])
  return (
    <group>
      {ins ? (
        <B s={[t + 0.02, h + 0.02, w + 0.02]} rad={0.01} m={M.insulation} />
      ) : (
        <>
          <Inst g={boxGeo(0.0014, h - 0.004, w - 0.004, 0.0006)} m={M.stainless} items={plates} />
          <B s={[0.004, h, w]} rad={0.002} p={[-t / 2, 0, 0]} m={M.stainless} />
          <B s={[0.004, h, w]} rad={0.002} p={[t / 2, 0, 0]} m={M.stainless} />
        </>
      )}
      {[[h / 2 - 0.03, w / 2 - 0.03], [h / 2 - 0.03, -w / 2 + 0.03], [-h / 2 + 0.03, w / 2 - 0.03], [-h / 2 + 0.03, -w / 2 + 0.03]].map(([y, z], i) => (
        <group key={i} position={[t / 2 + 0.02, y, z]}>
          <CX rt={i < 2 ? 0.012 : 0.009} h={0.04} m={i % 2 ? M.stainless : M.copper} seg={14} />
          {i % 2 === 1 && <group position={[0.022, 0, 0]}><mesh geometry={hexGeo(0.016, 0.014)} rotation={[0, 0, Math.PI / 2]} material={M.brass} castShadow /></group>}
        </group>
      ))}
    </group>
  )
}

/** Finned coil slab: fins along local X, thickness along Z, height along Y. Centre at origin. */
export function CoilSlab({ len, h, t = 0.045 }: { len: number; h: number; t?: number }) {
  return (
    <group>
      <mesh geometry={boxGeo(len, h, t)} material={finMat(len, h)} castShadow receiveShadow />
      {/* top/bottom galvanised channels */}
      <B s={[len, 0.012, t + 0.006]} p={[0, h / 2 + 0.006, 0]} m={M.galv} />
      <B s={[len, 0.012, t + 0.006]} p={[0, -h / 2 - 0.006, 0]} m={M.galv} />
    </group>
  )
}

/** Hairpin return bends on a coil tube sheet (YZ plane, bends pointing +X). */
export function Hairpins({ h, t, seed = 'hp' }: { h: number; t: number; seed?: string }) {
  const items = useMemo<InstItem[]>(() => {
    const out: InstItem[] = []
    const rows = 2
    const pitch = 0.025
    const n = Math.floor((h - 0.04) / pitch)
    for (let r = 0; r < rows; r++)
      for (let i = 0; i < n; i += 2) {
        const y = -h / 2 + 0.03 + i * pitch + (r ? pitch / 2 : 0)
        const z = (r - 0.5) * t * 0.5
        out.push({ p: [0, y + pitch / 2, z], r: [0, 0, -Math.PI / 2] })
      }
    void seed
    return out
  }, [h, t, seed])
  return <Inst g={torusGeo(0.0125, 0.0045, 6, 12, Math.PI)} m={M.copper} items={items} />
}

/** Three-blade axial fan propeller; axis along Z, blades in XY plane. */
export function fanBladeGeo(R: number, hubR: number, n = 3) {
  return customGeo(`fan:${R.toFixed(3)}:${hubR.toFixed(3)}:${n}`, () => {
    const Nr = 18, Ns = 12
    const pos: number[] = []
    const idx: number[] = []
    for (let b = 0; b < n; b++) {
      const a0 = (b / n) * Math.PI * 2
      const base = pos.length / 3
      for (let i = 0; i <= Nr; i++) {
        const u = i / Nr
        const rr = hubR * 0.9 + (R - hubR * 0.9) * u
        let span = 1.05 - 0.25 * u
        if (u > 0.78) span *= Math.sqrt(Math.max(0.04, 1 - ((u - 0.78) / 0.22) ** 2))
        const sweep = 0.45 * u * u
        const pitch = 0.62 - 0.3 * u
        for (let j = 0; j <= Ns; j++) {
          const v = j / Ns - 0.5
          const th = a0 + sweep + v * span
          const z = v * span * rr * Math.tan(pitch) * 0.55 - 0.01 * Math.cos(v * Math.PI)
          pos.push(Math.cos(th) * rr, Math.sin(th) * rr, z)
        }
      }
      for (let i = 0; i < Nr; i++)
        for (let j = 0; j < Ns; j++) {
          const a = base + i * (Ns + 1) + j
          const bb = a + Ns + 1
          idx.push(a, bb, a + 1, a + 1, bb, bb + 1)
        }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  })
}

export function FanPropeller({ R, spin = 0 }: { R: number; spin?: number }) {
  const hub = R * 0.2
  return (
    <group rotation={[0, 0, -spin]}>
      <mesh geometry={fanBladeGeo(R, hub)} material={M.fanBlade} castShadow />
      <CZ rt={hub} h={0.07} m={M.fanBlade} seg={28} />
      <Sph rad={hub} p={[0, 0, 0.035]} scale={[1, 1, 0.45]} m={M.fanBlade} />
      {/* balancing clip, makes rotation readable */}
      <B s={[0.02, 0.012, 0.01]} p={[R * 0.55, 0, 0.012]} m={M.steel} />
    </group>
  )
}

/** Fan guard grille: concentric rings plus radial spokes, in XY plane facing +Z. */
export function FanGrille({ R }: { R: number }) {
  const rings = useMemo(() => {
    const n = Math.max(7, Math.round(R / 0.03))
    return Array.from({ length: n }, (_, i) => R * (0.18 + (0.82 * (i + 1)) / n))
  }, [R])
  const spokes = 8
  return (
    <group>
      {rings.map((rr, i) => (
        <mesh key={i} geometry={torusGeo(rr, 0.0028, 6, Math.max(32, Math.round(rr * 220)))} material={M.grille} position={[0, 0, (i / rings.length) * 0.012]} castShadow />
      ))}
      {Array.from({ length: spokes }, (_, i) => {
        const a = (i / spokes) * Math.PI * 2
        return <B key={i} s={[R * 0.86, 0.006, 0.006]} p={[Math.cos(a) * (R * 0.57), Math.sin(a) * (R * 0.57), 0.006]} r={[0, 0, a]} m={M.grille} />
      })}
      <C rt={R * 0.16} h={0.01} p={[0, 0, 0.014]} r={[Math.PI / 2, 0, 0]} m={M.grille} seg={32} />
    </group>
  )
}

/** Inverter PCB populated with components. In XZ plane, components up (+Y). */
export function PcbBoard({ w = 0.22, d = 0.16, seed = 'pcb' }: { w?: number; d?: number; seed?: string }) {
  const parts = useMemo(() => {
    const r = rng('pcb', seed)
    const smd: InstItem[] = []
    for (let i = 0; i < 70; i++) smd.push({ p: [(r() - 0.5) * w * 0.9, 0.003, (r() - 0.5) * d * 0.9], r: [0, Math.floor(r() * 2) * Math.PI / 2, 0], s: [1 + r(), 1, 1] })
    const caps: InstItem[] = []
    for (let i = 0; i < 4; i++) caps.push({ p: [-w * 0.32 + i * 0.03, 0.022, -d * 0.3] })
    return { smd, caps }
  }, [w, d, seed])
  return (
    <group>
      <B s={[w, 0.0016, d]} m={M.pcb} />
      <Inst g={boxGeo(0.006, 0.003, 0.004)} m={M.plasticDark} items={parts.smd} cast={false} />
      {/* electrolytic capacitors */}
      <Inst g={cylGeo(0.012, 0.012, 0.04, 16)} m={M.plasticBlue} items={parts.caps} />
      {/* heat sink with fins (IPM module) */}
      <group position={[w * 0.22, 0.004, d * 0.12]}>
        <B s={[0.09, 0.006, 0.07]} m={M.alu} />
        {Array.from({ length: 9 }, (_, i) => <B key={i} s={[0.003, 0.035, 0.07]} p={[-0.04 + i * 0.01, 0.02, 0]} m={M.alu} />)}
      </group>
      {/* PFC choke, relays, connectors */}
      <B s={[0.04, 0.03, 0.035]} rad={0.004} p={[-w * 0.05, 0.016, d * 0.25]} m={M.plasticDark} />
      <B s={[0.02, 0.018, 0.016]} p={[w * 0.05, 0.01, -d * 0.32]} m={M.plasticWhite} />
      <B s={[0.02, 0.018, 0.016]} p={[w * 0.15, 0.01, -d * 0.32]} m={M.plasticWhite} />
      <Tor R={0.016} rad={0.007} p={[-w * 0.3, 0.008, d * 0.25]} r={[Math.PI / 2, 0, 0]} m={M.copper} />
      {[0, 1, 2, 3].map((i) => <B key={i} s={[0.025, 0.01, 0.008]} p={[-w * 0.35 + i * 0.035, 0.006, d / 2 - 0.008]} m={M.plasticWhite} />)}
      <B s={[0.03, 0.016, 0.02]} p={[w / 2 - 0.02, 0.009, -d / 2 + 0.02]} m={M.plasticGreen} />
    </group>
  )
}

/** Wire harness bundle loosely coiled: a few coloured strands with connectors. */
export function HarnessCoil({ R = 0.09, seed = 'h' }: { R?: number; seed?: string }) {
  const strands = useMemo(() => {
    const r = rng('harness', seed)
    const mats = [M.hoseBlack, M.hoseBlue, M.cableOrange, M.hoseGrey, M.hoseRed]
    return mats.map((m, k) => {
      const pts: V3[] = []
      const off = r() * 0.02
      for (let i = 0; i <= 26; i++) {
        const a = (i / 24) * Math.PI * 2 * 1.1 + k * 0.05
        pts.push([Math.cos(a) * (R + off), 0.006 + k * 0.004 + Math.sin(i) * 0.002, Math.sin(a) * (R + off) * 0.85])
      }
      return { pts, m }
    })
  }, [R, seed])
  return (
    <group>
      {strands.map((s, i) => <Hose key={i} pts={s.pts} rad={0.0035} m={s.m} tub={72} radial={5} />)}
      <B s={[0.03, 0.016, 0.02]} p={[R + 0.02, 0.01, 0.02]} m={M.plasticWhite} />
      <B s={[0.024, 0.014, 0.016]} p={[-R + 0.01, 0.01, -0.06]} m={M.plasticDark} />
    </group>
  )
}

/** Short bent copper pipe as it arrives in a kit. */
export function CopperPipe({ len = 0.4, rad = 0.008, bend = 1 }: { len?: number; rad?: number; bend?: number }) {
  const pts: V3[] = [[-len / 2, 0, 0], [-len / 4, 0, 0], [len / 6, 0, 0.02 * bend], [len / 3, 0, 0.08 * bend], [len / 2 - 0.02, 0, 0.14 * bend]]
  return <Hose pts={pts} rad={rad} m={M.copper} tub={24} radial={8} />
}

/** Flat side panel (casing) lying on its face. */
export function CasingPanel({ w = 0.9, h = 0.7 }: { w?: number; h?: number }) {
  return (
    <group>
      <B s={[w, 0.012, h]} rad={0.004} m={M.casing} />
      <B s={[w - 0.04, 0.003, 0.012]} p={[0, 0.007, h / 2 - 0.02]} m={M.casingShade} />
      {/* louvres */}
      {Array.from({ length: 5 }, (_, i) => <B key={i} s={[0.16, 0.006, 0.012]} p={[w * 0.25, 0.008, -h * 0.25 + i * 0.03]} m={M.casingShade} />)}
    </group>
  )
}

/** Small screw, for heaps: hex head + shank. Geometry merged so it can be instanced. */
export function screwGeo() {
  return customGeo('screw', () => {
    const head = new THREE.CylinderGeometry(0.0065, 0.0065, 0.005, 6).translate(0, 0.0125, 0)
    const shank = new THREE.CylinderGeometry(0.0035, 0.0035, 0.025, 6)
    const merged = mergeGeos([head, shank])
    return merged
  })
}
export function grommetGeo() {
  return customGeo('grommet', () => new THREE.TorusGeometry(0.012, 0.007, 8, 14))
}

function mergeGeos(gs: THREE.BufferGeometry[]) {
  const pos: number[] = []
  const nor: number[] = []
  const idx: number[] = []
  let off = 0
  for (const g0 of gs) {
    const g = g0
    const p = g.getAttribute('position')
    const n = g.getAttribute('normal')
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i))
      nor.push(n.getX(i), n.getY(i), n.getZ(i))
    }
    const ix = g.index
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off)
    else for (let i = 0; i < p.count; i++) idx.push(i + off)
    off += p.count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  out.setIndex(idx)
  return out
}
