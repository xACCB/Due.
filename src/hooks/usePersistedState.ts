import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

// Replaces the "useState(() => localStorage...) + useEffect(() => localStorage.setItem(...))"
// pair that used to be hand-written per field. Reads are JSON-parsed so any
// serializable value works (arrays, objects, booleans, numbers); if parsing
// fails, the raw string is returned as-is instead of falling back to
// `initial` -- several fields predate this hook and stored plain unquoted
// strings (e.g. "list", not '"list"'), and this keeps those values intact on
// the first load after adopting the hook instead of silently resetting them.
export function usePersistedState<T>(key:string, initial:T):[T,Dispatch<SetStateAction<T>>] {
  const [state,setState]=useState<T>(()=>{
    const raw=localStorage.getItem(key);
    if(raw==null)return initial;
    try{return JSON.parse(raw) as T;}
    catch{return raw as unknown as T;}
  });
  useEffect(()=>{
    try{localStorage.setItem(key,JSON.stringify(state));}catch{/* storage unavailable or full */}
  },[key,state]);
  return [state,setState];
}
