#!/usr/bin/env node
// Den FERTIGEN Abzug abnehmen, bevor er hochgeladen wird. Lauf:
//   node tools/svg-export/__tests__/abzug-pruefen.js <verzeichnis>
//
// 🔴 DIESELBE LISTE WIE IM UNIT-TEST (abzug-pruefung.js). Der Unterschied ist, WAS sie zu
// sehen bekommt: dort eine Fixture, hier die echten 8 MB. Ein Test an einer Fixture beweist,
// dass der Bauer richtig baut; er beweist NICHT, dass der naechtliche Lauf richtig geladen
// hat. Genau dafuer steht dieser Schritt im Workflow -- vor dem Hochladen, nicht danach.
//
// ⚠️ Traegt bewusst KEIN `.test.js` im Namen: er braucht ein Verzeichnis als Argument und
// haette im Testlauf des Deploys nichts zu tun.
"use strict";

const fs = require("fs");
const path = require("path");
const P = require("../abzug-pruefung.js");

const verzeichnis = process.argv[2];
if (!verzeichnis) {
	console.error("Aufruf: node tools/svg-export/__tests__/abzug-pruefen.js <verzeichnis>");
	process.exit(2);
}

const zeigerPfad = path.join(verzeichnis, "aktuell.json");
if (!fs.existsSync(zeigerPfad)) {
	console.error(`FEHLT: ${zeigerPfad}`);
	process.exit(1);
}
const zeiger = JSON.parse(fs.readFileSync(zeigerPfad, "utf8"));

const fehler = [];
const sagen = (text) => console.log(text);

// ---- Der Zeiger selbst -----------------------------------------------------------------
// 💣 Genau die Form, die api/_internal/app/svg-export-ablage.php akzeptiert. Ein Zeiger, den
// der Endpunkt verwirft, sieht von aussen aus wie „es liegt kein Abzug bereit" -- und der
// naechtliche Lauf haette gemeldet, alles sei gut.
if (!/^abzug-[0-9a-f]{16}\.svg$/.test(String(zeiger.datei || ""))) {
	fehler.push(`der Dateiname passt nicht zur erlaubten Form: ${zeiger.datei}`);
}
if (!/^avesmaps-karte-\d{4}-\d{2}-\d{2}-r\d+-inkscape\.svg$/.test(String(zeiger.dateiname || ""))) {
	fehler.push(`der Downloadname passt nicht zum Muster: ${zeiger.dateiname}`);
}
if (!/^"[0-9a-f]{64}"$/.test(String(zeiger.etag || ""))) {
	fehler.push(`der ETag ist kein starker sha256-Tag: ${zeiger.etag}`);
}
if (!zeiger.kartenfassung || zeiger.kartenfassung === "0") {
	fehler.push("die Kartenfassung fehlt -- ohne sie ist der Abzug nicht mit einem Raster vergleichbar");
}
if (!zeiger.landschaftsfassung) {
	fehler.push("die Landschaftsfassung fehlt");
}

const svgPfad = path.join(verzeichnis, String(zeiger.datei || ""));
if (!fs.existsSync(svgPfad)) {
	console.error(`FEHLT: ${svgPfad}`);
	process.exit(1);
}

// ---- Die Datei: Groesse, Hash, Inhalt --------------------------------------------------
const roh = fs.readFileSync(svgPfad);
if (roh.length !== zeiger.bytes) {
	fehler.push(`die Groesse im Zeiger (${zeiger.bytes}) ist nicht die der Datei (${roh.length})`);
}
const hash = require("crypto").createHash("sha256").update(roh).digest("hex");
if (hash !== zeiger.sha256) {
	fehler.push("der Hash im Zeiger gehoert nicht zu diesen Bytes");
}
// ⚠️ Ein leerer oder winziger Abzug ist der wahrscheinlichste stille Fehlschlag: ein
// Endpunkt antwortet 200 mit leerem Inhalt, der Bauer baut brav ein leeres Dokument.
if (roh.length < 1024 * 1024) {
	fehler.push(`der Abzug ist mit ${(roh.length / 1024).toFixed(0)} KB verdaechtig klein `
		+ "(erwartet werden mehrere MB) -- vermutlich hat ein Endpunkt leer geantwortet");
}

const text = roh.toString("utf8");
const abnahme = P.pruefeAbzug(text);
abnahme.befunde.forEach((b) => fehler.push(`Abnahmepunkt nicht erfuellt: ${b}`));
P.pruefeStruktur(text).befunde.forEach((b) => fehler.push(`Struktur: ${b}`));

sagen(`Abzug:     ${zeiger.datei}`);
sagen(`Groesse:   ${(roh.length / (1024 * 1024)).toFixed(1)} MB`);
sagen(`Fassungen: Karte ${zeiger.kartenfassung}, Landschaften ${zeiger.landschaftsfassung}`);
sagen(`Abnahme:   ${abnahme.geprueft - abnahme.befunde.length}/${abnahme.geprueft} Punkte`);
Object.entries(zeiger.ebenen || {}).forEach(([ebene, anzahl]) => sagen(`  ${ebene}: ${anzahl}`));

if (fehler.length > 0) {
	console.error("\nFEHLGESCHLAGEN:");
	fehler.forEach((f) => console.error(`  - ${f}`));
	process.exit(1);
}

sagen("\nAbzug abgenommen.");
