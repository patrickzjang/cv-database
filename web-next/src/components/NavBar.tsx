"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useRef } from "react";

/* ── Navigation structure ───────────────────────────────────────────────── */
type NavLink = { href: string; label: string };
type NavGroup = { label: string; children: NavLink[] };
type NavItem = NavLink | NavGroup;

const NAV_ITEMS: NavItem[] = [
  {
    label: "Products",
    children: [
      { href: "/",                  label: "Search" },
      { href: "/products/pricing",  label: "Pricing" },
      { href: "/products/suppliers",label: "Suppliers" },
    ],
  },
  {
    label: "Assets",
    children: [
      { href: "/dam",        label: "Asset Library" },
      { href: "/dam/upload", label: "Upload" },
    ],
  },
  { href: "/inventory", label: "Inventory" },
  {
    label: "Reports",
    children: [
      { href: "/dashboard",           label: "Dashboard" },
      { href: "/reports/profit-loss",  label: "Profit & Loss" },
    ],
  },
  { href: "/after-sales", label: "After-Sales" },
  {
    label: "Settings",
    children: [
      { href: "/settings/platform-fees", label: "Platform Fees" },
      { href: "/settings/alerts",        label: "Stock Alerts" },
    ],
  },
];

function isGroup(item: NavItem): item is NavGroup {
  return "children" in item;
}

function isActiveGroup(group: NavGroup, pathname: string): boolean {
  return group.children.some(c =>
    c.href === "/" ? pathname === "/" : pathname.startsWith(c.href),
  );
}

function isActiveLink(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/* ── Dropdown component ─────────────────────────────────────────────────── */
function NavDropdown({ group, pathname }: { group: NavGroup; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = isActiveGroup(group, pathname);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className={`nav-link nav-dropdown-trigger${active ? " active" : ""}`}
        onClick={() => setOpen(o => !o)}
        style={{ background: "none", border: "none", font: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}
      >
        {group.label}
        <svg width="10" height="6" viewBox="0 0 10 6" style={{ opacity: 0.5, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="nav-dropdown" style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 170,
          background: "var(--surface)", border: "1px solid var(--border-2)",
          borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
          padding: "6px 0", zIndex: 100, animation: "fadeIn 0.12s ease-out",
        }}>
          {group.children.map(child => (
            <a
              key={child.href}
              href={child.href}
              onClick={() => setOpen(false)}
              style={{
                display: "block", padding: "8px 16px", fontSize: "0.88rem",
                color: isActiveLink(child.href, pathname) ? "var(--app-accent)" : "var(--text)",
                fontWeight: isActiveLink(child.href, pathname) ? 600 : 400,
                textDecoration: "none", transition: "background 0.1s",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              {child.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── NavBar ─────────────────────────────────────────────────────────────── */
export default function NavBar() {
  const pathname = usePathname();
  const [auth, setAuth] = useState<boolean | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then(r => r.json())
      .then(d => setAuth(Boolean(d?.authenticated)));
  }, []);

  if (!auth || pathname === "/login" || pathname.startsWith("/returns")) return null;

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  // Flatten all links for mobile menu
  const allLinks: NavLink[] = NAV_ITEMS.flatMap(item =>
    isGroup(item) ? item.children : [item],
  );

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
          {NAV_ITEMS.map((item, i) =>
            isGroup(item) ? (
              <NavDropdown key={i} group={item} pathname={pathname} />
            ) : (
              <a
                key={item.href}
                href={item.href}
                className={`nav-link${isActiveLink(item.href, pathname) ? " active" : ""}`}
              >
                {item.label}
              </a>
            ),
          )}
        </div>

        {/* Logout */}
        <button className="ghost nav-logout" onClick={logout} style={{ padding: "6px 14px", fontSize: "0.88rem" }}>
          Sign out
        </button>

        {/* Mobile hamburger */}
        <button className="nav-hamburger ghost" onClick={() => setMobileOpen(o => !o)} aria-label="Menu">
          {mobileOpen ? "✕" : "☰"}
        </button>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="nav-mobile">
          {allLinks.map(link => {
            const active = isActiveLink(link.href, pathname);
            return (
              <a
                key={link.href}
                href={link.href}
                className={`nav-mobile-link${active ? " active" : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
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
