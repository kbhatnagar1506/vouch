"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const EMPLOYMENT_STATUSES = [
  "Employed",
  "Self-employed",
  "Student",
  "Unemployed",
  "Retired",
  "Other",
];

const INCOME_RANGES = [
  "Under $25,000",
  "$25,000–$50,000",
  "$50,000–$100,000",
  "$100,000–$200,000",
  "$200,000+",
  "Prefer not to say",
];

const FINANCIAL_GOALS = [
  "Building credit",
  "Saving money",
  "Investing",
  "Budgeting / tracking spending",
  "Paying off debt",
  "Other",
];

const inputClass =
  "w-full rounded-[10px] border-[1.5px] border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100 disabled:opacity-60";
const labelClass = "text-[13px] font-semibold text-slate-700";
const sectionTitleClass = "mb-3 text-sm font-bold text-slate-900";

function Spinner() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export default function OnboardingForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [age, setAge] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [addressStreet, setAddressStreet] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressZip, setAddressZip] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("");
  const [incomeRange, setIncomeRange] = useState("");
  const [financialGoal, setFinancialGoal] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          age,
          phoneNumber,
          addressStreet,
          addressCity,
          addressState,
          addressZip,
          employmentStatus,
          incomeRange,
          financialGoal,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      router.push("/login-extend");
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50 px-4 py-10">
      <div className="w-full max-w-[540px] rounded-[20px] border border-slate-100 bg-white p-9 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.08)]">
        <div className="mb-7 flex items-center gap-2">
          <Image src="/logo1.png" alt="" width={32} height={32} className="h-8 w-8 object-contain" priority />
          <span className="text-lg font-bold tracking-tight text-slate-900">
            Vouch
          </span>
        </div>

        <h1 className="mb-1.5 text-2xl font-bold tracking-tight text-slate-900">
          Let&apos;s personalize your account
        </h1>
        <p className="mb-7 text-sm text-slate-500">
          A few details help us tailor Vouch to your finances.
        </p>

        <form className="flex flex-col gap-8" onSubmit={handleSubmit}>
          <section>
            <h2 className={sectionTitleClass}>About you</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="age" className={labelClass}>Age</label>
                <input
                  id="age"
                  type="number"
                  min={18}
                  max={120}
                  required
                  disabled={loading}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="phoneNumber" className={labelClass}>Phone number</label>
                <input
                  id="phoneNumber"
                  type="tel"
                  placeholder="(555) 123-4567"
                  autoComplete="tel"
                  required
                  disabled={loading}
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          <section>
            <h2 className={sectionTitleClass}>Address</h2>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="addressStreet" className={labelClass}>Street address</label>
                <input
                  id="addressStreet"
                  type="text"
                  autoComplete="address-line1"
                  required
                  disabled={loading}
                  value={addressStreet}
                  onChange={(e) => setAddressStreet(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="addressCity" className={labelClass}>City</label>
                  <input
                    id="addressCity"
                    type="text"
                    autoComplete="address-level2"
                    required
                    disabled={loading}
                    value={addressCity}
                    onChange={(e) => setAddressCity(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="addressState" className={labelClass}>State</label>
                  <input
                    id="addressState"
                    type="text"
                    autoComplete="address-level1"
                    required
                    disabled={loading}
                    value={addressState}
                    onChange={(e) => setAddressState(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="addressZip" className={labelClass}>ZIP</label>
                  <input
                    id="addressZip"
                    type="text"
                    autoComplete="postal-code"
                    required
                    disabled={loading}
                    value={addressZip}
                    onChange={(e) => setAddressZip(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className={sectionTitleClass}>Your finances</h2>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="employmentStatus" className={labelClass}>Employment status</label>
                <select
                  id="employmentStatus"
                  required
                  disabled={loading}
                  value={employmentStatus}
                  onChange={(e) => setEmploymentStatus(e.target.value)}
                  className={inputClass}
                >
                  <option value="" disabled>Select one</option>
                  {EMPLOYMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="incomeRange" className={labelClass}>Annual income</label>
                <select
                  id="incomeRange"
                  required
                  disabled={loading}
                  value={incomeRange}
                  onChange={(e) => setIncomeRange(e.target.value)}
                  className={inputClass}
                >
                  <option value="" disabled>Select a range</option>
                  {INCOME_RANGES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="financialGoal" className={labelClass}>Primary financial goal</label>
                <select
                  id="financialGoal"
                  required
                  disabled={loading}
                  value={financialGoal}
                  onChange={(e) => setFinancialGoal(e.target.value)}
                  className={inputClass}
                >
                  <option value="" disabled>Select a goal</option>
                  {FINANCIAL_GOALS.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section>
            <h2 className={sectionTitleClass}>Connect your bank</h2>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
              <div>
                <p className="text-[13px] font-semibold text-slate-700">Plaid bank connection</p>
                <p className="text-[12px] text-slate-500">You can connect your bank later from your account.</p>
              </div>
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded-[10px] border-[1.5px] border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-bold text-slate-400"
              >
                Coming soon
              </button>
            </div>
          </section>

          {error && (
            <p
              role="alert"
              className="animate-[shake_0.35s_ease-in-out] rounded-lg bg-red-50 px-3 py-2 text-[13px] font-medium text-red-600"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-blue-600 py-3 text-[15px] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && <Spinner />}
            {loading ? "Saving…" : "Finish setup"}
          </button>
        </form>
      </div>
    </div>
  );
}
