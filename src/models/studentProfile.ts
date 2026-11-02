import type { Topic } from '../../shared/contract'
import { topicLabels } from '../lib/opportunities'

export const intensityLabels = {
  light: 'Light',
  balanced: 'Balanced',
  focused: 'Focused',
} as const

export type LearningIntensity = keyof typeof intensityLabels

/** Blank strings, empty arrays and null mean the student has not specified a preference. */
export interface StudentProfile {
  state: string
  degreeCourse: string
  yearOfStudy: number | null
  careerInterests: Topic[]
  skills: string[]
  weeklyLearningHours: number | null
  learningIntensity: LearningIntensity | null
}

export type ProfileErrors = Partial<Record<keyof StudentProfile | 'profile', string>>
export type ProfileValidation =
  | { valid: true; profile: StudentProfile }
  | { valid: false; errors: ProfileErrors }

export function createDefaultProfile(): StudentProfile {
  return {
    state: 'Tamil Nadu',
    degreeCourse: '',
    yearOfStudy: null,
    careerInterests: [],
    skills: [],
    weeklyLearningHours: null,
    learningIntensity: null,
  }
}

/** Runtime validation is also used for localStorage, which is untrusted input. */
export function validateStudentProfile(value: unknown): ProfileValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: { profile: 'Preferences must be a profile object.' } }
  }
  const data = value as Record<string, unknown>
  const errors: ProfileErrors = {}
  const fields = Object.keys(createDefaultProfile())
  if (Object.keys(data).some(key => !fields.includes(key))) {
    errors.profile = 'Preferences contain unsupported fields.'
  }
  for (const [key, label, limit] of [
    ['state', 'State', 80],
    ['degreeCourse', 'Degree or course', 120],
  ] as const) {
    if (typeof data[key] !== 'string' || data[key].trim().length > limit) {
      errors[key] = `${label} must be text of ${limit} characters or fewer, or left blank.`
    }
  }
  if (data.yearOfStudy !== null && (
    typeof data.yearOfStudy !== 'number' || !Number.isInteger(data.yearOfStudy)
    || data.yearOfStudy < 1 || data.yearOfStudy > 10
  )) {
    errors.yearOfStudy = 'Choose a year from 1 to 10, or leave it unspecified.'
  }
  if (!Array.isArray(data.careerInterests) || data.careerInterests.length > 5
    || data.careerInterests.some(topic => typeof topic !== 'string' || !Object.hasOwn(topicLabels, topic))) {
    errors.careerInterests = 'Choose interests from the five available topics, or leave them blank.'
  }
  if (!Array.isArray(data.skills) || data.skills.length > 30
    || data.skills.some(skill => typeof skill !== 'string' || !skill.trim() || skill.trim().length > 80)) {
    errors.skills = 'Enter up to 30 skills, each between 1 and 80 characters, or leave skills blank.'
  }
  if (data.weeklyLearningHours !== null && (
    typeof data.weeklyLearningHours !== 'number' || !Number.isFinite(data.weeklyLearningHours)
    || data.weeklyLearningHours < 0 || data.weeklyLearningHours > 168
  )) {
    errors.weeklyLearningHours = 'Enter a number from 0 to 168 hours, or leave it blank.'
  }
  if (data.learningIntensity !== null && (
    typeof data.learningIntensity !== 'string' || !Object.hasOwn(intensityLabels, data.learningIntensity)
  )) {
    errors.learningIntensity = 'Choose a listed learning intensity, or leave it unspecified.'
  }
  if (Object.keys(errors).length) return { valid: false, errors }

  // Every field has now been checked. Normalize without mutating the input.
  const checked = data as unknown as StudentProfile
  const skills = checked.skills.map(skill => skill.trim())
    .filter((skill, index, all) => all.findIndex(other => other.toLowerCase() === skill.toLowerCase()) === index)
  return {
    valid: true,
    profile: {
      state: checked.state.trim(),
      degreeCourse: checked.degreeCourse.trim(),
      yearOfStudy: checked.yearOfStudy,
      careerInterests: [...new Set(checked.careerInterests)],
      skills,
      weeklyLearningHours: checked.weeklyLearningHours,
      learningIntensity: checked.learningIntensity,
    },
  }
}
