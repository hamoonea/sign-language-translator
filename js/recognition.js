/**
 * Sign Language Translator static hand-shape recognizer.
 *
 * All inputs must use isotropic coordinates: for MediaPipe normalized landmarks,
 * pass {x, y: y * videoHeight / videoWidth, z}. Keep raw landmarks for drawing.
 * Camera coordinates must retain their original convention: y increases down.
 * The built-ins are conservative geometry rules, not a trained ASL translator.
 * Scores express rule fit / sample similarity, not calibrated probabilities.
 * Custom features intentionally ignore translation, size, rotation and mirroring;
 * they cannot distinguish signs that differ only in orientation or movement.
 */

export const BUILTIN_SIGNS = Object.freeze([
  { id: 'I', label: 'I', description: 'Pinky up; other fingers curled.', tip: 'Keep your thumb tucked across your curled fingers.' },
  { id: 'L', label: 'L', description: 'Index finger and thumb form an L.', tip: 'Extend your index and thumb; curl the other three fingers.' },
  { id: 'U', label: 'U', description: 'Index and middle fingers up, together.', tip: 'Keep the two fingers straight, uncrossed and close together; tuck your thumb.' },
  { id: 'V', label: 'V', description: 'Index and middle fingers form a V.', tip: 'Separate the two raised fingers; curl your ring and pinky and tuck your thumb.' },
  { id: 'W', label: 'W', description: 'Index, middle and ring fingers up.', tip: 'Separate the three raised fingers; keep your pinky curled and thumb tucked.' },
  { id: 'Y', label: 'Y', description: 'Thumb and pinky extended.', tip: 'Extend your thumb to the side and your pinky upward; curl the middle three fingers.' },
  { id: 'ILY', label: 'I love you', description: 'Thumb, index and pinky extended.', tip: 'Extend your thumb, index and pinky; curl your middle and ring fingers.' },
].map(Object.freeze));

export const FEATURES_LENGTH = 210;
const MIN_CUSTOM_SAMPLES = 5;
const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const magnitude = a => Math.hypot(...a);
const distance = (a, b) => magnitude(sub(a, b));
const unit = a => a.map(v => v / magnitude(a));

function handGeometry(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return null;
  const p = [];
  for (const point of landmarks) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        (point.z !== undefined && !Number.isFinite(point.z))) return null;
    p.push([point.x, point.y, point.z ?? 0]);
  }
  const length = distance(p[0], p[9]);
  const width = distance(p[5], p[17]);
  const scale = (length + width) / 2;
  if (!Number.isFinite(scale) || length < 1e-6 || width < 1e-6 || scale < 1e-6) return null;
  const yAxis = unit(sub(p[9], p[0]));
  const across = sub(p[5], p[17]);
  const xRaw = across.map((v, i) => v - dot(across, yAxis) * yAxis[i]);
  if (magnitude(xRaw) < scale * 0.08) return null;
  const xAxis = unit(xRaw);
  const x = point => dot(sub(point, p[0]), xAxis) / scale;
  const y = point => dot(sub(point, p[0]), yAxis) / scale;
  // Reject degenerate, non-hand chains instead of producing a confident label.
  for (const base of [1, 5, 9, 13, 17]) {
    for (let i = base; i < base + 3; i++) {
      const bone = distance(p[i], p[i + 1]) / scale;
      if (!Number.isFinite(bone) || bone < 0.008 || bone > 1.2) return null;
    }
  }
  return { p, scale, x, y };
}

/** 210 pairwise landmark distances, normalized by palm size. */
export function extractFeatures(landmarks) {
  const g = handGeometry(landmarks);
  if (!g) return null;
  const features = [];
  for (let a = 0; a < 21; a++) {
    for (let b = a + 1; b < 21; b++) features.push(distance(g.p[a], g.p[b]) / g.scale);
  }
  return features;
}

function validFeatures(features) {
  if (!Array.isArray(features) || features.length !== FEATURES_LENGTH) return false;
  // Index explicitly: Array.every skips holes in a sparse input array.
  for (let i = 0; i < features.length; i++) {
    const v = features[i];
    if (!Number.isFinite(v) || v < 0 || v > 20) return false;
  }
  return true;
}

function featureDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum / a.length);
}

/**
 * Nearest-examples classifier. Five examples are required per label; the mean
 * distance of the nearest three determines similarity. All examples should be
 * collected from independent poses with slight natural variation.
 */
