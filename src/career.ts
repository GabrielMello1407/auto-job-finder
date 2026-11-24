import type { Resume } from "./schemas.js";
import { norm } from "./util/text.js";

/**
 * O tempo de carreira como um recrutador conta, sem IA: pelas datas das posições do currículo. Vale para
 * qualquer área. Alimenta a triagem (senioridade pedida contra o tempo com datas), o número de páginas do
 * currículo e a ordem das posições que acontecem ao mesmo tempo.
 */

type Role = Resume["experience"][number];

const CURRENT = /^(atual|presente|o momento|hoje|present|current|now|ongoing|today)\b/i;
const VOLUNTEER = /volunt[aá]ri|voluntariado|volunteer/i;
/** Empresa ou projeto da própria pessoa: conta como experiência, mas não é o emprego principal quando há um. */
const OWN = /\b(co-?)?(fundador|fundadora|founder|s[oó]ci[oa]|owner|propriet[aá]ri[oa]|empreendedor|empreendedora)\b|projeto pr[oó]prio|saas pr[oó]prio|empresa pr[oó]pria|own (company|business|project)/i;

export const isCurrent = (r: Role) => CURRENT.test(r.end.trim());
export const isVolunteer = (r: Role) => VOLUNTEER.test(`${r.title} ${r.company}`);
export const isOwnVenture = (r: Role) => OWN.test(`${r.title} ${r.company}`);

/**
 * "03/2024", "2024" ou "Atual" em número de meses (ano × 12 + mês). Nunca passa de hoje: "Atual (até
 * 01/2027)" conta até agora, não até o fim previsto. Sem data reconhecível, null.
 */
export function monthIndex(text: string, now = new Date()): number | null {
  const t = norm(text).trim();
  const today = now.getFullYear() * 12 + now.getMonth();
  if (CURRENT.test(t)) return today;
  const mmYYYY = t.match(/(\d{1,2})\s*[/.-]\s*(\d{4})/);
  if (mmYYYY) return Math.min(today, Number(mmYYYY[2]) * 12 + Math.min(11, Math.max(0, Number(mmYYYY[1]) - 1)));
  const yyyy = t.match(/\b(19|20)\d{2}\b/);
  return yyyy ? Math.min(today, Number(yyyy[0]) * 12) : null;
}

/**
 * Meses de experiência profissional com datas: junta as posições que se sobrepõem (dois empregos ao mesmo
 * tempo não contam em dobro) e deixa de fora o voluntariado. Puro.
 */
export function professionalMonths(r: Pick<Resume, "experience">, now = new Date()): number {
  const spans = r.experience
    .filter((e) => !isVolunteer(e))
    .map((e) => [monthIndex(e.start, now), monthIndex(e.end, now)] as const)
    .filter((s): s is readonly [number, number] => s[0] != null && s[1] != null && s[1] >= s[0])
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [s, e] of spans) {
    if (cur && s <= cur[1] + 1) cur[1] = Math.max(cur[1], e);
    else {
      if (cur) total += cur[1] - cur[0] + 1;
      cur = [s, e];
    }
  }
  if (cur) total += cur[1] - cur[0] + 1;
  return total;
}

/** "1 ano e 9 meses", "3 anos", "8 meses". */
export function monthsText(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const years = y ? `${y} ano${y > 1 ? "s" : ""}` : "";
  const rest = m ? `${m} ${m > 1 ? "meses" : "mês"}` : "";
  return [years, rest].filter(Boolean).join(" e ") || "menos de 1 mês";
}

/** Até 3 anos de experiência com datas, o currículo cabe em 1 página; daí em diante, até 2. */
export const EARLY_CAREER_MONTHS = 36;
export const pageLimit = (months: number): 1 | 2 => (months < EARLY_CAREER_MONTHS ? 1 : 2);

/**
 * Posições ao mesmo tempo: o emprego principal vem primeiro. Empresa ou projeto próprio e voluntariado que
 * correm em paralelo a um emprego atual descem para logo depois dele (antes, por começar depois, um
 * "Fundador" de 7 meses abria o currículo de quem se candidata a um emprego). Sem emprego atual de outro
 * tipo, nada muda: aí o projeto próprio é o trabalho principal. Puro.
 */
export function mainRoleFirst<T extends Pick<Resume, "experience">>(r: T): T {
  const side = (e: Role) => isCurrent(e) && (isOwnVenture(e) || isVolunteer(e));
  const mains = r.experience.filter((e) => isCurrent(e) && !side(e));
  if (!mains.length) return r;
  const lastMain = r.experience.lastIndexOf(mains[mains.length - 1]);
  const moved = r.experience.filter((e, i) => side(e) && i < lastMain);
  if (!moved.length) return r;
  const rest = r.experience.filter((e) => !moved.includes(e));
  const at = rest.indexOf(mains[mains.length - 1]) + 1;
  return { ...r, experience: [...rest.slice(0, at), ...moved, ...rest.slice(at)] };
}
