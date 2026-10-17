import { memo, useMemo } from 'react'
import * as THREE from 'three'
import { M, cardboardMat } from '../stations/lib/mats'
import { B, C, CX, CZ, Hose, Inst, customGeo, sphereGeo, type InstItem, type V3 } from '../stations/lib/prims'
import { hash01 } from '../../lib/rng'
import { Articulated, Rigid } from '../batch'
import { CoilSlab, Compressor, EEV, FanGrille, FanPropeller, FourWayValve, Hairpins, PcbBoard, PlateHX } from './parts'

/** Height of the work-pallet top above its base (the pallet base sits on the conveyor top). */
export const PALLET_TOP = 0.05
export const PALLET_SIZE: [number, number] = [1.45, 0.72]

export interface UnitDims {
  w: number
  h: number
  d: number
}
/** 6 kW ≈ 1.0 × 0.75 × 0.4 m; 12 kW ≈ 1.25 × 0.95 × 0.45 m (w × h × d). Estimate. */
export function unitDims(kw: number): UnitDims {
  const k = Math.min(1, Math.max(0, (kw - 6) / 6))
  return { w: 1.0 + 0.25 * k, h: 0.75 + 0.2 * k, d: 0.4 + 0.05 * k }
}

/** Derived layout of the unit interior (all in unit-local metres, origin = pallet base centre). */
function layout(kw: number) {
  const { w, h, d } = unitDims(kw)
  const k = (kw - 6) / 6
  const y0 = PALLET_TOP + 0.02 // bottom of feet
  const yb = y0 + 0.045 // base pan underside
  const yf = yb + 0.005 // interior floor
  const top = y0 + h
  const cw = 0.34 * w
  const xp = w / 2 - cw // partition between fan and compressor chambers
  const rc = 0.08 + 0.015 * k
  const hc = 0.3 + 0.08 * k
  const xc = xp + 0.13
  const zc = 0.035
  const fanL = -w / 2 + 0.085
  const xf = (fanL + xp) / 2
  const hi = top - 0.02 - yf
  const R = Math.min(xp - fanL, hi) * 0.43
  const yfan = yf + hi * 0.52
  const zfan = d / 2 - 0.085
  const y4 = yf + hc + 0.09 // four-way valve axis
  // plate HX (ports face +z after rotating -90° about Y)
  const ph = 0.26 + 0.06 * k
  const pw = 0.11
  const pn = 30 + Math.round(10 * k)
  const pt = pn * 0.0022 + 0.01
  const xh = w / 2 - 0.1
  const yh = yf + 0.03 + ph / 2
  const zh = -d / 2 + 0.03 + pt / 2
  const portZ = zh + pt / 2 + 0.04
  const port = (i: number): V3 => {
    const py = i < 2 ? ph / 2 - 0.03 : -ph / 2 + 0.03
    const pz = i % 2 === 0 ? pw / 2 - 0.03 : -pw / 2 + 0.03
    return [xh - pz, yh + py, portZ]
  }
  const xa = xc + rc + 0.05
  const za = zc - 0.01
  const accTop = 0.035 + yf + 0.1 + hc * 0.62 + 0.08
  const xe = xp + 0.04
  const ze = d / 2 - 0.05
  const ye = yf + 0.07
  return { w, h, d, k, y0, yb, yf, top, cw, xp, rc, hc, xc, zc, xf, R, yfan, zfan, hi, y4, ph, pw, pn, pt, xh, yh, zh, portZ, port, xa, za, accTop, xe, ye, ze }
}
type L = ReturnType<typeof layout>

