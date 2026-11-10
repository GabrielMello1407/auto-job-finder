import { z } from "zod";
import { canWebSearch, webSearchStructured } from "../llm.js";
import type { Job, JobResearchSummary } from "../schemas.js";
import { today, truncate } from "../util/text.js";
import { cleanJobText } from "./page.js";
import { findJob, loadJobs, updateJob } from "./store.js";

/**
 * Pesquisa na web uma vaga que chegou sem link (indicação, e-mail, WhatsApp): acha o anúncio oficial
 * e o site da empresa, completa requisitos e a forma de candidatura, e confere se a vaga é real.
 * O que for achado entra na descrição da vaga, marcado como pesquisa, e passa a valer para a triagem
 * e o pacote. Nada é inventado: o que não aparecer na web fica como "não encontrado".
 */

export const JobResearchSchema = z.object({
  postingFound: z.boolean().describe("Achou o anúncio oficial desta mesma vaga?"),
  postingUrl: z.string().describe("Link direto do anúncio oficial (site de carreira da empresa, Gupy, LinkedIn etc.); vazio se não achou"),
  companySite: z.string().describe("Site oficial da empresa; vazio se não achou"),
  companySummary: z.string().describe("2–3 frases sobre a empresa com base no que achou (área, produto, porte); vazio se não achou nada confiável"),
  extraDetails: z.array(z.string()).describe("Requisitos, responsabilidades, benefícios ou etapas do anúncio oficial que NÃO estão no texto recebido"),
  applyInstructions: z.string().describe("Como se candidatar segundo o anúncio oficial ou o texto (e-mail, plataforma, prazo, assunto exigido); vazio se não há"),
  officialEmailDomains: z.array(z.string()).describe("Domínios de e-mail que pertencem de fato à empresa (ex.: empresa.com.br)"),
  verdict: z.enum(["confirmada", "nao_encontrada", "suspeita"]).describe("confirmada: anúncio oficial achado; nao_encontrada: não achou o anúncio; suspeita: há sinais de golpe"),
  notes: z.array(z.string()).describe("Observações curtas: o que conferiu, o que não bate (ex.: e-mail de contato fora do domínio da empresa), sinais de golpe"),
  sources: z.array(z.string()).describe("Links consultados"),
});
export type JobResearch = z.infer<typeof JobResearchSchema>;

const MARK = "## Pesquisa na web";

export function researchBlock(r: JobResearch): string {
  const verdict = VERDICT_LABEL[r.verdict];
  return `${MARK} (${today()})

> Informações encontradas pelo agente na web. Não vieram de quem passou a vaga: confira os links.

- Situação: ${verdict}
- Anúncio oficial: ${r.postingUrl || "não encontrado"}
- Empresa: ${r.companySite || "site não encontrado"}${r.companySummary ? ` — ${r.companySummary}` : ""}
${r.applyInstructions ? `- Como se candidatar: ${r.applyInstructions}\n` : ""}${r.officialEmailDomains.length ? `- Domínios de e-mail da empresa: ${r.officialEmailDomains.join(", ")}\n` : ""}${
    r.extraDetails.length ? `\nDetalhes do anúncio oficial que não estavam no texto recebido:\n${r.extraDetails.map((d) => `- ${d}`).join("\n")}\n` : ""
  }${r.notes.length ? `\nObservações:\n${r.notes.map((n) => `- ${n}`).join("\n")}\n` : ""}${r.sources.length ? `\nFontes: ${r.sources.join(" · ")}\n` : ""}`;
}

const VERDICT_LABEL: Record<JobResearchSummary["verdict"], string> = {
  confirmada: "✅ anúncio oficial encontrado",
  nao_encontrada: "❔ anúncio oficial não encontrado",
  suspeita: "🚩 há sinais de golpe",
};

/** Resumo da pesquisa para o terminal (ajf show e o menu). */
export function researchLines(job: Job): string[] {
  const r = job.research;
  if (!r) return [];
  return [
    `🔎 Pesquisa na web (${r.at.slice(0, 10)}): ${VERDICT_LABEL[r.verdict]}`,
    ...(r.postingUrl ? [`   Anúncio oficial: ${r.postingUrl}`] : []),
    ...(r.companySite ? [`   Empresa: ${r.companySite}`] : []),
    ...r.notes.map((n) => `   - ${n}`),
  ];
}

/** Tira uma pesquisa anterior da descrição (para pesquisar de novo sem duplicar). */
export const withoutResearch = (description: string) => description.split(`\n\n---\n\n${MARK}`)[0];

export async function researchJob(id: string): Promise<Job> {
  if (!canWebSearch()) throw new Error("A IA escolhida não faz busca na web. Troque de IA (Claude ou outra com busca) para pesquisar a vaga.");
  const job = findJob(loadJobs(), id);
  const received = cleanJobText(withoutResearch(job.description));
  console.log(`Pesquisando ${job.company || "a empresa"} e a vaga "${job.title}" na web...`);
  const r = await webSearchStructured(JobResearchSchema, {
    label: "search:job-research",
    effort: "medium",
    maxSearches: 6,
    system: [
      "Você ajuda uma pessoa a conferir uma vaga de emprego que ela recebeu por indicação, e-mail ou mensagem. Use a busca na web. Nunca invente links, empresas, requisitos ou contatos: só registre o que encontrar. Se não encontrar, diga que não encontrou.",
    ],
    user: `Hoje é ${today()}. Recebi esta vaga sem link:

Empresa (como me passaram): ${job.company || "(não informada)"}
Cargo: ${job.title}
Local: ${job.location || "(não informado)"}

<texto_recebido>
${truncate(received, 8000)}
</texto_recebido>

1. Ache o anúncio oficial desta mesma vaga (site de carreira da empresa, Gupy, LinkedIn, Indeed, InfoJobs etc.). Só conte como oficial se for a mesma vaga (mesmo cargo e empresa).
2. Ache o site oficial da empresa e resuma em 2–3 frases o que ela faz.
3. Liste o que o anúncio oficial traz e o texto recebido não traz (requisitos, responsabilidades, benefícios, etapas).
4. Diga como se candidatar (e-mail, plataforma, prazo, assunto exigido), pelo anúncio oficial ou pelo texto recebido.
5. Confira se é real: e-mail de contato fora do domínio da empresa (ex.: Gmail para uma empresa grande), empresa que não aparece em lugar nenhum, pedido de pagamento ou documentos, salário fora da realidade. Se houver sinais assim, verdict = "suspeita" e explique em notes.`,
  });

  const research: JobResearchSummary = {
    at: new Date().toISOString(),
    verdict: r.verdict,
    postingUrl: /^https?:\/\//i.test(r.postingUrl) ? r.postingUrl : undefined,
    companySite: /^https?:\/\//i.test(r.companySite) ? r.companySite : undefined,
    notes: r.notes,
  };
  const updated = updateJob(job.id, {
    description: `${received}\n\n---\n\n${researchBlock(r)}`,
    research,
    // Vaga sem link ganha o link oficial para "Ver vaga" e "Candidatar-se".
    ...(research.postingUrl && !/^https?:\/\//i.test(job.applyUrl ?? job.url) ? { applyUrl: research.postingUrl } : {}),
  });
  console.log(
    research.verdict === "confirmada"
      ? `✅ Anúncio oficial encontrado: ${research.postingUrl}`
      : research.verdict === "suspeita"
        ? `🚩 Sinais de golpe: ${r.notes.join("; ")}`
        : "❔ Anúncio oficial não encontrado; a vaga segue com o que foi informado.",
  );
  return updated;
}
