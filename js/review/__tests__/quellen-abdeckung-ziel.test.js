// QUELLE ODER PUBLIKATION -- die Abdeckung sagt, was aus der Eingabe wird.
//
// 💣 FALL #122 (Owner 10.09.2026, Salthel): „Fuegt man eine externe Quelle manuell hinzu und will
// die Abdeckung ‚Nur an diesem Objekt‘ aendert, z.B. von ‚Standardquelle‘ auf ‚Ausfuehrlich‘, wird
// die Quelle beim Speichern nicht hinzugefuegt." Nachgemessen: gespeichert wurde sie IMMER -- der
// Server verzweigt auf `reference_kind` an keiner Stelle des Anlegewegs. Sie war ab diesem Moment
// nur keine QUELLE mehr: `reference_kind !== ''` ist im ganzen Haus das Kennzeichen „Publikation"
// (Anzeige, Kanon, Wegquellen-Verteiler), und nichts sagte es.
//
// 🔴 OWNER-ENTSCHEID 12.09.2026: „ich find das vorgehen macht sinn, kann man das kommunizieren,
// dass es aufgrund der eingabe publikation oder quelle wird." Das Verhalten bleibt -- es muss sich
// erklaeren, VOR dem Speichern (Hinweiszeile) und danach (Bestaetigung).
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellen-abdeckung-ziel.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (...t) => fs.readFileSync(path.join(WURZEL, ...t), "utf8");
const quelleJs = lies("js", "review", "review-feature-sources.js");
const markupJs = lies("js", "ui", "feature-source-markup.js");

let n = 0;
const pruefe = (b, t) => { assert.ok(b, t); n++; };
const gleich = (a, b, t) => { assert.strictEqual(a, b, t); n++; };

const modul = require(path.join(WURZEL, "js", "review", "review-feature-sources.js"));
require(path.join(WURZEL, "js", "ui", "feature-source-markup.js"));
const {
  featureSourceKindZiel, featureSourceKindZielMarkup, featureSourceKindZielNachziehen,
  featureSourceKindZielBestaetigung, renderFeatureSourceEditorHtml, renderFeatureSourceEditPanel,
} = modul;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const tr = (_k, f) => f;

// ══ 1 · Die Regel ═══════════════════════════════════════════════════════════════════════════════
gleich(featureSourceKindZiel("").publikation, false, "leer = Quelle -- der Normalfall des Formulars");
["ausfuehrlich", "ergaenzend", "erwaehnung"].forEach((k) => {
  gleich(featureSourceKindZiel(k).publikation, true, k + " macht daraus eine Publikation");
});
// 🔴 GEMESSEN AN DER WEISSEN LISTE, nicht an „nicht leer". Der Server (`$allowedKinds` in
// avesmapsAddFeatureSource) macht aus allem anderen `null` -- also eine Quelle. Wer hier auf
// „nicht leer" prueft, behauptet eine Publikation, die nie angelegt wird.
gleich(featureSourceKindZiel("wichtig").publikation, false,
  "ein unbekannter Wert ist eine QUELLE -- genau das legt der Server an");
gleich(featureSourceKindZiel(null).publikation, false, "und nichts ist auch nichts");
// Die zwei Folgen stehen IM Satz -- ohne sie ist „Publikation" ein Wort ohne Wirkung.
pruefe(featureSourceKindZiel("ausfuehrlich").satz.includes("Publikationstabelle"),
  "der Satz nennt, WO die Zeile dann steht");
pruefe(/offiziell/.test(featureSourceKindZiel("ausfuehrlich").satz),
  "und dass sie den Kanon nicht mehr entscheidet");
pruefe(featureSourceKindZiel("").satz.includes("Quelle(n)"),
  "und im Quellenfall, wo sie stattdessen steht");
// 💣 Die zwei Saetze muessen VERSCHIEDEN sein -- eine Hinweiszeile, die in beiden Zustaenden
// dasselbe sagt, ist keine Auskunft, sondern Zierde.
pruefe(featureSourceKindZiel("").satz !== featureSourceKindZiel("erwaehnung").satz,
  "Quelle und Publikation sagen nicht dasselbe");
pruefe(featureSourceKindZiel("").wort !== featureSourceKindZiel("erwaehnung").wort, "und heissen nicht gleich");

