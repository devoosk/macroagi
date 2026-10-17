import { isCapture } from '../../lib/mode'

export type Quality = 'demo' | 'capture'

export interface QualityPreset {
  /** Key light shadow map size (square). */
  shadowMapSize: number
  /** Cube resolution for the Lightformer environment. */
  envResolution: number
  /** N8AO quality preset. */
  aoQuality: 'performance' | 'low' | 'medium' | 'high' | 'ultra'
  aoHalfRes: boolean
  /** MSAA samples in the effect composer. */
  multisampling: number
  /** Width of the floor colour texture (height is half). */
  floorTexSize: number
  /** Anisotropic filtering for floor and walls. */
  anisotropy: number
  /** Suggested device pixel ratio range for the Canvas. */
  dpr: [number, number]
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  demo: {
    shadowMapSize: 2048,
    envResolution: 128,
    aoQuality: 'performance',
    aoHalfRes: true,
    multisampling: 4,
    floorTexSize: 2048,
    anisotropy: 8,
    dpr: [1, 1.5],
  },
  capture: {
    shadowMapSize: 4096,
    envResolution: 256,
    aoQuality: 'high',
    aoHalfRes: false,
    multisampling: 8,
    floorTexSize: 4096,
    anisotropy: 16,
    dpr: [1, 2],
  },
}

/** Default quality follows the URL app mode (?mode=capture). */
export const defaultQuality: Quality = isCapture ? 'capture' : 'demo'

export function useQuality(quality: Quality = defaultQuality): QualityPreset {
  return QUALITY_PRESETS[quality]
}
