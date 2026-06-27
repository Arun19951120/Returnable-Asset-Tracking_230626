"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAll, addDocument, deleteDocument, updateDocument, logAudit } from "@/lib/storage";
import { UserProfile, CustomRole, BUILT_IN_ROLES, Asset, Location } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import {
  X, UserPlus, Trash2, Loader2, CheckCircle2, AlertCircle,
  Eye, EyeOff, User, Users, ShieldCheck, Package, LogOut, LogIn,
} from "lucide-react";
import { toast } from "sonner";
import CheckInOutDialog from "@/components/dialogs/CheckInOutDialog";

interface Props { onClose: () => void }

const ROLE_COLORS: Record<string, string> = {
  Admin:    "bg-purple-100 text-purple-700",
  Manager:  "bg-blue-100 text-blue-700",
  Employee: "bg-emerald-100 text-emerald-700",
  Customer: "bg-orange-100 text-orange-700",
};

const STATUS_COLORS: Record<string, { fill: string; light: string; text: string; label: string }> = {
  Available:   { fill: "#10b981", light: "bg-emerald-100", text: "text-emerald-700", label: "Available" },
  Dispatched:  { fill: "#f59e0b", light: "bg-amber-100",   text: "text-amber-700",   label: "Dispatched" },
  "In-Transit":{ fill: "#3b82f6", light: "bg-blue-100",    text: "text-blue-700",    label: "In-Transit" },
  Maintenance: { fill: "#ef4444", light: "bg-red-100",     text: "text-red-700",     label: "Maintenance" },
};

type Tab = "profile" | "assets" | "users";

const EMPTY_NEW = { displayName: "", email: "", password: "", role: "Employee", organization: "" };

