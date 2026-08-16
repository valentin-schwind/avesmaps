const assert = require("assert");
const {
	avesmapsRegionDerivedIsSourceless,
	avesmapsRegionPolygonIsInteractive,
} = require("../map-features-region-interactivity.js");

// ---- das Signal --------------------------------------------------------------------------------
// 💣 Es kommt vom SERVER (derived_source_geometry_public_ids, in zwei Abfragen aufgeloest) und wird
// NICHT im Browser gezaehlt. „Im Layer liegt nur die Huelle" trifft bei Zoom 4 auf 114 Gebiete zu,
// und 111 davon sind kerngesund -- ihre Quellflaechen sind bei diesem Zoom nur nicht ausgeliefert.
assert.strictEqual(
	avesmapsRegionDerivedIsSourceless({ is_derived_geometry: true, derived_source_geometry_public_ids: [] }),
	true,
	"leere Quellenliste = Geist",
);
assert.strictEqual(
	avesmapsRegionDerivedIsSourceless({ is_derived_geometry: true, derived_source_geometry_public_ids: ["g-1"] }),
	false,
	"eine Quelle reicht",
);
assert.strictEqual(
	avesmapsRegionDerivedIsSourceless({ is_derived_geometry: false, derived_source_geometry_public_ids: [] }),
	false,
	"eine Quellflaeche ist nie eine verwaiste Huelle",
);
// ⚠️ Fehlt das Feld, ist das die Lage ZWISCHEN zwei Deploys -- dann lieber nichts freischalten als
// aus Versehen jede Huelle der Karte anklickbar machen.
assert.strictEqual(
	avesmapsRegionDerivedIsSourceless({ is_derived_geometry: true }),
	false,
	"kein Feld = keine Aussage = kein Geist",
);

// ---- die Entscheidung --------------------------------------------------------------------------
const geist = { isDerivedGeometry: true, derivedIsSourceless: true, source: "political_territory" };
const aggregat = { isDerivedGeometry: true, derivedIsSourceless: false, source: "political_territory" };
const quelle = { isDerivedGeometry: false, derivedIsSourceless: false, source: "political_territory" };

// Editor: Huellen bleiben inert, damit Klicks an die Quellgeometrien gehen -- sonst landet
// update_geometry auf einer Derived-ID. Fuer den Geist gilt der Grund nicht: da ist nichts zu treffen.
assert.strictEqual(
	avesmapsRegionPolygonIsInteractive({ isEditMode: true, regionEntry: geist, isAtActiveDisplayZoom: true, isAggregatedSourceFragment: false }),
	true,
	"der Geist ist im Editor anklickbar",
);
// 💣 DIE GEGENPROBE, an der alles haengt: ohne sie kippen live 111 gesunde Aggregate mit und
// schlucken die Klicks ihrer Kinder (Discord #13, schon einmal bezahlt).
assert.strictEqual(
	avesmapsRegionPolygonIsInteractive({ isEditMode: true, regionEntry: aggregat, isAtActiveDisplayZoom: true, isAggregatedSourceFragment: false }),
	false,
	"Kosch und Winhall bleiben inert",
);
assert.strictEqual(
	avesmapsRegionPolygonIsInteractive({ isEditMode: true, regionEntry: quelle, isAtActiveDisplayZoom: false, isAggregatedSourceFragment: false }),
	true,
	"Quellflaechen sind im Editor zoomunabhaengig anklickbar (unveraendert)",
);

// Frontend: unveraendert -- Band + Herkunft entscheiden, der Geist bekommt keine Sonderrolle.
assert.strictEqual(
	avesmapsRegionPolygonIsInteractive({ isEditMode: false, regionEntry: aggregat, isAtActiveDisplayZoom: true, isAggregatedSourceFragment: false }),
	true,
	"Huelle im Band ist im Frontend anklickbar",
);
assert.strictEqual(
	avesmapsRegionPolygonIsInteractive({ isEditMode: false, regionEntry: aggregat, isAtActiveDisplayZoom: false, isAggregatedSourceFragment: false }),
	false,
	"ausserhalb des Bandes nicht",
);
assert.strictEqual(
	avesmapsRegionPolygonIsInteractive({ isEditMode: false, regionEntry: quelle, isAtActiveDisplayZoom: true, isAggregatedSourceFragment: true }),
	false,
	"ein Aggregat-Fragment bleibt im Frontend stumm",
);
assert.strictEqual(
	avesmapsRegionPolygonIsInteractive({ isEditMode: false, regionEntry: { ...quelle, source: "ecosystem" }, isAtActiveDisplayZoom: true, isAggregatedSourceFragment: false }),
	false,
	"nur politische Flaechen",
);

