// Perfil: assistente de cadastro (fontes → leitura pela IA → perguntas → vagas → montagem) e a página do perfil.
import { $, action, api, app, btn, diffHtml, esc, link, modal, mono, on, plural, S, t, tagsField, tagValues, toast, uploadFile } from "./core.js";
import { getLang } from "./i18n.js";

let profile = null; // GET /api/profile
const wiz = { sub: "questions", answers: {}, justBuilt: false };
let truthDraft = null; // edição não salva do profile_truth.md

export async function loadProfile() {
  profile = await api("/api/profile");
  emitPending();
  return profile;
}
export const pendingCount = () => profile?.pending?.length ?? 0;
function emitPending() {
  const pill = $("#nav-perfil");
  if (!pill) return;
  const n = pendingCount();
  pill.hidden = !n || !S.hasProfile;
  pill.textContent = n;
  pill.title = t("{items} a confirmar", { items: plural(n, "item", "itens") });
}

const running = (kind) => S.tasks.find((k) => k.kind === kind && (k.status === "queued" || k.status === "running"));
const lastLog = (task) => task?.log?.[task.log.length - 1] ?? t("Começando…");

/* =================================================================== assistente */

const STEPS = [
  ["sources", t("Suas fontes")],
  ["reading", t("Leitura")],
  ["questions", t("Perguntas")],
  ["choices", t("Vagas que você quer")],
  ["building", t("Montagem")],
];

function wizardStep() {
  if (running("profile-build")) return "building";
  if (wiz.justBuilt && S.hasProfile) return "done";
  if (running("profile-read")) return "reading";
  if (profile?.draft?.intake) return wiz.sub;
  return "sources";
}

export async function renderWizard() {
  await loadProfile();
  paintWizard();
}

function stepsBar(now) {
  const idx = STEPS.findIndex(([id]) => id === now);
  return `<div class="steps">${STEPS.map(([id, label], i) => `<span class="step ${i < idx || now === "done" ? "done" : i === idx ? "now" : ""}">${label}</span>`).join("")}</div>`;
}

export function paintWizard() {
  const view = $("#view");
  if (!view || !profile) return;
  const step = wizardStep();
  const head = `<header class="page-head"><div><h1>${S.hasProfile && step !== "done" ? t("Montar o perfil de novo") : t("Vamos montar seu perfil")}</h1>
    <p>${t("Tudo o que o agente escreve sobre você sai daqui. Ele nunca inventa: o que faltar vira pergunta.")}</p></div>
    ${S.hasProfile && step !== "building" && step !== "done" ? btn("go:perfil", t("Cancelar"), null, "ghost") : ""}</header>`;
  const noIa = !S.provider?.active
    ? `<div class="banner"><span>${t("🤖 Primeiro escolha qual IA o agente vai usar (Claude, ChatGPT, Gemini…).")}</span>${btn("ia", t("Escolher IA"), null, "primary small")}</div>`
    : "";
  const body = {
    sources: wizSources,
    reading: () => waitScreen(t("A IA está lendo suas fontes"), t("Ela vai resumir o que entendeu e perguntar só o que falta para o currículo ficar completo e verdadeiro."), running("profile-read")),
    questions: wizQuestions,
    choices: wizChoices,
    building: () => waitScreen(t("Montando seu perfil"), t("Organizando sua carreira, escrevendo os currículos-base em português e inglês e as regras do que nunca afirmar. Leva alguns minutos."), running("profile-build")),
    done: wizDone,
  }[step]();
  view.innerHTML = `${head}${step === "done" ? "" : stepsBar(step)}${noIa}${body}`;
  if (step === "sources") bindDrop();
  if (step === "choices") bindChoices();
}

function waitScreen(title, text, task) {
  return `<div class="panel wait"><div class="spin lg"></div><h2>${esc(title)}…</h2><p class="muted">${esc(text)}</p><p class="faint" id="wait-log">${esc(lastLog(task))}</p></div>`;
}

/** Nome da fonte: o começo fixo ("Currículo/documento: arquivo.pdf") é traduzido; o nome do arquivo não. */
const sourceLabel = (label) => {
  const i = label.indexOf(": ");
  return i > 0 ? `${t(label.slice(0, i))}${label.slice(i)}` : t(label);
};

const KIND = { curriculo: "📄", linkedin: "💼", portfolio: "🎨", github: "🐙", site: "🌐", texto: "📝", respostas: "🗣" };

