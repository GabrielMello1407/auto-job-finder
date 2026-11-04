import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ensureDir, paths, settings } from "./config.js";
import { loadJobs } from "./jobs/store.js";
import type { Job } from "./schemas.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fileLink = (p: string | undefined, label: string) =>
  p && fs.existsSync(p) ? `<a href="${pathToFileURL(p).href}">${label}</a>` : "";
const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "");

function pkgLinks(j: Job): string {
  const dir = j.outputDir;
  return [
    fileLink(j.files?.resume, "📄 Currículo"),
    fileLink(j.files?.coverLetter, "✉️ Cover letter"),
    dir && fileLink(path.join(dir, "emails.md"), "📧 E-mails"),
    dir && fileLink(path.join(dir, "LEIA-ME.md"), "📋 LEIA-ME"),
    dir && fileLink(path.join(dir, "interview_prep.md"), "🎤 Entrevista"),
    `<a href="${esc(j.applyUrl ?? j.url)}" target="_blank" rel="noopener">🔗 Vaga</a>`,
  ]
    .filter(Boolean)
    .join(" ");
}

function badge(n: number | undefined, good: number, warn: number, suffix = "") {
  if (n == null) return "";
  const cls = n >= good ? "ok" : n >= warn ? "warn" : "bad";
  return `<span class="badge ${cls}">${n}${suffix}</span>`;
}

function table(jobs: Job[], cols: ("score" | "rating" | "ats" | "applied" | "links" | "reason")[]): string {
  if (!jobs.length) return `<p class="empty">Nada aqui por enquanto.</p>`;
  const head: Record<string, string> = { score: "Triagem", rating: "Nota", ats: "ATS", applied: "Enviada", links: "Arquivos", reason: "Motivo" };
  return `<div class="scroll"><table><thead><tr><th>Vaga</th>${cols.map((c) => `<th>${head[c]}</th>`).join("")}</tr></thead><tbody>
${jobs
  .map(
    (j) => `<tr><td><strong>${esc(j.title)}</strong><br><span class="muted">${esc(j.company)} · ${esc(j.location || "")} · ${esc(
      j.triage?.market ?? "",
    )} · <code>${j.id}</code></span></td>${cols
      .map((c) => {
        if (c === "score") return `<td>${badge(j.triage?.score, settings.minTriageScore, 50)}</td>`;
        if (c === "rating") return `<td>${badge(j.rating, settings.minRating, 5)}</td>`;
        if (c === "ats") return `<td>${badge(j.atsScore, 80, 60, "%")}</td>`;
        if (c === "applied") return `<td>${date(j.appliedAt)}</td>`;
        if (c === "reason") return `<td class="muted">${esc(j.triage?.reason ?? "")}</td>`;
        return `<td class="links">${j.outputDir ? pkgLinks(j) : `<a href="${esc(j.applyUrl ?? j.url)}" target="_blank" rel="noopener">🔗 Vaga</a>`}</td>`;
      })
      .join("")}</tr>`,
  )
  .join("\n")}
</tbody></table></div>`;
}

/** Gera output/painel.html com o estado de todas as vagas. Abre direto no navegador (sem servidor). */
export function writeDashboard(): string {
  const jobs = loadJobs();
  const by = (...s: Job["status"][]) => jobs.filter((j) => s.includes(j.status));
  const byScore = (a: Job, b: Job) => (b.triage?.score ?? 0) - (a.triage?.score ?? 0);
  const byRating = (a: Job, b: Job) => (b.rating ?? 0) - (a.rating ?? 0);

  const ready = by("tailored").sort(byRating);
  const recommended = by("shortlisted").sort(byScore);
  const active = by("applied", "interview", "offer").sort((a, b) => (b.appliedAt ?? "").localeCompare(a.appliedAt ?? ""));
  const lowFit = by("low_fit").sort(byRating);
  const maybe = by("triaged").sort(byScore);
  const fresh = by("new");

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Painel de Vagas</title>
<style>
:root { --bg:#f7f7f5; --card:#fff; --fg:#1b1b1b; --muted:#6b6b6b; --line:#e4e4e0; --accent:#2457d6; --ok:#1f7a3f; --okbg:#e3f4e8; --warn:#8a5a00; --warnbg:#fdf1d6; --bad:#a02626; --badbg:#fbe3e3; }
@media (prefers-color-scheme: dark) { :root { --bg:#141414; --card:#1d1d1d; --fg:#ececec; --muted:#9a9a9a; --line:#2e2e2e; --accent:#7ea2ff; --ok:#7fd69b; --okbg:#18301f; --warn:#f0c46a; --warnbg:#332812; --bad:#f19a9a; --badbg:#3a1b1b; } }
* { box-sizing:border-box } body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif }
main { max-width:1200px; margin:0 auto; padding:24px 16px 64px }
h1 { margin:0 0 4px; font-size:26px } h2 { margin:32px 0 10px; font-size:18px }
.muted { color:var(--muted); font-size:13px } .empty { color:var(--muted) }
.stats { display:flex; flex-wrap:wrap; gap:10px; margin:16px 0 } .stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 14px; min-width:120px }
.stat b { display:block; font-size:22px }
.scroll { overflow-x:auto; background:var(--card); border:1px solid var(--line); border-radius:10px }
table { width:100%; border-collapse:collapse } th,td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:top }
th { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted) } tr:last-child td { border-bottom:0 }
a { color:var(--accent); text-decoration:none } a:hover { text-decoration:underline } .links a { margin-right:10px; white-space:nowrap }
.badge { display:inline-block; min-width:36px; text-align:center; padding:2px 8px; border-radius:999px; font-weight:600; font-size:13px }
.ok { color:var(--ok); background:var(--okbg) } .warn { color:var(--warn); background:var(--warnbg) } .bad { color:var(--bad); background:var(--badbg) }
details summary { cursor:pointer; margin:28px 0 10px; font-weight:600 } code { font-size:12px }
.tip { background:var(--card); border:1px solid var(--line); border-left:4px solid var(--accent); border-radius:8px; padding:10px 14px; margin-top:12px }
</style></head><body><main>
<h1>Painel de Vagas</h1>
<div class="muted">Atualizado em ${new Date().toLocaleString("pt-BR")} · nota mínima ${settings.minRating} · triagem mínima ${settings.minTriageScore}</div>
<div class="stats">
<div class="stat"><b>${ready.length}</b>prontos para enviar</div>
<div class="stat"><b>${recommended.length}</b>recomendadas sem pacote</div>
<div class="stat"><b>${active.length}</b>em andamento</div>
<div class="stat"><b>${fresh.length}</b>aguardando triagem</div>
</div>
<div class="tip">Para gerar pacotes, enviar ou atualizar status, rode <code>ajf</code> no terminal e use o menu.</div>

<h2>✅ Prontos para enviar (nota ≥ ${settings.minRating})</h2>
${table(ready, ["rating", "ats", "links"])}

<h2>⭐ Recomendadas pela triagem, ainda sem pacote</h2>
${table(recommended, ["score", "reason", "links"])}

<h2>📨 Em andamento</h2>
${table(active, ["rating", "applied", "links"])}

<details><summary>⚠️ Pacotes com baixa aderência (${lowFit.length})</summary>${table(lowFit, ["rating", "links"])}</details>
<details><summary>🤔 Avaliadas — decidir (${maybe.length})</summary>${table(maybe, ["score", "reason", "links"])}</details>
</main></body></html>`;

  ensureDir(paths.outputDir);
  const file = path.join(paths.outputDir, "painel.html");
  fs.writeFileSync(file, html);
  return file;
}
