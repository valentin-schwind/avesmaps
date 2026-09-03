// Ein Gipfel steht in „Alle“ und „Topographie“ spaetestens ab der Vorgabe seiner Art.
//
// Owner 03.09.2026: „Kannst du machen, dass in den Landschaftsansichten “Alle" und "Topographie"
// wieder alle Berge, Vulkane, etc. angezeigt werden?"
//
// 🔴 DIE DRITTE FASSUNG DERSELBEN ZEILE IN EINER WOCHE, und die zwei davor sind der Grund fuer
// ihre Form:
//   27.08.-02.09.  die Tafel (berggipfel/vulkan ab 4) schlug das eigene Band UEBERALL -- ein Riegel,
//                  „Sichtbar ab Zoom“ bei 76 Gipfeln still wirkungslos (Owner 02.09.: „ich wollte nur
//                  dass berggipfel durch die einstellung eine vorgabe bekommen").
//   ab 02.09.      UEBERALL nur das eigene Band (6a0390e32) -- und in der Topographie fehlten bei z4
//                  19 von 76 Gipfeln, bei z5 11, weil ihr eigenes Band spaeter beginnt.
//   ab 03.09.      keine dritte Zahl, sondern ein ORT: nur im Landschaftsmodus mit „Alle“ oder
//                  „Topographie“ haengt an das eigene Band die Zusage der Tafel. Ueberall sonst gilt
//                  weiter allein das eigene Band -- „Der Dreizack“ (min_zoom 6) bleibt in der
//                  Standardansicht bei z5 weg.
//
// ⭐ Der Test FAEHRT die Regel, die Weiche und shouldShowLabelMarker als Ausschnitte mit einer
// steuerbaren Umgebung, statt ihren Quelltext zu lesen -- ein Regex kennt keinen Geltungsbereich
// (die Lehre vom 03.09.2026, Beschriftungen zwei Stunden weg bei drei gruenen Signalen).
// Die Tafel wird ECHT geladen: ihr „ab 4“ fuer beide Gipfelarten ist der Owner-Entscheid vom 27.08.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/gipfel-band-in-der-ansicht.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.join(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(path.join(wurzel, "js", "map-features", "map-features-labels.js"), "utf8")
	.replace(/\r\n/g, "\n");
let pruefungen = 0;
const ist = (a, b, was) => { assert.strictEqual(a, b, `${was} (bekam: ${JSON.stringify(a)})`); pruefungen++; };

