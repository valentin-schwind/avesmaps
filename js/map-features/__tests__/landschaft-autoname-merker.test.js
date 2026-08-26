// Der Haken „Auto-Name" wird GESPEICHERT — und eine frisch gezeichnete Fläche bekommt keine
// Beschriftung mehr.
//
// 🔴 Owner 26.08.2026, zwei Entscheide in einem Satz: „1, und ja, speicher den haken."
//
// 💣 DER FEHLER, DER DAZU GEFÜHRT HAT. Der Haken wurde bis dahin nicht gespeichert, sondern aus dem
// NAMEN abgeleitet — mit einer Zusatzbedingung, die der Namensgeber nicht kennt:
//     region_type !== ""  &&  name passt auf <Art>-<Zahl>
// Eine frisch gezeichnete Region hat noch KEINE Art. Der Namensgeber stört das nicht (ohne Art
// fällt er auf den Griff „Fläche" zurück und vergibt „Fläche-100"), die Ableitung dagegen sagt:
// keine Art ⇒ niemals automatisch. Anhaken, speichern, wieder aufmachen — Haken weg. Der NAME war
// korrekt gespeichert; nur die Anzeige log. Live betroffen: 9 Regionen ohne Art mit Auto-Namen,
// plus jede neu gezeichnete, bevor sie eine Art bekommt.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-autoname-merker.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").replace(/\r\n/g, "\n");
// 🪤 Ein Quelltext-Test, der „dieser Aufruf ist weg" prüft, schlägt sonst an dem KOMMENTAR an, der
// vor dem entfernten Aufruf warnt — und der nächste Leser löscht die Warnung, um den Test grün zu
// bekommen. Genau das ist hier passiert: der Zeichner trägt jetzt einen Block, der die alte Zeile
// `createEcosystemRegionLabel(regionPublicId, …)` wörtlich zitiert, damit niemand sie zurückbaut.
const ohneKommentare = (quelltext) =>
	quelltext.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
let checks = 0;

// ── A. DREI ZUSTÄNDE, NICHT ZWEI ─────────────────────────────────────────────────────────────
// 🔴 Hier weicht der Merker bewusst vom Nachbarn `wiki_no_article` ab, der `false` LÖSCHT statt es
// zu schreiben. Dort sind „entschieden: nein" und „nie entschieden" bedeutungsgleich — hier NICHT:
//   fehlt      -> nie angefasst, aus dem Namen ableiten (Altbestand, frisch gezeichnet)
//   true       -> ausdrücklich automatisch
//   false      -> ausdrücklich KEIN Auto-Name, auch wenn der Name noch danach aussieht
// Ohne den dritten Zustand käme eine Region, die „Wald-001" heisst und deren Haken jemand bewusst
// entfernt hat, beim nächsten Öffnen wieder angehakt zurück — derselbe Fehler, nur andersherum.
const { avesmapsEcosystemAutoNameAusMerker } = require("../map-features-ecosystem-naming.js");
assert.strictEqual(avesmapsEcosystemAutoNameAusMerker(true, "Wald-001", "Wald"), true); checks++;
assert.strictEqual(avesmapsEcosystemAutoNameAusMerker(false, "Wald-001", "Wald"), false,
	"ausdrücklich abgehakt schlägt den Namen"); checks++;
assert.strictEqual(avesmapsEcosystemAutoNameAusMerker(null, "Wald-001", "Wald"), true,
	"ohne Merker entscheidet der Name"); checks++;
assert.strictEqual(avesmapsEcosystemAutoNameAusMerker(null, "Farindel", "Wald"), false,
	"…und ein echter Name bleibt einer"); checks++;
assert.strictEqual(avesmapsEcosystemAutoNameAusMerker(undefined, "Fläche-100", ""), true,
	"OHNE ART zählt der Rückfall-Griff „Fläche\" -- genau der Fall, der den Haken verlor"); checks++;
assert.strictEqual(avesmapsEcosystemAutoNameAusMerker(true, "Fläche-100", ""), true,
	"…und gespeichert erst recht"); checks++;

// ── B. DIE ABLEITUNG KENNT DIE ART-BEDINGUNG NICHT MEHR ──────────────────────────────────────
// 💣 `region_type !== ""` war die ganze Ursache. Sie stand da, damit eine frisch gezeichnete Fläche
// nicht mit gesetztem Haken (und damit schreibgeschütztem Namensfeld) aufgeht — dieses Ziel
// erreicht jetzt der fehlende MERKER, ohne die Ableitung zu verbiegen.
const eco = lies("js/map-features/map-features-ecosystem-properties.js");
assert.ok(!/String\(area\.region_type \|\| ""\) !== ""\s*\n\s*&& isEcosystemRegionAutoName/.test(eco),
	"die Art-Bedingung ist aus der Ableitung raus"); checks++;
assert.ok(/avesmapsEcosystemAutoNameAusMerker/.test(eco),
	"…und der gespeicherte Merker entscheidet"); checks++;

