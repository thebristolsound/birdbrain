import type { ComponentType, ReactNode } from 'react'
import { Lock, FolderUp, MousePointer2, FolderOpen, FileJson, FileCode, Folder } from 'lucide-react'
import extensionIconImg from '@renderer/assets/extension-icon-48.png'

function SkeletonBar({ width, strong }: { width: string; strong?: boolean }) {
  return (
    <div
      className={`h-2.5 rounded ${strong ? 'bg-border-strong' : 'bg-border'}`}
      style={{ width }}
    />
  )
}

function DevModeToggle({ glow }: { glow?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-text-secondary">Developer mode</span>
      <div
        className={`relative h-[18px] w-[34px] rounded-full bg-accent ${glow ? 'shadow-[var(--shadow-glow)]' : ''}`}
      >
        <div className="absolute right-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white" />
      </div>
    </div>
  )
}

function ExtensionsPageHeader({ glow }: { glow?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="font-display text-[13px] font-bold text-text-primary">Extensions</span>
      <DevModeToggle glow={glow} />
    </div>
  )
}

function DeveloperModeVisual() {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="flex gap-[5px]">
          <span className="h-2 w-2 rounded-full bg-red-400" />
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        <div className="flex flex-1 items-center gap-1.5 rounded-full border border-accent bg-elevated px-3 py-[5px] ring-[3px] ring-accent/10">
          <Lock className="h-[11px] w-[11px] text-text-faint" />
          <span className="font-mono text-[11px] text-text-primary">chrome://extensions</span>
        </div>
      </div>
      <ExtensionsPageHeader glow />
      <div className="flex flex-col gap-2 px-4 pb-4">
        <SkeletonBar width="70%" strong />
        <SkeletonBar width="45%" />
      </div>
    </>
  )
}

function LoadUnpackedVisual() {
  return (
    <>
      <div className="border-b border-border">
        <ExtensionsPageHeader />
      </div>
      <div className="relative flex gap-2 px-4 py-3.5">
        <div className="flex items-center gap-1.5 rounded-[10px] bg-accent px-3.5 py-2 font-display text-xs font-semibold text-white shadow-[var(--shadow-btn)]">
          <FolderUp className="h-[13px] w-[13px]" />
          Load unpacked
        </div>
        <div className="flex items-center rounded-[10px] border border-border-strong px-3.5 py-2 font-display text-xs font-medium text-text-muted">
          Pack extension
        </div>
        <div className="flex items-center rounded-[10px] border border-border-strong px-3.5 py-2 font-display text-xs font-medium text-text-muted">
          Update
        </div>
        <MousePointer2 className="absolute left-24 top-9 h-[18px] w-[18px] fill-card text-text-primary" />
      </div>
      <div className="mt-auto flex flex-col gap-2 px-4 pb-4">
        <SkeletonBar width="60%" strong />
        <SkeletonBar width="40%" />
      </div>
    </>
  )
}

const PICKER_FILES = [
  {
    icon: FileJson,
    iconColor: 'text-amber-500',
    name: 'manifest.json',
    tone: 'text-text-secondary'
  },
  { icon: FileCode, iconColor: 'text-text-faint', name: 'background.js', tone: 'text-text-muted' },
  { icon: Folder, iconColor: 'text-text-faint', name: 'icons/', tone: 'text-text-muted' }
]

function SelectFolderVisual() {
  return (
    <div className="flex flex-1 flex-col gap-3 p-4">
      <div className="rounded-[10px] border border-border-strong bg-card p-3">
        <div className="flex items-center gap-2 border-b border-border pb-2.5">
          <FolderOpen className="h-3.5 w-3.5 text-accent" />
          <span className="font-mono text-[11px] text-text-primary">~/birdbrain/extension</span>
        </div>
        <div className="flex flex-col gap-1.5 pt-2.5">
          {PICKER_FILES.map(({ icon: Icon, iconColor, name, tone }) => (
            <div key={name} className="flex items-center gap-2">
              <Icon className={`h-3 w-3 ${iconColor}`} />
              <span className={`font-mono text-[11px] ${tone}`}>{name}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <div className="rounded-lg border border-border-strong px-3 py-1.5 font-display text-[11px] font-medium text-text-muted">
            Cancel
          </div>
          <div className="rounded-lg bg-accent px-3 py-1.5 font-display text-[11px] font-semibold text-white shadow-[var(--shadow-btn)]">
            Select
          </div>
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2.5 rounded-[10px] border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5">
        <img src={extensionIconImg} alt="" className="h-5 w-5 rounded-[5px]" />
        <div className="flex-1">
          <div className="font-display text-xs font-bold text-text-primary">
            Extension installed
          </div>
          <div className="font-mono text-[10px] text-text-muted">now in your Chrome toolbar</div>
        </div>
        <span className="flex items-center gap-[5px] rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-[3px] font-mono text-[10px] font-medium text-emerald-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Active
        </span>
      </div>
    </div>
  )
}

export interface InstallStep {
  title: string
  sub: ReactNode
  caption: ReactNode
  /**
   * One-sentence form, for surfaces with no room for `caption` — the tour's
   * install walkthrough renders these three inside a 296px tooltip (#404).
   * Kept here so the two surfaces cannot drift on what the steps say.
   */
  brief: ReactNode
  Visual: ComponentType
}

export const INSTALL_STEPS: InstallStep[] = [
  {
    title: 'Enable Developer mode',
    sub: (
      <>
        Go to <span className="font-mono text-accent">chrome://extensions</span> and flip the toggle
      </>
    ),
    caption: (
      <>
        Type the address into the URL bar, then switch on{' '}
        <strong className="font-semibold text-text-primary">Developer mode</strong> in the top-right
        corner of the page.
      </>
    ),
    brief: (
      <>
        Open <span className="font-mono text-text-secondary">chrome://extensions</span> and switch
        on Developer mode (top right).
      </>
    ),
    Visual: DeveloperModeVisual
  },
  {
    title: 'Click Load unpacked',
    sub: 'A new toolbar appears once Developer mode is on',
    caption: (
      <>
        Click <strong className="font-semibold text-text-primary">Load unpacked</strong> on the left
        of the developer toolbar. A system file picker opens.
      </>
    ),
    brief: (
      <>
        Click <span className="font-semibold text-text-primary">Load unpacked</span> in the toolbar
        that appears.
      </>
    ),
    Visual: LoadUnpackedVisual
  },
  {
    title: 'Select the extension folder',
    sub: (
      <>
        Use <span className="font-mono">Open extension folder</span> below — it ships inside this
        Birdbrain build
      </>
    ),
    caption: (
      <>
        Choose the folder that holds{' '}
        <strong className="font-semibold text-text-primary">manifest.json</strong> — the one this
        button opens, not a zip or a copy from elsewhere, so the extension matches this app version.
        After an app update, reload it from{' '}
        <span className="font-mono text-accent">chrome://extensions</span>.
      </>
    ),
    brief: (
      <>
        Pick the folder holding <span className="font-mono text-text-secondary">manifest.json</span>{' '}
        — no restart needed. Pin it from the puzzle-piece menu.
      </>
    ),
    Visual: SelectFolderVisual
  }
]
