// Die Sicht-Tafel: welche FORM und welche FARBE ein importiertes Objekt auf der Karte bekommt.
// Entwurf: docs/superpowers/specs/2026-08-29-garetien-importer-sichtwerkzeug-design.md §4.1
// Brief:   .superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-3-brief.md
// Nachtrag: .superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-3-nachtrag.md
//
// Ausfuehren: node js/review/__tests__/garetien-sicht-tafel.test.js
//
// 🔴 RULING R3 (Nachtrag §3): `Wege` und `Grenzen` fehlen ABSICHTLICH in der Tafel -- ihre
// Kartenfarben (Weiss, Grau, Hellwarm) haben KEIN Token (tokens.css:530). `Sonstiges` fehlt aus
// demselben Grund: ein Sammeltopf ohne eigene Bedeutung hat keine eigene Farbe zu vergeben. Alle
// drei muessen ueber `neutral: true` laufen, nicht ueber einen erfundenen Tokennamen.

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const WURZEL = path.resolve(__dirname, "..", "..", "..");

let checks = 0;
function gleich(i, s, w) { assert.strictEqual(i, s, w || ""); checks++; }
function wahr(b, w) { assert.ok(b, w || ""); checks++; }

const karte = require(path.resolve(__dirname, "..", "review-garetien-karte.js"));
const sicht = karte.avesmapsGaretienSichtFuer;
wahr(typeof sicht === "function", "avesmapsGaretienSichtFuer fehlt im Export");
wahr(typeof karte.AVESMAPS_GARETIEN_SICHT_EBENE === "object" && karte.AVESMAPS_GARETIEN_SICHT_EBENE !== null,
	"AVESMAPS_GARETIEN_SICHT_EBENE fehlt im Export");

// ---- 1. Mit Vorschlag gewinnt die SERVER-Auskunft -----------------------------------------------
//
// 🔴 `kind` + `subtyp` erlauben den Tokennamen nach der HAUSKONVENTION herzuleiten
// (`--color-ecosystem-<kind>-<subtyp mit _ als ->`, css/base/tokens.css:282). Kein zweiter
// Tabelleneintrag, keine zweite Wahrheit.
gleich(sicht({ ebene: "Gewaesser", typ: "See", kind: "topographie", subtyp: "see",
	geometrie_typ: "Polygon" }).token, "--color-ecosystem-topographie-see",
	"ein See mit Vorschlag bekommt SEINE echte Kartenfarbe, hergeleitet aus kind+subtyp");
gleich(sicht({ ebene: "Gewaesser", typ: "See", kind: "topographie", subtyp: "see",
	geometrie_typ: "Polygon" }).form, "flaeche",
	"und `geometrie_typ` entscheidet die Form -- die Auskunft des Erzeugers ueber sich selbst");
// Die DIFFERENZ: derselbe Vorschlag als LineString ist eine Linie, keine Flaeche.
gleich(sicht({ ebene: "Gewaesser", typ: "See", kind: "topographie", subtyp: "see",
	geometrie_typ: "LineString" }).form, "linie",
	"ohne Polygon bleibt es eine Linie, auch mit Vorschlag");

gleich(sicht({ ebene: "Gewaesser", typ: "Fluss", subtyp: "Flussweg",
	geometrie_typ: "LineString" }).token, "--color-path-flussweg",
	"ein Weg-Ziel hat kein `kind` und leitet aus dem `subtyp` her -- kleingeschrieben");
gleich(sicht({ ebene: "Gewaesser", typ: "Sumpf", kind: "vegetation", subtyp: "suempfe_moore",
	geometrie_typ: "Polygon" }).token, "--color-ecosystem-vegetation-suempfe-moore",
	"ein Unterstrich im `subtyp` wird zum Bindestrich -- so wie die Hauskonvention es verlangt");

// ---- 2. OHNE Vorschlag entscheidet die EBENE ----------------------------------------------------
//
// 🔴 DER HAEUFIGSTE FALL. `subtyp` und `geometrie_typ` sind ohne Vorschlag LEER (beide kommen aus
// `after`, das es ohne Vorschlag nicht gibt) -- ihr `ebene` dagegen ist immer da. Wer die genaue
// Zahl der moeglichen Werte braucht, zaehlt sie in AVESMAPS_GARETIEN_EBENEN
// (api/_internal/import/garetien-abruf.php) nach, statt einer Zahl hier zu glauben.
gleich(sicht({ ebene: "Berge", typ: "Berg", subtyp: "", geometrie_typ: "" }).form, "punkt",
	"ein Berg ohne Vorschlag ist ein PUNKT -- als Linie gezeichnet waere er unsichtbar");
gleich(sicht({ ebene: "Ortschaften_3", typ: "Dorf", subtyp: "", geometrie_typ: "" }).form, "punkt",
	"alle vier Ortschaften-Ebenen sind Punkte");
