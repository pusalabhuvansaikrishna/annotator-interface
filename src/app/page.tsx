"use client";

import { useState } from "react";
import Image from "next/image";
import styles from "./page.module.css";
import { BASE_URL } from "@/config/api";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!username.trim() || !password.trim()) {
      setError("Please enter both username and password.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${BASE_URL}/annotator/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",          // keeps the httpOnly auth cookies
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await response.json();

      if (!response.ok) {
        const detail = data.detail;
        if (typeof detail === "string") {
          setError(detail);
        } else if (Array.isArray(detail)) {
          setError(detail.map((e: { msg: string }) => e.msg).join(", "));
        } else {
          setError("Invalid credentials. Please try again.");
        }
        return;
      }

      // Persist safe annotator info for the dashboard to display
      sessionStorage.setItem("annotator", JSON.stringify(data.annotator));

      // Set a non-httpOnly sentinel cookie so the Next.js middleware can
      // detect an active session and enforce route protection server-side.
      document.cookie = "has_session=true; path=/; SameSite=Lax";

      // Hard navigate so the middleware re-runs and the dashboard SSR
      // can read the session cookie on first load.
      window.location.href = "/dashboard";
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.logoWrap}>
          <Image
            src="/iiit-logo.png"
            alt="IIIT Hyderabad Logo"
            width={237}
            height={122}
            className={styles.logoImg}
            priority
          />
        </div>
        <h1 className={styles.portalTitle}>VISHVASETU ANNOTATOR PORTAL</h1>
      </header>

      <main className={styles.main}>
        <div className={styles.illustrationWrap}>
          <Image
            src="/annotator.png"
            alt="Annotator illustration"
            width={320}
            height={380}
            className={styles.illustration}
            priority
          />
        </div>

        <div className={styles.cardWrap}>
          <div className={styles.card}>
            <form onSubmit={handleLogin} noValidate>
              <div className={styles.fieldGroup}>
                <label htmlFor="username" className={styles.label}>username</label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={styles.input}
                  spellCheck={false}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label htmlFor="password" className={styles.label}>password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={styles.input}
                />
              </div>

              {error && <p className={styles.error}>{error}</p>}

              <div className={styles.btnWrap}>
                <button type="submit" className={styles.loginBtn} disabled={loading}>
                  {loading ? <span className={styles.spinner} /> : "Login"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}