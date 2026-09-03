// Die nachgezogenen Beschriftungen einer Flaeche werden SOFORT sichtbar -- der Leser und seine drei
// Aufrufer.
//
// 🔴 WARUM (Owner 03.09.2026, „Lawaralîr"/„Cronwald"): `update_region` und `assign_wiki_region` geben
// seit heute die Beschriftungen zurueck, die sie nachgezogen haben (`labels`, in der Form von
// `update_label`) -- die Zuweisung geerbt oder, beim ausdruecklichen Entfernen, die Kopie genommen.
// Der Kartenpayload wird nach einem Speichern nicht neu geholt; ohne diesen Leser staende die Infobox
// bis zum naechsten Live-Abgleich auf dem Artikel, den die Flaeche gerade verloren hat.
//
// 💣 EIN Leser, DREI Aufrufer: der Flaechendialog, die Rueckrichtung aus dem Beschriftungsdialog und
// der Panel-Knopf „Flaeche zuweisen". Eine Regel, die einen von drei Erzeugern bindet, ist keine.
//
// Run: node js/map-features/__tests__/wiki-entfernen-sichtbar-verdrahtung.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const wurzel = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").replace(/\r\n/g, "\n");
const ohneKommentare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
let checks = 0;

// ---- A. Der Leser, herausgeschnitten und AUSGEFUEHRT --------------------------------------------------
const labels = lies("js/map-features/map-features-labels.js");
const start = labels.indexOf("function applyLabelFeaturesLocally(features) {");
assert.ok(start > -1, "applyLabelFeaturesLocally fehlt in map-features-labels.js"); checks++;
const ende = labels.indexOf("\n}\n", start);
const quelltext = labels.slice(start, ende + 2);

const aufrufe = [];
const eintraege = { "lbl-1": { label: { publicId: "lbl-1" } }, "lbl-2": { label: { publicId: "lbl-2" } } };
const leser = new Function(
	"findLabelEntryByPublicId", "applyLabelFeatureResponse",
	quelltext + "\nreturn applyLabelFeaturesLocally;"
)((id) => eintraege[id] || null, (entry, feature) => { aufrufe.push([entry.label.publicId, feature]); });

assert.strictEqual(leser(undefined), 0, "ohne Liste passiert nichts"); checks++;
assert.strictEqual(leser(null), 0); checks++;
assert.strictEqual(leser("x"), 0, "eine Zeichenkette ist keine Liste"); checks++;
assert.strictEqual(aufrufe.length, 0); checks++;

// Bekannte werden angewandt, unbekannte uebersprungen -- nicht angelegt.
const f1 = { type: "Feature", id: "lbl-1", properties: { public_id: "lbl-1", text: "Cronwald" } };
const f2 = { type: "Feature", id: "lbl-2", properties: { public_id: "lbl-2", text: "Cronwald" } };
const fremd = { type: "Feature", id: "lbl-9", properties: { public_id: "lbl-9" } };
assert.strictEqual(leser([f1, fremd, f2]), 2, "zwei bekannte, eine unbekannte"); checks++;
assert.deepStrictEqual(aufrufe.map((a) => a[0]), ["lbl-1", "lbl-2"]); checks++;
assert.strictEqual(aufrufe[0][1], f1, "das Feature wird unveraendert an applyLabelFeatureResponse gereicht"); checks++;

// Die Kennung faellt auf `id` zurueck, wenn `properties.public_id` fehlt (die Form der Rueckgabe).
aufrufe.length = 0;
assert.strictEqual(leser([{ id: "lbl-2", properties: {} }]), 1, "`id` genuegt als Kennung"); checks++;

// 🔴 UEBER applyLabelFeatureResponse, nicht applyLabelFeatureLocally: nur jener Weg behaelt eine
// vorhandene Kurve, und die Antwort des Schreibwegs kennt keine (Falle vom 23.08.2026).
assert.ok(/applyLabelFeatureResponse\(entry, feature\)/.test(ohneKommentare(quelltext)),
	"der Leser muss ueber applyLabelFeatureResponse gehen"); checks++;
