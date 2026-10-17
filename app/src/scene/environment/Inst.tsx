import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'

export interface InstItem {
  p: [number, number, number]
  r?: [number, number, number]
  s?: [number, number, number]
  c?: THREE.ColorRepresentation
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _c = new THREE.Color()

/** Static InstancedMesh from a list of transforms (and optional per-instance colours). */
export function Inst({
  geometry,
  material,
  items,
  castShadow = false,
  receiveShadow = true,
}: {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  items: InstItem[]
  castShadow?: boolean
  receiveShadow?: boolean
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    items.forEach((it, i) => {
      _m.compose(_p.set(...it.p), _q.setFromEuler(_e.set(...(it.r ?? [0, 0, 0]))), _s.set(...(it.s ?? [1, 1, 1])))
      mesh.setMatrixAt(i, _m)
      if (it.c !== undefined) mesh.setColorAt(i, _c.set(it.c))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items])
  if (items.length === 0) return null
  return (
    <instancedMesh
      key={items.length}
      ref={ref}
      args={[geometry, material, items.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  )
}

/** Static mesh with shadow flags (geometry/material are shared, never disposed here). */
export function M({
  g,
  m,
  cast = false,
  receive = true,
}: {
  g: THREE.BufferGeometry
  m: THREE.Material
  cast?: boolean
  receive?: boolean
}) {
  return <mesh geometry={g} material={m} castShadow={cast} receiveShadow={receive} />
}
