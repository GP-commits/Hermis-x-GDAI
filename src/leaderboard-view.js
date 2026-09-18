const $ = id => document.getElementById(id);
const number = value => Number(value || 0).toLocaleString();
export function bindLeaderboard(service, isEligible) {
  const render = state => {
    $('board-status').textContent = ({ live: '● LIVE', connecting: 'CONNECTING…', offline: 'OFFLINE · SAVED VIEW', error: 'UNAVAILABLE', unconfigured: 'COMING SOON', idle: 'CONNECTING…' })[state.connection];
    $('board-account').textContent = state.user ? `Riding as ${state.user.name}` : 'A little friendly competition.';
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
    $('board-practice').textContent = isEligible() ? 'Fresh starts count. Chapter-select rides are practice.' : 'This is a practice ride. Start fresh to join the leaderboard.';
    $('board-rows').replaceChildren();
    for (const [index, row] of state.rows.entries()) {
      const entry = document.createElement('li'); entry.className = 'board-row';
      entry.classList.toggle('is-you', row.uid === state.user?.uid);
      const position = document.createElement('span'); position.className = 'board-rank'; position.textContent = String(index + 1).padStart(2, '0');
      const rider = document.createElement('span'); rider.className = 'board-rider';
      const name = document.createElement('strong'); name.textContent = row.displayName + (row.uid === state.user?.uid ? ' · you' : '');
      const distance = document.createElement('small'); distance.textContent = `${(row.distanceMeters / 1000).toFixed(2)} km · ${number(row.flips)} flips`;
      rider.append(name, distance);
      const score = document.createElement('strong'); score.className = 'board-score'; score.textContent = number(row.score);
      entry.append(position, rider, score); $('board-rows').append(entry);
    }
    $('board-empty').textContent = state.rows.length ? '' : state.connection === 'live' ? 'The mountain is yours. Set the first score.' : state.connection === 'connecting' ? 'Finding riders…' : '';
    $('board-retry').classList.toggle('hidden', !state.configured || !['error', 'offline'].includes(state.connection));
  };
  service.addEventListener('change', event => render(event.detail));
  $('google-sign-in').addEventListener('click', () => service.signIn());
  $('board-sign-out').addEventListener('click', () => service.signOut());
  $('board-retry').addEventListener('click', () => service.watch());
  render(service.snapshot());
  return () => render(service.snapshot());
}