gleich(sicht({ ebene: "Ortschaften_1", typ: "Dorf", subtyp: "", geometrie_typ: "" }).token,
	"--color-marker-settlement", "Ortschaften_1 traegt dasselbe Siedlungstoken");
gleich(sicht({ ebene: "Detail_2", typ: "Bauwerk", subtyp: "", geometrie_typ: "" }).form, "punkt",
	"Detail_1/2 sind ebenfalls Punkte");
gleich(sicht({ ebene: "Waelder", typ: "Forst", subtyp: "", geometrie_typ: "" }).token,
	"--color-ecosystem-vegetation-wald", "ein Wald ist gruen, auch ohne Vorschlag");
gleich(sicht({ ebene: "Waelder", typ: "Forst", subtyp: "", geometrie_typ: "" }).form, "flaeche",
	"ein Wald ohne Vorschlag ist eine Flaeche");
gleich(sicht({ ebene: "Gewaesser", typ: "See", subtyp: "", geometrie_typ: "" }).token,
	"--color-path-flussweg",
	"ein Gewaesser ohne Vorschlag bekommt die grobe Wasserfarbe -- 'See' im Feld `typ` aendert "
	+ "daran nichts, `typ` wird hier NICHT gelesen");

// Die DIFFERENZ zwischen den Ebenen: zwei verschiedene Ebenen ergeben zwei verschiedene Tokens.
wahr(sicht({ ebene: "Berge", subtyp: "", geometrie_typ: "" }).token
	!== sicht({ ebene: "Waelder", subtyp: "", geometrie_typ: "" }).token,
	"Berge und Waelder muessten sich sonst nicht unterscheiden -- die Tafel waere Vakuum");

// `geometrie_typ` schlaegt auch bei einem Tafeleintrag durch, falls es (untypisch) doch gefuellt
// waere -- es ist die Auskunft des Erzeugers ueber sich selbst, die Tafel nur die Faustregel.
gleich(sicht({ ebene: "Berge", typ: "Berg", subtyp: "", geometrie_typ: "Polygon" }).form, "flaeche",
	"ein gefuelltes `geometrie_typ` gewinnt auch gegen die Tafel");

// ---- 3. RULING R3: Wege, Grenzen und Sonstiges fallen ABSICHTLICH neutral aus -------------------
//
// Fuer diese drei Ebenen gibt es KEIN Kartentoken (tokens.css:530 fuer Wege/Grenzen; Sonstiges ist
// der Sammeltopf ohne eigene Bedeutung). Ein erfundenes Token waere die zweite Farbwahrheit, die
// AGENTS.md §12 verbietet -- und ein Tokenname, den es nicht gibt, liesse die Form lautlos
// verschwinden (leerer `var()`).
["Wege", "Grenzen", "Sonstiges"].forEach(function (ebene) {
	const r = sicht({ ebene: ebene, typ: "irgendwas", subtyp: "", geometrie_typ: "" });
	gleich(r.neutral, true, "Ebene " + ebene + " hat KEINE eigene Sicht-Regel (RULING R3)");
	gleich(r.token, "--color-marker-active",
		"Ebene " + ebene + " faellt auf den Gold-Rueckfall zurueck, nicht auf ein erfundenes Token");
});
gleich(Object.prototype.hasOwnProperty.call(karte.AVESMAPS_GARETIEN_SICHT_EBENE, "Wege"), false,
	"die Tafel darf keinen Eintrag fuer `Wege` bekommen -- es gibt kein Kartentoken dafuer");
gleich(Object.prototype.hasOwnProperty.call(karte.AVESMAPS_GARETIEN_SICHT_EBENE, "Grenzen"), false,
	"die Tafel darf keinen Eintrag fuer `Grenzen` bekommen -- es gibt kein Kartentoken dafuer");

// ---- 4. Unbekannt faellt NEUTRAL aus, und sagt es ------------------------------------------------
//
// ⚠️ Die zurueckhaltende Richtung: eine unbekannte Ebene wird gezeichnet wie bisher (goldene Linie),
// nie gar nicht. Ein nicht gezeichnetes Objekt ist von „liegt da nichts" nicht zu unterscheiden.
const unbekannt = sicht({ ebene: "Sternenhimmel", typ: "Komet", subtyp: "", geometrie_typ: "" });
gleich(unbekannt.form, "linie", "unbekannt heisst Linie -- das Bild von vor dieser Aufgabe");
gleich(unbekannt.token, "--color-marker-active", "und Gold");
gleich(unbekannt.neutral, true,
	"🔴 und es SAGT, dass es geraten hat -- die Bilanzzeile meldet es, sonst sieht ein Rueckfall "
	+ "aus wie „so sieht das Objekt eben aus\"");
// Die DIFFERENZ: ein getroffener Fall meldet sich NICHT als neutral.
gleich(sicht({ ebene: "Berge", typ: "Berg", subtyp: "", geometrie_typ: "" }).neutral, false,
	"ein Treffer in der Tafel ist kein Rueckfall");
