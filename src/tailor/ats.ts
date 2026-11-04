import type { JobAnalysis, Resume } from "../schemas.js";
import { norm } from "../util/text.js";
import { resumePlainText } from "../render/resumeHtml.js";
import type { MarketProfile } from "../market.js";

/** Variações comuns para casar termos ("Node.js" ≈ "NodeJS" ≈ "Node"). */
function variants(term: string): string[] {
  const n = norm(term);
  const out = new Set([n, n.replace(/\./g, ""), n.replace(/\.js$/, ""), n.replace(/js$/, ".js"), n.replace(/-/g, " "), n.replace(/\s+/g, "")]);
  const aliases: Record<string, string[]> = {
    "rest api": ["rest apis", "apis rest", "api rest", "restful"],
    "rest apis": ["rest api", "apis rest", "restful"],
    postgres: ["postgresql"],
    postgresql: ["postgres"],
    "ci/cd": ["ci cd", "continuous integration"],
    llm: ["llms", "large language model"],
    llms: ["llm", "large language model"],
    "large language models": ["llm", "llms"],
    "generative ai": ["ia generativa", "genai"],
    "ia generativa": ["generative ai"],
    "amazon web services": ["aws"],
    aws: ["amazon web services"],
    "front-end": ["front end", "frontend"],
    "back-end": ["back end", "backend"],
    microservices: ["microsservicos"],
    microsservicos: ["microservices"],
    "testes automatizados": ["jest", "testing library", "cypress", "playwright"],
    "automated testing": ["jest", "testing library", "cypress", "playwright"],
  };
  for (const a of aliases[n] ?? []) out.add(a);
  return [...out].filter((v) => v.length > 1);
}

function contains(haystack: string, term: string): boolean {
  return variants(term).some((v) => {
    // termos curtos (ex.: "go", "ai") exigem fronteira de palavra
    if (v.length <= 3) return new RegExp(`(^|[^a-z0-9])${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(haystack);
    return haystack.includes(v);
  });
}

export interface AtsReport {
  score: number;
  covered: string[];
  /** Termos que você TEM (estão nas fontes) mas o currículo não mostra. */
  coverable: string[];
  /** Termos sem evidência: lacuna real. Não adicionar. */
  gaps: string[];
  checks: { ok: boolean; item: string }[];
}

export function atsReport(
  resume: Resume,
  analysis: JobAnalysis,
  sourcesText: string,
  opts: { pages: number; market: MarketProfile; fileName: string },
): AtsReport {
  const text = norm(resumePlainText(resume));
  const src = norm(sourcesText);
  const terms = [...new Set([...analysis.atsKeywords, ...analysis.mustHave.filter((m) => m.split(" ").length <= 4)])];

  const covered: string[] = [];
  const coverable: string[] = [];
  const gaps: string[] = [];
  for (const t of terms) {
    if (contains(text, t)) covered.push(t);
    else if (contains(src, t)) coverable.push(t);
    else gaps.push(t);
  }
  const reachable = covered.length + coverable.length;
  const score = reachable ? Math.round((covered.length / reachable) * 100) : 100;

  // "Pessoa Desenvolvedora Fullstack Node/React III (IAM | Segurança)" → ["desenvolvedor", "fullstack", "node", "react"]
  const titleWords = norm(analysis.roleTitle)
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\b(pessoa|senior|sr|pleno|junior|jr|mid|level|ii|iii|iv|de|da|do|em|para|com|e|and|of|the)\b/g, " ")
    .replace(/desenvolvedora/g, "desenvolvedor")
    .replace(/engenheira/g, "engenheiro")
    .split(/[\s/|,-]+/)
    .filter((w) => w.length > 2);
  const head = norm(`${resume.headline} ${resume.summary}`).replace(/full[\s-]stack/g, "fullstack");
  const titleHits = titleWords.filter((w) => head.includes(w.replace(/full[\s-]stack/g, "fullstack"))).length;

  const checks = [
    { ok: true, item: "Layout de uma coluna, sem tabelas/imagens/ícones (template)" },
    { ok: true, item: "Títulos de seção padrão e contato no corpo do documento (não no cabeçalho/rodapé do PDF)" },
    { ok: true, item: "PDF com texto selecionável gerado pelo Chrome" },
    { ok: opts.pages > 0 && opts.pages <= 2, item: `Tamanho: ${opts.pages} página(s) (ideal 1–2)` },
    { ok: titleWords.length === 0 || titleHits / titleWords.length >= 0.6, item: `Título da vaga ("${analysis.roleTitle}") refletido no headline/resumo` },
    { ok: resume.experience.every((e) => /^(\d{2}\/)?\d{4}$/.test(e.start)), item: "Datas no formato MM/AAAA" },
    { ok: /^[A-Za-z0-9_.-]+\.pdf$/.test(opts.fileName), item: `Nome do arquivo sem espaços/acentos: ${opts.fileName}` },
    { ok: opts.market.paper === (opts.market.market === "US" || opts.market.market === "CA" ? "Letter" : "A4"), item: `Papel ${opts.market.paper} para o mercado ${opts.market.market}` },
  ];

  return { score, covered, coverable, gaps, checks };
}

export function atsMarkdown(r: AtsReport): string {
  return `# Relatório ATS

**Cobertura de palavras-chave (do que é verdadeiro para você): ${r.score}%**

## Checklist de formato
${r.checks.map((c) => `- [${c.ok ? "x" : " "}] ${c.item}`).join("\n")}

## Palavras-chave presentes no currículo (${r.covered.length})
${r.covered.map((k) => `- ${k}`).join("\n") || "- (nenhuma)"}

## Você tem, mas o currículo não mostra (${r.coverable.length})
> Evidência nas suas fontes. Vale encaixar onde for verdadeiro.
${r.coverable.map((k) => `- ${k}`).join("\n") || "- (nenhuma)"}

## Lacunas reais — NÃO adicionar (${r.gaps.length})
> Sem evidência nas fontes. Se você tiver essa experiência, registre no profile_truth.md e gere de novo.
${r.gaps.map((k) => `- ${k}`).join("\n") || "- (nenhuma)"}
`;
}
