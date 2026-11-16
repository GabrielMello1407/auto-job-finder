import "./setup.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { autofillData, bookmarkletHref, bookmarkletPage, compactScript } from "../src/autofill/index.js";
import { DEFAULT_PREFERENCES, loadBaseResume } from "../src/profile.js";

/* ----------------------------- preencher formulários com o favorito do navegador ----------------------------- */

const SOURCE = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "autofill", "bookmarklet.js"), "utf8");

interface Desc {
  tag?: string;
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  label?: string;
  filled?: boolean;
  maxLength?: number;
}
interface Fill {
  match(d: Desc): string | null;
  plan(d: Desc[], data: Record<string, unknown>): { index: number; key: string; skipped?: boolean }[];
  clean(raw: string): Record<string, string> | null;
}
/** As funções puras do favorito, sem navegador. */
const fill = (): Fill => vm.runInNewContext(`${SOURCE}\nAJF_FILL`) as Fill;
/** Objetos de outro contexto (vm) não passam no deepEqual: compara pelo JSON. */
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x));

test("favorito: reconhece os campos de Greenhouse, Lever, Ashby e formulários em português", () => {
  const { match } = fill();
  const cases: [Desc, string | null][] = [
    // Greenhouse
    [{ id: "first_name", name: "first_name", label: "First Name*" }, "firstName"],
    [{ id: "last_name", name: "last_name", label: "Last Name*" }, "lastName"],
    [{ id: "email", type: "text", label: "Email*" }, "email"],
    [{ id: "phone", type: "tel", label: "Phone" }, "phone"],
    [{ name: "job_application[answers_attributes][0][text_value]", label: "LinkedIn Profile" }, "linkedin"],
    [{ id: "candidate-location", label: "Location (City)" }, "location"],
    [{ tag: "textarea", id: "cover_letter_text", label: "Cover Letter" }, "message"],
    // Lever
    [{ name: "name", label: "Full name✱" }, "fullName"],
    [{ name: "name" }, "name"], // sem rótulo: o plano decide (primeiro nome ou nome completo)
    [{ name: "urls[LinkedIn]", label: "LinkedIn URL" }, "linkedin"],
    [{ name: "urls[GitHub]" }, "github"],
    [{ name: "urls[Portfolio]" }, "portfolio"],
    [{ name: "urls[Twitter]", label: "Twitter URL" }, null],
    [{ name: "org", label: "Current company" }, "currentCompany"],
    [{ tag: "textarea", name: "comments", label: "Additional information" }, "message"],
    // Ashby
    [{ name: "_systemfield_name" }, "fullName"],
    [{ name: "_systemfield_email", type: "email" }, "email"],
    // Português, autocomplete e tipo
    [{ label: "Sobrenome" }, "lastName"],
    [{ label: "Celular (WhatsApp)" }, "phone"],
    [{ label: "Cidade onde mora" }, "location"],
    [{ autocomplete: "given-name" }, "firstName"],
    [{ type: "email", label: "Seu contato" }, "email"],
    [{ label: "Pretensão salarial" }, "salary"],
    [{ label: "Will you now or in the future require visa sponsorship?" }, "workAuthorization"],
    [{ label: "Are you willing to relocate?" }, "relocation"],
    [{ tag: "textarea", label: "Expectativa salarial (CLT ou PJ)" }, "salary"],
    // O que não deve ser preenchido
    [{ type: "file", name: "resume" }, null],
    [{ type: "checkbox", name: "gdpr" }, null],
    [{ tag: "textarea", label: "Why do you want to work here?" }, null],
    [{ tag: "textarea", label: "Por que você quer trabalhar aqui? (carta de apresentação)" }, null],
    [{ label: "Do you have experience building mobile apps?" }, null],
    [{ tag: "textarea", label: "Location" }, null],
    [{ type: "text", label: "How did you hear about us?" }, null],
  ];
  for (const [d, want] of cases) assert.equal(match(d), want, JSON.stringify(d));
});

