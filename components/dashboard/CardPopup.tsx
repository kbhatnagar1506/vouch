import { X, Mic, TrendingUp, TrendingDown, Minus, RefreshCw, Loader2, Check, Ban, Brain } from "lucide-react";
import Logo from "./Logo";
import type { AnalyzedSubscription } from "@/lib/dashboard-types";
import { formatMemoryTimestamp } from "@/lib/memory-schema";

const verdictLabel: Record<string, string> = { renew: "Renew", hold: "Hold", cancel: "Cancel", ask: "Your call" };

interface SuccessState {
  action: "renew" | "cancel";
  name: string;
}

export default function CardPopup({
  sub,
  onClose,
  onResolve,
  mode,
  needsPhone,
  phoneNumber,
  onPhoneChange,
  resolving,
  resolveError,
  success,
}: {
  sub: AnalyzedSubscription | null;
  onClose: () => void;
  onResolve: (id: string, action: "renew" | "cancel") => void;
  mode: "demo" | "real";
  needsPhone: boolean;
  phoneNumber: string;
  onPhoneChange: (v: string) => void;
  resolving: boolean;
  resolveError: string | null;
  success: SuccessState | null;
}) {
  if (!sub) return null;
  const dead = sub.card === "closed";
  const TrendIcon = sub.trend === "up" ? TrendingUp : sub.trend === "down" ? TrendingDown : Minus;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="popup" onClick={(e) => e.stopPropagation()}>
        {/* The card itself — dead cards render grey */}
        <div className={`vcard ${dead ? "dead" : ""}`} style={{ ["--card-tint" as string]: sub.tint }}>
          <div className="vcard-chip" />
          {sub.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="vcard-brand"
              src={sub.logo}
              alt={sub.name}
              style={{ filter: dead ? "grayscale(1) opacity(.5)" : "brightness(0) invert(1)" }}
            />
          )}
          <div className="vcard-top">
            <div className="vcard-issuer">
              <Logo size={15} color={dead ? "#6b6a64" : "#fff"} /> VOUCH
            </div>
            <div className="vcard-status">{dead ? "Closed" : "Active"}</div>
          </div>
          <div className="vcard-num">{dead ? "•••• •••• •••• ✕✕✕✕" : `•••• •••• •••• ${sub.card.replace("•••• ", "")}`}</div>
          <div className="vcard-foot">
            <div>
              <span>Merchant</span>
              <strong>{sub.name}</strong>
            </div>
            <div>
              <span>Single charge</span>
              <strong>${sub.price.toFixed(2)}</strong>
            </div>
          </div>
        </div>

        {success ? (
          <div className={`popup-success ${success.action === "cancel" ? "dead" : ""}`}>
            <div className="popup-success-icon">{success.action === "renew" ? <Check size={26} /> : <Ban size={24} />}</div>
            <h3>{success.action === "renew" ? "Card minted" : "Kept it dead"}</h3>
            <p>
              {success.action === "renew"
                ? `A fresh single-use card is active for ${success.name}'s next charge.`
                : `${success.name} won't be charged on this card again.`}
            </p>
          </div>
        ) : (
          <div className="popup-body">
            <div className="popup-verdict">
              <span className={`dot ${sub.status === "ask" ? "hold" : sub.status}`} />
              <h3>{verdictLabel[sub.status]}</h3>
              <span className={`chip ${sub.status}`} style={{ marginLeft: "auto" }}>
                {sub.name} · ${sub.price.toFixed(2)}/{sub.cycle === "monthly" ? "mo" : "yr"}
              </span>
            </div>

            <p className="popup-reason">{sub.reason}</p>

            <div className="popup-evidence">
              {sub.usage30 !== undefined && (
                <div className="evidence-row">
                  <span className="k">Usage · last 30 days</span>
                  <span className="v">
                    {sub.usage30} {sub.usageUnit}
                  </span>
                </div>
              )}
              {sub.trend && (
                <div className="evidence-row">
                  <span className="k">Trend</span>
                  <span className={`v ${sub.trend === "up" ? "up" : sub.trend === "down" ? "down" : ""}`}>
                    <TrendIcon size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                    {sub.trend}
                  </span>
                </div>
              )}
              <div className="evidence-row">
                <span className="k">Price vs last charge</span>
                <span className={`v ${sub.priceChange ? "down" : ""}`}>{sub.priceChange ? `+${sub.priceChange}%` : "unchanged"}</span>
              </div>
              {sub.overlap && (
                <div className="evidence-row">
                  <span className="k">Overlap</span>
                  <span className="v down">also paying for {sub.overlap}</span>
                </div>
              )}
              <div className="evidence-row">
                <span className="k">Renews in</span>
                <span className="v">{sub.renewsIn === null ? "unknown" : `${sub.renewsIn} day${sub.renewsIn === 1 ? "" : "s"}`}</span>
              </div>
            </div>

            {sub.memories && sub.memories.length > 0 && (
              <div className="popup-memories">
                <div className="popup-memories-head">
                  <Brain size={13} />
                  <span>What Vouch remembers · {sub.memories.length} from Backboard</span>
                </div>
                {/* Raw retrieved memories, verbatim and in Backboard's own
                    relevance order — nothing here is summarized or rewritten. */}
                <ul className="memory-list">
                  {sub.memories.map((memory) => (
                    <li key={memory.id} className="memory-item">
                      <p className="memory-content">{memory.content}</p>
                      <div className="memory-meta">
                        {memory.score !== null && <span className="memory-score">{memory.score.toFixed(2)} match</span>}
                        {memory.createdAt && <span>{formatMemoryTimestamp(memory.createdAt)}</span>}
                        {Object.entries(memory.metadata).map(([key, value]) => (
                          <span key={key} className="memory-tag">
                            {key}: {value}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {mode === "real" && needsPhone && (
              <div className="popup-phone">
                <label htmlFor="popup-phone-input">Phone number (required once, for Stripe 3D Secure)</label>
                <input
                  id="popup-phone-input"
                  type="tel"
                  placeholder="+1 555 555 5555"
                  value={phoneNumber}
                  onChange={(e) => onPhoneChange(e.target.value)}
                />
                <p className="popup-phone-note">Used only to set up card issuance. Continuing counts as accepting Stripe's cardholder terms.</p>
              </div>
            )}

            {resolveError && <p className="popup-error">{resolveError}</p>}

            <div className="popup-actions">
              <button className="btn btn-renew" disabled={resolving} onClick={() => onResolve(sub.id, "renew")}>
                {resolving ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Mint card & renew
              </button>
              <button className="btn btn-cancel" disabled={resolving} onClick={() => onResolve(sub.id, "cancel")}>
                Keep it dead
              </button>
            </div>

            <div className="voice-hint">
              <Mic size={14} /> Vouch can ask you this out loud — answer &ldquo;renew&rdquo; or &ldquo;cancel.&rdquo;
            </div>
          </div>
        )}

        <button onClick={onClose} style={{ position: "absolute", top: 18, right: 18, color: "#fff", opacity: 0.85 }} aria-label="Close">
          <X size={20} />
        </button>
      </div>
    </div>
  );
}
