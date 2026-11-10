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
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    // <li><p>texto</p></li> (comum em feeds RSS): o marcador fica na mesma linha do texto.
    .replace(/<li[^>]*>\s*(<p[^>]*>)?/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|section|article|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return tidyText(decodeEntities(s));
}

const MARKER = /^[-•·*–]$/;
const STARTS_WITH_MARKER = /^[-•·*–](\s|$)/;

/**
 * Espaços normalizados e sem linhas em branco seguidas. Um marcador de lista sozinho na linha é juntado
 * ao texto que vem logo depois ("-" / "SQL" vira "- SQL"); se depois vier outro marcador, é um item
 * vazio (menu de site) e sai.
 */
/**
 * Sem travessão (—) nem meia-risca (–) como pontuação: em currículo, carta e e-mail soa como texto de IA.
 * - "text": vira vírgula ("Portal AITEC — engenheiro único" → "Portal AITEC, engenheiro único");
 * - "title": o resto vai entre parênteses ("TV Box Educacional — UENP — em desenvolvimento" →
 *   "TV Box Educacional (UENP, em desenvolvimento)");
 * - "subject" (assunto de e-mail): hífen; "headline": barra vertical, como o resto da linha.
 * Intervalos de data e número ("02/2025 – atual", "10–20") viram hífen comum ("02/2025 - atual", "10-20"):
 * nenhum "—" ou "–" sobra.
 */
export function withoutDashes(s: string, kind: "text" | "title" | "subject" | "headline" = "text"): string {
  if (!/[—–]/.test(s)) return s;
  // Traço de pontuação: não vem depois de um dígito, com ou sem espaço (aí é intervalo: "2023 – 2024").
  const DASH = /(?<!\d\s*)\s*[—–]\s*/g;
  let out: string;
  if (kind === "title") {
    const parts = s.split(DASH).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) out = s.replace(DASH, " ");
    else {
      const [first, ...rest] = parts;
      // Se o resto já tem parênteses, parêntese dentro de parêntese fica feio: vai com vírgula.
      out = rest.some((p) => /[()]/.test(p)) || /\)$/.test(first) ? parts.join(", ") : `${first} (${rest.join(", ")})`;
    }
  } else out = s.replace(DASH, kind === "subject" ? " - " : kind === "headline" ? " | " : ", ");
  // O que sobrou é intervalo (depois de um dígito): hífen comum, com ou sem espaço como estava.
  out = out.replace(/(\s*)[—–](\s*)/g, (_, a: string, b: string) => (a || b ? " - " : "-"));
  return out
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([.;:!?)])/g, "$1")
    .replace(/\(\s*,\s*/g, "(")
    .replace(/^\s*[,|-]\s*|\s*[,|-]\s*$/g, "")
    .replace(/[ \t]{2,}/g, " ");
}

export function tidyText(text: string): string {
  const lines = normalizeLines(text);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!MARKER.test(lines[i])) {
      out.push(lines[i]);
      continue;
    }
    let next = i + 1;
    while (next < lines.length && lines[next] === "") next++;
    if (next < lines.length && !STARTS_WITH_MARKER.test(lines[next])) {
      lines[next] = `- ${lines[next]}`;
      i = next - 1; // pula as linhas em branco entre o marcador e o texto
    }
  }
  return out
    .filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")
    .trim();
}

function normalizeLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim());
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
