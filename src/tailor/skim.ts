import type { JobAnalysis, Resume } from "../schemas.js";
import { norm } from "../util/text.js";

/**
 * Teste dos primeiros segundos, sem IA. Na primeira olhada o recrutador lê o topo: título, resumo e o
 * cargo atual (Ladders 2018: ~7 segundos, olhando cargos e títulos; ver docs/how-it-works.md,
 * "Research behind the features"). O teste confere se esse topo já mostra o cargo da vaga e as
 * palavras-chave que o currículo comprova mais abaixo.
 */

const STOP = new Set([
  ...["de", "da", "do", "das", "dos", "e", "em", "para", "com", "a", "o", "as", "os", "the", "and", "of", "for", "in", "at", "to", "or", "ou"],
  // Senioridade e forma do cargo não decidem se o título bate.
  ...["jr", "junior", "pleno", "senior", "sr", "pl", "mid", "level", "lead", "staff", "principal", "iii", "ii", "i", "estagio", "trainee", "remoto", "remote", "hibrido", "hybrid", "pessoa", "vaga"],
]);
const words = (s: string) =>
  norm(s)
    .replace(/[^a-z0-9+#.]+/g, " ")
    .split(" ")
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter((w) => w.length >= 2 && !STOP.has(w));

/** Texto que o recrutador lê primeiro: título, resumo e o cargo atual com os 2 primeiros tópicos. */
export function topBlock(r: Resume): string {
  const first = r.experience[0];
  return [r.headline, r.summary, first ? `${first.title} ${first.company} ${first.bullets.slice(0, 2).join(" ")}` : ""].join("\n");
}

const has = (text: string, term: string) => {
  const t = norm(text);
  const k = norm(term).trim();
  return k.length > 0 && new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(t);
};

export interface SkimResult {
  /** O título do currículo mostra o cargo da vaga (a maior parte das palavras do cargo). */
  titleMatch: boolean;
  /** Palavras-chave da vaga que o currículo comprova (estão nele) e já aparecem no topo. */
  foundTop: string[];
  /** As que estão mais abaixo no currículo mas não no topo: subir para o resumo ou o título. */
  missingTop: string[];
  /** Tópicos de experiência com resultado em número. */
  measurable: { withNumber: number; total: number };
  pass: boolean;
}

export function skimTest(resume: Resume, analysis: Pick<JobAnalysis, "roleTitle" | "mustHave" | "atsKeywords">): SkimResult {
  const role = words(analysis.roleTitle);
  const head = new Set(words(resume.headline));
  const titleMatch = role.length > 0 && role.filter((w) => head.has(w)).length >= Math.ceil(role.length / 2);

  const all = JSON.stringify(resume);
  const top = topBlock(resume);
  // As palavras-chave mais importantes: as da vaga que o currículo comprova (estão nele), na ordem da análise.
  const proven = [...new Set(analysis.atsKeywords)].filter((k) => has(all, k)).slice(0, 8);
  const foundTop = proven.filter((k) => has(top, k));
  const missingTop = proven.filter((k) => !has(top, k));

  const bullets = resume.experience.flatMap((e) => e.bullets);
  const withNumber = bullets.filter((b) => /\d/.test(b)).length;
  return { titleMatch, foundTop, missingTop, measurable: { withNumber, total: bullets.length }, pass: titleMatch && missingTop.length <= 2 };
}

/** O que o editor deve ajustar no topo (só com o que o currículo já comprova). Vazio se passou. */
export function skimFeedback(s: SkimResult, roleTitle: string): string {
  if (s.pass) return "";
  return [
    s.titleMatch ? "" : `- O título (headline) não mostra o cargo da vaga ("${roleTitle}"). Use o nome do cargo da vaga no título, sem subir a senioridade além do que o perfil sustenta.`,
    s.missingTop.length > 2 ? `- Estas palavras-chave da vaga já estão no currículo, mas não no topo: ${s.missingTop.join(", ")}. Traga as mais importantes para o resumo ou o título, sem inventar.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function skimMarkdown(s: SkimResult): string {
  return `## Teste dos primeiros segundos (topo do currículo)

- ${s.pass ? "✅ Passou" : "⚠ Pode melhorar"}: na primeira olhada o recrutador lê o título, o resumo e o cargo atual.
- Cargo da vaga no título: ${s.titleMatch ? "sim" : "não"}
- Palavras-chave da vaga já no topo: ${s.foundTop.join(", ") || "nenhuma"}
- No currículo, mas não no topo: ${s.missingTop.join(", ") || "nenhuma"}
- Resultados com número: ${s.measurable.withNumber} de ${s.measurable.total} tópicos de experiência${
    s.measurable.total && s.measurable.withNumber / s.measurable.total < 0.4 ? ' (poucos: veja "Números que faltam" no Perfil)' : ""
  }
`;
}
