export const RULESET = 'duskride-v2';
export const COLLECTION = 'leaderboards/duskride-v2/players';
export const BOARD_LIMIT = 50;

export function compareScores(a, b) {
  if (!a) return b ? -1 : 0;
  if (!b) return 1;
  return a.score - b.score || a.distanceMeters - b.distanceMeters;
}
export function displayName(value) {
  return String(value || 'Rider').normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '').trim().slice(0, 40) || 'Rider';
}
export function validScore(score) {
  if (!score || score.ruleset !== RULESET || typeof score.runId !== 'string' || !/^[a-f0-9-]{36}$/.test(score.runId)) return false;
  if (typeof score.seed !== 'string' || !score.seed.length || score.seed.length > 32) return false;
  const limits = { score: [1, 100000000], distanceMeters: [0, 10000000], durationMs: [1000, 604800000], flips: [0, 1000000], perfectLandings: [0, 1000000], bestAirMs: [0, 60000] };
  for (const [field, [min, max]] of Object.entries(limits)) if (!Number.isSafeInteger(score[field]) || score[field] < min || score[field] > max) return false;
  return score.distanceMeters <= score.durationMs * .047 + 5 && score.score <= score.durationMs * .5;
}
function runID() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export class RankedRun {
  constructor(seed, startX = 80) { this.seed = seed; this.id = runID(); this.eligible = startX === 80; }
  capture(state, rewinding = false) {
    if (!this.eligible || rewinding || state.score <= 0) return null;
    const value = { ruleset: RULESET, runId: this.id, seed: this.seed, score: state.score, distanceMeters: Math.floor(Math.max(0, state.distance - 80) * .075), durationMs: Math.round(state.time * 1000), flips: state.flips, perfectLandings: state.landings, bestAirMs: Math.round(state.bestAir * 1000) };
    return validScore(value) ? value : null;
  }
}

export const PROFILES = 'duskrideProfiles';
export function validProfile(p) { return Boolean(p && typeof p.name === 'string' && p.name.trim().length >= 2 && p.name.length <= 40 && typeof p.department === 'string' && p.department.trim().length >= 2 && p.department.length <= 60 && Number.isInteger(p.year) && p.year >= 1 && p.year <= 6); }
