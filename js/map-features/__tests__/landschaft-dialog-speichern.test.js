// Der EINE Speichern-Knopf des vereinigten Landschaftsfensters — und der Löschknopf mit Bezug.
//
// 💣 EIN Knopf, ZWEI Formulare. Wer nur das Formular des OFFENEN Reiters abschickt, verliert die
// Änderung im anderen — lautlos, weil das Fenster danach zugeht. Wer BEIDE blind abschickt, legt an
// einer Fläche ohne Beschriftung bei jedem Speichern eine NEUE an: `buildLabelEditPayload` liest
// eine leere `public_id` als `create_label`.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-dialog-speichern.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
	avesmapsLandschaftDialogSpeichernAuftraege,
	avesmapsLandschaftDialogLoeschText,
} = require("../landschaft-dialog.js");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");
let checks = 0;

// ── A. NUR DIE GELADENEN HÄLFTEN ─────────────────────────────────────────────────────────────
assert.deepStrictEqual(
	avesmapsLandschaftDialogSpeichernAuftraege({ hatFlaeche: true, hatLabel: true }),
	["ecosystem-properties-form", "label-edit-form"],
	"beide geladen: beide Formulare"); checks++;
assert.deepStrictEqual(
	avesmapsLandschaftDialogSpeichernAuftraege({ hatFlaeche: true, hatLabel: false }),
	["ecosystem-properties-form"], "nur die Fläche"); checks++;
assert.deepStrictEqual(
	avesmapsLandschaftDialogSpeichernAuftraege({ hatFlaeche: false, hatLabel: true }),
	["label-edit-form"], "nur die Beschriftung"); checks++;
// 🔴 Keine Hälfte geladen -> NICHTS abschicken. Das ist der Zustand, in dem ein blinder Knopf ein
// Objekt anlegen würde.
assert.deepStrictEqual(
	avesmapsLandschaftDialogSpeichernAuftraege({ hatFlaeche: false, hatLabel: false }),
	[], "nichts geladen: nichts abschicken"); checks++;
assert.deepStrictEqual(avesmapsLandschaftDialogSpeichernAuftraege(undefined), [],
	"ohne Angabe: nichts abschicken"); checks++;

// ── B. DIE FLÄCHE ZUERST ─────────────────────────────────────────────────────────────────────
// 🔴 Ihre Änderung an Name und Art trägt der vorhandene Propagationsweg ohnehin an die Beschriftung
// (`renameLinkedEcosystemLabel`); andersherum überschriebe die Beschriftung den frisch gesetzten
// Regionsnamen wieder.
const beide = avesmapsLandschaftDialogSpeichernAuftraege({ hatFlaeche: true, hatLabel: true });
assert.ok(beide.indexOf("ecosystem-properties-form") < beide.indexOf("label-edit-form"),
	"die Fläche wird vor der Beschriftung gespeichert"); checks++;

// ── C. `requestSubmit`, nicht `submit()` ─────────────────────────────────────────────────────
// 💣 Nur `requestSubmit` löst das submit-EREIGNIS aus, an dem beide Module hängen. `submit()`
// schickt am Zuhörer vorbei — und damit an der ganzen Nutzlast vorbei, die er baut.
const huelle = lies("js/map-features/landschaft-dialog.js");
assert.ok(/formular\.requestSubmit\(\)/.test(huelle), "abgeschickt wird per requestSubmit"); checks++;
assert.ok(!/\.submit\(\)/.test(huelle), "und nie per submit()"); checks++;

