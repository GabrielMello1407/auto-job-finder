import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Resume — estrutura do currículo (qualquer área).                    */
/* ------------------------------------------------------------------ */

export const ContactSchema = z.object({
  location: z.string().describe("Cidade, UF, País — nunca endereço completo"),
  email: z.string(),
  phone: z.string().describe("Vazio se não houver"),
  linkedin: z.string(),
  github: z.string(),
  portfolio: z.string(),
  availability: z.string().describe("Ex.: 'Open to remote, hybrid or on-site roles'"),
});

export const SkillGroupSchema = z.object({
  category: z.string(),
  items: z.array(z.string()),
});

export const ExperienceSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  mode: z.string().describe("Remoto / Híbrido / Presencial (ou Remote / Hybrid / On-site). Vazio se desconhecido"),
  start: z.string().describe("MM/AAAA ou AAAA, igual à fonte. Vazio se a fonte não traz (nunca 'A confirmar')"),
  end: z.string().describe("MM/AAAA, AAAA, 'Atual' ou 'Present'. Vazio se a fonte não traz (nunca 'A confirmar')"),
  bullets: z.array(z.string()),
});

export const ProjectSchema = z.object({
  name: z.string(),
  description: z.string(),
  tech: z.array(z.string()),
  url: z.string().describe("Vazio se não houver"),
});

export const EducationSchema = z.object({
  degree: z.string(),
  institution: z.string(),
  period: z.string().describe("Ex.: '02/2019 – 08/2022'. Vazio se não houver"),
});

export const CertificationSchema = z.object({
  name: z.string(),
  issuer: z.string().describe("Vazio se a fonte não traz"),
  date: z.string().describe("Vazio se a fonte não traz"),
});

export const ResumeSchema = z.object({
  language: z.enum(["pt-BR", "en"]),
  name: z.string(),
  headline: z.string().describe("Linha abaixo do nome: cargo-alvo | 3–5 competências ou ferramentas-chave"),
  contact: ContactSchema,
  summary: z.string(),
  skills: z.array(SkillGroupSchema),
  experience: z.array(ExperienceSchema),
  projects: z.array(ProjectSchema).describe("Opcional: projetos pessoais/open source relevantes à vaga. Pode ser vazio"),
  education: z.array(EducationSchema),
  certifications: z.array(CertificationSchema),
  languages: z.string().describe("Uma linha. Ex.: 'Portuguese: native | English: ...'"),
});
export type Resume = z.infer<typeof ResumeSchema>;

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export type JobStatus =
  | "new"
  | "triaged"
  | "shortlisted"
  | "tailored" // pacote pronto, nota ≥ mínimo
  | "low_fit" // pacote gerado, mas nota abaixo do mínimo
  | "applied"
  | "interview"
  | "rejected"
  | "offer"
  | "discarded";

export interface Job {
  id: string;
  source: string;
  title: string;
  company: string;
  location: string;
  remote: boolean | null;
  url: string;
  applyUrl?: string;
  postedAt?: string;
  salary?: string;
  tags: string[];
  description: string;
  /** Restrições de localização informadas pela fonte (ex.: ["United States"]). */
  locationRestrictions?: string[];
  addedAt: string;
  status: JobStatus;
  triage?: Triage;
  outputDir?: string;
  /** Nota final do hiring manager para o currículo gerado. */
  rating?: number;
  atsScore?: number;
  /** PDFs gerados (caminhos absolutos). */
  files?: { resume?: string; coverLetter?: string };
  appliedAt?: string;
  /** Por onde a pessoa se candidatou (src/jobs/status.ts#APPLY_CHANNELS). */
  appliedVia?: ApplyVia;
  notes?: string;
  /** Pesquisa na web sobre a vaga e a empresa (vagas recebidas sem link ou por indicação). */
  research?: JobResearchSummary;
  /** Perguntas do formulário de candidatura e as respostas preparadas (src/writers/answers.ts). */
  answers?: JobAnswer[];
  /** A mesma vaga já estava salva com este ID (outro site, outro link). Ver src/jobs/dedupe.ts. */
  duplicateOf?: string;
  /** Você reabriu a vaga marcada como repetida: não marcar de novo. */
  notDuplicate?: boolean;
  /** Igual a uma que você já tratou há muito tempo (ou publicada depois): vaga reaberta. ID da antiga. */
  reopenedFrom?: string;
  /** Última conferência de que a vaga ainda aceita candidaturas (src/jobs/open.ts). */
  openCheck?: OpenCheck;
  /** Primeira resposta da empresa (entrevista, oferta ou recusa), para o tempo de resposta (src/jobs/funnel.ts). */
  respondedAt?: string;
  /** Como terminou uma candidatura recusada: a etapa e o motivo, se a empresa disse (src/jobs/funnel.ts). */
  outcome?: JobOutcome;
  /** Datas dos follow-ups enviados depois da candidatura. */
  followUps?: string[];
  /** Pedido de indicação para esta vaga (src/jobs/referral.ts). */
  referral?: JobReferral;
}

export type ApplyVia = "plataforma" | "email" | "linkedin" | "site" | "whatsapp" | "indicacao" | "outro";

