import { memo } from 'react'
import { Articulated, MergeSkip } from '../../batch'
import { M, lampMat } from '../lib/mats'
import { B, C, CX, CZ, Hose, Sph, Tor, frac, keyed, type V3 } from '../lib/prims'
import { Balancer, BottleCart, BrazingTorch, Cabinet, EuroPallet, Heap, Monitor, ScannerHolster } from '../lib/common'
import { PartModel, isTiny } from '../lib/presentation'
import { boxGeo, cylGeo } from '../lib/prims'
import { grommetGeo, screwGeo } from '../../units/parts'
import { Compressor, CopperPipe, FourWayValve } from '../../units/parts'
import type { KindProps } from './types'

/* ------------------------------------------------------------------ kitting */

/** Gravity flow rack (carton live storage) with pick-to-light; front faces -z. */
const FlowRack = memo(function FlowRack() {
  const W = 1.9, D = 0.85, H = 2.0
  const levels = [0.35, 0.8, 1.25, 1.7]
  const fills: Parameters<typeof PartModel>[0]['shape'][] = ['pipe', 'valve4', 'eev', 'grommet', 'screw', 'cap', 'pcb', 'harness', 'pipe', 'eev', 'tie', 'label', 'valve4', 'pipe', 'cap', 'motor', 'screw', 'grommet', 'pipe', 'eev']
  return (
    <group>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => <B key={`${sx}${sz}`} s={[0.05, H, 0.05]} p={[sx * (W / 2), H / 2, sz * (D / 2)]} m={M.ral5010} />),
      )}
      {[-1, 1].map((sx) => <B key={sx} s={[0.03, 0.03, D]} p={[sx * W / 2, H, 0]} m={M.ral5010} />)}
      {levels.map((y, li) => (
        <group key={y} position={[0, y, 0]} rotation={[-0.16, 0, 0]}>
          <B s={[W, 0.03, 0.04]} p={[0, 0, -D / 2]} m={M.ral5010} />
          <B s={[W, 0.03, 0.04]} p={[0, 0, D / 2]} m={M.ral5010} />
          {Array.from({ length: 6 }, (_, i) => <B key={i} s={[0.03, 0.02, D]} p={[-W / 2 + 0.17 + i * 0.31, 0.0, 0]} m={M.alu} />)}
          {Array.from({ length: 5 }, (_, i) => {
            const shape = fills[(li * 5 + i) % fills.length]
            return (
              <group key={i} position={[-W / 2 + 0.32 + i * 0.315, 0.012, -0.12]}>
                <B s={[0.29, 0.005, 0.42]} p={[0, 0.0025, 0]} m={li % 2 ? M.plasticBlue : M.plasticGrey} />
                {[-1, 1].map((s) => <B key={s} s={[0.005, 0.14, 0.42]} p={[s * 0.145, 0.07, 0]} m={li % 2 ? M.plasticBlue : M.plasticGrey} />)}
                <B s={[0.29, 0.14, 0.005]} p={[0, 0.07, 0.21]} m={li % 2 ? M.plasticBlue : M.plasticGrey} />
                <B s={[0.29, 0.07, 0.005]} p={[0, 0.035, -0.21]} m={li % 2 ? M.plasticBlue : M.plasticGrey} />
                {isTiny(shape) ? (
                  <Heap g={shape === 'screw' ? screwGeo() : shape === 'grommet' ? grommetGeo() : shape === 'cap' ? cylGeo(0.012, 0.012, 0.016, 10) : boxGeo(0.08, 0.002, 0.005)} m={shape === 'screw' ? M.steel : shape === 'grommet' ? M.rubber : shape === 'cap' ? M.plasticRed : M.plasticDark} w={0.27} d={0.4} n={110} seed={`fr${li}${i}`} height={0.07} />
                ) : (
                  [0, 1, 2, 3].map((k) => (
                    <group key={k} position={[((k % 2) - 0.5) * 0.12, 0.006 + Math.floor(k / 2) * 0.02, (Math.floor(k / 2) - 0.5) * 0.18]} rotation={[0, k * 0.4, 0]} scale={shape === 'pcb' || shape === 'harness' ? 0.6 : shape === 'pipe' ? 0.5 : 0.9}>
                      <PartModel shape={shape} seed={`fr${li}${i}${k}`} />
                    </group>
                  ))
                )}
                {/* pick-to-light module */}
                <B s={[0.06, 0.04, 0.025]} p={[0, -0.03, -0.24]} m={M.plasticDark} />
              </group>
            )
          })}
        </group>
      ))}
    </group>
  )
})

