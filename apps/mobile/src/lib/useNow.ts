import { useEffect, useState } from "react";
import { clock } from "./clock";

// The current time, refreshed every `ms` (the web's `now` tick), for live
// labels such as "Due in 2h 5m".
export function useNow(ms = 30000): number {
  const [now, setNow] = useState(clock);
  useEffect(() => {
    const id = setInterval(() => setNow(clock()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
