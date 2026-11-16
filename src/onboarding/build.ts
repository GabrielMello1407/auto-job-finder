import { z } from "zod";
import { structured } from "../llm.js";
import { ResumeSchema, type Resume } from "../schemas.js";
import { today } from "../util/text.js";
import type { SourceDoc } from "./sources.js";

/**
 * Montagem do perfil a partir do que a pessoa forneceu (currículo, LinkedIn, portfólio, respostas).
 * Ainda não existe profile_truth: as chamadas usam um system prompt próprio, com a mesma regra de ouro
 * — nada que não esteja nas fontes.
 */

export const SYSTEM = `Você é um especialista em carreira e recrutamento (qualquer área: tecnologia, saúde, educação, vendas, finanças, indústria, direito, design, administração etc.). Sua tarefa é organizar a carreira de uma pessoa a partir das FONTES que ela forneceu.

REGRA DE OURO: só registre fatos que estão nas fontes. Nunca invente empresas, cargos, datas, números, ferramentas, certificações ou resultados. Se algo importante está faltando ou ambíguo, registre como pendência ("A confirmar") — não preencha. Se as fontes se contradizem (ex.: datas diferentes no currículo e no LinkedIn), registre a divergência em "A confirmar".`;

export function sourcesBlock(sources: SourceDoc[]): string {
  return sources.map((s, i) => `<fonte n="${i + 1}" tipo="${s.kind}" origem="${s.label}">\n${s.text}\n</fonte>`).join("\n\n");
}

/* ------------------------------ 1. Leitura inicial ------------------------------ */

export const IntakeSchema = z.object({
  name: z.string().describe("Nome completo como aparece nas fontes; vazio se não houver"),
  area: z.string().describe("Área de atuação em 1–3 palavras (ex.: 'tecnologia', 'marketing digital', 'enfermagem')"),
  isTech: z.boolean().describe("true se a pessoa trabalha com desenvolvimento de software, dados ou infraestrutura de TI"),
  understood: z.string().describe("2–3 frases: o que você entendeu da carreira da pessoa"),
  suggestedTargetRoles: z.array(z.string()).describe("3–6 cargos que a pessoa pode buscar, coerentes com as fontes, no idioma do país dela"),
  seniority: z.string().describe("Senioridade provável (ex.: júnior, pleno, sênior, especialista, gestão)"),
  questions: z
    .array(z.object({ question: z.string(), why: z.string() }))
    .describe(
      "Até 8 perguntas curtas para completar o perfil: datas faltando, resultados com números reais, ferramentas usadas, nível de idioma, certificações (curso x certificação oficial), registro profissional, divergências entre fontes. Só o que muda o currículo.",
    ),
});
export type Intake = z.infer<typeof IntakeSchema>;

export function readIntake(sources: SourceDoc[]): Promise<Intake> {
  return structured(IntakeSchema, {
    label: "init:intake",
    effort: "medium",
    system: [SYSTEM],
    user: `${sourcesBlock(sources)}

Leia as fontes acima e devolva o entendimento inicial e as perguntas que faltam para montar um currículo forte e verdadeiro. Perguntas em português do Brasil, diretas, uma coisa por pergunta.`,
  });
}

/* ------------------------------ 2. Perfil (profile_truth + preferências + regras) ------------------------------ */

export const ProfileBuildSchema = z.object({
  profileTruth: z.string().describe("Markdown completo do profile_truth.md, com os títulos exigidos"),
  neverClaim: z
    .array(z.object({ phrase: z.string(), message: z.string() }))
    .describe("Frases curtas que o agente NUNCA pode escrever sobre a pessoa (ex.: 'inglês fluente' se o nível é intermediário; 'certificado PMP' se só fez curso). Em pt e en quando fizer sentido."),
  queries: z
    .array(z.string())
    .describe(
      "4–8 termos de busca de vagas (cargo + variações). Sempre inclua termos no idioma do país onde a pessoa mora (portais locais, como a Gupy no Brasil, só acham vagas assim); acrescente termos em inglês se ela aceita vagas internacionais",
    ),
  titleMustInclude: z
    .array(z.string())
    .describe("10–30 palavras/expressões curtas em minúsculas que o TÍTULO da vaga deve conter (variações do cargo em pt/en, com e sem acento). Ex.: 'analista de marketing', 'marketing analyst'"),
  titleExclude: z
    .array(z.string())
    .describe("Palavras em minúsculas que eliminam a vaga pelo título: senioridade incompatível e especialidades sem relação"),
});
export type ProfileBuild = z.infer<typeof ProfileBuildSchema>;

export interface PreferenceAnswers {
  targetRoles: string[];
  seniority: string;
  workModes: string;
  onsiteCities: string[];
  international: boolean;
  country: string;
}

