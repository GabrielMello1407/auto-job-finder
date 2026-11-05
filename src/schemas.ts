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
  start: z.string().describe("MM/AAAA ou AAAA, igual à fonte"),
  end: z.string().describe("MM/AAAA, AAAA, 'Atual' ou 'Present'"),
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
  issuer: z.string(),
  date: z.string(),
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
  notes?: string;
  /** Pesquisa na web sobre a vaga e a empresa (vagas recebidas sem link ou por indicação). */
  research?: JobResearchSummary;
}

export interface JobResearchSummary {
  at: string;
  /** confirmada = achou o anúncio oficial; nao_encontrada = a empresa existe ou não, mas o anúncio não apareceu; suspeita = sinais de golpe. */
  verdict: "confirmada" | "nao_encontrada" | "suspeita";
  postingUrl?: string;
  companySite?: string;
  notes: string[];
}

export const MarketSchema = z.enum(["BR", "US", "CA", "UK", "EU", "LATAM", "GLOBAL"]);
export type Market = z.infer<typeof MarketSchema>;

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
});
export type Triage = z.infer<typeof TriageSchema>;

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
