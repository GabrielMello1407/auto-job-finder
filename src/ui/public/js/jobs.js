// Página de vagas: funil de etapas, cartões, gaveta de detalhes e as ações de cada vaga.
import { $, $$, action, api, app, btn, copy, daysSince, esc, link, md, modal, mono, norm, plural, ring, level, S, store, toast } from "./core.js";

export const STAGES = [
  {
    id: "decide", cls: "s-decide", label: "Para decidir", sub: "achadas pela busca", statuses: ["shortlisted", "triaged", "new"],
    hint: "A IA já avaliou cada vaga contra o seu perfil. Gere o pacote das que valem a pena.",
    empty: ["🔎", "Nenhuma vaga para avaliar agora.", ["search", "🔎 Buscar vagas"]],
  },
  {
    id: "ready", cls: "s-ready", label: "Prontas", sub: "pacote pronto", statuses: ["tailored"],
    hint: "Confira o currículo, candidate-se no site da vaga e marque “Já me candidatei”.",
    empty: ["📦", "Nenhum pacote pronto. Gere um em “Para decidir”.", ["stage:decide", "Ver vagas para decidir"]],
  },
  {
    id: "active", cls: "s-active", label: "Em andamento", sub: "candidaturas enviadas", statuses: ["applied", "interview", "offer"],
    hint: "Atualize quando chamarem para entrevista ou responderem. O follow-up aparece depois de 7 dias.",
    empty: ["📨", "Você ainda não marcou nenhuma candidatura como enviada."],
  },
  {
    id: "low", cls: "s-low", label: "Baixa aderência", sub: "nota abaixo do mínimo", statuses: ["low_fit"],
    hint: "Pacotes com nota abaixo do mínimo. Não é recomendado enviar, mas a decisão é sua.",
    empty: ["✨", "Nada aqui."],
  },
  {
    id: "closed", cls: "s-closed", label: "Encerradas", sub: "recusadas e descartadas", statuses: ["rejected", "discarded"],
    hint: "Recusadas e descartadas. Dá para reabrir qualquer uma.",
    empty: ["🗄", "Nada aqui."],
  },
];
export const stageOf = (status) => STAGES.find((s) => s.statuses.includes(status));
export const jobTask = (id) => S.tasks.find((t) => t.jobId === id && (t.status === "queued" || t.status === "running"));
export const findJob = (id) => S.jobs.find((j) => j.id === id);
const salary = (s) => (s && !/n[aã]o informad|not (specified|disclosed)/i.test(s) ? s : "");
const SENDABLE = ["tailored", "low_fit", "shortlisted", "triaged", "new"];

let stage = store.get("ajf.stage");
let filterText = "";
let cursor = -1;

/* ------------------------------------------------------------------- cartão */

function gauges(j) {
  const t = j.triage;
  return `<div class="gauges">${ring("Triagem", t?.score, 100, t ? level(t.score, S.settings.minTriageScore, 50) : "")}${ring(
    "Nota",
    j.rating,
    10,
    j.rating != null ? level(j.rating, S.settings.minRating, 5) : "",
    j.rating != null ? String(j.rating).replace(".", ",") : "",
  )}${ring("ATS", j.atsScore, 100, j.atsScore != null ? level(j.atsScore, 80, 60) : "", j.atsScore != null ? `${j.atsScore}` : "")}</div>`;
}

function meta(j) {
  const parts = [j.location, j.triage?.market, salary(j.salary)].filter(Boolean).map(esc);
  const flags = j.triage?.scam?.length ? `<span class="chip bad" title="${esc(j.triage.scam.join("; "))}">🚩 sinais de golpe</span>` : "";
  const fresh = j.status === "new" ? `<span class="chip accent">nova · sem triagem</span>` : "";
  const outdated = j.pkg?.outdated ? `<span class="chip warn" title="O seu perfil mudou depois que este pacote foi gerado. Gere de novo para usar as novidades.">perfil mudou depois</span>` : "";
  const research = j.research ? researchChip(j.research) : "";
  return `<div class="job-meta"><strong>${esc(j.company)}</strong>${parts.map((p) => `<span class="sep">·</span>${p}`).join("")}${flags}${research}${duplicateChip(j)}${reopenedChip(j)}${closedChip(j)}${fresh}${outdated}</div>`;
}

/* Vaga repetida (a mesma vaga em outro site) e vaga encerrada (a página diz que acabou). */
const CHECKABLE = ["new", "triaged", "shortlisted", "tailored", "low_fit"];
const original = (j) => (j.duplicateOf ? findJob(j.duplicateOf) : null);
function duplicateChip(j) {
  const o = original(j);
  return o ? `<span class="chip warn" title="${esc(`Parece a mesma vaga que ${o.company} — ${o.title} (${stageOf(o.status)?.label ?? o.statusLabel})`)}">🔁 repetida</span>` : "";
}
const SENT_STATUSES = ["applied", "interview", "offer", "rejected"];
const reopenedFrom = (j) => (j.reopenedFrom ? findJob(j.reopenedFrom) : null);
const reopenedText = (o) =>
  `${SENT_STATUSES.includes(o.status) ? "Você se candidatou a uma vaga igual" : "Você gerou um pacote para uma vaga igual"} em ${new Date(o.appliedAt ?? o.addedAt).toLocaleDateString("pt-BR")}`;
function reopenedChip(j) {
  const o = reopenedFrom(j);
  return o ? `<span class="chip accent" title="${esc(`${reopenedText(o)} (${o.company} — ${o.title}). Foi há tempo: conta como vaga nova.`)}">📨 vaga reaberta</span>` : "";
}
const isClosed = (j) => j.openCheck?.verdict === "encerrada" && (CHECKABLE.includes(j.status) || j.status === "discarded");
const closedChip = (j) => (isClosed(j) ? `<span class="chip bad" title="${esc(j.openCheck.reason)}">🔒 vaga encerrada</span>` : "");
const OPEN_TEXT = { aberta: ["ok", "✓ aberta"], encerrada: ["bad", "🔒 parece encerrada"], sem_confirmacao: ["", "sem confirmação"] };

const RESEARCH = {
  confirmada: ["ok", "✓ vaga confirmada na web", "O agente achou o anúncio oficial desta vaga."],
  nao_encontrada: ["", "não achada na web", "O agente não achou o anúncio oficial. A vaga segue com o que foi informado."],
  suspeita: ["bad", "🚩 vaga suspeita", "A pesquisa na web achou sinais de golpe. Veja os detalhes."],
};
function researchChip(r) {
  const [cls, text, title] = RESEARCH[r.verdict] ?? RESEARCH.nao_encontrada;
  return `<span class="chip ${cls}" title="${esc(title)}">${text}</span>`;
}