// ══ 2 · Die Hinweiszeile steht in BEIDEN Formularen ═════════════════════════════════════════════
// 💣 Eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel (AGENTS.md §11). Die
// Abdeckung steht in der Eingabezeile UND im ✎ -- also muss die Auskunft in beiden stehen.
// ⚠️ Gemessen wird das GEBAUTE Markup, nicht der Quelltext: ein Regex kennt keinen Geltungsbereich
// (die Lehre vom 03.09.2026, als ein gruener Quelltext-Test zwei Stunden lang keine Beschriftungen
// auf der Karte verhinderte).
const eingabe = renderFeatureSourceEditorHtml({ ok: true, wiki_url: "", sources: [] }, { escape: esc, tr });
const zaehleZeilen = (html) => (html.match(/data-fs-kind-ziel/g) || []).length;
gleich(zaehleZeilen(eingabe), 1, "die Eingabezeile traegt GENAU EINE Hinweiszeile");
pruefe(/Wird geführt als[\s\S]*?<strong data-fs-kind-wort>Quelle</.test(eingabe),
  "und sie startet auf „Quelle“ -- die leere Eingabezeile ist der Normalfall");
pruefe(eingabe.indexOf("fs-kind-ziel--publikation") === -1,
  "ohne Abdeckung traegt sie den Publikations-Modifier NICHT");

const bauQuelle = (kind) => ({
  source_id: 7, url: "https://garetien.de/Salthel", label: "Salthel", type: "briefspiel",
  official: false, origin: "manual", pages: "", reference_kind: kind, license: "", attribution: "",
  usage_count: 1, wiki_owned: false, own_fields: [], created: { link: null, source: null }, corpus: null,
});
const kastenQuelle = renderFeatureSourceEditPanel(bauQuelle(""), esc, tr);
const kastenPub = renderFeatureSourceEditPanel(bauQuelle("ausfuehrlich"), esc, tr);
gleich(zaehleZeilen(kastenQuelle), 1, "der ✎ traegt sie ebenfalls, genau einmal");
// 🔴 Der ✎ zeichnet den GESPEICHERTEN Stand, keine Vorgabe: eine bestehende Zeile IST bereits das
// eine oder das andere, und eine Zeile, die immer „Quelle" sagt, waere dort schlicht falsch.
pruefe(/<strong data-fs-kind-wort>Publikation</.test(kastenPub),
  "und im ✎ einer Publikation sagt sie „Publikation“");
pruefe(kastenPub.indexOf("fs-kind-ziel--publikation") !== -1, "samt Modifier");
pruefe(/<strong data-fs-kind-wort>Quelle</.test(kastenQuelle), "im ✎ einer Quelle sagt sie „Quelle“");

// 💣 SIE STEHT IM DRITTEN RAHMEN, HINTER DER ABDECKUNG. Im Korpusrahmen daruber gelesen, behauptete
// sie eine Reichweite, die sie nicht hat -- und die Abdeckung gehoert ausschliesslich dieser einen
// Fundstelle („Nur an diesem Objekt").
[["Eingabezeile", eingabe], ["✎", kastenQuelle]].forEach(([wo, html]) => {
  const feld = html.indexOf(wo === "✎" ? 'data-fs-field="reference_kind"' : "fs-add-kind");
  const zeile = html.indexOf("data-fs-kind-ziel");
  pruefe(feld !== -1 && zeile > feld, wo + ": die Hinweiszeile steht HINTER dem Abdeckungsfeld");
  const rahmen = html.lastIndexOf("fs-scope", zeile);
  pruefe(rahmen !== -1 && rahmen > html.indexOf("fs-scope"), wo + ": und im dritten Rahmen");
});

