// Der Takt des Routenplaner-Panels — EIN Abstand, ein Token, und ein gekoppelter Leser.
// =====================================================================================
// Owner 05.09.2026, mit zwei Bildern: „die abstaende sind auch noch nicht gleich". Im Browser
// nachgemessen waren es VIER verschiedene in einer Spalte:
//   Wegpunktzeile → Wegpunktzeile          5px   (`gap` von #waypoints)
//   letzte Zeile → „Ziel hinzufuegen"     13px   (5px Sockel + 8px `gap` von #search)
//   „Ziel hinzufuegen" → Transportmittel  13px   (5px Sockel + 8px)
//   Transportmittel → Reiseoptionen        8px
//
// 🔴 DIE REGEL: den senkrechten Takt legt EIN Elternteil (`#search`, `gap`), und die Kinder legen
//    NICHTS dazu. Ein Sockel unter einem Kasten addiert sich auf den `gap` und ist von aussen
//    nicht als Sockel zu erkennen -- man sieht nur, dass „es nicht gleich ist".
//
// 💣 UND DIE WEGPUNKTLISTE HAT EINEN ZWEITEN LESER: die gestrichelte Verbindungslinie zwischen
//    zwei Wegpunkten ueberbrueckt genau diese Luecke (`bottom: calc(-1 * <gap> - 50% + 9px)` in
//    route-planner-waypoint-timeline.css). Wer den Abstand aendert und die Linie vergisst, bekommt
//    eine Linie, die vor dem naechsten Punkt endet -- oder ueber ihn hinauslaeuft. Ein Token, zwei
//    Leser; dieser Test haelt sie zusammen.
//
// 🪤 Und der Grund, warum eine Aenderung im falschen Blatt WIRKUNGSLOS ist: `#waypoints { gap }`
//    steht in ZWEI Blaettern (route-planner.css und route-planner-waypoint-timeline.css), gleiche
//    Spezifitaet -- das spaeter geladene gewinnt. Am 05.09.2026 stand im einen schon 8 und im
//    anderen noch 5, und gemessen kamen 5 an. Der Test verlangt deshalb, dass BEIDE denselben
//    Token nennen: dann ist die Ladereihenfolge egal.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/routenplaner-takt.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const WURZEL = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF (AGENTS.md §9).
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), "utf8").replace(/\r\n/g, "\n");
const ohneKommentare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const regeln = (css) => Array.from(ohneKommentare(css).matchAll(/([^{}]+)\{([^}]*)\}/g))
	.map((m) => ({ sel: m[1].trim(), rumpf: m[2] }));

const TAKT = "var(--space-6)";

// ---- 1. Der Takt steht an EINER Stelle und ist ein Token --------------------------------------
{
	const suche = ohneKommentare(lies("css/layout/map-layout.css")).match(/#search\s*\{([^}]*)\}/);
	assert.ok(suche, "#search steht in css/layout/map-layout.css");
	const gap = (suche[1].match(/(?:^|;)\s*gap:\s*([^;]+)/) || [])[1];
	assert.strictEqual((gap || "").trim(), TAKT,
		"der Takt des Panels ist " + TAKT + ", keine gegriffene Zahl: " + gap);
}

// ---- 2. Kein Kind legt sich seinen Abstand selbst dazu ----------------------------------------
// 💣 Der Sockel stand als `padding: 0 0 5px 0` unter #waypoints UND .input-options -- also genau
//    unter den zwei Kaesten, zwischen denen der Owner den Unterschied gesehen hat.
{
	["css/features/route-planner.css", "css/features/route-planner-waypoint-timeline.css"].forEach((f) => {
		regeln(lies(f))
			.filter((r) => /#waypoints|\.input-options/.test(r.sel))
			.forEach((r) => {
				const pad = (r.rumpf.match(/(?:^|;)\s*padding(?:-bottom)?:\s*([^;]+)/) || [])[1];
				if (!pad) return;
				assert.ok(!/(^|\s)0\s+0\s+\d/.test(pad.trim()) && !/^\s*[1-9]/.test(pad.trim()),
					f + ": `" + r.sel + "` legt sich mit `padding: " + pad.trim()
					+ "` einen eigenen Sockel unter den Kasten -- der addiert sich auf den `gap` von #search");
			});
	});
}

// ---- 3. Beide Blaetter nennen denselben Takt fuer die Wegpunktliste ---------------------------
// 🪤 Gleiche Spezifitaet in zwei Blaettern: das spaeter geladene gewinnt, und eine Aenderung im
//    anderen ist lautlos wirkungslos. Nur wenn beide dasselbe sagen, ist die Reihenfolge egal.
{
	const gaps = [];
	["css/features/route-planner.css", "css/features/route-planner-waypoint-timeline.css"].forEach((f) => {
		regeln(lies(f))
			.filter((r) => /^#waypoints$/.test(r.sel))
			.forEach((r) => {
				const g = (r.rumpf.match(/(?:^|;)\s*gap:\s*([^;]+)/) || [])[1];
				if (g) gaps.push({ f, g: g.trim() });
			});
	});
	assert.ok(gaps.length >= 1, "mindestens ein Blatt setzt den `gap` von #waypoints");
	gaps.forEach((x) => assert.strictEqual(x.g, TAKT,
		x.f + ": #waypoints faehrt denselben Takt wie das Panel (" + TAKT + "), gefunden: " + x.g));
}

// ---- 4. Die Punktlinie liest DENSELBEN Wert -------------------------------------------------
// 💣 Sie ueberbrueckt die Luecke des Rasters. Stand dort eine eigene Zahl (`-5px`), endete sie beim
//    naechsten Taktwechsel vor dem Punkt -- sichtbar, aber so klein, dass es niemand meldet.
{
	const linie = regeln(lies("css/features/route-planner-waypoint-timeline.css"))
		.filter((r) => /waypoint-container:not\(:last-child\)::after/.test(r.sel));
	assert.strictEqual(linie.length, 1, "genau eine Regel zeichnet den Verbinder");
	const unten = (linie[0].rumpf.match(/(?:^|;)\s*bottom:\s*([^;]+)/) || [])[1] || "";
	assert.ok(unten.includes("--space-6"),
		"der Verbinder rechnet mit demselben Token wie der `gap` -- sonst laufen sie auseinander: "
		+ unten.trim());
}

console.log("OK -- ein Takt im Routenplaner, ein Token, und die Punktlinie liest denselben.");
