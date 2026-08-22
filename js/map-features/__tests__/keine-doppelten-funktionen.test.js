const assert = require("assert");
const fs = require("fs");
const path = require("path");

// 🔴 KEINE DATEI DARF DIESELBE FUNKTION ZWEIMAL AUF OBERSTER EBENE DEKLARIEREN.
//
// 💣 DER ANLASS, 22.08.2026, und er ging LIVE: beim Auslagern des Platzierungsverfahrens ersetzte
// ein Skript einen Block per `s[:a] + neu + s[b:]`. `b` war der Index des ERSTEN Treffers von
// „Schreibphase 2" -- der lag in einer FRÜHEREN Funktion, also vor `a`. Das Ergebnis war kein
// Ersetzen, sondern eine Verdopplung: `resolveLabelCollisions` stand danach zweimal in der Datei,
// die zweite (alte) Fassung überschrieb die erste, und sie griff auf eine Variable zu, die es nicht
// mehr gab. Auf der Karte warf damit jeder Auflösungslauf einen ReferenceError -- die gesamte
// Entzerrung der Beschriftung war tot, und KEIN Test hat es gemerkt: keiner ruft
// `resolveLabelCollisions` (sie braucht Leaflet und ein echtes DOM).
//
// Dieser Test ruft sie auch nicht. Er prüft nur das eine Muster, an dem so ein Unfall IMMER
// erkennbar ist -- billig, dateiweit, und er hätte den Fehler vor dem Push gefunden.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/keine-doppelten-funktionen.test.js

const wurzel = path.join(__dirname, "..", "..");
const AUSGENOMMEN = ["third-party"];

function jsDateien(verzeichnis) {
	const treffer = [];
	fs.readdirSync(verzeichnis, { withFileTypes: true }).forEach((eintrag) => {
		const voll = path.join(verzeichnis, eintrag.name);
		if (eintrag.isDirectory()) {
			if (AUSGENOMMEN.includes(eintrag.name) || eintrag.name === "__tests__") { return; }
			treffer.push(...jsDateien(voll));
			return;
		}
		if (eintrag.name.endsWith(".js")) { treffer.push(voll); }
	});
	return treffer;
}

const dateien = jsDateien(wurzel);
assert.ok(dateien.length > 50, `es werden wirklich Dateien geprueft (${dateien.length})`);

let geprueft = 0;
const befunde = [];
dateien.forEach((datei) => {
	const text = fs.readFileSync(datei, "utf8");
	const gesehen = new Map();
	// Nur Deklarationen auf OBERSTER Ebene (Spalte 0) -- eingerückte sind lokal und duerfen sich
	// wiederholen. Das ist genau die Ebene, auf der eine spaetere die fruehere ueberschreibt.
	const muster = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
	let treffer;
	while ((treffer = muster.exec(text)) !== null) {
		const name = treffer[1];
		const zeile = text.slice(0, treffer.index).split("\n").length;
		if (gesehen.has(name)) {
			befunde.push(`${path.relative(wurzel, datei)}: "${name}" steht in Zeile ${gesehen.get(name)} UND ${zeile}`);
		} else {
			gesehen.set(name, zeile);
		}
		geprueft += 1;
	}
});

assert.deepStrictEqual(befunde, [],
	"keine Datei deklariert dieselbe Funktion zweimal auf oberster Ebene:\n  " + befunde.join("\n  "));
assert.ok(geprueft > 500, `es wurden wirklich Deklarationen gefunden (${geprueft})`);

// 🔴 Und die konkrete Stelle, an der es passiert ist -- damit sie nicht ein zweites Mal entsteht.
const loeser = fs.readFileSync(path.join(wurzel, "map-features", "map-features-label-collisions.js"), "utf8");
assert.strictEqual((loeser.match(/^function resolveLabelCollisions\(/gm) || []).length, 1,
	"resolveLabelCollisions steht genau einmal in der Datei");
assert.ok(!/\bmaxDrift\b/.test(loeser),
	"und die verwaiste Variable des alten Losers ist weg -- der Deckel liegt jetzt im Fundament");

console.log(`keine-doppelten-funktionen: ${dateien.length} Dateien, ${geprueft} Deklarationen, alles eindeutig`);