// ---- das Menue ---------------------------------------------------------------------------------
const { avesmapsRegionContextMenuPlan } = require("../map-features-region-interactivity.js");

const planGeist = avesmapsRegionContextMenuPlan(geist);
assert.deepStrictEqual(
	planGeist.actions,
	["edit-properties", "show-info", "delete"],
	"fuer einen Geist bleiben genau drei Eintraege -- alles andere gehoert einer Quellflaeche, die es nicht gibt",
);
assert.strictEqual(planGeist.deleteLabel, "Außenhülle löschen", "und der Loeschknopf sagt, was er loescht");

// 🔴 Der gesunde Pfad wird NICHT angefasst: ein Aggregat mit Quellen behaelt Menue und
// Beschriftung, wie sie waren. Die Ausnahme gilt dem Geist, nicht den Huellen ueberhaupt.
const planAggregat = avesmapsRegionContextMenuPlan(aggregat);
assert.strictEqual(planAggregat.actions, null, "ein gesundes Aggregat behaelt das volle Menue");
assert.strictEqual(planAggregat.deleteLabel, "Löschen", "und seine bisherige Beschriftung");

const planQuelle = avesmapsRegionContextMenuPlan(quelle);
assert.strictEqual(planQuelle.actions, null, "eine Quellflaeche ebenso");
assert.strictEqual(planQuelle.deleteLabel, "Löschen", "und behaelt ihre Beschriftung");

// ---- der Satz beim Klick -----------------------------------------------------------------------
// 💣 Er stand zweimal wortgleich im Code (Klick UND Doppelklick), und gefixt wurde einer. Wer
// klickt und nichts passiert, doppelklickt -- und bekam dort weiter „bitte das Unterreich
// anklicken" zu lesen, obwohl es keins gibt. Deshalb EIN Erzeuger, den beide Zweige rufen.
const { avesmapsRegionDerivedClickHint } = require("../map-features-region-interactivity.js");

assert.strictEqual(
	avesmapsRegionDerivedClickHint(geist),
	"Diese Außenhülle hat keine Quellfläche mehr. Rechtsklick → „Außenhülle löschen“.",
	"der Geist verweist auf den Rechtsklick",
);
assert.strictEqual(
	avesmapsRegionDerivedClickHint(aggregat),
	"Das ist eine abgeleitete Außengrenze. Bitte die untergeordnete Geometrie (das Unterreich) anklicken.",
	"das gesunde Aggregat behaelt seinen Satz",
);
// ⚠️ Ohne Aussage kein Sonderfall: derselbe Rueckfall wie bei avesmapsRegionDerivedIsSourceless.
assert.strictEqual(
	avesmapsRegionDerivedClickHint({ isDerivedGeometry: true }),
	"Das ist eine abgeleitete Außengrenze. Bitte die untergeordnete Geometrie (das Unterreich) anklicken.",
	"kein Feld = keine Aussage = der alte Satz",
);
assert.strictEqual(
	avesmapsRegionDerivedClickHint(null),
	"Das ist eine abgeleitete Außengrenze. Bitte die untergeordnete Geometrie (das Unterreich) anklicken.",
	"und ohne Eintrag ebenso",
);

// ---- der Satz beim Menue-Eintrag „Territoriumseditor oeffnen" ----------------------------------
// 💣 Derselbe Fehler eine Ebene weiter: `AVESMAPS_REGION_SOURCELESS_HULL_ACTIONS` LAESST den Eintrag
// fuer einen Geist ausdruecklich stehen, der Handler stieg aber fuer JEDE abgeleitete Huelle aus --
// „bitte das Unterreich bearbeiten", und ein Unterreich gibt es hier nicht. Der Eintrag war damit
// sichtbar und tot. Deshalb entscheidet nicht mehr der Handler, sondern ein Erzeuger.
// 🔴 `null` heisst „kein Hinweis, oeffne den Editor" -- nicht „leerer Hinweis".
const { avesmapsRegionDerivedPropertiesHint } = require("../map-features-region-interactivity.js");

