// End-to-end: two headless browsers as two devices on one account, against the
// local Auth and Firestore emulators and the app's dev server in emulator mode.
// Covers what unit tests can't: real sign-in, real sync between devices, an
// edit conflict, and the device list's "sign out" flows.
// Started by tests/e2e/run.mjs (`npm run test:e2e`), which sets APP_URL.
import { browser, sleep, waitFor } from "./browser.mjs";

const APP = process.env.APP_URL || "http://localhost:5199/";
const PROJECT = "ai-homework-planner-92260"; // the emulator's project id (.firebaserc)
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !extra ? "" : "  " + extra}`); if (!ok) failures++; };

// The app's own firebase/auth module instance (found from what the page
// loaded), so tests can sign in without the Google popup: the Auth emulator
// accepts a made-up Google credential.
const AUTH = `(async()=>{const u=performance.getEntriesByType("resource").map(e=>e.name).find(n=>/deps\\/firebase_auth\\.js/.test(n));return await import(u);})()`;
const device = async label => {
  const b = await browser(label);
  return {
    ...b,
    open: () => b.goto(APP),
    signIn: sub => b.ev(`(async()=>{const m=await ${AUTH};const c=await m.signInWithCredential(m.getAuth(),m.GoogleAuthProvider.credential(JSON.stringify({sub:"${sub}",email:"${sub}@example.com",email_verified:true,name:"Test ${sub}"})));return c.user.uid;})()`),
    uid: () => b.ev(`(async()=>{const m=await ${AUTH};await m.getAuth().authStateReady();return m.getAuth().currentUser?.uid||null;})()`),
    registered: () => b.ev(`localStorage.getItem("hw-device-registered")`),
    tasks: () => b.ev(`JSON.parse(localStorage.getItem("hw-tasks")||"[]")`),
    click: (root, pattern) => b.ev(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(root + " button")})].find(x=>new RegExp(${JSON.stringify(pattern)}).test(x.textContent.trim())||new RegExp(${JSON.stringify(pattern)}).test(x.getAttribute("aria-label")||""));if(!el)return false;el.click();return true;})()`),
    openProfile: async () => { await b.ev(`document.querySelector("[data-tour=profile-row]").click()`); await sleep(800); },
    openTask: async title => { const ok = await b.ev(`(()=>{const el=[...document.querySelectorAll("main .title-btn")].find(x=>x.textContent.trim()===${JSON.stringify(title)});if(!el)return false;el.click();return true;})()`); await sleep(900); return ok; },
    closeSheet: async () => { await b.ev(`document.querySelector("[role=dialog] button[aria-label=Close]")?.click()`); await sleep(600); },
  };
};
const deviceCount = async uid => {
  const r = await fetch(`http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}/meta/devices`, { headers: { Authorization: "Bearer owner" } });
  if (r.status === 404) return 0;
  return Object.keys((await r.json()).fields?.d?.mapValue?.fields || {}).length;
};
// A unique account per run, so a re-run against a still-running emulator starts clean.
const run = Date.now().toString(36);
const student = `student-${run}`, other = `other-${run}`;