assert.ok(!/applyLabelFeatureLocally\(/.test(ohneKommentare(quelltext)),
	"und nicht ueber applyLabelFeatureLocally -- das verloere die Kurve"); checks++;

// ---- B. Die drei Aufrufer ------------------------------------------------------------------------------
const flaeche = ohneKommentare(lies("js/map-features/map-features-ecosystem-properties.js"));
const rueckweg = ohneKommentare(lies("js/map-features/map-features-ecosystem-label-writeback.js"));
const panel = ohneKommentare(lies("js/review/review-region-sync-ecosystem.js"));

assert.ok(/applyLabelFeaturesLocally\(antwort\?\.labels\)/.test(flaeche),
	"der Flaechendialog wendet die `labels` der update_region-Antwort an"); checks++;
assert.ok(/applyLabelFeaturesLocally\(antwort\?\.labels\)/.test(rueckweg),
	"die Rueckrichtung aus dem Beschriftungsdialog ebenso"); checks++;
assert.ok(/applyLabelFeaturesLocally\(result\?\.labels\)/.test(panel),
	"und der Panel-Knopf „Flaeche zuweisen\" (assign_wiki_region)"); checks++;

// 💣 VOR renameLinkedEcosystemLabel: das liest den GELADENEN Labelzustand und entscheidet daran, ob
// es noch etwas zu schreiben gibt. Kaeme die Antwort danach, rechnete es mit dem alten Nest.
const anwendung = flaeche.indexOf("applyLabelFeaturesLocally(antwort?.labels)");
const nachzug = flaeche.indexOf("await renameLinkedEcosystemLabel(area, name)");
assert.ok(anwendung > -1 && nachzug > -1 && anwendung < nachzug,
	"die Antwort wird angewandt, BEVOR das verbundene Label nachgezogen wird"); checks++;

// ---- C. Das ausdrueckliche Entfernen im Flaechendialog ----------------------------------------------
// Der Rumpf an das primaere Label steht ausdruecklich, damit der Zustand nicht davon abhaengt, ob die
// Antwort das Label erreicht hat: `pendingWikiRegion === null` (entfernt, nie bloss „hat keine") und
// das Label traegt noch eine -> `wiki_region: null`.
const nachziehStart = flaeche.indexOf("async function renameLinkedEcosystemLabel(");
const nachziehEnde = flaeche.indexOf("\n\tasync function ", nachziehStart + 1);
const nachzieh = flaeche.slice(nachziehStart, nachziehEnde === -1 ? undefined : nachziehEnde);
assert.ok(/const wikiEntfernt = pendingWikiRegion === null && labelWikiKey !== ""/.test(nachzieh),
	"„entfernt\" haengt an pendingWikiRegion === null UND einer vorhandenen Kopie am Label"); checks++;
assert.ok(/wikiEntfernt \? \{ wiki_region: null \} : \{\}/.test(nachzieh),
	"und schickt dann ausdruecklich `wiki_region: null` -- sonst nichts"); checks++;
assert.ok(/&& !wikiEntfernt/.test(nachzieh),
	"ein Speichern, das NUR die Zuweisung entfernt, gilt als Aenderung und steigt nicht frueh aus"); checks++;

// ---- D. Die Ebene der Flaeche ueberlebt die Antwort des Schreibwegs ------------------------------------
// 🔴 Im Browser gefunden, von keinem Test (03.09.2026): `ecosystem_region_kind` entsteht nur im
// LESEPFAD, die Antworten der Schreibwege tragen die rohe Ablage. Nach dem Speichern stand der
// „Cronwald" als einziges Label mit Flaeche und ohne Ebene da -- und die Vegetations-Ebene zeigt nur
// ihre eigenen Beschriftungen: das eben gespeicherte Label war von der Karte verschwunden.
const ebeneStart = labels.indexOf("function avesmapsLabelEbeneErgaenzen(frisch, bisher) {");
assert.ok(ebeneStart > -1, "avesmapsLabelEbeneErgaenzen fehlt"); checks++;
const ebeneQuelle = labels.slice(ebeneStart, labels.indexOf("\n}\n", ebeneStart) + 2);
const ergaenze = (store) => new Function("ecosystemRegionOfLabel", ebeneQuelle + "\nreturn avesmapsLabelEbeneErgaenzen;")(store);

// Mit Regionsbestand: die Ebene kommt von dort -- auch wenn das Label die Flaeche gewechselt hat.
const bestand = (label) => (label.ecosystemRegionPublicId === "r-veg" ? { public_id: "r-veg", kind: "vegetation" } : { public_id: label.ecosystemRegionPublicId });
let frisch = ergaenze(bestand)({ ecosystemRegionKind: "", ecosystemRegionPublicId: "r-veg" }, { ecosystemRegionKind: "topographie", ecosystemRegionPublicId: "r-topo" });
assert.strictEqual(frisch.ecosystemRegionKind, "vegetation", "der Bestand schlaegt die alte Ebene"); checks++;

// Ohne Bestand (Kind unbekannt), dieselbe Flaeche: die bisherige bleibt.
frisch = ergaenze(bestand)({ ecosystemRegionKind: "", ecosystemRegionPublicId: "r-topo" }, { ecosystemRegionKind: "topographie", ecosystemRegionPublicId: "r-topo" });
assert.strictEqual(frisch.ecosystemRegionKind, "topographie", "dieselbe Flaeche: die Ebene bleibt stehen"); checks++;

// Ohne Bestand und ANDERE Flaeche: nicht raten.
frisch = ergaenze(bestand)({ ecosystemRegionKind: "", ecosystemRegionPublicId: "r-neu" }, { ecosystemRegionKind: "topographie", ecosystemRegionPublicId: "r-topo" });
assert.strictEqual(frisch.ecosystemRegionKind, "", "eine fremde Ebene an einer neuen Flaeche waere geraten"); checks++;

// Ohne Flaeche gibt es keine Ebene -- "" bleibt "", auch wenn vorher eine da war (Label geloest).
frisch = ergaenze(bestand)({ ecosystemRegionKind: "", ecosystemRegionPublicId: "" }, { ecosystemRegionKind: "vegetation", ecosystemRegionPublicId: "r-veg" });
assert.strictEqual(frisch.ecosystemRegionKind, "", "ohne Flaeche keine Ebene"); checks++;

// Eine mitgelieferte Ebene wird nie ueberschrieben (der Lesepfad liefert sie).
frisch = ergaenze(bestand)({ ecosystemRegionKind: "klima", ecosystemRegionPublicId: "r-veg" }, { ecosystemRegionKind: "vegetation", ecosystemRegionPublicId: "r-veg" });
assert.strictEqual(frisch.ecosystemRegionKind, "klima", "eine gelieferte Ebene bleibt"); checks++;

// 🔴 Der Bestand schlaegt auch eine BISHERIGE Ebene an derselben Flaeche (sie kann veraltet sein --
// die Flaeche selbst hat die Ebene gewechselt). Gefangen von einer Mutationsprobe: mit vertauschter
// Reihenfolge blieb hier „topographie" stehen.
frisch = ergaenze(bestand)({ ecosystemRegionKind: "", ecosystemRegionPublicId: "r-veg" }, { ecosystemRegionKind: "topographie", ecosystemRegionPublicId: "r-veg" });
assert.strictEqual(frisch.ecosystemRegionKind, "vegetation", "der Bestand gewinnt auch gegen die bisherige Ebene"); checks++;

// 💣 Das PRIMAERE Label haengt oft nur ueber den Zeiger der Region und traegt selbst keinen -- der
// Aufloeser findet es trotzdem (beide Richtungen), und die Ebene muss ueberleben. Ein frueher
// Ausstieg bei leerem Zeiger liesse genau dieses Label nach dem Speichern verschwinden.
const bestandPrimaer = (label) => (label.publicId === "l-primaer" ? { public_id: "r-veg", kind: "vegetation" } : null);
frisch = ergaenze(bestandPrimaer)({ publicId: "l-primaer", ecosystemRegionKind: "", ecosystemRegionPublicId: "" }, { ecosystemRegionKind: "vegetation", ecosystemRegionPublicId: "" });
assert.strictEqual(frisch.ecosystemRegionKind, "vegetation", "ohne eigenen Zeiger entscheidet der Aufloeser"); checks++;

// Ohne Aufloeser (Editorseite) faellt es auf die bisherige zurueck, statt zu werfen.
frisch = ergaenze(undefined)({ ecosystemRegionKind: "", ecosystemRegionPublicId: "r-veg" }, { ecosystemRegionKind: "vegetation", ecosystemRegionPublicId: "r-veg" });
assert.strictEqual(frisch.ecosystemRegionKind, "vegetation"); checks++;

// 💣 BEIDE Anwender der Antwort gehen hindurch -- der in-place-Weg und der ersetzende.
const antwortStart = labels.indexOf("function applyLabelFeatureResponse(entry, feature) {");
const antwort = ohneKommentare(labels.slice(antwortStart, labels.indexOf("\n}\n", antwortStart) + 2));
assert.ok(/avesmapsLabelEbeneErgaenzen\(label, entry\.label\)/.test(antwort), "applyLabelFeatureResponse ergaenzt die Ebene"); checks++;
const lokalStart = labels.indexOf("function applyLabelFeatureLocally(feature) {");
const lokal = ohneKommentare(labels.slice(lokalStart, labels.indexOf("\n}\n", lokalStart) + 2));
assert.ok(/avesmapsLabelEbeneErgaenzen\(normalizeLabelFeature\(feature\), entry\.label\)/.test(lokal), "applyLabelFeatureLocally ebenso"); checks++;

// ---- E. Das offene Infopanel zieht mit --------------------------------------------------------------
// Der Label-Klick gibt dem Panel einen BAUER (createLabelMarker) -- der Refresh war moeglich und wurde
// nach einem Save nie gerufen. Gemessen 03.09.2026: Panel vor dem Refresh mit Lage, Staat, Beschreibung
// und Wiki-Quelle des entfernten Artikels, danach ohne.
assert.ok(/avesmapsLabelInfopanelNachziehen\(\)/.test(antwort), "applyLabelFeatureResponse frischt das offene Panel auf"); checks++;
const nachziehStartPanel = labels.indexOf("function avesmapsLabelInfopanelNachziehen() {");
const nachziehPanel = new Function("window", labels.slice(nachziehStartPanel, labels.indexOf("\n}\n", nachziehStartPanel) + 2) + "\nreturn avesmapsLabelInfopanelNachziehen;");
let gerufen = 0;
nachziehPanel({ avesmapsRefreshInfopanel: () => { gerufen++; } })();
assert.strictEqual(gerufen, 1, "ruft avesmapsRefreshInfopanel"); checks++;
nachziehPanel({})();
assert.strictEqual(gerufen, 1, "ohne Panel (Editorseite) passiert nichts und nichts wirft"); checks++;

console.log("wiki-entfernen-sichtbar-verdrahtung: " + checks + " Zusicherungen gruen");
