/**
 * `npm run demo`: monta a pasta demo/ com o perfil fictício de examples/profile (Ana Souza) e vagas
 * inventadas (empresas "Exemplo", links example.com) e abre a interface nela.
 *
 * Não usa IA e não toca nos seus dados: serve para conhecer a interface, testar mudanças nela
 * e tirar prints para a documentação. A pasta demo/ é recriada a cada execução e fica fora do git.
 *
 *   npm run demo                # gera os dados e abre a interface
 *   npm run demo -- --no-open   # só mostra o link
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO = path.join(ROOT, "demo");
// Antes de importar qualquer coisa de src/: a configuração lê AJF_HOME ao carregar.
process.env.AJF_HOME = DEMO;

const DAY = 86_400_000;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000).toISOString();
const slug = (s: string, max: number) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max)
    .replace(/-$/, "");

type Status = "new" | "triaged" | "shortlisted" | "tailored" | "low_fit" | "applied" | "interview" | "offer" | "rejected" | "discarded";

interface DemoJob {
  id: string;
  company: string;
  title: string;
  location: string;
  remote: boolean | null;
  salary?: string;
  status: Status;
  days: number;
  description: string;
  triage?: {
    fit: "alta" | "media" | "baixa";
    score: number;
    reason: string;
    evidence: string[];
    gaps: string[];
    scam?: string[];
    market: "BR" | "US" | "LATAM" | "GLOBAL";
    lang: "pt-BR" | "en";
    seniority: string;
  };
  rating?: number;
  ats?: number;
  appliedDays?: number;
  notes?: string;
  interviewGuide?: boolean;
  /** Pacote feito antes da última mudança no perfil. */
  outdated?: boolean;
}

const EVID_FULLSTACK = [
  "APIs REST em Node.js (Express) e TypeScript com PostgreSQL na Prefeitura Exemplo",
  "Interfaces em React e Next.js na Agência Pixel Exemplo",
  "Testes automatizados com Jest e Testing Library",
];

