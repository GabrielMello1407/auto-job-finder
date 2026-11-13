// Página de vagas: funil de etapas, cartões, gaveta de detalhes e as ações de cada vaga.
import { $, $$, action, api, app, btn, copy, daysSince, esc, link, md, modal, mono, norm, plural, ring, level, S, store, t, toast, uploadFile } from "./core.js";
import { dateText, getLang } from "./i18n.js";

export const STAGES = [
  {
    id: "decide", cls: "s-decide", label: t("Para decidir"), sub: t("achadas pela busca"), statuses: ["shortlisted", "triaged", "new"],
    hint: t("A IA já avaliou cada vaga contra o seu perfil. Gere o pacote das que valem a pena."),
    empty: ["🔎", t("Nenhuma vaga para avaliar agora."), ["search", t("🔎 Buscar vagas")]],
  },
  {
    id: "ready", cls: "s-ready", label: t("Prontas"), sub: t("pacote pronto"), statuses: ["tailored"],
    hint: t("Confira o currículo, candidate-se no site da vaga e marque “Já me candidatei”."),
    empty: ["📦", t("Nenhum pacote pronto. Gere um em “Para decidir”."), ["stage:decide", t("Ver vagas para decidir")]],
  },
  {
    id: "active", cls: "s-active", label: t("Em andamento"), sub: t("candidaturas enviadas"), statuses: ["applied", "interview", "offer"],
    hint: t("Atualize quando chamarem para entrevista ou responderem. O follow-up aparece depois de 7 dias."),
    empty: ["📨", t("Você ainda não marcou nenhuma candidatura como enviada.")],
  },
  {
    id: "low", cls: "s-low", label: t("Baixa aderência"), sub: t("nota abaixo do mínimo"), statuses: ["low_fit"],
    hint: t("Pacotes com nota abaixo do mínimo ({min}). Não é recomendado enviar, mas a decisão é sua."),
    empty: ["✨", t("Nada aqui.")],
  },
  {
    id: "closed", cls: "s-closed", label: t("Encerradas"), sub: t("recusadas e descartadas"), statuses: ["rejected", "discarded"],
    hint: t("Recusadas e descartadas. Dá para reabrir qualquer uma."),
    empty: ["🗄", t("Nada aqui.")],
  },
];
export const stageOf = (status) => STAGES.find((s) => s.statuses.includes(status));
export const jobTask = (id) => S.tasks.find((k) => k.jobId === id && (k.status === "queued" || k.status === "running"));
export const findJob = (id) => S.jobs.find((j) => j.id === id);
const salary = (s) => (s && !/n[aã]o informad|not (specified|disclosed)/i.test(s) ? s : "");
const SENDABLE = ["tailored", "low_fit", "shortlisted", "triaged", "new"];

let stage = store.get("ajf.stage");
let filterText = "";
let cursor = -1;

/* ------------------------------------------------------------------- cartão */

/** Nota com vírgula em português, ponto em inglês. */
const decimal = (n) => (getLang() === "pt-BR" ? String(n).replace(".", ",") : String(n));
const FIT = { alta: t("alta"), media: t("média"), baixa: t("baixa") };

function gauges(j) {
  const tri = j.triage;
  return `<div class="gauges">${ring(t("Triagem"), tri?.score, 100, tri ? level(tri.score, S.settings.minTriageScore, 50) : "")}${ring(
    t("Nota"),
    j.rating,
    10,
    j.rating != null ? level(j.rating, S.settings.minRating, 5) : "",
    j.rating != null ? decimal(j.rating) : "",
  )}${ring("ATS", j.atsScore, 100, j.atsScore != null ? level(j.atsScore, 80, 60) : "", j.atsScore != null ? `${j.atsScore}` : "")}</div>`;
}

function meta(j) {
  const parts = [j.location, j.triage?.market, salary(j.salary)].filter(Boolean).map(esc);
  const flags = j.triage?.scam?.length ? `<span class="chip bad" title="${esc(j.triage.scam.join("; "))}">${t("🚩 sinais de golpe")}</span>` : "";
  const fresh = j.status === "new" ? `<span class="chip accent">${t("nova · sem triagem")}</span>` : "";
  const outdated = j.pkg?.outdated ? `<span class="chip warn" title="${esc(t("O seu perfil mudou depois que este pacote foi gerado. Gere de novo para usar as novidades."))}">${t("perfil mudou depois")}</span>` : "";
  const research = j.research ? researchChip(j.research) : "";
  return `<div class="job-meta"><strong>${esc(j.company)}</strong>${parts.map((p) => `<span class="sep">·</span>${p}`).join("")}${flags}${research}${duplicateChip(j)}${reopenedChip(j)}${closedChip(j)}${fresh}${outdated}${ageChip(j)}${ghostChip(j)}${knockoutChip(j)}${referralChip(j)}</div>`;
}

/* Prioridade: frescor, vaga fantasma, critérios eliminatórios e indicação (src/jobs/priority.ts e referral.ts). */
export const STAGE_TEXT = {
  sem_resposta: t("sem resposta"),
  triagem: t("na triagem, antes de qualquer conversa"),
  rh: t("depois da conversa com o RH"),
  tecnica: t("depois do teste ou da entrevista técnica"),
  final: t("depois da entrevista final"),
  desconhecida: t("etapa desconhecida"),
};
const GHOST_TEXT = {
  antiga: t("publicada há mais de 30 dias"),
  republicada: t("a mesma vaga já tinha aparecido antes (republicada)"),
  banco_de_talentos: t("parece banco de talentos, sem uma vaga específica"),
  sem_detalhes: t("anúncio com pouquíssimos detalhes"),
};
const TO_SEND = ["new", "triaged", "shortlisted", "tailored", "low_fit"];
const postedText = (d) => (d === 0 ? t("publicada hoje") : t("publicada há {days}", { days: plural(d, "dia", "dias") }));
function ageChip(j) {
  if (j.ageDays == null || !TO_SEND.includes(j.status)) return "";
  if (j.ageDays <= 3) return `<span class="chip ok" title="${esc(t("Quem se candidata nos primeiros dias é visto antes. Esta vaga sobe na lista."))}">🆕 ${esc(postedText(j.ageDays))}</span>`;
  if (j.ageDays > 14) return `<span class="chip warn" title="${esc(t("Vagas antigas já receberam muitas candidaturas. Esta vaga desce na lista."))}">⏳ ${esc(postedText(j.ageDays))}</span>`;
  return "";
}
function ghostChip(j) {
  if (!j.ghost?.length || !TO_SEND.includes(j.status)) return "";
  return `<span class="chip warn" title="${esc(j.ghost.map((g) => GHOST_TEXT[g] ?? g).join("; "))}">${t("👻 pode ser vaga fantasma")}</span>`;
}
const failedKnockouts = (j) => (j.knockouts ?? []).filter((k) => k.meets === "nao");
function knockoutChip(j) {
  const failed = failedKnockouts(j);
  if (!failed.length || !TO_SEND.includes(j.status)) return "";
  return `<span class="chip bad" title="${esc(failed.map((k) => k.requirement).join("; "))}">${esc(t("⛔ eliminatório: {what}", { what: failed[0].requirement }))}</span>`;
}
function referralChip(j) {
  const r = j.referral;
  if (!r?.status || !TO_SEND.includes(j.status)) return "";
  if (r.status === "recebida") return `<span class="chip ok">${t("🤝 indicação recebida")}</span>`;
  if (r.status === "pedida")
    return r.overdue
      ? `<span class="chip warn" title="${esc(t("Ninguém respondeu ainda. Não espere mais: candidate-se pela plataforma, chegar cedo pesa mais."))}">${t("🤝 indicação sem resposta")}</span>`
      : `<span class="chip accent">${t("🤝 indicação pedida")}</span>`;
  return "";
}

/* Vaga repetida (a mesma vaga em outro site) e vaga encerrada (a página diz que acabou). */
const CHECKABLE = ["new", "triaged", "shortlisted", "tailored", "low_fit"];
const original = (j) => (j.duplicateOf ? findJob(j.duplicateOf) : null);
function duplicateChip(j) {
  const o = original(j);
  return o ? `<span class="chip warn" title="${esc(t("Parece a mesma vaga que {job} ({stage})", { job: `${o.company} — ${o.title}`, stage: stageOf(o.status)?.label ?? t(o.statusLabel) }))}">${t("🔁 repetida")}</span>` : "";
}
const SENT_STATUSES = ["applied", "interview", "offer", "rejected"];
const reopenedFrom = (j) => (j.reopenedFrom ? findJob(j.reopenedFrom) : null);
const reopenedText = (o) => {
  const date = dateText(o.appliedAt ?? o.addedAt);
  return SENT_STATUSES.includes(o.status) ? t("Você se candidatou a uma vaga igual em {date}", { date }) : t("Você gerou um pacote para uma vaga igual em {date}", { date });
};
function reopenedChip(j) {
  const o = reopenedFrom(j);
  return o ? `<span class="chip accent" title="${esc(`${reopenedText(o)} (${o.company} — ${o.title}). ${t("Foi há tempo: conta como vaga nova.")}`)}">${t("📨 vaga reaberta")}</span>` : "";
}
const isClosed = (j) => j.openCheck?.verdict === "encerrada" && (CHECKABLE.includes(j.status) || j.status === "discarded");
const closedChip = (j) => (isClosed(j) ? `<span class="chip bad" title="${esc(j.openCheck.reason)}">${t("🔒 vaga encerrada")}</span>` : "");
const OPEN_TEXT = { aberta: ["ok", t("✓ aberta")], encerrada: ["bad", t("🔒 parece encerrada")], sem_confirmacao: ["", t("sem confirmação")] };

