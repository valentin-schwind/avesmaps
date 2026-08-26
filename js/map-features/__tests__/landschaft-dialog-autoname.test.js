// Ein Auto-Name bekommt keine Beschriftung.
//
// 🔴 Owner 26.08.2026: „landschaften die autonamen haben, dürfen keine beschriftung bekommen (der
// button 'Beschriftung anlegen' muss ausgegraut sein + hinweistext) bis auto-name wieder aus ist."
//
// ⭐ Die Begründung steht seit jeher im Namensmodul: „Ein Auto-Name ist interne Buchführung und darf
// nie nach aussen dringen" (map-features-ecosystem-naming.js, ecosystemRegionDisplayName). Die
// Beschriftung IST das Nachaussendringen — sie schreibt den Namen auf die Karte. „Wald-001" gehört
// dort nicht hin.
//
// 💣 Der Haken wird NICHT gespeichert, er wird ABGELEITET: trägt der Name die Form `<Art>-<Zahl>`,
// ist er gesetzt (isEcosystemRegionAutoName). „Auto-Name ist an" heisst also nichts anderes als
// „der Name ist ein Griff, kein Name".
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-dialog-autoname.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { avesmapsLandschaftDialogAnlegenSperre } = require("../landschaft-dialog.js");
const { isEcosystemRegionAutoName } = require("../map-features-ecosystem-naming.js");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").replace(/\r\n/g, "\n");
let checks = 0;

// ── A. DIE REGEL ─────────────────────────────────────────────────────────────────────────────
// 🔴 Gesperrt heisst: ein SATZ, nicht bloss ein toter Knopf. Ein ausgegrauter Knopf ohne Grund ist
// die Sorte Sackgasse, an der ein Editor rätselt, was er falsch macht.
const gesperrt = avesmapsLandschaftDialogAnlegenSperre(true);
assert.ok(gesperrt !== "", "mit Auto-Name ist das Anlegen gesperrt"); checks++;
assert.ok(/Auto-Name/.test(gesperrt), "…und der Satz nennt den Haken beim Namen"); checks++;
assert.strictEqual(avesmapsLandschaftDialogAnlegenSperre(false), "",
	"ohne Auto-Name ist nichts gesperrt"); checks++;
assert.strictEqual(avesmapsLandschaftDialogAnlegenSperre(undefined), "",
	"ohne Angabe wird nicht gesperrt -- im Zweifel bleibt die Handlung erreichbar"); checks++;

// ── B. „AUTO-NAME AN" IST EINE FRAGE AN DEN NAMEN ────────────────────────────────────────────
// ⚠️ Als Zusicherung festgenagelt, weil die ganze Regel darauf steht: gäbe es irgendwo einen
// zweiten Begriff von „auto", liefen Sperre und Haken auseinander.
assert.strictEqual(isEcosystemRegionAutoName("Wald-001", "Wald"), true); checks++;
assert.strictEqual(isEcosystemRegionAutoName("Farindel", "Wald"), false); checks++;
assert.strictEqual(isEcosystemRegionAutoName("Wald der Wälder-2", "Wald"), false,
	"ein echter Name, der auf eine Zahl endet, bleibt ein echter Name"); checks++;

// ── C. DIE VERDRAHTUNG ───────────────────────────────────────────────────────────────────────
// 🔴 Die Sperre haengt an `syncPropertiesAutoName` -- der EINEN Stelle, die den Haken ohnehin bei
// jeder Aenderung und beim Oeffnen nachzieht. An den Aufrufern haengte sie beim ersten vergessenen
// Pfad schief.
const eco = lies("js/map-features/map-features-ecosystem-properties.js");
const vonS = eco.indexOf("function syncPropertiesAutoName(");
assert.ok(vonS >= 0, "den Nachzieher gibt es"); checks++;
const nachS = eco.slice(vonS + 10).match(/\n\t(?:async )?function [A-Za-z]/);
const sync = nachS ? eco.slice(vonS, vonS + 10 + nachS.index) : eco.slice(vonS);
assert.ok(/avesmapsLandschaftDialogAnlegenSperre|avesmapsLandschaftDialogAnlegenKnopf/.test(sync),
	"der Nachzieher setzt die Sperre"); checks++;

// ── D. DER KNOPF UND SEIN SATZ STEHEN IM MARKUP ──────────────────────────────────────────────
const markup = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
assert.ok(markup.indexOf('id="landschaft-dialog-label-anlegen"') !== -1,
	"den Knopf gibt es"); checks++;
assert.ok(markup.indexOf("data-landschaft-anlegen-hinweis") !== -1,
	"…und den Platz fuer seinen Grund"); checks++;