function wizSources() {
  const d = profile.draft;
  return `
  <label class="drop" id="drop">
    <input type="file" id="files" multiple accept=".pdf,.docx,.txt,.md" hidden>
    <div class="big">📄</div><b>${t("Arraste seu currículo aqui")}</b>
    <span>${t("ou clique para escolher · PDF, DOCX ou TXT · vale também o PDF do LinkedIn e o do portfólio")}</span>
  </label>
  <div class="ways">
    <button type="button" class="way" data-act="src-link"><b>${t("🌐 Um link")}</b><span>${t("Portfólio, site pessoal ou GitHub")}</span></button>
    <button type="button" class="way" data-act="src-text"><b>${t("📝 Colar texto")}</b><span>${t("Seu “Sobre” do LinkedIn, uma descrição da carreira")}</span></button>
    <button type="button" class="way" data-act="src-interview"><b>${t("🗣 Não tenho currículo")}</b><span>${t("Responda algumas perguntas e eu monto")}</span></button>
  </div>
  <details class="panel" style="margin-top:12px"><summary>${t("Como baixar o PDF do seu LinkedIn")}</summary><p class="muted">${esc(t(profile.linkedinHelp))}</p></details>
  <div class="sources" id="sources">${
    d.sources.length
      ? d.sources
          .map(
            (s) => `<div class="source"><span style="font-size:20px">${KIND[s.kind] ?? "📄"}</span><div class="txt"><b>${esc(sourceLabel(s.label))}</b><span>${t("{n} caracteres lidos", { n: s.chars.toLocaleString(getLang()) })}</span></div>${btn("src-remove", "✕", s.index, "ghost small icon", t("Remover"))}</div>`,
          )
          .join("")
      : ""
  }</div>
  <div class="btn-row" style="justify-content:flex-end;margin-top:18px">
    <button type="button" class="primary" data-act="wiz-read"${d.sources.length && S.provider?.active ? "" : " disabled"}>${t("Ler minhas fontes com a IA →")}</button>
  </div>`;
}

function bindDrop() {
  const drop = $("#drop");
  const input = $("#files");
  input.addEventListener("change", () => upload([...input.files]));
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add("over")));
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    upload([...e.dataTransfer.files]);
  });
}

async function upload(files) {
  for (const f of files) {
    toast(t("Lendo {file}…", { file: f.name }));
    try {
      const data = await uploadFile("/api/profile/upload", f);
      profile.draft = data;
      const added = data.sources[data.sources.length - 1];
      toast(added?.kind === "linkedin" ? t("✅ Reconheci o PDF do LinkedIn.") : t("✅ {file} lido.", { file: f.name }));
    } catch (e) {
      toast(`${f.name}: ${e.message}`, "bad");
    }
  }
  paintWizard();
}

async function addSource(body, busyText) {
  toast(busyText);
  profile.draft = await api("/api/profile/sources", body);
  paintWizard();
}

