// Ponto de entrada: rotas, estado ao vivo (SSE), painel de tarefas, paleta de comandos (Ctrl+K) e escolha da IA.
import { $, $$, ACTIONS, action, api, app, btn, closeModal, emit, esc, modal, modalOpen, norm, on, S, t, toast } from "./core.js";
import { getLang, LANGS, saveLang } from "./i18n.js";
import { busyChanged, closeDrawer, countIn, drawerOpen, jobsKeydown, paintJobs, paletteJobs, reloadDrawer, renderJobsPage, STAGES } from "./jobs.js";
import { loadProfile, paintWizard, renderProfilePage, renderWizard } from "./profile.js";
import { renderPrefsPage } from "./prefs.js";
import { renderLinkedinPage } from "./linkedin.js";
import { refreshResults, renderResultsPage } from "./results.js";

/* ===================================================================== rotas */

const ROUTES = {
  vagas: renderJobsPage,
  resultados: renderResultsPage,
  perfil: renderProfilePage,
  comecar: renderWizard,
  preferencias: renderPrefsPage,
  linkedin: renderLinkedinPage,
};
let currentRoute = null;

function routeName() {
  const r = location.hash.replace(/^#\/?/, "") || "vagas";
  // Sem perfil, tudo leva ao cadastro (e a URL fica nele, para mostrar "Perfil pronto" no fim).
  if (!S.hasProfile) {
    if (r !== "comecar") history.replaceState(null, "", "#/comecar");
    return "comecar";
  }
  return ROUTES[r] ? r : "vagas";
}

async function showRoute() {
  const r = routeName();
  currentRoute = r;
  closeDrawer();
  const navRoute = r === "comecar" ? "perfil" : r;
  $$("#nav a").forEach((a) => (a.dataset.route === navRoute ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  try {
    await ROUTES[r]();
  } catch (e) {
    $("#view").innerHTML = `<div class="empty"><div class="big">⚠️</div><p>${esc(e.message)}</p></div>`;
  }
  window.scrollTo({ top: 0 });
}

app.go = (route) => {
  if (location.hash === `#/${route}`) showRoute();
  else location.hash = `#/${route}`;
};
action("go", (_id, route) => app.go(route));
window.addEventListener("hashchange", showRoute);

/* ===================================================================== estado */

app.refresh = async () => {
  const hadProfile = S.hasProfile;
  Object.assign(S, await api("/api/state"));
  paintChrome();
  if (hadProfile !== S.hasProfile || (currentRoute === "comecar" && routeName() !== "comecar")) return showRoute();
  if (currentRoute === "vagas") paintJobs();
  if (currentRoute === "resultados") await refreshResults();
  if (currentRoute === "comecar") paintWizard();
  if (drawerOpen()) await reloadDrawer();
};

function paintChrome() {
  const chip = $("#ia-chip");
  $("#ia-label").textContent = S.provider?.label ? t(S.provider.label).replace(/\s*\(.*\)\s*$/, "") : t("Escolher a IA");
  chip.classList.toggle("warn", !S.provider?.active);
  chip.title = S.provider?.error || t("Trocar a IA");
  const ready = S.hasProfile ? countIn("ready") : 0;
  const pill = $("#nav-vagas");
  pill.hidden = !ready;
  pill.textContent = ready;
  pill.title = t("{n} pronta(s) para enviar", { n: ready });
  paintDock();
}

/* ============================================================ painel de tarefas */

let dockOpen = false;
const seen = new Map();

function paintDock() {
  const root = $("#dock-root");
  const tasks = S.tasks;
  if (!tasks.length) return (root.innerHTML = "");
  const running = tasks.find((k) => k.status === "running");
  const queued = tasks.filter((k) => k.status === "queued");
  const finished = tasks.filter((k) => k.status === "done" || k.status === "error").reverse();
  const head = running
    ? `<span class="spin"></span><div class="txt"><b>${esc(running.label)}</b><span>${esc(running.log[running.log.length - 1] ?? t("Começando…"))}</span></div>`
    : queued.length
      ? `<span class="spin"></span><div class="txt"><b>${esc(t("{n} na fila", { n: queued.length }))}</b><span>${esc(t("Começando…"))}</span></div>`
      : `<span class="done-dot${finished[0]?.status === "error" ? " err" : ""}">${finished[0]?.status === "error" ? "✕" : "✓"}</span><div class="txt"><b>${esc(finished[0].label)}</b><span>${esc(finished[0].status === "error" ? finished[0].error : finished[0].result ?? t("concluído"))}</span></div>`;
  const extra = queued.length && running ? `<span class="chip">+${queued.length}</span>` : "";
  let body = "";
  if (dockOpen) {
    if (running) body += `<pre class="log" id="dock-log">${esc(running.log.join("\n"))}</pre>`;
    body += queued.map((k) => `<div class="dock-row"><span class="faint">⏳</span><span class="txt">${esc(k.label)}</span>${btn("unqueue", t("Tirar"), k.id, "ghost small")}</div>`).join("");
    body += finished
      .map(
        (k) => `<div class="dock-row ${k.status}"><span class="done-dot${k.status === "error" ? " err" : ""}">${k.status === "error" ? "✕" : "✓"}</span><span class="txt"><b>${esc(k.label)}</b> · ${esc(k.status === "error" ? k.error : k.result ?? t("concluído"))}</span></div>`,
      )
      .join("");
    if (finished.length && !running) body += `<div class="btn-row" style="justify-content:flex-end">${btn("clear-tasks", t("Limpar"), null, "ghost small")}</div>`;
  }
  root.innerHTML = `<section class="dock" aria-live="polite" aria-label="${esc(t("Tarefas"))}"><div class="dock-head" data-act="dock" data-nolock role="button" tabindex="0" aria-expanded="${dockOpen}">${head}${extra}<span class="faint">${dockOpen ? "▾" : "▴"}</span></div>${
    body ? `<div class="dock-body">${body}</div>` : ""
  }</section>`;
  const log = $("#dock-log");
  if (log) log.scrollTop = log.scrollHeight;
}

action("dock", () => {
  dockOpen = !dockOpen;
  paintDock();
});
action("unqueue", (id) => api(`/api/tasks/${id}`, undefined, "DELETE"));
action("clear-tasks", async () => {
  await api("/api/tasks/clear", {});
  dockOpen = false;
});

function onTasks(list) {
  for (const task of list) {
    const before = seen.get(task.id);
    if (before && before !== task.status && (task.status === "done" || task.status === "error")) {
      if (task.status === "done") toast(`✅ ${task.label}: ${task.result ?? t("concluído")}`);
      else toast(`❌ ${task.label}: ${task.error}`, "bad");
      emit("task-finished", task);
    }
    seen.set(task.id, task.status);
  }
  S.tasks = list;
  paintDock();
  if (currentRoute === "vagas" && busyChanged()) paintJobs();
  emit("tasks", list);
}

function connect() {
  const es = new EventSource("/api/events");
  es.addEventListener("open", () => ($("#offline").hidden = true));
  es.addEventListener("tasks", (e) => onTasks(JSON.parse(e.data)));
  es.addEventListener("jobs", () => app.refresh().catch(() => {}));
  es.addEventListener("profile", () => emit("profile"));
  es.addEventListener("bye", () => {
    es.close();
    $("#offline").hidden = false;
  });
  es.addEventListener("error", () => ($("#offline").hidden = false));
}

/* ==================================================================== IA */

action("ia", async () => {
  const [p, doc] = await Promise.all([api("/api/providers"), api("/api/doctor")]);
  const usable = p.providers.filter((x) => x.ready);
  const r = await modal({
    title: t("Qual IA o agente deve usar?"),
    wide: true,
    html: `${p.error ? `<p class="chip warn" style="height:auto;padding:8px 12px">${esc(p.error)}</p>` : ""}
      ${p.providers
        .map(
          (x) => `<label class="option${x.ready ? "" : " off"}"><input type="radio" name="id" value="${esc(x.id)}"${x.id === p.active ? " checked" : ""}${x.ready ? "" : " disabled"}>
          <span><b>${esc(x.label)}</b><br><small class="muted">${esc(x.kind === "assinatura" ? t("Usa sua assinatura, sem custo extra") : t("Paga por uso"))}${x.webSearch ? "" : esc(t(" · sem busca na web"))} · ${esc(x.ready ? x.detail : x.setup)}</small></span></label>`,
        )
        .join("")}
      ${usable.length ? "" : `<p class="muted" style="margin-top:12px">${esc(t("Nenhuma IA pronta nesta máquina. Siga a instrução de uma delas e abra esta janela de novo."))}</p>`}
      ${p.active ? `<div class="btn-row" style="margin-top:12px"><button type="button" class="small" id="ia-test">${esc(t("⚡ Testar se a IA em uso responde"))}</button><span class="muted" id="ia-test-out"></span></div>` : ""}
      <details class="panel" style="margin-top:16px"><summary>${esc(t("Diagnóstico"))}</summary>
        <p>${doc.chrome ? "✅" : "❌"} ${esc(t("Chrome/Edge para gerar PDF:"))} ${doc.chrome ? `<code>${esc(doc.chrome)}</code>` : esc(t("não encontrado, defina CHROME_PATH no .env"))}</p>
        <p style="margin-top:6px">${esc(t("Pasta de trabalho:"))} <code>${esc(doc.home)}</code></p>
        <ul style="margin:6px 0 0;padding:0;list-style:none;display:grid;gap:2px">${doc.files.map((f) => `<li>${f.ok ? "✅" : "❌"} ${esc(f.name)}</li>`).join("")}</ul>
        <p class="muted" style="margin-top:6px">${esc(t("Meta do currículo {target} · nota mínima {min} · triagem mínima {triage} · até {revisions} revisões", { target: doc.settings.targetRating, min: doc.settings.minRating, triage: doc.settings.minTriageScore, revisions: doc.settings.maxRevisions }))}</p>
      </details>`,
    confirm: usable.length ? t("Usar esta") : "",
    cancel: t("Fechar"),
    onOpen: (form) => {
      const test = form.querySelector("#ia-test");
      if (!test) return;
      test.onclick = async () => {
        const out = form.querySelector("#ia-test-out");
        test.disabled = true;
        out.textContent = t("perguntando…");
        try {
          const res = await api("/api/providers/test", {});
          out.textContent = `✅ ${t("respondeu em {s} s", { s: getLang() === "pt-BR" ? String(res.seconds).replace(".", ",") : res.seconds })}`;
        } catch (e) {
          out.textContent = `❌ ${e.message}`;
        } finally {
          test.disabled = false;
        }
      };
    },
  });
  if (!r?.id || r.id === p.active) return;
  await api("/api/providers", { id: r.id });
  toast(t("🤖 IA trocada."));
  await app.refresh();
});

/* ======================================================= paleta de comandos */

const COMMANDS = [
  { ico: "🔎", text: t("Buscar vagas novas"), run: () => ACTIONS.search() },
  { ico: "🚀", text: t("Piloto automático"), sub: t("buscar, avaliar e gerar pacotes"), run: () => ACTIONS.auto() },
  { ico: "➕", text: t("Colar uma vaga"), run: () => ACTIONS.paste() },
  { ico: "🧠", text: t("Avaliar vagas novas"), when: () => S.jobs.some((j) => j.status === "new"), run: () => ACTIONS.triage() },
  {
    ico: "🔒",
    text: t("Conferir se as vagas ainda estão abertas"),
    sub: t("marca as encerradas antes de você gastar tempo com elas"),
    when: () => S.jobs.some((j) => ["new", "triaged", "shortlisted", "tailored", "low_fit"].includes(j.status)),
    run: () => ACTIONS["check-open"](),
  },
  ...STAGES.map((s) => ({
    ico: "💼",
    text: t("Ver: {stage}", { stage: s.label }),
    sub: s.sub,
    run: () => {
      ACTIONS.stage(undefined, s.id);
      app.go("vagas");
    },
  })),
  { ico: "📊", text: t("Resultados das candidaturas"), sub: t("o que está funcionando"), run: () => app.go("resultados") },
  { ico: "🪪", text: t("Abrir meu perfil"), run: () => app.go("perfil") },
  {
    ico: "🔢",
    text: t("Números que faltam no currículo"),
    sub: t("resultados sem número"),
    run: () => {
      app.go("perfil");
      setTimeout(() => $("#numbers")?.scrollIntoView({ block: "start", behavior: "smooth" }), 400);
    },
  },
  { ico: "🆕", text: t("Atualizar o perfil com uma novidade"), sub: t("projeto, emprego, curso"), run: () => ACTIONS["update-news"]() },
  { ico: "✅", text: t("Conferir meu LinkedIn"), run: () => app.go("linkedin") },
  { ico: "🎯", text: t("Preferências de busca"), run: () => app.go("preferencias") },
  { ico: "🔗", text: t("Plano de LinkedIn"), run: () => app.go("linkedin") },
  { ico: "📄", text: t("Gerar PDFs do currículo-base"), run: () => ACTIONS["render-base"]() },
  { ico: "🤖", text: t("Trocar a IA"), always: true, run: () => ACTIONS.ia() },
  { ico: "🌐", text: t("Mudar o idioma da interface"), sub: Object.values(LANGS).join(" · "), always: true, run: () => ACTIONS.language() },
];

let palette = null;

function paletteItems(query) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const cmds = COMMANDS.filter((c) => (!c.when || c.when()) && (S.hasProfile || c.always || c.ico === "🪪" || c.ico === "🆕"))
    .filter((c) => words.every((w) => norm(`${c.text} ${c.sub ?? ""}`).includes(w)))
    .map((c) => ({ ...c, group: t("Ações") }));
  return [...(S.hasProfile ? paletteJobs(query) : []), ...cmds].slice(0, 30);
}

function openPalette() {
  if (palette) return;
  closeModal();
  palette = { items: paletteItems(""), sel: 0 };
  $("#palette-root").innerHTML = `<div class="palette" data-palette-close><div class="palette-box" role="dialog" aria-modal="true" aria-label="${esc(t("Paleta de comandos"))}">
    <input class="palette-input" id="palette-q" placeholder="${esc(t("Digite uma empresa, uma vaga ou uma ação…"))}" autocomplete="off" aria-controls="palette-list">
    <div class="palette-list" id="palette-list" role="listbox"></div>
    <div class="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> ${esc(t("navegar"))}</span><span><kbd>Enter</kbd> ${esc(t("escolher"))}</span><span><kbd>Esc</kbd> ${esc(t("fechar"))}</span></div></div></div>`;
  const q = $("#palette-q");
  q.addEventListener("input", () => {
    palette.items = paletteItems(q.value);
    palette.sel = 0;
    paintPalette();
  });
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = palette.items.length;
      if (n) palette.sel = (palette.sel + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      paintPalette();
    } else if (e.key === "Enter") {
      e.preventDefault();
      runPalette(palette.sel);
    }
  });
  $(".palette").addEventListener("mousedown", (e) => {
    if (e.target.hasAttribute("data-palette-close")) closePalette();
  });
  paintPalette();
  q.focus();
}