const JOBS: DemoJob[] = [
  {
    id: "demo0001",
    company: "Clínica Bem-Estar Exemplo",
    title: "Desenvolvedora(or) Full Stack Pleno — Node.js e React",
    location: "Remoto (Brasil)",
    remote: true,
    salary: "R$ 9.000–11.000 (CLT)",
    status: "tailored",
    days: 2,
    rating: 8.6,
    ats: 94,
    triage: {
      fit: "alta",
      score: 88,
      reason: "Stack principal (Node.js, TypeScript, React, PostgreSQL) tem evidência direta no perfil; a vaga é remota no Brasil e pede pleno.",
      evidence: [...EVID_FULLSTACK, "Integração com sistemas legados e migração de dados"],
      gaps: [],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: `Somos uma rede de clínicas (fictícia) e estamos digitalizando o agendamento e o prontuário.

Responsabilidades
- Construir APIs em Node.js e TypeScript e telas em React.
- Integrar o novo sistema ao legado e migrar dados com segurança.

Requisitos
- Node.js, TypeScript, React e PostgreSQL.
- Testes automatizados.

Diferenciais
- Experiência com IA aplicada (LLMs).

Como se candidatar: pela página de vagas, com currículo em PDF.`,
  },
  {
    id: "demo0002",
    company: "Studio Nébula Example",
    title: "Full Stack Developer (React/Node)",
    location: "Remote — LATAM",
    remote: true,
    salary: "US$ 4,000–5,500/month (contractor)",
    status: "tailored",
    days: 3,
    rating: 7.8,
    ats: 88,
    outdated: true,
    triage: {
      fit: "media",
      score: 79,
      reason: "Strong match on React and Node; the role asks for advanced spoken English, and the profile declares intermediate conversation.",
      evidence: EVID_FULLSTACK,
      gaps: ["Inglês avançado na conversação (perfil: intermediário)"],
      market: "US",
      lang: "en",
      seniority: "mid-level",
    },
    description: `Fictional design studio hiring a full stack developer to build client dashboards.

You will
- Ship features end to end with React, Next.js and Node.js.
- Work async with a team spread across the Americas.

Requirements
- 3+ years with React and Node.js, TypeScript.
- Advanced English for daily calls.`,
  },
  {
    id: "demo0003",
    company: "EducaMais Exemplo",
    title: "Pessoa Engenheira de Software — Plataforma de Cursos",
    location: "Londrina, PR (híbrido)",
    remote: false,
    status: "applied",
    days: 6,
    appliedDays: 3,
    notes: "via Gupy",
    rating: 8.1,
    ats: 91,
    triage: {
      fit: "alta",
      score: 84,
      reason: "Vaga híbrida em Londrina (cidade aceita) com Node.js, React e PostgreSQL, tudo com evidência no perfil.",
      evidence: EVID_FULLSTACK,
      gaps: [],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Plataforma de cursos (fictícia) procura pessoa engenheira de software para evoluir o painel de alunos e as APIs de matrícula. Node.js, React, PostgreSQL. Híbrido em Londrina.",
  },
  {
    id: "demo0004",
    company: "Varejo Sol Exemplo",
    title: "Desenvolvedora(or) React",
    location: "Remoto (Brasil)",
    remote: true,
    status: "applied",
    days: 12,
    appliedDays: 9,
    notes: "indicação de ex-colega",
    rating: 7.5,
    ats: 86,
    triage: {
      fit: "alta",
      score: 81,
      reason: "Foco em React e Next.js para e-commerce, com evidência direta na Agência Pixel Exemplo.",
      evidence: ["Interfaces em React e Next.js para clientes de varejo", "Testes com Jest e Testing Library"],
      gaps: [],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Varejista (fictícia) contrata pessoa desenvolvedora React para a loja online. React, Next.js, testes automatizados.",
  },
  {
    id: "demo0005",
    company: "Banco Horizonte Exemplo",
    title: "Software Engineer — Plataforma de Dados",
    location: "Remoto (Brasil)",
    remote: true,
    salary: "R$ 12.000–14.000 (PJ)",
    status: "interview",
    days: 15,
    appliedDays: 11,
    notes: "entrevista técnica marcada",
    rating: 8.3,
    ats: 90,
    interviewGuide: true,
    triage: {
      fit: "media",
      score: 77,
      reason: "Node.js, TypeScript e PostgreSQL com evidência; a vaga cita Kubernetes como desejável, que é lacuna declarada.",
      evidence: [...EVID_FULLSTACK, "Migração de 5.235 documentos com Node.js e SQL"],
      gaps: ["Kubernetes (desejável): sem experiência"],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Banco digital (fictício) busca engenheira(o) de software para APIs internas de dados. Node.js, TypeScript, PostgreSQL. Desejável: Kubernetes.",
  },
  {
    id: "demo0006",
    company: "Nuvem Azul Tecnologia Exemplo",
    title: "Desenvolvedora(or) Back-end Node.js",
    location: "Remoto (Brasil)",
    remote: true,
    salary: "R$ 8.000–10.000",
    status: "shortlisted",
    days: 1,
    triage: {
      fit: "alta",
      score: 86,
      reason: "APIs REST em Node.js e TypeScript com PostgreSQL e notificações em tempo real: todos os obrigatórios têm evidência.",
      evidence: ["APIs REST em Node.js (Express) e TypeScript com PostgreSQL", "Notificações em tempo real com Socket.io"],
      gaps: [],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Empresa de software (fictícia) contrata back-end Node.js para APIs de logística. Node.js, TypeScript, PostgreSQL, filas e tempo real.",
  },
  {
    id: "demo0007",
    company: "Fintech Aurora Exemplo",
    title: "AI Engineer — Aplicações com LLM",
    location: "Remoto (Brasil)",
    remote: true,
    status: "shortlisted",
    days: 1,
    triage: {
      fit: "media",
      score: 74,
      reason: "IA aplicada com LLMs e RAG tem evidência com resultado medido; Python avançado é pedido e não aparece no perfil.",
      evidence: ["Relatórios com LLMs e RAG: de 3 horas para menos de 10 minutos", "APIs em Node.js e TypeScript"],
      gaps: ["Python avançado"],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Fintech (fictícia) procura AI Engineer para assistentes internos com LLM e RAG. Desejável Node.js; obrigatório Python avançado.",
  },
  {
    id: "demo0008",
    company: "Northwind Labs Example",
    title: "Software Engineer (TypeScript)",
    location: "Remote — Americas",
    remote: true,
    status: "triaged",
    days: 2,
    triage: {
      fit: "media",
      score: 63,
      reason: "TypeScript and Node.js match, but the role wants 5+ years and on-call experience with AWS at scale.",
      evidence: ["TypeScript e Node.js no trabalho atual"],
      gaps: ["5+ anos de experiência", "AWS em produção (perfil: só curso livre)"],
      market: "US",
      lang: "en",
      seniority: "senior",
    },
    description: "Fictional SaaS company hiring a TypeScript engineer. 5+ years, AWS, on-call rotation.",
  },
  {
    id: "demo0009",
    company: "Oportunidade Digital Exemplo",
    title: "Desenvolvedor(a) Front-end — início imediato",
    location: "Remoto",
    remote: true,
    salary: "R$ 15.000 para júnior",
    status: "triaged",
    days: 1,
    triage: {
      fit: "media",
      score: 52,
      reason: "A stack combina, mas o anúncio tem sinais claros de golpe.",
      evidence: ["React e JavaScript"],
      gaps: [],
      scam: ["Pede pagamento de taxa de cadastro", "Salário muito acima do mercado para o nível", "Contato só por WhatsApp pessoal"],
      market: "BR",
      lang: "pt-BR",
      seniority: "júnior",
    },
    description: "Vaga (fictícia) com início imediato. Para participar, pague a taxa de cadastro de R$ 49,90 e envie seus documentos pelo WhatsApp.",
  },
  {
    id: "demo0010",
    company: "LogiTrans Exemplo",
    title: "Desenvolvedora(or) Full Stack — Rastreamento de Entregas",
    location: "Remoto (Brasil)",
    remote: true,
    status: "new",
    days: 0,
    description: "Transportadora (fictícia) busca full stack para o painel de rastreamento. Node.js, React, PostgreSQL, mapas.",
  },
  {
    id: "demo0011",
    company: "Agro Campo Exemplo",
    title: "Desenvolvedora(or) Mobile — React Native",
    location: "Remoto (Brasil)",
    remote: true,
    status: "low_fit",
    days: 5,
    rating: 6.2,
    ats: 71,
    triage: {
      fit: "media",
      score: 71,
      reason: "React e TypeScript ajudam, mas a vaga é centrada em React Native, sem evidência no perfil.",
      evidence: ["React e TypeScript"],
      gaps: ["React Native em produção", "Publicação nas lojas de aplicativos"],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Agrotech (fictícia) contrata dev mobile React Native para o app de campo.",
  },
  {
    id: "demo0012",
    company: "Nuvem Forte Exemplo",
    title: "Engenheira(o) de Plataforma Sênior",
    location: "Remoto",
    remote: true,
    status: "discarded",
    days: 4,
    triage: {
      fit: "baixa",
      score: 18,
      reason: "Vaga de infraestrutura (Kubernetes, Terraform, on-call) para sênior; quase nada disso aparece no perfil.",
      evidence: [],
      gaps: ["Kubernetes", "Terraform", "Senioridade sênior"],
      market: "BR",
      lang: "pt-BR",
      seniority: "sênior",
    },
    description: "Plataforma (fictícia) busca engenheira(o) sênior de infraestrutura. Kubernetes, Terraform, on-call.",
  },
  {
    id: "demo0013",
    company: "Saúde Já Exemplo",
    title: "Desenvolvedora(or) Full Stack",
    location: "Remoto (Brasil)",
    remote: true,
    status: "rejected",
    days: 25,
    appliedDays: 20,
    notes: "retorno: seguiram com outra pessoa",
    rating: 7.9,
    ats: 89,
    triage: {
      fit: "alta",
      score: 80,
      reason: "Node.js, React e PostgreSQL com evidência direta.",
      evidence: EVID_FULLSTACK,
      gaps: [],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Healthtech (fictícia) procura full stack para o portal do paciente.",
  },
];

const FOLDER: Record<Status, string> = {
  new: "1-prontas-para-enviar",
  triaged: "1-prontas-para-enviar",
  shortlisted: "1-prontas-para-enviar",
  tailored: "1-prontas-para-enviar",
  applied: "2-em-andamento",
  interview: "2-em-andamento",
  offer: "2-em-andamento",
  low_fit: "3-baixa-aderencia",
  rejected: "4-encerradas",
  discarded: "4-encerradas",
};

/* ------------------------------------------------------------- arquivos do pacote */

function leiaMe(j: DemoJob, pdf: string) {
  const ready = (j.rating ?? 0) >= 7;
  return `# Pacote: ${j.title} — ${j.company}

${ready ? `✅ **Pronto para revisar e enviar** (nota ${j.rating} ≥ 7).` : `⚠️ **Baixa aderência** (nota ${j.rating} < 7). Não recomendado enviar — as lacunas estão em rating_report.md.`}

- Vaga: https://example.com/vagas/${j.id}
- Mercado: ${j.triage?.market ?? "BR"} · idioma ${j.triage?.lang ?? "pt-BR"} · papel A4
- Nota final: **${j.rating}** (meta 8.5) · ATS: **${j.ats}%** · 1 página(s)
- Violações das travas: nenhuma

## Como se candidatar
🌐 **Pelo site da empresa** (https://example.com/vagas/${j.id}): preencha o formulário e envie ${pdf}.

## Arquivos
- ${pdf}
- emails.md — candidatura, LinkedIn, follow-up, agradecimento
- ats_report.md · rating_report.md · coverage_review.md${j.interviewGuide ? " · interview_prep.md" : ""}

## Antes de enviar (você aprova tudo)
- [ ] Li o PDF inteiro: datas, cargos, empresas e números conferem
- [ ] Nenhuma lacuna foi "preenchida" com algo que não fiz
- [ ] Vaga existe no site oficial da empresa; e-mail do recrutador tem domínio da empresa
- [ ] Não pediram documento, pagamento ou para baixar e rodar código
- [ ] Depois de enviar: clique em "Já me candidatei" na interface (\`ajf\`) ou rode \`ajf enviei ${j.id}\`

> Dados de demonstração: empresa e vaga fictícias.
`;
}

function emails(j: DemoJob, pdf: string) {
  return `# E-mails e mensagens para o recrutador

_Nenhum e-mail de contato na vaga. Procure o recrutador no LinkedIn._

**Anexos:** ${pdf}

## 1. E-mail de candidatura
**Assunto (escolha um):**
- ${j.title} — Ana Souza
- Candidatura: ${j.title} — Ana Souza

\`\`\`text
Olá, [Nome],

Sou Ana Souza, desenvolvedora full stack com Node.js, TypeScript e React, e me candidato à vaga de ${j.title}.

Duas experiências ligadas aos requisitos:
- Na Prefeitura Exemplo, desenvolvi APIs REST em Node.js e TypeScript com PostgreSQL e migrei 5.235 documentos do sistema legado.
- Automatizei relatórios técnicos com LLMs e RAG, reduzindo o tempo de 3 horas para menos de 10 minutos.

Envio meu currículo em anexo. Fico à disposição para conversar.

Atenciosamente,
Ana Souza
ana.souza@example.com
\`\`\`

## 2. Convite de conexão no LinkedIn
\`\`\`text
Olá, [Nome]! Vi a vaga de ${j.title} na ${j.company} e me candidatei. Trabalho com Node.js, TypeScript e React. Gostaria de me conectar.
\`\`\`

## 3. Mensagem direta / InMail
\`\`\`text
Obrigada por aceitar o convite, [Nome]. Me candidatei à vaga de ${j.title}. Na Prefeitura Exemplo, construí APIs em Node.js e TypeScript e automatizei relatórios com LLMs. Se for útil, posso enviar o currículo por aqui.
\`\`\`

## 4. Follow-up (5–7 dias úteis depois)
**Assunto:** Candidatura: ${j.title} — Ana Souza
\`\`\`text
Olá, [Nome],

Na semana passada me candidatei à vaga de ${j.title} e gostaria de saber se há novidades sobre o processo.

Sigo à disposição para conversar.

Atenciosamente,
Ana Souza
\`\`\`

## 5. Agradecimento pós-entrevista
**Assunto:** Obrigada pela conversa — ${j.title}
\`\`\`text
Olá, [Nome],

Obrigada pela conversa de hoje sobre a vaga de ${j.title}. Gostei de entender os desafios do time.

Atenciosamente,
Ana Souza
\`\`\`
`;
}

const atsReport = (j: DemoJob) => `# Relatório ATS — ${j.ats}%

## Coberto no currículo
- Node.js · TypeScript · React · PostgreSQL · APIs REST · testes automatizados

## Você tem, mas não mostrou
- Socket.io (está no perfil; dá para citar no resumo)

## Lacuna real (não preencher)
${j.triage?.gaps.length ? j.triage.gaps.map((g) => `- ${g}`).join("\n") : "- nenhuma"}
`;

const ratingReport = (j: DemoJob) => `# Nota do recrutador: ${j.rating} (meta 8.5)

| Rodada | Nota | O que mudou |
|---|---|---|
| 1 | ${(Math.max(5, (j.rating ?? 7) - 0.9)).toFixed(1)} | primeira versão |
| 2 | ${j.rating} | resumo reposicionado para os requisitos da vaga |

## O que faltou
${j.triage?.gaps.length ? j.triage.gaps.map((g) => `- ${g}`).join("\n") : "- nada obrigatório"}
`;

const coverage = () => `# Conferência com o seu perfil

- ✅ Todas as empresas, cargos e datas batem com o profile_truth.md.
- ✅ Todo número citado tem fonte (5.235 documentos; 3 horas → 10 minutos).
- ✅ Nenhuma frase de "Nunca afirmar" (rules.json).
`;

const interviewPrep = (j: DemoJob) => `# Guia de entrevista — ${j.title}

## Perguntas prováveis
1. **Conte um projeto de migração de dados.** Use a migração de 5.235 documentos (4,2 GB) na Prefeitura Exemplo: o problema, os scripts em Node.js e SQL e como você garantiu que nada se perdeu.
2. **Como você usaria IA aplicada no nosso contexto?** Cite os relatórios com LLMs e RAG (de 3 horas para menos de 10 minutos) e como mediu o ganho.
3. **Você já trabalhou com Kubernetes?** Seja honesta: não. Mostre o que já fez de deploy e como aprenderia.

## Perguntas para fazer
- Como o time divide o trabalho entre produto e plataforma?
- O que define sucesso nos primeiros 90 dias?

> Dados de demonstração.
`;

/* --------------------------------------------- atualização do perfil e LinkedIn */

/** Uma proposta de atualização pronta (como se a Ana tivesse contado um projeto novo). */
function seedProfileUpdate(truth: string) {
  const updated = truth
    .replace(
      "- Orbita — painel open source",
      "- Orbita Mobile — app em React Native do Orbita, publicado em 09/2026, com 1.200 downloads. github.com/ana-souza-exemplo/orbita-mobile\n- Orbita — painel open source",
    )
    .replace("Socket.io, Jest, Testing Library, LLMs, RAG, Git.", "Socket.io, Jest, Testing Library, LLMs, RAG, Git, React Native (no Orbita Mobile).")
    .replace(
      "- [ ] **Telefone:**",
      "- [ ] **Orbita Mobile:** data de início do projeto não informada.\n- [ ] **Telefone:**",
    );
  // Mesmo cálculo de truthHash (src/onboarding/update.ts), sem importar src/ antes de AJF_HOME valer.
  const norm = (t: string) => t.replace(/\r\n/g, "\n").trim() + "\n";
  const proposal = {
    createdAt: new Date().toISOString(),
    sources: ["Novidade contada"],
    changes: [
      "Projeto novo: Orbita Mobile (React Native), publicado em 09/2026, com 1.200 downloads",
      "React Native entrou nas competências, com evidência no Orbita Mobile",
    ],
    toConfirm: ["Orbita Mobile: data de início do projeto"],
    truth: norm(updated),
    baseHash: crypto.createHash("sha256").update(norm(truth)).digest("hex").slice(0, 16),
  };
  const dir = path.join(DEMO, "profile", "atualizacao");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "proposta.json"), JSON.stringify(proposal, null, 2));
}

/** Um plano de LinkedIn antigo (feito antes da última mudança no perfil) e uma conferência recente. */
function seedLinkedin() {
  const dir = path.join(DEMO, "output", "linkedin");
  fs.mkdirSync(dir, { recursive: true });
  const planDay = ago(10).slice(0, 10);
  const plan = {
    inconsistencies: ["O LinkedIn diz “AWS Certified”; o perfil tem só o curso livre de Fundamentos de AWS"],
    headlines: [
      "Desenvolvedora Full Stack | Node.js · React · TypeScript · PostgreSQL | IA aplicada com LLMs e RAG",
      "Full Stack (Node.js/React) | APIs, migração de dados e IA aplicada",
      "Desenvolvedora Full Stack com IA aplicada | Node.js · React · PostgreSQL",
    ],
    aboutPt: "Sou desenvolvedora full stack e trabalho com Node.js, TypeScript, React e PostgreSQL...",
    aboutEn: "I'm a full stack developer working with Node.js, TypeScript, React and PostgreSQL...",
    experiences: [],
    topSkills: ["Node.js", "React", "TypeScript", "PostgreSQL", "LLMs"],
    skills: ["Node.js", "React", "TypeScript", "PostgreSQL", "LLMs", "RAG", "Next.js", "Jest"],
    featured: [{ title: "Orbita", url: "https://github.com/ana-souza-exemplo/orbita", why: "projeto open source com Next.js e PostgreSQL" }],
    keywordsByFamily: [{ family: "Full Stack", keywords: ["node.js", "react", "typescript"] }],
    openToWork: { jobTitles: ["Desenvolvedora Full Stack", "Software Engineer"], locations: ["Remoto (Brasil)", "Londrina"], notes: "Visível só para recrutadores." },
    checklist: ["Fixar as 5 competências do topo", "Adicionar o Orbita nos Destaques", "Ativar o Open to Work só para recrutadores"],
  };
  const planMd = `# Plano de LinkedIn — ${planDay}

> Nada foi alterado no LinkedIn. Revise e aplique você mesmo o que aprovar.

## 1. Inconsistências para corrigir
- [ ] ${plan.inconsistencies[0]}

## 2. Headline (escolha uma)
${plan.headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}

## 3. Sobre — Português
${plan.aboutPt}

## 6. Competências
**Fixar no topo (5):** ${plan.topSkills.join(" · ")}

## 7. Destaques (Featured)
- **Orbita** — ${plan.featured[0].url}

## 9. Open to Work
- Cargos: ${plan.openToWork.jobTitles.join(", ")}
- Locais: ${plan.openToWork.locations.join(", ")}

## 10. Checklist
${plan.checklist.map((c) => `- [ ] ${c}`).join("\n")}

> Dados de demonstração.
`;
  const checkMd = `# Conferência do LinkedIn — ${ago(0).slice(0, 10)}

> Comparado com o seu perfil e com o plano de ${planDay}. Nada foi alterado no LinkedIn.

A headline e o “Sobre” já seguem o plano. Falta tirar o “AWS Certified” e adicionar o Orbita nos Destaques.

## ⚠️ Para corrigir
- [ ] **“AWS Certified” na seção de licenças** — troque por “Fundamentos de AWS (curso livre)”: o perfil não tem certificação oficial.
- [ ] **Inglês “fluente” nos idiomas** — o perfil declara inglês intermediário na conversação.

## ⏳ Do plano, ainda falta
- [ ] Adicionar o Orbita nos Destaques
- [ ] Fixar “LLMs” entre as 5 competências do topo

## ✅ Já está certo
- Headline no espírito da opção 1 do plano
- “Sobre” atualizado com Node.js, React, TypeScript e IA aplicada
- Experiências e datas batem com o perfil
- Open to Work com os cargos do plano

> Dados de demonstração.
`;
  const planBase = path.join(dir, `plano_linkedin_${planDay}`);
  fs.writeFileSync(`${planBase}.json`, JSON.stringify(plan, null, 2));
  fs.writeFileSync(`${planBase}.md`, planMd);
  const old = new Date(Date.now() - 10 * DAY);
  fs.utimesSync(`${planBase}.md`, old, old);
  fs.utimesSync(`${planBase}.json`, old, old);
  fs.writeFileSync(path.join(dir, `conferencia_linkedin_${ago(0).slice(0, 10)}.md`), checkMd);
}

/* ------------------------------------------------------------------- montagem */

async function main() {
  fs.rmSync(DEMO, { recursive: true, force: true });
  fs.mkdirSync(path.join(DEMO, "data"), { recursive: true });
  fs.cpSync(path.join(ROOT, "examples", "profile"), path.join(DEMO, "profile"), { recursive: true });

  // Um ponto "a confirmar" para a página Perfil mostrar como eles aparecem.
  const truthFile = path.join(DEMO, "profile", "profile_truth.md");
  fs.writeFileSync(
    truthFile,
    fs
      .readFileSync(truthFile, "utf8")
      .replace("- (nada pendente)", "- [ ] **Telefone:** não informado nas fontes. Deixe em branco se não quiser publicar."),
  );

  // PDFs de conferência do perfil fictício (sem IA). Sem Chrome, a demo segue sem PDFs.
  let basePdf: string | undefined;
  try {
    const { renderBaseResumes } = await import("../src/render/base.js");
    const files = await renderBaseResumes(() => {});
    basePdf = files.find((f) => f.includes("pt-BR"));
  } catch (e) {
    console.log(`⚠ Sem PDFs na demo (${(e as Error).message})`);
  }

  const jobs = JOBS.map((j) => {
    const job: Record<string, unknown> = {
      id: j.id,
      source: "demo",
      title: j.title,
      company: j.company,
      location: j.location,
      remote: j.remote,
      url: `https://example.com/vagas/${j.id}`,
      postedAt: ago(j.days + 1),
      salary: j.salary,
      tags: [],
      description: j.description,
      addedAt: ago(j.days, 2),
      status: j.status,
    };
    if (j.triage)
      job.triage = {
        fit: j.triage.fit,
        score: j.triage.score,
        evidence: j.triage.evidence,
        mustHaveGaps: j.triage.gaps,
        scamSignals: j.triage.scam ?? [],
        recommendation: j.triage.scam?.length ? "decidir" : j.triage.score >= 70 ? "candidatar" : j.triage.score < 30 ? "descartar" : "decidir",
        market: j.triage.market,
        jobLanguage: j.triage.lang,
        seniority: j.triage.seniority,
        reason: j.triage.reason,
      };
    if (j.appliedDays != null) job.appliedAt = ago(j.appliedDays, 3);
    if (j.notes) job.notes = j.notes;

    if (j.rating != null) {
      const dir = path.join(DEMO, "output", FOLDER[j.status], `${ago(j.days).slice(0, 10)}-${slug(j.company, 25)}-${slug(j.title, 35)}`);
      fs.mkdirSync(dir, { recursive: true });
      const pdfName = `Ana_Souza_Curriculo_${slug(j.company, 20).replace(/-/g, "_")}.pdf`;
      const write = (f: string, text: string) => fs.writeFileSync(path.join(dir, f), text);
      write("LEIA-ME.md", leiaMe(j, pdfName));
      write("emails.md", emails(j, pdfName));
      write("ats_report.md", atsReport(j));
      write("rating_report.md", ratingReport(j));
      write("coverage_review.md", coverage());
      write("job.md", `# ${j.title} — ${j.company}\n\n${j.description}\n`);
      fs.copyFileSync(path.join(DEMO, "profile", "base_resume.pt.json"), path.join(dir, "resume.json"));
      if (j.interviewGuide) write("interview_prep.md", interviewPrep(j));
      if (basePdf) fs.copyFileSync(basePdf, path.join(dir, pdfName));
      // Pacote gerado antes da última mudança no perfil: aparece como "perfil mudou depois".
      if (j.outdated) {
        const past = new Date(Date.now() - 3 * DAY);
        fs.utimesSync(path.join(dir, "LEIA-ME.md"), past, past);
      }
      job.outputDir = dir;
      job.rating = j.rating;
      job.atsScore = j.ats;
      job.files = basePdf ? { resume: path.join(dir, pdfName) } : {};
    }
    return job;
  });
  fs.writeFileSync(path.join(DEMO, "data", "jobs.json"), JSON.stringify(jobs, null, 2));
  seedProfileUpdate(fs.readFileSync(truthFile, "utf8"));
  seedLinkedin();
  console.log(`✅ Demonstração montada em ${DEMO} (${jobs.length} vagas fictícias, perfil da Ana Souza).`);

  const { startUi } = await import("../src/ui/server.js");
  await startUi({ open: !process.argv.includes("--no-open") });
}

main().catch((e) => {
  console.error(`❌ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