function PickLights({ t, working }: { t: number; working: boolean }) {
  const levels = [0.35, 0.8, 1.25, 1.7]
  const active = working ? Math.floor(t / 3.5) % 20 : -1
  return (
    <group>
      {levels.map((y, li) => (
        <group key={y} position={[0, y, 0]} rotation={[-0.16, 0, 0]}>
          {Array.from({ length: 5 }, (_, i) => (
            <mesh key={i} position={[-1.9 / 2 + 0.32 + i * 0.315, -0.012 - 0.018, -0.12 - 0.253]}>
              <boxGeometry args={[0.03, 0.018, 0.004]} />
              <primitive object={lampMat('green', li * 5 + i === active)} attach="material" />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

/** Pallet racking with boxed compressors and coils (supermarket), far side. */
const Supermarket = memo(function Supermarket() {
  const W = 2.8
  return (
    <group>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <group key={`${sx}${sz}`} position={[sx * W / 2, 0, sz * 0.45]}>
            <B s={[0.08, 2.4, 0.06]} p={[0, 1.2, 0]} m={M.ral5010} />
            <B s={[0.16, 0.01, 0.12]} p={[0, 0.005, 0]} m={M.galv} />
          </group>
        )),
      )}
      {[0.12, 1.35].map((y) => (
        <group key={y}>
          {[-1, 1].map((sz) => <B key={sz} s={[W, 0.1, 0.05]} p={[0, y + 0.05, sz * 0.45]} m={M.ral2004} />)}
          {[-1, 0, 1].map((i) => <B key={i} s={[0.04, 0.02, 0.92]} p={[i * 0.9, y + 0.1, 0]} m={M.galv} />)}
        </group>
      ))}
      {/* compressor cartons on pallet, lower level */}
      <group position={[-0.68, 0.22, 0]}>
        <EuroPallet>
          {[-1, 1].map((sx) =>
            [-1, 1].map((sz) => <B key={`${sx}${sz}`} s={[0.32, 0.42, 0.3]} rad={0.004} p={[sx * 0.2, 0.21, sz * 0.18]} m={M.cardboard} />),
          )}
        </EuroPallet>
      </group>
      {/* open compressor tray, lower right */}
      <group position={[0.68, 0.22, 0]}>
        <EuroPallet>
          {[-1, 1].map((sx) =>
            [-1, 1].map((sz) => (
              <group key={`${sx}${sz}`} position={[sx * 0.25, 0, sz * 0.18]}>
                <Compressor r={0.08} h={0.3} withMounts={false} />
              </group>
            )),
          )}
        </EuroPallet>
      </group>
      {/* coil cartons, upper */}
      {[-0.7, 0.7].map((x) => (
        <group key={x}>
          <B s={[1.1, 0.12, 0.75]} p={[x, 1.52, 0]} m={M.cardboard} />
          <B s={[1.1, 0.12, 0.75]} p={[x, 1.645, 0]} m={M.cardboardDark} />
          <B s={[1.0, 0.004, 0.05]} p={[x, 1.708, 0]} m={M.tape} />
        </group>
      ))}
    </group>
  )
})

export function Kitting({ t, working, robot }: KindProps) {
  return (
    <group>
      <group position={[0, 0, -1.4]}>
        <Supermarket />
      </group>
      {!robot && (
        <>
          <group position={[0, 0, 1.95]}>
            <FlowRack />
            {/* pick-to-light lamps swap material: drawn on their own */}
            <MergeSkip>
              <PickLights t={t} working={working} />
            </MergeSkip>
          </group>
          <group position={[1.35, 1.3, 1.35]} rotation={[0, -Math.PI / 2 - 0.4, 0]}>
            <Monitor />
          </group>
          <C rt={0.03} h={1.3} p={[1.35, 0.65, 1.55]} m={M.alu} />
          <B s={[0.3, 0.02, 0.3]} p={[1.35, 0.01, 1.55]} m={M.ral7016} />
          <group position={[1.35, 1.0, 1.42]} rotation={[0, Math.PI, 0]}>
            <ScannerHolster />
          </group>
        </>
      )}
      {/* stacked empty kit totes */}
      <group position={[-1.5, 0, -0.6]}>
        {Array.from({ length: 6 }, (_, i) => (
          <group key={i} position={[0, 0.04 + i * 0.13, 0]}>
            <B s={[0.6, 0.12, 0.4]} rad={0.006} p={[0, 0.06, 0]} m={M.plasticBlue} />
            <B s={[0.12, 0.03, 0.01]} p={[0, 0.08, 0.2]} m={M.plasticDark} />
          </group>
        ))}
        <B s={[0.62, 0.04, 0.42]} p={[0, 0.02, 0]} m={M.ral7016} />
      </group>
    </group>
  )
}

/* --------------------------------------------------------------- base_frame */

/** Torque reaction arm on a pillar with a nutrunner, swinging over the unit when working. */
function ReactionArm({ t, working }: { t: number; working: boolean }) {
  const u = frac(t / 9)
  const a1 = working ? keyed([[0, 0.9], [0.25, 0.3], [0.5, -0.15], [0.75, 0.25], [1, 0.9]], u) : 1.25
  const a2 = working ? keyed([[0, -1.6], [0.25, -1.0], [0.5, -0.7], [0.75, -1.1], [1, -1.6]], u) : -2.3
  const drop = working ? keyed([[0, 0], [0.2, 0.18], [0.3, 0.0], [0.45, 0.18], [0.55, 0], [1, 0]], u) : 0
  return (
    <group>
      <B s={[0.4, 0.02, 0.4]} p={[0, 0.01, 0]} m={M.ral7016} />
      <C rt={0.065} h={1.55} p={[0, 0.79, 0]} m={M.ral7035} seg={24} />
      <C rt={0.09} h={0.08} p={[0, 1.6, 0]} m={M.ral7016} seg={24} />
      <group position={[0, 1.62, 0]} rotation={[0, a1, 0]}>
        {[0, 0.07].map((y) => <B key={y} s={[0.62, 0.035, 0.05]} rad={0.01} p={[0.31, y, 0]} m={M.alu} />)}
        <C rt={0.05} h={0.14} p={[0.62, 0.035, 0]} m={M.ral7016} />
        <group position={[0.62, 0, 0]} rotation={[0, a2, 0]}>
          {[0, 0.07].map((y) => <B key={y} s={[0.55, 0.03, 0.045]} rad={0.01} p={[0.275, y, 0]} m={M.alu} />)}
          <group position={[0.55, -0.06 - drop, 0]}>
            <C rt={0.04} h={0.08} p={[0, 0.03, 0]} m={M.ral7016} />
            <C rt={0.032} h={0.26} p={[0, -0.13, 0]} m={M.ral5015} seg={20} />
            {[-1, 1].map((s) => <B key={s} s={[0.14, 0.025, 0.025]} rad={0.008} p={[s * 0.09, -0.08, 0]} m={M.rubber} />)}
            <C rt={0.022} rb={0.014} h={0.05} p={[0, -0.285, 0]} m={M.steelDark} />
            <C rt={0.006} h={0.05} p={[0, -0.33, 0]} m={M.chrome} seg={8} />
          </group>
        </group>
      </group>
      <Hose pts={[[0, 1.7, 0], [0.2, 1.9, 0.1], [0.5, 1.85, 0.2], [0.8, 1.75, 0.3]]} rad={0.008} m={M.hoseBlack} tub={20} radial={6} />
    </group>
  )
}

const FeetRack = memo(function FeetRack() {
  return (
    <group>
      <B s={[0.9, 0.04, 0.5]} p={[0, 0.3, 0]} m={M.ral5015} />
      <B s={[0.9, 0.04, 0.5]} p={[0, 0.85, 0]} m={M.ral5015} />
      {[-1, 1].map((sx) => [-1, 1].map((sz) => <B key={`${sx}${sz}`} s={[0.04, 1.0, 0.04]} p={[sx * 0.43, 0.5, sz * 0.23]} m={M.ral5015} />))}
      {[0.32, 0.87].map((y) =>
        Array.from({ length: 6 }, (_, i) => (
          <group key={`${y}${i}`} position={[-0.32 + i * 0.13, y + 0.02, 0]} rotation={[0, Math.PI / 2, 0]}>
            <PartModel shape="feet" />
            <group position={[0, 0.05, 0]}><PartModel shape="feet" /></group>
          </group>
        )),
      )}
    </group>
  )
})

export function BaseFrame({ t, working, robot }: KindProps) {
  return (
    <group>
      {!robot && (
        <group position={[0.75, 0, -0.85]}>
          <Articulated>
            <ReactionArm t={t} working={working} />
          </Articulated>
        </group>
      )}
      <group position={[-0.95, 0, -1.25]}>
        <FeetRack />
      </group>
      <group position={[0.9, 0, -1.6]}>
        <Cabinet w={0.6} h={1.6} d={0.35} lamps={[['green', working], ['amber', false]]} />
      </group>
      {/* rivet nut setter on the bench edge */}
      <group position={[-1.45, 0, -0.6]}>
        <B s={[0.5, 0.85, 0.4]} rad={0.008} p={[0, 0.425, 0]} m={M.ral7035} />
        <C rt={0.04} h={0.3} p={[0, 1.0, 0]} m={M.ral5015} />
        <C rt={0.008} h={0.08} p={[0, 0.81, 0]} m={M.chrome} />
        <B s={[0.12, 0.1, 0.12]} p={[0, 1.2, 0]} m={M.ral7016} />
      </group>
    </group>
  )
}

/* --------------------------------------------------------- compressor_mount */

/** Pillar jib crane with chain hoist and compressor gripper. Pivot at origin. */
function JibCrane({ t, working, pick, place }: { t: number; working: boolean; pick: V3; place: V3 }) {
  const u = frac(t / 16)
  const k = working ? keyed([[0, 0], [0.25, 0], [0.55, 1], [0.8, 1], [1, 0]], u) : 0.5
  const tx = pick[0] + (place[0] - pick[0]) * k
  const tz = pick[2] + (place[2] - pick[2]) * k
  const ang = Math.atan2(-tz, tx)
  const r = Math.hypot(tx, tz)
  const yTop = 2.25
  const hookY = working ? keyed([[0, 1.4], [0.1, pick[1]], [0.2, pick[1]], [0.3, 1.5], [0.55, 1.5], [0.65, place[1]], [0.75, place[1]], [0.85, 1.6], [1, 1.4]], u) : 1.7
  const carrying = working && u > 0.18 && u < 0.72
  const chain = yTop - 0.35 - hookY
  return (
    <group>
      <B s={[0.6, 0.03, 0.6]} p={[0, 0.015, 0]} m={M.ral7016} />
      {[-1, 1].map((a) => [-1, 1].map((b) => <C key={`${a}${b}`} rt={0.015} h={0.04} p={[a * 0.25, 0.04, b * 0.25]} m={M.steel} seg={6} />))}
      <C rt={0.1} h={yTop + 0.1} p={[0, (yTop + 0.1) / 2, 0]} m={M.ral1003} seg={24} />
      <group position={[0, yTop, 0]} rotation={[0, ang, 0]}>
        <C rt={0.13} h={0.12} m={M.ral1003} seg={24} />
        {/* I-beam boom */}
        <B s={[2.2, 0.012, 0.1]} p={[1.1, 0.07, 0]} m={M.ral1003} />
        <B s={[2.2, 0.012, 0.1]} p={[1.1, -0.07, 0]} m={M.ral1003} />
        <B s={[2.2, 0.13, 0.008]} p={[1.1, 0, 0]} m={M.ral1003} />
        <B s={[0.9, 0.012, 0.012]} p={[0.45, 0.25, 0]} r={[0, 0, -0.3]} m={M.ral1003} />
        <B s={[0.06, 0.2, 0.12]} p={[2.17, 0.0, 0]} m={M.rubber} />
        {/* trolley + hoist */}
        <group position={[r, -0.12, 0]}>
          <B s={[0.16, 0.06, 0.14]} p={[0, 0.03, 0]} m={M.steelDark} />
          <B s={[0.28, 0.2, 0.2]} rad={0.02} p={[0, -0.12, 0]} m={M.ral1003} />
          <CX rt={0.07} h={0.08} p={[0.17, -0.12, 0]} m={M.ral7016} />
          <B s={[0.08, 0.1, 0.06]} p={[0, -0.07, 0.13]} m={M.ral7016} />
          {/* chain length changes every frame (new geometry), so it is drawn on its own */}
          <MergeSkip>
            <C rt={0.006} h={chain} p={[0, -0.22 - chain / 2, 0]} m={M.steelDark} seg={6} />
          </MergeSkip>
          {/* pendant */}
          <Hose pts={[[0, -0.2, 0.1], [0.05, -0.6, 0.15], [0.05, -1.0, 0.15]]} rad={0.005} m={M.hoseBlack} tub={12} radial={5} />
          <B s={[0.06, 0.18, 0.05]} rad={0.012} p={[0.05, -1.1, 0.15]} m={M.ral1003} />
          <group position={[0, -0.22 - chain, 0]}>
            <Tor R={0.03} rad={0.007} r={[0, 0, 0]} m={M.ral1003} />
            {/* three-jaw gripper */}
            <C rt={0.1} h={0.03} p={[0, -0.05, 0]} m={M.ral7016} />
            {[0, 1, 2].map((i) => {
              const a = (i / 3) * Math.PI * 2
              const rr = carrying ? 0.09 : 0.12
              return (
                <group key={i} position={[Math.cos(a) * rr, -0.11, Math.sin(a) * rr]}>
                  <B s={[0.02, 0.12, 0.03]} r={[0, -a, 0]} m={M.steelDark} />
                </group>
              )
            })}
            <B s={[0.03, 0.1, 0.03]} p={[0, -0.0, 0.11]} m={M.plasticRed} />
            {/* always mounted (shown while carrying) so the crane's batch does not rebuild every lift */}
            <group position={[0, -0.47, 0]} visible={carrying}>
              <Articulated>
                <Compressor r={0.085} h={0.33} withMounts={false} />
              </Articulated>
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}

export function CompressorMount({ t, working, robot }: KindProps) {
  return (
    <group>
      {!robot && (
        <>
          <group position={[-1.35, 0, -1.05]}>
            <Articulated>
              <JibCrane t={t} working={working} pick={[1.75, 0.65, -0.25]} place={[1.65, 1.45, 1.085]} />
            </Articulated>
          </group>
          <group position={[0.4, 0, -1.3]}>
            <EuroPallet>
              {[-1, 0, 1].map((sx) =>
                [-1, 1].map((sz) => (
                  <group key={`${sx}${sz}`} position={[sx * 0.36, 0, sz * 0.2]}>
                    <B s={[0.3, 0.02, 0.3]} p={[0, 0.01, 0]} m={M.cardboardDark} />
                    {!(sx === 0 && sz === 1) && <group position={[0, 0.02, 0]}><Compressor r={0.085} h={0.33} withMounts={false} /></group>}
                  </group>
                )),
              )}
            </EuroPallet>
          </group>
        </>
      )}
      {robot && (
        <group position={[1.0, 0, -0.95]}>
          <EuroPallet>
            {[-1, 1].map((sx) =>
              [-1, 1].map((sz) => (
                <group key={`${sx}${sz}`} position={[sx * 0.3, 0, sz * 0.2]}>
                  <Compressor r={0.085} h={0.33} withMounts={false} />
                </group>
              )),
            )}
          </EuroPallet>
        </group>
      )}
      <group position={[1.45, 0, -1.6]}>
        <Cabinet w={0.5} h={1.5} d={0.3} lamps={[['green', working]]} />
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ brazing */

const FumeArm = memo(function FumeArm() {
  const hood: V3 = [0.75, 1.85, 0.85]
  return (
    <group>
      <B s={[0.3, 0.02, 0.3]} p={[0, 0.01, 0]} m={M.ral7016} />
      <C rt={0.08} h={2.2} p={[0, 1.1, 0]} m={M.ral7035} seg={20} />
      <C rt={0.11} h={0.15} p={[0, 2.25, 0]} m={M.ral3000} seg={20} />
      {/* main duct up to ceiling */}
      <C rt={0.08} h={0.6} p={[0, 2.6, 0]} m={M.galv} seg={20} />
      <Hose pts={[[0, 2.3, 0.05], [0.1, 2.38, 0.25], [0.35, 2.35, 0.5], [0.55, 2.2, 0.72], [hood[0], hood[1] + 0.2, hood[2]], [hood[0], hood[1] + 0.06, hood[2]]]} rad={0.065} m={M.hoseGrey} tub={48} radial={14} />
      {/* support struts and friction joints */}
      <B s={[0.7, 0.025, 0.025]} p={[0.2, 2.42, 0.32]} r={[0, -0.95, 0.15]} m={M.alu} />
      <Sph rad={0.05} p={[0.38, 2.37, 0.5]} m={M.plasticDark} />
      <Sph rad={0.045} p={[0.56, 2.2, 0.72]} m={M.plasticDark} />
      {/* hood */}
      <group position={hood}>
        <C rt={0.07} rb={0.2} h={0.15} m={M.ral3000} seg={28} open />
        <C rt={0.2} h={0.02} p={[0, -0.08, 0]} m={M.ral3000} seg={28} open />
        <C rt={0.012} h={0.2} p={[0.22, 0, 0]} r={[0, 0, 0.8]} m={M.plasticDark} seg={8} />
      </group>
    </group>
  )
})

function WeldCurtain({ len }: { len: number }) {
  return (
    <group>
      {[0, len].map((z) => (
        <group key={z}>
          <C rt={0.02} h={1.9} p={[0, 0.95, z]} m={M.ral7035} seg={10} />
          <B s={[0.5, 0.02, 0.05]} p={[0, 0.01, z]} m={M.ral7035} />
          <CX rt={0.025} h={0.04} p={[0.22, 0.03, z]} m={M.rubber} />
          <CX rt={0.025} h={0.04} p={[-0.22, 0.03, z]} m={M.rubber} />
        </group>
      ))}
      <CZ rt={0.015} h={len} p={[0, 1.88, len / 2]} m={M.ral7035} seg={10} />
      <mesh position={[0, 1.05, len / 2]} rotation={[0, Math.PI / 2, 0]} material={M.curtain}>
        <planeGeometry args={[len - 0.06, 1.6]} />
      </mesh>
    </group>
  )
}

export function Brazing({ t, working, robot }: KindProps) {
  const flicker = 0.85 + 0.15 * Math.sin(t * 41) * Math.sin(t * 17.3)
  return (
    <group>
      {!robot && (
        <group position={[-0.6, 0, -1.0]}>
          <FumeArm />
        </group>
      )}
      <group position={[1.0, 0, -1.3]}>
        <BottleCart bottles={[[M.cylBlack, M.cylWhite], [M.cylMaroon, M.cylMaroon], [M.cylGrey, M.cylBlack]]} />
      </group>
      {/* twin hose from regulators up to the rail, along it, down to the torch balancer */}
      {!robot && (
        <>
          <Hose pts={[[0.81, 1.62, -1.2], [0.75, 2.1, -1.0], [0.6, 2.42, -0.4], [0.3, 2.45, 0.2], [0.15, 2.3, 0.3], [0.13, 1.6, 0.32], [0.12, 1.32, 0.3]]} rad={0.007} m={M.hoseRed} tub={64} />
          <Hose pts={[[0.83, 1.62, -1.2], [0.77, 2.1, -1.0], [0.62, 2.43, -0.4], [0.32, 2.46, 0.2], [0.17, 2.31, 0.3], [0.15, 1.6, 0.32], [0.13, 1.32, 0.3]]} rad={0.007} m={M.hoseBlue} tub={64} />
          <Articulated>
            <Balancer x={0.13} drop={0.75}>
              <group rotation={[0, Math.PI, 0]}>
                <group rotation={[0.5, 0, 0]}>
                  <BrazingTorch flame={working ? flicker : 0} />
                </group>
              </group>
            </Balancer>
          </Articulated>
          {/* nitrogen purge hose to the unit */}
          <Hose pts={[[1.07, 1.62, -1.2], [1.0, 1.4, -0.6], [0.7, 1.15, -0.3], [0.5, 1.05, -0.15]]} rad={0.006} m={M.hoseYellow} tub={32} />
        </>
      )}
      <group position={[-1.85, 0, -1.8]}>
        <WeldCurtain len={1.3} />
      </group>
      <group position={[1.85, 0, -1.8]}>
        <WeldCurtain len={1.0} />
      </group>
      {/* fire extinguisher on a stand */}
      <group position={[-1.5, 0, 0.62]}>
        <B s={[0.25, 0.02, 0.2]} p={[0, 0.01, 0]} m={M.ral3000} />
        <C rt={0.075} h={0.55} p={[0, 0.3, 0]} m={M.cylRed} seg={22} />
        <Sph rad={0.075} p={[0, 0.575, 0]} scale={[1, 0.5, 1]} m={M.cylRed} />
        <B s={[0.1, 0.03, 0.03]} p={[0.02, 0.65, 0]} m={M.plasticDark} />
        <Hose pts={[[0.03, 0.63, 0.02], [0.1, 0.5, 0.07], [0.09, 0.3, 0.08]]} rad={0.008} m={M.hoseBlack} tub={12} />
      </group>
    </group>
  )
}

/** Bench-top items for brazing: flux pot, rods, spark lighter, spare pipes. */
export const BrazingBench = memo(function BrazingBench() {
  return (
    <group>
      <C rt={0.04} h={0.08} p={[-0.75, 0.04, -0.05]} m={M.plasticWhite} />
      <C rt={0.03} h={0.45} p={[-0.6, 0.225, 0.15]} r={[0.25, 0, 0]} m={M.steelDark} seg={16} open />
      {Array.from({ length: 8 }, (_, i) => <C key={i} rt={0.0016} h={0.5} p={[-0.6 + (i % 3) * 0.008, 0.26, 0.15 + Math.floor(i / 3) * 0.008]} r={[0.25, 0, 0]} m={M.brazeFill} seg={5} />)}
      <B s={[0.12, 0.02, 0.05]} p={[-0.4, 0.01, -0.12]} r={[0, 0.3, 0]} m={M.steelDark} />
      {[0, 1, 2].map((i) => (
        <group key={i} position={[0.0, 0.01 + i * 0.017, -0.05 + i * 0.03]}>
          <CopperPipe len={0.45} rad={0.008} bend={i % 2 ? -1 : 1} />
        </group>
      ))}
      <group position={[0.35, 0.07, 0.0]}>
        <FourWayValve />
      </group>
    </group>
  )
})
