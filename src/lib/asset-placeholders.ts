// The crawler stores each page's HTML but not its heavy assets (images, video, audio): too much storage.
// Before a stored page is rendered in the preview, every asset is swapped for a neutral placeholder of the
// same size that names the file, so the layout stays right and nobody mistakes it for the real content.
// The Source view and issue snippets keep the original markup; only the rendered preview changes.
//   <img>            → grey box: file name, width × height, "not stored"
//   <video>          → the same box with a play mark (rendered as an image, so no player controls)
//   <audio>          → a flat player bar with the file name and "Audio not stored"
//   external images  → placeholders too, so the preview never loads anything from another host

const fileOf = (src: string) => {
  try { return decodeURIComponent(new URL(src, "https://x.invalid").pathname.split("/").pop() || src); } catch { return src; }
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"))?.[1] ?? null;

function box(file: string, w: number, h: number, kind: "image" | "video") {
  const small = h < 60 || w < 140;
  const fs = small ? 10 : 13;
  const cy = h / 2;
  const icon = small ? "" : kind === "video"
    ? `<circle cx="${w / 2}" cy="${cy - 22}" r="16" fill="none" stroke="#8a95a1" stroke-width="1.5"/><path d="M${w / 2 - 5} ${cy - 30} l13 8 -13 8z" fill="#8a95a1"/>`
    : `<rect x="${w / 2 - 14}" y="${cy - 36}" width="28" height="22" rx="3" fill="none" stroke="#8a95a1" stroke-width="1.5"/><path d="M${w / 2 - 10} ${cy - 18} l7 -8 5 5 4 -3 6 6z" fill="#8a95a1"/>`;
  const label = small
    ? `<text x="${w / 2}" y="${cy + 3.5}" text-anchor="middle" font-size="${fs}" fill="#5b6876">${esc(file)}</text>`
    : `<text x="${w / 2}" y="${cy + 4}" text-anchor="middle" font-size="${fs}" fill="#4a5560">${esc(file)}</text>` +
      `<text x="${w / 2}" y="${cy + 22}" text-anchor="middle" font-size="11" fill="#8a95a1">${kind === "video" ? "Video" : "Image"} · ${w} × ${h} · not stored</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif">` +
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="#f1f3f5" stroke="#d9dee3"/>${icon}${label}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const size = (tag: string, fw: number, fh: number) => {
  const w = Number(attr(tag, "width")) || fw;
  const h = Number(attr(tag, "height")) || Math.round((w * fh) / fw);
  return [w, h] as const;
};

export function withPlaceholders(html: string) {
  return html
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = attr(tag, "src");
      if (!src || src.startsWith("data:")) return tag;
      const [w, h] = size(tag, 800, 450);
      return tag.replace(/\ssrc="[^"]*"/i, ` src="${box(fileOf(src), w, h, "image")}"`).replace(/\ssrcset="[^"]*"/i, "");
    })
    .replace(/<video\b([^>]*)>[\s\S]*?<\/video>/gi, (whole, attrs: string) => {
      const src = attr(whole, "src") ?? whole.match(/<source[^>]*\ssrc="([^"]*)"/i)?.[1] ?? "video";
      const [w, h] = size(`<video${attrs}>`, 880, 495);
      const keep = attrs.replace(/\s(src|poster|controls|autoplay|preload)(="[^"]*")?/gi, "");
      // An <img>, not a <video poster>: with scripts disabled in the preview frame, Chrome forces video controls on
      return `<img${keep} data-asset="video" alt="" src="${box(fileOf(src), w, h, "video")}" style="display:block;width:100%;height:auto;margin:20px 0">`;
    })
    .replace(/<audio\b([^>]*)>[\s\S]*?<\/audio>|<audio\b([^>]*)\/?>/gi, (whole, a1: string | undefined, a2: string | undefined) => {
      const attrs = a1 ?? a2 ?? "";
      const src = attr(whole, "src") ?? whole.match(/<source[^>]*\ssrc="([^"]*)"/i)?.[1] ?? "audio";
      const keep = attrs.replace(/\s(src|controls|autoplay|preload|style)(="[^"]*")?/gi, "");
      return `<div${keep} role="img" aria-label="Audio file not stored: ${esc(fileOf(src))}" style="display:flex;align-items:center;gap:12px;height:48px;padding:0 14px;margin:16px 0;` +
        `border:1px solid #d9dee3;border-radius:6px;background:#f1f3f5;font:13px -apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#4a5560">` +
        `<span style="display:inline-flex;width:26px;height:26px;border-radius:50%;border:1.5px solid #8a95a1;align-items:center;justify-content:center;color:#8a95a1;font-size:10px">&#9654;</span>` +
        `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(fileOf(src))}</span>` +
        `<span style="color:#8a95a1;font-size:12px">Audio not stored</span></div>`;
    });
}
