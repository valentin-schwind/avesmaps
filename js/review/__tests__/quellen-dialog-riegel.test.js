// DER RIEGEL AM FREMDEN FORMULAR -- „Speichern" des Dialogs darf keine ausgefuellte Quelle wegwerfen.
//
// 💣 GEMESSEN AN index.html: der Quellenkasten liegt in VIER Kartendialogen IM `<form>` des Dialogs
// (location-edit-form, path-edit-form, powerline-edit-form, region-edit-form), jedes mit eigenem
// `<button type="submit">Speichern</button>`. Damit stehen zwei Knoepfe „Speichern" in einem
// Fenster -- der des Kastens steckt in der zugeklappten Falte, der des Dialogs ist der grosse.
// Gemessen gegen ein echtes DOM: der grosse schickte aus dem Kasten NULL Anfragen und raeumte die
// Zeile danach ab (`resetForm: true`). Eine vollstaendig ausgefuellte Quelle war wortlos weg.
//
// 💣 UND DIE FANGPHASE IST TRAGEND. Der Speicherweg des Dialogs haengt AM FORMULAR und wird beim
// Seitenstart gebunden (js/app/bootstrap.js), das Bauteil montiert erst beim Oeffnen. Am selben
// Element laufen Zuhoerer in ANMELDEreihenfolge -- ein `preventDefault()` von hier kaeme zu spaet.
// Deshalb haengt der Riegel am VORFAHREN des Formulars, in der Fangphase.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellen-dialog-riegel.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const quelleJs = fs.readFileSync(path.join(WURZEL, "js", "review", "review-feature-sources.js"), "utf8");
const markupJs = fs.readFileSync(path.join(WURZEL, "js", "ui", "feature-source-markup.js"), "utf8");
const modul = require(path.join(WURZEL, "js", "review", "review-feature-sources.js"));
require(path.join(WURZEL, "js", "ui", "feature-source-markup.js"));
const { featureSourceFormRiegel } = modul;

let n = 0;
const pruefe = (b, t) => { assert.ok(b, t); n++; };
const gleich = (a, b, t) => { assert.strictEqual(a, b, t); n++; };

// ── Ein Formular-Doppel mit seinem Vorfahren ───────────────────────────────────────────────────
function macheFormular() {
  const zuhoerer = [];
  const wirt = {
    addEventListener: (typ, fn, capture) => zuhoerer.push({ typ, fn, capture }),
  };
  const form = {
    dataset: {}, parentNode: wirt,
    contains: () => true,
    querySelector: () => null,
  };
  const behaelter = { closest: (sel) => (sel === "form" ? form : null), querySelector: () => null };
  return { wirt, form, behaelter, zuhoerer,
    feuere: (typ, ereignis) => zuhoerer.filter((z) => z.typ === typ).forEach((z) => z.fn(ereignis)) };
}
const macheSubmit = (ziel) => {
  const e = { target: ziel, verhindert: false, gestoppt: false };
  e.preventDefault = () => { e.verhindert = true; };
  e.stopPropagation = () => { e.gestoppt = true; };
  return e;
};
const macheEnter = (tag, drin, key) => {
  const e = {
    key: key === undefined ? "Enter" : key,
    target: { tagName: tag, closest: (sel) => (drin && /data-fs-add/.test(sel) ? {} : null) },
    verhindert: false,
  };
  e.preventDefault = () => { e.verhindert = true; };
  return e;
};

// ══ 1 · Wo der Riegel haengt ════════════════════════════════════════════════════════════════════
const a = macheFormular();
gleich(featureSourceFormRiegel(a.behaelter, () => false), a.form, "der Riegel findet das Formular");
// 💣 AM VORFAHREN, IN DER FANGPHASE -- am Formular selbst kaeme er nach dem Speicherweg des Dialogs.
gleich(a.zuhoerer.length, 2, "zwei Zuhoerer: Absenden und Enter");
a.zuhoerer.forEach((z) => pruefe(z.capture === true, z.typ + " haengt in der FANGPHASE"));
pruefe(a.zuhoerer.every((z) => z.typ === "submit" || z.typ === "keydown"), "und sonst nichts");

// ══ 2 · Er haelt nur, wenn etwas offen ist ══════════════════════════════════════════════════════
let offen = false;
const b = macheFormular();
featureSourceFormRiegel(b.behaelter, () => offen);
let ev = macheSubmit(b.form);
b.feuere("submit", ev);
pruefe(!ev.verhindert && !ev.gestoppt, "leere Eingabezeile: das Speichern des Dialogs laeuft durch");
offen = true;
ev = macheSubmit(b.form);
b.feuere("submit", ev);
pruefe(ev.verhindert && ev.gestoppt,
  "gefuellte Eingabezeile: das Speichern wird verhindert UND gestoppt");
