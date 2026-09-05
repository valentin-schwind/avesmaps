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

// ---- 5. Die 4px ueber den zwei Rahmenkaesten: eine OPTISCHE Korrektur, an ZWEI Stellen --------
// 🔴 Das ist die Ausnahme von Abschnitt 2, und sie ist gemessen, nicht gefuehlt: die Aufschrift
//    dieser zwei Kaesten sitzt AUF der Rahmenlinie und ragt 6,92px UEBER die Oberkante hinaus.
//    Vom 8px-Takt bleiben zwischen dem Element darueber und den Buchstaben 1,08px -- Owner
//    05.09.2026: „stossen fast am item darueber an". Mit `--space-2` sind es 5,08px.
//    Der Unterschied zum Sockel aus Abschnitt 2: ein Sockel macht gleiche Abstaende ungleich,
//    diese Zahl macht ungleich AUSSEHENDE gleich.
// 💣 Sie steht an ZWEI Stellen -- an der Gruppenregel und im Aufheber des Stapelrands, der sonst
//    den ZWEITEN Kasten wieder auf 0 zieht (er ist (0,4,0) und gewinnt). Steht dort eine 0,
//    stossen die „Reiseoptionen" an die „Transportmittel" -- genau der gemeldete Fall.
{
	const rs = regeln(lies("css/features/route-planner.css"));
	const gruppe = rs.filter((r) => /#transport-options,\s*\.route-planner-options-panel/.test(r.sel)
		&& /(^|;)\s*margin:/.test(r.rumpf));
	assert.strictEqual(gruppe.length, 1, "genau eine Regel setzt den Rand der zwei Gruppen");
	const randGruppe = (gruppe[0].rumpf.match(/(?:^|;)\s*margin:\s*([^;]+)/) || [])[1].trim();
	assert.ok(/^var\(--space-2\)\s+0\s+0$/.test(randGruppe),
		"die Gruppen tragen `var(--space-2) 0 0` -- gefunden: " + randGruppe);

	const geschwister = rs.filter((r) => /\.planner-group[^,{]*\+\s*\.planner-group/.test(r.sel));
	assert.strictEqual(geschwister.length, 1, "genau eine Regel regelt den Rand zwischen den Gruppen");
	const randZwei = (geschwister[0].rumpf.match(/(?:^|;)\s*margin-top:\s*([^;]+)/) || [])[1].trim();
	assert.strictEqual(randZwei, "var(--space-2)",
		"…und zwar mit DEMSELBEN Token, nicht mit 0: " + randZwei);

	// 🔴 UND DER REISEPLAN-KASTEN FAEHRT DIESELBE BLOCKLUFT. Er hat keinen Ueberstand -- er bekommt
	//    die 4px, damit die Reihe nicht 12 / 12 / 8 laeuft (Owner 05.09.2026: „zwischen reiseoptionen
	//    und der reiseübersicht ist der abstand noch zu klein"; live gemessen 12 / 12 / 8).
	//    Die DREI Stellen sind EINE Aussage: zwischen umrandeten Bloecken stehen 12px.
	const uebersicht = regeln(lies("css/features/route-overview.css"))
		.filter((r) => /^#overview$/.test(r.sel));
	assert.strictEqual(uebersicht.length, 1, "genau eine Grundregel formt die Reiseuebersicht");
	const randDrei = (uebersicht[0].rumpf.match(/(?:^|;)\s*margin-top:\s*([^;]+)/) || [])[1];
	assert.strictEqual((randDrei || "").trim(), "var(--space-2)",
		"die Reiseuebersicht traegt dieselbe Blockluft wie die zwei Gruppen: " + randDrei);
}

// ---- 6. Der Rahmenkasten WAECHST NICHT in der Flex-Spalte des Panels ------------------------
// 💣 DER TEUERSTE FEHLER DIESES TAGES, und am Zeiger unsichtbar. `.avm-rahmen` traegt
//    `flex: 1 1 100%` -- gemeint fuer eine Flex-ZEILE (die Eingabezeile des Quellen-Editors, wo der
//    Kasten sonst auf seine Inhaltsbreite schrumpft). #search ist eine Flex-SPALTE: dort misst
//    `flex-basis: 100%` die HOEHE und `flex-grow: 1` frisst jeden freien Platz.
// 🔴 Am Zeiger hat #search keine feste Hoehe (der Inhalt bestimmt sie) -- es gibt keinen freien
//    Platz, also passiert nichts. AM TELEFON haengt es zwischen `top` und `bottom` (gemessen
//    840px), und dann wachsen beide Gruppen: 291px statt 133,6px, der Kopf 96,2px statt 17,5px,
//    die zugeklappte „Reiseoptionen" ein 380px hoher gefuellter Kasten. Owner-Bilder 05.09.2026.
// ⚠️ Das Bauteil bleibt unveraendert -- es hat recht fuer seinen Wirt. Geprueft wird, dass der
//    Planer ihm das Wachsen NIMMT und dass die Zeile im Bauteil noch dasteht (sonst prueft dieser
//    Abschnitt ab morgen nichts mehr).
{
	const rs = regeln(lies("css/features/route-planner.css"));
	const opt = rs.filter((r) => /^\.planner-group\.avm-rahmen$/.test(r.sel) && /(^|;)\s*flex:/.test(r.rumpf));
	assert.strictEqual(opt.length, 1,
		"eine Regel nimmt den zwei Gruppen das Wachsen in der Flex-Spalte");
	const wert = (opt[0].rumpf.match(/(?:^|;)\s*flex:\s*([^;]+)/) || [])[1].trim();
	assert.strictEqual(wert, "0 0 auto",
		"und zwar auf `0 0 auto` -- `flex-grow: 0` allein liesse `flex-basis: 100%` stehen, und das ist"
		+ " in einer Spalte die volle HOEHE: " + wert);

	const bauteil = regeln(lies("css/components/rahmenkasten.css"))
		.filter((r) => /^\.avm-rahmen$/.test(r.sel));
	assert.strictEqual(bauteil.length, 1, "das Bauteil hat genau eine Grundregel");
	assert.ok(/flex:\s*1 1 100%/.test(bauteil[0].rumpf),
		"…und die traegt weiterhin `flex: 1 1 100%` fuer ihren Zeilen-Wirt -- faellt sie, ist die"
		+ " Ausnahme hier eine Regel gegen nichts");
}

console.log("OK -- ein Takt im Routenplaner, ein Token, die Punktlinie liest denselben, "
	+ "und der Ueberstand der Aufschrift ist an beiden Stellen ausgeglichen.");