// ══ 3 · Das Nachziehen ══════════════════════════════════════════════════════════════════════════
// Ein Knoten-Doppel, das genau das kann, was die Funktion anfasst.
function macheZeile() {
  const wort = { textContent: "" };
  const satz = { textContent: "" };
  const klassen = new Set();
  const zeile = {
    classList: { toggle: (k, an) => { if (an) { klassen.add(k); } else { klassen.delete(k); } } },
    querySelector: (s) => (s === "[data-fs-kind-wort]" ? wort : (s === "[data-fs-kind-satz]" ? satz : null)),
  };
  const rahmen = { querySelector: (s) => (s === "[data-fs-kind-ziel]" ? zeile : null) };
  return { wort, satz, klassen, rahmen };
}
const z1 = macheZeile();
const feld1 = { value: "erwaehnung", closest: (s) => (s === ".fs-scope" ? z1.rahmen : null) };
const erg = featureSourceKindZielNachziehen(feld1, tr);
gleich(z1.wort.textContent, "Publikation", "das Nachziehen schreibt das WORT");
pruefe(z1.satz.textContent.includes("Publikationstabelle"), "und den SATZ");
pruefe(z1.klassen.has("fs-kind-ziel--publikation"), "und setzt den Modifier");
gleich(erg && erg.publikation, true, "und gibt das Ziel zurueck, statt es nur zu setzen");
feld1.value = "";
featureSourceKindZielNachziehen(feld1, tr);
gleich(z1.wort.textContent, "Quelle", "und den Weg zurueck ebenso");
pruefe(!z1.klassen.has("fs-kind-ziel--publikation"), "der Modifier faellt wieder weg");
// 🔴 GESUCHT WIRD VOM RAHMEN AUS, nie weiter aussen. Steht der ✎ offen, liegen ZWEI Abdeckungen
// und ZWEI Hinweiszeilen im selben Behaelter; wer von der Huelle aus sucht, trifft die erstbeste
// und schreibt die Auskunft ans falsche Formular. Gemessen an genau dieser Lage: das Feld kennt
// seinen eigenen Rahmen UND eine Huelle darum, in der die FREMDE Zeile haengt.
const eigen = macheZeile();
const fremd = macheZeile();
fremd.wort.textContent = "unberuehrt";
const feld2 = {
  value: "ausfuehrlich",
  closest: (s) => (s === ".fs-scope" ? eigen.rahmen : fremd.rahmen),
};
featureSourceKindZielNachziehen(feld2, tr);
gleich(eigen.wort.textContent, "Publikation", "die Zeile des EIGENEN Rahmens wird geschrieben");
gleich(fremd.wort.textContent, "unberuehrt", "die des Nachbarformulars bleibt unberuehrt");
gleich(featureSourceKindZielNachziehen({ value: "ausfuehrlich", closest: () => null }, tr), null,
  "ohne eigenen Rahmen wird NICHTS geschrieben");
gleich(featureSourceKindZielNachziehen(null, tr), null, "und ohne Feld auch nicht");

// ══ 4 · Die Bestaetigung nach dem Speichern ═════════════════════════════════════════════════════
pruefe(featureSourceKindZielBestaetigung("ausfuehrlich", tr).includes("Publikation"),
  "der Satz nach dem Speichern nennt die Publikation");
pruefe(featureSourceKindZielBestaetigung("ausfuehrlich", tr).includes("Ausführlich"),
  "und die Art, denn davon haengt der Reiter ab");
pruefe(featureSourceKindZielBestaetigung("", tr).includes("Quelle"), "und im Quellenfall die Quelle");
// 💣 ER FRAGT DIESELBE REGEL wie die Hinweiszeile -- eine zweite Fassung derselben Frage lief hier
// beim Bau bereits auseinander: fuer einen unbekannten Wert behauptete der Satz „Als Publikation
// gefuehrt (Standardquelle)", waehrend die Zeile daneben richtig „Quelle" sagte und der Server eine
// Quelle anlegt. Drei Antworten auf eine Frage.
pruefe(featureSourceKindZielBestaetigung("wichtig", tr) === featureSourceKindZielBestaetigung("", tr),
  "ein unbekannter Wert wird auch hier als Quelle benannt -- wie in der Regel und wie beim Server");

