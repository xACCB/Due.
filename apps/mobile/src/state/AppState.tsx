import type { ReactNode } from "react";
import { AppContext } from "./appContext";
import { useAppValue } from "./useAppValue";

export function AppProvider({ children }: { children: ReactNode }) {
  const value = useAppValue();
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
