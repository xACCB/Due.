import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, GoogleAuthProvider } from "firebase/auth";
import { initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getPerformance } from "firebase/performance";
import { getAnalytics, isSupported as isAnalyticsSupported } from "firebase/analytics";
import { startFlags } from "./lib/flags";

const firebaseConfig = {
  apiKey: "AIzaSyD9W3eTvKjthiEZ_0MjeCHBIZ6BevMKgSo",
  // Deliberately this site's own domain, not Firebase's *.firebaseapp.com --
  // see vercel.json, which transparently proxies /__/auth/** on this domain
  // to Firebase's real handler. Sign-in then never crosses origins at all,
  // which is what actually eliminates (not just mitigates) the class of bug
  // where browsers with strict storage partitioning -- Firefox's Enhanced
  // Tracking Protection notably -- break signInWithRedirect when the auth
  // handler lives on a different origin than the app itself.
  authDomain: "dueplanner.vercel.app",
  projectId: "ai-homework-planner-92260",
  storageBucket: "ai-homework-planner-92260.firebasestorage.app",
  messagingSenderId: "445404835645",
  appId: "1:445404835645:web:c84c3f1bbb8cbfe171df54",
};
const fbApp = initializeApp(firebaseConfig);
export const auth = getAuth(fbApp);
// ignoreUndefinedProperties: a stray `undefined` field anywhere in a synced
// payload would otherwise make setDoc() throw synchronously (uncaught, since
// this fires from a plain useEffect with no error boundary), crashing the
// whole app to a blank screen instead of just dropping that one field.
//
// localCache/persistentLocalCache: enables an IndexedDB-backed local cache
// instead of the default in-memory-only one, so the app can actually read
// (and queue writes to sync later) while offline, and repeat loads serve from
// the local cache instead of a fresh network round trip every time.
// persistentMultipleTabManager lets multiple open tabs share that cache
// instead of only the first tab getting persistence and the rest silently
// falling back to memory-only. Wrapped in try/catch, with a plain in-memory
// fallback, because this runs at module load time (before React even
// renders) -- if an exotic environment (locked-down IndexedDB, very old
// browser) made this throw synchronously and uncaught, the whole app would
// fail to load at all rather than just missing offline support.
export let db: Firestore;
try {
  db = initializeFirestore(fbApp, {
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (e) {
  console.error("Firestore persistent cache unavailable, falling back to in-memory cache:", e);
  db = initializeFirestore(fbApp, { ignoreUndefinedProperties: true });
}
// Local development against the Firebase emulators (`npx firebase-tools
// emulators:start --only auth,firestore`), to try sync changes without touching
// real accounts or data. Only in `npm run dev` with VITE_FIREBASE_EMULATORS=1 --
// import.meta.env.DEV is false in every production build.
if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATORS === "1") {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
}
// Feature flags (src/lib/flags.ts): not in emulator mode, where the defaults stand.
else startFlags(fbApp);
export const googleProvider = new GoogleAuthProvider();
// App Check proves requests are coming from this real app (not a script
// hitting the project directly with the public firebaseConfig above) via a
// reCAPTCHA Enterprise attestation (classic reCAPTCHA v3 is deprecated in
// favor of this as of when this key was created). Fully inert -- and safe to
// leave committed -- until VITE_RECAPTCHA_SITE_KEY is actually set, since
// without a site key there's nothing to initialize. A site key isn't a
// secret (same category as firebaseConfig: meant to be public, verified
// server-side by Google), so this doesn't need to live outside version
// control. Generating tokens here does nothing on its own -- enforcement
// (Firestore actually rejecting requests without a valid token) is a
// separate switch in the Firebase Console, off by default, and should only
// be flipped on after confirming in the console's App Check metrics that
// real traffic is producing valid tokens -- otherwise it locks out every
// real user at once.
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
if (recaptchaSiteKey) {
  initializeAppCheck(fbApp, {
    provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}
// Automatically tracks real-world page load time and network request
// latency, visible in Firebase Console -> Performance. No setup/key needed
// (unlike App Check) and included on the free Spark plan. Wrapped in
// try/catch since it relies on browser Performance APIs that could be
// missing in an unsupported environment -- shouldn't be able to break the
// app over a monitoring feature.
try {
  getPerformance(fbApp);
} catch (e) {
  console.error("Firebase Performance Monitoring unavailable:", e);
}
// Basic usage analytics (page views, sessions, engagement time) -- free on
// the Spark plan, visible in Firebase Console -> Analytics. isSupported() is
// used (not just try/catch) because the underlying gtag.js script commonly
// gets blocked outright by ad/privacy blocker extensions (AdGuard, uBlock,
// etc.) rather than throwing -- isSupported() checks this explicitly instead
// of silently failing partway through initialization. If the project's never
// had Google Analytics linked at the Firebase-project level, this will just
// silently collect nothing rather than error.
isAnalyticsSupported().then(supported => {
  if (!supported) return;
  try {
    getAnalytics(fbApp);
  } catch (e) {
    console.error("Firebase Analytics unavailable:", e);
  }
}).catch(()=>{});
// Detects the signature of a browser blocking the storage handoff Firebase
// needs to complete signInWithRedirect across the round trip through its
// authDomain (a different origin from this site) -- notably Firefox's
// Enhanced Tracking Protection / Total Cookie Protection, on by default. This
// shows up two different ways depending on exactly when the browser blocks
// it: sometimes getRedirectResult() just resolves with no result and no
// error (handled separately, see the "no result" branch below), and
// sometimes it throws this specific error instead ("missing initial state" /
// web-storage-unsupported) -- both are the same underlying cause and deserve
// the same actionable message, not a generic "unknown error".
export function isStorageBlockedError(e: unknown): boolean {
  const code = (e as { code?: string })?.code || "";
  const message = ((e as { message?: string })?.message || "").toLowerCase();
  return code === "auth/web-storage-unsupported"
    || message.includes("missing initial state")
    || message.includes("sessionstorage");
}
export const STORAGE_BLOCKED_MESSAGE = "Sign-in was blocked by your browser's tracking protection. In Firefox: click the shield icon in the address bar and turn off Enhanced Tracking Protection for this site, then try again. Chrome and Edge don't hit this issue.";
