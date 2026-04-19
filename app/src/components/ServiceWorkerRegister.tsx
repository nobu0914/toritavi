"use client";

import { useEffect } from "react";

/*
 * SW registration + update policy.
 *
 * Goals:
 * - The service worker file itself must never be served from cache; otherwise
 *   an updated sw.js would never reach the client. updateViaCache: "none"
 *   enforces this at registration time (supported on all evergreen browsers).
 * - When a new SW activates (after skipWaiting + claim) we reload the page
 *   once so the user sees the fresh bundle instead of the already-rendered
 *   tree tied to the previous SW's responses.
 * - On tab focus we poll registration.update() so a user who left the tab
 *   open through a deploy picks up the new SW without needing a hard reload.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Dev mode: don't register. Next.js HMR plus our SW reload-on-activate
    // logic can fight each other, and a stale SW from a previous prod visit
    // to the same origin can intercept localhost dev responses. If a SW is
    // already registered from a previous session, unregister it so the dev
    // server stays on the happy path.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister());
      }).catch(() => undefined);
      return;
    }

    let reg: ServiceWorkerRegistration | null = null;
    let refreshing = false;

    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((r) => {
        reg = r;
        r.update().catch(() => undefined);
      })
      .catch(() => undefined);

    const onFocus = () => {
      reg?.update().catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return null;
}
