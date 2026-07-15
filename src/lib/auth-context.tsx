"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { UserProfile, CustomRole, ALL_TABS } from "./types";
import { fetchAll } from "./storage";

interface AuthContextValue {
  user: UserProfile | null;
  profile: UserProfile | null;
  roles: CustomRole[];
  allowedTabs: string[];
  loading: boolean;
  logout: () => void;
  refreshRoles: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  roles: [],
  allowedTabs: [],
  loading: true,
  logout: () => {},
  refreshRoles: async () => {},
});

const SESSION_KEY = "ct_session";

export const useAuth = () => useContext(AuthContext);

// Separate context for the login action so LoginPage can call it
const LoginActionContext = createContext<(p: UserProfile) => void>(() => {});

export function AuthProviderWithLogin({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);

  async function refreshRoles() {
    const r = await fetchAll<CustomRole>("custom_roles");
    setRoles(r);
  }

  useEffect(() => {
    async function init() {
      try {
        const stored = localStorage.getItem(SESSION_KEY);
        if (stored) {
          const cached: UserProfile = JSON.parse(stored);
          setUser(cached);
          // Re-fetch fresh profile from server so fields like allowedLocations are always current
          try {
            const all = await fetchAll<UserProfile & { password?: string; passwordHash?: string }>("users");
            const fresh = all.find((u) => u.uid === cached.uid);
            if (fresh) {
              const { password: _p, passwordHash: _h, ...safeProfile } = fresh;
              setUser(safeProfile as UserProfile);
              localStorage.setItem(SESSION_KEY, JSON.stringify(safeProfile));
            }
          } catch { /* network issue — keep cached profile */ }
        }
      } catch {}
      await refreshRoles();
      setLoading(false);
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function login(profile: UserProfile) {
    setUser(profile);
    localStorage.setItem(SESSION_KEY, JSON.stringify(profile));
  }

  function logout() {
    setUser(null);
    localStorage.removeItem(SESSION_KEY);
  }

  const allowedTabs = (() => {
    if (!user) return [];
    if (user.role === "Admin") return ALL_TABS.map((t) => t.id);
    const matched = roles.find((r) => r.name === user.role);
    if (matched) return matched.allowedTabs;
    if (user.role === "Manager")  return ["dashboard", "assets", "movements", "transfers", "cycles", "orders", "pickups", "projects", "inventory", "reports", "hardware", "notifications", "audit"];
    if (user.role === "Customer") return ["dashboard", "movements", "orders", "pickups", "sustainability", "notifications"];
    if (user.role === "Employee") return ["dashboard", "assets", "movements", "orders", "pickups", "sustainability", "notifications"];
    // Legacy / fallback role names
    if (user.role === "Supplier") return ["dashboard", "movements", "orders", "pickups", "sustainability", "notifications"];
    if (user.role === "Tier-1")   return ["dashboard", "assets", "movements", "orders", "pickups", "sustainability", "notifications"];
    if (user.role === "OEM")      return ["dashboard", "assets", "movements", "orders", "pickups", "sustainability", "notifications"];
    return ["dashboard"];
  })();

  return (
    <LoginActionContext.Provider value={login}>
      <AuthContext.Provider
        value={{ user, profile: user, roles, allowedTabs, loading, logout, refreshRoles }}
      >
        {children}
      </AuthContext.Provider>
    </LoginActionContext.Provider>
  );
}

export const useLoginAction = () => useContext(LoginActionContext);
