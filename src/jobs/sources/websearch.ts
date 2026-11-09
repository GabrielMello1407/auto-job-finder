import { z } from "zod";
import { webSearchStructured } from "../../llm.js";
import type { Preferences } from "../../profile.js";
import { today } from "../../util/text.js";
import { WEB_SUMMARY_HEADER } from "../page.js";
import type { RawJob } from "./index.js";

const WebJobsSchema = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      location: z.string(),
      remote: z.boolean(),
      url: z.string().describe("Link direto para a página da vaga"),
      site: z.string().describe("Ex.: LinkedIn, Gupy, Indeed, Glassdoor, site da empresa"),
      postedAt: z.string().describe("AAAA-MM-DD se souber; senão vazio"),
      summary: z.string().describe("Requisitos e responsabilidades principais, o mais completo possível"),
      salary: z.string(),
    }),
  ),
  discarded: z.array(z.string()).describe("Vagas vistas e descartadas, com motivo"),
});

/**
 * Busca vagas na web (LinkedIn, Gupy, Indeed, Glassdoor, Programathor, sites de carreira) usando a
 * ferramenta web_search do Claude. Útil para o mercado brasileiro, que não tem API pública aberta.
 */
export async function webSearchJobs(prefs: Preferences, profileSystem: string[], extra?: string): Promise<RawJob[]> {
  const sinceDate = new Date(Date.now() - prefs.maxAgeDays * 86400_000).toISOString().slice(0, 10);
  const user = `Hoje é ${today()}. Busque vagas de emprego ABERTAS publicadas desde ${sinceDate} para o candidato descrito no perfil.

Cargos-alvo: ${prefs.targetRoles.join("; ") || "(ver perfil)"}${prefs.seniority ? ` · senioridade: ${prefs.seniority}` : ""}
Termos de busca: ${prefs.queries.join("; ")}
País do candidato: ${prefs.country}
Regiões aceitas para remoto: ${prefs.acceptedRegions.join(", ")}
Cidades aceitas para presencial/híbrido: ${prefs.onsiteCities.join(", ")}
Empresas excluídas: ${prefs.excludedCompanies.join(", ") || "nenhuma"}
${prefs.webSearchHints}
${extra ?? ""}

Regras:
- Procure em LinkedIn Jobs, Gupy (portal.gupy.io e *.gupy.io), Indeed, Glassdoor, Catho, InfoJobs, Vagas.com, Solides, Trampos, Remotar e páginas de carreira de empresas — e, se a área for tecnologia, também Programathor, Wellfound e GeekHunter. Use os sites que fazem sentido para a área e o país do candidato.
- Só inclua vagas com link direto da vaga (não página de busca) e que pareçam estar abertas.
- Descarte vagas claramente incompatíveis com o perfil (senioridade muito acima, área ou especialidade sem relação, exige cidadania/residência em outro país quando for remoto).
- Não invente vagas, links ou datas. Se não souber a data, deixe vazio.
- No resumo, traga requisitos obrigatórios, desejáveis e responsabilidades com as palavras exatas da vaga.
- Máximo de 15 vagas.`;

  const result = await webSearchStructured(WebJobsSchema, {
    label: "search:web",
    system: profileSystem,
    user,
    effort: "medium",
    maxSearches: 10,
  });

  return result.jobs.map((j) => ({
    source: `web:${j.site.toLowerCase()}`,
    title: j.title,
    company: j.company,
    location: j.location,
    remote: j.remote,
    url: j.url,
    postedAt: j.postedAt || undefined,
    salary: j.salary || undefined,
    tags: [],
    description: `${WEB_SUMMARY_HEADER}\n${j.summary}`,
  }));
}
