import { RefreshCw, CheckCircle2, AlertCircle, ExternalLink, Loader2 } from 'lucide-react'
import type { BirdbrainSettings, ReleaseChannel, UpdateStatus } from '@shared/types'
import { Card, CardContent, Button, Label } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import { useUpdateStatus } from '@renderer/hooks/useUpdateStatus'

interface UpdatesConfigProps {
  settings: BirdbrainSettings
  onUpdate: (partial: Partial<BirdbrainSettings>) => Promise<void>
}

const CHANNELS: [ReleaseChannel, string, string][] = [
  ['stable', 'Stable', 'Only tagged, production releases.'],
  ['beta', 'Beta', 'Early access — includes alpha/beta prereleases alongside stable.']
]

function StatusLine({
  status,
  currentVersion
}: {
  status: UpdateStatus | null
  currentVersion: string
}) {
  if (!status || status.state === 'idle') {
    return <p className="text-xs text-text-muted">Version {currentVersion}</p>
  }

  if (status.state === 'checking') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking for updates…
      </p>
    )
  }

  if (status.state === 'up-to-date') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-text-muted">
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        You&rsquo;re on the latest version ({currentVersion}).
      </p>
    )
  }

  if (status.state === 'available') {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-medium text-text-primary">
          Version {status.availableVersion} is available.
        </span>
        {status.releaseNotesUrl && (
          <a
            href={status.releaseNotesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:text-accent-hover"
          >
            View release
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    )
  }

  // error
  return (
    <p className="flex items-center gap-1.5 text-xs text-red-500">
      <AlertCircle className="h-3.5 w-3.5" />
      Couldn&rsquo;t check for updates{status.error ? `: ${status.error}` : '.'}
    </p>
  )
}

export function UpdatesConfig({ settings, onUpdate }: UpdatesConfigProps) {
  const { status, check } = useUpdateStatus()
  const currentVersion = status?.currentVersion ?? ''
  const checking = status?.state === 'checking'

  return (
    <Card>
      <CardContent>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Updates</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => check()}
            disabled={checking}
            className="gap-1.5"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', checking && 'animate-spin')} />
            Check for updates
          </Button>
        </div>

        <div className="space-y-5">
          <StatusLine status={status} currentVersion={currentVersion} />

          <div>
            <Label>Release channel</Label>
            <div className="space-y-1">
              {CHANNELS.map(([value, label, desc]) => (
                <label
                  key={value}
                  className="flex items-start gap-2 cursor-pointer rounded p-1.5 hover:bg-elevated"
                >
                  <input
                    type="radio"
                    name="releaseChannel"
                    value={value}
                    checked={settings.releaseChannel === value}
                    onChange={() => onUpdate({ releaseChannel: value })}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm text-text-secondary">{label}</div>
                    <div className="text-xs text-text-muted">{desc}</div>
                  </div>
                </label>
              ))}
            </div>
            {settings.releaseChannel === 'beta' && (
              <p className="mt-1.5 text-xs text-text-muted">
                Switching to Stable won&rsquo;t downgrade — you&rsquo;ll stay on your current build
                until a newer stable release ships.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text-primary">Check automatically</div>
              <div className="text-xs text-text-muted">
                Check for new releases shortly after launch and periodically while running.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoCheckForUpdates}
              aria-label="Check for updates automatically"
              onClick={() => onUpdate({ autoCheckForUpdates: !settings.autoCheckForUpdates })}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                settings.autoCheckForUpdates ? 'bg-accent' : 'bg-text-faint'
              )}
            >
              <span
                className={cn(
                  'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                  settings.autoCheckForUpdates ? 'translate-x-[18px]' : 'translate-x-0.5'
                )}
              />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
