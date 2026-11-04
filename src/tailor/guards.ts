import { forbiddenPatterns } from "../profile.js";
import type { Resume } from "../schemas.js";
import { norm } from "../util/text.js";
import { resumePlainText } from "../render/resumeHtml.js";

export interface GuardReport {
  /** Erros que bloqueiam: o editor precisa corrigir. */
  violations: string[];
  /** Alertas para revisão humana. */
  warnings: string[];
}

const NUM_RE = /\d+(?:[.,]\d+)*/g;

/** "5.235" e "5,235" → "5235"; "4,2" e "4.2" → "42". Compara só dígitos. */
const digits = (s: string) => s.replace(/[.,]/g, "");

function numbersIn(text: string): Set<string> {
  return new Set((text.match(NUM_RE) ?? []).map(digits));
}

/**
 * Travas determinísticas contra invenção — não dependem do modelo se auto-avaliar.
 * Comparam o currículo gerado com as fontes (profile_truth + currículos-base).
 */
export function runGuards(
  tailored: Resume,
  base: Resume,
  sourcesText: string,
  forbidden: { re: RegExp; msg: string }[] = forbiddenPatterns(),
): GuardReport {
  const violations: string[] = [];
  const warnings: string[] = [];
  const src = norm(sourcesText);

  // 1. Todas as posições preservadas, com as mesmas datas.
  for (const b of base.experience) {
    const t = tailored.experience.find((e) => norm(e.company) === norm(b.company));
    if (!t) {
      violations.push(`posição removida: ${b.title} @ ${b.company} — mantenha todas as experiências`);
      continue;
    }
    if (norm(t.start) !== norm(b.start) || norm(t.end) !== norm(b.end))
      violations.push(`datas alteradas em ${b.company}: fonte ${b.start} – ${b.end}, gerado ${t.start} – ${t.end}`);
    const tt = norm(t.title);
    const bt = norm(b.title);
    if (tt !== bt && !bt.includes(tt) && !tt.includes(bt))
      violations.push(`cargo alterado em ${b.company}: fonte "${b.title}", gerado "${t.title}"`);
    if (t.bullets.length < Math.min(2, b.bullets.length))
      warnings.push(`${b.company}: só ${t.bullets.length} bullet(s) — confira se nada relevante sumiu`);
  }
  for (const t of tailored.experience) {
    if (!base.experience.some((b) => norm(b.company) === norm(t.company)))
      violations.push(`experiência que não existe na base: ${t.title} @ ${t.company}`);
  }

  // 2. Números sem fonte.
  const srcNums = numbersIn(sourcesText);
  const text = resumePlainText(tailored);
  const orphan = [...numbersIn(text)].filter((n) => !srcNums.has(n));
  if (orphan.length) violations.push(`números sem fonte: ${orphan.join(", ")} — remova ou use o número exato das fontes`);

  // 3. Afirmações proibidas (profile/rules.json → "neverClaim").
  for (const f of forbidden) if (f.re.test(text)) violations.push(f.msg);

  // 4. Idiomas não podem mudar de nível.
  if (norm(tailored.languages) !== norm(base.languages))
    warnings.push(`linha de idiomas mudou: base "${base.languages}" → "${tailored.languages}"`);

  // 5. Certificações e formação: nada novo.
  for (const c of tailored.certifications)
    if (!base.certifications.some((b) => norm(b.name) === norm(c.name)) && !src.includes(norm(c.name)))
      violations.push(`certificação sem fonte: ${c.name}`);
  for (const e of tailored.education)
    if (!base.education.some((b) => norm(b.degree) === norm(e.degree)))
      warnings.push(`formação diferente da base: ${e.degree}`);

  // 6. Competências sem evidência nas fontes.
  const unknownSkills = tailored.skills
    .flatMap((g) => g.items)
    .filter((s) => {
      const core = norm(s).replace(/\(.*?\)/g, "").trim();
      return core.length > 1 && !src.includes(core);
    });
  if (unknownSkills.length)
    warnings.push(`competências não encontradas literalmente nas fontes (confira): ${unknownSkills.join(", ")}`);

  // 7. Projetos: precisam existir no profile_truth.
  for (const p of tailored.projects) {
    const key = norm(p.name).replace(/\(.*?\)/g, "").split(/\s+[—–-]\s+|:/)[0].trim();
    if (!src.includes(key)) violations.push(`projeto sem fonte: ${p.name}`);
  }

  return { violations, warnings };
}
