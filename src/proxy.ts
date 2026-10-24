import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "@/lib/supabase/env";

// Refreshes the Supabase session cookie on each request so Server
// Components always read a live session (Next.js 16 `proxy`).
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = supabaseEnv();
  if (!env) return response;

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });
  const { data } = await supabase.auth.getClaims();

  // Fast path for admin routes: a signed-out visitor gets a real redirect
  // to sign-in. The role check itself runs in requireRole on the page.
  const { pathname, search } = request.nextUrl;
  if (!data?.claims?.sub && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    const signin = new URL("/signin", request.url);
    signin.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(signin);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
