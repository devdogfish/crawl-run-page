// The crawler stores each page's HTML, not its images, video or audio (too much storage). The HTML already holds
// each asset's path, so the preview streams them from the site on demand: a <base> pointing at the crawled
// environment makes the relative paths resolve. Only an asset that no longer loads (removed, renamed, blocked)
// is swapped for a neutral placeholder of the same size that names the file, so the layout stays right.
// The Source view and issue snippets always show the original markup.
//   <img>          → grey box: file name, width × height, "not available"
//   <video>        → the same box with a play mark
//   <audio>        → a flat bar with the file name and "Audio not available"

const fileOf = (src: string) => {
  try { return decodeURIComponent(new URL(src, "https://x.invalid").pathname.split("/").pop() || src); } catch { return src; }
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Point relative asset paths at the environment the page was crawled from; never autoplay anything
export function withBase(html: string, origin: string | undefined) {
  const out = html.replace(/\sautoplay(="[^"]*")?/gi, "");
  return origin ? out.replace(/<head([^>]*)>/i, `<head$1><base href="${esc(origin)}/">`) : out;
}

function box(file: string, w: number, h: number, kind: "image" | "video") {
  const small = h < 60 || w < 140;
  const cy = h / 2;
  const icon = small ? "" : kind === "video"
    ? `<circle cx="${w / 2}" cy="${cy - 22}" r="16" fill="none" stroke="#8a95a1" stroke-width="1.5"/><path d="M${w / 2 - 5} ${cy - 30} l13 8 -13 8z" fill="#8a95a1"/>`
    : `<rect x="${w / 2 - 14}" y="${cy - 36}" width="28" height="22" rx="3" fill="none" stroke="#8a95a1" stroke-width="1.5"/><path d="M${w / 2 - 10} ${cy - 18} l7 -8 5 5 4 -3 6 6z" fill="#8a95a1"/>`;
  const label = small
    ? `<text x="${w / 2}" y="${cy + 3.5}" text-anchor="middle" font-size="10" fill="#5b6876">${esc(file)}</text>`
    : `<text x="${w / 2}" y="${cy + 4}" text-anchor="middle" font-size="13" fill="#4a5560">${esc(file)}</text>` +
      `<text x="${w / 2}" y="${cy + 22}" text-anchor="middle" font-size="11" fill="#8a95a1">${kind === "video" ? "Video" : "Image"} · ${w} × ${h} · not available</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif">` +
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="#f1f3f5" stroke="#d9dee3"/>${icon}${label}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const sizeOf = (el: Element, fw: number, fh: number) => {
  const w = Number(el.getAttribute("width")) || (el as HTMLElement).clientWidth || fw;
  const h = Number(el.getAttribute("height")) || Math.round((w * fh) / fw);
  return [Math.round(w), Math.round(h)] as const;
};
const mediaSrc = (el: Element) => el.getAttribute("src") ?? el.querySelector("source[src]")?.getAttribute("src") ?? "";

// After the page loads: swap every asset that failed (now or later) for its placeholder. `changed` re-measures the page.
export function placeholdMissing(doc: Document, changed: () => void) {
  const img = (el: HTMLImageElement) => {
    if (el.dataset.missing || el.src.startsWith("data:")) return;
    const [w, h] = sizeOf(el, 800, 450);
    el.dataset.missing = "1";
    el.removeAttribute("srcset");
    el.src = box(fileOf(el.getAttribute("src") ?? ""), w, h, "image");
    changed();
  };
  doc.querySelectorAll("img").forEach((el) => {
    if (el.complete && el.naturalWidth === 0) img(el);
    else el.addEventListener("error", () => img(el), { once: true });
  });

  const media = (el: HTMLMediaElement) => {
    if (!el.isConnected) return;
    const file = fileOf(mediaSrc(el));
    const keep = [...el.attributes].filter((a) => /^(class|id|data-)/.test(a.name)).map((a) => ` ${a.name}="${esc(a.value)}"`).join("");
    if (el.tagName === "VIDEO") {
      const [w, h] = sizeOf(el, 880, 495);
      el.outerHTML = `<img${keep} alt="" data-missing="1" src="${box(file, w, h, "video")}" style="display:block;width:100%;height:auto;margin:20px 0">`;
    } else {
      el.outerHTML = `<div${keep} role="img" aria-label="Audio not available: ${esc(file)}" style="display:flex;align-items:center;gap:12px;height:48px;padding:0 14px;margin:16px 0;` +
        `border:1px solid #d9dee3;border-radius:6px;background:#f1f3f5;font:13px -apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#4a5560">` +
        `<span style="display:inline-flex;width:26px;height:26px;border-radius:50%;border:1.5px solid #8a95a1;align-items:center;justify-content:center;color:#8a95a1;font-size:10px">&#9654;</span>` +
        `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(file)}</span>` +
        `<span style="color:#8a95a1;font-size:12px">Audio not available</span></div>`;
    }
    changed();
  };
  doc.querySelectorAll<HTMLMediaElement>("video, audio").forEach((el) => {
    // A failed <source> fires on the source, not the element; a src that 404s sets el.error
    if (el.error || (el.networkState === HTMLMediaElement.NETWORK_NO_SOURCE && mediaSrc(el))) { media(el); return; }
    el.addEventListener("error", () => media(el), { once: true });
    el.querySelectorAll("source").forEach((s) => s.addEventListener("error", () => media(el), { once: true }));
  });
}
