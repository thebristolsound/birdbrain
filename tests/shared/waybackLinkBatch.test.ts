import { describe, it, expect } from 'vitest'
import { planLinkBatch, WAYBACK_LINK_BATCH_CAP } from '@shared/waybackLinkBatch'

// #1738, plan S3 and S4: the addresses a Wayback batch sends, which the confirmation lists
// and main sends again from the same rows.

describe('planLinkBatch', () => {
  it('sends each address once, in the order the rows first show it', () => {
    const plan = planLinkBatch([
      'https://b.example/',
      'https://a.example/',
      'https://b.example/',
      'https://a.example/'
    ])
    expect(plan).toEqual({
      send: ['https://b.example/', 'https://a.example/'],
      overCap: [],
      refused: []
    })
  })

  it('refuses what the shared address rule refuses, once per address with its row count', () => {
    const plan = planLinkBatch([
      'http://intranet/wiki',
      'https://a.example/',
      'http://127.0.0.1/admin',
      'http://intranet/wiki',
      'mailto:desk@news.example',
      'http://printer.local/'
    ])
    expect(plan.send).toEqual(['https://a.example/'])
    expect(plan.refused).toEqual([
      { url: 'http://intranet/wiki', reason: 'Points at a private network', rows: 2 },
      { url: 'http://127.0.0.1/admin', reason: 'Points at a loopback address', rows: 1 },
      { url: 'mailto:desk@news.example', reason: 'Not a web address', rows: 1 },
      { url: 'http://printer.local/', reason: 'Points at a private network', rows: 1 }
    ])
  })

  it('caps the batch after refusals and de-duplication, and names the rest', () => {
    const allowed = Array.from(
      { length: WAYBACK_LINK_BATCH_CAP + 3 },
      (_, i) => `https://site${i}.example/`
    )
    const urls = ['http://localhost/', ...allowed, allowed[0], allowed[1]]
    const plan = planLinkBatch(urls)
    expect(WAYBACK_LINK_BATCH_CAP).toBe(50)
    expect(plan.send).toEqual(allowed.slice(0, WAYBACK_LINK_BATCH_CAP))
    expect(plan.overCap).toEqual(allowed.slice(WAYBACK_LINK_BATCH_CAP))
    expect(plan.refused).toHaveLength(1)
  })

  it('sends nothing for no rows', () => {
    expect(planLinkBatch([])).toEqual({ send: [], overCap: [], refused: [] })
  })
})
