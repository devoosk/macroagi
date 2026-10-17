/**
 * Capture "lens + sensor" look as a single postprocessing Effect.
 * - CCTV: barrel distortion, mild blur, desaturated green-ish tint, sensor noise.
 * - FP (body-cam / GoPro): stronger fisheye, vignette, cleaner image.
 *
 * Noise is seeded by simTime (uniform uSeed), never by the composer's clock,
 * so a frame is a pure function of simTime (CLAUDE.md rule 1).
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { EffectComposer } from '@react-three/postprocessing'
import { BlendFunction, Effect } from 'postprocessing'
import { Uniform, Vector3 } from 'three'
import { usePlayback } from '../playback/store'
import type { CaptureCamType } from './cameras'

const fragment = /* glsl */ `
uniform float uSeed;
uniform float uBarrel;
uniform float uBlur;
uniform float uSat;
uniform vec3 uTint;
uniform float uNoise;
uniform float uVignette;
uniform float uContrast;

// Dave Hoskins "hash without sine": stable across frames for identical inputs.
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

void mainUv(inout vec2 uv) {
  vec2 c = uv - 0.5;
  c.x *= aspect;
  float r2 = dot(c, c);
  float rmax2 = 0.25 * (aspect * aspect + 1.0);
  c *= (1.0 + uBarrel * r2) / (1.0 + uBarrel * rmax2);
  c.x /= aspect;
  uv = c + 0.5;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 col = inputColor.rgb;
  if (uBlur > 0.0) {
    vec2 d = texelSize * uBlur;
    vec3 acc = col * 4.0;
    acc += texture2D(inputBuffer, uv + vec2(d.x, 0.0)).rgb * 2.0;
    acc += texture2D(inputBuffer, uv - vec2(d.x, 0.0)).rgb * 2.0;
    acc += texture2D(inputBuffer, uv + vec2(0.0, d.y)).rgb * 2.0;
    acc += texture2D(inputBuffer, uv - vec2(0.0, d.y)).rgb * 2.0;
    acc += texture2D(inputBuffer, uv + d).rgb;
    acc += texture2D(inputBuffer, uv - d).rgb;
    acc += texture2D(inputBuffer, uv + vec2(d.x, -d.y)).rgb;
    acc += texture2D(inputBuffer, uv + vec2(-d.x, d.y)).rgb;
    col = acc / 16.0;
  }
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat) * uTint;
  col = (col - 0.18) * uContrast + 0.18;

  vec2 c = uv - 0.5;
  c.x *= aspect;
  float v = 1.0 - uVignette * smoothstep(0.25, 1.05, length(c) * 1.4);
  col *= v;

  // Sensor noise: per pixel, per sim-time frame. Luma-dominant with a little chroma.
  vec2 px = floor(uv * resolution);
  float n = hash13(vec3(px, uSeed)) - 0.5;
  float nc = hash13(vec3(px.yx, uSeed + 17.0)) - 0.5;
  col += uNoise * (n + 0.25 * vec3(nc, -nc, 0.0));

  outputColor = vec4(max(col, 0.0), inputColor.a);
}
`

export interface LookParams {
  barrel: number
  blur: number
  sat: number
  tint: [number, number, number]
  noise: number
  vignette: number
  contrast: number
}

export const LOOKS: Record<CaptureCamType, LookParams> = {
  cctv: { barrel: 0.12, blur: 0.9, sat: 0.62, tint: [0.94, 1.04, 0.92], noise: 0.045, vignette: 0.18, contrast: 0.92 },
  fp: { barrel: 0.32, blur: 0, sat: 1.04, tint: [1, 1, 1], noise: 0.012, vignette: 0.55, contrast: 1.04 },
}

export class CaptureLookEffect extends Effect {
  constructor(p: LookParams) {
    super('CaptureLookEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uSeed', new Uniform(0)],
        ['uBarrel', new Uniform(p.barrel)],
        ['uBlur', new Uniform(p.blur)],
        ['uSat', new Uniform(p.sat)],
        ['uTint', new Uniform(new Vector3(...p.tint))],
        ['uNoise', new Uniform(p.noise)],
        ['uVignette', new Uniform(p.vignette)],
        ['uContrast', new Uniform(p.contrast)],
      ]),
    })
  }
  setSimTime(t: number) {
    // Keep the seed small for float precision; still unique per sim-time frame in practice.
    this.uniforms.get('uSeed')!.value = (t * 7.31) % 997.0
  }
}

/** Effect composer with the capture look for a camera type. Must be inside the Canvas. */
export function CaptureLook({ type }: { type: CaptureCamType }) {
  const effect = useMemo(() => new CaptureLookEffect(LOOKS[type]), [type])
  useEffect(() => () => effect.dispose(), [effect])
  // Priority 0 runs before the composer's render (priority 1).
  useFrame(() => effect.setSimTime(usePlayback.getState().simTime))
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <primitive object={effect} dispose={null} />
    </EffectComposer>
  )
}
