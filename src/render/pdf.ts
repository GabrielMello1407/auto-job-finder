import fs from "node:fs";
import puppeteer, { type Browser } from "puppeteer-core";
import { settings } from "../config.js";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser) return browser;
  if (!settings.chromePath)
    throw new Error("Chrome/Edge não encontrado. Defina CHROME_PATH no .env com o caminho do executável.");
  browser = await puppeteer.launch({ executablePath: settings.chromePath, headless: true, args: ["--no-sandbox"] });
  return browser;
}

export async function closeBrowser() {
  if (browser) await browser.close();
  browser = null;
}

/** Renderiza HTML em PDF (texto selecionável, compatível com ATS). Retorna o número de páginas. */
export async function htmlToPdf(html: string, outPath: string, paper: "A4" | "Letter"): Promise<number> {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: paper === "Letter" ? "letter" : "a4", printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(outPath, pdf);
    return countPdfPages(Buffer.from(pdf));
  } finally {
    await page.close();
  }
}

/** Texto visível de uma página que só monta o conteúdo com JavaScript (ex.: portfólio em React). */
export async function renderedPageText(url: string): Promise<string> {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45_000 });
    return await page.evaluate(() => document.body?.innerText ?? "");
  } finally {
    await page.close();
  }
}

export function countPdfPages(buf: Buffer): number {
  const m = buf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g);
  return m ? m.length : 0;
}
