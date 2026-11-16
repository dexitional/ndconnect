import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RoutePending } from "./components/skeletons";
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    // Show the workspace skeleton the moment a page is opened, rather than
    // leaving the old page on screen while the next page's code loads.
    defaultPendingComponent: RoutePending,
    defaultPendingMs: 0,
    defaultPendingMinMs: 150,
  });
}
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
