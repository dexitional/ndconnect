import { useRouterState } from "@tanstack/react-router";

// Loading layouts shaped like the pages they stand in for, so a page keeps
// its structure while data arrives instead of a "Getting ready…" message.

function Bar({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`skeleton ${className}`} />;
}

function Rows({ count }: { count: number }) {
  return (
    <div className="divide-y divide-[#e7ece9]">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-[22px] py-4">
          <Bar className="size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-[2] space-y-2">
            <Bar className="h-3.5 w-2/3" />
            <Bar className="h-3 w-1/3" />
          </div>
          <Bar className="hidden h-3.5 flex-1 md:block" />
          <Bar className="hidden h-6 w-20 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

// Rows on their own, for a list inside a panel that is still loading.
export function RowsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Rows count={count} />
    </div>
  );
}

// A whole workspace page: heading, stat cards and a list panel.
export function PageSkeleton() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="mb-7 flex items-end justify-between gap-4">
        <div className="flex-1 space-y-3">
          <Bar className="h-3 w-24" />
          <Bar className="h-8 w-72 max-w-full" />
          <Bar className="h-3.5 w-96 max-w-full" />
        </div>
        <Bar className="hidden h-10 w-36 rounded-lg sm:block" />
      </div>
      <div className="stats-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="stat-card">
            <div className="flex items-center justify-between">
              <Bar className="h-3 w-24" />
              <Bar className="size-8 rounded-lg" />
            </div>
            <Bar className="mt-4 h-7 w-20" />
            <Bar className="mt-3 h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="panel">
        <div className="panel-heading">
          <div className="flex-1 space-y-2">
            <Bar className="h-4 w-40" />
            <Bar className="h-3 w-64 max-w-full" />
          </div>
          <Bar className="h-9 w-28 rounded-lg" />
        </div>
        <Rows count={5} />
      </div>
    </div>
  );
}

// The workspace frame while the signed-in user is being checked. It uses the
// real shell classes so it lines up with the page that replaces it.
export function WorkspaceSkeleton() {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-hidden>
        <div className="flex items-center gap-3">
          <Bar className="size-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Bar className="h-4 w-24" />
            <Bar className="h-2.5 w-32" />
          </div>
        </div>
        <Bar className="mt-7 h-14 w-full rounded-xl" />
        <Bar className="mt-7 mb-3 h-2.5 w-20" />
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-3">
            <Bar className="size-5 rounded" />
            <Bar className="h-3.5 w-28" />
          </div>
        ))}
      </aside>
      <div className="app-main">
        <header className="topbar" aria-hidden>
          <Bar className="h-3.5 w-48" />
          <div className="flex items-center gap-4">
            <Bar className="hidden h-8 w-40 rounded-lg md:block" />
            <Bar className="size-9 rounded-full" />
            <Bar className="size-9 rounded-full" />
          </div>
        </header>
        <main className="content">
          <PageSkeleton />
        </main>
      </div>
    </div>
  );
}

// A thin bar along the top of the window while the router is loading a page.
export function NavigationProgress() {
  const pending = useRouterState({ select: (s) => s.status === "pending" });
  if (!pending) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-[#006b43]/15"
    >
      <div className="nav-progress h-full w-1/3 bg-[#006b43]" />
    </div>
  );
}

// The router's pending view: the workspace frame for workspace pages. Public
// pages and sign-in forms show only the progress bar.
export function RoutePending() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (
    /^\/(login|signup|reset-password|admin\/login|voice-sms-campaigns)(\/|$)/.test(
      pathname,
    )
  )
    return null;
  return <WorkspaceSkeleton />;
}
