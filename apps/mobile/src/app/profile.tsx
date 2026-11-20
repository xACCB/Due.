import { useRef, useState, type ComponentRef } from "react";
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Circle, Path, Svg } from "react-native-svg";
import { formatAgo, formatDuration, ink } from "@dueplanner/core/lib/format";
import { completionStats, timeLeft } from "@dueplanner/core/lib/taskViews";
import { priColor } from "@dueplanner/core/constants";
import { todayISO } from "@dueplanner/core/lib/dates";
import { turnReminders } from "../lib/reminderSwitch";
import { LIMITS } from "@dueplanner/core/lib/limits";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";
import { signInWithGoogle } from "../lib/firebase";
import { syncStatusText } from "../lib/syncStatus";
import { useNow } from "../lib/useNow";
import { useDevAction, useDevScroll } from "../lib/devScroll";
import { IconPerson } from "../components/icons";

const PRIVACY_URL = "https://dueplanner.vercel.app/privacy.html";
const FEEDBACK_URL = "https://forms.gle/oPuAWx6jNHvm75xi8";

// Profile (the web's ProfileModal), over everything, opened from the
// sidebar's top row. Signed out: the web's sign-in screen, "Continue with
// Google". Signed in, as the web: picture, name, email and the sync status,
// then the completion ring, time and By subject cards, Devices, Storage, This
// device, and Sign out.
export default function Profile() {
  const { T, fz, user, authReady, sync, signOut, devices, signOutDevice, signOutOtherDevices, signInNote, clearSignInNote, tasks, trash, settings } = useApp();
  const now = useNow(30000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.navigate("/"));
  // The web's stats, from every task that isn't archived.
  const shown = tasks.filter(t => !t.archived);
  const stats = completionStats(shown);
  const leftMins = timeLeft(shown, todayISO()).totalMins;
  const doneMins = shown.filter(t => t.done).reduce((a, t) => a + (t.estMins || 0), 0);
  const bySubject = settings.subjects
    .map(name => ({ name, count: shown.filter(t => t.subject === name).length, color: settings.subjectColors[name] ?? T.textFaint }))
    .filter(x => x.count > 0).sort((a, b) => b.count - a.count);

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    clearSignInNote();
    try { await signInWithGoogle(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useDevScroll(scrollRef); // development only: the dev remote's "scroll"
  // Development only: the dev remote's stand-ins for the buttons ("sign-in", "sign-out", "others").
  useDevAction("profile", what => { if (what === "sign-in") void signIn(); else if (what === "others") signOutOtherDevices(); else void signOut(); });

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
            {!!(error || signInNote) && <Text style={[styles.note, { fontSize: fz(11), color: ink("#FF4757", T.light), marginBottom: 12 }]} accessibilityLiveRegion="polite">{error || signInNote}</Text>}
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
      <ScrollView ref={scrollRef} contentContainerStyle={styles.page}>
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
        {/* The web's stats, over every task but archived ones. */}
        <View style={[styles.card, styles.statsCard, { backgroundColor: T.card, borderColor: T.border, borderRadius: 16, padding: 20 }]}>
          <View style={{ width: 80, height: 80 }}>
            <Svg width={80} height={80} style={{ transform: [{ rotate: "-90deg" }] }}>
              <Circle cx={40} cy={40} r={33} fill="none" stroke={T.border} strokeWidth={7} />
              {stats.pct > 0 && <Circle cx={40} cy={40} r={33} fill="none" stroke={T.accent} strokeWidth={7} strokeDasharray="207" strokeDashoffset={207 * (1 - stats.pct / 100)} strokeLinecap="round" />}
            </Svg>
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <Text style={{ fontFamily: F.heading, fontSize: fz(18), color: T.text }}>{stats.pct}%</Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.heading, fontSize: fz(13), color: T.textMuted, marginBottom: 10 }}>Completion</Text>
            <View style={styles.statGrid}>
              {[{ l: "Total", v: stats.total, c: T.text }, { l: "Done", v: stats.done, c: "#2ED573" }, { l: "Pending", v: stats.total - stats.done, c: T.accent }, { l: "Urgent", v: stats.urgent, c: priColor("high", settings.colorCodeUrgency) }].map(x => (
                <View key={x.l} style={styles.statCell} accessible accessibilityLabel={`${x.l}: ${x.v}`}>
                  <Text style={{ fontFamily: F.heading, fontSize: 20, lineHeight: 24, color: x.c }}>{x.v}</Text>
                  <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textFaint }}>{x.l}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
        <View style={styles.timeRow}>
          {[{ v: formatDuration(leftMins) || "0m", l: "Estimated left" }, { v: formatDuration(doneMins) || "0m", l: "Completed work" }].map(x => (
            <View key={x.l} style={[styles.card, styles.timeCard, { backgroundColor: T.card, borderColor: T.border }]}>
              <Text style={{ fontFamily: F.heading, fontSize: 26, lineHeight: 32, color: T.accent }}>{x.v}</Text>
              <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textFaint, marginTop: 2 }}>{x.l}</Text>
            </View>
          ))}
        </View>
        {bySubject.length > 0 && (
          <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
            <Text style={[styles.cardLabel, { fontSize: fz(10), color: T.textMuted }]} accessibilityRole="header">By subject</Text>
            {bySubject.map(x => (
              <View key={x.name} style={{ marginBottom: 10 }}>
                <View style={styles.storageTop}>
                  <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.text }}>{x.name}</Text>
                  <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textFaint }}>{x.count} task{x.count !== 1 ? "s" : ""}</Text>
                </View>
                <View style={[styles.bar, { backgroundColor: T.border }]}>
                  <View style={[styles.barFill, { width: `${Math.round(x.count / stats.total * 100)}%`, backgroundColor: x.color }]} />
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Devices signed in to this account. Signing one out removes its entry;
            that device signs itself out when it next has the app open and
            online (lib/cloudSync.ts watchDevices), which the note says plainly. */}
        <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
          <Text style={[styles.cardLabel, { fontSize: fz(10), color: T.textMuted }]} accessibilityRole="header">Devices</Text>
          {!devices || devices.length === 0
            ? <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.textFaint }}>{devices ? "Getting this device ready…" : "The device list isn't available right now."}</Text>
            : <>
              {devices.map(d => (
                <View key={d.id} style={styles.deviceRow}>
                  <View style={{ flexShrink: 1 }}>
                    <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: fz(12), color: T.text }}>{d.entry.name}</Text>
                    <Text style={{ fontFamily: F.body, fontSize: fz(10), marginTop: 2, color: d.current ? ink("#2ED573", T.light) : T.textFaint }}>{d.current ? "This device" : `Active ${formatAgo(d.entry.lastSeen, now)}`}</Text>
                  </View>
                  {!d.current && (
                    <Pressable onPress={() => signOutDevice(d.id)} accessibilityRole="button" accessibilityLabel={`Sign out ${d.entry.name}`}
                      style={({ pressed }) => [styles.smallBtn, { borderColor: T.border, opacity: pressed ? 0.7 : 1 }]}>
                      <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.text }}>Sign out</Text>
                    </Pressable>
                  )}
                </View>
              ))}
              {devices.some(d => !d.current) && devices.some(d => d.current) && (
                <Pressable onPress={signOutOtherDevices} accessibilityRole="button"
                  style={({ pressed }) => [styles.othersBtn, { opacity: pressed ? 0.7 : 1 }]}>
                  <Text style={{ fontFamily: F.body, fontSize: fz(12), color: ink("#FF4757", T.light) }}>Sign out all other devices</Text>
                </Pressable>
              )}
              <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textFaint, lineHeight: 15 }}>A device signs out the next time it has DuePlanner open and online. If you think someone else can get into your Google account, change your Google password as well.</Text>
            </>}
        </View>

        {/* Storage: the tasks on this phone against the account's caps (LIMITS). */}
        <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
          <Text style={[styles.cardLabel, { fontSize: fz(10), color: T.textMuted }]} accessibilityRole="header">Storage</Text>
          {[{ label: "Tasks", used: tasks.length, max: LIMITS.tasks }, { label: "Recently deleted", used: trash.length, max: LIMITS.trash }].map(r => {
            const pct = Math.min(100, r.used / r.max * 100), nearlyFull = pct >= 90;
            return (
              <View key={r.label} style={{ marginBottom: 10 }}>
                <View style={styles.storageTop}>
                  <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.text }}>{r.label}</Text>
                  <Text style={{ fontFamily: F.body, fontSize: fz(11), color: nearlyFull ? ink("#FF4757", T.light) : T.textFaint }}>{r.used.toLocaleString("en-US")} of {r.max.toLocaleString("en-US")}</Text>
                </View>
                <View accessibilityRole="progressbar" accessibilityLabel={`${r.label} storage used`} accessibilityValue={{ min: 0, max: r.max, now: Math.min(r.used, r.max) }}
                  style={[styles.bar, { backgroundColor: T.border }]}>
                  <View style={[styles.barFill, { width: `${r.used > 0 ? Math.max(pct, 1.5) : 0}%`, backgroundColor: nearlyFull ? "#FF4757" : T.accent }]} />
                </View>
              </View>
            );
          })}
          <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textFaint, lineHeight: 15 }}>Finished and archived tasks count too. Deleting tasks frees up room.</Text>
        </View>

        {/* This device: the phone's own settings (reminders are per device),
            then the feedback form and the privacy policy. The web's "Install
            DuePlanner" row reads as installed here: this is the app. */}
        <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
          <Text style={[styles.cardLabel, { fontSize: fz(10), color: T.textMuted }]} accessibilityRole="header">This device</Text>
          <View style={styles.deviceLine}>
            <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.text }}>App</Text>
            <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textFaint }}>Installed on this device</Text>
          </View>
          <View style={[styles.deviceLine, { marginTop: 8 }]}>
            <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.text }}>Reminders</Text>
            <Pressable onPress={() => { turnReminders(!settings.notifications, settings.setNotifications).catch(() => {}); }}
              accessibilityRole="button" accessibilityState={{ selected: settings.notifications }}
              style={({ pressed }) => [styles.smallBtn, { borderColor: T.border, opacity: pressed ? 0.7 : 1 }]}>
              <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.text }}>{settings.notifications ? "On. Turn off" : "Turn on"}</Text>
            </Pressable>
          </View>
          <View style={[styles.rule, { backgroundColor: T.border + "33" }]} />
          <View style={styles.links}>
            <Text onPress={() => { Linking.openURL(FEEDBACK_URL).catch(() => {}); }} accessibilityRole="link" style={{ fontFamily: F.body, fontSize: fz(12), color: T.text, textDecorationLine: "underline" }}>Send feedback or report a bug</Text>
            <Text onPress={() => { Linking.openURL(PRIVACY_URL).catch(() => {}); }} accessibilityRole="link" style={{ fontFamily: F.body, fontSize: fz(12), color: T.textMuted, textDecorationLine: "underline" }}>Privacy policy</Text>
          </View>
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
  statsCard: { flexDirection: "row", alignItems: "center", gap: 20 },
  center: { alignItems: "center", justifyContent: "center" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 8 },
  statCell: { width: "50%" },
  timeRow: { flexDirection: "row", gap: 10 },
  timeCard: { flex: 1 },
  deviceLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 32 },
  rule: { height: 1, marginVertical: 12 },
  links: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  card: { borderRadius: 14, padding: 16, borderWidth: 1, marginBottom: 14 },
  cardLabel: { fontFamily: F.body, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },
  deviceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 },
  smallBtn: { borderWidth: 1, borderRadius: 9, paddingVertical: 6, paddingHorizontal: 12, flexShrink: 0 },
  othersBtn: { borderWidth: 1, borderColor: "#FF475744", borderRadius: 9, padding: 9, alignItems: "center", marginBottom: 10 },
  storageTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  bar: { height: 5, borderRadius: 999 },
  barFill: { height: "100%", borderRadius: 999 },
  signOut: { borderWidth: 1, borderColor: "#FF475744", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
});
