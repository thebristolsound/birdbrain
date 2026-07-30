'use client'
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps
} from 'fumadocs-ui/components/dialog/search'
import { useDocsSearch } from 'fumadocs-core/search/client'
import { oramaStaticClient } from 'fumadocs-core/search/client/orama-static'
import { create } from '@orama/orama'
import { basePath } from '@/lib/base-path.mjs'

// The static export has no search server, so the client downloads the exported
/**
 * Creates an Orama database configured for English-language search.
 *
 * @returns An Orama database with a string field schema.
 */
function initOrama() {
  return create({
    schema: { _: 'string' },
    // https://docs.orama.com/docs/orama-js/supported-languages
    language: 'english'
  })
}

/**
 * Provides a search dialog backed by the site's static search index.
 *
 * @param props - Additional properties for the search dialog.
 * @returns The configured search dialog.
 */
export default function DefaultSearchDialog(props: SharedProps) {
  const { search, setSearch, query } = useDocsSearch({
    client: oramaStaticClient({
      initOrama,
      // Defaults to '/api/search', which resolves against the domain root and so
      // misses the exported index when the site is served from a sub-path.
      from: `${basePath}/api/search`
    })
  })

  return (
    <SearchDialog search={search} onSearchChange={setSearch} isLoading={query.isLoading} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== 'empty' ? query.data : null} />
      </SearchDialogContent>
    </SearchDialog>
  )
}
