// Jeder Bildpfad, den das Haus in einem <img> nennt, muss auch wirklich existieren.
//
// 💣 Ein Tippfehler in so einem Pfad faellt NIRGENDS auf: kein Fehler in der Konsole, den jemand
//    sieht, kein roter Test -- nur ein Knopf, der ab jetzt ohne Symbol dasteht. Genau das ist die
//    Familie von [[erfundene-css-klasse-faellt-nicht-auf]], nur mit Dateien statt Klassen. Am
//    13.08.2026 wurden vier Symbole auf einmal ausgetauscht; ohne diesen Waechter haette ein
//    verrutschtes Zeichen im Dateinamen die naechsten Wochen ueberlebt.
//
// ⚠️ Geprueft werden nur RELATIVE, statische Pfade aus dem Quelltext. Zusammengesetzte URLs
//    (Wappen-Proxy, Vorschaubilder aus der Datenbank, alles mit + oder ${}) koennen hier gar nicht
//    geprueft werden -- die entstehen erst zur Laufzeit und gehoeren dem Server.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/icon-paths.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

/** Alle .js unter js/, ohne die Tests selbst und ohne die Fremdbibliotheken. */
function quelldateien(dir, out) {
	out = out || [];
	fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) {
			if (e.name === "__tests__" || e.name === "third-party") {
				return;
			}
			quelldateien(p, out);
			return;
		}
		if (e.name.endsWith(".js")) {
			out.push(p);
		}
	});
	return out;
}

// src="img/menu/brief.webp?v=1" -> img/menu/brief.webp
// Nur Anfuehrungszeichen-Literale: was mit + zusammengesetzt wird, faellt nicht in dieses Muster.
const MUSTER = /src="((?:img|icons)\/[A-Za-z0-9_./-]+\.(?:webp|png|jpg|svg))(\?[^"]*)?"/g;

const dateien = quelldateien(path.join(ROOT, "js"));
assert.ok(dateien.length > 50, "genug Quelldateien gefunden (sonst hat der Lauf danebengegriffen)");

const gefunden = new Map(); // Pfad -> [Fundstellen]
dateien.forEach((datei) => {
	const quelle = fs.readFileSync(datei, "utf8");
	let m;
	while ((m = MUSTER.exec(quelle)) !== null) {
		const rel = m[1];
		if (!gefunden.has(rel)) {
			gefunden.set(rel, []);
		}
		gefunden.get(rel).push(path.relative(ROOT, datei).replace(/\\/g, "/"));
	}
});

assert.ok(gefunden.size >= 5, "es wurden Bildpfade gefunden -- sonst prueft dieser Test nichts");

const fehlend = [...gefunden.entries()]
	.filter(([rel]) => !fs.existsSync(path.join(ROOT, rel)))
	.map(([rel, wo]) => rel + "  (genannt in " + [...new Set(wo)].join(", ") + ")");
assert.deepStrictEqual(fehlend, [], "jeder genannte Bildpfad liegt auch im Repo");

// Die vier Symbole der Vorschlags-/Sammlungs-Knoepfe stehen namentlich hier, weil sie am
// 13.08.2026 vom Owner einzeln zugeordnet wurden -- ein spaeterer Umbau soll sie nicht
// unbeabsichtigt wieder zusammenlegen.
const ERWARTET = {
	"img/menu/vorschlag.webp": "Aenderungen vorschlagen",
	"img/menu/brief.webp": "Vorschlag senden",
	"img/menu/buch.webp": "Literatur",
	"img/menu/stadtkarten.webp": "Kartensammlung",
	"icons/feder.webp": "Karte vorschlagen",
};
Object.entries(ERWARTET).forEach(([rel, wofuer]) => {
	assert.ok(fs.existsSync(path.join(ROOT, rel)), rel + " (" + wofuer + ") liegt im Repo");
});
// Und sie sind fuenf VERSCHIEDENE Bilder -- nicht fuenfmal dasselbe.
const groessen = Object.keys(ERWARTET).map((rel) => fs.statSync(path.join(ROOT, rel)).size);
assert.strictEqual(new Set(groessen).size, groessen.length, "die fuenf Symbole sind verschiedene Dateien");

console.log("icon-paths: " + gefunden.size + " Bildpfade geprueft, alle vorhanden");