/** Work pallet: steel top plate, POM locating blocks, rubber corner bumpers, RFID puck. */
const Pallet = memo(function Pallet() {
  const [pw, pd] = PALLET_SIZE
  return (
    <group>
      <B s={[pw, 0.03, pd]} rad={0.006} p={[0, 0.02, 0]} m={M.palletTop} />
      <B s={[pw - 0.1, 0.006, 0.05]} p={[0, 0.003, pd / 2 - 0.08]} m={M.palletWear} />
      <B s={[pw - 0.1, 0.006, 0.05]} p={[0, 0.003, -pd / 2 + 0.08]} m={M.palletWear} />
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <group key={`${sx}${sz}`}>
            <B s={[0.06, 0.04, 0.06]} rad={0.01} p={[sx * (pw / 2 - 0.02), 0.025, sz * (pd / 2 - 0.02)]} m={M.rubber} />
            <B s={[0.07, 0.02, 0.1]} rad={0.003} p={[sx * 0.4, PALLET_TOP + 0.01, sz * 0.18]} m={M.palletWear} />
          </group>
        )),
      )}
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * 0.52, PALLET_TOP, 0]}>
          <C rt={0.012} rb={0.015} h={0.04} p={[0, 0.02, 0]} m={M.chrome} seg={14} />
          <C rt={0.008} h={0.012} p={[0, 0.046, 0]} m={M.chrome} seg={14} />
        </group>
      ))}
      <C rt={0.022} h={0.008} p={[0.55, 0.02, pd / 2 + 0.002]} r={[Math.PI / 2, 0, 0]} m={M.plasticDark} seg={20} />
      <B s={[0.12, 0.012, 0.02]} p={[-0.6, 0.01, pd / 2 - 0.005]} m={M.steelDark} />
    </group>
  )
})

/** Galvanised base pan with feet rails, embossed ribs and drain holes. */
function BasePan({ L }: { L: L }) {
  const { w, d, y0, yb } = L
  return (
    <group>
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * w * 0.36, y0, 0]}>
          <B s={[0.06, 0.004, d + 0.05]} p={[0, 0.002, 0]} m={M.galv} />
          <B s={[0.004, 0.045, d + 0.05]} p={[-0.028, 0.0225, 0]} m={M.galv} />
          <B s={[0.004, 0.045, d + 0.05]} p={[0.028, 0.0225, 0]} m={M.galv} />
          {[-1, 1].map((sz) => (
            <C key={sz} rt={0.009} h={0.006} p={[0, 0.004, sz * (d / 2 + 0.008)]} m={M.ral9005} seg={14} />
          ))}
        </group>
      ))}
      <B s={[w, 0.004, d]} p={[0, yb + 0.002, 0]} m={M.galv} />
      <B s={[w, 0.035, 0.003]} p={[0, yb + 0.0175, d / 2 - 0.0015]} m={M.galv} />
      <B s={[w, 0.035, 0.003]} p={[0, yb + 0.0175, -d / 2 + 0.0015]} m={M.galv} />
      <B s={[0.003, 0.035, d]} p={[w / 2 - 0.0015, yb + 0.0175, 0]} m={M.galv} />
      <B s={[0.003, 0.035, d]} p={[-w / 2 + 0.0015, yb + 0.0175, 0]} m={M.galv} />
      {[-0.3, -0.1, 0.1, 0.3].map((f) => (
        <B key={f} s={[0.02, 0.006, d - 0.06]} rad={0.003} p={[f * w, yb + 0.006, 0]} m={M.galv} />
      ))}
      {[-0.4, -0.2, 0.0].map((f) => (
        <C key={f} rt={0.012} h={0.002} p={[f * w, yb + 0.0045, d * 0.28]} m={M.ral9005} seg={16} />
      ))}
      {/* bolts fixing pan to feet */}
      {[-1, 1].map((sx) =>
        [-1, 0, 1].map((sz) => <C key={`${sx}${sz}`} rt={0.007} h={0.006} p={[sx * w * 0.36, yb + 0.007, sz * d * 0.35]} m={M.steel} seg={6} />),
      )}
    </group>
  )
}

function Partition({ L }: { L: L }) {
  const { xp, yf, top, d } = L
  const hh = top - 0.02 - yf
  return (
    <group>
      <B s={[0.003, hh, d - 0.04]} p={[xp, yf + hh / 2, -0.01]} m={M.galv} />
      <B s={[0.02, hh, 0.003]} p={[xp + 0.01, yf + hh / 2, d / 2 - 0.03]} m={M.galv} />
    </group>
  )
}

