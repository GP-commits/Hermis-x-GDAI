import { World, CHAPTERS, CHAPTER_LENGTH, JOURNEY_LENGTH, METERS_PER_UNIT, clamp, lerp } from './world.js';
import { BikePhysics, STEP } from './physics.js';
import { Scene } from './scene.js';
import { Soundscape } from './audio.js';

const $ = id => document.getElementById(id);
const show = id => { const el = $(id); if (el.classList.contains('hidden')) el.classList.remove('hidden'); };
const hide = id => { const el = $(id); if (!el.classList.contains('hidden')) el.classList.add('hidden'); };
const touch = matchMedia('(pointer: coarse)').matches;
const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(`duskride:${key}`)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`duskride:${key}`, JSON.stringify(value)); } catch { /* Private mode can disable storage. */ } },
};
function readSeed() { try { return decodeURIComponent(location.hash.slice(1)).trim().slice(0, 32) || 'DUSKRIDE'; } catch { return 'DUSKRIDE'; } }
let world = new World(readSeed());
let bike = new BikePhysics(world);
const scene = new Scene($('landscape'), world);
const audio = new Soundscape();
audio.enabled = storage.get('sound', true);
let mode = 'intro';
let previousMode = 'intro';
let lastFocus = null;
let overlay = null;
let currentChapter = 0;
let currentDay = 1;
let maxChapter = clamp(Number(storage.get('chapter', 0)) || 0, 0, 7);
let bestDistance = Number(storage.get('distance', 0)) || 0;
let lastSaved = 0;
let arrivalUntil = 0, trickUntil = 0, hintUntil = 0, toastTimer = null;
let summitTimer = 0, summitSeen = false;
let firstAir = false, crashShown = false, lowerTrailSeen = false;
let lastThunder = 0;
let lastUI = 0;
let previousPose = null;
let lastDistance = '', lastFlips = '', lastProgress = '';
let last = performance.now(), accumulator = 0;
const keys = new Set();
const touches = new Map();
const now = () => performance.now() / 1000;
const kms = x => (Math.max(0, x - 80) * METERS_PER_UNIT / 1000).toFixed(2);
const kmAt = x => (x * METERS_PER_UNIT / 1000).toFixed(1);

