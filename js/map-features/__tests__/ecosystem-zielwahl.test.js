// Die Zielwahl der Zwei-Flächen-Gesten („Mit anderer vereinigen", „… ausschneiden" & Co.) --
// Owner 09.10.2026, nach der Discord-Meldung zu Fläche-058 an den Windhagbergen:
//   „er soll sich mit dem vereinigen oder das abziehen, das […] markiert wurde"
//   „bei der auswahl immer in der ebene bleiben, die man gerade betreibt. ein wechsel auf vegetation
//    oder alles zeigt alles an und erlaubt dann vereinigungen damit"
//   „kannst du dem richtig gelb geben, die linien deutlich dünner machen, die gelbe kontur, deren
//    fläche übernommen werden soll, nicht transparent machen"
//
// ⭐ AUSGEFÜHRT, NICHT GELESEN. Der Fehler war keiner, den ein Regex sieht: Überfahren und Klick nahmen
// je für sich das oberste SVG-Element, und an einer gemeinsamen Küste war das die derographische Region
// statt des Meeres. Deshalb fährt dieser Test die ECHTE map-features-ecosystem-geometry-ops.js samt
// der echten Rechnung (polygon-clipping) in einem vm-Kontext: Menüeintrag -> Maus bewegen -> klicken,
// und prüft, was an den Schreibkanal ginge.
//
// Die Fixture bildet die zwei gemeldeten Fälle nach (Masse in Karteneinheiten, Zoom 4 = 16 px je
// Einheit, die Reichweite von 6 px sind also 0,375 Einheiten):
//   * Küste: „Meer" (Topographie) und „Windhag" (Derographie) teilen die Linie x = 3;
//     „Fläche-058" (Topographie) ragt von x = 1 bis 10 ins Meer hinein.
//   * Hang: „Windhagberge" (Topographie) und „Hangwald" (Vegetation) teilen die Linie x = 20.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ecosystem-zielwahl.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(wurzel, ...teile), "utf8");
let pruefungen = 0;
const pruefe = (bedingung, text) => { pruefungen++; assert.ok(bedingung, text); };

const rechteck = (x1, y1, x2, y2) => ({
	type: "Polygon",
	coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]],
});
const kasten = (g) => {
	const xs = g.coordinates[0].map((p) => p[0]);
	const ys = g.coordinates[0].map((p) => p[1]);
	return { min_x: Math.min(...xs), min_y: Math.min(...ys), max_x: Math.max(...xs), max_y: Math.max(...ys) };
};

