import { Bloom, EffectComposer, HueSaturation, N8AO, ToneMapping, Vignette, BrightnessContrast } from '@react-three/postprocessing'
import { BlendFunction, Effect, ToneMappingMode } from 'postprocessing'
import { forwardRef, useEffect, useMemo } from 'react'
import { Uniform } from 'three'
import { QUALITY_PRESETS, defaultQuality, type Quality } from './quality'

const grainFrag = /* glsl */ `
uniform float seed;
uniform float amount;
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + seed * 0.1);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float n = hash(gl_FragCoord.xy) + hash(gl_FragCoord.xy + 17.17) - 1.0;
  float l = dot(inputColor.rgb, vec3(0.299, 0.587, 0.114));
  // Sensor noise is strongest in the mid-tones and shadows.
  float w = amount * (1.0 - 0.6 * l);
  outputColor = vec4(max(inputColor.rgb + n * w, 0.0), inputColor.a);
}
`

/**
 * Deterministic film grain: a static per-pixel pattern selected by `seed` (no clock).
 * postprocessing's NoiseEffect animates with the composer clock, which would break frame reproducibility.
 */
class GrainEffect extends Effect {
  constructor({ seed = 0, amount = 0.035 }: { seed?: number; amount?: number } = {}) {
    super('GrainEffect', grainFrag, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['seed', new Uniform(seed)],
        ['amount', new Uniform(amount)],
      ]),
    })
  }
}

const Grain = forwardRef<GrainEffect, { seed: number; amount: number }>(function Grain({ seed, amount }, ref) {
  const effect = useMemo(() => new GrainEffect({ seed, amount }), [])
  useEffect(() => {
    effect.uniforms.get('seed')!.value = seed
    effect.uniforms.get('amount')!.value = amount
  }, [effect, seed, amount])
  useEffect(() => () => effect.dispose(), [effect])
  return <primitive ref={ref} object={effect} dispose={null} />
})

export interface FactoryEffectsProps {
  quality?: Quality
  /**
   * Seed for the capture-mode grain pattern. Pass something derived from simTime / frame index
   * (e.g. Math.floor(simTime)) for grain that changes per frame but stays reproducible.
   */
  grainSeed?: number
  /** Turn ambient occlusion off (e.g. for very low-end devices). */
  ao?: boolean
}

/** Post chain: N8AO, subtle bloom (flames, LEDs), ACES tone mapping, vignette; CCTV look in capture. */
export function FactoryEffects({ quality = defaultQuality, grainSeed = 0, ao = true }: FactoryEffectsProps) {
  const q = QUALITY_PRESETS[quality]
  const capture = quality === 'capture'
  const fx: JSX.Element[] = []
  if (ao) {
    fx.push(
      <N8AO
        key="ao"
        aoRadius={1.6}
        distanceFalloff={0.6}
        intensity={capture ? 2.6 : 2.2}
        quality={q.aoQuality}
        halfRes={q.aoHalfRes}
        depthAwareUpsampling
      />,
    )
  }
  fx.push(<Bloom key="bloom" mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.2} intensity={capture ? 0.5 : 0.65} radius={0.65} />)
  fx.push(<ToneMapping key="tm" mode={ToneMappingMode.ACES_FILMIC} />)
  if (capture) {
    fx.push(<HueSaturation key="sat" saturation={-0.18} />)
    fx.push(<BrightnessContrast key="bc" brightness={-0.01} contrast={0.06} />)
    fx.push(<Grain key="grain" seed={grainSeed} amount={0.018} />)
  }
  fx.push(<Vignette key="vig" offset={0.32} darkness={capture ? 0.55 : 0.4} />)
  return (
    <EffectComposer multisampling={q.multisampling} enableNormalPass={false}>
      {fx}
    </EffectComposer>
  )
}
