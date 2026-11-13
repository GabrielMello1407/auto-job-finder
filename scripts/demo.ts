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
  /** E-mail de candidatura que aparece na vaga. */
  contactEmail?: string;
  source?: string;
  /** A mesma vaga de outra (achada em outro site). */
  duplicateOf?: string;
  /** A conferência achou a vaga encerrada (o motivo). */
  closed?: string;
  /** Igual a uma antiga em que a pessoa já se candidatou: vaga reaberta. */
  reopenedFrom?: string;
  /** Dias desde a publicação (padrão: days + 1). */
  postedDays?: number;
  /** Critérios eliminatórios da triagem. */
  knockouts?: { requirement: string; kind: string; meets: "sim" | "nao" | "incerto"; evidence: string }[];
  /** Por onde a candidatura foi enviada. */
  via?: "plataforma" | "email" | "linkedin" | "site" | "whatsapp" | "indicacao" | "outro";
  /** Recusa: até onde chegou e o motivo. */
  outcome?: { stage: "sem_resposta" | "triagem" | "rh" | "tecnica" | "final" | "desconhecida"; reason?: string };
  /** Dias atrás em que a empresa respondeu pela primeira vez. */
  respondedDays?: number;
  /** Dias atrás em que cada follow-up foi enviado. */
  followUpDays?: number[];
  /** Pedido de indicação (dias atrás). */
  referral?: { status: "pedida" | "recebida" | "sem_resposta"; days: number };
  /** Vaga recebida sem link (indicação, e-mail, WhatsApp) e pesquisada na web. */
  research?: {
    verdict: "confirmada" | "nao_encontrada" | "suspeita";
    postingUrl?: string;
    companySite?: string;
    summary?: string;
    extra?: string[];
    apply?: string;
    notes: string[];
    /** Missão e valores da página oficial, com o link (fictícios). */
    culture?: { text: string; source: string }[];
  };
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
    contactEmail: "vagas@clinicabemestar.example.com",
    referral: { status: "recebida", days: 1 },
    knockouts: [
      { requirement: "Morar no Brasil", kind: "local", meets: "sim", evidence: "Mora em Londrina, PR" },
      { requirement: "Experiência com Node.js e React", kind: "experiencia", meets: "sim", evidence: "Full stack com Node.js e React na Prefeitura Exemplo desde 2023" },
    ],
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
    postedDays: 18,
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
    via: "plataforma",
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
    via: "indicacao",
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
    via: "email",
    respondedDays: 7,
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
    referral: { status: "pedida", days: 4 },
    knockouts: [
      { requirement: "Experiência com Node.js e TypeScript em produção", kind: "experiencia", meets: "sim", evidence: "APIs REST em Node.js e TypeScript na Prefeitura Exemplo" },
      { requirement: "Disponibilidade para começar em até 30 dias", kind: "outro", meets: "sim", evidence: "Respostas fixas: pode começar em 30 dias" },
    ],
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
    description:
      "Indicação de um amigo: a Nuvem Azul (fictícia) contrata back-end Node.js para o time de APIs de logística. Node.js, TypeScript, PostgreSQL, filas e tempo real. Currículo para talentos@nuvemazul.example.com com o assunto \"Back-end Node\".",
    research: {
      verdict: "confirmada",
      postingUrl: "https://example.com/carreiras/nuvem-azul/backend-node",
      companySite: "https://example.com/nuvem-azul",
      summary: "Empresa de software (fictícia) para logística: rastreamento de frotas e roteirização para transportadoras.",
      extra: ["Experiência com filas (RabbitMQ ou SQS)", "Desejável: Docker", "Etapas: conversa com RH, desafio técnico e entrevista com o time"],
      apply: "E-mail para talentos@nuvemazul.example.com com o assunto \"Back-end Node\", até o fim do mês.",
      notes: ["O anúncio oficial no site de carreiras é a mesma vaga, com os mesmos requisitos.", "O e-mail que o seu amigo passou bate com o domínio da empresa."],
      culture: [
        { text: "Missão: tirar o achismo da logística, com dados de rastreamento em tempo real.", source: "https://example.com/nuvem-azul/sobre" },
        { text: "Autonomia com responsabilidade: quem constrói também cuida do que vai para produção.", source: "https://example.com/nuvem-azul/carreiras" },
        { text: "Comunicação clara, com decisões escritas e abertas para o time.", source: "https://example.com/nuvem-azul/carreiras" },
      ],
    },
  },
  {
    id: "demo0007",
    company: "Fintech Aurora Exemplo",
    knockouts: [
      { requirement: "Python avançado (obrigatório)", kind: "experiencia", meets: "nao", evidence: "O perfil não mostra Python além de scripts simples" },
      { requirement: "Experiência com LLMs em produção", kind: "experiencia", meets: "sim", evidence: "Relatórios com LLMs e RAG em uso na Prefeitura Exemplo" },
    ],
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
    knockouts: [
      { requirement: "5+ years of professional experience", kind: "experiencia", meets: "nao", evidence: "Cerca de 3 anos de experiência profissional" },
      { requirement: "Authorized to work in the US", kind: "autorizacao", meets: "incerto", evidence: "O perfil não fala de autorização de trabalho nos EUA" },
    ],
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
    closed: "a página diz “no longer accepting applications”",
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
    research: {
      verdict: "suspeita",
      notes: [
        "Nenhum anúncio desta vaga no site ou nas redes da empresa.",
        "O contato é um WhatsApp pessoal, não um canal da empresa.",
        "Empresas sérias não cobram taxa para participar de processo seletivo.",
      ],
    },
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
    via: "plataforma",
    respondedDays: 12,
    outcome: { stage: "rh", reason: "seguiram com outra pessoa, com experiência em saúde" },
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
  {
    // A mesma vaga da demo0006, achada de novo em outro site: entra descartada como repetida.
    id: "demo0014",
    company: "Nuvem Azul Tecnologia",
    title: "Desenvolvedor(a) Back-end Node.js",
    location: "Remoto (Brasil)",
    remote: true,
    status: "discarded",
    days: 0,
    source: "gupy",
    duplicateOf: "demo0006",
    description:
      "A Nuvem Azul (fictícia) contrata back-end Node.js para o time de APIs de logística. Node.js, TypeScript, PostgreSQL, filas e tempo real.",
  },
  {
    // A Saúde Já abriu de novo a vaga em que a Ana foi recusada: entra como vaga nova, com o aviso.
    id: "demo0015",
    company: "Saúde Já Exemplo",
    title: "Desenvolvedora(or) Full Stack",
    location: "Remoto (Brasil)",
    remote: true,
    status: "shortlisted",
    days: 0,
    reopenedFrom: "demo0013",
    triage: {
      fit: "alta",
      score: 81,
      reason: "A mesma stack da vaga anterior da empresa: Node.js, React e PostgreSQL com evidência direta.",
      evidence: EVID_FULLSTACK,
      gaps: [],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Healthtech (fictícia) reabriu a vaga de full stack para o portal do paciente.",
  },
  {
    // Anúncio antigo de banco de talentos: aparece com o alerta de vaga fantasma e desce na lista.
    id: "demo0016",
    company: "Grupo Atlas Exemplo",
    title: "Banco de Talentos — Tecnologia",
    location: "Remoto (Brasil)",
    remote: true,
    status: "triaged",
    days: 2,
    postedDays: 45,
    triage: {
      fit: "media",
      score: 66,
      reason: "Pede desenvolvimento web em geral, sem uma vaga específica; a stack combina com o perfil.",
      evidence: ["Node.js e React no trabalho atual"],
      gaps: [],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "O Grupo Atlas (fictício) mantém um banco de talentos de tecnologia. Cadastre seu currículo para oportunidades futuras em desenvolvimento web.",
  },
  {
    id: "demo0017",
    company: "Conecta Seguros Exemplo",
    title: "Desenvolvedora(or) Full Stack Pleno",
    location: "Remoto (Brasil)",
    remote: true,
    status: "rejected",
    days: 51,
    postedDays: 52,
    appliedDays: 40,
    source: "gupy",
    via: "plataforma",
    respondedDays: 38,
    outcome: {stage: "triagem",reason: "pediam 5 anos de experiência"},
    triage: {
      fit: "media",
      score: 72,
      reason: "Stack combina; a vaga pede 5 anos de experiência.",
      evidence: EVID_FULLSTACK,
      gaps: ["5 anos de experiência"],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Seguradora (fictícia) busca full stack pleno para o portal do corretor. Node.js, React, 5 anos de experiência.",
  },
  {
    id: "demo0018",
    company: "Rota Certa Exemplo",
    title: "Desenvolvedora(or) Node.js",
    location: "Remoto (Brasil)",
    remote: true,
    status: "rejected",
    days: 47,
    postedDays: 48,
    appliedDays: 39,
    source: "remotive",
    via: "plataforma",
    outcome: {stage: "sem_resposta"},
    triage: {
      fit: "alta",
      score: 76,
      reason: "Node.js e PostgreSQL com evidência direta.",
      evidence: EVID_FULLSTACK,
      gaps: [],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Empresa de logística (fictícia) contrata back-end Node.js para a API de rotas.",
  },
  {
    id: "demo0019",
    company: "Feira Livre Digital Exemplo",
    title: "Desenvolvedora(or) Front-end React",
    location: "Remoto (Brasil)",
    remote: true,
    status: "applied",
    days: 43,
    postedDays: 47,
    appliedDays: 36,
    source: "web:google jobs",
    via: "plataforma",
    triage: {
      fit: "media",
      score: 70,
      reason: "React e TypeScript com evidência; pouco back-end na vaga.",
      evidence: EVID_FULLSTACK,
      gaps: [],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Marketplace (fictício) procura front-end React para o app do vendedor.",
  },
  {
    id: "demo0020",
    company: "Pagar Fácil Exemplo",
    title: "Software Engineer (Node.js)",
    location: "Remoto (Brasil)",
    remote: true,
    status: "rejected",
    days: 32,
    postedDays: 33,
    appliedDays: 31,
    source: "manual",
    via: "indicacao",
    respondedDays: 27,
    outcome: {stage: "tecnica",reason: "o teste técnico pedia Go"},
    triage: {
      fit: "alta",
      score: 79,
      reason: "Node.js e TypeScript com evidência; Go aparece como desejável.",
      evidence: EVID_FULLSTACK,
      gaps: ["Go (desejável)"],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Fintech (fictícia) busca engenheira(o) de software Node.js para pagamentos. Desejável: Go.",
  },
  {
    id: "demo0021",
    company: "Clima Verde Exemplo",
    title: "Desenvolvedora(or) Full Stack",
    location: "Remoto (Brasil)",
    remote: true,
    status: "applied",
    days: 16,
    postedDays: 17,
    appliedDays: 15,
    source: "github-br",
    via: "linkedin",
    followUpDays: [7],
    triage: {
      fit: "alta",
      score: 83,
      reason: "Node.js, React e PostgreSQL com evidência direta.",
      evidence: EVID_FULLSTACK,
      gaps: [],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Startup de energia (fictícia) contrata full stack para o painel de consumo. Node.js, React, PostgreSQL.",
  },
  {
    id: "demo0022",
    company: "Turismo Sul Exemplo",
    title: "Desenvolvedora(or) Web",
    location: "Remoto (Brasil)",
    remote: true,
    status: "rejected",
    days: 29,
    postedDays: 30,
    appliedDays: 28,
    source: "gupy",
    via: "email",
    respondedDays: 24,
    triage: {
      fit: "media",
      score: 74,
      reason: "React e Node.js com evidência; a vaga é mais de front-end.",
      evidence: EVID_FULLSTACK,
      gaps: [],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Agência de turismo (fictícia) contrata dev web para o site de reservas.",
  },
  {
    id: "demo0023",
    company: "Escola Online Exemplo",
    title: "Pessoa Desenvolvedora Front-end",
    location: "Remoto (Brasil)",
    remote: true,
    status: "rejected",
    days: 39,
    postedDays: 40,
    appliedDays: 34,
    source: "gupy",
    respondedDays: 31,
    outcome: {stage: "triagem"},
    triage: {
      fit: "media",
      score: 68,
      reason: "React com evidência; a vaga pede Vue.js.",
      evidence: EVID_FULLSTACK,
      gaps: ["Vue.js"],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Plataforma de ensino (fictícia) procura front-end com Vue.js para a área do aluno.",
  },
  {
    id: "demo0024",
    company: "Logística Ágil Exemplo",
    title: "Desenvolvedora(or) Back-end",
    location: "Remoto (Brasil)",
    remote: true,
    status: "rejected",
    days: 25,
    postedDays: 26,
    appliedDays: 25,
    source: "github-br",
    via: "plataforma",
    outcome: {stage: "sem_resposta"},
    triage: {
      fit: "media",
      score: 71,
      reason: "Node.js com evidência; filas e mensageria são lacuna.",
      evidence: EVID_FULLSTACK,
      gaps: ["Mensageria (RabbitMQ)"],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Transportadora (fictícia) busca back-end para integrações com parceiros. Node.js, RabbitMQ.",
  },
  {
    id: "demo0025",
    company: "Fábrica de Apps Exemplo",
    title: "Desenvolvedora(or) Full Stack",
    location: "Remoto (Brasil)",
    remote: true,
    status: "rejected",
    days: 59,
    postedDays: 60,
    appliedDays: 58,
    source: "manual",
    via: "email",
    respondedDays: 52,
    outcome: {stage: "triagem",reason: "a vaga passou a exigir inglês fluente"},
    triage: {
      fit: "alta",
      score: 78,
      reason: "Node.js e React com evidência direta.",
      evidence: EVID_FULLSTACK,
      gaps: [],
      market: "BR",
      lang: "pt-BR",
      seniority: "pleno",
    },
    description: "Software house (fictícia) contrata full stack para projetos de clientes. Node.js, React.",
  },
];

const DETAILS_PT = `

Responsabilidades
- Desenvolver e manter funcionalidades de ponta a ponta, com testes automatizados.
- Participar das revisões de código e das decisões técnicas do time.
- Acompanhar o sistema em produção e propor melhorias.

Benefícios
- Plano de saúde, auxílio home office e horário flexível.

Etapas do processo
- Conversa com RH, entrevista técnica e conversa final com a liderança.`;
const DETAILS_EN = `

Responsibilities
- Build and maintain features end to end, with automated tests.
- Take part in code reviews and technical decisions.
- Monitor the system in production and suggest improvements.

Benefits
- Health plan, home office allowance and flexible hours.

Hiring process
- Recruiter call, technical interview and a final conversation with the team lead.`;
/** Vaga colada (com pesquisa) fica como veio; as outras ganham o corpo de um anúncio. */
const withDetails = (j: DemoJob) => (j.research || j.description.length >= 400 ? j.description : j.description + (j.triage?.lang === "en" ? DETAILS_EN : DETAILS_PT));

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
  // Igual ao pacote de verdade (src/tailor/index.ts): com e-mail na vaga, sai o link do rascunho.
  const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const subject = `${j.title} — Ana Souza`;
  const body = `Olá,

Sou Ana Souza e me candidato à vaga de ${j.title}. Envio meu currículo em anexo.

Atenciosamente,
Ana Souza`;
  const to = j.contactEmail
    ? `**Destinatário encontrado na vaga:** ${j.contactEmail}  
[Abrir rascunho no seu e-mail](mailto:${j.contactEmail}?subject=${enc(subject)}&body=${enc(body)}) (anexe os arquivos manualmente)`
    : "_Nenhum e-mail de contato na vaga. Procure o recrutador no LinkedIn._";
  return `# E-mails e mensagens para o recrutador

${to}

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

## 6. Mensagem curta de apresentação (${note(j).length}/600 caracteres)
Para o campo "mensagem", "carta de apresentação" ou "por que você?" das plataformas, ou para o corpo de um e-mail curto.
\`\`\`text
${note(j)}
\`\`\`
`;
}

const note = (j: DemoJob) =>
  `Sou desenvolvedora full stack com Node.js, TypeScript e React. Na Prefeitura Exemplo, construí APIs REST com PostgreSQL, migrei 5.235 documentos do sistema legado e automatizei relatórios com LLMs, de 3 horas para menos de 10 minutos. Quero levar essa experiência para a vaga de ${j.title} na ${j.company}. Meu currículo está em anexo.`;

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

/**
 * "Números que faltam" já analisados, como a IA deixaria (profile/numeros_que_faltam.json): a demo não
 * chama IA. Tópico do perfil fictício sem análise aqui ganha uma genérica.
 */
async function seedNumberHints() {
  const { bulletsWithoutNumbers } = await import("../src/onboarding/numbers.js");
  const resume = JSON.parse(fs.readFileSync(path.join(DEMO, "profile", "base_resume.pt.json"), "utf8"));
  const KNOWN: Record<string, object> = {
    "Desenvolvi APIs REST em Node.js (Express) e TypeScript com PostgreSQL.": {
      worth: "alto",
      measure: "volume e alcance: quantas chamadas, quantos sistemas ou pessoas dependem das APIs",
      question: "Quantos sistemas ou quantas pessoas usam essas APIs, e quantas requisições elas recebem por dia?",
      examples: ["cerca de N mil requisições por dia", "usadas por N secretarias"],
      why: "Mostra a escala do que você mantém em produção.",
    },
    "Construí interfaces em React e Next.js para clientes de varejo.": {
      worth: "alto",
      measure: "alcance: quantos clientes ou lojas, quantas pessoas usam",
      question: "Para quantos clientes você fez essas interfaces, e quantas pessoas as usam por mês?",
      examples: ["N clientes de varejo", "cerca de N mil acessos por mês"],
      why: "Transforma uma tarefa em resultado com público.",
    },
    "Criei testes automatizados com Jest e Testing Library.": {
      worth: "medio",
      measure: "qualidade: cobertura ou erros evitados",
      question: "Quanto do código ficou coberto pelos testes, ou quantos erros em produção caíram depois deles?",
      examples: ["cobertura de N%", "de N para N erros por mês"],
      why: "Qualidade medida diz mais que só citar a ferramenta.",
    },
    "Mantive o site institucional em JavaScript e HTML/CSS.": {
      worth: "medio",
      measure: "alcance: visitas por mês",
      question: "Quantas visitas o site recebia por mês?",
      examples: ["cerca de N mil visitas por mês"],
      why: "Mostra quantas pessoas o trabalho alcançava.",
    },
    "Corrigi problemas de acessibilidade apontados pela comunidade.": {
      worth: "baixo",
      measure: "quantidade de correções",
      question: "Quantos problemas de acessibilidade você corrigiu?",
      examples: ["N correções"],
      why: "É um trabalho voluntário pontual; o número pesa pouco aqui.",
    },
  };
  const generic = {
    worth: "medio",
    measure: "alcance, volume ou tempo",
    question: "Quantas pessoas, itens ou horas esse trabalho envolveu?",
    examples: ["cerca de N pessoas", "de N horas para N minutos"],
    why: "Um número mostra o tamanho do resultado.",
  };
  const hints = Object.fromEntries(bulletsWithoutNumbers(resume, 12).map((b) => [b.bullet, KNOWN[b.bullet] ?? generic]));
  fs.writeFileSync(path.join(DEMO, "profile", "numeros_que_faltam.json"), JSON.stringify({ updatedAt: ago(1), hints }, null, 2));
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

  // Respostas fixas dos formulários (Preferências): entram na ficha, nas respostas e na triagem.
  const prefsFile = path.join(DEMO, "profile", "preferences.json");
  const prefs = JSON.parse(fs.readFileSync(prefsFile, "utf8"));
  prefs.applicationFacts = {
    salaryExpectation: "R$ 9.000 a 10.000 CLT, ou R$ 12.000 PJ",
    availability: "em 30 dias",
    noticePeriod: "30 dias",
    relocation: "não; remoto ou híbrido em Londrina",
    workAuthorization: "brasileira; sem visto para outros países, só como PJ remoto",
  };
  fs.writeFileSync(prefsFile, JSON.stringify(prefs, null, 2));

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

  const { researchBlock } = await import("../src/jobs/research.js");
  const jobs = JOBS.map((j) => {
    const job: Record<string, unknown> = {
      id: j.id,
      source: "demo",
      title: j.title,
      company: j.company,
      location: j.location,
      remote: j.remote,
      url: `https://example.com/vagas/${j.id}`,
      postedAt: ago(j.postedDays ?? j.days + 1),
      salary: j.salary,
      tags: [],
      description: withDetails(j),
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
        recommendation:
          j.triage.scam?.length || j.knockouts?.some((k) => k.meets === "nao") ? "decidir" : j.triage.score >= 70 ? "candidatar" : j.triage.score < 30 ? "descartar" : "decidir",
        knockouts: j.knockouts,
        market: j.triage.market,
        jobLanguage: j.triage.lang,
        seniority: j.triage.seniority,
        reason: j.triage.reason,
      };
    if (j.research) {
      const r = j.research;
      job.source = "manual";
      job.url = `manual://colada#${j.id}`;
      if (r.postingUrl) job.applyUrl = r.postingUrl;
      const block = researchBlock({
        postingFound: r.verdict === "confirmada",
        postingUrl: r.postingUrl ?? "",
        companySite: r.companySite ?? "",
        companySummary: r.summary ?? "",
        extraDetails: r.extra ?? [],
        applyInstructions: r.apply ?? "",
        officialEmailDomains: [],
        verdict: r.verdict,
        notes: r.notes,
        companyCulture: r.culture ?? [],
        sources: [r.postingUrl, r.companySite].filter((u): u is string => Boolean(u)),
      });
      job.description = `${j.description}\n\n---\n\n${block}`;
      job.research = { at: ago(j.days, 1), verdict: r.verdict, postingUrl: r.postingUrl, companySite: r.companySite, notes: r.notes, culture: r.culture ?? [] };
    }
    if (j.appliedDays != null) job.appliedAt = ago(j.appliedDays, 3);
    if (j.via) job.appliedVia = j.via;
    if (j.respondedDays != null) job.respondedAt = ago(j.respondedDays, 1);
    if (j.outcome) job.outcome = { ...j.outcome, at: ago(j.respondedDays ?? Math.max(0, (j.appliedDays ?? 30) - 30), 1) };
    if (j.followUpDays) job.followUps = j.followUpDays.map((d) => ago(d, 2));
    if (j.referral) job.referral = { status: j.referral.status, at: ago(j.referral.days, 2) };
    if (j.notes) job.notes = j.notes;
    if (j.source) job.source = j.source;
    if (j.duplicateOf) job.duplicateOf = j.duplicateOf;
    if (j.reopenedFrom) job.reopenedFrom = j.reopenedFrom;
    if (j.closed) job.openCheck = { at: ago(0, 1), verdict: "encerrada", reason: j.closed };

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
      // Canal de candidatura e e-mail de contato, como a análise da vaga grava (rascunho de e-mail, "Já me candidatei").
      write(
        "analysis.json",
        JSON.stringify(
          {
            analysis: { applyChannel: j.contactEmail ? "email" : "plataforma", recruiterEmail: j.contactEmail ?? "" },
            market: { language: j.triage?.lang ?? "pt-BR", paper: "A4", docName: "Curriculo" },
            baseName: pdfName.replace(/\.pdf$/, ""),
            company: j.company,
          },
          null,
          2,
        ),
      );
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
  await seedNumberHints();
  seedLinkedin();
  console.log(`✅ Demonstração montada em ${DEMO} (${jobs.length} vagas fictícias, perfil da Ana Souza).`);

  const { startUi } = await import("../src/ui/server.js");
  await startUi({ open: !process.argv.includes("--no-open") });
}

main().catch((e) => {
  console.error(`❌ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
