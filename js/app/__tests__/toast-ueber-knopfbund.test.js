// Am Telefon steht der Toast ueber dem Knopfbund unten rechts (Owner 14.09.2026) -- solange der Bund da ist.
//
// Unten mittig ueberdeckte er bei 375px den Kartenfaecher und stiess an „Hinweise" -- seit die
// Meldungen des Routenplaners als Toast kommen (showRouteNotice), ist das ein Alltagsfall.
// Die Geometrie selbst ist live gemessen (Toast gegen Bund, ohne Ueberlappung; bei offener Infobox
// unten statt auf ihren Kacheln); dieser Test haelt die Regel und ihre Kopplungen fest: die
// Telefon-Klasse, die gemessene Bundhoehe und die zwei Zustaende, in denen der Bund ausgeblendet ist.
//
// Aus der Wurzel des Repos:  node js/app/__tests__/toast-ueber-knopfbund.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
// Zeilenendenneutral (AGENTS.md §9) und ohne Kommentare -- die Begruendung im CSS nennt die Regel selbst.
const lies = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8").replace(/\r\n/g, "\n");
const ohneKommentare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const css = ohneKommentare(lies("css", "components", "feedback-toast.css"));

// 1) Am Zeiger bleibt alles, wie es war: unten mittig, 18px ueber dem Rand.
const grund = css.match(/(^|\n)\.feedback-toast\s*\{([^}]*)\}/);
assert.ok(grund, "css/components/feedback-toast.css hat keine Grundregel .feedback-toast mehr");
assert.ok(/bottom:\s*18px;/.test(grund[2]), "am Zeiger bleibt der Toast 18px ueber dem Rand: " + grund[2]);
assert.ok(/left:\s*50%;/.test(grund[2]), "und mittig");

// 2) Am Telefon ueber dem Knopfbund -- aus der GEMESSENEN Hoehe, mit Rueckfall.
const telefon = css.match(/(^|\n)html\.avesmaps-phone((?::not\(\.[\w-]+\))*) \.feedback-toast\s*\{([^}]*)\}/);
assert.ok(telefon, "keine Regel `html.avesmaps-phone… .feedback-toast` -- am Telefon verdeckt der Toast den Knopfbund");
const regel = telefon[3];
assert.ok(
	/bottom:\s*calc\(var\(--avesmaps-edge-gap\)\s*\+\s*var\(--avesmaps-corner-stack,\s*0px\)\);/.test(regel),
	"der Abstand kommt aus Kartenrand + gemessener Bundhoehe, nicht aus einer Pixelzahl: " + regel
);
assert.ok(!/\d+px\s*;/.test(regel.replace(/0px\)/g, "")),
	"keine eigene Pixelzahl in der Telefonregel -- sie laege beim naechsten Wachsen des Bundes daneben");
assert.ok(!/left|right|transform/.test(regel), "am Telefon wandert der Toast nur nach OBEN, er bleibt mittig");

// 3) NUR solange der Bund da ist: die Ausschluesse sind GENAU die Zustaende, in denen das Haus den Bund
//    am Telefon ausblendet. Ohne sie sprang der Toast bei offener Infobox auf deren Aktionskacheln.
const ausschluesse = (telefon[2].match(/:not\(\.([\w-]+)\)/g) || []).map((teil) => teil.slice(6, -1)).sort();
const layout = ohneKommentare(lies("css", "layout", "map-layout.css"));
const infopanel = ohneKommentare(lies("css", "features", "infopanel.css"));
const ausblendeKlassen = [];
for (const quelle of [layout, infopanel]) {
	const re = /html\.avesmaps-phone\.([\w-]+) #map-corner-actions\s*\{([^}]*)\}/g;
	let treffer;
	while ((treffer = re.exec(quelle))) {
		if (/opacity:\s*0/.test(treffer[2]) && /visibility:\s*hidden/.test(treffer[2])) {
			ausblendeKlassen.push(treffer[1]);
		}
	}
}
assert.ok(ausblendeKlassen.length >= 2, "die Ausblenderegeln des Knopfbunds am Telefon sind nicht mehr auffindbar: " + ausblendeKlassen);
assert.deepStrictEqual(ausschluesse, [...new Set(ausblendeKlassen)].sort(),
	"der Toast weicht dem Bund genau dann aus, wenn der Bund zu sehen ist -- die :not()-Klassen der Toastregel "
	+ "muessen die Ausblenderegeln des Bunds spiegeln: Toast " + JSON.stringify(ausschluesse)
	+ ", Bund ausgeblendet bei " + JSON.stringify(ausblendeKlassen));

// 4) „Telefon" ist die EINE Klasse, keine Media-Query in dieser Datei.
assert.ok(!/@media/.test(css), "css/components/feedback-toast.css fuehrt eine Media-Query -- Telefon heisst hier html.avesmaps-phone");

// 5) Die zwei Kopplungen: wer die Klasse setzt und wer die Hoehe schreibt.
const runtime = lies("js", "app", "runtime-state.js");
assert.ok(/classList\.toggle\("avesmaps-phone",\s*avesmapsIsPhoneViewport\(\)\)/.test(runtime),
	"js/app/runtime-state.js setzt `avesmaps-phone` nicht mehr aus avesmapsIsPhoneViewport()");
const controls = lies("js", "ui", "ui-controls.js");
assert.ok(/document\.documentElement\.style\.setProperty\("--avesmaps-corner-stack"/.test(controls),
	"js/ui/ui-controls.js schreibt --avesmaps-corner-stack nicht mehr auf <html> -- die Telefonregel liefe auf 0px");

console.log("toast-ueber-knopfbund.test.js: all assertions passed");