action("src-link", async () => {
  const r = await modal({
    title: t("Adicionar um link"),
    html: `<p class="muted">${t("Portfólio, site pessoal ou perfil do GitHub. O LinkedIn bloqueia leitura automática: para ele, use o PDF.")}</p>
      <label class="field"><span>${t("Link")}</span><input name="url" type="url" required placeholder="${esc(t("https://meusite.com ou https://github.com/usuario"))}" autocomplete="off"></label>`,
    confirm: t("Adicionar"),
  });
  if (r) await addSource({ type: "link", url: r.url }, t("Lendo o link… sites feitos em JavaScript podem levar alguns segundos."));
});
action("src-text", async () => {
  const r = await modal({
    title: t("Colar texto"),
    wide: true,
    html: `<label class="field"><span>${t("Texto sobre a sua carreira")}</span><small>${t("O “Sobre” e as experiências do LinkedIn, uma descrição sua, o que tiver.")}</small><textarea name="text" rows="12" required minlength="40"></textarea></label>`,
    confirm: t("Adicionar"),
  });
  if (r) await addSource({ type: "text", text: r.text }, t("Adicionando o texto…"));
});
action("src-interview", async () => {
  const exp = (i) => `<fieldset class="panel" style="margin-top:12px"><legend class="muted">${t("Experiência {n}", { n: i + 1 })}</legend>
    <div class="grid2"><label class="field"><span>${t("Empresa ou organização")}</span><input name="e${i}company"></label><label class="field"><span>${t("Cargo")}</span><input name="e${i}title"></label></div>
    <div class="grid2"><label class="field"><span>${t("Início (MM/AAAA)")}</span><input name="e${i}start"></label><label class="field"><span>${t("Fim (MM/AAAA ou Atual)")}</span><input name="e${i}end"></label></div>
    <label class="field"><span>${t("O que você fazia e quais resultados")}</span><small>${t("Use números reais se tiver.")}</small><textarea name="e${i}description" rows="3"></textarea></label></fieldset>`;
  const r = await modal({
    title: t("Vamos do zero"),
    wide: true,
    html: `<p class="muted">${t("Responda com suas palavras. Pode deixar em branco o que não tiver.")}</p>
      <div class="grid2"><label class="field"><span>${t("Nome completo")}</span><input name="name"></label><label class="field"><span>${t("Cidade/UF")}</span><input name="city" placeholder="${esc(t("Londrina, PR"))}"></label></div>
      <div class="grid2"><label class="field"><span>${t("E-mail profissional")}</span><input name="email" type="text"></label><label class="field"><span>${t("Telefone/WhatsApp")}</span><input name="phone"></label></div>
      <div class="grid2"><label class="field"><span>LinkedIn</span><input name="linkedin"></label><label class="field"><span>${t("Portfólio, site ou GitHub")}</span><input name="portfolio"></label></div>
      <label class="field"><span>${t("Qual cargo ou área você quer?")}</span><input name="goal"></label>
      <div id="exps">${exp(0)}</div>
      <button type="button" class="small" id="add-exp">${t("＋ Outra experiência")}</button>
      <label class="field"><span>${t("Formação")}</span><input name="education" placeholder="${esc(t("Curso, instituição, período"))}"></label>
      <label class="field"><span>${t("Cursos e certificações")}</span><small>${t("Diga quais são certificações oficiais e quais são cursos.")}</small><textarea name="courses" rows="2"></textarea></label>
      <label class="field"><span>${t("Ferramentas, sistemas e competências")}</span><textarea name="skills" rows="2"></textarea></label>
      <label class="field"><span>${t("Idiomas e nível")}</span><input name="languages" placeholder="${esc(t("Inglês intermediário"))}"></label>
      <label class="field"><span>${t("Um resultado de que você se orgulha")}</span><textarea name="achievements" rows="2"></textarea></label>`,
    confirm: t("Adicionar respostas"),
    onOpen: (form) => {
      let n = 1;
      form.querySelector("#add-exp").onclick = () => form.querySelector("#exps").insertAdjacentHTML("beforeend", exp(n++));
    },
  });
  if (!r) return;
  const experiences = [];
  for (let i = 0; `e${i}company` in r; i++)
    experiences.push({ company: r[`e${i}company`], title: r[`e${i}title`], start: r[`e${i}start`], end: r[`e${i}end`], description: r[`e${i}description`] });
  const { name, city, email, phone, linkedin, portfolio, goal, education, courses, skills, languages, achievements } = r;
  await addSource({ type: "interview", answers: { name, city, email, phone, linkedin, portfolio, goal, education, courses, skills, languages, achievements, experiences } }, t("Adicionando suas respostas…"));
});
action("src-remove", async (i) => {
  profile.draft = await api(`/api/profile/sources/${i}`, undefined, "DELETE");
  paintWizard();
});
action("wiz-read", async () => {
  await api("/api/profile/read", {});
  wiz.sub = "questions";
  wiz.answers = {};
  wiz.choices = null; // cargos sugeridos vêm da nova leitura
  await app.refresh();
  paintWizard();
});

function wizQuestions() {
  const it = profile.draft.intake;
  return `<div class="understood"><span class="faint">${t("Entendi assim:")}</span><br>${esc(it.understood)}</div>
  <form id="wiz-q" class="panel">
    <h3>${it.questions.length ? t("Algumas perguntas para o currículo ficar completo e verdadeiro") : t("Não tenho perguntas: entendi tudo.")}</h3>
    ${it.questions.length ? `<p class="muted">${t("Responda o que souber. Em branco, o ponto fica marcado como “a confirmar” no perfil.")}</p>` : ""}
    ${it.questions
      .map(
        (q, i) => `<label class="field"><span>${i + 1}. ${esc(q.question)}</span><small>${esc(q.why)}</small><textarea name="q${i}" rows="2">${esc(wiz.answers[i] ?? "")}</textarea></label>`,
      )
      .join("")}
  </form>
  <div class="btn-row" style="justify-content:space-between;margin-top:16px">${btn("wiz-back-sources", t("← Voltar às fontes"), null, "ghost")}${btn("wiz-to-choices", t("Continuar →"), null, "primary")}</div>`;
}
function keepAnswers() {
  const form = $("#wiz-q");
  if (!form) return;
  profile.draft.intake.questions.forEach((_q, i) => (wiz.answers[i] = form.elements[`q${i}`]?.value ?? ""));
}
action("wiz-back-sources", async () => {
  keepAnswers();
  const ok = await modal({ title: t("Voltar às fontes?"), html: `<p>${t("Se você mudar as fontes, a IA lê tudo de novo e as perguntas podem mudar.")}</p>`, confirm: t("Voltar") });
  if (!ok) return;
  profile.draft.intake = null;
  paintWizard();
});
action("wiz-to-choices", () => {
  keepAnswers();
  wiz.sub = "choices";
  paintWizard();
  window.scrollTo({ top: 0 });
});

