import type { Case, Capture, Tag, Entity, EntityGraph, CaseAnalysisResult, BirdbrainSettings, OpenRouterModel, ExportOptions } from '@shared/types'
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
}

declare global {
  interface Window {
    birdbrain: BirdbrainAPI
  }
}
