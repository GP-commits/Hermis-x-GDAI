# DUSKRIDE shared leaderboard

The game stays on GitHub Pages. Firebase Authentication supplies Google sign-in; Cloud Firestore stores one best run per Google user and streams the top 50. The static game works without either service. Production builds hide the leaderboard entry points while the Firebase config is unset; local development exposes the setup-pending screen. The Firebase SDK loads only when opening the board or restoring a previously signed-in session.

## Connect the backend

1. Authenticate locally with `npx firebase login` (or `npx firebase login --no-localhost` and follow its account-owner authorization instructions). Never commit login tokens or service-account keys.
2. Create a new Firebase project and register a web app named DUSKRIDE. Analytics is optional and unused. Create the default Firestore database in production mode; choose its permanent region before creating it.
3. In Authentication → Sign-in method, enable Google and choose the project's support email. Under Authentication → Settings → Authorized domains add `gp-commits.github.io`. Add `localhost` and `127.0.0.1` only if testing real Google login locally.
4. Copy the public web app configuration from Project settings → Your apps into `src/firebase-config.js`, replacing `null`. Leave `emulatorConfig = null`. This is public browser configuration, not a private credential.
5. Deploy this repository's rules and index to that project:

   ```sh
   npx firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID
   ```

6. Wait for the composite index to finish building, then run `npm run publish:pages`. Open the trophy button at https://gp-commits.github.io/Hermis-x-GDAI/ and verify Google login, a scored ride, reload, and another browser's live board.

The Google popup must be opened directly by the player's click. Do not switch to cross-domain redirect login on GitHub Pages without configuring Firebase's redirect storage requirements.

## Score behavior

Rank by trick points, then distance. A fresh start is eligible; chapter-select rides are practice. One run's score is a snapshot, never an increment on the stored total. Rewind therefore cannot add the same event twice. A better guest score can be claimed during explicit Google sign-in. Switching away from a signed-in account makes the current run practice so it cannot be submitted under another account.

The browser records scores locally, batches writes, and retries queued submissions after reconnecting. Per-user queues keep signed-out accounts separate. Transactions plus monotonic database rules keep a weaker device submission from replacing a stronger one. Only verified Google identities can write their own row. Public documents contain display name and run statistics, never email addresses or credentials.

These are casual client-reported scores. Validation restricts schema and plausible ranges but cannot prove an unmodified browser played the run. Prize competitions would need authoritative server simulation or replay verification. Firestore/Auth usage remains subject to the chosen project's quotas; no paid upgrade is configured by this code.

## Tests

```sh
npm test
npm run check
# Requires Java 21 or later and free localhost ports 8085 / 9099.
npm run test:firebase
```

For the browser integration test, run the game at `127.0.0.1:5173` and `npx firebase emulators:start --only auth,firestore --project demo-duskride`, then `node scripts/check-leaderboard.mjs`. The test intercepts the config module only within its isolated browser; production is never switched to an emulator via a URL parameter. Emulator test accounts and scores are synthetic and never uploaded to the live project.
