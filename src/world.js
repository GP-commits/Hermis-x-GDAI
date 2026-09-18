export const CHAPTER_LENGTH = 6600;
export const JOURNEY_LENGTH = CHAPTER_LENGTH * 8;
export const METERS_PER_UNIT = 0.075;
export const CHAPTERS = [
  { name: 'Golden Ridge', note: 'Every journey starts with a little gravity.', short: 'Follow the fading light', sky: ['#556c7c', '#b6a3a3', '#efb090', '#f8d2a0'], layers: ['#b49999', '#a38486', '#856e7a', '#655765', '#39444b'], sun: '#ffe3ab', trees: 0.12, fog: 0, rain: 0 },
  { name: 'Pine Valley', note: 'Let the mountain carry you.', short: 'Between the evergreens', sky: ['#435568', '#978898', '#d8a3a0', '#edb496'], layers: ['#a28b9d', '#87788d', '#68687e', '#475469', '#283e47'], sun: '#f8d7ba', trees: 1, fog: 0.06, rain: 0 },
  { name: 'Mist Forest', note: 'Breathe in. Find your rhythm.', short: 'A softer kind of silence', sky: ['#677981', '#8a9a9e', '#b5b9b0', '#ced0b9'], layers: ['#a5b5b2', '#8fa4a4', '#738f95', '#516f7a', '#2e4a56'], sun: '#e5dfc8', trees: 1.3, fog: 0.65, rain: 0 },
  { name: 'Broken Trail', note: 'Sometimes the way down is another way forward.', short: 'Take the path you find', sky: ['#424e68', '#6c708d', '#a38f9f', '#c8a6a4'], layers: ['#8c849d', '#736f8e', '#5a5c7a', '#3b465f', '#253747'], sun: '#e4ced0', trees: 0.35, fog: 0.12, rain: 0 },
  { name: 'Moonlit Cliffs', note: 'A little closer to the stars.', short: 'Leave the earth behind', sky: ['#17283f', '#293d59', '#56647b', '#9a949b'], layers: ['#606880', '#4c5875', '#3b4965', '#293b55', '#182d40'], sun: '#e6e8d5', trees: 0.18, fog: 0.05, rain: 0 },
  { name: 'The Rain', note: 'There is no hurry. Even here.', short: 'A rhythm of its own', sky: ['#1e303e', '#344957', '#5f7680', '#9bacac'], layers: ['#697e8b', '#566b7b', '#41576c', '#2c4358', '#192f3f'], sun: '#c5d5d2', trees: 0.8, fog: 0.4, rain: 1 },
  { name: 'Ancient Trail', note: 'Other journeys have passed this way.', short: 'Stories without words', sky: ['#242d45', '#44425d', '#807589', '#b9a09e'], layers: ['#877c97', '#6d6b88', '#555a79', '#39465f', '#243549'], sun: '#ece1c9', trees: 0.8, fog: 0.15, rain: 0 },
  { name: 'The Summit', note: 'Look how far you have come.', short: 'The light returns', sky: ['#687786', '#bba3a7', '#f1bca3', '#ffe0ac'], layers: ['#ba9caa', '#a28699', '#826e84', '#5c566b', '#36414e'], sun: '#fff0c7', trees: 0.16, fog: 0.1, rain: 0 },
];

export function hashSeed(seed) {
  let h = 2166136261;
  for (const char of String(seed)) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);
export const angleDiff = a => Math.atan2(Math.sin(a), Math.cos(a));