function statusLine(j) {
  const d = daysSince(j.appliedAt);
  if (j.status === "applied") {
    const when = d == null ? "Enviada" : d === 0 ? "Enviada hoje" : `Enviada há ${plural(d, "dia", "dias")}`;
    const late = d != null && d >= 7;
    return `<div class="status-line"><span class="chip ${late ? "warn" : "accent"}">${late ? "⏰ hora do follow-up" : "📨 aguardando resposta"}</span><span>${when}${j.appliedViaLabel ? ` via ${esc(j.appliedViaLabel)}` : ""}${j.notes ? ` · ${esc(j.notes)}` : ""}</span></div>`;
  }
  if (j.status === "interview") return `<div class="status-line"><span class="chip accent">🎤 em entrevista</span></div>`;
  if (j.status === "offer") return `<div class="status-line"><span class="chip ok">🎉 oferta recebida</span></div>`;
  if (j.status === "rejected") return `<div class="status-line"><span class="chip">recusada</span></div>`;
  if (j.status === "discarded") return `<div class="status-line"><span class="chip">descartada</span></div>`;
  return "";
}

export function actionsFor(j) {
  const task = jobTask(j.id);
  if (task) {
    const what =
      { tailor: "Gerando o pacote…", interview: "Preparando o guia de entrevista…", triage: "A IA está avaliando…", research: "Pesquisando na web…", render: "Gerando o PDF…", check: "Conferindo se está aberta…" }[task.kind] ??
      "Trabalhando…";
    return `<span class="busy"><span class="spin"></span>${task.status === "running" ? what : "Na fila…"}</span>`;
  }
  const pdf = (label = "📄 Currículo") => link(j.pkg?.resume, label);
  const A = [];
  switch (j.status) {
    case "new":
    case "triaged":
    case "shortlisted":
      A.push(
        isClosed(j)
          ? btn("tailor-anyway", "📦 Gerar mesmo assim", j.id, "", "A página da vaga diz que ela acabou. Confira o link antes.")
          : btn("tailor", "📦 Gerar pacote", j.id, "primary", ""),
        link(j.url, "🔗 Ver vaga"),
        btn("applied", "✅ Já me candidatei", j.id),
        btn("discard", "Descartar", j.id, "ghost danger"),
      );
      break;
    case "tailored":
      A.push(j.url ? link(j.url, "🔗 Candidatar-se", "primary") : "", pdf(), j.pkg?.cover ? link(j.pkg.cover, "✉️ Carta") : "");
      if (j.pkg?.emails) A.push(btn("open:emails", "📧 E-mails", j.id));
      A.push(btn("open:ficha", "📋 Ficha", j.id, "", "Os campos do formulário de candidatura, prontos para copiar"));
      A.push(btn("applied", "✅ Já me candidatei", j.id, j.url ? "" : "primary"));
      if (j.pkg?.outdated) A.push(btn("tailor", "🔄 Gerar de novo", j.id, "", "O seu perfil mudou depois deste pacote"));
      A.push(btn("discard", "Descartar", j.id, "ghost danger"));
      break;
    case "low_fit":
      A.push(btn("open:pacote", "🔍 Por que a nota baixa?", j.id), pdf(), btn("tailor", "🔄 Gerar de novo", j.id), btn("applied", "✅ Me candidatei assim mesmo", j.id), btn("discard", "Descartar", j.id, "ghost danger"));
      break;
    case "applied":
      A.push(btn("interview", "🎤 Fui chamado para entrevista", j.id, "primary"));
      if (j.pkg?.emails) A.push(btn("open:emails", "📧 Follow-up", j.id));
      A.push(pdf("📄 Currículo enviado"), btn("status:rejected", "Fui recusado", j.id, "ghost danger"));
      break;
    case "interview":
      A.push(j.pkg?.interview ? btn("open:entrevista", "🎤 Guia de entrevista", j.id, "primary") : btn("guide", "🎤 Gerar guia de entrevista", j.id, "primary"));
      if (j.pkg?.emails) A.push(btn("open:emails", "🙏 Agradecimento", j.id));
      A.push(btn("status:offer", "🎉 Recebi oferta", j.id), btn("status:rejected", "Fui recusado", j.id, "ghost danger"));
      break;
    case "offer":
      A.push(pdf("📄 Currículo enviado"), btn("status:rejected", "Não deu certo", j.id, "ghost"));
      break;
    default:
      A.push(btn("reopen", "↩ Reabrir", j.id), link(j.url, "🔗 Ver vaga"));
  }
  return A.filter(Boolean).join("");
}

function card(j, i) {
  const showReason = j.triage?.reason && !["applied", "interview", "offer"].includes(j.status);
  return `<article class="job" tabindex="0" data-job="${esc(j.id)}" data-index="${i}" style="animation-delay:${Math.min(i, 12) * 18}ms">
  ${mono(j.company)}
  <div>
    ${meta(j)}
    <button type="button" class="job-title" data-act="open" data-id="${esc(j.id)}">${esc(j.title)}</button>
    ${statusLine(j)}
    ${showReason ? `<p class="job-reason">${esc(j.triage.reason)}</p>` : ""}
    <div class="job-actions">${actionsFor(j)}</div>
  </div>
  ${gauges(j)}
</article>`;
}

/* -------------------------------------------------------------------- página */

function sorted(st, jobs) {
  const score = (j) => j.triage?.score ?? -1;
  const rank = { shortlisted: 0, triaged: 1, new: 2 };
  const by = {
    decide: (a, b) => rank[a.status] - rank[b.status] || score(b) - score(a),
    ready: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
    active: (a, b) => String(b.appliedAt ?? "").localeCompare(String(a.appliedAt ?? "")),
    low: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
    closed: (a, b) => String(b.addedAt ?? "").localeCompare(String(a.addedAt ?? "")),
  }[st.id];
  return [...jobs].sort(by);
}

function visible(st) {
  const words = norm(filterText).split(/\s+/).filter(Boolean);
  const jobs = S.jobs.filter((j) => st.statuses.includes(j.status));
  return sorted(st, words.length ? jobs.filter((j) => words.every((w) => norm(`${j.company} ${j.title}`).includes(w))) : jobs);
}

export const countIn = (id) => S.jobs.filter((j) => STAGES.find((s) => s.id === id).statuses.includes(j.status)).length;

function current() {
  if (!STAGES.some((s) => s.id === stage)) stage = countIn("ready") ? "ready" : "decide";
  return STAGES.find((s) => s.id === stage);
}

export function renderJobsPage() {
  const view = $("#view");
  view.innerHTML = `
  <header class="page-head">
    <div><h1>Vagas</h1><p id="jobs-summary"></p></div>
    <div class="btn-row">
      ${btn("paste", "➕ Colar vaga")}
      ${btn("search", "🔎 Buscar vagas")}
      ${btn("auto", "🚀 Piloto automático", null, "primary")}
    </div>
  </header>
  <div class="pipeline" id="pipeline" role="tablist" aria-label="Etapas"></div>
  <div class="toolbar">
    <label class="search"><input id="filter" type="search" placeholder="Filtrar por empresa ou cargo" autocomplete="off" aria-label="Filtrar vagas" value="${esc(filterText)}"><kbd>/</kbd></label>
    <p class="hint" id="stage-hint"></p>
  </div>
  <div id="jobs" class="jobs"></div>`;
  $("#filter").addEventListener("input", (e) => {
    filterText = e.target.value;
    paintList();
  });
  animateNext = true;
  paintJobs();
}