// ── D. Jede Hälfte meldet sich SELBST an ─────────────────────────────────────────────────────
// 🔴 Nur das Modul, dem eine Hälfte gehört, weiß, ob ein Objekt dahintersteht. Fehlt eine der
// Anmeldungen, speichert das Fenster diese Hälfte nie — und das fällt niemandem auf, weil der Knopf
// gedrückt aussieht wie immer.
assert.ok(/avesmapsLandschaftDialogHaelfte\("beschriftung"/.test(lies("js/review/review-labels.js")),
	"die Beschriftung meldet sich an"); checks++;
const eco = lies("js/map-features/map-features-ecosystem-properties.js");
assert.ok(/avesmapsLandschaftDialogHaelfte\("flaeche", true\)/.test(eco),
	"die Fläche meldet sich an"); checks++;
assert.ok(/avesmapsLandschaftDialogHaelfte\("flaeche", false\)/.test(eco),
	"…und beim Schließen wieder ab"); checks++;

// ── E. DER LÖSCHKNOPF HAT EINEN BEZUG ────────────────────────────────────────────────────────
assert.strictEqual(avesmapsLandschaftDialogLoeschText("flaeche"), "Fläche löschen"); checks++;
assert.strictEqual(avesmapsLandschaftDialogLoeschText("beschriftung"), "Beschriftung löschen"); checks++;
// ⚠️ Im Reiter „Wiki & Quellen" gibt es nichts zu löschen: leerer Text -> der Knopf ist verborgen.
assert.strictEqual(avesmapsLandschaftDialogLoeschText("wiki"), ""); checks++;
assert.strictEqual(avesmapsLandschaftDialogLoeschText(""), ""); checks++;
assert.ok(/knopf\.hidden = text === ""/.test(huelle),
	"leerer Text verbirgt den Knopf, statt ihn zu sperren"); checks++;

// ── F. GENAU EINE SICHTBARE KNOPFLEISTE ──────────────────────────────────────────────────────
// 🔴 Die zwei alten Leisten bleiben im Markup und sind VERBORGEN: an ihren Knöpfen hängen die
// echten Handler, und die gemeinsame Leiste gibt an sie weiter, statt einen dritten Schreibweg zu
// erfinden. Sichtbar ist genau eine — drei Knopfleisten in einem Fenster wären eine Zumutung.
const markup = lies("index.html");
const von = markup.indexOf('<div id="landschaft-dialog-overlay"');
const bis = markup.indexOf('<div id="region-edit-overlay"');
assert.ok(von > 0 && bis > von, "das Fenster steht in der Seite");
const fenster = markup.slice(von, bis);
const sichtbar = (fenster.match(/__actions"(?! hidden)/g) || []).length;
const verborgen = (fenster.match(/__actions" hidden/g) || []).length;
assert.strictEqual(sichtbar, 1, "genau eine sichtbare Knopfleiste, gefunden: " + sichtbar); checks++;
assert.strictEqual(verborgen, 2, "die zwei alten sind verborgen, gefunden: " + verborgen); checks++;

// ── G. NAME UND ART STEHEN GENAU EINMAL ──────────────────────────────────────────────────────
// 🔴 Gemessen am 25.08.2026: von 679 Paaren tragen 679 denselben Namen und 613 dieselbe Art; die 66
// Abweichungen sind ausnahmslos „Fläche ohne Art → Beschriftung auf dem neutralen `region`". Kein
// einziger echter Widerspruch — ein Feld genügt.
assert.strictEqual(markup.split('id="ecosystem-properties-name"').length - 1, 0,
	"das Namensfeld der Fläche ist eingeschmolzen"); checks++;
assert.strictEqual(markup.split('id="ecosystem-properties-type"').length - 1, 0,
	"das Artfeld der Fläche ist eingeschmolzen"); checks++;
assert.ok(/name: "label-edit-text"/.test(eco) && /type: "label-edit-type"/.test(eco),
	"das Flächenmodul erreicht sie über die Zwillingstabelle"); checks++;

// 💣 Und die zwei Felder gehören per `form`-Attribut zum Beschriftungsformular: sie stehen im
// gemeinsamen Kopf, also AUSSERHALB des <form>, und `buildLabelEditPayload` liest sie über
// `new FormData(formElement)`. Ohne das Attribut speicherte der Dialog einen leeren Namen.
const kopfVon = fenster.indexOf('id="landschaft-dialog-kopf"');
const kopfBis = fenster.indexOf('id="landschaft-dialog-reiter"');
const kopf = fenster.slice(kopfVon, kopfBis);
assert.ok(/id="label-edit-text"[^>]*form="label-edit-form"/.test(kopf),
	"das Textfeld im Kopf gehört zum Beschriftungsformular"); checks++;
assert.ok(/id="label-edit-type"[^>]*form="label-edit-form"|form="label-edit-form"[^>]*id="label-edit-type"/.test(kopf)
	|| /<select id="label-edit-type"[\s\S]{0,200}form="label-edit-form"/.test(kopf),
	"die Artauswahl im Kopf gehört zum Beschriftungsformular"); checks++;

// ── H. 🪤 DIE VERDRAHTUNG HÄNGT AM EINEN TRICHTER ────────────────────────────────────────────
// Sie stand zuerst im Öffner der Hülle -- aber die zwei Module öffnen das Fenster über
// `avesmapsLandschaftDialogSichtbar(true)` und gehen daran VORBEI. „Abbrechen" und „×" der
// gemeinsamen Leiste taten deshalb nichts, sobald der Dialog auf dem normalen Weg aufging --
// gefunden im Ablauf, nicht im Testfeld: alle Zusicherungen waren grün.
// 🔴 Eine Regel, die einen von mehreren Erzeugern bindet, ist keine Regel.
const iSichtbar = huelle.indexOf("function avesmapsLandschaftDialogSichtbar(");
assert.ok(iSichtbar >= 0, "der Trichter steht als eigene Funktion da");
const rumpfSichtbar = huelle.slice(iSichtbar, iSichtbar + 900);
assert.ok(rumpfSichtbar.includes("avesmapsLandschaftDialogVerdrahten()"),
	"verdrahtet wird im Trichter, durch den JEDER Weg geht"); checks++;

console.log("landschaft-dialog-speichern: " + checks + " Zusicherungen gruen");
