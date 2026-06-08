"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { BASE_URL } from "@/config/api";
import styles from "./completed.module.css";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompletedTask {
  task_id: number;
  status: string;
  user_reason: string;
  annotator_reason: string | null;
  updated_at: string;
  document: {
    document_id: number;
    file_name: string;
    file_type: string | null;
    version_count: number;
  } | null;
  collection: {
    collection_id: number;
    title: string;
    language: string | null;
  } | null;
}

type FetchState = "loading" | "success" | "error" | "empty";
type FilterOption = "all" | "completed" | "deleted";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isDeleted(task: CompletedTask): boolean {
  return task.document === null || task.collection === null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CompletedTasksPage() {
  const router = useRouter();

  const [tasks, setTasks] = useState<CompletedTask[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>("loading");
  const [filter, setFilter] = useState<FilterOption>("completed");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const fetchCompleted = async () => {
      try {
        const res = await fetch(`${BASE_URL}/annotator/tasks/completed`, {
          credentials: "include",
        });

        if (res.status === 401 || res.status === 403) {
          router.replace("/");
          return;
        }
        if (!res.ok) {
          setFetchState("error");
          return;
        }

        const data: CompletedTask[] = await res.json();
        setTasks(data);
        setFetchState(data.length === 0 ? "empty" : "success");
      } catch {
        setFetchState("error");
      }
    };

    fetchCompleted();
  }, [router]);

  const handleRowClick = (taskId: number) => {
    router.push(`/dashboard/assigned/task/${taskId}`);
  };

  // ── Filtering ───────────────────────────────────────────────────────────────

  const filteredTasks = useMemo(() => {
    let result = tasks;

    // Status filter
    if (filter === "completed") {
      result = result.filter((t) => !isDeleted(t));
    } else if (filter === "deleted") {
      result = result.filter((t) => isDeleted(t));
    }

    // Search filter (collection title, document name, task id)
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (t) =>
          t.collection?.title?.toLowerCase().includes(q) ||
          t.document?.file_name?.toLowerCase().includes(q) ||
          String(t.task_id).includes(q)
      );
    }

    return result;
  }, [tasks, filter, search]);

  const deletedCount = useMemo(() => tasks.filter(isDeleted).length, [tasks]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={styles.container}>

      {/* Header */}
      <div className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>Completed Tasks</h2>
        <p className={styles.pageSubtitle}>
          A record of all tasks you have finished annotating.
        </p>
      </div>

      {/* Filter bar — only shown when data is available */}
      {fetchState === "success" && (
        <div className={styles.filterBar}>
          <div className={styles.filterTabs}>
            <button
              className={`${styles.filterTab} ${filter === "all" ? styles.filterTabActive : ""}`}
              onClick={() => setFilter("all")}
            >
              All
              <span className={styles.filterCount}>{tasks.length}</span>
            </button>
            <button
              className={`${styles.filterTab} ${filter === "completed" ? styles.filterTabActive : ""}`}
              onClick={() => setFilter("completed")}
            >
              Completed
              <span className={styles.filterCount}>{tasks.length - deletedCount}</span>
            </button>
            <button
              className={`${styles.filterTab} ${filter === "deleted" ? styles.filterTabActiveDeleted : ""}`}
              onClick={() => setFilter("deleted")}
            >
              Deleted
              <span className={`${styles.filterCount} ${filter === "deleted" ? styles.filterCountDeleted : ""}`}>
                {deletedCount}
              </span>
            </button>
          </div>

          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}>🔍</span>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search by collection, file name, or task ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className={styles.searchClear} onClick={() => setSearch("")}>
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {/* Loading */}
      {fetchState === "loading" && (
        <div className={styles.stateWrap}>
          <span className={styles.spinner} />
          <p>Loading completed tasks…</p>
        </div>
      )}

      {/* Error */}
      {fetchState === "error" && (
        <div className={styles.stateWrap}>
          <span className={styles.stateIcon}>⚠️</span>
          <p className={styles.stateTitle}>Failed to load tasks</p>
          <p className={styles.stateSubtitle}>Please refresh the page and try again.</p>
        </div>
      )}

      {/* Empty (no tasks at all) */}
      {fetchState === "empty" && (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>✅</span>
          <p className={styles.emptyTitle}>No completed tasks yet</p>
          <p className={styles.emptySubtitle}>Tasks you finish will be recorded here.</p>
        </div>
      )}

      {/* Table */}
      {fetchState === "success" && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>#</th>
                <th className={styles.th}>Collection</th>
                <th className={styles.th}>Document</th>
                <th className={styles.th}>Language</th>
                <th className={styles.th}>Versions</th>
                <th className={styles.th}>Completed On</th>
                <th className={styles.th}>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className={styles.noResults}>
                    No tasks match your current filter.
                  </td>
                </tr>
              ) : (
                filteredTasks.map((task) => {
                  const deleted = isDeleted(task);
                  return (
                    <tr
                      key={task.task_id}
                      className={`${styles.tr} ${deleted ? styles.trDeleted : ""}`}
                      onClick={() => handleRowClick(task.task_id)}
                      title={
                        deleted
                          ? `Task #${task.task_id} — document or collection has been deleted`
                          : `Open task #${task.task_id}`
                      }
                    >
                      {/* Task ID */}
                      <td className={styles.td}>
                        <span className={`${styles.taskId} ${deleted ? styles.taskIdDeleted : ""}`}>
                          #{task.task_id}
                        </span>
                        {deleted && (
                          <span className={styles.deletedBadge}>deleted</span>
                        )}
                      </td>

                      {/* Collection */}
                      <td className={styles.td}>
                        {task.collection ? (
                          <span className={styles.collectionTitle}>
                            {task.collection.title}
                          </span>
                        ) : (
                          <span className={styles.deletedPlaceholder}>Collection deleted</span>
                        )}
                      </td>

                      {/* Document */}
                      <td className={styles.td}>
                        {task.document ? (
                          <>
                            <span className={styles.fileName}>
                              {task.document.file_name}
                            </span>
                            {task.document.file_type && (
                              <span className={`${styles.fileType} ${deleted ? styles.fileTypeDeleted : ""}`}>
                                {task.document.file_type.toUpperCase()}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className={styles.deletedPlaceholder}>Document deleted</span>
                        )}
                      </td>

                      {/* Language */}
                      <td className={styles.td}>
                        <span className={styles.language}>
                          {task.collection?.language ?? "—"}
                        </span>
                      </td>

                      {/* Version count */}
                      <td className={styles.td}>
                        {task.document ? (
                          <span className={`${styles.versionBadge} ${deleted ? styles.versionBadgeDeleted : ""}`}>
                            v{task.document.version_count}
                          </span>
                        ) : (
                          <span className={styles.remarksEmpty}>—</span>
                        )}
                      </td>

                      {/* Completed at */}
                      <td className={styles.td}>
                        <span className={styles.dateMain}>{formatDate(task.updated_at)}</span>
                        <span className={styles.dateTime}>{formatTime(task.updated_at)}</span>
                      </td>

                      {/* Annotator remarks */}
                      <td className={styles.td}>
                        {task.annotator_reason ? (
                          <span className={styles.remarks} title={task.annotator_reason}>
                            {task.annotator_reason.length > 60
                              ? task.annotator_reason.slice(0, 60) + "…"
                              : task.annotator_reason}
                          </span>
                        ) : (
                          <span className={styles.remarksEmpty}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          <p className={styles.rowCount}>
            {filteredTasks.length} of {tasks.length} completed task{tasks.length !== 1 ? "s" : ""}
            {deletedCount > 0 && (
              <span className={styles.rowCountDeleted}>
                {" "}· {deletedCount} with deleted document{deletedCount !== 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>
      )}

    </div>
  );
}