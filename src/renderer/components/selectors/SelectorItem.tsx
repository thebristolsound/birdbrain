import type { Selector } from '@shared/types'
import type { UpdateSelectorParams } from '@shared/ipc'

interface SelectorItemProps {
  selector: Selector
  onUpdate: (params: UpdateSelectorParams) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export function SelectorItem({ selector, onUpdate, onDelete }: SelectorItemProps) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-white/[0.06] bg-slate-900 px-3 py-2">
      <div className="flex items-center gap-2 overflow-hidden">
        <input
          type="checkbox"
          checked={selector.enabled}
          onChange={(e) => onUpdate({ id: selector.id, enabled: e.target.checked })}
          className="rounded"
        />
        <span className="truncate font-mono text-sm text-slate-200">{selector.pattern}</span>
        {selector.isRegex && (
          <span className="shrink-0 rounded bg-blue-600/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
            regex
          </span>
        )}
        {selector.label && (
          <span className="truncate text-xs text-slate-500">{selector.label}</span>
        )}
      </div>
      <button
        onClick={() => onDelete(selector.id)}
        className="shrink-0 text-sm text-slate-600 hover:text-red-400"
      >
        &times;
      </button>
    </div>
  )
}
