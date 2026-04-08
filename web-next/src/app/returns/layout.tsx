import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "Returns & Exchanges - Cloud Vision",
  description: "Submit and track your return requests",
};

export default function ReturnsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh" }}>
      {/* Simple header with logo only */}
      <header style={{ padding: "16px 24px", borderBottom: "1px solid var(--border-2)", background: "var(--surface)", display: "flex", alignItems: "center", gap: 10 }}>
        <img src="/favicon.png" alt="CV" height={24} />
        <span style={{ fontWeight: 600, fontSize: "1.05rem" }}>Returns & Exchanges</span>
      </header>
      {children}
    </div>
  );
}