function input() {
  let left = keys.has('ArrowLeft') || keys.has('KeyA') || [...touches.values()].includes('left');
  let right = keys.has('ArrowRight') || keys.has('KeyD') || [...touches.values()].includes('right');
  const both = left && right;
  return { left: left && !both, right: right && !both, pump: both || keys.has('Space') || keys.has('ArrowDown') || keys.has('KeyS') };
}
function clearInput() { keys.clear(); touches.clear(); }
function syncSound() {
  $('sound-button').classList.toggle('sound-on', audio.enabled);
  $('sound-button').setAttribute('aria-label', audio.enabled ? 'Turn sound off' : 'Turn sound on');
  $('sound-button').setAttribute('aria-pressed', String(audio.enabled));
}
function toggleSound() { audio.setEnabled(!audio.enabled); storage.set('sound', audio.enabled); syncSound(); }
function notify(message) {
  $('toast').textContent = message; show('toast');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => hide('toast'), 2800);
}
function announceChapter(index, day2 = false) {
  const chapter = CHAPTERS[index];
  $('arrival-number').textContent = day2 ? `DAY ${currentDay}` : `CHAPTER ${String(index + 1).padStart(2, '0')}`;
  $('arrival-title').textContent = day2 ? 'A new horizon.' : chapter.name;
  $('arrival-note').textContent = day2 ? 'The sunrise is yours. Ride as far as you like.' : chapter.note;
  hide('chapter-arrival'); void $('chapter-arrival').offsetWidth; show('chapter-arrival'); arrivalUntil = now() + 5;
}
function updateChapter() {
  const chapter = CHAPTERS[currentChapter];
  $('chapter-index').textContent = String(currentChapter + 1).padStart(2, '0');
  $('chapter-name').textContent = chapter.name.toUpperCase();
  $('chapter-detail').textContent = chapter.short;
  $('top-caption').textContent = mode === 'intro' ? 'A DOWNHILL DAYDREAM' : `DAY ${currentDay}  /  ${chapter.name.toUpperCase()}`;
}
function hint(text, duration = 5) { $('ride-hint').textContent = text; show('ride-hint'); hintUntil = now() + duration; }
function showTrick(label, score = '') {
  $('trick-label').textContent = label;
  $('trick-score').textContent = score;
  const position = scene.screen(bike.state.x, bike.state.y);
  $('trick').style.left = `${clamp(position.x, 100, scene.w - 100)}px`;
  $('trick').style.top = `${position.y - 95}px`;
  hide('trick'); void $('trick').offsetWidth; show('trick'); trickUntil = now() + 2.2;
}
function openOverlay(id) {
  clearInput();
  if (!overlay) lastFocus = document.activeElement;
  if (overlay) hide(overlay);
  overlay = id; show(id);
  document.body.classList.remove('riding');
  requestAnimationFrame(() => $(id).querySelector('button:not(:disabled),input')?.focus({ preventScroll: true }));
}
function closeOverlay(restoreFocus = true) {
  if (overlay) hide(overlay);
  overlay = null;
  if (mode === 'riding') document.body.classList.add('riding');
  if (restoreFocus && lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
}
function startRide(x = null) {
  if (x !== null) bike.reset(x);
  previousPose = null;
  mode = 'riding'; crashShown = false; closeOverlay(false); clearInput();
  document.body.classList.add('riding');
  $('intro').classList.add('departing');
  setTimeout(() => hide('intro'), 800);
  show('ride-hud'); show('pause-button'); hide('crash-overlay'); hide('ride-hint');
  $('start-button').blur(); audio.start();
  currentChapter = world.chapterAt(bike.state.x); currentDay = bike.state.day; updateChapter();
  announceChapter(currentChapter);
  if (!firstAir) {
    if (touch) { show('touch-hints'); setTimeout(() => hide('touch-hints'), 6500); }
    else hint('HOLD → OR D TO PEDAL · LET GO TO COAST', 7);
  }
  last = performance.now(); accumulator = 0;
}
function updateStats() {
  $('stat-distance').textContent = kms(bike.state.distance);
  $('stat-air').textContent = `${bike.state.bestAir.toFixed(1)}s`;
  $('stat-flips').textContent = bike.state.flips;
  $('seed-input').value = world.seed;
  for (const button of document.querySelectorAll('[data-bike]')) {
    const required = button.dataset.bike === 'hardtail' ? 1000 : button.dataset.bike === 'tiny' ? 2000 : 0;
    const unlocked = bestDistance * METERS_PER_UNIT >= required;
    button.disabled = !unlocked;
    button.querySelector('small')?.classList.toggle('hidden', unlocked);
  }
}
function pause() {
  if (mode !== 'riding' && mode !== 'summit') return;
  mode = 'paused'; clearInput(); updateStats(); openOverlay('pause-overlay'); save();
}
function resume() {
  mode = 'riding'; closeOverlay(); clearInput(); last = performance.now(); accumulator = 0; previousPose = null; audio.start();
}
function rewind() {
  if (mode === 'intro') return;
  bike.rewind(); crashShown = false; previousPose = null;
  mode = 'riding'; closeOverlay(false); clearInput(); hide('trick'); hide('ride-hint');
  show('rewind-label'); audio.rewind(); last = performance.now(); accumulator = 0;
}
function restart(seed = world.seed, x = 80) {
  world = new World(seed); bike = new BikePhysics(world); scene.setWorld(world);
  scene.bikeStyle = selectedBike;
  currentChapter = world.chapterAt(x); currentDay = 1; firstAir = false; lowerTrailSeen = false; summitSeen = false;
  history.replaceState(null, '', `${location.pathname}${location.search}${seed === 'DUSKRIDE' ? '' : '#' + encodeURIComponent(seed)}`);
  startRide(x);
}
function save() { storage.set('chapter', maxChapter); storage.set('distance', bestDistance); }
function renderJourney() {
  $('chapter-list').replaceChildren();
  CHAPTERS.forEach((chapter, index) => {
    const button = document.createElement('button'); button.className = 'chapter-card';
    button.classList.toggle('current', index === currentChapter);
    button.disabled = index > maxChapter;
    button.setAttribute('aria-label', `${chapter.name}, ${index > maxChapter ? 'discover by riding' : 'ride this chapter'}`);
    // Chapter content is a fixed, local list, not user-provided markup.
    button.innerHTML = `<span class="number">${String(index + 1).padStart(2, '0')}</span><span><strong>${chapter.name}</strong><small>${index > maxChapter ? `Discover at ${kmAt(index * CHAPTER_LENGTH)} km` : chapter.short}</small></span><span class="chapter-dot"></span>`;
    button.addEventListener('click', () => { restart(world.seed, index * CHAPTER_LENGTH + 80); });
    $('chapter-list').append(button);
  });
}
function showJourney() {
  previousMode = mode;
  if (mode === 'riding' || mode === 'summit') { pause(); previousMode = 'paused'; }
  renderJourney(); openOverlay('journey-overlay');
}
function showControls() {
  previousMode = mode;
  if (mode === 'riding' || mode === 'summit') { pause(); previousMode = 'paused'; }
  openOverlay('controls-overlay');
}
function closeSubpanel() {
  if (previousMode === 'paused') { mode = 'paused'; updateStats(); openOverlay('pause-overlay'); }
  else { mode = previousMode; closeOverlay(); }
}
async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else notify('Your browser already uses the full available screen.');
  } catch { notify('Fullscreen is unavailable in this browser.'); }
}

