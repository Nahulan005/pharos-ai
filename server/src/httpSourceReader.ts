import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { getSourceById, isValidSourceUrl } from './sourceRegistry.ts'
import type { Source } from './sourceRegistry.ts'
import { OpportunityOrganizer } from './opportunityOrganizer.ts'
import { readerFailure } from './sourceReader.ts'
import type { ReadRequest, ReadResult, ReaderErrorCode, SourceReader } from './sourceReader.ts'

export interface HttpApproval {
  readonly sourceId: string
  readonly methods: readonly ('api' | 'web_fetch')[]
  readonly hosts: readonly string[]
  /** Exact URLs, including path and query. No wildcards or inherited subdomain approval. */
  readonly urls: readonly string[]
}

export interface MockHttpResponse {
  status: number
  url: string
  peerAddress: string
  headers: Readonly<Record<string, string>>
  body: AsyncIterable<Uint8Array>
}

/**
 * Trusted test adapter, not caller input. No production transport ships in Step 4.
 * A future adapter must bind the socket to address without resolving again, verify
 * TLS against servername, disable proxies/redirects, stream bytes and honor abort.
 * Response peer metadata alone cannot establish that these guarantees were met.
 */
export interface MockPinnedTransport {
  readonly kind: 'mock'
  readonly security: 'pinned-ip-tls-no-redirects-v1'
  resolve(host: string, signal: AbortSignal): Promise<readonly string[]>
  request(input: {
    url: string; address: string; servername: string; signal: AbortSignal
    redirect: 'error'; maxBytes: number
  }): Promise<MockHttpResponse>
}

export interface HttpReaderOptions {
  transport?: MockPinnedTransport
  approvals?: readonly HttpApproval[]
  /** Trusted test seam for simulating reviewed registry entries. Never expose to API callers. */
  lookupSource?: (id: string) => Source | undefined
  now?: () => string
  maxBytes?: number
  timeoutMs?: number
}

/** Conservative policy: public IPv4 only; all IPv6 is denied until reviewed support exists. */
export function isAllowedPublicAddress(address: string): boolean {
  if (isIP(address) !== 4) return false
  const [a, b, c] = address.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113))
}

function safeUrl(value: string): URL | undefined {
  if (!isValidSourceUrl(value)) return undefined
  const url = new URL(value)
  const host = url.hostname
  if (isIP(host) || host.includes(':') || !host.includes('.') || host.endsWith('.')
    || /(?:^|\.)(?:localhost|local|internal|lan|home)$/i.test(host)) return undefined
  return url
}

class ReadFailure extends Error {
  constructor(readonly code: ReaderErrorCode) { super(code) }
}
function reject(code: ReaderErrorCode): never { throw new ReadFailure(code) }

export class HttpSourceReader implements SourceReader {
  private readonly options: HttpReaderOptions
  private readonly maxBytes: number
  private readonly timeoutMs: number
  constructor(options: HttpReaderOptions = {}) {
    this.maxBytes = options.maxBytes ?? 256 * 1024
    this.timeoutMs = options.timeoutMs ?? 5000
    if (!Number.isInteger(this.maxBytes) || this.maxBytes < 1 || this.maxBytes > 1024 * 1024
      || !Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30_000) {
      throw new RangeError('Reader limits must be positive integers within 1 MiB and 30 seconds.')
    }
    this.options = { ...options, approvals: structuredClone(options.approvals ?? []) }
  }