global.window = {};
global.location = { search: "" };
global.document = { getElementById: () => null };
vm.runInThisContext(
	fs.readFileSync(path.join(wurzel, "js", "map-features", "ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" }
);

function ausschnitt(name) {
	const von = quelle.indexOf("function " + name + "(");
	assert.ok(von >= 0, name + " steht als eigene Funktion da");
	const bis = quelle.indexOf("\n}", von);
	return quelle.slice(von, bis + 2);
}

// Die Umgebung, wie die Funktionen sie sehen -- je Fall umgestellt.
const umgebung = { eco: false, showAll: false, kind: "vegetation" };
global.isEcosystemLayerModeActive = () => umgebung.eco;
global.isEcosystemShowAllLayers = () => umgebung.showAll;
global.getActiveEcosystemLayerKind = () => umgebung.kind;
global.isEcosystemPeakSubtype = (t) => t === "berggipfel" || t === "vulkan";

vm.runInThisContext(
	[ausschnitt("avesmapsLabelImBand"), ausschnitt("avesmapsGipfelAnsichtAktiv"),
		ausschnitt("avesmapsLabelImBandDerAnsicht"), ausschnitt("shouldShowLabelMarker")].join("\n"),
	{ filename: "map-features-labels-ausschnitt.js" }
);

const standard = () => { umgebung.eco = false; umgebung.showAll = false; umgebung.kind = "vegetation"; };
const topographie = () => { umgebung.eco = true; umgebung.showAll = false; umgebung.kind = "topographie"; };
// ⚠️ „Alle“ merkt sich die zuletzt gewaehlte Ebene -- live gemessen 03.09.2026: showAll true,
// ecoKind "vegetation". Genau so wird sie hier gestellt, damit die Reihenfolge der Weiche zaehlt.
const alle = () => { umgebung.eco = true; umgebung.showAll = true; umgebung.kind = "vegetation"; };
const vegetation = () => { umgebung.eco = true; umgebung.showAll = false; umgebung.kind = "vegetation"; };

const dreizack = { labelType: "berggipfel", minZoom: 6, maxZoom: 7 };   // der gemeldete Fall vom 02.09.
const frueh = { labelType: "vulkan", minZoom: 2, maxZoom: 7 };
const kurz = { labelType: "berggipfel", minZoom: 6, maxZoom: 6 };
const see = { labelType: "see", minZoom: 6, maxZoom: 7 };

// ---- A. Die Ansicht ----------------------------------------------------------------------------
standard();
ist(avesmapsGipfelAnsichtAktiv(), false, "Standardansicht: keine Gipfel-Ansicht");
vegetation();
ist(avesmapsGipfelAnsichtAktiv(), false, "Vegetation: keine Gipfel-Ansicht");
topographie();
ist(avesmapsGipfelAnsichtAktiv(), true, "Topographie: Gipfel-Ansicht");
alle();
ist(avesmapsGipfelAnsichtAktiv(), true, "💣 „Alle“ ist Gipfel-Ansicht, obwohl die gemerkte Ebene „vegetation“ sagt");

// ---- B. Standardansicht: der Stand vom 02.09. bleibt --------------------------------------------
standard();
ist(avesmapsLabelImBandDerAnsicht(dreizack, 4), false, "🔴 Standard: „Der Dreizack“ (min 6) bei z4 nicht");
ist(avesmapsLabelImBandDerAnsicht(dreizack, 5), false, "Standard: bei z5 nicht -- der gemeldete Fall");
ist(avesmapsLabelImBandDerAnsicht(dreizack, 6), true, "Standard: ab z6 steht er da");
ist(avesmapsLabelImBandDerAnsicht(frueh, 3), true, "Standard: ein eigenes z2 zieht vor");

// ---- C. Topographie: spaetestens ab der Vorgabe -------------------------------------------------
topographie();
ist(avesmapsLabelImBandDerAnsicht(dreizack, 3), false, "Topographie: vor der Vorgabe (ab 4) nicht");
ist(avesmapsLabelImBandDerAnsicht(dreizack, 4), true, "🔴 Topographie: bei z4 steht er -- die Zusage der Tafel");
ist(avesmapsLabelImBandDerAnsicht(dreizack, 5), true, "Topographie: bei z5 auch");
ist(avesmapsLabelImBandDerAnsicht(dreizack, 7), true, "Topographie: bis z7");
ist(avesmapsLabelImBandDerAnsicht(frueh, 3), true, "Topographie: ein eigenes z2 zieht weiterhin vor -- frueher ja");
ist(avesmapsLabelImBandDerAnsicht(kurz, 7), false, "💣 das eigene OBERE Ende bleibt: „nur bis Zoom 6“ gilt auch hier");
ist(avesmapsLabelImBandDerAnsicht(kurz, 4), true, "aber ab z4 steht er");
ist(avesmapsLabelImBandDerAnsicht(see, 4), false, "💣 ein See ist kein Gipfel -- die Zusage gilt NUR der Gipfelliste");
ist(avesmapsLabelImBandDerAnsicht(see, 6), true, "der See folgt seinem eigenen Band");

// ---- D. „Alle“: dieselbe Zusage ----------------------------------------------------------------
alle();
ist(avesmapsLabelImBandDerAnsicht(dreizack, 4), true, "🔴 Alle: bei z4 steht er");
ist(avesmapsLabelImBandDerAnsicht(dreizack, 3), false, "Alle: bei z3 nicht");

// ---- E. Vegetation: keine Zusage --------------------------------------------------------------
vegetation();
ist(avesmapsLabelImBandDerAnsicht(dreizack, 4), false, "Vegetation: nur das eigene Band");

// ---- F. Die Tafel wird gelesen, nicht abgeschrieben --------------------------------------------
topographie();
avesmapsEcosystemDisplayInstall({ vorgabe: { berggipfel: { ab: 5, bis: 7 } } });
ist(avesmapsLabelImBandDerAnsicht(dreizack, 4), false, "Tafel auf ab 5: bei z4 nicht mehr");
ist(avesmapsLabelImBandDerAnsicht(dreizack, 5), true, "Tafel auf ab 5: ab z5");
// ⚠️ „aus“ (bis < ab) sagt NICHTS zu -- nur das eigene Band gilt.
avesmapsEcosystemDisplayInstall({ vorgabe: { berggipfel: { ab: 5, bis: 4 } } });
ist(avesmapsLabelImBandDerAnsicht(dreizack, 5), false, "Tafel „aus“: keine Zusage");
ist(avesmapsLabelImBandDerAnsicht(dreizack, 6), true, "Tafel „aus“: das eigene Band bleibt");
avesmapsEcosystemDisplayInstall(null);

// ---- G. Der hereingereichte Zweig ist rein -----------------------------------------------------
standard();
ist(avesmapsLabelImBandDerAnsicht(dreizack, 4, true), true, "hereingereichtes „Gipfel-Ansicht“ schlaegt die Umgebung");
topographie();
ist(avesmapsLabelImBandDerAnsicht(dreizack, 4, false), false, "hereingereichtes „keine“ ebenso");

// ---- H. Fehlt die Gipfelliste, faellt es auf das eigene Band -- kein Wurf ----------------------
const liste = global.isEcosystemPeakSubtype;
delete global.isEcosystemPeakSubtype;
ist(avesmapsLabelImBandDerAnsicht(dreizack, 4), false, "ohne Gipfelliste: kein Gipfel, kein Wurf");
global.isEcosystemPeakSubtype = liste;

// ---- I. Die Verdrahtung: shouldShowLabelMarker WIRKLICH gefahren --------------------------------
global.map = { getZoom: () => 4 };
global.getMapRenderBounds = () => ({});
global.isMapLabelEditorOverrideActive = () => undefined;
global.isLabelsWithRegionFilterActive = () => false;
global.ecosystemRegionOfLabel = () => null;
global.isLabelOfActiveEcosystemLayer = () => true;
global.MAP_LABEL_MODES = ["deregraphic", "ecosystem"];
global.getSelectedMapLayerMode = () => (umgebung.eco ? "ecosystem" : "deregraphic");
global.isLatLngInRenderBounds = () => true;
const eintrag = (label) => ({ label, marker: { getLatLng: () => ({ lat: 0, lng: 0 }) } });

topographie();
ist(shouldShowLabelMarker(eintrag(dreizack)), true, "🔴 Topographie, z4: der Marker steht");
ist(shouldShowLabelMarker(eintrag(see)), false, "Topographie, z4: der See (min 6) nicht");
standard();
ist(shouldShowLabelMarker(eintrag(dreizack)), false, "Standard, z4: der Marker bleibt weg");
topographie();
ist(shouldShowLabelMarker(eintrag(dreizack), 4, {}, false), false,
	"💣 nur ZEIGEN, nie verbergen: der Labels-Haken aus bleibt aus");
ist(shouldShowLabelMarker(eintrag({ ...dreizack, showName: false })), false,
	"„Regionname anzeigen“ aus bleibt aus");
global.isLatLngInRenderBounds = () => false;
ist(shouldShowLabelMarker(eintrag(dreizack)), false, "und das Culling am Bildrand gilt weiter");
global.isLatLngInRenderBounds = () => true;

// ---- J. Die 76 Live-Baender als Zeuge (map-features.php, 03.09.2026) ---------------------------
// 💣 Gemessen, nicht geschaetzt: min_zoom je Gipfel, alle max_zoom 7. Das ist der Bestand, an dem
// der Owner die Luecke gesehen hat -- und die Zahlen, die 6a0390e32 als Preis genannt hat.
const bestand = [];
const zaehle = (art, min, n) => { for (let i = 0; i < n; i++) { bestand.push({ labelType: art, minZoom: min, maxZoom: 7 }); } };
zaehle("berggipfel", 2, 2); zaehle("berggipfel", 3, 21); zaehle("berggipfel", 4, 14);
zaehle("berggipfel", 5, 8); zaehle("berggipfel", 6, 10); zaehle("berggipfel", 7, 1);
zaehle("vulkan", 3, 10); zaehle("vulkan", 4, 10);
ist(bestand.length, 76, "76 Gipfel im Livebestand");
const sichtbar = (zoom) => bestand.filter((l) => avesmapsLabelImBandDerAnsicht(l, zoom)).length;
standard();
ist(sichtbar(3), 33, "Standard z3: 33 (die 33, die der Owner am 02.09. angenommen hat)");
ist(sichtbar(4), 57, "Standard z4: 57 -- 19 fehlen, das ist der gemeldete Zustand");
ist(sichtbar(5), 65, "Standard z5: 65 -- 11 fehlen");
topographie();
ist(sichtbar(3), 33, "Topographie z3: unveraendert 33 -- vor der Vorgabe aendert sich nichts");
ist(sichtbar(4), 76, "🔴 Topographie z4: ALLE 76");
ist(sichtbar(5), 76, "🔴 Topographie z5: ALLE 76");
alle();
ist(sichtbar(4), 76, "🔴 Alle z4: ALLE 76");

console.log(`gipfel-band-in-der-ansicht.test: OK (${pruefungen} Zusicherungen)`);