// Each chunk begins and ends on its baseline. Shared Hermite tangents join
// handcrafted contours without seams; the seed selects compatible contours.
const SHAPES = {
  descent: [[0, 0], [.22, 25], [.48, 100], [.73, 112], [1, 120]],
  roller: [[0, 0], [.22, 90], [.48, 115], [.72, 0], [1, 65]],
  jump: [[0, 0], [.27, 110], [.47, 75], [.60, -25], [.80, 135], [1, 155]],
  valley: [[0, 0], [.20, 80], [.43, 210], [.63, 180], [.84, 25], [1, 60]],
  pump: [[0, 0], [.16, 60], [.32, -10], [.50, 90], [.69, 15], [.86, 100], [1, 65]],
  cliff: [[0, 0], [.26, 110], [.44, 25], [.56, -20], [.81, 275], [1, 220]],
  climb: [[0, 0], [.24, 25], [.53, -45], [.76, -10], [1, -65]],
};
const SETS = [ ['descent', 'roller', 'jump'], ['roller', 'jump', 'valley'], ['pump', 'roller', 'pump'], ['jump', 'cliff', 'valley'], ['cliff', 'jump', 'valley'], ['roller', 'valley', 'pump'], ['descent', 'roller', 'jump'], ['climb', 'roller', 'climb'] ];

export class World {
  constructor(seed = 'DUSKRIDE') {
    this.seed = seed;
    this.rng = random(hashSeed(seed));
    this.nodes = [{ x: -2000, y: 400 }, { x: -300, y: 440 }, { x: 0, y: 445 }];
    this.chunks = [];
    this.gaps = [];
    this.structures = [];
    this.endX = 0;
    this.endY = 445;
    this.ensure(JOURNEY_LENGTH + 8000);
  }
  chapterAt(x) { return Math.floor(Math.max(0, x) / CHAPTER_LENGTH) % 8; }
  ensure(x) {
    if (this.endX >= x + 2500) return;
    while (this.endX < x + 2500) {
      const chapter = this.chapterAt(this.endX);
      const index = this.chunks.length;
      const type = index < 2 ? 'descent' : SETS[chapter][Math.floor(this.rng() * SETS[chapter].length)];
      const width = 930 + this.rng() * 290;
      const scale = chapter === 0 ? .72 : chapter === 4 ? 1.22 : 1;
      const shape = SHAPES[type];
      const x0 = this.endX, y0 = this.endY;
      for (const [u, v] of shape.slice(1)) this.nodes.push({ x: x0 + u * width, y: y0 + v * scale });
      this.chunks.push({ x: x0, width, type, chapter });
      if (chapter === 3 && (type === 'cliff' || type === 'jump')) {
        this.gaps.push({ start: x0 + width * .56, end: x0 + width * .97, depth: 95 });
      }
      if (chapter === 6) this.structures.push({ x: x0 + width * .35, type: ['cabin', 'bridge', 'tunnel', 'waterfall'][index % 4], width: 250 });
      this.endX += width;
      this.endY = this.nodes.at(-1).y;
    }
    for (let i = 0; i < this.nodes.length; i++) {
      const prev = this.nodes[Math.max(0, i - 1)], next = this.nodes[Math.min(i + 1, this.nodes.length - 1)];
      this.nodes[i].m = (next.y - prev.y) / Math.max(1, next.x - prev.x);
    }
  }
  segment(x) {
    let low = 0, high = this.nodes.length - 2;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.nodes[mid].x <= x) low = mid; else high = mid - 1;
    }
    return [this.nodes[low], this.nodes[low + 1]];
  }
  base(x) {
    const [a, b] = this.segment(x);
    const d = b.x - a.x, t = clamp((x - a.x) / d, 0, 1), t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a.y + (t3 - 2 * t2 + t) * d * a.m + (-2 * t3 + 3 * t2) * b.y + (t3 - t2) * d * b.m;
  }
  height(x) {
    const gap = this.gaps.find(g => x > g.start && x < g.end);
    if (!gap) return this.base(x);
    const t = (x - gap.start) / (gap.end - gap.start);
    // A real lower trail: entry drops away, then reconnects continuously.
    const dip = Math.sin(t * Math.PI) ** 2;
    return this.base(x) + gap.depth * dip;
  }
  slope(x) { return (this.height(x + 2) - this.height(x - 2)) / 4; }
  inTunnel(x) { return this.structures.some(s => s.type === 'tunnel' && x > s.x && x < s.x + s.width); }
  lowerTrail(x, y) { return this.gaps.some(g => x > g.start && x < g.end && y > this.base(x) + 32); }
}
