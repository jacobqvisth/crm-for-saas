"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { SESSION_EXPIRED_MESSAGE, signInHref } from "@/lib/auth/api-error";
import { consumeIntentionalSignOut } from "@/lib/auth/sign-out";

/**
 * Catches a session that dies while the app is open.
 *
 * The auth middleware only runs on navigation, so a tab left open past its
 * refresh-token lifetime stays on screen and every subsequent fetch fails.
 * That is how a page ended up showing a bare "Unauthorized" instead of the
 * login screen. Supabase fires SIGNED_OUT when a refresh fails, so here we say
 * what happened and move the user to sign-in with `?next=` pointing back at
 * the page they were on.
 *
 * Mounted once in the dashboard layout, so it covers every page rather than
 * only the ones that remembered to handle 401s.
 */
export function SessionWatcher() {
  const router = useRouter();
  const pathname = usePathname();

  // Held in a ref so navigating doesn't tear down and rebuild the subscription.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const supabase = createClient();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      // The sidebar's Sign out button already routes to /login itself.
      if (consumeIntentionalSignOut()) return;

      toast.error(SESSION_EXPIRED_MESSAGE, { id: "session-expired", duration: 8000 });
      router.replace(signInHref(pathnameRef.current));
    });

    return () => subscription.unsubscribe();
  }, [router]);

  return null;
}