export function buildProfile(p: { sources: SourceDoc[]; answers: { question: string; answer: string }[]; prefs: PreferenceAnswers; intake: Intake }): Promise<ProfileBuild> {
  const answered = p.answers.filter((a) => a.answer.trim());
  return structured(ProfileBuildSchema, {
    label: "init:profile",
    effort: "high",
    maxTokens: 48000,
    system: [SYSTEM],
    user: `${sourcesBlock(p.sources)}

<respostas_da_pessoa>
${answered.map((a) => `P: ${a.question}\nR: ${a.answer}`).join("\n\n") || "(nenhuma)"}
</respostas_da_pessoa>

<objetivo>
Cargos-alvo: ${p.prefs.targetRoles.join("; ")}
Senioridade: ${p.prefs.seniority}
Modalidade: ${p.prefs.workModes}${p.prefs.onsiteCities.length ? ` · cidades para presencial/híbrido: ${p.prefs.onsiteCities.join(", ")}` : ""}
Mora em: ${p.prefs.country} · aceita vagas internacionais/em inglês: ${p.prefs.international ? "sim" : "não"}
</objetivo>

Monte o perfil da pessoa. As respostas acima também são fonte (a pessoa confirmou).

profileTruth — Markdown com EXATAMENTE estes títulos de seção (## ...), nesta ordem:
# Perfil profissional — <Nome>
> Fonte única de verdade do agente. Gerado em ${today()} a partir de: <liste as fontes>. Revise e corrija o que estiver errado.
## Identificação e contato
## Objetivo e cargos-alvo
## Resumo
## Experiência profissional
(uma subseção "### <Cargo> — <Empresa> (<MM/AAAA> – <MM/AAAA ou Atual>)" por posição, com local/modalidade e bullets de fatos: atividades, ferramentas, resultados — números SÓ como aparecem nas fontes. O cargo do título em um idioma só, como a pessoa usa no país dela; se as fontes trazem o nome também em outro idioma (ex.: o LinkedIn em inglês), registre numa linha "- Cargo em inglês: ..." dentro da posição, nunca entre parênteses no título)
## Projetos e portfólio
## Formação
## Certificações e cursos
(separe certificação oficial de curso livre; não promova curso a certificação)
## Competências e ferramentas
(só as que têm evidência; indique onde foram usadas)
## Idiomas
## Lacunas conhecidas
(requisitos comuns dos cargos-alvo SEM evidência nas fontes — o agente não pode afirmar)
## A confirmar
(datas faltando, divergências entre fontes, perguntas não respondidas)
## Nunca afirmar
(lista do que não pode ser dito: níveis de idioma acima do declarado, cursos como certificações, cargos/senioridade que não teve etc.)
## Regras de comunicação
(tom e preferências que aparecem nas fontes/respostas; se não houver, "tom profissional e direto")

As seções "Lacunas", "A confirmar", "Nunca afirmar" e "Regras de comunicação" NÃO contam como evidência para o agente: não coloque fatos verdadeiros nelas.`,
  });
}

/* ------------------------------ 3. Currículos-base ------------------------------ */

/**
 * Como um recrutador quer ler o currículo-base. O profile_truth guarda todos os fatos (inclusive números de
 * contexto, que servem para entrevistas e para um pacote quando uma vaga pedir); o currículo escolhe.
 * Vale para montar do zero, para atualizar depois de uma novidade e para a revisão (src/onboarding/resumeQuality.ts).
 */
export const RESUME_CURATION = `REGRAS DO CURRÍCULO-BASE (como um recrutador e um ATS leem):
- O currículo é uma SELEÇÃO do perfil, não uma cópia. O profile_truth guarda todos os fatos; o currículo mostra o que mais pesa para os cargos-alvo, em até 2 páginas.
- Tópicos por posição: a posição principal (a mais relevante para os cargos-alvo) tem de 4 a 6, e até 8 quando reúne projetos diferentes; as outras, de 2 a 4, nunca mais de 6; posições antigas ou pouco relevantes, 1 a 2.
- Use o espaço: o limite é 2 páginas, não 1. Se sobra espaço, inclua projetos e resultados distintos que reforçam os cargos-alvo em vez de deixar a segunda página vazia. Se passa de 2 páginas, corte primeiro o que pesa menos.
- Cada tópico é uma realização: começa com verbo de ação, ocupa no máximo 2 linhas (cerca de 250 caracteres) e diz o que foi feito, como (só as ferramentas que importam) e o resultado. Junte fatos relacionados num tópico só; não liste funcionalidades uma a uma.
- Vários projetos na mesma posição: cite o nome do projeto dentro do tópico, sem repetir o mesmo prefixo ("Projeto X:") em vários tópicos seguidos. Os projetos menores podem ficar de fora.
- Números: use os que mostram impacto ou escala que importa para os cargos-alvo (tempo economizado, melhoria percentual, volume processado, pessoas atendidas, economia ou receita relevante), no máximo 1 ou 2 por tópico. Deixe de fora números que diminuem o trabalho (poucos clientes, receita pequena, um único usuário, contagens de cadastros) e contadores internos de trabalho (commits, pull requests, linhas de código, quantidade de rotas, arquivos, modelos ou migrations), a não ser que o cargo-alvo peça exatamente isso.
- Número marcado como estimado no perfil: escreva "cerca de" (em inglês, "about"). Nunca escreva de onde o número veio nem quando foi medido ("autodeclarado", "estimado", "conforme relato", "segundo a pessoa", "levantamento de DD/MM/AAAA").
- Nada de pendências, perguntas ou notas para a pessoa: nada do que está em "A confirmar", nenhuma frase como "a confirmar", "verificar" ou "pendente".
- Resumo: 3 a 4 frases, até cerca de 600 caracteres, sem repetir a lista de competências.
- Competências: 4 a 7 categorias com o que um ATS procura (tecnologias, ferramentas, métodos, áreas), até cerca de 12 itens por categoria. Detalhe de implementação fica no tópico da experiência, não em competências.
- Revise ortografia e concordância.`;

