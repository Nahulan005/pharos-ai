import { SCHEMA_VERSION } from '../../shared/contract'
import type { Opportunity } from '../../shared/contract'
import { categoryLabels, costLabels, sourceLabels, topicLabels, verificationLabels, isCalendarDate, safeSourceUrl } from '../lib/opportunities'

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && Boolean(v.trim())
const nullableText = (v: unknown) => v === null || typeof v === 'string'
const enumeration = (v: unknown, labels: object) => typeof v === 'string' && Object.hasOwn(labels, v)
const validId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)
const date = (v: unknown) => typeof v === 'string' && isCalendarDate(v)
const invalid = () => new Error('Opportunity data is unavailable. Please try again.')
const notFound = Symbol('opportunity-not-found')

// The shared CLI validator imports node:fs. Keep browser checks here, using the
// existing frontend enum labels/date helpers; reject the entire malformed response.
function isOpportunity(v: unknown): v is Opportunity {
  if (!object(v) || !validId(v.id) || !['title', 'provider', 'summary', 'eligibilitySummary'].every(key => text(v[key]))
    || !enumeration(v.category, categoryLabels) || !enumeration(v.cost, costLabels)
    || !enumeration(v.sourceType, sourceLabels) || !enumeration(v.verificationStatus, verificationLabels)
    || !nullableText(v.sourceName) || !(v.sourceUrl === null || (typeof v.sourceUrl === 'string' && safeSourceUrl(v.sourceUrl)))
    || !nullableText(v.verifiedBy) || !(v.lastVerifiedAt === null || date(v.lastVerifiedAt))
    || !Array.isArray(v.topics) || !v.topics.every(topic => enumeration(topic, topicLabels))
    || !Array.isArray(v.tags) || !v.tags.every(tag => typeof tag === 'string')
    || !object(v.applicability) || !['national', 'state', 'unknown'].includes(String(v.applicability.scope))
    || !Array.isArray(v.applicability.states) || !v.applicability.states.every(text)
    || (v.applicability.scope === 'state' ? v.applicability.states.length === 0 : v.applicability.states.length !== 0)
    || !object(v.deadline) || !['fixed', 'rolling', 'annual_expected', 'unknown'].includes(String(v.deadline.type))
    || !nullableText(v.deadline.note) || !(v.deadline.date === null || date(v.deadline.date))
    || (v.deadline.type === 'fixed' && !date(v.deadline.date))) return false
  if (v.verificationStatus === 'demo' && (!(v.title as string).startsWith('[DEMO]')
    || v.sourceUrl !== null || v.verifiedBy !== null || v.lastVerifiedAt !== null)) return false
  if ((v.title as string).startsWith('[DEMO]') && v.verificationStatus !== 'demo') return false
  if ((v.verificationStatus === 'unreviewed' || v.sourceType === 'unknown')
    && (v.verifiedBy !== null || v.lastVerifiedAt !== null)) return false
  if (v.verificationStatus === 'checked_against_source' && (!text(v.verifiedBy) || !date(v.lastVerifiedAt)
    || v.sourceUrl === null || !['official', 'provider'].includes(String(v.sourceType)))) return false
  return true
}

function isTimestamp(v: unknown): boolean {
  if (typeof v !== 'string') return false
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(v)
  return Boolean(match && isCalendarDate(match[1]) && +match[2] < 24 && +match[3] < 60 && +match[4] < 60
    && (match[5] === 'Z' || (+match[6] < 24 && +match[7] < 60)) && Number.isFinite(Date.parse(v)))
}

async function request(path: string, allowNotFound = false): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal })
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw invalid()
    const data: unknown = await response.json()
    if (allowNotFound && response.status === 404 && object(data) && object(data.error)
      && data.error.code === 'OPPORTUNITY_NOT_FOUND') return notFound
    if (!response.ok) throw invalid()
    return data
  } catch { throw invalid() }
  finally { clearTimeout(timer) }
}

/** Relative URLs use the existing Vite /api proxy. No client fixture fallback. */
export async function getAll(): Promise<Opportunity[]> {
  const data = await request('/api/opportunities')
  if (!object(data) || data.schemaVersion !== SCHEMA_VERSION || !isTimestamp(data.generatedAt)
    || !Array.isArray(data.items) || !data.items.every(isOpportunity)
    || new Set(data.items.map(item => item.id)).size !== data.items.length) throw invalid()
  return data.items
}

export async function getById(id: string): Promise<Opportunity | null> {
  if (!validId(id)) return null
  const data = await request(`/api/opportunities/${encodeURIComponent(id)}`, true)
  if (data === notFound) return null
  if (!isOpportunity(data) || data.id !== id) throw invalid()
  return data
}
