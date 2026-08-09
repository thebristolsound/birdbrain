import { Fragment } from 'react'
import { FlaskConical, Trash2, Globe } from 'lucide-react'
import type { Selector } from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'
import { highlightRegexSyntax } from '@renderer/components/selectors/selectorUtils'
import { useForegroundMatchPreview } from '@renderer/components/selectors/useForegroundMatchPreview'

interface SelectorTableRowProps {
  selector: Selector
  matchCount: number
  isExpanded: boolean
  onToggleExpand: () => void
  onToggleEnabled: () => void
  onDelete: () => void
  caseId: string
}

export function SelectorTableRow({
  selector,
  matchCount,
  isExpanded,
  onToggleExpand,
  onToggleEnabled,
  onDelete,
  caseId
}: SelectorTableRowProps) {
  const activeSelectorFilters = useAppStore((s) => s.activeSelectorFilters)
  const addSelectorFilter = useAppStore((s) => s.addSelectorFilter)
  const removeSelectorFilter = useAppStore((s) => s.removeSelectorFilter)
  const {
    previews,
    loading: loadingPreviews,
    run: runPreview
  } = useForegroundMatchPreview(caseId, { maxCaptures: 3, maxMatchesPerCapture: 5 })

  const isFilterActive = activeSelectorFilters.includes(selector.id)

  function handleToggleExpand() {
    if (!isExpanded && !previews && !loadingPreviews) {
      void runPreview(selector.pattern, selector.isRegex, selector.id)
    }
    onToggleExpand()
  }

  function handleFilterToggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (isFilterActive) {
      removeSelectorFilter(selector.id)
    } else {
      addSelectorFilter(selector.id)
    }
  }

  return (
    <Fragment>
      <tr
        className={`border-b border-border transition-colors hover:bg-surface ${
          !selector.enabled ? 'opacity-35' : ''
        }`}
      >
        {/* On toggle */}
        <td className="px-4 py-2.5">
          <button
            type="button"
            role="switch"
            aria-checked={selector.enabled}
            onClick={(e) => {
              e.stopPropagation()
              onToggleEnabled()
            }}
            className={`relative inline-flex h-[18px] w-[34px] items-center rounded-full transition-colors ${
              selector.enabled ? 'bg-accent' : 'bg-slate-600'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                selector.enabled ? 'translate-x-[16px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </td>

        {/* Pattern */}
        <td className="px-4 py-2.5">
          {selector.isRegex ? (
            <span className="inline-block rounded-lg border border-border bg-canvas px-2 py-1 font-mono text-xs">
              {highlightRegexSyntax(selector.pattern)}
            </span>
          ) : (
            <span className="font-mono text-xs text-orange-400">{selector.pattern}</span>
          )}
        </td>

        {/* Type badge */}
        <td className="px-4 py-2.5">
          {selector.isRegex ? (
            <span className="rounded-md border border-accent/20 bg-accent-subtle px-1.5 py-0.5 text-[10px] font-mono font-medium text-accent">
              regex
            </span>
          ) : (
            <span className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-mono text-text-muted">
              string
            </span>
          )}
        </td>

        {/* Label */}
        <td className="px-4 py-2.5 text-xs text-text-muted">{selector.label || '\u2014'}</td>

        {/* Match count */}
        <td className="px-4 py-2.5">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              matchCount > 0
                ? 'bg-accent text-white shadow-lg shadow-indigo-600/20'
                : 'bg-surface text-text-muted'
            }`}
          >
            {matchCount}
          </span>
        </td>

        {/* Filter */}
        <td className="px-4 py-2.5">
          <button
            onClick={handleFilterToggle}
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
              isFilterActive
                ? 'bg-accent-subtle text-accent border border-accent/30'
                : 'text-text-muted hover:text-text-secondary border border-transparent hover:border-border-strong'
            }`}
          >
            {isFilterActive ? 'Active' : 'Apply'}
          </button>
        </td>

        {/* Actions */}
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleToggleExpand()
              }}
              className="rounded-lg p-1 text-text-muted hover:bg-accent-subtle hover:text-accent"
              title="Test matches"
            >
              <FlaskConical className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="rounded-lg p-1 text-text-muted hover:bg-red-500/10 hover:text-red-400"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded match preview */}
      {isExpanded && (
        <tr>
          <td colSpan={7} className="bg-surface px-4 py-3">
            <div className="expand-panel">
              {loadingPreviews ? (
                <p className="text-xs text-text-muted">Loading previews...</p>
              ) : previews && previews.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {previews.map((preview, idx) => (
                    <div
                      key={idx}
                      className="min-w-[250px] max-w-[300px] shrink-0 rounded-lg border border-border bg-elevated p-3"
                    >
                      <div className="mb-2 flex items-center gap-1.5 text-[10px] text-text-muted">
                        <Globe className="h-3 w-3" />
                        <span className="truncate">{preview.captureUrl}</span>
                      </div>
                      {preview.matches.slice(0, 2).map((m, mi) => (
                        <p key={mi} className="mb-1 font-mono text-[11px] text-text-muted">
                          ...{m.context.slice(0, m.index > 25 ? 25 : m.index)}
                          <span className="rounded bg-indigo-500/30 px-0.5 text-indigo-200">
                            {m.matchText}
                          </span>
                          {m.context.slice((m.index > 25 ? 25 : m.index) + m.matchText.length)}...
                        </p>
                      ))}
                    </div>
                  ))}
                  {matchCount > previews.length && (
                    <div className="flex min-w-[120px] items-center justify-center rounded-lg border border-border bg-elevated p-3">
                      <span className="text-xs text-text-muted">
                        +{matchCount - previews.length} more
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-text-muted">No match previews available.</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}