// ---- A. Die reine Regel -------------------------------------------------------------------------
{
	const kontext = { console };
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext(lies("js/map-features/map-features-ecosystem-geometry.js"), kontext);
	vm.runInContext(lies("js/map-features/map-features-ecosystem-boolean.js"), kontext);
	const waehle = kontext.ecosystemBooleanZielWaehlen;

	const meer = { publicId: "meer", kind: "topographie", geometry: rechteck(-20, -20, 3, 30) };
	const region = { publicId: "windhag", kind: "derographisch", geometry: rechteck(3, -20, 30, 30) };
	const optionen = { toleranz: 0.375, gleichstand: 0.03, quelleKind: "topographie" };

	pruefe(waehle([region, meer], { x: 3, y: 5 }, optionen) === "meer",
		"💣 DER GEMELDETE FALL: auf derselben Küstenlinie gewinnt die Fläche der EIGENEN Ebene, nicht die"
		+ " derographische Region -- auch wenn diese in der Liste zuerst steht");
	pruefe(waehle([meer, region], { x: 3, y: 5 }, { ...optionen, quelleKind: "derographisch" }) === "windhag",
		"und andersherum: wer aus der Derographie kommt, bekommt die Region");
	// Eine Region, deren Kante 0,3 neben der Küste liegt: zwei Linien in Reichweite, verschieden weit weg.
	const nachbar = { publicId: "nachbar", kind: "derographisch", geometry: rechteck(3.3, -20, 30, 30) };
	pruefe(waehle([meer, nachbar], { x: 3.25, y: 5 }, optionen) === "nachbar",
		"⭐ liegt eine Linie WIRKLICH näher am Zeiger, gewinnt sie -- die eigene Ebene entscheidet nur Gleichstände");
	pruefe(waehle([meer, nachbar], { x: 3.05, y: 5 }, optionen) === "meer",
		"und umgekehrt: näher an der Küste ist das Meer gemeint");
	pruefe(waehle([region, meer], { x: 3.5, y: 5 }, optionen) === "",
		"weiter als die Reichweite von jedem Rand: kein Ziel -- die Füllung allein trifft nicht (Bug #69)");
	pruefe(waehle([meer], { x: 3.3, y: 5 }, { ...optionen, zulassen: () => false }) === "",
		"was der Aufrufer nicht zulässt (ausgeblendet, gesperrt), ist kein Ziel");

	const unten = { publicId: "unten", kind: "topographie", geometry: rechteck(0, 0, 10, 10) };
	const oben = { publicId: "oben", kind: "topographie", geometry: rechteck(10, 0, 20, 10) };
	const rang = (k) => (k.publicId === "oben" ? 2 : 1);
	pruefe(waehle([oben, unten], { x: 10, y: 5 }, { ...optionen, rang }) === "oben"
		&& waehle([unten, oben], { x: 10, y: 5 }, { ...optionen, rang }) === "oben",
		"gleiche Ebene, gleiche Linie: die oben gezeichnete -- unabhängig von der Reihenfolge der Liste");

	let rangGefragt = 0;
	waehle([unten, oben], { x: 0.1, y: 5 }, { ...optionen, rang: () => { rangGefragt++; return 0; } });
	pruefe(rangGefragt === 0, "der Stapelplatz (DOM) wird nur bei einem Gleichstand gefragt, nicht bei jeder Mausbewegung");

	let zugelassen = 0;
	waehle([unten, oben], { x: 500, y: 500 }, { ...optionen, zulassen: () => { zugelassen++; return true; } });
	pruefe(zugelassen === 0, "der Kastentest kommt vor `zulassen` -- getComputedStyle nur für Flächen in Reichweite");
}