// ── Pie chart (pure SVG, no library) ────────────────────────────────────────
function PieChart({
  data, selected, onSelect,
}: {
  data: { status: string; count: number }[];
  selected: string | null;
  onSelect: (s: string | null) => void;
}) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) return (
    <div className="flex h-48 items-center justify-center text-sm text-slate-400">No assets found</div>
  );

  const cx = 80; const cy = 80; const r = 70; const ir = 38;
  let angle = -Math.PI / 2;

  const slices = data.map((d) => {
    const sweep = (d.count / total) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const xi1 = cx + ir * Math.cos(angle);
    const yi1 = cy + ir * Math.sin(angle);
    const xi2 = cx + ir * Math.cos(angle - sweep);
    const yi2 = cy + ir * Math.sin(angle - sweep);
    const large = sweep > Math.PI ? 1 : 0;
    const path = [
      `M ${xi2} ${yi2}`,
      `L ${x1} ${y1}`,
      `A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`,
      `L ${xi1} ${yi1}`,
      `A ${ir} ${ir} 0 ${large} 0 ${xi2} ${yi2}`,
      "Z",
    ].join(" ");
    const midAngle = angle - sweep / 2;
    return { ...d, path, midAngle, sweep };
  });

  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 160 160" className="w-48 h-48 cursor-pointer">
        {slices.map((s) => {
          const cfg = STATUS_COLORS[s.status];
          const isSelected = selected === s.status;
          const scale = isSelected ? 1.06 : 1;
          const tx = cx * (1 - scale);
          const ty = cy * (1 - scale);
          return (
            <path
              key={s.status}
              d={s.path}
              fill={cfg?.fill ?? "#94a3b8"}
              opacity={selected && !isSelected ? 0.4 : 1}
              transform={isSelected ? `matrix(${scale},0,0,${scale},${tx},${ty})` : undefined}
              onClick={() => onSelect(selected === s.status ? null : s.status)}
              className="transition-all duration-200"
              stroke="white" strokeWidth="1.5"
            />
          );
        })}
        {/* Centre label */}
        <text x={cx} y={cy - 6} textAnchor="middle" className="text-xs" fontSize="20" fontWeight="700" fill="#1e293b">{total}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="8" fill="#64748b">assets</text>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-2">
        {slices.map((s) => {
          const cfg = STATUS_COLORS[s.status];
          return (
            <button key={s.status} onClick={() => onSelect(selected === s.status ? null : s.status)}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border transition-all ${
                selected === s.status
                  ? "border-slate-700 bg-slate-800 text-white shadow"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}>
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: cfg?.fill ?? "#94a3b8" }} />
              {s.status} ({s.count})
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function UserProfileDialog({ onClose }: Props) {
  const { profile: me, refreshRoles } = useAuth();
  const [tab, setTab]           = useState<Tab>("profile");
  const [users, setUsers]       = useState<UserProfile[]>([]);
  const [roles, setRoles]       = useState<CustomRole[]>([]);
  const [loading, setLoading]   = useState(false);

  // My-profile edit
  const [editMe, setEditMe]         = useState({ displayName: me?.displayName ?? "", organization: me?.organization ?? "" });
  const [savingMe, setSavingMe]     = useState(false);

  // Add-user form
  const [showAdd, setShowAdd]       = useState(false);
  const [newUser, setNewUser]       = useState({ ...EMPTY_NEW });
  const [showPw, setShowPw]         = useState(false);
  const [saving, setSaving]         = useState(false);
  const [addErrors, setAddErrors]   = useState<string[]>([]);

  // Delete confirm
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  // Assets tab
  const [assets,        setAssets]       = useState<Asset[]>([]);
  const [locations,     setLocations]    = useState<Location[]>([]);
  const [selectedSlice, setSelectedSlice] = useState<string | null>(null);
  const [txAsset,       setTxAsset]      = useState<Asset | null>(null);
  const [txMode,        setTxMode]       = useState<"checkout" | "checkin">("checkout");

  const isAdmin = true;

  const load = useCallback(async () => {
    setLoading(true);
    const [u, r, a, l] = await Promise.all([
      fetchAll<UserProfile>("users"),
      fetchAll<CustomRole>("custom_roles"),
      fetchAll<Asset>("assets"),
      fetchAll<Location>("locations"),
    ]);
    setUsers(u); setRoles(r); setAssets(a); setLocations(l);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const allRoles = [...BUILT_IN_ROLES, ...roles.map((r) => r.name).filter((n) => !BUILT_IN_ROLES.includes(n))];

  // Pie chart data — group by status
  const statusCounts = Object.keys(STATUS_COLORS).map((s) => ({
    status: s,
    count: assets.filter((a) => a.status === s).length,
  })).filter((d) => d.count > 0);

  const filteredAssets = selectedSlice
    ? assets.filter((a) => a.status === selectedSlice)
    : assets;

  // ── Save my profile ──────────────────────────────────────────────────────
  async function handleSaveMe() {
    if (!me) return;
    setSavingMe(true);
    try {
      await updateDocument("users", me.uid, { displayName: editMe.displayName, organization: editMe.organization });
      await logAudit({ userId: me.uid, userEmail: me.email, action: "Updated own profile", category: "User", details: JSON.stringify(editMe) });
      toast.success("Profile updated — re-login to see name changes");
    } catch { toast.error("Failed to save"); }
    finally { setSavingMe(false); }
  }

  // ── Add user ─────────────────────────────────────────────────────────────
  function validateNew(): string[] {
    const e: string[] = [];
    if (!newUser.displayName.trim()) e.push("Display name is required");
    if (!newUser.email.trim() || !newUser.email.includes("@")) e.push("Valid email is required");
    if (newUser.password.length < 6) e.push("Password must be at least 6 characters");
    if (users.some((u) => u.email.toLowerCase() === newUser.email.toLowerCase())) e.push("Email already exists");
    return e;
  }

  async function handleAddUser() {
    const errs = validateNew();
    if (errs.length) { setAddErrors(errs); return; }
    setAddErrors([]);
    setSaving(true);
    try {
      const uid = `user_${Date.now()}`;
      await addDocument("users", {
        uid,
        displayName: newUser.displayName.trim(),
        email: newUser.email.trim().toLowerCase(),
        password: newUser.password,
        role: newUser.role,
        organization: newUser.organization.trim() || undefined,
      });
      await logAudit({ userId: me?.uid ?? "", userEmail: me?.email ?? "", action: `Added user: ${newUser.email}`, category: "User", details: `Role: ${newUser.role}` });
      toast.success(`User "${newUser.displayName}" added`);
      setNewUser({ ...EMPTY_NEW });
      setShowAdd(false);
      load();
      refreshRoles();
    } catch { toast.error("Failed to add user"); }
    finally { setSaving(false); }
  }

  // ── Delete user ──────────────────────────────────────────────────────────
  async function handleDelete(uid: string) {
    const u = users.find((x) => x.uid === uid);
    if (!u) return;
    try {
      await deleteDocument("users", uid);
      await logAudit({ userId: me?.uid ?? "", userEmail: me?.email ?? "", action: `Deleted user: ${u.email}`, category: "User", details: `UID: ${uid}` });
      toast.success(`User "${u.displayName}" deleted`);
      setConfirmDel(null);
      load();
    } catch { toast.error("Failed to delete user"); }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white uppercase">
                {me?.displayName?.[0] ?? "?"}
              </div>
              <div>
                <p className="font-semibold text-slate-900 text-sm">{me?.displayName}</p>
                <p className="text-[10px] text-slate-400 font-mono">{me?.email}</p>
              </div>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-slate-100 shrink-0">
            {([
              { id: "profile" as Tab, label: "My Profile",       icon: User },
              { id: "assets"  as Tab, label: "Assets",           icon: Package },
              ...(me?.role === "Admin" || me?.role === "Manager"
                ? [{ id: "users" as Tab, label: "User Management", icon: Users }]
                : []),
            ]).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center justify-center gap-1.5 flex-1 py-2.5 text-xs font-semibold transition-colors ${
                  tab === id
                    ? "border-b-2 border-slate-900 text-slate-900"
                    : "text-slate-400 hover:text-slate-600"
                }`}>
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="overflow-y-auto flex-1 p-5">

            {/* ── My Profile tab ── */}
            {tab === "profile" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-xl font-bold text-white uppercase">
                    {me?.displayName?.[0] ?? "?"}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">{me?.displayName}</p>
                    <p className="text-xs text-slate-500">{me?.email}</p>
                    <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${ROLE_COLORS[me?.role ?? ""] ?? "bg-slate-100 text-slate-600"}`}>
                      <ShieldCheck className="h-2.5 w-2.5" /> {me?.role}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Display Name</label>
                  <input value={editMe.displayName}
                    onChange={(e) => setEditMe((p) => ({ ...p, displayName: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 bg-slate-50" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Organization</label>
                  <input value={editMe.organization}
                    onChange={(e) => setEditMe((p) => ({ ...p, organization: e.target.value }))}
                    placeholder="Your organization name…"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 bg-slate-50" />
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-700">
                  ℹ️ Email and role can only be changed by an Admin from the User Management tab.
                </div>
                <button onClick={handleSaveMe} disabled={savingMe}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                  {savingMe ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Save Profile
                </button>
              </div>
            )}

            {/* ── Assets tab ── */}
            {tab === "assets" && (
              <div className="space-y-5">
                {loading ? (
                  <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
                ) : (
                  <>
                    <PieChart data={statusCounts} selected={selectedSlice} onSelect={setSelectedSlice} />

                    {selectedSlice && (
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-slate-600">
                          Showing <span className="text-slate-900">{filteredAssets.length}</span> {selectedSlice} assets
                        </p>
                        <button onClick={() => setSelectedSlice(null)}
                          className="text-xs text-slate-400 hover:text-slate-600 underline">
                          Show all
                        </button>
                      </div>
                    )}

                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {filteredAssets.length === 0 && (
                        <p className="text-center text-sm text-slate-400 py-6">No assets in this category</p>
                      )}
                      {filteredAssets.map((a) => {
                        const cfg = STATUS_COLORS[a.status];
                        return (
                          <div key={a.id}
                            className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5 hover:bg-slate-50 transition-colors">
                            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cfg?.light ?? "bg-slate-100"}`}>
                              <Package className={`h-4 w-4 ${cfg?.text ?? "text-slate-500"}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-slate-800 truncate">{a.name}</p>
                              <p className="text-[10px] text-slate-400 font-mono">{a.uuid} · {a.location}</p>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg?.light ?? "bg-slate-100"} ${cfg?.text ?? "text-slate-600"}`}>
                              {a.status}
                            </span>
                            {/* Action buttons */}
                            {a.status === "Available" && (
                              <button
                                onClick={() => { setTxAsset(a); setTxMode("checkout"); }}
                                title="Check Out"
                                className="shrink-0 flex items-center gap-1 rounded-lg bg-orange-50 border border-orange-200 px-2 py-1 text-[10px] font-semibold text-orange-700 hover:bg-orange-100 transition-colors">
                                <LogOut className="h-3 w-3" /> Out
                              </button>
                            )}
                            {(a.status === "Dispatched" || a.status === "In-Transit") && (
                              <button
                                onClick={() => { setTxAsset(a); setTxMode("checkin"); }}
                                title="Check In"
                                className="shrink-0 flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors">
                                <LogIn className="h-3 w-3" /> In
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── User Management tab ── */}
            {tab === "users" && (
              <div className="space-y-4">
                {isAdmin && !showAdd && (
                  <button onClick={() => setShowAdd(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-colors">
                    <UserPlus className="h-4 w-4" /> Add New User
                  </button>
                )}

                {isAdmin && showAdd && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-700">New User Details</p>
                      <button onClick={() => { setShowAdd(false); setAddErrors([]); setNewUser({ ...EMPTY_NEW }); }}
                        className="rounded p-1 text-slate-400 hover:bg-slate-200">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {addErrors.length > 0 && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 space-y-1">
                        <div className="flex items-center gap-1.5 text-red-700">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <p className="text-xs font-semibold">Fix the following:</p>
                        </div>
                        {addErrors.map((e, i) => <p key={i} className="text-xs text-red-600 pl-5">• {e}</p>)}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Display Name *</label>
                        <input value={newUser.displayName}
                          onChange={(e) => setNewUser((p) => ({ ...p, displayName: e.target.value }))}
                          placeholder="John Smith"
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-slate-400" />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Organization</label>
                        <input value={newUser.organization}
                          onChange={(e) => setNewUser((p) => ({ ...p, organization: e.target.value }))}
                          placeholder="Company name"
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-slate-400" />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Email *</label>
                        <input type="email" value={newUser.email}
                          onChange={(e) => setNewUser((p) => ({ ...p, email: e.target.value }))}
                          placeholder="user@example.com"
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-slate-400" />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Password *</label>
                        <div className="relative">
                          <input type={showPw ? "text" : "password"} value={newUser.password}
                            onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))}
                            placeholder="min 6 chars"
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 pr-8 text-sm outline-none focus:border-slate-400" />
                          <button type="button" onClick={() => setShowPw((v) => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                            {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Role *</label>
                      <div className="flex flex-wrap gap-2">
                        {allRoles.map((r) => (
                          <button key={r} type="button" onClick={() => setNewUser((p) => ({ ...p, role: r }))}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                              newUser.role === r
                                ? "border-slate-800 bg-slate-800 text-white"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            }`}>
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button onClick={handleAddUser} disabled={saving}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                      Create User
                    </button>
                  </div>
                )}

                {loading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
                ) : (
                  <div className="space-y-2">
                    {users.map((u) => (
                      <div key={u.uid}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${u.uid === me?.uid ? "border-slate-300 bg-slate-50" : "border-slate-100 bg-white"}`}>
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white uppercase ${
                          ROLE_COLORS[u.role]?.replace("bg-", "bg-").replace("-100", "-500").split(" ")[0] ?? "bg-slate-500"
                        }`}>
                          {u.displayName?.[0] ?? "?"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-slate-800 truncate">{u.displayName}</p>
                            {u.uid === me?.uid && <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-600 uppercase">You</span>}
                          </div>
                          <p className="text-[10px] text-slate-400 truncate">{u.email}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${ROLE_COLORS[u.role] ?? "bg-slate-100 text-slate-600"}`}>
                          {u.role}
                        </span>

                        {u.uid !== me?.uid && (
                          confirmDel === u.uid ? (
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={() => handleDelete(u.uid)}
                                className="rounded bg-red-500 px-2 py-1 text-[10px] font-bold text-white hover:bg-red-600">Yes</button>
                              <button onClick={() => setConfirmDel(null)}
                                className="rounded border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-50">No</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmDel(u.uid)} title="Delete user"
                              className="shrink-0 rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Check-In / Check-Out dialog launched from asset list */}
      {txAsset && (
        <CheckInOutDialog
          asset={txAsset}
          locations={locations}
          initialMode={txMode}
          onClose={() => { setTxAsset(null); load(); }}
        />
      )}
    </>
  );
}