export function paintJobs() {
  if (!$("#pipeline")) return;
  const st = current();
  const ready = countIn("ready");
  const active = countIn("active");
  $("#jobs-summary").textContent = ready
    ? `${plural(ready, "pacote pronto", "pacotes prontos")} para enviar · ${active} em andamento`
    : `${countIn("decide")} para decidir · ${active} em andamento`;
  $("#pipeline").innerHTML = STAGES.map(
    (s) => `<button type="button" class="stage ${s.cls}" role="tab" aria-selected="${s.id === st.id}" data-act="stage:${s.id}" data-nolock>
      <span class="label"><i></i>${s.label}</span><span class="count">${countIn(s.id)}</span><span class="sub">${s.sub}</span><span class="bar"></span></button>`,
  ).join("");
  $("#stage-hint").textContent = st.id === "low" ? st.hint.replace("mínimo", `mínimo (${S.settings.minRating})`) : st.hint;
  paintList();
}

let busyKey = "";
const currentBusyKey = () =>
  S.tasks
    .filter((t) => t.status === "queued" || t.status === "running")
    .map((t) => `${t.kind}:${t.jobId ?? ""}:${t.status}`)
    .join("|");
export const busyChanged = () => currentBusyKey() !== busyKey;

function paintList() {
  const box = $("#jobs");
  if (!box) return;
  const st = current();
  const jobs = visible(st);
  let html = "";
  if (st.id === "decide") {
    const fresh = S.jobs.filter((j) => j.status === "new").length;
    const triaging = S.tasks.some((t) => t.kind === "triage" && !t.jobId && (t.status === "queued" || t.status === "running"));
    if (fresh && !triaging) html += `<div class="banner"><span>🧠 ${plural(fresh, "vaga nova ainda não foi avaliada", "vagas novas ainda não foram avaliadas")} pela IA.</span>${btn("triage", "Avaliar agora", null, "primary small")}</div>`;
    if (jobs.length > 1 && !filterText)
      html += `<div class="btn-row" style="justify-content:flex-end;margin-bottom:2px">${checkAllButton()}${btn("tailor-many", "📦 Gerar vários pacotes de uma vez", null, "small ghost")}</div>`;
  }
  if (st.id === "ready" && jobs.length && !filterText) html += `<div class="btn-row" style="justify-content:flex-end;margin-bottom:2px">${checkAllButton()}</div>`;
  if (!jobs.length) {
    const [icon, text, cta] = st.empty;
    html += filterText
      ? `<div class="empty"><div class="big">🔍</div><p>Nenhuma vaga com “${esc(filterText)}” nesta etapa.</p></div>`
      : `<div class="empty"><div class="big">${icon}</div><p>${esc(text)}</p>${cta ? btn(cta[0], cta[1], null, "primary") : ""}</div>`;
  } else html += jobs.map(card).join("");
  box.innerHTML = html;
  // Animação de entrada só ao abrir a página ou trocar de etapa, não a cada atualização ao vivo.
  box.classList.toggle("enter", animateNext);
  animateNext = false;
  busyKey = currentBusyKey();
  cursor = -1;
}
let animateNext = true;

const checkAllButton = () =>
  S.tasks.some((t) => t.kind === "check" && !t.jobId && (t.status === "queued" || t.status === "running"))
    ? `<span class="busy"><span class="spin"></span>Conferindo as vagas…</span>`
    : btn("check-open", "🔒 Conferir se ainda estão abertas", null, "small ghost", "Abre o link de cada vaga que você ainda não enviou e marca as encerradas");

/** Teclado na página de vagas: j/k andam entre as vagas (setas também, quando uma vaga está selecionada), Enter abre. */
export function jobsKeydown(e) {
  const cards = $$(".job");
  if (!cards.length) return false;
  const onCard = document.activeElement?.classList.contains("job");
  if (e.key === "j" || e.key === "k" || (onCard && (e.key === "ArrowDown" || e.key === "ArrowUp"))) {
    const down = e.key === "j" || e.key === "ArrowDown";
    cursor = Math.max(0, Math.min(cards.length - 1, cursor + (down ? 1 : -1)));
    cards.forEach((c, i) => c.classList.toggle("kbd", i === cursor));
    cards[cursor].focus({ preventScroll: true });
    cards[cursor].scrollIntoView({ block: "nearest", behavior: "smooth" });
    return true;
  }
  if (e.key === "Enter" && document.activeElement?.classList.contains("job")) {
    openDrawer(document.activeElement.dataset.job);
    return true;
  }
  return false;
}

/* -------------------------------------------------------------------- gaveta */

const drawer = { id: null, tab: "resumo", data: null };
export const drawerOpen = () => Boolean(drawer.id);
const DRAWER_TABS = [
  ["resumo", "Resumo", () => true],
  ["pacote", "Pacote", (d) => Boolean(d.pkg)],
  ["emails", "E-mails e mensagens", (d) => Boolean(d.docs?.emails)],
  ["ficha", "Ficha", (d) => Boolean(d.sheet)],
  ["entrevista", "Entrevista", (d) => Boolean(d.docs?.interview)],
  ["perguntas", "Perguntas", () => true],
  ["descricao", "Descrição da vaga", () => true],
];

export async function openDrawer(id, tab = "resumo") {
  drawer.id = id;
  drawer.tab = tab;
  drawer.data = null;
  $("#drawer-root").innerHTML = `<div class="scrim" data-act="close-drawer" data-nolock></div><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div class="drawer-body"><span class="busy"><span class="spin"></span>Carregando…</span></div></aside>`;
  await reloadDrawer();
}

export async function reloadDrawer() {
  const id = drawer.id;
  if (!id) return;
  try {
    const data = await api(`/api/jobs/${encodeURIComponent(id)}`);
    if (drawer.id !== id) return;
    drawer.data = data;
    paintDrawer();
  } catch (e) {
    closeDrawer();
    toast(e.message, "bad");
  }
}

export function closeDrawer() {
  drawer.id = null;
  drawer.data = null;
  $("#drawer-root").innerHTML = "";
}

