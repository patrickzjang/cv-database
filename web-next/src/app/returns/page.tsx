"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ─── Types ───────────────────────────────────────────────────────────────────

type OrderItem = {
  sku: string;
  name: string;
  qty: number;
  price: number;
};

type OrderData = {
  platform_order_id: string;
  order_date: string;
  items: OrderItem[];
};

type ReturnItem = {
  sku: string;
  name: string;
  selected: boolean;
  qty: number;
  maxQty: number;
  reason: string;
};

const REASONS = [
  "Defective",
  "Wrong Size",
  "Wrong Color",
  "Changed Mind",
  "Other",
];

// ─── Step Indicator ──────────────────────────────────────────────────────────

function StepIndicator({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) {
  const steps = ["Order Lookup", "Select Items", "Details"];
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0, marginBottom: 28 }}>
      {steps.map((label, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === currentStep;
        const isDone = stepNum < currentStep;
        const color = isActive ? "var(--cyan)" : isDone ? "var(--ok)" : "var(--border-2)";

        return (
          <div key={i} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 80 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: isDone ? "var(--ok)" : isActive ? "var(--cyan)" : "var(--surface-2)",
                border: `2px solid ${color}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.82rem", fontWeight: 700,
                color: isDone || isActive ? "#fff" : "var(--text-muted)",
              }}>
                {isDone ? "\u2713" : stepNum}
              </div>
              <div style={{
                marginTop: 6, fontSize: "0.76rem", fontWeight: 600,
                color: isActive ? "var(--text)" : "var(--text-muted)",
              }}>
                {label}
              </div>
            </div>
            {i < totalSteps - 1 && (
              <div style={{
                width: 48, height: 2, margin: "0 4px",
                marginBottom: 20,
                background: isDone ? "var(--ok)" : "var(--border-2)",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ReturnsPage() {
  const router = useRouter();

  // Step state
  const [step, setStep] = useState(1);

  // Step 1: Order Lookup
  const [lookupOrderId, setLookupOrderId] = useState("");
  const [lookupContact, setLookupContact] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [orderData, setOrderData] = useState<OrderData | null>(null);

  // Step 2: Item selection
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);

  // Step 3: Details
  const [description, setDescription] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photoInput, setPhotoInput] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Success state
  const [trackingCode, setTrackingCode] = useState<string | null>(null);

  // Track section
  const [trackInput, setTrackInput] = useState("");

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleLookup = async () => {
    setLookupLoading(true);
    setLookupError(null);
    try {
      const res = await fetch("/api/returns/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform_order_id: lookupOrderId.trim(),
          contact: lookupContact.trim(),
        }),
      });
      const json = await res.json();
      if (json.error) {
        setLookupError(json.error);
      } else {
        setOrderData(json.order);
        setReturnItems(
          (json.order.items ?? []).map((item: OrderItem) => ({
            sku: item.sku,
            name: item.name,
            selected: false,
            qty: 1,
            maxQty: item.qty,
            reason: "Defective",
          }))
        );
        setStep(2);
      }
    } catch (e: any) {
      setLookupError(e.message ?? "Network error");
    } finally {
      setLookupLoading(false);
    }
  };

  const toggleItem = (idx: number) => {
    setReturnItems((prev) =>
      prev.map((item, i) => i === idx ? { ...item, selected: !item.selected } : item)
    );
  };

  const updateItem = (idx: number, field: keyof ReturnItem, value: any) => {
    setReturnItems((prev) =>
      prev.map((item, i) => i === idx ? { ...item, [field]: value } : item)
    );
  };

  const selectedItems = returnItems.filter((i) => i.selected);

  const handleGoToStep3 = () => {
    if (selectedItems.length === 0) return;
    setStep(3);
  };

  const addPhotoUrl = () => {
    if (photoInput.trim()) {
      setPhotoUrls((prev) => [...prev, photoInput.trim()]);
      setPhotoInput("");
    }
  };

  const removePhoto = (idx: number) => {
    setPhotoUrls((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/returns/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform_order_id: orderData?.platform_order_id,
          items: selectedItems.map((i) => ({ sku: i.sku, qty: i.qty, reason: i.reason })),
          description,
          photo_urls: photoUrls,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          customer_email: customerEmail.trim(),
        }),
      });
      const json = await res.json();
      if (json.error) {
        setSubmitError(json.error);
      } else {
        setTrackingCode(json.tracking_code);
      }
    } catch (e: any) {
      setSubmitError(e.message ?? "Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTrack = () => {
    if (trackInput.trim()) {
      router.push(`/returns/${trackInput.trim()}`);
    }
  };

  // ─── Success View ────────────────────────────────────────────────────────

  if (trackingCode) {
    return (
      <div style={{ maxWidth: 520, margin: "48px auto", padding: "0 20px" }}>
        <div className="card" style={{ textAlign: "center", padding: "40px 28px" }}>
          <div style={{ fontSize: "3rem", marginBottom: 12 }}>&#10003;</div>
          <h2 style={{ color: "var(--ok)", marginBottom: 8 }}>Request Submitted</h2>
          <p className="subtitle">Your return request has been received. Use the tracking code below to check the status.</p>
          <div style={{
            background: "var(--surface-2)", borderRadius: 12, padding: "16px 24px",
            margin: "20px 0", border: "1px solid var(--border)",
          }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Tracking Code
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, letterSpacing: "0.05em", color: "var(--cyan)" }}>
              {trackingCode}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="primary" onClick={() => router.push(`/returns/${trackingCode}`)}>
              Track Status
            </button>
            <button className="ghost" onClick={() => {
              setTrackingCode(null);
              setStep(1);
              setOrderData(null);
              setReturnItems([]);
              setDescription("");
              setPhotoUrls([]);
              setCustomerName("");
              setCustomerPhone("");
              setCustomerEmail("");
            }}>
              Submit Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 720, margin: "32px auto", padding: "0 20px" }}>
      {/* Submit Return Request */}
      <h2 style={{ fontSize: "1.3rem", marginBottom: 4 }}>Submit a Return Request</h2>
      <p className="subtitle" style={{ marginBottom: 24 }}>Follow the steps below to submit your return or exchange request.</p>

      <StepIndicator currentStep={step} totalSteps={3} />

      {/* ── Step 1: Order Lookup ── */}
      {step === 1 && (
        <div className="card">
          <h3 style={{ fontSize: "1rem", marginBottom: 4 }}>Step 1: Look Up Your Order</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", marginBottom: 16 }}>
            Enter your order ID and the phone number or email used for the order.
          </p>
          <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Platform Order ID</label>
              <input
                value={lookupOrderId}
                onChange={(e) => setLookupOrderId(e.target.value)}
                placeholder="e.g. SHP-20260401-00123"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Phone or Email</label>
              <input
                value={lookupContact}
                onChange={(e) => setLookupContact(e.target.value)}
                placeholder="e.g. 0812345678 or name@email.com"
                style={{ width: "100%" }}
              />
            </div>
          </div>
          {lookupError && (
            <div style={{
              background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.25)",
              borderRadius: 10, padding: "10px 14px", color: "var(--error)", marginBottom: 12,
              fontSize: "0.88rem",
            }}>
              {lookupError}
            </div>
          )}
          <button
            className="primary"
            disabled={lookupLoading || !lookupOrderId.trim() || !lookupContact.trim()}
            onClick={handleLookup}
          >
            {lookupLoading ? "Looking up..." : "Look Up Order"}
          </button>
        </div>
      )}

      {/* ── Step 2: Select Items ── */}
      {step === 2 && orderData && (
        <div className="card">
          <h3 style={{ fontSize: "1rem", marginBottom: 4 }}>Step 2: Select Items to Return</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", marginBottom: 6 }}>
            Order: <strong>{orderData.platform_order_id}</strong> | Date: {orderData.order_date}
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: 16 }}>
            Select the items you want to return and specify a reason for each.
          </p>

          <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
            {returnItems.map((item, i) => (
              <div key={i} style={{
                border: `1px solid ${item.selected ? "var(--cyan)" : "var(--border)"}`,
                borderRadius: 12, padding: "14px 16px",
                background: item.selected ? "rgba(0,180,216,0.03)" : "var(--surface)",
                transition: "border-color 0.15s, background 0.15s",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: item.selected ? 12 : 0 }}>
                  <input
                    type="checkbox"
                    checked={item.selected}
                    onChange={() => toggleItem(i)}
                    style={{ width: 18, height: 18, accentColor: "var(--cyan)", cursor: "pointer" }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: "0.92rem" }}>{item.name}</div>
                    <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", fontFamily: "monospace" }}>{item.sku}</div>
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    Qty: {item.maxQty}
                  </div>
                </div>

                {item.selected && (
                  <div style={{ display: "flex", gap: 12, alignItems: "center", paddingLeft: 30, flexWrap: "wrap" }}>
                    <div>
                      <label style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 2 }}>Return Qty</label>
                      <input
                        type="number"
                        value={item.qty}
                        min={1}
                        max={item.maxQty}
                        onChange={(e) => updateItem(i, "qty", Math.min(parseInt(e.target.value) || 1, item.maxQty))}
                        style={{ width: 70 }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <label style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 2 }}>Reason</label>
                      <select value={item.reason} onChange={(e) => updateItem(i, "reason", e.target.value)} style={{ width: "100%" }}>
                        {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="ghost" onClick={() => setStep(1)}>Back</button>
            <button
              className="primary"
              disabled={selectedItems.length === 0}
              onClick={handleGoToStep3}
            >
              Continue ({selectedItems.length} item{selectedItems.length !== 1 ? "s" : ""})
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Details ── */}
      {step === 3 && (
        <div className="card">
          <h3 style={{ fontSize: "1rem", marginBottom: 4 }}>Step 3: Provide Details</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", marginBottom: 16 }}>
            Add a description and any supporting photos for your return.
          </p>

          <div style={{ display: "grid", gap: 14, marginBottom: 20 }}>
            {/* Description */}
            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Please describe the issue or reason for return..."
                rows={4}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>

            {/* Photo upload area */}
            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Photos (optional)</label>
              <div style={{
                border: "2px dashed var(--border-2)", borderRadius: 12, padding: "20px 16px",
                background: "var(--surface-2)", textAlign: "center", marginBottom: 8,
              }}>
                <div style={{ fontSize: "1.5rem", marginBottom: 6 }}>&#128247;</div>
                <div style={{ fontSize: "0.88rem", color: "var(--text-muted)", marginBottom: 10 }}>
                  Add photo URLs to show evidence of the issue
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                  <input
                    value={photoInput}
                    onChange={(e) => setPhotoInput(e.target.value)}
                    placeholder="Paste image URL..."
                    style={{ width: 280, maxWidth: "100%" }}
                    onKeyDown={(e) => e.key === "Enter" && addPhotoUrl()}
                  />
                  <button className="ghost" onClick={addPhotoUrl} disabled={!photoInput.trim()}>Add</button>
                </div>
              </div>
              {photoUrls.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {photoUrls.map((url, i) => (
                    <div key={i} style={{ position: "relative" }}>
                      <img src={url} alt={`Photo ${i + 1}`} style={{
                        width: 72, height: 72, objectFit: "cover", borderRadius: 8,
                        border: "1px solid var(--border-2)",
                      }} />
                      <button onClick={() => removePhoto(i)} style={{
                        position: "absolute", top: -6, right: -6, width: 20, height: 20,
                        borderRadius: "50%", background: "var(--error)", color: "#fff",
                        fontSize: "0.65rem", fontWeight: 700, display: "flex",
                        alignItems: "center", justifyContent: "center", padding: 0,
                        border: "2px solid var(--surface)",
                      }}>
                        X
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Contact info */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Your Name</label>
                <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Full name" style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Phone</label>
                <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="0812345678" style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Email</label>
                <input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="name@email.com" style={{ width: "100%" }} />
              </div>
            </div>
          </div>

          {submitError && (
            <div style={{
              background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.25)",
              borderRadius: 10, padding: "10px 14px", color: "var(--error)", marginBottom: 12,
              fontSize: "0.88rem",
            }}>
              {submitError}
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="ghost" onClick={() => setStep(2)}>Back</button>
            <button
              className="primary"
              disabled={submitting || !customerName.trim()}
              onClick={handleSubmit}
            >
              {submitting ? "Submitting..." : "Submit Return Request"}
            </button>
          </div>
        </div>
      )}

      {/* ── Divider ── */}
      <div style={{
        margin: "40px 0 28px", display: "flex", alignItems: "center", gap: 16,
      }}>
        <div style={{ flex: 1, height: 1, background: "var(--border-2)" }} />
        <span style={{ color: "var(--text-muted)", fontSize: "0.85rem", fontWeight: 600 }}>OR</span>
        <div style={{ flex: 1, height: 1, background: "var(--border-2)" }} />
      </div>

      {/* ── Track Existing ── */}
      <div className="card" style={{ marginBottom: 40 }}>
        <h3 style={{ fontSize: "1rem", marginBottom: 4 }}>Track Existing Request</h3>
        <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", marginBottom: 14 }}>
          Already submitted a return? Enter your tracking code to check the status.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={trackInput}
            onChange={(e) => setTrackInput(e.target.value)}
            placeholder="Enter tracking code..."
            style={{ flex: 1 }}
            onKeyDown={(e) => e.key === "Enter" && handleTrack()}
          />
          <button className="primary" disabled={!trackInput.trim()} onClick={handleTrack}>
            Track
          </button>
        </div>
      </div>
    </div>
  );
}
