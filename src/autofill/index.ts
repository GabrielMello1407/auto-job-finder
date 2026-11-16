import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyKit } from "../jobs/applyQueue.js";
import { englishBase, loadPreferences, withoutDashesResume, withoutTranslatedTitles, type ApplicationFacts, type AutofillPrefs } from "../profile.js";
import type { Job, Resume } from "../schemas.js";
import { withoutDashes } from "../util/text.js";
import { resumeFor } from "../writers/applicationSheet.js";

/**
 * Preencher formulários com um clique: um favorito do navegador (bookmarklet.js) que preenche os campos de
 * um formulário de candidatura com os dados que a pessoa copia no ajf. Os dados só saem do ajf quando a
 * pessoa copia e cola; o favorito não faz requisição, não anexa arquivos e nunca envia o formulário.
 * Começa desligado (preferences.autofill).
 */

type Lang = "pt-BR" | "en";

/** Fim de experiência que quer dizer "trabalho aqui atualmente". */
const CURRENT = /^(atual|present|current|presente|hoje|o momento)$/i;

/** Os dados que o favorito usa, só dos grupos ligados. Puro. */
export function autofillData(
  resume: Resume,
  opts: { company: string; note?: string | null; facts: ApplicationFacts; groups: Omit<AutofillPrefs, "enabled">; lang: Lang },
): Record<string, string | number> {
  const r = withoutDashesResume(resume);
  const c = r.contact;
  const g = opts.groups;
  const [first, ...rest] = r.name.trim().split(/\s+/);
  const now = r.experience.find((e) => CURRENT.test(e.end.trim()));
  const pick = (on: boolean, values: Record<string, string | undefined>) => (on ? Object.entries(values).filter((e): e is [string, string] => Boolean(e[1]?.trim())) : []);
  // Formulários costumam validar o link: "linkedin.com/in/x" vira "https://linkedin.com/in/x".
  const url = (s: string) => (s.trim() && !/^https?:\/\//i.test(s.trim()) ? `https://${s.trim()}` : s);
  return {
    ajf: 1,
    lang: opts.lang,
    company: opts.company,
    ...Object.fromEntries([
      ...pick(g.contact, { fullName: r.name, firstName: first, lastName: rest.join(" "), email: c.email, phone: c.phone }),
      ...pick(g.links, { linkedin: url(c.linkedin), github: url(c.github), portfolio: url(c.portfolio) }),
      ...pick(g.location, { location: c.location }),
      ...pick(g.current, { currentCompany: now?.company, currentTitle: now?.title }),
      ...pick(g.message, { message: opts.note ? withoutDashes(opts.note) : undefined }),
      ...pick(g.facts, {
        salary: opts.facts.salaryExpectation,
        availability: opts.facts.availability,
        notice: opts.facts.noticePeriod,
        relocation: opts.facts.relocation,
        workAuthorization: opts.facts.workAuthorization,
      }),
    ].map(([k, v]) => [k, v.trim()])),
  };
}

/** O texto que a pessoa copia no ajf e cola no favorito: o currículo da vaga (do pacote, se houver). */
export function autofillText(job: Job, lang: Lang, prefs = loadPreferences()): string {
  const { resume } = resumeFor(job);
  const clean = withoutTranslatedTitles(resume, resume.language === "pt-BR" ? englishBase() : null);
  const { enabled: _enabled, ...groups } = prefs.autofill;
  return JSON.stringify(autofillData(clean, { company: job.company, note: applyKit(job).note, facts: prefs.applicationFacts, groups, lang }));
}

const SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "bookmarklet.js");

/** Tira as linhas de comentário e a indentação. O código do favorito não tem comentário no fim da linha. */
export function compactScript(src: string): string {
  return src
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .join("\n");
}

/** O link do favorito (javascript:...). Sempre o mesmo, sem nenhum dado da pessoa. */
export function bookmarkletHref(src = fs.readFileSync(SOURCE, "utf8")): string {
  return `javascript:${encodeURIComponent(`(function(){${compactScript(src)}\nAJF_FILL.run();})();`)}`;
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Página para quem usa só o terminal (`ajf preencher --favorito`): o botão para arrastar e o código. */
export function bookmarkletPage(href = bookmarkletHref()): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Favorito: Preencher com ajf</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:680px;margin:40px auto;padding:0 16px;color:#1b1b1b}a.fav{display:inline-block;padding:10px 16px;border-radius:8px;background:#5b4ee0;color:#fff;font-weight:600;text-decoration:none}textarea{width:100%;height:120px;font:12px ui-monospace,monospace}@media (prefers-color-scheme:dark){body{background:#141414;color:#ececec}}</style></head>
<body><h1>🪄 Preencher com ajf</h1>
<ol><li>Mostre a barra de favoritos (Ctrl+Shift+B no Chrome e no Edge, Cmd+Shift+B no Mac).</li>
<li>Arraste este botão para a barra: <a class="fav" href="${escHtml(href)}" onclick="event.preventDefault();alert('Arraste o botão para a barra de favoritos.')">🪄 Preencher com ajf</a></li>
<li>Não dá para arrastar? Crie um favorito qualquer, edite e cole o código abaixo no lugar do endereço.</li></ol>
<textarea readonly onclick="this.select()">${escHtml(href)}</textarea>
<p>Para usar: rode <code>ajf preencher &lt;empresa&gt;</code>, copie a linha que aparece, abra o formulário da vaga, clique no favorito e cole. Ele preenche só os campos vazios que reconhece, não anexa arquivos e nunca envia o formulário: confira tudo e envie você.</p>
</body></html>
`;
}
