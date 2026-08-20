import type { HashVerification, RecentActivityEvent } from '@shared/types'
import { MAX_RECENT_ACTIVITY_LIMIT, RECENT_ACTIVITY_LIMIT } from '@shared/constants'
import { getDb } from '@main/services/db/core'

// Cross-aggregate read for the dashboard's recent-activity feed (#403). It
// spans captures, notes and cases, so it fits no single-aggregate repo;
// diagnosticsRepo is the precedent for a read-only module of this shape.
//
// Capture and note events only. `selector_matches` carries no timestamp — a
// hit event has no independent time to order by — so hits stay out until a
// `matched_at` column exists (maintainer ruling 2026-08-20, #403).

interface ActivityRow {
  kind: 'capture' | 'note'
  id: string
  case_id: string
  case_name: string
  case_type: string | null
  title: string | null
  url: string | null
  ts: string
  last_verified_status: string | null
}

// Each source is bounded and ordered before the union, so SQLite never sorts
// more than `limit` rows per source however large the tables get. The outer
// ORDER BY breaks ties on id so a page of same-second events is stable across
// calls — two captures written in the same second must not swap places on a
// refetch.
const RECENT_ACTIVITY_SQL = `
  SELECT * FROM (
    SELECT
      'capture' AS kind,
      c.id AS id,
      c.case_id AS case_id,
      cs.name AS case_name,
      cs.type AS case_type,
      c.title AS title,
      c.url AS url,
      c.created_at AS ts,
      c.last_verified_status AS last_verified_status
    FROM captures c
    JOIN cases cs ON cs.id = c.case_id
    WHERE cs.archived = 0
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT :limit
  )
  UNION ALL
  SELECT * FROM (
    SELECT
      'note' AS kind,
      n.id AS id,
      n.case_id AS case_id,
      cs.name AS case_name,
      cs.type AS case_type,
      n.title AS title,
      NULL AS url,
      n.updated_at AS ts,
      NULL AS last_verified_status
    FROM notes n
    JOIN cases cs ON cs.id = n.case_id
    WHERE cs.archived = 0
    ORDER BY n.updated_at DESC, n.id DESC
    LIMIT :limit
  )
  ORDER BY ts DESC, id DESC
  LIMIT :limit
`

const CASE_TYPES = ['crypto', 'malware', 'fraud', 'custom'] as const
const VERIFIED_STATUSES = ['verified', 'tampered', 'missing', 'chain-broken', 'legacy'] as const

function toCaseType(value: string | null): RecentActivityEvent['caseType'] {
  return CASE_TYPES.find((t) => t === value)
}

function toVerifiedStatus(value: string | null): HashVerification['status'] | undefined {
  return VERIFIED_STATUSES.find((s) => s === value)
}

function toEvent(row: ActivityRow): RecentActivityEvent {
  const base = {
    caseId: row.case_id,
    caseName: row.case_name,
    caseType: toCaseType(row.case_type),
    occurredAt: row.ts,
    title: row.title === null || row.title === '' ? null : row.title
  }
  if (row.kind === 'note') {
    return { ...base, kind: 'note', noteId: row.id }
  }
  return {
    ...base,
    kind: 'capture',
    captureId: row.id,
    url: row.url ?? '',
    lastVerifiedStatus: toVerifiedStatus(row.last_verified_status)
  }
}

/**
 * The most recent events across every non-archived case, newest first.
 *
 * `limit` is clamped rather than trusted: it arrives over IPC, and the point of
 * the query is that the renderer never fetches everything and sorts.
 */
export function listRecentActivity(limit: number = RECENT_ACTIVITY_LIMIT): RecentActivityEvent[] {
  const bounded = Math.min(
    MAX_RECENT_ACTIVITY_LIMIT,
    Math.max(1, Math.floor(Number.isFinite(limit) ? limit : RECENT_ACTIVITY_LIMIT))
  )
  const rows = getDb().prepare(RECENT_ACTIVITY_SQL).all({ limit: bounded }) as ActivityRow[]
  return rows.map(toEvent)
}
