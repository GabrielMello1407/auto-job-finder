import { withoutDashesResume } from "../profile.js";
import type { CoverLetter, Resume } from "../schemas.js";
import { withoutDashes } from "../util/text.js";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const LABELS = {
  "pt-BR": {
    summary: "RESUMO PROFISSIONAL",
    skills: "COMPETÊNCIAS",
    experience: "EXPERIÊNCIA PROFISSIONAL",
    projects: "PROJETOS",
    education: "FORMAÇÃO ACADÊMICA",
    certifications: "CERTIFICAÇÕES",
    languages: "IDIOMAS",
    portfolio: "Portfólio",
    tech: "Ferramentas",
  },
  en: {
    summary: "PROFESSIONAL SUMMARY",
    skills: "SKILLS",
    experience: "PROFESSIONAL EXPERIENCE",
    projects: "PROJECTS",
    education: "EDUCATION",
    certifications: "CERTIFICATIONS",
    languages: "LANGUAGES",
    portfolio: "Portfolio",
    tech: "Tools",
  },
} as const;

function href(url: string): string {
  return /^https?:\/\//.test(url) ? url : url.includes("@") ? `mailto:${url}` : `https://${url}`;
}

function link(text: string): string {
  return `<a href="${esc(href(text))}">${esc(text)}</a>`;
}

/**
 * Modelo clássico de currículo ATS:
 * uma coluna, Arial/Helvetica, títulos em caixa alta com filete, bullets justificados.
 * Tudo é texto real (selecionável), sem tabelas nem imagens — amigável para ATS.
 */
const BASE_CSS = (paper: "A4" | "Letter") => `
@page { size: ${paper}; margin: 15mm 17mm 14mm 17mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; }
body { margin: 0; font-family: Arial, "Liberation Sans", Helvetica, sans-serif; font-size: 9.6pt; line-height: 1.32; color: #111; }
a { color: inherit; text-decoration: none; }
h1 { font-size: 22pt; margin: 0 0 3pt; letter-spacing: -0.2pt; }
.headline { font-weight: 700; font-size: 11pt; margin: 0 0 4pt; }
.contact { font-size: 8.8pt; margin: 0 0 8pt; color: #222; }
h2 { font-size: 10.6pt; font-weight: 700; margin: 9pt 0 5pt; padding-bottom: 2pt; border-bottom: 1.3pt solid #111; letter-spacing: 0.1pt; }
p { margin: 0 0 3pt; text-align: justify; }
ul { margin: 2pt 0 5pt; padding-left: 13pt; }
li { margin: 0 0 2.2pt; text-align: justify; }
.skills p { text-align: left; margin-bottom: 2pt; }
.job { break-inside: avoid-page; margin-bottom: 4pt; }
.job-title { font-weight: 700; font-size: 10pt; margin: 6pt 0 1pt; }
.job-meta { font-size: 8.8pt; color: #222; margin: 0 0 2pt; }
.edu-title { font-weight: 700; margin: 4pt 0 1pt; }
.small { font-size: 9pt; }
`;