// ---- B. Der echte Ablauf --------------------------------------------------------------------------
function baueWelt({ aktiveEbene = "topographie", alle = false } = {}) {
	const flaechen = {
		f058: { public_id: "f058", region_name: "Fläche-058", kind: "topographie", geometry: rechteck(1, 0, 10, 10), geometry_revision: 30 },
		meer: { public_id: "meer", region_name: "Meer der Sieben Winde", kind: "topographie", geometry: rechteck(-20, -20, 3, 30), geometry_revision: 1033 },
		windhag: { public_id: "windhag", region_name: "Windhag", kind: "derographisch", geometry: rechteck(3, -20, 30, 30), geometry_revision: 1 },
		berge: { public_id: "berge", region_name: "Windhagberge", kind: "topographie", geometry: rechteck(12, 0, 20, 10), geometry_revision: 232 },
		hangwald: { public_id: "hangwald", region_name: "Westlicher Hangwald", kind: "vegetation", geometry: rechteck(20, 0, 26, 10), geometry_revision: 28 },
		klima: { public_id: "klima", region_name: "Gemässigte Zone", kind: "klima", geometry: rechteck(-50, -50, 50, 50), geometry_revision: 1 },
	};
	Object.values(flaechen).forEach((f) => { f.bounds = kasten(f.geometry); });

	const zIndex = { derographisch: "252", vegetation: "251", topographie: "250", klima: "253" };
	const panes = {};
	Object.keys(zIndex).forEach((kind) => {
		panes[kind] = { _z: zIndex[kind], children: [], classList: { toggle() {} } };
	});
	const tooltips = [];
	const ebenen = new Map();
	Object.values(flaechen).forEach((area) => {
		const pane = panes[area.kind];
		const pfad = {
			isConnected: true,
			style: {},
			parentNode: pane,
			closest: () => pane,
		};
		pane.children.push(pfad);
		ebenen.set(area.public_id, {
			_ecosystemArea: area,
			_path: pfad,
			getElement: () => pfad,
			openTooltip: () => tooltips.push(area.public_id),
			closeTooltip: () => {},
		});
	});

	const karte = {
		handler: {},
		overlays: [],
		on(typ, fn) { (this.handler[typ] = this.handler[typ] || []).push(fn); },
		off(typ, fn) { this.handler[typ] = (this.handler[typ] || []).filter((h) => h !== fn); },
		feuere(typ, ereignis) { (this.handler[typ] || []).slice().forEach((h) => h(ereignis)); },
		latLngToContainerPoint: ([lat, lng]) => ({ x: lng * 16, y: -lat * 16 }),
		removeLayer(layer) { this.overlays = this.overlays.filter((l) => l !== layer); },
		getContainer: () => behaelter,
	};
	const behaelterKlassen = new Set();
	const behaelter = {
		classList: {
			toggle: (k, an) => (an ? behaelterKlassen.add(k) : behaelterKlassen.delete(k)),
			remove: (k) => behaelterKlassen.delete(k),
		},
	};

	const eintraege = {};
	const toasts = [];
	const gesendet = [];
	const kontext = {
		console,
		Map, Set, Promise, Number, String, Boolean, Array, Object, Math, JSON, Error,
		setTimeout, clearTimeout,
		requestAnimationFrame: (fn) => { fn(); return 0; },
		cancelAnimationFrame: () => {},
		getComputedStyle: (el) => ({ display: el.style?.display || "block", zIndex: el._z || "0" }),
		document: {
			readyState: "complete",
			addEventListener() {},
			querySelectorAll: () => [],
			querySelector: () => null,
		},
		map: karte,
		L: {
			polygon(latlngs, options) {
				return { latlngs, options, addTo(m) { m.overlays.push(this); return this; } };
			},
			DomEvent: { stop() {}, stopPropagation() {} },
		},
		ecosystemLayers: ebenen,
		ecosystemAreaLatLngs: (g) => g.coordinates.map((ring) => ring.map(([x, y]) => [y, x])),
		closeAllEcosystemAreaTooltips() {},
		isEcosystemKindVisible: (kind) => (alle ? kind !== "klima" : kind === kontext.aktiveEbene),
		getActiveEcosystemLayerKind: () => kontext.aktiveEbene,
		aktiveEbene,
		showFeedbackToast: (text, ton) => toasts.push([text, ton]),
		withEcosystemOperation: async (label, run) => run(),
		postEcosystemEdit: async (aktion, rumpf) => {
			gesendet.push({ aktion, rumpf });
			return { ok: true };
		},
	};
	kontext.window = kontext;
	kontext.globalThis = kontext;
	kontext.polygonClipping = require(path.join(wurzel, "js/third-party/polygon-clipping.umd.min.js"));
	kontext.AvesmapsEcosystemAreaMenu = { addEntry: (e) => { eintraege[e.action] = e; } };
	vm.createContext(kontext);
	vm.runInContext(lies("js/map-features/map-features-ecosystem-geometry.js"), kontext);
	vm.runInContext(lies("js/map-features/map-features-ecosystem-boolean.js"), kontext);
	vm.runInContext(lies("js/map-features/map-features-ecosystem-geometry-ops.js"), kontext);

	const punkt = (x, y) => ({ latlng: { lat: y, lng: x }, originalEvent: {} });
	return {
		kontext, karte, eintraege, toasts, gesendet, tooltips, flaechen, behaelterKlassen,
		starte: (aktion, quelle) => eintraege[aktion].onClick(quelle),
		bewege: (x, y) => karte.feuere("mousemove", punkt(x, y)),
		klicke: (x, y) => karte.feuere("click", punkt(x, y)),
		markiert: () => {
			const ov = karte.overlays.find((l) => l.options?.className === "ecosystem-zielkontur");
			if (!ov) {
				return "";
			}
			const treffer = Object.values(flaechen).find((f) =>
				JSON.stringify(kontext.ecosystemAreaLatLngs(f.geometry)) === JSON.stringify(ov.latlngs));
			return treffer ? treffer.public_id : "?";
		},
	};
}

const ruhe = () => new Promise((r) => setImmediate(r));
const flaeche = (g) => {
	const welt = baueWelt();
	return welt.kontext.ecosystemGeometryArea(g);
};

