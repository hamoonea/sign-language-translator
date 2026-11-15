import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSamples, parseSignImport, serializeSigns, loadLocalData, saveSamples, saveSessions } from '../js/data.js';

const sample = (label = 'L', features = [0.2, -0.5, 1]) => ({ label, features });
const session = (overrides = {}) => ({ id: 'one', createdAt: '2026-11-14T18:20:00.000Z', text: 'HELLO', ...overrides });
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, value), data };
}

test('sample validation copies data, normalizes labels, and preserves markup as inert text', () => {
  const input = [sample('  L\n  pose\u0000 '), sample('<b>Y</b>')];
  const clean = validateSamples(input);
  assert.equal(clean[0].label, 'L pose');
  assert.equal(clean[1].label, '<b>Y</b>');
  input[0].features[0] = 999;
  assert.equal(clean[0].features[0], 0.2);
  assert.deepEqual(validateSamples([]), []);
});

test('nonfinite/coerced numbers and incompatible vectors are rejected before matching', () => {
  for (const bad of [NaN, Infinity, -Infinity, '0.2', null, {}, undefined]) {
    assert.throws(() => validateSamples([sample('A', [bad])]), /finite number/);
  }
  assert.throws(() => validateSamples([sample(), sample('A', [1])]), /consistent/);
  for (const features of [[], new Array(257).fill(0), new Float32Array([1, 2])]) {
    assert.throws(() => validateSamples([sample('L', features)]), /1 to 256/);
  }
  assert.throws(() => validateSamples(new Array(10001).fill(sample())), /10,000/);
  assert.throws(() => validateSamples([sample('x'.repeat(25))]), /1 to 24/);
  assert.throws(() => validateSamples([sample('\n\u0000\u200b')]), /1 to 24/);
});

test('sparse, inherited, and accessor-poisoned data cannot masquerade as training samples', () => {
  assert.throws(() => validateSamples(new Array(1)), /missing/);
  const sparse = [0, , 1];
  Object.setPrototypeOf(sparse, { 1: 0 });
  assert.throws(() => validateSamples([sample('L', sparse)]), /missing/);
  let invoked = false;
  const hostile = { features: [1], get label() { invoked = true; return 'L'; } };
  assert.throws(() => validateSamples([hostile]), /plain data/);
  assert.equal(invoked, false);
  const input = JSON.parse('[{"label":"L","features":[1],"__proto__":{"polluted":true}}]');
  assert.deepEqual(validateSamples(input), [{ label: 'L', features: [1] }]);
  assert.equal({}.polluted, undefined);
});

test('export round trips using a strict versioned schema', () => {
  const text = serializeSigns([sample()]);
  assert.deepEqual(parseSignImport(text), [sample()]);
  assert.ok(Number.isFinite(Date.parse(JSON.parse(text).exportedAt)));
  assert.throws(() => parseSignImport('{'), /valid JSON/);
  assert.throws(() => parseSignImport('null'), /object/);
  for (const payload of [{ samples: [] }, { schema: 'sign-language-translator-signs', version: 2, samples: [] }]) {
    assert.throws(() => parseSignImport(JSON.stringify(payload)), /schema/);
  }
  assert.throws(() => parseSignImport('{"schema":"sign-language-translator-signs","version":1,"samples":[{"label":"L","features":[null]}]}'), /finite/);
});

test('import enforces byte limits, including multibyte text', () => {
  assert.throws(() => parseSignImport(' '.repeat(10 * 1024 * 1024)), /10 MiB/);
  assert.throws(() => parseSignImport('😀'.repeat(3 * 1024 * 1024)), /10 MiB/);
});

test('corrupt storage does not crash or erase independent valid data', () => {
  const storage = memoryStorage({
    'sign-language-translator.samples.v1': '{broken',
    'sign-language-translator.sessions.v1': JSON.stringify([session({ text: '<script>alert(1)</script>' })]),
  });
  const loaded = loadLocalData(storage);
  assert.deepEqual(loaded.samples, []);
  assert.equal(loaded.sessions[0].text, '<script>alert(1)</script>');
  assert.equal(loaded.warnings.length, 1);
  assert.equal(storage.getItem('sign-language-translator.samples.v1'), '{broken');
  assert.deepEqual(loadLocalData(memoryStorage()), { samples: [], sessions: [], warnings: [] });
});

test('unavailable and read/write-failing storage report recoverable failures', () => {
  assert.equal(loadLocalData(null).warnings.length, 1);
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.equal(loadLocalData(blocked).warnings.length, 2);
  assert.throws(() => saveSamples([sample()], blocked), /blocked or full/);
  assert.throws(() => saveSessions([session()], blocked), /blocked or full/);
  assert.throws(() => saveSamples([sample()], null), /could not be saved/);
});

test('saved arrays round trip with no extra object fields or caller aliasing', () => {
  const storage = memoryStorage();
  const input = sample();
  input.untrusted = 'extra';
  const saved = saveSamples([input], storage);
  input.features[0] = 30;
  assert.deepEqual(saved, [sample()]);
  assert.deepEqual(loadLocalData(storage).samples, [sample()]);
  const clean = saveSessions([session({ createdAt: '2026-11-14T10:20:00-08:00', extra: true })], storage);
  assert.equal(clean[0].createdAt, '2026-11-14T18:20:00.000Z');
  assert.deepEqual(Object.keys(clean[0]), ['id', 'createdAt', 'text']);
});

test('session boundaries reject invalid dates, oversized transcripts, and duplicate IDs without overwriting saved data', () => {
  const storage = memoryStorage();
  saveSessions([session()], storage);
  const original = storage.getItem('sign-language-translator.sessions.v1');
  for (const bad of [
    session({ createdAt: '2026-02-30T00:00:00Z' }),
    session({ createdAt: 'yesterday' }),
    session({ text: 'x'.repeat(5001) }),
    session({ text: { html: 'oops' } }),
    session({ id: '' }),
  ]) assert.throws(() => saveSessions([bad], storage));
  assert.throws(() => saveSessions([session(), session()], storage), /unique/);
  assert.throws(() => saveSessions(new Array(31).fill(session()), storage), /30/);
  assert.equal(storage.getItem('sign-language-translator.sessions.v1'), original);
  assert.equal(saveSessions([session({ createdAt: '2024-02-29T00:00:00Z' })], storage)[0].createdAt, '2024-02-29T00:00:00.000Z');
});
