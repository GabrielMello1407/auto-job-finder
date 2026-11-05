import { htmlToText } from "../util/text.js";

/**
 * Texto de uma vaga a partir da página dela, sem o resto do site (menu, rodapé, "vagas parecidas").
 *
 * 1. JobPosting em JSON-LD: o formato que os sites de vaga publicam para o Google (Gupy, Greenhouse,
 *    Lever, Workday, Wellfound, Indeed...). Traz a descrição limpa, a empresa, o local e o salário.
 * 2. Sem isso, o conteúdo principal da página (<main>, ou <article>), sem cabeçalho, menu, rodapé e formulários.
 */
export function jobPageText(html: string): string {
  return postingText(html) ?? htmlToText(mainContent(html));
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