export function paintDrawer() {
  const d = drawer.data;
  if (!d) return;
  const job = findJob(d.id) ?? d;
  const tabs = DRAWER_TABS.filter(([, , ok]) => ok(d));
  if (!tabs.some(([id]) => id === drawer.tab)) drawer.tab = "resumo";
  const scroll = $(".drawer-body")?.scrollTop ?? 0;
  // O painel é redesenhado quando uma tarefa termina: o que estava digitado nos campos não pode sumir.
  const kept = Object.fromEntries($$(".drawer [data-keep]").map((el) => [el.dataset.keep, el.value]));
  const focused = document.activeElement?.dataset?.keep;
  const st = stageOf(d.status);
  $(".drawer").innerHTML = `
  <div class="drawer-head">
    <div class="drawer-top">
      ${mono(d.company, "lg")}
      <div>${meta(job)}<h2 id="drawer-title">${esc(d.title)}</h2>
        <div class="status-line"><span class="chip">${esc(st?.label ?? d.statusLabel)}</span>${d.url ? link(d.url, "🔗 Vaga original", "small ghost") : ""}</div></div>
      ${btn("close-drawer", "✕", null, "ghost icon", "Fechar (Esc)")}
    </div>
    <div class="job-actions">${actionsFor(job)}${jobTask(job.id) ? "" : drawerExtras(job)}</div>
    <nav class="tabs" role="tablist">${tabs
      .map(([id, label]) => `<button type="button" class="tab" role="tab" data-act="dtab" data-id="${id}" data-nolock aria-selected="${id === drawer.tab}">${label}</button>`)
      .join("")}</nav>
  </div>
  <div class="drawer-body">${drawerBody(d, job)}</div>`;
  for (const el of $$(".drawer [data-keep]")) {
    if (kept[el.dataset.keep]) el.value = kept[el.dataset.keep];
    if (el.dataset.keep === focused) el.focus();
  }
  if (scroll) $(".drawer-body").scrollTop = scroll;
}

/** Ações a mais na gaveta (as mesmas opções do `ajf tailor` e do `ajf triage --id`). */
function drawerExtras(j) {
  const out = [];
  if (!["applied", "interview", "offer", "rejected"].includes(j.status))
    out.push(btn("tailor-options", j.pkg ? "⚙ Gerar de novo com opções" : "⚙ Gerar com opções", j.id, "ghost small"));
  if (["new", "triaged", "shortlisted", "discarded"].includes(j.status)) out.push(btn("retriage", "🧠 Avaliar de novo", j.id, "ghost small"));
  if (S.webSearch && !["rejected", "discarded"].includes(j.status))
    out.push(btn("research", j.research ? "🔎 Pesquisar de novo na web" : "🔎 Pesquisar na web", j.id, "ghost small", "Anúncio oficial, site da empresa e se a vaga é real"));
  if (CHECKABLE.includes(j.status) && j.url) out.push(btn("check-one", "🔒 Conferir se está aberta", j.id, "ghost small", "Abre o link da vaga e procura sinais de que ela acabou"));
  return out.join("");
}

/** Quadro "vaga repetida" e "vaga encerrada" no resumo da gaveta. */
function flagsPanels(d) {
  let html = "";
  const o = original(d);
  if (o)
    html += `<div class="panel"><h3>🔁 Vaga repetida</h3><p class="muted">Parece a mesma vaga que ${btn("open", `${esc(o.company)} — ${esc(o.title)}`, o.id, "small")} <span class="faint">(${esc(stageOf(o.status)?.label ?? o.statusLabel)}, ${esc(o.source)})</span>: mesma empresa, mesmo cargo e o mesmo texto, em outro site.</p>
      <p class="faint" style="margin-top:8px">${d.status === "discarded" ? "Por isso ela entrou já descartada. Se não for a mesma, reabra." : "Confira antes de gerar outro pacote ou se candidatar de novo."}</p>
      ${d.status === "discarded" ? "" : `<div class="btn-row" style="margin-top:10px">${btn("not-duplicate", "Não é a mesma vaga", d.id, "small ghost")}</div>`}</div>`;
  const r = reopenedFrom(d);
  if (r)
    html += `<div class="panel"><h3>📨 Vaga reaberta</h3><p class="muted">${esc(reopenedText(r))}: ${btn("open", `${esc(r.company)} — ${esc(r.title)}`, r.id, "small")} <span class="faint">(${esc(stageOf(r.status)?.label ?? r.statusLabel)})</span>.</p>
      <p class="faint" style="margin-top:8px">Como foi há mais de ${S.settings.repeatWindowDays ?? 90} dias, ou esta foi publicada depois, o agente trata como uma vaga nova da mesma empresa. Confira se vale se candidatar de novo.</p></div>`;
  const c = d.openCheck;
  if (c && (CHECKABLE.includes(d.status) || d.status === "discarded")) {
    const [cls, text] = OPEN_TEXT[c.verdict] ?? OPEN_TEXT.sem_confirmacao;
    html += `<div class="panel"${c.verdict === "encerrada" ? ' style="border-color:var(--bad)"' : ""}><h3>🔒 A vaga está aberta? <span class="faint" style="font-weight:400">· conferida em ${new Date(c.at).toLocaleDateString("pt-BR")}</span></h3>
      <div class="status-line"><span class="chip ${cls}">${text}</span><span>${esc(c.reason)}</span></div>
      ${c.verdict === "encerrada" ? `<p class="faint" style="margin-top:8px">Abra o link para ter certeza. Se ainda estiver aberta, use “Gerar mesmo assim”.</p>` : ""}</div>`;
  }
  return html;
}

/* Ficha de candidatura: os campos que os formulários pedem, cada um com o botão de copiar. */
function sheetTab(s) {
  const from =
    s.from === "pacote"
      ? "Do currículo adaptado para esta vaga."
      : "Do seu currículo-base (esta vaga ainda não tem pacote; gerado o pacote, a ficha usa o currículo adaptado).";
  return `<div class="panel"><p class="muted">Os campos que formulários como Gupy, InHire, Greenhouse e Workday pedem de novo, prontos para copiar. ${from} Perguntas como “por que você quer trabalhar aqui?” ficam na aba Perguntas.</p></div>
  ${s.sections
    .map(
      (sec, i) => `<section class="panel sheet"><h3>${esc(sec.title)}</h3>${sec.fields
        .map(
          (f, k) => `<div class="sheet-row${f.long ? " long" : ""}"><span class="sheet-label">${esc(f.label)}${f.long ? `<small>${f.value.length} caracteres</small>` : ""}</span>
          <div class="sheet-value">${esc(f.value)}</div>${btn("copy-sheet", "📋", `${i}:${k}`, "small ghost icon", `Copiar: ${f.label}`)}</div>`,
        )
        .join("")}</section>`,
    )
    .join("")}`;
}

