export type { InputFileKind, InputFileKindResult } from '@/domain/input/types'
export {
  detectInputBufferKind,
  detectInputFileKind,
  isSupportedImageMime,
  SUPPORTED_IMAGE_MIME_TYPES,
} from '@/infrastructure/input/detect-file-kind'
