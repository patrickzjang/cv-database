"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

// ─── Inline SVG Icons (stroke-based, 20×20) ────────────────────────────────

function IconDashboard() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="7" height="8" rx="1.5" />
      <rect x="11" y="2" width="7" height="5" rx="1.5" />
      <rect x="2" y="12" width="7" height="6" rx="1.5" />
      <rect x="11" y="9" width="7" height="9" rx="1.5" />
    </svg>
  );
}

function IconProducts() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2 L17.5 6 L17.5 14 L10 18 L2.5 14 L2.5 6 Z" />
      <path d="M10 18 L10 10" />
      <path d="M17.5 6 L10 10 L2.5 6" />
    </svg>
  );
}

function IconAssetLibrary() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="16" height="14" rx="2" />
      <circle cx="7" cy="8" r="1.8" />
      <path d="M2 14 L6 10.5 L9 13 L13 8.5 L18 13.5" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13 L10 3" />
      <path d="M6 6.5 L10 3 L14 6.5" />
      <path d="M3 13 L3 15.5 C3 16.3 3.7 17 4.5 17 L15.5 17 C16.3 17 17 16.3 17 15.5 L17 13" />
    </svg>
  );
}

function IconPricing() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2 L10 18" /><path d="M7 5 L12 5 C13.7 5 15 6.3 15 8 C15 9.7 13.7 11 12 11 L7 11" />
      <path d="M7 11 L13 11 C14.7 11 16 12.3 16 14 C16 15.7 14.7 17 13 17 L7 17" />
    </svg>
  );
}

function IconInventory() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="16" height="14" rx="2" />
      <path d="M2 8 L18 8" /><path d="M8 8 L8 17" />
    </svg>
  );
}

function IconReport() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 17 L4 8" /><path d="M8 17 L8 5" /><path d="M12 17 L12 10" /><path d="M16 17 L16 3" />
    </svg>
  );
}

function IconAfterSales() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10 L3 5 C3 3.9 3.9 3 5 3 L15 3 C16.1 3 17 3.9 17 5 L17 10" />
      <path d="M1 10 L19 10" /><path d="M7 13 L13 13" /><path d="M5 17 L15 17" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="3" />
      <path d="M10 2 L10 4 M10 16 L10 18 M3.5 5 L5.2 6.2 M14.8 13.8 L16.5 15 M2 10 L4 10 M16 10 L18 10 M3.5 15 L5.2 13.8 M14.8 6.2 L16.5 5" />
    </svg>
  );
}

function IconSuppliers() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="6" r="3" /><path d="M4 17 C4 13.7 6.7 11 10 11 C13.3 11 16 13.7 16 17" />
    </svg>
  );
}

function IconPlatformFee() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="16" height="12" rx="2" />
      <path d="M2 9 L18 9" />
      <path d="M6 13 L9 13" />
      <path d="M12 13 L14 13" />
    </svg>
  );
}

function IconStockAlert() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3 L18 16 L2 16 Z" />
      <path d="M10 9 L10 12" />
      <circle cx="10" cy="14" r="0.5" fill="currentColor" />
    </svg>
  );
}

function IconCollapse() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4 L7 10 L12 16" />
    </svg>
  );
}

function IconExpand() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 4 L13 10 L8 16" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 13.5 L16.5 10 L12.5 6.5" />
      <path d="M16.5 10 L7 10" />
      <path d="M7 3.5 L4.5 3.5 C3.7 3.5 3 4.2 3 5 L3 15 C3 15.8 3.7 16.5 4.5 16.5 L7 16.5" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 5 L17 5" /><path d="M3 10 L17 10" /><path d="M3 15 L17 15" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M5 5 L15 15" /><path d="M15 5 L5 15" />
    </svg>
  );
}

// ─── Nav config ─────────────────────────────────────────────────────────────

