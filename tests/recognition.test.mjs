// Synthetic geometry and state-machine tests only. These do not measure ASL
// recognition accuracy and contain no recordings from real people.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../js/recognition.js', import.meta.url), 'utf8');
const { BUILTIN_SIGNS, FEATURES_LENGTH, extractFeatures, classifyCustom, classifyHand, TemporalStabilizer } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function hand({ up = [], thumb = false, spread = false, together = false } = {}) {
  const p = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const set = (i, x, y, z = 0) => { p[i] = { x, y, z }; };
  set(0, 0, 0);
  set(1, 0.28, 0.21); set(2, 0.48, 0.28);
  if (thumb) { set(3, 0.69, 0.31); set(4, 0.88, 0.33); }
  else { set(3, 0.22, 0.50, 0.11); set(4, 0.08, 0.52, 0.15); }
  const bases = [[5, .28, .62, .73], [9, 0, .68, .80], [13, -.24, .62, .73], [17, -.43, .48, .60]];
  for (let f = 0; f < bases.length; f++) {
    const [b, x, y, length] = bases[f];
    set(b, x, y);
    if (up.includes(f)) {
      let offset = spread ? [.30, 0, -.30, -.35][f] : 0;
      if (together && f === 0) offset = -.09;
      for (const [j, ratio] of [[1, .40], [2, .72], [3, 1]]) set(b + j, x + offset * ratio, y + length * ratio);
    } else {
      set(b + 1, x, y + .24, .08);
      set(b + 2, x, y + .18, .20);
      set(b + 3, x, y + .04, .17);
    }
  }
  // Fixtures use camera coordinates: an upright hand points toward smaller y.
  return p.map(point => ({ ...point, y: -point.y }));
}
const pose = hand({ up: [0], thumb: true });
const almostEqual = (a, b) => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-10, `feature ${i}: ${v} vs ${b[i]}`));
};
const copies = (label, features, count = 5) => Array.from({ length: count }, () => ({ label, features: [...features] }));
const candidate = label => ({ label, score: .92, source: 'builtin', reason: 'synthetic unit test' });
function observe(s, label, from, to, step = 100) {
  let r;
  const commits = [];
  for (let t = from; t <= to; t += step) {
    r = s.update(label ? candidate(label) : null, t);
    if (r.committed) commits.push(r.committed.label);
  }
  return { result: r, commits };
}

test('features have documented size and are invariant under translation, scale, rotation and mirroring', () => {
  const f = extractFeatures(pose);
  assert.equal(f.length, FEATURES_LENGTH);
  const angle = .72;
  const transformed = pose.map(p => ({
    x: 3 + 4 * (p.x * Math.cos(angle) - p.y * Math.sin(angle)),
    y: -2 + 4 * (p.x * Math.sin(angle) + p.y * Math.cos(angle)),
    z: 5 + p.z * 4,
  }));
  almostEqual(f, extractFeatures(transformed));
  almostEqual(f, extractFeatures(pose.map(p => ({ ...p, x: -p.x }))));
});

test('invalid and degenerate landmarks are rejected without throwing', () => {
  const bad = [null, [], pose.slice(0, 20), Array(21).fill({ x: 0, y: 0, z: 0 }),
    pose.map((p, i) => i === 8 ? { ...p, x: NaN } : p),
    pose.map((p, i) => i === 8 ? { ...p, z: Infinity } : p),
    pose.map((p, i) => i === 8 ? {} : p)];
  for (const p of bad) { assert.equal(extractFeatures(p), null); assert.equal(classifyHand(p), null); }
});

test('finite isotropic coordinates are allowed outside normalized bounds', () => {
  assert.ok(extractFeatures(pose.map(p => ({ x: p.x + 6, y: p.y + 8, z: p.z - 4 }))));
});

test('built-in rules distinguish clearly separated synthetic shapes and reject unsupported fists', () => {
  assert.equal(classifyHand(hand()), null);
  assert.equal(classifyHand(hand({ up: [0], thumb: true }))?.label, 'L');
  assert.equal(classifyHand(hand({ up: [3] }))?.label, 'I');
  assert.equal(classifyHand(hand({ up: [3], thumb: true }))?.label, 'Y');
  assert.equal(classifyHand(hand({ up: [0, 3], thumb: true }))?.label, 'ILY');
  assert.equal(classifyHand(hand({ up: [0, 1], spread: true }))?.label, 'V');
  assert.equal(classifyHand(hand({ up: [0, 1], together: true }))?.label, 'U');
  assert.equal(classifyHand(hand({ up: [0, 1, 2], spread: true }))?.label, 'W');
  assert.equal(classifyHand(hand({ up: [0, 1, 2, 3], thumb: true })), null);
  assert.equal(classifyHand(pose, [], { threshold: 1 }), null);
  assert.deepEqual(BUILTIN_SIGNS.map(s => s.id), ['I', 'L', 'U', 'V', 'W', 'Y', 'ILY']);
});

