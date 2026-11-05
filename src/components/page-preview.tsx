// The crawled page with its issues drawn on top.
//   screenshot → what the crawler saved (image + element boxes): fixed 1280px, issue boxes only.
//   live       → the stored HTML rendered again: any viewport width, hover to inspect any element,
//                and accessibility layers computed from the DOM (tab order, headings, landmarks, alt text).
//   crop       → a zoomed slice around one element, used as evidence in the issue panel.
// Issues are shown in "focus" style: only the selected one is outlined (the page dims around it); every other
// issue is a dot on a rail at the left edge, at its element's height. Hover a dot to outline it, click to select.
// PROTOTYPE: both modes render the generated HTML; in the real app "screenshot" is an image and the
// boxes come from the crawl (no stored HTML needed). Live render is what the extra ~15% storage would buy.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, type BoxProps } from "@chakra-ui/react";
import { RULE_CATALOG, type Instance } from "@/lib/page-issues";
import { placeholdMissing, withBase } from "@/lib/asset-placeholders";

export type Layer = "issues" | "tab" | "headings" | "landmarks" | "alt";
type Rect = { x: number; y: number; w: number; h: number };
type Mark = Rect & { label: string; bad?: boolean };

const SEV_COLOR: Record<string, string> = { critical: "#e5484d", serious: "#f76b15", moderate: "#d6a300", minor: "#8b8d98" };
const ACCENT = "#0d74ce"; // selection and hover, like a browser inspector
const rectOf = (el: Element): Rect => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
// Rough accessible name: aria-label, alt, or visible text with at least one letter or digit (an icon glyph isn't a name)
const nameOf = (el: Element) => {
  const n = (el.getAttribute("aria-label") || el.getAttribute("alt") || (el as HTMLElement).innerText || "").trim().replace(/\s+/g, " ");
  return /[\p{L}\p{N}]/u.test(n) ? n.slice(0, 60) : "";
};