assert.strictEqual(
	avesmapsRegionDerivedPropertiesHint(geist),
	null,
	"der Geist bekommt keinen Hinweis, sondern den Territoriumseditor",
);
// 🔴 DIE GEGENPROBE: der gesunde Pfad ist geprueft und bleibt Wort fuer Wort, wie er war.
assert.strictEqual(
	avesmapsRegionDerivedPropertiesHint(aggregat),
	"Das ist eine abgeleitete Außengrenze. Bitte die untergeordnete Geometrie (das Unterreich) bearbeiten.",
	"das gesunde Aggregat behaelt seinen Satz",
);
assert.strictEqual(
	avesmapsRegionDerivedPropertiesHint(quelle),
	null,
	"eine Quellflaeche oeffnet den Editor wie bisher",
);
// ⚠️ Ohne Aussage kein Sonderfall -- dieselbe Richtung wie avesmapsRegionDerivedIsSourceless und
// avesmapsRegionDerivedClickHint: zwischen zwei Deploys lieber der alte Satz als jede Huelle im Editor.
assert.strictEqual(
	avesmapsRegionDerivedPropertiesHint({ isDerivedGeometry: true }),
	"Das ist eine abgeleitete Außengrenze. Bitte die untergeordnete Geometrie (das Unterreich) bearbeiten.",
	"kein Feld = keine Aussage = der alte Satz",
);
// ⚠️ Hier weicht er vom Klick-Satz ab, und zwar absichtlich: ohne Eintrag gab es nie einen Hinweis,
// der Handler lief in den normalen Editor-Pfad. Der Erzeuger bildet ab, was war.
assert.strictEqual(
	avesmapsRegionDerivedPropertiesHint(null),
	null,
	"ohne Eintrag gibt es nichts zu erklaeren",
);

// 💣 Die Zusicherung, die das Abschreiben verhindert: BEIDE Zweige in map-features.js muessen den
// Erzeuger rufen, und keiner der beiden darf den Satz noch selbst im Code stehen haben.
const fs = require("fs");
const path = require("path");
const mapFeaturesSource = fs.readFileSync(path.join(__dirname, "..", "map-features.js"), "utf8");
assert.strictEqual(
	(mapFeaturesSource.match(/avesmapsRegionDerivedClickHint\(/g) || []).length,
	2,
	"Klick- und Doppelklick-Zweig rufen denselben Erzeuger",
);
// ⚠️ Gemeint ist der KLICK-Satz („… anklicken."). Der Menue-Eintrag „Territoriumseditor oeffnen"
// traegt einen eigenen, anders endenden Satz („… bearbeiten.") und gehoert nicht hierher.
assert.strictEqual(
	mapFeaturesSource.includes("Bitte die untergeordnete Geometrie (das Unterreich) anklicken."),
	false,
	"und keiner der beiden traegt den Satz noch selbst",
);

// Dieselbe Zusicherung fuer den Menue-Eintrag: EIN Aufruf, und der Satz steht nicht mehr im Handler.
assert.strictEqual(
	(mapFeaturesSource.match(/avesmapsRegionDerivedPropertiesHint\(/g) || []).length,
	1,
	"der Handler fragt den Erzeuger, statt selbst zu entscheiden",
);
assert.strictEqual(
	mapFeaturesSource.includes("Bitte die untergeordnete Geometrie (das Unterreich) bearbeiten."),
	false,
	"und traegt den Satz nicht mehr selbst",
);
// ⭐ Und der Geist laeuft in DENSELBEN Editor-Pfad wie jede Quellflaeche. Ein zweiter Aufruf waere
// eine zweite Fassung -- genau die Divergenz, an der der Klick-Satz schon einmal gescheitert ist.
assert.strictEqual(
	(mapFeaturesSource.match(/AvesmapsPoliticalTerritoryEditorLink\.open\(/g) || []).length,
	1,
	"es gibt genau EINEN Weg in den Territoriumseditor",
);

console.log("OK: verwaiste-aussenhuelle-interaktiv");
