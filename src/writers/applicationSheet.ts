import fs from "node:fs";
import path from "node:path";
import {
  APPLICATION_FACT_LABELS,
  englishBase,
  loadBaseResume,
  loadPreferences,
  withoutDashesResume,
  withoutTranslatedTitles,
  type ApplicationFacts,
} from "../profile.js";
import { ResumeSchema, type Job, type Resume } from "../schemas.js";
import { withoutDashes } from "../util/text.js";
import { parseEmails } from "./emailDraft.js";

/*
 * Ficha de candidatura: os campos que os formulários das plataformas (Gupy, InHire, Greenhouse,
 * Workday...) pedem de novo, um por um, prontos para copiar. Tudo sai do currículo (o adaptado para
 * a vaga, se houver pacote; senão o currículo-base no idioma da vaga). Nada novo, sem IA.
 */

export const SHEET_FILE = "ficha_de_candidatura.md";

export interface SheetField {
  label: string;
  value: string;
  /** Texto longo (resumo, descrição): mostra o tamanho, que muitos formulários limitam. */
  long?: boolean;
}

export interface SheetSection {
  title: string;
  fields: SheetField[];
}

export interface ApplicationSheet {
  language: "pt-BR" | "en";
  /** De onde vieram os campos: o currículo adaptado para a vaga ou o currículo-base. */
  from: "pacote" | "base";
  sections: SheetSection[];
}

/** Frases inteiras até `max` caracteres (sem cortar no meio de uma palavra). */
export function fitText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  // Fim de frase: pontuação seguida de espaço e letra maiúscula ("Node.js" e "10.5" não quebram).
  const sentences = clean.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9"“(])/u);
  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  const cut = clean.slice(0, max + 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[,;:\s]+$/, "");
}

const CURRENT = /^(atual|present|current|presente|hoje)$/i;

/** A ficha a partir de um currículo. */
export function sheetFromResume(resume: Resume, from: ApplicationSheet["from"] = "base"): ApplicationSheet {
  // O que vai para o formulário também sai sem travessão (soa como texto de IA).
  const r = withoutDashesResume(resume);
  const en = r.language === "en";
  const t = (pt: string, eng: string) => (en ? eng : pt);
  const f = (label: string, value: string | undefined, long = false): SheetField[] => (value && value.trim() ? [{ label, value: value.trim(), long }] : []);
  const [first, ...rest] = r.name.trim().split(/\s+/);
  const c = r.contact;
  const sections: SheetSection[] = [
    {
      title: t("Dados pessoais", "Personal details"),
      fields: [
        ...f(t("Nome completo", "Full name"), r.name),
        ...f(t("Nome", "First name"), first),
        ...f(t("Sobrenome", "Last name"), rest.join(" ")),
        ...f("E-mail", c.email),
        ...f(t("Telefone", "Phone"), c.phone),
        ...f(t("Telefone (só números)", "Phone (digits only)"), c.phone.replace(/\D/g, "")),
        ...f(t("Cidade", "Location"), c.location),
        ...f("LinkedIn", c.linkedin),
        ...f("GitHub", c.github),
        ...f(t("Portfólio / site", "Portfolio / website"), c.portfolio),
        ...f(t("Disponibilidade", "Availability"), c.availability),
      ],
    },
    {
      title: t("Resumo profissional", "Professional summary"),
      fields: [
        ...f(t("Título profissional", "Headline"), r.headline),
        ...f(t("Resumo curto (até 300 caracteres)", "Short summary (up to 300 characters)"), fitText(r.summary, 300), true),
        ...f(t("Resumo médio (até 600 caracteres)", "Medium summary (up to 600 characters)"), fitText(r.summary, 600), true),
        ...f(t("Resumo completo", "Full summary"), r.summary, true),
      ].filter((x, i, all) => all.findIndex((y) => y.value === x.value) === i),
    },
    ...r.experience.map((e) => ({
      title: `${t("Experiência", "Experience")}: ${e.title}, ${e.company}`,
      fields: [
        ...f(t("Cargo", "Job title"), e.title),
        ...f(t("Empresa", "Company"), e.company),
        ...f(t("Local", "Location"), e.location),
        ...f(t("Modalidade", "Work mode"), e.mode),
        ...f(t("Início", "Start date"), e.start),
        ...f(t("Fim", "End date"), CURRENT.test(e.end.trim()) ? "" : e.end),
        ...f(t("Trabalho aqui atualmente", "I currently work here"), CURRENT.test(e.end.trim()) ? t("Sim", "Yes") : t("Não", "No")),
        ...f(t("Descrição (atividades e resultados)", "Description (responsibilities and results)"), e.bullets.map((b) => `• ${b}`).join("\n"), true),
      ],
    })),
    ...(r.education.length
      ? [
          {
            title: t("Formação", "Education"),
            fields: r.education.flatMap((e) => f(e.degree, [e.institution, e.period].filter(Boolean).join(" · "))),
          },
        ]
      : []),
    ...(r.certifications.length
      ? [
          {
            title: t("Certificações e cursos", "Certifications and courses"),
            fields: r.certifications.flatMap((x) => f(x.name, [x.issuer, x.date].filter(Boolean).join(" · ") || x.name)),
          },
        ]
      : []),
    {
      title: t("Idiomas e competências", "Languages and skills"),
      fields: [
        ...f(t("Idiomas", "Languages"), r.languages),
        ...f(t("Competências (todas, separadas por vírgula)", "Skills (all, comma-separated)"), [...new Set(r.skills.flatMap((s) => s.items))].join(", "), true),
        ...r.skills.flatMap((s) => f(s.category, s.items.join(", "))),
      ],
    },
    ...(r.projects.length
      ? [
          {
            title: t("Projetos", "Projects"),
            fields: r.projects.flatMap((p) => f(p.name, [p.description, p.tech.length ? `${t("Tecnologias", "Tech")}: ${p.tech.join(", ")}` : "", p.url].filter(Boolean).join("\n"), true)),
          },
        ]
      : []),
  ];
  return { language: r.language, from, sections: sections.filter((s) => s.fields.length) };
}

