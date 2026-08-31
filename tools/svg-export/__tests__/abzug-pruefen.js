#!/usr/bin/env node
// Den FERTIGEN Abzug abnehmen, bevor er hochgeladen wird. Lauf:
//   node tools/svg-export/__tests__/abzug-pruefen.js <verzeichnis>
//
// 🔴 DIESELBE LISTE WIE IM UNIT-TEST (abzug-pruefung.js). Der Unterschied ist, WAS sie zu
// sehen bekommt: dort eine Fixture, hier die echten 8 MB. Ein Test an einer Fixture beweist,
// dass der Bauer richtig baut; er beweist NICHT, dass der naechtliche Lauf richtig geladen
// hat. Genau dafuer steht dieser Schritt im Workflow -- vor dem Hochladen, nicht danach.
//
// 🔴 ZWEI FASSUNGEN, BEIDE ABGENOMMEN (seit 31.08.2026): die rohe (Stuetzpunkt-Polygone) und
// die geglaettete (Bezierkurven, `?smooth=1`). Wer nur eine prueft, laedt die andere blind
// hoch -- und die glatte ist genau die, deren Fehler niemand sieht, weil ihr Kopf stimmt.
//
// ⚠️ Traegt bewusst KEIN `.test.js` im Namen: er braucht ein Verzeichnis als Argument und
// haette im Testlauf des Deploys nichts zu tun.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const P = require("../abzug-pruefung.js");

const verzeichnis = process.argv[2];
if (!verzeichnis) {
	console.error("Aufruf: node tools/svg-export/__tests__/abzug-pruefen.js <verzeichnis>");
	process.exit(2);
}

// 💣 GENAU DIE FORMEN, DIE api/_internal/app/svg-export-ablage.php AKZEPTIERT. Ein Zeiger, den
// der Endpunkt verwirft, sieht von aussen aus wie „es liegt kein Abzug bereit" -- und der
// naechtliche Lauf haette gemeldet, alles sei gut.
// 🔴 Und die getrennten Namensraeume sind druebem der einzige Riegel dagegen, dass die
// Aufraeumung der einen Fassung die andere wegwirft. Wer hier lockert, hebt das dort auf.
const VARIANTEN = [
	{
		schluessel: "roh",
		zeigerDatei: "aktuell.json",
		dateiMuster: /^abzug-[0-9a-f]{16}\.svg$/,
		nameMuster: /^avesmaps-karte-\d{4}-\d{2}-\d{2}-r\d+-inkscape\.svg$/,
		glatt: false,
	},
	{
		schluessel: "glatt",
		zeigerDatei: "aktuell-glatt.json",
		dateiMuster: /^abzug-glatt-[0-9a-f]{16}\.svg$/,
		nameMuster: /^avesmaps-karte-\d{4}-\d{2}-\d{2}-r\d+-inkscape-glatt\.svg$/,
		glatt: true,
	},
];

const fehler = [];
const sagen = (text) => console.log(text);
const gesehen = [];