function wizChoices() {
  const it = profile.draft.intake;
  const c = wiz.choices ?? { roles: it.suggestedTargetRoles, extra: [], seniority: it.seniority, mode: "remoto", cities: [], country: "Brasil", timezone: "UTC-3", international: false };
  wiz.choices = c;
  return `<form id="wiz-c">
  <div class="panel"><h3>${t("Que cargos você quer?")}</h3><p class="muted">${t("Sugestões a partir do que você enviou. Desmarque o que não quiser e adicione outros.")}</p>
    <div class="btn-row" style="margin-top:10px">${it.suggestedTargetRoles
      .map((r) => `<label class="toggle-tag"><input type="checkbox" name="roles" data-list value="${esc(r)}"${c.roles.includes(r) ? " checked" : ""}><span>${esc(r)}</span></label>`)
      .join("")}</div>
    <div class="field"><span>${t("Outros cargos")}</span>${tagsField("extra", c.extra, t("Digite um cargo e aperte Enter"))}</div>
    <label class="field"><span>${t("Senioridade que você busca")}</span><input name="seniority" value="${esc(c.seniority)}"></label>
  </div>
  <div class="panel"><h3>${t("Como você quer trabalhar?")}</h3>
    ${[
      ["remoto", t("Só remoto"), t("Vagas 100% remotas.")],
      ["remoto+regiao", t("Remoto, ou híbrido/presencial na minha região"), t("Remoto em qualquer lugar e presencial só nas cidades que você indicar.")],
      ["qualquer", t("Qualquer modalidade, na minha região"), t("Presencial, híbrido ou remoto nas suas cidades.")],
    ]
      .map(([v, title, s]) => `<label class="option"><input type="radio" name="mode" value="${v}"${c.mode === v ? " checked" : ""}><span><b>${title}</b><br><small class="muted">${s}</small></span></label>`)
      .join("")}
    <div class="field" id="cities"${c.mode === "remoto" ? " hidden" : ""}><span>${t("Cidades onde aceita presencial ou híbrido")}</span>${tagsField("cities", c.cities, t("Digite uma cidade e aperte Enter"))}</div>
  </div>
  <div class="panel"><h3>${t("Onde você mora")}</h3>
    <div class="grid2"><label class="field"><span>${t("País")}</span><input name="country" value="${esc(c.country)}"></label><label class="field"><span>${t("Fuso horário")}</span><input name="timezone" value="${esc(c.timezone)}"></label></div>
    <label class="switch"><input type="checkbox" name="international"${c.international ? " checked" : ""}><span>${t("Aceito vagas de empresas de fora do país")}<small>${t("O processo costuma ser em inglês.")}</small></span></label>
  </div></form>
  <div class="btn-row" style="justify-content:space-between;margin-top:16px">${btn("wiz-back-questions", t("← Voltar"), null, "ghost")}${btn("wiz-build", t("🛠 Montar meu perfil"), null, "primary")}</div>`;
}
function bindChoices() {
  const form = $("#wiz-c");
  form.addEventListener("change", () => {
    $("#cities").hidden = form.elements.mode.value === "remoto";
  });
}
function readChoices() {
  const form = $("#wiz-c");
  if (!form) return wiz.choices;
  const roles = [...form.querySelectorAll('input[name="roles"]:checked')].map((i) => i.value);
  wiz.choices = {
    roles,
    extra: tagValues(form.querySelector('[data-name="extra"]')),
    seniority: form.elements.seniority.value,
    mode: form.elements.mode.value,
    cities: tagValues(form.querySelector('[data-name="cities"]')),
    country: form.elements.country.value,
    timezone: form.elements.timezone.value,
    international: form.elements.international.checked,
  };
  return wiz.choices;
}
action("wiz-back-questions", () => {
  readChoices();
  wiz.sub = "questions";
  paintWizard();
});
action("wiz-build", async () => {
  const c = readChoices();
  const targetRoles = [...c.roles, ...c.extra];
  if (!targetRoles.length) return toast(t("Escolha pelo menos um cargo."), "bad");
  if (c.mode !== "remoto" && !c.cities.length) return toast(t("Diga pelo menos uma cidade para presencial/híbrido."), "bad");
  const answers = profile.draft.intake.questions.map((q, i) => ({ question: q.question, answer: wiz.answers[i] ?? "" }));
  await api("/api/profile/build", { answers, targetRoles, seniority: c.seniority, mode: c.mode, onsiteCities: c.cities, country: c.country, timezone: c.timezone, international: c.international });
  await app.refresh();
  paintWizard();
});

function wizDone() {
  return `<div class="panel wait"><div style="font-size:44px">🎉</div><h2>${t("Perfil pronto!")}</h2>
    <p class="muted">${t("Antes de buscar vagas, confira o que a IA montou, principalmente os itens “a confirmar”. Tudo o que o agente escrever sai do seu perfil.")}</p>
    <div class="btn-row" style="justify-content:center">${(profile.basePdfs ?? []).map((f) => link(f.url, `📄 ${esc(f.name)}`)).join("")}</div>
    <div class="btn-row" style="justify-content:center">${btn("wiz-finish:perfil", t("Conferir meu perfil"))}${btn("wiz-finish:vagas", t("🚀 Buscar vagas"), null, "primary")}</div></div>`;
}
action("wiz-finish", (_id, to) => {
  wiz.justBuilt = false;
  wiz.choices = null;
  app.go(to);
});

