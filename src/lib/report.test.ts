import { describe, expect, it } from "vitest";
import { scrubEvent } from "./report";

describe("scrubEvent", () => {
  it("drops the user, extras and breadcrumbs", () => {
    const e = scrubEvent({ user: { email: "a@b.c" }, extra: { title: "Essay" }, breadcrumbs: [{ message: "x" }] });
    expect(e).toEqual({});
  });
  it("keeps only the page address (without query or hash) and the browser", () => {
    const e = scrubEvent({ request: {
      url: "https://dueplanner.vercel.app/?task=1#x", data: { title: "Essay" }, cookies: { a: "b" }, query_string: "task=1",
      headers: { "User-Agent": "Firefox", Referer: "https://example.com/?q=secret" },
    } });
    expect(e.request).toEqual({ url: "https://dueplanner.vercel.app/", headers: { "User-Agent": "Firefox" } });
  });
  it("leaves an event without a request alone", () => {
    expect(scrubEvent({})).toEqual({});
  });
});
