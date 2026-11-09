import { htmlToText } from "../util/text.js";

/**
 * Texto de uma vaga a partir da página dela, sem o resto do site (menu, rodapé, "vagas parecidas").
 *
 * 1. JobPosting em JSON-LD: o formato que os sites de vaga publicam para o Google (Gupy, Greenhouse,
 *    Lever, Workday, Wellfound, Indeed...). Traz a descrição limpa, a empresa, o local e o salário.
 * 2. Sem isso, o conteúdo principal da página (<main>, ou <article>), sem cabeçalho, menu, rodapé e formulários.
 */
/** Primeira linha da descrição das vagas da busca na web: o texto é um resumo escrito pela IA, não o da vaga. */
export const WEB_SUMMARY_HEADER = "[Resumo da busca web — confira a vaga completa no link]";
export const isWebSummary = (description: string) => description.startsWith("[Resumo da busca web");

export function jobPageText(html: string): string {
  return postingText(html) ?? gupyText(html) ?? htmlToText(mainContent(html));
}

/** Dados que páginas feitas em Next.js mandam junto (`<script id="__NEXT_DATA__">`). */
export function nextData(html: string): any {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** A vaga da página de uma vaga da Gupy (`empresa.gupy.io/jobs/123`), se for uma. */
export function gupyJobData(html: string): Obj | null {
  const job = nextData(html)?.props?.pageProps?.job;
  return isObj(job) && str(job.name) ? job : null;
}

export const GUPY_WORKPLACE: Record<string, string> = { remote: "Remoto", hybrid: "Híbrido", "on-site": "Presencial" };
export const GUPY_JOB_TYPE: Record<string, string> = {
  vacancy_type_effective: "Efetivo (CLT)",
  vacancy_legal_entity: "PJ",
  vacancy_type_internship: "Estágio",
  vacancy_type_temporary: "Temporário",
  vacancy_type_apprentice: "Jovem aprendiz",
  vacancy_type_trainee: "Trainee",
  vacancy_type_talent_pool: "Banco de talentos (não é uma vaga aberta agora)",
};

/** Página de vaga da Gupy: não tem JSON-LD; a descrição, as responsabilidades e os requisitos vêm separados. */
function gupyText(html: string): string | null {
  const job = gupyJobData(html);
  if (!job) return null;
  const career = isObj(job.careerPage) ? str(job.careerPage.name) : "";
  const place = [str(job.addressCity), str(job.addressState), str(job.addressCountry)].filter(Boolean).join(", ");
  const meta = [
    ["Empresa", career],
    ["Local", [GUPY_WORKPLACE[str(job.workplaceType)] ?? "", place].filter(Boolean).join(" · ")],
    ["Tipo", GUPY_JOB_TYPE[str(job.jobType)] ?? ""],
    ["Inscrições até", str(job.registerEndDate).slice(0, 10)],
  ].filter(([, v]) => v);
  const sections = [
    ["Descrição", job.description],
    ["Responsabilidades e atribuições", job.responsibilities],
    ["Requisitos e qualificações", job.prerequisites],
    ["Informações adicionais", job.relevantExperiences],
  ]
    .map(([h, v]) => [h, htmlToText(str(v))])
    .filter(([, v]) => v)
    .map(([h, v]) => `## ${h}\n\n${v}`);
  if (!sections.length) return null;
  return [`# ${str(job.name)}`, meta.map(([k, v]) => `${k}: ${v}`).join("\n"), ...sections].filter(Boolean).join("\n\n");
}

/** O bloco JobPosting (JSON-LD) da página, se houver. */
export function jobPostingLd(html: string): Obj | null {
  return ldObjects(html).find((o) => list(o["@type"]).some((t) => str(t).toLowerCase() === "jobposting")) ?? null;
}

/** Texto visível do conteúdo principal da página (sem scripts, menu e rodapé). */
export function visibleText(html: string): string {
  return htmlToText(mainContent(html));
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const nameOf = (v: unknown) => (isObj(v) ? str(v.name) : str(v));

/** Todos os objetos dos blocos JSON-LD da página (inclusive dentro de listas e de @graph). */
function ldObjects(html: string): Obj[] {
  const out: Obj[] = [];
  const visit = (v: unknown) => {
    for (const item of list(v)) {
      if (!isObj(item)) continue;
      out.push(item);
      if (item["@graph"]) visit(item["@graph"]);
    }
  };
  for (const m of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1].trim()));
    } catch {
      /* bloco inválido: ignora */
    }
  }
  return out;
}

function place(v: unknown): string {
  if (!isObj(v)) return str(v);
  const a = isObj(v.address) ? v.address : v;
  return [a.addressLocality, a.addressRegion, nameOf(a.addressCountry)].map((x) => (typeof x === "string" ? x.trim() : nameOf(x))).filter(Boolean).join(", ");
}

function salary(v: unknown): string {
  if (!isObj(v)) return str(v);
  const value = isObj(v.value) ? v.value : v;
  const amount = [str(value.minValue), str(value.maxValue)].filter(Boolean).join("–") || str(value.value);
  if (!amount) return "";
  const unit = { HOUR: "por hora", DAY: "por dia", WEEK: "por semana", MONTH: "por mês", YEAR: "por ano" }[str(value.unitText).toUpperCase()] ?? "";
  return [str(v.currency), amount, unit].filter(Boolean).join(" ");
}

function postingText(html: string): string | null {
  const p = ldObjects(html).find((o) => list(o["@type"]).some((t) => str(t).toLowerCase() === "jobposting"));
  if (!p) return null;
  const description = htmlToText(str(p.description));
  if (description.length < 200) return null;
  const remote = str(p.jobLocationType).toUpperCase() === "TELECOMMUTE";
  const locations = list(p.jobLocation).map(place).filter(Boolean);
  const countries = list(p.applicantLocationRequirements).map(nameOf).filter(Boolean);
  const months = isObj(p.experienceRequirements) ? str(p.experienceRequirements.monthsOfExperience) : "";
  const meta = [
    ["Empresa", nameOf(p.hiringOrganization)],
    ["Local", [remote ? "Remoto" : "", ...locations].filter(Boolean).join(" · ")],
    ["Aceita candidatos de", countries.length > 12 ? `${countries.slice(0, 12).join(", ")} e mais ${countries.length - 12}` : countries.join(", ")],
    ["Tipo", list(p.employmentType).map(str).filter((t) => t && t.toUpperCase() !== "OTHER").join(", ")],
    ["Salário", salary(p.baseSalary)],
    ["Experiência", months ? `${months} meses` : str(p.experienceRequirements)],
    ["Publicada em", str(p.datePosted).slice(0, 10)],
    ["Inscrições até", str(p.validThrough).slice(0, 10)],
  ].filter(([, v]) => v);
  const title = str(p.title);
  return [title && `# ${title}`, meta.map(([k, v]) => `${k}: ${v}`).join("\n"), description].filter(Boolean).join("\n\n");
}

/** O conteúdo principal da página, sem cabeçalho, menu, rodapé, barras laterais e formulários. */
function mainContent(html: string): string {
  const clean = html
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<(script|style|noscript|template|svg|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(header|nav|footer|aside|form|button|select)\b[\s\S]*?<\/\1>/gi, " ");
  const pick = (tag: string) => clean.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)</${tag}>`, "i"))?.[1];
  return pick("main") ?? pick("article") ?? pick("body") ?? clean;
}