/* Perguntas do formulário de candidatura: pergunta → resposta, com ajustes. */
function answersTab(d) {
  const list = [...(d.answers ?? [])].reverse();
  return `<div class="panel answer-new">
    <h3>Pergunta do formulário</h3>
    <p class="muted">Cole a pergunta que o formulário de candidatura faz, como "Por que você quer trabalhar aqui?" ou "Fale de um projeto de que você se orgulha". A IA responde com o seu perfil e com o que a vaga diz da empresa.</p>
    <label class="field"><span>Pergunta</span><textarea id="ans-q" data-keep="ans-q" rows="3" placeholder="ex.: Por que você gostaria de trabalhar na ${esc(d.company)}?"></textarea></label>
    <label class="field"><span>Limite de caracteres <small>(se o formulário tiver)</small></span><input id="ans-limit" data-keep="ans-limit" type="number" min="50" max="20000" step="10" placeholder="ex.: 500" style="max-width:180px"></label>
    <label class="field"><span>O que só você sabe <small>(opcional)</small></span><small>Motivação, opinião sobre o produto, algo que não está no perfil. Vale só para esta resposta.</small><textarea id="ans-ctx" data-keep="ans-ctx" rows="2" placeholder="ex.: Uso o app deles há um ano e gosto de como resolvem X."></textarea></label>
    <div class="btn-row">${btn("answer-ask", "✍️ Responder", d.id, "primary")}</div>
  </div>
  ${
    list.length
      ? list.map(answerCard).join("")
      : `<p class="faint" style="margin:4px 2px">Nenhuma pergunta respondida ainda. As respostas ficam salvas aqui e em <code>perguntas_e_respostas.md</code>, na pasta do pacote.</p>`
  }`;
}

