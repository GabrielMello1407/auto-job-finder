// Preferências de busca: cargos, termos, filtros de título, regiões, fontes e notas mínimas.
import { $, action, api, app, btn, copy, esc, formData, link, S, t, tagsField, toast } from "./core.js";

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

/*
 * Google for Jobs pela SerpApi (src/jobs/sources/googlejobs.ts). A chave vai para o .env e nunca volta para a
 * página: aqui só dá para colar uma nova, testar ou remover.
 */
function googleJobsBlock(p) {
  const g = data.googleJobs;
  return `<div class="panel inset" id="google-jobs">
    <h4>${t("Google for Jobs")}</h4>
    <p class="muted">${t("Traz as vagas que o Google reúne de LinkedIn, Indeed, Glassdoor e páginas de carreira, já com a descrição completa e sem IA navegando: bem mais barato e rápido que a busca na web. Usa a API da SerpApi, que pede uma chave. O plano gratuito tem 250 buscas por mês. Depois de salvar a chave, ligue a fonte googlejobs acima.")}</p>
    <p>${g.hasKey ? `<span class="chip ok">${t("✅ chave configurada")}</span>` : `<span class="chip warn">${t("sem chave")}</span>`}</p>
    <div class="btn-row">${link(g.signupUrl, t("Criar conta grátis na SerpApi"), "small")}${link(g.keyUrl, t("Onde está a minha chave"), "small")}</div>
    <label class="field"><span>${g.hasKey ? t("Trocar a chave") : t("Chave da SerpApi")}</span><small>${t("Fica só no arquivo .env deste computador e não aparece de novo na tela.")}</small><input type="password" name="serpapiKey" autocomplete="off" spellcheck="false" placeholder="${esc(g.hasKey ? t("deixe vazio para manter a atual") : t("cole a chave aqui"))}"></label>
    <div class="btn-row"><button type="button" class="small" data-act="googlejobs-test">${t("🔌 Testar a chave")}</button><span class="muted" id="gj-test-out"></span></div>
    ${g.hasKey ? `<label class="switch"><input type="checkbox" name="serpapiKeyRemove"><span>${t("Remover a chave salva")}</span></label>` : ""}
    <label class="field"><span>${t("Termos de busca por rodada")}</span><small>${t("Cada termo gasta 1 busca da sua cota. Com 3 por rodada e uma busca por dia, são umas 90 por mês.")}</small><input type="number" name="googleJobsMaxQueries" min="1" max="10" value="${esc(p.googleJobs?.maxQueries ?? 3)}" style="max-width:140px"></label>
  </div>`;
}

action("googlejobs-test", async () => {
  const out = $("#gj-test-out");
  out.textContent = t("testando… (gasta 1 busca da cota)");
  try {
    const r = await api("/api/preferences/googlejobs/test", { key: $("#prefs").elements.serpapiKey.value.trim() });
    out.textContent = t("✅ A chave funciona: {n} vaga(s) para o primeiro termo de busca.", { n: r.count });
  } catch (e) {
    out.textContent = `❌ ${e.message}`;
  }
});

/*
 * Preencher formulários (src/autofill/): o favorito "Preencher com ajf" e os grupos de campos. O link do
 * favorito é código gerado pelo servidor, sem dado da pessoa; clicar nele aqui só explica como instalar.
 */
