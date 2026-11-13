// Resultados: o funil das candidaturas e o que funciona melhor (canal, fonte, prazo, nota). Dados de src/jobs/funnel.ts.
import { $, api, btn, esc, S, t } from "./core.js";
import { STAGE_TEXT } from "./jobs.js";

let data = null; // GET /api/funnel

export async function renderResultsPage() {
  data = await api("/api/funnel");
  paint();
}

/** Redesenha quando as vagas mudam (marcou uma recusa, registrou um canal...). */
export async function refreshResults() {
  if (!$("#results")) return;
  data = await api("/api/funnel");
  paint();
}

const LAG = { "0-3": t("até 3 dias"), "4-7": t("4 a 7 dias"), "8-14": t("8 a 14 dias"), "15+": t("15 dias ou mais"), "?": t("sem data de publicação") };
const SCORE = { "85+": t("85 ou mais"), "70-84": t("70 a 84"), "<70": t("abaixo de 70"), "?": t("sem triagem") };
const SOURCE = { web: t("busca na web"), manual: t("colada"), github: t("comunidades no GitHub") };
const channel = (key) => (key === "?" ? t("sem canal") : t(S.applyChannels?.[key] ?? key));
const pct = (r) => (r == null ? "–" : `${r}%`);
/** Grupo com poucas candidaturas com resultado: a % ainda não diz muito. */
const MIN = 3;

function insightText(i) {
  const v = i.vars;
  switch (i.code) {
    case "missing_outcome":
      return t("{n} recusa(s) sem a etapa registrada. Registre até onde chegou: é o que mostra onde o processo trava.", v);
    case "missing_channel":
      return t("{n} candidatura(s) sem o canal registrado. Sem ele não dá para comparar os canais.", v);
    case "small_sample":
      return t("Ainda são poucas candidaturas com resultado ({n}). As comparações ficam mais confiáveis a partir de umas 10 por grupo.", v);
    case "best_channel":
      return t("Por {best}, {bestRate}% das candidaturas tiveram resposta; por {worst}, {worstRate}%. Priorize o canal que responde mais.", { ...v, best: t(v.best), worst: t(v.worst) });
    case "early_better":
      return t("Enviadas até 7 dias depois da publicação: {early}% de resposta. Depois disso: {late}%. Candidate-se cedo.", v);
    case "screening":
      return t("{n} de {total} recusas vieram na triagem, antes de qualquer conversa. Confira os critérios eliminatórios e o topo do currículo (cargo e palavras-chave da vaga).", v);
    case "no_interviews":
      return t("{n} candidaturas com resultado e nenhuma entrevista ainda. Tente indicação e vagas mais recentes, e confira se a senioridade das vagas bate com a sua.", v);
    default:
      return "";
  }
}

function table(title, groups, label) {
  if (!groups?.length) return "";
  return `<section class="panel"><h3>${title}</h3><div class="table-wrap"><table class="data-table cols"><colgroup><col class="c-label"><col class="c-sent"><col><col></colgroup>
    <thead><tr><th></th><th>${t("Enviadas")}</th><th>${t("Resposta")}</th><th>${t("Entrevista")}</th></tr></thead>
    <tbody>${groups
      .map((g) => {
        const few = g.sent - g.pending < MIN;
        return `<tr${few ? ' class="few"' : ""}><th scope="row">${esc(label(g.key))}${few ? ` <small class="faint">${t("(poucas)")}</small>` : ""}</th><td>${g.sent}</td><td>${bar(g.replyRate)}</td><td>${bar(g.interviewRate)}</td></tr>`;
      })
      .join("")}</tbody></table></div></section>`;
}
const bar = (rate) => `<span class="rate"><span class="rate-bar" style="--p:${rate ?? 0}%"></span><b>${pct(rate)}</b></span>`;

function list(title, hint, jobs, actions) {
  if (!jobs?.length) return "";
  return `<section class="panel"><h3>${title}</h3><p class="muted">${hint}</p><ul class="todo">${jobs
    .map((j) => `<li><span><b>${esc(j.company)}</b> — ${esc(j.title)}</span><span class="btn-row">${actions(j)}</span></li>`)
    .join("")}</ul></section>`;
}

