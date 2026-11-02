import type { SourceFinding } from '../src/sourceFinding.ts'

// Local synthetic course observation only. URL/timestamp are test inputs, not evidence of a real retrieval.
const course: SourceFinding = {
  findingId: 'fixture-course-v1', sourceId: 'swayam',
  sourceUrl: 'https://swayam.gov.in/pharos-fixture-only',
  retrievedAt: '2026-11-02T10:00:00+05:30', publishedAt: null,
  evidenceText: 'PHAROS local fixture only. This is not a real course or offer and no website was accessed.',
  verificationStatus: 'unreviewed',
  facts: {
    id: 'fixture-course-v1', category: 'course_cert',
    title: 'PHAROS fixture only — not a real course',
  },
}

/** Explicit manifest, never a filesystem path derived from user input. */
export const sourceFixtures: Readonly<Record<string, string>> = Object.freeze({
  'course-v1': JSON.stringify(course),
})