function Coil({ L }: { L: L }) {
  const { w, d, xp, yf, hi } = L
  const hc = hi - 0.03
  const yc = yf + 0.01 + hc / 2
  const backL = xp - 0.025 - (-w / 2 + 0.03)
  const sideL = d - 0.13
  const t = 0.045
  return (
    <group>
      {/* back slab */}
      <group position={[(-w / 2 + 0.03 + xp - 0.025) / 2, yc, -d / 2 + 0.03]}>
        <CoilSlab len={backL} h={hc} t={t} />
      </group>
      {/* side slab (along z) */}
      <group position={[-w / 2 + 0.03, yc, -d / 2 + 0.06 + sideL / 2]} rotation={[0, Math.PI / 2, 0]}>
        <CoilSlab len={sideL} h={hc} t={t} />
      </group>
      {/* rounded corner bend */}
      <mesh geometry={customGeo(`coilcorner:${hc.toFixed(3)}`, () => new THREE.CylinderGeometry(0.05, 0.05, hc, 12, 1, false, Math.PI, Math.PI / 2))} material={M.aluDark} position={[-w / 2 + 0.06, yc, -d / 2 + 0.06]} castShadow />
      {/* tube sheet + hairpins at the compressor end */}
      <B s={[0.004, hc + 0.02, t + 0.02]} p={[xp - 0.025, yc, -d / 2 + 0.03]} m={M.galv} />
      <group position={[xp - 0.022, yc, -d / 2 + 0.03]}>
        <Hairpins h={hc} t={t} />
      </group>
      {/* tube sheet + hairpins at the front of the side slab */}
      <B s={[t + 0.02, hc + 0.02, 0.004]} p={[-w / 2 + 0.03, yc, d / 2 - 0.07]} m={M.galv} />
      <group position={[-w / 2 + 0.03, yc, d / 2 - 0.067]} rotation={[0, -Math.PI / 2, 0]}>
        <Hairpins h={hc} t={t} seed="side" />
      </group>
      {/* gas header, vertical, with stubs into coil */}
      <C rt={0.011} h={hc - 0.06} p={[xp + 0.03, yc, -d / 2 + 0.055]} m={M.copper} seg={14} />
      {Array.from({ length: Math.floor((hc - 0.1) / 0.07) }, (_, i) => (
        <CX key={i} rt={0.005} h={0.05} p={[xp + 0.005, yc - hc / 2 + 0.07 + i * 0.07, -d / 2 + 0.05]} m={M.copper} seg={8} />
      ))}
    </group>
  )
}

/** Refrigerant circuit: pipes between compressor, 4-way valve, accumulator, PHE, EEV and coil. Returns joint positions. */
function circuit(L: L) {
  const { xc, zc, hc, y4, xa, za, accTop, xp, d, yf, port, portZ, xe, ye, ze, hi } = L
  const ctop = 0.035 + yf + hc - 0.05 + L.rc * 0.45 + 0.05
  const z4 = -0.07
  const p0 = port(0)
  const p2 = port(2)
  const headerTop = yf + 0.01 + (hi - 0.03) / 2 + (hi - 0.03 - 0.06) / 2
  const pipes: { pts: V3[]; r: number }[] = [
    { pts: [[xc, ctop, zc], [xc, y4 + 0.12, zc], [xc, y4 + 0.12, z4], [xc, y4 + 0.065, z4]], r: 0.0075 },
    { pts: [[xc - 0.03, y4 - 0.065, z4], [xc - 0.03, y4 - 0.11, z4], [xp + 0.06, y4 - 0.08, -d / 2 + 0.08], [xp + 0.03, headerTop + 0.06, -d / 2 + 0.055], [xp + 0.03, headerTop, -d / 2 + 0.055]], r: 0.0095 },
    { pts: [[xc, y4 - 0.065, z4], [xc, y4 - 0.1, z4], [xa, accTop + 0.08, za], [xa, accTop + 0.01, za]], r: 0.0085 },
    { pts: [[xc + 0.03, y4 - 0.065, z4], [xc + 0.04, y4 - 0.13, z4], [p0[0], p0[1] + 0.05, portZ + 0.05], [p0[0], p0[1], portZ + 0.02], [p0[0], p0[1], portZ]], r: 0.0085 },
    { pts: [[p2[0], p2[1], portZ], [p2[0], p2[1], portZ + 0.03], [xp + 0.09, yf + 0.03, 0.06], [xe, yf + 0.025, ze], [xe, ye - 0.04, ze]], r: 0.006 },
    { pts: [[xe - 0.045, ye + 0.02, ze], [xp + 0.012, ye + 0.03, ze - 0.02], [xp + 0.02, ye + 0.08, 0.0], [xp + 0.025, ye + 0.12, -d / 2 + 0.12]], r: 0.006 },
  ]
  const joints: V3[] = [
    [xc, ctop, zc], [xc, y4 + 0.065, z4], [xc - 0.03, y4 - 0.065, z4], [xc, y4 - 0.065, z4], [xc + 0.03, y4 - 0.065, z4],
    [xp + 0.03, headerTop, -d / 2 + 0.055], [xa, accTop + 0.01, za], p0, p2, [xe, ye - 0.04, ze], [xe - 0.045, ye + 0.02, ze],
  ]
  // distributor + capillaries to coil circuits
  const dist: V3 = [xp + 0.025, ye + 0.12, -d / 2 + 0.12]
  const caps: V3[][] = []
  const n = 6
  const coilH = hi - 0.03
  for (let i = 0; i < n; i++) {
    const yT = yf + 0.06 + (i / (n - 1)) * (coilH - 0.12)
    const end: V3 = [xp - 0.012, yT, -d / 2 + 0.02 + (i % 2) * 0.02]
    caps.push([dist, [dist[0] + 0.01, dist[1] + 0.04, dist[2] - 0.01], [xp + 0.015 + i * 0.004, (dist[1] + yT) / 2 + 0.03, -d / 2 + 0.09], [xp + 0.01, yT, -d / 2 + 0.035], end])
    joints.push(end)
  }
  return { pipes, joints, caps, dist }
}

