"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Konva from "konva";
import { BASE_URL } from "@/config/api";
import styles from "./taskDetail.module.css";


// ── Types ─────────────────────────────────────────────────────────────────────

interface BBox { x: number; y: number; w: number; h: number; }

interface Word {
  id: string;
  text: string;
  bbox: BBox;
  confidence: number;
}

interface LayoutLine {
  id: string;
  text: string;
  bbox: BBox;
  baseline_y: number;
  words: Word[];
}

interface PageData {
  page_number: number;
  width: number;
  height: number;
  layout_lines: LayoutLine[];
}

export interface OcrData {
  [page: string]: PageData;
}

interface Props {
  imageUrl: string;
  ocrUrl: string;
  spellCheckUrl?: string;
  addWordUrl?: string;
  onOcrChange?: (ocr: OcrData) => void;
  onSelectionChange?: (id: string | null) => void;
  className?: string;
  language?: string;
  readOnly?: boolean;
  isPdf?: boolean;
}

// ── Tooltip / Suggestion state ────────────────────────────────────────────────

interface TooltipState {
  id: string;
  text: string;
  rectLeft: number;
  rectTop: number;
  rectBottom: number;
  rectW: number;
}

interface SuggestionState {
  words: string[];
  activeIndex: number;
  rawWord: string;
  caretPos: number;
}

// ── Context menu state ────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  word: string;
}

// ── Spell-check ───────────────────────────────────────────────────────────────

type SpellStatus = "unknown" | "correct" | "wrong" | "skip";

const DOT_WRONG_COLOR  = "#ef4444";
const DOT_STROKE_COLOR = "#0a0a14";
const DOT_R            = 5;

interface SpellCheckResponse {
  word: string;
  language: string;
  locale: string;
  is_correct: boolean;
  suggestions: string[];
}

const spellCache = new Map<string, SpellStatus>();
function cacheKey(word: string, lang: string) { return `${lang}::${word}`; }

// ── Constants ─────────────────────────────────────────────────────────────────

type Tool  = "select" | "create";
type Level = "line"   | "word";

const COLORS = {
  line:           "rgba(236, 72, 153, 0.20)",
  lineStroke:     "#ec4899",
  word:           "rgba(139, 92, 246, 0.20)",
  wordStroke:     "#8b5cf6",
  creating:       "rgba(251, 146, 60, 0.25)",
  creatingStroke: "#f97316",
};

// ── Google Input Tools IME map ────────────────────────────────────────────────
const LANG_IME_MAP: Record<string, string> = {
  "English":    "",
  "Assamese":   "as-t-i0-und",
  "Bengali":    "bn-t-i0-und",
  "Gujarati":   "gu-t-i0-und",
  "Hindi":      "hi-t-i0-und",
  "Kannada":    "kn-t-i0-und",
  "Malayalam":  "ml-t-i0-und",
  "Manipuri":   "mni-t-i0-und",
  "Marathi":    "mr-t-i0-und",
  "Oriya":      "or-t-i0-und",
  "Punjabi":    "pa-t-i0-und",
  "Tamil":      "ta-t-i0-und",
  "Telugu":     "te-t-i0-und",
  "Urdu":       "ur-t-i0-und",
  "Sanskrit":   "sa-t-i0-und",
  "Sindhi":     "sd-t-i0-und",
  "Bodo":       "brx-t-i0-und",
  "Dogri":      "doi-t-i0-und",
  "Kashmiri":   "ks-t-i0-und",
  "Santali":    "sat-t-i0-und",
  "Maithili":   "mai-t-i0-und",
  "Konkani":    "kok-t-i0-und",
  "Nepali":     "ne-t-i0-und",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function findText(ocr: OcrData, pageKey: string, id: string): string {
  const lines = ocr[pageKey]?.layout_lines ?? [];
  for (const line of lines) {
    if (line.id === id) return line.text;
    const word = line.words.find((w) => w.id === id);
    if (word) return word.text;
  }
  return "";
}

function syncLineText(line: LayoutLine): void {
  line.text = line.words.map((w) => w.text).join(" ");
}

async function fetchSuggestions(
  rawWord: string,
  imeCode: string,
  numSuggestions = 8
): Promise<string[]> {
  if (!rawWord.trim() || !imeCode) return [];
  try {
    const url =
      `https://inputtools.google.com/request?text=${encodeURIComponent(rawWord)}` +
      `&itc=${imeCode}&num=${numSuggestions}&cp=0&cs=1&ie=utf-8&oe=utf-8&app=demopage`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data[0] === "SUCCESS" && data[1]?.[0]?.[1]) {
      return data[1][0][1] as string[];
    }
  } catch { /* fail silently */ }
  return [];
}

// ── Dot helpers ───────────────────────────────────────────────────────────────

function makeDot(rect: Konva.Rect): Konva.Circle {
  return new Konva.Circle({
    x: rect.x() + rect.width() - DOT_R - 2,
    y: rect.y() + DOT_R + 2,
    radius: DOT_R,
    fill: DOT_WRONG_COLOR,
    stroke: DOT_STROKE_COLOR,
    strokeWidth: 1,
    name: "spell-dot",
    listening: false,
    visible: false,
  });
}

function repositionDot(dot: Konva.Circle, rect: Konva.Rect) {
  dot.x(rect.x() + rect.width() - DOT_R - 2);
  dot.y(rect.y() + DOT_R + 2);
}

// ── PDF.js loader ─────────────────────────────────────────────────────────────

let pdfjsLib: typeof import("pdfjs-dist") | null = null;

async function getPdfjsLib() {
  if (pdfjsLib) return pdfjsLib;
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  pdfjsLib = pdfjs;
  return pdfjsLib;
}