// ══ 5 · Die Verdrahtung -- der Behaelter zieht wirklich nach ════════════════════════════════════
// ⚠️ AUSGEFUEHRT, nicht gelesen: die Zeile haengt am DELEGIERTEN change-Zuhoerer, weil die
// Eingabezeile nach jedem Schreibvorgang neu gebaut wird und ein direkt gebundener Zuhoerer danach
// weg waere. Ob sie dort wirklich haengt, sagt nur der Lauf.
function macheKontext() {
  const ctx = {
    console,
    window: { __sourceCatalog: {}, __featureSourceRefs: {} },
    document: { querySelector: () => null },
    attachSourceAutocomplete: () => () => {},
    fetch: async () => ({ json: async () => ({ ok: true, wiki_url: "", sources: [] }) }),
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(markupJs, ctx);
  vm.runInContext(quelleJs, ctx);
  return ctx;
}
function macheBehaelter() {
  const felder = {};
  for (const sel of [".fs-add-url", ".fs-add-label", ".fs-add-type", ".fs-add-kind", ".fs-add-official",
    ".fs-add-pages", ".fs-add-license", ".fs-add-attribution"]) {
    felder[sel] = { value: "", checked: false, dataset: {}, focus() {}, addEventListener() {},
      matches: (s) => s === sel, closest: () => null };
  }
  felder["[data-fs-note]"] = { textContent: "", hidden: true };
  return {
    innerHTML: "", felder, _change: null, _klick: null,
    addEventListener(typ, fn) { if (typ === "change") { this._change = fn; } if (typ === "click") { this._klick = fn; } },
    querySelector(sel) { return felder[sel] || null; },
    querySelectorAll() { return []; },
  };
}

(async () => {
  const ctx = macheKontext();
  const b = macheBehaelter();
  const gerufen = [];
  await ctx.mountFeatureSourceEditor(b, "settlement", () => "salthel-1", {});
  // Spion AUF dem Kontext: der Aufruf loest den Namen zur Laufzeit im globalen Raum auf.
  ctx.featureSourceKindZielNachziehen = (feld) => { gerufen.push(String(feld && feld.value)); return null; };

  b.felder[".fs-add-kind"].value = "ergaenzend";
  b._change({ target: b.felder[".fs-add-kind"] });
  assert.deepStrictEqual(gerufen, ["ergaenzend"],
    "ein change am Abdeckungsfeld der EINGABEZEILE zieht die Hinweiszeile nach"); n++;

  const kastenFeld = { value: "erwaehnung", dataset: {}, closest: () => null,
    matches: (s) => s === '[data-fs-field="reference_kind"]' };
  b._change({ target: kastenFeld });
  assert.deepStrictEqual(gerufen, ["ergaenzend", "erwaehnung"],
    "und ein change am Abdeckungsfeld des ✎ ebenso -- beide Erzeuger, eine Regel"); n++;

  b._change({ target: b.felder[".fs-add-license"] });
  assert.deepStrictEqual(gerufen, ["ergaenzend", "erwaehnung"],
    "ein change an einem ANDEREN Feld zieht sie nicht nach"); n++;

  // 🔴 UND DIE EINGABEZEILE SAGT NACH DEM SPEICHERN, WAS SIE EINGETRAGEN HAT -- gefahren, nicht
  // gelesen. Genau diese Rueckmeldung fehlte in Fall #122: „Hinzugefuegt." stand da, und was
  // hinzugefuegt wurde, war eine Publikation.
  // ⚠️ Auf dem ERWARTETEN Weg (ohne Abdeckung) bleibt sie still -- dieselbe Rangfolge wie bei
  // `retyped` und `linked`: eine Quelle, die als Quelle steht, ist keine Nachricht.
  b.felder[".fs-add-url"].value = "https://garetien.de/Salthel";
  b.felder[".fs-add-label"].value = "Salthel";
  b.felder[".fs-add-kind"].value = "ausfuehrlich";
  await b._klick({ target: { closest: (sel) => (sel === "[data-fs-add-submit]" ? {} : null) } });
  pruefe(b.felder["[data-fs-note]"].textContent.indexOf("Publikation") !== -1,
    "die Eingabezeile nennt die Publikation: " + JSON.stringify(b.felder["[data-fs-note]"].textContent));
  b.felder["[data-fs-note]"].textContent = "";
  b.felder[".fs-add-kind"].value = "";
  await b._klick({ target: { closest: (sel) => (sel === "[data-fs-add-submit]" ? {} : null) } });
  // 💣 ZEICHENGLEICH geprueft, nicht „enthaelt kein ‚Publikation‘". Ein „Als Quelle gefuehrt — …"
  // daneben enthaelt das Wort auch nicht und waere trotzdem Laerm auf dem haeufigsten Weg des
  // Formulars: die Rueckmeldung muss dort GENAU der Erfolgssatz sein und sonst nichts.
  gleich(b.felder["[data-fs-note]"].textContent, "Hinzugefügt: „Salthel“.",
    "ohne Abdeckung bleibt sie still -- nur der Erfolgssatz");

  // 🔴 UND DER ✎-SPEICHERWEG WIRD GEFAHREN, nicht gelesen. Er ist der ZWEITE Schreiber der
  // Abdeckung; eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel. Dort gilt sie in
  // BEIDE Richtungen -- auch der Weg zurueck („wieder eine Quelle") ist eine Aussage.
  const k2 = macheKontext();
  const b2 = macheBehaelter();
  const ZEILE = {
    source_id: 7, url: "https://garetien.de/Salthel", label: "Salthel", type: "briefspiel",
    official: false, origin: "manual", pages: "", reference_kind: "", license: "", attribution: "",
    usage_count: 1, wiki_owned: false, own_fields: [], created: { link: null, source: null }, corpus: null,
  };
  k2.fetch = async () => ({ json: async () => ({ ok: true, wiki_url: "", sources: [ZEILE] }) });
  await k2.mountFeatureSourceEditor(b2, "settlement", () => "salthel-1", {});
  // Ein Kasten-Doppel: genau die zwei Fragen, die `speichereBearbeiten` ihm stellt.
  // ⚠️ `data-fs-orig` ist der Stand, MIT DEM der Kasten gezeichnet wurde -- daran entscheidet
  // `featureSourceChangedFields`, ob ueberhaupt etwas geschickt wird. Ohne ihn misst der Test den
  // Zweig „Nichts geändert." statt des Speicherwegs.
  const machePanel = (wert, orig) => ({
    querySelectorAll: (s) => (s === "[data-fs-field]"
      ? [{
        getAttribute: (a) => (a === "data-fs-field" ? "reference_kind" : (a === "data-fs-orig" ? orig : "")),
        value: wert, disabled: false, type: "select-one",
      }]
      : []),
    querySelector: () => null,
  });
  const alteAbfrage = b2.querySelector.bind(b2);
  let offenerWert = "ausfuehrlich";
  let offenerOrig = "";
  b2.querySelector = (sel) => (sel === '[data-fs-edit-panel="7"]' ? machePanel(offenerWert, offenerOrig) : alteAbfrage(sel));
  await b2._klick({ target: { closest: (s) => (s === "[data-fs-edit-save]" ? { getAttribute: () => "7" } : null) } });
  pruefe(b2.felder["[data-fs-note]"].textContent.indexOf("Publikation") !== -1,
    "der ✎ sagt nach dem Speichern, dass daraus eine Publikation wurde: "
    + JSON.stringify(b2.felder["[data-fs-note]"].textContent));
  offenerWert = "";
  offenerOrig = "ausfuehrlich"; // jetzt steht sie als Publikation da, der Kasten leert sie
  ZEILE.reference_kind = "ausfuehrlich";
  b2.felder["[data-fs-note]"].textContent = "";
  await b2._klick({ target: { closest: (s) => (s === "[data-fs-edit-save]" ? { getAttribute: () => "7" } : null) } });
  pruefe(b2.felder["[data-fs-note]"].textContent.indexOf("Quelle") !== -1,
    "und den Weg zurueck ebenso: " + JSON.stringify(b2.felder["[data-fs-note]"].textContent));

  // ══ 6 · Kein zweiter Erzeuger ════════════════════════════════════════════════════════════════
  // 💣 Die Hinweiszeile hat EINEN Bauer. Eine zweite Fassung liefe beim naechsten Satz auseinander
  // -- dieselbe Falle wie bei den sieben Listenzeilen-Rezepturen (AGENTS.md §11).
  const jsDateien = [];
  (function sammle(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "third-party" && e.name !== "__tests__") { sammle(p); } }
      else if (e.name.endsWith(".js")) { jsDateien.push(p); }
    }
  })(path.join(WURZEL, "js"));
  const erzeuger = jsDateien.filter((f) => /data-fs-kind-ziel>/.test(fs.readFileSync(f, "utf8")));
  gleich(erzeuger.length, 1, "genau EIN Erzeuger des Markups: " + erzeuger.join(", "));

  // ══ 7 · Das Blatt -- Quelle UND Bauprodukt ═══════════════════════════════════════════════════
  // 🔴 css/features/feature-sources.css ist die VIERTE Quelle von tools/scope_editor_css.js
  // (AGENTS.md §10). Eine Regel, die nur im Quellblatt steht, wirkt im Territoriumseditor nicht --
  // und eine, die nur im Bauprodukt steht, stirbt beim naechsten Lauf des Werkzeugs.
  const blatt = lies("css", "features", "feature-sources.css");
  const produkt = lies("css", "pages", "political-territory-editor-inline.css");
  [".fs-kind-ziel {", ".fs-kind-ziel--publikation {"].forEach((regel) => {
    pruefe(blatt.indexOf(regel) !== -1, "das Quellblatt traegt " + regel);
    pruefe(produkt.indexOf(regel.slice(1, -2)) !== -1, "und das gescopte Bauprodukt kennt " + regel.slice(0, -2));
  });
  // ⚠️ 11px ist die Untergrenze dieses Hauses (§12) -- 10px war schon einmal der Fehler.
  const block = /\.fs-kind-ziel \{([\s\S]*?)\}/.exec(blatt);
  pruefe(block && /font-size:\s*11px/.test(block[1]), "und sie steht auf 11px, nicht darunter");

  console.log("quellen-abdeckung-ziel: " + n + " Zusicherungen erfuellt");
})().catch((e) => { console.error(e); process.exit(1); });