/* ================================================================ página do perfil */

export async function renderProfilePage() {
  await loadProfile();
  paintProfile();
}

function paintProfile() {
  const view = $("#view");
  const p = profile;
  if (!view || !p) return;
  const contact = Object.entries(p.contact ?? {})
    .filter(([k, v]) => v && !/availability/i.test(k))
    .map(([, v]) => `<span>${esc(v)}</span>`)
    .join("");
  const rendering = running("render-base");
  view.innerHTML = `
  <header class="page-head"><div><h1>${t("Perfil")}</h1><p>${t("A fonte única de fatos sobre você. O agente só escreve o que está aqui.")}</p></div>
    <div class="btn-row">${btn("redo-profile", t("🔄 Montar de novo"))}${
      rendering ? `<span class="busy"><span class="spin"></span>${t("Gerando PDFs…")}</span>` : btn("render-base", t("📄 Gerar PDFs de conferência"))
    }</div></header>
  <div class="panel hero">${mono(p.name || "?", "lg")}
    <div><h2>${esc(p.name || t("Sem nome"))}</h2><p class="muted">${esc(p.headline)}</p><div class="contact">${contact}</div></div>
    <div class="btn-row">${p.basePdfs.map((f) => link(f.url, `📄 ${/_en\.pdf$/i.test(f.name) ? t("Inglês") : t("Português")}`, "small")).join("")}</div>
  </div>
  ${updatePanel(p.update)}
  ${numbersPanel(p)}
  ${
    p.pending.length
      ? `<div class="panel"><h3>⚠️ ${plural(p.pending.length, "ponto a confirmar", "pontos a confirmar")}</h3>
        <p class="muted">${t("A IA achou divergências ou informações faltando. Resolva no texto abaixo: corrija o que precisar e troque <code>- [ ]</code> por <code>- [x]</code>.")}</p>
        <ul class="pending">${p.pending.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`
      : ""
  }
  <div class="panel">
    <div class="section-title" style="margin-top:0"><h2>profile_truth.md</h2><span class="faint">profile/profile_truth.md</span></div>
    <p class="muted">${t("Mantenha os títulos das seções (linhas com <code>##</code>).")} ${
      p.nonEvidence.length ? t("As seções {list} não contam como evidência para as travas.", { list: p.nonEvidence.map((h) => `“${esc(h)}”`).join(", ") }) : ""
    }</p>
    <textarea id="truth" class="code" spellcheck="false" aria-label="${esc(t("Conteúdo do profile_truth.md"))}" style="margin-top:12px">${esc(truthDraft ?? p.truth)}</textarea>
    <div id="save-slot"></div>
  </div>`;
  const ta = $("#truth");
  ta.addEventListener("input", () => {
    truthDraft = ta.value === p.truth ? null : ta.value;
    paintSaveBar();
  });
  paintSaveBar();
  // Números que faltam: a IA analisa sozinha, uma vez por visita, os tópicos que ainda não têm análise.
  if (!numbersTried && S.provider?.active && $("#numbers") && p.numbers.some((n) => !n.hint)) {
    numbersTried = true;
    analyzeNumbersNow();
  }
}

/* ------------------------------------------------------ atualizar o perfil */

const UPDATE_TASKS = {
  "profile-update": t("A IA está preparando as mudanças no seu perfil…"),
  "profile-apply": t("Atualizando o perfil e refazendo os currículos-base…"),
  "rebuild-base": t("Refazendo os currículos-base a partir do perfil…"),
};
const updateTask = () => Object.keys(UPDATE_TASKS).map(running).find(Boolean);

function updatePanel(u) {
  const task = updateTask();
  if (task)
    return `<div class="panel update"><span class="busy"><span class="spin"></span>${task.status === "running" ? UPDATE_TASKS[task.kind] : t("Na fila…")}</span>
      <p class="faint">${esc(lastLog(task))}</p></div>`;
  const prop = u?.proposal;
  if (prop) {
    const when = new Date(prop.createdAt).toLocaleString(getLang() === "pt-BR" ? "pt-BR" : "en-US", { dateStyle: "short", timeStyle: "short" });
    return `<div class="panel update proposal">
      <div class="section-title" style="margin-top:0"><h2>${t("📝 Proposta de atualização")}</h2><span class="faint">${esc(when)} · ${esc(prop.sources.map(sourceLabel).join(", "))}</span></div>
      <p class="muted">${t("Confira antes de aplicar. Nada foi salvo ainda.")}</p>
      <h3>${t("O que muda")}</h3><ul class="list-ok">${prop.changes.map((c) => `<li>${esc(c)}</li>`).join("") || `<li>${t("nenhuma mudança")}</li>`}</ul>
      ${prop.toConfirm.length ? `<h3>${t("Ficou para você confirmar")}</h3><ul class="pending">${prop.toConfirm.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
      <details class="diff-box"><summary>${t("Ver o texto antes e depois")} <span class="chip ok">+${prop.stats.added}</span> <span class="chip bad">−${prop.stats.removed}</span></summary>${diffHtml(prop.diff)}</details>
      ${prop.outdated ? `<p class="status-line warn">${t("⚠️ Você editou o perfil depois desta proposta. Descarte e conte a novidade de novo.")}</p>` : ""}
      <div class="btn-row" style="margin-top:14px">
        <button type="button" class="primary" data-act="update-apply"${prop.outdated ? " disabled" : ""}>${t("✅ Aplicar e refazer os currículos")}</button>
        ${btn("update-discard", t("Descartar"), null, "ghost danger")}
      </div>
      <p class="faint" style="margin-top:10px">${t("Ao aplicar, o perfil atual vai para um backup e os currículos-base em português e inglês são refeitos. Leva alguns minutos.")}</p>
    </div>`;
  }
  return `<div class="panel update">
    <h3>${t("🆕 Atualizar o perfil")}</h3>
    <p class="muted">${t("Projeto novo, emprego novo, curso, certificação, um resultado com número? Conte aqui: a IA propõe as mudanças no perfil e você confere o antes e o depois antes de salvar. Os currículos-base são refeitos junto.")}</p>
    <div class="btn-row" style="margin-top:12px">${btn("update-news", t("➕ Contar uma novidade"), null, "primary")}${btn(
      "rebuild-base-ask",
      t("🔄 Refazer currículos-base"),
      null,
      "",
      t("Depois de editar o texto do perfil à mão"),
    )}</div>
  </div>`;
}

action("update-news", async () => {
  let file = null;
  const r = await modal({
    title: t("Contar uma novidade"),
    wide: true,
    html: `<p class="muted">${t("A IA usa só o que você contar: o que faltar vira “a confirmar”. Você confere o antes e o depois antes de salvar.")}</p>
      <label class="field"><span>${t("O que mudou?")}</span><small>${t("Com as suas palavras. Inclua datas e números reais, se tiver.")}</small>
        <textarea name="text" rows="6" placeholder="${esc(t("ex.: Em 10/2026 saí da Empresa A e entrei na Empresa B como Desenvolvedora Pleno. Terminei o projeto Orbita 2, usado por 200 pessoas."))}"></textarea></label>
      <div class="field"><span>${t("Ou um arquivo")} <small>${t("(opcional)")}</small></span><small>${t("Currículo atualizado ou o PDF do LinkedIn (Mais → Salvar como PDF).")}</small>
        <div class="btn-row"><label class="btn small">${t("📄 Escolher arquivo")}<input type="file" name="file" accept=".pdf,.docx,.txt,.md" hidden></label><span class="faint" data-file-name>${t("Nenhum arquivo")}</span></div></div>
      <label class="field"><span>${t("Ou um link")} <small>${t("(opcional)")}</small></span><input name="url" type="url" placeholder="${esc(t("https://… (portfólio, GitHub, página do projeto)"))}" autocomplete="off"></label>`,
    confirm: t("Preparar a atualização"),
    onOpen: (form) => {
      const check = () =>
        form.elements.text.setCustomValidity(form.elements.text.value.trim() || file || form.elements.url.value.trim() ? "" : t("Conte a novidade, mande um arquivo ou um link."));
      form.elements.file.addEventListener("change", () => {
        file = form.elements.file.files[0] ?? null;
        form.querySelector("[data-file-name]").textContent = file ? file.name : t("Nenhum arquivo");
        check();
      });
      form.addEventListener("input", check);
      check();
    },
  });
  if (!r) return;
  await api("/api/profile/update/reset", {});
  if (file) await uploadFile("/api/profile/update/upload", file);
  if (r.url.trim()) await api("/api/profile/update/sources", { type: "link", url: r.url.trim() });
  if (r.text.trim()) await api("/api/profile/update/sources", { type: "text", text: r.text });
  await api("/api/profile/update/propose", {});
  toast(t("📝 Preparando a atualização. Você confere antes de salvar."));
  await app.refresh();
  if (location.hash.startsWith("#/perfil")) paintProfile();
});
action("update-apply", async () => {
  await api("/api/profile/update/apply", {});
  toast(t("✅ Aplicando. O perfil anterior vai para um backup."));
  await app.refresh();
  paintProfile();
});
/**
 * Números que faltam: tópicos do currículo-base sem nenhum resultado medido. A pessoa informa o número
 * real ou aproximado e isso vira uma proposta de atualização (confere o antes e o depois antes de salvar).
 */
