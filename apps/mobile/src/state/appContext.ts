import { createContext, useContext } from "react";
import type { AppValue } from "./useAppValue";

export const AppContext = createContext<AppValue | null>(null);

// The app's shared state, from any screen under AppProvider.
export function useApp(): AppValue {
  const v = useContext(AppContext);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