const RESEARCH = {
  confirmada: ["ok", t("✓ vaga confirmada na web"), t("O agente achou o anúncio oficial desta vaga.")],
  nao_encontrada: ["", t("não achada na web"), t("O agente não achou o anúncio oficial. A vaga segue com o que foi informado.")],
  suspeita: ["bad", t("🚩 vaga suspeita"), t("A pesquisa na web achou sinais de golpe. Veja os detalhes.")],
};
function researchChip(r) {
  const [cls, text, title] = RESEARCH[r.verdict] ?? RESEARCH.nao_encontrada;
  return `<span class="chip ${cls}" title="${esc(title)}">${text}</span>`;
}

function statusLine(j) {
  const d = daysSince(j.appliedAt);
  if (j.status === "applied") {
    const when = d == null ? t("Enviada") : d === 0 ? t("Enviada hoje") : t("Enviada há {days}", { days: plural(d, "dia", "dias") });
    const chip = j.noReply
      ? `<span class="chip warn">${t("📭 sem retorno")}</span>`
      : j.followUpDue === 1
        ? `<span class="chip warn">${t("⏰ hora do follow-up")}</span>`
        : j.followUpDue === 2
          ? `<span class="chip warn">${t("⏰ hora do 2º follow-up")}</span>`
          : `<span class="chip accent">${t("📨 aguardando resposta")}</span>`;
    const sent = j.followUps ? ` · ${esc(t("{n} follow-up(s) enviado(s)", { n: j.followUps }))}` : "";
    return `<div class="status-line">${chip}<span>${esc(when)}${j.appliedViaLabel ? ` ${esc(t("via {channel}", { channel: t(j.appliedViaLabel) }))}` : ""}${sent}${j.notes ? ` · ${esc(j.notes)}` : ""}</span></div>`;
  }
  if (j.status === "interview") return `<div class="status-line"><span class="chip accent">${t("🎤 em entrevista")}</span></div>`;
  if (j.status === "offer") return `<div class="status-line"><span class="chip ok">${t("🎉 oferta recebida")}</span></div>`;
  if (j.status === "rejected")
    return `<div class="status-line"><span class="chip">${t("recusada")}</span>${
      j.outcome
        ? `<span>${esc(STAGE_TEXT[j.outcome.stage] ?? j.outcome.stage)}${j.outcome.reason ? ` · ${esc(j.outcome.reason)}` : ""}</span>`
        : `<span class="faint">${t("etapa não registrada")}</span>`
    }</div>`;
  if (j.status === "discarded") return `<div class="status-line"><span class="chip">${t("descartada")}</span></div>`;
  return "";
}

export function actionsFor(j) {
  const task = jobTask(j.id);
  if (task) {
    const what =
      { tailor: t("Gerando o pacote…"), interview: t("Preparando o guia de entrevista…"), triage: t("A IA está avaliando…"), research: t("Pesquisando na web…"), render: t("Gerando o PDF…"), check: t("Conferindo se está aberta…") }[task.kind] ??
      t("Trabalhando…");
    return `<span class="busy"><span class="spin"></span>${task.status === "running" ? what : t("Na fila…")}</span>`;
  }
  const pdf = (label = t("📄 Currículo")) => link(j.pkg?.resume, label);
  const A = [];
  switch (j.status) {
    case "new":
    case "triaged":
    case "shortlisted":
      A.push(
        isClosed(j)
          ? btn("tailor-anyway", t("📦 Gerar mesmo assim"), j.id, "", t("A página da vaga diz que ela acabou. Confira o link antes."))
          : btn("tailor", t("📦 Gerar pacote"), j.id, "primary", ""),
        link(j.url, t("🔗 Ver vaga")),
        j.status === "new" ? "" : referralButton(j),
        btn("applied", t("✅ Já me candidatei"), j.id),
        btn("discard", t("Descartar"), j.id, "ghost danger"),
      );
      break;
    case "tailored":
      A.push(j.url ? link(j.url, t("🔗 Candidatar-se"), "primary") : "", pdf(), j.pkg?.cover ? link(j.pkg.cover, t("✉️ Carta")) : "");
      if (j.pkg?.emails) A.push(btn("open:emails", t("📧 E-mails"), j.id));
      A.push(btn("open:ficha", t("📋 Ficha"), j.id, "", t("Os campos do formulário de candidatura, prontos para copiar")));
      A.push(referralButton(j));
      A.push(btn("applied", t("✅ Já me candidatei"), j.id, j.url ? "" : "primary"));
      if (j.pkg?.outdated) A.push(btn("tailor", t("🔄 Gerar de novo"), j.id, "", t("O seu perfil mudou depois deste pacote")));
      A.push(btn("discard", t("Descartar"), j.id, "ghost danger"));
      break;
    case "low_fit":
      A.push(btn("open:pacote", t("🔍 Por que a nota baixa?"), j.id), pdf(), btn("tailor", t("🔄 Gerar de novo"), j.id), btn("applied", t("✅ Me candidatei assim mesmo"), j.id), btn("discard", t("Descartar"), j.id, "ghost danger"));
      break;
    case "applied":
      A.push(btn("interview", t("🎤 Fui chamado para entrevista"), j.id, "primary"));
      if (j.pkg?.emails) A.push(btn("open:emails", t("📧 Follow-up"), j.id));
      if (j.followUpDue) A.push(btn("followup-sent", t("✅ Enviei o follow-up"), j.id));
      if (j.noReply) A.push(btn("no-reply", t("📭 Fechar como sem retorno"), j.id, "", t("Sem resposta há muito tempo: conta como sem retorno nos resultados")));
      A.push(pdf(t("📄 Currículo enviado")), btn("reject", t("Fui recusado"), j.id, "ghost danger"));
      break;
    case "interview":
      A.push(j.pkg?.interview ? btn("open:entrevista", t("🎤 Guia de entrevista"), j.id, "primary") : btn("guide", t("🎤 Gerar guia de entrevista"), j.id, "primary"));
      if (j.pkg?.emails) A.push(btn("open:emails", t("🙏 Agradecimento"), j.id));
      A.push(btn("status:offer", t("🎉 Recebi oferta"), j.id), btn("reject", t("Fui recusado"), j.id, "ghost danger"));
      break;
    case "offer":
      A.push(pdf(t("📄 Currículo enviado")), btn("reject", t("Não deu certo"), j.id, "ghost"));
      break;
    default:
      if (j.status === "rejected") A.push(btn("reject", j.outcome ? t("📝 Corrigir a etapa") : t("📝 Registrar como foi"), j.id, j.outcome ? "ghost" : ""));
      A.push(btn("reopen", t("↩ Reabrir"), j.id), link(j.url, t("🔗 Ver vaga")));
  }
  return A.filter(Boolean).join("");
}

const referralButton = (j) =>
  btn("referral", j.referral?.status ? t("🤝 Indicação") : t("🤝 Pedir indicação"), j.id, "", t("Indicação é o caminho que mais vira contratação"));

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
  // Prioridade (src/jobs/priority.ts): aderência + frescor, menos vaga fantasma e eliminatório.
  const priority = (j) => j.priority ?? score(j);
  const by = {
    decide: (a, b) => rank[a.status] - rank[b.status] || priority(b) - priority(a),
    ready: (a, b) => priority(b) - priority(a) || (b.rating ?? 0) - (a.rating ?? 0),
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
    <div><h1>${t("Vagas")}</h1><p id="jobs-summary"></p></div>
    <div class="btn-row">
      ${btn("paste", t("➕ Colar vaga"))}
      ${btn("search", t("🔎 Buscar vagas"))}
      ${btn("auto", t("🚀 Piloto automático"), null, "primary")}
    </div>
  </header>
  <div class="pipeline" id="pipeline" role="tablist" aria-label="${esc(t("Etapas"))}"></div>
  <div class="toolbar">
    <label class="search"><input id="filter" type="search" placeholder="${esc(t("Filtrar por empresa ou cargo"))}" autocomplete="off" aria-label="${esc(t("Filtrar vagas"))}" value="${esc(filterText)}"><kbd>/</kbd></label>
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
    ? t("{ready} para enviar · {active} em andamento", { ready: plural(ready, "pacote pronto", "pacotes prontos"), active })
    : t("{decide} para decidir · {active} em andamento", { decide: countIn("decide"), active });
  $("#pipeline").innerHTML = STAGES.map(
    (s) => `<button type="button" class="stage ${s.cls}" role="tab" aria-selected="${s.id === st.id}" data-act="stage:${s.id}" data-nolock>
      <span class="label"><i></i>${s.label}</span><span class="count">${countIn(s.id)}</span><span class="sub">${s.sub}</span><span class="bar"></span></button>`,
  ).join("");
  $("#stage-hint").textContent = st.hint.replace("{min}", decimal(S.settings.minRating));
  paintList();
}

