import type { Job } from "../schemas.js";
import { canonicalUrl } from "./dedupe.js";
import { addJob } from "./search.js";

/**
 * Vários links de vaga de uma vez: um e-mail de alerta (LinkedIn, Indeed, Gupy...) ou uma lista colada.
 * Acha os links, desembrulha os redirecionamentos de e-mail e de rastreio, deixa só os que parecem de UMA vaga
 * e adiciona cada um como se fosse colado sozinho (o agente abre a página pública da vaga).
 */

const URL_RE = /https?:\/\/[^\s<>"'()[\]{}|\\^`]+/gi;
const MAX_LINKS = 30;

/** Tira o redirecionamento de e-mail (Outlook SafeLinks, Google) e devolve o link da vaga; "" se não der. */
export function unwrapLink(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.replace(/[.,;:!?]+$/, ""));
  } catch {
    return "";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  const host = u.hostname.toLowerCase();
  if (/safelinks\.protection\.outlook\.com$/.test(host) && u.searchParams.get("url")) return unwrapLink(u.searchParams.get("url")!);
  if (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname === "/url") {
    const q = u.searchParams.get("q") ?? u.searchParams.get("url");
    return q ? unwrapLink(q) : "";
  }
  return u.toString();
}

/** Parece o link de UMA vaga (e não busca, perfil, descadastro, imagem...)? */
export function looksLikeJob(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const p = u.pathname.toLowerCase();
  const segments = p.split("/").filter(Boolean);
  if (/\.(png|jpe?g|gif|svg|webp|ico|css|js)$/.test(p)) return false;
  if (/unsubscribe|descadastr|optout|opt-out|preferen|settings|configura|privacy|privacidade|terms|termos|\/help|ajuda|login|signin|sign-in|signup|\/feed/.test(p)) return false;
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return /\/jobs\/view\/(?:[^/]*?-)?\d{6,}/.test(p) || Boolean(u.searchParams.get("currentJobId"));
  if (/(^|\.)indeed\.[a-z.]+$/.test(host)) return Boolean(u.searchParams.get("jk") ?? u.searchParams.get("vjk"));
  if (host.endsWith(".gupy.io")) return /^\/(jobs\/\d+|job\/)/.test(p);
  if (host.endsWith("greenhouse.io")) return /\/jobs\/\d+/.test(p) || Boolean(u.searchParams.get("gh_jid"));
  if (host.endsWith("lever.co") || host.endsWith("ashbyhq.com")) return segments.length >= 2;
  if (host.endsWith("workable.com")) return /\/(j|view)\/[a-z0-9]+/.test(p);
  if (Boolean(u.searchParams.get("gh_jid"))) return true;
  // Outros sites: um caminho de vaga ("/jobs/123", "/vagas/desenvolvedor-x", "/careers/...") com algo depois.
  return /\/(jobs?|vagas?|careers?|carreiras|oportunidades?|positions?|openings?|o|j)\/[^/]{3,}/.test(p);
}

/** Os links de vaga do texto, sem repetir (pelo link canônico), no máximo `max`. */
export function extractJobLinks(text: string, max = MAX_LINKS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // E-mail copiado do HTML pode trazer "&amp;" nos links.
  for (const m of text.replace(/&amp;/g, "&").matchAll(URL_RE)) {
    const url = unwrapLink(m[0]);
    if (!url || !looksLikeJob(url)) continue;
    const link = canonicalUrl(url);
    if (seen.has(link)) continue;
    seen.add(link);
    out.push(link);
    if (out.length >= max) break;
  }
  return out;
}

export interface LinksResult {
  added: Job[];
  /** Já estavam salvas. */
  known: string[];
  /** Não abriram (login, bloqueio, página fora do ar), com o motivo. */
  failed: { url: string; reason: string }[];
}

/** Adiciona cada link como uma vaga colada. Um link que falha não para os outros. */
export async function addJobLinks(links: string[], log: (line: string) => void = console.log): Promise<LinksResult> {
  const r: LinksResult = { added: [], known: [], failed: [] };
  for (const [i, url] of links.entries()) {
    try {
      const job = await addJob({ url });
      r.added.push(job);
      log(`  ${i + 1}/${links.length} ✓ ${job.company} — ${job.title}`);
    } catch (e) {
      const reason = (e as Error).message;
      if (/já está cadastrada/i.test(reason)) {
        r.known.push(url);
        log(`  ${i + 1}/${links.length} = já estava salva: ${url}`);
      } else {
        r.failed.push({ url, reason });
        log(`  ${i + 1}/${links.length} ✗ ${url}: ${reason}`);
      }
    }
  }
  return r;
}
