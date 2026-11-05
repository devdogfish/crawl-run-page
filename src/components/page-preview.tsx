"use client";

// The crawled page with its issues drawn on top.
//   screenshot → what the crawler saved (image + element boxes): fixed 1280px, issue boxes only.
//   live       → the stored HTML rendered again: any viewport width, hover to inspect any element,
//                and accessibility layers computed from the DOM (tab order, headings, landmarks, alt text).
//   crop       → a zoomed slice around one element, used as evidence in the issue panel.
// PROTOTYPE: both modes render the generated HTML; in the real app "screenshot" is an image and the
// boxes come from the crawl (no stored HTML needed). Live render is what the extra ~15% storage would buy.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box, Text } from "@chakra-ui/react";
import { RULE_CATALOG, type Instance } from "@/lib/page-issues";

export type Layer = "issues" | "tab" | "headings" | "landmarks" | "alt";
type Rect = { x: number; y: number; w: number; h: number };
type Mark = Rect & { label: string; bad?: boolean };

const SEV_COLOR: Record<string, string> = { critical: "#e5484d", serious: "#f76b15", moderate: "#d6a300", minor: "#8b8d98" };
const rectOf = (el: Element): Rect => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
// Rough accessible name: aria-label, alt, or visible text with at least one letter or digit (an icon glyph isn't a name)
const nameOf = (el: Element) => {
  const n = (el.getAttribute("aria-label") || el.getAttribute("alt") || (el as HTMLElement).innerText || "").trim().replace(/\s+/g, " ");
  return /[\p{L}\p{N}]/u.test(n) ? n.slice(0, 60) : "";
};

