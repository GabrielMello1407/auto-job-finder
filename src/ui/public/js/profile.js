// Perfil: assistente de cadastro (fontes → leitura pela IA → perguntas → vagas → montagem) e a página do perfil.
import { $, action, api, app, btn, esc, link, md, modal, mono, on, plural, S, tagsField, tagValues, toast } from "./core.js";

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
  pill.title = `${plural(n, "item", "itens")} a confirmar`;
}

const running = (kind) => S.tasks.find((t) => t.kind === kind && (t.status === "queued" || t.status === "running"));
const lastLog = (t) => t?.log?.[t.log.length - 1] ?? "Começando…";

/* =================================================================== assistente */

const STEPS = [
  ["sources", "Suas fontes"],
  ["reading", "Leitura"],
  ["questions", "Perguntas"],
  ["choices", "Vagas que você quer"],
  ["building", "Montagem"],
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
  const head = `<header class="page-head"><div><h1>${S.hasProfile && step !== "done" ? "Montar o perfil de novo" : "Vamos montar seu perfil"}</h1>
    <p>Tudo o que o agente escreve sobre você sai daqui. Ele nunca inventa: o que faltar vira pergunta.</p></div>
    ${S.hasProfile && step !== "building" && step !== "done" ? btn("go:perfil", "Cancelar", null, "ghost") : ""}</header>`;
  const noIa = !S.provider?.active
    ? `<div class="banner"><span>🤖 Primeiro escolha qual IA o agente vai usar (Claude, ChatGPT, Gemini…).</span>${btn("ia", "Escolher IA", null, "primary small")}</div>`
    : "";
  const body = {
    sources: wizSources,
    reading: () => waitScreen("A IA está lendo suas fontes", "Ela vai resumir o que entendeu e perguntar só o que falta para o currículo ficar completo e verdadeiro.", running("profile-read")),
    questions: wizQuestions,
    choices: wizChoices,
    building: () => waitScreen("Montando seu perfil", "Organizando sua carreira, escrevendo os currículos-base em português e inglês e as regras do que nunca afirmar. Leva alguns minutos.", running("profile-build")),
    done: wizDone,
  }[step]();
  view.innerHTML = `${head}${step === "done" ? "" : stepsBar(step)}${noIa}${body}`;
  if (step === "sources") bindDrop();
  if (step === "choices") bindChoices();
}

function waitScreen(title, text, task) {
  return `<div class="panel wait"><div class="spin lg"></div><h2>${esc(title)}…</h2><p class="muted">${esc(text)}</p><p class="faint" id="wait-log">${esc(lastLog(task))}</p></div>`;
}

const KIND = { curriculo: "📄", linkedin: "💼", portfolio: "🎨", github: "🐙", site: "🌐", texto: "📝", respostas: "🗣" };

