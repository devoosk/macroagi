import { Environment, Lightformer } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import { rng } from '../../lib/rng'
import type { HallLayout } from './layout'
import type { QualityPreset } from './quality'

/**
 * Hall lighting: a Lightformer-only environment (no preset files, nothing fetched), a key directional
 * light standing in for the skylights + high-bays with shadows over the line, and a hemisphere fill.
 * `lightSeed` varies intensity and direction very slightly (deterministically) between capture cycles.
 */
export function Lighting({ L, q, lightSeed = 0 }: { L: HallLayout; q: QualityPreset; lightSeed?: number | string }) {
  const v = useMemo(() => {
    const r = rng('env', 'light', lightSeed)
    return {
      key: 1 + (r() - 0.5) * 0.12,
      dx: (r() - 0.5) * 4,
      dz: (r() - 0.5) * 3,
      warm: (r() - 0.5) * 0.04,
    }
  }, [lightSeed])
  const b = L.bounds
  const cx = (b.minX + b.maxX) / 2
  const target = useMemo(() => {
    const o = new THREE.Object3D()
    o.position.set(cx, 0, L.ridgeZ)
    o.updateMatrixWorld()
    return o
  }, [cx, L.ridgeZ])
  const keyColor = useMemo(() => new THREE.Color().setHSL(0.11 + v.warm, 0.25, 0.92), [v.warm])
  const halfX = L.length / 2 + 2
  const halfZ = L.width / 2 + 3
  // Environment rows of luminaires mirrored from the hall layout, compressed into the env cube.
  const rows = [-12.2, -8.4, -4.6, -1.6, 1.6, 4.6, 8.4, 12.2]
  return (
    <>
      <hemisphereLight args={['#e8eef4', '#5d5a55', 0.3]} />
      <directionalLight
        position={[cx + v.dx, 32, L.ridgeZ + 9 + v.dz]}
        target={target}
        intensity={1.45 * v.key}
        color={keyColor}
        castShadow
        shadow-mapSize={[q.shadowMapSize, q.shadowMapSize]}
        shadow-bias={-0.00025}
        shadow-normalBias={0.025}
        shadow-camera-left={-halfX}
        shadow-camera-right={halfX}
        shadow-camera-top={halfZ}
        shadow-camera-bottom={-halfZ}
        shadow-camera-near={5}
        shadow-camera-far={70}
      />
      <primitive object={target} />
      {/* Soft secondary from the opposite side so shadow sides are not black. */}
      <directionalLight position={[cx - 12, 20, L.ridgeZ - 14]} intensity={0.35} color="#dfe8f2" />
      <Environment frames={1} resolution={q.envResolution} environmentIntensity={0.7} background={false}>
        <color attach="background" args={['#41454a']} />
        {/* Ceiling: luminaire rows. */}
        {rows.map((z, i) => (
          <Lightformer key={i} form="rect" intensity={2.4} color="#fff6ea" position={[0, 6, z * 0.5]} rotation-x={Math.PI / 2} scale={[40, 0.35, 1]} />
        ))}
        {/* Rooflight bands: cool daylight. */}
        {[-4.6, 4.6].map((z, i) => (
          <Lightformer key={`s${i}`} form="rect" intensity={3.2} color="#e3eeff" position={[0, 7, z]} rotation-x={Math.PI / 2} scale={[40, 1.2, 1]} />
        ))}
        {/* Clerestory window bands on the long walls. */}
        {[-1, 1].map((s) => (
          <Lightformer key={`w${s}`} form="rect" intensity={1.6} color="#dce8f5" position={[0, 2.5, s * 9]} rotation-y={s > 0 ? Math.PI : 0} scale={[40, 1.2, 1]} />
        ))}
        {/* Light cladding walls (bounce). */}
        {[-1, 1].map((s) => (
          <Lightformer key={`g${s}`} form="rect" intensity={0.5} color="#e9e8e2" position={[s * 18, 0, 0]} rotation-y={(s * -Math.PI) / 2} scale={[20, 10, 1]} />
        ))}
        {/* Warm grey floor bounce. */}
        <Lightformer form="rect" intensity={0.35} color="#9a958c" position={[0, -4, 0]} rotation-x={-Math.PI / 2} scale={[60, 40, 1]} />
      </Environment>
    </>
  )
}
