"use client";

import { useEffect, useRef, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

type Mode = "login" | "signup";

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-3.27 2.6A9.14 9.14 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 4.22-5.94" />
        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
        <path d="M1 1l22 22" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

const FADE_MS = 160;

export default function AuthForm({ initialMode }: { initialMode: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [displayMode, setDisplayMode] = useState<Mode>(initialMode);
  const [fading, setFading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  const firstFieldRef = useRef<HTMLInputElement>(null);

  const isLogin = displayMode === "login";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!fading) {
      firstFieldRef.current?.focus();
      return;
    }
    const t = setTimeout(() => {
      setDisplayMode(mode);
      setFading(false);
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [fading, mode]);

  function switchMode(next: Mode) {
    if (next === mode) return;
    setError(null);
    setMode(next);
    setFading(true);
    window.history.replaceState(null, "", `/${next}`);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/auth/${isLogin ? "login" : "signup"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isLogin
            ? { email, password, rememberMe }
            : { name: name.trim(), email, password },
        ),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }

      if (isLogin) {
        router.push("/login-extend");
      } else {
        router.push("/signup-extend");
      }
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  const passwordTooShort = !isLogin && password.length > 0 && password.length < 8;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50 px-4 py-8">
      <div
        className={`w-full max-w-[400px] rounded-[20px] border border-slate-100 bg-white p-9 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.08)] transition-all duration-500 ${
          mounted ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        <div className="mb-7 flex justify-center">
          <Image src="/logo1.png" alt="Vouch" width={1580} height={482} className="h-14 w-auto object-contain" priority />
        </div>

        <div className="relative mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={`relative z-10 rounded-lg py-2.5 text-sm font-semibold transition-colors ${
              mode === "login" ? "text-white" : "text-slate-500"
            }`}
          >
            Log In
          </button>
          <button
            type="button"
            onClick={() => switchMode("signup")}
            className={`relative z-10 rounded-lg py-2.5 text-sm font-semibold transition-colors ${
              mode === "signup" ? "text-white" : "text-slate-500"
            }`}
          >
            Sign Up
          </button>
          <span
            className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-lg bg-blue-600 transition-transform duration-250 ease-out ${
              mode === "login" ? "translate-x-0" : "translate-x-full"
            }`}
          />
        </div>

        <div
          className={`transition-opacity ease-out ${fading ? "opacity-0" : "opacity-100"}`}
          style={{ transitionDuration: `${FADE_MS}ms` }}
        >
          <h1 className="mb-1.5 text-2xl font-bold tracking-tight text-slate-900">
            {isLogin ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mb-6 text-sm text-slate-500">
            {isLogin
              ? "Log in to continue to your account"
              : "Sign up to get started with Vouch"}
          </p>

          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            {!isLogin && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="name" className="text-[13px] font-semibold text-slate-700">
                  Full name
                </label>
                <input
                  ref={firstFieldRef}
                  id="name"
                  type="text"
                  placeholder="Jane Doe"
                  autoComplete="name"
                  required
                  disabled={loading}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-[10px] border-[1.5px] border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100 disabled:opacity-60"
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-[13px] font-semibold text-slate-700">
                Email
              </label>
              <input
                ref={isLogin ? firstFieldRef : undefined}
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
                disabled={loading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-[10px] border-[1.5px] border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100 disabled:opacity-60"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <label htmlFor="password" className="text-[13px] font-semibold text-slate-700">
                  Password
                </label>
                {!isLogin && (
                  <span
                    className={`text-[11px] font-medium ${
                      password.length === 0
                        ? "text-slate-400"
                        : passwordTooShort
                          ? "text-red-500"
                          : "text-emerald-600"
                    }`}
                  >
                    {password.length === 0
                      ? "At least 8 characters"
                      : passwordTooShort
                        ? `${8 - password.length} more to go`
                        : "Looks good"}
                  </span>
                )}
              </div>
              <div className="relative flex items-center">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  required
                  minLength={8}
                  disabled={loading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-[10px] border-[1.5px] border-slate-200 bg-slate-50 px-3.5 py-2.5 pr-11 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2.5 flex items-center justify-center rounded p-1 text-slate-400 transition-colors hover:text-blue-600"
                >
                  <EyeIcon open={showPassword} />
                </button>
              </div>
            </div>

            {isLogin && (
              <label className="flex select-none items-center gap-2 text-[13px] text-slate-600">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                />
                Remember me
              </label>
            )}

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
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-[10px] bg-blue-600 py-3 text-[15px] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Spinner />}
              {loading ? "Please wait…" : isLogin ? "Log In" : "Create Account"}
            </button>
          </form>

          <p className="mt-5 text-center text-[13px] text-slate-500">
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => switchMode(isLogin ? "signup" : "login")}
              className="font-bold text-blue-600"
            >
              {isLogin ? "Sign up" : "Log in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
