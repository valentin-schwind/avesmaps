"use strict";

/**
 * EIN Erzeuger für das gespeicherte Höhenfeld.
 *
 * 🔴 Seit V12 (04.09.2026) entsteht das Höhenfeld eines Gebirges in `avesmapsGebirgsRasterBauen`
 * -- Randwertaufgabe aus Gipfeln, Kamm, Flüssen und Seen, danach hydraulische Erosion. Der
 * Sammellauf des Landschaften-Editors rechnet noch die alte Bergsumme (`sampleEcosystemHeightField`)
 * und ist deshalb stillgelegt: beide schreiben in dieselbe Tabelle, und der alte würde beim nächsten
 * Klick jedes V12-Raster überschreiben -- still, ohne Fehlermeldung, und der Unterschied fällt erst
 * in der Wegfindung auf.
 *
 * 💣 Genau diese Falle hat das Projekt bei der Verkehrsmittel-Sperre und beim Querfeldein-Ausstieg
 * schon zweimal bezahlt: eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), "utf8");
// ⚠️ Kommentare raus, BEVOR gesucht wird: dieser Test warnt selbst vor `heightmap_put`, und der
// Kopf der Editorseite nennt die alte Funktion beim Namen. Ein Quelltexttest, der seine eigene
// Warnung mitliest, schlägt auf sich selbst an.
const ohneKommentare = (text) => text
	.replace(/<!--[\s\S]*?-->/g, "")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

let bestanden = 0;
const pruefe = (name, fn) => {
	try {
		fn();
		bestanden++;
		console.log("  ok  " + name);
	} catch (fehler) {
		console.error("  FEHLER  " + name + "\n    " + fehler.message);
		process.exitCode = 1;
	}
};

pruefe("genau ZWEI Stellen im Repo rufen `heightmap_put` -- und die zweite ist stillgelegt", () => {
	// Gezählt wird über die ganze Oberfläche, nicht über eine Datei: ein dritter Erzeuger wäre genau
	// der Fehler, den dieser Test verhindert, und er entstünde woanders.
	const dateien = [];
	const sammle = (verzeichnis) => {
		for (const eintrag of fs.readdirSync(path.join(WURZEL, verzeichnis), { withFileTypes: true })) {
			const p = verzeichnis + "/" + eintrag.name;
			if (eintrag.isDirectory()) {
				if (eintrag.name === "__tests__" || eintrag.name === "third-party") { continue; }
				sammle(p);
			} else if (/\.(js|html)$/.test(eintrag.name)) {
				dateien.push(p);
			}
		}
	};
	sammle("js");
	sammle("html");
	const rufer = dateien.filter((p) => ohneKommentare(lies(p)).includes('"heightmap_put"'));
	assert.deepStrictEqual(rufer.sort(), [
		"html/landschaften-editor.html",
		"js/map-features/map-features-ecosystem-height-render.js",
	], "die Menge der Schreiber des Höhenfelds hat sich geändert:\n    " + rufer.join("\n    "));
});

pruefe("der Sammellauf des Editors ist stillgelegt -- im LAUF, nicht nur am Knopf", () => {
	const quelle = lies("html/landschaften-editor.html");
	const ohne = ohneKommentare(quelle);

	// 💣 Der Riegel muss IM Lauf stehen. Ein `disabled` am Knopf fällt bei jedem Neuaufbau des
	// Menübands, und `runHeightmaps()` ist über die Konsole erreichbar.
	const lauf = ohne.indexOf("async function runHeightmaps()");
	assert.ok(lauf > 0, "der Sammellauf wurde nicht gefunden");
	const riegel = ohne.indexOf("HOEHENRASTER_SAMMELLAUF_STILLGELEGT", lauf);
	const putRuf = ohne.indexOf('"heightmap_put"', lauf);
	assert.ok(riegel > 0, "im Lauf steht kein Riegel");
	assert.ok(putRuf > 0, "der Schreibaufruf wurde nicht gefunden");
	assert.ok(riegel < putRuf,
		"der Riegel steht NACH dem Schreibaufruf -- der Lauf schreibt, bevor er abbricht");

	// Und der Knopf sagt es auch, statt nur nicht zu reagieren: ein Knopf, der auf einen Klick
	// nichts tut, ist von einem kaputten nicht zu unterscheiden.
	assert.ok(/id="ecoHeightmap"[^>]*\sdisabled/.test(quelle),
		"der Knopf ist nicht deaktiviert");
	assert.ok(/id="ecoHeightmap"[^>]*Stillgelegt seit/.test(quelle),
		"der Knopf nennt den Grund nicht in seinem title");
});

pruefe("der Flaechendialog-Weg rechnet mit dem V12-Trichter, nicht mit der Bergsumme", () => {
	const render = ohneKommentare(lies("js/map-features/map-features-ecosystem-height-render.js"));
	const upload = render.indexOf("function gebirgsRasterHochladen");
	assert.ok(upload > 0, "der Uploader wurde nicht gefunden");
	const bis = render.indexOf('"heightmap_put"', upload);
	const rumpf = render.slice(upload, bis);
	assert.ok(rumpf.includes("avesmapsGebirgsRasterBauen("),
		"der Uploader ruft den V12-Trichter nicht");
	assert.ok(!rumpf.includes("rasterizeEcosystemHeightField"),
		"der Uploader tastet die alte Höhenfunktion ab, statt das gerechnete Raster zu nehmen");
});

pruefe("die alte Rasterisierung hat KEINEN Aufrufer mehr, der wirklich laeuft", () => {
	// ⚠️ Die Funktion bleibt bestehen -- sie gehört zur Kodier-Datei, die auch
	// `ecosystemHeightmapToBase64` trägt, und die wird gebraucht. Aber wer sie RUFT, schreibt die
	// alte Rechnung fort; das darf nur der stillgelegte Lauf.
	const editor = ohneKommentare(lies("html/landschaften-editor.html"));
	const treffer = editor.split("rasterizeEcosystemHeightField(").length - 1;
	assert.strictEqual(treffer, 1,
		"die alte Rasterisierung wird " + treffer + "-mal gerufen; erwartet ist genau einmal (im "
		+ "stillgelegten Sammellauf)");
});

if (!process.exitCode) {
	console.log("\n" + bestanden + " Zusicherungen gehalten.");
}