(async () => {
	// ---- B1. Fläche-058 vom Meer abziehen, in der Topographie -----------------------------------
	{
		const w = baueWelt();
		w.starte("difference-keep-target", "f058");
		pruefe(w.toasts.some(([t]) => /gelb markiert/.test(t) && /umschalten/.test(t)),
			"der Hinweis beim Start nennt die gelbe Markierung und das Umschalten der Ebene");

		w.bewege(3, 5);
		pruefe(w.markiert() === "meer",
			"💣 auf der Küste ist das MEER markiert, nicht die Region „Windhag“ (Derographie ruht in der Topographie)"
			+ ` -- markiert: ${w.markiert()}`);
		pruefe(w.tooltips.at(-1) === "meer", "der Schwebezettel nennt dieselbe Fläche wie die Markierung");
		pruefe(w.behaelterKlassen.has("ecosystem-zielwahl--treffer"), "der Zeiger zeigt, dass ein Ziel darunter liegt");

		w.klicke(3, 5);
		await ruhe(); await ruhe();
		const update = w.gesendet.find((g) => g.aktion === "update_area_geometry");
		pruefe(update && update.rumpf.public_id === "f058", "geschrieben wird die Quelle Fläche-058");
		pruefe(Math.abs(flaeche(update.rumpf.geometry_geojson) - 70) < 1e-9,
			"🔴 GENOMMEN WIRD, WAS GELB MARKIERT IST: 058 minus Meer = 7 × 10 = 70 -- nicht 058 minus Region"
			+ ` (das ergäbe 20). Ergebnis: ${flaeche(update.rumpf.geometry_geojson)}`);
		pruefe(!w.gesendet.some((g) => g.aktion === "delete_area"), "„… und andere beibehalten“ löscht nichts");
		pruefe(w.markiert() === "", "nach dem Klick ist die gelbe Linie weg");
	}

	// ---- B2. Mit Windhagberge vereinigen -- dieselbe Linie wie der Hangwald --------------------
	{
		const w = baueWelt();
		w.starte("union", "f058");
		w.bewege(20, 5);
		pruefe(w.markiert() === "berge",
			`💣 an der gemeinsamen Kante markiert die Topographie die Windhagberge, nicht den Hangwald -- markiert: ${w.markiert()}`);
		w.klicke(20, 5);
		await ruhe(); await ruhe();
		pruefe(!w.toasts.some(([t]) => /nur innerhalb einer Ebene/.test(t)),
			"die Meldung „Vereinigen geht nur innerhalb einer Ebene“ kommt nicht mehr -- es wurde ja das Gebirge gewählt");
		const update = w.gesendet.find((g) => g.aktion === "update_area_geometry");
		const loeschen = w.gesendet.find((g) => g.aktion === "delete_area");
		pruefe(update && Math.abs(flaeche(update.rumpf.geometry_geojson) - 170) < 1e-9,
			"die Vereinigung umfasst Fläche-058 (90) und die Windhagberge (80) -- nicht den Hangwald (60)");
		pruefe(loeschen && loeschen.rumpf.public_id === "berge",
			"„Mit anderer vereinigen“ verbraucht genau die markierte Fläche");
	}

	// ---- B3. Ebene umschalten mitten in der Zielwahl -- dann gilt die andere Ebene -------------
	{
		const w = baueWelt();
		w.starte("union", "f058");
		w.kontext.aktiveEbene = "vegetation";
		w.bewege(20, 5);
		pruefe(w.markiert() === "hangwald", "nach dem Umschalten auf Vegetation ist der Hangwald das Ziel");
		w.klicke(20, 5);
		await ruhe(); await ruhe();
		const loeschen = w.gesendet.find((g) => g.aktion === "delete_area");
		pruefe(loeschen && loeschen.rumpf.public_id === "hangwald",
			"🔴 und die Vereinigung über die Ebene hinweg ist ERLAUBT (Owner 09.10.2026) -- keine Absage");
	}

	// ---- B4. „Alle“: alle Ebenen bieten an, bei Gleichstand gewinnt die eigene --------------------
	{
		const w = baueWelt({ alle: true });
		w.starte("difference-keep-target", "f058");
		w.bewege(3, 5);
		pruefe(w.markiert() === "meer",
			"in „Alle“ liegen Meer und Region auf derselben Küste -- es gewinnt die Ebene der Quelle (Topographie)");
		w.bewege(30, 5);
		pruefe(w.markiert() === "windhag",
			"⭐ und wer die Region meint, zeigt auf eine Kante, die nur sie hat -- auch das zeigt die Markierung vorher");
		w.klicke(30, 5);
		await ruhe(); await ruhe();
		const update = w.gesendet.find((g) => g.aktion === "update_area_geometry");
		pruefe(update && Math.abs(flaeche(update.rumpf.geometry_geojson) - 20) < 1e-9,
			"geklickt wird, was markiert war: 058 minus Windhag = 2 × 10");
	}

	// ---- B5. Was nie Ziel ist ---------------------------------------------------------------------
	{
		const w = baueWelt({ alle: true });
		w.kontext.isEcosystemKindVisible = () => true; // selbst wenn Klima sichtbar wäre
		w.starte("union", "f058");
		w.bewege(50, 0);
		pruefe(w.markiert() === "", "ein Klimaband ist nie Ziel (avesmapsClimateAssertNotDerived)");

		w.bewege(10, 5);
		pruefe(w.markiert() === "", "die Quelle ist nie ihr eigenes Ziel");
		w.klicke(10, 5);
		await ruhe();
		pruefe(w.toasts.some(([t]) => /Kein Ziel getroffen/.test(t)) && w.gesendet.length === 0,
			"ein Klick ohne Ziel sagt es -- und schreibt nichts");

		w.kontext.ecosystemLayers.get("berge")._path.style.display = "none";
		w.bewege(20, 5);
		pruefe(w.markiert() === "hangwald", "eine ausgeblendete Fläche ist kein Ziel");

		w.flaechen.hangwald.is_locked = true;
		w.bewege(20, 5);
		pruefe(w.markiert() === "", "eine gesperrte Fläche ist kein Ziel -- auch in „Alle“");
	}

	// ---- B6. Abbrechen räumt die gelbe Linie weg ---------------------------------------------------
	{
		const w = baueWelt();
		w.starte("intersection", "f058");
		w.bewege(3, 5);
		pruefe(w.markiert() === "meer", "Vorbedingung: etwas ist markiert");
		w.kontext.AvesmapsEcosystemGeometryOps.cancel({ silent: true });
		pruefe(w.markiert() === "" && !w.behaelterKlassen.has("ecosystem-zielwahl"),
			"nach dem Abbrechen bleibt keine Linie und kein Zielwahl-Zustand stehen");
		w.bewege(3, 5);
		pruefe(w.markiert() === "", "und eine weitere Mausbewegung markiert nichts mehr");
	}

	// ---- B7. Auch ein Flächenklick (falls einer durchkommt) nimmt die markierte ------------------
	{
		const w = baueWelt();
		w.starte("difference-keep-target", "f058");
		w.bewege(3, 5);
		const verbraucht = w.kontext.AvesmapsEcosystemGeometryOps.handleAreaClick("windhag", { latlng: { lat: 5, lng: 3 } });
		await ruhe(); await ruhe();
		const update = w.gesendet.find((g) => g.aktion === "update_area_geometry");
		pruefe(verbraucht && update && Math.abs(flaeche(update.rumpf.geometry_geojson) - 70) < 1e-9,
			"💣 trifft ein Klick doch eine Fläche (hier die Region), entscheidet trotzdem die Markierung (Meer)");
	}

	// ---- C. Das Blatt -------------------------------------------------------------------------------
	const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
	const css = ohneKommentare(lies("css/features/ecosystem-layer.css"));
	const tokens = ohneKommentare(lies("css/base/tokens.css"));
	const regeln = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, " "), body: m[2] }));

	const kontur = regeln.find((r) => r.sel === ".leaflet-pane > svg path.ecosystem-zielkontur");
	pruefe(kontur, "die Regel für die gelbe Zielkontur fehlt");
	pruefe(/stroke:\s*var\(--color-ecosystem-target-active\)/.test(kontur.body), "die Kontur liest ihren Ton aus dem Token");
	pruefe(/stroke-opacity:\s*1;/.test(kontur.body), "🔴 deckend (Owner: „nicht transparent“)");
	pruefe(/stroke-dasharray:\s*none;/.test(kontur.body),
		"💣 ohne Strichelung -- sonst trüge eine derographische Fläche ihre Striche in die Markierung");
	const breite = Number((kontur.body.match(/stroke-width:\s*([\d.]+)/) || [])[1]);
	pruefe(breite > 0 && breite <= 4, `🔴 dünn (Owner: „deutlich dünner“ als die alten 12px) -- steht auf ${breite}`);

	const gelb = (tokens.match(/--color-ecosystem-target-active:\s*#([0-9a-fA-F]{6})/) || [])[1];
	pruefe(gelb, "der Token --color-ecosystem-target-active fehlt");
	const [r, g, b] = [0, 2, 4].map((i) => parseInt(gelb.slice(i, i + 2), 16));
	pruefe(r > 230 && g > 200 && b < 80,
		`🔴 RICHTIG GELB (Owner: „richtig gelb“, vorher #ffab24 „braungelb“) -- steht auf #${gelb}`);
	pruefe(/--color-ecosystem-target-halo:/.test(tokens), "der dunkle Saum hat seinen Token");

	const durchlaessig = regeln.find((r) => r.sel.includes("ecosystem-pane--picking > svg path.leaflet-interactive")
		&& /pointer-events:\s*none/.test(r.body));
	pruefe(durchlaessig, "💣 während der Zielwahl nehmen die Flächen KEINEN Klick -- sonst entschiede wieder das oberste SVG-Element");
	// 💣 UND SIE MUSS GEWINNEN, nicht nur dastehen. Gezählt wird gegen JEDE Regel, die einen Flächenpfad
	// wieder anklickbar macht -- die stärkste ist die der offenen Ecken-Sitzung (vier Klassen), und gegen
	// die verlor die erste Fassung (drei), sobald eine Fläche per Doppelklick geöffnet war (Prüfagent).
	const klassen = (sel) => Math.max(...sel.split(",").map((s) => (s.match(/\.[a-zA-Z][\w-]*/g) || []).length));
	const gegner = regeln.filter((r) => /ecosystem-pane/.test(r.sel) && /path\.leaflet-interactive/.test(r.sel)
		&& /pointer-events:\s*(auto|stroke|all|visible)/.test(r.body));
	pruefe(gegner.length > 0, "es gibt keine Gegenregel mehr -- dann prüft der Vergleich darunter nichts");
	const staerkster = Math.max(...gegner.map((r) => klassen(r.sel)));
	pruefe(klassen(durchlaessig.sel) > staerkster,
		`die Zielwahl-Regel hat ${klassen(durchlaessig.sel)} Klassen, die stärkste Gegenregel ${staerkster}`
		+ ` (${gegner.find((r) => klassen(r.sel) === staerkster).sel}) -- bei Gleichstand entschiede die Reihenfolge im Blatt`);
	pruefe(/\.ecosystem-zielwahl\b/.test(durchlaessig.sel),
		"die Regel hängt an der Klasse, die setLayerPicking am Kartenrahmen setzt");
	pruefe(/container\?\.classList\.toggle\("ecosystem-zielwahl", Boolean\(on\)\)/.test(lies("js/map-features/map-features-ecosystem-geometry-ops.js")),
		"setLayerPicking setzt `ecosystem-zielwahl` am Kartenrahmen -- ohne sie greift die Regel nie");
	pruefe(!regeln.some((r) => /ecosystem-pane--resting\.ecosystem-pane--picking/.test(r.sel)),
		"🔴 die Zielwahl weckt keine ruhende Ebene mehr (Owner: „immer in der ebene bleiben“)");
	pruefe(!regeln.some((r) => /pointer-events:\s*stroke/.test(r.body) && /ecosystem-pane/.test(r.sel)),
		"das Trefferband per `pointer-events: stroke` ist weg -- getroffen wird im Skript");
	pruefe(!/--ecosystem-pick-band-width/.test(css + tokens), "der 12px-Token des alten Bandes ist weg");

	const kante = regeln.find((r) => r.sel.includes("ecosystem-pane--picking") && /--eco-contour/.test(r.body));
	pruefe(kante && kante.sel.includes(":not(.ecosystem-pane--klima)") && !kante.sel.includes("showall"),
		"die Kandidaten zeigen ihre Kante auch in „Alle“, Klima nicht");

	// ---- D. Der Schwebezettel bleibt bei der Zielwahl zugelassen (Owner 20.08.2026) ---------------
	const renderer = ohneKommentare(lies("js/map-features/map-features-ecosystem-rendering.js"));
	pruefe(renderer.includes("isPickingTarget"),
		"der Zettel-Riegel im Renderer fragt `isPickingTarget` -- sonst schweigt der Zettel bei der Zielwahl");
	pruefe(/handleAreaClick\?\.\(area\.public_id, event\)/.test(renderer),
		"der Flächenklick reicht seine Stelle mit, damit auch dieser Weg dieselbe Frage stellt");

	console.log(`ok - ecosystem-zielwahl (${pruefungen} Prüfungen)`);
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