let busyKey = "";
const currentBusyKey = () =>
  S.tasks
    .filter((k) => k.status === "queued" || k.status === "running")
    .map((k) => `${k.kind}:${k.jobId ?? ""}:${k.status}`)
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
    const triaging = S.tasks.some((k) => k.kind === "triage" && !k.jobId && (k.status === "queued" || k.status === "running"));
    if (fresh && !triaging)
      html += `<div class="banner"><span>🧠 ${fresh === 1 ? t("1 vaga nova ainda não foi avaliada pela IA.") : t("{n} vagas novas ainda não foram avaliadas pela IA.", { n: fresh })}</span>${btn("triage", t("Avaliar agora"), null, "primary small")}</div>`;
    if (jobs.length > 1 && !filterText)
      html += `<div class="btn-row" style="justify-content:flex-end;margin-bottom:2px">${checkAllButton()}${btn("tailor-many", t("📦 Gerar vários pacotes de uma vez"), null, "small ghost")}</div>`;
  }
  if (st.id === "ready" && jobs.length && !filterText) html += `<div class="btn-row" style="justify-content:flex-end;margin-bottom:2px">${checkAllButton()}</div>`;
  if (st.id === "active" && !filterText) {
    const due = jobs.filter((j) => j.followUpDue).length;
    const quiet = jobs.filter((j) => j.noReply).length;
    if (due || quiet)
      html += `<div class="banner"><span>${[due ? t("⏰ {n} follow-up(s) para mandar.", { n: due }) : "", quiet ? t("📭 {n} sem retorno há mais de {days} dias: feche para os resultados ficarem certos.", { n: quiet, days: S.settings.noReplyDays ?? 30 }) : ""].filter(Boolean).join(" ")}</span>${btn("go:resultados", t("📊 Ver resultados"), null, "small")}</div>`;
  }
  if (!jobs.length) {
    const [icon, text, cta] = st.empty;
    html += filterText
      ? `<div class="empty"><div class="big">🔍</div><p>${t("Nenhuma vaga com “{q}” nesta etapa.", { q: esc(filterText) })}</p></div>`
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
  S.tasks.some((k) => k.kind === "check" && !k.jobId && (k.status === "queued" || k.status === "running"))
    ? `<span class="busy"><span class="spin"></span>${t("Conferindo as vagas…")}</span>`
    : btn("check-open", t("🔒 Conferir se ainda estão abertas"), null, "small ghost", t("Abre o link de cada vaga que você ainda não enviou e marca as encerradas"));

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
  ["resumo", t("Resumo"), () => true],
  ["pacote", t("Pacote"), (d) => Boolean(d.pkg)],
  ["emails", t("E-mails e mensagens"), (d) => Boolean(d.docs?.emails)],
  ["ficha", t("Ficha"), (d) => Boolean(d.sheet)],
  ["entrevista", t("Entrevista"), (d) => Boolean(d.docs?.interview)],
  ["perguntas", t("Perguntas"), () => true],
  ["descricao", t("Descrição da vaga"), () => true],
];

export async function openDrawer(id, tab = "resumo") {
  drawer.id = id;
  drawer.tab = tab;
  drawer.data = null;
  $("#drawer-root").innerHTML = `<div class="scrim" data-act="close-drawer" data-nolock></div><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div class="drawer-body"><span class="busy"><span class="spin"></span>${t("Carregando…")}</span></div></aside>`;
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
        <div class="status-line"><span class="chip">${esc(st?.label ?? t(d.statusLabel))}</span>${d.url ? link(d.url, t("🔗 Vaga original"), "small ghost") : ""}</div></div>
      ${btn("close-drawer", "✕", null, "ghost icon", t("Fechar (Esc)"))}
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
    out.push(btn("tailor-options", j.pkg ? t("⚙ Gerar de novo com opções") : t("⚙ Gerar com opções"), j.id, "ghost small"));
  if (["new", "triaged", "shortlisted", "discarded"].includes(j.status)) out.push(btn("retriage", t("🧠 Avaliar de novo"), j.id, "ghost small"));
  if (S.webSearch && !["rejected", "discarded"].includes(j.status))
    out.push(btn("research", j.research ? t("🔎 Pesquisar de novo na web") : t("🔎 Pesquisar na web"), j.id, "ghost small", t("Anúncio oficial, site da empresa e se a vaga é real")));
  if (CHECKABLE.includes(j.status) && j.url) out.push(btn("check-one", t("🔒 Conferir se está aberta"), j.id, "ghost small", t("Abre o link da vaga e procura sinais de que ela acabou")));
  return out.join("");
}

/** Quadro "vaga repetida" e "vaga encerrada" no resumo da gaveta. */
function flagsPanels(d) {
  let html = "";
  const o = original(d);
  if (o)
    html += `<div class="panel"><h3>${t("🔁 Vaga repetida")}</h3><p class="muted">${t("Parece a mesma vaga que {job} {info}: mesma empresa, mesmo cargo e o mesmo texto, em outro site.", {
      job: btn("open", `${esc(o.company)} — ${esc(o.title)}`, o.id, "small"),
      info: `<span class="faint">(${esc(stageOf(o.status)?.label ?? t(o.statusLabel))}, ${esc(o.source)})</span>`,
    })}</p>
      <p class="faint" style="margin-top:8px">${d.status === "discarded" ? t("Por isso ela entrou já descartada. Se não for a mesma, reabra.") : t("Confira antes de gerar outro pacote ou se candidatar de novo.")}</p>
      ${d.status === "discarded" ? "" : `<div class="btn-row" style="margin-top:10px">${btn("not-duplicate", t("Não é a mesma vaga"), d.id, "small ghost")}</div>`}</div>`;
  const r = reopenedFrom(d);
  if (r)
    html += `<div class="panel"><h3>${t("📨 Vaga reaberta")}</h3><p class="muted">${esc(reopenedText(r))}: ${btn("open", `${esc(r.company)} — ${esc(r.title)}`, r.id, "small")} <span class="faint">(${esc(stageOf(r.status)?.label ?? t(r.statusLabel))})</span>.</p>
      <p class="faint" style="margin-top:8px">${t("Como foi há mais de {days} dias, ou esta foi publicada depois, o agente trata como uma vaga nova da mesma empresa. Confira se vale se candidatar de novo.", { days: S.settings.repeatWindowDays ?? 90 })}</p></div>`;
  const c = d.openCheck;
  if (c && (CHECKABLE.includes(d.status) || d.status === "discarded")) {
    const [cls, text] = OPEN_TEXT[c.verdict] ?? OPEN_TEXT.sem_confirmacao;
    html += `<div class="panel"${c.verdict === "encerrada" ? ' style="border-color:var(--bad)"' : ""}><h3>${t("🔒 A vaga está aberta?")} <span class="faint" style="font-weight:400">· ${t("conferida em {date}", { date: dateText(c.at) })}</span></h3>
      <div class="status-line"><span class="chip ${cls}">${text}</span><span>${esc(c.reason)}</span></div>
      ${c.verdict === "encerrada" ? `<p class="faint" style="margin-top:8px">${t("Abra o link para ter certeza. Se ainda estiver aberta, use “Gerar mesmo assim”.")}</p>` : ""}</div>`;
  }
  return html;
}

