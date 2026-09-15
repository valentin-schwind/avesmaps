// ⇅ „Route umkehren" und 🗑 „Route löschen" neben „Ziel hinzufügen".
// ===================================================================
// Owner 15.09.2026: „eingetragene Wegpunkte sollen einfach ihre sortierung umdrehen … nur aktiv wenn
// >= 2 Wegpunkte" und „alle entfernt … nur aktiv wenn >= 1 wegpunkte"; „Ziel hinzufügen soll genau
// unter dem Textfeld ‚Suche Ort' stehen".
//
// Was hier AUSGEFUEHRT wird, nicht gelesen:
//   - die Regel (ausgefuellte Wegpunkte zaehlen, leere Zeilen nicht)
//   - das Umkehren -- es verschiebt ZEILEN, damit ein Kartenpunkt seine waypointId behaelt
//   - das Loeschen -- zurueck auf eine leere Zeile, dann Neurechnen
//   - jede Stelle, die den Abgleich ruft, und die Verdrahtung beim Start
// Was hier gelesen wird: Markup, i18n-Schluessel und das geteilte Raster im CSS.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/wegpunkte-umkehren-loeschen.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const WURZEL = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF (AGENTS.md §9).
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), "utf8").replace(/\r\n/g, "\n");

function schneide(quelle, name, datei) {
	const start = quelle.search(new RegExp(`^function ${name}\\b`, "m"));
	assert.notStrictEqual(start, -1, `${name} fehlt in ${datei}`);
	const kopf = quelle.slice(start, quelle.indexOf("\n", start));
	let tiefe = 0;
	for (let i = start + kopf.lastIndexOf("{"); i < quelle.length; i += 1) {
		if (quelle[i] === "{") tiefe += 1;
		else if (quelle[i] === "}" && (tiefe -= 1) === 0) {
			return quelle.slice(start, i + 1);
		}
	}
	throw new Error(`unausgeglichene Klammern in ${name} (${datei})`);
}

const WEGPUNKTE = "js/map-features/map-features-waypoints.js";
const wegpunkte = lies(WEGPUNKTE);
// Die Autovervollstaendigung samt replace-/clearWaypointLocationName steht seit 75220d48c in einer eigenen
// Datei (Paket P-017) -- der Abgleich in clearWaypointLocationName wird dort ausgeschnitten.
const AUTOVERVOLLSTAENDIGUNG = "js/map-features/map-features-waypoints-autocomplete.js";
const autovervollstaendigung = lies(AUTOVERVOLLSTAENDIGUNG);

// Baut eine Funktion aus dem echten Quelltext; `umgebung` stellt die Nachbarn, die sie ruft.
function baue(namen, ziel, umgebung, quelle = wegpunkte, datei = WEGPUNKTE) {
	const schluessel = Object.keys(umgebung);
	return new Function("umgebung", [
		schluessel.length ? `const { ${schluessel.join(", ")} } = umgebung;` : "",
		...namen.map((n) => schneide(quelle, n, datei)),
		`return ${ziel};`,
	].join("\n"))(umgebung);
}

const zaehler = () => {
	const f = (...args) => { f.aufrufe.push(args); };
	f.aufrufe = [];
	return f;
};

// ---- 1. Die Regel: ausgefuellte Wegpunkte, ab 2 umkehren, ab 1 loeschen ---------------------------
{
	const regel = baue(["waypointListActionState"], "waypointListActionState", {});
	const als = (n) => ({ ...regel(n) });
	assert.deepStrictEqual(als(0), { canReverse: false, canClear: false }, "leer: beide aus");
	assert.deepStrictEqual(als(1), { canReverse: false, canClear: true }, "ein Wegpunkt: nur loeschen");
	assert.deepStrictEqual(als(2), { canReverse: true, canClear: true }, "zwei: beide an");
	assert.deepStrictEqual(als(7), { canReverse: true, canClear: true }, "sieben: beide an");
	assert.deepStrictEqual(als(undefined), { canReverse: false, canClear: false }, "Unsinn zaehlt als 0");
	assert.deepStrictEqual(als(-3), { canReverse: false, canClear: false }, "negativ zaehlt als 0");
}

