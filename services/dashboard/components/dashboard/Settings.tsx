import { useState } from "react";
import type { DashboardUser } from "@/lib/dashboard-types";

export default function Settings({ user, mode }: { user: DashboardUser; mode: "demo" | "real" }) {
  const [decisionMode, setDecisionMode] = useState<"fast" | "careful">("careful");
  const [tone, setTone] = useState<"terse" | "friendly">("terse");
  const [voiceOn, setVoiceOn] = useState(true);
  const [neverCancel, setNeverCancel] = useState(true);
  const [askOver, setAskOver] = useState(true);

  return (
    <>
      <div className="page-head">
        <div className="page-title">Settings</div>
        <div className="page-sub">How Vouch decides, and how it reaches you.</div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Account</div>
          </div>
          <div className="panel-pad">
            <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 18, borderBottom: "1px solid var(--line)" }}>
              <div className="avatar" style={{ width: 48, height: 48, fontSize: 16 }}>
                {user.initials}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{user.name}</div>
                <div style={{ color: "var(--ink-3)", fontSize: 13 }}>{user.email}</div>
              </div>
            </div>
            <div className="set-row">
              <div>
                <div className="set-label">Plan</div>
                <div className="set-desc">Member since {user.memberSince}</div>
              </div>
              <span className="chip ask">{user.plan}</span>
            </div>
            <div className="set-row">
              <div>
                <div className="set-label">Notifications</div>
                <div className="set-desc">Get a ping when a decision needs you.</div>
              </div>
              <div className="toggle on" />
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Decision engine</div>
          </div>
          <div className="panel-pad">
            {mode === "real" && <p className="settings-note">Preview controls — the current build always uses the careful, rule-based logic described in Analysis.</p>}
            <div className="set-row">
              <div>
                <div className="set-label">Decision mode</div>
                <div className="set-desc">Fast decides more on its own with a cheaper model. Careful asks you more often.</div>
              </div>
              <div className="seg">
                <button className={decisionMode === "fast" ? "on" : ""} onClick={() => setDecisionMode("fast")}>
                  Fast
                </button>
                <button className={decisionMode === "careful" ? "on" : ""} onClick={() => setDecisionMode("careful")}>
                  Careful
                </button>
              </div>
            </div>
            <div className="set-row">
              <div>
                <div className="set-label">Never cancel Spotify</div>
                <div className="set-desc">Always renew, no matter the usage.</div>
              </div>
              <button className={`toggle ${neverCancel ? "on" : ""}`} onClick={() => setNeverCancel(!neverCancel)} />
            </div>
            <div className="set-row">
              <div>
                <div className="set-label">Ask me about anything over $30</div>
                <div className="set-desc">Higher charges always come to you first.</div>
              </div>
              <button className={`toggle ${askOver ? "on" : ""}`} onClick={() => setAskOver(!askOver)} />
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Voice</div>
          </div>
          <div className="panel-pad">
            <div className="set-row">
              <div>
                <div className="set-label">Voice prompts</div>
                <div className="set-desc">Vouch calls you out loud at decision moments.</div>
              </div>
              <button className={`toggle ${voiceOn ? "on" : ""}`} onClick={() => setVoiceOn(!voiceOn)} />
            </div>
            <div className="set-row">
              <div>
                <div className="set-label">Tone</div>
                <div className="set-desc">How the voice speaks to you.</div>
              </div>
              <div className="seg">
                <button className={tone === "terse" ? "on" : ""} onClick={() => setTone("terse")}>
                  Terse
                </button>
                <button className={tone === "friendly" ? "on" : ""} onClick={() => setTone("friendly")}>
                  Friendly
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Cards</div>
          </div>
          <div className="panel-pad">
            <div className="set-row">
              <div>
                <div className="set-label">Close card after each charge</div>
                <div className="set-desc">The core rule. Every card dies after one use.</div>
              </div>
              <div className="toggle on" />
            </div>
            <div className="set-row">
              <div>
                <div className="set-label">Issuer</div>
                <div className="set-desc">Where new cards are minted.</div>
              </div>
              <span className="chip renew">Stripe · sandbox</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
