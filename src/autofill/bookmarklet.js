/*
 * auto-job-finder: favorito "Preencher com ajf" (src/autofill/index.ts monta o link javascript:).
 * Roda na página do formulário de candidatura, só quando a pessoa clica no favorito. Pede os dados que a
 * pessoa copiou no ajf (ela cola), preenche os campos vazios que reconhece e mostra o que preencheu.
 * Não faz nenhuma requisição, não anexa arquivos e nunca envia o formulário: a pessoa confere e envia.
 * Sem comentários no fim das linhas: o link tira só as linhas de comentário.
 */
var AJF_FILL = (function () {
  var KEYS = ["firstName", "lastName", "fullName", "email", "phone", "linkedin", "github", "portfolio", "location", "currentCompany", "currentTitle", "message", "salary", "availability", "notice", "relocation", "workAuthorization"];
  var norm = function (s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[*:]+/g, " ").replace(/\s+/g, " ").trim();
  };
  var AUTOCOMPLETE = { "given-name": "firstName", "family-name": "lastName", name: "fullName", email: "email", tel: "phone", "tel-national": "phone", "address-level2": "location", organization: "currentCompany", "organization-title": "currentTitle" };
  var NAME = "name";
  var RULES = [
    ["linkedin", /linkedin/],
    ["github", /github/],
    ["email", /e-?mail/],
    ["lastName", /last.?name|family.?name|surname|lname|sobrenome|apellido/],
    ["firstName", /first.?name|given.?name|fname|primeiro.?nome/],
    ["fullName", /full.?name|nome.?completo|nombre.?completo|your.?name|candidate.?name|systemfield.?name/],
    [NAME, /^(name|nome|nombre)( \(.*\))?$/],
    ["phone", /phone|telefone|celular|whats.?app|mobile|telefono|^tel$/],
    ["portfolio", /portfolio|website|site pessoal|personal.?(site|page|website)|urls\[other\]|urls\[portfolio\]/],
    ["currentCompany", /current.?(company|employer)|empresa.?atual|^org$/],
    ["currentTitle", /current.?(title|role|position)|cargo.?atual/],
    ["salary", /salary|salari(o|al)|pretensao|compensation|remuneracao|expected.?pay|desired.?pay/],
    ["notice", /notice.?period|aviso.?previo/],
    ["availability", /start.?date|availability|disponibilidade|when can you start|data de inicio/],
    ["relocation", /relocat|mudanca de cidade|mudar de cidade/],
    ["workAuthorization", /authori[sz]|sponsor|visa\b|visto|work.?permit|autorizacao de trabalho/],
    ["location", /location|city|cidade|localizacao|ubicacion|where (do )?you (live|are based)/],
    ["message", /cover.?letter|carta|mensagem|message|additional.?info|comments|apresentacao/],
  ];
  var FACTS = { salary: 1, notice: 1, availability: 1, relocation: 1, workAuthorization: 1 };
  var TEXT_TYPES = { "": 1, text: 1, email: 1, tel: 1, url: 1, search: 1 };

  /* A chave de um campo pelo que dá para ler dele, sem olhar os dados. Puro. */
  function match(d) {
    var tag = (d.tag || "input").toLowerCase();
    var type = (d.type || "").toLowerCase();
    if (tag === "input" && !TEXT_TYPES[type]) return null;
    var auto = AUTOCOMPLETE[norm(d.autocomplete).split(" ").pop()];
    if (auto && tag === "input") return auto;
    if (tag === "input" && type === "email") return "email";
    if (tag === "input" && type === "tel") return "phone";
    var texts = [norm(d.name), norm(d.id), norm(d.label)];
    var NAMES = { firstName: 1, lastName: 1, fullName: 1 };
    /* "name" sozinho no atributo: o rótulo ainda pode dizer se é o nome completo ou o primeiro nome. */
    var pending = null;
    for (var t = 0; t < texts.length; t++) {
      var text = texts[t];
      if (!text) continue;
      /* Rótulo em forma de pergunta ("Tem experiência com apps mobile?"): só as respostas fixas e a cidade. */
      var question = t === 2 && (text.indexOf("?") >= 0 || text.length > 60);
      for (var i = 0; i < RULES.length; i++) {
        var key = RULES[i][0];
        if (!RULES[i][1].test(text)) continue;
        if (pending && NAMES[key] !== 1) break;
        if (key === NAME) {
          pending = tag === "input" ? NAME : null;
          break;
        }
        if (key === "message") return tag === "textarea" && !/\?|\bwhy\b|por ?que|porque/.test(text) ? key : null;
        if (question && FACTS[key] !== 1 && key !== "location") return null;
        return tag === "input" || FACTS[key] === 1 ? key : null;
      }
    }
    return pending;
  }

  /* O que preencher: só campos vazios e com dado. "Nome" sozinho é o primeiro nome quando há sobrenome. Puro. */
  function plan(descs, data) {
    var keys = descs.map(match);
    var hasLast = keys.indexOf("lastName") >= 0;
    var out = [];
    for (var i = 0; i < descs.length; i++) {
      var key = keys[i] === NAME ? (hasLast ? "firstName" : "fullName") : keys[i];
      if (!key || descs[i].filled) continue;
      var value = data[key];
      if (typeof value !== "string" || !value.trim()) continue;
      if (descs[i].maxLength > 0 && value.length > descs[i].maxLength) {
        out.push({ index: i, key: key, skipped: true });
        continue;
      }
      out.push({ index: i, key: key });
    }
    return out;
  }

  /* Só as chaves conhecidas, só texto, com tamanho limitado: o que vier colado não vira outra coisa. */
  function clean(raw) {
    var data;
    try {
      data = JSON.parse(String(raw || "").trim());
    } catch (e) {
      return null;
    }
    if (!data || data.ajf !== 1) return null;
    var out = { lang: data.lang === "en" ? "en" : "pt-BR", company: typeof data.company === "string" ? data.company.slice(0, 120) : "" };
    KEYS.forEach(function (k) {
      if (typeof data[k] === "string") out[k] = data[k].slice(0, 5000);
    });
    return out;
  }

  var LABELS = {
    "pt-BR": { firstName: "nome", lastName: "sobrenome", fullName: "nome completo", email: "e-mail", phone: "telefone", linkedin: "LinkedIn", github: "GitHub", portfolio: "site", location: "cidade", currentCompany: "empresa atual", currentTitle: "cargo atual", message: "mensagem", salary: "pretensão salarial", availability: "disponibilidade", notice: "aviso prévio", relocation: "mudança de cidade", workAuthorization: "autorização de trabalho" },
    en: { firstName: "first name", lastName: "last name", fullName: "full name", email: "e-mail", phone: "phone", linkedin: "LinkedIn", github: "GitHub", portfolio: "website", location: "location", currentCompany: "current company", currentTitle: "current title", message: "message", salary: "salary", availability: "availability", notice: "notice period", relocation: "relocation", workAuthorization: "work authorization" },
  };
  var TEXTS = {
    "pt-BR": {
      paste: "Cole aqui (Ctrl+V) os dados que você copiou no ajf (🪄 Copiar para o preenchimento):",
      bad: "Isso não parece o que o ajf copia. No ajf, abra a vaga e clique em 🪄 Copiar para o preenchimento.",
      filled: "🪄 ajf preencheu {n} campo(s){company}: {list}. Confira tudo, anexe o currículo e envie você. Nada foi enviado.",
      none: "🪄 ajf não achou campos vazios que reconhece nesta página.",
      long: "Não coube no limite do campo: {list}.",
      frame: "O formulário parece estar num quadro de outro site. Abra direto e clique no favorito de novo:",
      open: "abrir o formulário",
      close: "Fechar",
    },
    en: {
      paste: "Paste here (Ctrl+V) the data you copied in ajf (🪄 Copy for autofill):",
      bad: "This doesn't look like what ajf copies. In ajf, open the job and click 🪄 Copy for autofill.",
      filled: "🪄 ajf filled {n} field(s){company}: {list}. Check everything, attach the resume and send it yourself. Nothing was sent.",
      none: "🪄 ajf didn't find empty fields it recognizes on this page.",
      long: "Too long for the field's limit: {list}.",
      frame: "The form seems to be inside a frame from another site. Open it directly and click the bookmark again:",
      open: "open the form",
      close: "Close",
    },
  };

  function labelOf(el, doc) {
    var parts = [];
    if (el.id) {
      var forId = doc.querySelector('label[for="' + String(el.id).replace(/["\\]/g, "\\$&") + '"]');
      if (forId) parts.push(forId.textContent);
    }
    var wrap = el.closest("label");
    if (wrap) parts.push(wrap.textContent);
    var by = el.getAttribute("aria-labelledby");
    if (by)
      by.split(/\s+/).forEach(function (id) {
        var n = doc.getElementById(id);
        if (n) parts.push(n.textContent);
      });
    parts.push(el.getAttribute("aria-label") || "", el.getAttribute("placeholder") || "");
    if (!parts.join("").trim()) {
      var box = el.closest("li, fieldset, .field, .form-group, [class*=question], [class*=field]");
      var title = box && box.querySelector("label, legend, [class*=label]");
      if (title) parts.push(title.textContent);
    }
    return parts.join(" ").slice(0, 300);
  }

  function fields(doc) {
    return Array.prototype.filter.call(doc.querySelectorAll("input, textarea"), function (el) {
      return !el.disabled && !el.readOnly && el.getClientRects().length > 0;
    });
  }

  function describe(el, doc) {
    return {
      tag: el.tagName,
      type: el.getAttribute("type") || "",
      name: el.getAttribute("name") || "",
      id: el.id || "",
      autocomplete: el.getAttribute("autocomplete") || "",
      label: labelOf(el, doc),
      filled: String(el.value || "").trim() !== "",
      maxLength: el.maxLength > 0 ? el.maxLength : 0,
    };
  }

  /* Muda o valor do jeito que formulários em React e Vue percebem. */
  function setValue(el, value) {
    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    el.style.outline = "2px solid #7c6cf2";
    el.style.outlineOffset = "1px";
  }

  function banner(doc, lines, link, T) {
    var old = doc.getElementById("ajf-fill-banner");
    if (old) old.remove();
    var box = doc.createElement("div");
    box.id = "ajf-fill-banner";
    box.setAttribute("role", "status");
    box.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;max-width:420px;padding:12px 40px 12px 14px;border-radius:10px;background:#1d1b2e;color:#fff;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35)";
    lines.forEach(function (text) {
      var p = doc.createElement("p");
      p.style.margin = "0 0 6px";
      p.textContent = text;
      box.appendChild(p);
    });
    if (link) {
      var a = doc.createElement("a");
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = T.open;
      a.style.color = "#b9b0ff";
      box.appendChild(a);
    }
    var x = doc.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.setAttribute("aria-label", T.close);
    x.style.cssText = "position:absolute;top:6px;right:8px;border:0;background:none;color:#fff;font-size:20px;cursor:pointer";
    x.addEventListener("click", function () {
      box.remove();
    });
    box.appendChild(x);
    doc.body.appendChild(box);
  }

  function run() {
    var doc = document;
    var guess = /^pt/i.test(navigator.language || "") ? "pt-BR" : "en";
    var raw = window.prompt(TEXTS[guess].paste);
    if (raw == null) return;
    var data = clean(raw);
    if (!data) {
      window.alert(TEXTS[guess].bad);
      return;
    }
    var T = TEXTS[data.lang];
    var L = LABELS[data.lang];
    var els = fields(doc);
    var todo = plan(
      els.map(function (el) {
        return describe(el, doc);
      }),
      data,
    );
    var done = [];
    var long = [];
    todo.forEach(function (x) {
      if (x.skipped) return long.push(L[x.key]);
      setValue(els[x.index], data[x.key]);
      if (done.indexOf(L[x.key]) < 0) done.push(L[x.key]);
    });
    var lines = [];
    var link = "";
    if (done.length) lines.push(T.filled.replace("{n}", String(todo.length - long.length)).replace("{company}", data.company ? " (" + data.company + ")" : "").replace("{list}", done.join(", ")));
    else {
      lines.push(T.none);
      var frame = Array.prototype.find.call(doc.querySelectorAll("iframe[src]"), function (f) {
        return /^https?:/i.test(f.src) && /greenhouse|lever|ashby|workable|smartrecruiters|gupy|recruitee|teamtailor|bamboohr|myworkday|jobvite|icims/i.test(f.src);
      });
      if (frame) {
        lines.push(T.frame);
        link = frame.src;
      }
    }
    if (long.length) lines.push(T.long.replace("{list}", long.join(", ")));
    banner(doc, lines, link, T);
  }

  return { match: match, plan: plan, clean: clean, run: run };
})();
