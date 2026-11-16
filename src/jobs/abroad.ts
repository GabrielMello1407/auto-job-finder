import type { Preferences } from "../profile.js";
import type { Knockout, Triage } from "../schemas.js";
import { norm } from "../util/text.js";

/**
 * Vaga no exterior: presencial ou híbrida em outro país, ou remota só para quem já mora em outro país.
 *
 * Vaga remota restrita a um país quer quem já mora e pode trabalhar lá; não leva ninguém. Já a vaga
 * presencial ou híbrida no exterior pode levar, se a empresa patrocinar o visto e a mudança. A triagem
 * (IA) só diz o país (`workCountry`) e o que o anúncio diz sobre visto (`visaSponsorship`); aqui, sem IA,
 * isso vira um critério eliminatório coerente com as Preferências: de onde a pessoa pode trabalhar
 * (`acceptedRegions`) e se ela aceita se mudar (`relocateAbroad`, `relocationCountries`).
 */

/** Nomes do mesmo país em português e em inglês (a IA, a fonte e a pessoa podem usar qualquer um). */
const COUNTRY_NAMES: string[][] = [
  ["brasil", "brazil"],
  ["estados unidos", "eua", "usa", "us", "united states", "united states of america"],
  ["canada"],
  ["mexico"],
  ["argentina"],
  ["chile"],
  ["colombia"],
  ["peru"],
  ["uruguai", "uruguay"],
  ["paraguai", "paraguay"],
  ["portugal"],
  ["espanha", "spain"],
  ["franca", "france"],
  ["alemanha", "germany", "deutschland"],
  ["holanda", "paises baixos", "netherlands", "the netherlands"],
  ["belgica", "belgium"],
  ["italia", "italy"],
  ["irlanda", "ireland"],
  ["reino unido", "united kingdom", "uk", "inglaterra", "england", "escocia", "scotland"],
  ["suica", "switzerland"],
  ["austria"],
  ["suecia", "sweden"],
  ["noruega", "norway"],
  ["dinamarca", "denmark"],
  ["finlandia", "finland"],
  ["polonia", "poland"],
  ["republica tcheca", "czech republic", "czechia"],
  ["estonia"],
  ["japao", "japan"],
  ["coreia do sul", "south korea"],
  ["china"],
  ["india"],
  ["singapura", "singapore"],
  ["emirados arabes unidos", "united arab emirates", "uae", "dubai"],
  ["israel"],
  ["australia"],
  ["nova zelandia", "new zealand"],
  ["africa do sul", "south africa"],
];

/** Os nomes conhecidos do país (ou o próprio nome, se não estiver na lista). */
function namesOf(country: string): string[] {
  const n = norm(country).replace(/\(.*?\)/g, "").trim();
  return COUNTRY_NAMES.find((g) => g.includes(n)) ?? (n ? [n] : []);
}

const hasWord = (text: string, word: string) => new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(text);

/** Dois nomes são o mesmo país? ("EUA" e "United States": sim.) */
export function sameCountry(a: string, b: string): boolean {
  const names = namesOf(a);
  const other = norm(b).replace(/\(.*?\)/g, "").trim();
  return Boolean(other) && names.includes(other);
}

/** O texto (local da vaga, por exemplo) cita o país? ("Lisboa, Portugal" cita Portugal.) */
export function mentionsCountry(text: string, country: string): boolean {
  const t = norm(text);
  return namesOf(country).some((n) => hasWord(t, n));
}

/** Começo do critério que este módulo cria (para a interface achar o dele entre os da IA). */
// "no exterior (país)" em vez de "em país": cada país pede um artigo (no Brasil, em Portugal, nos Estados Unidos).
export const ABROAD_REQUIREMENT = "Morar e trabalhar no exterior";

/** O critério eliminatório da vaga no exterior, ou null se dá para trabalhar de onde a pessoa mora. */
export function abroadKnockout(
  triage: Pick<Triage, "workCountry" | "visaSponsorship">,
  remote: boolean | null | undefined,
  prefs: Pick<Preferences, "country" | "acceptedRegions" | "relocateAbroad" | "relocationCountries">,
): Knockout | null {
  const country = triage.workCountry?.trim();
  if (!country || sameCountry(country, prefs.country)) return null;
  const k = (meets: Knockout["meets"], evidence: string): Knockout => ({ requirement: `${ABROAD_REQUIREMENT} (${country})`, kind: "local", meets, evidence });

  // A pessoa disse que pode trabalhar de lá (Preferências → de onde você pode trabalhar).
  if (prefs.acceptedRegions.some((r) => sameCountry(country, r))) return k("sim", `Nas Preferências, você disse que pode trabalhar de lá (${country}).`);
  const sponsored = triage.visaSponsorship === "sim";
  // Remota só para quem já mora lá: a empresa não leva ninguém (a não ser que o anúncio diga que patrocina).
  if (remote !== false && !sponsored) return k("nao", `A vaga é remota e só aceita quem já mora lá (${country}). O seu país é ${prefs.country}.`);
  if (!prefs.relocateAbroad) return k("nao", "Nas Preferências, você não aceita se mudar para outro país.");
  if (prefs.relocationCountries.length && !prefs.relocationCountries.some((c) => sameCountry(country, c)))
    return k("nao", `${country} não está entre os países para onde você aceita se mudar.`);
  if (sponsored) return k("sim", "A vaga patrocina o visto e a mudança, e você aceita se mudar.");
  if (triage.visaSponsorship === "nao") return k("nao", `A vaga não patrocina visto: pede quem já pode trabalhar lá (${country}).`);
  return k("incerto", "A vaga não diz se patrocina o visto. Pergunte ao recrutador antes de gerar o pacote.");
}

/**
 * Põe o critério da vaga no exterior na triagem. Os critérios de local e de autorização que a IA tenha
 * criado saem (o assunto é o mesmo, decidido aqui). Se não atende ou é incerto, a vaga não fica como
 * "candidatar": a pessoa decide (com "incerto", depois de perguntar sobre o visto).
 */
export function applyAbroad<T extends Triage>(triage: T, remote: boolean | null | undefined, prefs: Parameters<typeof abroadKnockout>[2]): T {
  const k = abroadKnockout(triage, remote, prefs);
  if (!k) return triage;
  const others = (triage.knockouts ?? []).filter((x) => x.kind !== "local" && x.kind !== "autorizacao");
  const recommendation = k.meets !== "sim" && triage.recommendation === "candidatar" ? "decidir" : triage.recommendation;
  return { ...triage, knockouts: [k, ...others], recommendation };
}

/** A situação da vaga no exterior, para a interface (selo ✈️) e a prioridade. */
export function abroadStatus(triage: Triage | undefined): { country: string; sponsorship: string; meets: Knockout["meets"] } | null {
  const k = triage?.knockouts?.find((x) => x.requirement.startsWith(ABROAD_REQUIREMENT));
  return k && triage?.workCountry ? { country: triage.workCountry, sponsorship: triage.visaSponsorship ?? "nao_informado", meets: k.meets } : null;
}

/**
 * Filtro (sem IA): vaga presencial ou híbrida fora das cidades da pessoa passa quando ela aceita se mudar
 * para outro país e o local não é no país dela (e é num dos países escolhidos, se ela escolheu).
 */
export function onsiteAbroadOk(location: string, prefs: Pick<Preferences, "country" | "relocateAbroad" | "relocationCountries">): boolean {
  if (!prefs.relocateAbroad || !location.trim() || mentionsCountry(location, prefs.country)) return false;
  return !prefs.relocationCountries.length || prefs.relocationCountries.some((c) => mentionsCountry(location, c));
}
