// Das vereinigte Fenster lädt BEIDE Hälften — egal, durch welche Tür man hereinkommt.
//
// 🔴 DER BEFUND, live gemessen am 26.08.2026. Jeder Einstieg lud nur seine eigene Hälfte:
// `openEcosystemPropertiesDialog` meldete „flaeche" an, `openLabelEditDialog` meldete
// „beschriftung" an — und keiner den Gegenpart. Der andere Reiter behauptete deshalb IMMER, es
// gebe ihn nicht: „Siebenwind-Küste" (eine Beschriftung) und das „Ingvaltal" (drei) sagten über die
// Fläche geöffnet beide „Diese Fläche trägt keine Beschriftung." und boten „Beschriftung anlegen"
// an. Betroffen war praktisch der ganze Bestand — 716 Flächen mit Beschriftung, 703 Beschriftungen
// mit Fläche.
//
// ⚠️ Dass Name und Art trotzdem in BEIDE Zeilen gingen, lag am Propagationsweg
// (`renameLinkedEcosystemLabel`), nicht am Fenster — deshalb fiel es beim Speichern nicht auf.
// Unerreichbar war alles Halbteil-Eigene: Größe, Zoom, Priorität, Position, Gelände, Sperre.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-dialog-beide-haelften.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { avesmapsLandschaftDialogLadeAuftraege } = require("../landschaft-dialog.js");

const wurzel = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral lesen: hier CRLF, im Deploy-Tor LF (AGENTS.md §9).
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").replace(/\r\n/g, "\n");
let checks = 0;

// ── A. DIE REIHENFOLGE IST DIE UMKEHRUNG DES SPEICHERNS ──────────────────────────────────────
// 🔴 Beim SPEICHERN geht die Fläche zuerst (ihre Änderung propagiert an die Beschriftung). Beim
// LADEN geht sie zuletzt — aus demselben Grund, nur andersherum gelesen: der gemeinsame Kopf
// (Name, Art, Nodix, Kurvenbeschriftung) gehört der REGION, und wer zuletzt schreibt, gewinnt.
// Lüde die Fläche zuerst, überschriebe `populateLabelEditForm` den Regionsnamen mit dem Labeltext.
assert.deepStrictEqual(
	avesmapsLandschaftDialogLadeAuftraege({ hatFlaeche: true, hatLabel: true }),
	["beschriftung", "flaeche"],
	"beide da: die Beschriftung zuerst, die Fläche zuletzt"); checks++;
assert.deepStrictEqual(
	avesmapsLandschaftDialogLadeAuftraege({ hatFlaeche: true, hatLabel: false }),
	["flaeche"], "nur die Fläche"); checks++;
assert.deepStrictEqual(
	avesmapsLandschaftDialogLadeAuftraege({ hatFlaeche: false, hatLabel: true }),
	["beschriftung"], "nur die Beschriftung"); checks++;
assert.deepStrictEqual(avesmapsLandschaftDialogLadeAuftraege(undefined), [],
	"ohne Angabe: nichts laden"); checks++;

// 🔴 Und sie ist die exakte Umkehrung — als Zusicherung, nicht als Zufall. Wer eine der beiden
// Reihenfolgen dreht, muss hier vorbei.
const { avesmapsLandschaftDialogSpeichernAuftraege } = require("../landschaft-dialog.js");
const speichern = avesmapsLandschaftDialogSpeichernAuftraege({ hatFlaeche: true, hatLabel: true });
const laden = avesmapsLandschaftDialogLadeAuftraege({ hatFlaeche: true, hatLabel: true });
assert.strictEqual(speichern[0].indexOf("ecosystem") === 0, true, "gespeichert wird die Fläche zuerst"); checks++;
assert.strictEqual(laden[laden.length - 1], "flaeche", "geladen wird sie zuletzt"); checks++;

// ── B. DER FLÄCHEN-EINSTIEG HOLT SEINE BESCHRIFTUNG ──────────────────────────────────────────
const eco = lies("js/map-features/map-features-ecosystem-properties.js");
const vonE = eco.indexOf("async function openEcosystemPropertiesDialog(");
assert.ok(vonE >= 0, "den Flächen-Öffner gibt es"); checks++;
// ⚠️ Kein `indexOf(...) + n || fallback`: `-1 + n` ist ab n=2 truthy und der Rückfall käme nie
// (AGENTS.md §9). Die Fallunterscheidung steht deshalb ausgeschrieben da.
const bisE = eco.indexOf("\n\tasync function", vonE + 10);
const oeffnerE = eco.slice(vonE, bisE > vonE ? bisE : eco.length);
assert.ok(/findLabelEntriesByEcosystemRegion/.test(oeffnerE),
	"der Flächen-Öffner sucht die Beschriftungen seiner Region"); checks++;
