// Die Stapelreihenfolge der Landschaften-Ebenen und die Sonderrolle der Derographie in „Alle“.
// Owner 27.08.2026: „Labels über Derographie über Vegetation über Topographie“ und, zu den Klicks:
// „nur das label soll klickbar sein und die fläche zeigen, außerdem kannst du die normale transparenz
// auf 0% senken, die transparenz wenn das label angeklickt wurde, passt".
//
// 🔴 WARUM DAS EIN TEST BRAUCHT. Bis heute hielt KEINE Zusicherung die Reihenfolge der drei Panes --
// sie stand in drei Zeilen bootstrap.js und liess sich lautlos umdrehen. Und die Sonderrolle der
// Derographie haengt an einer Spezifitaet: ihre Regel muss die Fuellung je Flaeche schlagen und darf
// die Hervorhebung NICHT schlagen. Beides sind Zahlenverhaeltnisse, die niemand im Kopf nachrechnet.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** 💣 Ein Treffer im KOMMENTAR ist kein Beleg -- gerade hier, wo die Prosa genau das erklaert, wonach
 *  gesucht wird. Dieselbe Vorsichtsmassnahme wie in ecosystem-pick-band.test.js. */
const ohneBlockKommentare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const ohneZeilenKommentare = (text) => text.replace(/^[\t ]*\/\/.*$/gm, "");