async function renderPdfPageToCanvas(
  pdfUrl: string,
  pageNumber: number,
  targetWidth: number
): Promise<{
  canvas: HTMLCanvasElement;
  nativeW: number;
  nativeH: number;
  pixelW: number;
  pixelH: number;
}> {
  const pdfjs = await getPdfjsLib();
  const pdf   = await pdfjs.getDocument(pdfUrl).promise;
  const page  = await pdf.getPage(pageNumber);

  const viewport1 = page.getViewport({ scale: 1 });
  const nativeW   = viewport1.width;
  const nativeH   = viewport1.height;

  const scale   = targetWidth / nativeW;
  const scaled  = page.getViewport({ scale });

  const canvas  = document.createElement("canvas");
  canvas.width  = Math.floor(scaled.width);
  canvas.height = Math.floor(scaled.height);

  await page.render({
    canvasContext: canvas.getContext("2d")!,
    viewport:      scaled,
  }).promise;

  return { canvas, nativeW, nativeH, pixelW: canvas.width, pixelH: canvas.height };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OcrKonvaViewer({
  imageUrl,
  ocrUrl,
  spellCheckUrl = `${BASE_URL}/annotator/spellcheck`,
  addWordUrl    = `${BASE_URL}/annotator/spellcheck/word`,
  onOcrChange,
  onSelectionChange,
  className = "",
  language  = "",
  readOnly  = false,
  isPdf,
}: Props) {
  const isActuallyPdf = isPdf ?? imageUrl.toLowerCase().includes(".pdf");

  const wrapperRef   = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef     = useRef<Konva.Stage | null>(null);
  const layerRef     = useRef<Konva.Layer | null>(null);
  const trRef        = useRef<Konva.Transformer | null>(null);

  const [ocrData,  setOcrData]  = useState<OcrData | null>(null);
  const [localOcr, setLocalOcr] = useState<OcrData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  // ── Multi-page state ───────────────────────────────────────────────────────
  const [currentPage,  setCurrentPage]  = useState(1);
  const [totalPages,   setTotalPages]   = useState(1);
  const currentPageRef = useRef(1);
  const [ocrPageKeys,  setOcrPageKeys]  = useState<string[]>([]);

  const [activeTool,  setActiveTool]  = useState<Tool>("select");
  const [activeLevel, setActiveLevel] = useState<Level>("line");
  const [selectedId,  setSelectedId]  = useState<string | null>(null);

  const [visibleLevels, setVisibleLevels] = useState<Set<Level>>(
    new Set<Level>(["word"])
  );

  // ── Zoom state ─────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1);
  const zoomRef         = useRef(1);
  const MIN_ZOOM        = 0.25;
  const MAX_ZOOM        = 4;
  const ZOOM_STEP       = 0.25;

  // ── Spell-check state ──────────────────────────────────────────────────────
  const dotMapRef = useRef<Map<string, { dot: Konva.Circle; status: SpellStatus }>>(new Map());

  const [showWrongDots, setShowWrongDots] = useState(true);
  const showWrongDotsRef = useRef(true);
  useEffect(() => { showWrongDotsRef.current = showWrongDots; }, [showWrongDots]);

  const [wrongCount,         setWrongCount]         = useState(0);
  const [tooltipSpellStatus, setTooltipSpellStatus] = useState<SpellStatus>("skip");
  const spellDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Context menu state ─────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [addingWord,  setAddingWord]  = useState(false);

  // ── Tooltip / suggestion state ─────────────────────────────────────────────
  const [tooltip,         setTooltip]         = useState<TooltipState | null>(null);
  const [translitEnabled, setTranslitEnabled] = useState(true);
  const [suggestions,     setSuggestions]     = useState<SuggestionState | null>(null);
  const tooltipInputRef                        = useRef<HTMLTextAreaElement>(null);

  const rawWordRef  = useRef("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Stale-closure refs ─────────────────────────────────────────────────────
  const scaleRef       = useRef(1);
  const toolRef        = useRef<Tool>("select");
  const levelRef       = useRef<Level>("line");
  const localOcrRef    = useRef<OcrData | null>(null);
  const onChangeRef    = useRef(onOcrChange);
  const onSelectionRef = useRef(onSelectionChange);
  const visibleLevRef  = useRef<Set<Level>>(new Set<Level>(["word"]));
  const tooltipRef     = useRef<TooltipState | null>(null);
  const readOnlyRef    = useRef(readOnly);

  const languageRef   = useRef(language);
  const spellUrlRef   = useRef(spellCheckUrl);
  const addWordUrlRef = useRef(addWordUrl);

  const isDrawing           = useRef(false);
  const drawStart           = useRef({ x: 0, y: 0 });
  const drawRect            = useRef<Konva.Rect | null>(null);
  const canvasMountedRef    = useRef(false);
  const justFinishedDrawing = useRef(false);

  const renderedPixelWRef = useRef(0);
  const renderedPixelHRef = useRef(0);

  useEffect(() => { toolRef.current        = activeTool;        }, [activeTool]);
  useEffect(() => { levelRef.current       = activeLevel;       }, [activeLevel]);
  useEffect(() => { onChangeRef.current    = onOcrChange;       }, [onOcrChange]);
  useEffect(() => { onSelectionRef.current = onSelectionChange; }, [onSelectionChange]);
  useEffect(() => { visibleLevRef.current  = visibleLevels;     }, [visibleLevels]);
  useEffect(() => { tooltipRef.current     = tooltip;           }, [tooltip]);
  useEffect(() => { languageRef.current    = language;          }, [language]);
  useEffect(() => { spellUrlRef.current    = spellCheckUrl;     }, [spellCheckUrl]);
  useEffect(() => { addWordUrlRef.current  = addWordUrl;        }, [addWordUrl]);
  useEffect(() => { readOnlyRef.current    = readOnly;          }, [readOnly]);

  // ── Zoom handler ───────────────────────────────────────────────────────────
  const applyZoom = useCallback((next: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    const pixelW  = renderedPixelWRef.current;
    const pixelH  = renderedPixelHRef.current;

    stage.x(0);
    stage.y(0);
    stage.scaleX(clamped);
    stage.scaleY(clamped);

    const scaledW = pixelW  * clamped;
    const scaledH = pixelH  * clamped;
    stage.width(scaledW);
    stage.height(scaledH);

    if (containerRef.current) {
      containerRef.current.style.width  = `${scaledW}px`;
      containerRef.current.style.height = `${scaledH}px`;
    }

    stage.batchDraw();
    zoomRef.current = clamped;
    setZoom(clamped);
  }, []);

  const handleZoom = useCallback((direction: "in" | "out" | "reset") => {
    const current = zoomRef.current;
    const next =
      direction === "in"  ? current + ZOOM_STEP :
      direction === "out" ? current - ZOOM_STEP :
                            1;
    applyZoom(next);
  }, [applyZoom]);

  // ── Spell API ──────────────────────────────────────────────────────────────
  const callSpellApi = useCallback(async (word: string): Promise<SpellStatus> => {
    const lang = languageRef.current;
    const url  = spellUrlRef.current;
    if (!word.trim() || !lang || !url) return "skip";
    const clean = word.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    if (!clean || /^\d+$/.test(clean)) return "skip";
    const key = cacheKey(clean, lang);
    if (spellCache.has(key)) return spellCache.get(key)!;
    try {
      const params = new URLSearchParams({ word: clean, language: lang });
      const res    = await fetch(`${url}?${params.toString()}`, {
        method: "GET", credentials: "include",
        headers: { "Accept": "application/json" },
      });
      if (!res.ok) return "skip";
      const data: SpellCheckResponse = await res.json();
      const status: SpellStatus      = data.is_correct ? "correct" : "wrong";
      spellCache.set(key, status);
      return status;
    } catch { return "skip"; }
  }, []);

  const refreshWrongCount = useCallback(() => {
    let n = 0;
    dotMapRef.current.forEach(({ status }) => { if (status === "wrong") n++; });
    setWrongCount(n);
  }, []);

  const upsertDot = useCallback((wordId: string, rect: Konva.Rect, status: SpellStatus) => {
    const layer = layerRef.current;
    if (!layer) return;
    const existing = dotMapRef.current.get(wordId);
    if (status !== "wrong") {
      if (existing) { existing.status = status; existing.dot.visible(false); layer.batchDraw(); }
      refreshWrongCount();
      return;
    }
    const shouldBeVisible = showWrongDotsRef.current && visibleLevRef.current.has("word");
    if (existing) {
      existing.status = "wrong";
      repositionDot(existing.dot, rect);
      existing.dot.visible(shouldBeVisible);
    } else {
      const dot = makeDot(rect);
      dot.visible(shouldBeVisible);
      layer.add(dot);
      dotMapRef.current.set(wordId, { dot, status: "wrong" });
    }
    layer.batchDraw();
    refreshWrongCount();
  }, [refreshWrongCount]);

  const checkWordRect = useCallback(async (wordId: string, text: string, rect: Konva.Rect) => {
    const status = await callSpellApi(text);
    upsertDot(wordId, rect, status);
  }, [callSpellApi, upsertDot]);

  const checkAllWordsOnLayer = useCallback((ocr: OcrData, pageKey: string, layer: Konva.Layer) => {
    const lines = ocr[pageKey]?.layout_lines ?? [];
    for (const line of lines) {
      for (const word of line.words) {
        const rect = layer.findOne<Konva.Rect>(`#${word.id}`);
        if (rect) checkWordRect(word.id, word.text, rect);
      }
    }
  }, [checkWordRect]);

  const addWordToDictionary = useCallback(async (word: string) => {
    const lang = languageRef.current;
    const url  = addWordUrlRef.current;
    if (!word.trim() || !lang || !url) return;
    const clean = word.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    if (!clean) return;
    setAddingWord(true);
    try {
      const params = new URLSearchParams({ word: clean, language: lang });
      const res = await fetch(`${url}?${params}`, {
        method: "POST", credentials: "include",
        headers: { "Accept": "application/json" },
      });
      if (!res.ok && res.status !== 409) return;
      spellCache.delete(cacheKey(clean, lang));
      const layer = layerRef.current;
      const tid   = tooltipRef.current?.id;
      if (tid?.startsWith("word") && layer) {
        const rect = layer.findOne<Konva.Rect>(`#${tid}`);
        if (rect) { upsertDot(tid, rect, "correct"); setTooltipSpellStatus("correct"); }
      }
      const ocr = localOcrRef.current;
      if (ocr && layer) {
        const pageKey = String(currentPageRef.current);
        const lines   = ocr[pageKey]?.layout_lines ?? [];
        for (const line of lines) {
          for (const w of line.words) {
            if (w.id === tid) continue;
            const wordClean = w.text.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
            if (wordClean === clean) {
              const rect = layer.findOne<Konva.Rect>(`#${w.id}`);
              if (rect) upsertDot(w.id, rect, "correct");
            }
          }
        }
      }
    } catch { /* fail silently */ }
    finally { setAddingWord(false); }
  }, [upsertDot]);

  // ── Close context menu on outside click / Escape ───────────────────────────
  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      setContextMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown",   close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown",   close);
    };
  }, [contextMenu]);

  useEffect(() => {
    dotMapRef.current.forEach(({ dot, status }) => {
      dot.visible(status === "wrong" && showWrongDots && visibleLevRef.current.has("word"));
    });
    layerRef.current?.batchDraw();
  }, [showWrongDots]);

  // ── Accept transliteration suggestion ─────────────────────────────────────
  const acceptSuggestion = useCallback((suggested: string, sugg: SuggestionState) => {
    const ta = tooltipInputRef.current;
    if (!ta) return;
    const rawLen    = sugg.rawWord.length;
    const insertPos = sugg.caretPos;
    const before    = ta.value.slice(0, insertPos - rawLen);
    const after     = ta.value.slice(insertPos);
    const newVal    = before + suggested + after;
    const newCursor = before.length + suggested.length;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value"
    )?.set;
    nativeSetter?.call(ta, newVal);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.setSelectionRange(newCursor, newCursor);
    rawWordRef.current = "";
    setSuggestions(null);
    ta.focus();
  }, []);

  // ── Transliteration keyboard logic ────────────────────────────────────────
  useEffect(() => {
    const imeCode = LANG_IME_MAP[language];
    const el      = tooltipInputRef.current;
    if (!tooltip || !imeCode || !el) return;
    rawWordRef.current = "";

    const triggerSuggestions = (rawWord: string, caretPos: number) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!rawWord) { setSuggestions(null); return; }
      debounceRef.current = setTimeout(async () => {
        const words = await fetchSuggestions(rawWord, imeCode);
        if (words.length > 0) setSuggestions({ words, activeIndex: 0, rawWord, caretPos });
        else setSuggestions(null);
      }, 300);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "g") {
        e.preventDefault(); e.stopPropagation();
        setTranslitEnabled((v) => !v);
        rawWordRef.current = "";
        setSuggestions(null);
        return;
      }
      setSuggestions((prev) => {
        if (!prev) return prev;
        if (e.key === "ArrowDown") { e.preventDefault(); return { ...prev, activeIndex: (prev.activeIndex + 1) % prev.words.length }; }
        if (e.key === "ArrowUp")   { e.preventDefault(); return { ...prev, activeIndex: (prev.activeIndex - 1 + prev.words.length) % prev.words.length }; }
        if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); acceptSuggestion(prev.words[prev.activeIndex], prev); return null; }
        if (e.key === "Escape") { e.preventDefault(); rawWordRef.current = ""; return null; }
        const num = parseInt(e.key);
        if (!isNaN(num) && num >= 1 && num <= prev.words.length) { e.preventDefault(); acceptSuggestion(prev.words[num - 1], prev); return null; }
        return prev;
      });
      if ([" ", ",", ".", "!", "?", ";", ":", "(", ")", "\n"].includes(e.key)) {
        setSuggestions((prev) => {
          if (prev && prev.words.length > 0) {
            e.preventDefault();
            const ta = tooltipInputRef.current;
            if (ta) {
              const rawLen    = prev.rawWord.length;
              const insertPos = prev.caretPos;
              const before    = ta.value.slice(0, insertPos - rawLen);
              const after     = ta.value.slice(insertPos);
              const boundary  = e.key === "\n" ? "\n" : e.key;
              const newVal    = before + prev.words[0] + boundary + after;
              const newCursor = before.length + prev.words[0].length + boundary.length;
              const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
              nativeSetter?.call(ta, newVal);
              ta.dispatchEvent(new Event("input", { bubbles: true }));
              ta.setSelectionRange(newCursor, newCursor);
              rawWordRef.current = "";
            }
            return null;
          }
          return prev;
        });
        return;
      }
      if (e.key === "Backspace") {
        rawWordRef.current = rawWordRef.current.slice(0, -1);
        if (!rawWordRef.current) setSuggestions(null);
      }
    };

    const handleInput = (e: Event) => {
      if (!translitEnabled) return;
      const input = e as InputEvent;
      const ta    = tooltipInputRef.current;
      if (!ta) return;
      if (input.inputType === "insertText" && input.data && !/[\s.,!?;:()\[\]{}"'\n]/.test(input.data)) {
        rawWordRef.current += input.data;
        triggerSuggestions(rawWordRef.current, ta.selectionStart ?? ta.value.length);
      }
      if (input.inputType === "insertText" && input.data && /[\s.,!?;:()\[\]{}"'\n]/.test(input.data)) {
        rawWordRef.current = "";
        setSuggestions(null);
      }
    };

    el.addEventListener("keydown", handleKeyDown);
    el.addEventListener("input",   handleInput);
    return () => {
      el.removeEventListener("keydown", handleKeyDown);
      el.removeEventListener("input",   handleInput);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSuggestions(null);
      rawWordRef.current = "";
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tooltip?.id, language, translitEnabled, acceptSuggestion]);

  // ── Show tooltip for a rect ───────────────────────────────────────────────
  const openTooltip = useCallback((rect: Konva.Rect) => {
    const ocr       = localOcrRef.current;
    const container = containerRef.current;
    const wrapper   = wrapperRef.current;
    if (!ocr || !container || !wrapper) return;

    const id      = rect.id();
    const pageKey = String(currentPageRef.current);
    const text    = findText(ocr, pageKey, id);

    const absPos = rect.getAbsolutePosition();
    const zoom   = zoomRef.current;

    const bboxW = rect.width()  * zoom;
    const bboxH = rect.height() * zoom;

    setTooltip({
      id, text,
      rectLeft:   container.offsetLeft + absPos.x,
      rectTop:    container.offsetTop  + absPos.y,
      rectBottom: container.offsetTop  + absPos.y + bboxH,
      rectW:      bboxW,
    });

    if (id.startsWith("word")) {
      setTooltipSpellStatus(dotMapRef.current.get(id)?.status ?? "unknown");
    } else {
      setTooltipSpellStatus("skip");
    }

    requestAnimationFrame(() => tooltipInputRef.current?.focus());
  }, []);

  const closeTooltip = useCallback(() => {
    rawWordRef.current = "";
    setSuggestions(null);
    setContextMenu(null);
    if (debounceRef.current)      clearTimeout(debounceRef.current);
    if (spellDebounceRef.current) clearTimeout(spellDebounceRef.current);
    setTooltip(null);
    setTooltipSpellStatus("skip");
  }, []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    onSelectionRef.current?.(id);
    if (!id) closeTooltip();
  }, [closeTooltip]);

  // ── Level button handlers ──────────────────────────────────────────────────
  const handleLevelClick = useCallback((level: Level) => {
    setActiveLevel(level);
    setVisibleLevels((prev) => { const next = new Set(prev); next.add(level); return next; });
  }, []);

  const handleToggleVisibility = useCallback((level: Level, e: React.MouseEvent) => {
    e.stopPropagation();
    setVisibleLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level); else next.add(level);
      return next;
    });
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.find(".line").forEach((n) => n.visible(visibleLevels.has("line")));
    layer.find(".word").forEach((n) => n.visible(visibleLevels.has("word")));
    dotMapRef.current.forEach(({ dot, status }) => {
      dot.visible(status === "wrong" && showWrongDotsRef.current && visibleLevels.has("word"));
    });
    layer.draw();
  }, [visibleLevels]);

  // ── Update OCR state ───────────────────────────────────────────────────────
  const updateOcr = useCallback((updater: (prev: OcrData) => OcrData) => {
    setLocalOcr((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      localOcrRef.current = next;
      setTimeout(() => onChangeRef.current?.(next), 0);
      return next;
    });
  }, []);

  const updateBboxText = useCallback((id: string, text: string) => {
    const ocr     = localOcrRef.current;
    const pageKey = String(currentPageRef.current);
    if (!ocr) return;
    const lines = ocr[pageKey]?.layout_lines ?? [];
    const line  = lines.find((l) => l.id === id);
    if (line) {
      line.text = text;
    } else {
      for (const l of lines) {
        const word = l.words.find((w) => w.id === id);
        if (word) { word.text = text; syncLineText(l); break; }
      }
    }
    const snapshot = JSON.parse(JSON.stringify(ocr)) as OcrData;
    setTimeout(() => onChangeRef.current?.(snapshot), 0);

    if (id.startsWith("word")) {
      setTooltipSpellStatus("unknown");
      if (spellDebounceRef.current) clearTimeout(spellDebounceRef.current);
      spellDebounceRef.current = setTimeout(async () => {
        const layer = layerRef.current;
        if (!layer) return;
        const rect = layer.findOne<Konva.Rect>(`#${id}`);
        if (!rect) return;
        const lang = languageRef.current;
        spellCache.delete(cacheKey(text.trim(), lang));
        const status = await callSpellApi(text);
        upsertDot(id, rect, status);
        setTooltipSpellStatus(status);
      }, 600);
    }
  }, [callSpellApi, upsertDot]);

  // ── Fetch OCR ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(ocrUrl);
        if (!res.ok) throw new Error("Failed to load OCR data");
        const data: OcrData = await res.json();

        const keys = Object.keys(data)
          .filter((k) => !isNaN(Number(k)))
          .sort((a, b) => Number(a) - Number(b));
        setOcrPageKeys(keys);
        setTotalPages(keys.length);

        setOcrData(data);
        const clone = JSON.parse(JSON.stringify(data)) as OcrData;
        setLocalOcr(clone);
        localOcrRef.current = clone;
        onChangeRef.current?.(clone);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [ocrUrl]);

  // ── syncRect ───────────────────────────────────────────────────────────────
  const syncRect = useCallback((rect: Konva.Rect, level: "line" | "word") => {
    const sc      = scaleRef.current;
    const rid     = rect.id();
    const pageKey = String(currentPageRef.current);
    const scaleX  = rect.scaleX(), scaleY = rect.scaleY();
    const rawW    = rect.width()  * scaleX, rawH = rect.height() * scaleY;
    const visualX = rect.x() + Math.min(0, rawW);
    const visualY = rect.y() + Math.min(0, rawH);
    const visualW = Math.abs(rawW), visualH = Math.abs(rawH);
    rect.x(visualX); rect.y(visualY);
    rect.width(visualW); rect.height(visualH);
    rect.scaleX(1); rect.scaleY(1);
    const newBbox: BBox = {
      x: Math.round(visualX / sc), y: Math.round(visualY / sc),
      w: Math.round(visualW / sc), h: Math.round(visualH / sc),
    };
    updateOcr((prev) => {
      const next  = JSON.parse(JSON.stringify(prev)) as OcrData;
      const lines = next[pageKey].layout_lines;
      if (level === "line") {
        const line = lines.find((l) => l.id === rid);
        if (line) line.bbox = newBbox;
      } else {
        for (const line of lines) {
          const word = line.words.find((w) => w.id === rid);
          if (word) { word.bbox = newBbox; break; }
        }
      }
      return next;
    });
    if (level === "word") {
      const entry = dotMapRef.current.get(rid);
      if (entry) repositionDot(entry.dot, rect);
    }
    openTooltip(rect);
    select(rid);
    layerRef.current?.draw();
  }, [updateOcr, select, openTooltip]);

  // ── Delete Selected ────────────────────────────────────────────────────────
  const deleteSelected = useCallback(() => {
    if (!selectedId || !trRef.current || !layerRef.current) return;
    const layer   = layerRef.current;
    const node    = layer.findOne(`#${selectedId}`);
    if (!node) return;
    const isWord  = node.hasName("word");
    const pageKey = String(currentPageRef.current);
    trRef.current.nodes([]);
    node.destroy();
    if (isWord) {
      const entry = dotMapRef.current.get(selectedId);
      if (entry) { entry.dot.destroy(); dotMapRef.current.delete(selectedId); }
      refreshWrongCount();
    }
    layer.draw();
    select(null);
    closeTooltip();
    updateOcr((prev) => {
      const next  = JSON.parse(JSON.stringify(prev)) as OcrData;
      const lines = next[pageKey].layout_lines;
      if (!isWord) {
        next[pageKey].layout_lines = lines.filter((l) => l.id !== selectedId);
      } else {
        for (const line of lines) {
          const before = line.words.length;
          line.words = line.words.filter((w) => w.id !== selectedId);
          if (line.words.length !== before) syncLineText(line);
        }
      }
      return next;
    });
  }, [selectedId, updateOcr, select, closeTooltip, refreshWrongCount]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Escape") { closeTooltip(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && !inInput && !readOnlyRef.current) {
        deleteSelected();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [deleteSelected, closeTooltip]);

  // ── Attach Handlers ────────────────────────────────────────────────────────
  const attachHandlers = useCallback((rect: Konva.Rect) => {
    rect.on("dragend", () => {
      if (readOnlyRef.current) return;
      syncRect(rect, rect.hasName("word") ? "word" : "line");
    });
    rect.on("transformend", () => {
      if (readOnlyRef.current) return;
      syncRect(rect, rect.hasName("word") ? "word" : "line");
    });
    rect.on("click tap", (e) => {
      e.cancelBubble = true;
      select(rect.id());
      if (trRef.current) { trRef.current.nodes([rect]); trRef.current.getLayer()?.draw(); }
      if (!readOnlyRef.current) openTooltip(rect);
    });
  }, [syncRect, select, openTooltip]);

  // ── Drawing ────────────────────────────────────────────────────────────────
  const startDrawing = useCallback((pos: { x: number; y: number }) => {
    if (!layerRef.current) return;
    closeTooltip();
    isDrawing.current = true;
    drawStart.current = pos;
    const rect = new Konva.Rect({
      x: pos.x, y: pos.y, width: 5, height: 5,
      fill: COLORS.creating, stroke: COLORS.creatingStroke,
      strokeWidth: 2, dash: [4, 2], name: "creating",
    });
    drawRect.current = rect;
    layerRef.current.add(rect);
    layerRef.current.draw();
  }, [closeTooltip]);

  const updateDrawing = useCallback((pos: { x: number; y: number }) => {
    if (!isDrawing.current || !drawRect.current) return;
    drawRect.current.width(pos.x - drawStart.current.x);
    drawRect.current.height(pos.y - drawStart.current.y);
    layerRef.current?.draw();
  }, []);

  const finishDrawing = useCallback(() => {
    if (!isDrawing.current || !drawRect.current || !layerRef.current) return;
    const rect    = drawRect.current;
    const sc      = scaleRef.current;
    const level   = levelRef.current;
    const pageKey = String(currentPageRef.current);

    let x = rect.x(), y = rect.y(), w = rect.width(), h = rect.height();
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }

    if (w < 15 || h < 15) {
      rect.destroy(); layerRef.current.draw();
      isDrawing.current = false; drawRect.current = null;
      return;
    }

    const newId = generateId(level === "line" ? "line" : "word");

    const cleanRect = new Konva.Rect({
      id: newId, name: `bbox ${level}`,
      x, y, width: w, height: h,
      fill:        level === "line" ? COLORS.line       : COLORS.word,
      stroke:      level === "line" ? COLORS.lineStroke : COLORS.wordStroke,
      strokeWidth: level === "line" ? 1.5 : 1,
      draggable: true, visible: true,
    });

    setVisibleLevels((prev) => {
      if (prev.has(level)) return prev;
      const next = new Set(prev); next.add(level); return next;
    });

    rect.destroy();
    layerRef.current.add(cleanRect);
    attachHandlers(cleanRect);

    if (level === "word") {
      const dot = makeDot(cleanRect);
      dot.visible(false);
      layerRef.current.add(dot);
      dotMapRef.current.set(newId, { dot, status: "skip" });
    }

    if (trRef.current) { trRef.current.nodes([cleanRect]); trRef.current.getLayer()?.draw(); }
    layerRef.current.draw();

    const newBbox: BBox = {
      x: Math.round(x / sc), y: Math.round(y / sc),
      w: Math.round(w / sc), h: Math.round(h / sc),
    };

    const ocr = localOcrRef.current;
    if (ocr) {
      const page = ocr[pageKey];
      if (level === "line") {
        const newLine: LayoutLine = {
          id: newId, text: "", bbox: newBbox,
          baseline_y: newBbox.y + newBbox.h, words: [],
        };
        const insertAt = page.layout_lines.findIndex((l) => l.bbox.y > newBbox.y);
        if (insertAt === -1) page.layout_lines.push(newLine);
        else page.layout_lines.splice(insertAt, 0, newLine);
      } else {
        const centerY = newBbox.y + newBbox.h / 2;
        const lines   = page.layout_lines;
        let bestLine  = lines.find((l) => centerY >= l.bbox.y && centerY <= l.bbox.y + l.bbox.h);
        if (!bestLine && lines.length > 0) {
          bestLine = lines.reduce((closest, l) => {
            const lc = l.bbox.y + l.bbox.h / 2, cc = closest.bbox.y + closest.bbox.h / 2;
            return Math.abs(lc - centerY) < Math.abs(cc - centerY) ? l : closest;
          });
        }
        if (bestLine) {
          const newWord: Word = { id: newId, text: "", bbox: newBbox, confidence: 0.85 };
          const insertAt = bestLine.words.findIndex((ww) => ww.bbox.x > newBbox.x);
          if (insertAt === -1) bestLine.words.push(newWord);
          else bestLine.words.splice(insertAt, 0, newWord);
          syncLineText(bestLine);
        }
      }
      const snapshot = JSON.parse(JSON.stringify(ocr)) as OcrData;
      setLocalOcr(snapshot);
      setTimeout(() => onChangeRef.current?.(snapshot), 0);
    }

    justFinishedDrawing.current = true;
    setTimeout(() => { justFinishedDrawing.current = false; }, 100);

    select(newId);
    openTooltip(cleanRect);
    isDrawing.current = false;
    drawRect.current  = null;
  }, [attachHandlers, select, openTooltip]);

  // ── Build Canvas ───────────────────────────────────────────────────────────
  const buildCanvas = useCallback((
    ocr: OcrData,
    pageKey: string,
    bgSource: HTMLImageElement | HTMLCanvasElement,
    ocrW: number,
    ocrH: number,
    imgPixelW: number,
    imgPixelH: number,
  ) => {
    const container = containerRef.current;
    if (!container) return;

    const containerW = container.clientWidth
      || container.offsetWidth
      || (container.parentElement?.clientWidth ?? 800);

    const s = containerW / ocrW;
    scaleRef.current = s;

    const canvasH = imgPixelH * (containerW / imgPixelW);

    renderedPixelWRef.current = containerW;
    renderedPixelHRef.current = canvasH;

    if (stageRef.current) stageRef.current.destroy();
    dotMapRef.current.clear();

    const currentZoom = zoomRef.current;

    const stage = new Konva.Stage({
      container,
      width:  containerW  * currentZoom,
      height: canvasH     * currentZoom,
    });
    stage.scaleX(currentZoom);
    stage.scaleY(currentZoom);
    stageRef.current = stage;

    if (containerRef.current) {
      containerRef.current.style.width  = `${containerW  * currentZoom}px`;
      containerRef.current.style.height = `${canvasH     * currentZoom}px`;
    }

    // ── Background layer ──
    const bgLayer = new Konva.Layer();
    stage.add(bgLayer);

    bgLayer.add(new Konva.Image({
      image:  bgSource,
      x:      0,
      y:      0,
      width:  containerW,
      height: canvasH,
    }));
    bgLayer.draw();

    // ── Annotation layer ──
    const layer = new Konva.Layer();
    layerRef.current = layer;
    stage.add(layer);

    const tr = new Konva.Transformer({
      enabledAnchors: readOnly ? [] : [
        "top-left","top-right","bottom-left","bottom-right",
        "middle-left","middle-right","top-center","bottom-center",
      ],
      rotateEnabled: false,
      borderStroke: "#f97316", borderDash: [4, 2],
      anchorStroke: "#f97316", anchorFill: "#fff", anchorSize: 8, keepRatio: false,
    });
    trRef.current = tr;
    layer.add(tr);

    const makeRect = (id: string, lv: "line" | "word", bbox: BBox) => new Konva.Rect({
      id, name: `bbox ${lv}`,
      x: bbox.x * s, y: bbox.y * s, width: bbox.w * s, height: bbox.h * s,
      fill:        lv === "line" ? COLORS.line       : COLORS.word,
      stroke:      lv === "line" ? COLORS.lineStroke : COLORS.wordStroke,
      strokeWidth: lv === "line" ? 1.5 : 1,
      draggable: !readOnly,
      visible: visibleLevRef.current.has(lv),
    });

    const pageData = ocr[pageKey];
    if (pageData) {
      pageData.layout_lines.forEach((line) => {
        const lr = makeRect(line.id, "line", line.bbox);
        attachHandlers(lr);
        layer.add(lr);
        line.words.forEach((word) => {
          const wr = makeRect(word.id, "word", word.bbox);
          attachHandlers(wr);
          layer.add(wr);
          const dot = makeDot(wr);
          dot.visible(false);
          layer.add(dot);
          dotMapRef.current.set(word.id, { dot, status: "unknown" });
        });
      });
    }

    layer.draw();
    checkAllWordsOnLayer(ocr, pageKey, layer);

    // ── Stage events ──
    stage.on("mousedown touchstart", (e) => {
      if (e.evt instanceof MouseEvent && e.evt.button !== 0) return;
      if (readOnlyRef.current) return;
      const pos = stage.getPointerPosition();
      if (pos && toolRef.current === "create") {
        startDrawing({ x: pos.x / zoomRef.current, y: pos.y / zoomRef.current });
      }
    });
    stage.on("mousemove touchmove", () => {
      if (readOnlyRef.current) return;
      const pos = stage.getPointerPosition();
      if (pos && toolRef.current === "create") {
        updateDrawing({ x: pos.x / zoomRef.current, y: pos.y / zoomRef.current });
      }
    });
    stage.on("mouseup touchend", () => {
      if (readOnlyRef.current) return;
      if (toolRef.current === "create") finishDrawing();
    });
    stage.on("click tap", (e) => {
      if (justFinishedDrawing.current) return;
      if (e.target === stage) {
        select(null); closeTooltip();
        trRef.current?.nodes([]);
        layer.draw();
      }
    });

    stage.on("wheel", (e) => {
      const evt = e.evt;
      if (evt.ctrlKey || evt.metaKey) {
        evt.preventDefault();
        const oldZoom = zoomRef.current;
        const next    = evt.deltaY < 0
          ? Math.min(oldZoom + ZOOM_STEP, MAX_ZOOM)
          : Math.max(oldZoom - ZOOM_STEP, MIN_ZOOM);
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        const contentX = (pointer.x - stage.x()) / oldZoom;
        const contentY = (pointer.y - stage.y()) / oldZoom;
        const newStageX = pointer.x - contentX * next;
        const newStageY = pointer.y - contentY * next;
        const clampedX  = Math.min(0, newStageX);
        const clampedY  = Math.min(0, newStageY);
        stage.scaleX(next); stage.scaleY(next);
        stage.x(clampedX);  stage.y(clampedY);

        const scaledW = containerW * next;
        const scaledH = canvasH    * next;
        stage.width(scaledW);
        stage.height(scaledH);
        if (containerRef.current) {
          containerRef.current.style.width  = `${scaledW}px`;
          containerRef.current.style.height = `${scaledH}px`;
        }
        stage.batchDraw();
        zoomRef.current = next;
        setZoom(next);
        return;
      }
      if (evt.shiftKey) {
        evt.preventDefault();
        const wrapper = wrapperRef.current;
        if (wrapper) wrapper.scrollLeft += evt.deltaY;
        return;
      }
    });
  }, [
    readOnly, startDrawing, updateDrawing, finishDrawing,
    attachHandlers, select, closeTooltip, checkAllWordsOnLayer,
  ]);

  // ── Mount / rebuild canvas when OCR + page changes ─────────────────────────
  const buildForCurrentPage = useCallback(async (ocr: OcrData, page: number) => {
    const pageKey = String(page);
    currentPageRef.current = page;
    const container = containerRef.current;
    if (!container) return;

    container.style.width  = "100%";
    container.style.height = "";

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    if (isActuallyPdf) {
      const containerW = container.clientWidth || container.offsetWidth || 800;
      try {
        const { canvas: offscreen, nativeW, nativeH, pixelW, pixelH } =
          await renderPdfPageToCanvas(imageUrl, page, containerW);

        const pageData = ocr[pageKey];
        const ocrW = (pageData?.width  > 0 ? pageData.width  : nativeW);
        const ocrH = (pageData?.height > 0 ? pageData.height : nativeH);
        buildCanvas(ocr, pageKey, offscreen, ocrW, ocrH, pixelW, pixelH);

        const pdfjs = await getPdfjsLib();
        const pdf   = await pdfjs.getDocument(imageUrl).promise;
        setTotalPages(Math.max(pdf.numPages, Object.keys(ocr).filter(k => !isNaN(Number(k))).length));
      } catch (err) {
        setError(`Failed to render PDF page ${page}: ${(err as Error).message}`);
      }
    } else {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.src = imageUrl;
      img.onload = () => {
        const pageData = ocr[pageKey];
        const ocrW = (pageData?.width  > 0 ? pageData.width  : img.naturalWidth);
        const ocrH = (pageData?.height > 0 ? pageData.height : img.naturalHeight);
        buildCanvas(
          ocr, pageKey, img,
          ocrW,
          ocrH,
          img.naturalWidth,
          img.naturalHeight,
        );
      };
      img.onerror = () => setError("Failed to load image");
    }
  }, [imageUrl, isActuallyPdf, buildCanvas]);

  // ── Initial mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (localOcr && !loading && !canvasMountedRef.current) {
      canvasMountedRef.current = true;
      buildForCurrentPage(localOcr, currentPage);
    }
    return () => {
      if (canvasMountedRef.current) {
        stageRef.current?.destroy();
        canvasMountedRef.current = false;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localOcr, loading]);

  // ── ResizeObserver: rebuild canvas when container width changes ────────────
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    let rafId: number;
    let lastWidth = wrapper.clientWidth;

    const observer = new ResizeObserver((entries) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const entry = entries[0];
        if (!entry) return;

        // Only rebuild when width actually changes — height-only changes
        // (e.g. JSON panel collapsing) don't need a canvas rebuild.
        const newWidth = Math.round(entry.contentRect.width);
        if (newWidth === lastWidth || newWidth === 0) return;
        lastWidth = newWidth;

        const ocr = localOcrRef.current;
        if (!ocr || !canvasMountedRef.current) return;

        // Reset zoom to 1 so the image fills the new width correctly.
        zoomRef.current = 1;
        setZoom(1);

        // Reset container size so buildForCurrentPage reads fresh clientWidth.
        if (containerRef.current) {
          containerRef.current.style.width  = "100%";
          containerRef.current.style.height = "";
        }

        buildForCurrentPage(ocr, currentPageRef.current);
      });
    });

    observer.observe(wrapper);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [buildForCurrentPage]);

  // ── Page navigation ────────────────────────────────────────────────────────
  const navigateToPage = useCallback((page: number) => {
    const ocr = localOcrRef.current;
    if (!ocr) return;
    select(null);
    closeTooltip();
    setCurrentPage(page);
    currentPageRef.current = page;
    dotMapRef.current.clear();
    setWrongCount(0);
    zoomRef.current = 1;
    setZoom(1);
    stageRef.current?.destroy();
    canvasMountedRef.current = false;
    buildForCurrentPage(ocr, page).then(() => {
      canvasMountedRef.current = true;
    });
  }, [select, closeTooltip, buildForCurrentPage]);

  // ── Reset ──────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    if (!ocrData) return;
    const clone = JSON.parse(JSON.stringify(ocrData)) as OcrData;
    localOcrRef.current = clone;
    select(null);
    closeTooltip();
    onChangeRef.current?.(clone);
    stageRef.current?.destroy();
    canvasMountedRef.current = false;
    dotMapRef.current.clear();
    setWrongCount(0);
    zoomRef.current = 1;
    setZoom(1);
    if (containerRef.current) {
      containerRef.current.style.width  = "100%";
      containerRef.current.style.height = "";
    }
    setLocalOcr(clone);
    buildForCurrentPage(clone, currentPage).then(() => {
      canvasMountedRef.current = true;
    });
  }, [ocrData, select, closeTooltip, currentPage, buildForCurrentPage]);

  // ── Tooltip position ───────────────────────────────────────────────────────
  const { tooltipStyle, tooltipAbove } = (() => {
    if (!tooltip) return { tooltipStyle: {} as React.CSSProperties, tooltipAbove: false };
    const wrapper  = wrapperRef.current;
    const tooltipW = 310;
    const tooltipH = suggestions ? 260 : 185;
    const GAP      = 8;
    const scrollTop = wrapper?.scrollTop   ?? 0;
    const wrapperH  = wrapper?.clientHeight ?? window.innerHeight;
    const wrapperW  = wrapper?.clientWidth  ?? window.innerWidth;
    const spaceBelow = (scrollTop + wrapperH) - tooltip.rectBottom;
    const spaceAbove =  tooltip.rectTop       - scrollTop;
    const placeAbove = spaceBelow < tooltipH + GAP && spaceAbove > spaceBelow;
    const top  = placeAbove ? tooltip.rectTop - tooltipH - GAP : tooltip.rectBottom + GAP;
    const left = Math.max(8, Math.min(tooltip.rectLeft, wrapperW - tooltipW - 8));
    return {
      tooltipStyle: { top: `${top}px`, left: `${left}px`, width: `${tooltipW}px` } as React.CSSProperties,
      tooltipAbove: placeAbove,
    };
  })();

  const activeIme = LANG_IME_MAP[language];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={`ocr-konva-viewer ${className}`}
      style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}
    >
      {/* ── Toolbar ── */}
      <div style={{
        display: "flex", flexDirection: "row", flexWrap: "nowrap",
        alignItems: "center", gap: 6, padding: "6px 10px",
        borderBottom: "1px solid #e3e6ef", background: "#faf7f0",
        flexShrink: 0, overflowX: "auto", overflowY: "visible",
        minHeight: 44,
        scrollbarWidth: "thin" as React.CSSProperties["scrollbarWidth"],
        scrollbarColor: "#c8bfa8 transparent" as unknown as React.CSSProperties["scrollbarColor"],
      }}>

        {/* Group 1 — Tool selection */}
        {!readOnly && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
              {(["select", "create"] as Tool[]).map((t) => (
                <button key={t} onClick={() => setActiveTool(t)} style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "5px 12px", borderRadius: 7, cursor: "pointer",
                  border: "1.5px solid #e8dfc8",
                  background: activeTool === t ? "#3A2C08" : "#faf7f0",
                  color:      activeTool === t ? "#fff"    : "#3A2C08",
                  fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
                  transition: "all 0.15s",
                }}>
                  <i className={`bi ${t === "select" ? "bi-cursor" : "bi-plus-square"}`} />
                  {t === "select" ? "Select" : "Create Box"}
                </button>
              ))}
            </div>
            <div style={{ width: 1, height: 22, background: "rgba(0,0,0,0.12)", flexShrink: 0, alignSelf: "center" }} />
          </>
        )}

        {/* Group 2 — Level toggles */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          {(["line", "word"] as Level[]).map((lv) => (
            <button key={lv} onClick={() => handleLevelClick(lv)} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "5px 11px", borderRadius: 7, cursor: "pointer",
              border: `1.5px solid ${lv === "line" ? "#ec4899" : "#8b5cf6"}`,
              background: activeLevel === lv ? (lv === "line" ? "#ec4899" : "#8b5cf6") : "transparent",
              color: activeLevel === lv ? "#fff" : (lv === "line" ? "#ec4899" : "#8b5cf6"),
              fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, transition: "all 0.15s",
            }}>
              <span style={{
                width: 9, height: 9, borderRadius: 2, flexShrink: 0,
                background: lv === "line" ? "#ec4899" : "#8b5cf6",
                border: "1px solid rgba(255,255,255,0.35)", display: "inline-block",
              }} />
              {lv.charAt(0).toUpperCase() + lv.slice(1)}
              <span
                title={visibleLevels.has(lv) ? `Hide ${lv}s` : `Show ${lv}s`}
                onClick={(e) => handleToggleVisibility(lv, e)}
                style={{ opacity: visibleLevels.has(lv) ? 1 : 0.4, cursor: "pointer", lineHeight: 1 }}
              >
                <i className={`bi ${visibleLevels.has(lv) ? "bi-eye" : "bi-eye-slash"}`} />
              </span>
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 22, background: "rgba(0,0,0,0.12)", flexShrink: 0, alignSelf: "center" }} />

        {/* Group 3 — Spell-check */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          <button
            onClick={() => setShowWrongDots((v) => !v)}
            title={showWrongDots ? "Hide misspelled dots" : "Show misspelled dots"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "5px 11px", borderRadius: 7, cursor: "pointer",
              border: `1px solid ${showWrongDots ? "#ef444499" : "rgba(0,0,0,0.15)"}`,
              background: showWrongDots ? "#ef444415" : "transparent",
              color:      showWrongDots ? "#ef4444"   : "rgba(0,0,0,0.4)",
              fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, transition: "all 0.15s",
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: "50%", flexShrink: 0, display: "inline-block",
              background: showWrongDots ? "#ef4444" : "rgba(0,0,0,0.2)", transition: "all 0.15s",
            }} />
            Misspelled
          </button>
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            minWidth: 22, height: 22, borderRadius: 11, padding: "0 6px",
            fontSize: 11, fontWeight: 700, fontFamily: "monospace", flexShrink: 0,
            background: wrongCount > 0 ? "#ef444420" : "rgba(0,0,0,0.06)",
            color:      wrongCount > 0 ? "#ef4444"   : "rgba(0,0,0,0.3)",
            border: `1px solid ${wrongCount > 0 ? "#ef444440" : "rgba(0,0,0,0.1)"}`,
            transition: "all 0.2s",
          }}>
            {wrongCount}
          </span>
        </div>

        <div style={{ width: 1, height: 22, background: "rgba(0,0,0,0.12)", flexShrink: 0, alignSelf: "center" }} />

        {/* Group 4 — Zoom controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <button onClick={() => handleZoom("out")} title="Zoom out" disabled={zoom <= MIN_ZOOM} style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: 7,
            cursor: zoom <= MIN_ZOOM ? "not-allowed" : "pointer",
            border: "1.5px solid #e8dfc8", background: "#faf7f0", color: "#3A2C08",
            fontSize: 14, flexShrink: 0, opacity: zoom <= MIN_ZOOM ? 0.4 : 1, transition: "all 0.15s",
          }}>
            <i className="bi bi-dash-lg" />
          </button>
          <span onClick={() => handleZoom("reset")} title="Reset zoom" style={{
            fontSize: 11, fontWeight: 700, fontFamily: "monospace",
            color: zoom !== 1 ? "#3A2C08" : "rgba(0,0,0,0.35)",
            minWidth: 42, textAlign: "center", cursor: "pointer",
            padding: "3px 6px", borderRadius: 5,
            background: zoom !== 1 ? "#e8dfc8" : "transparent",
            border: `1px solid ${zoom !== 1 ? "#d4c9a8" : "transparent"}`,
            transition: "all 0.15s", flexShrink: 0, userSelect: "none",
          }}>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => handleZoom("in")} title="Zoom in" disabled={zoom >= MAX_ZOOM} style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: 7,
            cursor: zoom >= MAX_ZOOM ? "not-allowed" : "pointer",
            border: "1.5px solid #e8dfc8", background: "#faf7f0", color: "#3A2C08",
            fontSize: 14, flexShrink: 0, opacity: zoom >= MAX_ZOOM ? 0.4 : 1, transition: "all 0.15s",
          }}>
            <i className="bi bi-plus-lg" />
          </button>
        </div>

        {/* Group 5 — Page navigation */}
        {totalPages > 1 && (
          <>
            <div style={{ width: 1, height: 22, background: "rgba(0,0,0,0.12)", flexShrink: 0, alignSelf: "center" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              <button
                onClick={() => navigateToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                title="Previous page"
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 28, height: 28, borderRadius: 7,
                  cursor: currentPage <= 1 ? "not-allowed" : "pointer",
                  border: "1.5px solid #e8dfc8", background: "#faf7f0", color: "#3A2C08",
                  fontSize: 14, flexShrink: 0, opacity: currentPage <= 1 ? 0.4 : 1, transition: "all 0.15s",
                }}
              >
                <i className="bi bi-chevron-left" />
              </button>
              <span style={{
                fontSize: 11, fontWeight: 700, fontFamily: "monospace",
                color: "#3A2C08", minWidth: 54, textAlign: "center",
                padding: "3px 6px", borderRadius: 5,
                background: "#e8dfc8", border: "1px solid #d4c9a8",
                flexShrink: 0, userSelect: "none",
              }}>
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => navigateToPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
                title="Next page"
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 28, height: 28, borderRadius: 7,
                  cursor: currentPage >= totalPages ? "not-allowed" : "pointer",
                  border: "1.5px solid #e8dfc8", background: "#faf7f0", color: "#3A2C08",
                  fontSize: 14, flexShrink: 0, opacity: currentPage >= totalPages ? 0.4 : 1, transition: "all 0.15s",
                }}
              >
                <i className="bi bi-chevron-right" />
              </button>
            </div>
          </>
        )}

        {/* Spacer */}
        <div style={{ flex: "1 0 8px" }} />

        {/* Group 6 — Actions */}
        {!readOnly && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
            <button onClick={handleReset} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "5px 12px", borderRadius: 7, cursor: "pointer",
              border: "1.5px solid #e8dfc8", background: "#faf7f0", color: "#3A2C08",
              fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, transition: "all 0.15s",
            }}>
              <i className="bi bi-arrow-counterclockwise" /> Reset
            </button>
            <button onClick={deleteSelected} disabled={!selectedId} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "5px 12px", borderRadius: 7,
              cursor: selectedId ? "pointer" : "not-allowed",
              border: "1.5px solid #fca5a5", background: "#fff", color: "#b91c1c",
              fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
              opacity: selectedId ? 1 : 0.4, transition: "all 0.15s",
            }}>
              <i className="bi bi-trash" /> Delete
            </button>
          </div>
        )}
      </div>

      {/* ── Canvas wrapper ── */}
      <div
        ref={wrapperRef}
        className={styles.viewerContent}
        style={{ flex: 1, background: "#f8fafc", overflow: "auto", position: "relative" }}
      >
        <div ref={containerRef} style={{ width: "100%", position: "relative" }}>
          {loading && <div className={styles.viewerState}><p>Loading OCR viewer…</p></div>}
          {error   && <div className={styles.viewerEmpty}>⚠ {error}</div>}
        </div>

        {/* ── Tooltip ── */}
        {tooltip && !readOnly && (
          <div
            style={{ position: "absolute", zIndex: 9999, pointerEvents: "auto", ...tooltipStyle }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              background: "#1e1e2e", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.45)", overflow: "hidden",
            }}>
              {/* Header */}
              <div style={{
                display: "flex", alignItems: "center", padding: "6px 10px",
                background: "rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.08)", gap: 8,
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)",
                  letterSpacing: "0.06em", textTransform: "uppercase",
                  fontFamily: "monospace", flexShrink: 0,
                }}>
                  {tooltip.id.startsWith("line") ? "Line" : "Word"} text
                </span>

                {tooltip.id.startsWith("word") && tooltipSpellStatus !== "skip" && (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    fontSize: 10, fontWeight: 600, fontFamily: "monospace",
                    padding: "2px 7px", borderRadius: 4, flexShrink: 0, transition: "all 0.2s",
                    color:
                      tooltipSpellStatus === "wrong"   ? "#ef4444" :
                      tooltipSpellStatus === "correct" ? "#22c55e" : "rgba(255,255,255,0.3)",
                    background:
                      tooltipSpellStatus === "wrong"   ? "#ef444418" :
                      tooltipSpellStatus === "correct" ? "#22c55e18" : "rgba(255,255,255,0.05)",
                    border: `1px solid ${
                      tooltipSpellStatus === "wrong"   ? "#ef444450" :
                      tooltipSpellStatus === "correct" ? "#22c55e50" : "rgba(255,255,255,0.1)"
                    }`,
                  }}>
                    {tooltipSpellStatus === "wrong"   && <><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} /> Misspelled</>}
                    {tooltipSpellStatus === "correct" && <><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} /> Correct</>}
                    {tooltipSpellStatus === "unknown" && <>Checking…</>}
                  </span>
                )}

                {activeIme && (
                  <button
                    title="Toggle phonetic input (Ctrl+G)"
                    onClick={() => { setTranslitEnabled((v) => !v); rawWordRef.current = ""; setSuggestions(null); }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      fontSize: 10, fontWeight: 600, fontFamily: "monospace",
                      color:      translitEnabled ? "#4ade80" : "rgba(255,255,255,0.3)",
                      background: translitEnabled ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.05)",
                      border:     `1px solid ${translitEnabled ? "rgba(74,222,128,0.35)" : "rgba(255,255,255,0.1)"}`,
                      borderRadius: 4, padding: "2px 8px", letterSpacing: "0.04em",
                      cursor: "pointer", flexShrink: 0, transition: "all 0.15s",
                    }}
                  >
                    <i className="bi bi-keyboard" style={{ fontSize: 11 }} />
                    {language} · {translitEnabled ? "ON" : "OFF"}
                  </button>
                )}

                <button onClick={closeTooltip} style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "rgba(255,255,255,0.4)", fontSize: 14, lineHeight: 1,
                  padding: "0 2px", flexShrink: 0, marginLeft: "auto",
                }} title="Close (Esc)">✕</button>
              </div>

              {activeIme && translitEnabled && (
                <div style={{
                  padding: "3px 10px", background: "rgba(74,222,128,0.07)",
                  borderBottom: "1px solid rgba(74,222,128,0.1)",
                  fontSize: 10, color: "rgba(74,222,128,0.65)", fontFamily: "monospace",
                }}>
                  Type phonetically → suggestions appear · Space accepts · Ctrl+G toggles
                </div>
              )}

              <div style={{ padding: "8px 10px 6px" }}>
                <textarea
                  ref={tooltipInputRef}
                  value={tooltip.text}
                  onChange={(e) => {
                    const val = e.target.value;
                    setTooltip((prev) => prev ? { ...prev, text: val } : prev);
                    updateBboxText(tooltip.id, val);
                  }}
                  placeholder={
                    activeIme && translitEnabled
                      ? `Type Roman phonetics for ${language}…`
                      : "Type text for this box…"
                  }
                  rows={3}
                  style={{
                    width: "100%", resize: "none", outline: "none", boxSizing: "border-box",
                    background: "rgba(255,255,255,0.06)",
                    border: `1px solid ${
                      tooltipSpellStatus === "wrong"   ? "rgba(239,68,68,0.5)"  :
                      tooltipSpellStatus === "correct" ? "rgba(34,197,94,0.4)"  : "rgba(255,255,255,0.12)"
                    }`,
                    borderRadius: 6, color: "#e8e8f0",
                    fontSize: 14, fontFamily: "sans-serif",
                    padding: "6px 8px", lineHeight: 1.6, transition: "border-color 0.2s",
                  }}
                  onFocus={(e) => { (e.target as HTMLTextAreaElement).style.borderColor = "rgba(139,92,246,0.6)"; }}
                  onBlur={(e) => {
                    (e.target as HTMLTextAreaElement).style.borderColor =
                      tooltipSpellStatus === "wrong"   ? "rgba(239,68,68,0.5)"  :
                      tooltipSpellStatus === "correct" ? "rgba(34,197,94,0.4)"  : "rgba(255,255,255,0.12)";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { e.preventDefault(); closeTooltip(); }
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); closeTooltip(); }
                    e.stopPropagation();
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const ta       = tooltipInputRef.current;
                    const selected = ta
                      ? ta.value.slice(ta.selectionStart ?? 0, ta.selectionEnd ?? 0).trim()
                      : "";
                    const word = selected || tooltip.text.trim();
                    if (!word) return;
                    setContextMenu({ x: e.clientX, y: e.clientY, word });
                  }}
                />

                {suggestions && suggestions.words.length > 0 && (
                  <div style={{
                    marginTop: 4, background: "#13131f",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6, overflow: "hidden", maxHeight: 160, overflowY: "auto",
                  }}>
                    <div style={{
                      padding: "4px 8px", fontSize: 10, color: "rgba(255,255,255,0.25)",
                      fontFamily: "monospace", borderBottom: "1px solid rgba(255,255,255,0.06)",
                    }}>
                      "{suggestions.rawWord}" →
                    </div>
                    {suggestions.words.map((word, i) => (
                      <button key={word} onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(word, suggestions); }} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        width: "100%", padding: "6px 10px",
                        background: i === suggestions.activeIndex ? "rgba(139,92,246,0.25)" : "transparent",
                        border: "none", borderBottom: "1px solid rgba(255,255,255,0.04)",
                        color: i === suggestions.activeIndex ? "#e8e8f0" : "rgba(255,255,255,0.65)",
                        fontSize: 14, fontFamily: "sans-serif",
                        cursor: "pointer", textAlign: "left", transition: "background 0.1s",
                      }}>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontFamily: "monospace", minWidth: 12 }}>
                          {i + 1}
                        </span>
                        {word}
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>
                    {tooltip.id}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, color: "rgba(139,92,246,0.7)" }}>
                      {tooltip.text.length} chars
                    </span>
                    <button
                      title="Confirm (Ctrl+Enter)"
                      onClick={closeTooltip}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                        border: "1px solid rgba(34,197,94,0.45)", background: "rgba(34,197,94,0.12)",
                        color: "#22c55e", cursor: "pointer", fontSize: 14, lineHeight: 1, transition: "background 0.15s, border-color 0.15s",
                      }}
                    >✓</button>
                  </div>
                </div>
              </div>
            </div>

            {tooltipAbove ? (
              <div style={{
                position: "absolute", bottom: -6, left: 14, width: 0, height: 0,
                borderLeft: "6px solid transparent", borderRight: "6px solid transparent",
                borderTop: "6px solid #1e1e2e", pointerEvents: "none",
              }} />
            ) : (
              <div style={{
                position: "absolute", top: -6, left: 14, width: 0, height: 0,
                borderLeft: "6px solid transparent", borderRight: "6px solid transparent",
                borderBottom: "6px solid #1e1e2e", pointerEvents: "none",
              }} />
            )}
          </div>
        )}

        {/* ── Context menu ── */}
        {contextMenu && !readOnly && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed", top: contextMenu.y, left: contextMenu.x,
              zIndex: 99999, background: "#1e1e2e",
              border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8,
              boxShadow: "0 8px 28px rgba(0,0,0,0.55)", overflow: "hidden", minWidth: 210,
            }}
          >
            <div style={{
              padding: "5px 12px", fontSize: 10, fontFamily: "monospace",
              fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
              color: "rgba(255,255,255,0.3)", borderBottom: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)", whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis", maxWidth: 210,
            }}>
              "{contextMenu.word}"
            </div>
            <button
              disabled={addingWord}
              onClick={async () => { await addWordToDictionary(contextMenu.word); setContextMenu(null); }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "9px 14px", background: "transparent",
                border: "none", color: addingWord ? "rgba(255,255,255,0.3)" : "#e8e8f0",
                fontSize: 13, fontFamily: "sans-serif",
                cursor: addingWord ? "wait" : "pointer", textAlign: "left", transition: "background 0.12s",
              }}
            >
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 22, height: 22, borderRadius: 5,
                background: addingWord ? "rgba(255,255,255,0.05)" : "rgba(139,92,246,0.18)",
                color:      addingWord ? "rgba(255,255,255,0.2)"  : "#a78bfa",
                fontSize: 13, fontWeight: 700, flexShrink: 0, transition: "all 0.15s",
              }}>
                {addingWord ? "…" : "+"}
              </span>
              {addingWord ? "Adding…" : "Add to Dictionary"}
            </button>
            <div style={{
              padding: "5px 14px", fontSize: 10, fontFamily: "monospace",
              color: "rgba(255,255,255,0.18)", borderTop: "1px solid rgba(255,255,255,0.06)",
            }}>
              Word will be saved to .pwl
            </div>
          </div>
        )}
      </div>
    </div>
  );
}