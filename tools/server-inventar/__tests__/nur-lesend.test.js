// NUR LESEND -- der Waechter des Server-PHP-Inventars.
//
// 🔴 Owner 14.09.2026: ein manuell ausloesbarer, NUR LESENDER Workflow -- „kein rm, kein mirror
//    --delete, keine Schreibbefehle". Geloescht wird auf dem Server weiterhin nur ueber die
//    Retire-Liste des Deploys (AGENTS.md §10). Dieser Test haelt das am Quelltext fest, damit ein
//    spaeteres „ich raeume gleich mit auf" rot wird und nicht still auf das Shared Hosting geht.
// 💣 Kommentare werden vorher entfernt: sie nennen die verbotenen Befehle beim Namen.
// ⚠️ Zeilenendenneutral (AGENTS.md §9): hier CRLF, im Tor LF.
//
// Aus der Wurzel des Repos:  node tools/server-inventar/__tests__/nur-lesend.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");

// ---- 1. Der Workflow ----------------------------------------------------------------------------
const yml = lies(".github/workflows/server-php-inventar.yml")
	.split("\n")
	.filter((zeile) => !/^\s*#/.test(zeile))
	.join("\n");

const onBlock = yml.match(/^on:\n((?:[ \t]+.*\n|\n)*)/m);
assert.ok(onBlock, "der on:-Block ist lesbar");
const ausloeser = onBlock[1].split("\n")
	.map((zeile) => zeile.match(/^[ \t]+([a-z_]+):/))
	.filter(Boolean)
	.map((treffer) => treffer[1]);
assert.deepStrictEqual(ausloeser, ["workflow_dispatch"],
	"nur von Hand ausloesbar -- kein push, kein Zeitplan (gefunden: " + ausloeser.join(", ") + ")");

[
	[/\blftp\b/, "lftp"],
	[/\bmirror\b/, "mirror"],
	[/--delete\b/, "--delete"],
	[/(^|[\s;|&(])rm\s/m, "rm"],
	[/\bsftp:\/\//, "sftp://"],
	[/\b(ssh|scp|rsync|sshpass)\s/, "ssh/scp/rsync"],
	[/\bm?put\s/, "put"],
].forEach(([muster, name]) => {
	assert.ok(!muster.test(yml), "der Workflow enthaelt keinen Schreib-/Loeschweg: " + name);
});

assert.ok(/tools\/server-inventar\/php-inventar\.py/.test(yml), "der Workflow faehrt das Leseskript");
const upload = yml.match(/uses: actions\/upload-artifact@[^\n]*\n(?:[ \t]+.*\n)*/);
assert.ok(upload, "das Artefakt wird hochgeladen");
const aufbewahrung = upload[0].match(/retention-days:\s*(\d+)/);
assert.ok(aufbewahrung && Number(aufbewahrung[1]) <= 3, "das Artefakt nennt Server-Pfade und lebt hoechstens drei Tage");
const temp = (pfad) => pfad.trim().replace(/\$\{\{\s*runner\.temp\s*\}\}|\$RUNNER_TEMP|\$\{RUNNER_TEMP\}/g, "TEMP").replace(/\/+$/, "");
const artefaktPfad = temp(upload[0].match(/path:\s*(.+)/)[1]);
const holen = yml.match(/--holen\s+"([^"]+)"/);
assert.ok(holen, "geholte Dateien haben ein eigenes Verzeichnis");
assert.ok(artefaktPfad !== "TEMP" && !(temp(holen[1]) + "/").startsWith(artefaktPfad + "/"),
	"die geholten Datei-INHALTE liegen nicht im Artefakt (Artefakt " + artefaktPfad + ", geholt nach " + temp(holen[1]) + ")");

// ---- 2. Das Leseskript --------------------------------------------------------------------------
const py = lies("tools/server-inventar/php-inventar.py")
	.replace(/"""[\s\S]*?"""/g, '""')
	.split("\n")
	.map((zeile) => zeile.replace(/(^|\s)#.*$/, ""))
	.join("\n");

// 🪤 Die Griff-Suche laeuft OHNE Zeichenketten: „nur-auf-dem-server.json" ist sonst ein Zugriff `server.json`.
const pyCode = py.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');

const sftpGriffe = [...new Set([...pyCode.matchAll(/\b_?sftp\.(\w+)/g)].map((t) => t[1]))].sort();
assert.deepStrictEqual(sftpGriffe, ["chdir", "listdir_attr", "open"],
	"auf den SFTP-Client wird nur lesend zugegriffen (gefunden: " + sftpGriffe.join(", ") + ")");

[...py.matchAll(/\b_?sftp\.open\(([^)]*)\)/g)].forEach((treffer) => {
	assert.ok(/^\s*\w+\s*,\s*["']rb["']\s*$/.test(treffer[1]), "SFTP-Dateien werden nur mit \"rb\" geoeffnet: " + treffer[0]);
});

const klasse = pyCode.match(/^class NurLesen\b[\s\S]*?(?=^(?:def|class) )/m);
assert.ok(klasse, "die Kapsel NurLesen steht da");
const ausserhalb = pyCode.replace(klasse[0], "");
const nackt = ausserhalb.match(/\bsftp\b/g) || [];
assert.strictEqual(nackt.length, 2, "ausserhalb der Kapsel wird der rohe Client nur angelegt und sofort in NurLesen gesteckt");
assert.ok(!/\b_sftp\b/.test(ausserhalb), "an den gekapselten Client kommt ausserhalb von NurLesen niemand heran");
assert.ok(/\bNurLesen\(\s*sftp\s*\)/.test(py), "der rohe Client geht nur an NurLesen");

const serverGriffe = [...new Set([...pyCode.matchAll(/\bserver\.(\w+)/g)].map((t) => t[1]))].sort();
assert.deepStrictEqual(serverGriffe, ["lies", "liste", "wechsle"], "ausserhalb von NurLesen gibt es nur die drei Lesegriffe");

const clientGriffe = [...new Set([...pyCode.matchAll(/\bclient\.(\w+)/g)].map((t) => t[1]))].sort();
assert.deepStrictEqual(clientGriffe, ["close", "connect", "open_sftp", "set_missing_host_key_policy"],
	"die SSH-Verbindung oeffnet keine Shell und kein Kommando");

const verboten = pyCode.match(/\b(remove|unlink|rename|posix_rename|rmdir|mkdir|put|putfo|chmod|chown|utime|truncate|symlink|exec_command|invoke_shell|invoke_subsystem|get_transport)\s*\(/);
assert.ok(!verboten, "kein Schreib-, Loesch- oder Shellgriff im Leseskript: " + (verboten && verboten[0]));

const ausgeschlossen = py.match(/AUSGESCHLOSSEN_OBEN\s*=\s*\(([^)]*)\)/);
assert.ok(ausgeschlossen, "die ausgeschlossenen Verzeichnisse stehen als Liste da");
["tiles", "uploads", "admin"].forEach((name) => {
	assert.ok(ausgeschlossen[1].includes('"' + name + '"'), name + "/ wird nicht betreten");
});
assert.ok(/NIE_HOLEN\s*=\s*\([^)]*"config\.local\.php"/.test(py), "config.local.php wird nie geholt");

console.log("OK -- Server-PHP-Inventar: nur von Hand, nur lesend, tiles/uploads/admin ausgeschlossen, keine Inhalte im Artefakt.");