/**
 * Currículo-base a partir do profile_truth. Em inglês, traduz a versão em português (`ptVersion`).
 * Com `previous` (o currículo-base atual), atualiza: mantém a redação do que continua bom e encaixa o que é novo
 * dentro dos limites, em vez de acrescentar tópicos a cada novidade.
 */
export function buildBaseResume(profileTruth: string, lang: "pt-BR" | "en", ptVersion?: Resume, previous?: Resume): Promise<Resume> {
  const en = lang === "en";
  return structured(ResumeSchema, {
    label: `init:resume-${lang}`,
    effort: "high",
    system: [SYSTEM, `<profile_truth>\n${profileTruth}\n</profile_truth>`, RESUME_CURATION],
    user: !en && previous
      ? `<curriculo_base_atual>\n${JSON.stringify(previous, null, 2)}\n</curriculo_base_atual>

O profile_truth acima foi atualizado. Atualize este currículo-base em português do Brasil (language "pt-BR") para refletir o perfil atual, no mesmo padrão ATS e seguindo as REGRAS DO CURRÍCULO-BASE:
- Mantenha a redação dos tópicos, do resumo e da headline que continuam valendo e já seguem as regras.
- O que é novo no perfil (experiência, projeto, certificação, competência, resultado): encaixe no tópico relacionado ou troque um tópico mais fraco. Não acrescente tópicos além do limite de cada posição. Nem toda novidade precisa entrar: ela continua no perfil.
- Ajuste o que mudou (datas, cargos, empresa atual) e retire o que não está mais no perfil.
- Se o currículo atual já passa dos limites ou quebra alguma regra, corrija agora.
- experience: TODAS as posições do perfil, ordem cronológica reversa, cargos e datas exatamente como no perfil (cargo só em português, sem tradução entre parênteses).
Não invente nada.`
      : en && ptVersion
      ? `<curriculo_pt>\n${JSON.stringify(ptVersion, null, 2)}\n</curriculo_pt>

Traduza este currículo para inglês americano (language "en"), adaptando para o padrão de resume dos EUA: verbos de ação sem pronome, datas MM/YYYY, "Present" no lugar de "Atual", modalidade Remote/Hybrid/On-site. Mesmas posições, datas, números e fatos, nada novo, e o mesmo número de tópicos. Cargos em inglês: use o "Cargo em inglês" do perfil quando houver; senão, traduza fielmente, sem promover nem mudar a senioridade. Linha de idiomas no mesmo nível declarado (ex.: "Portuguese: native | English: intermediate").`
      : `Monte o currículo-base em português do Brasil (language "pt-BR") a partir do profile_truth, no padrão ATS e seguindo as REGRAS DO CURRÍCULO-BASE:
- headline: cargo-alvo principal | 3–5 competências comprovadas.
- summary: 3–4 frases fortes e verdadeiras (o que faz, para quem, resultados reais).
- skills: 4–7 categorias coerentes com a área, só itens com evidência.
- experience: TODAS as posições, ordem cronológica reversa, cargos (só em português, sem tradução entre parênteses) e datas exatamente como no perfil, com o número de tópicos das regras (verbo de ação + o quê + como + resultado real).
- projects: 0–3 projetos/portfólio relevantes (vazio se não houver).
- education, certifications (só certificações/cursos reais; issuer e date como no perfil, vazio se não houver), languages (uma linha, nível declarado).
- contact: copie do perfil; campos ausentes ficam vazios. availability: modalidades aceitas.
Não invente nada.`,
  });
}

/** Revisão de um currículo-base: corrige só os problemas apontados pela conferência (resumeQuality.ts). */
export function reviseBaseResume(profileTruth: string, resume: Resume, problems: string[]): Promise<Resume> {
  const en = resume.language === "en";
  return structured(ResumeSchema, {
    label: `init:resume-${resume.language}-revisao`,
    effort: "high",
    system: [SYSTEM, `<profile_truth>\n${profileTruth}\n</profile_truth>`, RESUME_CURATION],
    user: `<curriculo>\n${JSON.stringify(resume, null, 2)}\n</curriculo>

<problemas>
${problems.map((p) => `- ${p}`).join("\n")}
</problemas>

Corrija estes problemas no currículo acima seguindo as REGRAS DO CURRÍCULO-BASE: escolha os tópicos e os números que mais pesam, junte o que é parecido e tire o resto (tudo continua no perfil). Mantenha o que já está bom, as posições, cargos e datas. Devolva o currículo inteiro${en ? ' em inglês (language "en")' : ' em português do Brasil (language "pt-BR")'}. Não invente nada.`,
  });
}
