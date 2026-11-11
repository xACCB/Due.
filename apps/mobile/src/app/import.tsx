import { useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { File, Paths } from "expo-file-system";
import { parseSyllabus } from "@dueplanner/core/lib/syllabus";
import { readBackup, tasksCsv, withImportedColors, withImportedSubjects, withImportedTemplates, withSyllabusTasks } from "@dueplanner/core/lib/backup";
import { contrastColor, formatDate, ink } from "@dueplanner/core/lib/format";
import { todayISO } from "@dueplanner/core/lib/dates";
import { SCHEMA_VERSION } from "@dueplanner/core/lib/migrations";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";
import { ScreenTitle } from "../components/ScreenTitle";
import { Dropdown } from "../components/Dropdown";

type Found = { title: string; dueDate: string; checked: boolean };

// Import/Export (the web's screen): scan pasted syllabus text for dated
// assignments, and back up or restore everything as a file. A backup merges:
// tasks already here are kept, subjects and templates added if missing,
// existing subject colours win, settings untouched.
export default function ImportExport() {
  const app = useApp();
  const { T, fz } = app;
  const s = app.settings;
  const [text, setText] = useState("");
  const [subject, setSubject] = useState<string | null>(null);
  const [preview, setPreview] = useState<Found[] | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const subjectEff = subject && s.subjects.includes(subject) ? subject : s.subjects[0] ?? "";
  const checked = preview?.filter(p => p.checked) ?? [];

  const scan = () => { setPreview(parseSyllabus(text).map(f => ({ ...f, checked: true }))); setAdded(null); };
  const commit = () => {
    if (!checked.length) return;
    const items = checked.map(({ title, dueDate }) => ({ title, dueDate }));
    app.importTasks(prev => withSyllabusTasks(prev, items, subjectEff));
    setAdded(items.length);
    setText("");
    setPreview(null);
  };

  // A file in the app's cache, handed to the share sheet (Save to Files, AirDrop, Mail...).
  const shareFile = async (name: string, contents: string) => {
    try {
      const file = new File(Paths.cache, name);
      await file.write(contents);
      await Share.share({ url: file.uri, title: name });
    } catch {
      setNote("Couldn't make the file. Try again.");
    }
  };
  const exportJSON = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      tasks: app.tasks, subjects: s.subjects, subjectColors: s.subjectColors, templates: s.templates,
      settings: {
        themeMode: s.themeMode, layout: s.layout, groupBy: s.groupBy, colorCodeUrgency: s.colorCodeUrgency, showDone: s.showDone,
        showSuggestion: s.showSuggestion, autoArchiveDays: s.autoArchiveDays, notificationsEnabled: s.notifications,
        enabledOffsets: s.reminderOffsets, timeFormat: s.timeFormat, weekStart: s.weekStart,
        pomodoroWorkMins: s.pomodoroWork, pomodoroBreakMins: s.pomodoroBreak, autoStartBreaks: s.pomodoroAutoBreak,
      },
    };
    shareFile(`dueplanner-export-${todayISO()}.json`, JSON.stringify(data, null, 2));
  };
  const exportCSV = () => shareFile(`dueplanner-tasks-${todayISO()}.csv`, tasksCsv(app.tasks));
  const importBackup = async () => {
    try {
      const picked = await File.pickFileAsync({ mimeTypes: ["application/json"] });
      if (picked.canceled) return;
      const read = readBackup(JSON.parse(await picked.result.text()), app.tasks, s.subjects);
      if (!read) { setNote("That file doesn't look like a DuePlanner export."); return; }
      const { fresh, skipped, extraSubjects, colors, templates } = read;
      if (fresh.length) app.importTasks(prev => [...prev, ...fresh]);
      if (extraSubjects?.length) s.setSubjects(prev => withImportedSubjects(prev, extraSubjects));
      if (colors) s.setSubjectColors(prev => withImportedColors(prev, colors));
      if (templates) s.setTemplates(prev => withImportedTemplates(prev, templates));
      setNote(`Imported ${fresh.length} task${fresh.length === 1 ? "" : "s"}${skipped ? ` (${skipped} already here)` : ""}.`);
    } catch {
      setNote("Couldn't read that file. Pick a .json file from \"Export all (JSON)\".");
    }
  };

  const plainBtn = (label: string, onPress: () => void) => (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.plainBtn, { backgroundColor: T.surface, borderColor: T.border, opacity: pressed ? 0.7 : 1 }]}>
      <Text style={[styles.plainText, { fontSize: fz(11), color: T.textMuted }]}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <ScreenTitle title="Import/Export" />

      <Dropdown title="Import from Syllabus">
        <TextInput
          value={text}
          onChangeText={v => { setText(v); setPreview(null); setAdded(null); }}
          placeholder="Paste your syllabus text here..."
          placeholderTextColor={T.textFaint}
          multiline
          accessibilityLabel="Syllabus text"
          style={[styles.area, { fontSize: fz(13), color: T.text, backgroundColor: T.surface, borderColor: T.border }]}
        />
        <Text style={[styles.kicker, { fontSize: fz(10), color: T.textFaint }]}>ADD AS SUBJECT</Text>
        <View style={styles.chips}>
          {s.subjects.map(name => {
            const on = subjectEff === name;
            const c = s.subjectColors[name] || T.accent;
            return (
              <Pressable key={name} onPress={() => setSubject(name)} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={[styles.chip, { backgroundColor: on ? c + "33" : "transparent", borderColor: on ? c : T.border }]}>
                <Text style={{ fontFamily: F.body, fontSize: fz(12), color: on ? ink(c, T.light) : T.textMuted }}>{name}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={scan} disabled={!text.trim()} accessibilityRole="button" accessibilityState={{ disabled: !text.trim() }}
          style={[styles.mainBtn, { backgroundColor: text.trim() ? T.accent : T.surface }]}>
          <Text style={[styles.mainText, { fontSize: fz(13), color: text.trim() ? contrastColor(T.accent) : T.textFaint }]}>Scan for assignments</Text>
        </Pressable>
        {added !== null && <Text style={[styles.added, { fontSize: fz(12), color: ink("#2ED573", T.light) }]}>✓ Added {added} task{added === 1 ? "" : "s"}</Text>}
        {preview && (
          <View style={styles.preview}>
            <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textMuted, marginBottom: 8 }}>Found {preview.length} assignment{preview.length === 1 ? "" : "s"}</Text>
            {preview.length === 0
              ? <Text style={[styles.none, { fontSize: fz(12), color: T.textFaint }]}>No dated lines found. Try a different format.</Text>
              : (
                <>
                  {preview.map((it, i) => (
                    <Pressable key={i} onPress={() => setPreview(p => p && p.map((x, j) => (j === i ? { ...x, checked: !x.checked } : x)))}
                      accessibilityRole="checkbox" accessibilityState={{ checked: it.checked }} accessibilityLabel={`${it.title}${it.dueDate ? `, ${formatDate(it.dueDate)}` : ""}`}
                      style={[styles.item, { backgroundColor: T.surface, opacity: it.checked ? 1 : 0.45 }]}>
                      <View style={[styles.box, { borderColor: it.checked ? T.accent : T.textFaint, backgroundColor: it.checked ? T.accent : "transparent" }]}>
                        {it.checked && <Text style={{ color: contrastColor(T.accent), fontSize: 11, fontWeight: "700" }}>✓</Text>}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: fz(12), color: T.text }}>{it.title}</Text>
                        {!!it.dueDate && <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textFaint, marginTop: 1 }}>{formatDate(it.dueDate)}</Text>}
                      </View>
                    </Pressable>
                  ))}
                  <Pressable onPress={commit} disabled={!checked.length} accessibilityRole="button" accessibilityState={{ disabled: !checked.length }} style={[styles.mainBtn, { backgroundColor: T.accent, opacity: checked.length ? 1 : 0.4, marginTop: 6 }]}>
                    <Text style={[styles.mainText, { fontSize: fz(13), color: contrastColor(T.accent) }]}>+ Add {checked.length} task{checked.length === 1 ? "" : "s"}</Text>
                  </Pressable>
                </>
              )}
          </View>
        )}
      </Dropdown>

      <Dropdown title="Backup & export">
        <View style={styles.btnRow}>
          {plainBtn("Import backup (JSON)", importBackup)}
          {plainBtn("Export all (JSON)", exportJSON)}
          {plainBtn("Export tasks (CSV)", exportCSV)}
        </View>
        {!!note && <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textMuted, marginTop: 8 }}>{note}</Text>}
      </Dropdown>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 48, gap: 8 },
  area: { minHeight: 100, maxHeight: 200, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, fontFamily: F.body, textAlignVertical: "top", marginBottom: 10 },
  kicker: { fontFamily: F.body, letterSpacing: 0.7, marginBottom: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 10 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  mainBtn: { borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  mainText: { fontFamily: F.bodyMedium },
  added: { fontFamily: F.body, textAlign: "center", marginTop: 10 },
  preview: { marginTop: 12 },
  none: { fontFamily: F.body, textAlign: "center", paddingVertical: 16 },
  item: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 11, marginBottom: 6 },
  box: { width: 18, height: 18, borderRadius: 5, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  btnRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  plainBtn: { flexGrow: 1, flexBasis: 100, borderWidth: 1, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 4, alignItems: "center" },
  plainText: { fontFamily: F.body, textAlign: "center" },
});
