"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import { BASE_URL } from "@/config/api";
import styles from "./layout.module.css";

interface AnnotatorInfo {
  annotator_id: number;
  name: string;
  username: string;
  email?: string;
  is_active?: boolean;
  created_at?: string;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [annotator, setAnnotator] = useState<AnnotatorInfo | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const fetchMe = async () => {
      try {
        const res = await fetch(`${BASE_URL}/annotator/me`, {
          method: "GET",
          credentials: "include",
        });

        if (!res.ok) {
          // Not authenticated — send back to login
          router.replace("/");
          return;
        }

        const data: AnnotatorInfo = await res.json();
        setAnnotator(data);
      } catch {
        router.replace("/");
      } finally {
        setChecking(false);
      }
    };

    fetchMe();
  }, [router]);

  // Block render until auth check is done to avoid flicker
  if (checking) {
    return (
      <div className={styles.loadingScreen}>
        <span className={styles.spinner} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header annotatorName={annotator?.name || annotator?.username} />
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}