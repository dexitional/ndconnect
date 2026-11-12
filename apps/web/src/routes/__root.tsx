import {
  createRootRoute,
  HeadContent,
  Scripts,
  Outlet,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";
import css from "../styles.css?url";
import { logoUrl } from "../lib/brand";
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "NDC Connect · Every message brings us closer" },
      {
        name: "description",
        content:
          "Your workspace for SMS, voice campaigns, and community connections.",
      },
    ],
    links: [
      { rel: "stylesheet", href: css },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Manrope:wght@500;600;700&display=swap",
      },
      { rel: "icon", href: logoUrl },
    ],
  }),
  component: Root,
  notFoundComponent: () => (
    <div className="not-found">
      <h1>Page not found</h1>
      <a href="/">Back to your workspace</a>
    </div>
  ),
});
function Root() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15000, retry: 1, refetchOnWindowFocus: true },
        },
      }),
  );
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={client}>
          <Outlet />
          <Toaster richColors position="top-right" />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
