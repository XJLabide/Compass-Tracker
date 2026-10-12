import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnvironment } from "./env";

export async function updateSession(request: NextRequest) {
  const { url, key } = getSupabasePublicEnvironment();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Verify claims and refresh expiring sessions before route rendering.
  const { data } = await supabase.auth.getClaims();
  const protectedPrefixes = [
    "/today",
    "/home",
    "/tasks",
    "/routines",
    "/history",
    "/settings",
    "/more",
    "/calendar",
    "/projects",
    "/goals",
    "/nutrition",
    "/finances",
    "/fitness",
    "/projects",
    "/goals",
    "/sync-lab",
  ];
  const isProtected = protectedPrefixes.some((path) =>
    request.nextUrl.pathname === path || request.nextUrl.pathname.startsWith(`${path}/`),
  );

  if (isProtected && typeof data?.claims?.sub !== "string") {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    const redirectResponse = NextResponse.redirect(signInUrl);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  return response;
}