// ---- 1. Die Reihenfolge: Derographie > Vegetation > Topographie ---------------------------------
// ⚠️ Gelesen und GEGENEINANDER gehalten, keine Zahl fest erwartet -- dieselbe Bauart wie
// bootstrap-panes.test.js. Ein Test auf „252“ faellt nicht auf, wenn jemand das ganze Band verschiebt
// und dabei zwei der drei mitnimmt.
const bootstrap = ohneZeilenKommentare(read("js", "app", "bootstrap.js"));
const zIndex = new Map(
	[...bootstrap.matchAll(/getPane\(\s*"([^"]+)"\s*\)\.style\.zIndex\s*=\s*(\d+)/g)]
		.map((m) => [m[1], Number(m[2])])
);

["ecosystemPaneDerographisch", "ecosystemPaneVegetation", "ecosystemPaneTopographie", "labelsPane"]
	.forEach((name) => {
		assert.strictEqual(typeof zIndex.get(name), "number",
			`${name} hat keinen lesbaren zIndex in bootstrap.js -- prueft der Test noch das Richtige?`);
	});

assert.ok(zIndex.get("ecosystemPaneDerographisch") > zIndex.get("ecosystemPaneVegetation"),
	`🔴 Die Derographie (${zIndex.get("ecosystemPaneDerographisch")}) muss UEBER der Vegetation`
	+ ` (${zIndex.get("ecosystemPaneVegetation")}) liegen -- sonst liegt eine hervorgehobene Provinz`
	+ " unter dem Wald, und die Antwort auf den Label-Klick ist keine.");
assert.ok(zIndex.get("ecosystemPaneVegetation") > zIndex.get("ecosystemPaneTopographie"),
	`🔴 Die Vegetation (${zIndex.get("ecosystemPaneVegetation")}) muss ueber der Topographie`
	+ ` (${zIndex.get("ecosystemPaneTopographie")}) liegen (Owner 27.08.2026).`);
assert.ok(zIndex.get("labelsPane") > zIndex.get("ecosystemPaneDerographisch"),
	"💣 Und die Beschriftungen ueber allen dreien -- sie sind die oberste Stufe der Owner-Ordnung."
	+ " Das war schon so und bleibt es; ohne Zusicherung faellt eine Verschiebung des Bandes nicht auf.");

// ---- 2. Die Derographie in „Alle“: unsichtbar und klickdurchlaessig -----------------------------
const sheet = ohneBlockKommentare(read("css", "features", "ecosystem-layer.css"));

function regeln(bedingung) {
	const gefunden = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let m;
	while ((m = re.exec(sheet)) !== null) {
		const selector = m[1].trim();
		if (bedingung(selector)) { gefunden.push({ selector, body: m[2] }); }
	}
	return gefunden;
}

const derographischAlle = regeln((s) => s.includes("ecosystem-pane--derographisch")
	&& s.includes("ecosystem-pane--showall")
	&& s.includes("path.leaflet-interactive"));
assert.strictEqual(derographischAlle.length, 1,
	`Es gibt ${derographischAlle.length} Regeln fuer die derographischen Pfade in „Alle“ -- erwartet: genau eine.`);

const regel = derographischAlle[0];
assert.ok(/(^|[;\s])fill-opacity\s*:\s*0\s*(;|$)/.test(regel.body),
	"🔴 Die Derographie fuellt in „Alle“ mit 0 (Owner: „die normale transparenz auf 0% senken\").");
assert.ok(/pointer-events\s*:\s*none/.test(regel.body),
	"🔴 Und sie nimmt dort keine Klicks (Owner: „nur das label soll klickbar sein\") -- sie liegt jetzt"
	+ " oben und faenge sonst jeden Klick ab, der dem Wald darunter galt.");

// ---- 3. Die Spezifitaet, und sie ist die eigentliche Falle --------------------------------------
// 💣 ZWEI Nachbarn, in ZWEI Richtungen:
//   * Die Fuellung JE FLAECHE (`--eco-fill-art`, zwei Klassen) muss die neue Regel SCHLAGEN, sonst
//     bleibt die Derographie bei ihren 0,16 -- lautlos, denn der Wert steht am <path> im JavaScript.
//   * Die HERVORHEBUNG muss die neue Regel schlagen, sonst zeigt der Label-Klick nichts mehr an --
//     und das ist genau die Geste, fuer die die Ebene ueberhaupt nach oben gewandert ist.
const klassen = (selektor) => (selektor.match(/\.[a-zA-Z][\w-]*/g) || []).length;
const staerke = (selektor) => Math.max(...selektor.split(",").map(klassen));

const artFuellung = regeln((s) => s.includes("path.leaflet-interactive")
	&& !/ecosystem-area--/.test(s) && !s.includes("ecosystem-pane--showall"))
	.filter((r) => /(^|[;\s])fill-opacity\s*:/.test(r.body));
assert.ok(artFuellung.length > 0,
	"Es gibt keine Ebenen-Fuellungsregel mehr -- die Zusicherung darunter haette keinen Gegner und waere still wertlos.");
const staerksterGegner = Math.max(...artFuellung.map((r) => staerke(r.selector)));
assert.ok(staerke(regel.selector) > staerksterGegner,
	`Die „Alle\"-Regel hat ${staerke(regel.selector)} Klassen, die staerkste Ebenen-Fuellung`
	+ ` ${staerksterGegner}. Bei Gleichstand gewinnt die spaetere im Blatt -- und die Derographie`
	+ " bliebe sichtbar, obwohl die Regel dasteht.");

const hervorhebung = regeln((s) => s.includes("ecosystem-area--highlight"))
	.filter((r) => /(^|[;\s])fill-opacity\s*:/.test(r.body));
assert.ok(hervorhebung.length > 0, "Die Hervorhebung hat keine Fuellungsregel mehr.");
const schwaechsteHervorhebung = Math.min(...hervorhebung.map((r) => staerke(r.selector)));
assert.ok(schwaechsteHervorhebung > staerke(regel.selector),
	`🔴 Die schwaechste Hervorhebungsregel hat ${schwaechsteHervorhebung} Klassen, die „Alle\"-Regel`
	+ ` ${staerke(regel.selector)}. Damit wuerde der Label-Klick auf eine derographische Flaeche nichts`
	+ " mehr zeigen -- der Kern dessen, wofuer die Ebene nach oben gewandert ist.");

// ⚠️ Und die Klicks bekommt sie auch als hervorgehobene nicht zurueck: „nur das label soll klickbar
// sein". Die Hervorhebungsregeln setzen Fuellung und Kontur, kein `pointer-events` -- wer dort eines
// ergaenzt, macht die Flaeche im Hervorhebungszustand wieder zum Klickfaenger.
hervorhebung.forEach((r) => {
	assert.ok(!/pointer-events/.test(r.body),
		"💣 Eine Hervorhebungsregel setzt `pointer-events` -- damit finge die hervorgehobene"
		+ " derographische Flaeche die Klicks wieder ab, die dem Wald darunter gelten.");
});

console.log("landschaften-sortierung: alle Zusicherungen gruen");
