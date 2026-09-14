// DIE RETIRE-LISTE LOESCHT NICHTS, WAS GEBRAUCHT WIRD -- der Waechter des einzigen Loeschwegs auf dem Server.
//
// 🔴 Der Deploy loescht nie (AGENTS.md §10); geloescht wird nur ueber den Schritt „Retire orphaned
//    remote files" in .github/workflows/deploy-avesmaps-strato.yml. Am 14.09.2026 kamen dort 44
//    Nur-Server-PHP-Dateien auf einmal dazu. Eine Liste dieser Laenge liest niemand mehr Zeile fuer
//    Zeile -- also haelt dieser Test die zwei Dinge fest, die dort nie stehen duerfen:
//
//    1. eine GESCHUETZTE Datei (AGENTS.md §10): tiles/, uploads/, admin/, api/wiki-sync.php,
//       api/app/.user.ini, config.local.php -- und keine .htaccess, sonst steht ein gesperrtes
//       Verzeichnis wie api/_internal/ offen.
//    2. eine Datei, die IM REPO liegt. Der Retire-Schritt laeuft NACH dem Hochladen; eine Repo-Datei
//       auf der Liste waere nach jedem Deploy auf dem Server weg, waehrend Repo und Tests gruen sind.
//
// ⚠️ Zeilenendenneutral (AGENTS.md §9), und Kommentare werden vor dem Lesen entfernt -- sie nennen
//    die geschuetzten Pfade beim Namen.
//
// Aus der Wurzel des Repos:  node tools/__tests__/retire-liste-geschuetzt.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..");
const yml = fs.readFileSync(path.join(WURZEL, ".github/workflows/deploy-avesmaps-strato.yml"), "utf8").replace(/\r\n/g, "\n");

const start = yml.indexOf("- name: Retire orphaned remote files");
assert.ok(start >= 0, "der Retire-Schritt steht im Deploy-Workflow");
const naechster = yml.slice(start + 1).search(/\n {6}(- name:|# )/);
const schritt = (naechster < 0 ? yml.slice(start) : yml.slice(start, start + 1 + naechster))
	.split("\n")
	.filter((zeile) => !/^\s*#/.test(zeile))
	.join("\n");

// Jeder Pfad: aus `rm`-Zeilen und aus dem Array. Die printf-Beschriftungen (mit Klammerzusatz) zaehlen nicht.
const ausRm = [...schritt.matchAll(/^\s*rm\s+(?:-[rf]+\s+)*"([^"$]+)"\s*$/gm)].map((t) => t[1]);
const arrayBlock = schritt.match(/retire_nur_server_php=\(\n([\s\S]*?)\n\s*\)/);
const ausArray = arrayBlock ? [...arrayBlock[1].matchAll(/"([^"]+)"/g)].map((t) => t[1]) : [];
const pfade = [...ausRm, ...ausArray];

assert.ok(ausRm.length >= 10, "die festen rm-Zeilen werden gelesen (gefunden: " + ausRm.length + ")");
assert.ok(ausArray.length > 0, "die Nur-Server-Liste wird gelesen");
assert.ok(/\$\(printf 'rm -f "%s"\\n' "\$\{retire_nur_server_php\[@\]\}"\)/.test(schritt),
	"die Nur-Server-Liste wird wirklich geloescht, nicht nur ausgegeben");

const GESCHUETZT = [
	[/^tiles(\/|$)/, "tiles/"],
	[/^uploads(\/|$)/, "uploads/"],
	[/^admin(\/|$)/, "admin/"],
	[/^api\/wiki-sync\.php$/, "api/wiki-sync.php"],
	[/^api\/app\/\.user\.ini$/, "api/app/.user.ini"],
	[/(^|\/)config\.local\.php$/, "config.local.php"],
	[/(^|\/)\.htaccess$/, ".htaccess"],
	[/(^|\/)\.env$/, ".env"],
];
pfade.forEach((pfad) => {
	GESCHUETZT.forEach(([muster, name]) => {
		assert.ok(!muster.test(pfad), "geschuetzt (" + name + ") und trotzdem auf der Retire-Liste: " + pfad);
	});
	assert.ok(!fs.existsSync(path.join(WURZEL, pfad)),
		"liegt im Repo und stuende nach jedem Deploy nicht mehr auf dem Server: " + pfad);
});

assert.ok(!/\bmirror\b/.test(schritt), "der Retire-Schritt spiegelt nicht");
assert.strictEqual(new Set(pfade).size, pfade.length, "kein Pfad steht doppelt auf der Liste");

console.log("OK -- Retire-Liste: " + pfade.length + " Pfade, keiner geschuetzt, keiner im Repo.");