type NavSection = { label?: string; items: { href: string; label: string; icon: ReactNode }[] };

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/dashboard",     label: "Dashboard",     icon: <IconDashboard /> },
    ],
  },
  {
    label: "Products",
    items: [
      { href: "/",              label: "Search",        icon: <IconProducts /> },
      { href: "/products/pricing", label: "Pricing",    icon: <IconPricing /> },
      { href: "/products/suppliers", label: "Suppliers", icon: <IconSuppliers /> },
    ],
  },
  {
    label: "Assets",
    items: [
      { href: "/dam",           label: "Asset Library",  icon: <IconAssetLibrary /> },
      { href: "/dam/upload",    label: "Upload",         icon: <IconUpload /> },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/inventory",            label: "Inventory",      icon: <IconInventory /> },
      { href: "/after-sales",          label: "After-Sales",    icon: <IconAfterSales /> },
      { href: "/reports/profit-loss",   label: "Profit & Loss", icon: <IconReport /> },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/settings/platform-fees", label: "Platform Fees", icon: <IconPlatformFee /> },
      { href: "/settings/alerts",        label: "Stock Alerts",  icon: <IconStockAlert /> },
    ],
  },
];

const ALL_ITEMS = NAV_SECTIONS.flatMap(s => s.items);

// ─── Component ──────────────────────────────────────────────────────────────

export default function NavBar() {
  const pathname = usePathname();
  const [auth, setAuth]       = useState<boolean | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then(r => r.json())
      .then(d => setAuth(Boolean(d?.authenticated)));
  }, [pathname]);

  if (!auth || pathname === "/login" || pathname.startsWith("/returns")) return null;

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <>
      {/* ── Desktop sidebar ── */}
      <aside className={`sidebar${collapsed ? " sidebar-collapsed" : ""}`}>
        {/* Brand */}
        <a href="/" className="sidebar-brand">
          {collapsed
            ? <img src="/favicon.png" alt="CV" className="sidebar-logo" />
            : <img src="/assets/cv-wordmark.png" alt="Cloud Vision" className="sidebar-wordmark" />
          }
        </a>

        {/* Nav links */}
        <nav className="sidebar-nav">
          {NAV_SECTIONS.map((section, si) => (
            <div key={si}>
              {section.label && !collapsed && (
                <div style={{ padding: "12px 16px 4px", fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--dim)" }}>
                  {section.label}
                </div>
              )}
              {section.label && collapsed && <div style={{ height: 8 }} />}
              {section.items.map(item => (
                <a
                  key={item.href}
                  href={item.href}
                  className={`sidebar-link${isActive(item.href) ? " active" : ""}`}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="sidebar-icon">{item.icon}</span>
                  {!collapsed && <span>{item.label}</span>}
                </a>
              ))}
            </div>
          ))}
        </nav>

        {/* Bottom */}
        <div className="sidebar-bottom">
          <button
            className="sidebar-link sidebar-collapse-btn"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <span className="sidebar-icon">{collapsed ? <IconExpand /> : <IconCollapse />}</span>
            {!collapsed && <span>Collapse</span>}
          </button>
          <button
            className="sidebar-link sidebar-logout"
            onClick={logout}
          >
            <span className="sidebar-icon"><IconLogout /></span>
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {/* ── Mobile top bar ── */}
      <div className="mobile-topbar">
        <a href="/" className="sidebar-brand" style={{ margin: 0 }}>
          <img src="/favicon.png" alt="CV" className="sidebar-logo" />
          <img src="/assets/cv-wordmark.png" alt="Cloud Vision" className="sidebar-wordmark" />
        </a>
        <button
          className="ghost mobile-menu-btn"
          onClick={() => setMobileOpen(o => !o)}
          aria-label="Menu"
        >
          {mobileOpen ? <IconClose /> : <IconMenu />}
        </button>
      </div>

      {mobileOpen && (
        <div className="mobile-nav-dropdown">
          {ALL_ITEMS.map(item => (
            <a
              key={item.href}
              href={item.href}
              className={`sidebar-link${isActive(item.href) ? " active" : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span>{item.label}</span>
            </a>
          ))}
          <button className="sidebar-link sidebar-logout" onClick={logout}>
            <span className="sidebar-icon"><IconLogout /></span>
            <span>Sign out</span>
          </button>
        </div>
      )}
    </>
  );
}
