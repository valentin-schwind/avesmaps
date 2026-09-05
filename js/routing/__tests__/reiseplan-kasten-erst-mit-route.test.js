// Der Reiseplan-Kasten erscheint ERST mit einer Route.
// =====================================================
// Owner 05.09.2026: „die box mit dem text ‚Wegpunkte und Dauer der Reise ...' soll erst angezeigt
// werden, wenn auch eine route angezeigt wird." Ein umrandeter Kasten unter den Eingaben, der nur
// erklaert, dass er spaeter einmal etwas enthaelt, ist eine Behauptung von Inhalt.
//
// 🔴 DIE REGEL IST EINE KETTE AUS DREI GLIEDERN, und ein einzelnes gibt lautlos nach:
//    1. das Markup startet LEER (index.html)
//    2. `#overview:empty { display: none }` blendet leer aus (css/features/route-overview.css)
//    3. `resetOverview()` LEERT, statt den Satz zurueckzuschreiben (js/map-features/map-features.js)
//    Schreibt Glied 3 wieder Text hinein, steht der Kasten nach jedem Zuruecksetzen wieder da --
//    und zwar mit einem Satz, den niemand mehr erwartet.
//
// 💣 UND DAS VIERTE GLIED IST EIN ATTRIBUT: `data-i18n` am Kasten. Der Sprachumschalter schreibt
//    in JEDES so ausgezeichnete Element seinen Text -- mit dem Attribut waere der Satz beim ersten
//    Wechsel auf EN zurueck. Im Browser gemessen (05.09.2026): ohne Attribut bleibt der Kasten
//    nach dem Wechsel auf EN leer und unsichtbar.
//
// ⚠️ WAS AUSDRUECKLICH SICHTBAR BLEIBT: „Route wird berechnet..." und „Keine Route gefunden".
//    Beide sind eine Antwort auf eine Handlung -- der leere Kasten war keine. Sie setzt
//    route-engine.js als reinen Text in denselben Kasten; ein Test darauf steht hier, weil ein
//    „mach den Kasten weg" beim naechsten Mal genau diese zwei mitnimmt.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/routing/__tests__/reiseplan-kasten-erst-mit-route.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF (AGENTS.md §9).
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), "utf8").replace(/\r\n/g, "\n");

// ---- 1. Das Markup startet leer --------------------------------------------------------------
{
	const html = lies("index.html");
	const treffer = html.match(/<div id="overview"[^>]*>([\s\S]*?)<\/div>/);
	assert.ok(treffer, "#overview steht in index.html");
	assert.strictEqual(treffer[1], "",
		"…und ist LEER -- mit Text darin steht der Kasten schon vor der ersten Route da: "
		+ JSON.stringify(treffer[1].slice(0, 60)));
	assert.ok(!/<div id="overview"[^>]*data-i18n/.test(html),
		"…und traegt kein `data-i18n`: der Sprachumschalter schriebe den Satz sonst zurueck");
}

// ---- 2. Leer heisst unsichtbar ---------------------------------------------------------------
{
	const css = lies("css/features/route-overview.css").replace(/\/\*[\s\S]*?\*\//g, "");
	const regel = css.match(/#overview:empty\s*\{([^}]*)\}/);
	assert.ok(regel, "`#overview:empty` steht in css/features/route-overview.css");
	assert.ok(/display:\s*none/.test(regel[1]),
		"…und blendet aus -- ohne diese Zeile bleibt ein leerer Rahmen von 1px Hoehe stehen");
}

// ---- 3. `resetOverview` wird AUSGEFUEHRT, nicht gelesen ---------------------------------------
// ⭐ Ein Regex kennt keinen Geltungsbereich. Der Rumpf wird ausgeschnitten und in einer Attrappe
//    wirklich gefahren -- gemessen wird, was er TUT.
{
	const quelle = lies("js/map-features/map-features.js");
	const anfang = quelle.indexOf("function resetOverview() {");
	assert.ok(anfang >= 0, "`resetOverview` steht in js/map-features/map-features.js");
	let tiefe = 0;
	let ende = quelle.indexOf("{", anfang);
	for (let i = ende; i < quelle.length; i += 1) {
		if (quelle[i] === "{") tiefe += 1;
		else if (quelle[i] === "}") {
			tiefe -= 1;
			if (tiefe === 0) { ende = i + 1; break; }
		}
	}
	const rumpf = quelle.slice(anfang, ende);

	const gerufen = [];
	const kontext = {
		$: (sel) => {
			gerufen.push("$(" + sel + ")");
			return new Proxy({}, {
				get: (_ziel, name) => (...args) => {
					gerufen.push(String(name) + "(" + args.map((a) => JSON.stringify(a)).join(", ") + ")");
					return undefined;
				},
			});
		},
		// 💣 Absichtlich KEIN `tr` und keine Textkonstante im Kontext: greift der Rumpf danach,
		//    wirft er hier -- und genau das soll er nicht mehr tun.
	};
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext(rumpf + "\nresetOverview();", kontext);

	assert.deepStrictEqual(gerufen, ["$(#overview)", "empty()"],
		"resetOverview() LEERT den Kasten und schreibt nichts hinein: " + gerufen.join(" -> "));
}

// ---- 4. Die zwei Zwischenzustaende bleiben ----------------------------------------------------
{
	const engine = lies("js/routing/route-engine.js");
	[
		["planner.overview.calculating", "Route wird berechnet"],
		["planner.overview.noRoute", "Keine Route gefunden"],
	].forEach(([schluessel, satz]) => {
		const zeile = new RegExp('\\$\\("#overview"\\)\\.text\\(tr\\("' + schluessel.replace(/\./g, "\\.") + '"');
		assert.ok(zeile.test(engine),
			"„" + satz + "\" steht weiterhin im Kasten -- der Kasten verschwindet nur in der RUHE");
	});
}

// ---- 5. Kein toter Rueckstand ----------------------------------------------------------------
// 💣 Eine Konstante ohne Leser und ein i18n-Schluessel ohne Aufrufer sind die Einladung, den Satz
//    „nur schnell wieder anzuklemmen" -- und dann ist die Owner-Entscheidung still zurueckgenommen.
{
	const dateien = ["index.html", "js/config.js", "js/app/i18n-en.js",
		"js/map-features/map-features.js", "js/routing/route-engine.js", "js/routing/route-plan.js"];
	dateien.forEach((f) => {
		const text = lies(f);
		assert.ok(!/DEFAULT_OVERVIEW_TEXT/.test(text),
			f + ": `DEFAULT_OVERVIEW_TEXT` ist weg -- die Vorgabe ist LEER");
		assert.ok(!/planner\.overview\.default/.test(text),
			f + ": der i18n-Schluessel `planner.overview.default` ist weg");
	});
}

console.log("OK -- der Reiseplan-Kasten kommt erst mit Inhalt, und die zwei Zwischenzustaende bleiben.");
