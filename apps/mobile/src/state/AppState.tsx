import { useState, type ReactNode } from "react";
import { AppContext } from "./appContext";
import { useAppValue } from "./useAppValue";

// `restart` remounts everything under it, so the app starts over from what's
// saved, as the web reloads the page after deleting the account.
export function AppProvider({ children }: { children: ReactNode }) {
  const [run, setRun] = useState(0);
  return <AppRun key={run} restart={() => setRun(n => n + 1)}>{children}</AppRun>;
}

function AppRun({ restart, children }: { restart: () => void; children: ReactNode }) {
  const value = useAppValue(restart);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
