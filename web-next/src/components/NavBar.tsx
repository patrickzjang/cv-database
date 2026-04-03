"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { href: "/",         label: "Products" },
  { href: "/dam",      label: "Asset Library" },
  { href: "/dam/upload", label: "Upload" },
  { href: "/dashboard", label: "Dashboard" },
] as const;

export default function NavBar() {
  const pathname = usePathname();
  const [auth, setAuth]   = useState<boolean | null>(null);
  const [open, setOpen]   = useState(false);

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then(r => r.json())
      .then(d => setAuth(Boolean(d?.authenticated)));
  }, []);

  if (!auth || pathname === "/login") return null;

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <nav className="app-nav">
      <div className="nav-inner">
        {/* Logo */}
        <a href="/" className="nav-brand">
          <img src="/fav-logo-2026.png" alt="CV" height={28} />
          <span>Cloud Vision</span>
        </a>

        {/* Desktop links */}
        <div className="nav-links">
          {NAV_ITEMS.map(item => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <a key={item.href} href={item.href} className={`nav-link${active ? " active" : ""}`}>
                {item.label}
              </a>
            );
          })}
        </div>

        {/* Logout */}
        <button className="ghost nav-logout" onClick={logout} style={{ padding: "6px 14px", fontSize: "0.88rem" }}>
          Sign out
        </button>

        {/* Mobile hamburger */}
        <button className="nav-hamburger ghost" onClick={() => setOpen(o => !o)} aria-label="Menu">
          {open ? "✕" : "☰"}
        </button>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="nav-mobile">
          {NAV_ITEMS.map(item => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <a key={item.href} href={item.href} className={`nav-mobile-link${active ? " active" : ""}`} onClick={() => setOpen(false)}>
                {item.label}
              </a>
            );
          })}
          <button className="ghost" onClick={logout} style={{ width: "100%", textAlign: "left", marginTop: 8 }}>
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}