function Circuit({ L, brazed, charged }: { L: L; brazed: boolean; charged: boolean }) {
  const c = useMemo(() => circuit(L), [L])
  const jointItems = useMemo<InstItem[]>(() => c.joints.map((p) => ({ p })), [c])
  return (
    <group>
      {c.pipes.map((p, i) => (
        <Hose key={i} pts={p.pts} rad={p.r} m={M.copper} tub={40} radial={10} />
      ))}
      {c.caps.map((pts, i) => (
        <Hose key={'c' + i} pts={pts} rad={0.0022} m={M.copper} tub={30} radial={5} />
      ))}
      {/* distributor body */}
      <C rt={0.006} rb={0.014} h={0.03} p={c.dist} m={M.brass} seg={14} />
      {/* joints: bright copper sleeves before brazing, oxidised with filler fillet after */}
      <Inst g={sphereGeo(brazed ? 0.0125 : 0.0105, 12, 8)} m={brazed ? M.copperDark : M.copper} items={jointItems} />
      {brazed && <Inst g={sphereGeo(0.0115, 12, 6)} m={M.brazeFill} items={jointItems.map((j) => ({ p: [j.p[0], j.p[1] + 0.006, j.p[2]], s: [1, 0.25, 1] }))} cast={false} />}
      {/* 4-way valve */}
      <group position={[L.xc, L.y4, -0.07]}>
        <FourWayValve brazed={brazed} />
      </group>
      {/* EEV */}
      <group position={[L.xe, L.ye - 0.02, L.ze]}>
        <EEV />
      </group>
      {/* service valves on the right flank (charge port gets a red cap once charged) */}
      {[0, 1].map((i) => (
        <group key={i} position={[L.w / 2 - 0.05, L.yf + 0.09 + i * 0.07, L.d / 2 - 0.1 - i * 0.05]}>
          <B s={[0.03, 0.04, 0.03]} rad={0.004} m={M.brass} />
          <CX rt={0.008} h={0.04} p={[0.03, 0, 0]} m={M.brass} seg={12} />
          <CX rt={0.011} h={0.016} p={[0.054, 0, 0]} m={charged && i === 0 ? M.plasticRed : M.brass} seg={14} />
          <Hose pts={[[-0.015, 0, 0], [-0.06, -0.02, 0], [-0.12, 0.0, -0.08 + i * 0.03]]} rad={0.006} m={M.copper} tub={16} radial={8} />
        </group>
      ))}
    </group>
  )
}

function Water({ L }: { L: L }) {
  const p1 = L.port(1)
  const p3 = L.port(3)
  return (
    <group>
      {[p1, p3].map((p, i) => (
        <group key={i}>
          <Hose pts={[p, [p[0], p[1], p[2] + 0.04], [L.w / 2 - 0.06, p[1], p[2] + 0.05], [L.w / 2 + 0.02, p[1], p[2] + 0.05]]} rad={0.012} m={M.stainless} tub={20} radial={10} />
          <CX rt={0.017} h={0.04} p={[L.w / 2 + 0.035, p[1], p[2] + 0.05]} m={M.brass} seg={6} />
          <CX rt={0.019} h={0.015} p={[L.w / 2 + 0.062, p[1], p[2] + 0.05]} m={i === 0 ? M.plasticRed : M.plasticBlue} seg={18} />
        </group>
      ))}
    </group>
  )
}