// ---- 2. Die neue Reihenfolge: belegte gedreht, leere dahinter, dieselben ZEILEN -----------------
const zeile = (wert, id) => ({ wert, id });
const KARTENPUNKT = "Kartenpunkt (512,3, 480,1)";
{
	const ordnung = baue(["reversedWaypointRowOrder"], "reversedWaypointRowOrder", {});
	const gareth = zeile("Gareth", "a");
	const leer1 = zeile("", "b");
	const punin = zeile("Punin", "c");
	const punkt = zeile(KARTENPUNKT, "d");
	const leer2 = zeile("  ", "e");
	const ergebnis = ordnung([gareth, leer1, punin, punkt, leer2], (z) => Boolean(z.wert.trim()));
	assert.deepStrictEqual(ergebnis.map((z) => z.id), ["d", "c", "a", "b", "e"],
		"belegte Zeilen gedreht, leere in ihrer Reihenfolge dahinter");
	assert.strictEqual(ergebnis[0], punkt,
		"der Kartenpunkt ist DIESELBE Zeile -- sonst waere seine waypointId gegen die Beschriftung vertauscht");
}

// ---- 3. Umkehren fuehrt aus: Riegel, Verschieben, Sortierer auffrischen, Neurechnen -------------
function umkehrUmgebung(zeilen) {
	const protokoll = [];
	const umgebung = {
		getWaypointInputValues: () => zeilen.map((z) => z.wert.trim()).filter(Boolean),
		getWaypointContainers: () => ({ get: () => zeilen.slice() }),
		isWaypointRowFilled: (z) => Boolean(z.wert.trim()),
		$: (sel) => ({ append: (x) => protokoll.push(["append", sel, x]) }),
		refreshWaypointSorting: () => protokoll.push(["sortierer"]),
		updateMapView: () => protokoll.push(["route"]),
	};
	return {
		protokoll,
		umkehren: baue(["waypointListActionState", "reversedWaypointRowOrder", "reverseWaypoints"],
			"reverseWaypoints", umgebung),
	};
}
{
	const { protokoll, umkehren } = umkehrUmgebung([zeile("Gareth", "a"), zeile("", "b")]);
	assert.strictEqual(umkehren(), false, "ein Wegpunkt: nichts umzukehren");
	assert.deepStrictEqual(protokoll, [], "…und dann wird weder verschoben noch gerechnet");
}
{
	const zeilen = [zeile("Gareth", "a"), zeile(KARTENPUNKT, "b"), zeile("Punin", "c"), zeile("", "d")];
	const { protokoll, umkehren } = umkehrUmgebung(zeilen);
	assert.strictEqual(umkehren(), true);
	assert.strictEqual(protokoll.length, 3, "verschieben, Sortierer, Neurechnen: " + JSON.stringify(protokoll));
	assert.strictEqual(protokoll[0][0], "append");
	assert.strictEqual(protokoll[0][1], "#waypoints", "verschoben wird in die Wegpunktliste");
	assert.deepStrictEqual(protokoll[0][2].map((z) => z.id), ["c", "b", "a", "d"]);
	assert.ok(protokoll[0][2].every((z, i) => z === zeilen.find((o) => o.id === z.id)),
		"es sind die vorhandenen Zeilen, keine neu gebauten");
	assert.deepStrictEqual(protokoll.slice(1), [["sortierer"], ["route"]],
		"danach Sortierer auffrischen und neu rechnen -- in dieser Reihenfolge");
}