function answerCard(a) {
  const over = a.limit && a.answer.length > a.limit;
  return `<section class="panel answer">
    <h3>${esc(a.question)}</h3>
    <div class="message">${esc(a.answer)}</div>
    <div class="status-line" style="margin-top:8px">
      <span class="chip ${over ? "bad" : ""}">${a.answer.length} caracteres${a.limit ? ` de ${a.limit}` : ""}</span>
      ${btn("answer-copy", "📋 Copiar", a.id, "small")}${btn("answer-delete", "🗑 Apagar", a.id, "small ghost")}
    </div>
    ${a.adjustments?.length ? `<p class="faint answer-history">Ajustes pedidos: ${a.adjustments.map((x) => `“${esc(x)}”`).join(" · ")}</p>` : ""}
    ${a.warnings?.length ? `<p class="answer-warn">⚠ Confira antes de usar: ${esc(a.warnings.join("; "))}</p>` : ""}
    ${a.needsYou?.length ? `<div class="answer-needs"><strong>Para ficar com a sua cara, conte:</strong><ul>${a.needsYou.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
    <div class="answer-refine">
      <input type="text" data-keep="refine-${esc(a.id)}" maxlength="1000" placeholder="Ajustar: mais curto, cite o projeto X, em inglês… ou responda o que falta acima" aria-label="O que ajustar nesta resposta">
      ${btn("answer-refine", "Ajustar", a.id, "small")}
    </div>
  </section>`;
}

/** Botão com "escrevendo…" enquanto a IA trabalha (leva de 20 a 60 segundos). */
async function writingButton(el, run) {
  const label = el.innerHTML;
  el.innerHTML = `<span class="spin"></span> Escrevendo…`;
  try {
    return await run();
  } finally {
    if (el.isConnected) el.innerHTML = label;
  }
}

function drawerBody(d, job) {
  if (drawer.tab === "perguntas") return answersTab(d);
  if (drawer.tab === "pacote") {
    const reports = [
      ["Relatório ATS (palavras-chave da vaga)", d.docs.ats],
      ["Nota do recrutador e o que faltou", d.docs.rating],
      ["Conferência com o seu perfil", d.docs.coverage],
    ].filter(([, v]) => v);
    return `<div class="panel"><h3>Arquivos</h3><div class="btn-row">${d.files.map((f) => link(f.url, `📄 ${esc(f.name)}`, "small")).join("")}${btn("folder", "📁 Abrir pasta", d.id, "small")}</div>
      <p class="faint" style="margin-top:8px">output/${esc(d.pkg.folder)}</p>
      <p class="muted" style="margin-top:10px">Editou o <code>resume.json</code> ou o <code>cover_letter.json</code> na pasta? ${btn("rerender", "🔄 Gerar o PDF de novo", d.id, "small")}</p></div>
      ${d.docs.readme ? `<div class="panel md">${md(d.docs.readme)}</div>` : ""}
      ${reports.map(([t, v], i) => `<details class="panel md"${d.status === "low_fit" && i === 1 ? " open" : ""}><summary>${t}</summary>${md(v)}</details>`).join("")}`;
  }
  if (drawer.tab === "emails") {
    const e = d.docs.emails;
    const a = d.apply;
    const send = a
      ? `<div class="panel"><h3>✉️ Enviar o e-mail de candidatura</h3>
        <p class="muted">${a.to ? `Para <strong>${esc(a.to)}</strong>. ` : "A vaga não traz um e-mail de contato: preencha o destinatário. "}Nada é enviado sozinho: o e-mail abre pronto, você confere e clica em Enviar.</p>
        <div class="btn-row" style="margin-top:10px">${btn("email-draft", "✉️ Abrir no programa de e-mail, com o currículo anexado", d.id, "primary small", "Outlook, Thunderbird ou o programa de e-mail do computador")}${link(a.gmail, "Abrir no Gmail", "small")}${btn("folder", "📁 Pasta do PDF", d.id, "small ghost")}</div>
        <p class="faint" style="margin-top:8px">No programa de e-mail, ${a.attachments.length ? `${esc(a.attachments.join(" e "))} já vai anexado` : "anexe o currículo"}. No Gmail pelo navegador, arraste o PDF da pasta para o e-mail.</p></div>`
      : "";
    return `${send}${e.intro ? `<div class="panel md">${md(e.intro)}</div>` : ""}${e.sections
      .map(
        (s, i) => `<section class="email"><h3>${esc(s.title)}</h3>
        ${s.subjects.map((sub, k) => `<div class="subject"><span><span class="faint">Assunto</span> ${esc(sub)}</span>${btn("copy-email", "📋", `s:${i}:${k}`, "small ghost icon", "Copiar assunto")}</div>`).join("")}
        ${s.notes ? `<div class="md muted">${md(s.notes)}</div>` : ""}
        <div class="message">${esc(s.message)}</div><div class="btn-row">${btn("copy-email", "📋 Copiar mensagem", `m:${i}`, "small")}${s.gmail ? link(s.gmail, "Abrir no Gmail", "small ghost") : ""}</div>
      </section>`,
      )
      .join("")}`;
  }
  if (drawer.tab === "ficha") return sheetTab(d.sheet);
  if (drawer.tab === "entrevista") return `<div class="panel md">${md(d.docs.interview)}</div>`;
  if (drawer.tab === "descricao") return `<div class="panel desc">${esc(d.description)}</div>`;

  const t = d.triage;
  let html = `<div class="panel" style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">${gauges(job)}<p class="muted" style="flex:1;min-width:220px">${
    t ? `Aderência <strong>${esc(t.fit)}</strong> segundo a IA. ${esc(t.reason)}` : "Esta vaga ainda não foi avaliada pela IA."
  }</p></div>`;
  if (["applied", "interview", "offer", "rejected"].includes(d.status) && (d.appliedAt || d.notes))
    html += `<div class="panel"><h3>Sua candidatura</h3><p>${d.appliedAt ? `Enviada em ${new Date(d.appliedAt).toLocaleDateString("pt-BR")}` : ""}${d.appliedViaLabel ? ` via ${esc(d.appliedViaLabel)}` : ""}${d.notes ? ` · ${esc(d.notes)}` : ""}</p></div>`;
  if (t?.scam?.length) html += `<div class="panel" style="border-color:var(--bad)"><h3>🚩 Sinais de golpe</h3><p>${esc(t.scam.join("; "))}</p></div>`;
  html += flagsPanels(d);
  if (d.research) {
    const r = d.research;
    html += `<div class="panel"${r.verdict === "suspeita" ? ' style="border-color:var(--bad)"' : ""}><h3>🔎 Pesquisa na web <span class="faint" style="font-weight:400">· ${new Date(r.at).toLocaleDateString("pt-BR")}</span></h3>
      <div class="status-line">${researchChip(r)}</div>
      <div class="btn-row" style="margin-top:10px">${link(r.postingUrl, "🔗 Anúncio oficial", "small")}${link(r.companySite, "🏢 Site da empresa", "small")}</div>
      ${r.notes?.length ? `<ul class="${r.verdict === "confirmada" ? "list-ok" : "list-gap"}" style="margin-top:10px">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      <p class="faint" style="margin-top:8px">Os detalhes encontrados estão no fim da descrição da vaga e já valem para a triagem e o pacote.</p></div>`;
  }
  if (d.evidence.length) html += `<div class="panel"><h3>O que você já tem</h3><ul class="list-ok">${d.evidence.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  if (d.gaps.length) html += `<div class="panel"><h3>Lacunas: requisitos sem evidência no seu perfil</h3><ul class="list-gap">${d.gaps.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  html += `<div class="panel"><h3>Descrição</h3><div class="desc">${esc(d.description.slice(0, 1400))}${d.description.length > 1400 ? "…" : ""}</div>
    ${d.description.length > 1400 ? `<div style="margin-top:10px">${btn("dtab", "Ler a descrição completa", "descricao", "small")}</div>` : ""}</div>`;
  return html;
}

/* -------------------------------------------------------------------- ações */

async function setStatus(id, status, note = "", { quiet = false, via } = {}) {
  const r = await api(`/api/jobs/${encodeURIComponent(id)}/status`, { status, note, via });
  if (!quiet) {
    const dest = stageOf(status);
    toast(`${r.job.company} → ${dest?.label ?? r.job.statusLabel}`, "", {
      label: "Desfazer",
      run: () => setStatus(id, r.previous, "", { quiet: true }).then(() => toast("Desfeito.")),
    });
  }
  await app.refresh();
  return r;
}

function reopenStatus(j) {
  if (j.pkg && j.rating != null) return j.rating >= S.settings.minRating ? "tailored" : "low_fit";
  if (j.triage) return j.triage.recommendation === "candidatar" ? "shortlisted" : "triaged";
  return "new";
}

function webOption(withHint = false) {
  const on = S.webSearch && S.webDefault;
  return `<label class="switch"><input type="checkbox" name="web"${on ? " checked" : ""}${S.webSearch ? "" : " disabled"}>
    <span>Incluir busca na web com IA (LinkedIn, Gupy, Indeed)<small>${S.webSearch ? "Acha mais vagas no Brasil, mas é mais lenta e usa mais a IA." : "A IA escolhida não faz busca na web."}</small></span></label>
    ${withHint ? `<label class="field" id="web-hint"${on ? "" : " hidden"}><span>Instrução extra para a busca na web <small>(opcional)</small></span><input name="hint" placeholder="ex.: só vagas em Londrina, ou empresas de saúde" autocomplete="off"></label>` : ""}`;
}
const toggleHint = (form) => {
  const web = form.elements.web;
  if (web && form.querySelector("#web-hint")) web.addEventListener("change", () => (form.querySelector("#web-hint").hidden = !web.checked));
};

export async function markApplied(id) {
  const j = findJob(id);
  const channels = Object.entries(S.applyChannels ?? {});
  const r = await modal({
    title: "Marcar como enviada",
    html: `<p><strong>${esc(j.company)}</strong> — ${esc(j.title)}</p>
      <p class="muted" style="margin-top:6px">A vaga vai para “Em andamento”${j.pkg ? " e a pasta do pacote para <code>output/2-em-andamento</code>" : ""}. Daqui a 7 dias aparece o lembrete de follow-up.</p>
      <div class="field"><span>Por onde você se candidatou?</span><small>Com isso dá para ver depois qual canal responde mais.</small>
        <div class="via-grid">${channels
          .map(([v, label]) => `<label class="option"><input type="radio" name="via" value="${esc(v)}"${v === j.applyGuess ? " checked" : ""}><span>${esc(label)}</span></label>`)
          .join("")}</div></div>
      <label class="field"><span>Observação <small>(opcional)</small></span><input name="note" placeholder="ex.: indicação do Fulano, código da vaga 123" autocomplete="off"></label>`,
    confirm: "✅ Já me candidatei",
  });
  if (r) await setStatus(id, "applied", r.note, { via: r.via });
}

action("stage", (_id, id) => {
  stage = id;
  store.set("ajf.stage", id);
  animateNext = true;
  paintJobs();
});
action("open", (id, tab) => openDrawer(id, tab));
action("close-drawer", () => closeDrawer());
action("dtab", (id) => {
  drawer.tab = id;
  paintDrawer();
  $(".drawer-body").scrollTop = 0;
});
action("tailor", async (id) => {
  const j = findJob(id);
  await api(`/api/jobs/${encodeURIComponent(id)}/tailor`, {});
  toast(`📦 Pacote de ${j?.company ?? "vaga"} na fila. Leva alguns minutos; pode continuar usando.`);
  await app.refresh();
});
action("tailor-anyway", async (id) => {
  const j = findJob(id);
  const ok = await modal({
    title: "Gerar mesmo com a vaga encerrada?",
    html: `<p><strong>${esc(j.company)}</strong> — ${esc(j.title)}</p>
      <p class="muted" style="margin-top:6px">Na última conferência, ${esc(j.openCheck?.reason ?? "a página disse que a vaga acabou")}. Abra o link e confira: se ela ainda aceita candidaturas, gere o pacote.</p>
      ${j.url ? `<div class="btn-row" style="margin-top:10px">${link(j.url, "🔗 Abrir a vaga", "small")}</div>` : ""}`,
    confirm: "📦 Gerar mesmo assim",
  });
  if (!ok) return;
  await api(`/api/jobs/${encodeURIComponent(id)}/tailor`, { ignoreClosed: true });
  toast(`📦 Pacote de ${j.company} na fila.`);
  await app.refresh();
});
action("check-open", async () => {
  await api("/api/check-open", {});
  toast("🔒 Conferindo as vagas que você ainda não enviou. As encerradas sem pacote vão para “Encerradas”.");
  await app.refresh();
});
action("not-duplicate", async (id) => {
  await api(`/api/jobs/${encodeURIComponent(id)}/not-duplicate`, {});
  toast("Marca de repetida tirada. O agente não marca esta vaga de novo.");
  await app.refresh();
  if (drawer.id === id) await reloadDrawer();
});
action("check-one", async (id) => {
  await api(`/api/jobs/${encodeURIComponent(id)}/check-open`, {});
  toast("🔒 Conferindo se a vaga ainda está aberta.");
  await app.refresh();
});
action("tailor-options", async (id) => {
  const j = findJob(id);
  const sel = (name, label, options) =>
    `<label class="field"><span>${label}</span><select name="${name}">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></label>`;
  const r = await modal({
    title: j.pkg ? "Gerar o pacote de novo" : "Gerar o pacote com opções",
    html: `<p><strong>${esc(j.company)}</strong> — ${esc(j.title)}</p>
      <p class="muted" style="margin-top:6px">Deixe em “automático” para o agente decidir pela vaga.${j.pkg ? " O pacote atual continua na pasta; o novo vai para uma pasta própria." : ""}</p>
      <div class="grid2">${sel("lang", "Idioma do currículo", [["", "Automático"], ["pt-BR", "Português"], ["en", "Inglês"]])}${sel("paper", "Papel", [["", "Automático"], ["A4", "A4"], ["Letter", "Letter (EUA/Canadá)"]])}</div>
      <div class="grid2">${sel("market", "Mercado", [["", "Automático"], ["BR", "Brasil"], ["US", "EUA"], ["CA", "Canadá"], ["UK", "Reino Unido"], ["EU", "Europa"], ["LATAM", "América Latina"], ["GLOBAL", "Global"]])}${sel("cover", "Carta de apresentação", [["", "Automático"], ["sim", "Gerar"], ["nao", "Não gerar"]])}</div>
      <label class="switch"><input type="checkbox" name="interview"><span>Gerar também o guia de entrevista</span></label>
      ${isClosed(j) ? `<label class="switch"><input type="checkbox" name="ignoreClosed"><span>Gerar mesmo com a vaga parecendo encerrada<small>${esc(j.openCheck.reason)}</small></span></label>` : ""}`,
    confirm: "📦 Gerar",
  });
  if (!r) return;
  await api(`/api/jobs/${encodeURIComponent(id)}/tailor`, r);
  toast(`📦 Pacote de ${j.company} na fila.`);
  await app.refresh();
});
action("tailor-many", async () => {
  const st = STAGES[0];
  const jobs = sorted(st, S.jobs.filter((j) => st.statuses.includes(j.status))).slice(0, 25);
  const top = new Set(jobs.filter((j) => (j.triage?.score ?? 0) >= S.settings.minTriageScore && !j.triage?.scam?.length).slice(0, 3).map((j) => j.id));
  const r = await modal({
    title: "Gerar vários pacotes",
    wide: true,
    html: `<p class="muted">Marque as vagas. Os pacotes entram na fila e são gerados um de cada vez (alguns minutos cada).</p>
      ${jobs
        .map(
          (j) => `<label class="option"><input type="checkbox" name="ids" data-list value="${esc(j.id)}"${top.has(j.id) ? " checked" : ""}>
          <span><b>${esc(j.company)}</b> — ${esc(j.title)}<br><small class="muted">${j.triage ? `triagem ${j.triage.score}` : "sem triagem"}${j.triage?.scam?.length ? " · 🚩 sinais de golpe" : ""}</small></span></label>`,
        )
        .join("")}`,
    confirm: "📦 Gerar os marcados",
  });
  if (!r?.ids?.length) return;
  const res = await api("/api/tailor-many", { ids: r.ids });
  toast(`📦 ${plural(res.tasks.length, "pacote na fila", "pacotes na fila")}.`);
  await app.refresh();
});
action("retriage", async (id) => {
  await api(`/api/jobs/${encodeURIComponent(id)}/triage`, {});
  toast("🧠 Avaliando a vaga de novo.");
  await app.refresh();
});
action("research", async (id) => {
  await api(`/api/jobs/${encodeURIComponent(id)}/research`, {});
  toast("🔎 Pesquisando a vaga e a empresa na web.");
  await app.refresh();
});
action("rerender", async (id) => {
  await api(`/api/jobs/${encodeURIComponent(id)}/render`, {});
  toast("🔄 Gerando o PDF de novo.");
  await app.refresh();
});
action("applied", (id) => markApplied(id));
action("discard", (id) => setStatus(id, "discarded"));
action("status", (id, value) => setStatus(id, value));
action("reopen", (id) => setStatus(id, reopenStatus(findJob(id))));
action("interview", async (id) => {
  const j = findJob(id);
  await setStatus(id, "interview", "", { quiet: true });
  const ok = await modal({
    title: "Boa! Quer o guia de entrevista?",
    html: `<p>A IA prepara perguntas prováveis e respostas com base ${j?.pkg ? "no currículo que você enviou para essa vaga" : "no seu currículo-base"}. Leva alguns minutos e roda em segundo plano.</p>`,
    confirm: "🎤 Gerar guia",
    cancel: "Agora não",
  });
  if (ok) await ACTIONS_guide(id);
});
async function ACTIONS_guide(id) {
  await api(`/api/jobs/${encodeURIComponent(id)}/interview`, {});
  toast("🎤 Guia de entrevista na fila.");
  await app.refresh();
}
action("guide", (id) => ACTIONS_guide(id));
action("folder", (id) => api(`/api/jobs/${encodeURIComponent(id)}/open-folder`, {}));
action("answer-ask", async (jobId, _arg, el) => {
  const question = $("#ans-q").value.trim();
  if (question.length < 5) return toast("Escreva a pergunta do formulário.", "bad");
  const limit = Number($("#ans-limit").value) || undefined;
  const context = $("#ans-ctx").value.trim();
  await writingButton(el, () => api(`/api/jobs/${encodeURIComponent(jobId)}/answers`, { question, limit, context }));
  for (const f of ["#ans-q", "#ans-limit", "#ans-ctx"]) if ($(f)) $(f).value = "";
  toast("✍️ Resposta pronta. Revise antes de colar no formulário.");
  if (drawer.id === jobId) await reloadDrawer();
});

action("answer-refine", async (answerId, _arg, el) => {
  const jobId = drawer.id;
  const input = el.closest(".answer-refine").querySelector("input");
  const instruction = input.value.trim();
  if (!instruction) return input.focus();
  await writingButton(el, () => api(`/api/jobs/${encodeURIComponent(jobId)}/answers/${encodeURIComponent(answerId)}/refine`, { instruction }));
  if (input.isConnected) input.value = "";
  if (drawer.id === jobId) await reloadDrawer();
});

// Enter no campo "Ajustar" envia o ajuste.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing || !e.target.matches?.(".answer-refine input")) return;
  e.preventDefault();
  e.target.parentElement.querySelector("button")?.click();
});

