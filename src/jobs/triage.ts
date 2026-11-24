import { structured } from "../llm.js";
import { monthsText, professionalMonths } from "../career.js";
import { applicationFactsText, loadBaseResume, loadExcluded, loadPreferences } from "../profile.js";
import { applyAbroad } from "./abroad.js";
import { applyKnockouts } from "./priority.js";
import { profileSystem } from "../prompts.js";
import { TriageBatchSchema, type Job, type JobStatus } from "../schemas.js";
import { today, truncate } from "../util/text.js";
import { cleanJobText } from "./page.js";
import { loadJobs, saveJobs } from "./store.js";

const BATCH = 6;

/**
 * O tempo de experiência com datas, contado sem IA (src/career.ts), para a triagem comparar com a senioridade
 * da vaga como um recrutador faz. Sem currículo-base, a linha fica de fora.
 */
export function careerLine(): string {
  let months: number;
  try {
    months = professionalMonths(loadBaseResume("pt-BR"));
  } catch {
    return "";
  }
  return `- Experiência profissional com datas no perfil: ${monthsText(months)} (posições somadas sem contar em dobro; voluntariado fora). Um recrutador compara isso com a vaga. Se a vaga escreve anos mínimos acima disso, ou, sem anos escritos, pede uma senioridade acima disso (com folga: sênior pede pelo menos 4 anos; liderança, staff ou principal, pelo menos 6; pleno, pelo menos 1 ano e meio; júnior e estágio não pedem tempo), é requisito obrigatório sem evidência: entra em mustHaveGaps e num knockout "tempo de experiência" com "nao", e o fit não pode ser "alta".
`;
}

function jobBlock(j: Job): string {
  return `<job id="${j.id}">
Título: ${j.title}
Empresa: ${j.company}
Local: ${j.location} | Remoto: ${j.remote ?? "?"} | Fonte: ${j.source} | Publicada: ${j.postedAt ?? "?"}
Salário: ${j.salary ?? "não informado"}
Link: ${j.url}
Descrição:
${truncate(cleanJobText(j.description), 5000)}
</job>`;
}

/**
 * Etapa da vaga depois da triagem. Vaga que a pessoa colou (fonte "manual") não some sozinha: com
 * "descartar", fica em "Para decidir" com o motivo, e ela decide.
 */
export function statusAfterTriage(recommendation: "candidatar" | "decidir" | "descartar", source: string): JobStatus {
  if (recommendation === "candidatar") return "shortlisted";
  return recommendation === "descartar" && !source.startsWith("manual") ? "discarded" : "triaged";
}

