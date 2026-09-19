import { saveHighScore, getPlayerRank } from './leaderboard-store.js';
import { firebaseConfig, emulatorConfig } from './firebase-config.js';
import { COLLECTION, BOARD_LIMIT, compareScores, displayName, validScore, validProfile, PROFILES, RULESET } from './leaderboard-model.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const write = (key, value) => { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch { /* Riding still works without persistent browser storage. */ } };
const outboxKey = uid => `duskride:${RULESET}:score-outbox:${uid}`;
const sameScore = (a, b) => a && b && a.runId === b.runId && compareScores(a, b) === 0;

export class LeaderboardService extends EventTarget {
  constructor() {
    super();
    this.configured = Boolean(firebaseConfig?.apiKey && firebaseConfig?.projectId && firebaseConfig?.authDomain && firebaseConfig?.appId);
    this.rank = null; this.rankLoading = false; this.rankRequest = 0; this.rankTimer = null;
    this.profile = null; this.profileLoading = false; this.profileError = ''; this.profileSaving = false;
    this.ready = false; this.user = null; this.rows = []; this.best = null; this.pending = null;
    this.guestBest = read(`duskride:${RULESET}:guest-score`);
    if (!validScore(this.guestBest)) this.guestBest = null;
    this.connection = this.configured ? 'idle' : 'unconfigured';
    this.sync = 'idle'; this.error = ''; this.wantWatch = false; this.claimGuest = false;
    this.timer = null; this.lastPersist = 0; this.lastAttempt = 0; this.inFlight = false;
    window.addEventListener('online', () => { if (this.pending && this.user) this.flush(); if (this.wantWatch) this.watch(); });
    window.addEventListener('offline', () => { this.connection = 'offline'; this.emit(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.persist(); else if (this.pending && this.user) this.flush(); });
  }
  snapshot() { return { rank: this.rank, rankLoading: this.rankLoading, profile: this.profile, needsProfile: Boolean(this.user && !this.profile), profileLoading: this.profileLoading, profileError: this.profileError, profileSaving: this.profileSaving, configured: this.configured, ready: this.ready, user: this.user, rows: this.rows, best: this.best, pending: this.pending, guestBest: this.guestBest, connection: this.connection, sync: this.sync, error: this.error }; }
  emit(extra = {}) { this.dispatchEvent(new CustomEvent('change', { detail: { ...this.snapshot(), ...extra } })); }
  async init() {
    if (!this.configured || this.ready) return this.ready;
    if (this.initializing) return this.initializing;
    this.connection = 'connecting'; this.error = ''; this.emit();
    this.initializing = (async () => {
      try {
        const [appSDK, authSDK, storeSDK] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
        this.authSDK = authSDK; this.storeSDK = storeSDK;
        const app = appSDK.getApps().find(app => app.name === 'duskride-leaderboard') || appSDK.initializeApp(firebaseConfig, 'duskride-leaderboard');
        this.auth = authSDK.getAuth(app); this.db = storeSDK.getFirestore(app);
        if (emulatorConfig && ['localhost', '127.0.0.1'].includes(location.hostname)) {
          authSDK.connectAuthEmulator(this.auth, `http://${emulatorConfig.host}:${emulatorConfig.authPort}`, { disableWarnings: true });
          storeSDK.connectFirestoreEmulator(this.db, emulatorConfig.host, emulatorConfig.firestorePort);
        }
        this.provider = new authSDK.GoogleAuthProvider(); this.provider.setCustomParameters({ prompt: 'select_account' });
        this.ready = true;
        await new Promise(resolve => {
          let first = true;
          authSDK.onAuthStateChanged(this.auth, account => {
            const previousUID = this.user?.uid || null;
            this.user = account ? { uid: account.uid, name: displayName(account.displayName) } : null;
            this.rank = null; this.rankRequest++; clearTimeout(this.rankTimer);
            this.profile = null; this.profileLoading = Boolean(account); this.profileError = '';
            this.best = null; this.pending = account ? read(outboxKey(account.uid)) : null;
            if (!validScore(this.pending)) this.pending = null;
            write('duskride:cloud-signed-in', Boolean(account));
            if (account && this.claimGuest && this.guestBest) {
              if (compareScores(this.guestBest, this.pending) > 0) this.pending = this.guestBest;
              this.guestBest = null; write(`duskride:${RULESET}:guest-score`, null); this.claimGuest = false; this.persist();
            }
            if (account) this.claimGuest = false;
            this.sync = this.pending ? 'pending' : 'idle';
            this.emit({ previousUID });
            if (this.wantWatch) this.startListeners();
            if (account) this.loadProfile();
            if (first) { first = false; resolve(); }
          }, () => { this.error = 'Could not restore your sign-in. Try signing in again.'; this.emit(); resolve(); });
        });
        return true;
      } catch {
        this.ready = false; this.connection = 'error'; this.error = 'Could not connect to the leaderboard. Check your connection and try again.'; this.emit();
        return false;
      } finally { this.initializing = null; }
    })();
    return this.initializing;
  }
  async watch() { if (this.unsubscribeRows && this.connection === 'live') return; this.wantWatch = true; if (await this.init()) { if (this.wantWatch) this.startListeners(); } else this.emit(); }
  stopWatching() { /* The on-screen leaderboard keeps its live subscription. */ }
  startListeners() {
    this.unsubscribeRows?.(); this.unsubscribeBest?.();
    const { collection, query, orderBy, limit, onSnapshot, doc } = this.storeSDK;
    this.connection = 'connecting'; this.emit();
    const board = query(collection(this.db, COLLECTION), orderBy('score', 'desc'), orderBy('distanceMeters', 'desc'), limit(BOARD_LIMIT));
    this.unsubscribeRows = onSnapshot(board, { includeMetadataChanges: true }, snapshot => {
      this.rows = snapshot.docs.map(row => ({ uid: row.id, ...row.data() }));
      this.connection = snapshot.metadata.fromCache ? navigator.onLine ? 'connecting' : 'offline' : 'live';
      this.error = ''; this.emit(); this.scheduleRank();
    }, () => { this.connection = 'error'; this.error = 'The leaderboard is unavailable right now. Your ride is still saved on this device.'; this.emit(); });
    if (this.user) this.unsubscribeBest = onSnapshot(doc(this.db, COLLECTION, this.user.uid), snapshot => {
      this.best = snapshot.exists() ? snapshot.data() : null; this.emit(); this.scheduleRank();
    }, () => { this.sync = this.pending ? 'pending' : 'error'; this.emit(); });
  }
  scheduleRank() {
    clearTimeout(this.rankTimer);
    const visibleRank = this.rows.findIndex(row => row.uid === this.user?.uid);
    if (visibleRank >= 0) { this.rankRequest++; this.rank = visibleRank + 1; this.rankLoading = false; this.emit(); return; }
    if (!this.user || !this.best) { this.rank = null; this.rankLoading = false; this.emit(); return; }
    this.rankLoading = true; this.emit();
    this.rankTimer = setTimeout(async () => {
      const request = ++this.rankRequest, uid = this.user.uid, best = this.best;
      try { const rank = await getPlayerRank(this.db, this.storeSDK, uid, best); if (request === this.rankRequest && uid === this.user?.uid) this.rank = rank; }
      catch { if (request === this.rankRequest) this.rank = null; }
      finally { if (request === this.rankRequest) { this.rankLoading = false; this.emit(); } }
    }, 1000);
  }
  async loadProfile() {
    if (!this.user) return;
    const uid = this.user.uid; this.profileLoading = true; this.profileError = ''; this.emit();
    try {
      const snapshot = await this.storeSDK.getDocFromServer(this.storeSDK.doc(this.db, PROFILES, uid));
      if (this.user?.uid !== uid) return;
      this.profile = snapshot.exists() && validProfile(snapshot.data()) ? snapshot.data() : null;
    } catch { if (this.user?.uid === uid) this.profileError = 'Could not load your details. Check your connection and retry.'; }
    finally { if (this.user?.uid === uid) { this.profileLoading = false; this.emit(); if (this.profile && this.pending) this.schedule(0); } }
  }
  async saveProfile(value) {
    if (!this.user || this.profileSaving || this.profileLoading) return;
    const profile = { name: displayName(value.name.trim()), department: value.department.trim().normalize('NFKC'), year: Number(value.year) };
    if (!value.name.trim() || !validProfile(profile)) { this.profileError = 'Enter your name, department, and year (1–6).'; this.emit(); return; }
    const uid = this.user.uid; this.profileSaving = true; this.profileError = ''; this.emit();
    try {
      const { doc, runTransaction, serverTimestamp } = this.storeSDK;
      const saved = await runTransaction(this.db, async tx => {
        const ref = doc(this.db, PROFILES, uid), existing = await tx.get(ref);
        if (existing.exists()) return existing.data();
        tx.set(ref, { ...profile, createdAt: serverTimestamp() }); return profile;
      });
      if (this.user?.uid === uid) { this.profile = saved; if (this.pending) this.schedule(0); }
    } catch { if (this.user?.uid === uid) this.profileError = 'Could not save your details. Please try again when connected.'; }
    finally { this.profileSaving = false; this.emit(); }
  }
  signIn() {
    if (!this.ready) return Promise.resolve();
    this.claimGuest = true; this.error = ''; this.sync = 'signing-in'; this.emit();
    // The popup opens directly in the click gesture, after SDK loading has finished.
    return this.authSDK.signInWithPopup(this.auth, this.provider).catch(error => {
      this.claimGuest = false; this.sync = 'idle';
      const messages = { 'auth/popup-blocked': 'Allow popups for this site, then try again.', 'auth/unauthorized-domain': 'Google sign-in is not enabled for this web address yet.', 'auth/operation-not-allowed': 'Google sign-in is not enabled yet.' };
      this.error = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error.code) ? '' : messages[error.code] || 'Google sign-in did not finish. Please try again.';
      this.emit();
    });
  }
  async signOut() {
    this.persist(); clearTimeout(this.timer); this.timer = null;
    try { await this.authSDK.signOut(this.auth); }
    catch { this.error = 'Could not sign out. Please try again.'; this.emit(); }
  }
  record(candidate, immediate = false) {
    if (!validScore(candidate)) return;
    if (!this.user) {
      if (compareScores(candidate, this.guestBest) > 0) {
        const changedScore = candidate.score !== this.guestBest?.score;
        this.guestBest = candidate;
        if (changedScore || immediate || Date.now() - this.lastPersist > 5000) { write(`duskride:${RULESET}:guest-score`, candidate); this.lastPersist = Date.now(); }
      }
      if (this.wantWatch) this.emit();
      return;
    }
    if (compareScores(candidate, this.best) <= 0 || compareScores(candidate, this.pending) <= 0) { if (immediate && this.pending) this.schedule(0); return; }
    const changedScore = candidate.score !== this.pending?.score;
    this.pending = candidate; this.sync = navigator.onLine ? 'pending' : 'offline';
    if (changedScore || immediate || Date.now() - this.lastPersist > 5000) this.persist();
    this.schedule(immediate ? 0 : Math.max(0, 15000 - (Date.now() - this.lastAttempt)));
    if (this.wantWatch) this.emit();
  }
  persist() {
    if (this.pending && this.user) write(outboxKey(this.user.uid), this.pending);
    if (!this.user && this.guestBest) write(`duskride:${RULESET}:guest-score`, this.guestBest);
    this.lastPersist = Date.now();
  }
  schedule(delay) { if (this.timer !== null && delay > 0) return; clearTimeout(this.timer); this.timer = setTimeout(() => { this.timer = null; this.flush(); }, delay); }
  async flush() {
    if (!this.ready || !this.user || !this.pending || !this.profile || this.inFlight) return;
    if (!navigator.onLine) { this.sync = 'offline'; this.persist(); this.emit(); return; }
    const user = { ...this.user, ...this.profile }, candidate = { ...this.pending };
    this.inFlight = true; this.lastAttempt = Date.now(); this.sync = 'saving'; this.persist(); this.emit();
    try {
      const saved = await saveHighScore(this.db, this.storeSDK, user, candidate, () => this.user?.uid === user.uid);
      const stored = read(outboxKey(user.uid));
      if (sameScore(stored, candidate) || compareScores(stored, saved) <= 0) write(outboxKey(user.uid), null);
      if (this.user?.uid === user.uid) {
        this.best = saved; this.scheduleRank();
        if (compareScores(this.pending, saved) <= 0) this.pending = null;
        this.sync = this.pending ? 'pending' : 'saved'; this.error = ''; this.emit();
      }
    } catch {
      if (this.user?.uid === user.uid) { this.sync = navigator.onLine ? 'error' : 'offline'; this.error = 'Your score is kept on this device. We will retry saving it.'; this.persist(); this.emit(); }
    } finally {
      this.inFlight = false;
      if (this.pending && this.user) this.schedule(this.sync === 'error' ? 30000 : 15000);
    }
  }
}
