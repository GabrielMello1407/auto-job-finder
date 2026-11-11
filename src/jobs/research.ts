import { z } from "zod";
import { canWebSearch, webSearchStructured } from "../llm.js";
import type { Job, JobResearchSummary } from "../schemas.js";
import { norm, today, truncate } from "../util/text.js";
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
  companyCulture: z
    .array(
      z.object({
        text: z.string().describe("A missão, um valor ou um traço de cultura, como a página oficial escreve (pode encurtar, sem acrescentar nada)"),
        source: z.string().describe("Link exato da página oficial onde está esse texto"),
      }),
    )
    .describe("Missão, valores e cultura que a empresa declara na página oficial dela (site, 'sobre nós', 'carreiras', 'cultura'). Nada de Glassdoor, notícias, avaliações ou opinião. Vazio se a página oficial não fala disso."),
  sources: z.array(z.string()).describe("Links consultados"),
});
export type JobResearch = z.infer<typeof JobResearchSchema>;
export type CultureItem = JobResearch["companyCulture"][number];

const MARK = "## Pesquisa na web";

/** Domínio base de um link (empresa.com.br, empresa.com), sem www. Vazio se o link não é http(s). */
export function baseDomain(url: string | undefined): string {
  let host: string;
  try {
    const u = new URL(url ?? "");
    if (!/^https?:$/.test(u.protocol)) return "";
    host = u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
  const parts = host.split(".");
  // empresa.com.br, empresa.co.uk: três partes; empresa.com: duas.
  const n = parts.length >= 3 && parts.at(-1)!.length === 2 && /^(com|co|org|net|gov|edu|ac|ind|art|eco|ltd|plc)$/.test(parts.at(-2)!) ? 3 : 2;
  return parts.slice(-n).join(".");
}

/** Páginas de carreira hospedadas em plataformas de recrutamento: oficiais quando o endereço tem o nome da empresa. */
const CAREER_HOSTS =
  /(^|\.)(gupy\.io|greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|recruitee\.com|smartrecruiters\.com|myworkdayjobs\.com|inhire\.app|solides\.jobs|kenoby\.com|breezy\.hr|teamtailor\.com|bamboohr\.com|pinpointhq\.com)$/;
/** Palavras que não identificam uma empresa (aparecem no nome de muitas). */
const GENERIC = new Set(["tecnologia", "technology", "technologies", "solucoes", "solutions", "servicos", "services", "sistemas", "systems", "grupo", "group", "brasil", "brazil", "digital", "labs", "ltda", "company", "empresa", "consultoria", "consulting", "software", "global", "exemplo", "example"]);
const squash = (s: string) => norm(s).replace(/[^a-z0-9]/g, "");

/**
 * Só fica a missão/valor/cultura com link de página oficial: o mesmo domínio do site da empresa ou do
 * anúncio oficial, um endereço que tem o nome da empresa, ou a página de carreiras dela numa
 * plataforma de recrutamento. Link de Glassdoor, notícia, LinkedIn ou sem link: sai.
 */
export function officialCulture(items: CultureItem[], company: string, ...officialUrls: (string | undefined)[]): CultureItem[] {
  const domains = new Set(officialUrls.map(baseDomain).filter(Boolean));
  const words = norm(company)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !GENERIC.has(w));
  const nameIn = (s: string) => words.some((w) => squash(s).includes(w));
  return items
    .map((i) => ({ text: i.text.trim(), source: i.source.trim() }))
    .filter((i) => {
      const domain = baseDomain(i.source);
      if (!i.text || !domain) return false;
      if (domains.has(domain)) return true;
      const u = new URL(i.source);
      if (CAREER_HOSTS.test(u.hostname)) return nameIn(u.hostname + u.pathname);
      return nameIn(u.hostname);
    })
    .slice(0, 8);
}

export function researchBlock(r: JobResearch): string {
  const verdict = VERDICT_LABEL[r.verdict];
  return `${MARK} (${today()})

> Informações encontradas pelo agente na web. Não vieram de quem passou a vaga: confira os links.

- Situação: ${verdict}
- Anúncio oficial: ${r.postingUrl || "não encontrado"}
- Empresa: ${r.companySite || "site não encontrado"}${r.companySummary ? ` — ${r.companySummary}` : ""}
${r.applyInstructions ? `- Como se candidatar: ${r.applyInstructions}\n` : ""}${r.officialEmailDomains.length ? `- Domínios de e-mail da empresa: ${r.officialEmailDomains.join(", ")}\n` : ""}${
    r.extraDetails.length ? `\nDetalhes do anúncio oficial que não estavam no texto recebido:\n${r.extraDetails.map((d) => `- ${d}`).join("\n")}\n` : ""
  }${
    r.companyCulture.length ? `\nMissão, valores e cultura, como a página oficial da empresa escreve:\n${r.companyCulture.map((c) => `- ${c.text} (fonte: ${c.source})`).join("\n")}\n` : ""
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
    ...(r.culture?.length ? ["   Missão e valores (página oficial):", ...r.culture.map((c) => `   - ${c.text} (${c.source})`)] : []),
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
    user: `Hoje é ${today()}. ${/^https?:\/\//i.test(job.url) ? `Esta é a vaga (link: ${job.url}):` : "Recebi esta vaga sem link:"}

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
5. Confira se é real: e-mail de contato fora do domínio da empresa (ex.: Gmail para uma empresa grande), empresa que não aparece em lugar nenhum, pedido de pagamento ou documentos, salário fora da realidade. Se houver sinais assim, verdict = "suspeita" e explique em notes.
6. Na página oficial da empresa (site, "sobre nós", "quem somos", "carreiras", "cultura"), ache a missão, os valores e a cultura que ela declara. Copie como a página escreve, em itens curtos, cada um com o link exato da página em que está. Não use Glassdoor, notícias, avaliações nem a sua opinião. Se a página oficial não fala disso, deixe companyCulture vazio.`,
  });

  const postingUrl = /^https?:\/\//i.test(r.postingUrl) ? r.postingUrl : undefined;
  const companySite = /^https?:\/\//i.test(r.companySite) ? r.companySite : undefined;
  // Missão e valores só com link de página oficial (nada de Glassdoor, notícia ou item sem fonte).
  const culture = officialCulture(r.companyCulture ?? [], job.company, companySite, postingUrl);
  const research: JobResearchSummary = { at: new Date().toISOString(), verdict: r.verdict, postingUrl, companySite, notes: r.notes, culture };
  const updated = updateJob(job.id, {
    description: `${received}\n\n---\n\n${researchBlock({ ...r, companyCulture: culture })}`,
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
