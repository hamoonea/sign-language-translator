/**
 * Sign Language Translator data boundary. Every returned record is newly allocated and contains
 * only documented fields. Labels and transcripts are text, never HTML.
 *
 * loadLocalData(storage?) -> { samples, sessions, warnings: string[] }
 * parseSignImport(text) -> samples
 * saveSamples(samples, storage?) / saveSessions(sessions, storage?) -> stored array
 * Storage defaults to browser localStorage and can be injected for tests.
 */

const SAMPLE_KEY = 'sign-language-translator.samples.v1';
const SESSION_KEY = 'sign-language-translator.sessions.v1';
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function dataField(record, key, context) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !own(descriptor, 'value')) {
    throw new Error(`${context}: ${key} must be a plain data field.`);
  }
  return descriptor.value;
}

function checkRecord(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
}

function cleanLabel(value, context) {
  if (typeof value !== 'string') throw new Error(`${context}: label must be text.`);
  const label = value.normalize('NFC')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, '')
    .replace(/\s+/gu, ' ').trim();
  if (!label || Array.from(label).length > 24) {
    throw new Error(`${context}: label must contain 1 to 24 characters.`);
  }
  return label;
}

export function validateSamples(samples) {
  if (!Array.isArray(samples)) throw new Error('Samples must be an array.');
  if (samples.length > 10000) throw new Error('Use no more than 10,000 samples.');
  let featureCount;
  const result = [];
  for (let i = 0; i < samples.length; i += 1) {
    const context = `Sample ${i + 1}`;
    if (!own(samples, i)) throw new Error(`${context} is missing.`);
    const sample = dataField(samples, String(i), context);
    checkRecord(sample, context);
    const label = cleanLabel(dataField(sample, 'label', context), context);
    const features = dataField(sample, 'features', context);
    if (!Array.isArray(features) || features.length < 1 || features.length > 256) {
      throw new Error(`${context}: features must contain 1 to 256 numbers.`);
    }
    if (featureCount !== undefined && features.length !== featureCount) {
      throw new Error(`${context}: feature vector sizes must be consistent.`);
    }
    featureCount = features.length;
    const copy = [];
    for (let j = 0; j < features.length; j += 1) {
      if (!own(features, j)) throw new Error(`${context}: feature ${j + 1} is missing.`);
      const value = dataField(features, String(j), context);
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${context}: feature ${j + 1} must be a finite number.`);
      }
      copy.push(value);
    }
    result.push({ label, features: copy });
  }
  return result;
}

export function parseSignImport(text) {
  if (typeof text !== 'string') throw new Error('Import must contain JSON text.');
  // UTF-8 is never smaller than the UTF-16 length for valid JSON text. The first
  // check avoids allocating a second large buffer for clearly oversized input.
  if (text.length >= MAX_IMPORT_BYTES || new TextEncoder().encode(text).byteLength >= MAX_IMPORT_BYTES) {
    throw new Error('Sign files must be smaller than 10 MiB.');
  }
  let payload;
  try { payload = JSON.parse(text); }
  catch { throw new Error('This file is not valid JSON.'); }
  checkRecord(payload, 'Sign file');
  if (payload.schema !== 'sign-language-translator-signs' || payload.version !== 1) {
    throw new Error('Use a Sign Language Translator signs file with schema sign-language-translator-signs and version 1.');
  }
  return validateSamples(payload.samples);
}

export function serializeSigns(samples) {
  return JSON.stringify({
    schema: 'sign-language-translator-signs',
    version: 1,
    exportedAt: new Date().toISOString(),
    samples: validateSamples(samples),
  }, null, 2);
}

function isoDate(value, context) {
  if (typeof value !== 'string') throw new Error(`${context}: createdAt must be an ISO timestamp.`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error(`${context}: createdAt must be an ISO timestamp.`);
  const [, year, month, day, hours, minutes, seconds] = match.map((v, index) => index > 0 && index < 7 ? Number(v) : v);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const time = Date.parse(value);
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hours > 23 || minutes > 59 || seconds > 59 || !Number.isFinite(time)) {
    throw new Error(`${context}: createdAt is not a valid date and time.`);
  }
  return new Date(time).toISOString();
}

function validateSessions(sessions) {
  if (!Array.isArray(sessions) || sessions.length > 30) {
    throw new Error('Sessions must be an array containing no more than 30 entries.');
  }
  const result = [];
  const ids = new Set();
  for (let i = 0; i < sessions.length; i += 1) {
    const context = `Session ${i + 1}`;
    if (!own(sessions, i)) throw new Error(`${context} is missing.`);
    const session = dataField(sessions, String(i), context);
    checkRecord(session, context);
    const id = dataField(session, 'id', context);
    const text = dataField(session, 'text', context);
    if (typeof id !== 'string' || !id.trim()) throw new Error(`${context}: id must be nonempty text.`);
    if (ids.has(id)) throw new Error(`${context}: session IDs must be unique.`);
    if (typeof text !== 'string' || text.length > 5000) throw new Error(`${context}: text must contain no more than 5,000 characters.`);
    const createdAt = isoDate(dataField(session, 'createdAt', context), context);
    result.push({ id, createdAt, text });
    ids.add(id);
  }
  return result;
}

function resolveStorage(storage) {
  // Accessing localStorage itself can throw in restricted/embedded contexts.
  const selected = storage === undefined ? globalThis.localStorage : storage;
  if (!selected || typeof selected.getItem !== 'function' || typeof selected.setItem !== 'function') {
    throw new Error('Browser storage is unavailable.');
  }
  return selected;
}

export function loadLocalData(storage) {
  const state = { samples: [], sessions: [], warnings: [] };
  let selected;
  try { selected = resolveStorage(storage); }
  catch { state.warnings.push('Browser storage is unavailable. Saved data could not be loaded.'); return state; }
  for (const [field, key, validate] of [
    ['samples', SAMPLE_KEY, validateSamples],
    ['sessions', SESSION_KEY, validateSessions],
  ]) {
    try {
      const raw = selected.getItem(key);
      if (raw === null || raw === undefined) continue;
      if (typeof raw !== 'string' || raw.length >= MAX_IMPORT_BYTES) throw new Error('Stored content is invalid or too large.');
      state[field] = validate(JSON.parse(raw));
    } catch {
      state.warnings.push(`Saved ${field} could not be loaded. The stored data was left unchanged.`);
    }
  }
  return state;
}

function saveData(key, value, validate, storage, name) {
  const clean = validate(value);
  const json = JSON.stringify(clean);
  try { resolveStorage(storage).setItem(key, json); }
  catch { throw new Error(`${name} could not be saved. Browser storage may be blocked or full. Export your data for a backup.`); }
  return clean;
}

export function saveSamples(samples, storage) {
  return saveData(SAMPLE_KEY, samples, validateSamples, storage, 'Sign samples');
}

export function saveSessions(sessions, storage) {
  return saveData(SESSION_KEY, sessions, validateSessions, storage, 'Sessions');
}