function ElectricalBox({ L, seed }: { L: L; seed: string }) {
  const { xp, cw, top, d, w } = L
  const bw = cw - 0.04
  const bh = Math.min(0.32, top - 0.02 - (L.yf + L.hc + 0.02))
  const x = xp + 0.02 + bw / 2
  const y = top - 0.03 - bh / 2
  const z = d / 2 - 0.075
  return (
    <group>
      <group position={[x, y, z]}>
        <B s={[bw, bh, 0.004]} m={M.galv} />
        <B s={[bw, 0.004, 0.06]} p={[0, -bh / 2, 0.03]} m={M.galv} />
        <B s={[0.004, bh, 0.06]} p={[-bw / 2, 0, 0.03]} m={M.galv} />
        <group position={[0, 0.02, 0.012]} rotation={[Math.PI / 2, 0, 0]}>
          <PcbBoard w={bw - 0.03} d={bh - 0.07} seed={seed} />
        </group>
        {/* terminal block row */}
        {Array.from({ length: 7 }, (_, i) => (
          <B key={i} s={[0.014, 0.03, 0.035]} p={[-bw / 2 + 0.03 + i * 0.016, -bh / 2 + 0.025, 0.02]} m={i === 6 ? M.plasticGreen : M.ral7035} />
        ))}
        <B s={[0.04, 0.024, 0.03]} p={[bw / 2 - 0.04, -bh / 2 + 0.022, 0.018]} m={M.plasticDark} />
      </group>
      {/* harness: PCB → compressor terminal, → fan motor through partition, → 4-way coil, → EEV */}
      <Hose pts={[[x - bw / 4, y - bh / 2, z + 0.02], [x - bw / 4, y - bh / 2 - 0.05, z], [L.xc, L.yf + L.hc * 0.85, L.zc + L.rc + 0.03], [L.xc + 0.02, L.yf + L.hc * 0.8 + 0.035, L.zc + L.rc + 0.01]]} rad={0.006} m={M.hoseBlack} tub={30} radial={6} />
      <Hose pts={[[x - bw / 2 + 0.02, y, z + 0.01], [xp + 0.01, y - 0.02, z - 0.03], [xp - 0.05, L.yfan + 0.1, -d / 2 + 0.14], [L.xf + 0.05, L.yfan + 0.04, -d / 2 + 0.14]]} rad={0.005} m={M.hoseGrey} tub={30} radial={6} />
      <Hose pts={[[x, y - bh / 2, z], [x, y - bh / 2 - 0.04, z - 0.05], [L.xc + 0.005, L.y4 + 0.08, -0.12], [L.xc + 0.005, L.y4 + 0.05, -0.105]]} rad={0.003} m={M.hoseBlue} tub={24} radial={5} />
      <Hose pts={[[x - bw / 3, y - bh / 2, z + 0.01], [x - bw / 3, y - bh / 2 - 0.1, z + 0.01], [L.xe + 0.02, L.ye + 0.15, L.ze], [L.xe + 0.022, L.ye + 0.06, L.ze]]} rad={0.003} m={M.cableOrange} tub={24} radial={5} />
      {/* mains cable gland through the right side */}
      <Hose pts={[[x + bw / 2 - 0.03, y - bh / 2, z + 0.02], [w / 2 - 0.06, y - bh / 2 - 0.08, z - 0.05], [w / 2 - 0.02, y - bh / 2 - 0.1, z - 0.1]]} rad={0.007} m={M.hoseGrey} tub={20} radial={6} />
    </group>
  )
}

