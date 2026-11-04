import crypto from "node:crypto";

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&ndash;": "–",
  "&mdash;": "—",
  "&bull;": "•",
  "&hellip;": "…",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

/** HTML → texto legível (mantém quebras de bloco e bullets). */
export function htmlToText(html: string): string {
  let s = decodeEntities(html); // algumas APIs mandam HTML escapado
  s = s
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|section|article|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")
    .trim();
}

export function slugify(text: string, max = 60): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export function shortHash(s: string, len = 8): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, len);
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "\n[...texto truncado]";
}

/** Normaliza para comparação (minúsculas, sem acento, sem pontuação extra). */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Corrige UTF-8 lido como Latin-1 ("Ã§" → "ç", "â€“" → "–"), comum em algumas APIs. */
export function fixMojibake(s: string): string {
  if (!/[ÃÂâ][\u0080-¿]/.test(s)) return s;
  const fixed = Buffer.from(s, "latin1").toString("utf8");
  return fixed.includes("�") ? s : fixed;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