/** Quadros de critérios eliminatórios, vaga fantasma e resultado da candidatura no resumo da gaveta. */
function priorityPanels(d) {
  let html = "";
  const MEETS = { sim: ["ok", "✓"], nao: ["bad", "✗"], incerto: ["", "?"] };
  if (d.knockouts?.length)
    html += `<div class="panel"${failedKnockouts(d).length ? ' style="border-color:var(--bad)"' : ""}><h3>${t("⛔ Critérios eliminatórios da vaga")}</h3>
      <ul class="knockouts">${d.knockouts
        .map((k) => {
          const [cls, mark] = MEETS[k.meets] ?? MEETS.incerto;
          return `<li><span class="chip ${cls}">${mark}</span><span>${esc(k.requirement)}${k.evidence ? `<small class="faint">${esc(k.evidence)}</small>` : ""}</span></li>`;
        })
        .join("")}</ul>
      <p class="faint" style="margin-top:8px">${
        failedKnockouts(d).length
          ? t("Plataformas costumam filtrar por esses critérios antes de alguém ler o currículo. A IA não descarta a vaga sozinha: a decisão é sua.")
          : t("✓ = o perfil comprova · ✗ = o perfil mostra que não atende · ? = o perfil não diz (confira antes de se candidatar)")
      }</p></div>`;
  if (d.ghost?.length && TO_SEND.includes(d.status))
    html += `<div class="panel"><h3>${t("👻 Pode ser vaga fantasma")}</h3><ul class="list-gap">${d.ghost.map((g) => `<li>${esc(GHOST_TEXT[g] ?? g)}</li>`).join("")}</ul>
      <p class="faint" style="margin-top:8px">${t("Nem todo anúncio tem contratação de verdade. A vaga desce na lista; se quiser, confira no site da empresa se ela ainda existe.")}</p></div>`;
  if (d.status === "rejected")
    html += `<div class="panel"><h3>${t("📝 Como terminou")}</h3><p>${
      d.outcome
        ? `${esc(STAGE_TEXT[d.outcome.stage] ?? d.outcome.stage)}${d.outcome.reason ? ` · ${esc(d.outcome.reason)}` : ""}`
        : `<span class="faint">${t("Etapa não registrada.")}</span>`
    }${d.respondedAt && d.appliedAt ? ` <span class="faint">· ${esc(t("resposta em {days}", { days: plural(daysBetween(d.appliedAt, d.respondedAt), "dia", "dias") }))}</span>` : ""}</p>
      <div class="btn-row" style="margin-top:10px">${btn("reject", d.outcome ? t("📝 Corrigir a etapa") : t("📝 Registrar como foi"), d.id, "small")}</div></div>`;
  return html;
}
const daysBetween = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));

/* Ficha de candidatura: os campos que os formulários pedem, cada um com o botão de copiar. */
function sheetTab(s) {
  const from =
    s.from === "pacote"
      ? t("Do currículo adaptado para esta vaga.")
      : t("Do seu currículo-base (esta vaga ainda não tem pacote; gerado o pacote, a ficha usa o currículo adaptado).");
  return `<div class="panel"><p class="muted">${t("Os campos que formulários como Gupy, InHire, Greenhouse e Workday pedem de novo, prontos para copiar.")} ${from} ${t("Perguntas como “por que você quer trabalhar aqui?” ficam na aba Perguntas.")}</p></div>
  ${s.sections
    .map(
      (sec, i) => `<section class="panel sheet"><h3>${esc(sec.title)}</h3>${sec.fields
        .map(
          (f, k) => `<div class="sheet-row${f.long ? " long" : ""}"><span class="sheet-label">${esc(f.label)}${f.long ? `<small>${t("{n} caracteres", { n: f.value.length })}</small>` : ""}</span>
          <div class="sheet-value">${esc(f.value)}</div>${btn("copy-sheet", "📋", `${i}:${k}`, "small ghost icon", t("Copiar: {label}", { label: f.label }))}</div>`,
        )
        .join("")}</section>`,
    )
    .join("")}`;
}

/* Perguntas do formulário de candidatura: pergunta → resposta, com ajustes. */
function answersTab(d) {
  const list = [...(d.answers ?? [])].reverse();
  return `<div class="panel answer-new">
    <h3>${t("Pergunta do formulário")}</h3>
    <p class="muted">${t("Cole a pergunta que o formulário de candidatura faz, como “Por que você quer trabalhar aqui?” ou “Fale de um projeto de que você se orgulha”. A IA responde com o seu perfil e com o que a vaga diz da empresa.")}</p>
    <label class="field"><span>${t("Pergunta")}</span><textarea id="ans-q" data-keep="ans-q" rows="3" placeholder="${esc(t("ex.: Por que você gostaria de trabalhar na {company}?", { company: d.company }))}"></textarea></label>
    <div class="ans-image"><label class="btn small">${t("📷 Ler a pergunta de um print")}<input type="file" id="ans-img" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label><span class="faint">${t("ou cole (Ctrl+V) ou arraste o print aqui")}</span></div>
    <div id="ans-found"></div>
    <label class="field"><span>${t("Limite de caracteres")} <small>${t("(se o formulário tiver)")}</small></span><input id="ans-limit" data-keep="ans-limit" type="number" min="50" max="20000" step="10" placeholder="${esc(t("ex.: 500"))}" style="max-width:180px"></label>
    <label class="field"><span>${t("O que só você sabe")} <small>${t("(opcional)")}</small></span><small>${t("Motivação, opinião sobre o produto, algo que não está no perfil. Vale só para esta resposta.")}</small><textarea id="ans-ctx" data-keep="ans-ctx" rows="2" placeholder="${esc(t("ex.: Uso o app deles há um ano e gosto de como resolvem X."))}"></textarea></label>
    <div class="btn-row">${btn("answer-ask", t("✍️ Responder"), d.id, "primary")}</div>
  </div>
  ${
    list.length
      ? list.map(answerCard).join("")
      : `<p class="faint" style="margin:4px 2px">${t("Nenhuma pergunta respondida ainda. As respostas ficam salvas aqui e em <code>perguntas_e_respostas.md</code>, na pasta do pacote.")}</p>`
  }`;
}

