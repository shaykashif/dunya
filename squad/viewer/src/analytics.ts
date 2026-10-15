// A few anonymous counters, to learn where visitors leave and what holds them: time to first
// interaction, speed changes, barrages, how far into the battle they got. No personal data is
// collected. Nothing is sent unless a collector is configured: set `window.SIM_ANALYTICS` to an
// endpoint URL that accepts JSON POSTs (it is sent with sendBeacon), or load Plausible and its
// `plausible()` is used. Without either, events are only kept in a small ring in sessionStorage
// (`squad.events`) so they can be inspected from the console.

declare global {
  interface Window {
    SIM_ANALYTICS?: string;
    plausible?: (name: string, opts?: { props: Record<string, string | number | boolean> }) => void;
  }
}

const RING = "squad.events";
const t0 = performance.now();
let firstInteraction = false;
let sid = "";
try {
  sid = sessionStorage.getItem("squad.sid") ?? "";
  if (!sid) {
    sid = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem("squad.sid", sid);
  }
} catch {
  sid = Math.random().toString(36).slice(2, 10);
}

export function track(name: string, props: Record<string, string | number | boolean> = {}): void {
  const body = { name, sid, t: Math.round(performance.now() - t0), ...props };
  try {
    if (window.SIM_ANALYTICS) navigator.sendBeacon(window.SIM_ANALYTICS, JSON.stringify(body));
    else if (typeof window.plausible === "function") window.plausible(name, { props });
    const ring = JSON.parse(sessionStorage.getItem(RING) ?? "[]") as unknown[];
    ring.push(body);
    sessionStorage.setItem(RING, JSON.stringify(ring.slice(-60)));
  } catch {
    // Analytics must never get in the way.
  }
}

/** The first thing a visitor does that is not just watching. */
export function trackFirstInteraction(what: string): void {
  if (firstInteraction) return;
  firstInteraction = true;
  track("first_interaction", { what, ms: Math.round(performance.now() - t0) });
}

/** A heartbeat while the page is open, and a last word as it closes, so drop-off can be read by second. */
export function startHeartbeat(state: () => Record<string, string | number | boolean>): void {
  const beat = (name: string) => track(name, { ...state(), open_s: Math.round((performance.now() - t0) / 1000) });
  setInterval(() => {
    if (!document.hidden) beat("heartbeat");
  }, 15000);
  window.addEventListener("pagehide", () => beat("leave"));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) beat("hidden");
  });
}