/** Triagem por IA: aderência, lacunas obrigatórias, sinais de golpe e mercado (BR/US/...). */
export async function triageJobs(opts: { limit?: number; ids?: string[] } = {}) {
  let pending = loadJobs().filter((j) => (opts.ids?.length ? opts.ids.includes(j.id) : j.status === "new"));
  if (opts.limit) pending = pending.slice(0, opts.limit);
  if (!pending.length) return [];
  // Status de cada vaga ao entrar na fila: se mudar durante a triagem (ex.: pela interface), a mudança vale.
  const statusBefore = new Map(pending.map((j) => [j.id, j.status]));

  const system = profileSystem();
  const prefs = loadPreferences();
  const excluded = loadExcluded();
  const facts = applicationFactsText(prefs.applicationFacts);
  const career = careerLine();
  const done: Job[] = [];

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    process.stdout.write(`  triagem ${i + 1}–${i + batch.length} de ${pending.length}...\n`);
    const result = await structured(TriageBatchSchema, {
      label: "triage",
      tier: "fast",
      effort: "medium",
      system,
      user: `Hoje é ${today()}. Avalie cada vaga abaixo contra o profile_truth.

Para cada vaga devolva um item em "results" com o mesmo jobId.
Critérios:
- fit "alta" só se TODOS os requisitos obrigatórios têm evidência no perfil; "media" se falta 1–2 obrigatórios contornáveis; "baixa" caso contrário.
- score 0–100 coerente com o fit.
- evidence: cite trechos curtos do perfil. mustHaveGaps: requisitos obrigatórios sem evidência (escreva "sem evidência", não suponha).
- scamSignals: domínio de e-mail estranho, pedido de documento/pagamento, teste que exige baixar e rodar código, salário irreal, vaga vaga demais.
- market: o mercado da empresa que contrata, não o lugar onde a pessoa vai trabalhar (BR só para empresa brasileira; empresa de fora contratando no Brasil, como CLT por parceiro ou contractor, usa o país dela ou GLOBAL; US se empresa americana, mesmo remota).
- recommendation: "candidatar" (fit alta/média sem golpe), "decidir" (dúvida real), "descartar".
- O candidato mora em ${prefs.country} (a cidade está no perfil). ${
        prefs.relocateAbroad
          ? `Ele aceita se mudar para outro país se a empresa patrocinar o visto e a mudança${prefs.relocationCountries.length ? ` (só para: ${prefs.relocationCountries.join(", ")})` : ""}.`
          : "Ele não aceita se mudar para outro país."
      }
- ${prefs.onsiteCities.length ? `Vaga presencial ou híbrida em ${prefs.country} só serve nestas cidades/região: ${prefs.onsiteCities.join(", ")}. Fora delas, sem opção remota → "descartar".` : `O candidato não informou cidades para trabalho presencial: vaga só presencial/híbrida em ${prefs.country} sem opção remota → "decidir".`}
- Vaga que exige morar em outro país (presencial ou híbrida no exterior, ou remota só para quem mora lá: "US only", "must be based in Germany", local "United States"): preencha workCountry com o país e visaSponsorship com o que o anúncio diz sobre visto e mudança. Não crie critério eliminatório de local nem de autorização para isso (o agente cria a partir desses dois campos) e não descarte só por isso: se o resto combina, use "candidatar" ou "decidir". Vaga que dá para fazer de onde ele mora: workCountry vazio.
- Cargos-alvo do candidato: ${prefs.targetRoles.join("; ") || "(ver perfil)"}. Senioridade buscada: ${prefs.seniority || "(ver perfil)"}.
${career}- Considere o nível de idioma declarado no perfil quando a vaga exigir fluência: isso é lacuna, não descarte automático.
- knockouts: liste SÓ os critérios eliminatórios explícitos da vaga (o que ela diz ser obrigatório para ser considerado: anos mínimos, idioma exigido, presencial ou região, autorização de trabalho ou visto, formação ou certificação obrigatória). Para cada um: meets "sim" se o perfil comprova, "nao" se o perfil mostra que não atende (ex.: pede 5 anos e o perfil soma 2; pede inglês fluente e o perfil declara intermediário), "incerto" se o perfil não diz. Vaga sem critério eliminatório: lista vazia. Se algum for "nao", a recomendação não pode ser "candidatar".
${facts ? `- Respostas fixas do candidato (valem para autorização de trabalho, mudança e disponibilidade):\n${facts}` : "- O candidato não informou autorização de trabalho nem se aceita mudança: nesses critérios, use \"incerto\"."}

Vagas/empresas que o candidato excluiu:
${excluded || "(nenhuma)"}

${batch.map(jobBlock).join("\n\n")}`,
    });

    // Relê o arquivo: outras partes (interface, outro comando) podem ter salvado enquanto a IA respondia.
    const jobs = loadJobs();
    for (const r of result.results) {
      const job = jobs.find((j) => j.id === r.jobId);
      if (!job) continue;
      const { jobId: _ignored, ...raw } = r;
      // Vaga no exterior vira critério de local (src/jobs/abroad.ts); critério que o perfil não atende: no
      // máximo "decidir" (a pessoa decide).
      const triage = applyKnockouts(applyAbroad(raw, job.remote, prefs));
      job.triage = triage;
      if (job.status === statusBefore.get(job.id)) job.status = statusAfterTriage(triage.recommendation, job.source);
      done.push(job);
    }
    saveJobs(jobs);
  }
  return done;
}
