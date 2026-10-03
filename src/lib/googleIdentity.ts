// Google Identity Services (the "Sign in with Google" button Google renders
// itself). It hands back a Google ID token directly, so sign-in doesn't go
// through Firebase's popup, which opens blank, bounces to Google and back
// through /__/auth/handler, then closes. In browsers with FedCM (Chrome, Edge)
// the account chooser is a browser dialog, with no popup window at all;
// elsewhere Google opens its own account chooser popup.
//
// The script is only loaded when the sign-in screen is shown, and only when a
// client id is configured (VITE_GOOGLE_CLIENT_ID) -- without one the app keeps
// using the Firebase popup.

type GoogleId={
  initialize(options:{client_id:string; callback:(response:{credential?:string})=>void; use_fedcm_for_button?:boolean}):void;
  renderButton(parent:HTMLElement,options:Record<string,string|number>):void;
};

declare global {
  interface Window { google?:{accounts?:{id?:GoogleId}} }
}

// initialize() may only be called once per page, so the callback it's given
// forwards to whichever handler is current.
let handler:(idToken:string)=>void=()=>{};
let ready:Promise<GoogleId>|null=null;

export function onGoogleCredential(fn:(idToken:string)=>void){ handler=fn; }

// Resolves with the API once the script has loaded; rejects if it can't be
// loaded (offline, or blocked by a privacy extension), so the caller can fall
// back to the Firebase popup.
export function googleIdentity(clientId:string):Promise<GoogleId>{
  ready??=new Promise<GoogleId>((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="https://accounts.google.com/gsi/client";
    script.async=true;
    script.onload=()=>{
      const id=window.google?.accounts?.id;
      if(!id){ ready=null; reject(new Error("Google Identity Services unavailable")); return; }
      id.initialize({client_id:clientId,callback:r=>{ if(r.credential)handler(r.credential); },use_fedcm_for_button:true});
      resolve(id);
    };
    script.onerror=()=>{ ready=null; script.remove(); reject(new Error("Google Identity Services blocked")); };
    document.head.appendChild(script);
  });
  return ready;
}
