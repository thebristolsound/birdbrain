import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LaunchedBrowserOption } from '@shared/types'
import { Button, SectionLabel } from '@renderer/components/ui'
import { queryKeys } from '@renderer/lib/api/keys'
import {
  chooseBrowserExecutable,
  launchedBrowsersQueryOptions
} from '@renderer/lib/api/launchedBrowser'
import { InfoTip } from '@renderer/components/launchedBrowser/InfoTip'

const GROUP_TIP =
  'Finding a browser launches nothing, and Birdbrain confirms a browser’s product and version ' +
  'only when it launches it. A row shows the version the browser reported at its last launch, ' +
  'and says so; a browser Birdbrain has not launched yet shows none. Birdbrain refuses a ' +
  'browser it does not recognize, or one older than the oldest version it supports.'

const NOT_LAUNCHED_TIP =
  'Birdbrain has not launched this browser, so it has no version to show. Its first launch ' +
  'confirms the product and version.'

// Found browsers in Settings (S1, `1a`). Main records a version only for a launch that passed
// its checks, so a row's version is the one from that launch.
export function FoundBrowsers() {
  const queryClient = useQueryClient()
  const { data: browsers, isError } = useQuery(launchedBrowsersQueryOptions)
  const [choosing, setChoosing] = useState(false)
  const [refusal, setRefusal] = useState('')

  async function choose() {
    setChoosing(true)
    try {
      const chosen = await chooseBrowserExecutable()
      setRefusal('')
      if (chosen) await queryClient.invalidateQueries({ queryKey: queryKeys.launchedBrowsers })
    } catch (error) {
      setRefusal((error as Error).message)
    } finally {
      setChoosing(false)
    }
  }

  return (
    <section aria-labelledby="launched-browsers-heading" className="border-t border-border pt-4">
      <div className="flex items-center gap-1.5">
        <SectionLabel id="launched-browsers-heading">Launched browsers</SectionLabel>
        <InfoTip text={GROUP_TIP} />
      </div>
      <p className="mb-2.5 mt-1 text-xs text-text-muted">
        Browsers Birdbrain can open for a Capture Session.
      </p>
      {isError && (
        <p role="alert" className="text-[11px] text-danger-fg">
          Birdbrain could not list the browsers it can launch.
        </p>
      )}
      {browsers?.length === 0 && (
        <p className="text-[11px] text-text-muted">
          Birdbrain found no supported browser in the usual install folders.
        </p>
      )}
      {browsers && browsers.length > 0 && (
        <ul className="flex flex-col rounded border border-border">
          {browsers.map((browser) => (
            <BrowserRow key={browser.executablePath} browser={browser} />
          ))}
        </ul>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void choose()} disabled={choosing}>
          Choose an executable…
        </Button>
        <span className="text-[11px] text-text-muted">For a browser not listed here.</span>
        <InfoTip text="Birdbrain does not look for a browser installed through Snap or Flatpak." />
      </div>
      {refusal && (
        <p role="alert" className="mt-1 text-[11px] text-danger-fg">
          {refusal}
        </p>
      )}
    </section>
  )
}

function BrowserRow({ browser }: { browser: LaunchedBrowserOption }) {
  const { label, executablePath, chosen, lastVersion } = browser
  return (
    <li className="flex items-center gap-2.5 border-b border-border px-2.5 py-[7px] text-xs last:border-b-0">
      <span data-browser-label className="font-semibold text-text-primary">
        {label}
      </span>
      {chosen && (
        <span title={executablePath} className="min-w-0 truncate font-mono text-[11px]">
          {executablePath}
        </span>
      )}
      {lastVersion && <span className="font-mono text-[11px]">{lastVersion}</span>}
      <span className="flex-1" />
      <span className="shrink-0 text-[11px] text-text-muted">
        {lastVersion ? 'from its last launch' : 'not launched yet'}
      </span>
      <InfoTip
        text={
          lastVersion
            ? `The version ${label} reported at the last launch that passed its checks.`
            : NOT_LAUNCHED_TIP
        }
      />
    </li>
  )
}
