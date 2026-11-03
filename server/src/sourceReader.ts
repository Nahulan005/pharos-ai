import type { SourceFinding } from './sourceFinding.ts'

export type ReaderMethod = 'fixture' | 'web_fetch' | 'api'
export type ReadRequest =
  | { sourceId: string; method: 'fixture'; fixtureId: string }
  | { sourceId: string; method: 'web_fetch' | 'api'; sourceUrl: string }

export interface RawEvidence {
  sourceId: string
  sourceUrl: string
  retrievedAt: string
  method: ReaderMethod
  mode: 'fixture' | 'mock_http'
  /** All reader content in Step 4 is synthetic; never publish it as a real offer. */
  synthetic: true
  fixtureId: string | null
  contentType: string
  byteLength: number
  body: string
}

export type ReaderErrorCode = 'UNKNOWN_SOURCE' | 'METHOD_NOT_SUPPORTED' | 'FIXTURE_NOT_FOUND'
  | 'SOURCE_MISMATCH' | 'ACCESS_DISABLED' | 'UNSAFE_URL' | 'TRANSPORT_UNAVAILABLE'
  | 'UNSAFE_ADDRESS' | 'REDIRECT_DENIED' | 'HTTP_ERROR' | 'CONTENT_TYPE_DENIED'
  | 'RESPONSE_TOO_LARGE' | 'TIMEOUT' | 'NETWORK_ERROR' | 'INVALID_CONTENT'

export type ReadResult =
  | { ok: true; finding: SourceFinding; rawEvidence: RawEvidence }
  | { ok: false; error: { code: ReaderErrorCode; message: string } }

export interface SourceReader { read(request: ReadRequest): Promise<ReadResult> }

const messages: Record<ReaderErrorCode, string> = {
  UNKNOWN_SOURCE: 'Source ID is not registered.', METHOD_NOT_SUPPORTED: 'Retrieval method is not supported.',
  FIXTURE_NOT_FOUND: 'Fixture ID was not found.', SOURCE_MISMATCH: 'Fixture does not belong to the requested source.',
  ACCESS_DISABLED: 'Automated access is not explicitly approved for this source and URL.',
  UNSAFE_URL: 'URL is not an allowed HTTPS destination.', TRANSPORT_UNAVAILABLE: 'A supported secure transport is unavailable.',
  UNSAFE_ADDRESS: 'Destination address or connection binding is not allowed.', REDIRECT_DENIED: 'Redirects are not permitted.',
  HTTP_ERROR: 'Source returned an unsuccessful response.', CONTENT_TYPE_DENIED: 'Response content type or encoding is not allowed.',
  RESPONSE_TOO_LARGE: 'Response exceeds the byte limit.', TIMEOUT: 'Source read timed out.',
  NETWORK_ERROR: 'Source transport failed.', INVALID_CONTENT: 'Source content is not a valid structured finding.',
}
export function readerFailure(code: ReaderErrorCode): Extract<ReadResult, { ok: false }> {
  return { ok: false, error: { code, message: messages[code] } }
}
