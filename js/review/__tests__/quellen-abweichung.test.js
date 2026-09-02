const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Die ABWEICHUNG: eine einzelne Quelle darf ein korpuseigenes Feld gegen ihren Korpus behaupten.
// Owner-Entscheid 02.09.2026: "Quelle soll optional noch haben: Abweichende Lizenz, Abweichende
// Namensnennung" -- auf Nachfrage auf alle VIER korpuseigenen Felder erweitert.
//
// 💣 WARUM ALLE VIER: live gemessen am 02.09.2026 stehen in den acht Korpora genau drei
// Widersprueche, und keiner davon ist Lizenz oder Nennung. "Der Preis der Macht" (horaswiki.de)
// ist ein Abenteuer und offiziell, waehrend sein Korpus "Briefspiel" und "nicht offiziell" sagt.
// Eine Liste mit Ausnahmen haette ausgerechnet den einzigen echten Fall nicht abgedeckt.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellen-abweichung.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
require(path.join(wurzel, "js/ui/feature-source-markup.js"));
const modul = require(path.join(wurzel, "js/review/review-feature-sources.js"));
const { renderFeatureSourceEditPanel, featureSourceOwnFieldsFromPanel, featureSourceChangedFields } = modul;

let pruefungen = 0;
const pruefe = (b, t) => { assert.ok(b, t); pruefungen++; };
const gleich = (a, b, t) => { assert.deepStrictEqual(a, b, t); pruefungen++; };

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const tr = (_k, f) => f;

// „Der Preis der Macht" -- der einzige echte Abweicher im Livebestand.
const bauQuelle = (eigen) => ({
  source_id: 7, url: "https://www.horaswiki.de/wiki/Der_Preis_der_Macht",
  label: "Der Preis der Macht", type: "abenteuer", official: true, origin: "manual",
  pages: "", reference_kind: "", license: "", attribution: "",
  usage_count: 1, wiki_owned: false, own_fields: eigen,
  created: { link: null, source: null },
  corpus: {
    corpus_key: "horaswiki.de", label: "LieblichesFeld-Wiki", known: true,
    source_type: "briefspiel", license: "cc-by-sa-4.0", attribution: "",
    is_official: false, sources: 3, objects: 3,
  },
});

