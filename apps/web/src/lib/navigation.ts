import { useCallback, useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

// The workspace used plain <a href> links, so every click reloaded the whole
// app: the scripts, the session check and every query started from scratch,
// which on a slow network looked like nothing was happening. Internal links
// now move within the app instead; the page swaps straight away and shows
// its skeleton while its data loads.

// Paths the server answers itself, which the app router can't render.
const SERVER_PATHS =
  /^\/(api\/|robots\.txt$|sitemap\.xml$|brand\/)|\.[a-z0-9]+$/i;

// The in-app path for an href, or null when the browser should handle it
// (another site, a download, a mail link, a server path).
export function appPath(href: string): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  if (SERVER_PATHS.test(url.pathname)) return null;
  return url.pathname + url.search + url.hash;
}

// A reload used to fetch everything fresh. To keep that, each in-app move
// marks the cache stale: the next page shows what's cached at once and
// refreshes it in the background (a campaign saved on one page appears on
// the next).
function useNavigateInApp() {
  const router = useRouter();
  const client = useQueryClient();
  return useCallback(
    (to: string) => {
      void client.invalidateQueries({ refetchType: "none" });
      void router.navigate({ href: to });
    },
    [router, client],
  );
}

export function useGoTo() {
  const navigate = useNavigateInApp();
  return useCallback(
    (href: string) => {
      const to = appPath(href);
      if (to) navigate(to);
      else window.location.assign(href);
    },
    [navigate],
  );
}

// Click handler for a container: ordinary left clicks on internal links
// navigate in-app; new-tab clicks, downloads and outside links are untouched.
export function useInAppLinks() {
  const navigate = useNavigateInApp();
  return useCallback(
    (e: React.MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const anchor = (e.target as Element).closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const to = appPath(anchor.href);
      if (!to) return;
      const here = window.location.pathname + window.location.search;
      // A link to a section of this same page: let the browser scroll.
      if (anchor.hash && to.startsWith(here + "#")) return;
      e.preventDefault();
      navigate(to);
    },
    [navigate],
  );
}

// Fetch the workspace page code once the browser is idle, so the first
// click doesn't wait for it on a slow network.
export function usePreloadWorkspace(paths: readonly string[]) {
  const router = useRouter();
  const key = paths.join("|");
  useEffect(() => {
    const preload = () => {
      for (const path of key.split("|")) {
        const preload =
          path === "/"
            ? router.preloadRoute({ to: "/" })
            : router.preloadRoute({
                to: "/$",
                params: { _splat: path.slice(1) },
              });
        preload.catch(() => {});
      }
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(preload, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(preload, 1500);
    return () => clearTimeout(id);
  }, [router, key]);
}
