import { describe, expect, it } from "vitest";
// Both files as text (Vite's ?raw import), so this runs in plain `npm test`.
import html from "../../index.html?raw";
import vercel from "../../vercel.json?raw";

// The Content Security Policy in vercel.json allows the inline scripts in
// index.html by the hash of their text, so changing one of those scripts
// without updating its hash would have the browser refuse to run it once the
// policy is enforced (the launch screen would stay up, the saved background
// wouldn't be painted, the fonts wouldn't switch on). This recomputes the
// hashes from index.html and checks each is in the policy; a failure prints
// the hash to put there.
type Header = { key: string; value: string };
const headers: Header[] = (JSON.parse(vercel) as { headers: { headers: Header[] }[] }).headers.flatMap(h => h.headers);
const policy = headers.find(h => h.key.startsWith("Content-Security-Policy"))?.value ?? "";
const directive = (name: string) => policy.split(";").map(d => d.trim()).find(d => d.startsWith(name + " ")) ?? "";

async function hashOf(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return "'sha256-" + btoa(String.fromCharCode(...bytes)) + "'";
}
// As the file is served: the build runs on Linux, where it has plain line
// breaks whatever this checkout has.
const served = html.replace(/\r\n/g, "\n");
const inlineScripts = [...served.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter(m => !/\ssrc=/.test(m[1] ?? "")).map(m => m[2]);
const handlers = [...served.matchAll(/\son[a-z]+="([^"]*)"/g)].map(m => m[1]);

describe("the Content Security Policy matches index.html", () => {
  it("there is a policy, and it doesn't allow inline scripts wholesale", () => {
    expect(policy).not.toBe("");
    expect(directive("script-src")).not.toContain("'unsafe-inline'");
    expect(directive("script-src")).not.toContain("'unsafe-eval'");
  });
  it("every inline script's hash is in script-src", async () => {
    expect(inlineScripts.length).toBeGreaterThan(0);
    for (const script of inlineScripts) {
      const hash = await hashOf(script);
      expect(directive("script-src"), `add ${hash} to script-src in vercel.json for the script starting "${script.trim().slice(0, 50)}"`).toContain(hash);
    }
  });
  it("every inline event handler's hash is there too, with 'unsafe-hashes'", async () => {
    for (const handler of handlers) {
      const hash = await hashOf(handler);
      expect(directive("script-src"), `add ${hash} to script-src in vercel.json for the handler "${handler}"`).toContain(hash);
    }
    if (handlers.length) expect(directive("script-src")).toContain("'unsafe-hashes'");
  });
  it("lists no hash that index.html no longer needs", async () => {
    const needed = new Set(await Promise.all([...inlineScripts, ...handlers].map(hashOf)));
    for (const listed of directive("script-src").match(/'sha256-[^']+'/g) ?? []) expect(needed.has(listed), `${listed} matches nothing in index.html`).toBe(true);
  });
});