test("favorito: só campos vazios e com dado; 'Nome' sozinho depende de haver sobrenome", () => {
  const { plan } = fill();
  const data = { firstName: "Ana", lastName: "Souza", fullName: "Ana Souza", email: "ana@example.com", message: "x".repeat(700) };
  const withLast = plain(plan([{ label: "Nome" }, { label: "Sobrenome" }, { label: "E-mail", filled: true }, { label: "LinkedIn" }], data));
  assert.deepEqual(withLast, [
    { index: 0, key: "firstName" },
    { index: 1, key: "lastName" },
  ], "e-mail já preenchido fica como está; LinkedIn sem dado fica vazio");
  assert.deepEqual(plain(plan([{ label: "Nome" }, { label: "E-mail" }], data)), [
    { index: 0, key: "fullName" },
    { index: 1, key: "email" },
  ]);
  assert.deepEqual(plain(plan([{ tag: "textarea", label: "Cover letter", maxLength: 600 }], data)), [{ index: 0, key: "message", skipped: true }], "não corta a mensagem no meio");
});

test("favorito: só aceita o que o ajf copia, e só texto", () => {
  const { clean } = fill();
  assert.equal(clean("qualquer coisa"), null);
  assert.equal(clean('{"email":"a@b.c"}'), null, "sem a marca do ajf");
  const c = clean(JSON.stringify({ ajf: 1, lang: "en", company: "Acme", email: "a@b.c", phone: 123, evil: "<script>", fullName: "x".repeat(9000) }));
  assert.equal(c?.lang, "en");
  assert.equal(c?.email, "a@b.c");
  assert.equal(c?.phone, undefined, "número não é texto");
  assert.equal("evil" in (c ?? {}), false, "chave desconhecida fica de fora");
  assert.equal(c?.fullName.length, 5000);
});

test("favorito: nunca envia, clica ou manda dados para fora; o link não leva dado nenhum", () => {
  const code = compactScript(SOURCE);
  for (const banned of [".submit(", "requestSubmit", ".click(", "fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "innerHTML", "eval("])
    assert.equal(code.includes(banned), false, `o favorito não pode usar ${banned}`);
  assert.doesNotMatch(code, /^\s*\/\//m, "sem linhas de comentário no link");
  const href = bookmarkletHref(SOURCE);
  assert.match(href, /^javascript:/);
  assert.ok(href.length < 32_000, "cabe num favorito");
  const js = decodeURIComponent(href.slice("javascript:".length));
  assert.doesNotThrow(() => new Function(js.replace("AJF_FILL.run();", "")), "o código do link é JavaScript válido");
  assert.doesNotMatch(href, /example\.com|Souza/, "nenhum dado da pessoa no favorito");
  assert.ok(bookmarkletPage(href).includes(`href="${href}"`));
});

test("dados do preenchimento: só os grupos ligados, links com https e nada inventado", () => {
  const resume = loadBaseResume("pt-BR");
  const facts = { ...DEFAULT_PREFERENCES.applicationFacts, salaryExpectation: "R$ 9.000 CLT" };
  const groups = { contact: true, links: true, location: true, current: true, message: true, facts: false };
  const d = autofillData(resume, { company: "Acme", note: "Mensagem — curta.", facts, groups, lang: "pt-BR" });
  assert.equal(d.ajf, 1);
  assert.equal(d.fullName, resume.name);
  assert.equal(d.firstName, resume.name.split(" ")[0]);
  assert.equal(d.email, resume.contact.email);
  assert.equal("phone" in d, false, "telefone vazio no perfil não vai");
  assert.match(String(d.linkedin), /^https:\/\/linkedin\.com\//);
  assert.equal(d.message, "Mensagem, curta.", "sem travessão");
  assert.equal("salary" in d, false, "respostas fixas desligadas por padrão");

  const only = autofillData(resume, { company: "Acme", facts, groups: { ...groups, contact: false, links: false, location: false, current: false, message: false, facts: true }, lang: "en" });
  assert.deepEqual(Object.keys(only).sort(), ["ajf", "company", "lang", "salary"]);
  assert.equal(DEFAULT_PREFERENCES.autofill.enabled, false, "começa desligado");
});
