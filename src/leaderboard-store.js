import { COLLECTION, compareScores } from './leaderboard-model.js';

export async function saveHighScore(db, sdk, user, candidate, stillSignedIn = () => true) {
  const reference = sdk.doc(db, COLLECTION, user.uid);
  for (let attempt = 0; ; attempt++) {
    try {
      return await sdk.runTransaction(db, async transaction => {
        const existing = await transaction.get(reference);
        if (!stillSignedIn()) throw new Error('Account changed');
        if (existing.exists() && compareScores(candidate, existing.data()) <= 0) return existing.data();
        const record = { ...candidate, displayName: user.name, updatedAt: sdk.serverTimestamp() };
        transaction.set(reference, record); return record;
      });
    } catch (error) {
      // A concurrent higher score can make the monotonic security rule reject
      // an older transaction before Firestore reports a transaction conflict.
      if (error.code !== 'permission-denied' || !stillSignedIn()) throw error;
      const latest = await sdk.getDocFromServer(reference);
      if (latest.exists() && compareScores(candidate, latest.data()) <= 0) return latest.data();
      if (attempt >= 2) throw error;
    }
  }
}