/** O currículo da vaga: o do pacote (adaptado), senão o currículo-base no idioma da vaga. */
function resumeFor(job: Job): { resume: Resume; from: ApplicationSheet["from"] } {
  if (job.outputDir) {
    try {
      return { resume: ResumeSchema.parse(JSON.parse(fs.readFileSync(path.join(job.outputDir, "resume.json"), "utf8"))), from: "pacote" };
    } catch {
      /* pacote sem resume.json: usa o currículo-base */
    }
  }
  return { resume: loadBaseResume(job.triage?.jobLanguage === "en" ? "en" : "pt-BR"), from: "base" };
}

export function applicationSheet(job: Job): ApplicationSheet {
  const { resume, from } = resumeFor(job);
  // Pacotes antigos podem ter o cargo repetido em inglês: no formulário em português, só em português.
  const sheet = sheetFromResume(withoutDashesResume(withoutTranslatedTitles(resume, resume.language === "pt-BR" ? englishBase() : null)), from);
  const extra = extraSections(job, sheet.language === "en");
  return extra.length ? { ...sheet, sections: [...sheet.sections.slice(0, 2), ...extra, ...sheet.sections.slice(2)] } : sheet;
}

/**
 * O que os formulários pedem além do currículo: a mensagem curta do pacote (emails.md, item 6) e as
 * respostas fixas das Preferências (pretensão, disponibilidade, aviso prévio, mudança, visto).
 */
export function extraSections(job: Job, en: boolean, facts: ApplicationFacts = loadPreferences().applicationFacts): SheetSection[] {
  const out: SheetSection[] = [];
  const emails = job.outputDir && fs.existsSync(path.join(job.outputDir, "emails.md")) ? parseEmails(fs.readFileSync(path.join(job.outputDir, "emails.md"), "utf8")) : null;
  const note = emails?.sections.find((s) => /^6\./.test(s.title))?.message;
  if (note) out.push({ title: en ? "Short cover message" : "Mensagem de apresentação", fields: [{ label: en ? "Message (up to 600 characters)" : "Mensagem (até 600 caracteres)", value: withoutDashes(note), long: true }] });
  const answers = (Object.keys(APPLICATION_FACT_LABELS) as (keyof ApplicationFacts)[])
    .filter((k) => facts[k]?.trim())
    .map((k) => ({ label: APPLICATION_FACT_LABELS[k][en ? 1 : 0], value: facts[k].trim(), long: false }));
  if (answers.length) out.push({ title: en ? "Common questions" : "Perguntas frequentes", fields: answers });
  return out;
}

/** A ficha em Markdown (`ficha_de_candidatura.md` e terminal). */
export function sheetMarkdown(s: ApplicationSheet, title = "Ficha de candidatura"): string {
  const intro =
    s.language === "en"
      ? "> Fields that application forms ask for, ready to copy. They come from your resume: nothing new."
      : "> Campos que os formulários de candidatura pedem, prontos para copiar. Vêm do seu currículo: nada novo.";
  const body = s.sections
    .map((sec) => `## ${sec.title}\n\n${sec.fields.map((x) => (x.long || x.value.includes("\n") ? `**${x.label}** (${x.value.length} ${s.language === "en" ? "characters" : "caracteres"})\n\n${x.value}\n` : `- **${x.label}:** ${x.value}`)).join("\n")}`)
    .join("\n\n");
  return `# ${title}\n\n${intro}\n\n${body}\n`;
}

/** Grava a ficha na pasta do pacote. */
export function writeSheet(job: Job, dir: string): string {
  const file = path.join(dir, SHEET_FILE);
  fs.writeFileSync(file, sheetMarkdown(applicationSheet({ ...job, outputDir: dir }), `Ficha de candidatura: ${job.company}`));
  return file;
}
