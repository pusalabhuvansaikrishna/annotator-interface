"use client";

import { usePathname, useRouter } from "next/navigation";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { label: "Assigned Tasks",  href: "/dashboard/assigned",  icon: "bi-list-task" },
  { label: "Completed Tasks", href: "/dashboard/completed", icon: "bi-check2-square" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className={styles.sidebar}>
      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <button
              key={item.href}
              className={`${styles.navItem} ${isActive ? styles.active : ""}`}
              onClick={() => router.push(item.href)}
            >
              <i className={`bi ${item.icon} ${styles.icon}`} />
              <span className={styles.label}>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}