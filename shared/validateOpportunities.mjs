import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Runtime equivalents of the unions in contract.ts; TypeScript types alone
// cannot validate JSON. Keep these values aligned with that shared contract.
const enums = {
  category: ['scholarship', 'course_cert', 'software_perk'],
  cost: ['free', 'free_to_learn_paid_cert', 'paid', 'unknown'],
  topics: ['ai_ml', 'web_dev', 'cybersecurity', 'data_science', 'general'],
  deadline: ['fixed', 'rolling', 'annual_expected', 'unknown'],
  scope: ['national', 'state', 'unknown'],
  sourceType: ['official', 'provider', 'third_party', 'unknown'],
  verificationStatus: ['checked_against_source', 'unreviewed', 'demo'],
};

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function isTimestamp(value) {
  if (typeof value !== 'string') return false;
  // Require a complete ISO timestamp with seconds and an explicit timezone.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  return Boolean(match && isCalendarDate(match[1])
    && Number(match[2]) <= 23 && Number(match[3]) <= 59 && Number(match[4]) <= 59
    && (match[5] === 'Z' || (Number(match[6]) <= 23 && Number(match[7]) <= 59))
    && Number.isFinite(Date.parse(value)));
}

function isHttpUrl(value) {
  if (typeof value !== 'string' || value !== value.trim() || !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Validate an OpportunityListResponse at runtime, returning field-specific errors. */
export function validateOpportunities(data) {
  const errors = [];
  const fail = (path, message) => errors.push(`${path}: ${message}`);
  const object = (value, path, fields) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      fail(path, 'must be an object');
      return false;
    }
    for (const field of fields) {
      if (!Object.hasOwn(value, field)) fail(`${path}.${field}`, 'missing required property');
    }
    for (const field of Object.keys(value)) {
      if (!fields.includes(field)) fail(`${path}.${field}`, 'unexpected property');
    }
    return true;
  };
  const string = (value, path, nullable = false) => {
    if (typeof value !== 'string' && !(nullable && value === null)) {
      fail(path, `must be a string${nullable ? ' or null' : ''}`);
    }
  };
  const enumeration = (value, path, values) => {
    if (!values.includes(value)) fail(path, `must be one of: ${values.join(', ')}`);
  };
  const array = (value, path, values) => {
    if (!Array.isArray(value)) {
      fail(path, 'must be an array');
      return;
    }
    for (let index = 0; index < value.length; index += 1) {
      if (values) enumeration(value[index], `${path}[${index}]`, values);
      else string(value[index], `${path}[${index}]`);
    }
  };
  const date = (value, path) => {
    if (value !== null && !isCalendarDate(value)) {
      fail(path, 'must be null or a valid YYYY-MM-DD calendar date');
    }
  };

  if (!object(data, 'response', ['schemaVersion', 'generatedAt', 'items'])) return errors;
  if (data.schemaVersion !== 1) fail('response.schemaVersion', 'must equal the number 1');
  if (!isTimestamp(data.generatedAt)) fail('response.generatedAt', 'must be a valid ISO timestamp with a timezone');
  if (!Array.isArray(data.items)) {
    fail('response.items', 'must be an array');
    return errors;
  }

  const ids = new Set();
  const fields = [
    'id', 'category', 'title', 'provider', 'summary', 'cost', 'eligibilitySummary',
    'applicability', 'deadline', 'sourceName', 'sourceUrl', 'sourceType',
    'verificationStatus', 'lastVerifiedAt', 'verifiedBy', 'topics', 'tags',
  ];
  for (let index = 0; index < data.items.length; index += 1) {
    const item = data.items[index];
    const path = `items[${index}]`;
    if (!object(item, path, fields)) continue;
    for (const field of ['id', 'title', 'provider', 'summary', 'eligibilitySummary']) {
      string(item[field], `${path}.${field}`);
    }
    for (const field of ['sourceName', 'sourceUrl', 'lastVerifiedAt', 'verifiedBy']) {
      string(item[field], `${path}.${field}`, true);
    }
    for (const field of ['category', 'cost', 'sourceType', 'verificationStatus']) {
      enumeration(item[field], `${path}.${field}`, enums[field]);
    }
    if (typeof item.id === 'string') {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)) {
        fail(`${path}.id`, 'must be lowercase-kebab-case (lowercase letters/digits separated by single hyphens)');
      }
      if (ids.has(item.id)) fail(`${path}.id`, `duplicate ID ${JSON.stringify(item.id)}`);
      ids.add(item.id);
    }
    array(item.topics, `${path}.topics`, enums.topics);
    array(item.tags, `${path}.tags`);

    if (object(item.applicability, `${path}.applicability`, ['scope', 'states'])) {
      const { scope, states } = item.applicability;
      enumeration(scope, `${path}.applicability.scope`, enums.scope);
      array(states, `${path}.applicability.states`);
      if (Array.isArray(states)) {
        if (scope === 'state' && !states.some(state => typeof state === 'string' && state.trim())) {
          fail(`${path}.applicability.states`, 'state scope requires at least one nonblank state');
        }
        if (scope !== 'state' && states.length !== 0) {
          fail(`${path}.applicability.states`, 'must be empty for non-state applicability');
        }
      }
    }
    if (object(item.deadline, `${path}.deadline`, ['type', 'date', 'note'])) {
      enumeration(item.deadline.type, `${path}.deadline.type`, enums.deadline);
      date(item.deadline.date, `${path}.deadline.date`);
      string(item.deadline.note, `${path}.deadline.note`, true);
      if (item.deadline.type === 'fixed' && !isCalendarDate(item.deadline.date)) {
        fail(`${path}.deadline.date`, 'fixed deadlines require a valid date');
      }
      // Do not reject past dates: a fixed deadline expires only after its date
      // ends in IST; deciding whether to display expired records is separate.
    }
    date(item.lastVerifiedAt, `${path}.lastVerifiedAt`);
    if (typeof item.sourceUrl === 'string' && !isHttpUrl(item.sourceUrl)) {
      fail(`${path}.sourceUrl`, 'must be a valid HTTP(S) URL or null');
    }

    const demoTitle = typeof item.title === 'string' && item.title.startsWith('[DEMO]');
    if (demoTitle && item.verificationStatus !== 'demo') {
      fail(`${path}.verificationStatus`, '[DEMO] titles require demo status');
    }
    if (item.verificationStatus === 'demo') {
      if (!demoTitle) fail(`${path}.title`, 'demo titles must begin with [DEMO]');
      for (const field of ['sourceUrl', 'lastVerifiedAt', 'verifiedBy']) {
        if (item[field] !== null) fail(`${path}.${field}`, 'must be null for demo records');
      }
    }
    if (item.verificationStatus === 'checked_against_source') {
      if (!isHttpUrl(item.sourceUrl)) fail(`${path}.sourceUrl`, 'checked records require a valid HTTP(S) source URL');
      if (!isCalendarDate(item.lastVerifiedAt)) fail(`${path}.lastVerifiedAt`, 'checked records require a valid verification date');
      if (typeof item.verifiedBy !== 'string' || !item.verifiedBy.trim()) {
        fail(`${path}.verifiedBy`, 'checked records require a nonblank verifier name');
      }
      if (!['official', 'provider'].includes(item.sourceType)) {
        fail(`${path}.sourceType`, 'checked records require official or provider');
      }
    }
    // The contract has no "unknown" verification status. Unknown source type
    // or unreviewed status cannot carry claims of human verification.
    if (item.sourceType === 'unknown' || item.verificationStatus === 'unreviewed') {
      for (const field of ['lastVerifiedAt', 'verifiedBy']) {
        if (item[field] !== null) fail(`${path}.${field}`, 'must be null for unknown-source or unreviewed records');
      }
    }
  }
  return errors;
}

// Resolve the sample relative to this module, regardless of the caller's cwd.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const sample = JSON.parse(readFileSync(new URL('./opportunities.sample.json', import.meta.url), 'utf8'));
    const errors = validateOpportunities(sample);
    if (errors.length) {
      console.error(`Validation failed (${errors.length} errors):\n${errors.map(error => `- ${error}`).join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log(`Validation passed: ${sample.items.length} opportunities, schemaVersion 1.`);
    }
  } catch (error) {
    console.error(`Validation failed: unable to read or parse sample JSON: ${error.message}`);
    process.exitCode = 1;
  }
}