let numbersTyped = {}; // o que a pessoa já escreveu, por tópico: sobrevive ao redesenho e à nova ordem
let numbersState = ""; // "" | "analyzing" | "failed"
let numbersTried = false; // a análise automática roda uma vez por visita
let numbersStarted = 0; // quando a análise começou (para o tempo no aviso)

const WORTH = {
  alto: ["ok", t("💪 pesa muito")],
  medio: ["accent", t("👍 ajuda")],
  baixo: ["", t("ajuda pouco")],
};

function numberItem(n, i) {
  const h = n.hint;
  const [cls, label] = h ? (WORTH[h.worth] ?? WORTH.medio) : [];
  const note = h ? [h.measure, h.why].filter(Boolean).join(" · ") : "";
  // Sem o ponto final de cada exemplo: eles vão juntos, separados por ";" (vale para análises já salvas).
  const examples = (h?.examples ?? []).map((e) => e.replace(/[\s.;,]+$/, "")).filter(Boolean);
  const placeholder = examples.length ? t("ex.: {examples}", { examples: examples.join("; ") }) : t("ex.: cerca de 30%, 200 usuários, de 3 h para 10 min");
  return `<label class="field num-item">
      <span class="num-head"><span>${esc(n.company)} <small>${esc(n.title)}</small></span>${h ? `<span class="chip ${cls}">${label}</span>` : ""}</span>
      <small class="num-bullet">${esc(n.bullet)}</small>
      ${h ? `<span class="num-q">${esc(h.question)}</span>${note ? `<small class="faint">${esc(note)}</small>` : ""}` : ""}
      <input data-num="${i}" maxlength="200" value="${esc(numbersTyped[n.bullet] ?? "")}" placeholder="${esc(placeholder)}" aria-label="${esc(h?.question ?? n.bullet)}">
    </label>`;
}

