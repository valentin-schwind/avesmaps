// Fall #73 — "Sporadische Fehler beim Selektieren von Territorien".
//
// 💣 DIE URSACHE: das Durchschalten durch uebereinanderliegende Gebiete zaehlt EINEN Zaehler hoch,
// und der Rechtsklick zaehlte ihn MIT. Der Editor waehlte per Linksklick die richtige Kontur (Toast
// "1/2"), und der darauf folgende Rechtsklick schaltete eine weiter -- das Kontextmenue und damit der
// Editor gehoerten der ANDEREN Flaeche. Bei genau zwei Flaechen kippt das JEDES Mal.
//
// ⚠️ Warum es sich "sporadisch" anfuehlte, obwohl es deterministisch ist: der Zaehler gilt nur
// REGION_OVERLAP_SELECTION_TIMEOUT_MS (3000) lang und nur innerhalb von
// REGION_OVERLAP_SELECTION_MAX_PIXEL_DISTANCE (18) Pixeln. Wer langsam genug ist oder die Maus weit
// genug bewegt, faellt auf 0 zurueck und trifft zufaellig richtig. Gemeldet als "klappt dann so etwa
// beim 10ten bis 20ten Versuch erst" (Nottel, 15.08.2026) -- das ist genau dieses Zeitfenster.
//
// 🔴 Die Regel dahinter: Durchschalten ist eine AUSWAHL-Geste (Linksklick). Der Rechtsklick HANDELT
// auf der aktuellen Auswahl und veraendert sie nicht.
//
// Run: node js/map-features/__tests__/region-overlap-rechtsklick.test.js

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "map-features-region-overlap-selection.js"), "utf8");

let jetzt = 1000;
const context = {
	console,
	window: {},
	Date: { now: () => jetzt },
	REGION_OVERLAP_SELECTION_TIMEOUT_MS: 3000,
	REGION_OVERLAP_SELECTION_MAX_PIXEL_DISTANCE: 18,
	recentRegionOverlapSelection: null,
	regionPolygons: [],
	L: {
		latLng: (wert) => (Array.isArray(wert) ? { lat: wert[0], lng: wert[1] } : { lat: wert.lat, lng: wert.lng }),
		stamp: (layer) => layer._id,
	},
	map: {
		// Der Test rechnet in Pixeln == Koordinaten; die Umrechnung interessiert hier nicht,
		// nur der Abstand zwischen zwei Klickpunkten.
		latLngToContainerPoint: ({ lat, lng }) => ({
			x: lng,
			y: lat,
			distanceTo(anderer) { return Math.hypot(anderer.x - this.x, anderer.y - this.y); },
		}),
		latLngToLayerPoint: ({ lat, lng }) => ({ x: lng, y: lat }),
	},
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);

let fehler = 0;
function pruefe(bedingung, warum) {
	if (!bedingung) { console.error("FAIL: " + warum); fehler += 1; }
}

// Zwei uebereinanderliegende Herrschaftsgebiete -- der gemeldete Fall: Baronie "Irakema" und
// "Staemme des Regengebirges" ueberlappen sich wirklich, beides echte, verschiedene Gebiete.
function flaeche(id, name) {
	return {
		_id: id,
		_map: {},
		_containsPoint: () => true,
		getBounds: () => ({ contains: () => true }),
		_regionEntry: { source: "political_territory", geometryPublicId: id, name },
	};
}
const irakema = flaeche("geo-irakema", "Irakema");
const regengebirge = flaeche("geo-regengebirge", "Stämme des Regengebirges");
context.regionPolygons = [irakema, regengebirge];

const punkt = { lat: 500, lng: 500 };
const nameVon = (auswahl) => auswahl?.layer?._regionEntry?.name || "(keine)";

function linksklick(p = punkt) { return context.resolveOverlappingRegionLayerSelection(p, irakema); }
function rechtsklick(p = punkt) { return context.resolveOverlappingRegionLayerSelection(p, irakema, { advance: false }); }

// ---- Der gemeldete Ablauf ----------------------------------------------------------------------
context.recentRegionOverlapSelection = null;
const ersteWahl = linksklick();
pruefe(ersteWahl.total === 2, "beide Flaechen liegen unter dem Klick");
pruefe(ersteWahl.index === 0, "der erste Klick nimmt die oberste");

// 💣 Der Kern: der Rechtsklick unmittelbar danach muss DIESELBE Flaeche liefern.
const menue = rechtsklick();
pruefe(menue.index === 0, "der Rechtsklick schaltet NICHT weiter -- Fall #73");
pruefe(nameVon(menue) === nameVon(ersteWahl),
	`Kontextmenue gehoert derselben Flaeche wie die Auswahl (war: ${nameVon(ersteWahl)}, wurde: ${nameVon(menue)})`);

// ---- Durchschalten bleibt erhalten -------------------------------------------------------------
const zweiteWahl = linksklick();
pruefe(zweiteWahl.index === 1, "der naechste Linksklick schaltet weiter");
pruefe(nameVon(zweiteWahl) !== nameVon(ersteWahl), "und landet auf der anderen Flaeche");

const menue2 = rechtsklick();
pruefe(menue2.index === 1, "der Rechtsklick folgt der neuen Auswahl");
pruefe(nameVon(menue2) === nameVon(zweiteWahl), "und oeffnet sie, nicht die erste");

// ⚠️ Zwei Rechtsklicks hintereinander bleiben stehen -- sonst waere der Fehler nur verschoben.
pruefe(rechtsklick().index === 1, "auch der zweite Rechtsklick bleibt stehen");
pruefe(rechtsklick().index === 1, "und der dritte");

// Und der Linksklick zaehlt danach normal weiter (der Rechtsklick hat den Zaehler nicht verloren).
pruefe(linksklick().index === 0, "nach zwei Flaechen ist wieder die erste dran (Ringschluss)");

// ---- Ohne vorherige Auswahl ---------------------------------------------------------------------
context.recentRegionOverlapSelection = null;
pruefe(rechtsklick().index === 0, "ein Rechtsklick ohne vorherige Auswahl nimmt die oberste");

// ---- Die zwei Fenster, die das Ganze "sporadisch" aussehen liessen -------------------------------
context.recentRegionOverlapSelection = null;
linksklick();
jetzt += 3001;                                   // laenger als REGION_OVERLAP_SELECTION_TIMEOUT_MS
pruefe(linksklick().index === 0, "nach dem Zeitfenster faengt das Durchschalten von vorn an");

context.recentRegionOverlapSelection = null;
jetzt = 1000;
linksklick();
pruefe(linksklick({ lat: 500, lng: 519 }).index === 0, "und weiter als 18 Pixel weg ebenfalls");

// ---- Eine einzelne Flaeche schaltet gar nicht durch ----------------------------------------------
context.regionPolygons = [irakema];
context.recentRegionOverlapSelection = null;
const einzeln = linksklick();
pruefe(einzeln.total === 1 && einzeln.index === 0, "eine Flaeche allein: kein Durchschalten");
pruefe(rechtsklick().index === 0, "und der Rechtsklick trifft sie");

if (fehler > 0) { console.error(`${fehler} Zusicherung(en) rot.`); process.exit(1); }
console.log("region-overlap-rechtsklick: alle Zusicherungen gruen.");