const A = await device("A"), B = await device("B");
try {
  // ---- Sign-in and the device list ----
  await A.open();
  const uid = await A.signIn(student);
  check("A signs in", typeof uid === "string" && !uid.startsWith("EXC"), String(uid));
  check("A is in the device list", await waitFor(() => deviceCount(uid), n => n === 1) === 1);
  check("A marked itself registered only after the server accepted it", await waitFor(() => A.registered(), v => v === uid) === uid);
  await B.open();
  await B.signIn(student);
  check("B joins the list (2 devices)", await waitFor(() => deviceCount(uid), n => n === 2) === 2);
  await waitFor(() => B.registered(), v => v === uid);

  // ---- Tasks sync between the two devices ----
  const title = `Shared task ${run}`;
  await A.ev(`document.querySelector("[data-tour=add]").click()`); await sleep(500);
  await A.ev(`(()=>{const i=document.querySelector("main form input")||document.querySelector("main input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,${JSON.stringify(title)});i.dispatchEvent(new Event("input",{bubbles:true}));i.closest("form").requestSubmit();})()`);
  for (let i = 0; i < 5; i++) { await sleep(600); if (!await A.click("main", "^Skip")) break; }
  const onA = await waitFor(() => A.tasks(), ts => ts.some(t => t.title === title));
  check("A adds a task", onA.some(t => t.title === title));
  const onB = await waitFor(() => B.tasks(), ts => ts.some(t => t.title === title), 20000);
  check("the task reaches B", onB.some(t => t.title === title));

  // ---- An edit conflict: each device changes a different field of the same task at the same moment ----
  check("A opens the task", await A.openTask(title));
  check("B opens the task", await B.openTask(title));
  const [a, b] = await Promise.all([A.click("[role=dialog]", "^Tomorrow$"), B.click("[role=dialog]", "^High$")]);
  check("A snoozes it to tomorrow while B sets its priority to High", a && b);
  const both = t => t && t.priorityOverride === "high" && !!t.dueDate;
  const mine = async d => (await d.tasks()).find(t => t.title === title);
  const finalA = await waitFor(() => mine(A), both, 20000), finalB = await waitFor(() => mine(B), both, 20000);
  check("A ends up with both changes", both(finalA), JSON.stringify(finalA));
  check("B ends up with both changes", both(finalB), JSON.stringify(finalB));
  check("the two devices agree", finalA && finalB && finalA.dueDate === finalB.dueDate && finalA.priorityOverride === finalB.priorityOverride && finalA.title === finalB.title);
  await A.closeSheet(); await B.closeSheet();

  // ---- A delete on one device reaches the other ----
  await A.ev(`[...document.querySelectorAll("main [aria-label^='Delete ']")].find(x=>x.getAttribute("aria-label")===${JSON.stringify("Delete " + title)}).click()`);
  check("deleting on A removes it on B", !(await waitFor(() => B.tasks(), ts => !ts.some(t => t.title === title), 20000)).some(t => t.title === title));

  // ---- The device list: signing devices out ----
  await A.open();
  check("A stays signed in after a reload", await A.uid() === uid);
  check("a reload doesn't add a duplicate device", await deviceCount(uid) === 2);
  await A.openProfile();
  check("A sees a Sign out button for the other device", await A.ev(`[...document.querySelectorAll("button")].filter(x=>(x.getAttribute("aria-label")||"").startsWith("Sign out ")).length`) === 1);
  check("A signs B out", await A.click("body", "^Sign out ") === true);
  check("B's entry is gone", await waitFor(() => deviceCount(uid), n => n === 1) === 1);
  check("B signed itself out", await waitFor(() => B.uid(), v => v === null) === null);
  check("B is told why", await waitFor(() => B.ev(`document.body.innerText.includes("signed out from another device")`), v => v === true) === true);
  check("B cleared its registered note", await B.registered() === null);
  check("A is untouched", await A.uid() === uid && await A.registered() === uid);

  await B.signIn(student);
  check("B signs in again and re-registers", await waitFor(() => deviceCount(uid), n => n === 2) === 2 && await waitFor(() => B.registered(), v => v === uid) === uid);
  await B.goto("about:blank", 500); // B is closed
  await A.open(); await A.openProfile();
  check("A signs out all other devices", await A.click("body", "^Sign out all other devices$") === true);
  check("only A is left in the list", await waitFor(() => deviceCount(uid), n => n === 1) === 1);
  await B.open();
  check("B, reopened later, signs itself out", await waitFor(() => B.uid(), v => v === null) === null);
  check("B did not put itself back in the list", await deviceCount(uid) === 1);

  // A device that lost its note must re-add itself, never sign out.
  await A.ev(`localStorage.removeItem("hw-device-registered")`);
  await A.open();
  check("A without its note stays signed in", await A.uid() === uid);
  check("and re-registers", await waitFor(() => A.registered(), v => v === uid) === uid && await deviceCount(uid) === 1);

  // Another account is separate.
  await B.open();
  const uid2 = await B.signIn(other);
  check("a second account gets its own list", uid2 !== uid && await waitFor(() => deviceCount(uid2), n => n === 1) === 1 && await deviceCount(uid) === 1);
  check("A is unaffected by the other account", await A.uid() === uid);

  // A's own sign-out takes it off the list.
  await A.open(); await A.openProfile();
  check("A signs out", await A.click("body", "^Sign out$") === true);
  check("A signed out", await waitFor(() => A.uid(), v => v === null) === null);
  check("A removed its own entry", await waitFor(() => deviceCount(uid), n => n === 0) === 0);
  check("A is not shown the 'signed out from another device' message", await A.ev(`document.body.innerText.includes("signed out from another device")`) === false);
} catch (e) {
  console.log("FAIL  the run stopped on an error:", e);
  failures++;
} finally { A.close(); B.close(); }
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
