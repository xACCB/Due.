// Development only: one step as "the website", for checking the phone app's
// sync without opening a window. A fresh headless Chrome (no window) loads the
// web dev server in emulator mode (VITE_FIREBASE_EMULATORS=1 npx vite, port
// 5173), signs in as the phone's pretend emulator user (the same account),
// does the step, waits for the write, prints the tasks and synced settings,
// and exits. Each run is a new device. Usage: node scripts/web-device.mjs <step> ["<title>"]
// Steps:
//   list                       print the tasks the website has after syncing
//   add "<title>"              add a task through the add card
//   high "<title>"             open the task's sheet and set Priority to High
//   done "<title>"             tick the task done
//   delete "<title>"           delete it with its × button
//   settings ["Monday|24-hour"] Settings -> Date & time: press those two buttons
import { browser, sleep, waitFor } from "../tests/e2e/browser.mjs";

const [step, title] = process.argv.slice(2);
const APP = "http://localhost:5173/";
const AUTH = `(async()=>{const u=performance.getEntriesByType("resource").map(e=>e.name).find(n=>/deps\\/firebase_auth\\.js/.test(n));return await import(u);})()`;
const b = await browser("web");
const tasks = () => b.ev(`JSON.parse(localStorage.getItem("hw-tasks")||"[]")`);
const click = (root, pattern) => b.ev(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(root + " button")})].find(x=>new RegExp(${JSON.stringify(pattern)}).test(x.textContent.trim())||new RegExp(${JSON.stringify(pattern)}).test(x.getAttribute("aria-label")||""));if(!el)return false;el.click();return true;})()`);
const show = ts => ts.map(t => `${t.done ? "[x]" : "[ ]"} ${t.title}${t.priorityOverride ? " !" + t.priorityOverride : ""}${t.dueDate ? " " + t.dueDate : ""}${t.archived ? " (archived)" : ""}`).join("\n");
try {
  await b.goto(APP);
  const uid = await b.ev(`(async()=>{const m=await ${AUTH};const c=await m.signInWithCredential(m.getAuth(),m.GoogleAuthProvider.credential(JSON.stringify({sub:"emulator-user",email:"emulator@dueplanner.test",email_verified:true,name:"Emulator user"})));return c.user.uid;})()`);
  console.log("uid", uid);
  await waitFor(tasks, ts => ts.length > 0, 15000);
  await sleep(2500); // let both listeners settle
  if (step === "add") {
    await b.ev(`document.querySelector("[data-tour=add]").click()`); await sleep(500);
    await b.ev(`(()=>{const i=document.querySelector("main form input")||document.querySelector("main input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,${JSON.stringify(title)});i.dispatchEvent(new Event("input",{bubbles:true}));i.closest("form").requestSubmit();})()`);
    for (let i = 0; i < 5; i++) { await sleep(600); if (!await click("main", "^Skip")) break; }
  } else if (step === "high") {
    await b.ev(`[...document.querySelectorAll("main .title-btn")].find(x=>x.textContent.trim()===${JSON.stringify(title)}).click()`); await sleep(900);
    console.log("clicked High:", await click("[role=dialog]", "^High$"));
    await sleep(600); await b.ev(`document.querySelector("[role=dialog] button[aria-label=Close]")?.click()`);
  } else if (step === "settings") {
    // Settings -> Date & time -> Monday and 24-hour.
    console.log("Settings:", await click("body", "^Settings$"));
    await sleep(700);
    console.log("Date & time:", await click("main", "^Date & time"));
    await sleep(500);
    const [day, clock] = (title || "Monday|24-hour").split("|");
    console.log(day, await click("main", `^${day}$`), clock, await click("main", `^${clock}`));
  } else if (step === "done") {
    console.log("clicked:", await click("main", `^Mark ${title} done$`));
  } else if (step === "delete") {
    console.log("clicked:", await click("main", `^Delete ${title}$`));
  }
  await sleep(3000); // the 400ms debounce, then the write reaching the emulator
  console.log(show(await tasks()));
  console.log("settings:", await b.ev(`JSON.stringify(Object.fromEntries(["hw-weekstart","hw-timeformat","hw-layout","hw-subjects","hw-colorcode-urgency"].map(k=>[k,localStorage.getItem(k)])))`));
} catch (e) { console.log("ERROR", e); } finally { b.close(); }
process.exit(0);