function autofillBlock(a) {
  const group = (name, on, label) => `<label class="option"><input type="checkbox" name="${name}"${on ? " checked" : ""}><span>${label}</span></label>`;
  return `<div class="panel inset" id="autofill">
    <h4>${t("🪄 Preencher formulários com um clique")}</h4>
    <p class="muted">${t("Um favorito do navegador preenche os campos do formulário de candidatura (Greenhouse, Lever, Ashby, Workable, sites de empresas) com os seus dados. Você copia os dados da vaga no ajf, abre o formulário, clica no favorito e cola. Ele preenche só os campos vazios que reconhece, não anexa arquivos e nunca clica em Enviar.")}</p>
    <label class="switch"><input type="checkbox" name="autofillEnabled"${a.enabled ? " checked" : ""}><span>${t("Ligar o preenchimento de formulários")}<small>${t("Mostra o botão 🪄 Copiar para o preenchimento no modo candidatura e na ficha da vaga.")}</small></span></label>
    <div class="field"><span>${t("O que preencher")}</span><div class="via-grid">
      ${group("autofillContact", a.contact !== false, t("Nome, e-mail e telefone"))}
      ${group("autofillLinks", a.links !== false, t("LinkedIn, GitHub e site"))}
      ${group("autofillLocation", a.location !== false, t("Cidade"))}
      ${group("autofillCurrent", a.current !== false, t("Empresa e cargo atuais"))}
      ${group("autofillMessage", a.message !== false, t("Mensagem curta (campo de mensagem ou carta)"))}
      ${group("autofillFacts", Boolean(a.facts), t("Respostas fixas (pretensão, disponibilidade, visto)"))}
    </div><small>${t("As respostas fixas só entram em campos de texto que perguntam exatamente isso. Confira sempre antes de enviar.")}</small></div>
    <div class="field"><span>${t("Instalar o favorito")}</span><small>${t("Mostre a barra de favoritos (Ctrl+Shift+B no Chrome e no Edge, Cmd+Shift+B no Mac) e arraste o botão abaixo para ela. Não dá para arrastar? Copie o código, crie um favorito e cole no lugar do endereço.")}</small>
      <div class="btn-row"><a class="btn primary small" id="ajf-bookmarklet" href="${esc(data.bookmarklet)}" draggable="true">${t("🪄 Preencher com ajf")}</a>${btn("bookmarklet-copy", t("📋 Copiar o código do favorito"), null, "small ghost")}</div></div>
  </div>`;
}

action("bookmarklet-copy", async () => {
  await copy(data.bookmarklet);
  toast(t("Código copiado. Crie um favorito e cole no lugar do endereço."));
});

