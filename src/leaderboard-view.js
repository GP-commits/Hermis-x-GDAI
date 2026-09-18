const $ = id => document.getElementById(id);
const number = value => Number(value || 0).toLocaleString();
export function bindLeaderboard(service, isEligible) {
  let formUID = null, lastLiveRows = '';
  const render = state => {
    $('crash-account-prompt').classList.toggle('hidden', Boolean(state.user && state.profile));
    $('crash-sign-in').textContent = state.user ? 'Complete player details' : 'Sign in to save your score';
    $('crash-account-note').textContent = state.user ? 'Add your name, department, and year to enter the leaderboard.' : 'Sign in to save this run and compete with your classmates.';
    $('live-board').querySelector('.eyebrow').textContent = state.connection === 'live' ? 'LIVE LEADERBOARD' : 'LEADERBOARD';
    const liveRows = JSON.stringify(state.rows.slice(0, 3).map(row => [row.displayName, row.score]));
    const liveKey = liveRows + state.connection;
    if (liveKey !== lastLiveRows) {
      lastLiveRows = liveKey; $('live-board-rows').replaceChildren();
      for (const [i, row] of state.rows.slice(0, 3).entries()) { const line = document.createElement('span'); line.className = 'live-board-row'; const name = document.createElement('span'); name.textContent = `${i + 1}. ${row.displayName}`; const score = document.createElement('b'); score.textContent = number(row.score); line.append(name, score); $('live-board-rows').append(line); }
      if (!state.rows.length) $('live-board-rows').textContent = state.connection === 'live' ? 'Set the first score ↗' : state.connection === 'connecting' || state.connection === 'idle' ? 'Connecting…' : 'Tap to view scores ↗';
    }
    const needsForm = state.needsProfile && !state.profileLoading;
    $('profile-form').classList.toggle('hidden', !needsForm);
    $('profile-loading').classList.toggle('hidden', !state.profileLoading);
    $('profile-retry').classList.toggle('hidden', !state.profileError || Boolean(state.profile));
    $('profile-error').textContent = state.profileError;
    $('profile-save').disabled = state.profileSaving || Boolean(state.profileError && !needsForm);
    $('profile-save').textContent = state.profileSaving ? 'Saving…' : 'Save player details';
    if (formUID !== state.user?.uid) { formUID = state.user?.uid; $('profile-form').reset(); $('player-name').value = state.user?.name || ''; }

    $('board-status').textContent = ({ live: '● LIVE', connecting: 'CONNECTING…', offline: 'OFFLINE · SAVED VIEW', error: 'UNAVAILABLE', unconfigured: 'COMING SOON', idle: 'CONNECTING…' })[state.connection];
    $('board-account').textContent = state.user ? `Riding as ${state.profile?.name || state.user.name}` : 'A little friendly competition.';
    $('google-sign-in').classList.toggle('hidden', Boolean(state.user));
    $('google-sign-in').disabled = !state.ready || state.sync === 'signing-in';
    $('google-sign-in').textContent = state.sync === 'signing-in' ? 'Opening Google…' : 'Sign in with Google';
    $('board-sign-out').classList.toggle('hidden', !state.user);
    $('board-privacy').classList.toggle('hidden', Boolean(state.user));
    const best = state.best;
    const rank = state.rows.findIndex(row => row.uid === state.user?.uid);
    $('board-best').textContent = state.user ? best ? `YOUR BEST  ${number(best.score)} pts · ${(best.distanceMeters / 1000).toFixed(2)} km${rank >= 0 ? ` · #${rank + 1}` : ''}` : 'Land a trick to set your first score.' : state.guestBest ? `ON THIS DEVICE  ${number(state.guestBest.score)} pts · Sign in to save it.` : 'Sign in to keep your best ride across devices.';
    $('board-sync').textContent = state.pending ? state.sync === 'saving' ? 'Saving your best ride…' : 'Score saved on this device · waiting to sync.' : state.sync === 'saved' ? 'Your best ride is saved.' : '';
    $('board-error').textContent = state.error || (!state.configured ? 'The shared leaderboard is not connected yet. You can still ride and keep your score on this device.' : '');
    $('board-practice').textContent = isEligible() ? 'Stage 1 starts count. Crashes end the run. Chapter-select rides are practice.' : 'This is a practice ride. Start fresh to join the leaderboard.';
    $('board-rows').replaceChildren();
    for (const [index, row] of state.rows.entries()) {
      const entry = document.createElement('li'); entry.className = 'board-row';
      entry.classList.toggle('is-you', row.uid === state.user?.uid);
      const position = document.createElement('span'); position.className = 'board-rank'; position.textContent = String(index + 1).padStart(2, '0');
      const rider = document.createElement('span'); rider.className = 'board-rider';
      const name = document.createElement('strong'); name.textContent = row.displayName + (row.uid === state.user?.uid ? ' · you' : '');
      const distance = document.createElement('small'); distance.textContent = `${row.department} · Year ${row.year} · ${(row.distanceMeters / 1000).toFixed(2)} km · ${number(row.flips)} flips`;
      rider.append(name, distance);
      const score = document.createElement('strong'); score.className = 'board-score'; score.textContent = number(row.score);
      entry.append(position, rider, score); $('board-rows').append(entry);
    }
    $('board-empty').textContent = state.rows.length ? '' : state.connection === 'live' ? 'The mountain is yours. Set the first score.' : state.connection === 'connecting' ? 'Finding riders…' : '';
    $('board-retry').classList.toggle('hidden', !state.configured || !['error', 'offline'].includes(state.connection));
  };
  service.addEventListener('change', event => render(event.detail));
  $('profile-form').addEventListener('submit', event => { event.preventDefault(); service.saveProfile({ name: $('player-name').value, department: $('player-department').value, year: $('player-year').value }); });
  $('profile-retry').addEventListener('click', () => service.loadProfile());
  $('google-sign-in').addEventListener('click', () => service.signIn());
  $('board-sign-out').addEventListener('click', () => service.signOut());
  $('board-retry').addEventListener('click', () => service.watch());
  render(service.snapshot());
  return () => render(service.snapshot());
}