// ── E. DAS ANHAEKELN ENTFERNT BESTEHENDE BESCHRIFTUNGEN ──────────────────────────────────────
// 🔴 Owner 26.08.2026: „bestehende labels sollen entfernt werden, sofern 'Auto-Name' angehäkelt
// wird." Es ist ein ÜBERGANG, kein Zustand: „wird angehäkelt" heisst aus→an in DIESEM Fenster.
// ⚠️ Der Unterschied ist nicht akademisch. Der Haken wird ABGELEITET, also steht er bei den ~30
// Flächen, die schon einen Auto-Namen tragen, beim Öffnen bereits an — als Zustand gelesen würde
// jedes beiläufige „Speichern" dort die Beschriftung löschen, ohne dass jemand etwas angehakt hat.
const { avesmapsLandschaftDialogAutoNameEntfernt } = require("../landschaft-dialog.js");
assert.strictEqual(avesmapsLandschaftDialogAutoNameEntfernt(false, true), true,
	"aus -> an: die Beschriftungen gehen"); checks++;
assert.strictEqual(avesmapsLandschaftDialogAutoNameEntfernt(true, true), false,
	"an -> an: es hat niemand angehakt, also wird nichts gelöscht"); checks++;
assert.strictEqual(avesmapsLandschaftDialogAutoNameEntfernt(true, false), false,
	"an -> aus: erst recht nicht"); checks++;
assert.strictEqual(avesmapsLandschaftDialogAutoNameEntfernt(false, false), false); checks++;

// ── F. UND ES IST KASKADENSICHER ─────────────────────────────────────────────────────────────
// 💣 DIE GEFAEHRLICHSTE STELLE DES GANZEN AUFTRAGS. Das LETZTE Label einer Region nimmt beim
// Löschen die REGION UND IHRE FLÄCHEN mit (`avesmapsEcosystemCascadeAfterRemoval`) — ein Häkchen
// dürfte niemals eine Landschaft vernichten.
// 🔴 Die Kaskade prüft `avesmapsEcosystemRegionPublicIdOfLabel`: erst den Zeiger AM LABEL, dann den
// AN DER REGION. Sind BEIDE leer, ist die Antwort '' und der Kaskadenblock wird gar nicht betreten.
// Deshalb drei Phasen in dieser Reihenfolge: Regionszeiger lösen → jeden Rückzeiger lösen → erst
// dann löschen. Bricht es in Phase 2 ab, stehen freie Beschriftungen da — sichtbar und reparierbar,
// und nichts Gezeichnetes ist weg.
const vonR = eco.indexOf("async function entferneBeschriftungenDerRegion(");
assert.ok(vonR >= 0, "den Entferner gibt es"); checks++;
const nachR = eco.slice(vonR + 10).match(/\n\t(?:async )?function [A-Za-z]/);
const entferner = nachR ? eco.slice(vonR, vonR + 10 + nachR.index) : eco.slice(vonR);
// 🔴 PHASE 1 reist im Rumpf DESSELBEN `update_region`, mit dem das Fenster ohnehin speichert --
// `ecosystem-properties-sperre.test.js` erlaubt genau EINEN solchen Aufruf, und zwei Schreibwege für
// dieselbe Zeile laufen beim nächsten Umbau auseinander.
assert.ok(/payload\.label_public_id = ""/.test(eco),
	"der Regionszeiger wird im Rumpf des einen update_region gelöst"); checks++;
const posLoesen = entferner.indexOf('ecosystem_region_public_id: ""');
const posLoeschen = entferner.indexOf('"delete_feature"');
assert.ok(posLoesen >= 0, "der Rückzeiger am Label wird gelöst"); checks++;
assert.ok(posLoeschen >= 0, "und danach wird gelöscht"); checks++;
assert.ok(posLoesen < posLoeschen,
	"…und zwar in DIESER Reihenfolge -- sonst reisst die Kaskade die Fläche mit"); checks++;
// 🔴 Und ALLE Rückzeiger sind gelöst, bevor das ERSTE Label fällt: zwei getrennte Schleifen, nicht
// eine, die je Label löst und löscht. Bricht es dazwischen ab, stehen freie Beschriftungen da --
// sichtbar und reparierbar. Nichts Gezeichnetes ist weg.
assert.strictEqual((entferner.match(/for \(const eintrag of eintraege\)/g) || []).length, 2,
	"zwei getrennte Durchgänge: erst alle lösen, dann alle löschen"); checks++;
// 💣 `update_label` schreibt `text` und `feature_subtype` IMMER (Vorgabe '' bzw. 'region'), den
// Darstellungssatz dagegen nur, wenn er mitkommt. Wer beim Lösen nur die public_id schickt, leert
// den Beschriftungstext -- kurz bevor er das Label löscht, also unsichtbar, aber im Protokoll.
assert.ok(/text:/.test(entferner) && /feature_subtype:/.test(entferner),
	"beim Lösen reisen Text und Art mit, sonst leert update_label sie"); checks++;

console.log("landschaft-dialog-autoname: " + checks + " Zusicherungen gruen");