function FanAssembly({ L }: { L: L }) {
  const { xf, yf, top, yfan, d, R, zfan } = L
  const zb = -d / 2 + 0.105
  const hh = top - 0.02 - yf
  const motorL = Math.max(0.05, zfan - 0.045 - (zb + 0.01))
  return (
    <group>
      {[-1, 1].map((s) => (
        <group key={s}>
          <B s={[0.03, hh, 0.004]} p={[xf + s * 0.075, yf + hh / 2, zb]} m={M.galv} />
          <B s={[0.004, hh, 0.03]} p={[xf + s * 0.09, yf + hh / 2, zb + 0.015]} m={M.galv} />
        </group>
      ))}
      <B s={[0.2, 0.05, 0.004]} p={[xf, yfan, zb]} m={M.galv} />
      <B s={[0.2, 0.03, 0.004]} p={[xf, yfan + 0.08, zb]} m={M.galv} />
      <group position={[xf, yfan, zb + 0.01 + motorL / 2]}>
        <CZ rt={Math.min(0.075, R * 0.32)} h={motorL} m={M.ral9005} seg={28} />
        <CZ rt={Math.min(0.065, R * 0.28)} h={0.006} p={[0, 0, motorL / 2 + 0.003]} m={M.steelDark} seg={28} />
        <CZ rt={0.008} h={0.05} p={[0, 0, motorL / 2 + 0.02]} m={M.chrome} seg={10} />
      </group>
    </group>
  )
}

/** Panels, top cover, fan grille and wire guards. */
function Casing({ L, labelled }: { L: L; labelled: boolean }) {
  const { w, h, d, yb, top, xf, yfan, R, xp } = L
  const ph = top - 0.02 - yb
  const frontGeo = useMemo(
    () =>
      customGeo(`front:${w.toFixed(3)}:${h.toFixed(3)}`, () => {
        const s = new THREE.Shape()
        const x0 = -w / 2, y0 = 0, x1 = w / 2, y1 = ph, r = 0.01
        s.moveTo(x0 + r, y0)
        s.lineTo(x1 - r, y0)
        s.quadraticCurveTo(x1, y0, x1, y0 + r)
        s.lineTo(x1, y1 - r)
        s.quadraticCurveTo(x1, y1, x1 - r, y1)
        s.lineTo(x0 + r, y1)
        s.quadraticCurveTo(x0, y1, x0, y1 - r)
        s.lineTo(x0, y0 + r)
        s.quadraticCurveTo(x0, y0, x0 + r, y0)
        const hole = new THREE.Path()
        hole.absarc(xf, yfan - yb, R + 0.02, 0, Math.PI * 2, true)
        s.holes.push(hole)
        const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2, curveSegments: 48 })
        return g
      }),
    [w, h, ph, xf, yfan, yb, R],
  )
  const bellGeo = customGeo(`bell:${R.toFixed(3)}`, () => {
    const pts: THREE.Vector2[] = []
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * (Math.PI / 2)
      pts.push(new THREE.Vector2(R + 0.012 + 0.03 * (1 - Math.cos(a)), -0.06 + 0.03 * Math.sin(a) + (i / 10) * 0.03))
    }
    return new THREE.LatheGeometry(pts, 48)
  })
  return (
    <group>
      {/* front panel with fan aperture */}
      <mesh geometry={frontGeo} material={M.casing} position={[0, yb, d / 2 - 0.008]} castShadow receiveShadow />
      {/* bell mouth */}
      <mesh geometry={bellGeo} material={M.plasticDark} position={[xf, yfan, d / 2 - 0.012]} rotation={[Math.PI / 2, 0, 0]} />
      {/* fan grille */}
      <group position={[xf, yfan, d / 2 + 0.002]}>
        <FanGrille R={R + 0.035} />
      </group>
      {/* front service cover seam and recessed handle (compressor side) */}
      <B s={[0.003, ph * 0.9, 0.003]} p={[xp + 0.03, yb + ph * 0.5, d / 2 + 0.0]} m={M.casingShade} />
      <B s={[0.12, 0.025, 0.006]} rad={0.006} p={[(xp + w / 2) / 2 + 0.01, top - 0.1, d / 2 + 0.001]} m={M.ral7016} />
      {/* right side panel */}
      <B s={[0.012, ph, d + 0.004]} rad={0.004} p={[w / 2 - 0.003, yb + ph / 2, 0]} m={M.casing} />
      <B s={[0.004, 0.035, 0.12]} rad={0.008} p={[w / 2 + 0.001, top - 0.12, 0]} m={M.ral7016} />
      {[0, 1, 2].map((i) => (
        <CX key={i} rt={0.011} h={0.016} p={[w / 2 + 0.006, yb + 0.06 + i * 0.045, -d / 2 + 0.06]} m={M.plasticDark} seg={6} />
      ))}
      {/* valve cover on right flank */}
      <B s={[0.008, 0.18, 0.16]} rad={0.003} p={[w / 2 + 0.004, yb + 0.14, d / 2 - 0.12]} m={M.casingShade} />
      {labelled && <B s={[0.002, 0.07, 0.11]} p={[w / 2 + 0.008, top - 0.24, -d / 2 + 0.12]} m={M.alu} />}
      {/* back: solid panel behind compressor chamber, wire guard over coil */}
      <B s={[w / 2 - xp, ph, 0.01]} rad={0.003} p={[(w / 2 + xp) / 2, yb + ph / 2, -d / 2 + 0.002]} m={M.casing} />
      <mesh geometry={planeGeoCached(xp + w / 2 - 0.02, ph - 0.04)} material={M.guardMesh} position={[(xp - w / 2) / 2, yb + ph / 2, -d / 2 - 0.004]} />
      {/* left: wire guard over side coil */}
      <mesh geometry={planeGeoCached(d - 0.04, ph - 0.04)} material={M.guardMesh} position={[-w / 2 - 0.004, yb + ph / 2, 0]} rotation={[0, Math.PI / 2, 0]} />
      {/* corner posts */}
      {[[-w / 2 + 0.01, -d / 2 + 0.01], [-w / 2 + 0.01, d / 2 - 0.015]].map(([x, z], i) => (
        <B key={i} s={[0.022, ph, 0.022]} rad={0.004} p={[x, yb + ph / 2, z]} m={M.casing} />
      ))}
      {/* top cover with drip edge */}
      <B s={[w + 0.02, 0.022, d + 0.02]} rad={0.007} p={[0, top - 0.011, 0]} m={M.casing} />
      <B s={[w + 0.026, 0.008, d + 0.026]} rad={0.003} p={[0, top - 0.026, 0]} m={M.casingShade} />
    </group>
  )
}

