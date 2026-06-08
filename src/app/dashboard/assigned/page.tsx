"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { BASE_URL } from "@/config/api";
import styles from "./assigned.module.css";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AssignedTask {
  task_id: number;
  document_id: number;
  requested_by: string;
  user_reason: string;
  status: "Assigned" | "InReview";
  created_at: string;
  updated_at: string;
  file_name: string;
  file_path: string;
  file_type: string | null;
  language: string | null;
  priority: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const STATUS_STYLES: Record<string, { cls: string; icon: string }> = {
  Assigned: { cls: "statusAssigned", icon: "bi-person-check" },
  InReview: { cls: "statusInReview", icon: "bi-eye"          },
};

const PRIORITY_STYLES: Record<string, string> = {
  Low:      "priorityLow",
  Medium:   "priorityMedium",
  High:     "priorityHigh",
  Critical: "priorityCritical",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function AssignedTasksPage() {
  const router = useRouter();

  const [tasks, setTasks]     = useState<AssignedTask[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Filters
  const [search,   setSearch]   = useState("");
  const [status,   setStatus]   = useState("");
  const [priority, setPriority] = useState("");

  // Pagination
  const [page, setPage] = useState(1);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${BASE_URL}/annotator/tasks/assigned`, {
        method: "GET",
        credentials: "include",
      });

      if (!res.ok) throw new Error(`Error ${res.status}: ${res.statusText}`);

      const data: AssignedTask[] = await res.json();

      // Client-side filtering
      let filtered = data;
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(
          (t) =>
            t.file_name.toLowerCase().includes(q) ||
            t.requested_by.toLowerCase().includes(q) ||
            t.user_reason.toLowerCase().includes(q) ||
            (t.language ?? "").toLowerCase().includes(q)
        );
      }
      if (status)   filtered = filtered.filter((t) => t.status === status);
      if (priority) filtered = filtered.filter((t) => t.priority === priority);

      setTotal(filtered.length);

      // Client-side pagination
      const offset = (page - 1) * PAGE_SIZE;
      setTasks(filtered.slice(offset, offset + PAGE_SIZE));
    } catch (err: any) {
      setError(err.message ?? "Failed to fetch tasks.");
    } finally {
      setLoading(false);
    }
  }, [page, search, status, priority]);

  useEffect(() => { setPage(1); }, [search, status, priority]);
  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>

      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <h2 className={styles.title}>Assigned Tasks</h2>
          {!loading && !error && (
            <span className={styles.totalBadge}>{total} total</span>
          )}
        </div>
      </div>

      {/* ── Filters ── */}
      <div className={styles.filters}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search by file name, user, language or reason…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className={styles.select}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="Assigned">Assigned</option>
          <option value="InReview">In Review</option>
        </select>
        <select
          className={styles.select}
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="">All Priorities</option>
          <option value="Low">Low</option>
          <option value="Medium">Medium</option>
          <option value="High">High</option>
          <option value="Critical">Critical</option>
        </select>
      </div>

      {/* ── Table ── */}
      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.stateWrap}>
            <span className={styles.spinner} />
            <p>Loading tasks…</p>
          </div>
        ) : error ? (
          <div className={styles.stateWrap}>
            <p className={styles.errorText}>{error}</p>
            <button className={styles.retryBtn} onClick={fetchTasks}>Retry</button>
          </div>
        ) : tasks.length === 0 ? (
          <div className={styles.stateWrap}>
            <i className={`bi bi-list-task ${styles.emptyIcon}`} />
            <p className={styles.emptyText}>No tasks found.</p>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Task ID</th>
                <th>File Name</th>
                <th>Type</th>
                <th>Language</th>
                <th>Requested By</th>
                <th>Reason</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Assigned On</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const s = STATUS_STYLES[task.status];
                const priorityCls = PRIORITY_STYLES[task.priority] ?? "priorityLow";
                return (
                  <tr key={task.task_id}>
                    <td className={styles.idCell}>
                      <button
                        className={styles.taskIdBtn}
                        onClick={() => router.push(`/dashboard/assigned/task/${task.task_id}`)}
                        title="View task details"
                      >
                        #{task.task_id}
                        <i className="bi bi-arrow-right-short" />
                      </button>
                    </td>
                    <td className={styles.fileCell}>
                      <i className={`bi bi-file-earmark-text ${styles.fileIcon}`} />
                      {task.file_name}
                    </td>
                    <td>
                      <span className={styles.fileType}>
                        {task.file_type?.toUpperCase() ?? "—"}
                      </span>
                    </td>
                    <td className={styles.langCell}>{task.language ?? "—"}</td>
                    <td className={styles.userCell}>{task.requested_by}</td>
                    <td className={styles.reasonCell}>
                      <span title={task.user_reason}>{task.user_reason}</span>
                    </td>
                    <td>
                      <span className={`${styles.priorityBadge} ${styles[priorityCls]}`}>
                        {task.priority}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.statusBadge} ${styles[s.cls]}`}>
                        <i className={`bi ${s.icon}`} />
                        {task.status === "InReview" ? "In Review" : task.status}
                      </span>
                    </td>
                    <td className={styles.dateCell}>{formatDate(task.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
      {!loading && !error && totalPages > 1 && (
        <div className={styles.pagination}>
          <button className={styles.pageBtn} disabled={page === 1} onClick={() => setPage(1)}>«</button>
          <button className={styles.pageBtn} disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹</button>

          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
            .reduce<(number | "...")[]>((acc, p, idx, arr) => {
              if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("...");
              acc.push(p);
              return acc;
            }, [])
            .map((p, i) =>
              p === "..." ? (
                <span key={`ellipsis-${i}`} className={styles.ellipsis}>…</span>
              ) : (
                <button
                  key={p}
                  className={`${styles.pageBtn} ${page === p ? styles.pageBtnActive : ""}`}
                  onClick={() => setPage(p as number)}
                >
                  {p}
                </button>
              )
            )}

          <button className={styles.pageBtn} disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
          <button className={styles.pageBtn} disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
          <span className={styles.pageInfo}>Page {page} of {totalPages}</span>
        </div>
      )}

    </div>
  );
}