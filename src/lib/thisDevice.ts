import { newDeviceId } from "./devices";

// Captured at module load so the "Add to Home Screen" button can trigger the
// browser's own install prompt later (Chrome/Edge/Android fire this event;
// Safari never does, so it gets written instructions instead).
interface InstallPromptEvent extends Event { prompt:()=>Promise<void>; }
let deferredInstallPrompt:InstallPromptEvent|null=null;
if(typeof window!=="undefined"){
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e as InstallPromptEvent;});
}
// This browser's id in the account's device list (src/lib/devices.ts). Kept
// across sign-outs, so signing back in reuses the same row.
let fallbackDeviceId="";
export function thisDeviceId(){
  try{
    let id=localStorage.getItem("hw-device-id");
    if(!id||!/^[0-9a-f]{24}$/.test(id)){ id=newDeviceId(); localStorage.setItem("hw-device-id",id); }
    return id;
  }catch{ return fallbackDeviceId||(fallbackDeviceId=newDeviceId()); }
}
// Installing the app: the browser's own prompt where it offers one, otherwise
// instructions for this kind of device (handed to `setHint`).
export async function requestInstall(setHint:(hint:string|null)=>void){
  if(deferredInstallPrompt){ await deferredInstallPrompt.prompt(); deferredInstallPrompt=null; setHint(null); return; }
  setHint(/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1)
    ?"In Safari, tap the Share button, then \"Add to Home Screen\"."
    :"Open your browser's menu and choose \"Install app\" or \"Add to Home screen\".");
}
export function isStandalone(){
  return window.matchMedia?.("(display-mode: standalone)").matches||(navigator as unknown as {standalone?:boolean}).standalone===true;
}