$('start-button').addEventListener('click', () => startRide());
$('pause-button').addEventListener('click', pause);
$('resume-button').addEventListener('click', resume);
$('rewind-button').addEventListener('click', rewind);
$('restart-button').addEventListener('click', () => restart());
$('sound-button').addEventListener('click', toggleSound);
$('fullscreen-button').addEventListener('click', fullscreen);
$('home-link').addEventListener('click', event => { event.preventDefault(); if (mode === 'riding') pause(); else if (mode === 'intro') showJourney(); });
$('journey-button').addEventListener('click', showJourney);
$('pause-journey').addEventListener('click', showJourney);
$('controls-button').addEventListener('click', showControls);
$('pause-controls').addEventListener('click', showControls);
for (const id of ['close-controls', 'controls-done', 'close-journey']) $(id).addEventListener('click', closeSubpanel);
$('seed-button').addEventListener('click', () => { const seed = $('seed-input').value.trim().slice(0, 32) || 'DUSKRIDE'; restart(seed); });
$('seed-input').addEventListener('keydown', event => { if (event.key === 'Enter') { event.stopPropagation(); $('seed-button').click(); } });
$('share-button').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#${encodeURIComponent(world.seed)}`;
  try { await navigator.clipboard.writeText(url); notify('Trail link copied. Same seed, same mountain.'); }
  catch { $('seed-input').focus(); $('seed-input').select(); notify('Share this trail with #' + world.seed + ' at the end of the URL.'); }
});
let selectedBike = storage.get('bike', 'mountain');
if (!['mountain', 'hardtail', 'tiny'].includes(selectedBike) || (selectedBike === 'hardtail' && bestDistance * METERS_PER_UNIT < 1000) || (selectedBike === 'tiny' && bestDistance * METERS_PER_UNIT < 2000)) selectedBike = 'mountain';
function selectBike(style) {
  selectedBike = style; scene.bikeStyle = style; storage.set('bike', style);
  document.querySelectorAll('[data-bike]').forEach(button => { const selected = button.dataset.bike === style; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
}
document.querySelectorAll('[data-bike]').forEach(button => button.addEventListener('click', () => selectBike(button.dataset.bike)));
selectBike(selectedBike);

for (const side of ['left', 'right']) {
  const zone = $(`${side}-zone`);
  zone.addEventListener('pointerdown', event => {
    if (mode !== 'riding' || overlay) return;
    event.preventDefault(); zone.setPointerCapture(event.pointerId); touches.set(event.pointerId, side); hide('touch-hints');
  });
  const release = event => touches.delete(event.pointerId);
  zone.addEventListener('pointerup', release); zone.addEventListener('pointercancel', release); zone.addEventListener('lostpointercapture', release);
  zone.addEventListener('contextmenu', event => event.preventDefault());
}
window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement && !['Escape', 'Tab'].includes(event.code)) return;
  if (event.code === 'Tab' && overlay) {
    const focusables = [...$(overlay).querySelectorAll('button:not(:disabled),input')].filter(el => !el.closest('.hidden'));
    const first = focusables[0], final = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); final?.focus(); }
    else if (!event.shiftKey && document.activeElement === final) { event.preventDefault(); first?.focus(); }
    return;
  }
  if (event.code === 'Escape') {
    event.preventDefault();
    if (overlay === 'controls-overlay' || overlay === 'journey-overlay') closeSubpanel();
    else if (mode === 'paused') resume(); else pause();
    return;
  }
  if (event.repeat) return;
  if (event.code === 'KeyM') toggleSound();
  if (event.code === 'KeyF') fullscreen();
  if (event.code === 'KeyR' && mode !== 'intro') { event.preventDefault(); rewind(); }
  if (event.code === 'Enter' && mode === 'intro' && !overlay && document.activeElement.tagName !== 'BUTTON') { event.preventDefault(); startRide(); }
  if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'Space', 'KeyA', 'KeyD', 'KeyS'].includes(event.code) && mode === 'riding' && !overlay) { event.preventDefault(); keys.add(event.code); }
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { clearInput(); if (mode === 'riding' || mode === 'summit') pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); pause(); save(); } last = performance.now(); accumulator = 0; });
window.addEventListener('resize', () => scene.resize());
document.addEventListener('fullscreenchange', () => { $('fullscreen-button').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'); scene.resize(); });
window.addEventListener('hashchange', () => { if (readSeed() !== world.seed) { restart(readSeed()); } });
window.addEventListener('pagehide', save);

function handleEvents() {
  for (const event of bike.consumeEvents()) {
    if (event.type === 'takeoff' && !firstAir) { firstAir = true; hint(touch ? 'HOLD LEFT / RIGHT TO ROTATE · RELEASE TO LEVEL OUT' : 'HOLD ← / → TO ROTATE · RELEASE TO LEVEL OUT', 5); }
    if (event.type === 'landing') {
      audio.land(event.perfect); scene.burst(bike.state);
      if (event.flips) showTrick(event.direction, `+${event.flips * 250}${event.perfect ? '  ·  PERFECT +100' : ''}`);
      else if (event.perfect) showTrick('PERFECT', '+100');
      else if (event.air > 1.2) showTrick('LONG AIR', `${event.air.toFixed(1)}s  ·  +75`);
    }
    if (event.type === 'crash') { audio.crash(); clearInput(); hide('ride-hint'); hide('trick'); }
  }
}
function updateUI() {
  const s = bike.state;
  const distance = kms(s.distance), flips = s.flips > 0 ? `${s.flips} ↻` : '';
  const progress = `${clamp(s.x % JOURNEY_LENGTH / JOURNEY_LENGTH * 100, 0, 100).toFixed(1)}%`;
  if (distance !== lastDistance) { $('distance').innerHTML = `${distance} <small>km</small>`; lastDistance = distance; }
  if (flips !== lastFlips) { $('flow-count').textContent = flips; lastFlips = flips; }
  if (progress !== lastProgress) { $('trail-progress-fill').style.width = progress; lastProgress = progress; }
  bestDistance = Math.max(bestDistance, s.distance);
  const chapter = world.chapterAt(s.x);
  if (chapter !== currentChapter || currentDay !== s.day) {
    const newDay = currentDay !== s.day;
    currentChapter = chapter; currentDay = s.day;
    maxChapter = Math.max(maxChapter, chapter); save(); updateChapter(); announceChapter(chapter, newDay);
    if (chapter === 2) hint(touch ? 'HOLD BOTH SIDES DOWNHILL · RELEASE ON THE RISE' : 'HOLD SPACE DOWNHILL · RELEASE ON THE RISE', 8);
    if (chapter === 5) { audio.thunder(); lastThunder = s.time; }
  }
  if (chapter === 5 && s.time - lastThunder > 19) { audio.thunder(); if (!scene.reducedMotion) scene.flash = .12; lastThunder = s.time; }
  if (!lowerTrailSeen && world.lowerTrail(s.x, s.y)) { lowerTrailSeen = true; showTrick('ANOTHER WAY DOWN', 'LOWER TRAIL DISCOVERED'); }
  if (!summitSeen && s.x > JOURNEY_LENGTH - 100 && s.x < JOURNEY_LENGTH) {
    summitSeen = true; summitTimer = 3; mode = 'summit'; clearInput(); announceChapter(7); hide('ride-hint');
  }
  if (s.crashed && s.crashTime > .55 && !crashShown) {
    crashShown = true; mode = 'crashed'; openOverlay('crash-overlay'); save();
  }
  if (now() > lastSaved + 5) { save(); lastSaved = now(); }
}
function frame(timestamp) {
  const dt = Math.min((timestamp - last) / 1000, .1); last = timestamp;
  if (mode === 'riding' || mode === 'crashed') {
    if (mode === 'riding') {
      accumulator += dt;
      const controls = input();
      let iterations = 0;
      while (accumulator >= STEP && iterations++ < 12) {
        const { x, y, angle, vx, vy, omega } = bike.state;
        previousPose = { x, y, angle, vx, vy, omega };
        bike.update(controls); accumulator -= STEP;
      }
      handleEvents();
      if (!bike.rewinding) hide('rewind-label');
    }
  } else accumulator = 0;
  if (mode === 'summit') { summitTimer -= dt; if (summitTimer <= 0) { mode = 'riding'; bike.state.vx = Math.max(bike.state.vx, 135); } }
  const renderState = { ...bike.state, pedaling: mode === 'riding' && input().right };
  if (mode === 'riding' && previousPose && !bike.state.crashed) {
    const alpha = clamp(accumulator / STEP, 0, 1);
    for (const key of ['x', 'y', 'angle', 'vx', 'vy', 'omega']) renderState[key] = lerp(previousPose[key], bike.state[key], alpha);
  }
  scene.draw(renderState, dt, { intro: mode === 'intro', paused: !['riding', 'summit', 'crashed'].includes(mode), rewinding: bike.rewinding });
  if (timestamp - lastUI >= 100 && mode !== 'intro') { updateUI(); audio.update(bike.state, world, mode === 'riding'); lastUI = timestamp; }
  if (now() > arrivalUntil) hide('chapter-arrival');
  if (now() > trickUntil) hide('trick');
  if (now() > hintUntil) hide('ride-hint');
  requestAnimationFrame(frame);
}
syncSound(); updateChapter(); updateStats(); requestAnimationFrame(frame);

// A read-only diagnostic snapshot supports browser smoke tests without exposing
// commands that can mutate a live game or skip progression.
window.duskride = Object.freeze({ inspect: () => ({ mode, seed: world.seed, chapter: currentChapter, day: currentDay, state: bike.snapshot(), rewinding: bike.rewinding, input: input(), viewport: { width: scene.w, height: scene.h } }) });
