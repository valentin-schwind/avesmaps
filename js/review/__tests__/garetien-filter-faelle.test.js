// Aufgabe 5, Fixrunde 1 (Garetien-Importer vereint, 14.09.2026): gemeinsame Fall-Tafel gegen
// garetienStageFilterAnwenden -- ihr PHP-Gegenstueck (garetien-filter-faelle-test.php) faehrt
// dieselbe Tafel gegen avesmapsGaretienListeObjektPasstFilter.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-filter-faelle.test.js
//
// 🔴 WARUM ES DIESE DATEI GIBT: garetienStageFilterAnwenden (Stage-Reiter) setzt dieselbe
// Filterregel um wie avesmapsGaretienListeObjektPasstFilter (Server-Reiter, PHP) -- Ebene, Typ,
// Urteil, Wiki, nur_mehrteilig, nur Verbuende, Suche. Ohne eine gemeinsame Fall-Tafel prueft jede
// Seite nur gegen eigene, hart codierte Erwartungen, und ein kuenftiger Zusatz auf einer Seite
// liefe unbemerkt auseinander. Kein PHP-Binary wird hier gestartet -- diese Datei liest dieselbe
// JSON-Tafel unabhaengig und fuehrt die echte JS-Funktion aus.
//
// 💣 DIE EINZIGE BEKANNTE NAMENSABWEICHUNG: das Feld heisst am Server/auf der Leitung
// `nur_verbuende` (so auch in der Tafel, PHP/Wire-kanonisch) und im internen `zustand.filter` des
// Clients `nurVerbuende` (camelCase, siehe der Kommentar an garetienStageAntwortBauen in
// review-garetien-importer.js). Diese Datei UEBERSETZT genau dieses eine Feld vor dem Aufruf --
// sie baut KEINE zweite Fassung der Filterregeln selbst nach. Alle uebrigen Felder (ebene, typ,
// urteil, wiki, nur_mehrteilig, suche) heissen auf beiden Seiten bereits gleich und reisen
// unveraendert durch.

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api } = ladeImporter([]);

// 🔴 EINE Tafel fuer beide Seiten: die Datei liegt bei ihrem PHP-Gegenstueck
// (api/_internal/import/__tests__/fixtures/), keine zweite Kopie unter js/.
const fixturePfad = path.join(
	__dirname, "..", "..", "..", "api", "_internal", "import", "__tests__", "fixtures",
	"garetien-filter-faelle.json"
);
const fixture = JSON.parse(fs.readFileSync(fixturePfad, "utf8"));
assert.ok(Array.isArray(fixture.faelle), 'die Fall-Tafel liefert ein Feld "faelle"');
assert.ok(fixture.faelle.length >= 15, "die Fall-Tafel deckt jeden Abschnitt mit Treffer/Fehltreffer ab");

// Die EINE dokumentierte Uebersetzung: nur_verbuende (Tafel, PHP/Wire) -> nurVerbuende (Client).
function alsClientFilter(filterAusTafel) {
	const f = Object.assign({}, filterAusTafel);
	if (Object.prototype.hasOwnProperty.call(f, "nur_verbuende")) {
		f.nurVerbuende = f.nur_verbuende;
		delete f.nur_verbuende;
	}
	return f;
}

let geprueft = 0;
fixture.faelle.forEach(function (fall) {
	const clientFilter = alsClientFilter(fall.filter || {});
	const ergebnis = api.garetienStageFilterAnwenden([fall.objekt], clientFilter);
	const ist = ergebnis.length === 1;
	assert.strictEqual(ist, fall.passt, 'Fall "' + fall.beschreibung + '": erwartet ' + fall.passt
		+ ", bekommen " + ist + " (objekt=" + JSON.stringify(fall.objekt) + ", filter="
		+ JSON.stringify(fall.filter) + ", clientFilter=" + JSON.stringify(clientFilter) + ")");
	geprueft++;
});

console.log(`OK: ${geprueft} Faelle aus der gemeinsamen Tafel (garetien-filter-faelle)`);