function numbersPanel(p) {
  if (!p.numbers?.length || p.update?.proposal || updateTask()) return "";
  const pending = p.numbers.some((n) => !n.hint);
  const analyzing = numbersState === "analyzing";
  const all = p.numbers.map((n, i) => [n, i]);
  const main = all.filter(([n]) => n.hint?.worth !== "baixo");
  const weak = all.filter(([n]) => n.hint?.worth === "baixo");
  const status = analyzing
    ? `<p class="busy num-busy"><span class="spin"></span><span id="numbers-busy-text">${esc(analyzingText())}</span></p>`
    : pending
      ? `<div class="btn-row">${btn("numbers-analyze", t("🧠 Ver o que medir em cada tópico"), null, "small")}${
          numbersState === "failed" ? `<span class="faint">${t("A análise não deu certo. Tente de novo ou responda assim mesmo.")}</span>` : ""
        }</div>`
      : "";
  return `<div class="panel" id="numbers"><h3>${t("🔢 Números que faltam")}</h3>
    <p class="muted">${
      pending
        ? t("Resultados com número pesam mais na leitura do recrutador. Estes tópicos do seu currículo não têm nenhum.")
        : t("Resultados com número pesam mais na leitura do recrutador. Para cada tópico sem número, a IA diz o que dá para medir e faz a pergunta. Responda só o que você sabe, com o número real ou aproximado; o que ficar vazio é ignorado.")
    } ${t("Vira uma proposta de atualização, que você confere antes de salvar. A IA nunca sugere o valor.")}</p>
    ${status}
    <form id="numbers-form" autocomplete="off">${main.map(([n, i]) => numberItem(n, i)).join("")}${
      weak.length
        ? `<details class="num-weak"${main.length ? "" : " open"}><summary>${weak.length === 1 ? t("Outro tópico, em que um número ajuda pouco") : t("Outros {n} tópicos, em que um número ajuda pouco", { n: weak.length })}</summary>${weak
            .map(([n, i]) => numberItem(n, i))
            .join("")}</details>`
        : ""
    }</form>
    <div class="btn-row">${btn("numbers-send", t("📝 Preparar a atualização"), null, "primary small")}${
      !pending && !analyzing ? btn("numbers-analyze-again", t("🔄 Analisar de novo"), null, "small ghost") : ""
    }</div></div>`;
}

/** Redesenha só o painel, para não mexer no resto da página (o texto do perfil pode estar em edição). */
function paintNumbers() {
  const el = $("#numbers");
  if (el && profile) el.outerHTML = numbersPanel(profile);
}

/** O aviso enquanto a IA analisa, com o tempo correndo: costuma levar meio minuto; passou disso, diz que está demorando. */
function analyzingText() {
  const s = Math.max(0, Math.round((Date.now() - numbersStarted) / 1000));
  return s < 75
    ? t("A IA está vendo o que dá para medir em cada tópico ({s} s). Costuma levar meio minuto; você já pode ir respondendo.", { s })
    : t("Está demorando mais que o normal ({s} s). Pode continuar usando o app: as perguntas aparecem aqui quando a IA terminar.", { s });
}