// ---- 4. Loeschen fuehrt aus: Riegel, eine leere Zeile, Neurechnen --------------------------------
function loeschUmgebung(werte) {
	const protokoll = [];
	const umgebung = {
		getWaypointInputValues: () => werte,
		resetWaypointInputs: (...args) => protokoll.push(["zuruecksetzen", args.length]),
		updateMapView: () => protokoll.push(["route"]),
	};
	return {
		protokoll,
		loeschen: baue(["waypointListActionState", "clearWaypoints"], "clearWaypoints", umgebung),
	};
}
{
	const { protokoll, loeschen } = loeschUmgebung([]);
	assert.strictEqual(loeschen(), false, "leer: nichts zu loeschen");
	assert.deepStrictEqual(protokoll, []);
}
{
	const { protokoll, loeschen } = loeschUmgebung(["Gareth"]);
	assert.strictEqual(loeschen(), true, "ein Wegpunkt genuegt zum Loeschen");
	assert.deepStrictEqual(protokoll, [["zuruecksetzen", 0], ["route"]],
		"zurueck auf den Startzustand (resetWaypointInputs OHNE Namen = eine leere Zeile), dann neu rechnen");
}

// ---- 5. Der Abgleich schaltet beide Knoepfe ------------------------------------------------------
{
	const knoepfe = { reverseRouteButton: { disabled: null }, clearRouteButton: { disabled: null } };
	let werte = [];
	const abgleich = baue(["waypointListActionState", "syncWaypointListActions"], "syncWaypointListActions", {
		getWaypointInputValues: () => werte,
		document: { getElementById: (id) => knoepfe[id] || null },
	});
	abgleich();
	assert.deepStrictEqual([knoepfe.reverseRouteButton.disabled, knoepfe.clearRouteButton.disabled], [true, true]);
	werte = ["Gareth"];
	abgleich();
	assert.deepStrictEqual([knoepfe.reverseRouteButton.disabled, knoepfe.clearRouteButton.disabled], [true, false]);
	werte = ["Gareth", "Punin"];
	abgleich();
	assert.deepStrictEqual([knoepfe.reverseRouteButton.disabled, knoepfe.clearRouteButton.disabled], [false, false]);
}

// ---- 6. Jede Stelle, die einen Wert ohne Zeilenwechsel setzt, gleicht selbst ab ------------------
// 💣 Der Zeilen-Beobachter sieht nur `childList`, der `input`-Zuhoerer nur Tippen. Wer programmatisch
//    einen Wert setzt und nicht neu rechnet, liesse die Knoepfe im alten Zustand stehen.
{
	// removeWaypointElement: die letzte Zeile wird nur GELEERT.
	const sync = zaehler();
	const entferne = baue(["removeWaypointElement"], "removeWaypointElement", {
		getWaypointContainers: () => ({ length: 1 }),
		refreshWaypointSorting: () => {},
		updateMapView: () => {},
		syncPlannerStateToUrl: () => {},
		syncWaypointListActions: sync,
	});
	const feld = { val: zaehler() };
	entferne({ length: 1, find: () => feld, remove: () => {} }, { updateRoute: false });
	assert.deepStrictEqual(feld.val.aufrufe, [[""]], "die letzte Zeile wird geleert");
	assert.strictEqual(sync.aufrufe.length, 1, "removeWaypointElement gleicht ab");
}
{
	// fillLastEmptyWaypointOrAppend: eine vorhandene leere Zeile wird gefuellt.
	const sync = zaehler();
	const anhaengen = zaehler();
	const feld = { length: 1, val: zaehler() };
	const fuelle = baue(["fillLastEmptyWaypointOrAppend"], "fillLastEmptyWaypointOrAppend", {
		$: () => ({ length: 0 }),
		getWaypointInputValues: () => ["Gareth"],
		getLastEmptyWaypointInput: () => feld,
		appendWaypointInput: anhaengen,
		syncWaypointListActions: sync,
	});
	fuelle("Punin");
	assert.deepStrictEqual(feld.val.aufrufe, [["Punin"]]);
	assert.strictEqual(anhaengen.aufrufe.length, 0, "gefuellt, nicht angehaengt");
	assert.strictEqual(sync.aufrufe.length, 1, "fillLastEmptyWaypointOrAppend gleicht ab");
}
{
	// clearWaypointLocationName: ein geloeschter Ort leert seine Zeile.
	const baueLeerer = (eingaben, sync) => baue(["clearWaypointLocationName"], "clearWaypointLocationName", {
		$: (x) => (typeof x === "string"
			? { each: (cb) => eingaben.forEach((el) => cb.call(el)) }
			: { val: (v) => (v === undefined ? x.wert : (x.wert = v)) }),
		normalizeLocationSearchName: (s) => String(s || "").trim().toLowerCase(),
		syncWaypointListActions: sync,
	}, autovervollstaendigung, AUTOVERVOLLSTAENDIGUNG);
	const sync = zaehler();
	const eingaben = [{ wert: "Gareth" }, { wert: "Punin" }];
	assert.strictEqual(baueLeerer(eingaben, sync)("gareth"), true);
	assert.strictEqual(eingaben[0].wert, "");
	assert.strictEqual(sync.aufrufe.length, 1, "clearWaypointLocationName gleicht ab, wenn es etwas geleert hat");
	const still = zaehler();
	assert.strictEqual(baueLeerer([{ wert: "Punin" }], still)("Gareth"), false);
	assert.strictEqual(still.aufrufe.length, 0, "…und nicht, wenn nichts passiert ist");
}