VARIANTEN.forEach((variante) => {
	const melde = (text) => fehler.push(`[${variante.schluessel}] ${text}`);

	const zeigerPfad = path.join(verzeichnis, variante.zeigerDatei);
	if (!fs.existsSync(zeigerPfad)) {
		console.error(`FEHLT: ${zeigerPfad}`);
		process.exit(1);
	}
	const zeiger = JSON.parse(fs.readFileSync(zeigerPfad, "utf8"));

	// ---- Der Zeiger selbst -------------------------------------------------------------
	if (!variante.dateiMuster.test(String(zeiger.datei || ""))) {
		melde(`der Dateiname passt nicht zur erlaubten Form: ${zeiger.datei}`);
	}
	if (!variante.nameMuster.test(String(zeiger.dateiname || ""))) {
		melde(`der Downloadname passt nicht zum Muster: ${zeiger.dateiname}`);
	}
	if (!/^"[0-9a-f]{64}"$/.test(String(zeiger.etag || ""))) {
		melde(`der ETag ist kein starker sha256-Tag: ${zeiger.etag}`);
	}
	if (!zeiger.kartenfassung || zeiger.kartenfassung === "0") {
		melde("die Kartenfassung fehlt -- ohne sie ist der Abzug nicht mit einem Raster vergleichbar");
	}
	if (!zeiger.landschaftsfassung) {
		melde("die Landschaftsfassung fehlt");
	}
	// ⚠️ Der Zeiger muss dasselbe sagen wie die Datei -- er ist es, den der Server spaeter
	// nachbaut, und ein Zeiger, der „glatt" behauptet, waehrend die Datei eckig ist, fuehrt
	// die Einordnung auf dem Server an der Nase herum.
	const erwartet = variante.glatt ? "ja" : "nein";
	if (String(zeiger.geglaettet) !== erwartet) {
		melde(`der Zeiger meldet geglaettet="${zeiger.geglaettet}", erwartet war "${erwartet}"`);
	}

	const svgPfad = path.join(verzeichnis, String(zeiger.datei || ""));
	if (!fs.existsSync(svgPfad)) {
		console.error(`FEHLT: ${svgPfad}`);
		process.exit(1);
	}

	// ---- Die Datei: Groesse, Hash, Inhalt ----------------------------------------------
	const roh = fs.readFileSync(svgPfad);
	if (roh.length !== zeiger.bytes) {
		melde(`die Groesse im Zeiger (${zeiger.bytes}) ist nicht die der Datei (${roh.length})`);
	}
	const hash = crypto.createHash("sha256").update(roh).digest("hex");
	if (hash !== zeiger.sha256) {
		melde("der Hash im Zeiger gehoert nicht zu diesen Bytes");
	}
	// ⚠️ Ein leerer oder winziger Abzug ist der wahrscheinlichste stille Fehlschlag: ein
	// Endpunkt antwortet 200 mit leerem Inhalt, der Bauer baut brav ein leeres Dokument.
	if (roh.length < 1024 * 1024) {
		melde(`der Abzug ist mit ${(roh.length / 1024).toFixed(0)} KB verdaechtig klein `
			+ "(erwartet werden mehrere MB) -- vermutlich hat ein Endpunkt leer geantwortet");
	}

	const text = roh.toString("utf8");
	const abnahme = P.pruefeAbzug(text, false, { glatt: variante.glatt });
	abnahme.befunde.forEach((b) => melde(`Abnahmepunkt nicht erfuellt: ${b}`));
	P.pruefeStruktur(text).befunde.forEach((b) => melde(`Struktur: ${b}`));
	// Wenn fremde Kommandos drinstehen, sagt der Befundname nur DASS -- hier steht WELCHE.
	const fremde = P.fremdeKommandos(text);
	if (fremde.length > 0) {
		melde(`fremde Pfadkommandos in d=: ${fremde.join(", ")}`);
	}

	sagen(`Abzug (${variante.schluessel}): ${zeiger.datei}`);
	sagen(`  Groesse:   ${(roh.length / (1024 * 1024)).toFixed(1)} MB`);
	sagen(`  Fassungen: Karte ${zeiger.kartenfassung}, Landschaften ${zeiger.landschaftsfassung}`);
	sagen(`  Kurven:    ${P.enthaeltKurven(text) ? "ja" : "nein"}`);
	sagen(`  Abnahme:   ${abnahme.geprueft - abnahme.befunde.length}/${abnahme.geprueft} Punkte`);
	if (variante.schluessel === "roh") {
		Object.entries(zeiger.ebenen || {}).forEach(([ebene, anzahl]) => sagen(`  ${ebene}: ${anzahl}`));
	}

	gesehen.push({ variante: variante.schluessel, zeiger: zeiger });
});

// 💣 BEIDE FASSUNGEN MUESSEN DIESELBE WELT ZEIGEN. Sie werden aus EINEM Datenabruf gebaut,
// also muessen ihre Fassungsstempel gleich sein -- sind sie es nicht, stammt eine aus einem
// frueheren Lauf (etwa weil ein Upload durchfiel und die alte Datei liegenblieb). Ein Renderer,
// der die glatte Geometrie ueber eine roh gerechnete Auswertung legt, saehe nichts davon.
if (gesehen.length === 2) {
	const [a, b] = gesehen;
	["kartenfassung", "landschaftsfassung", "exportiert"].forEach((feld) => {
		if (String(a.zeiger[feld]) !== String(b.zeiger[feld])) {
			fehler.push(`die beiden Fassungen sind nicht aus demselben Lauf: ${feld} `
				+ `"${a.zeiger[feld]}" gegen "${b.zeiger[feld]}"`);
		}
	});
	if (String(a.zeiger.sha256) === String(b.zeiger.sha256)) {
		fehler.push("roh und glatt haben denselben Hash -- dann ist eine der beiden nicht "
			+ "das, was sie zu sein behauptet");
	}
}

if (fehler.length > 0) {
	console.error("\nFEHLGESCHLAGEN:");
	fehler.forEach((f) => console.error(`  - ${f}`));
	process.exit(1);
}

sagen("\nBeide Abzuege abgenommen.");
