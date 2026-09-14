// Der Auto-Name einer Landschaft -- DREI Regeln, EINE Fallliste.
//
// 🔴 Der Browser entscheidet den Haken „Auto-Name" (isEcosystemRegionAutoName) und, strenger, ob ein
// LESER statt des Namens die Art sieht (ecosystemRegionNameIsGriff). Der Server entscheidet, ob eine
// Landschaft in die Suche kommt (avesmapsLandscapeSearchNameIsMachineGiven,
// api/_internal/app/landscape-search.php). Alle drei lesen dieselbe Datei
// api/_internal/app/__tests__/fixtures/landschaft-autonamen.json -- dieser Test die Spalten
// `browser_auto` und `anzeige_griff`, der PHP-Test die Spalte `suche_verborgen`.
//
// 💣 Jede Stufe darf STRENGER sein als die vorige, nie grosszuegiger (Entwurf
// docs/superpowers/specs/2026-08-28-landschaften-in-der-suche-design.md §5): Haken ⊆ Anzeige ⊆ Suche.
// Ein Name, den der Haken als „Wald-001" erkennt, darf nie in einem Tooltip stehen, und einer, den die
// Anzeige verbirgt, nie als Suchtreffer erscheinen.
//
// 🔴 WARUM DIE ANZEIGE EINE EIGENE STUFE IST (14.09.2026): der Haken prueft nur gegen die AKTUELLE Art.
// „Fläche-048" wurde vergeben, als die Region noch keine Art hatte; seit sie ein Urwald ist, hielt der
// Haken den Griff fuer einen echten Namen -- und „Führt durch" zeigte ihn. Der Haken bleibt so, wie er
// ist (er ist eine eigene Entscheidung mit gespeichertem Merker); nur die ANZEIGE kennt den Rueckfall-
// Griff zusaetzlich, und das ohne Rücksicht auf Gross- und Kleinschreibung.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-autonamen-zwilling.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const {
	isEcosystemRegionAutoName,
	ecosystemRegionNameIsGriff,
	ECOSYSTEM_AUTO_NAME_FALLBACK,
} = require("../map-features-ecosystem-naming.js");

const fixture = JSON.parse(
	fs.readFileSync(path.join(wurzel, "api", "_internal", "app", "__tests__", "fixtures", "landschaft-autonamen.json"), "utf8")
);
const faelle = fixture.faelle;
assert.ok(Array.isArray(faelle) && faelle.length >= 10, "die Fallliste ist leer oder nicht gelesen");
assert.strictEqual(typeof ecosystemRegionNameIsGriff, "function", "die Anzeigeregel ist nicht exportiert");

let checks = 0;
for (const fall of faelle) {
	assert.strictEqual(typeof fall.anzeige_griff, "boolean", `Fall "${fall.name}" hat keine Spalte anzeige_griff`);
	assert.strictEqual(isEcosystemRegionAutoName(fall.name, fall.art), fall.browser_auto,
		`Haken-Regel bei "${fall.name}" (Art "${fall.art}")`);
	assert.strictEqual(ecosystemRegionNameIsGriff(fall.name, fall.art), fall.anzeige_griff,
		`Anzeige-Regel bei "${fall.name}" (Art "${fall.art}")`);
	checks += 3;
	if (fall.browser_auto) {
		assert.strictEqual(fall.anzeige_griff, true,
			`💣 Anzeige ⊇ Haken: "${fall.name}" haelt der Haken fuer automatisch, der Tooltip zeigte ihn`);
		checks++;
	}
	if (fall.anzeige_griff) {
		assert.strictEqual(fall.suche_verborgen, true,
			`💣 Suche ⊇ Anzeige: "${fall.name}" verbirgt die Anzeige, die Liste zeigt ihn in der Suche`);
		checks++;
	}
}

// Ohne einen Fall je Stufe, in dem sie strenger ist, beweist die Liste die Erweiterung nicht -- dann
// liefe jeder Test auch mit der schwaecheren Regel gruen.
assert.ok(faelle.some((fall) => !fall.browser_auto && fall.anzeige_griff),
	"die Liste braucht einen Fall, in dem die Anzeige strenger ist als der Haken (Fläche-048 als Urwald)"); checks++;
assert.ok(faelle.some((fall) => !fall.anzeige_griff && fall.suche_verborgen),
	"die Liste braucht einen Fall, in dem die Suche strenger ist als die Anzeige"); checks++;
assert.ok(faelle.some((fall) => !fall.browser_auto && !fall.anzeige_griff && !fall.suche_verborgen),
	"…und mindestens einen echten Namen, sonst verbirgt ein Riegel, der ALLES verbirgt, gruen"); checks++;

// 💣 Der Rueckfall-Griff steht in zwei Sprachen.
const php = fs.readFileSync(path.join(wurzel, "api", "_internal", "app", "ecosystem-naming.php"), "utf8");
const treffer = php.match(/const AVESMAPS_ECOSYSTEM_AUTO_NAME_FALLBACK = '([^']*)';/u);
assert.ok(treffer, "die Konstante des Servers ist nicht mehr lesbar -- umbenannt?"); checks++;
assert.strictEqual(treffer[1], ECOSYSTEM_AUTO_NAME_FALLBACK, "Rueckfall-Griff Server gegen Browser"); checks++;

console.log(`landschaft-autonamen-zwilling: ${checks} Pruefungen OK`);