function paintPalette() {
  const list = $("#palette-list");
  if (!list) return;
  let group = "";
  list.innerHTML = palette.items.length
    ? palette.items
        .map((it, i) => {
          const head = it.group !== group ? `<div class="palette-group">${esc((group = it.group))}</div>` : "";
          return `${head}<div class="palette-item" role="option" data-index="${i}" aria-selected="${i === palette.sel}"><span class="ico">${it.ico}</span><span class="txt">${esc(it.text)}${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span></div>`;
        })
        .join("")
    : `<div class="palette-group">${esc(t("Nada encontrado"))}</div>`;
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  list.querySelectorAll(".palette-item").forEach((el) => {
    el.addEventListener("mousemove", () => {
      if (palette.sel === Number(el.dataset.index)) return;
      palette.sel = Number(el.dataset.index);
      list.querySelectorAll(".palette-item").forEach((x) => x.setAttribute("aria-selected", String(x === el)));
    });
    el.addEventListener("click", () => runPalette(Number(el.dataset.index)));
  });
}

function closePalette() {
  palette = null;
  $("#palette-root").innerHTML = "";
}

async function runPalette(i) {
  const it = palette?.items[i];
  closePalette();
  if (!it) return;
  try {
    await it.run();
  } catch (e) {
    toast(e.message, "bad");
  }
}
action("palette", () => openPalette());