async function analyzeNumbersNow(force = false) {
  if (numbersState === "analyzing") return;
  numbersState = "analyzing";
  numbersStarted = Date.now();
  paintNumbers();
  // Atualiza só o texto do aviso, para não redesenhar os campos enquanto a pessoa escreve.
  const tick = setInterval(() => {
    const el = $("#numbers-busy-text");
    if (el) el.textContent = analyzingText();
  }, 1000);
  try {
    const r = await api("/api/profile/numbers/analyze", { force });
    profile.numbers = r.numbers;
    numbersState = "";
  } catch (e) {
    numbersState = "failed";
    toast(e.message, "bad");
  } finally {
    clearInterval(tick);
  }
  paintNumbers();
}

document.addEventListener("input", (e) => {
  const el = e.target.closest?.("[data-num]");
  const n = el && profile?.numbers?.[Number(el.dataset.num)];
  if (n) numbersTyped[n.bullet] = el.value;
});

action("numbers-analyze", () => analyzeNumbersNow());
action("numbers-analyze-again", () => analyzeNumbersNow(true));

action("numbers-send", async () => {
  const items = profile.numbers.map((n) => ({ bullet: n.bullet, value: (numbersTyped[n.bullet] ?? "").trim() })).filter((x) => x.value);
  if (!items.length) return toast(t("Preencha o número de pelo menos um resultado."), "bad");
  await api("/api/profile/numbers", { items });
  numbersTyped = {};
  toast(t("📝 Preparando a atualização. Você confere antes de salvar."));
  await app.refresh();
  if (location.hash.startsWith("#/perfil")) paintProfile();
});

action("update-discard", async () => {
  await api("/api/profile/update/discard", {});
  await loadProfile();
  paintProfile();
  toast(t("Proposta descartada."));
});
action("rebuild-base-ask", async () => {
  const ok = await modal({
    title: t("Refazer os currículos-base?"),
    html: `<p>${t("A IA refaz o currículo-base em português e em inglês a partir do <code>profile_truth.md</code> atual, mantendo a redação do que não mudou. Use depois de editar o texto do perfil à mão. Os currículos atuais vão para um backup. Leva alguns minutos.")}</p>`,
    confirm: t("🔄 Refazer"),
  });
  if (!ok) return;
  await api("/api/profile/rebuild-base", {});
  toast(t("🔄 Refazendo os currículos-base."));
  await app.refresh();
  paintProfile();
});

function paintSaveBar() {
  const slot = $("#save-slot");
  if (!slot) return;
  slot.innerHTML = truthDraft != null ? `<div class="save-bar"><span>${t("Alterações não salvas")}</span><div class="btn-row">${btn("truth-discard", t("Descartar"), null, "ghost small")}${btn("truth-save", t("Salvar"), null, "primary small")}</div></div>` : "";
}

action("truth-save", async () => {
  const r = await api("/api/profile/truth", { text: truthDraft }, "PUT");
  truthDraft = null;
  toast(r.pending.length ? t("Salvo. Ainda {items}.", { items: plural(r.pending.length, "ponto a confirmar", "pontos a confirmar") }) : t("Salvo. Nada a confirmar. 👌"));
  await renderProfilePage();
});
action("truth-discard", () => {
  truthDraft = null;
  paintProfile();
});
action("render-base", async () => {
  await api("/api/profile/render", {});
  toast(t("📄 Gerando os PDFs do currículo-base."));
  await app.refresh();
  if (location.hash.startsWith("#/perfil")) paintProfile();
});
action("redo-profile", async () => {
  const ok = await modal({
    title: t("Montar o perfil de novo?"),
    html: `<p>${t("Você envia currículo, LinkedIn ou responde perguntas de novo, e a IA monta tudo do zero. O perfil atual só é trocado no fim, e vai para um backup.")}</p>`,
    confirm: t("Começar"),
  });
  if (ok) app.go("comecar");
});

window.addEventListener("beforeunload", (e) => {
  if (truthDraft != null) e.preventDefault();
});

/* ======================================================= atualizações ao vivo */

let profileBusyKey = "";
on("tasks", () => {
  const route = location.hash.replace(/^#\/?/, "");
  const log = $("#wait-log");
  if (log) log.textContent = lastLog(running("profile-read") ?? running("profile-build"));
  if (route !== "perfil") return;
  // Redesenha quando começa ou termina uma tarefa do perfil (o log muda o tempo todo e não precisa).
  const key = ["render-base", ...Object.keys(UPDATE_TASKS)].map((k) => `${k}:${running(k)?.status ?? ""}`).join("|");
  if (key !== profileBusyKey) {
    profileBusyKey = key;
    paintProfile();
  }
});
on("profile", async () => {
  await loadProfile();
  const route = location.hash.replace(/^#\/?/, "") || "vagas";
  if (route === "comecar" || !S.hasProfile) paintWizard();
  else if (route === "perfil" && truthDraft == null) paintProfile();
});
on("task-finished", (task) => {
  // "Perfil pronto" só quando a montagem deu certo; se falhou, volta para as escolhas para tentar de novo.
  if (task.kind === "profile-build") wiz.justBuilt = task.status === "done";
  if (task.kind === "profile-read" || task.kind === "profile-build") loadProfile().then(paintWizard);
});
