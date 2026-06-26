"use client";

import { useState } from "react";
import Image from "next/image";
import { useLoginAction } from "@/lib/auth-context";
import { UserProfile } from "@/lib/types";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const loginAction = useLoginAction();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint =
        mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        mode === "login"
          ? { email, password }
          : { email, password, displayName };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Authentication failed");
        return;
      }

      loginAction(data as UserProfile);
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-white shadow-lg shadow-slate-200 border border-slate-100 overflow-hidden">
            <Image src="/AKN.png" alt="AKN Design Tech" width={80} height={80} className="object-contain p-1" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            AKN Returnable Asset Tracking
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Returnable Asset Tracking & Management
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all duration-200">
          <h2 className="mb-6 text-lg font-semibold text-slate-800">
            {mode === "login" ? "Sign in to your account" : "Create account"}
          </h2>

          {/* Demo credentials hint */}
          {mode === "login" && (
            <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500 space-y-1">
              <p className="font-semibold text-slate-700 mb-1.5">Demo accounts:</p>
              {[
                { role: "Admin",    email: "admin@circulartrack.com",  pass: "admin123",    color: "text-red-600" },
                { role: "Manager",  email: "manager@circulartrack.com",pass: "manager123",  color: "text-purple-600" },
                { role: "Employee", email: "ops@circulartrack.com",    pass: "employee123", color: "text-blue-600" },
                { role: "Customer", email: "customer@acme.com",        pass: "customer123", color: "text-emerald-600" },
              ].map(({ role, email, pass, color }) => (
                <div key={role} className="flex items-center gap-2">
                  <span className={`font-semibold w-16 ${color}`}>{role}</span>
                  <button type="button" className="text-left hover:text-slate-800 transition-colors"
                    onClick={() => { setEmail(email); setPassword(pass); }}>
                    {email} / {pass}
                  </button>
                </div>
              ))}
              <p className="text-[10px] text-slate-400 pt-0.5">Click any row to auto-fill credentials</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-colors"
                  placeholder="Jane Smith"
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-indigo-700 hover:shadow-md hover:shadow-indigo-200 disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-slate-500">
            {mode === "login" ? "No account yet?" : "Already have an account?"}{" "}
            <button
              onClick={() => setMode(mode === "login" ? "register" : "login")}
              className="font-medium text-indigo-600 hover:text-indigo-800 underline transition-colors"
            >
              {mode === "login" ? "Register" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
