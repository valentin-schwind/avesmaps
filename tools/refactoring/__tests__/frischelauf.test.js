// Der Frischelauf: ein Paket gilt, weil es HEUTE nachgeprueft wurde (Entwurf §4).
// Blob gleich -> gilt; anders -> ueberholt; Datei weg -> datei-weg; nicht offen -> nicht geprueft.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node tools/refactoring/__tests__/frischelauf.test.js

const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

(async () => {
	const m = await import(pathToFileURL(path.join(__dirname, "..", "frischelauf.mjs")).href);

	const pakete = [
		{ id: "P-001", datei: "a.js", status: "offen", blob: "aaaa" },
		{ id: "P-002", datei: "b.js", status: "offen", blob: "bbbb" },
		{ id: "P-003", datei: "c.js", status: "GO nötig", blob: "cccc" },
		{ id: "P-004", datei: "d.js", status: "erledigt", blob: "dddd" },
		{ id: "P-005", datei: "e.js", status: "in Arbeit", blob: "eeee" },
		{ id: "P-006", datei: "f.js", status: "verworfen", blob: "ffff" },
	];
	const blobs = { "a.js": "aaaa", "b.js": "b2b2", "c.js": null, "e.js": "eeee" };
	const erg = m.pruefeFrische(pakete, (d) => blobs[d] ?? null);
	assert.deepStrictEqual(erg.map((e) => [e.id, e.ergebnis]), [
		["P-001", "gilt"], ["P-002", "überholt"], ["P-003", "datei-weg"], ["P-004", "nicht-offen"], ["P-005", "gilt"], ["P-006", "nicht-offen"],
	]);
	assert.strictEqual(erg[1].blobJetzt, "b2b2");
	assert.strictEqual(erg[0].blobJetzt, "aaaa");

	// Mutationsprobe: der Blob-Leser wird fuer nicht-offene Pakete NICHT gefragt (kein git-Aufruf ins Leere)
	const gefragt = [];
	m.pruefeFrische(pakete, (d) => { gefragt.push(d); return "x"; });
	assert.deepStrictEqual(gefragt, ["a.js", "b.js", "c.js", "e.js"]);

	// Blockgrenzen aus dem Block-Feld lesen -- erster und letzter Name um das „…“
	assert.deepStrictEqual(m.blockGrenzen("„Lore-Liste“ — loadLoreList … renderLoreDetail (6 Funktionen, ~220 Zeilen ab Z. 3169)"),
		{ von: "loadLoreList", bis: "renderLoreDetail" });
	assert.deepStrictEqual(m.blockGrenzen("„Autoget“ — avesmapsCitymapAutogetResolveUrl … avesmapsCitymapParsePlainPage"),
		{ von: "avesmapsCitymapAutogetResolveUrl", bis: "avesmapsCitymapParsePlainPage" });
	assert.strictEqual(m.blockGrenzen("irgendwas ohne Namen"), null);
	assert.strictEqual(m.blockGrenzen(""), null);

	console.log("frischelauf: ok");
})().catch((e) => { console.error(e); process.exit(1); });
