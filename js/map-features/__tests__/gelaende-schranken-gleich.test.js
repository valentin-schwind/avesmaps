"use strict";

/**
 * Die Schranken eines Geländereglers stehen an DREI Stellen -- und sie müssen dieselben sein.
 *
 * 💣 DER FEHLER, DEN DIESER TEST FESTNAGELT (gemeldet 05.09.2026: „wenn ich auf höhenfeld erzeugen
 * klicke, macht es alle werte wild durcheinander"). Der Regler „Detailstufen" spannt im Markup
 * 1..8, die Vorlage „Gratgebirge" setzt 6 -- und der Server klemmte beim Speichern auf 0..5. Der
 * Editor stellte 6 ein, sah 6, drückte „Höhenfeld erzeugen" und bekam 5 zurück.
 *
 * 🔴 DIE URSACHE WAR EINE TRENNUNG, DIE NUR HALB NACHGEZOGEN WURDE. Bis zum 04.09.2026 war
 * `terrain_levels` die EROSIONSSTUFE (0..5) und die Oktavenzahl in einer Spalte; `055ad2bdd` hat
 * beide getrennt (Owner: „terrain_levels trenn die beiden!"). Die Erosion bekam ihre eigene Spalte
 * mit 0..5, der Regler wurde auf 1..8 aufgezogen -- die SERVERKLEMME blieb auf dem alten Wert
 * stehen und gehörte seither zu einer Größe, die es dort nicht mehr gibt.
 *
 * ⚠️ Ein stiller Wertsprung ist die schlimmste Sorte: die Zahl steht danach plausibel da, nur eben
 * anders als eingestellt -- und das gespeicherte Gebirge ist ein anderes als das gezeigte.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(wurzel, p), "utf8");

let gehalten = 0;
const pruefe = (name, fn) => {
	try {
		fn();
		gehalten++;
		console.log("  ok  " + name);
	} catch (fehler) {
		console.error("  FEHLER  " + name + "\n    " + fehler.message);
		process.exitCode = 1;
	}
};

// Regler-Kennung im Markup -> Spaltenname. ⚠️ Zwei heissen anders, als man denkt: „Detailstufen"
// ist `levels`, die „Kammhöhe" ist `avgheight`.
const SPALTE_ZU_REGLER = {
	terrain_grain: "grain",
	terrain_levels: "levels",
	terrain_avg_height: "avgheight",
	terrain_erosion: "erosion",
	terrain_plateau: "plateau",
	terrain_hypsometrie: "hypsometrie",
	terrain_bergform: "bergform",
	terrain_rauschen: "rauschen",
	terrain_sattel: "sattel",
	terrain_talbreite: "talbreite",
	terrain_einschnitt: "einschnitt",
};

const markup = lies("index.html");
// 🪤 KOMMENTARFREI GELESEN. In `ecosystem.php` steht über der Körnungs-Klemme eine Messreihe mit
// Zahlen in Klammern; ein Muster, das Kommentare mitliest, findet dort Zahlenpaare, die keine
// Schranke sind. Dieselbe Lehre wie beim Tokenizer-Lesen der Sync-Monitor-Libs.
const php = lies("api/_internal/app/ecosystem.php")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function schrankenAusMarkup() {
	const raus = {};
	for (const [spalte, regler] of Object.entries(SPALTE_ZU_REGLER)) {
		const treffer = markup.match(new RegExp(
			'id="ecosystem-properties-' + regler + '" type="range" min="([\\d.]+)" max="([\\d.]+)"'));
		assert.ok(treffer, "der Regler `" + regler + "` steht nicht mehr im Markup");
		raus[spalte] = [Number(treffer[1]), Number(treffer[2])];
	}

	return raus;
}

// Der Server klemmt an zwei Bauformen: einzeln (`$lesen($payload['x'], min, max)`) und als Tabelle
// (`'x' => [min, max],`). Beide werden gelesen -- eine Bauform allein zu prüfen hiesse, die andere
// bei der nächsten Verschiebung zu übersehen.
function schrankenAusServer() {
	const raus = {};
	let treffer;
	const einzeln = /\$lesen\(\$payload\['(terrain_[a-z_]+)'\],\s*([\d.]+),\s*([\d.]+)\)/g;
	while ((treffer = einzeln.exec(php)) !== null) {
		raus[treffer[1]] = [Number(treffer[2]), Number(treffer[3])];
	}
	const tabelle = /'(terrain_[a-z_]+)'\s*=>\s*\[([\d.]+),\s*([\d.]+)\]/g;
	while ((treffer = tabelle.exec(php)) !== null) {
		raus[treffer[1]] = [Number(treffer[2]), Number(treffer[3])];
	}

	return raus;
}

pruefe("beide Seiten wurden überhaupt gefunden", () => {
	// ⚠️ Ohne diese Zusicherung wäre der Test bei einem kaputten Muster grün und prüfte nichts --
	// die Vakuum-Falle: eine leere Schnittmenge hält jede Behauptung.
	const server = schrankenAusServer();
	const gefunden = Object.keys(SPALTE_ZU_REGLER).filter((s) => server[s]);
	assert.ok(gefunden.length === Object.keys(SPALTE_ZU_REGLER).length,
		"im Server fehlen Klemmen für: "
		+ Object.keys(SPALTE_ZU_REGLER).filter((s) => !server[s]).join(", ")
		+ " -- entweder klemmt der Endpunkt sie nicht mehr, oder das Muster passt nicht mehr");
});

pruefe("jeder Regler klemmt im Server genauso wie im Markup", () => {
	const marke = schrankenAusMarkup();
	const server = schrankenAusServer();
	const abweichungen = [];
	for (const spalte of Object.keys(SPALTE_ZU_REGLER)) {
		const m = marke[spalte];
		const s = server[spalte];
		if (!s || m[0] !== s[0] || m[1] !== s[1]) {
			abweichungen.push(spalte + ": Regler [" + m.join(", ") + "] gegen Server ["
				+ (s ? s.join(", ") : "keine Klemme") + "]");
		}
	}
	assert.deepStrictEqual(abweichungen, [],
		"Ein Wert, den der Regler annimmt und der Server kappt, wird beim Speichern still zu einer "
		+ "anderen Zahl -- der Editor sieht danach ein anderes Gebirge, als er eingestellt hat:\n    "
		+ abweichungen.join("\n    "));
});

if (!process.exitCode) {
	console.log("\n" + gehalten + " Zusicherungen gehalten.");
}
