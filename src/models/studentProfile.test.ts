import { describe, expect, it } from 'vitest'
import { createDefaultProfile, validateStudentProfile } from './studentProfile'

describe('student profile validation', () => {
  it('defaults to Tamil Nadu without filling other preferences', () => {
    expect(createDefaultProfile()).toEqual({ state: 'Tamil Nadu', degreeCourse: '', yearOfStudy: null,
      careerInterests: [], skills: [], weeklyLearningHours: null, learningIntensity: null })
  })
  it('allows every preference to be left blank', () => {
    expect(validateStudentProfile({ ...createDefaultProfile(), state: '' }).valid).toBe(true)
  })
  it('normalizes text and duplicate interests/skills without mutating the input', () => {
    const input = { ...createDefaultProfile(), state: ' Tamil Nadu ', degreeCourse: ' BSc ',
      careerInterests: ['web_dev', 'web_dev'], skills: [' JavaScript ', 'javascript', 'CSS'] }
    const original = structuredClone(input)
    const result = validateStudentProfile(input)
    expect(result).toEqual({ valid: true, profile: { ...createDefaultProfile(), degreeCourse: 'BSc',
      careerInterests: ['web_dev'], skills: ['JavaScript', 'CSS'] } })
    expect(input).toEqual(original)
  })
  it.each([null, [], 'text', 1, {}, { state: 'Tamil Nadu' }])('rejects malformed profile %j', value => {
    expect(validateStudentProfile(value).valid).toBe(false)
  })
  it.each([
    ['state', 42], ['state', 'a'.repeat(81)], ['degreeCourse', null], ['degreeCourse', 'a'.repeat(121)],
    ['yearOfStudy', 0], ['yearOfStudy', 11], ['yearOfStudy', 1.5], ['yearOfStudy', '2'],
    ['careerInterests', ['unknown']], ['careerInterests', ['constructor']], ['careerInterests', 'ai_ml'],
    ['skills', ['']], ['skills', [1]], ['skills', ['a'.repeat(81)]], ['skills', Array(31).fill('skill')],
    ['weeklyLearningHours', -1], ['weeklyLearningHours', 169], ['weeklyLearningHours', NaN],
    ['weeklyLearningHours', Infinity], ['weeklyLearningHours', '5'],
    ['learningIntensity', 'extreme'], ['learningIntensity', 'constructor'],
  ])('rejects invalid %s (%j)', (field, value) => {
    const result = validateStudentProfile({ ...createDefaultProfile(), [field]: value })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toHaveProperty(field)
  })
  it('accepts shared topic values and finite hours including zero and fractions', () => {
    for (const hours of [0, 2.5, 168]) {
      expect(validateStudentProfile({ ...createDefaultProfile(), careerInterests: ['ai_ml', 'web_dev', 'cybersecurity', 'data_science', 'general'], weeklyLearningHours: hours }).valid).toBe(true)
    }
  })
  it.each(['light', 'balanced', 'focused'])('accepts %s intensity', learningIntensity => {
    expect(validateStudentProfile({ ...createDefaultProfile(), learningIntensity }).valid).toBe(true)
  })
  it('rejects unsupported fields rather than persisting extra personal data', () => {
    expect(validateStudentProfile({ ...createDefaultProfile(), email: 'not-needed@example.com' }).valid).toBe(false)
  })
  it('creates independent defaults', () => {
    const profile = createDefaultProfile()
    profile.skills.push('JavaScript')
    expect(createDefaultProfile().skills).toEqual([])
  })
})
