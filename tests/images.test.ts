import "./setup.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { anthropicContent, copyImages, geminiParts, imageMime, imageNote, openaiChatContent, openaiResponsesInput, type ImageInput } from "../src/providers/images.js";
import { cleanImageQuestions, imageFile, imageFromFile } from "../src/writers/answers.js";

/* ------------------------------ print da pergunta do formulário ------------------------------ */

// Um PNG de 1x1 pixel.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ajf-img-test-"));
}

test("imagem: tipo pelos primeiros bytes, não pela extensão", () => {
  assert.equal(imageMime(PNG), "image/png");
  assert.equal(imageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
  assert.equal(imageMime(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1")), "image/webp");
  assert.equal(imageMime(Buffer.from("GIF89a....", "latin1")), "image/gif");
  assert.equal(imageMime(Buffer.from("%PDF-1.7", "latin1")), null);
  assert.equal(imageMime(Buffer.from("<svg></svg>", "latin1")), null);
  assert.equal(imageMime(Buffer.alloc(0)), null);
});

test("imagem: caminho digitado ou arrastado no terminal", () => {
  const dir = tmp();
  try {
    const file = path.join(dir, "print da pergunta.png");
    fs.writeFileSync(file, PNG);
    assert.equal(imageFile(file), file);
    assert.equal(imageFile(`"${file}"`), file, "Windows arrasta com aspas");
    assert.equal(imageFile(`'${file}'`), file);
    assert.equal(imageFile(`& '${file}'`), file, "PowerShell arrasta com &");
    assert.equal(imageFile(`  ${file}  `), file);
    assert.equal(imageFile("Por que você quer trabalhar aqui?"), null, "pergunta digitada não é arquivo");
    assert.equal(imageFile(path.join(dir, "nao-existe.png")), null);
    const txt = path.join(dir, "notas.txt");
    fs.writeFileSync(txt, "x");
    assert.equal(imageFile(txt), null);
    assert.deepEqual(imageFromFile(file), { path: file, mime: "image/png" });
    const fake = path.join(dir, "falso.png");
    fs.writeFileSync(fake, "não é imagem");
    assert.throws(() => imageFromFile(fake), /não é uma imagem PNG, JPG, WEBP ou GIF/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("imagem no pedido: formato de cada API e das CLIs", () => {
  const dir = tmp();
  try {
    const file = path.join(dir, "p.png");
    fs.writeFileSync(file, PNG);
    const img: ImageInput = { path: file, mime: "image/png" };
    const b64 = PNG.toString("base64");

    // Sem imagem, nada muda.
    assert.equal(anthropicContent("oi"), "oi");
    assert.equal(openaiResponsesInput("oi"), "oi");
    assert.equal(openaiChatContent("oi"), "oi");
    assert.deepEqual(geminiParts("oi"), [{ text: "oi" }]);

    assert.deepEqual(anthropicContent("leia", [img]), [{ type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }, { type: "text", text: "leia" }]);
    assert.deepEqual(openaiResponsesInput("leia", [img]), [
      { role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${b64}` }, { type: "input_text", text: "leia" }] },
    ]);
    assert.deepEqual(openaiChatContent("leia", [img]), [{ type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } }, { type: "text", text: "leia" }]);
    assert.deepEqual(geminiParts("leia", [img]), [{ inline_data: { mime_type: "image/png", data: b64 } }, { text: "leia" }]);

    // CLIs: a imagem vai para a pasta da chamada e o pedido diz para abrir com a ferramenta de ler arquivos.
    const callDir = path.join(dir, "chamada");
    fs.mkdirSync(callDir);
    const copies = copyImages(callDir, [img]);
    assert.equal(copies.length, 1);
    assert.ok(copies[0].startsWith(callDir) && copies[0].endsWith(".png"));
    assert.deepEqual(fs.readFileSync(copies[0]), PNG);
    const note = imageNote(copies, "Read");
    assert.match(note, /uma imagem: \.\/imagem-.+\.png/);
    assert.match(note, /ferramenta Read/);
    assert.equal(imageNote([], "Read"), "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("perguntas lidas da imagem: sem repetidas, sem lixo, limite 0 vira sem limite", () => {
  const out = cleanImageQuestions([
    { question: "  Por que você quer   trabalhar aqui? ", limit: 500 },
    { question: "Por que você quer trabalhar aqui?", limit: 0 },
    { question: "Fale de um projeto de que você se orgulha.", limit: 0 },
    { question: "OK", limit: 0 },
    { question: "Quanto tempo de experiência com React?", limit: 99999 },
  ]);
  assert.deepEqual(out, [
    { question: "Por que você quer trabalhar aqui?", limit: 500 },
    { question: "Fale de um projeto de que você se orgulha.", limit: undefined },
    { question: "Quanto tempo de experiência com React?", limit: 20000 },
  ]);
});
