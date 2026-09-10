"use strict";

/**
 * EIN TREFFER OHNE WIKI-ADRESSE DARF KEINE ZUWEISUNG LOESCHEN.
 *
 * 🚩 Owner-Meldung 10.09.2026, waehrend der Handreparatur der sechs Landschaftsflaechen:
 * „Moosgrunder Tann weigert sich seine wiki-zuweisung zu speichern", „Madas Auge speichert auch
 * nicht seinen wikieintrag", und -- der entscheidende Satz -- „bei Dirak hat es erst nach dem
 * 3.-4. mal geklappt".
 *
 * 💣 DER MECHANISMUS: `wikiAssignZuweisen` uebernimmt den Rohtreffer der Staging-Suche ungeprueft
 * nach `pendingWikiRegion`, und das Speichern schickte `pendingWikiRegion?.wiki_url || ""`. Traegt
 * der Treffer KEINE Adresse, geht der leere String hinaus -- und `avesmapsEcosystemReadRegionFields`
 * liest den als „Zuweisung entfernen" (`wiki_url = null`, `wiki_region_key = null`). Der Kasten
 * meldete „Wiki-Landschaft gewaehlt", das Speichern meldete Erfolg, und zugewiesen war NICHTS.
 * ⭐ „Erst beim 3.-4. Mal" ist genau das Muster: je nachdem, welcher Treffer erwischt wurde, ging
 * eine Adresse mit oder eben nicht. Ein stiller Fehlschlag, der wie ein ignoriertes Formular
 * aussieht.
 *
 * 🔴 UND DIE ADRESSE WIRD NICHT AUS DEM SCHLUESSEL GEBAUT. `wiki_region_key` leitet der Server aus
 * `wiki_url` ab (AGENTS.md §5); die Gegenrichtung waere eine zweite Ableitung und braeche jeden
 * Join. Der Treffer wird abgelehnt, laut und sichtbar -- lieber keine Zuweisung als eine falsche.
 *
 * ⚠️ Geprueft wird der QUELLTEXT, kommentarfrei: der Dialog haengt an Leaflet, jQuery und einem
 * halben Dutzend Globals, und ein Nachbau davon pruefte den Nachbau. Die Aussage hier ist eine
 * ueber die zwei Riegel, nicht ueber das Rendering.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const DATEI = path.join(__dirname, "..", "map-features-ecosystem-properties.js");
const roh = fs.readFileSync(DATEI, "utf8").replace(/\r\n/g, "\n");

// 💣 Kommentare RAUS, bevor gesucht wird -- die Begruendungen dieses Fixes nennen die verbotene
// Zeile woertlich, und ein roher Fund waere die eigene Warnung. Dieselbe Lehre wie beim
// Rueckbau-Waechter in kanon-landschaft-zuweisung-test.php.
const quelle = roh
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.split("\n")
	.map((z) => z.replace(/^\s*\/\/.*$/, ""))
	.join("\n");

// ---- 1. Der Eingangsriegel ---------------------------------------------------------------------

assert.ok(
	/function wikiAssignZuweisen\([\s\S]{0,600}?if \(String\(roh\.wiki_url \|\| ""\)\.trim\(\) === ""\)/.test(quelle),
	"1a: wikiAssignZuweisen muss einen Treffer OHNE Adresse ablehnen, bevor er nach "
	+ "pendingWikiRegion wandert"
);
assert.ok(
	/if \(String\(roh\.wiki_url \|\| ""\)\.trim\(\) === ""\) \{[\s\S]{0,400}?setPropertiesError\([\s\S]{0,400}?return;/.test(quelle),
	"1b: und zwar SICHTBAR -- ein stilles `return` waere derselbe Fehlschlag in neuer Verkleidung"
);

// ---- 2. Der Riegel am Schreibweg, der tragende ---------------------------------------------------

assert.ok(
	!/payload\.wiki_url = pendingWikiRegion\?\.wiki_url \|\| "";/.test(quelle),
	"2a: 💣 DIE GEMELDETE ZEILE DARF NICHT ZURUECKKEHREN. `pendingWikiRegion?.wiki_url || \"\"` macht "
	+ "aus einem adresslosen Treffer eine Loeschung"
);
assert.ok(
	/if \(pendingWikiRegion === null\) \{\s*payload\.wiki_url = "";/.test(quelle),
	"2b: NUR das ausdrueckliche Entfernen (`null`) schickt den leeren String -- das ist die "
	+ "Loeschung, die es geben MUSS (Owner 03.09.2026)"
);
assert.ok(
	/\} else if \(pendingWikiRegion !== undefined\s*&& String\(pendingWikiRegion\.wiki_url \|\| ""\)\.trim\(\) !== ""\) \{/.test(quelle),
	"2c: und ein GEWAEHLTER Treffer reist nur mit, wenn er wirklich eine Adresse hat -- `null` und "
	+ "„gewaehlt, aber adresslos\" saehen sonst gleich aus"
);

// ⚠️ Die dritte Lesart bleibt unberuehrt: `undefined` heisst „unberuehrt, nimm den Stand der
// Flaeche" -- ohne sie loeschte jedes beilaeufige Speichern einer Flaeche ihre Zuweisung.
assert.ok(
	/`update_region` schreibt ausschliesslich die\n\s*\/\/ Felder, die IM Payload stehen/.test(roh)
	|| /Nur mitschicken, wenn wirklich daran gedreht wurde/.test(roh),
	"2d: die Begruendung fuer den `undefined`-Fall bleibt am Code stehen -- sie ist der Grund, "
	+ "warum hier ueberhaupt drei Zustaende noetig sind"
);

console.log("OK: landschaft-wiki-adresse-pflicht.test.js");
