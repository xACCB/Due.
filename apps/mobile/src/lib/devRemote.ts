import { DevSettings } from "react-native";
import { router, type Href } from "expo-router";
import { devSampleTasks } from "./devSample";
import { writeJSON } from "./storage";

// Development only: lets a script on the Mac move the Simulator's app around,
// to check screens without tapping. Every second it reads
// http://localhost:8099/cmd.json, e.g. `{ "n": 3, "go": "/calendar" }`,
// `{ "n": 4, "seed": true }` or `{ "n": 5, "set": ["hw-group", "subject"] }`,
// and acts once per new `n`. Never started in a release build (app/_layout.tsx).
// `"set":["dev-open-section","Subjects"]` opens that Settings section after the
// reload (components/ui.tsx Section), so a screenshot can show it.
const URL = "http://localhost:8099/cmd.json";

type Cmd = { n?: number; go?: string; push?: string; back?: boolean; seed?: boolean; reset?: boolean; set?: [string, unknown]; reload?: boolean };

export function startDevRemote(): () => void {
  let last: number | null = null;
  const tick = async () => {
    try {
      const res = await fetch(URL, { cache: "no-store" });
      if (!res.ok) return;
      const cmd = (await res.json()) as Cmd;
      if (typeof cmd.n !== "number" || cmd.n === last) return;
      const first = last === null;
      last = cmd.n;
      if (first) return; // what was there before the app started isn't new
      if (cmd.seed) { writeJSON("hw-tasks", devSampleTasks(Date.now())); writeJSON("hw-trash", []); DevSettings.reload(); return; }
      if (cmd.reset) { writeJSON("hw-tasks", []); writeJSON("hw-trash", []); DevSettings.reload(); return; }
      if (cmd.set) { writeJSON(cmd.set[0], cmd.set[1]); DevSettings.reload(); return; }
      if (cmd.reload) { DevSettings.reload(); return; }
      if (cmd.back && router.canGoBack()) router.back();
      if (cmd.go) router.navigate(cmd.go as Href);
      if (cmd.push) router.push(cmd.push as Href);
    } catch { /* no script running: nothing to do */ }
  };
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}
