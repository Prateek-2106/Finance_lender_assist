import { useEffect, useState } from "react";

/** "#/estimates/abc" → ["estimates", "abc"] */
export function useHash(): [string[], (path: string) => void] {
  const read = () => location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return [parts, (path) => (location.hash = `#/${path}`)];
}
