import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppWorkspace } from "@/app/app-workspace";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<main className="workspace-loading">Opening Compass…</main>}>
      <WorkspaceGate>{children}</WorkspaceGate>
    </Suspense>
  );
}

async function WorkspaceGate({ children }: { children: ReactNode }) {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const ownerId = data?.claims?.sub;
  if (typeof ownerId !== "string") redirect("/sign-in");

  return <AppWorkspace ownerId={ownerId}>{children}</AppWorkspace>;
}