// ── C. GESPEICHERT WIRD ER AUCH ──────────────────────────────────────────────────────────────
assert.ok(/auto_name/.test(eco), "der Schreibweg schickt den Merker mit"); checks++;
const php = lies("api/_internal/app/ecosystem.php");
assert.ok(/function avesmapsEcosystemRegionAutoName\(/.test(php),
	"der Server liest den Merker"); checks++;
assert.ok(/function avesmapsEcosystemApplyRegionAutoName\(/.test(php),
	"…und schreibt ihn in properties_json"); checks++;
// 💣 `properties_json` hat ZWEI Schreiber (dieser und `wiki_no_article`). Der zweite liest, was der
// erste in `$fields` gelegt hat -- läuft meiner DANACH, wirft er dessen Ergebnis weg.
const posAuto = php.indexOf("avesmapsEcosystemApplyRegionAutoName($before");
const posNoArt = php.indexOf("avesmapsEcosystemApplyRegionNoArticle($before");
assert.ok(posAuto > 0 && posNoArt > 0, "beide Merker werden angewandt"); checks++;
assert.ok(posAuto < posNoArt,
	"…und der Auto-Name ZUERST, damit der zweite Schreiber sein Ergebnis weiterträgt"); checks++;
// ⚠️ Herausgegeben wird die ANTWORT, nie die Ablage -- wie bei `wiki_no_article` daneben.
assert.ok(/'auto_name' => avesmapsEcosystemRegionAutoName\(/.test(php),
	"list_regions gibt die Antwort heraus"); checks++;
assert.ok(!/'properties_json' => \$row\['properties_json'\]/.test(php),
	"…und nie die rohe Ablage"); checks++;

// ── D. EINE FRISCH GEZEICHNETE FLÄCHE BEKOMMT KEINE BESCHRIFTUNG ─────────────────────────────
// 🔴 Owner 26.08.2026 („1"): erst Name und Art vergeben, dann eine Beschriftung anlegen. Das hebt
// den Entscheid vom 27.07.2026 auf („JEDE Region bekommt automatisch ihr Karten-Label") — und zwar
// weil er dem neuen widerspricht: das automatische Label trug den AUTO-NAMEN als Text, also genau
// das, was seit heute nicht mehr auf die Karte gehört. Live standen so 92 Beschriftungen da
// („See-318", „See-317", …).
const draw = lies("js/map-features/map-features-ecosystem-draw.js");
const vonS = draw.indexOf("async function saveEcosystemAreaRing(");
assert.ok(vonS >= 0, "den Speicherweg des Zeichners gibt es"); checks++;
const nachS = draw.slice(vonS + 10).match(/\n(?:async )?function [A-Za-z]/);
const speichern = ohneKommentare(nachS ? draw.slice(vonS, vonS + 10 + nachS.index) : draw.slice(vonS));
// ⚠️ Die Länge ist die Wache gegen einen Schnitt, der ins Leere greift: `indexOf` liefert -1, die
// Scheibe wäre dann winzig (oder das ganze Restdokument) und der Test prüfte nichts.
assert.ok(speichern.length > 400 && speichern.length < 6000,
	"die Scheibe ist wirklich der Speicherweg (" + speichern.length + " Zeichen)"); checks++;
assert.ok(!/createEcosystemRegionLabel\(/.test(speichern),
	"der Zeichner legt keine Beschriftung mehr an"); checks++;
// 🔴 …UND SIE GEHT MIT AUSDRUECKLICH ABGEWAEHLTEM HAKEN AUF.
// 💣 Der Zeichner vergibt weiterhin „Fläche-100" (`ecosystemDraftRegionName`) — das ist die Form
// `<Griff>-<Zahl>`, also ein Auto-Name. Ohne das mitgeschickte `false` leitete der Dialog daraus
// „automatisch" ab, ginge mit gesetztem Haken auf und haette das Namensfeld GESPERRT — ausgerechnet
// in dem Augenblick, in dem der Editor den Namen vergeben soll (`nameInput.readOnly = checked`).
// Der Owner hat „autoname is nicht angehäkelt" als Ist-Zustand einer frischen Fläche beschrieben.
assert.ok(/auto_name:\s*false/.test(speichern),
	"der Zeichner meldet den frischen Zustand nicht als ausdruecklich-kein-Auto-Name"); checks++;
// 💣 …und der Server muss ihn beim ANLEGEN auch anwenden — beide Erzeuger, oder es ist keine Regel.
const posCreate = php.indexOf("function avesmapsCreateEcosystemRegion(");
const posCreateEnde = php.indexOf("\nfunction ", posCreate + 10);
const anlegen = php.slice(posCreate, posCreateEnde > 0 ? posCreateEnde : undefined);
assert.ok(anlegen.length > 400, "die Scheibe ist wirklich der Anlegeweg"); checks++;
assert.ok(/avesmapsEcosystemApplyRegionAutoName\(/.test(anlegen),
	"create_region wendet den Merker nicht an — das mitgeschickte false fiele auf den Boden"); checks++;

// ⚠️ Und die BEWUSSTEN Wege bleiben: der Haken „Regionname anzeigen" und „Beschriftung anlegen".
assert.ok(/createEcosystemRegionLabel\(/.test(eco),
	"die ausdrücklichen Wege legen weiterhin eine an"); checks++;
// 💣 Die Funktion selbst bleibt, wo sie ist -- sie ist der EINE Erzeuger, den beide Wege rufen.
assert.ok(/function createEcosystemRegionLabel\(/.test(draw),
	"der Erzeuger selbst bleibt bestehen"); checks++;

console.log("landschaft-autoname-merker: " + checks + " Zusicherungen gruen");