function evaluateCustom(features, samples, options = {}) {
  const noMatch = { candidate: null, ambiguous: false };
  if (!validFeatures(features) || !Array.isArray(samples)) return noMatch;
  options = options ?? {};
  const maxDistance = Number.isFinite(options.maxDistance) && options.maxDistance > 0
    ? options.maxDistance : 0.18;
  const ambiguityMargin = Number.isFinite(options.ambiguityMargin) && options.ambiguityMargin >= 0
    ? options.ambiguityMargin : 0.025;
  const groups = new Map();
  for (const sample of samples) {
    if (!sample || typeof sample.label !== 'string' || !sample.label.trim() ||
        sample.label.length > 40 || !validFeatures(sample.features)) continue;
    const label = sample.label.trim();
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(featureDistance(features, sample.features));
  }
  const ranked = [];
  for (const [label, distances] of groups) {
    if (distances.length < MIN_CUSTOM_SAMPLES) continue;
    distances.sort((a, b) => a - b);
    ranked.push({ label, distance: (distances[0] + distances[1] + distances[2]) / 3 });
  }
  ranked.sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  if (!best || best.distance > maxDistance) return noMatch;
  if (ranked[1] && ranked[1].distance - best.distance < ambiguityMargin) {
    return { candidate: null, ambiguous: true };
  }
  return {
    candidate: {
      label: best.label,
      score: clamp(1 - best.distance / (2 * maxDistance)),
      source: 'custom',
      reason: 'Matches your saved static-pose examples.',
    },
    ambiguous: false,
  };
}

/** Returns the matched custom candidate, or null for unknown/ambiguous input. */
export function classifyCustom(features, samples, options = {}) {
  return evaluateCustom(features, samples, options).candidate;
}

function finger(g, base) {
  const { p, y } = g;
  const chain = distance(p[base], p[base + 1]) + distance(p[base + 1], p[base + 2]) +
    distance(p[base + 2], p[base + 3]);
  const straightness = distance(p[base], p[base + 3]) / chain;
  const rise = y(p[base + 3]) - y(p[base]);
  const beyondKnuckle = y(p[base + 3]) - y(p[base + 1]);
  if (straightness > 0.89 && rise > 0.48 && beyondKnuckle > 0.15) {
    return { state: 'up', quality: Math.min(clamp((straightness - 0.85) / 0.13), clamp((rise - 0.35) / 0.5)) };
  }
  if (straightness < 0.76 && beyondKnuckle < 0.12) {
    return { state: 'down', quality: clamp((0.84 - straightness) / 0.35) };
  }
  return { state: 'unknown', quality: 0 };
}

function classifyBuiltin(g) {
  const { p, scale, x, y } = g;
  // Preserve camera-frame orientation for the built-ins. Shape normalization
  // alone would conflate upright U with the sideways, orientation-distinct H.
  // This gate accepts an upright palm axis with a moderate amount of tilt.
  const palmAxis = sub(p[9], p[0]);
  const palmAcross = sub(p[5], p[17]);
  const palmLength = magnitude(palmAxis);
  if (-palmAxis[1] / palmLength < 0.70) return null;
  // A very edge-on palm has little projected area, making folded fingers and
  // spacing unreliable. The absolute value permits either handedness; it does
  // not infer whether the camera sees the palm or the back of the hand.
  const projectedArea = Math.abs(palmAxis[0] * palmAcross[1] - palmAxis[1] * palmAcross[0]);
  if (projectedArea / (palmLength * magnitude(palmAcross)) < 0.35) return null;
  const fingers = [5, 9, 13, 17].map(base => finger(g, base));
  if (fingers.some(f => f.state === 'unknown')) return null;
  const shape = fingers.map(f => f.state === 'up' ? '1' : '0').join('');
  const thumbReach = x(p[4]) - x(p[5]);
  const thumbLength = distance(p[4], p[2]) / scale;
  const thumbOut = thumbReach > 0.30 && thumbLength > 0.45;
  const thumbTucked = thumbReach < 0.18 && distance(p[4], p[9]) / scale < 1.05;
  if (!thumbOut && !thumbTucked) return null;
  let label = null;
  let detailQuality = 1;
  if (shape === '0001') label = thumbOut ? 'Y' : 'I';
  if (shape === '1000' && thumbOut) label = 'L';
  if (shape === '1001' && thumbOut) label = 'ILY';
  if (shape === '1110' && thumbTucked) {
    // W is spread, whereas closely touching raised fingers can be another pose.
    const gapA = distance(p[8], p[12]) / scale;
    const gapB = distance(p[12], p[16]) / scale;
    if (gapA > 0.28 && gapB > 0.28 && x(p[8]) > x(p[12]) && x(p[12]) > x(p[16])) label = 'W';
  }
  if (shape === '1100' && thumbTucked) {
    const gap = distance(p[8], p[12]) / scale;
    const indexDirection = unit(sub(p[8], p[5]));
    const middleDirection = unit(sub(p[12], p[9]));
    const separation = Math.acos(clamp(dot(indexDirection, middleDirection), -1, 1));
    const uncrossed = x(p[8]) > x(p[12]) + 0.025;
    if (uncrossed && gap < 0.34 && separation < 0.19 && Math.abs(y(p[8]) - y(p[12])) < 0.35) {
      label = 'U';
      detailQuality = clamp((0.42 - gap) / 0.20);
    } else if (uncrossed && gap > 0.48 && separation > 0.22) {
      label = 'V';
      detailQuality = clamp((gap - 0.36) / 0.30);
    }
  }
  if (!label) return null;
  const quality = Math.min(...fingers.map(f => f.quality), detailQuality);
  return {
    label,
    score: clamp(0.72 + 0.25 * quality),
    source: 'builtin',
    reason: 'Static hand shape matches a conservative built-in rule.',
  };
}

