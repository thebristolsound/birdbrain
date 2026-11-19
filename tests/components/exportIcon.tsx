import { renderToStaticMarkup } from 'react-dom/server'
import { ExportIcon } from '@renderer/components/export/exportIcon'

/** A CSS selector for the one export icon as it renders, to tell it from any other icon. */
export function exportIconSelector(): string {
  const classes = /class="([^"]*)"/.exec(renderToStaticMarkup(<ExportIcon />))?.[1] ?? ''
  const names = classes.split(' ').filter((name) => name.startsWith('lucide-'))
  if (names.length === 0) throw new Error('the export icon renders no class to find it by')
  return `svg.${names.join('.')}`
}
