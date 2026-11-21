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
//   signout "<device name>"    Profile -> Devices: sign that device out
//   devices                    print the device list as Profile shows it
//   addprofile "<name>"        Settings -> Profiles: add it (a ready-made chip, else by name)
//   delprofile "<name>"        Settings -> Profiles: delete it (both taps)
//   profile ["<name>"]         switch to that profile in the sidebar (none: All), then print what Home shows
import { browser, sleep, waitFor } from "../tests/e2e/browser.mjs";

const [step, title] = process.argv.slice(2);
const APP = "http://localhost:5173/";
const AUTH = `(async()=>{const u=performance.getEntriesByType("resource").map(e=>e.name).find(n=>/deps\\/firebase_auth\\.js/.test(n));return await import(u);})()`;
const b = await browser("web");
const tasks = () => b.ev(`JSON.parse(localStorage.getItem("hw-tasks")||"[]")`);
const click = (root, pattern) => b.ev(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(root + " button")})].find(x=>new RegExp(${JSON.stringify(pattern)}).test(x.textContent.trim())||new RegExp(${JSON.stringify(pattern)}).test(x.getAttribute("aria-label")||""));if(!el)return false;el.click();return true;})()`);
const show = ts => ts.map(t => `${t.done ? "[x]" : "[ ]"} ${t.title}${t.priorityOverride ? " !" + t.priorityOverride : ""}${t.dueDate ? " " + t.dueDate : ""}${t.archived ? " (archived)" : ""}${t.profile ? " @" + t.profile : ""}`).join("\n");
const openProfiles = async () => {
  await click("body", "^Settings$"); await sleep(700);
  if (!await b.ev(`!!document.querySelector('[aria-label="Add a profile with your own name"],[aria-label="Profile name"]')`)) { await click("main", "^Profiles"); await sleep(500); }
};
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
  } else if (step === "signout" || step === "devices") {
    await b.ev(`document.querySelector("[data-tour=profile-row]").click()`); await sleep(1200);
    if (step === "signout") console.log("clicked:", await click("body", `^Sign out ${title}$`));
    await sleep(1500);
    console.log(await b.ev(`document.querySelector("[data-tour=profile-devices]")?.innerText`));
  } else if (step === "addprofile") {
    await openProfiles();
    if (!await click("main", `^Add the ${title} profile$`)) {
      await click("main", "^Add a profile with your own name$"); await sleep(300);
      await b.ev(`(()=>{const i=document.querySelector('input[aria-label="Profile name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,${JSON.stringify(title)});i.dispatchEvent(new Event("input",{bubbles:true}));i.closest("form").requestSubmit();})()`);
    }
  } else if (step === "delprofile") {
    await openProfiles();
    console.log("delete:", await click("main", `^Delete ${title}$`)); await sleep(300);
    console.log("confirm:", await click("main", `^Confirm deleting ${title}$`));
  } else if (step === "profile") {
    console.log("switched:", await click("nav", title ? `^Show ${title}$` : "^Show all profiles$"));
    await sleep(800);
    console.log("Home shows:", await b.ev(`[...document.querySelectorAll("main .title-btn")].map(x=>x.textContent.trim()).join(", ")`));
  } else if (step === "done") {
    console.log("clicked:", await click("main", `^Mark ${title} done$`));
  } else if (step === "delete") {
    console.log("clicked:", await click("main", `^Delete ${title}$`));
  }
  await sleep(3000); // the 400ms debounce, then the write reaching the emulator
  console.log(show(await tasks()));
  console.log("settings:", await b.ev(`JSON.stringify(Object.fromEntries(["hw-weekstart","hw-timeformat","hw-layout","hw-subjects","hw-colorcode-urgency","hw-profiles","hw-profile"].map(k=>[k,localStorage.getItem(k)])))`));
} catch (e) { console.log("ERROR", e); } finally { b.close(); }
process.exit(0);
