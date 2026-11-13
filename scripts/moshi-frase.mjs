#!/usr/bin/env node
/**
 * Invia la frase del momento (lo stesso slot dell'app) tramite il webhook Moshi.
 * Usato da .github/workflows/frasi-moshi.yml ogni 30 minuti (Europe/Rome).
 *
 * Ore di silenzio: dalle 23 alle 7 (ora di Roma), saltate salvo FORCE=1
 * o un avvio manuale (workflow_dispatch).
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SLOT_MS = 30 * 60 * 1000;
const TZ = "Europe/Rome";
const MOSHI_URL = "https://api.getmoshi.app/api/webhook";
const APP_URL = "https://zaratireeda41-art.github.io/mie-cose/";
const QUIET_START = 23;
const QUIET_END = 7;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFrasi() {
  const frasiPath = path.join(__dirname, "..", "frasi.js");
  const code = fs.readFileSync(frasiPath, "utf8");
  vm.runInThisContext(code, { filename: frasiPath });
  if (!globalThis.MiaFrasi || typeof globalThis.MiaFrasi.phraseForSlot !== "function") {
    throw new Error("frasi.js non ha esposto MiaFrasi.phraseForSlot");
  }
  return globalThis.MiaFrasi;
}

function romeHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour").value);
}

function romeStamp(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

function isForced() {
  const f = String(process.env.FORCE || "").trim().toLowerCase();
  if (f === "1" || f === "true" || f === "yes") return true;
  return process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
}

function inQuietHours(date) {
  const h = romeHour(date);
  return h >= QUIET_START || h < QUIET_END;
}

function currentSlot(date = new Date()) {
  // Stesso calcolo dell'app: Math.floor(Date.now() / (30 * 60 * 1000)).
  // Lo slot è sull'epoca Unix, indipendente dal fuso; il fuso serve solo alle ore di silenzio.
  return Math.floor(date.getTime() / SLOT_MS);
}

async function sendMoshi({ token, title, message }) {
  const res = await fetch(MOSHI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      title,
      message,
      data: { type: "url", url: APP_URL }
    })
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body, text };
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const now = new Date();
const forced = isForced();
const hour = romeHour(now);
const slot = currentSlot(now);

console.log("Europe/Rome: " + romeStamp(now) + " (ora " + hour + ")");
console.log("Slot: " + slot + (forced ? " [FORCE]" : ""));

if (!forced && inQuietHours(now)) {
  console.log("Ore di silenzio (23–7 Europe/Rome): nessuna notifica.");
  process.exit(0);
}

const token = String(process.env.MOSHI_TOKEN || "").trim();
if (!token) {
  fail("Manca MOSHI_TOKEN. Imposta il secret del repository o la variabile d'ambiente.");
}

const Frasi = loadFrasi();
const phrase = Frasi.phraseForSlot(slot);
if (!phrase || !phrase.text) {
  fail("Impossibile generare la frase per lo slot " + slot);
}

const title = "Mie Cose · " + (phrase.themeLabel || "Mie Cose");
const message = phrase.text;

console.log("Persona: " + (phrase.themeLabel || phrase.theme));
console.log("Titolo: " + title);
console.log("Frase: " + message);

const result = await sendMoshi({ token, title, message });
const preview = (result.text || "").slice(0, 400);
if (!result.ok || !result.body || result.body.success !== true) {
  fail("Moshi non ha accettato l'invio (HTTP " + result.status + "): " + preview);
}
if (result.body.pushSent !== undefined && Number(result.body.pushSent) < 1) {
  fail("Moshi ha risposto success ma pushSent=" + result.body.pushSent + ": " + preview);
}
console.log("Inviata. pushSent=" + (result.body.pushSent ?? "?"));
