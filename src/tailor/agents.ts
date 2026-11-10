import { structured } from "../llm.js";
import type { MarketProfile } from "../market.js";
import { profileSystem } from "../prompts.js";
import { JobAnalysisSchema, ResumeSchema, ReviewSchema, type JobAnalysis, type Resume, type Review } from "../schemas.js";
import type { GuardReport } from "./guards.js";

const json = (x: unknown) => JSON.stringify(x, null, 2);

const jobBlock = (jd: string) => `<job_description>\n${jd}\n</job_description>`;

/** 1. Analista: extrai requisitos e palavras-chave ATS da vaga. */
export function analyzeJob(jd: string): Promise<JobAnalysis> {
  return structured(JobAnalysisSchema, {
    label: "tailor:analyze",
    effort: "medium",
    system: profileSystem(),
    user: `${jobBlock(jd)}

Analise a vaga acima. Extraia requisitos obrigatórios e desejáveis, responsabilidades e de 15 a 35 palavras-chave ATS exatamente como escritas na vaga (ferramentas, tecnologias, metodologias, certificações, nome do cargo). Identifique o mercado do empregador (BR, US, CA, UK, EU, LATAM ou GLOBAL).
Descubra também COMO se candidatar (applyChannel): e-mail com currículo anexo, LinkedIn (Easy Apply/candidatura simplificada ou mensagem), plataforma de recrutamento (Gupy, Greenhouse, Lever, Workday, Solides, Kenoby...), formulário no site da empresa ou WhatsApp. Copie instruções específicas (assunto obrigatório do e-mail, código da vaga, documentos pedidos, prazo). Não avalie o candidato aqui.`,
  });
}

/** 2. Estrategista de carreira: reposiciona o currículo-base para a vaga. */
export function strategist(params: {
  jd: string;
  analysis: JobAnalysis;
  base: Resume;
  market: MarketProfile;
}): Promise<Resume> {
  const { jd, analysis, base, market } = params;
  return structured(ResumeSchema, {
    label: "tailor:strategist",
    effort: "high",
    system: profileSystem(),
    user: `${jobBlock(jd)}

<job_analysis>
${json(analysis)}
</job_analysis>

<starting_resume lang="${market.language}">
${json(base)}
</starting_resume>

Você é um estrategista de carreira sênior. Reposicione o currículo acima para ESTA vaga, sem inventar nada.
Idioma de saída: ${market.language}. Mercado: ${market.market} (${market.notes.join(" ")}).

Tarefas:
1. headline: cargo-alvo da vaga (sem subir senioridade além do que o perfil sustenta) + 3 a 5 competências ou ferramentas que a vaga pede e o perfil comprova, separados por " | ".
2. summary: 3 a 5 frases. Quem é, o que entrega, por que serve para ESTA vaga. Use os termos exatos da vaga onde forem verdadeiros. Comece pelo que a vaga mais valoriza.
3. skills: reordene categorias e itens por relevância para a vaga. Pode renomear categorias para casar com a vaga. Pode incluir competências que estão no profile_truth e a vaga pede. Nunca inclua competência sem evidência.
4. experience: mantenha TODAS as posições, mesmas empresas, cargos e datas, em ordem cronológica reversa. Dentro de cada posição, coloque primeiro os bullets mais relevantes para a vaga e reescreva-os com verbo de ação + o quê + como (ferramentas, métodos) + resultado real. Pode trazer do profile_truth projetos/fatos verdadeiros que não estão no currículo-base quando forem relevantes para a vaga. Não descarte fatos distintos; junte só repetições.
5. projects: inclua de 0 a 3 projetos/trabalhos do profile_truth (portfólio, projetos pessoais, voluntariado, cases; marque "em desenvolvimento" entre parênteses no nome quando for o caso) SOMENTE se reforçarem requisitos da vaga. Senão, deixe vazio.
6. education, certifications, languages e contact: copie do currículo inicial (pode reordenar certificações por relevância). Não altere a linha de idiomas.
7. Mire em no máximo 2 páginas: corte redundância, não fatos relevantes.
8. Métricas: só os números exatos que já existem nas fontes.`,
  });
}

