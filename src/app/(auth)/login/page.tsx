import { getTenant } from "@/config/tenants";
import { LoginForm } from "./login-form";

/**
 * The sign-in page.
 *
 * A server component since phase 11, so it can read TENANT_SLUG and decide
 * which providers to offer. The buttons themselves need browser APIs and live
 * in ./login-form.tsx.
 *
 * `auth` comes from the compiled tenant config rather than the control plane on
 * purpose: a remotely toggleable sign-in flag could lock every user out of a
 * tenant, and the value has to agree with a Supabase dashboard setting that the
 * control plane cannot see. See TenantAuth in src/config/tenants/types.ts.
 */
export default function LoginPage() {
  const { auth } = getTenant();

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-600 rounded-xl mb-4">
              <span className="text-white font-bold text-xl">C</span>
            </div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Welcome back
            </h1>
            <p className="text-slate-500 mt-2">
              Sign in to your CRM workspace
            </p>
          </div>

          <LoginForm auth={auth} />

          <p className="text-xs text-slate-400 text-center mt-6">
            By signing in, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}