export function PagePreview({ html, origin, instances, selected, highlightRule, onSelect, mode, viewport = 1280, layers = ["issues"], crop, height, card }: {
  card?: React.ReactNode; // actions shown on the selected element (screen-size, not scaled with the page)
  html: string;
  origin?: string; // site the page was crawled from: assets stream from there
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
  const doc = useMemo(() => withBase(html, origin), [html, origin]); // assets aren't stored: they load from the site
  const [width, setWidth] = useState(0);
  const [docH, setDocH] = useState(1200);
  const [boxes, setBoxes] = useState<Map<number, Rect>>(new Map());
  const [marks, setMarks] = useState<Record<Exclude<Layer, "issues">, Mark[]>>({ tab: [], headings: [], landmarks: [], alt: [] });
  const [peekK, setPeekK] = useState<number | null>(null); // issue whose rail dot is hovered
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
  // Overlay sizes are given in screen pixels and converted to page pixels, so they look the same at any zoom
  const u = (screenPx: number, pagePxTimesScale = 0) => `${(screenPx + pagePxTimesScale) / s}px`;

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
  const rail = (() => {
    const out: { it: Instance; y: number; col: number }[] = [];
    const rows = new Map<number, number>();
    for (const it of [...drawn].sort((x, y) => boxes.get(x.k)!.y - boxes.get(y.k)!.y)) {
      const b = boxes.get(it.k)!;
      const y = b.y + Math.min(b.h, 40) / 2;
      const row = Math.round(y / (14 / s));
      const col = rows.get(row) ?? 0;
      rows.set(row, col + 1);
      out.push({ it, y, col });
    }
    return out;
  })();
  return (
    <Box ref={wrap} position="relative" overflow="hidden" h={crop != null ? `${height ?? 200}px` : `${docH * scale}px`} bg="white" rounded="l2" borderWidth="1px">
      <Box position="absolute" top="0" left="0" w={`${viewport}px`} h={`${docH}px`} transformOrigin="top left"
        style={{ transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
        <iframe ref={frame} srcDoc={doc} sandbox="allow-same-origin" title="Crawled page" onLoad={() => { measure(); const d = frame.current?.contentDocument; if (d) placeholdMissing(d, measure); }}
          style={{ width: viewport, height: docH, border: 0, display: "block", pointerEvents: "none" }} />

        {/* Overlay, in page pixels */}
        <Box position="absolute" inset="0" onMouseMove={onMove} onMouseLeave={() => setHover(null)}
          onClick={() => hover?.k != null && onSelect?.(hover.k)} cursor={live && hover?.k != null ? "pointer" : undefined}>
          {/* Issues: only the selected one (and, when asked, the rest of its rule) is outlined; the others are dots on the rail */}
          {layers.includes("issues") && drawn.map((it) => {
            const r = boxes.get(it.k)!;
            const on = it.k === selected;
            const peek = it.k === peekK || (highlightRule === it.rule && !on);
            if (!on && !peek) return null;
            return (
              <Box key={it.k} position="absolute" left={u(-4, r.x * s)} top={u(-4, r.y * s)} w={u(8, r.w * s)} h={u(8, r.h * s)} rounded={u(4)} pointerEvents="none"
                boxShadow={on
                  ? `0 0 0 ${u(2)} ${ACCENT}${crop == null ? `, 0 0 0 100vmax rgba(15,17,20,.10)` : ""}`
                  : `0 0 0 ${u(1.5)} ${ACCENT}99`}>
                {on && crop == null && card && (() => {
                  // Below the element, or above it near the bottom; kept inside the frame horizontally
                  const below = (r.y + r.h) * s + 220 < docH * s;
                  const shift = Math.min(0, (width - 392 - r.x * s) / s);
                  return (
                    <Box position="absolute" left={`${shift - 4 / s}px`} {...(below ? { top: `calc(100% + ${8 / s}px)` } : { bottom: `calc(100% + ${8 / s}px)` })}
                      pointerEvents="auto" zIndex="1" onClick={(e) => e.stopPropagation()} onMouseMove={(e) => { e.stopPropagation(); setHover(null); }}>
                      <Box transform={`scale(${1 / s})`} transformOrigin={below ? "top left" : "bottom left"}>{card}</Box>
                    </Box>
                  );
                })()}
              </Box>
            );
          })}
          {layers.includes("issues") && crop == null && rail.map(({ it, y, col }) => {
            const on = it.k === selected;
            return (
              <Box key={`dot${it.k}`} as="button" aria-label={RULE_CATALOG[it.rule].title} position="absolute" top={u(-5, y * s)} left={u(6 + col * 12)}
                w={u(10)} h={u(10)} rounded="full" bg={SEV_COLOR[RULE_CATALOG[it.rule].severity]} cursor="pointer"
                boxShadow={on ? `0 0 0 ${u(2)} white, 0 0 0 ${u(3.5)} ${ACCENT}` : `0 0 0 ${u(2)} white`}
                opacity={on || peekK === it.k ? 1 : 0.85} transition="transform 0.1s" _hover={{ transform: "scale(1.25)" }}
                onMouseEnter={() => setPeekK(it.k)} onMouseLeave={() => setPeekK(null)}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); onSelect?.(it.k); }} />
            );
          })}

          {live && (["tab", "headings", "landmarks", "alt"] as const).filter((l) => layers.includes(l)).map((l) =>
            marks[l].map((m, n) => (
              <Box key={`${l}${n}`} position="absolute" left={`${m.x}px`} top={`${m.y}px`} w={`${m.w}px`} h={`${m.h}px`} pointerEvents="none"
                rounded={u(3)} boxShadow={l === "landmarks" ? `inset 0 0 0 ${u(1)} ${m.bad ? "#e5484d" : "#8b8d98"}` : undefined}>
                {l === "tab" ? (
                  <Box position="absolute" top={u(-8)} left={u(-8)} w={u(16)} h={u(16)} rounded="full" display="flex" alignItems="center" justifyContent="center"
                    bg={m.bad ? "#e5484d" : "#18191b"} color="white" fontSize={u(9)} fontWeight="600" boxShadow={`0 0 0 ${u(1.5)} white`} fontVariantNumeric="tabular-nums">
                    {m.label}
                  </Box>
                ) : (
                  l === "headings"
                    // in the left margin, level by level, so the tags don't cover the text
                    ? <Tag s={s} top="50%" transform="translateY(-50%)" right="100%" me={u(8)} bad={m.bad}>{m.label}</Tag>
                    : <Tag s={s} top={l === "alt" ? undefined : u(-22)} bottom={l === "alt" ? u(4) : undefined} left={l === "alt" ? u(4) : "0"} bad={m.bad}>{m.label}</Tag>
                )}
              </Box>
            )))}

          {live && hover && (
            <Box position="absolute" left={`${hover.x}px`} top={`${hover.y}px`} w={`${hover.w}px`} h={`${hover.h}px`} pointerEvents="none"
              boxShadow={`inset 0 0 0 ${u(1)} ${ACCENT}`} bg={`${ACCENT}0d`}>
              <Tag s={s} bottom="100%" left="0" mb={u(4)}>
                <Box as="span" fontFamily="mono">{hover.tag}</Box>
                <Box as="span" opacity={0.6}> {Math.round(hover.w)}×{Math.round(hover.h)}{hover.name ? "" : " · no accessible name"}</Box>
              </Tag>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

// Small dark label on the overlay (sizes in screen pixels, divided by the scale)
function Tag({ s, bad, children, ...rest }: BoxProps & { s: number; bad?: boolean }) {
  const u = (n: number) => `${n / s}px`;
  return (
    <Box position="absolute" display="flex" alignItems="center" whiteSpace="nowrap" maxW={u(360)} overflow="hidden"
      bg={bad ? "#e5484d" : "#18191b"} color="white" fontSize={u(11)} fontWeight="500" lineHeight="1" px={u(6)} py={u(4)} rounded={u(4)}
      boxShadow={`0 ${u(1)} ${u(3)} rgba(0,0,0,.2)`} fontFamily="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" {...rest}>
      {children}
    </Box>
  );
}
