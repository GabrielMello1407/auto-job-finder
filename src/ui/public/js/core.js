// Núcleo da interface: estado, chamadas à API, ações, modal, avisos e markdown.

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const daysSince = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : null);
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento: tudo bem */ } },
};

/** Estado vindo do servidor (/api/state) + coisas da tela. */
export const S = {
  hasProfile: true,
  jobs: [],
  tasks: [],
  settings: { minRating: 7, minTriageScore: 70 },
  provider: {},
  webSearch: false,
  webDefault: false,
};

/** Ganchos preenchidos pelo main.js (evita import circular): recarregar o estado e trocar de página. */
export const app = {
  refresh: async () => {},
  go: (_route) => {},
};

export async function api(path, body, method) {
  const res = await fetch(path, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

/** Envia um arquivo (corpo bruto) para uma rota de upload e devolve o JSON da resposta. */
export async function uploadFile(path, file) {
  const res = await fetch(`${path}?name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

/** Antes e depois de um texto: mostra as linhas que mudaram e resume as iguais. */
export function diffHtml(lines, context = 2) {
  const keep = lines.map((l, i) => l.type !== "same" || lines.slice(Math.max(0, i - context), i + context + 1).some((x) => x.type !== "same"));
  let html = "";
  let skipped = 0;
  const flush = () => {
    if (skipped) html += `<div class="d-skip">⋯ ${plural(skipped, "linha igual", "linhas iguais")}</div>`;
    skipped = 0;
  };
  lines.forEach((l, i) => {
    if (!keep[i]) return void skipped++;
    flush();
    const mark = l.type === "add" ? "+" : l.type === "del" ? "−" : " ";
    html += `<div class="d-${l.type}"><span class="d-mark">${mark}</span>${esc(l.text) || "&nbsp;"}</div>`;
  });
  flush();
  return `<div class="diff">${html}</div>`;
}

/* ------------------------------------------------------------ eventos internos */

const listeners = new Map();
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
}
export function emit(event, data) {
  for (const fn of listeners.get(event) ?? []) fn(data);
}

/* -------------------------------------------- ações (data-act nos botões) */

export const ACTIONS = {};
export function action(name, fn) {
  ACTIONS[name] = fn;
}

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const [name, arg] = el.dataset.act.split(":");
  const fn = ACTIONS[name];
  if (!fn) return;
  if (el.tagName === "A") e.preventDefault();
  const lock = el.tagName === "BUTTON" && !el.hasAttribute("data-nolock");
  if (lock) el.disabled = true;
  try {
    await fn(el.dataset.id, arg, el);
  } catch (err) {
    toast(err.message, "bad");
  } finally {
    if (lock && el.isConnected) el.disabled = false;
  }
});

/* ------------------------------------------------------------------ visual */

export function hue(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
export function initials(text) {
  const words = String(text ?? "")
    .replace(/\(.*?\)/g, "")
    .split(/[\s,.\-–—/&]+/)
    .filter((w) => w && !/^(de|da|do|das|dos|e|the|inc|llc|ltda|sa|s\.a)$/i.test(w));
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
}
export function mono(text, cls = "") {
  return `<div class="mono ${cls}" style="--h:${hue(text)}" aria-hidden="true">${esc(initials(text))}</div>`;
}
export const level = (n, good, warn) => (n >= good ? "ok" : n >= warn ? "warn" : "bad");
export function ring(label, value, max, cls, shown = value) {
  if (value == null) return `<div class="ring none" title="${esc(label)}: ainda não tem"><div class="dial"></div><b>–</b>${esc(label)}</div>`;
  return `<div class="ring ${cls}" style="--v:${Math.max(0, Math.min(1, value / max))}" title="${esc(label)}: ${esc(shown)}"><div class="dial"></div><b>${esc(shown)}</b>${esc(label)}</div>`;
}
export function btn(act, label, id, cls = "", title = "") {
  return `<button type="button" class="${cls}" data-act="${act}"${id != null ? ` data-id="${esc(id)}"` : ""}${title ? ` title="${esc(title)}" aria-label="${esc(title)}"` : ""}>${label}</button>`;
}
export function link(href, label, cls = "") {
  return href ? `<a class="btn ${cls}" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>` : "";
}

/* --------------------------------------------------------- modal e avisos */

let closeCurrentModal = null;
export const modalOpen = () => Boolean(closeCurrentModal);
export function closeModal() {
  closeCurrentModal?.(null);
}

/** Abre um formulário. Resolve com os campos (ou null se cancelar). `onOpen(form)` liga comportamentos extras. */
export function modal({ title, html, confirm = "Confirmar", cancel = "Cancelar", wide = false, onOpen }) {
  closeModal();
  return new Promise((resolve) => {
    const root = $("#modal-root");
    root.innerHTML = `<div class="backdrop"><form class="modal${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title" novalidate>
      <h2 id="modal-title">${esc(title)}</h2><div>${html}</div>
      <div class="modal-actions"><button type="button" class="ghost" data-close>${esc(cancel)}</button>${confirm ? `<button type="submit" class="primary">${esc(confirm)}</button>` : ""}</div>
    </form></div>`;
    const form = $("form", root);
    const close = (value) => {
      closeCurrentModal = null;
      root.innerHTML = "";
      resolve(value);
    };
    closeCurrentModal = close;
    $("[data-close]", root).onclick = () => close(null);
    $(".backdrop", root).addEventListener("mousedown", (e) => {
      if (e.target === e.currentTarget) close(null);
    });
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      close(formData(form));
    };
    onOpen?.(form);
    (form.querySelector("[autofocus], textarea, input:not([type=checkbox]):not([type=radio]):not([disabled])") ?? form.querySelector("button.primary"))?.focus();
  });
}

/** Campos do formulário: checkbox vira true/false, radio o valor marcado, data-list vira lista. */
export function formData(form) {
  const data = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") {
      if (el.dataset.list != null) {
        data[el.name] ??= [];
        if (el.checked) data[el.name].push(el.value);
      } else data[el.name] = el.checked;
    } else if (el.type === "radio") {
      if (el.checked) data[el.name] = el.value;
    } else data[el.name] = el.value;
  }
  for (const box of form.querySelectorAll(".tags[data-name]")) data[box.dataset.name] = tagValues(box);
  return data;
}

export function toast(message, kind = "", act) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.setAttribute("role", kind === "bad" ? "alert" : "status");
  el.innerHTML = `<span>${esc(message)}</span>`;
  if (act) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = act.label;
    b.onclick = () => {
      el.remove();
      act.run();
    };
    el.append(b);
  }
  $("#toasts").append(el);
  setTimeout(() => el.remove(), act ? 9000 : kind === "bad" ? 7000 : 4500);
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  toast("📋 Copiado.");
}

/* ------------------------------------------------- campo de etiquetas (tags) */

/** Campo onde cada item vira uma etiqueta: Enter ou vírgula adiciona, ✕ remove. */
export function tagsField(name, values = [], placeholder = "Digite e aperte Enter") {
  return `<div class="tags" data-name="${esc(name)}">${values.map(tagHtml).join("")}<input type="text" aria-label="Adicionar" placeholder="${esc(placeholder)}"></div>`;
}
const tagHtml = (v) => `<span class="tag" data-value="${esc(v)}">${esc(v)}<button type="button" data-tag-remove aria-label="Remover ${esc(v)}">✕</button></span>`;
export function tagValues(box) {
  const pending = $("input", box).value.trim();
  const values = [...box.querySelectorAll(".tag")].map((t) => t.dataset.value);
  return pending ? [...values, ...pending.split(",").map((s) => s.trim()).filter(Boolean)] : values;
}
function addTags(box, text) {
  const input = $("input", box);
  for (const v of text.split(",").map((s) => s.trim()).filter(Boolean)) {
    if ([...box.querySelectorAll(".tag")].some((t) => norm(t.dataset.value) === norm(v))) continue;
    input.insertAdjacentHTML("beforebegin", tagHtml(v));
  }
  input.value = "";
  box.dispatchEvent(new Event("change", { bubbles: true }));
}
document.addEventListener("keydown", (e) => {
  const input = e.target.closest?.(".tags input");
  if (!input) return;
  const box = input.closest(".tags");
  if ((e.key === "Enter" || e.key === ",") && input.value.trim()) {
    e.preventDefault();
    addTags(box, input.value);
  } else if (e.key === "Enter") e.preventDefault();
  else if (e.key === "Backspace" && !input.value) {
    box.querySelector(".tag:last-of-type")?.remove();
    box.dispatchEvent(new Event("change", { bubbles: true }));
  }
});
document.addEventListener("focusout", (e) => {
  const input = e.target.closest?.(".tags input");
  if (input?.value.trim()) addTags(input.closest(".tags"), input.value);
});
document.addEventListener("click", (e) => {
  const rm = e.target.closest("[data-tag-remove]");
  if (rm) {
    const box = rm.closest(".tags");
    rm.parentElement.remove();
    box.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  const box = e.target.closest(".tags");
  if (box && e.target === box) $("input", box).focus();
});

/* ------------------------------------------------------- markdown simples */

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)!?]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}

/** Markdown dos arquivos do agente (LEIA-ME, relatórios, guia, plano de LinkedIn). Blocos de código ganham "Copiar". */
export function md(src) {
  if (!src) return "";
  let html = "";
  let list = null;
  let para = [];
  let quote = [];
  let code = null;
  const flush = () => {
    if (para.length) html += `<p>${inline(para.join(" "))}</p>`;
    if (quote.length) html += `<blockquote>${inline(quote.join(" "))}</blockquote>`;
    if (list) html += `</${list}>`;
    para = [];
    quote = [];
    list = null;
  };
  for (const line of String(src).replace(/\r/g, "").split("\n")) {
    if (code) {
      if (/^```/.test(line)) {
        html += `<pre><button type="button" class="small ghost copy-pre" data-act="copy-pre">📋 Copiar</button><code>${esc(code.join("\n"))}</code></pre>`;
        code = null;
      } else code.push(line);
      continue;
    }
    if (/^```/.test(line)) {
      flush();
      code = [];
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      flush();
      const n = Math.min(h[1].length + 1, 5);
      html += `<h${n}>${inline(h[2])}</h${n}>`;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      html += "<hr>";
      continue;
    }
    const li = line.match(/^\s*([-*]|\d+\.)\s+(.*)/);
    if (li) {
      const type = /\d/.test(li[1]) ? "ol" : "ul";
      if (para.length || quote.length || (list && list !== type)) flush();
      if (!list) {
        html += `<${type}>`;
        list = type;
      }
      const box = li[2].match(/^\[( |x)\]\s+(.*)/i);
      html += box ? `<li class="task"><input type="checkbox" disabled${box[1] === " " ? "" : " checked"}> ${inline(box[2])}</li>` : `<li>${inline(li[2])}</li>`;
      continue;
    }
    const q = line.match(/^>\s?(.*)/);
    if (q) {
      if (para.length || list) flush();
      quote.push(q[1]);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (list || quote.length) flush();
    para.push(line.trim());
  }
  if (code) html += `<pre><code>${esc(code.join("\n"))}</code></pre>`;
  flush();
  return html;
}

action("copy-pre", (_id, _arg, el) => copy(el.parentElement.querySelector("code").textContent));