/* ================================================================== teclado */

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    return palette ? closePalette() : openPalette();
  }
  if (e.key === "Escape") {
    if (palette) return closePalette();
    if (modalOpen()) return closeModal();
    if (drawerOpen()) return closeDrawer();
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "") || document.activeElement?.isContentEditable;
  if (typing || palette || modalOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "/" && currentRoute === "vagas") {
    e.preventDefault();
    $("#filter")?.focus();
    return;
  }
  if (currentRoute === "vagas" && !drawerOpen() && jobsKeydown(e)) e.preventDefault();
});
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.('[role="button"][data-act]')) {
    e.preventDefault();
    e.target.click();
  }
});

/* ==================================================================== idioma */

/** Textos fixos do index.html: o português do HTML é a chave. */
function translateStatic() {
  for (const el of $$("[data-i18n]")) el.textContent = t(el.textContent.trim());
  for (const el of $$("[data-i18n-html]")) el.innerHTML = t(el.innerHTML.trim()); // texto fixo do nosso HTML, não vem de fora
  for (const el of $$("[data-i18n-label]")) el.setAttribute("aria-label", t(el.dataset.i18nLabel));
  const chip = $("#lang-chip");
  chip.textContent = `🌐 ${LANGS[getLang()]}`;
  chip.title = t("Mudar o idioma da interface");
}

action("language", async () => {
  const r = await modal({
    title: t("Idioma da interface"),
    html: `<p class="muted">${esc(t("Currículos, cartas e e-mails continuam saindo no idioma de cada vaga."))}</p>
      <div class="via-grid">${Object.entries(LANGS)
        .map(([code, name]) => `<label class="option"><input type="radio" name="lang" value="${esc(code)}"${code === getLang() ? " checked" : ""}><span>${esc(name)}</span></label>`)
        .join("")}</div>`,
    confirm: t("Usar este idioma"),
  });
  if (!r?.lang || r.lang === getLang()) return;
  saveLang(r.lang);
  location.reload();
});

/* ===================================================================== início */

(async () => {
  translateStatic();
  try {
    Object.assign(S, await api("/api/state"));
    for (const task of S.tasks) seen.set(task.id, task.status);
    paintChrome();
    await loadProfile().catch(() => {});
    await showRoute();
    connect();
  } catch (e) {
    $("#view").innerHTML = `<div class="empty"><div class="big">⚠️</div><p>${esc(e.message)}</p></div>`;
    $("#offline").hidden = false;
  }
})();
