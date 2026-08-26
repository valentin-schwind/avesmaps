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
// 🪤 Und die Grenze ist die nächste Funktion JEDER Art, nicht die nächste `async function`: die
// folgt erst 29.820 Zeichen später, der Schnitt umfasste also ein halbes Dutzend fremder
// Funktionen — und eine Zusicherung darin war grün, ohne irgendetwas zu prüfen. Gemessen:
// 11.643 statt 29.820 Zeichen.
const nachE = eco.slice(vonE + 10).match(/\n\t(?:async )?function [A-Za-z]/);
const oeffnerE = nachE ? eco.slice(vonE, vonE + 10 + nachE.index) : eco.slice(vonE);
assert.ok(oeffnerE.length < 15000, "der Schnitt trifft den Öffner, nicht den halben Modulrest"); checks++;
assert.ok(/openLabelEditDialog\(/.test(oeffnerE),
	"…und lädt die Beschriftungs-Hälfte"); checks++;
// 💣 BEIDE RICHTUNGEN, wie der Server. `avesmapsEcosystemRegionPublicIdOfLabel` liest den Zeiger AM
// LABEL (`properties.ecosystem_region_public_id`) UND den an der Region
// (`ecosystem_region.label_public_id`) -- der Client las nur die erste. Live gemessen am 26.08.2026:
// 718 Regionen führen ein Label, aber nur 705 Labels tragen den Rückzeiger. Die **14** Regionen
// dazwischen (darunter „Abagund" und „Siebenwind-Küste") zeigten trotz vorhandener Beschriftung
// „Diese Fläche trägt keine Beschriftung." — und boten an, eine zweite anzulegen.
assert.ok(/beschriftungenDerRegion\(/.test(oeffnerE),
	"…über den EINEN Auflöser, der beide Richtungen kennt"); checks++;
const vonA = eco.indexOf("function beschriftungenDerRegion(");
assert.ok(vonA >= 0, "den Auflöser gibt es"); checks++;
const aufloeser = eco.slice(vonA, vonA + 900);
assert.ok(/findLabelEntriesByEcosystemRegion/.test(aufloeser),
	"er liest den Rückzeiger AM LABEL"); checks++;
assert.ok(/linkedEcosystemLabelEntry/.test(aufloeser),
	"…und den Zeiger AN DER REGION"); checks++;

// ── B2. „BESCHRIFTUNG ANLEGEN" ZEIGT SIE DANN AUCH ───────────────────────────────────────────
// 🔴 Der Entwurf verlangt es wörtlich (§5): „nach dem Anlegen erscheint die Meldung … und der
// Reiter zeigt das Formular". Bis zum 26.08.2026 blieb der Leerzustand samt Knopf stehen — die
// Beschriftung war angelegt, auf der Karte sichtbar und in der Datenbank, aber das Fenster
// behauptete weiter, es gebe keine. Ein zweiter Klick legte dann eine ZWEITE an, die der Server
// ablehnt und der Client wieder zurücknimmt: viel Verkehr für nichts.
// ⚠️ Über DENSELBEN Auflöser wie der Öffner — eine zweite Fassung liefe beim ersten Sonderfall
// (mehrere Beschriftungen, fehlender Rückzeiger) auseinander.
const vonL = eco.indexOf("async function legeBeschriftungAn(");
assert.ok(vonL >= 0, "den Anleger gibt es"); checks++;
const nachL = eco.slice(vonL + 10).match(/\n\t(?:async )?function [A-Za-z]/);
const anleger = nachL ? eco.slice(vonL, vonL + 10 + nachL.index) : eco.slice(vonL);
assert.ok(/beschriftungenDerRegion\(/.test(anleger),
	"nach dem Anlegen wird die Beschriftungs-Hälfte geladen"); checks++;
assert.ok(/openLabelEditDialog\(/.test(anleger),
	"…über den Öffner der Beschriftung"); checks++;
assert.ok(/paar: false/.test(anleger),
	"…ohne Rückruf, der Reiter bleibt wo er ist"); checks++;

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

// ── G. DER TITEL SAGT, WAS DAS FENSTER BEARBEITET ────────────────────────────────────────────
// 🪤 EINE REGRESSION AUS GENAU DIESEM UMBAU, im Bild gefunden. `#ecosystem-properties-title` gibt es
// im vereinigten Fenster GAR NICHT mehr — der Schreibversuch des Flächen-Öffners läuft ins Leere,
// sichtbar ist allein `#label-edit-title`. Solange die Beschriftungs-Hälfte beim Flächen-Einstieg
// nicht lud, blieb dort die Aufschrift aus dem Markup stehen: „Landschaft bearbeiten". Seit sie
// IMMER lädt, überschrieb `setLabelEditDialogTitle` sie mit „Topographie-Label bearbeiten" — für ein
// Fenster, das beide Hälften bearbeitet, eine falsche Auskunft.
//
// 🔴 Die Regel teilt sich das Prädikat mit dem Wiki-Kasten: liegt eine FLÄCHE vor, ist es eine
// Landschaft. Ohne Fläche behält die Beschriftung ihren eigenen, genaueren Titel („Freies Label
// bearbeiten" sagt etwas über die Zugehörigkeit, das nicht verlorengehen darf).
// 🔴 Das Wort ist „Region bearbeiten" (Owner 26.08.2026) -- dasselbe, das der Landschaften-Editor
// daneben benutzt. Es stand einen Tag lang als „Landschaft bearbeiten" da.
const { avesmapsLandschaftDialogTitel } = require("../landschaft-dialog.js");
assert.strictEqual(avesmapsLandschaftDialogTitel({ hatFlaeche: true, hatLabel: true }),
	"Region bearbeiten", "beide Hälften: das Fenster bearbeitet eine Region"); checks++;
assert.strictEqual(avesmapsLandschaftDialogTitel({ hatFlaeche: true, hatLabel: false }),
	"Region bearbeiten", "nur die Fläche: ebenfalls eine Region"); checks++;
assert.strictEqual(avesmapsLandschaftDialogTitel({ hatFlaeche: false, hatLabel: true }), "",
	"nur die Beschriftung: ihren eigenen Titel NICHT anfassen"); checks++;
assert.strictEqual(avesmapsLandschaftDialogTitel(undefined), "",
	"ohne Stand: nichts anfassen"); checks++;
assert.ok(/avesmapsLandschaftDialogTitel\(stand\)/.test(huelle),
	"die Datenlagen ziehen den Titel nach"); checks++;
// 💣 EIN SCHREIBER, SONST EIN RENNEN. Der Titel der Beschriftung wird ZWEISTUFIG gesetzt, und die
// zweite Stufe kommt nachgereicht (erst dann ist die Ebene bekannt) -- sie überschrieb die Hülle,
// obwohl die Hülle danach nichts mehr tat. Deshalb fragt der Titelsetzer der Beschriftung ZUERST
// die Hülle und schweigt, wenn die schon geschrieben hat.
assert.ok(/avesmapsLandschaftDialogTitel\(avesmapsLandschaftDialogStand\(\)\)/.test(labels),
	"der Titelsetzer der Beschriftung fragt zuerst die Hülle"); checks++;

console.log("landschaft-dialog-beide-haelften: " + checks + " Zusicherungen gruen");
