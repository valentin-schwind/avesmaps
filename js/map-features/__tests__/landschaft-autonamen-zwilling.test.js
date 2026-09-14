// Der Auto-Name einer Landschaft -- ZWEI Seiten, EINE Fallliste.
//
// 🔴 Der Browser entscheidet den Haken „Auto-Name" (isEcosystemRegionAutoName), der Server entscheidet,
// ob eine Landschaft in die Suche kommt (avesmapsLandscapeSearchNameIsMachineGiven,
// api/_internal/app/landscape-search.php). Beide lesen dieselbe Datei
// api/_internal/app/__tests__/fixtures/landschaft-autonamen.json -- dieser Test die Spalte
// `browser_auto`, der PHP-Test die Spalte `suche_verborgen`.
//
// 💣 Die Suche darf STRENGER sein als der Haken, nie grosszuegiger (Entwurf
// docs/superpowers/specs/2026-08-28-landschaften-in-der-suche-design.md §5): ein Name, den der Browser
// als „Wald-001" erkennt, darf nie als Suchtreffer erscheinen.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-autonamen-zwilling.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const { isEcosystemRegionAutoName, ECOSYSTEM_AUTO_NAME_FALLBACK } = require("../map-features-ecosystem-naming.js");

const fixture = JSON.parse(
	fs.readFileSync(path.join(wurzel, "api", "_internal", "app", "__tests__", "fixtures", "landschaft-autonamen.json"), "utf8")
);
const faelle = fixture.faelle;
assert.ok(Array.isArray(faelle) && faelle.length >= 10, "die Fallliste ist leer oder nicht gelesen");

let checks = 0;
for (const fall of faelle) {
	assert.strictEqual(isEcosystemRegionAutoName(fall.name, fall.art), fall.browser_auto,
		`Browser-Regel bei "${fall.name}" (Art "${fall.art}")`);
	checks++;
	if (fall.browser_auto) {
		assert.strictEqual(fall.suche_verborgen, true,
			`💣 Server ⊇ Browser: "${fall.name}" haelt der Browser fuer automatisch, die Liste zeigt ihn in der Suche`);
		checks++;
	}
}

// Ohne einen Fall, in dem die Suche strenger ist, beweist die Liste die Erweiterung nicht -- dann liefe
// der Server-Test auch mit der Browser-Regel gruen.
assert.ok(faelle.some((fall) => !fall.browser_auto && fall.suche_verborgen),
	"die Liste braucht mindestens einen Fall, in dem die Suche strenger ist als der Haken"); checks++;
assert.ok(faelle.some((fall) => !fall.browser_auto && !fall.suche_verborgen),
	"…und mindestens einen echten Namen, sonst verbirgt ein Riegel, der ALLES verbirgt, gruen"); checks++;

// 💣 Der Rueckfall-Griff steht in zwei Sprachen.
const php = fs.readFileSync(path.join(wurzel, "api", "_internal", "app", "ecosystem-naming.php"), "utf8");
const treffer = php.match(/const AVESMAPS_ECOSYSTEM_AUTO_NAME_FALLBACK = '([^']*)';/u);
assert.ok(treffer, "die Konstante des Servers ist nicht mehr lesbar -- umbenannt?"); checks++;
assert.strictEqual(treffer[1], ECOSYSTEM_AUTO_NAME_FALLBACK, "Rueckfall-Griff Server gegen Browser"); checks++;

console.log(`landschaft-autonamen-zwilling: ${checks} Pruefungen OK`);
