// Preferências de busca: cargos, termos, filtros de título, regiões, fontes e notas mínimas.
import { $, action, api, app, btn, esc, formData, S, t, tagsField, toast } from "./core.js";

let data = null; // GET /api/preferences
let dirty = false;

export async function renderPrefsPage() {
  data = await api("/api/preferences");
  dirty = false;
  paint();
}

function section(title, text, inner) {
  return `<div class="panel"><h3>${title}</h3>${text ? `<p class="muted">${text}</p>` : ""}${inner}</div>`;
}
const tags = (label, name, values, help = "", placeholder) =>
  `<div class="field"><span>${label}</span>${help ? `<small>${help}</small>` : ""}${tagsField(name, values, placeholder)}</div>`;

function paint() {
  const p = data.prefs;
  const view = $("#view");
  view.innerHTML = `
  <header class="page-head"><div><h1>${t("Preferências")}</h1><p>${t("O que o agente procura, onde procura e o que ele descarta antes de gastar IA.")}</p></div></header>
  <form id="prefs" autocomplete="off">
    ${section(
      t("🎯 O que você procura"),
      "",
      `${tags(t("Cargos-alvo"), "targetRoles", p.targetRoles, t("A triagem compara cada vaga com estes cargos."))}
      <div class="grid2"><label class="field"><span>${t("Senioridade")}</span><input name="seniority" value="${esc(p.seniority)}"></label>
      <label class="field"><span>${t("Área")}</span><input name="area" value="${esc(p.area)}"></label></div>
      <div class="grid2"><label class="field"><span>${t("País onde mora")}</span><input name="country" value="${esc(p.country)}"></label>
      <label class="field"><span>${t("Fuso horário")}</span><input name="timezone" value="${esc(p.timezone)}"></label></div>`,
    )}
    ${section(
      t("🔎 Como buscar"),
      "",
      `${tags(t("Termos de busca"), "queries", p.queries, t("Cada termo vira uma busca nas fontes de vagas. Para a Gupy e os sites do Brasil, inclua termos em português (ex.: “analista de dados”); para as fontes internacionais, em inglês."))}
      <div class="field"><span>${t("Fontes de vagas")}</span><div class="source-grid">${data.sources
        .map(
          (s) => `<label class="source-opt"><input type="checkbox" name="defaultSources" data-list value="${esc(s.id)}"${p.defaultSources.includes(s.id) ? " checked" : ""}><span><b>${esc(s.id)}</b><br><small class="muted">${esc(t(s.description))}</small></span></label>`,
        )
        .join("")}</div></div>
      <label class="switch"><input type="checkbox" name="webSearchByDefault"${p.webSearchByDefault ? " checked" : ""}><span>${t("Buscar também na web com IA por padrão")}<small>${t("LinkedIn, Gupy, Indeed e sites de empresas. Mais vagas no Brasil, mas é mais lento e usa mais a IA.")}${S.webSearch ? "" : ` ${t("A IA escolhida não faz busca na web.")}`}</small></span></label>
      <label class="field"><span>${t("Dica para a busca na web")}</span><small>${t("Em uma ou duas frases: que vagas priorizar.")}</small><textarea name="webSearchHints" rows="3">${esc(p.webSearchHints)}</textarea></label>
      <label class="field"><span>${t("Ignorar vagas publicadas há mais de (dias)")}</span><input type="number" name="maxAgeDays" min="1" max="365" value="${esc(p.maxAgeDays)}"></label>`,
    )}
    ${section(
      t("🧹 Filtro pelo título"),
      t("Corta vagas sem gastar IA. Sem acento e em minúsculas funciona melhor."),
      `${tags(t("O título precisa ter pelo menos um destes"), "titleMustInclude", p.titleMustInclude, t("Vazio aceita qualquer título."))}
      ${tags(t("O título não pode ter"), "titleExclude", p.titleExclude, t("Ex.: senioridades que você não quer, tecnologias fora do seu foco."))}`,
    )}
    ${section(
      t("📍 Onde"),
      "",
      `${tags(t("Regiões aceitas em vagas remotas com restrição"), "acceptedRegions", p.acceptedRegions, t("Ex.: brasil, latam, worldwide."))}
      ${tags(t("Cidades onde aceita presencial ou híbrido"), "onsiteCities", p.onsiteCities, t("Vazio = só remoto."))}`,
    )}
    ${section(
      t("🏢 Empresas"),
      "",
      `${tags(t("Empresas que você não quer"), "excludedCompanies", p.excludedCompanies)}
      <div class="grid2">${tags("Greenhouse", "greenhouse", p.companyBoards.greenhouse, t("Empresas para monitorar (nome na URL do Greenhouse)."))}
      ${tags("Lever", "lever", p.companyBoards.lever, t("Nome na URL do Lever."))}</div>
      ${tags("Ashby", "ashby", p.companyBoards.ashby, t("Nome na URL do Ashby."))}`,
    )}
    ${section(
      t("⭐ Notas mínimas"),
      "",
      `<div class="field"><span>${t("Triagem mínima para o piloto automático gerar pacote")}</span>
        <div class="range"><input type="range" name="minTriageScore" min="0" max="100" step="5" value="${data.minTriageScore}"><output>${data.minTriageScore}</output></div></div>
      <div class="field"><span>${t("Nota mínima do currículo para “pronto para enviar”")}</span>
        <div class="range"><input type="range" name="minRating" min="0" max="10" step="0.5" value="${data.minRating}"><output>${data.minRating}</output></div></div>`,
    )}
    <div id="prefs-save"></div>
  </form>`;
  const form = $("#prefs");
  const mark = (e) => {
    if (e.target.type === "range") e.target.nextElementSibling.textContent = e.target.value;
    if (!dirty) {
      dirty = true;
      $("#prefs-save").innerHTML = `<div class="save-bar"><span>${t("Alterações não salvas")}</span><div class="btn-row">${btn("prefs-discard", t("Descartar"), null, "ghost small")}${btn("prefs-save", t("Salvar"), null, "primary small")}</div></div>`;
    }
  };
  form.addEventListener("input", mark);
  form.addEventListener("change", mark);
  form.addEventListener("submit", (e) => e.preventDefault());
}

action("prefs-save", async () => {
  const f = formData($("#prefs"));
  await api(
    "/api/preferences",
    {
      ...f,
      companyBoards: { greenhouse: f.greenhouse, lever: f.lever, ashby: f.ashby },
      maxAgeDays: Number(f.maxAgeDays),
      minRating: Number(f.minRating),
      minTriageScore: Number(f.minTriageScore),
    },
    "PUT",
  );
  toast(t("Preferências salvas. Valem a partir da próxima busca."));
  await app.refresh();
  await renderPrefsPage();
});
action("prefs-discard", () => renderPrefsPage());

window.addEventListener("beforeunload", (e) => {
  if (dirty) e.preventDefault();
});
