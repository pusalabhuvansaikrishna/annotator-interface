"use client";

import Image from "next/image";
import { useState } from "react";
import { BASE_URL } from "@/config/api";
import styles from "./Header.module.css";

interface HeaderProps {
  annotatorName?: string;
}

export default function Header({ annotatorName }: HeaderProps) {
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch(`${BASE_URL}/annotator/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // best-effort
    } finally {
      document.cookie =
        "has_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
      window.location.href = "/";
    }
  };

  return (
    <header className={styles.header}>
      <div className={styles.logoWrap}>
        <Image
          src="/iiit-logo.png"
          alt="IIIT Hyderabad Logo"
          width={120}
          height={60}
          className={styles.logoImg}
          priority
        />
      </div>

      <h1 className={styles.portalTitle}>VISHVASETU ANNOTATOR PORTAL</h1>

      <div className={styles.headerRight}>
        {annotatorName && (
          <span className={styles.greeting}>
            Hello, <strong>{annotatorName}</strong>
          </span>
        )}
        <button
          className={styles.logoutBtn}
          onClick={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </header>
  );
}