function answerCard(a) {
  const over = a.limit && a.answer.length > a.limit;
  return `<section class="panel answer">
    <h3>${esc(a.question)}</h3>
    <div class="message">${esc(a.answer)}</div>
    <div class="status-line" style="margin-top:8px">
      <span class="chip ${over ? "bad" : ""}">${a.limit ? t("{n} de {limit} caracteres", { n: a.answer.length, limit: a.limit }) : t("{n} caracteres", { n: a.answer.length })}</span>
      ${btn("answer-copy", t("📋 Copiar"), a.id, "small")}${btn("answer-delete", t("🗑 Apagar"), a.id, "small ghost")}
    </div>
    ${a.adjustments?.length ? `<p class="faint answer-history">${t("Ajustes pedidos:")} ${a.adjustments.map((x) => `“${esc(x)}”`).join(" · ")}</p>` : ""}
    ${a.warnings?.length ? `<p class="answer-warn">${t("⚠ Confira antes de usar:")} ${esc(a.warnings.join("; "))}</p>` : ""}
    ${a.needsYou?.length ? `<div class="answer-needs"><strong>${t("Para ficar com a sua cara, conte:")}</strong><ul>${a.needsYou.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
    <div class="answer-refine">
      <input type="text" data-keep="refine-${esc(a.id)}" maxlength="1000" placeholder="${esc(t("Ajustar: mais curto, cite o projeto X, em inglês… ou responda o que falta acima"))}" aria-label="${esc(t("O que ajustar nesta resposta"))}">
      ${btn("answer-refine", t("Ajustar"), a.id, "small")}
    </div>
  </section>`;
}

/** Botão com "escrevendo…" enquanto a IA trabalha (leva de 20 a 60 segundos). */
async function writingButton(el, run) {
  const label = el.innerHTML;
  el.innerHTML = `<span class="spin"></span> ${t("Escrevendo…")}`;
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
      [t("Relatório ATS (palavras-chave da vaga)"), d.docs.ats],
      [t("Nota do recrutador e o que faltou"), d.docs.rating],
      [t("Conferência com o seu perfil"), d.docs.coverage],
    ].filter(([, v]) => v);
    return `<div class="panel"><h3>${t("Arquivos")}</h3><div class="btn-row">${d.files.map((f) => link(f.url, `📄 ${esc(f.name)}`, "small")).join("")}${btn("folder", t("📁 Abrir pasta"), d.id, "small")}</div>
      <p class="faint" style="margin-top:8px">output/${esc(d.pkg.folder)}</p>
      <p class="muted" style="margin-top:10px">${t("Editou o <code>resume.json</code> ou o <code>cover_letter.json</code> na pasta?")} ${btn("rerender", t("🔄 Gerar o PDF de novo"), d.id, "small")}</p></div>
      ${d.docs.readme ? `<div class="panel md">${md(d.docs.readme)}</div>` : ""}
      ${reports.map(([title, v], i) => `<details class="panel md"${d.status === "low_fit" && i === 1 ? " open" : ""}><summary>${title}</summary>${md(v)}</details>`).join("")}`;
  }
  if (drawer.tab === "emails") {
    const e = d.docs.emails;
    const a = d.apply;
    const send = a
      ? `<div class="panel"><h3>${t("✉️ Enviar o e-mail de candidatura")}</h3>
        <p class="muted">${a.to ? t("Para <strong>{to}</strong>.", { to: esc(a.to) }) : t("A vaga não traz um e-mail de contato: preencha o destinatário.")} ${t("Nada é enviado sozinho: o e-mail abre pronto, você confere e clica em Enviar.")}</p>
        <div class="btn-row" style="margin-top:10px">${btn("email-draft", t("✉️ Abrir no programa de e-mail, com o currículo anexado"), d.id, "primary small", t("Outlook, Thunderbird ou o programa de e-mail do computador"))}${link(a.gmail, t("Abrir no Gmail"), "small")}${btn("folder", t("📁 Pasta do PDF"), d.id, "small ghost")}</div>
        <p class="faint" style="margin-top:8px">${a.attachments.length ? t("No programa de e-mail, {files} já vai anexado.", { files: esc(a.attachments.join(t(" e "))) }) : t("No programa de e-mail, anexe o currículo.")} ${t("No Gmail pelo navegador, arraste o PDF da pasta para o e-mail.")}</p></div>`
      : "";
    return `${send}${e.intro ? `<div class="panel md">${md(e.intro)}</div>` : ""}${e.sections
      .map(
        (s, i) => `<section class="email"><h3>${esc(s.title)}</h3>
        ${s.subjects.map((sub, k) => `<div class="subject"><span><span class="faint">${t("Assunto")}</span> ${esc(sub)}</span>${btn("copy-email", "📋", `s:${i}:${k}`, "small ghost icon", t("Copiar assunto"))}</div>`).join("")}
        ${s.notes ? `<div class="md muted">${md(s.notes)}</div>` : ""}
        <div class="message">${esc(s.message)}</div><div class="btn-row">${btn("copy-email", t("📋 Copiar mensagem"), `m:${i}`, "small")}${s.gmail ? link(s.gmail, t("Abrir no Gmail"), "small ghost") : ""}</div>
      </section>`,
      )
      .join("")}`;
  }
  if (drawer.tab === "ficha") return sheetTab(d.sheet);
  if (drawer.tab === "entrevista") return `<div class="panel md">${md(d.docs.interview)}</div>`;
  if (drawer.tab === "descricao") return `<div class="panel desc">${esc(d.description)}</div>`;

  const tri = d.triage;
  let html = `<div class="panel" style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">${gauges(job)}<p class="muted" style="flex:1;min-width:220px">${
    tri ? `${t("Aderência <strong>{fit}</strong> segundo a IA.", { fit: esc(FIT[tri.fit] ?? tri.fit) })} ${esc(tri.reason)}` : t("Esta vaga ainda não foi avaliada pela IA.")
  }</p></div>`;
  if (["applied", "interview", "offer", "rejected"].includes(d.status) && (d.appliedAt || d.notes))
    html += `<div class="panel"><h3>${t("Sua candidatura")}</h3><p>${d.appliedAt ? esc(t("Enviada em {date}", { date: dateText(d.appliedAt) })) : ""}${d.appliedViaLabel ? ` ${esc(t("via {channel}", { channel: t(d.appliedViaLabel) }))}` : ""}${d.notes ? ` · ${esc(d.notes)}` : ""}</p></div>`;
  if (tri?.scam?.length) html += `<div class="panel" style="border-color:var(--bad)"><h3>${t("🚩 Sinais de golpe")}</h3><p>${esc(tri.scam.join("; "))}</p></div>`;
  html += flagsPanels(d);
  html += priorityPanels(d);
  if (d.research) {
    const r = d.research;
    html += `<div class="panel"${r.verdict === "suspeita" ? ' style="border-color:var(--bad)"' : ""}><h3>${t("🔎 Pesquisa na web")} <span class="faint" style="font-weight:400">· ${dateText(r.at)}</span></h3>
      <div class="status-line">${researchChip(r)}</div>
      <div class="btn-row" style="margin-top:10px">${link(r.postingUrl, t("🔗 Anúncio oficial"), "small")}${link(r.companySite, t("🏢 Site da empresa"), "small")}</div>
      ${r.notes?.length ? `<ul class="${r.verdict === "confirmada" ? "list-ok" : "list-gap"}" style="margin-top:10px">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      ${
        r.culture?.length
          ? `<p style="margin-top:12px"><strong>${t("🏢 Missão e valores (página oficial)")}</strong></p><ul class="culture" style="margin-top:6px">${r.culture
              .map((c) => `<li>${esc(c.text)} ${link(c.source, t("fonte"), "small ghost")}</li>`)
              .join("")}</ul>`
          : ""
      }
      <p class="faint" style="margin-top:8px">${t("Os detalhes encontrados estão no fim da descrição da vaga e já valem para a triagem, o pacote e as respostas do formulário.")}</p></div>`;
  }
  if (d.evidence.length) html += `<div class="panel"><h3>${t("O que você já tem")}</h3><ul class="list-ok">${d.evidence.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  if (d.gaps.length) html += `<div class="panel"><h3>${t("Lacunas: requisitos sem evidência no seu perfil")}</h3><ul class="list-gap">${d.gaps.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  html += `<div class="panel"><h3>${t("Descrição")}</h3><div class="desc">${esc(d.description.slice(0, 1400))}${d.description.length > 1400 ? "…" : ""}</div>
    ${d.description.length > 1400 ? `<div style="margin-top:10px">${btn("dtab", t("Ler a descrição completa"), "descricao", "small")}</div>` : ""}</div>`;
  return html;
}

/* -------------------------------------------------------------------- ações */

async function setStatus(id, status, note = "", { quiet = false, via, stage, reason } = {}) {
  const r = await api(`/api/jobs/${encodeURIComponent(id)}/status`, { status, note, via, stage, reason });
  if (!quiet) {
    const dest = stageOf(status);
    toast(`${r.job.company} → ${dest?.label ?? t(r.job.statusLabel)}`, "", {
      label: t("Desfazer"),
      run: () => setStatus(id, r.previous, "", { quiet: true }).then(() => toast(t("Desfeito."))),
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
    <span>${t("Incluir busca na web com IA (LinkedIn, Gupy, Indeed)")}<small>${S.webSearch ? t("Acha mais vagas no Brasil, mas é mais lenta e usa mais a IA.") : t("A IA escolhida não faz busca na web.")}</small></span></label>
    ${withHint ? `<label class="field" id="web-hint"${on ? "" : " hidden"}><span>${t("Instrução extra para a busca na web")} <small>${t("(opcional)")}</small></span><input name="hint" placeholder="${esc(t("ex.: só vagas em Londrina, ou empresas de saúde"))}" autocomplete="off"></label>` : ""}`;
}
const toggleHint = (form) => {
  const web = form.elements.web;
  if (web && form.querySelector("#web-hint")) web.addEventListener("change", () => (form.querySelector("#web-hint").hidden = !web.checked));
};

export async function markApplied(id) {
  const j = findJob(id);
  const channels = Object.entries(S.applyChannels ?? {});
  const r = await modal({
    title: t("Marcar como enviada"),
    html: `<p><strong>${esc(j.company)}</strong> — ${esc(j.title)}</p>
      <p class="muted" style="margin-top:6px">${j.pkg ? t("A vaga vai para “Em andamento” e a pasta do pacote para <code>output/2-em-andamento</code>.") : t("A vaga vai para “Em andamento”.")} ${t("Daqui a 7 dias aparece o lembrete de follow-up.")}</p>
      <div class="field"><span>${t("Por onde você se candidatou?")}</span><small>${t("Com isso dá para ver depois qual canal responde mais.")}</small>
        <div class="via-grid">${channels
          .map(([v, label]) => `<label class="option"><input type="radio" name="via" value="${esc(v)}"${v === j.applyGuess ? " checked" : ""}><span>${esc(t(label))}</span></label>`)
          .join("")}</div></div>
      <label class="field"><span>${t("Observação")} <small>${t("(opcional)")}</small></span><input name="note" placeholder="${esc(t("ex.: indicação do Fulano, código da vaga 123"))}" autocomplete="off"></label>`,
    confirm: t("✅ Já me candidatei"),
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
  toast(t("📦 Pacote de {company} na fila. Leva alguns minutos; pode continuar usando.", { company: j?.company ?? t("vaga") }));
  await app.refresh();
});
action("tailor-anyway", async (id) => {
  const j = findJob(id);
  const ok = await modal({
    title: t("Gerar mesmo com a vaga encerrada?"),
    html: `<p><strong>${esc(j.company)}</strong> — ${esc(j.title)}</p>
      <p class="muted" style="margin-top:6px">${t("Na última conferência: {reason}. Abra o link e confira: se ela ainda aceita candidaturas, gere o pacote.", { reason: esc(j.openCheck?.reason ?? t("a página disse que a vaga acabou")) })}</p>
      ${j.url ? `<div class="btn-row" style="margin-top:10px">${link(j.url, t("🔗 Abrir a vaga"), "small")}</div>` : ""}`,
    confirm: t("📦 Gerar mesmo assim"),
  });
  if (!ok) return;
  await api(`/api/jobs/${encodeURIComponent(id)}/tailor`, { ignoreClosed: true });
  toast(t("📦 Pacote de {company} na fila.", { company: j.company }));
  await app.refresh();
});
action("check-open", async () => {
  await api("/api/check-open", {});
  toast(t("🔒 Conferindo as vagas que você ainda não enviou. As encerradas sem pacote vão para “Encerradas”."));
  await app.refresh();
});
action("not-duplicate", async (id) => {
  await api(`/api/jobs/${encodeURIComponent(id)}/not-duplicate`, {});
  toast(t("Marca de repetida tirada. O agente não marca esta vaga de novo."));
  await app.refresh();
  if (drawer.id === id) await reloadDrawer();
});
action("check-one", async (id) => {
  await api(`/api/jobs/${encodeURIComponent(id)}/check-open`, {});
  toast(t("🔒 Conferindo se a vaga ainda está aberta."));
  await app.refresh();
});
action("tailor-options", async (id) => {
  const j = findJob(id);
  const sel = (name, label, options) =>
    `<label class="field"><span>${label}</span><select name="${name}">${options.map(([v, text]) => `<option value="${v}">${text}</option>`).join("")}</select></label>`;
  const auto = t("Automático");
  const r = await modal({
    title: j.pkg ? t("Gerar o pacote de novo") : t("Gerar o pacote com opções"),
    html: `<p><strong>${esc(j.company)}</strong> — ${esc(j.title)}</p>
      <p class="muted" style="margin-top:6px">${t("Deixe em “automático” para o agente decidir pela vaga.")}${j.pkg ? ` ${t("O pacote atual continua na pasta; o novo vai para uma pasta própria.")}` : ""}</p>
      <div class="grid2">${sel("lang", t("Idioma do currículo"), [["", auto], ["pt-BR", t("Português")], ["en", t("Inglês")]])}${sel("paper", t("Papel"), [["", auto], ["A4", "A4"], ["Letter", t("Letter (EUA/Canadá)")]])}</div>
      <div class="grid2">${sel("market", t("Mercado"), [["", auto], ["BR", t("Brasil")], ["US", t("EUA")], ["CA", t("Canadá")], ["UK", t("Reino Unido")], ["EU", t("Europa")], ["LATAM", t("América Latina")], ["GLOBAL", t("Global")]])}${sel("cover", t("Carta de apresentação"), [["", auto], ["sim", t("Gerar")], ["nao", t("Não gerar")]])}</div>
      <label class="switch"><input type="checkbox" name="interview"><span>${t("Gerar também o guia de entrevista")}</span></label>
      ${isClosed(j) ? `<label class="switch"><input type="checkbox" name="ignoreClosed"><span>${t("Gerar mesmo com a vaga parecendo encerrada")}<small>${esc(j.openCheck.reason)}</small></span></label>` : ""}`,
    confirm: t("📦 Gerar"),
  });
  if (!r) return;
  await api(`/api/jobs/${encodeURIComponent(id)}/tailor`, r);
  toast(t("📦 Pacote de {company} na fila.", { company: j.company }));
  await app.refresh();
});
action("tailor-many", async () => {
  const st = STAGES[0];
  const jobs = sorted(st, S.jobs.filter((j) => st.statuses.includes(j.status))).slice(0, 25);
  const top = new Set(jobs.filter((j) => (j.triage?.score ?? 0) >= S.settings.minTriageScore && !j.triage?.scam?.length).slice(0, 3).map((j) => j.id));
  const r = await modal({
    title: t("Gerar vários pacotes"),
    wide: true,
    html: `<p class="muted">${t("Marque as vagas. Os pacotes entram na fila e são gerados um de cada vez (alguns minutos cada).")}</p>
      ${jobs
        .map(
          (j) => `<label class="option"><input type="checkbox" name="ids" data-list value="${esc(j.id)}"${top.has(j.id) ? " checked" : ""}>
          <span><b>${esc(j.company)}</b> — ${esc(j.title)}<br><small class="muted">${j.triage ? t("triagem {score}", { score: j.triage.score }) : t("sem triagem")}${j.triage?.scam?.length ? ` · ${t("🚩 sinais de golpe")}` : ""}</small></span></label>`,
        )
        .join("")}`,
    confirm: t("📦 Gerar os marcados"),
  });
  if (!r?.ids?.length) return;
  const res = await api("/api/tailor-many", { ids: r.ids });
  toast(`📦 ${plural(res.tasks.length, "pacote na fila", "pacotes na fila")}.`);
  await app.refresh();
});
action("retriage", async (id) => {
  await api(`/api/jobs/${encodeURIComponent(id)}/triage`, {});
  toast(t("🧠 Avaliando a vaga de novo."));
  await app.refresh();
});
action("research", async (id) => {
  await api(`/api/jobs/${encodeURIComponent(id)}/research`, {});
  toast(t("🔎 Pesquisando a vaga e a empresa na web."));
  await app.refresh();
});
action("rerender", async (id) => {
  await api(`/api/jobs/${encodeURIComponent(id)}/render`, {});
  toast(t("🔄 Gerando o PDF de novo."));
  await app.refresh();
});
action("applied", (id) => markApplied(id));
action("discard", (id) => setStatus(id, "discarded"));
action("status", (id, value) => setStatus(id, value));

/* --------------------------------------------- resultado, follow-up, canal e indicação */

const enc = encodeURIComponent;

/** Recusa com a etapa (e o motivo, se a empresa disse): é o que mostra onde as candidaturas travam. */
export async function rejectModal(id) {
  const j = findJob(id);
  if (!j) return;
  // Mesma regra de src/jobs/funnel.ts#defaultStage: sem retorno há muito tempo, a recusa provável é "sem resposta".
  const def = j.outcome?.stage ?? (["interview", "offer"].includes(j.status) ? "tecnica" : j.noReply ? "sem_resposta" : "triagem");
  const r = await modal({
    title: t("Como foi a recusa?"),
    wide: true,
    html: `<p><strong>${esc(j.company)}</strong> — ${esc(j.title)}</p>
      <p class="muted" style="margin-top:6px">${t("Registrar até onde o processo chegou mostra, com o tempo, onde as suas candidaturas travam (página Resultados).")}</p>
      <div class="field"><span>${t("Até onde chegou?")}</span><div class="via-grid">${Object.entries(STAGE_TEXT)
        .map(([v, label]) => `<label class="option"><input type="radio" name="stage" value="${v}"${v === def ? " checked" : ""}><span>${esc(label)}</span></label>`)
        .join("")}</div></div>
      <label class="field"><span>${t("Motivo")} <small>${t("(se a empresa disse)")}</small></span><input name="reason" maxlength="300" value="${esc(j.outcome?.reason ?? "")}" autocomplete="off"></label>
      <details class="panel"><summary>${t("📧 Colar o e-mail de recusa para a IA ler")}</summary>
        <textarea name="email" rows="5" placeholder="${esc(t("Cole aqui o e-mail que a empresa mandou"))}"></textarea>
        <div class="btn-row" style="margin-top:8px"><button type="button" class="small" data-read-email>${t("Ler o e-mail")}</button><span class="faint" data-read-status></span></div>
      </details>`,
    confirm: t("Registrar"),
    onOpen: (form) => {
      form.querySelector("[data-read-email]").onclick = async () => {
        const text = form.elements.email.value.trim();
        if (text.length < 20) return toast(t("Cole o e-mail de recusa."), "bad");
        const status = form.querySelector("[data-read-status]");
        status.textContent = t("Lendo…");
        try {
          const res = await api(`/api/jobs/${enc(id)}/rejection/read`, { text });
          const radio = [...form.querySelectorAll('input[name="stage"]')].find((x) => x.value === res.stage);
          if (radio) radio.checked = true;
          if (res.reason) form.elements.reason.value = res.reason;
          status.textContent = res.automated ? t("✓ Lido. Parece uma mensagem automática.") : t("✓ Lido. Confira a etapa e o motivo.");
        } catch (e) {
          status.textContent = "";
          toast(e.message, "bad");
        }
      };
    },
  });
  if (r) await setStatus(id, "rejected", "", { stage: r.stage, reason: r.reason });
}
action("reject", (id) => rejectModal(id));
action("no-reply", (id) => setStatus(id, "rejected", "", { stage: "sem_resposta" }));
action("followup-sent", async (id) => {
  await api(`/api/jobs/${enc(id)}/followup`, {});
  toast(t("✅ Follow-up registrado. O próximo lembrete vem em {days} dias, se não responderem.", { days: S.settings.followUpDays ?? 7 }));
  await app.refresh();
});

/** Canal de uma candidatura já enviada (para comparar os canais nos resultados). */
action("set-channel", async (id) => {
  const j = findJob(id);
  if (!j) return;
  const r = await modal({
    title: t("Por onde você se candidatou?"),
    html: `<p><strong>${esc(j.company)}</strong> — ${esc(j.title)}</p>
      <div class="via-grid" style="margin-top:10px">${Object.entries(S.applyChannels ?? {})
        .map(([v, label]) => `<label class="option"><input type="radio" name="via" value="${esc(v)}"${v === j.applyGuess ? " checked" : ""}><span>${esc(t(label))}</span></label>`)
        .join("")}</div>`,
    confirm: t("Salvar"),
  });
  if (!r?.via) return;
  await api(`/api/jobs/${enc(id)}/channel`, { via: r.via });
  toast(t("Canal salvo."));
  await app.refresh();
});

/**
 * Pedir indicação: o agente não entra no LinkedIn. Monta as buscas (a pessoa abre logada) e escreve as
 * mensagens só com fatos do perfil. Quem envia é a pessoa.
 */
async function referralModal(id) {
  const j = findJob(id);
  if (!j) return;
  const data = await api(`/api/jobs/${enc(id)}/referral`);
  let msgs = data.referral?.messages ?? null;
  const current = data.referral?.status ?? "";
  const msgHtml = (m) => `<p class="faint">${t("Para quem já conhece você")}</p><div class="message">${esc(m.warm)}</div>
    <div class="btn-row"><button type="button" class="small" data-copy="warm">${t("📋 Copiar")}</button></div>
    <p class="faint" style="margin-top:10px">${esc(t("Convite de conexão para quem não conhece você ({n}/300)", { n: m.cold.length }))}</p><div class="message">${esc(m.cold)}</div>
    <div class="btn-row"><button type="button" class="small" data-copy="cold">${t("📋 Copiar")}</button><button type="button" class="small ghost" data-write>${t("🔄 Escrever de novo")}</button></div>`;
  const options = [
    ["", t("Ainda não pedi")],
    ["pedida", t("Pedi a indicação")],
    ["recebida", t("Recebi a indicação")],
    ["sem_resposta", t("Ninguém respondeu")],
  ];
  const r = await modal({
    title: t("Pedir indicação"),
    wide: true,
    html: `<p><strong>${esc(j.company)}</strong> — ${esc(j.title)}</p>
      <p class="muted" style="margin-top:6px">${t("Indicação é o caminho que mais vira contratação. O agente não entra no LinkedIn: abra as buscas abaixo (logado), escolha alguém e mande a mensagem.")}</p>
      <div class="btn-row" style="margin-top:10px">${link(data.links.network, t("👥 Pessoas da empresa na sua rede"), "small")}${link(data.links.recruiters, t("🧑‍💼 Quem recruta lá"), "small")}</div>
      <div class="panel" style="margin-top:12px" data-ref-msgs>${msgs ? msgHtml(msgs) : `<p class="muted">${t("Mensagens curtas, só com fatos do seu perfil, sem inventar vínculo com ninguém.")}</p><div class="btn-row" style="margin-top:8px"><button type="button" class="small primary" data-write>${t("✍️ Escrever as mensagens")}</button></div>`}</div>
      <div class="field" style="margin-top:12px"><span>${t("Situação")}</span><div class="via-grid">${options
        .map(([v, label]) => `<label class="option"><input type="radio" name="status" value="${v}"${v === current ? " checked" : ""}><span>${esc(label)}</span></label>`)
        .join("")}</div><small>${t("Se ninguém responder em 3 dias, candidate-se pela plataforma: chegar cedo pesa mais que esperar.")}</small></div>`,
    confirm: t("Salvar"),
    onOpen: (form) => {
      const box = form.querySelector("[data-ref-msgs]");
      box.addEventListener("click", async (e) => {
        const copyBtn = e.target.closest("[data-copy]");
        if (copyBtn && msgs) return copy(msgs[copyBtn.dataset.copy]);
        const write = e.target.closest("[data-write]");
        if (!write) return;
        write.disabled = true;
        write.innerHTML = `<span class="spin"></span> ${t("Escrevendo…")}`;
        try {
          msgs = (await api(`/api/jobs/${enc(id)}/referral/messages`, { force: Boolean(msgs) })).messages;
          box.innerHTML = msgHtml(msgs);
        } catch (err) {
          toast(err.message, "bad");
          write.disabled = false;
          write.textContent = t("✍️ Escrever as mensagens");
        }
      });
    },
  });
  if (r && r.status && r.status !== current) {
    await api(`/api/jobs/${enc(id)}/referral`, { status: r.status });
    toast(r.status === "pedida" ? t("🤝 Registrado. Sem resposta em 3 dias, candidate-se pela plataforma.") : t("🤝 Registrado."));
  }
  await app.refresh();
}
action("referral", (id) => referralModal(id));
action("reopen", (id) => setStatus(id, reopenStatus(findJob(id))));
action("interview", async (id) => {
  const j = findJob(id);
  await setStatus(id, "interview", "", { quiet: true });
  const ok = await modal({
    title: t("Boa! Quer o guia de entrevista?"),
    html: `<p>${j?.pkg ? t("A IA prepara perguntas prováveis e respostas com base no currículo que você enviou para essa vaga.") : t("A IA prepara perguntas prováveis e respostas com base no seu currículo-base.")} ${t("Leva alguns minutos e roda em segundo plano.")}</p>`,
    confirm: t("🎤 Gerar guia"),
    cancel: t("Agora não"),
  });
  if (ok) await ACTIONS_guide(id);
});
async function ACTIONS_guide(id) {
  await api(`/api/jobs/${encodeURIComponent(id)}/interview`, {});
  toast(t("🎤 Guia de entrevista na fila."));
  await app.refresh();
}
action("guide", (id) => ACTIONS_guide(id));
action("folder", (id) => api(`/api/jobs/${encodeURIComponent(id)}/open-folder`, {}));
action("answer-ask", async (jobId, _arg, el) => {
  const question = $("#ans-q").value.trim();
  if (question.length < 5) return toast(t("Escreva a pergunta do formulário."), "bad");
  const limit = Number($("#ans-limit").value) || undefined;
  const context = $("#ans-ctx").value.trim();
  const ask = (skipResearch) => writingButton(el, () => api(`/api/jobs/${encodeURIComponent(jobId)}/answers`, { question, limit, context, skipResearch }));
  const first = await ask(false);
  // Pergunta sobre a empresa sem a missão e os valores pesquisados: o servidor sugere pesquisar antes.
  if (first.suggestResearch) {
    if ((await researchFirst(jobId, first.researching)) !== "answer") return;
    await ask(true);
  }
  for (const f of ["#ans-q", "#ans-limit", "#ans-ctx"]) if ($(f)) $(f).value = "";
  toast(t("✍️ Resposta pronta. Revise antes de colar no formulário."));
  if (drawer.id === jobId) await reloadDrawer();
});

/** Pesquisar a empresa antes de responder, ou responder só com o anúncio. Devolve "research", "answer" ou null. */
async function researchFirst(jobId, researching) {
  const r = await modal({
    title: t("Pesquisar a empresa antes de responder?"),
    html: `<p>${t("Essa pergunta é sobre a empresa, e o agente ainda não pesquisou a missão e os valores dela na página oficial. Sem isso, a resposta usa só o que o anúncio diz.")}</p>
      <p class="muted" style="margin-top:8px">${
        researching
          ? t("A pesquisa desta vaga já está rodando. Quando terminar, clique em ✍️ Responder de novo.")
          : t("A pesquisa leva cerca de um minuto. Quando terminar, clique em ✍️ Responder de novo: a pergunta continua no campo.")
      }</p>
      <div class="btn-row" style="margin-top:12px"><button type="button" class="small" data-anyway>${t("Responder só com o anúncio")}</button></div>
      <input type="hidden" name="choice" value="research">`,
    confirm: researching ? "" : t("🔎 Pesquisar primeiro"),
    cancel: researching ? t("Esperar") : t("Cancelar"),
    onOpen: (form) => {
      form.querySelector("[data-anyway]").onclick = () => {
        form.elements.choice.value = "answer";
        form.requestSubmit();
      };
    },
  });
  if (r?.choice === "research") {
    await api(`/api/jobs/${encodeURIComponent(jobId)}/research`, {});
    toast(t("🔎 Pesquisando a empresa. Quando terminar, clique em ✍️ Responder de novo."));
    await app.refresh();
  }
  return r?.choice ?? null;
}

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

/* Print da pergunta: a IA lê o texto e o limite de caracteres; a pessoa confere antes de responder. */
let foundQuestions = [];

/** Reduz prints grandes (lado maior até 2000 px) para caber no limite das IAs e subir rápido. */
async function shrinkImage(file) {
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 3_000_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise((r) => canvas.toBlob(r, "image/png"));
    return png && png.size < 4_000_000 ? png : await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  } catch {
    return file;
  }
}

function useFoundQuestion(q) {
  if ($("#ans-q")) $("#ans-q").value = q.question;
  if ($("#ans-limit")) $("#ans-limit").value = q.limit ?? "";
}

async function readQuestionImage(file) {
  const jobId = drawer.id;
  const box = $("#ans-found");
  if (!jobId || !box || !file) return;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast(t("Mande uma imagem PNG, JPG, WEBP ou GIF."), "bad");
  box.innerHTML = `<span class="busy"><span class="spin"></span>${t("Lendo a pergunta da imagem…")}</span>`;
  try {
    const blob = await shrinkImage(file);
    const r = await uploadFile(`/api/jobs/${encodeURIComponent(jobId)}/answers/image`, new File([blob], "pergunta", { type: blob.type }));
    foundQuestions = r.questions ?? [];
    const unreadable = r.unreadable ? `<p class="answer-warn">${esc(t("⚠ Parte da imagem não deu para ler: {what}", { what: r.unreadable }))}</p>` : "";
    if (!foundQuestions.length) box.innerHTML = `<p class="answer-warn">${t("Não achei uma pergunta de formulário na imagem.")}</p>${unreadable}`;
    else if (foundQuestions.length === 1) {
      useFoundQuestion(foundQuestions[0]);
      box.innerHTML = `<p class="faint">${t("✓ Pergunta lida da imagem. Confira o texto antes de responder.")}</p>${unreadable}`;
    } else
      box.innerHTML = `<div class="found-questions"><p class="faint">${t("{n} perguntas na imagem. Escolha qual responder:", { n: foundQuestions.length })}</p>${foundQuestions
        .map((q, i) => btn("use-found-question", `${esc(q.question)}${q.limit ? ` <small>(${esc(t("{n} caracteres", { n: q.limit }))})</small>` : ""}`, i, "small ghost"))
        .join("")}</div>${unreadable}`;
  } catch (e) {
    box.innerHTML = "";
    toast(e.message, "bad");
  }
}

action("use-found-question", (i) => {
  const q = foundQuestions[Number(i)];
  if (!q) return;
  useFoundQuestion(q);
  $("#ans-q")?.focus();
});
document.addEventListener("change", (e) => {
  if (e.target.id !== "ans-img") return;
  readQuestionImage(e.target.files?.[0]);
  e.target.value = "";
});
document.addEventListener("paste", (e) => {
  if (!e.target.closest?.(".answer-new")) return;
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
  if (!item) return;
  e.preventDefault();
  readQuestionImage(item.getAsFile());
});
document.addEventListener("dragover", (e) => {
  if (e.target.closest?.(".answer-new") && [...(e.dataTransfer?.types ?? [])].includes("Files")) e.preventDefault();
});
document.addEventListener("drop", (e) => {
  if (!e.target.closest?.(".answer-new")) return;
  const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
  if (!file) return;
  e.preventDefault();
  readQuestionImage(file);
});

action("answer-copy", async (answerId) => {
  const a = drawer.data?.answers?.find((x) => x.id === answerId);
  if (a) await copy(a.answer);
});

action("answer-delete", async (answerId) => {
  const jobId = drawer.id;
  const a = drawer.data?.answers?.find((x) => x.id === answerId);
  if (!a || !(await modal({ title: t("Apagar esta resposta?"), html: `<p class="muted">${esc(a.question)}</p>`, confirm: t("Apagar") }))) return;
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
  toast(t("✉️ Abrindo o e-mail no seu programa de e-mail. Confira e clique em Enviar."));
});
action("copy-email", async (ref) => {
  const e = drawer.data?.docs?.emails;
  if (!e) return;
  const [kind, i, k] = ref.split(":").map((x, n) => (n ? Number(x) : x));
  await copy(kind === "s" ? e.sections[i].subjects[k] : e.sections[i].message);
});

action("search", async () => {
  const r = await modal({
    title: t("Buscar vagas novas"),
    html: `<p class="muted">${t("Procura nas fontes das suas preferências. Depois a IA avalia cada vaga contra o seu perfil.")}</p>${webOption(true)}`,
    confirm: t("🔎 Buscar"),
    onOpen: toggleHint,
  });
  if (!r) return;
  await api("/api/search", { web: r.web, hint: r.web ? r.hint : "" });
  toast(t("🔎 Busca começou. As vagas aparecem em “Para decidir”."));
  await app.refresh();
});
action("auto", async () => {
  const r = await modal({
    title: t("Piloto automático"),
    html: `<p class="muted">${t("Busca vagas, a IA avalia e gera os pacotes das melhores (triagem ≥ {min}). Nada é enviado: no fim você só revisa.", { min: S.settings.minTriageScore })}</p>
      ${webOption()}
      <label class="field"><span>${t("Quantos pacotes gerar no máximo")}</span><input type="number" name="max" min="0" max="15" value="3" required></label>
      <label class="switch"><input type="checkbox" name="interview"><span>${t("Gerar também o guia de entrevista de cada pacote")}</span></label>`,
    confirm: t("🚀 Começar"),
  });
  if (!r) return;
  await api("/api/auto", { web: r.web, max: Number(r.max), interview: r.interview });
  toast(t("🚀 Piloto automático começou. Acompanhe no canto da tela."));
  await app.refresh();
});
action("triage", async () => {
  await api("/api/triage", {});
  toast(t("🧠 Avaliando as vagas novas."));
  await app.refresh();
});
action("paste", async () => {
  const r = await modal({
    title: t("Colar uma vaga"),
    wide: true,
    html: `<p class="muted">${t("Para vagas do LinkedIn, da Gupy, ou que chegaram por indicação, e-mail ou WhatsApp, mesmo sem link. A IA avalia na hora e você gera o pacote como qualquer outra vaga.")}</p>
      <label class="field"><span>${t("Texto da vaga")}</span><small>${t("Cole tudo o que você recebeu: requisitos, como é a equipe, e-mail para enviar o currículo, prazo. Se a página da vaga abre sem login (Gupy, site da empresa), pode informar só o link. Do LinkedIn, cole o texto.")}</small><textarea name="text" rows="9" placeholder="${esc(t("ex.: A Empresa X está contratando Desenvolvedor Full Stack Pleno para o time de pagamentos. Requisitos: Node.js, React… Currículo para vagas@empresax.com.br até 20/11."))}"></textarea></label>
      <label class="field"><span>${t("Link da vaga")} <small>${t("(se tiver)")}</small></span><input name="url" type="url" placeholder="https://…" autocomplete="off"></label>
      <div class="grid2"><label class="field"><span>${t("Empresa")}</span><input name="company" autocomplete="off"></label><label class="field"><span>${t("Cargo")}</span><input name="title" autocomplete="off"></label></div>
      <label class="field"><span>${t("Local")} <small>${t("(opcional)")}</small></span><input name="location" placeholder="${esc(t("ex.: Remoto, Londrina (híbrido)"))}" autocomplete="off"></label>
      <label class="switch"><input type="checkbox" name="research"${S.webSearch ? " checked" : " disabled"}>
        <span>${t("🔎 Pesquisar a vaga e a empresa na web")}<small>${
          S.webSearch
            ? t("Acha o anúncio oficial e o site da empresa, completa o que faltar (requisitos, como se candidatar) e confere se a vaga é real. Por exemplo, se o e-mail bate com o domínio da empresa.")
            : t("A IA escolhida não faz busca na web.")
        }</small></span></label>`,
    confirm: t("Adicionar e avaliar"),
    onOpen: (form) => {
      // Texto completo, ou só o link (o agente lê a página). Valida antes de fechar a janela, sem perder o que foi colado.
      const check = () => {
        const text = form.elements.text.value.trim();
        const url = form.elements.url.value.trim();
        form.elements.text.setCustomValidity(
          text && text.length < 80 ? t("O texto está curto demais: cole a descrição inteira.") : !text && !url ? t("Cole o texto completo da vaga ou informe o link.") : "",
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
    `${t("➕ {company} adicionada.", { company: res.job.company })} ${r.research && S.webSearch ? t("A IA vai pesquisar a vaga na web e avaliar.") : t("A IA está avaliando.")}${
      same ? ` ${t("🔁 Parece a mesma vaga que {job}: confira antes de gerar outro pacote.", { job: `${same.company} — ${same.title}` })}` : ""
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
      { group: t("Vagas"), ico: "💼", text: `${j.company} — ${j.title}`, sub: stageOf(j.status)?.label, run: () => openDrawer(j.id) },
      ...(SENDABLE.includes(j.status) ? [{ group: t("Vagas"), ico: "✅", text: t("Já me candidatei: {company}", { company: j.company }), sub: j.title, run: () => markApplied(j.id) }] : []),
      ...(["discarded", "rejected"].includes(j.status)
        ? []
        : [{ group: t("Vagas"), ico: "📝", text: t("Responder pergunta do formulário: {company}", { company: j.company }), sub: j.title, run: () => openDrawer(j.id, "perguntas") }]),
    ]);
}