action("answer-copy", async (answerId) => {
  const a = drawer.data?.answers?.find((x) => x.id === answerId);
  if (a) await copy(a.answer);
});

action("answer-delete", async (answerId) => {
  const jobId = drawer.id;
  const a = drawer.data?.answers?.find((x) => x.id === answerId);
  if (!a || !(await modal({ title: "Apagar esta resposta?", html: `<p class="muted">${esc(a.question)}</p>`, confirm: "Apagar" }))) return;
  await api(`/api/jobs/${encodeURIComponent(jobId)}/answers/${encodeURIComponent(answerId)}/delete`, {});
  if (drawer.id === jobId) await reloadDrawer();
});

action("copy-sheet", async (ref) => {
  const [i, k] = ref.split(":").map(Number);
  const f = drawer.data?.sheet?.sections?.[i]?.fields?.[k];
  if (f) await copy(f.value);
});
action("email-draft", async (id) => {
  await api(`/api/jobs/${encodeURIComponent(id)}/email-draft`, {});
  toast("✉️ Abrindo o e-mail no seu programa de e-mail. Confira e clique em Enviar.");
});
action("copy-email", async (ref) => {
  const e = drawer.data?.docs?.emails;
  if (!e) return;
  const [kind, i, k] = ref.split(":").map((x, n) => (n ? Number(x) : x));
  await copy(kind === "s" ? e.sections[i].subjects[k] : e.sections[i].message);
});