// 🔴 `stopPropagation` ist kein Beiwerk: `handleLocationEditFormSubmit` ruft selbst
// `event.preventDefault()` und speichert danach -- ein blosses Verhindern hielte ihn nicht auf.
ev = macheSubmit({ andere: "Form" });
b.feuere("submit", ev);
pruefe(!ev.verhindert, "ein FREMDES Formular unter demselben Vorfahren geht uns nichts an");

// ══ 3 · EIN Zuhoerer je Formular, aber immer die AKTUELLE Montage ═══════════════════════════════
// 💣 Der Kartendialog tauscht seinen Behaelter bei jedem Oeffnen aus. Stapelten sich die Zuhoerer,
// waere das die Doppelanmeldung aus AGENTS.md §11; bliebe der ERSTE Pruefer stehen, haette der
// Riegel nach dem zweiten Oeffnen einen abgehaengten Kasten im Blick.
const c = macheFormular();
featureSourceFormRiegel(c.behaelter, () => false);
const zweiter = { gerufen: 0 };
featureSourceFormRiegel(c.behaelter, () => { zweiter.gerufen++; return true; });
gleich(c.zuhoerer.length, 2, "auch nach der zweiten Montage haengen genau zwei Zuhoerer");
ev = macheSubmit(c.form);
c.feuere("submit", ev);
gleich(zweiter.gerufen, 1, "und gefragt wird der Pruefer der ZWEITEN Montage");
pruefe(ev.verhindert, "dessen Antwort gilt");

// ══ 4 · Ohne Formular gibt es nichts zu riegeln ═════════════════════════════════════════════════
// ⚠️ Drei Oberflaechen montieren ausserhalb jedes Formulars (Ortseditor, Sync-Monitor,
// Beschriftungsdialog) -- dort darf der Riegel nichts anfassen und nicht werfen.
gleich(featureSourceFormRiegel({ closest: () => null }, () => true), null, "kein Formular: nichts");
gleich(featureSourceFormRiegel({}, () => true), null, "kein `closest`: auch nichts");
gleich(featureSourceFormRiegel(null, () => true), null, "kein Behaelter: auch nichts");

// ══ 5 · Enter ═══════════════════════════════════════════════════════════════════════════════════
const d = macheFormular();
featureSourceFormRiegel(d.behaelter, () => false);
let k = macheEnter("INPUT", true); d.feuere("keydown", k);
pruefe(k.verhindert, "Enter in einem FELD der Eingabezeile sendet das Formular nicht ab");
k = macheEnter("SELECT", true); d.feuere("keydown", k);
pruefe(k.verhindert, "auch am Auswahlfeld -- dort faengt Fall #122 an");
// ⚠️ Ein Knopf, eine Falte oder ein Link brauchen Enter fuer ihre EIGENE Handlung.
k = macheEnter("BUTTON", true); d.feuere("keydown", k);
pruefe(!k.verhindert, "auf einem Knopf wird Enter NICHT abgefangen");
k = macheEnter("SUMMARY", true); d.feuere("keydown", k);
pruefe(!k.verhindert, "auf der Falte ebenso wenig");
k = macheEnter("INPUT", false); d.feuere("keydown", k);
pruefe(!k.verhindert, "und ausserhalb des Kastens gehoert Enter dem Dialog");
k = macheEnter("INPUT", true, "a"); d.feuere("keydown", k);
pruefe(!k.verhindert, "eine andere Taste ohnehin nicht");

// ══ 6 · Die Messung, auf der das alles ruht ═════════════════════════════════════════════════════
// 🔴 Faellt sie, hat der Riegel keinen Gegenstand mehr -- dann gehoert er geprueft, nicht still
// mitgeschleppt. Deshalb steht sie hier und nicht nur im Kommentar.
const indexHtml = fs.readFileSync(path.join(WURZEL, "index.html"), "utf8");
const inFormMitSubmit = (id) => {
  const pos = indexHtml.indexOf('id="' + id + '"');
  if (pos === -1) { return false; }
  const auf = indexHtml.lastIndexOf("<form", pos);
  const zu = indexHtml.lastIndexOf("</form>", pos);
  if (auf === -1 || auf < zu) { return false; }
  const ende = indexHtml.indexOf("</form>", pos);
  return /<button[^>]*type="submit"/.test(indexHtml.slice(auf, ende));
};
["location-edit-feature-sources", "path-edit-feature-sources",
  "powerline-edit-feature-sources", "region-edit-feature-sources"].forEach((id) => {
  pruefe(inFormMitSubmit(id), id + " liegt im Formular eines Dialogs mit eigenem „Speichern“");
});
// ⚠️ Und der Beschriftungsdialog NICHT -- das ist eine Messung, keine Luecke.
pruefe(!inFormMitSubmit("label-edit-feature-sources"),
  "der Beschriftungsdialog liegt ausserhalb jedes Formulars");