/* Busca automática (src/routine.ts): ao abrir o app e/ou todo dia pelo agendador do sistema. */
const TRIGGER = { abrir: t("ao abrir o app"), agenda: t("agendada"), manual: t("pelo terminal") };
function routineStatus() {
  const r = data.routine;
  const sched = r.schedule
    ? `<p class="muted">${t("✅ Agendada todo dia às {time} ({scheduler}).", { time: esc(r.schedule.time), scheduler: esc(t(r.scheduler ?? "")) })}</p>`
    : "";
  const runs = (r.runs ?? []).slice(0, 3).map((x) => {
    const when = new Date(x.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
    return `<li>${esc(when)} · ${esc(TRIGGER[x.trigger] ?? x.trigger)} · ${
      x.ok ? esc(t("{n} nova(s), {top} recomendada(s)", { n: x.added, top: x.recommended })) : `<span class="bad-text">${esc(t("falhou: {error}", { error: x.errors.join(" | ") }))}</span>`
    }</li>`;
  });
  return `${sched}${runs.length ? `<div class="field"><span>${t("Últimas buscas automáticas")}</span><ul class="plain-list">${runs.join("")}</ul></div>` : ""}`;
}
function autoSearchSection(a) {
  const scheduler = data.routine.scheduler;
  return section(
    t("⏰ Busca automática"),
    t("A maior parte das candidaturas chega nos primeiros dias depois que a vaga sai. Com a busca automática, você vê as vagas no dia em que aparecem."),
    `<label class="switch"><input type="checkbox" name="autoOnOpen"${a.onOpen ? " checked" : ""}><span>${t("Buscar ao abrir o app")}<small>${t("Quando você abre o app e a última busca automática foi há mais horas que o limite abaixo.")}</small></span></label>
    <label class="field"><span>${t("Buscar de novo depois de (horas)")}</span><input type="number" name="autoOnOpenHours" min="1" max="168" value="${esc(a.onOpenHours)}" style="max-width:140px"></label>
    <label class="switch"><input type="checkbox" name="autoDaily"${a.daily ? " checked" : ""}${scheduler ? "" : " disabled"}><span>${t("Buscar todo dia, mesmo com o app fechado")}<small>${
      !scheduler
        ? t("Este sistema não tem um agendador que o app saiba usar. Use a busca ao abrir o app.")
        : scheduler === "crontab"
          ? t("Usa o crontab deste computador. O computador precisa estar ligado no horário; se estiver desligado, a busca só roda no dia seguinte.")
          : t("Usa o {scheduler} deste computador. O computador precisa estar ligado; se estiver desligado no horário, a busca roda quando ele ligar.", { scheduler: esc(t(scheduler)) })
    }</small></span></label>
    <label class="field"><span>${t("Horário")}</span><input type="time" name="autoTime" value="${esc(a.time)}" style="max-width:140px"></label>
    <label class="switch"><input type="checkbox" name="autoTriage"${a.triage ? " checked" : ""}><span>${t("Avaliar as vagas novas com a IA")}<small>${t("A triagem roda logo depois da busca, e as vagas já chegam com nota.")}</small></span></label>
    <label class="switch"><input type="checkbox" name="autoWeb"${a.web ? " checked" : ""}${S.webSearch ? "" : " disabled"}><span>${t("Incluir a busca na web com IA")}<small>${t("Acha mais vagas (LinkedIn, Indeed, páginas de carreira), mas é a parte mais lenta e a que mais gasta a IA.")}</small></span></label>
    ${routineStatus()}`,
  );
}

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
      ${googleJobsBlock(p)}
      <label class="switch"><input type="checkbox" name="webSearchByDefault"${p.webSearchByDefault ? " checked" : ""}><span>${t("Buscar também na web com IA por padrão")}<small>${t("LinkedIn, Gupy, Indeed e sites de empresas. Mais vagas no Brasil, mas é mais lento e usa mais a IA.")}${S.webSearch ? "" : ` ${t("A IA escolhida não faz busca na web.")}`}</small></span></label>
      <label class="field"><span>${t("Dica para a busca na web")}</span><small>${t("Em uma ou duas frases: que vagas priorizar.")}</small><textarea name="webSearchHints" rows="3">${esc(p.webSearchHints)}</textarea></label>
      <label class="field"><span>${t("Ignorar vagas publicadas há mais de (dias)")}</span><input type="number" name="maxAgeDays" min="1" max="365" value="${esc(p.maxAgeDays)}"></label>`,
    )}
    ${autoSearchSection(p.autoSearch)}
    ${section(
      t("🧹 Filtro pelo título"),
      t("Corta vagas sem gastar IA. Sem acento e em minúsculas funciona melhor."),
      `${tags(t("O título precisa ter pelo menos um destes"), "titleMustInclude", p.titleMustInclude, t("Vazio aceita qualquer título."))}
      ${tags(t("O título não pode ter"), "titleExclude", p.titleExclude, t("Ex.: senioridades que você não quer, tecnologias fora do seu foco."))}`,
    )}
    ${section(
      t("📍 Onde"),
      "",
      `${tags(
        t("De onde você pode trabalhar (vagas remotas com restrição de país)"),
        "acceptedRegions",
        p.acceptedRegions,
        t("O seu país e regiões que o incluem: brasil, latam, americas, worldwide. Não coloque um país só porque a empresa é de lá: vaga “só Estados Unidos” exige morar e ter autorização de trabalho lá. Se você tem essa autorização, aí sim inclua o país."),
      )}
      ${tags(t("Cidades onde aceita presencial ou híbrido"), "onsiteCities", p.onsiteCities, t("Vazio = só remoto."))}
      <label class="switch"><input type="checkbox" name="relocateAbroad"${p.relocateAbroad ? " checked" : ""}><span>${t("✈️ Aceito me mudar para outro país se a empresa patrocinar o visto e a mudança")}<small>${t(
        "Vagas presenciais ou híbridas no exterior passam a aparecer. A triagem confere o que o anúncio diz sobre visto: se patrocina, a vaga ganha ✈️; se não diz, você pergunta ao recrutador antes; se não patrocina, ela desce. Vaga remota só para quem já mora em outro país continua de fora: a empresa não leva ninguém.",
      )}</small></span></label>
      ${tags(t("Países para onde aceita se mudar"), "relocationCountries", p.relocationCountries ?? [], t("Vazio = qualquer país. Só vale com a opção acima. Ex.: portugal, alemanha, canadá."))}`,
    )}
    ${section(
      t("🏢 Empresas"),
      "",
      `${tags(
        t("Empresas que você segue"),
        "followedCompanies",
        (p.followedCompanies ?? []).map((f) => f.name),
        t("As vagas delas sobem na lista e entram na busca na web. Dá para seguir direto pela vaga (☆ Seguir empresa): se o link for do Greenhouse, do Lever ou do Ashby, a página de carreira da empresa passa a ser monitorada na busca."),
      )}
      ${tags(t("Empresas que você não quer"), "excludedCompanies", p.excludedCompanies)}
      <div class="grid2">${tags("Greenhouse", "greenhouse", p.companyBoards.greenhouse, t("Empresas para monitorar (nome na URL do Greenhouse)."))}
      ${tags("Lever", "lever", p.companyBoards.lever, t("Nome na URL do Lever."))}</div>
      ${tags("Ashby", "ashby", p.companyBoards.ashby, t("Nome na URL do Ashby."))}`,
    )}
    ${section(
      t("📝 Respostas fixas dos formulários"),
      t("O que os formulários sempre perguntam e não está no currículo. Entra na ficha de candidatura, nas respostas às perguntas e na triagem (critérios eliminatórios, como visto e mudança de cidade). Vazio = não informado: a IA não inventa."),
      `<label class="field"><span>${t("Pretensão salarial")}</span><input name="salaryExpectation" value="${esc(p.applicationFacts.salaryExpectation)}" placeholder="${esc(t("ex.: R$ 8.000 a 9.000 CLT, ou US$ 4.000/mês PJ"))}" autocomplete="off"><small class="faint">${t("Um valor por tipo de contrato (CLT, PJ, vaga no exterior): a IA usa o do tipo da vaga e nunca converte sozinha. No Brasil, PJ costuma pedir de 30% a 50% a mais que CLT, para compensar 13º, férias e FGTS.")}</small></label>
      <div class="grid2"><label class="field"><span>${t("Disponibilidade para começar")}</span><input name="availability" value="${esc(p.applicationFacts.availability)}" placeholder="${esc(t("ex.: imediata, ou em 30 dias"))}" autocomplete="off"></label>
      <label class="field"><span>${t("Aviso prévio")}</span><input name="noticePeriod" value="${esc(p.applicationFacts.noticePeriod)}" placeholder="${esc(t("ex.: 30 dias, ou não tenho"))}" autocomplete="off"></label></div>
      <div class="grid2"><label class="field"><span>${t("Mudança de cidade")}</span><input name="relocation" value="${esc(p.applicationFacts.relocation)}" placeholder="${esc(t("ex.: não, só remoto; ou sim, para São Paulo"))}" autocomplete="off"></label>
      <label class="field"><span>${t("Autorização de trabalho / visto")}</span><input name="workAuthorization" value="${esc(p.applicationFacts.workAuthorization)}" placeholder="${esc(t("ex.: brasileiro; sem visto para os EUA, só como PJ remoto"))}" autocomplete="off"></label></div>`,
    )}
    ${section(
      t("📨 Candidatura e resultados"),
      "",
      `<label class="field"><span>${t("Tamanho do currículo")}</span><select name="resumePages">${[
        ["ate2", t("Até 2 páginas")],
        ["1", t("1 página")],
        ["auto", t("Automático: 1 página com menos de 3 anos de experiência com datas")],
      ]
        .map(([v, label]) => `<option value="${v}"${(p.resume?.pages ?? "ate2") === v ? " selected" : ""}>${esc(label)}</option>`)
        .join("")}</select><small class="faint">${t("Vale para os currículos-base e os pacotes, sem encher para chegar à segunda página. Em 1 página, o resumo e os tópicos encurtam antes das competências. Para mudar os currículos-base já feitos: Perfil → 🔄 Refazer currículos-base.")}</small></label>
      <label class="switch"><input type="checkbox" name="applyReferralStep"${p.applyMode?.referralStep !== false ? " checked" : ""}><span>${t("Mostrar o passo de pedir indicação no modo candidatura")}<small>${t("No modo candidatura (Vagas → Prontas → 📨 Modo candidatura), cada vaga mostra o passo opcional de pedir indicação antes de enviar.")}</small></span></label>
      <label class="switch"><input type="checkbox" name="compareResumes"${p.results?.compareResumes !== false ? " checked" : ""}><span>${t("Comparar as versões do currículo nos Resultados")}<small>${t("Mostra a taxa de resposta pelo topo do currículo (cargo no título, palavras-chave, números) e pela versão do currículo-base. Só aparece quando há dados para comparar.")}</small></span></label>
      ${autofillBlock(p.autofill ?? {})}`,
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
  // O favorito é para arrastar para a barra; clicado aqui, só explica.
  $("#ajf-bookmarklet")?.addEventListener("click", (e) => {
    e.preventDefault();
    toast(t("Arraste este botão para a barra de favoritos do navegador."));
  });
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