gleich(sicht({ ebene: "Gewaesser", typ: "Fluss", subtyp: "Flussweg",
	geometrie_typ: "LineString" }).neutral, false,
	"und ein Treffer ueber `subtyp` erst recht nicht");
// Ohne jede Auskunft (kein `ebene`, kein `subtyp`) ist es ebenfalls neutral -- nicht etwa ein Wurf.
gleich(sicht({}).neutral, true, "ein leeres Objekt ist neutral, nicht kaputt");
gleich(sicht(null).neutral, true, "und `null` erst recht");

// ---- 5. Jedes Token der Tafel existiert wirklich -------------------------------------------------
//
// 🪤 Ein Tokenname, den es nicht gibt, macht `var()` ungueltig und `getComputedStyle` liefert "" --
// der Strich verschwindet dann lautlos, ohne Fehler und ohne Warnung (task-3-nachtrag.md). Diese
// Probe haette `--color-path-strasse`/`--color-territory-boundary` aus dem urspruenglichen Brief
// VOR dem Bauen verworfen.
const tokensCss = fs.readFileSync(path.join(WURZEL, "css", "base", "tokens.css"), "utf8");
function tokenDefiniert(name) {
	return new RegExp("^\\s*" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:", "m")
		.test(tokensCss);
}
wahr(tokenDefiniert("--color-marker-active"),
	"die Gegenprobe muss ein WIRKLICH vorhandenes Token finden, sonst prueft sie nichts");
wahr(!tokenDefiniert("--color-path-strasse-die-es-nicht-gibt"),
	"und ein erfundenes Token darf sie nicht finden, sonst prueft sie nichts");

const ebenenTokens = Object.keys(karte.AVESMAPS_GARETIEN_SICHT_EBENE)
	.map(function (k) { return karte.AVESMAPS_GARETIEN_SICHT_EBENE[k].token; });
wahr(ebenenTokens.length > 0, "die Tafel darf nicht leer sein -- sonst prueft die Schleife nichts");
Array.from(new Set(ebenenTokens.concat([karte.AVESMAPS_GARETIEN_SICHT_NEUTRAL.token])))
	.forEach(function (token) {
		wahr(tokenDefiniert(token), "Tafel-Token " + token + " steht nicht in css/base/tokens.css");
	});

// ---- 6. Rot heisst: bei uns liegt etwas, und eine Frage ist offen (Aufgabe 4, Entwurf §4.2) -----
//
// 🔴 Genau die drei Urteile, bei denen bei uns etwas an derselben Stelle liegt UND eine Frage offen
// ist. Eine Kollision betrifft BEIDE Seiten (ihre Form UND unsere) -- diese Probe prueft nur das
// reine Praedikat; die Verdrahtung beider Hoefe steht in garetien-karte.test.js Abschnitt 11e.
const kollidiert = karte.avesmapsGaretienKollidiert;
wahr(typeof kollidiert === "function", "avesmapsGaretienKollidiert fehlt im Export");
gleich(kollidiert({ urteil: "widerspruch" }), true, "ein Widerspruch gluet rot");
gleich(kollidiert({ urteil: "zweifel" }), true, "ein Zweifel auch");
gleich(kollidiert({ urteil: "ergaenzung" }), true, "und eine Ergaenzungsfrage auch");

// 🔴 DIE DIFFERENZ, und sie traegt die Aussage: wo nichts kollidiert, glueht auch nichts.
gleich(kollidiert({ urteil: "neu" }), false,
	"bei „neu\" liegt bei uns NICHTS -- ein rotes Gluehen behauptete eine Kollision, die es "
	+ "nicht gibt");
gleich(kollidiert({ urteil: "deckt_sich" }), false,
	"bei „deckt sich\" ist nichts zu entscheiden");
gleich(kollidiert({ urteil: "uebersprungen" }), false, "und uebersprungen ist keine Kollision");
gleich(kollidiert({}), false, "ohne Urteil: kein Gluehen (die zurueckhaltende Richtung)");
gleich(kollidiert(null), false, "und `null` erst recht nicht");

// 💣 Der Wert heisst in den Daten `widerspruch`, NICHT `widerspricht` (task-4-nachtrag.md §4) --
// diese Verwechslung hat am 29.08.2026 dazu gefuehrt, dass ein ganzer Objekttyp durch alle Filter
// fiel. Wer den Tippfehler in die Liste schriebe, verloere lautlos jede Kollisionsmeldung dieser Art.
gleich(kollidiert({ urteil: "widerspricht" }), false,
	"„widerspricht\" ist NICHT der Datenwert -- die Liste normalisiert, hier steht der normalisierte "
	+ "Wert");

console.log(`garetien-sicht-tafel: ${checks} Pruefungen bestanden.`);
