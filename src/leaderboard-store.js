import { COLLECTION, compareScores } from './leaderboard-model.js';

export async function saveHighScore(db, sdk, user, candidate, stillSignedIn = () => true) {
  const reference = sdk.doc(db, COLLECTION, user.uid);
  for (let attempt = 0; ; attempt++) {
    try {
      return await sdk.runTransaction(db, async transaction => {
        const existing = await transaction.get(reference);
        if (!stillSignedIn()) throw new Error('Account changed');
        if (existing.exists() && compareScores(candidate, existing.data()) <= 0) return existing.data();
        const record = { ...candidate, displayName: user.name, department: user.department, year: user.year, updatedAt: sdk.serverTimestamp() };
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

export async function getPlayerRank(db, sdk, uid, best) {
  const { collection, query, where, orderBy, documentId, getCountFromServer } = sdk;
  const base = collection(db, COLLECTION);
  const ordering = [orderBy('score', 'desc'), orderBy('distanceMeters', 'desc'), orderBy(documentId(), 'desc')];
  const ahead = [
    query(base, where('score', '>', best.score), ...ordering),
    query(base, where('score', '==', best.score), where('distanceMeters', '>', best.distanceMeters), ...ordering),
    query(base, where('score', '==', best.score), where('distanceMeters', '==', best.distanceMeters), where(documentId(), '>', uid), ...ordering),
  ];
  const counts = await Promise.all(ahead.map(q => getCountFromServer(q)));
  return 1 + counts.reduce((sum, result) => sum + result.data().count, 0);
}
