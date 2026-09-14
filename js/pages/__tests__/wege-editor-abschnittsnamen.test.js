"use strict";
// Wege-Editor: Abschnitte heissen „Abschnitt N: Ort – Ort" (Entwurf 2026-09-14 §4).
// Aus der Wurzel: node js/pages/__tests__/wege-editor-abschnittsnamen.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const ohneKommentare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
const rumpf = (quelle, kopf) => {
	const start = quelle.indexOf(kopf);
	assert.ok(start >= 0, kopf + " nicht gefunden");
	let tiefe = 0;
	for (let i = quelle.indexOf("{", start); i < quelle.length; i++) {
		if (quelle[i] === "{") tiefe++;
		if (quelle[i] === "}" && --tiefe === 0) return quelle.slice(start, i + 1);
	}
	throw new Error("offen: " + kopf);
};

const editor = ohneKommentare(lies("js/pages/wege-editor.js"));
assert.ok(rumpf(editor, "function segmentRow(way, index, group)").includes("wpAbschnittLabel(way, index)"), "die Abschnittszeile heisst nach der Regel");
assert.ok(rumpf(editor, "function renderGroupDetail(host)").includes("wpAbschnittLabel(segment, index + 1)"), "„Die Abschnitte“ auf der Weg-Ebene ebenso");
assert.ok(rumpf(editor, "function renderList()").includes("wpGanzeStrecke(group.segments)"), "der Gruppenkopf nennt die ganze Strecke");
assert.ok(rumpf(editor, "function weitereAbschnitte(ways)").includes("wpAbschnittLabel(way, nummer)"), "der Weitere-Kasten nennt die Abschnitte gleich");

const php = lies("api/edit/map/paths-editor.php");
assert.ok(php.includes("require_once __DIR__ . '/../../_internal/map/weg-abschnitt-ende.php';"));
assert.ok(php.includes("JSON_EXTRACT(geometry_json, '$.coordinates[0]') AS ende_von"), "Endpunkte per JSON_EXTRACT, nicht die ganze Geometrie");
assert.ok(php.includes("JSON_EXTRACT(geometry_json, '$.coordinates[last]') AS ende_bis"));
assert.ok(/'enden'\s*=>/.test(php) && /'ends'\s*=>/.test(php), "die Zeile traegt ends und enden");

// 🪤 R22 (Plan-Fehler im Testentwurf): die urspruengliche Zusicherung lief ueber die GANZE Datei --
// und traf damit auch avesmapsPathEditorDetail(), deren SELECT geometry_json legitim als eigene
// Spalte liest (die Weg-Ebene braucht die ganze Linie, um die Kette der Abschnitte zu bauen). Eine
// korrekte Umsetzung dieser Aufgabe waere daran gescheitert. Und selbst NUR im Rumpf von
// avesmapsPathEditorList enthaelt die eigene, korrekte Liste die Zeichenkette "geometry_json," --
// aus JSON_EXTRACT(geometry_json, '$.coordinates[…]'). Geprueft wird deshalb der (kommentarfreie)
// Rumpf von avesmapsPathEditorList, und als Verstoss zaehlt nur ein "geometry_json", das NICHT
// unmittelbar hinter "JSON_EXTRACT(" steht -- also eine roh selektierte Spalte, keine Funktion
// darauf.
const phpOhneKommentare = ohneKommentare(php);
const listRumpf = rumpf(phpOhneKommentare, "function avesmapsPathEditorList(PDO $pdo): array");
assert.ok(
	!/SELECT[^;]*(?<!JSON_EXTRACT\()\bgeometry_json\b\s*,[^;]*FROM map_features\s+WHERE feature_type = 'path'/.test(listRumpf),
	"die Liste liest die Geometrie nicht ganz"
);

console.log("wege-editor-abschnittsnamen.test.js: ok");