/**
 * Até onde a candidatura chegou antes da recusa. "sem_resposta" é a candidatura que nunca teve
 * retorno (marcada pela pessoa, ou contada assim pelo funil depois de AJF_NO_REPLY_DAYS).
 */
export type RejectionStage = "sem_resposta" | "triagem" | "rh" | "tecnica" | "final" | "desconhecida";

export interface JobOutcome {
  stage: RejectionStage;
  /** O motivo, só se a empresa disse (ou a pessoa contou). */
  reason?: string;
  at: string;
}

export interface JobReferral {
  /** pedida: a pessoa pediu a alguém; recebida: alguém indicou; sem_resposta: ninguém respondeu. Vazio: só as mensagens foram escritas. */
  status?: "pedida" | "recebida" | "sem_resposta";
  /** Quando o status mudou pela última vez. */
  at?: string;
  /** Mensagens prontas: para quem já conhece a pessoa (warm) e convite de conexão para quem não conhece (cold). */
  messages?: { warm: string; cold: string };
}

export interface OpenCheck {
  at: string;
  /** aberta = a página da vaga está no ar; encerrada = o site diz que acabou; sem_confirmacao = não deu para conferir. */
  verdict: "aberta" | "encerrada" | "sem_confirmacao";
  reason: string;
}