export function PagePreview({ html, instances, selected, highlightRule, onSelect, mode, viewport = 1280, layers = ["issues"], crop, height }: {
  html: string;
  instances: Instance[]; // the ones to draw (already filtered)
  selected: number | null;
  highlightRule?: string | null;
  onSelect?: (k: number) => void;
  mode: "screenshot" | "live";
  viewport?: number;
  layers?: Layer[];
  crop?: number; // instance to zoom in on
  height?: number; // crop height in px
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState(0);
  const [docH, setDocH] = useState(1200);
  const [boxes, setBoxes] = useState<Map<number, Rect>>(new Map());
  const [marks, setMarks] = useState<Record<Exclude<Layer, "issues">, Mark[]>>({ tab: [], headings: [], landmarks: [], alt: [] });
  const [hover, setHover] = useState<(Rect & { tag: string; name: string; k?: number }) | null>(null);

  // Measure everything from the rendered DOM
  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body || !doc.documentElement.scrollHeight) return; // hidden (e.g. an inactive tab): measure later
    setDocH(doc.documentElement.scrollHeight);
    const b = new Map<number, Rect>();
    doc.querySelectorAll("[data-ix]").forEach((el) => b.set(Number(el.getAttribute("data-ix")), rectOf(el)));
    setBoxes(b);
    const focusable = [...doc.querySelectorAll("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")];
    let prev = 0;
    setMarks({
      tab: focusable.map((el, n) => ({ ...rectOf(el), label: String(n + 1), bad: !nameOf(el) && !(el.tagName === "INPUT" && doc.querySelector(`label[for="${el.id}"]`)) })),
      headings: [...doc.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((el) => {
        const lvl = Number(el.tagName[1]);
        const bad = prev > 0 && lvl > prev + 1;
        prev = lvl;
        return { ...rectOf(el), label: `H${lvl}${bad ? " · skips a level" : ""}`, bad };
      }),
      landmarks: [...doc.querySelectorAll("header, nav, main, footer, aside, [role=region]")].map((el) => ({
        ...rectOf(el), label: `${el.tagName.toLowerCase()}${el.getAttribute("aria-label") ? ` "${el.getAttribute("aria-label")}"` : ""}`,
      })).concat([...doc.querySelectorAll("body > div")].map((el) => ({ ...rectOf(el), label: "Outside any landmark", bad: true }))),
      alt: [...doc.querySelectorAll("img")].map((el) => {
        const alt = el.getAttribute("alt");
        return { ...rectOf(el), label: alt == null ? "No alt" : alt === "" ? "Decorative (alt=\"\")" : `alt: ${alt}`, bad: alt == null };
      }),
    });
  }, []);

  useEffect(() => { const t = setTimeout(measure, 50); return () => clearTimeout(t); }, [viewport, html, measure]);

  // Width of the container sets the scale; it's 0 while a tab is hidden, so re-measure when it appears
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { setWidth(el.clientWidth); if (el.clientWidth) measure(); });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [measure]);

  const scale = width ? Math.min(1, width / viewport) : 0.5;
  const live = mode === "live";
  const cropRect = crop != null ? boxes.get(crop) : undefined;

  // Crop: zoom in (up to 1:1) and centre the element
  // Crop: zoom in, but never so far that the element (plus some context) doesn't fit
  const cropScale = Math.min(1, (width / viewport) * 1.8, cropRect && height ? (height - 32) / Math.max(1, cropRect.h) : 1, cropRect ? (width - 48) / Math.max(1, cropRect.w) : 1);
  const cx = cropRect ? width / 2 - (cropRect.x + cropRect.w / 2) * cropScale : 0; // centre the element
  const tx = viewport * cropScale > width ? Math.min(0, Math.max(width - viewport * cropScale, cx)) : cx;
  const ty = cropRect && height ? Math.min(0, Math.max(height - docH * cropScale, height / 2 - (cropRect.y + cropRect.h / 2) * cropScale)) : 0;
  const s = crop != null ? cropScale : scale;
  const lab = 11 / s; // labels stay ~11px on screen whatever the scale

  const onMove = (e: React.MouseEvent) => {
    if (!live) return;
    const doc = frame.current?.contentDocument;
    const r = e.currentTarget.getBoundingClientRect();
    const el = doc?.elementFromPoint((e.clientX - r.left) / s, (e.clientY - r.top) / s);
    if (!el || el === doc?.body || el === doc?.documentElement) return setHover(null);
    const ix = el.closest("[data-ix]")?.getAttribute("data-ix");
    setHover({ ...rectOf(el), tag: `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""}`, name: nameOf(el), k: ix != null ? Number(ix) : undefined });
  };

  const drawn = instances.filter((it) => boxes.has(it.k));
  return (
    <Box ref={wrap} position="relative" overflow="hidden" h={crop != null ? `${height ?? 200}px` : `${docH * scale}px`} bg="white" rounded="l2" borderWidth="1px">
      <Box position="absolute" top="0" left="0" w={`${viewport}px`} h={`${docH}px`} transformOrigin="top left"
        style={{ transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
        <iframe ref={frame} srcDoc={html} sandbox="allow-same-origin" title="Crawled page" onLoad={measure}
          style={{ width: viewport, height: docH, border: 0, display: "block", pointerEvents: "none" }} />

        {/* Overlay, in page pixels */}
        <Box position="absolute" inset="0" onMouseMove={onMove} onMouseLeave={() => setHover(null)}
          onClick={() => hover?.k != null && onSelect?.(hover.k)} cursor={live && hover?.k != null ? "pointer" : undefined}>
          {layers.includes("issues") && drawn.map((it) => {
            const r = boxes.get(it.k)!;
            const sev = RULE_CATALOG[it.rule].severity;
            const on = it.k === selected, hi = highlightRule === it.rule;
            const dim = selected != null && !on && !hi && crop == null;
            return (
              <Box key={it.k} position="absolute" left={`${r.x - 3}px`} top={`${r.y - 3}px`} w={`${r.w + 6}px`} h={`${r.h + 6}px`}
                border={`${(on ? 3 : 2) / s}px solid ${SEV_COLOR[sev]}`} bg={on && crop == null ? `${SEV_COLOR[sev]}22` : undefined} rounded="sm"
                opacity={dim ? 0.35 : 1} cursor="pointer" onClick={(e) => { e.stopPropagation(); onSelect?.(it.k); }}
                boxShadow={on ? `0 0 0 ${4 / s}px ${SEV_COLOR[sev]}44` : undefined}
                css={hi && !on ? { animation: "pulse 1.2s ease-in-out infinite", "@keyframes pulse": { "50%": { boxShadow: `0 0 0 ${6 / s}px ${SEV_COLOR[sev]}55` } } } : undefined}>
                {crop == null && (
                  <Box position="absolute" top={`${-9 / s}px`} left={`${-9 / s}px`} minW={`${18 / s}px`} h={`${18 / s}px`} px={`${4 / s}px`} rounded="full"
                    bg={SEV_COLOR[sev]} color="white" fontSize={`${lab}px`} fontWeight="bold" display="flex" alignItems="center" justifyContent="center" lineHeight="1">
                    {it.k + 1}
                  </Box>
                )}
              </Box>
            );
          })}

          {live && (["tab", "headings", "landmarks", "alt"] as const).filter((l) => layers.includes(l)).map((l) =>
            marks[l].map((m, n) => (
              <Box key={`${l}${n}`} position="absolute" left={`${m.x}px`} top={`${m.y}px`} w={`${m.w}px`} h={`${m.h}px`} pointerEvents="none"
                border={l === "landmarks" || l === "headings" ? `${1.5 / s}px dashed ${m.bad ? "#e5484d" : l === "landmarks" ? "#8e4ec6" : "#0090ff"}` : undefined}>
                <Box position="absolute" top={l === "tab" ? `${-8 / s}px` : 0} left={l === "tab" ? `${-8 / s}px` : 0} fontSize={`${lab}px`} lineHeight="1.3"
                  px={`${4 / s}px`} rounded={l === "tab" ? "full" : "sm"} fontWeight="semibold" whiteSpace="nowrap"
                  bg={m.bad ? "#e5484d" : l === "tab" ? "#0d74ce" : l === "landmarks" ? "#8e4ec6" : l === "alt" ? "#1d2733" : "#0090ff"} color="white">
                  {m.label}
                </Box>
              </Box>
            )))}

          {live && hover && (
            <Box position="absolute" left={`${hover.x}px`} top={`${hover.y}px`} w={`${hover.w}px`} h={`${hover.h}px`} pointerEvents="none"
              outline={`${1.5 / s}px solid #0d74ce`} bg="#0d74ce14">
              <Box position="absolute" bottom="100%" left="0" mb={`${4 / s}px`} bg="#111" color="white" fontSize={`${lab}px`} px={`${6 / s}px`} py={`${2 / s}px`} rounded="sm" whiteSpace="nowrap">
                <Text as="span" fontFamily="mono">{hover.tag}</Text>
                <Text as="span" opacity={0.7}> · {Math.round(hover.w)}×{Math.round(hover.h)} · name: {hover.name || "(none)"}</Text>
                {hover.k != null && <Text as="span" color="#ffb4a8"> · issue #{hover.k + 1}</Text>}
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
