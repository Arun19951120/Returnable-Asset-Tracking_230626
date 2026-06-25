"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAll, addDocument, updateDocument, deleteDocument, logAudit } from "@/lib/storage";
import { UserProfile, CustomRole, Location, Project, BUILT_IN_ROLES, ALL_TABS } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import {
  Users, ShieldCheck, FolderKanban, Plus, Trash2, Edit2, X, Loader2, Check,
  KeyRound, Eye, EyeOff, Lock, Search, RefreshCw, AlertTriangle, UserPlus,
} from "lucide-react";
import { toast } from "sonner";

const ROLE_COLORS: Record<string, string> = {
  Admin:    "bg-purple-100 text-purple-700 border-purple-200",
  Manager:  "bg-blue-100 text-blue-700 border-blue-200",
  Employee: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Customer: "bg-orange-100 text-orange-700 border-orange-200",
};
function RoleBadge({ role }: { role: string }) {
  const cls = ROLE_COLORS[role] ?? "bg-slate-100 text-slate-600 border-slate-200";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{role}</span>;
}

// ─── User Profiles ────────────────────────────────────────────────────────────
const NEW_USER_EMPTY = { displayName: "", email: "", password: "", role: "Employee", organization: "" };

function UserProfilesTab() {
  const { profile: cp, refreshRoles } = useAuth();
  const [users,     setUsers]     = useState<UserProfile[]>([]);
  const [roles,     setRoles]     = useState<CustomRole[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [projects,  setProjects]  = useState<Project[]>([]);
  const [search,   setSearch]   = useState("");
  const [editing,  setEditing]  = useState<UserProfile | null>(null);
  const [form,     setForm]     = useState<Partial<UserProfile>>({});
  const [saving,   setSaving]   = useState(false);

  // Add new user
  const [showAdd,   setShowAdd]   = useState(false);
  const [newUser,   setNewUser]   = useState({ ...NEW_USER_EMPTY });
  const [addSaving, setAddSaving] = useState(false);
  const [addErrors, setAddErrors] = useState<string[]>([]);
  const [showPass,  setShowPass]  = useState(false);

  const load = useCallback(async () => {
    const [u, r, l, p] = await Promise.all([
      fetchAll<UserProfile>("users"),
      fetchAll<CustomRole>("custom_roles"),
      fetchAll<Location>("locations"),
      fetchAll<Project>("projects"),
    ]);
    setUsers(u); setRoles(r); setLocations(l); setProjects(p);
  }, []);
  useEffect(() => { load(); }, [load]);

  const allRoles = [...BUILT_IN_ROLES, ...roles.map((r) => r.name).filter((n) => !BUILT_IN_ROLES.includes(n))];
  const activeLocations = locations.filter((l) => l.status === "Active");
  const activeProjects  = projects.filter((p) => p.status === "Active");
  const filtered = users.filter((u) =>
    [u.displayName, u.email, u.organization].some((f) => f?.toLowerCase().includes(search.toLowerCase()))
  );

  function openEdit(u: UserProfile) { setEditing(u); setForm({ ...u }); }

  async function handleAddUser() {
    const errs: string[] = [];
    if (!newUser.displayName.trim()) errs.push("Name is required");
    if (!newUser.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newUser.email)) errs.push("Valid email is required");
    if (newUser.password.length < 6) errs.push("Password must be at least 6 characters");
    if (users.some((u) => u.email.toLowerCase() === newUser.email.trim().toLowerCase())) errs.push("Email already exists");
    if (errs.length) { setAddErrors(errs); return; }
    setAddErrors([]);
    setAddSaving(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newUser.email.trim().toLowerCase(),
          password: newUser.password,
          displayName: newUser.displayName.trim(),
          role: newUser.role,
          organization: newUser.organization.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setAddErrors([err.error ?? "Failed to create user"]);
        return;
      }
      await res.json();
      await logAudit({ userId: cp?.uid ?? "", userEmail: cp?.email ?? "", action: `Created user: ${newUser.email}`, category: "User", details: `Role: ${newUser.role}` });
      toast.success(`User "${newUser.displayName}" created — they can log in with their email & password`);
      setNewUser({ ...NEW_USER_EMPTY });
      setShowAdd(false);
      load();
      refreshRoles();
    } catch { toast.error("Failed to create user"); }
    finally { setAddSaving(false); }
  }

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      await updateDocument("users", editing.uid, { ...form });
      await logAudit({ userId: cp?.uid ?? "", userEmail: cp?.email ?? "", action: `Updated profile: ${editing.email}`, category: "User", details: JSON.stringify(form) });
      toast.success("Profile updated"); setEditing(null); load();
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  }

  function toggle(field: "allowedLocations" | "projects", val: string) {
    const arr: string[] = (form[field] as string[]) ?? [];
    setForm((p) => ({ ...p, [field]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input type="text" placeholder="Search users…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-sm outline-none focus:border-slate-400 bg-white" />
        </div>
        <button onClick={load} className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => { setShowAdd(true); setAddErrors([]); setNewUser({ ...NEW_USER_EMPTY }); }}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700">
          <UserPlus className="h-3.5 w-3.5" /> Add New User
        </button>
      </div>

      {/* Add New User modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-slate-700" />
                <span className="font-semibold text-slate-900">Create New User</span>
              </div>
              <button onClick={() => setShowAdd(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              {addErrors.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 space-y-1">
                  {addErrors.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Full Name *</label>
                  <input value={newUser.displayName} onChange={(e) => setNewUser((p) => ({ ...p, displayName: e.target.value }))}
                    placeholder="John Doe"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Email Address *</label>
                  <input type="email" value={newUser.email} onChange={(e) => setNewUser((p) => ({ ...p, email: e.target.value }))}
                    placeholder="john@example.com"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Password * (min 6 chars)</label>
                  <div className="relative">
                    <input type={showPass ? "text" : "password"} value={newUser.password}
                      onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))}
                      placeholder="Set a login password"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-9 text-sm outline-none focus:border-slate-500" />
                    <button type="button" onClick={() => setShowPass((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Role</label>
                  <select value={newUser.role} onChange={(e) => setNewUser((p) => ({ ...p, role: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-500">
                    {allRoles.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Organization</label>
                  <input value={newUser.organization} onChange={(e) => setNewUser((p) => ({ ...p, organization: e.target.value }))}
                    placeholder="Optional"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                </div>
              </div>
              <p className="text-xs text-slate-400">The user can log in immediately using this email and password.</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button onClick={() => setShowAdd(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={handleAddUser} disabled={addSaving}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {addSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Create User
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden card-bento">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              {["Name", "Email", "Org", "Role", "Locations", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="py-10 text-center text-sm text-slate-400">No users found</td></tr>
            )}
            {filtered.map((u) => (
              <tr key={u.uid} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ${ROLE_COLORS[u.role]?.split(" ")[0]?.replace("100","600") ?? "bg-slate-500"}`}>
                      {u.displayName?.charAt(0).toUpperCase() ?? "?"}
                    </div>
                    <span className="font-medium text-slate-800">{u.displayName}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{u.email}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{u.organization ?? "—"}</td>
                <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {u.allowedLocations?.length ? u.allowedLocations.slice(0, 2).join(", ") + (u.allowedLocations.length > 2 ? ` +${u.allowedLocations.length - 2}` : "") : "All"}
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => openEdit(u)} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 transition-colors">
                    <Edit2 className="h-3 w-3" /> Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white/90 backdrop-blur px-5 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
                  {editing.displayName?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-slate-900">{editing.displayName}</p>
                  <p className="text-xs text-slate-400">{editing.email}</p>
                </div>
              </div>
              <button onClick={() => setEditing(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-5">
              {(["displayName", "organization"] as const).map((field) => (
                <div key={field}>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">{field === "displayName" ? "Display Name" : "Organization"}</label>
                  <input value={(form[field] as string) ?? ""} onChange={(e) => setForm((p) => ({ ...p, [field]: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 bg-slate-50" />
                </div>
              ))}
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-600">Role</label>
                <div className="grid grid-cols-2 gap-2">
                  {allRoles.map((r) => {
                    const active = form.role === r;
                    return (
                      <label key={r} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${active ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}>
                        <input type="radio" className="hidden" checked={active} onChange={() => setForm((p) => ({ ...p, role: r }))} />
                        {r}
                        {active && <Check className="h-3.5 w-3.5 ml-auto" />}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-600">Allowed Sites <span className="text-slate-400 font-normal">(empty = unrestricted)</span></label>
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                  {activeLocations.map((loc) => {
                    const checked = (form.allowedLocations ?? []).includes(loc.name);
                    return (
                      <label key={loc.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-all ${checked ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:bg-slate-50"}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggle("allowedLocations", loc.name)} className="rounded" />
                        <span className="font-medium text-slate-700 truncate">{loc.name}</span>
                        <span className="ml-auto text-slate-400 text-[10px] shrink-0">{loc.isMasterWarehouse ? "⭐" : loc.type}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-600">Project Access</label>
                <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                  {activeProjects.map((proj) => {
                    const checked = (form.projects ?? []).includes(proj.name);
                    return (
                      <label key={proj.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-all ${checked ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:bg-slate-50"}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggle("projects", proj.name)} className="rounded" />
                        <span className="font-medium text-slate-700 truncate">{proj.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-3 pt-2 sticky bottom-0 bg-white pb-1">
                <button onClick={() => setEditing(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Password Reset ────────────────────────────────────────────────────────────
function PasswordResetTab() {
  const { profile: cp } = useAuth();
  const [users,      setUsers]      = useState<UserProfile[]>([]);
  const [search,     setSearch]     = useState("");
  const [selected,   setSelected]   = useState<UserProfile | null>(null);
  const [newPass,    setNewPass]     = useState("");
  const [confirm,    setConfirm]     = useState("");
  const [showPass,   setShowPass]    = useState(false);
  const [saving,     setSaving]      = useState(false);
  const [strength,   setStrength]    = useState(0);

  useEffect(() => { fetchAll<UserProfile>("users").then(setUsers); }, []);

  const filtered = users.filter((u) =>
    [u.displayName, u.email].some((f) => f?.toLowerCase().includes(search.toLowerCase()))
  );

  function calcStrength(p: string) {
    let s = 0;
    if (p.length >= 8) s++;
    if (/[A-Z]/.test(p)) s++;
    if (/[0-9]/.test(p)) s++;
    if (/[^a-zA-Z0-9]/.test(p)) s++;
    setStrength(s);
  }

  async function handleReset() {
    if (!selected) return;
    if (newPass.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    if (newPass !== confirm) { toast.error("Passwords do not match"); return; }
    setSaving(true);
    try {
      // Store as hashed representation (in production this would call a secure API)
      // For this local JSON system: we store the password hash in user record
      const passwordHash = btoa(newPass); // Base64 encode as a simple local placeholder
      await updateDocument("users", selected.uid, { passwordHash });
      await logAudit({
        userId: cp?.uid ?? "", userEmail: cp?.email ?? "",
        action: `Password reset for ${selected.email}`,
        category: "User", details: selected.uid,
      });
      toast.success(`Password reset for ${selected.displayName}`);
      setSelected(null); setNewPass(""); setConfirm(""); setStrength(0);
    } catch { toast.error("Reset failed"); }
    finally { setSaving(false); }
  }

  const strengthLabels = ["Very Weak", "Weak", "Fair", "Strong"];
  const strengthColors = ["bg-red-500", "bg-orange-400", "bg-yellow-400", "bg-emerald-500"];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800">
          Password resets are logged in Audit Logs. Only reset passwords when explicitly requested by the user or for security purposes.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* User selection */}
        <div className="card-bento overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 bg-slate-50">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Select User</p>
          </div>
          <div className="p-3">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-xs outline-none focus:border-slate-400 bg-slate-50" />
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1">
              {filtered.map((u) => (
                <button key={u.uid} onClick={() => { setSelected(u); setNewPass(""); setConfirm(""); setStrength(0); }}
                  className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all ${selected?.uid === u.uid ? "bg-indigo-600 text-white" : "hover:bg-slate-50 text-slate-700"}`}>
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${selected?.uid === u.uid ? "bg-white text-slate-900" : "bg-slate-100 text-slate-600"}`}>
                    {u.displayName?.charAt(0).toUpperCase() ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.displayName}</p>
                    <p className={`text-xs truncate ${selected?.uid === u.uid ? "text-slate-300" : "text-slate-400"}`}>{u.email}</p>
                  </div>
                  <RoleBadge role={u.role} />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Reset form */}
        <div className="card-bento overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 bg-slate-50">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              {selected ? `Reset Password — ${selected.displayName}` : "New Password"}
            </p>
          </div>
          <div className="p-5 space-y-4">
            {!selected && (
              <div className="flex flex-col items-center py-10 text-slate-400 gap-2">
                <Lock className="h-10 w-10 opacity-30" />
                <p className="text-sm">Select a user to reset their password</p>
              </div>
            )}
            {selected && (
              <>
                <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
                    {selected.displayName?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{selected.displayName}</p>
                    <p className="text-xs text-slate-400">{selected.email}</p>
                  </div>
                  <RoleBadge role={selected.role} />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">New Password *</label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                      type={showPass ? "text" : "password"}
                      value={newPass}
                      onChange={(e) => { setNewPass(e.target.value); calcStrength(e.target.value); }}
                      placeholder="Enter new password…"
                      className="w-full rounded-xl border border-slate-200 pl-9 pr-10 py-2.5 text-sm outline-none focus:border-slate-400 bg-slate-50" />
                    <button type="button" onClick={() => setShowPass((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {newPass.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <div className="flex gap-1">
                        {[0,1,2,3].map((i) => (
                          <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i < strength ? strengthColors[strength - 1] : "bg-slate-200"}`} />
                        ))}
                      </div>
                      <p className={`text-xs font-medium ${strength >= 3 ? "text-emerald-600" : strength >= 2 ? "text-yellow-600" : "text-red-500"}`}>
                        {strengthLabels[strength - 1] ?? "Very Weak"}
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Confirm Password *</label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                      type={showPass ? "text" : "password"}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="Re-enter password…"
                      className={`w-full rounded-xl border pl-9 pr-3 py-2.5 text-sm outline-none bg-slate-50 ${
                        confirm && confirm !== newPass ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-slate-400"
                      }`} />
                  </div>
                  {confirm && confirm !== newPass && (
                    <p className="mt-1 text-xs text-red-500">Passwords do not match</p>
                  )}
                  {confirm && confirm === newPass && confirm.length > 0 && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600">
                      <Check className="h-3 w-3" /> Passwords match
                    </p>
                  )}
                </div>

                <button onClick={handleReset}
                  disabled={saving || !newPass || !confirm || newPass !== confirm || newPass.length < 6}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-all">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  Reset Password
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── RBAC Roles ───────────────────────────────────────────────────────────────
function RBACTab() {
  const { profile, refreshRoles } = useAuth();
  const [roles,      setRoles]      = useState<CustomRole[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newRole,    setNewRole]    = useState({ name: "", description: "", allowedTabs: [] as string[] });
  const [saving,     setSaving]     = useState(false);

  const load = useCallback(async () => { setRoles(await fetchAll<CustomRole>("custom_roles")); }, []);
  useEffect(() => { load(); }, [load]);

  function toggleTab(id: string) {
    setNewRole((p) => ({ ...p, allowedTabs: p.allowedTabs.includes(id) ? p.allowedTabs.filter((t) => t !== id) : [...p.allowedTabs, id] }));
  }

  async function handleCreate() {
    if (!newRole.name.trim()) return;
    if (BUILT_IN_ROLES.includes(newRole.name)) { toast.error("Cannot overwrite a built-in role"); return; }
    setSaving(true);
    try {
      await addDocument("custom_roles", { name: newRole.name, description: newRole.description, allowedTabs: newRole.allowedTabs, createdAt: new Date().toISOString() });
      toast.success(`Role "${newRole.name}" created`);
      setShowCreate(false); setNewRole({ name: "", description: "", allowedTabs: [] }); load(); refreshRoles();
    } catch { toast.error("Failed"); }
    finally { setSaving(false); }
  }

  async function handleDelete(role: CustomRole) {
    await deleteDocument("custom_roles", role.id);
    toast.success("Role deleted"); load(); refreshRoles();
  }

  void profile; // suppress unused warning

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">System Built-in Roles</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {BUILT_IN_ROLES.map((role) => {
            const desc: Record<string, string> = {
              Admin:    "Full access to all features and settings",
              Manager:  "Access to operations, reports, and customer management",
              Employee: "Access to assets, movements, and orders",
              Customer: "Access to their location inventory and movements only",
            };
            return (
              <div key={role} className={`rounded-2xl border p-4 ${ROLE_COLORS[role] ?? "border-slate-200 bg-slate-50"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm">{role}</span>
                  <span className="rounded-full bg-white/60 px-2 py-0.5 text-[10px] font-semibold">SYSTEM</span>
                </div>
                <p className="mt-1.5 text-xs opacity-80">{desc[role]}</p>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Custom Roles ({roles.length})</h3>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">
            <Plus className="h-3.5 w-3.5" /> Define New Role
          </button>
        </div>
        {roles.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-10 text-center text-sm text-slate-400">No custom roles yet</div>
        )}
        <div className="grid gap-3 lg:grid-cols-2">
          {roles.map((role) => (
            <div key={role.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-800">{role.name}</p>
                  {role.description && <p className="text-xs text-slate-500 mt-0.5">{role.description}</p>}
                </div>
                <button onClick={() => handleDelete(role)} className="rounded-xl p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {role.allowedTabs.map((tabId) => {
                  const tab = ALL_TABS.find((t) => t.id === tabId);
                  return <span key={tabId} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{tab?.label ?? tabId}</span>;
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="font-semibold text-slate-900">Define New Role</h3>
              <button onClick={() => setShowCreate(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Role Name</label>
                <input value={newRole.name} onChange={(e) => setNewRole((p) => ({ ...p, name: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 bg-slate-50" placeholder="e.g. Warehouse Team Lead" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Description</label>
                <input value={newRole.description} onChange={(e) => setNewRole((p) => ({ ...p, description: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 bg-slate-50" placeholder="Optional…" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-600">Permitted Screens</label>
                <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                  {ALL_TABS.map((tab) => {
                    const checked = newRole.allowedTabs.includes(tab.id);
                    return (
                      <label key={tab.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all ${checked ? "border-indigo-600 bg-indigo-600 text-white font-medium" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleTab(tab.id)} className="rounded" />
                        {tab.label}
                        {checked && <Check className="h-3 w-3 ml-auto" />}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowCreate(false)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                <button onClick={handleCreate} disabled={saving || !newRole.name.trim() || !newRole.allowedTabs.length}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create Role
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Projects ─────────────────────────────────────────────────────────────────
function ProjectsTab() {
  const { profile } = useAuth();
  const [projects,  setProjects]  = useState<Project[]>([]);
  const [showForm,  setShowForm]  = useState(false);
  const [editing,   setEditing]   = useState<Project | null>(null);
  const [form,      setForm]      = useState({ name: "", client: "", status: "Active" as Project["status"] });
  const [saving,    setSaving]    = useState(false);

  const load = useCallback(async () => { setProjects(await fetchAll<Project>("projects")); }, []);
  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setForm({ name: "", client: "", status: "Active" }); setShowForm(true); }
  function openEdit(p: Project) { setEditing(p); setForm({ name: p.name, client: p.client, status: p.status }); setShowForm(true); }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await updateDocument("projects", editing.id, { ...form });
        toast.success("Project updated");
      } else {
        await addDocument("projects", { ...form });
        await logAudit({ userId: profile?.uid ?? "", userEmail: profile?.email ?? "", action: `Project created: ${form.name}`, category: "User", details: form.client });
        toast.success("Project added");
      }
      setShowForm(false); load();
    } catch { toast.error("Failed to save project"); }
    finally { setSaving(false); }
  }

  async function handleDelete(p: Project) {
    await deleteDocument("projects", p.id);
    toast.success(`"${p.name}" deleted`); load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{projects.length} projects · {projects.filter((p) => p.status === "Active").length} active</p>
        <button onClick={openCreate} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
          <Plus className="h-4 w-4" /> Add Project
        </button>
      </div>

      <div className="overflow-hidden card-bento">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              {["Project Name", "Client / Company", "Status", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {projects.length === 0 && (
              <tr><td colSpan={4} className="py-12 text-center text-slate-400">No projects yet — add one above</td></tr>
            )}
            {projects.map((p) => (
              <tr key={p.id} className={`hover:bg-slate-50 transition-colors ${p.status === "Closed" ? "opacity-60" : ""}`}>
                <td className="px-4 py-3 font-semibold text-slate-800">{p.name}</td>
                <td className="px-4 py-3 text-slate-600">{p.client}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${p.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{p.status}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(p)} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                      <Edit2 className="h-3 w-3" /> Edit
                    </button>
                    <button onClick={() => handleDelete(p)} className="rounded-lg border border-slate-200 p-1 text-slate-400 hover:bg-red-50 hover:text-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="font-semibold text-slate-900">{editing ? "Edit Project" : "Add Project"}</h3>
              <button onClick={() => setShowForm(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Project Name *</label>
                <input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Project Delta"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 bg-slate-50" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Client / Company *</label>
                <input required value={form.client} onChange={(e) => setForm((p) => ({ ...p, client: e.target.value }))}
                  placeholder="e.g. ACME Corporation"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 bg-slate-50" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-600">Status</label>
                <div className="flex gap-3">
                  {(["Active", "Closed"] as const).map((s) => (
                    <label key={s} className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold transition-all ${form.status === s ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                      <input type="radio" className="hidden" checked={form.status === s} onChange={() => setForm((p) => ({ ...p, status: s }))} />
                      {form.status === s && <Check className="h-3.5 w-3.5" />} {s}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {editing ? "Save" : "Add Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Administration Shell ────────────────────────────────────────────────
export default function Administration() {
  const [activeTab, setActiveTab] = useState<"users" | "roles" | "projects" | "passwords">("users");

  const TABS = [
    { id: "users"     as const, label: "User Profiles",       icon: Users,       color: "text-blue-600"  },
    { id: "passwords" as const, label: "Password Reset",      icon: KeyRound,    color: "text-orange-600" },
    { id: "roles"     as const, label: "Access Roles (RBAC)", icon: ShieldCheck, color: "text-purple-600" },
    { id: "projects"  as const, label: "Projects",            icon: FolderKanban, color: "text-emerald-600" },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 px-6 py-5 text-white shadow-lg">
        <h1 className="text-2xl font-bold">Administration</h1>
        <p className="mt-1 text-sm text-slate-400">User management, RBAC roles, password reset, and project configuration</p>
      </div>

      <div className="flex flex-wrap border-b border-slate-200 gap-0">
        {TABS.map(({ id, label, icon: Icon, color }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-all ${activeTab === id ? `border-slate-900 ${color}` : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"}`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {activeTab === "users"     && <UserProfilesTab />}
      {activeTab === "passwords" && <PasswordResetTab />}
      {activeTab === "roles"     && <RBACTab />}
      {activeTab === "projects"  && <ProjectsTab />}
    </div>
  );
}