export function resumeHtml(resume: Resume, paper: "A4" | "Letter"): string {
  // Última garantia: o PDF nunca sai com travessão, nem de um resume.json editado à mão ou antigo.
  const r = withoutDashesResume(resume);
  const L = LABELS[r.language];
  const c = r.contact;
  const contactParts = [
    esc(c.location),
    c.email && link(c.email),
    c.phone && esc(c.phone),
    c.linkedin && link(c.linkedin),
    c.github && link(c.github),
    c.portfolio && `${L.portfolio}: ${link(c.portfolio)}`,
    c.availability && esc(c.availability),
  ].filter(Boolean);

  // Data desconhecida fica de fora: nada de "– Atual" solto ou de um traço sozinho.
  const period = (start: string, end: string) => [start, end].map((d) => d?.trim()).filter(Boolean).join(" - ");

  const skills = r.skills
    .map((g) => `<p><strong>${esc(g.category)}:</strong> ${esc(g.items.join(", "))}</p>`)
    .join("\n");

  const experience = r.experience
    .map((e) => {
      const meta = [e.company, e.location, e.mode, period(e.start, e.end)].filter(Boolean).map(esc).join(" | ");
      return `<div class="job">
  <div class="job-title">${esc(e.title)}</div>
  <div class="job-meta">${meta}</div>
  <ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
</div>`;
    })
    .join("\n");

  const projects = r.projects.length
    ? `<h2>${L.projects}</h2>
<ul>${r.projects
        .map(
          (p) =>
            `<li><strong>${esc(p.name)}</strong>: ${esc(p.description)}${
              p.tech.length ? ` ${L.tech}: ${esc(p.tech.join(", "))}.` : ""
            }${p.url ? ` ${link(p.url)}` : ""}</li>`,
        )
        .join("")}</ul>`
    : "";

  // Igual ao modelo: curso com período vira bloco (título + instituição); sem período, linha simples.
  const education = r.education
    .map((e) =>
      e.period
        ? `<div class="edu-title">${esc(e.degree)}</div><div class="job-meta">${esc(`${e.institution} | ${e.period}`)}</div>`
        : `<div class="job-meta" style="margin-top:3pt">${esc([e.degree, e.institution].filter(Boolean).join(", "))}</div>`,
    )
    .join("\n");

  const certs = r.certifications.length
    ? `<h2>${L.certifications}</h2>
<ul>${r.certifications
        .map((c) => `<li>${esc([c.name, c.issuer].filter((x) => x?.trim()).join(", "))}${c.date?.trim() ? ` (${esc(c.date)})` : ""}</li>`)
        .join("")}</ul>`
    : "";

  return `<!doctype html>
<html lang="${r.language}">
<head><meta charset="utf-8"><title>${esc(r.name)} | ${esc(r.headline)}</title>
<style>${BASE_CSS(paper)}</style></head>
<body>
<h1>${esc(r.name)}</h1>
<div class="headline">${esc(r.headline)}</div>
<div class="contact">${contactParts.join(" | ")}</div>

<h2>${L.summary}</h2>
<p>${esc(r.summary)}</p>

<h2>${L.skills}</h2>
<div class="skills">${skills}</div>

<h2>${L.experience}</h2>
${experience}

${projects}

<h2>${L.education}</h2>
${education}

${certs}

<h2>${L.languages}</h2>
<p class="small">${esc(r.languages)}</p>
</body></html>`;
}

/** Carta de apresentação / cover letter com o mesmo cabeçalho do currículo. */
/** Carta sem travessão como pontuação (soa como texto de IA). */
export function withoutDashesLetter(l: CoverLetter): CoverLetter {
  return {
    subjectLine: withoutDashes(l.subjectLine, "subject"),
    greeting: withoutDashes(l.greeting),
    paragraphs: l.paragraphs.map((p) => withoutDashes(p)),
    closing: withoutDashes(l.closing),
  };
}

export function coverLetterHtml(
  resume: Resume,
  coverLetter: CoverLetter,
  opts: { company: string; paper: "A4" | "Letter"; date: string },
): string {
  const r = withoutDashesResume(resume);
  const letter = withoutDashesLetter(coverLetter);
  const c = r.contact;
  const contact = [esc(c.location), c.email && link(c.email), c.phone && esc(c.phone), c.linkedin && link(c.linkedin), c.portfolio && link(c.portfolio)]
    .filter(Boolean)
    .join(" | ");
  return `<!doctype html>
<html lang="${r.language}">
<head><meta charset="utf-8"><title>${esc(r.name)} | Cover Letter</title>
<style>${BASE_CSS(opts.paper)}
@page { margin: 20mm 22mm; }
body { font-size: 10.5pt; line-height: 1.45; }
.letter p { margin: 0 0 9pt; }
.meta { margin: 14pt 0 12pt; }
</style></head>
<body>
<h1>${esc(r.name)}</h1>
<div class="headline">${esc(r.headline)}</div>
<div class="contact" style="border-bottom:1.3pt solid #111;padding-bottom:6pt">${contact}</div>
<div class="meta">${esc(opts.date)}<br>${esc(opts.company)}<br><strong>${esc(letter.subjectLine)}</strong></div>
<div class="letter">
<p>${esc(letter.greeting)}</p>
${letter.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("\n")}
<p>${esc(letter.closing)}<br>${esc(r.name)}</p>
</div>
</body></html>`;
}

/** Texto puro do currículo, como um ATS leria. Usado no relatório de palavras-chave. */
export function resumePlainText(r: Resume): string {
  return [
    r.name,
    r.headline,
    r.summary,
    ...r.skills.map((g) => `${g.category}: ${g.items.join(", ")}`),
    ...r.experience.flatMap((e) => [e.title, e.company, ...e.bullets]),
    ...r.projects.map((p) => `${p.name} ${p.description} ${p.tech.join(" ")}`),
    ...r.education.map((e) => `${e.degree} ${e.institution}`),
    ...r.certifications.map((c) => `${c.name} ${c.issuer}`),
    r.languages,
  ].join("\n");
}
