import { structured, text } from "../llm.js";
import type { MarketProfile } from "../market.js";
import { candidateName, loadPreferences } from "../profile.js";
import { profileSystem } from "../prompts.js";
import {
  CoverLetterSchema,
  EmailPackSchema,
  type CoverLetter,
  type EmailPack,
  type JobAnalysis,
  type Resume,
} from "../schemas.js";

const json = (x: unknown) => JSON.stringify(x, null, 2);

function context(jd: string, analysis: JobAnalysis, resume: Resume) {
  return `<job_description>
${jd}
</job_description>

<job_analysis>
${json(analysis)}
</job_analysis>

<tailored_resume>
${json(resume)}
</tailored_resume>`;
}

/**
 * Cover letter (EUA/internacional) ou carta de apresentação (Brasil).
 * Nos EUA o pacote padrão é resume + cover letter.
 */
export function writeCoverLetter(p: { jd: string; analysis: JobAnalysis; resume: Resume; market: MarketProfile }): Promise<CoverLetter> {
  const en = p.market.language === "en";
  return structured(CoverLetterSchema, {
    label: "write:cover-letter",
    effort: "high",
    system: profileSystem(),
    user: `${context(p.jd, p.analysis, p.resume)}

Escreva ${en ? "uma cover letter em inglês americano" : "uma carta de apresentação em português do Brasil"} para esta vaga.

Estrutura (250–380 palavras no total, 3 a 4 parágrafos):
1. Abertura com gancho: o cargo exato e por que ESTA empresa/produto (use só o que a vaga diz sobre a empresa — não invente fatos sobre ela). Nada de "${en ? "I am writing to express my interest" : "venho por meio desta"}".
2. Prova 1: a conquista mais alinhada ao requisito nº 1 da vaga, com o resultado real (número só se estiver nas fontes).
3. Prova 2: outro requisito importante atendido com fato concreto das fontes.
4. Fechamento: disponibilidade${en ? `, fuso horário (${loadPreferences().timezone}) se for remoto,` : ""} e convite para conversar. Confiante, sem bajulação.

Regras: tom humano e direto, frases curtas, nada de clichês ("passionate", "team player", "proativo"). Só fatos das fontes. Não mencione lacunas. ${
      en ? "Greeting: 'Dear <recruiter name>,' se houver nome na vaga; senão 'Dear Hiring Manager,'. Closing: 'Sincerely,'." : "Saudação: 'Olá, <nome>,' se houver nome; senão 'Prezada equipe de Recrutamento,'. Encerramento: 'Atenciosamente,'."
    } subjectLine: "${en ? "Re: <Role> — <Company>" : "Candidatura: <Cargo> — <Empresa>"}".`,
  });
}

/** Modelos de e-mail e mensagens de LinkedIn para o recrutador. */
export function writeEmails(p: { jd: string; analysis: JobAnalysis; resume: Resume; market: MarketProfile; withCoverLetter: boolean }): Promise<EmailPack> {
  const en = p.market.language === "en";
  return structured(EmailPackSchema, {
    label: "write:emails",
    effort: "medium",
    system: profileSystem(),
    user: `${context(p.jd, p.analysis, p.resume)}

Escreva, em ${en ? "inglês americano" : "português do Brasil"}, os textos de contato com o recrutador desta vaga. Nome do recrutador na vaga: "${p.analysis.recruiterName || "desconhecido"}" — se desconhecido use uma saudação neutra com [Nome] para eu preencher.

1. application: e-mail de candidatura. 3 opções de assunto (padrão: "<Cargo> — ${candidateName()}"; se a vaga exigir um assunto específico, a 1ª opção é exatamente ele). Instruções de candidatura da vaga: "${p.analysis.applyInstructions || "nenhuma"}". Corpo com 90–150 palavras: quem sou em 1 frase, 2 provas ligadas aos requisitos, menção aos anexos (${p.withCoverLetter ? "resume + cover letter" : "currículo"}) e links que existirem no currículo (LinkedIn, portfólio). Assinatura com nome, telefone/e-mail e links que existirem.
2. linkedinConnectionNote: convite de conexão com no MÁXIMO 300 caracteres (conte!). Cite a vaga e 1 prova.
3. linkedinMessage: mensagem direta/InMail após conectar, até ~600 caracteres.
4. followUp: e-mail de acompanhamento para 5–7 dias úteis depois, curto, educado, com 1 informação nova de valor.
5. thankYou: agradecimento pós-entrevista, com [ponto discutido] para eu preencher.

Regras: só fatos das fontes, tom profissional e humano, sem bajulação nem clichês.`,
  });
}

/** Guia de preparação para entrevista (rascunho para você reescrever com suas palavras). */
export function writeInterviewPrep(p: { jd: string; analysis: JobAnalysis; resume: Resume; market: MarketProfile }): Promise<string> {
  return text({
    label: "write:interview",
    effort: "medium",
    system: profileSystem(),
    user: `${context(p.jd, p.analysis, p.resume)}

Prepare um guia de entrevista em português do Brasil (perguntas que serão feitas em ${p.market.language === "en" ? "inglês — escreva as perguntas e as respostas sugeridas em inglês, e as explicações em português" : "português"}), em Markdown:

## 1. O que a vaga realmente quer (3–4 frases) e os 3 critérios decisivos
## 2. 12 perguntas prováveis com resposta sugerida (método STAR)
- 4 técnicas da área/ferramentas da vaga, 4 comportamentais, 2 situacionais (casos práticos da função), 2 de motivação.
- Respostas baseadas SÓ em fatos das fontes. Sem número inventado; quando faltar exemplo, escreva "[use um exemplo real seu]".
## 3. Pitch de 60 segundos ("Tell me about yourself" / "Fale sobre você")
## 4. Pontos de atenção e como abordá-los (lacunas reais, idioma, senioridade)
## 5. 8 perguntas para fazer ao entrevistador
## 6. Checklist pré-entrevista (o que pesquisar sobre a empresa, tópicos da área para revisar)
## 7. Sinais de golpe para ficar atento (teste que exige baixar/rodar código, pedido de documento ou pagamento)`,
  });
}