const planeCache = new Map<string, THREE.PlaneGeometry>()
function planeGeoCached(a: number, b: number) {
  const k = `${a.toFixed(3)}:${b.toFixed(3)}`
  let g = planeCache.get(k)
  if (!g) {
    g = new THREE.PlaneGeometry(a, b)
    planeCache.set(k, g)
  }
  return g
}

/** Packed: carton on a corrugated base with PP straps and edge boards. */
function Carton({ L, seed }: { L: L; seed: string }) {
  const { w, h, d } = L
  const bw = w + 0.08, bh = h + 0.1, bd = d + 0.08
  const y0 = PALLET_TOP
  const mat = cardboardMat(Math.floor(hash01('carton', seed) * 3))
  return (
    <group>
      <B s={[bw + 0.02, 0.06, bd + 0.02]} p={[0, y0 + 0.03, 0]} m={M.cardboardDark} />
      <B s={[bw, bh, bd]} rad={0.006} p={[0, y0 + 0.06 + bh / 2, 0]} m={mat} />
      {/* tape over top flap seam and down the ends */}
      <B s={[bw + 0.004, 0.002, 0.05]} p={[0, y0 + 0.06 + bh + 0.001, 0]} m={M.tape} />
      {[-1, 1].map((s) => <B key={s} s={[0.002, 0.12, 0.05]} p={[s * (bw / 2 + 0.001), y0 + 0.06 + bh - 0.06, 0]} m={M.tape} />)}
      {/* flap seam */}
      <B s={[bw - 0.01, 0.0015, 0.003]} p={[0, y0 + 0.06 + bh + 0.0025, 0]} m={M.cardboardDark} />
      {/* straps around (z-y loops) */}
      {[-0.28, 0.28].map((f) => (
        <group key={f} position={[f * bw, 0, 0]}>
          <B s={[0.016, 0.003, bd + 0.006]} p={[0, y0 + 0.06 + bh + 0.002, 0]} m={M.strap} />
          <B s={[0.016, bh + 0.06, 0.003]} p={[0, y0 + (bh + 0.06) / 2, bd / 2 + 0.003]} m={M.strap} />
          <B s={[0.016, bh + 0.06, 0.003]} p={[0, y0 + (bh + 0.06) / 2, -bd / 2 - 0.003]} m={M.strap} />
          <B s={[0.03, 0.008, 0.012]} p={[0, y0 + 0.06 + bh + 0.006, 0.08]} m={M.galv} />
        </group>
      ))}
      {/* vertical edge boards */}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => <B key={`${sx}${sz}`} s={[0.035, bh, 0.035]} p={[sx * (bw / 2 - 0.012), y0 + 0.06 + bh / 2, sz * (bd / 2 - 0.012)]} m={M.cardboardDark} />),
      )}
    </group>
  )
}