export interface JobAnswer {
  id: string;
  question: string;
  answer: string;
  /** Limite de caracteres do campo no formulário. */
  limit?: number;
  /** O que a pessoa contou para esta resposta (motivação, opinião sobre o produto...). */
  context?: string;
  /** Ajustes pedidos depois ("mais curto", "uso o app há um ano"): continuam valendo nos próximos. */
  adjustments?: string[];
  /** O que só a pessoa sabe e deixaria a resposta mais forte. */
  needsYou: string[];
  /** O que as travas ainda acharam depois da correção (número sem fonte, limite estourado). */
  warnings?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface JobResearchSummary {
  at: string;
  /** confirmada = achou o anúncio oficial; nao_encontrada = a empresa existe ou não, mas o anúncio não apareceu; suspeita = sinais de golpe. */
  verdict: "confirmada" | "nao_encontrada" | "suspeita";
  postingUrl?: string;
  companySite?: string;
  notes: string[];
  /**
   * Missão, valores e cultura da página oficial da empresa, cada um com o link da fonte
   * (src/jobs/research.ts#officialCulture). Vazio = pesquisou e a página oficial não fala disso;
   * ausente = pesquisa de antes desta busca existir.
   */
  culture?: { text: string; source: string }[];
}

export const MarketSchema = z.enum(["BR", "US", "CA", "UK", "EU", "LATAM", "GLOBAL"]);
export type Market = z.infer<typeof MarketSchema>;

/** Critério eliminatório explícito da vaga e se o perfil atende (src/jobs/priority.ts#applyKnockouts). */
export const KnockoutSchema = z.object({
  requirement: z.string().describe("O critério como a vaga escreve (ex.: '5+ anos com Java', 'inglês fluente', 'presencial em Curitiba', 'autorização para trabalhar nos EUA')"),
  kind: z.enum(["experiencia", "idioma", "local", "autorizacao", "formacao", "certificacao", "outro"]),
  meets: z.enum(["sim", "nao", "incerto"]).describe("sim: o perfil comprova; nao: o perfil mostra que não atende; incerto: o perfil não diz"),
  evidence: z.string().describe("Trecho curto do perfil ou das respostas fixas que decide; vazio se incerto"),
});
export type Knockout = z.infer<typeof KnockoutSchema>;

export const TriageSchema = z.object({
  fit: z.enum(["alta", "media", "baixa"]),
  score: z.number().describe("0 a 100"),
  evidence: z.array(z.string()).describe("Trechos do perfil que comprovam requisitos da vaga"),
  mustHaveGaps: z.array(z.string()).describe("Requisitos obrigatórios SEM evidência no perfil"),
  scamSignals: z.array(z.string()).describe("Sinais de golpe/fraude. Vazio se nenhum"),
  recommendation: z.enum(["candidatar", "decidir", "descartar"]),
  market: MarketSchema.describe("Mercado/país do empregador (define idioma e formato)"),
  jobLanguage: z.enum(["pt-BR", "en", "other"]),
  seniority: z.string().describe("Senioridade pedida: junior/pleno/senior/staff…"),
  reason: z.string().describe("Uma frase com o motivo da recomendação"),
  knockouts: z
    .array(KnockoutSchema)
    .describe(
      "Critérios ELIMINATÓRIOS explícitos da vaga: o que ela diz ser obrigatório para ser considerado (anos mínimos, idioma exigido, presencial ou região, autorização de trabalho ou visto, formação ou certificação obrigatória). Vazio se a vaga não tem. Não inclua desejáveis.",
    ),
});
/** Triagens antigas (de antes dos critérios eliminatórios) não têm `knockouts`. */
export type Triage = Omit<z.infer<typeof TriageSchema>, "knockouts"> & { knockouts?: Knockout[] };

export const TriageBatchSchema = z.object({
  results: z.array(TriageSchema.extend({ jobId: z.string() })),
});

/* ------------------------------------------------------------------ */
/* Tailoring                                                           */
/* ------------------------------------------------------------------ */

export const JobAnalysisSchema = z.object({
  roleTitle: z.string(),
  company: z.string(),
  market: MarketSchema,
  mustHave: z.array(z.string()).describe("Requisitos obrigatórios, curtos"),
  niceToHave: z.array(z.string()),
  atsKeywords: z
    .array(z.string())
    .describe("15–35 termos exatos como aparecem na vaga (ferramentas, tecnologias, metodologias, certificações, cargos), sem duplicatas"),
  responsibilities: z.array(z.string()),
  companyContext: z.string().describe("O que a empresa faz e o que valoriza, segundo a vaga"),
  recruiterName: z.string().describe("Nome do recrutador/contato se aparecer na vaga; senão vazio"),
  recruiterEmail: z.string().describe("E-mail de candidatura se aparecer na vaga; senão vazio"),
  applyChannel: z
    .enum(["email", "linkedin", "plataforma", "site", "whatsapp", "desconhecido"])
    .describe("Como a vaga pede a candidatura: e-mail com currículo, LinkedIn, plataforma de recrutamento (Gupy, Greenhouse...), formulário no site, WhatsApp"),
  applyInstructions: z
    .string()
    .describe("Instruções específicas de candidatura copiadas da vaga (assunto obrigatório, código, documentos, prazo). Vazio se não houver"),
});
export type JobAnalysis = z.infer<typeof JobAnalysisSchema>;

export const ReviewSchema = z.object({
  rating: z.number().describe("Nota de aderência 1.0 a 10.0, uma casa decimal"),
  ratingRationale: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(
    z.object({
      requirement: z.string(),
      why: z.string(),
      truthfullyCoverable: z.boolean().describe("true só se as FONTES têm evidência que o currículo deixou de mostrar"),
      suggestion: z.string(),
    }),
  ),
  missingKeywordsCoverable: z.array(z.string()).describe("Palavras-chave da vaga ausentes no currículo MAS presentes nas fontes"),
  presentation: z.array(z.string()),
});
export type Review = z.infer<typeof ReviewSchema>;

export const CoverLetterSchema = z.object({
  subjectLine: z.string().describe("Linha 'Re:' com cargo e empresa"),
  greeting: z.string(),
  paragraphs: z.array(z.string()).describe("3 a 4 parágrafos"),
  closing: z.string().describe("Ex.: 'Sincerely,' / 'Atenciosamente,'"),
});
export type CoverLetter = z.infer<typeof CoverLetterSchema>;

const EmailSchema = z.object({ subject: z.string(), body: z.string() });

export const EmailPackSchema = z.object({
  application: z.object({ subjectOptions: z.array(z.string()), body: z.string() }),
  linkedinConnectionNote: z.string().describe("Máximo 300 caracteres"),
  linkedinMessage: z.string().describe("Mensagem direta/InMail ao recrutador, até ~600 caracteres"),
  followUp: EmailSchema,
  thankYou: EmailSchema,
  applicationNote: z
    .string()
    .describe("Mensagem curta de apresentação (3 a 5 frases, até 600 caracteres) para o campo 'mensagem' ou 'carta' das plataformas"),
});
export type EmailPack = z.infer<typeof EmailPackSchema>;

export const LinkedinPlanSchema = z.object({
  inconsistencies: z.array(z.string()),
  headlines: z.array(z.string()).describe("3 opções, máx. 220 caracteres cada"),
  aboutPt: z.string(),
  aboutEn: z.string(),
  experiences: z.array(
    z.object({ company: z.string(), title: z.string(), descriptionPt: z.string(), descriptionEn: z.string() }),
  ),
  topSkills: z.array(z.string()).describe("Exatamente 5 para fixar"),
  skills: z.array(z.string()).describe("30–50 competências na ordem de prioridade"),
  featured: z.array(z.object({ title: z.string(), url: z.string(), why: z.string() })),
  keywordsByFamily: z.array(z.object({ family: z.string(), keywords: z.array(z.string()) })),
  openToWork: z.object({ jobTitles: z.array(z.string()), locations: z.array(z.string()), notes: z.string() }),
  checklist: z.array(z.string()),
});
export type LinkedinPlan = z.infer<typeof LinkedinPlanSchema>;

/** Conferência do LinkedIn atual contra o perfil e o último plano. */
export const LinkedinCheckSchema = z.object({
  summary: z.string().describe("1–2 frases: como o LinkedIn está em relação ao perfil e ao último plano"),
  issues: z
    .array(z.object({ problem: z.string(), fix: z.string() }))
    .describe("Inconsistências entre o LinkedIn e o profile_truth (datas, cargos, empresas, números, níveis de idioma, certificações), cada uma com a correção"),
  pending: z.array(z.string()).describe("O que do último plano ainda não aparece no LinkedIn; vazio se não houver plano"),
  ok: z.array(z.string()).describe("O que já está certo ou já foi aplicado do plano"),
});
export type LinkedinCheck = z.infer<typeof LinkedinCheckSchema>;