// ---- 7. Der Trichter des Neurechnens gleicht ab --------------------------------------------------
{
	const render = lies("js/routing/route-render.js");
	const sync = zaehler();
	new Function("umgebung", [
		"const { removeHighlightedRouteNodes, applyActiveRouteWaypointMarkers, applyActiveWaypointRow, syncWaypointListActions } = umgebung;",
		"const selectedLocations = [];",
		schneide(render, "renderRouteWaypointMarkers", "route-render.js"),
		"renderRouteWaypointMarkers();",
	].join("\n"))({
		removeHighlightedRouteNodes: () => {},
		applyActiveRouteWaypointMarkers: () => {},
		applyActiveWaypointRow: () => {},
		syncWaypointListActions: sync,
	});
	assert.strictEqual(sync.aufrufe.length, 1,
		"renderRouteWaypointMarkers gleicht ab -- dort laufen Autocomplete, „Hierher reisen“ und geteilte Links durch");
}

// ---- 8. Die Verdrahtung beim Start fuehrt aus ----------------------------------------------------
{
	const beobachtet = [];
	const zuhoerer = [];
	const klicks = {};
	const sync = zaehler();
	const umkehren = zaehler();
	const loeschen = zaehler();
	const liste = { addEventListener: (typ, fn) => zuhoerer.push([typ, fn]) };
	const init = baue(["initializeWaypointListActions"], "initializeWaypointListActions", {
		document: { getElementById: (id) => (id === "waypoints" ? liste : null) },
		MutationObserver: class {
			constructor(fn) { this.fn = fn; }
			observe(ziel, optionen) { beobachtet.push([ziel, optionen, this.fn]); }
		},
		$: (sel) => {
			const obj = { off: () => obj, on: (typ, fn) => { klicks[sel] = [typ, fn]; return obj; } };
			return obj;
		},
		syncWaypointListActions: sync,
		reverseWaypoints: umkehren,
		clearWaypoints: loeschen,
	});
	init();
	init();
	assert.strictEqual(beobachtet.length, 1, "ein zweiter Aufruf meldet nichts doppelt an");
	assert.strictEqual(beobachtet[0][0], liste, "beobachtet wird die Wegpunktliste");
	assert.deepStrictEqual({ ...beobachtet[0][1] }, { childList: true }, "…auf Zeilen, die kommen und gehen");
	assert.deepStrictEqual(zuhoerer.map(([t]) => t), ["input"], "und aufs Tippen");
	assert.strictEqual(sync.aufrufe.length, 1, "Startzustand wird sofort abgeglichen");
	beobachtet[0][2]();
	zuhoerer[0][1]();
	assert.strictEqual(sync.aufrufe.length, 3, "Beobachter und Tippen rufen den Abgleich");
	const ereignis = { preventDefault: zaehler() };
	assert.strictEqual(klicks["#reverseRouteButton"][0], "click");
	assert.strictEqual(klicks["#clearRouteButton"][0], "click");
	klicks["#reverseRouteButton"][1](ereignis);
	klicks["#clearRouteButton"][1](ereignis);
	assert.strictEqual(umkehren.aufrufe.length, 1, "⇅ kehrt um");
	assert.strictEqual(loeschen.aufrufe.length, 1, "🗑 loescht");
}
{
	const routing = lies("js/routing/routing.js").split("\n").filter((z) => !/^\s*\/\//.test(z)).join("\n");
	assert.ok(/initializeWaypointListActions\(\);\s*\n\s*resetWaypointInputs\(\);/.test(routing),
		"routing.js verdrahtet die Knoepfe direkt VOR dem ersten Aufbau der Liste");
}

// ---- 9. Markup: drei Knoepfe in einer Zeile, Symbolknoepfe starten aus ---------------------------
{
	const html = lies("index.html");
	const i18n = lies("js/app/i18n-en.js");
	const start = html.indexOf('<div class="input-options">');
	assert.notStrictEqual(start, -1, "die Zeile mit „Ziel hinzufügen“ steht in index.html");
	const block = html.slice(start, html.indexOf("</div>", start));
	const ids = Array.from(block.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)).map((m) => m[1]);
	assert.deepStrictEqual(ids, ["reverseRouteButton", "inputLocation", "clearRouteButton"],
		"⇅ links, „Ziel hinzufügen“ in der Mitte, 🗑 rechts");
	[["reverseRouteButton", "Route umkehren"], ["clearRouteButton", "Route löschen"]].forEach(([id, text]) => {
		const tag = (block.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>`)) || [""])[0];
		assert.ok(/\btype="button"/.test(tag), id + ": type=button");
		assert.ok(/\sdisabled(?=[\s>])/.test(tag), id + ": startet disabled -- vor dem Laden gibt es keine Wegpunkte");
		assert.ok(/\bclass="planner-route-action"/.test(tag), id + ": traegt die Klasse der Symbolknoepfe");
		assert.ok(tag.includes(`aria-label="${text}"`) && tag.includes(`title="${text}"`),
			id + ": Screenreader-Text und Tooltip „" + text + "“");
		const schluessel = (tag.match(/data-i18n-title="([^"]+)"/) || [])[1];
		assert.ok(schluessel && i18n.includes(`"${schluessel}":`), id + ": englischer Text zu " + schluessel);
		assert.ok(tag.includes(`data-i18n-aria-label="${schluessel}"`), id + ": auch aria-label wird uebersetzt");
	});
}

// ---- 10. CSS: EIN Raster fuer beide Zeilen, jede Spalte an ihrem Platz ---------------------------
const ohneKommentare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const regeln = (css) => Array.from(ohneKommentare(css).matchAll(/([^{}]+)\{([^}]*)\}/g))
	.map((m) => ({ sel: m[1].trim(), rumpf: m[2] }));
const wert = (rumpf, eigenschaft) => ((rumpf.match(new RegExp(`(?:^|;)\\s*${eigenschaft}:\\s*([^;]+)`)) || [])[1] || "").trim();
{
	const rs = regeln(lies("css/features/route-planner-waypoint-timeline.css"));

	const definition = rs.filter((r) => /--waypoint-row-columns\s*:/.test(r.rumpf));
	assert.strictEqual(definition.length, 1, "die Spalten stehen an EINER Stelle");
	assert.strictEqual(definition[0].sel, "#search", "…am gemeinsamen Vorfahren beider Zeilen");

	const wegpunktzeilen = rs.filter((r) => r.sel === "#waypoints .waypoint-container" && wert(r.rumpf, "grid-template-columns"));
	assert.ok(wegpunktzeilen.length >= 1);
	wegpunktzeilen.forEach((r) => assert.ok(wert(r.rumpf, "grid-template-columns").startsWith("var(--waypoint-row-columns)"),
		"jede Spaltenregel der Wegpunktzeile liest die Variable: " + wert(r.rumpf, "grid-template-columns")));

	const knopfzeile = rs.filter((r) => r.sel === "#search .input-options" && wert(r.rumpf, "grid-template-columns"));
	assert.strictEqual(knopfzeile.length, 1);
	assert.ok(wert(knopfzeile[0].rumpf, "grid-template-columns").startsWith("var(--waypoint-row-columns)"),
		"die Knopfzeile liest DIESELBE Variable");
	assert.strictEqual(wert(knopfzeile[0].rumpf, "column-gap"), "var(--waypoint-row-gap)");
	const wegpunktLuecke = rs.filter((r) => r.sel === "#waypoints .waypoint-container" && wert(r.rumpf, "column-gap"));
	wegpunktLuecke.forEach((r) => assert.strictEqual(wert(r.rumpf, "column-gap"), "var(--waypoint-row-gap)",
		"die Spaltenluecke ist in beiden Zeilen dieselbe"));

	// 💣 JEDE Regel, die eine Spalte setzt -- die spaetere gewinnt, eine vergessene zweite waere die gueltige.
	const spalte = (id, erwartet) => {
		const treffer = rs.filter((r) => r.sel === `#search .input-options #${id}` && wert(r.rumpf, "grid-column"));
		assert.ok(treffer.length >= 1, id + " hat eine Spalte");
		treffer.forEach((r) => assert.strictEqual(wert(r.rumpf, "grid-column"), erwartet,
			`${id} steht in Spalte ${erwartet} (gefunden: ${wert(r.rumpf, "grid-column")})`));
	};
	spalte("inputLocation", "3");
	spalte("reverseRouteButton", "2");
	spalte("clearRouteButton", "4");
}
{
	const rs = regeln(lies("css/features/route-planner.css"));
	const gefuellt = rs.flatMap((r) => r.sel.split(",").map((s) => s.trim()))
		.filter((s) => /\.input-options button/.test(s));
	assert.ok(gefuellt.length >= 2, "die gefuellte Knopfregel und ihr Hover stehen noch da");
	gefuellt.forEach((s) => assert.ok(s.includes(":not(.planner-route-action)"),
		"die gefuellte Hauptknopf-Regel nimmt ⇅ und 🗑 aus: " + s));

	const form = rs.find((r) => r.sel.split(",").map((s) => s.trim()).includes(".planner-route-action")
		&& /\bwidth:\s*24px/.test(r.rumpf));
	assert.ok(form && form.sel.includes(".remove-waypoint"), "⇅ und 🗑 teilen die Regel des ✕");

	// 🪤 Nur Selektoren, deren SUBJEKT der Symbolknopf ist -- `:not(.planner-route-action)` an der gefuellten
	//    Regel nennt die Klasse ebenfalls und meint das Gegenteil.
	const symbolHover = /(?<!\()\.planner-route-action[^,\s]*:hover/;
	const hover = rs.flatMap((r) => r.sel.split(",").map((s) => s.trim())).filter((s) => symbolHover.test(s));
	assert.ok(hover.length >= 1, "⇅ und 🗑 haben eine Hellung");
	hover.forEach((s) => assert.ok(s.includes(":not(:disabled)"), "keine Hellung auf einem ausgegrauten Knopf: " + s));

	const aus = rs.find((r) => r.sel === ".planner-route-action:disabled");
	assert.ok(aus, "ausgegraut hat eine eigene Regel");
	assert.strictEqual(wert(aus.rumpf, "color"), "var(--color-disabled-text)", "…mit dem Token, keiner Zahl");
}

console.log("OK -- ⇅ und 🗑 folgen der Zahl der ausgefuellten Wegpunkte, verschieben Zeilen statt Werte, "
	+ "und stehen im Raster der Wegpunktzeile.");
