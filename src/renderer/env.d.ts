import type { Case, Capture, Tag } from '@shared/types'
import type {
  CreateCaseParams,
  UpdateCaseParams,
  CreateTagParams,
  UpdateTagParams,
  CaptureTagParams
} from '@shared/ipc'

interface BirdbrainAPI {
  cases: {
    list(): Promise<Case[]>
    get(id: string): Promise<Case | undefined>
    create(params: CreateCaseParams): Promise<Case>
    update(params: UpdateCaseParams): Promise<Case | undefined>
    delete(id: string): Promise<boolean>
  }
  captures: {
    list(caseId: string): Promise<Capture[]>
    get(id: string): Promise<Capture | undefined>
    delete(id: string): Promise<boolean>
  }
  tags: {
    list(): Promise<Tag[]>
    create(params: CreateTagParams): Promise<Tag>
    update(params: UpdateTagParams): Promise<Tag | undefined>
    delete(id: string): Promise<boolean>
    addToCapture(params: CaptureTagParams): Promise<void>
    removeFromCapture(params: CaptureTagParams): Promise<void>
    getForCapture(captureId: string): Promise<Tag[]>
  }
  search(query: string): Promise<Capture[]>
  onNewCapture(callback: (capture: Capture) => void): () => void
}

declare global {
  interface Window {
    birdbrain: BirdbrainAPI
  }
}