function paint() {
  const view = $("#view");
  if (!view || !data) return;
  const tot = data.totals;
  const head = `<header class="page-head"><div><h1>${t("Resultados")}</h1><p>${t("O que acontece com as suas candidaturas e o que funciona melhor. Só com o que você registrou: quanto mais completo, mais confiável.")}</p></div></header>`;
  if (!tot.sent) {
    view.innerHTML = `${head}<div id="results" class="empty"><div class="big">📊</div><p>${t("Nenhuma candidatura enviada ainda. Quando você marcar “Já me candidatei”, os números aparecem aqui.")}</p>${btn("go:vagas", t("Ver vagas"), null, "primary")}</div>`;
    return;
  }
  const kpi = (n, label, sub = "") => `<div class="kpi"><b>${n}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const kpis = `<div class="kpis">
    ${kpi(tot.sent, t("enviadas"))}
    ${kpi(pct(tot.replyRate), t("com resposta"), esc(t("{n} de {total}", { n: tot.replied, total: tot.sent - tot.pending })))}
    ${kpi(pct(tot.interviewRate), t("com entrevista"), esc(t("{n} de {total}", { n: tot.interviewed, total: tot.sent - tot.pending })))}
    ${kpi(tot.noReply, t("sem retorno"), esc(t("mais de {days} dias", { days: data.settings.noReplyDays })))}
    ${kpi(tot.pending, t("aguardando"))}
    ${data.medianDaysToReply != null ? kpi(data.medianDaysToReply, t("dias até a resposta"), t("mediana")) : ""}
  </div>`;
  const insights = data.insights.length ? `<section class="panel insights"><h3>${t("O que os números dizem")}</h3><ul>${data.insights.map((i) => `<li>${esc(insightText(i))}</li>`).join("")}</ul></section>` : "";
  const stages = data.stages.length
    ? `<section class="panel"><h3>${t("Onde as recusas aconteceram")}</h3><ul class="stage-bars">${data.stages
        .map((s) => {
          const total = data.stages.reduce((a, b) => a + b.count, 0);
          const label = s.stage === "sem_etapa" ? t("etapa não registrada") : (STAGE_TEXT[s.stage] ?? s.stage);
          return `<li><span>${esc(label)}</span>${bar(Math.round((s.count / total) * 100))}<b class="n">${s.count}</b></li>`;
        })
        .join("")}</ul></section>`
    : "";
  const todo =
    list(t("📝 Recusas sem a etapa"), t("Registre até onde cada uma chegou."), data.missingOutcome, (j) => btn("reject", t("📝 Registrar como foi"), j.id, "small")) +
    list(t("📨 Candidaturas sem o canal"), t("Informe por onde você se candidatou."), data.missingChannel, (j) => btn("set-channel", t("Informar o canal"), j.id, "small")) +
    list(
      t("⏰ Follow-ups para mandar"),
      t("O texto está na aba E-mails da vaga."),
      data.followUpsDue,
      // Sem pacote não há texto de follow-up pronto: só o registro.
      (j) => `${j.hasPackage ? btn("open:emails", t("📧 Ver follow-up"), j.id, "small") : ""}${btn("followup-sent", t("✅ Enviei"), j.id, "small ghost")}`,
    );
  view.innerHTML = `${head}<div id="results">
    ${kpis}
    <p class="faint" style="margin:-4px 2px 14px">${t("As porcentagens contam só as candidaturas que já têm resultado; as que estão aguardando ficam de fora.")}</p>
    ${insights}${todo}${stages}
    ${table(t("Por canal"), data.byChannel, channel)}
    ${table(t("Dias entre a publicação e o envio"), data.byLag, (k) => LAG[k] ?? k)}
    ${table(t("Por nota da triagem"), data.byScore, (k) => SCORE[k] ?? k)}
    ${table(t("Por fonte"), data.bySource, (k) => SOURCE[k] ?? k)}
  </div>`;
}
