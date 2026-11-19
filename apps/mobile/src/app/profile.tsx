import { useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Path, Svg } from "react-native-svg";
import { ink } from "@dueplanner/core/lib/format";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";
import { signInWithGoogle } from "../lib/firebase";
import { syncStatusText } from "../lib/syncStatus";
import { useNow } from "../lib/useNow";
import { useDevAction } from "../lib/devScroll";
import { IconPerson } from "../components/icons";

const PRIVACY_URL = "https://dueplanner.vercel.app/privacy.html";

// Profile (the web's ProfileModal), over everything, opened from the
// sidebar's top row. Signed out: the web's sign-in screen, "Continue with
// Google". Signed in: picture, name, email and Sign out. The web's stats,
// Devices and Storage cards come with sync.
export default function Profile() {
  const { T, fz, user, authReady, sync, signOut } = useApp();
  const now = useNow(30000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.navigate("/"));

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await signInWithGoogle(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  // Development only: the dev remote's stand-ins for the two buttons.
  useDevAction("profile", what => { if (what === "sign-in") void signIn(); else void signOut(); });

  const closeBtn = (
    <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
      <Text style={{ fontSize: 22, lineHeight: 24, color: T.textFaint }}>×</Text>
    </Pressable>
  );
  const header = (
    <View style={styles.header}>
      <Text style={[styles.h1, { color: T.accent }]} accessibilityRole="header">Profile</Text>
      {closeBtn}
    </View>
  );

  // Firebase hasn't said yet who's signed in: the Profile header, not a flash of the sign-in screen.
  if (!authReady) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: T.bg }]}>
        <View style={styles.page}>{header}<Text style={[styles.loading, { fontSize: fz(12), color: T.textFaint }]}>Loading your profile…</Text></View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: T.bg }]}>
        <View style={styles.closeCorner}>{closeBtn}</View>
        <View style={styles.signIn}>
          <View style={styles.logo}>
            <Text style={[styles.word, { color: T.accent }]}>Due<Text style={{ color: T.text }}>Planner</Text></Text>
            <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.textFaint, marginTop: 6 }}>due. studios · sync across devices</Text>
          </View>
          <View style={styles.box}>
            <Pressable onPress={signIn} disabled={busy} accessibilityRole="button" accessibilityState={{ busy }}
              style={({ pressed }) => [styles.google, { backgroundColor: T.card, borderColor: T.border, opacity: pressed || busy ? 0.7 : 1 }]}>
              {busy ? <ActivityIndicator color={T.textMuted} /> : <GoogleLogo />}
              <Text style={{ fontFamily: F.body, fontSize: fz(13), color: T.text }}>Continue with Google</Text>
            </Pressable>
            {!!error && <Text style={[styles.note, { fontSize: fz(11), color: ink("#FF4757", T.light), marginBottom: 12 }]} accessibilityLiveRegion="polite">{error}</Text>}
            <Text style={[styles.note, { fontSize: fz(11), color: T.textFaint }]}>
              Signing in syncs your homework across your devices. We never sell your data or use it for ads. See the{" "}
              <Text style={{ color: T.textMuted, textDecorationLine: "underline" }} onPress={() => Linking.openURL(PRIVACY_URL)} accessibilityRole="link">privacy policy</Text>
              {" "}for the services that help run the app.
            </Text>
          </View>
        </View>
        <View style={styles.foot} accessible={false}>
          <View style={[styles.footLine, { backgroundColor: T.border }]} />
          <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textFaint }}>due. studios</Text>
          <View style={[styles.footLine, { backgroundColor: T.border }]} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: T.bg }]}>
      <ScrollView contentContainerStyle={styles.page}>
        {header}
        <View style={styles.who}>
          {user.photo
            ? <Image source={{ uri: user.photo }} style={styles.avatar} accessibilityIgnoresInvertColors />
            : <View style={[styles.avatar, styles.noPhoto, { backgroundColor: T.surface, borderColor: T.border }]}><IconPerson color={T.textMuted} size={34} /></View>}
          <Text style={[styles.name, { color: T.text }]}>{user.name || "Your account"}</Text>
          {!!user.email && <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.textFaint, marginBottom: 8 }}>{user.email}</Text>}
          {/* The web's sync pill: green while syncing, red with the reason when not. */}
          <View style={[styles.pill, { backgroundColor: sync.error ? "#FF475722" : "#2ED57322", borderColor: sync.error ? "#FF475744" : "#2ED57344" }]}>
            <View style={[styles.pillDot, { backgroundColor: sync.error ? "#FF4757" : "#2ED573" }]} />
            <Text style={{ fontFamily: F.body, fontSize: fz(11), color: ink(sync.error ? "#FF4757" : "#2ED573", T.light) }}>{sync.error ? "Sync issue" : syncStatusText(sync, now)}</Text>
          </View>
          {!!sync.error && <Text style={[styles.note, { fontSize: fz(11), color: ink("#FF4757", T.light), marginTop: 8, maxWidth: 280 }]}>{sync.error}</Text>}
        </View>
        <Pressable onPress={async () => { await signOut().catch(() => {}); close(); }} accessibilityRole="button"
          style={({ pressed }) => [styles.signOut, { opacity: pressed ? 0.7 : 1 }]}>
          <Text style={{ fontFamily: F.body, fontSize: fz(13), color: ink("#FF4757", T.light) }}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// Google's "G", as the web draws it.
function GoogleLogo() {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18">
      <Path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
      <Path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <Path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <Path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 40 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  h1: { fontFamily: F.heading, fontSize: 22, lineHeight: 28 },
  loading: { fontFamily: F.body, textAlign: "center", marginTop: 48 },
  closeCorner: { position: "absolute", top: 70, right: 20, zIndex: 1 },
  signIn: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  logo: { marginBottom: 40, alignItems: "center" },
  word: { fontFamily: F.heading, fontSize: 42, lineHeight: 46 },
  box: { width: "100%", maxWidth: 340 },
  google: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, borderWidth: 1, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, marginBottom: 12 },
  note: { fontFamily: F.body, textAlign: "center", lineHeight: 18 },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 40 },
  footLine: { height: 1, width: 60 },
  who: { alignItems: "center", marginBottom: 32 },
  avatar: { width: 80, height: 80, borderRadius: 40, marginBottom: 14 },
  noPhoto: { borderWidth: 1, alignItems: "center", justifyContent: "center" },
  name: { fontFamily: F.heading, fontSize: 24, lineHeight: 30, marginBottom: 4 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  signOut: { borderWidth: 1, borderColor: "#FF475744", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
});
