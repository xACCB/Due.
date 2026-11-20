import { getApp } from "@react-native-firebase/app";
import { initializeAppCheck, ReactNativeFirebaseAppCheckProvider } from "@react-native-firebase/app-check";
import { connectAuthEmulator, deleteUser, getAuth, GoogleAuthProvider, onAuthStateChanged, reauthenticateWithCredential, signInWithCredential, signOut, type User } from "@react-native-firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "@react-native-firebase/firestore";
import { GoogleSignin, isErrorWithCode, isNoSavedCredentialFoundResponse, isSuccessResponse, statusCodes } from "@react-native-google-signin/google-signin";

// Firebase for the phone app (the web's apps/web/src/firebase.ts): the same
// project, configured from GoogleService-Info.plist (app.json, gitignored).
//
// App Check is enforced on Auth and Firestore, so it starts before anything
// else. In development it uses the debug provider: the token comes from
// EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN (apps/mobile/.env.local, never committed)
// and has to be registered in the Firebase console (App Check -> Apps ->
// DuePlanner iOS -> Manage debug tokens). A release build will use App Attest,
// which needs the paid Apple Developer Program (left until release, the
// user's choice); until then a release build can't reach Firebase at all.

// Emulator mode (development only): EXPO_PUBLIC_FIREBASE_EMULATORS=1 in
// apps/mobile/.env.local points Auth and Firestore at the emulators on this
// Mac (`npx firebase-tools emulators:start --only auth,firestore`), with
// throwaway data, the same as the web's VITE_FIREBASE_EMULATORS. Never in a
// release build. Sign-in then uses a pretend Google account, no Google sheet.
export const USING_EMULATORS = __DEV__ && process.env.EXPO_PUBLIC_FIREBASE_EMULATORS === "1";

let started: Promise<void> | null = null;

export function startFirebase(): Promise<void> {
  started ??= (async () => {
    const provider = new ReactNativeFirebaseAppCheckProvider();
    provider.configure({
      apple: { provider: __DEV__ ? "debug" : "appAttestWithDeviceCheckFallback", debugToken: __DEV__ ? process.env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN : undefined },
      android: { provider: __DEV__ ? "debug" : "playIntegrity", debugToken: __DEV__ ? process.env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN : undefined },
    });
    await initializeAppCheck(getApp(), { provider, isTokenAutoRefreshEnabled: true });
    if (USING_EMULATORS) {
      connectAuthEmulator(getAuth(), "http://localhost:9099");
      connectFirestoreEmulator(getFirestore(), "localhost", 8080);
    }
    // Client ids come from GoogleService-Info.plist (the sign-in package's Firebase setup).
    GoogleSignin.configure({});
  })();
  return started;
}

export type AuthUser = { uid: string; name: string | null; email: string | null; photo: string | null };
const toUser = (u: User | null): AuthUser | null =>
  u ? { uid: u.uid, name: u.displayName, email: u.email, photo: u.photoURL } : null;

// Calls `fn` with the signed-in user (or null) now and whenever it changes.
export function watchUser(fn: (u: AuthUser | null) => void): () => void {
  return onAuthStateChanged(getAuth(), u => fn(toUser(u)));
}

// Whether the last sign-in was one the person just made (not a session
// restored at launch). The first sync after it keeps tasks made while signed
// out, as on the web (mergeLocalOnSignIn there). Read once.
let explicit = false;
export function takeExplicitSignIn(): boolean {
  const e = explicit;
  explicit = false;
  return e;
}

// Google's own sign-in sheet, then Firebase with its token. Resolves to null
// when the person cancels; throws a message fit to show when it fails.
export async function signInWithGoogle(): Promise<AuthUser | null> {
  await startFirebase();
  explicit = true;
  if (USING_EMULATORS) {
    // The Auth emulator takes an unsigned Google token, so no Google sheet.
    const fake = JSON.stringify({ sub: "emulator-user", email: "emulator@dueplanner.test", email_verified: true, name: "Emulator user" });
    return toUser((await signInWithCredential(getAuth(), GoogleAuthProvider.credential(fake))).user);
  }
  try {
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) { explicit = false; return null; }
    if (!res.data.idToken) throw new Error("no id token");
    const cred = await signInWithCredential(getAuth(), GoogleAuthProvider.credential(res.data.idToken));
    return toUser(cred.user);
  } catch (e) {
    explicit = false;
    if (isErrorWithCode(e) && e.code === statusCodes.IN_PROGRESS) return null;
    throw new Error(signInMessage(e), { cause: e });
  }
}

// Deleting the account needs a recent sign-in (Firebase's rule), so before
// anything is deleted the person proves it's them again: silently when
// Google still has them signed in on this phone, else Google's sheet.
// Resolves false when they cancel. Throws a message fit to show.
export async function confirmIdentity(): Promise<boolean> {
  const user = getAuth().currentUser;
  if (!user) throw new Error("You're not signed in.");
  try {
    let idToken: string | null;
    if (USING_EMULATORS) {
      idToken = JSON.stringify({ sub: "emulator-user", email: "emulator@dueplanner.test", email_verified: true, name: "Emulator user" });
    } else {
      const quiet = await GoogleSignin.signInSilently();
      if (isNoSavedCredentialFoundResponse(quiet)) {
        const res = await GoogleSignin.signIn();
        if (!isSuccessResponse(res)) return false;
        idToken = res.data.idToken;
      } else idToken = quiet.data.idToken;
    }
    if (!idToken) throw new Error("no id token");
    await reauthenticateWithCredential(user, GoogleAuthProvider.credential(idToken));
    return true;
  } catch (e) {
    if (isErrorWithCode(e) && e.code === statusCodes.IN_PROGRESS) return false;
    if ((e as { code?: string })?.code === "auth/user-mismatch") throw new Error("That's a different Google account. Choose the one you're signed in with.", { cause: e });
    throw new Error(signInMessage(e), { cause: e });
  }
}

// The last step of deleting the account: the sign-in account itself, then
// Google's own sign-in on this phone.
export async function deleteSignInAccount(): Promise<void> {
  const user = getAuth().currentUser;
  if (!user) return;
  await deleteUser(user);
  await GoogleSignin.signOut().catch(() => {});
}

function signInMessage(e: unknown): string {
  const code = isErrorWithCode(e) ? e.code : "";
  if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return "Google Play services aren't available on this device.";
  if (/network/i.test(code) || /network/i.test(String(e))) return "Couldn't reach Google. Check your connection and try again.";
  if (/app-check|appCheck|attest/i.test(String(e))) return "This copy of the app couldn't be verified, so sign-in was refused.";
  return "Sign-in didn't work. Please try again.";
}

export async function signOutEverywhere(): Promise<void> {
  await GoogleSignin.signOut().catch(() => {});
  // Already signed out (a second tap): nothing to do.
  await signOut(getAuth()).catch(e => { if ((e as { code?: string })?.code !== "auth/no-current-user") throw e; });
}
