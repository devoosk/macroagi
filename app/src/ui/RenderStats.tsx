import { useEffect } from 'react'
import { addAfterEffect, addEffect, useThree } from '@react-three/fiber'
import type * as THREE from 'three'

/**
 * Dev-only render stats (`?stats=1`, demo mode only). Logs draw calls, triangles (shadow pass included)
 * and frame time once a second, and exposes `window.__mxStats[label]` for headless measurement:
 *   - `calls`, `triangles`, `fps`, `cpuMs` (render-loop time, all canvases)
 *   - `sync = true` → `gpuMs`: frame time including GPU work (vsync-free, unlike rAF fps)
 *   - `breakdown()`: re-renders once per scene module with that module hidden and returns the calls /
 *     triangles each module costs. Modules are objects named `mx:<module>`.
 * Wall-clock timing here only measures; it never feeds back into what is rendered.
 */
export const statsEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('stats') === '1'

interface Sample {
  calls: number
  triangles: number
  fps: number
  cpuMs: number
  /** Set true to wait for the GPU after every frame (1 px readPixels); `gpuMs` is then the full frame cost. */
  sync: boolean
  gpuMs: number
  breakdown: () => Record<string, { calls: number; triangles: number }>
  /** Hide (or show again) the drawables of the named `mx:` modules, for A/B timing. */
  hide: (modules: string[], hidden: boolean) => void
  scene: THREE.Scene
}

declare global {
  interface Window {
    __mxStats?: Record<string, Sample>
  }
}

export function RenderStats({ label = 'main' }: { label?: string }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    if (!statsEnabled) return
    const info = gl.info
    // The post chain and shadow pass call gl.render several times a frame; count them all.
    info.autoReset = false
    let t0 = 0
    let frames = 0
    let cpu = 0
    let gpu = 0
    const px = new Uint8Array(4)
    let windowStart = performance.now()
    const sample: Sample = { calls: 0, triangles: 0, fps: 0, cpuMs: 0, sync: false, gpuMs: 0, breakdown: () => breakdown(gl, scene, camera), hide: (m, h) => hide(scene, m, h), scene }
    window.__mxStats = { ...window.__mxStats, [label]: sample }

    const offBefore = addEffect(() => {
      t0 = performance.now()
      info.reset()
    })
    const offAfter = addAfterEffect(() => {
      const now = performance.now()
      sample.calls = info.render.calls
      sample.triangles = info.render.triangles
      frames++
      cpu += now - t0
      if (sample.sync) {
        const ctx = gl.getContext()
        ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px)
        gpu += performance.now() - t0
      }
      if (now - windowStart >= 1000) {
        sample.fps = (frames * 1000) / (now - windowStart)
        sample.cpuMs = cpu / frames
        sample.gpuMs = gpu / frames
        console.info(
          `[stats ${label}] calls=${sample.calls} tris=${sample.triangles} fps=${sample.fps.toFixed(1)} loop=${sample.cpuMs.toFixed(1)}ms` +
            (sample.sync ? ` frame+gpu=${sample.gpuMs.toFixed(1)}ms` : ''),
        )
        frames = 0
        cpu = 0
        gpu = 0
        windowStart = now
      }
    })
    return () => {
      offBefore()
      offAfter()
      info.autoReset = true
      if (window.__mxStats) delete window.__mxStats[label]
    }
  }, [gl, scene, camera, label])

  return null
}

/** Visible drawables per `mx:<module>` (drawables only: hiding a module's lights would drop the shadow pass). */
function drawables(scene: THREE.Scene) {
  const modules = new Map<string, THREE.Object3D[]>()
  scene.traverse((o) => {
    if (!o.name.startsWith('mx:')) return
    const list = modules.get(o.name.slice(3)) ?? []
    o.traverse((c) => {
      const d = (c as THREE.Mesh).isMesh || (c as THREE.Line).isLine || (c as THREE.Points).isPoints || (c as THREE.Sprite).isSprite
      if (d && (c.visible || c.userData.mxStatsHidden)) list.push(c)
    })
    modules.set(o.name.slice(3), list)
  })
  return modules
}

function hide(scene: THREE.Scene, names: string[], hidden: boolean) {
  for (const [name, objs] of drawables(scene)) {
    if (!names.includes(name)) continue
    for (const o of objs) {
      o.visible = !hidden
      o.userData.mxStatsHidden = hidden
    }
  }
}

/** Main + shadow pass cost per `mx:<module>` group, by rendering once with the module hidden. */
function breakdown(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const modules = drawables(scene)
  const measure = () => {
    gl.info.reset()
    gl.shadowMap.needsUpdate = true
    gl.render(scene, camera)
    return { calls: gl.info.render.calls, triangles: gl.info.render.triangles }
  }
  const all = measure()
  const out: Record<string, { calls: number; triangles: number }> = { total: all }
  for (const [name, objs] of modules) {
    const was = objs.map((o) => o.visible)
    objs.forEach((o) => (o.visible = false))
    const r = measure()
    objs.forEach((o, i) => (o.visible = was[i]))
    out[name] = { calls: all.calls - r.calls, triangles: all.triangles - r.triangles }
  }
  return out
}
