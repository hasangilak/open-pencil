import type { MaskType } from '@open-pencil/scene-graph'

/** Scene mask types follow the Plugin API, which names the outline mask VECTOR; the archive names it OUTLINE. */
export function toKiwiMaskType(type: MaskType): 'ALPHA' | 'OUTLINE' | 'LUMINANCE' {
  return type === 'VECTOR' ? 'OUTLINE' : type
}

/** The archive's OUTLINE reads back as the scene's VECTOR. */
export function fromKiwiMaskType(type: string | undefined): MaskType {
  switch (type) {
    case 'OUTLINE':
    case 'VECTOR':
      return 'VECTOR'
    case 'LUMINANCE':
      return 'LUMINANCE'
    default:
      return 'ALPHA'
  }
}