test('built-in U requires upright orientation and rejects sideways, downward and edge-on poses', () => {
  const upright = hand({ up: [0, 1], together: true });
  const rotate = angle => upright.map(p => ({
    x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
    y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
    z: p.z,
  }));
  assert.equal(classifyHand(upright)?.label, 'U');
  assert.equal(classifyHand(rotate(Math.PI / 12))?.label, 'U');
  assert.equal(classifyHand(rotate(Math.PI / 2)), null);
  assert.equal(classifyHand(rotate(Math.PI)), null);
  const edgeOn = upright.map(p => ({ x: p.z, y: p.y, z: -p.x }));
  assert.equal(classifyHand(edgeOn), null);
  // Custom features still deliberately ignore rotation, documented as a limit.
  almostEqual(extractFeatures(upright), extractFeatures(rotate(Math.PI / 2)));
});

test('custom classification requires five examples, rejects malformed samples and distant poses', () => {
  const f = extractFeatures(pose);
  assert.equal(classifyCustom(f, copies('MY SIGN', f, 4)), null);
  assert.equal(classifyCustom(f, copies('MY SIGN', f))?.label, 'MY SIGN');
  assert.equal(classifyCustom(f, copies('MY SIGN', f))?.score, 1);
  assert.equal(classifyCustom(f, copies('FAR', f.map(v => v + 2))), null);
  assert.equal(classifyCustom([], copies('MY SIGN', f)), null);
  assert.equal(classifyCustom(f, [{ label: 'bad', features: f.map(() => NaN) }]), null);
  assert.equal(classifyHand(pose, copies('CUSTOM L', f))?.source, 'custom');
});

test('equally similar custom labels are rejected instead of guessing', () => {
  const f = extractFeatures(pose);
  assert.equal(classifyCustom(f, [...copies('FIRST', f), ...copies('SECOND', f)]), null);
});

test('ambiguous nearby custom labels block built-in fallback, but distant samples do not', () => {
  const u = hand({ up: [0, 1], together: true });
  const f = extractFeatures(u);
  const conflicting = [...copies('FIRST', f), ...copies('SECOND', f)];
  assert.equal(classifyHand(u, conflicting), null);
  assert.equal(classifyHand(u, copies('DISTANT', f.map(v => v + 2)))?.label, 'U');
});

test('custom feature validation rejects unavailable, negative, out-of-range and nonfinite values', () => {
  const f = extractFeatures(pose);
  for (const bad of [null, undefined, [], Array(FEATURES_LENGTH), f.slice(1),
    f.map((v, i) => i === 0 ? -0.01 : v),
    f.map((v, i) => i === 0 ? 20.01 : v),
    f.map((v, i) => i === 0 ? Infinity : v)]) {
    assert.equal(classifyCustom(bad, copies('L', f)), null);
    assert.equal(classifyCustom(f, Array.from({ length: 5 }, () => ({ label: 'BAD', features: bad }))), null);
  }
  assert.equal(classifyCustom(f, null), null);
  assert.equal(classifyCustom(f, undefined), null);
  assert.equal(classifyCustom(f, copies('L', f), null)?.label, 'L');
  assert.equal(classifyHand(pose, null, null)?.label, 'L');
});

test('a hold requires continuously observed elapsed time and commits once', () => {
  const s = new TemporalStabilizer();
  assert.deepEqual(observe(s, 'L', 0, 800).commits, []);
  assert.equal(s.update(candidate('L'), 900).committed.label, 'L');
  assert.deepEqual(observe(s, 'L', 1000, 2000).commits, []);
});

test('a missing hand releases a repeated label only after the release interval', () => {
  const s = new TemporalStabilizer();
  observe(s, 'L', 0, 900);
  observe(s, null, 1000, 1200);
  assert.deepEqual(observe(s, 'L', 1300, 2300).commits, []);
  observe(s, null, 2400, 2800);
  assert.deepEqual(observe(s, 'L', 2900, 3800).commits, ['L']);
});

test('different stable signs commit, while a flicker does not rearm a repeated sign', () => {
  const s = new TemporalStabilizer();
  observe(s, 'L', 0, 900);
  s.update(candidate('V'), 1000);
  assert.deepEqual(observe(s, 'L', 1100, 2100).commits, []);
  assert.deepEqual(observe(s, 'V', 2200, 3100).commits, ['V']);
  assert.deepEqual(observe(s, 'L', 3200, 4100).commits, ['L']);
});

test('frame gaps and clock reversal cannot produce a retroactive hold', () => {
  const s = new TemporalStabilizer();
  s.update(candidate('L'), 0);
  assert.equal(s.update(candidate('L'), 3000).progress, 0);
  assert.equal(s.update(candidate('L'), 3000).committed, null);
  assert.equal(s.update(candidate('L'), 2500).progress, 0);
  assert.deepEqual(observe(s, 'L', 2600, 3400).commits, ['L']);
});

test('unobserved gaps cannot unlatch the previous sign', () => {
  const s = new TemporalStabilizer();
  observe(s, 'L', 0, 900);
  s.update(null, 1000);
  s.update(null, 5000);
  assert.deepEqual(observe(s, 'L', 5100, 6100).commits, []);
});

test('low scores, invalid timestamps and reset cannot manufacture a commit', () => {
  const s = new TemporalStabilizer();
  observe(s, 'L', 0, 800);
  assert.equal(s.update({ ...candidate('L'), score: .2 }, 900).candidate, null);
  assert.equal(s.update(candidate('L'), 1000).progress, 0);
  assert.equal(s.update(candidate('L'), NaN).committed, null);
  assert.equal(s.update(candidate('L'), 2000).progress, 0);
  s.reset();
  assert.equal(s.update(candidate('L'), 2100).progress, 0);
});
