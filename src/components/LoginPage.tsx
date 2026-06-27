"use client";

import { useState } from "react";
import { useLoginAction } from "@/lib/auth-context";
import { UserProfile } from "@/lib/types";
import { Loader2, X, Send, MessageSquare } from "lucide-react";

const PRODUCT_OPTIONS = [
  "Corrugation Box", "Wooden Crate / Pallet", "Foam Insert / Dunnage",
  "Custom Packaging", "Packing Accessories", "Other / Not Sure",
];

function EnquiryModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", company: "", phone: "", productInterest: "", message: "" });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch("/api/data/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, status: "New", createdAt: new Date().toISOString() }),
      });
      setDone(true);
    } catch {
      // silent fallback
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-white" />
            <h2 className="text-base font-bold text-white">Sample Request / Enquiry</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-4 py-12 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <Send className="h-7 w-7 text-emerald-600" />
            </div>
            <p className="text-lg font-bold text-slate-900">Request Sent!</p>
            <p className="text-sm text-slate-500">Our team will contact you within 24 hours.</p>
            <button onClick={onClose}
              className="mt-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors">
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Full Name *</label>
                <input required type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Jane Smith"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Email *</label>
                <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@company.com"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Company</label>
                <input type="text" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}
                  placeholder="ACME Corp."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Phone</label>
                <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Product Interest</label>
              <select value={form.productInterest} onChange={(e) => setForm({ ...form, productInterest: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
                <option value="">Select a product type…</option>
                {PRODUCT_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Message *</label>
              <textarea required rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Describe your requirement, quantity, timeline…"
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
            </div>
            <button type="submit" disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-200 disabled:opacity-60 transition-all hover:shadow-indigo-300">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitting ? "Sending…" : "Send Enquiry"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  const loginAction = useLoginAction();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showEnquiry, setShowEnquiry] = useState(false);

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
    <div className="flex min-h-screen">
      {showEnquiry && <EnquiryModal onClose={() => setShowEnquiry(false)} />}
      {/* ── Left hero panel (hidden on small screens) ── */}
      <div className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: "linear-gradient(145deg, #0f1117 0%, #1e1b4b 50%, #1e0f3c 100%)" }}>
        {/* Background grid pattern */}
        <div className="absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "32px 32px" }} />

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-12">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/40">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" />
              </svg>
            </div>
            <div>
              <p className="text-white font-bold text-lg leading-tight">RSPL Returnable Asset Tracking</p>
              <p className="text-indigo-300/60 text-xs">Engineering Your Vision</p>
            </div>
          </div>

          <h1 className="text-4xl font-bold text-white leading-tight mb-4">
            Returnable Asset<br />
            <span style={{ background: "linear-gradient(135deg, #818cf8 0%, #c084fc 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              Tracking System
            </span>
          </h1>
          <p className="text-slate-400 text-base leading-relaxed max-w-sm">
            End-to-end visibility for every asset — from dispatch to return, with real-time RFID &amp; BLE tracking.
          </p>

          {/* Feature list */}
          <div className="mt-10 space-y-4">
            {[
              { icon: "📦", title: "Live Asset Tracking", desc: "RFID & BLE real-time location" },
              { icon: "📊", title: "Smart Analytics", desc: "Forecasting, KPIs, reports" },
              { icon: "🔄", title: "Full Cycle Visibility", desc: "Dispatch to return tracking" },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-xl shrink-0">{icon}</div>
                <div>
                  <p className="text-white text-sm font-semibold">{title}</p>
                  <p className="text-slate-500 text-xs">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom badge */}
        <div className="relative z-10">
          <p className="text-slate-600 text-xs">© 2026 RSPL Returnable Asset Tracking · All rights reserved</p>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex flex-1 items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md">
          {/* Mobile logo (shown only on small screens) */}
          <div className="lg:hidden mb-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-200">
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-900">RSPL Returnable Asset Tracking</h1>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-slate-900">
                {mode === "login" ? "Welcome back" : "Create account"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {mode === "login" ? "Sign in to your workspace" : "Get started today"}
              </p>
            </div>

            {/* Demo credentials */}
            {mode === "login" && (
              <div className="mb-5 rounded-xl bg-slate-50 border border-slate-100 px-3 py-3 text-xs space-y-1.5">
                <p className="font-semibold text-slate-600 mb-2">Demo accounts</p>
                {[
                  { role: "Admin",    email: "admin@circulartrack.com",   pass: "admin123",    color: "text-red-600" },
                  { role: "Manager",  email: "manager@circulartrack.com", pass: "manager123",  color: "text-purple-600" },
                  { role: "Employee", email: "ops@circulartrack.com",     pass: "employee123", color: "text-blue-600" },
                  { role: "Customer", email: "customer@acme.com",         pass: "customer123", color: "text-emerald-600" },
                ].map(({ role, email, pass, color }) => (
                  <button key={role} type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white transition-colors text-left"
                    onClick={() => { setEmail(email); setPassword(pass); }}>
                    <span className={`w-16 font-semibold shrink-0 ${color}`}>{role}</span>
                    <span className="text-slate-500 truncate">{email} / {pass}</span>
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "register" && (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">Full Name</label>
                  <input type="text" required value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                    placeholder="Jane Smith" />
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Email address</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                  placeholder="you@company.com" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Password</label>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                  placeholder="••••••••" />
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 text-xs text-red-600">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition-all hover:shadow-indigo-300 hover:shadow-xl hover:scale-[1.01] disabled:opacity-60 disabled:scale-100 disabled:shadow-none">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === "login" ? "Sign In" : "Create Account"}
              </button>
            </form>

            <p className="mt-5 text-center text-xs text-slate-500">
              {mode === "login" ? "No account yet?" : "Already have an account?"}{" "}
              <button onClick={() => setMode(mode === "login" ? "register" : "login")}
                className="font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">
                {mode === "login" ? "Register" : "Sign in"}
              </button>
            </p>

            {/* Enquiry divider */}
            <div className="mt-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-100" />
              <span className="text-[11px] text-slate-400 font-medium">or</span>
              <div className="h-px flex-1 bg-slate-100" />
            </div>
            <button
              type="button"
              onClick={() => setShowEnquiry(true)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-indigo-200 px-4 py-2.5 text-sm font-semibold text-indigo-600 hover:border-indigo-400 hover:bg-indigo-50 transition-all"
            >
              <MessageSquare className="h-4 w-4" />
              Request Sample / Send Enquiry
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
