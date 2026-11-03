import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Topic } from '../../shared/contract'
import { Icon } from '../components/Icon'
import { topicLabels } from '../lib/opportunities'
import { createDefaultProfile, intensityLabels } from '../models/studentProfile'
import type { LearningIntensity, ProfileErrors, StudentProfile } from '../models/studentProfile'
import { clearProfile, loadProfile, saveProfile } from '../services/profileStorage'

interface ProfileDraft {
  state: string
  degreeCourse: string
  yearOfStudy: string
  careerInterests: Topic[]
  skills: string
  weeklyLearningHours: string
  learningIntensity: LearningIntensity | ''
}

function toDraft(profile: StudentProfile): ProfileDraft {
  return {
    ...profile,
    yearOfStudy: profile.yearOfStudy === null ? '' : String(profile.yearOfStudy),
    skills: profile.skills.join(', '),
    weeklyLearningHours: profile.weeklyLearningHours === null ? '' : String(profile.weeklyLearningHours),
    learningIntensity: profile.learningIntensity ?? '',
  }
}

function toProfile(draft: ProfileDraft): StudentProfile {
  const hours = draft.weeklyLearningHours.trim()
  return {
    ...draft,
    yearOfStudy: draft.yearOfStudy === '' ? null : Number(draft.yearOfStudy),
    skills: draft.skills.split(/[,\n]/).map(skill => skill.trim()).filter(Boolean),
    weeklyLearningHours: hours === '' ? null : /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(hours) ? Number(hours) : NaN,
    learningIntensity: draft.learningIntensity || null,
  }
}

function FieldError({ field, errors }: { field: keyof StudentProfile; errors: ProfileErrors }) {
  return errors[field] ? <p className="field-error" id={`${field}-error`}>{errors[field]}</p> : null
}

const interestOptions = Object.keys(topicLabels) as Topic[]
const intensityDescriptions: Record<LearningIntensity, string> = {
  light: 'Short, flexible sessions',
  balanced: 'A steady weekly routine',
  focused: 'Longer, concentrated sessions',
}

