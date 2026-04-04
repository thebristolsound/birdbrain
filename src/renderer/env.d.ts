import type {
  Case,
  Capture,
  Tag,
  BirdbrainSettings,
  OpenRouterModel,
  ExportOptions,
  Selector,
  ActiveCaseSelectors,
  CaptureEvent
} from '@shared/types'
import type {
  CreateCaseParams,
  UpdateCaseParams,
  CreateTagParams,
  UpdateTagParams,
  CaptureTagParams,
  CreateSelectorParams,
  UpdateSelectorParams
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
    getContent(captureId: string, type: 'html' | 'png' | 'txt'): Promise<string | null>
    getThumbnail(captureId: string): Promise<string | null>
    getMatchingSelectors(captureId: string): Promise<Selector[]>
    download(captureId: string): Promise<string | null>
    openExternal(url: string): Promise<void>
    countsByCase(): Promise<Record<string, number>>
    toggleFavorite(captureId: string): Promise<boolean>
    isFavorite(captureId: string): Promise<boolean>
    listFavorites(caseId: string): Promise<string[]>
  }
  tags: {
    list(): Promise<Tag[]>
    create(params: CreateTagParams): Promise<Tag>
    update(params: UpdateTagParams): Promise<Tag | undefined>
    delete(id: string): Promise<boolean>
    addToCapture(params: CaptureTagParams): Promise<void>
    removeFromCapture(params: CaptureTagParams): Promise<void>
    getForCapture(captureId: string): Promise<Tag[]>
    countForCase(caseId: string): Promise<number>
  }
  selectors: {
    list(caseId: string): Promise<Selector[]>
    get(id: string): Promise<Selector | undefined>
    create(params: CreateSelectorParams): Promise<Selector>
    update(params: UpdateSelectorParams): Promise<Selector | undefined>
    delete(id: string): Promise<boolean>
    listActive(): Promise<ActiveCaseSelectors[]>
    matchCounts(caseId: string): Promise<Record<string, number>>
    matchingCaptures(caseId: string, selectorIds: string[]): Promise<string[]>
    coverage(caseId: string): Promise<{ matched: number; total: number }>
  }
  search(query: string): Promise<Capture[]>
  settings: {
    get(): Promise<BirdbrainSettings>
    update(partial: Partial<BirdbrainSettings>): Promise<BirdbrainSettings>
    reset(): Promise<BirdbrainSettings>
    testOpenRouter(apiKey: string): Promise<boolean>
    listModels(apiKey: string): Promise<OpenRouterModel[]>
  }
  export: {
    generateReport(caseId: string, options: ExportOptions): Promise<void>
  }
  onNewCapture(callback: (capture: Capture) => void): () => void
  onSessionStateChanged(
    callback: (state: {
      sessionActive: boolean
      activeCaseId: string | null
      captureCount: number
    }) => void
  ): () => void
  onExtensionConnection(callback: (data: { connected: boolean }) => void): () => void
  onCaptureActivity(callback: (event: CaptureEvent) => void): () => void
  testPipeline(): Promise<{ success: boolean; durationMs: number; error?: string }>
  testHttp(): Promise<{ success: boolean; durationMs: number; error?: string }>
}

declare global {
  interface Window {
    birdbrain: BirdbrainAPI
  }
}