/** 3. Gerente de contratação: nota 1–10 e feedback acionável. */
export function reviewer(params: { jd: string; analysis: JobAnalysis; resume: Resume }): Promise<Review> {
  const { jd, analysis, resume } = params;
  return structured(ReviewSchema, {
    label: "tailor:review",
    effort: "high",
    system: profileSystem(),
    user: `${jobBlock(jd)}

<job_analysis>
${json(analysis)}
</job_analysis>

<candidate_resume>
${json(resume)}
</candidate_resume>

Você é um hiring manager experiente avaliando este currículo para a vaga acima, como ele seria lido por um ATS e depois por um recrutador em 30 segundos.

- rating: 1.0 a 10.0 de aderência com base SÓ no que está escrito no currículo e comprovado pelas fontes. Não suba a nota por afirmações sem evidência.
- strengths: 3 a 5 pontos fortes ligados a requisitos da vaga.
- gaps: requisitos não atendidos ou mal mostrados. truthfullyCoverable = true SOMENTE se o profile_truth/base_resume tem evidência que o currículo deixou de mostrar; nesse caso, sugira exatamente onde e como mostrar. Se não há evidência, truthfullyCoverable = false e a sugestão é "manter como lacuna".
- missingKeywordsCoverable: termos da vaga ausentes do currículo mas presentes nas fontes.
- presentation: 2 a 3 ajustes de clareza/ordem/tamanho.`,
  });
}

/** 5. Enxugador: quando o PDF passa do limite de páginas. */
export function condenser(params: { jd: string; analysis: JobAnalysis; current: Resume; pages: number; maxPages: number; market: MarketProfile }): Promise<Resume> {
  const { jd, analysis, current, pages, maxPages, market } = params;
  return structured(ResumeSchema, {
    label: "tailor:condense",
    effort: "medium",
    system: profileSystem(),
    user: `${jobBlock(jd)}

<job_analysis>
${json(analysis)}
</job_analysis>

<current_version pages="${pages}">
${json(current)}
</current_version>

O PDF deste currículo tem ${pages} páginas; precisa caber em ${maxPages}. Enxugue sem perder o que a vaga mais valoriza:
- Mantenha TODAS as posições, empresas, cargos e datas.
- Encurte o resumo para 3–4 frases e cada bullet para no máximo 2 linhas.
- Junte bullets parecidos; corte detalhes de baixa relevância para a vaga (versões de ferramentas, listas longas de ferramentas dentro dos bullets).
- Na lista de competências, mantenha só o que a vaga pede ou reforça (no máximo ~8 itens por categoria, no máximo 7 categorias).
- Projetos: no máximo 1, e só se for muito relevante; senão deixe vazio.
- Não mude fatos nem números; não acrescente nada. Idioma ${market.language}.`,
  });
}

/** 4. Editor: aplica o feedback verdadeiro e corrige violações das travas. */
export function editor(params: {
  jd: string;
  analysis: JobAnalysis;
  current: Resume;
  base: Resume;
  review: Review;
  guards: GuardReport;
  market: MarketProfile;
}): Promise<Resume> {
  const { jd, analysis, current, base, review, guards, market } = params;
  const coverable = review.gaps.filter((g) => g.truthfullyCoverable);
  return structured(ResumeSchema, {
    label: "tailor:editor",
    effort: "high",
    system: profileSystem(),
    user: `${jobBlock(jd)}

<job_analysis>
${json(analysis)}
</job_analysis>

<starting_resume_source_of_truth>
${json(base)}
</starting_resume_source_of_truth>

<current_version>
${json(current)}
</current_version>

<automatic_checks>
VIOLAÇÕES (corrija TODAS antes de qualquer outra coisa):
${guards.violations.map((v) => `- ${v}`).join("\n") || "- nenhuma"}
Alertas:
${guards.warnings.map((v) => `- ${v}`).join("\n") || "- nenhum"}
</automatic_checks>

<hiring_manager_feedback rating="${review.rating}">
Lacunas que dá para mostrar com fatos reais:
${coverable.map((g) => `- ${g.requirement}: ${g.suggestion}`).join("\n") || "- nenhuma"}
Palavras-chave que você tem e faltam: ${review.missingKeywordsCoverable.join(", ") || "nenhuma"}
Apresentação: ${review.presentation.join(" | ") || "-"}
Lacunas reais (NÃO tente cobrir): ${review.gaps.filter((g) => !g.truthfullyCoverable).map((g) => g.requirement).join(", ") || "nenhuma"}
</hiring_manager_feedback>

Você é um editor de currículos. Produza a próxima versão de current_version:
1. Corrija todas as violações automáticas.
2. Aplique apenas o feedback que as fontes comprovam. Lacuna real continua lacuna.
3. Mantenha todas as posições, empresas, cargos e datas do currículo de origem. Bullets mais relevantes primeiro.
4. Idioma ${market.language}. Máximo 2 páginas. Números só se idênticos às fontes.`,
  });
}