/** Kit tote riding on the pallet after kitting (pipes, valves, grommets). */
function KitTote() {
  return (
    <group position={[0, PALLET_TOP, 0]}>
      <B s={[0.6, 0.02, 0.4]} rad={0.004} p={[0, 0.01, 0]} m={M.plasticBlue} />
      {[[0, 0.06, 0.195, 0.6, 0.12, 0.01], [0, 0.06, -0.195, 0.6, 0.12, 0.01], [0.295, 0.06, 0, 0.01, 0.12, 0.4], [-0.295, 0.06, 0, 0.01, 0.12, 0.4]].map((b, i) => (
        <B key={i} s={[b[3], b[4], b[5]]} p={[b[0], b[1], b[2]]} m={M.plasticBlue} />
      ))}
      <Hose pts={[[-0.25, 0.04, -0.1], [0, 0.04, -0.1], [0.12, 0.06, 0.0], [0.24, 0.05, 0.12]]} rad={0.008} m={M.copper} tub={20} />
      <Hose pts={[[-0.25, 0.05, 0.05], [-0.05, 0.05, 0.08], [0.05, 0.07, 0.15], [0.2, 0.06, 0.15]]} rad={0.0065} m={M.copper} tub={20} />
      <group position={[-0.15, 0.05, 0.1]}>
        <FourWayValve />
      </group>
      <group position={[0.15, 0.03, -0.1]}>
        <EEV />
      </group>
    </group>
  )
}

export interface ProductUnitProps {
  kw: 6 | 9 | 12 | number
  /** Index of last completed station, 0..10 (kitting .. packing). */
  stage: number
  /** Fan rotation in radians. */
  fanSpin: number
  seed: string
}

const StaticUnit = memo(function StaticUnit({ kw, stage, seed }: { kw: number; stage: number; seed: string }) {
  const L = useMemo(() => layout(kw), [kw])
  if (stage >= 10) {
    return (
      <group>
        <Pallet />
        <Carton L={L} seed={seed} />
      </group>
    )
  }
  return (
    <group>
      <Pallet />
      {stage <= 0 && <KitTote />}
      {stage >= 1 && <BasePan L={L} />}
      {stage >= 2 && (
        <>
          <Partition L={L} />
          <Coil L={L} />
          <group position={[L.xc, L.yf, L.zc]}>
            <Compressor r={L.rc} h={L.hc} />
          </group>
          <group position={[L.xh, L.yh, L.zh]} rotation={[0, -Math.PI / 2, 0]}>
            <PlateHX w={L.pw} h={L.ph} n={L.pn} ins={stage >= 5} />
          </group>
          <Circuit L={L} brazed={stage >= 3} charged={stage >= 5} />
          <Water L={L} />
        </>
      )}
      {stage >= 6 && (
        <>
          <ElectricalBox L={L} seed={seed} />
          <FanAssembly L={L} />
        </>
      )}
      {stage >= 7 && <Casing L={L} labelled={stage >= 9} />}
    </group>
  )
})

/**
 * R290 monobloc outdoor unit on its work pallet, built up to `stage`. Origin = pallet base centre; front (fan) faces +z.
 * Merged as one rigid batch (a few draws per unit) that rides along with the unit; it rebuilds when the
 * stage adds parts. The spinning fan is its own articulated batch.
 */
export function ProductUnit({ kw, stage, fanSpin, seed }: ProductUnitProps) {
  const L = useMemo(() => layout(kw), [kw])
  const s = Math.max(0, Math.min(10, Math.floor(stage)))
  return (
    <Rigid>
      <StaticUnit kw={kw} stage={s} seed={seed} />
      {s >= 6 && s < 10 && (
        <group position={[L.xf, L.yfan, L.zfan]}>
          <Articulated>
            <FanPropeller R={L.R} spin={fanSpin + hash01('fan', seed) * 6.28} />
          </Articulated>
        </group>
      )}
    </Rigid>
  )
}