  async read(request: ReadRequest): Promise<ReadResult> {
    // Copy request fields before awaiting so caller mutation cannot change the approved target.
    const target = { ...request }
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    try {
      const source = (this.options.lookupSource ?? getSourceById)(target.sourceId)
      if (!source || source.id !== target.sourceId) return readerFailure('UNKNOWN_SOURCE')
      if (target.method !== 'web_fetch' && target.method !== 'api') return readerFailure('METHOD_NOT_SUPPORTED')
      const url = safeUrl(target.sourceUrl)
      if (!url) return readerFailure('UNSAFE_URL')
      const approval = this.options.approvals?.find(item => item.sourceId === source.id
        && item.methods.includes(target.method) && item.hosts.includes(url.hostname)
        && item.urls.includes(target.sourceUrl))
      const reviewDateValid = typeof source.lastReviewedAt === 'string'
        && /^\d{4}-\d{2}-\d{2}$/.test(source.lastReviewedAt)
        && Number.isFinite(Date.parse(source.lastReviewedAt))
        && new Date(source.lastReviewedAt).toISOString().slice(0, 10) === source.lastReviewedAt
      if (source.automatedAccessStatus !== 'approved' || !reviewDateValid
        || !source.permittedRetrievalMethods.includes(target.method) || !approval
        || !isValidSourceUrl(source.websiteUrl) || url.origin !== new URL(source.websiteUrl).origin) {
        return readerFailure('ACCESS_DISABLED')
      }
      const transport = this.options.transport
      if (!transport || transport.kind !== 'mock' || transport.security !== 'pinned-ip-tls-no-redirects-v1') {
        return readerFailure('TRANSPORT_UNAVAILABLE')
      }

      const operation = async (): Promise<ReadResult> => {
        const addresses = await transport.resolve(url.hostname, controller.signal)
        controller.signal.throwIfAborted()
        if (!addresses.length || addresses.length > 16 || !addresses.every(isAllowedPublicAddress)) reject('UNSAFE_ADDRESS')
        const address = addresses[0]
        const response = await transport.request({
          url: target.sourceUrl, address, servername: url.hostname,
          signal: controller.signal, redirect: 'error', maxBytes: this.maxBytes,
        })
        controller.signal.throwIfAborted()
        if (response.peerAddress !== address) reject('UNSAFE_ADDRESS')
        if ((response.status >= 300 && response.status < 400) || response.url !== target.sourceUrl) reject('REDIRECT_DENIED')
        if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) reject('HTTP_ERROR')
        const headers: Record<string, string> = {}
        for (const [key, value] of Object.entries(response.headers)) {
          const name = key.toLowerCase()
          if (Object.hasOwn(headers, name)) reject('INVALID_CONTENT')
          headers[name] = value
        }
        if (headers.location !== undefined) reject('REDIRECT_DENIED')
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(headers['content-type'] ?? '')
          || (headers['content-encoding'] !== undefined && headers['content-encoding'] !== 'identity')) reject('CONTENT_TYPE_DENIED')
        const length = headers['content-length']
        if (length !== undefined) {
          if (!/^\d+$/.test(length)) reject('INVALID_CONTENT')
          if (Number(length) > this.maxBytes) reject('RESPONSE_TOO_LARGE')
        }
        let byteLength = 0
        const chunks: Buffer[] = []
        for await (const chunk of response.body) {
          controller.signal.throwIfAborted()
          if (!(chunk instanceof Uint8Array)) reject('INVALID_CONTENT')
          byteLength += chunk.byteLength
          if (byteLength > this.maxBytes) reject('RESPONSE_TOO_LARGE')
          chunks.push(Buffer.from(chunk))
        }
        controller.signal.throwIfAborted()
        if (length !== undefined && Number(length) !== byteLength) reject('INVALID_CONTENT')
        let body: string
        let payload: unknown
        try {
          body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
          payload = JSON.parse(body)
        } catch { return readerFailure('INVALID_CONTENT') }
        if (payload === null || typeof payload !== 'object' || Array.isArray(payload)
          || Object.keys(payload).some(key => !['facts', 'publishedAt'].includes(key))) reject('INVALID_CONTENT')
        const data = payload as Record<string, unknown>
        const retrievedAt = (this.options.now ?? (() => new Date().toISOString()))()
        const finding = {
          findingId: `http-${createHash('sha256').update(JSON.stringify([source.id, target.method, target.sourceUrl, body])).digest('hex')}`,
          sourceId: source.id, sourceUrl: target.sourceUrl, retrievedAt,
          publishedAt: data.publishedAt ?? null, evidenceText: body,
          verificationStatus: 'unreviewed', facts: data.facts,
        }
        const result = new OpportunityOrganizer().organize(finding)
        if (!result.ok) return readerFailure('INVALID_CONTENT')
        return { ok: true, finding: result.value.evidence.originalFinding, rawEvidence: {
          sourceId: source.id, sourceUrl: target.sourceUrl, retrievedAt,
          method: target.method, mode: 'mock_http', synthetic: true, fixtureId: null,
          contentType: headers['content-type'], byteLength, body,
        } }
      }
      const timeout = new Promise<never>((_, rejectTimeout) => {
        timer = setTimeout(() => {
          rejectTimeout(new ReadFailure('TIMEOUT'))
          controller.abort()
        }, this.timeoutMs)
      })
      return await Promise.race([operation(), timeout])
    } catch (error) {
      return readerFailure(error instanceof ReadFailure ? error.code : 'NETWORK_ERROR')
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      // Covers rejects before body consumption and timeout; adapter must close its resources.
      controller.abort()
    }
  }
}
