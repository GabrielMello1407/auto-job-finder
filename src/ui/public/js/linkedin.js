// Plano de LinkedIn: headline, Sobre em PT/EN, competências, destaques e Open to Work.
import { $, action, api, app, btn, esc, link, md, on, S, toast } from "./core.js";

let plan = null;
const running = () => S.tasks.find((t) => t.kind === "linkedin" && (t.status === "queued" || t.status === "running"));

export async function renderLinkedinPage() {
  plan = (await api("/api/linkedin")).plan;
  paint();
}

function paint() {
  const view = $("#view");
  const busy = running();
  view.innerHTML = `
  <header class="page-head"><div><h1>LinkedIn</h1><p>Um plano para o seu perfil atrair recrutadores das vagas que você quer, só com fatos do seu perfil.</p></div></header>
  <div class="panel">
    <h3>Gerar um plano novo</h3>
    <p class="muted">Opcional: cole o texto atual do seu LinkedIn (headline, Sobre, experiências) para o agente achar o que está inconsistente com o seu perfil.</p>
    <label class="field"><span>Seu LinkedIn hoje <small>(opcional)</small></span><textarea id="li-current" rows="6" placeholder="Cole aqui o texto do seu perfil…"></textarea></label>
    <div class="btn-row" style="margin-top:14px">${
      busy ? `<span class="busy"><span class="spin"></span>${busy.status === "running" ? "Escrevendo o plano…" : "Na fila…"}</span>` : btn("li-generate", "✨ Gerar plano", null, "primary")
    }</div>
    <p class="faint" style="margin-top:10px">O agente nunca muda o seu LinkedIn: você copia e cola o que quiser.</p>
  </div>
  ${
    plan
      ? `<div class="section-title"><h2>Plano de ${new Date(plan.date).toLocaleDateString("pt-BR")}</h2>${link(plan.file, "Abrir arquivo", "small")}</div><div class="panel md">${md(plan.markdown)}</div>`
      : `<div class="empty"><div class="big">🔗</div><p>Você ainda não gerou um plano.</p></div>`
  }`;
}

action("li-generate", async () => {
  await api("/api/linkedin", { current: $("#li-current")?.value ?? "" });
  toast("✨ Escrevendo o plano de LinkedIn. Leva alguns minutos.");
  await app.refresh();
  paint();
});

on("task-finished", (t) => {
  if (t.kind === "linkedin" && location.hash.startsWith("#/linkedin")) renderLinkedinPage();
});