/** Returns a static-pose candidate or null when uncertain/unsupported. */
export function classifyHand(landmarks, customSamples = [], options = {}) {
  const g = handGeometry(landmarks);
  if (!g) return null;
  options = options ?? {};
  const threshold = Number.isFinite(options.threshold) ? clamp(options.threshold) : 0.78;
  const features = Array.isArray(customSamples) && customSamples.length
    ? extractFeatures(landmarks) : null;
  const customResult = features ? evaluateCustom(features, customSamples) : null;
  // Conflicting nearby user labels are a genuine ambiguity, not an invitation
  // to substitute an unrelated built-in label for the same observed pose.
  if (customResult?.ambiguous) return null;
  const custom = customResult?.candidate;
  if (custom && custom.score >= threshold) return custom;
  const builtin = classifyBuiltin(g);
  return builtin && builtin.score >= threshold ? builtin : null;
}

/**
 * Requires continuous observations before committing, and suppresses repeats.
 * `committed` is a candidate object on one update only, otherwise null.
 * A different committed pose or observed release allows a repeated label.
 */
export class TemporalStabilizer {
  constructor({ holdMs = 900, releaseMs = 400, maxGapMs = 250, minScore = 0.70 } = {}) {
    this.holdMs = Number.isFinite(holdMs) && holdMs > 0 ? holdMs : 900;
    this.releaseMs = Number.isFinite(releaseMs) && releaseMs >= 0 ? releaseMs : 400;
    this.maxGapMs = Number.isFinite(maxGapMs) && maxGapMs > 0 ? maxGapMs : 250;
    this.minScore = Number.isFinite(minScore) ? clamp(minScore) : 0.70;
    this.reset();
  }

  reset() {
    this.current = null;
    this.startedAt = null;
    this.lastAt = null;
    this.missingSince = null;
    this.latchedLabel = null;
  }

  update(candidate, now) {
    if (!Number.isFinite(now) || now < 0) {
      this.reset();
      return { candidate: null, progress: 0, committed: null };
    }
    if (this.lastAt !== null && (now < this.lastAt || now - this.lastAt > this.maxGapMs)) {
      // An unobserved interval cannot establish either a hold or a release.
      this.current = null;
      this.startedAt = null;
      this.missingSince = null;
    }
    this.lastAt = now;
    const valid = candidate && typeof candidate.label === 'string' && candidate.label.trim() &&
      Number.isFinite(candidate.score) && candidate.score >= this.minScore && candidate.score <= 1;
    if (!valid) {
      this.current = null;
      this.startedAt = null;
      if (this.missingSince === null) this.missingSince = now;
      if (now - this.missingSince >= this.releaseMs) this.latchedLabel = null;
      return { candidate: null, progress: 0, committed: null };
    }
    this.missingSince = null;
    if (!this.current || this.current.label !== candidate.label) {
      this.current = { ...candidate };
      this.startedAt = now;
    } else {
      this.current = { ...candidate };
    }
    if (candidate.label === this.latchedLabel) {
      return { candidate: this.current, progress: 1, committed: null };
    }
    const progress = clamp((now - this.startedAt) / this.holdMs);
    if (progress < 1) return { candidate: this.current, progress, committed: null };
    this.latchedLabel = candidate.label;
    return { candidate: this.current, progress: 1, committed: { ...this.current } };
  }
}
