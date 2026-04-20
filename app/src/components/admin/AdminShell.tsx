"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconLayoutDashboard,
  IconUsers,
  IconShieldLock,
  IconLogout,
} from "@tabler/icons-react";
import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import type { AdminRole } from "@/lib/admin-auth";

type Props = {
  role: AdminRole;
  email: string | null;
  children: React.ReactNode;
};

type NavItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
  matchPrefix?: boolean;
};

const NAV: NavItem[] = [
  { href: "/admin", label: "ダッシュボード", Icon: IconLayoutDashboard },
  { href: "/admin/users", label: "利用者", Icon: IconUsers, matchPrefix: true },
  { href: "/admin/security", label: "セキュリティ", Icon: IconShieldLock, matchPrefix: true },
];

const ROLE_LABEL: Record<AdminRole, string> = {
  support_viewer: "閲覧",
  support_operator: "運用",
  super_admin: "管理者",
};

export function AdminShell({ role, email, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const isActive = (item: NavItem) => {
    if (item.matchPrefix) return pathname === item.href || pathname.startsWith(`${item.href}/`);
    return pathname === item.href;
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const sb = createClient();
      await sb.auth.signOut();
    } catch (e) {
      console.error("[admin] signOut failed", e);
    } finally {
      router.replace("/login");
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        background: "var(--n-50)",
        color: "var(--text)",
        zIndex: 50,
      }}
    >
      <aside
        style={{
          width: 240,
          flexShrink: 0,
          background: "var(--ink-900, #0F1B2D)",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          padding: "20px 0",
        }}
      >
        <div style={{ padding: "0 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 13, letterSpacing: 2, color: "rgba(255,255,255,0.5)" }}>
            TORITAVI
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
            Admin Console
          </div>
        </div>
        <nav style={{ padding: "12px 8px", flex: 1 }}>
          {NAV.map((item) => {
            const active = isActive(item);
            const Icon = item.Icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 8,
                  color: active ? "#fff" : "rgba(255,255,255,0.7)",
                  background: active ? "rgba(255,255,255,0.08)" : "transparent",
                  fontSize: 14,
                  fontWeight: active ? 600 : 400,
                  marginBottom: 2,
                }}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div style={{ padding: "12px 20px 0", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
          v1 MVP · read-heavy
        </div>
      </aside>

      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 12,
            padding: "12px 24px",
            background: "#fff",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
            {email ?? "—"}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 999,
              background: role === "super_admin" ? "var(--danger-50, #fee)" : "var(--n-100)",
              color: role === "super_admin" ? "var(--danger-700, #b00)" : "var(--text-dim)",
            }}
          >
            {ROLE_LABEL[role]}
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 6,
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text)",
              cursor: signingOut ? "not-allowed" : "pointer",
              fontSize: 13,
            }}
          >
            <IconLogout size={14} />
            {signingOut ? "ログアウト中…" : "ログアウト"}
          </button>
        </header>
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          {children}
        </div>
      </main>
    </div>
  );
}
