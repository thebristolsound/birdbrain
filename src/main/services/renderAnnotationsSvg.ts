import type { AnnotationShape } from '@shared/types'

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

const PIN_RADIUS = 14

function shapeToSvg(s: AnnotationShape): string {
  if (s.kind === 'rect') {
    return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" stroke="${escape(s.stroke)}" stroke-width="${s.strokeWidth}" fill="${s.fill ? escape(s.fill) : 'none'}" />`
  }
  if (s.kind === 'highlight') {
    return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${escape(s.color)}" fill-opacity="0.4" stroke="none" />`
  }
  if (s.kind === 'redact') {
    return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="#000000" stroke="none" />`
  }
  if (s.kind === 'arrow') {
    return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${escape(s.stroke)}" stroke-width="${s.strokeWidth}" marker-end="url(#arrow)" />`
  }
  if (s.kind === 'pin') {
    return [
      `<circle cx="${s.x}" cy="${s.y}" r="${PIN_RADIUS}" fill="#ef4444" stroke="#ffffff" stroke-width="2" />`,
      `<text x="${s.x}" y="${s.y + 5}" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#ffffff">${s.number}</text>`
    ].join('')
  }
  return ''
}

export function renderAnnotationsSvg(
  shapes: AnnotationShape[],
  width: number,
  height: number
): string {
  const body = shapes.map(shapeToSvg).join('')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
    `<path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>`,
    body,
    `</svg>`
  ].join('')
}