function wizSources() {
  const d = profile.draft;
  return `
  <label class="drop" id="drop">
    <input type="file" id="files" multiple accept=".pdf,.docx,.txt,.md" hidden>
    <div class="big">📄</div><b>Arraste seu currículo aqui</b>
    <span>ou clique para escolher · PDF, DOCX ou TXT · vale também o PDF do LinkedIn e o do portfólio</span>
  </label>
  <div class="ways">
    <button type="button" class="way" data-act="src-link"><b>🌐 Um link</b><span>Portfólio, site pessoal ou GitHub</span></button>
    <button type="button" class="way" data-act="src-text"><b>📝 Colar texto</b><span>Seu “Sobre” do LinkedIn, uma descrição da carreira</span></button>
    <button type="button" class="way" data-act="src-interview"><b>🗣 Não tenho currículo</b><span>Responda algumas perguntas e eu monto</span></button>
  </div>
  <details class="panel" style="margin-top:12px"><summary>Como baixar o PDF do seu LinkedIn</summary><p class="muted">${esc(profile.linkedinHelp)}</p></details>
  <div class="sources" id="sources">${
    d.sources.length
      ? d.sources
          .map(
            (s) => `<div class="source"><span style="font-size:20px">${KIND[s.kind] ?? "📄"}</span><div class="txt"><b>${esc(s.label)}</b><span>${s.chars.toLocaleString("pt-BR")} caracteres lidos</span></div>${btn("src-remove", "✕", s.index, "ghost small icon", "Remover")}</div>`,
          )
          .join("")
      : ""
  }</div>
  <div class="btn-row" style="justify-content:flex-end;margin-top:18px">
    <button type="button" class="primary" data-act="wiz-read"${d.sources.length && S.provider?.active ? "" : " disabled"}>Ler minhas fontes com a IA →</button>
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
    toast(`Lendo ${f.name}…`);
    try {
      const res = await fetch(`/api/profile/upload?name=${encodeURIComponent(f.name)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: f });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
      profile.draft = data;
      const added = data.sources[data.sources.length - 1];
      toast(`✅ ${added?.kind === "linkedin" ? "Reconheci o PDF do LinkedIn" : `${f.name} lido`}.`);
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
    title: "Adicionar um link",
    html: `<p class="muted">Portfólio, site pessoal ou perfil do GitHub. O LinkedIn bloqueia leitura automática: para ele, use o PDF.</p>
      <label class="field"><span>Link</span><input name="url" type="url" required placeholder="https://meusite.com ou https://github.com/usuario" autocomplete="off"></label>`,
    confirm: "Adicionar",
  });
  if (r) await addSource({ type: "link", url: r.url }, "Lendo o link… sites feitos em JavaScript podem levar alguns segundos.");
});
action("src-text", async () => {
  const r = await modal({
    title: "Colar texto",
    wide: true,
    html: `<label class="field"><span>Texto sobre a sua carreira</span><small>O “Sobre” e as experiências do LinkedIn, uma descrição sua, o que tiver.</small><textarea name="text" rows="12" required minlength="40"></textarea></label>`,
    confirm: "Adicionar",
  });
  if (r) await addSource({ type: "text", text: r.text }, "Adicionando o texto…");
});
action("src-interview", async () => {
  const exp = (i) => `<fieldset class="panel" style="margin-top:12px"><legend class="muted">Experiência ${i + 1}</legend>
    <div class="grid2"><label class="field"><span>Empresa ou organização</span><input name="e${i}company"></label><label class="field"><span>Cargo</span><input name="e${i}title"></label></div>
    <div class="grid2"><label class="field"><span>Início (MM/AAAA)</span><input name="e${i}start"></label><label class="field"><span>Fim (MM/AAAA ou Atual)</span><input name="e${i}end"></label></div>
    <label class="field"><span>O que você fazia e quais resultados</span><small>Use números reais se tiver.</small><textarea name="e${i}description" rows="3"></textarea></label></fieldset>`;
  const r = await modal({
    title: "Vamos do zero",
    wide: true,
    html: `<p class="muted">Responda com suas palavras. Pode deixar em branco o que não tiver.</p>
      <div class="grid2"><label class="field"><span>Nome completo</span><input name="name"></label><label class="field"><span>Cidade/UF</span><input name="city" placeholder="Londrina, PR"></label></div>
      <div class="grid2"><label class="field"><span>E-mail profissional</span><input name="email" type="text"></label><label class="field"><span>Telefone/WhatsApp</span><input name="phone"></label></div>
      <div class="grid2"><label class="field"><span>LinkedIn</span><input name="linkedin"></label><label class="field"><span>Portfólio, site ou GitHub</span><input name="portfolio"></label></div>
      <label class="field"><span>Qual cargo ou área você quer?</span><input name="goal"></label>
      <div id="exps">${exp(0)}</div>
      <button type="button" class="small" id="add-exp">＋ Outra experiência</button>
      <label class="field"><span>Formação</span><input name="education" placeholder="Curso, instituição, período"></label>
      <label class="field"><span>Cursos e certificações</span><small>Diga quais são certificações oficiais e quais são cursos.</small><textarea name="courses" rows="2"></textarea></label>
      <label class="field"><span>Ferramentas, sistemas e competências</span><textarea name="skills" rows="2"></textarea></label>
      <label class="field"><span>Idiomas e nível</span><input name="languages" placeholder="Inglês intermediário"></label>
      <label class="field"><span>Um resultado de que você se orgulha</span><textarea name="achievements" rows="2"></textarea></label>`,
    confirm: "Adicionar respostas",
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
  await addSource({ type: "interview", answers: { name, city, email, phone, linkedin, portfolio, goal, education, courses, skills, languages, achievements, experiences } }, "Adicionando suas respostas…");
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
  return `<div class="understood"><span class="faint">Entendi assim:</span><br>${esc(it.understood)}</div>
  <form id="wiz-q" class="panel">
    <h3>${it.questions.length ? "Algumas perguntas para o currículo ficar completo e verdadeiro" : "Não tenho perguntas: entendi tudo."}</h3>
    ${it.questions.length ? `<p class="muted">Responda o que souber. Em branco, o ponto fica marcado como “a confirmar” no perfil.</p>` : ""}
    ${it.questions
      .map(
        (q, i) => `<label class="field"><span>${i + 1}. ${esc(q.question)}</span><small>${esc(q.why)}</small><textarea name="q${i}" rows="2">${esc(wiz.answers[i] ?? "")}</textarea></label>`,
      )
      .join("")}
  </form>
  <div class="btn-row" style="justify-content:space-between;margin-top:16px">${btn("wiz-back-sources", "← Voltar às fontes", null, "ghost")}${btn("wiz-to-choices", "Continuar →", null, "primary")}</div>`;
}
function keepAnswers() {
  const form = $("#wiz-q");
  if (!form) return;
  profile.draft.intake.questions.forEach((_q, i) => (wiz.answers[i] = form.elements[`q${i}`]?.value ?? ""));
}
action("wiz-back-sources", async () => {
  keepAnswers();
  const ok = await modal({ title: "Voltar às fontes?", html: `<p>Se você mudar as fontes, a IA lê tudo de novo e as perguntas podem mudar.</p>`, confirm: "Voltar" });
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
  <div class="panel"><h3>Que cargos você quer?</h3><p class="muted">Sugestões a partir do que você enviou. Desmarque o que não quiser e adicione outros.</p>
    <div class="btn-row" style="margin-top:10px">${it.suggestedTargetRoles
      .map((r) => `<label class="toggle-tag"><input type="checkbox" name="roles" data-list value="${esc(r)}"${c.roles.includes(r) ? " checked" : ""}><span>${esc(r)}</span></label>`)
      .join("")}</div>
    <div class="field"><span>Outros cargos</span>${tagsField("extra", c.extra, "Digite um cargo e aperte Enter")}</div>
    <label class="field"><span>Senioridade que você busca</span><input name="seniority" value="${esc(c.seniority)}"></label>
  </div>
  <div class="panel"><h3>Como você quer trabalhar?</h3>
    ${[
      ["remoto", "Só remoto", "Vagas 100% remotas."],
      ["remoto+regiao", "Remoto, ou híbrido/presencial na minha região", "Remoto em qualquer lugar e presencial só nas cidades que você indicar."],
      ["qualquer", "Qualquer modalidade, na minha região", "Presencial, híbrido ou remoto nas suas cidades."],
    ]
      .map(([v, t, s]) => `<label class="option"><input type="radio" name="mode" value="${v}"${c.mode === v ? " checked" : ""}><span><b>${t}</b><br><small class="muted">${s}</small></span></label>`)
      .join("")}
    <div class="field" id="cities"${c.mode === "remoto" ? " hidden" : ""}><span>Cidades onde aceita presencial ou híbrido</span>${tagsField("cities", c.cities, "Digite uma cidade e aperte Enter")}</div>
  </div>
  <div class="panel"><h3>Onde você mora</h3>
    <div class="grid2"><label class="field"><span>País</span><input name="country" value="${esc(c.country)}"></label><label class="field"><span>Fuso horário</span><input name="timezone" value="${esc(c.timezone)}"></label></div>
    <label class="switch"><input type="checkbox" name="international"${c.international ? " checked" : ""}><span>Aceito vagas de empresas de fora do país<small>O processo costuma ser em inglês.</small></span></label>
  </div></form>
  <div class="btn-row" style="justify-content:space-between;margin-top:16px">${btn("wiz-back-questions", "← Voltar", null, "ghost")}${btn("wiz-build", "🛠 Montar meu perfil", null, "primary")}</div>`;
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
  if (!targetRoles.length) return toast("Escolha pelo menos um cargo.", "bad");
  if (c.mode !== "remoto" && !c.cities.length) return toast("Diga pelo menos uma cidade para presencial/híbrido.", "bad");
  const answers = profile.draft.intake.questions.map((q, i) => ({ question: q.question, answer: wiz.answers[i] ?? "" }));
  await api("/api/profile/build", { answers, targetRoles, seniority: c.seniority, mode: c.mode, onsiteCities: c.cities, country: c.country, timezone: c.timezone, international: c.international });
  await app.refresh();
  paintWizard();
});

function wizDone() {
  return `<div class="panel wait"><div style="font-size:44px">🎉</div><h2>Perfil pronto!</h2>
    <p class="muted">Antes de buscar vagas, confira o que a IA montou, principalmente os itens “a confirmar”. Tudo o que o agente escrever sai do seu perfil.</p>
    <div class="btn-row" style="justify-content:center">${(profile.basePdfs ?? []).map((f) => link(f.url, `📄 ${esc(f.name)}`)).join("")}</div>
    <div class="btn-row" style="justify-content:center">${btn("wiz-finish:perfil", "Conferir meu perfil")}${btn("wiz-finish:vagas", "🚀 Buscar vagas", null, "primary")}</div></div>`;
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
  <header class="page-head"><div><h1>Perfil</h1><p>A fonte única de fatos sobre você. O agente só escreve o que está aqui.</p></div>
    <div class="btn-row">${btn("redo-profile", "🔄 Montar de novo")}${
      rendering ? `<span class="busy"><span class="spin"></span>Gerando PDFs…</span>` : btn("render-base", "📄 Gerar PDFs de conferência")
    }</div></header>
  <div class="panel hero">${mono(p.name || "?", "lg")}
    <div><h2>${esc(p.name || "Sem nome")}</h2><p class="muted">${esc(p.headline)}</p><div class="contact">${contact}</div></div>
    <div class="btn-row">${p.basePdfs.map((f) => link(f.url, `📄 ${/_en\.pdf$/i.test(f.name) ? "Inglês" : "Português"}`, "small")).join("")}</div>
  </div>
  ${
    p.pending.length
      ? `<div class="panel"><h3>⚠️ ${plural(p.pending.length, "ponto a confirmar", "pontos a confirmar")}</h3>
        <p class="muted">A IA achou divergências ou informações faltando. Resolva no texto abaixo: corrija o que precisar e troque <code>- [ ]</code> por <code>- [x]</code>.</p>
        <ul class="pending">${p.pending.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`
      : ""
  }
  <div class="panel">
    <div class="section-title" style="margin-top:0"><h2>profile_truth.md</h2><span class="faint">profile/profile_truth.md</span></div>
    <p class="muted">Mantenha os títulos das seções (linhas com <code>##</code>). ${
      p.nonEvidence.length ? `As seções ${p.nonEvidence.map((h) => `“${esc(h)}”`).join(", ")} não contam como evidência para as travas.` : ""
    }</p>
    <textarea id="truth" class="code" spellcheck="false" aria-label="Conteúdo do profile_truth.md" style="margin-top:12px">${esc(truthDraft ?? p.truth)}</textarea>
    <div id="save-slot"></div>
  </div>`;
  const ta = $("#truth");
  ta.addEventListener("input", () => {
    truthDraft = ta.value === p.truth ? null : ta.value;
    paintSaveBar();
  });
  paintSaveBar();
}

function paintSaveBar() {
  const slot = $("#save-slot");
  if (!slot) return;
  slot.innerHTML = truthDraft != null ? `<div class="save-bar"><span>Alterações não salvas</span><div class="btn-row">${btn("truth-discard", "Descartar", null, "ghost small")}${btn("truth-save", "Salvar", null, "primary small")}</div></div>` : "";
}

action("truth-save", async () => {
  const r = await api("/api/profile/truth", { text: truthDraft }, "PUT");
  truthDraft = null;
  toast(r.pending.length ? `Salvo. Ainda ${plural(r.pending.length, "ponto a confirmar", "pontos a confirmar")}.` : "Salvo. Nada a confirmar. 👌");
  await renderProfilePage();
});
action("truth-discard", () => {
  truthDraft = null;
  paintProfile();
});
action("render-base", async () => {
  await api("/api/profile/render", {});
  toast("📄 Gerando os PDFs do currículo-base.");
  await app.refresh();
  if (location.hash.startsWith("#/perfil")) paintProfile();
});
action("redo-profile", async () => {
  const ok = await modal({
    title: "Montar o perfil de novo?",
    html: `<p>Você envia currículo, LinkedIn ou responde perguntas de novo, e a IA monta tudo do zero. O perfil atual só é trocado no fim, e vai para um backup.</p>`,
    confirm: "Começar",
  });
  if (ok) app.go("comecar");
});

window.addEventListener("beforeunload", (e) => {
  if (truthDraft != null) e.preventDefault();
});

/* ======================================================= atualizações ao vivo */

on("tasks", () => {
  const route = location.hash.replace(/^#\/?/, "");
  const log = $("#wait-log");
  if (log) log.textContent = lastLog(running("profile-read") ?? running("profile-build"));
  if (route === "perfil" && !running("render-base") && $(".busy")) paintProfile();
});
on("profile", async () => {
  await loadProfile();
  const route = location.hash.replace(/^#\/?/, "") || "vagas";
  if (route === "comecar" || !S.hasProfile) paintWizard();
  else if (route === "perfil" && truthDraft == null) paintProfile();
});
on("task-finished", (t) => {
  // "Perfil pronto" só quando a montagem deu certo; se falhou, volta para as escolhas para tentar de novo.
  if (t.kind === "profile-build") wiz.justBuilt = t.status === "done";
  if (t.kind === "profile-read" || t.kind === "profile-build") loadProfile().then(paintWizard);
});
