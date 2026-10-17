import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Group, ShaderMaterial, TextureLoader, type Texture } from 'three'
import type { Line } from '../contracts/types'
import { getT } from './clock'
import { T, ease, hash, seg } from './theme'

/** Feed tile positions: a CCTV tile and a headset tile above every station. */
export function feedPos(line: Line, st: string, fp = false): [number, number, number] {
  const s = line.stations.find((x) => x.id === st)
  return [s?.x ?? 0, fp ? 10.2 : 6.4, 0]
}

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`

/** Grainy black-and-white film, like the Atlas teaser. */
const frag = /* glsl */ `
uniform sampler2D a; uniform sampler2D b; uniform float mixAB; uniform float opacity; uniform float seed; uniform float has;
varying vec2 vUv;
float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
void main() {
  vec3 c = mix(texture2D(a, vUv).rgb, texture2D(b, vUv).rgb, mixAB);
  float g = dot(c, vec3(0.299, 0.587, 0.114));
  g = mix(0.12, g, has);
  g = (g - 0.5) * 1.25 + 0.5;
  g += (rnd(floor(vUv * 220.0)) - 0.5) * 0.22;
  vec2 d = vUv - 0.5;
  g *= 1.0 - dot(d, d) * 1.3;
  float edge = step(0.985, max(abs(d.x), abs(d.y)) * 2.0);
  g = mix(g, 1.0, edge * 0.8);
  gl_FragColor = vec4(vec3(g), opacity);
}`

interface Manifest {
  cams: { id: string; station: string; fp: boolean; frames: string[] }[]
}

function Tile({ pos, tex, delay, idx }: { pos: [number, number, number]; tex: Texture[]; delay: number; idx: number }) {
  const ref = useRef<Group>(null)
  const { camera } = useThree()
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        uniforms: { a: { value: tex[0] ?? null }, b: { value: tex[1] ?? tex[0] ?? null }, mixAB: { value: 0 }, opacity: { value: 0 }, seed: { value: 0 }, has: { value: tex.length ? 1 : 0 } },
      }),
    [tex],
  )
  useFrame(() => {
    const t = getT()
    const show = ease(seg(t, T.feeds[0] + delay, T.feeds[0] + delay + 0.5)) * (1 - seg(t, T.graph[0] + 0.4, T.graph[0] + 2))
    mat.uniforms.opacity.value = show
    mat.uniforms.mixAB.value = Math.floor(t * 1.5 + idx) % 2
    mat.uniforms.seed.value = Math.floor(t * 24) % 97
    if (ref.current) {
      ref.current.quaternion.copy(camera.quaternion)
      ref.current.visible = show > 0.005
      ref.current.scale.setScalar(0.85 + 0.15 * show)
    }
  })
  return (
    <group ref={ref} position={pos}>
      <mesh material={mat}>
        <planeGeometry args={[3.4, 3.4]} />
      </mesh>
    </group>
  )
}

/** Beat 2a: the wall of camera feeds (CCTV and MicroAGI headsets) that is the input data. */
export function Feeds({ line }: { line: Line }) {
  const [man, setMan] = useState<Manifest>()
  const [tex, setTex] = useState<Map<string, Texture[]>>(new Map())
  useEffect(() => {
    fetch('/story/feeds/manifest.json')
      .then((r) => (r.ok ? r.json() : { cams: [] }))
      .catch(() => ({ cams: [] }))
      .then((m: Manifest) => {
        setMan(m)
        const loader = new TextureLoader()
        const out = new Map<string, Texture[]>()
        for (const c of m.cams) out.set(c.id, c.frames.map((f) => loader.load(`/story/feeds/${f}`)))
        setTex(out)
      })
  }, [])
  const cams = useMemo(() => {
    // Every station gets a CCTV and a headset tile; tiles without an exported frame show grain only.
    const have = new Map((man?.cams ?? []).map((c) => [c.id, c]))
    return line.stations.flatMap((s) =>
      [false, true].map((fp) => {
        const id = `${fp ? 'fp' : 'cctv'}:${s.id}`
        return have.get(id) ?? { id, station: s.id, fp, frames: [] as string[] }
      }),
    )
  }, [man, line])
  const mid = line.stations.length / 2
  return (
    <>
      {cams.map((c, i) => {
        const order = line.stations.findIndex((s) => s.id === c.station)
        // Feeds multiply out from the middle of the line, CCTV first, then the headsets.
        const delay = Math.abs(order - mid) * 0.22 + (c.fp ? 0.9 : 0) + hash(i) * 0.15
        return <Tile key={c.id} pos={feedPos(line, c.station, c.fp)} tex={tex.get(c.id) ?? []} delay={delay} idx={i} />
      })}
    </>
  )
}
