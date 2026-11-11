// LinkedIn: conferência do perfil atual (o que está certo, o que falta do plano, o que corrigir) e plano.
import { $, action, api, app, btn, esc, link, md, on, S, t, toast, uploadFile } from "./core.js";
import { dateText, getLang } from "./i18n.js";

let data = null; // GET /api/linkedin
let currentText = ""; // o LinkedIn de hoje, enviado em PDF ou colado
const running = (kind) => S.tasks.find((k) => k.kind === kind && (k.status === "queued" || k.status === "running"));
const day = (iso) => dateText(iso);
const chars = (n) => t("{n} caracteres", { n: n.toLocaleString(getLang()) });
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
  <header class="page-head"><div><h1>LinkedIn</h1><p>${t("Um plano para o seu perfil atrair recrutadores das vagas que você quer, e a conferência do que já está certo. Só com fatos do seu perfil.")}</p></div></header>
  <div class="panel">
    <h3>${t("Seu LinkedIn hoje")}</h3>
    <p class="muted">${t("O agente não acessa o LinkedIn. Para ele conferir, mande o PDF do seu perfil (no LinkedIn: <strong>Mais → Salvar como PDF</strong>) ou cole o texto.")}</p>
    <div class="btn-row" style="margin-top:12px">
      <label class="btn small">${t("📄 Enviar o PDF do LinkedIn")}<input type="file" id="li-file" accept=".pdf,.txt,.md" hidden></label>
      <span class="faint" id="li-chars">${currentText ? esc(chars(currentText.length)) : ""}</span>
    </div>
    <textarea id="li-current" rows="6" placeholder="${esc(t("…ou cole aqui o texto do seu perfil: headline, Sobre, experiências, competências"))}" style="margin-top:10px">${esc(currentText)}</textarea>
    <div class="btn-row" style="margin-top:14px">${
      busy
        ? `<span class="busy"><span class="spin"></span>${busy.status !== "running" ? t("Na fila…") : busy.kind === "linkedin" ? t("Escrevendo o plano…") : t("Conferindo o seu LinkedIn…")}</span>`
        : `${btn("li-check", t("✅ Conferir meu LinkedIn"), null, "primary")}${btn("li-generate", t("✨ Gerar plano novo"))}`
    }</div>
    <p class="faint" style="margin-top:10px">${t("Conferir é rápido: mostra o que já está certo, o que do plano ainda falta e o que corrigir. O plano novo reescreve tudo. O agente nunca muda o seu LinkedIn: você copia e cola o que quiser.")}</p>
  </div>
  ${
    check
      ? `<div class="section-title"><h2>${t("✅ Conferência de {date}", { date: day(check.date) })}</h2><span class="btn-row">${checkOld ? `<span class="chip warn">${t("feita antes do plano atual")}</span>` : ""}${link(check.file, t("Abrir arquivo"), "small")}</span></div>
        <div class="panel md">${body(check.markdown)}</div>`
      : ""
  }
  ${
    plan
      ? `<div class="section-title"><h2>${t("✨ Plano de {date}", { date: day(plan.date) })}</h2>${link(plan.file, t("Abrir arquivo"), "small")}</div>
        ${data.planOutdated ? `<div class="banner"><span>${t("⚠️ O seu perfil mudou depois deste plano. Gere um plano novo para ele usar as novidades.")}</span>${btn("li-generate", t("✨ Gerar plano novo"), null, "small primary")}</div>` : ""}
        <details class="panel md"${check ? "" : " open"}><summary>${t("Ver o plano")}</summary>${body(plan.markdown)}</details>`
      : `<div class="empty"><div class="big">🔗</div><p>${t("Você ainda não gerou um plano.")}</p></div>`
  }
  ${
    others.length
      ? `<details class="panel"><summary>${t("Histórico ({n})", { n: others.length })}</summary><ul class="history">${others
          .map((h) => `<li>${h.kind === "plano" ? t("✨ Plano de {date}", { date: day(h.date) }) : t("✅ Conferência de {date}", { date: day(h.date) })} ${link(h.file, t("abrir"), "small ghost")}</li>`)
          .join("")}</ul></details>`
      : ""
  }`;

  $("#li-current").addEventListener("input", (e) => {
    currentText = e.target.value;
    $("#li-chars").textContent = currentText ? chars(currentText.length) : "";
  });
  $("#li-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      toast(t("Lendo {file}…", { file: file.name }));
      currentText = (await uploadFile("/api/linkedin/upload", file)).text;
      paint();
      toast(t("✅ PDF lido. Agora é só conferir."));
    } catch (err) {
      toast(err.message, "bad");
    }
  });
}

action("li-check", async () => {
  if (currentText.trim().length < 200) return toast(t("Mande o PDF do seu LinkedIn ou cole o texto do perfil primeiro."), "bad");
  await api("/api/linkedin/check", { current: currentText });
  toast(t("✅ Conferindo o seu LinkedIn."));
  await app.refresh();
  paint();
});

action("li-generate", async () => {
  await api("/api/linkedin", { current: currentText });
  toast(currentText ? t("✨ Escrevendo o plano novo com o seu LinkedIn atual.") : t("✨ Escrevendo o plano. Sem o seu LinkedIn atual, as inconsistências serão só o que conferir."));
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
on("task-finished", (task) => {
  if ((task.kind === "linkedin" || task.kind === "linkedin-check") && location.hash.startsWith("#/linkedin")) renderLinkedinPage();
});
