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

const MAX_REASON          = 1000;
const SELECTABLE_STATUSES = ["InReview", "Completed"] as TaskStatus[];

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

  // ── JSON panel collapse on mobile ───────────────────────────────────────────
  const [jsonPanelOpen, setJsonPanelOpen] = useState(false);

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
    // Auto-open JSON panel on mobile when a bbox is selected
    if (id) setJsonPanelOpen(true);
  }, []);

  useEffect(() => {
    const el    = highlightRef.current;
    const panel = jsonPanelRef.current;
    if (!el || !panel) return;
    panel.scrollTop = el.offsetTop - panel.clientHeight / 2 + el.offsetHeight / 2;
  }, [selectedBbox, localOcr]);

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
            <div className={styles.viewerRow}>

              {/* LEFT — OCR Konva editor */}
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

              {/* RIGHT — Live JSON panel */}
              <div className={`${styles.viewerBox} ${styles.jsonViewerBox}`}>

                {/* JSON header */}
                <div
                  className={styles.jsonPanelHeader}
                  onClick={() => setJsonPanelOpen((v) => !v)}
                  role="button"
                  aria-expanded={jsonPanelOpen}
                  style={{ cursor: "pointer" }}
                >
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
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setJsonSearch(e.target.value)}
                    />
                  )}

                  {!isCompleted && (
                    <button
                      className={styles.jsonPanelCopyBtn}
                      onClick={(e) => { e.stopPropagation(); handleCopy(); }}
                      title="Copy full JSON to clipboard"
                    >
                      {jsonCopied
                        ? <><i className="bi bi-check-lg" /><span className={styles.copyBtnText}>Copied!</span></>
                        : <><i className="bi bi-clipboard" /><span className={styles.copyBtnText}>Copy</span></>}
                    </button>
                  )}

                  {/* Mobile collapse chevron */}
                  <i className={`bi bi-chevron-${jsonPanelOpen ? "up" : "down"} ${styles.jsonChevron}`} />
                </div>

                {/* JSON body */}
                <div
                  ref={jsonPanelRef}
                  className={`${styles.jsonPanelPre} ${jsonPanelOpen ? styles.jsonPanelOpen : styles.jsonPanelClosed}`}
                  style={{
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