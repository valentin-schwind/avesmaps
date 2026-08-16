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

console.log("OK: verwaiste-aussenhuelle-interaktiv");