// ══ 7 · Der Pruefer der Montage ═════════════════════════════════════════════════════════════════
function macheKontext() {
  const ctx = { console, window: { __sourceCatalog: {}, __featureSourceRefs: {} },
    document: { querySelector: () => null }, attachSourceAutocomplete: () => () => {},
    fetch: async () => ({ json: async () => ({ ok: true, wiki_url: "", sources: [] }) }) };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(markupJs, ctx); vm.runInContext(quelleJs, ctx);
  return ctx;
}
function macheBehaelter(form) {
  const felder = {};
  for (const sel of [".fs-add-url", ".fs-add-label", ".fs-add-type", ".fs-add-kind", ".fs-add-official",
    ".fs-add-pages", ".fs-add-license", ".fs-add-attribution"]) {
    felder[sel] = { value: "", checked: false, dataset: {}, focus() {}, addEventListener() {},
      classList: { add() {}, remove() {}, toggle() {} },
      matches: (s) => s === sel, closest: () => null };
  }
  felder["[data-fs-note]"] = { textContent: "", hidden: true, classList: { add() {}, remove() {} } };
  return { innerHTML: "", felder, closest: (s) => (s === "form" ? form : null),
    addEventListener() {}, querySelector(sel) { return felder[sel] || null; }, querySelectorAll() { return []; } };
}

(async () => {
  const f = macheFormular();
  const ctx = macheKontext();
  const bh = macheBehaelter(f.form);
  f.behaelter = bh;
  await ctx.mountFeatureSourceEditor(bh, "settlement", () => "salthel-1", {});
  const submit = () => { const e = macheSubmit(f.form); f.feuere("submit", e); return e; };

  pruefe(!submit().verhindert, "leer: das Speichern des Dialogs laeuft durch");
  bh.felder[".fs-add-url"].value = "https://garetien.de/Salthel";
  pruefe(submit().verhindert, "mit getippter Adresse haelt der Riegel");
  pruefe(bh.felder["[data-fs-note]"].textContent.indexOf("noch nicht eingetragen") !== -1,
    "und sagt, was im Weg steht: " + JSON.stringify(bh.felder["[data-fs-note]"].textContent));
  bh.felder[".fs-add-url"].value = "";
  bh.felder[".fs-add-label"].value = "Salthel";
  pruefe(submit().verhindert, "auch ein getippter TITEL allein ist ungespeicherte Arbeit");
  bh.felder[".fs-add-label"].value = "";
  pruefe(!submit().verhindert, "geleert laeuft es wieder durch");

  // 🔴 DIE MELDUNGS-WARTESCHLANGE IST AUSGENOMMEN: dort hat nicht der Editor getippt, die Quelle
  // steht weiter in der Meldung, und „Ueberspringen" ist der vorgesehene Weg. Wer hier riegelte,
  // koennte eine Meldung nicht mehr annehmen.
  const f2 = macheFormular();
  const ctx2 = macheKontext();
  const bh2 = macheBehaelter(f2.form);
  await ctx2.mountFeatureSourceEditor(bh2, "settlement", () => "salthel-1",
    { meldung: { quellen: [{ url: "https://garetien.de/X", vorbelegung: { state: "neu" } }] } });
  bh2.felder[".fs-add-url"].value = "https://garetien.de/X";
  const e2 = macheSubmit(f2.form); f2.feuere("submit", e2);
  pruefe(!e2.verhindert, "im Meldungs-Fall haelt der Riegel NICHT");

  // Der offene ✎ mit Aenderung haelt ebenfalls -- gefragt wird `featureSourceChangedFields`,
  // also DIESELBE Regel, an der auch sein Speichern entscheidet, was es schickt.
  const f3 = macheFormular();
  const ctx3 = macheKontext();
  const bh3 = macheBehaelter(f3.form);
  await ctx3.mountFeatureSourceEditor(bh3, "settlement", () => "salthel-1", {});
  const machePanel = (wert, orig) => ({
    querySelectorAll: (s) => (s === "[data-fs-field]"
      ? [{ getAttribute: (at) => (at === "data-fs-field" ? "pages" : (at === "data-fs-orig" ? orig : "")),
        value: wert, disabled: false, type: "text" }] : []),
    querySelector: () => ({ textContent: "" }),
  });
  let panelWert = "12";
  const alteAbfrage = bh3.querySelector.bind(bh3);
  bh3.querySelector = (sel) => (sel === "[data-fs-edit-panel]" ? machePanel(panelWert, "") : alteAbfrage(sel));
  const e3 = macheSubmit(f3.form); f3.feuere("submit", e3);
  pruefe(e3.verhindert, "ein offener ✎ MIT Aenderung haelt das Speichern des Dialogs");
  panelWert = "";
  const e4 = macheSubmit(f3.form); f3.feuere("submit", e4);
  pruefe(!e4.verhindert, "ein offener ✎ OHNE Aenderung nicht -- wer nur hinsieht, wird nicht aufgehalten");

  console.log("quellen-dialog-riegel: " + n + " Zusicherungen erfuellt");
})().catch((e) => { console.error(e); process.exit(1); });