// ── 1 · Vier Haekchen, eines je korpuseigenem Feld ───────────────────────────────────────────
const ohne = renderFeatureSourceEditPanel(bauQuelle([]), esc, tr);
gleich((ohne.match(/data-fs-own="/g) || []).length, 4,
  "vier Haekchen -- genau die vier Felder, die der Korpus vorgibt");
["source_type", "license", "attribution", "is_official"].forEach((n) => {
  pruefe(ohne.indexOf('data-fs-own="' + n + '"') !== -1, "Haekchen fuer " + n);
});
pruefungen++;
// 💣 Seiten und Abdeckung gehoeren der VERKNUEPFUNG, nie dem Katalog -- sie duerfen kein Haekchen
// tragen, sonst behauptet die Oberflaeche eine Reichweite, die es nicht gibt.
pruefe(ohne.indexOf('data-fs-own="pages"') === -1 && ohne.indexOf('data-fs-own="reference_kind"') === -1,
  "Seiten und Abdeckung tragen keins");
// ⚠️ Und `url`/`label` auch nicht: die gehoeren der Zeile ohnehin schon, es gibt nichts abzuweichen.
pruefe(ohne.indexOf('data-fs-own="url"') === -1 && ohne.indexOf('data-fs-own="label"') === -1,
  "Adresse und Titel ebenso wenig -- sie gehoeren der Zeile bereits");

// ── 2 · Angehakt: der Korpuswert steht durchgestrichen daneben ───────────────────────────────
// 🔴 Bauteil und Optik sind `wiki-override.css` (.wiki-alt/.dt-old): der Korpus verhaelt sich zur
// Quelle wie das Wiki zum Kartenobjekt, und dafuer gibt es die Form laengst.
const mit = renderFeatureSourceEditPanel(bauQuelle(["source_type", "is_official"]), esc, tr);
gleich((mit.match(/data-fs-own-orig="1" checked/g) || []).length, 2, "zwei angehakt");
pruefe(/<span class="dt-old">Briefspiel<\/span>/.test(mit),
  "die Art des Korpus steht durchgestrichen daneben");
pruefe(/<span class="dt-old">nicht offiziell<\/span>/.test(mit),
  "und beim Kanon-Haken auch -- sonst sieht niemand, WOVON abgewichen wird");
gleich((mit.match(/fs-field--eigen/g) || []).length, 2, "und beide Felder sind als eigen markiert");

// ⚠️ NICHT durchgestrichen, wo der Korpus gar nichts sagt: ein durchgestrichenes Nichts ist keine
// Auskunft. Die Nennung ist im Korpus leer.
const nurNennung = renderFeatureSourceEditPanel(bauQuelle(["attribution"]), esc, tr);
gleich((nurNennung.match(/dt-old/g) || []).length, 0,
  "ein leerer Korpuswert wird nicht durchgestrichen");
// Und nicht, wo der Wert GLEICH ist -- dann gibt es keine Abweichung zu zeigen.
const gleicherWert = renderFeatureSourceEditPanel(
  Object.assign(bauQuelle(["license"]), { license: "cc-by-sa-4.0" }), esc, tr);
gleich((gleicherWert.match(/dt-old/g) || []).length, 0,
  "und ein gleicher Wert erst recht nicht");

// ── 2b · Ein besessenes Feld zeigt seinen EIGENEN Wert ───────────────────────────────────────
// 🔴 Ohne das stand im Kasten „Quellenart: Briefspiel" mit einem durchgestrichenen „Briefspiel"
// daneben -- derselbe Wert zweimal, einmal als Bestand und einmal als das, wovon er angeblich
// abweicht. Gefunden hat das der Blick ins Bild, nicht der Test; deshalb steht er jetzt hier.
pruefe(/data-fs-field="source_type" data-fs-orig="abenteuer"/.test(mit),
  "die besessene Art zeigt „abenteuer“, nicht den Korpuswert");
pruefe(/data-fs-field="is_official" data-fs-orig="1" checked/.test(mit),
  "und der besessene Kanon-Haken steht auf dem eigenen Wert");
// Gegenprobe: OHNE Besitz gewinnt weiterhin der Korpus -- das war und bleibt die Regel.
pruefe(/data-fs-field="source_type" data-fs-orig="briefspiel"/.test(ohne),
  "ohne Besitz zeigt das Feld den Korpuswert");
pruefe(!/data-fs-field="is_official"[^>]*checked/.test(ohne),
  "und der Kanon-Haken ebenso -- der Korpus sagt „nicht offiziell“");

// ── 3 · Der Sammler: volle Menge, und „geaendert" ist eine EIGENE Frage ──────────────────────
const machePanel = (zustaende) => ({
  querySelectorAll: () => zustaende.map((z) => ({
    disabled: z.disabled === true,
    checked: z.checked,
    getAttribute: (a) => (a === "data-fs-own" ? z.name : (z.orig ? "1" : "0")),
  })),
});
gleich(featureSourceOwnFieldsFromPanel(machePanel([
  { name: "license", checked: true, orig: false },
  { name: "attribution", checked: false, orig: false },
])), { liste: ["license"], geaendert: true }, "neu angehakt: Liste und Aenderung");
gleich(featureSourceOwnFieldsFromPanel(machePanel([
  { name: "license", checked: true, orig: true },
])), { liste: ["license"], geaendert: false },
  "unveraendert angehakt: die Liste steht, aber es hat sich NICHTS geaendert");
// 💣 DAS IST DIE TRAGENDE UNTERSCHEIDUNG. Ohne sie schickte jedes Speichern `own_fields` mit --
// und ein alter, zwischengespeicherter Client ohne diese Haekchen schickte eine LEERE Liste und
// loeschte damit still jede Abweichung. Dieselbe Regel wie bei `source_type_chosen` (29.08.2026):
// „da steht ein Wert" heisst nie „ein Mensch hat ihn gewaehlt".
gleich(featureSourceOwnFieldsFromPanel(machePanel([
  { name: "license", checked: false, orig: true },
])), { liste: [], geaendert: true }, "zurueckgegeben: leere Liste, aber geaendert");
gleich(featureSourceOwnFieldsFromPanel(machePanel([])), { liste: [], geaendert: false },
  "ein Panel ohne Haekchen aendert nichts -- der alte Client loescht nichts");
gleich(featureSourceOwnFieldsFromPanel(null), { liste: [], geaendert: false }, "und ohne Panel auch nicht");
// ⚠️ Gesperrte Haekchen tragen den Bestand, nicht eine Wahl.
gleich(featureSourceOwnFieldsFromPanel(machePanel([
  { name: "license", checked: true, orig: false, disabled: true },
])), { liste: [], geaendert: false }, "gesperrte zaehlen nicht mit");

// ── 4 · Die zwei Haekchen duerfen sich nicht ins Gehege kommen ───────────────────────────────
// 💣 `data-fs-own` und `data-fs-field` sind ZWEI Sammler auf demselben Panel. Truege das
// Abweichungs-Haekchen versehentlich auch ein `data-fs-field`, landete es als Katalogfeld in der
// Anfrage -- und der Server kennt kein Feld dieses Namens.
pruefe(!/data-fs-own="[a-z_]+"[^>]*data-fs-field/.test(mit) && !/data-fs-field="[a-z_]+"[^>]*data-fs-own/.test(mit),
  "kein Element traegt beide Merkmale");
// Gegenprobe zur Laufzeit: der Feld-Sammler sieht die Abweichungs-Haekchen NICHT.
const echtesPanel = {
  querySelectorAll: (sel) => (sel === "[data-fs-field]" ? [] : [
    { disabled: false, checked: true, getAttribute: (a) => (a === "data-fs-own" ? "license" : "0") },
  ]),
};
gleich(featureSourceChangedFields(echtesPanel), {},
  "der Feld-Sammler liest nur `data-fs-field` und nicht die Abweichung");

// ── 5 · Und der Speichern-Weg schickt sie NUR bei Aenderung ──────────────────────────────────
// ⚠️ Zeilenendenneutral: hier CRLF, im Deploy-Tor LF.
const quelltext = fs.readFileSync(
  path.join(wurzel, "js/review/review-feature-sources.js"), "utf8").replace(/\r\n/g, "\n");
pruefe(/if \(besitz\.geaendert\) \{\n\s*felder\.own_fields = besitz\.liste;/.test(quelltext),
  "`own_fields` reist nur mit, wenn die Haekchen wirklich bewegt wurden");

console.log("OK — " + pruefungen + " Zusicherungen (Abweichung vom Korpus)");
