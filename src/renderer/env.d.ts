import type { Case, Capture, Tag, Entity, EntityGraph, CaseAnalysisResult, BirdbrainSettings, OpenRouterModel, ExportOptions, Selector, ActiveCaseSelectors } from '@shared/types'
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
  app: {
    getVersion(): Promise<string>
  }
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
  selectors: {
    list(caseId: string): Promise<Selector[]>
    get(id: string): Promise<Selector | undefined>
    create(params: CreateSelectorParams): Promise<Selector>
    update(params: UpdateSelectorParams): Promise<Selector | undefined>
    delete(id: string): Promise<boolean>
    listActive(): Promise<ActiveCaseSelectors[]>
    matchCounts(caseId: string): Promise<Record<string, number>>
    matchingCaptures(caseId: string, selectorIds: string[]): Promise<string[]>
  }
  search(query: string): Promise<Capture[]>
  settings: {
    get(): Promise<BirdbrainSettings>
    update(partial: Partial<BirdbrainSettings>): Promise<BirdbrainSettings>
    reset(): Promise<BirdbrainSettings>
    testOpenRouter(apiKey: string): Promise<boolean>
    listModels(apiKey: string): Promise<OpenRouterModel[]>
  }
  ai: {
    extractEntities(captureId: string): Promise<Entity[]>
    getEntities(captureId: string): Promise<Entity[]>
    buildGraph(caseId: string): Promise<EntityGraph>
    analyzeCase(caseId: string): Promise<CaseAnalysisResult>
    getAnalysis(caseId: string): Promise<CaseAnalysisResult | null>
  }
  export: {
    generateReport(caseId: string, options: ExportOptions): Promise<void>
  }
  onNewCapture(callback: (capture: Capture) => void): () => void
  onSessionStateChanged(callback: (state: { sessionActive: boolean; activeCaseId: string | null; captureCount: number }) => void): () => void
  onExtensionConnection(callback: (data: { connected: boolean }) => void): () => void
}

declare global {
  interface Window {
    birdbrain: BirdbrainAPI
  }
}