assert.ok(/openLabelEditDialog\(/.test(oeffnerE),
	"…und lädt die Beschriftungs-Hälfte"); checks++;

// ── C. DER BESCHRIFTUNGS-EINSTIEG HOLT SEINE FLÄCHE ──────────────────────────────────────────
const labels = lies("js/review/review-labels.js");
const vonO = labels.indexOf("function openLabelEditDialog(");
assert.ok(vonO >= 0, "den Beschriftungs-Öffner gibt es"); checks++;
// ⚠️ Bis zur NÄCHSTEN Funktion schneiden, nie auf eine feste Zeichenzahl: der Öffner ist beim Bau
// dieses Tests von 4000 auf 4299 Zeichen gewachsen, und ein zu kurzer Schnitt meldet „die
// Verdrahtung fehlt", wo sie nur hinter dem Rand liegt (dieselbe Klasse Fehlalarm wie der
// CRLF-Fangschluss aus AGENTS.md §9).
const bisO = labels.indexOf("\nfunction ", vonO + 10);
const oeffnerO = labels.slice(vonO, bisO > vonO ? bisO : labels.length);
assert.ok(/avesmapsEcosystemAreaPublicIdOfLabel/.test(oeffnerO),
	"der Beschriftungs-Öffner sucht die Fläche seines Labels"); checks++;
// ⚠️ Über die VERÖFFENTLICHTE Tür, nicht über den Namen: `openEcosystemPropertiesDialog` steht in
// einer IIFE und ist von aussen unerreichbar — erreichbar ist allein
// `window.AvesmapsEcosystemProperties.open`. Diese Zusicherung hiess zuerst anders und wurde von der
// Modulgrenze widerlegt; sie steht so da, damit niemand den Aufruf „geradezieht".
assert.ok(/AvesmapsEcosystemProperties\?\.open|AvesmapsEcosystemProperties\.open/.test(oeffnerO),
	"…und lädt die Flächen-Hälfte über die veröffentlichte Tür"); checks++;

// ── D. KEIN KREISLAUF ────────────────────────────────────────────────────────────────────────
// 💣 Zwei Öffner, die einander rufen, laufen ohne Riegel im Kreis. Der Riegel ist ein AUSDRÜCKLICHER
// PARAMETER (`paar: false`), kein Modulzustand: ein Merker daneben überlebte das Öffnen und liesse
// beim zweiten Aufruf eine Hälfte weg — dieselbe Falle wie beim gemerkten Reiter.
assert.ok(/paar: false/.test(oeffnerE), "der Flächen-Öffner ruft den anderen OHNE Rückruf"); checks++;
assert.ok(/paar: false/.test(oeffnerO), "…und der Beschriftungs-Öffner ebenso"); checks++;
assert.ok(/options\.paar !== false/.test(labels), "der Beschriftungs-Öffner liest den Riegel"); checks++;
assert.ok(/\.paar !== false/.test(eco), "…und der Flächen-Öffner auch"); checks++;

// ── E. EINE FEHLENDE HÄLFTE WIRD ABGEMELDET ──────────────────────────────────────────────────
// 🔴 Ohne die Abmeldung bliebe der Stand der ZULETZT geöffneten Landschaft stehen: das Fenster
// zeigte eine Hälfte, hinter der kein Objekt mehr steht — und „Speichern" schickte ihr Formular ab.
assert.ok(/avesmapsLandschaftDialogHaelfte\("beschriftung", false\)/.test(eco),
	"keine Beschriftung -> Hälfte abgemeldet"); checks++;
assert.ok(/avesmapsLandschaftDialogHaelfte\("flaeche", false\)/.test(labels),
	"keine Fläche -> Hälfte abgemeldet"); checks++;

// ── F. NUR EINE WIKI-ZUWEISUNG IM DRITTEN REITER ─────────────────────────────────────────────
// 💣 Der Reiter „Wiki & Quellen" trägt ZWEI Behälter: `#label-wiki-assign-host` (die Zuweisung der
// Beschriftung) und `#ecosystem-properties-wiki-host` (die der Fläche). Solange nur eine Hälfte lud,
// stand dort immer genau ein Kasten. Mit beiden Hälften stünden zwei gleich aussehende Kästen
// übereinander — und der Benutzer müsste raten, welcher zählt.
// 🔴 Es gewinnt die FLÄCHE: `wiki_region_key` liegt an der Region, und die Propagation trägt ihn an
// die Beschriftungen ABWÄRTS (`applyRegionToLabels`). Die Zuweisung der Beschriftung ist eine Kopie.
// Ohne Fläche (254 Beschriftungen live) bleibt ihr eigener Kasten der einzige und steht.
const huelle = lies("js/map-features/landschaft-dialog.js");
assert.ok(/label-wiki-assign-host/.test(huelle),
	"die Hülle entscheidet über den Zuweisungskasten der Beschriftung"); checks++;
assert.ok(/avesmapsLandschaftDialogWikiKasten/.test(huelle),
	"…in einer eigenen, benannten Regel"); checks++;

console.log("landschaft-dialog-beide-haelften: " + checks + " Zusicherungen gruen");
