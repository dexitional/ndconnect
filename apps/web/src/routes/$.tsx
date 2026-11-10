import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "../components/workspace";
import { Auth } from "../components/auth";
export const Route = createFileRoute("/$")({ component: Page });
function Page() {
  const path = Route.useParams()._splat || "";
  if (["login", "signup", "admin/login", "reset-password"].includes(path))
    return <Auth mode={path} />;
  return <Workspace page={path} />;
}
