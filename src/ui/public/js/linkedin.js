// LinkedIn: conferência do perfil atual (o que está certo, o que falta do plano, o que corrigir) e plano.
import { $, action, api, app, btn, esc, link, md, on, S, toast, uploadFile } from "./core.js";

let data = null; // GET /api/linkedin
let currentText = ""; // o LinkedIn de hoje, enviado em PDF ou colado
const running = (kind) => S.tasks.find((t) => t.kind === kind && (t.status === "queued" || t.status === "running"));
const day = (iso) => new Date(iso).toLocaleDateString("pt-BR");
/** O título do arquivo (# ...) já aparece no cabeçalho da seção. */
const body = (markdown) => md(markdown.replace(/^# .*\r?\n/, ""));

export async function renderLinkedinPage() {
  data = await api("/api/linkedin");
  paint();
}

function paint() {
  const view = $("#view");
  if (!view || !data) return;
  const busy = running("linkedin-check") ?? running("linkedin");
  const { plan, check } = data;
  const checkOld = check && plan && Date.parse(check.date) < Date.parse(plan.date);
  const others = data.history.filter((h) => h.file !== plan?.file && h.file !== check?.file);

  view.innerHTML = `
  <header class="page-head"><div><h1>LinkedIn</h1><p>Um plano para o seu perfil atrair recrutadores das vagas que você quer, e a conferência do que já está certo. Só com fatos do seu perfil.</p></div></header>
  <div class="panel">
    <h3>Seu LinkedIn hoje</h3>
    <p class="muted">O agente não acessa o LinkedIn. Para ele conferir, mande o PDF do seu perfil (no LinkedIn: <strong>Mais → Salvar como PDF</strong>) ou cole o texto.</p>
    <div class="btn-row" style="margin-top:12px">
      <label class="btn small">📄 Enviar o PDF do LinkedIn<input type="file" id="li-file" accept=".pdf,.txt,.md" hidden></label>
      <span class="faint" id="li-chars">${currentText ? `${currentText.length.toLocaleString("pt-BR")} caracteres` : ""}</span>
    </div>
    <textarea id="li-current" rows="6" placeholder="…ou cole aqui o texto do seu perfil: headline, Sobre, experiências, competências" style="margin-top:10px">${esc(currentText)}</textarea>
    <div class="btn-row" style="margin-top:14px">${
      busy
        ? `<span class="busy"><span class="spin"></span>${busy.status === "running" ? (busy.kind === "linkedin" ? "Escrevendo o plano…" : "Conferindo o seu LinkedIn…") : "Na fila…"}</span>`
        : `${btn("li-check", "✅ Conferir meu LinkedIn", null, "primary")}${btn("li-generate", "✨ Gerar plano novo")}`
    }</div>
    <p class="faint" style="margin-top:10px">Conferir é rápido: mostra o que já está certo, o que do plano ainda falta e o que corrigir. O plano novo reescreve tudo. O agente nunca muda o seu LinkedIn: você copia e cola o que quiser.</p>
  </div>
  ${
    check
      ? `<div class="section-title"><h2>✅ Conferência de ${day(check.date)}</h2><span class="btn-row">${checkOld ? `<span class="chip warn">feita antes do plano atual</span>` : ""}${link(check.file, "Abrir arquivo", "small")}</span></div>
        <div class="panel md">${body(check.markdown)}</div>`
      : ""
  }
  ${
    plan
      ? `<div class="section-title"><h2>✨ Plano de ${day(plan.date)}</h2>${link(plan.file, "Abrir arquivo", "small")}</div>
        ${data.planOutdated ? `<div class="banner"><span>⚠️ O seu perfil mudou depois deste plano. Gere um plano novo para ele usar as novidades.</span>${btn("li-generate", "✨ Gerar plano novo", null, "small primary")}</div>` : ""}
        <details class="panel md"${check ? "" : " open"}><summary>Ver o plano</summary>${body(plan.markdown)}</details>`
      : `<div class="empty"><div class="big">🔗</div><p>Você ainda não gerou um plano.</p></div>`
  }
  ${
    others.length
      ? `<details class="panel"><summary>Histórico (${others.length})</summary><ul class="history">${others
          .map((h) => `<li>${h.kind === "plano" ? "✨ Plano" : "✅ Conferência"} de ${day(h.date)} ${link(h.file, "abrir", "small ghost")}</li>`)
          .join("")}</ul></details>`
      : ""
  }`;

  $("#li-current").addEventListener("input", (e) => {
    currentText = e.target.value;
    $("#li-chars").textContent = currentText ? `${currentText.length.toLocaleString("pt-BR")} caracteres` : "";
  });
  $("#li-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      toast(`Lendo ${file.name}…`);
      currentText = (await uploadFile("/api/linkedin/upload", file)).text;
      paint();
      toast("✅ PDF lido. Agora é só conferir.");
    } catch (err) {
      toast(err.message, "bad");
    }
  });
}

action("li-check", async () => {
  if (currentText.trim().length < 200) return toast("Mande o PDF do seu LinkedIn ou cole o texto do perfil primeiro.", "bad");
  await api("/api/linkedin/check", { current: currentText });
  toast("✅ Conferindo o seu LinkedIn.");
  await app.refresh();
  paint();
});

action("li-generate", async () => {
  await api("/api/linkedin", { current: currentText });
  toast(currentText ? "✨ Escrevendo o plano novo com o seu LinkedIn atual." : "✨ Escrevendo o plano. Sem o seu LinkedIn atual, as inconsistências serão só o que conferir.");
  await app.refresh();
  paint();
});

on("tasks", () => {
  if (location.hash.startsWith("#/linkedin") && $("#li-current")) {
    // Atualiza só o estado dos botões (sem perder o texto digitado).
    const busy = Boolean(running("linkedin-check") ?? running("linkedin"));
    const hasButtons = Boolean($('[data-act="li-check"]'));
    if (busy === hasButtons) paint();
  }
});
on("task-finished", (t) => {
  if ((t.kind === "linkedin" || t.kind === "linkedin-check") && location.hash.startsWith("#/linkedin")) renderLinkedinPage();
});
