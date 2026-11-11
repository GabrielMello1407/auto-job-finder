import "./setup.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { keysInCode, keysInHtml, loadLocale, locales, placeholders, PROVIDER_DETAILS, uiKeys } from "../scripts/i18n.js";
import { fill, tr } from "../src/ui/i18n.js";

/* ------------------------------------ idioma da interface ------------------------------------ */

test("i18n: acha as chaves no código da página e do servidor", () => {
  const code = [
    `btn("x", t("📦 Gerar pacote"), id)`,
    `const s = late ? t("⏰ hora do follow-up") : t("Enviada há {days}", { days });`,
    `plural(n, "pacote pronto", "pacotes prontos")`,
    `throw new HttpError(409, "Já está na fila.");`,
    `tr(langOf(req), "Host não permitido.")`,
    `c.t("Pacote: {job}", { job })`,
    `t("Com \\"aspas\\" escapadas")`,
    `// t("comentário não conta")`,
    `t(variavel)`,
  ].join("\n");
  assert.deepEqual(keysInCode(code).sort(), [
    "Com \"aspas\" escapadas",
    "Enviada há {days}",
    "Host não permitido.",
    "Já está na fila.",
    "Pacote: {job}",
    "pacote pronto",
    "pacotes prontos",
    "⏰ hora do follow-up",
    "📦 Gerar pacote",
  ].sort());
  const html = `<span data-i18n>Vagas</span><div data-i18n-html class="x">Rode <code>ajf</code>.</div><nav data-i18n-label="Navegação"></nav>`;
  assert.deepEqual(keysInHtml(html), ["Vagas", "Rode <code>ajf</code>.", "Navegação"]);
});

test("i18n: todo texto da interface tem tradução, e nada sobra no dicionário", () => {
  const keys = uiKeys();
  assert.ok(keys.size > 300, `poucas chaves achadas (${keys.size}): o extrator quebrou?`);
  for (const lang of locales()) {
    const dict = loadLocale(lang);
    const missing = [...keys].filter((k) => !(k in dict));
    const unused = Object.keys(dict).filter((k) => !keys.has(k));
    assert.deepEqual(missing, [], `${lang}.json: faltam traduções (rode npx tsx scripts/i18n.ts)`);
    assert.deepEqual(unused, [], `${lang}.json: chaves que o código não usa mais`);
  }
});

test("i18n: as situações das IAs traduzidas ainda existem na detecção", () => {
  const src = fs.readFileSync(new URL("../src/providers/index.ts", import.meta.url), "utf8");
  for (const d of PROVIDER_DETAILS) assert.ok(src.includes(d), `"${d}" não está mais em src/providers/index.ts: atualize scripts/i18n.ts`);
});

test("i18n: tradução com as mesmas {variáveis} e sem texto vazio", () => {
  for (const lang of locales()) {
    for (const [key, value] of Object.entries(loadLocale(lang))) {
      assert.ok(value.trim(), `${lang}.json: "${key}" está vazio`);
      assert.deepEqual(placeholders(value), placeholders(key), `${lang}.json: variáveis diferentes em "${key}"`);
    }
  }
});

test("i18n: o servidor traduz pelo idioma da página e preenche as variáveis", () => {
  assert.equal(tr("en", "Já está na fila."), "Already queued.");
  assert.equal(tr("en", "Arquivo grande demais (máximo {mb} MB).", { mb: 15 }), "File too large (maximum 15 MB).");
  assert.equal(tr("pt-BR", "Arquivo grande demais (máximo {mb} MB).", { mb: 15 }), "Arquivo grande demais (máximo 15 MB).");
  // Sem tradução (ex.: mensagem de erro vinda de outra parte do agente), volta o próprio texto.
  assert.equal(tr("en", "Mensagem sem tradução {x}", { x: 1 }), "Mensagem sem tradução 1");
  assert.equal(fill("{a} e {b}", { a: 1 }), "1 e {b}");
});
