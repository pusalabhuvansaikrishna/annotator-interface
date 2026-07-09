"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { BASE_URL } from "@/config/api";
import dynamic from "next/dynamic";
import styles from "./taskDetail.module.css";
import type { OcrData } from "./OcrKonvaViewer";

// react-konva requires browser APIs — load client-side only
const OcrKonvaViewer = dynamic(() => import("./OcrKonvaViewer"), {
  ssr: false,
  loading: () => (
    <div className={styles.viewerState}>
      <span className={styles.spinner} />
      <p>Loading viewer…</p>
    </div>
  ),
});

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaskDetail {
  task_id: number;
  status: string;
  user_reason: string;
  annotator_reason: string | null;
  priority: string;
  document_url: string;
  ocr_url: string | null;
  language: string | null;
}

type FetchState = "loading" | "success" | "error";
type TaskStatus = "InReview" | "Completed";

const MAX_REASON       = 1000;
const SELECTABLE_STATUSES = ["InReview", "Completed"] as TaskStatus[];
const JSON_PANEL_WIDTH = 420; // px — fixed width for the sliding JSON drawer

// ── JSON highlight helper ─────────────────────────────────────────────────────
function buildJsonSegments(
  ocr: OcrData,
  highlightId: string | null
): Array<{ text: string; highlight: boolean }> {
  const raw = JSON.stringify(ocr, null, 2);
  if (!highlightId) return [{ text: raw, highlight: false }];

  const idMarker  = `"id": "${highlightId}"`;
  const markerIdx = raw.indexOf(idMarker);
  if (markerIdx === -1) return [{ text: raw, highlight: false }];

  let depth = 0, start = markerIdx;
  for (let i = markerIdx; i >= 0; i--) {
    if (raw[i] === "}") depth++;
    if (raw[i] === "{") { if (depth === 0) { start = i; break; } depth--; }
  }

  depth = 0;
  let end = markerIdx;
  for (let i = markerIdx; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    if (raw[i] === "}") { if (depth === 0) { end = i + 1; break; } depth--; }
  }

  return [
    { text: raw.slice(0, start),   highlight: false },
    { text: raw.slice(start, end), highlight: true  },
    { text: raw.slice(end),        highlight: false },
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const router     = useRouter();

  const [task,       setTask]       = useState<TaskDetail | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>("loading");

  const [selectedStatus, setSelectedStatus] = useState<TaskStatus | "">("");
  const [savingStatus,   setSavingStatus]   = useState(false);
  const [statusMsg,      setStatusMsg]      = useState<{ text: string; ok: boolean } | null>(null);

  const [annotatorReason, setAnnotatorReason] = useState("");
  const [savedReason,     setSavedReason]     = useState("");
  const [savingReason,    setSavingReason]    = useState(false);
  const [reasonMsg,       setReasonMsg]       = useState<{ text: string; ok: boolean } | null>(null);

  const [localOcr,     setLocalOcr]     = useState<OcrData | null>(null);
  const [selectedBbox, setSelectedBbox] = useState<string | null>(null);
  const [jsonSearch,   setJsonSearch]   = useState("");
  const [jsonCopied,   setJsonCopied]   = useState(false);

  // ── JSON sidebar open/closed (slides in from the right edge as an overlay) ──
  // NOTE: this now only ever changes via the explicit toggle handle button.
  // Selecting a bbox in the Konva viewer must NOT force this open — it only
  // updates `selectedBbox` so that, IF the panel happens to already be open,
  // the corresponding JSON node gets highlighted/scrolled-to.
  const [jsonSidebarOpen, setJsonSidebarOpen] = useState(false);
  const viewerRowRef = useRef<HTMLDivElement>(null);

  // ── Save state ──────────────────────────────────────────────────────────────
  const [saving,   setSaving]   = useState(false);
  const [saveMsg,  setSaveMsg]  = useState<{ text: string; ok: boolean } | null>(null);

  const jsonPanelRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLSpanElement | null>(null);

  const handleOcrChange = useCallback((ocr: OcrData) => {
    setLocalOcr(ocr);
  }, []);

  const handleSelectionChange = useCallback((id: string | null) => {
    setSelectedBbox(id);
    setJsonSearch("");
    // Intentionally NOT auto-opening the JSON sidebar here anymore.
    // Live sync (localOcr updates, highlight-on-scroll when panel is open)
    // keeps working regardless of whether the panel is visible — the panel
    // itself should only ever open via the toggle handle below.
  }, []);

  useEffect(() => {
    if (!jsonSidebarOpen) return; // no point scrolling a hidden panel
    const el    = highlightRef.current;
    const panel = jsonPanelRef.current;
    if (!el || !panel) return;
    panel.scrollTop = el.offsetTop - panel.clientHeight / 2 + el.offsetHeight / 2;
  }, [selectedBbox, localOcr, jsonSidebarOpen]);

  useEffect(() => {
    const fetchTask = async () => {
      try {
        const res = await fetch(`${BASE_URL}/annotator/tasks/${taskId}`, {
          credentials: "include",
        });
        if (res.status === 401 || res.status === 403) { router.replace("/"); return; }
        if (!res.ok) { setFetchState("error"); return; }

        const data: TaskDetail = await res.json();
        setTask(data);
        const reason = data.annotator_reason ?? "";
        setAnnotatorReason(reason);
        setSavedReason(reason);
        setSelectedStatus(
          SELECTABLE_STATUSES.includes(data.status as TaskStatus)
            ? (data.status as TaskStatus) : ""
        );
        setFetchState("success");
      } catch {
        setFetchState("error");
      }
    };
    if (taskId) fetchTask();
  }, [taskId, router]);

  const handleStatusChange = async (newStatus: TaskStatus | "") => {
    setSelectedStatus(newStatus);
    if (!newStatus) return;
    setSavingStatus(true); setStatusMsg(null);
    try {
      const res = await fetch(`${BASE_URL}/annotator/tasks/${taskId}/status`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setStatusMsg({ text: json.detail ?? "Failed to update status.", ok: false });
        setSelectedStatus(
          task && SELECTABLE_STATUSES.includes(task.status as TaskStatus)
            ? (task.status as TaskStatus) : ""
        );
      } else {
        setTask((p) => p ? { ...p, status: newStatus } : p);
        setStatusMsg({ text: "Status updated.", ok: true });
      }
    } catch {
      setStatusMsg({ text: "Something went wrong.", ok: false });
    } finally {
      setSavingStatus(false);
      setTimeout(() => setStatusMsg(null), 3000);
    }
  };

  const handleSaveReason = async () => {
    if (!annotatorReason.trim()) return;
    setSavingReason(true); setReasonMsg(null);
    try {
      const res = await fetch(`${BASE_URL}/annotator/tasks/${taskId}/reason`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotator_reason: annotatorReason.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setReasonMsg({ text: json.detail ?? "Failed to save remarks.", ok: false });
      } else {
        setSavedReason(annotatorReason.trim());
        setTask((p) => p ? { ...p, annotator_reason: annotatorReason.trim() } : p);
        setReasonMsg({ text: "Remarks saved.", ok: true });
      }
    } catch {
      setReasonMsg({ text: "Something went wrong.", ok: false });
    } finally {
      setSavingReason(false);
      setTimeout(() => setReasonMsg(null), 3000);
    }
  };

  // ── Save OCR handler ────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!localOcr || !task || !task.ocr_url) return;

    setSaving(true);
    setSaveMsg(null);

    try {
      const res = await fetch(`${BASE_URL}/annotator/tasks/${taskId}/ocr`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ocr_url:  task.ocr_url,
          ocr_data: localOcr,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setSaveMsg({ text: json.detail ?? "Failed to save OCR data.", ok: false });
        return;
      }

      setSaveMsg({ text: "Saved! Redirecting…", ok: true });

      setTimeout(() => {
        router.push("/dashboard/assigned");
      }, 1000);

    } catch {
      setSaveMsg({ text: "Something went wrong.", ok: false });
    } finally {
      setSaving(false);
      if (saveMsg && !saveMsg.ok) setTimeout(() => setSaveMsg(null), 4000);
    }
  };

  const reasonIsDirty   = annotatorReason.trim() !== savedReason.trim();
  const reasonLen       = annotatorReason.length;
  const reasonNearLimit = reasonLen >= MAX_REASON * 0.85;

  const jsonText = localOcr ? JSON.stringify(localOcr, null, 2) : "";

  const jsonSegments = localOcr
    ? buildJsonSegments(localOcr, selectedBbox)
    : [{ text: "", highlight: false }];

  const filteredPlain = jsonSearch.trim()
    ? jsonText.split("\n").filter((l) =>
        l.toLowerCase().includes(jsonSearch.toLowerCase())
      ).join("\n")
    : jsonText;

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonText);
    setJsonCopied(true);
    setTimeout(() => setJsonCopied(false), 2000);
  };

  const isCompleted = task?.status === "Completed";
  const canSave     = !saving && !!localOcr && !!task?.ocr_url && !isCompleted;
  const isInReview  = task?.status === "InReview" || selectedStatus === "InReview";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>

      {/* Back + Save row */}
      <div className={styles.topActionRow}>
        <button className={styles.backBtn} onClick={() => router.back()}>
          <i className="bi bi-arrow-left" />
          <span className={styles.backBtnText}>Back to Assigned Tasks</span>
        </button>

        <div className={styles.topActionRight}>
          {saveMsg && (
            <span className={saveMsg.ok ? styles.saveMsgOk : styles.saveMsgErr}>
              {saveMsg.ok
                ? <><i className="bi bi-check-circle" /> {saveMsg.text}</>
                : <><i className="bi bi-exclamation-circle" /> {saveMsg.text}</>}
            </span>
          )}

          <button
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={!canSave}
            title={
              !task?.ocr_url  ? "No OCR data linked to this document" :
              !localOcr       ? "Waiting for OCR data to load"        :
              saving          ? "Saving…"                             :
              "Save OCR changes"
            }
          >
            {saving
              ? <><span className={styles.btnSpinner} /><span className={styles.saveBtnText}>Saving…</span></>
              : <><i className="bi bi-floppy" /><span className={styles.saveBtnText}>Save</span></>}
          </button>
        </div>
      </div>

      {fetchState === "loading" && (
        <div className={styles.stateWrap}>
          <span className={styles.spinner} /><p>Loading task…</p>
        </div>
      )}

      {fetchState === "error" && (
        <div className={styles.stateWrap}>
          <i className={`bi bi-exclamation-circle ${styles.errorIcon}`} />
          <p className={styles.errorText}>Task not found or you don't have access.</p>
          <button className={styles.retryBtn} onClick={() => router.back()}>Go Back</button>
        </div>
      )}

      {fetchState === "success" && task && (
        <div className={styles.content}>

          {/* ── Info row ── */}
          <div className={styles.topRow}>

            {/* Box 1 – Language · Status · Priority */}
            <div className={styles.infoBox}>
              <div className={styles.langRow}>
                <div className={styles.langIconWrap}>
                  <i className="bi bi-translate" />
                </div>
                <div className={styles.langText}>
                  <span className={styles.infoLabel}>Language</span>
                  <span className={styles.infoValue}>{task.language ?? "—"}</span>
                </div>
              </div>

              <div className={styles.divider} />

              <div className={styles.statusPriorityRow}>
                <div className={styles.fieldGroup}>
                  <div className={styles.infoLabelRow}>
                    <span className={styles.infoLabel}>Status</span>
                    {savingStatus && <span className={styles.inlineSpinner} />}
                  </div>
                  <select
                    className={`${styles.statusSelect} ${!selectedStatus ? styles.statusSelectPlaceholder : ""}`}
                    value={selectedStatus}
                    disabled={savingStatus || isCompleted}
                    onChange={(e) => handleStatusChange(e.target.value as TaskStatus | "")}
                  >
                    <option value="" disabled>Select…</option>
                    <option value="InReview">In Review</option>
                    <option value="Completed" disabled>Completed</option>
                  </select>
                  {statusMsg && (
                    <span className={statusMsg.ok ? styles.fieldMsgOk : styles.fieldMsgErr}>
                      {statusMsg.text}
                    </span>
                  )}
                </div>

                <div className={styles.fieldGroup}>
                  <span className={styles.infoLabel}>Priority</span>
                  <span className={`${styles.priorityBadge} ${styles[`priority${task.priority}`]}`}>
                    {task.priority}
                  </span>
                </div>
              </div>
            </div>

            {/* Box 2 – User Reason */}
            <div className={styles.infoBox}>
              <span className={styles.infoLabel}>User Reason</span>
              <p className={styles.reasonText}>{task.user_reason}</p>
            </div>

            {/* Box 3 – Annotator Remarks */}
            <div className={`${styles.infoBox} ${styles.infoBoxEditable}`}>
              <div className={styles.infoLabelRow}>
                <span className={styles.infoLabel}>Annotator Remarks</span>
                <span className={`${styles.charCount} ${reasonNearLimit ? styles.charCountWarn : ""}`}>
                  {reasonLen} / {MAX_REASON}
                </span>
              </div>
              <div className={styles.textareaWrap}>
                <textarea
                  className={styles.remarkTextarea}
                  value={annotatorReason}
                  onChange={(e) => {
                    if (e.target.value.length <= MAX_REASON)
                      setAnnotatorReason(e.target.value);
                  }}
                  placeholder="Add your remarks here…"
                  rows={3}
                  maxLength={MAX_REASON}
                />
                {reasonIsDirty && (
                  <button
                    className={styles.remarkTickBtn}
                    onClick={handleSaveReason}
                    disabled={savingReason || !annotatorReason.trim()}
                    title="Save remarks"
                  >
                    {savingReason
                      ? <span className={styles.btnSpinner} />
                      : <i className="bi bi-check-lg" />}
                  </button>
                )}
              </div>
              {reasonMsg && (
                <span className={reasonMsg.ok ? styles.fieldMsgOk : styles.fieldMsgErr}>
                  {reasonMsg.text}
                </span>
              )}
            </div>
          </div>

          {/* ── Viewer row ── */}
          {isInReview || isCompleted ? (
            <div
              ref={viewerRowRef}
              className={styles.viewerRow}
              style={{
                position: "relative",
                width: "100%",
                display: "flex",
                justifyContent: "center", // keeps the Konva box centered, always
              }}
            >

              {/* CENTER — OCR Konva editor, original size, untouched */}
              <div className={styles.viewerBox}>
                {task.ocr_url ? (
                  <OcrKonvaViewer
                    imageUrl={task.document_url}
                    ocrUrl={task.ocr_url}
                    onOcrChange={handleOcrChange}
                    onSelectionChange={handleSelectionChange}
                    language={task.language ?? ""}
                    readOnly={isCompleted}
                  />
                ) : (
                  <div className={styles.viewerEmpty}>
                    <i className="bi bi-file-earmark-x" />
                    <span>No OCR data available</span>
                  </div>
                )}
              </div>

              {/* Toggle handle — fixed to the row's right edge, always visible.
                  Black border + black arrow so it reads clearly against any background.
                  This is the ONLY control that opens/closes the JSON drawer. */}
              <button
                onClick={() => setJsonSidebarOpen((v) => !v)}
                title={jsonSidebarOpen ? "Hide JSON panel" : "Show JSON panel"}
                aria-expanded={jsonSidebarOpen}
                style={{
                  position: "absolute",
                  top: "50%",
                  right: jsonSidebarOpen ? `${JSON_PANEL_WIDTH}px` : 0,
                  transform: "translateY(-50%)",
                  transition: "right 0.3s ease",
                  zIndex: 9999,
                  width: 28,
                  height: 56,
                  borderRadius: "8px 0 0 8px",
                  border: "2px solid #000",
                  borderRight: "none",
                  background: "#fff",
                  boxShadow: "-1px 1px 4px rgba(0,0,0,0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  padding: 0,
                  color: "#000",
                }}
              >
                <i
                  className={`bi bi-chevron-${jsonSidebarOpen ? "right" : "left"}`}
                  style={{ color: "#000", fontSize: 16 }}
                />
              </button>

              {/* RIGHT — Live JSON panel, overlays on top as a drawer.
                  Does not affect the Konva box's size or position at all. */}
              <div
                className={`${styles.viewerBox} ${styles.jsonViewerBox}`}
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  height: "100%",
                  width: `${JSON_PANEL_WIDTH}px`,
                  boxSizing: "border-box",
                  transform: jsonSidebarOpen ? "translateX(0)" : "translateX(100%)",
                  transition: "transform 0.3s ease",
                  zIndex: 50,
                  display: "flex",
                  flexDirection: "column",
                  background: "#fff",
                  boxShadow: "-2px 0 12px rgba(0,0,0,0.12)",
                }}
              >

                {/* JSON header */}
                <div className={styles.jsonPanelHeader}>
                  <span className={styles.jsonPanelTitle}>
                    <i className="bi bi-braces" /> Live OCR JSON
                    {isCompleted && (
                      <span className={styles.readOnlyBadge}>Read only</span>
                    )}
                  </span>

                  {selectedBbox && (
                    <span className={styles.bboxBadge}>{selectedBbox}</span>
                  )}

                  {!selectedBbox && (
                    <input
                      className={styles.jsonPanelSearch}
                      placeholder="Filter lines…"
                      value={jsonSearch}
                      onChange={(e) => setJsonSearch(e.target.value)}
                    />
                  )}

                  {!isCompleted && (
                    <button
                      className={styles.jsonPanelCopyBtn}
                      onClick={handleCopy}
                      title="Copy full JSON to clipboard"
                    >
                      {jsonCopied
                        ? <><i className="bi bi-check-lg" /><span className={styles.copyBtnText}>Copied!</span></>
                        : <><i className="bi bi-clipboard" /><span className={styles.copyBtnText}>Copy</span></>}
                    </button>
                  )}
                </div>

                {/* JSON body */}
                <div
                  ref={jsonPanelRef}
                  className={styles.jsonPanelPre}
                  style={{
                    flex: 1,
                    overflow: "auto",
                    userSelect:    isCompleted ? "none"  : "text",
                    pointerEvents: isCompleted ? "none"  : "auto",
                    opacity:       isCompleted ? 0.75    : 1,
                  }}
                >
                  {!localOcr && <span style={{ color: "#94a3b8" }}>Waiting for OCR data…</span>}

                  {localOcr && selectedBbox && (
                    <span style={{ fontFamily: "inherit", whiteSpace: "pre" }}>
                      {jsonSegments.map((seg, i) =>
                        seg.highlight ? (
                          <span
                            key={i}
                            ref={highlightRef}
                            className={styles.jsonHighlight}
                          >
                            {seg.text}
                          </span>
                        ) : (
                          <span key={i}>{seg.text}</span>
                        )
                      )}
                    </span>
                  )}

                  {localOcr && !selectedBbox && filteredPlain}
                </div>

              </div>
            </div>
          ) : (
            /* ── Locked state ── */
            <div className={styles.lockedState}>
              <i className="bi bi-lock" style={{ fontSize: 36, opacity: 0.45 }} />
              <p className={styles.lockedTitle}>Editor locked</p>
              <p className={styles.lockedSubtitle}>
                Set the status to <strong>In Review</strong> above to unlock
                the Konva Editor and Live JSON viewer.
              </p>
            </div>
          )}

        </div>
      )}
    </div>
  );
}