export default function Profile() {
  const [initial] = useState(() => loadProfile())
  const [storageStatus, setStorageStatus] = useState(initial.status)
  const [draft, setDraft] = useState(() => toDraft(initial.profile))
  const [savedDraft, setSavedDraft] = useState(() => toDraft(initial.profile))
  const [errors, setErrors] = useState<ProfileErrors>({})
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null)
  const errorSummary = useRef<HTMLDivElement>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft)
  const storageWarning = storageStatus === 'corrupt'
    ? 'Saved preferences could not be read safely. The form shows defaults. The original data is kept until you choose Save preferences or Clear preferences.'
    : storageStatus === 'unavailable'
      ? 'Browser storage is unavailable. You can edit this form, but saving may not work. Enable storage for this site and try again.'
      : null

  function update<K extends keyof ProfileDraft>(field: K, value: ProfileDraft[K]) {
    setDraft(previous => ({ ...previous, [field]: value }))
    setErrors(previous => ({ ...previous, [field]: undefined }))
    setFeedback(null)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = saveProfile(toProfile(draft))
    if (!result.ok) {
      if (result.kind === 'validation') {
        setErrors(result.errors)
        setFeedback(null)
        requestAnimationFrame(() => errorSummary.current?.focus())
      } else {
        setFeedback({ message: result.message, error: true })
      }
      return
    }
    const normalized = toDraft(result.profile)
    setDraft(normalized)
    setSavedDraft(normalized)
    setStorageStatus('saved')
    setErrors({})
    setFeedback({ message: 'Preferences saved in this browser. You can edit them at any time.', error: false })
  }

  function reload() {
    if (dirty && !window.confirm('Reload saved preferences? Your unsaved edits will be discarded.')) return
    const result = loadProfile()
    setStorageStatus(result.status)
    if (result.status === 'unavailable') {
      setFeedback({ message: 'Could not reload saved preferences. Your current form has been kept.', error: true })
      return
    }
    const loaded = toDraft(result.profile)
    setDraft(loaded)
    setSavedDraft(loaded)
    setErrors({})
    setFeedback(result.status === 'corrupt' ? null : {
      message: result.status === 'saved' ? 'Saved preferences reloaded.' : 'No saved preferences found. Showing unsaved defaults.',
      error: false,
    })
  }

  function clear() {
    if (!window.confirm('Clear your saved PHAROS profile and current edits? Other browser data will be kept. The form will return to unsaved defaults, including Tamil Nadu.')) return
    const result = clearProfile()
    if (!result.ok) {
      setFeedback({ message: result.message, error: true })
      return
    }
    const defaults = toDraft(createDefaultProfile())
    setDraft(defaults)
    setSavedDraft(defaults)
    setStorageStatus('empty')
    setErrors({})
    setFeedback({ message: 'Preferences cleared from this browser. Tamil Nadu is the unsaved default; nothing is saved until you choose Save preferences.', error: false })
  }

  function fieldAria(field: keyof StudentProfile) {
    return { 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `${field}-hint ${field}-error` : `${field}-hint` }
  }
  const hasErrors = Object.values(errors).some(Boolean)

  return <>
    <header className="page-heading profile-heading">
      <div>
        <p className="eyebrow">YOUR DIRECTION, YOUR PACE</p>
        <h1>Student <span>Profile</span></h1>
        <p>A few preferences about what you’re learning and how you like to learn.</p>
      </div>
      <span className={`profile-save-state${dirty ? ' is-dirty' : ''}`}>
        <span className="signal-dot" />
        {dirty ? 'Unsaved changes' : storageStatus === 'saved' ? 'Saved in this browser' : 'Not saved'}
      </span>
    </header>

    <div className="notice profile-privacy">
      <Icon name="shield" />
      <p><strong>Stored in your browser, under your control.</strong> Preferences are saved on this browser and site, not synced between devices. If you request an opportunity explanation, your saved interests, skills and weekly learning hours are sent to the PHAROS backend and its AI service. Anyone using this browser can access saved preferences.</p>
    </div>
    {storageWarning && <div className="profile-message is-warning" role="alert"><Icon name="info" /><p>{storageWarning}</p></div>}

    <div className="profile-layout">
      <form className="profile-form" onSubmit={submit} noValidate>
        {hasErrors && <div className="profile-message is-error" role="alert" tabIndex={-1} ref={errorSummary}>
          <div><strong>Please check these preferences</strong><ul>{Object.entries(errors).filter(([, message]) => message).map(([field, message]) =>
            <li key={field}><a href={field === 'profile' ? '#profile-form-start' : `#profile-${field}`}>{message}</a></li>,
          )}</ul></div>
        </div>}

        <section className="detail-panel profile-section" id="profile-form-start" aria-labelledby="studies-title">
          <div className="profile-section-heading"><span className="category-icon"><Icon name="scholarship" /></span><div><h2 id="studies-title">Your studies</h2><p>Every field is optional. Share only what’s useful to you.</p></div></div>
          <div className="profile-fields">
            <div className="profile-field">
              <label htmlFor="profile-state">State / union territory</label>
              <input id="profile-state" value={draft.state} onChange={event => update('state', event.target.value)} maxLength={80} autoComplete="off" {...fieldAria('state')} />
              <p id="state-hint" className="field-hint">Tamil Nadu is the default. Change it or leave it blank.</p>
              <FieldError field="state" errors={errors} />
            </div>
            <div className="profile-field">
              <label htmlFor="profile-degreeCourse">Degree / course</label>
              <input id="profile-degreeCourse" value={draft.degreeCourse} onChange={event => update('degreeCourse', event.target.value)} placeholder="e.g. BSc Computer Science" maxLength={120} autoComplete="off" {...fieldAria('degreeCourse')} />
              <p id="degreeCourse-hint" className="field-hint">Your current course or area of study.</p>
              <FieldError field="degreeCourse" errors={errors} />
            </div>
            <div className="profile-field">
              <label htmlFor="profile-yearOfStudy">Year of study</label>
              <select id="profile-yearOfStudy" value={draft.yearOfStudy} onChange={event => update('yearOfStudy', event.target.value)} {...fieldAria('yearOfStudy')}>
                <option value="">Not specified</option>
                {Array.from({ length: 10 }, (_, index) => index + 1).map(year => <option key={year} value={year}>Year {year}</option>)}
              </select>
              <p id="yearOfStudy-hint" className="field-hint">Leave unspecified if this doesn’t apply.</p>
              <FieldError field="yearOfStudy" errors={errors} />
            </div>
          </div>
        </section>

        <section className="detail-panel profile-section" aria-labelledby="interests-title">
          <div className="profile-section-heading"><span className="category-icon"><Icon name="compass" /></span><div><h2 id="interests-title">What interests you?</h2><p>Choose any topics you’d like to explore.</p></div></div>
          <fieldset id="profile-careerInterests" className="profile-choice-fieldset" {...fieldAria('careerInterests')}>
            <legend className="sr-only">Career interests</legend>
            <div className="interest-grid">{interestOptions.map(topic => <label className="interest-option" key={topic}>
              <input type="checkbox" value={topic} checked={draft.careerInterests.includes(topic)} onChange={event => update('careerInterests', event.target.checked ? [...draft.careerInterests, topic] : draft.careerInterests.filter(value => value !== topic))} />
              <span>{topicLabels[topic]}</span>
            </label>)}</div>
            <p id="careerInterests-hint" className="field-hint">Select as many as you like, or leave all unselected.</p>
            <FieldError field="careerInterests" errors={errors} />
          </fieldset>
          <div className="profile-field skills-field">
            <label htmlFor="profile-skills">Existing skills</label>
            <textarea id="profile-skills" rows={3} value={draft.skills} onChange={event => update('skills', event.target.value)} placeholder="e.g. Python, writing, public speaking" {...fieldAria('skills')} />
            <p id="skills-hint" className="field-hint">Separate skills with commas or new lines. Up to 30 skills, 80 characters each. Duplicates are removed when saved.</p>
            <FieldError field="skills" errors={errors} />
          </div>
        </section>

        <section className="detail-panel profile-section" aria-labelledby="pace-title">
          <div className="profile-section-heading"><span className="category-icon"><Icon name="clock" /></span><div><h2 id="pace-title">A pace that fits your life</h2><p>Set your own learning preferences. You can change these later.</p></div></div>
          <div className="profile-field hours-field">
            <label htmlFor="profile-weeklyLearningHours">Available learning hours per week</label>
            <div className="hours-input"><input id="profile-weeklyLearningHours" type="text" inputMode="decimal" value={draft.weeklyLearningHours} onChange={event => update('weeklyLearningHours', event.target.value)} placeholder="e.g. 5" maxLength={12} {...fieldAria('weeklyLearningHours')} /><span aria-hidden="true">hours / week</span></div>
            <p id="weeklyLearningHours-hint" className="field-hint">From 0 to 168, including decimals such as 2.5. Blank means unspecified.</p>
            <FieldError field="weeklyLearningHours" errors={errors} />
          </div>
          <fieldset id="profile-learningIntensity" className="profile-choice-fieldset" {...fieldAria('learningIntensity')}>
            <legend>Preferred learning intensity</legend>
            <div className="intensity-grid">
              <label className="intensity-option"><input type="radio" name="learningIntensity" value="" checked={draft.learningIntensity === ''} onChange={() => update('learningIntensity', '')} /><span><strong>No preference</strong><small>Leave this open</small></span></label>
              {(Object.keys(intensityLabels) as LearningIntensity[]).map(intensity => <label className="intensity-option" key={intensity}>
                <input type="radio" name="learningIntensity" value={intensity} checked={draft.learningIntensity === intensity} onChange={() => update('learningIntensity', intensity)} />
                <span><strong>{intensityLabels[intensity]}</strong><small>{intensityDescriptions[intensity]}</small></span>
              </label>)}
            </div>
            <p id="learningIntensity-hint" className="field-hint">Pick the rhythm that feels comfortable for you, or leave it open.</p>
            <FieldError field="learningIntensity" errors={errors} />
          </fieldset>
        </section>

        <div className="profile-actions">
          <button className="button button-primary" type="submit" disabled={!dirty && storageStatus === 'saved'}>Save preferences <Icon name="check" /></button>
          <button className="button button-secondary" type="button" onClick={reload}>Reload saved preferences</button>
          <button className="profile-clear" type="button" onClick={clear} disabled={!dirty && storageStatus === 'empty'}>Clear preferences</button>
        </div>
        {feedback && <div className={`profile-message${feedback.error ? ' is-error' : ' is-success'}`} role={feedback.error ? 'alert' : 'status'}><Icon name={feedback.error ? 'info' : 'check'} /><p>{feedback.message}</p></div>}
      </form>

      <aside className="detail-panel profile-aside" aria-labelledby="profile-privacy-title">
        <span className="category-icon"><Icon name="shield" /></span>
        <h2 id="profile-privacy-title">Just the essentials.</h2>
        <p>No name, email, grades or financial details are needed. Everything here is optional.</p>
        <div className="profile-aside-note"><h3>You choose when to save</h3><p>Edits stay in this form until you save. Leaving the page before saving discards those edits.</p></div>
        <div className="profile-aside-note"><h3>Local to this browser</h3><p>Saved preferences survive page reloads. Clearing site data or using another browser won’t carry them over. Private browsing may remove them when the session ends.</p></div>
        <div className="profile-aside-note"><h3>Easy to change or remove</h3><p>Reload restores your last save. Clear removes these preferences and resets the form to unsaved defaults.</p></div>
      </aside>
    </div>
  </>
}
