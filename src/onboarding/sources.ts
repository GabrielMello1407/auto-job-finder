import fs from "node:fs";
import path from "node:path";
import { settings } from "../config.js";
import { renderedPageText } from "../render/pdf.js";
import { htmlToText } from "../util/text.js";

/** Uma fonte de informação sobre a pessoa (currículo, LinkedIn, portfólio, respostas). */
export interface SourceDoc {
  kind: "curriculo" | "linkedin" | "portfolio" | "github" | "site" | "texto" | "respostas";
  label: string;
  origin: string;
  text: string;
}

const MAX_CHARS = 40_000;

/** PDF exportado do LinkedIn ("Salvar como PDF") tem seções fixas que dá para reconhecer. */
export function looksLikeLinkedinExport(text: string): boolean {
  const t = text.slice(0, 6000);
  // Currículo comum também tem o link do LinkedIn: exige as marcas do PDF gerado pelo próprio LinkedIn.
  return /linkedin\.com\/in\//i.test(t) && /(Top Skills|Principais competências|\(LinkedIn\)|Page \d+ of \d+|Página \d+ de \d+)/i.test(text);
}

async function pdfText(file: string): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

async function docxText(file: string): Promise<string> {
  const mammoth = await import("mammoth");
  const r = await (mammoth.default ?? mammoth).extractRawText({ path: file });
  return r.value;
}

/** Lê um arquivo (PDF, DOCX, TXT, MD, JSON) e detecta se é o PDF do LinkedIn. */
export async function readFileSource(input: string): Promise<SourceDoc> {
  const file = path.resolve(input.trim().replace(/^["']|["']$/g, ""));
  if (!fs.existsSync(file)) throw new Error(`Arquivo não encontrado: ${file}`);
  const ext = path.extname(file).toLowerCase();
  let text: string;
  if (ext === ".pdf") text = await pdfText(file);
  else if (ext === ".docx") text = await docxText(file);
  else if ([".txt", ".md", ".markdown", ".json", ".html", ".htm"].includes(ext)) {
    text = fs.readFileSync(file, "utf8");
    if (ext.startsWith(".htm")) text = htmlToText(text);
  } else throw new Error(`Formato não suportado (${ext}). Use PDF, DOCX, TXT ou MD.`);
  text = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 80)
    throw new Error(`Quase não há texto em ${path.basename(file)}. Se for um PDF escaneado (imagem), exporte de novo como texto ou cole o conteúdo.`);
  const linkedin = looksLikeLinkedinExport(text);
  const portfolio = /portf[oó]lio|portfolio/i.test(path.basename(file));
  return {
    kind: linkedin ? "linkedin" : portfolio ? "portfolio" : "curriculo",
    label: `${linkedin ? "LinkedIn (PDF exportado)" : portfolio ? "Portfólio" : "Currículo/documento"}: ${path.basename(file)}`,
    origin: file,
    text: text.slice(0, MAX_CHARS),
  };
}

export const LINKEDIN_EXPORT_HELP =
  "O LinkedIn bloqueia leitura automática do perfil. Exporte o seu: abra seu perfil → botão 'Mais' (ou 'Recursos') → 'Salvar como PDF', e informe o arquivo baixado. Também dá para colar o texto do perfil.";

async function githubSource(user: string): Promise<SourceDoc> {
  const headers: Record<string, string> = { "User-Agent": settings.userAgent, Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const get = async (u: string) => {
    const r = await fetch(u, { headers });
    if (!r.ok) throw new Error(`GitHub ${r.status} em ${u}`);
    return r.json() as Promise<any>;
  };
  const profile = await get(`https://api.github.com/users/${user}`);
  const repos = ((await get(`https://api.github.com/users/${user}/repos?sort=pushed&per_page=100`)) as any[])
    .filter((r) => !r.fork && !r.archived)
    .sort((a, b) => b.stargazers_count - a.stargazers_count || Date.parse(b.pushed_at) - Date.parse(a.pushed_at))
    .slice(0, 25);
  const lines = [
    `GitHub: ${profile.html_url}`,
    profile.name ? `Nome: ${profile.name}` : "",
    profile.bio ? `Bio: ${profile.bio}` : "",
    profile.blog ? `Site: ${profile.blog}` : "",
    profile.location ? `Local: ${profile.location}` : "",
    "",
    "Repositórios públicos (sem forks):",
    ...repos.map(
      (r) =>
        `- ${r.name}${r.description ? ` — ${r.description}` : ""} [${[r.language, ...(r.topics ?? [])].filter(Boolean).join(", ")}] ${r.homepage || r.html_url} (★${r.stargazers_count}, atualizado ${String(r.pushed_at).slice(0, 10)})`,
    ),
  ];
  return { kind: "github", label: `GitHub: ${user}`, origin: profile.html_url, text: lines.filter((l) => l !== undefined).join("\n") };
}

/** Lê um link: site/portfólio (renderiza JS se precisar) ou perfil do GitHub. LinkedIn não dá: pede o PDF. */
export async function readUrlSource(raw: string): Promise<SourceDoc> {
  const url = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  if (host.endsWith("linkedin.com")) throw new Error(LINKEDIN_EXPORT_HELP);
  const gh = host === "github.com" && u.pathname.split("/").filter(Boolean);
  if (gh && gh.length === 1) return githubSource(gh[0]);

  let text = "";
  try {
    const res = await fetch(url, { headers: { "User-Agent": settings.userAgent } });
    if (res.ok) text = htmlToText(await res.text());
  } catch {
    /* tenta renderizar */
  }
  if (text.length < 600) {
    // Site feito em React/Vue/etc.: abre no Chrome para pegar o texto montado.
    try {
      const rendered = await renderedPageText(url);
      if (rendered.length > text.length) text = rendered;
    } catch {
      /* fica com o que tiver */
    }
  }
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 80) throw new Error(`Não consegui ler o conteúdo de ${url}. Cole o texto ou salve a página em PDF.`);
  return { kind: "site", label: `Site/portfólio: ${host}${u.pathname === "/" ? "" : u.pathname}`, origin: url, text: text.slice(0, MAX_CHARS) };
}

/** Arquivo ou link, conforme o que a pessoa digitou. */
export function readSource(input: string): Promise<SourceDoc> {
  const v = input.trim().replace(/^["']|["']$/g, "");
  const isDoc = /\.(pdf|docx|txt|md|markdown|json|html?)$/i.test(v);
  const looksLikeUrl = /^(https?:\/\/|www\.)/i.test(v) || (!isDoc && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v));
  if (looksLikeUrl && !fs.existsSync(v)) return readUrlSource(v);
  return readFileSource(v);
}
