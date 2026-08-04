// Re-export barrel. The query layer now lives in per-domain modules under
// lib/api/; this file keeps the old import path working while call sites move
// across, and is deleted in the final PR of #229
// (docs/specs/2026-07-30-renderer-query-layer-design.md). Import from the
// domain module directly in new code.
export * from '@renderer/lib/api/keys'
export * from '@renderer/lib/api/cases'
export * from '@renderer/lib/api/session'
export * from '@renderer/lib/api/captures'
export * from '@renderer/lib/api/recapture'
export * from '@renderer/lib/api/tags'
export * from '@renderer/lib/api/selectors'
export * from '@renderer/lib/api/notes'
export * from '@renderer/lib/api/extractedData'
export * from '@renderer/lib/api/annotations'
export * from '@renderer/lib/api/wayback'
export * from '@renderer/lib/api/settings'
export * from '@renderer/lib/api/app'
export * from '@renderer/lib/api/db'
export * from '@renderer/lib/api/system'
export * from '@renderer/lib/api/ai'
export * from '@renderer/lib/api/export'
export * from '@renderer/lib/api/updates'
export * from '@renderer/lib/api/diagnostics'