action("search", async () => {
  const r = await modal({
    title: "Buscar vagas novas",
    html: `<p class="muted">Procura nas fontes das suas preferências. Depois a IA avalia cada vaga contra o seu perfil.</p>${webOption(true)}`,
    confirm: "🔎 Buscar",
    onOpen: toggleHint,
  });
  if (!r) return;
  await api("/api/search", { web: r.web, hint: r.web ? r.hint : "" });
  toast("🔎 Busca começou. As vagas aparecem em “Para decidir”.");
  await app.refresh();
});
action("auto", async () => {
  const r = await modal({
    title: "Piloto automático",
    html: `<p class="muted">Busca vagas, a IA avalia e gera os pacotes das melhores (triagem ≥ ${S.settings.minTriageScore}). Nada é enviado: no fim você só revisa.</p>
      ${webOption()}
      <label class="field"><span>Quantos pacotes gerar no máximo</span><input type="number" name="max" min="0" max="15" value="3" required></label>
      <label class="switch"><input type="checkbox" name="interview"><span>Gerar também o guia de entrevista de cada pacote</span></label>`,
    confirm: "🚀 Começar",
  });
  if (!r) return;
  await api("/api/auto", { web: r.web, max: Number(r.max), interview: r.interview });
  toast("🚀 Piloto automático começou. Acompanhe no canto da tela.");
  await app.refresh();
});
action("triage", async () => {
  await api("/api/triage", {});
  toast("🧠 Avaliando as vagas novas.");
  await app.refresh();
});
action("paste", async () => {
  const r = await modal({
    title: "Colar uma vaga",
    wide: true,
    html: `<p class="muted">Para vagas do LinkedIn, da Gupy, ou que chegaram por indicação, e-mail ou WhatsApp, mesmo sem link. A IA avalia na hora e você gera o pacote como qualquer outra vaga.</p>
      <label class="field"><span>Texto da vaga</span><small>Cole tudo o que você recebeu: requisitos, como é a equipe, e-mail para enviar o currículo, prazo. Se a página da vaga abre sem login (Gupy, site da empresa), pode informar só o link. Do LinkedIn, cole o texto.</small><textarea name="text" rows="9" placeholder="ex.: A Empresa X está contratando Desenvolvedor Full Stack Pleno para o time de pagamentos. Requisitos: Node.js, React… Currículo para vagas@empresax.com.br até 20/11."></textarea></label>
      <label class="field"><span>Link da vaga <small>(se tiver)</small></span><input name="url" type="url" placeholder="https://…" autocomplete="off"></label>
      <div class="grid2"><label class="field"><span>Empresa</span><input name="company" autocomplete="off"></label><label class="field"><span>Cargo</span><input name="title" autocomplete="off"></label></div>
      <label class="field"><span>Local <small>(opcional)</small></span><input name="location" placeholder="ex.: Remoto, Londrina (híbrido)" autocomplete="off"></label>
      <label class="switch"><input type="checkbox" name="research"${S.webSearch ? " checked" : " disabled"}>
        <span>🔎 Pesquisar a vaga e a empresa na web<small>${
          S.webSearch
            ? "Acha o anúncio oficial e o site da empresa, completa o que faltar (requisitos, como se candidatar) e confere se a vaga é real — por exemplo, se o e-mail bate com o domínio da empresa."
            : "A IA escolhida não faz busca na web."
        }</small></span></label>`,
    confirm: "Adicionar e avaliar",
    onOpen: (form) => {
      // Texto completo, ou só o link (o agente lê a página). Valida antes de fechar a janela, sem perder o que foi colado.
      const check = () => {
        const text = form.elements.text.value.trim();
        const url = form.elements.url.value.trim();
        form.elements.text.setCustomValidity(
          text && text.length < 80 ? "O texto está curto demais: cole a descrição inteira." : !text && !url ? "Cole o texto completo da vaga ou informe o link." : "",
        );
      };
      form.addEventListener("input", check);
      check();
    },
  });
  if (!r) return;
  const res = await api("/api/paste", r);
  const same = res.job.duplicateOf ? findJob(res.job.duplicateOf) : null;
  toast(
    `➕ ${res.job.company} adicionada. ${r.research && S.webSearch ? "A IA vai pesquisar a vaga na web e avaliar." : "A IA está avaliando."}${
      same ? ` 🔁 Parece a mesma vaga que ${same.company} — ${same.title}: confira antes de gerar outro pacote.` : ""
    }`,
  );
  stage = "decide";
  store.set("ajf.stage", stage);
  app.go("vagas");
  await app.refresh();
});

/** Itens da paleta de comandos para as vagas que batem com a busca. */
export function paletteJobs(query) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return S.jobs
    .filter((j) => words.every((w) => norm(`${j.company} ${j.title}`).includes(w)))
    .slice(0, 6)
    .flatMap((j) => [
      { group: "Vagas", ico: "💼", text: `${j.company} — ${j.title}`, sub: stageOf(j.status)?.label, run: () => openDrawer(j.id) },
      ...(SENDABLE.includes(j.status) ? [{ group: "Vagas", ico: "✅", text: `Já me candidatei: ${j.company}`, sub: j.title, run: () => markApplied(j.id) }] : []),
      ...(["discarded", "rejected"].includes(j.status)
        ? []
        : [{ group: "Vagas", ico: "📝", text: `Responder pergunta do formulário: ${j.company}`, sub: j.title, run: () => openDrawer(j.id, "perguntas") }]),
    ]);
}
