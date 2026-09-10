const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 Die Karte fragt die Darstellungstafel, nicht mehr nur den Token. OHNE Uebersteuerung kommt
// derselbe Wert heraus wie heute -- das ist die Zusicherung, die „beim Ausliefern aendert sich
// nichts" traegt (Entwurf §5.1, §8).
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ecosystem-display-flaeche.test.js

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" }
);

const lies = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const rendering = lies("map-features-ecosystem-rendering.js");
const loader = lies("map-features-ecosystem-loader.js");
const css = fs.readFileSync(path.join(__dirname, "../../../css/features/ecosystem-layer.css"), "utf8");

// ---- A. ecosystemAreaColor reicht den Token durch die Tafel ------------------------------------
const vonFarbe = rendering.indexOf("function ecosystemAreaColor(");
const bisFarbe = rendering.indexOf("\n}", vonFarbe);
const rumpfFarbe = rendering.slice(vonFarbe, bisFarbe);
assert.ok(/avesmapsEcosystemDisplayFlaechenTon/.test(rumpfFarbe),
	"ecosystemAreaColor reicht den Token durch die Tafel");
// 💣 Und der Token wird weiterhin GELESEN -- die Tafel kennt keine Farbe (AGENTS.md §12).
assert.ok(/readEcosystemColorToken/.test(rumpfFarbe), "der Token bleibt die Vorgabequelle");

// ---- B. Die Deckkraft steht als Variable an der FLAECHE ----------------------------------------
// 💣 Nicht als Leaflet-Stil: Leaflet schreibt fill-opacity als SVG-PRAESENTATIONSATTRIBUT, und CSS
// ueberstimmt das. Die Zustandslogik (ruhend/aktiv/Kontur) bleibt an der Pane; nur der aktive
// Fuellwert kommt jetzt je Pfad.
assert.ok(/--eco-fill-art/.test(css), "die Flaeche traegt ihren eigenen Fuellwert im Stylesheet");
assert.ok(/--eco-fill-art/.test(rendering), "und jemand setzt ihn am Pfad");
assert.ok(/avesmapsEcosystemDisplayDeckkraft/.test(rendering), "aus der Tafel");

// 🔴 „Ruhend = unsichtbar" ist UNANGETASTET -- sonst laege ueber „Alle" wieder das Farbnetz,
// das AGENTS.md §12 ausdruecklich abgeschafft hat.
const flach = css.replace(/\s+/g, " ");
assert.ok(/\.ecosystem-pane \{ --eco-fill: 0; --eco-contour: 0; \}/.test(flach),
	"die ruhende Pane steht weiter auf 0/0");
// ⚠️ Der Rueckfall im var() ist tragend: eine Flaeche OHNE eigenen Wert muss den Panewert erben,
// sonst waere sie im ruhenden Zustand sichtbar.
assert.ok(/var\(--eco-fill-art, var\(--eco-fill\)\)/.test(flach),
	"ohne eigenen Wert erbt die Flaeche den Zustandswert der Pane");

// ---- C. Der Wert wird gesetzt, WO der Pfad entsteht -------------------------------------------
// 💣 Ein gruener Test beweist nichts ohne Verdrahtung. Der <path> existiert erst NACH addTo(map) --
// genau deshalb steht die Selektionsklasse dort und nicht im Baubauteil.
assert.ok(/applyEcosystemAreaDeckkraft/.test(loader),
	"der Loader setzt die Deckkraft, nachdem die Flaeche auf der Karte ist");
const posAdd = loader.indexOf("layer.addTo(map);");
const posDeck = loader.indexOf("applyEcosystemAreaDeckkraft", posAdd);
assert.ok(posAdd >= 0 && posDeck > posAdd, "und zwar NACH addTo(map) -- vorher gibt es kein Element");

// ⚠️ Auch beim Umtypisieren einer vorhandenen Flaeche: `setStyle` faerbt neu, aber die Deckkraft
// haengt an der ART, und die hat sich gerade geaendert.
const posSetStyle = loader.indexOf("existingLayer.setStyle(");
const posDeckStyle = loader.indexOf("applyEcosystemAreaDeckkraft", posSetStyle);
assert.ok(posSetStyle >= 0 && posDeckStyle > posSetStyle && posDeckStyle < posAdd,
	"und beim Umtypisieren einer vorhandenen Flaeche ebenfalls");

// ---- D. Ohne Uebersteuerung ist der Wert der heutige ------------------------------------------
avesmapsEcosystemDisplayInstall(null);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("derographisch", "region"), 0.16);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("vegetation", "wald"), 0.72);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("topographie", "gebirge"), 0.72);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("klima", "polar"), 0.30);

// ---- E. Die Tafel wird geholt, und ein Ausfall haelt die Karte NICHT auf ----------------------
// ⭐ Laderoutine im MODUL, Aufruf in js/config.js -- woertlich die Arbeitsteilung von
// avesmapsLoadLocationZoomBands. Ein Aufruf beim Laden der Datei loeste im Landschaften-Editor,
// der sie ebenfalls laedt, eine zweite nutzlose Anfrage aus.
const modul = lies("ecosystem-display.js");
assert.ok(/ecosystem-display\.php/.test(modul), "das Modul kennt seinen Endpunkt");
assert.ok(/function avesmapsLoadEcosystemDisplay/.test(modul), "und hat eine Laderoutine");
// ⚠️ Faellt STILL aus: kein Netz, kein Endpunkt, kaputte Antwort -> die Vorgaben gelten.
assert.ok(/\.catch\(\(\) => false\)/.test(modul),
	"sie faengt jeden Fehler -- ein Ausfall darf die Karte nicht aufhalten");

const config = fs.readFileSync(path.join(__dirname, "../../config.js"), "utf8");
assert.ok(/avesmapsLoadEcosystemDisplay\(\)/.test(config), "js/config.js ruft sie");
// 💣 Und zieht BEIDE Zwischenspeicher nach: der Typ-Stil je Labelart haelt die Farbe fest, die
// Flaechen ihre Deckkraft als CSS-Variable. Ohne beides wirkt eine geladene Tafel erst nach dem
// naechsten Neuladen -- und das sieht aus wie „Speichern tut nichts".
assert.ok(/avesmapsLeereLabelTypStil/.test(config), "und leert den Label-Typstil");
assert.ok(/avesmapsRefreshEcosystemDisplay/.test(config), "und zieht die Flaechen nach");
assert.ok(/function avesmapsRefreshEcosystemDisplay/.test(rendering),
	"den Nachzieher gibt es auch wirklich");

// ---- F. Die Deckkraft JE ART: der See ist deckend, seine Ebene nicht -------------------------
// Owner 09.09.2026: „fluesse und seen haben nicht diesselbe farbe". Beide lesen --color-water
// (#4c89c6); der Fluss zeichnet als LINIE mit stroke-opacity 1, die Seeflaeche mit der Fuellung
// ihrer Ebene -- live gemessen 0,5, ueber dem Pergament #d3cec2 also #90acc4. Die Deckkraft ist
// der EINZIGE Hebel: es gibt keine Fuellfarbe, die bei 0,5 zu #4c89c6 aufmischt (ein Kanal
// muesste negativ sein, 2*76 - 211 = -59), und die Flusslinie auszubleichen traefe ALLE Ansichten.
avesmapsEcosystemDisplayInstall(null);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("topographie", "see"), 1,
	"der See der Topographie traegt die Vorgabe-Deckkraft 1 und damit wirklich den Wasserton");

// 💣 DIE ZWEITE HAELFTE IST DIE WICHTIGERE: es ist eine Vorgabe JE ART, nicht je EBENE. Ohne sie
// kippt beim naechsten Anfassen die ganze Topographie auf 1 -- Gebirge, Huegelland, Tal und Meer
// mit --, und niemand merkt es, weil der gemeldete Fall dann trotzdem stimmt.
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("topographie", "gebirge"), 0.72,
	"das Gebirge derselben Ebene bleibt bei der Zahl seiner Ebene");
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("topographie", "meer"), 0.72,
	"und das Meer ebenso -- gefragt war nach Fluessen und Seen");

// ⚠️ Der Schluessel traegt die EBENE, nicht nur die Art. `insel` kommt in zweien vor; eine Tafel
// nach blosser Art haengte den Wert der einen an die andere.
assert.ok(Object.keys(AVESMAPS_ECOSYSTEM_DISPLAY_DECKKRAFT_JE_ART).length > 0,
	"die Tafel je Art ist nicht leer");
assert.ok(Object.keys(AVESMAPS_ECOSYSTEM_DISPLAY_DECKKRAFT_JE_ART).every((k) => k.includes(":")),
	"und jeder ihrer Schluessel nennt Ebene UND Art");

// 🔴 VORGABE, KEIN RIEGEL -- die GESPEICHERTE Deckkraft dieser Art schlaegt sie. Wer die Vorgabe je
// Art ueber eine ausdrueckliche Einstellung zoege, machte aus einer Owner-Zahl einen Riegel; genau
// das ist bei `berggipfel` am 02.09.2026 zurueckgenommen worden.
// ⚠️ Was der GLOBALE Wert der Ebene mit ihr macht, steht in Abschnitt G -- dort stand bis zum
// 10.09.2026 „er schlaegt auch sie", und genau daran war die Vorgabe live wirkungslos.
avesmapsEcosystemDisplayInstall({ deckkraft: { "topographie:see": 0.4 } });
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("topographie", "see"), 0.4,
	"eine im Fenster gespeicherte Deckkraft dieser Art schlaegt die Vorgabe");
avesmapsEcosystemDisplayInstall(null);

// ⚠️ Mit LEERER Art bleibt es die Zahl der Ebene -- das Fenster „Darstellung" beschriftet damit
// seine Zeile „Vorgabe-Deckkraft dieser Ebene" und den globalen Regler.
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("topographie", ""), 0.72,
	"die Vorgabe der EBENE ist unberuehrt");

// 💣 UND SIE MUSS BEIDE WEGE ERREICHEN. Die Karte geht ueber applyEcosystemAreaDeckkraft
// (Abschnitt B/C); das Fenster „Darstellung" liest denselben Vorgabengeber, statt eine eigene Zahl
// zu fuehren -- sonst zeigte sein Regler 72 %, waehrend die Karte 100 % zeichnet.
// ⚠️ Zeilenendenneutral gesucht: hier ist CRLF, im Deploy-Tor LF (AGENTS.md §9).
const LF = String.fromCharCode(10);
const fenster = fs
	.readFileSync(path.join(__dirname, "../../../html/landschaften-editor.html"), "utf8")
	.split(String.fromCharCode(13))
	.join("");
const vonZeile = fenster.indexOf("function ecoDisplayDeckZeile(");
assert.ok(vonZeile >= 0, "das Fenster hat einen Leser fuer den Zeilenwert");
const rumpfZeile = fenster.slice(vonZeile, fenster.indexOf(LF + "}", vonZeile));
assert.ok(rumpfZeile.includes("avesmapsEcosystemDisplayDeckkraft(kind, art)"),
	"und er faellt auf die geteilte Vorgabe zurueck, MIT der Art -- nicht auf eine eigene Zahl");

// ---- G. Wasser ist kein Gelaende: die GLOBALE Deckkraft gilt ihm nicht ------------------------
// Owner 09.09.2026: „dann mach die seeflaechen auch 1 opacity". Fuer die Topographie steht live
// {an:true, wert:0.5} gespeichert -- das ist die ERSTE Stufe, und damit war die Vorgabe aus
// Abschnitt F auf der Karte wirkungslos: der See zeichnete weiter #90acc4 statt #4c89c6.
// 🔴 Die globale Deckkraft laesst das gemalte GELAENDE durchscheinen. Wasser ist kein Gelaende, und
// sein Ton ist keine Geschmacksfrage, sondern eine Zusage -- „Fluss und See sind ein Gewaesser, ein
// Ton". Bei jeder Deckkraft unter 1 kann die Flaeche ihn nicht tragen (2*76 - 211 = -59).
avesmapsEcosystemDisplayInstall({ global: { topographie: { an: true, wert: 0.5 } } });
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("topographie", "see"), 1,
	"der See zeichnet deckend, auch wenn die Ebene global auf 50 % steht");

// 💣 DIE GEGENPROBE IST DIE EIGENTLICHE ZUSICHERUNG: ausgenommen ist das WASSER, nicht die EBENE.
// Ohne sie kippt beim naechsten Anfassen die ganze Topographie aus der globalen Regel heraus -- von
// 0,5 auf 0,72 --, und niemand merkt es, weil der gemeldete Fall dann trotzdem stimmt.
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("topographie", "gebirge"), 0.5,
	"das Gebirge derselben Ebene folgt dem globalen Wert weiter");
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("topographie", "meer"), 0.5,
	"und das Meer ebenso -- es traegt seinen eigenen Ton und hat keinen Zwilling");

// ⚠️ UND DIE WAHL DES OWNERS STICHT AUCH DIE AUSNAHME. Sonst waere sein Regler fuer diese Flaeche
// tot -- und ein Regler, dessen Wert nirgends gilt, ist von einem kaputten Formular nicht zu
// unterscheiden (AGENTS.md §11). Der durchscheinende See bleibt einstellbar.
avesmapsEcosystemDisplayInstall({
	global: { topographie: { an: true, wert: 0.5 } },
	deckkraft: { "topographie:see": 0.4 },
});
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("topographie", "see"), 0.4,
	"ein gespeicherter eigener Wert gewinnt auch gegen die Ausnahme");
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("topographie", "gebirge"), 0.5,
	"und nimmt der Ebene ihren globalen Wert nicht");
avesmapsEcosystemDisplayInstall(null);

// Die Ausnahme selbst -- EIN benannter Satz, und er kennt keine Art: er fragt die Liste.
assert.strictEqual(avesmapsEcosystemDisplayGlobaleDeckkraftGilt("topographie", "see"), false,
	"dem See gilt die globale Deckkraft nicht");
assert.strictEqual(avesmapsEcosystemDisplayGlobaleDeckkraftGilt("topographie", "gebirge"), true,
	"dem Gebirge schon");
// ⚠️ Mit LEERER Art gilt sie -- so fragt das Fenster nach der Zahl der EBENE („Vorgabe-Deckkraft
// dieser Ebene", der globale Regler). Eine Ausnahme, die dort zuschluege, verstellte seine Anzeige.
assert.strictEqual(avesmapsEcosystemDisplayGlobaleDeckkraftGilt("topographie", ""), true,
	"und fuer die Ebene als ganze ebenfalls");

// 💣 DIE ZWEI TAFELN MUESSEN SICH DECKEN. Eine ausgenommene Flaeche OHNE eigene Vorgabe fiele auf
// die Zahl ihrer Ebene (0,72) zurueck und traege den Ton genauso wenig -- die Ausnahme waere dann
// die Haelfte einer Regel, und das Ergebnis saehe nach „fast richtig" aus.
assert.ok(AVESMAPS_ECOSYSTEM_DISPLAY_WASSERFLAECHEN.size > 0, "die Liste der Ausnahmen ist nicht leer");
AVESMAPS_ECOSYSTEM_DISPLAY_WASSERFLAECHEN.forEach((k) => {
	assert.ok(k.includes(":"), "der Schluessel " + k + " nennt Ebene UND Art");
	assert.strictEqual(AVESMAPS_ECOSYSTEM_DISPLAY_DECKKRAFT_JE_ART[k], 1,
		k + " ist von der globalen Deckkraft ausgenommen und muss deshalb die Vorgabe 1 tragen");
});

// ---- G2. Das Fenster „Darstellung" ist der ZWEITE Erzeuger ------------------------------------
// 💣 Eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel: der Vorschaustreifen des
// Fensters zeigte sonst 50 %, waehrend die Karte deckend zeichnet.
// ⭐ AUSGEFUEHRT, nicht gelesen -- ein Regex kennt keinen Geltungsbereich (die Lehre vom
// 03.09.2026, als ein gesuchter Aufruf in einer anderen Funktion stand).
const vonWirkt = fenster.indexOf("function ecoDisplayDeckWirkt(");
assert.ok(vonWirkt >= 0, "das Fenster hat einen Leser fuer den WIRKENDEN Wert");
const rumpfWirkt = fenster.slice(vonWirkt, fenster.indexOf(LF + "}", vonWirkt) + 2);
assert.ok(rumpfWirkt.endsWith("}"), "und sein Rumpf ist vollstaendig ausgeschnitten");
vm.runInNewContext(
	[
		'const ecoDisplayKeyFl = (kind, art) => kind + ":" + art;',
		'function ecoDisplayGlobalAn(kind) { const g = _global[kind]; return (g && typeof g.an === "boolean") ? g.an : true; }',
		'function ecoDisplayGlobalWert(kind) { const g = _global[kind];'
			+ ' return (g && typeof g.wert === "number") ? g.wert : avesmapsEcosystemDisplayDeckkraft(kind, ""); }',
		'function ecoDisplayTeil(teil) { return teil === "deckkraft" ? _deck : {}; }',
		rumpfWirkt,
		'_global = { topographie: { an: true, wert: 0.5 } };',
		'assert.strictEqual(ecoDisplayDeckWirkt("topographie", "see"), 1,',
		'	"die Vorschau des Fensters zeigt den See deckend");',
		'assert.strictEqual(ecoDisplayDeckWirkt("topographie", "gebirge"), 0.5,',
		'	"und das Gebirge auf dem globalen Wert seiner Ebene");',
		'_deck = { "topographie:see": 0.4 };',
		'assert.strictEqual(ecoDisplayDeckWirkt("topographie", "see"), 0.4,',
		'	"ein gespeicherter eigener Wert gewinnt auch in der Vorschau");',
	].join(LF),
	{
		_global: {},
		_deck: {},
		assert,
		avesmapsEcosystemDisplayDeckkraft,
		avesmapsEcosystemDisplayGlobaleDeckkraftGilt,
	},
	{ filename: "ecoDisplayDeckWirkt (ausgeschnitten)" }
);

// 💣 Und die Liste der Ausnahmen kommt aus der GETEILTEN Regel, nicht aus einer zweiten Tafel im
// Fenster -- sonst nennte die Beschriftung beim naechsten Zuwachs eine andere Menge als die Karte.
const vonOhne = fenster.indexOf("function ecoDisplayGlobalOhne(");
assert.ok(vonOhne >= 0, "das Fenster hat einen Leser fuer die ausgenommenen Arten");
const rumpfOhne = fenster.slice(vonOhne, fenster.indexOf(LF + "}", vonOhne) + 2);
assert.ok(rumpfOhne.includes("avesmapsEcosystemDisplayGlobaleDeckkraftGilt"),
	"und er fragt die geteilte Regel");
assert.ok(!/WASSERFLAECHEN|"see"/.test(rumpfOhne), "und nennt selbst keine Art");

// ---- G3. 🔴 DAS BEDIENELEMENT IST BESCHRIFTET -------------------------------------------------
// AGENTS.md §11: „wer einen Wert doch irgendwo uebersteuert, beschriftet das Bedienelement -- ein
// Regler, dessen Wert stillschweigend nirgends gilt, ist von einem kaputten Formular nicht zu
// unterscheiden." Ohne diesen Abschnitt ist der ganze Umbau die Falle, die das Haus am 02.09.2026
// mit 76 Gipfeln bezahlt hat.
const vonGlobal = fenster.indexOf("function ecoDisplayZeichneGlobal(");
assert.ok(vonGlobal >= 0, "das Fenster zeichnet den globalen Regler");
const rumpfGlobal = fenster.slice(vonGlobal, fenster.indexOf(LF + "}", vonGlobal) + 2);
assert.ok(rumpfGlobal.includes("ecoDisplayGlobalOhne(kind)"),
	"die Beschriftung des Haekchens fragt, welche Arten ausgenommen sind");
assert.ok(rumpfGlobal.includes("ECO_DISPLAY_GLOBAL_OHNE_SATZ"),
	"und nennt den Grund, nicht nur die Tatsache");

// ⚠️ Die Zeile einer ausgenommenen Art bleibt BEDIENBAR und sagt sichtbar, warum -- sonst waere die
// Ausnahme genau der stille Riegel, den sie verhindern soll.
const vonTab = fenster.indexOf("function ecoDisplayZeichneTabelle(");
assert.ok(vonTab >= 0, "das Fenster zeichnet die Tabelle");
const rumpfTab = fenster.slice(vonTab, fenster.indexOf(LF + "}", vonTab) + 2);
assert.ok(rumpfTab.includes("const stumm = ecoDisplayGlobalAn(kind) && globalGiltHier;"),
	"eine ausgenommene Zeile wird NICHT stumm");
assert.ok(rumpfTab.includes("fl-ausnahme") && rumpfTab.includes("vom Häkchen oben ausgenommen"),
	"und traegt eine sichtbare Marke, nicht nur einen Tooltip");
assert.ok(rumpfTab.includes("ECO_DISPLAY_GLOBAL_OHNE_SATZ"), "mit demselben Grund dahinter");
// 💣 Eine Marke ohne Stil ist eine Marke, die niemand als solche liest.
const cssEditor = fs.readFileSync(path.join(__dirname, "../../../css/pages/landschaften-editor.css"), "utf8");
assert.ok(/\.fl-ausnahme\b/.test(cssEditor), "und das Blatt des Fensters kennt ihre Klasse");
// ⚠️ Ein Satz UEBER die Ausnahme taucht nur auf, wo es sie gibt -- sonst liest er sich wie eine
// Einschraenkung, die auf dieser Ebene niemand findet.
assert.ok(rumpfTab.includes("ecoDisplayGlobalOhne(kind).length"),
	"die Fussnote nennt die Ausnahme nur auf einer Ebene, die eine hat");


// ---- H. Die ZUSTAENDE duerfen die Deckkraft des Wassers nicht uebersteuern ---------------------
// Owner 09.09.2026, nach den zwei ersten Anlaeufen: „mit der deckkraft ist immer noch was falsch, sie
// aendert sich sogar, wenn ich draufklick. und selbst wenn ich draufklick ist sie noch falsch."
//
// 💣 DIE URSACHE WAR DIE KASKADE, NICHT DIE TAFEL. `--eco-fill-art` kommt ueber eine Regel mit ZWEI
// Klassen zur Wirkung; die Hervorhebung (`--highlight`, fuenf Klassen) setzt `fill-opacity: 0.8`
// DIREKT, die Zielwahl 0,42. Beim Ueberfahren und Anklicken sprang der See darum auf 0,8 -- und 0,8
// ist nicht 1, also trug er den Wasserton in keinem der beiden Zustaende.
//
// ⭐ WAS HIER GERECHNET WIRD UND WAS NICHT: node hat kein `getComputedStyle`. Dieser Abschnitt LOEST
// die Kaskade des echten Blattes selbst auf -- Regeln parsen, Spezifitaet zaehlen, den Gewinner je
// Elementzustand bestimmen -- und beantwortet damit dieselbe Frage wie eine Messung: WELCHE Regel
// gewinnt. Im Browser gegengemessen wurde zusaetzlich, mit `transition: none` (die Messfalle steht an
// `--eco-fill-art` im Blatt); die vier Zahlen unten sind dort Ziffer fuer Ziffer dieselben.

const klassenIn = (teil) => (teil.match(/\.[a-zA-Z][\w-]*/g) || []).map((k) => k.slice(1));
const nichtKlassenIn = (teil) => (teil.match(/:not\(\s*\.[a-zA-Z][\w-]*\s*\)/g) || [])
	.map((k) => k.replace(/^:not\(\s*\./, "").replace(/\s*\)$/, ""));
const ohneNot = (teil) => teil.replace(/:not\([^)]*\)/g, "");

// Ein Selektor der Form `<Pane-Teil> (>|Leerzeichen) svg path<Pfad-Teil>` -- die Bauform, in der
// dieses Blatt jede Flaechenregel schreibt. Alles andere ist eine PANE-Regel (sie setzt Variablen).
function zerlegePfadSelektor(sel) {
	const m = sel.match(/^([\s\S]+?)\s*>\s*svg\s+path([\s\S]*)$/)
		|| sel.match(/^([\s\S]+?)\s+svg\s+path([\s\S]*)$/);
	if (!m) { return null; }
	const paneTeil = m[1];
	const pfadTeil = m[2];
	return {
		// 💣 Die :not()-Klassen muessen aus der Positivliste heraus, sonst gilt eine ausgeschlossene
		// Klasse als verlangt und die Regel passt nie.
		paneHat: klassenIn(ohneNot(paneTeil)),
		paneHatNicht: nichtKlassenIn(paneTeil),
		pfadHat: klassenIn(ohneNot(pfadTeil)),
		pfadHatNicht: nichtKlassenIn(pfadTeil),
		// Spezifitaet: die Klassenzahl ueber BEIDE Teile -- :not() zaehlt mit seinem Argument mit.
		gewicht: klassenIn(paneTeil).length + klassenIn(pfadTeil).length,
	};
}

const cssOhneKommentare = css.replace(/\/\*[\s\S]*?\*\//g, "");
const alleRegeln = [];
{
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let m;
	let nr = 0;
	while ((m = re.exec(cssOhneKommentare)) !== null) {
		const body = m[2];
		m[1].split(",").forEach((sel) => {
			alleRegeln.push({ sel: sel.trim(), body, nr: nr += 1 });
		});
	}
}
assert.ok(alleRegeln.length > 50, "der Parser findet das Blatt (" + alleRegeln.length + " Regeln)");

/** Der zuletzt gewinnende Wert einer Eigenschaft INNERHALB eines Rumpfes. */
function letzteDeklaration(body, prop) {
	const re = new RegExp("(?:^|[;{\\s])" + prop.replace(/-/g, "\\-") + "\\s*:\\s*([^;]+)", "g");
	let treffer = null;
	let m;
	while ((m = re.exec(body)) !== null) { treffer = m[1].trim(); }
	return treffer;
}

/** Passt dieser Selektor auf die PANE (eine Regel ohne `svg path`)? Gewicht oder null. */
function passtPane(regel, paneKlassen) {
	if (zerlegePfadSelektor(regel.sel)) { return null; }
	const blank = ohneNot(regel.sel).trim();
	if (/[>+~\s]/.test(blank)) { return null; }
	if (!klassenIn(blank).every((k) => paneKlassen.has(k))) { return null; }
	if (nichtKlassenIn(regel.sel).some((k) => paneKlassen.has(k))) { return null; }
	return klassenIn(regel.sel).length;
}

/** `--eco-fill` der Pane: dieselbe Kaskade, eine Etage hoeher. */
function ecoFillDerPane(paneKlassen) {
	let best = null;
	alleRegeln.forEach((regel) => {
		const gewicht = passtPane(regel, paneKlassen);
		if (gewicht === null) { return; }
		const wert = letzteDeklaration(regel.body, "--eco-fill");
		if (wert === null) { return; }
		if (!best || gewicht > best.gewicht || (gewicht === best.gewicht && regel.nr > best.nr)) {
			best = { gewicht, nr: regel.nr, wert };
		}
	});
	return best ? best.wert : null;
}

/** Alle Regeln, die `fill-opacity` fuer diesen <path> setzen -- staerkste zuerst. */
function fillOpacityKandidaten(paneKlassen, pfadKlassen) {
	const kandidaten = [];
	alleRegeln.forEach((regel) => {
		const z = zerlegePfadSelektor(regel.sel);
		if (!z) { return; }
		if (!z.paneHat.every((k) => paneKlassen.has(k))) { return; }
		if (z.paneHatNicht.some((k) => paneKlassen.has(k))) { return; }
		if (!z.pfadHat.every((k) => pfadKlassen.has(k))) { return; }
		if (z.pfadHatNicht.some((k) => pfadKlassen.has(k))) { return; }
		const wert = letzteDeklaration(regel.body, "fill-opacity");
		if (wert === null) { return; }
		kandidaten.push({ sel: regel.sel, gewicht: z.gewicht, nr: regel.nr, wert });
	});
	// Bei Gleichstand gewinnt die SPAETERE im Blatt -- genau die Abhaengigkeit, die dieses Blatt
	// vermeiden will; Abschnitt H1 haelt fest, dass es hier keinen Gleichstand gibt.
	kandidaten.sort((a, b) => (b.gewicht - a.gewicht) || (b.nr - a.nr));
	return kandidaten;
}

/** `var(--eco-fill-art, X)` / `var(--eco-fill)` aufloesen und als Zahl zurueckgeben. */
function aufgeloest(wert, variablen) {
	let v = String(wert === null || wert === undefined ? "" : wert).trim();
	for (let runde = 0; runde < 5 && /^var\(/.test(v); runde += 1) {
		const m = v.match(/^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/);
		if (!m) { break; }
		v = (Object.prototype.hasOwnProperty.call(variablen, m[1])
			? String(variablen[m[1]])
			: String(m[2] || "")).trim();
	}
	return Number(v);
}

const PANE_AKTIV = new Set([
	"leaflet-pane", "ecosystem-pane", "ecosystem-pane--topographie", "ecosystem-pane--active",
]);
const PANE_RUHEND = new Set([
	"leaflet-pane", "ecosystem-pane", "ecosystem-pane--topographie", "ecosystem-pane--resting",
]);
const pfad = (...extra) => new Set(["leaflet-interactive"].concat(extra));

// 💣 Der Loeser muss das HEUTIGE Bild erst einmal reproduzieren, sonst messen alle Zusicherungen
// darunter nur seine eigenen Fehler.
{
	const ohneZustand = fillOpacityKandidaten(PANE_AKTIV, pfad());
	assert.ok(ohneZustand.length > 0, "der Loeser findet ueberhaupt eine Fuellungsregel");
	assert.strictEqual(aufgeloest(ohneZustand[0].wert, { "--eco-fill-art": 0.72 }), 0.72,
		"ohne Zustand gewinnt der Wert je Flaeche");
	const ruhend = fillOpacityKandidaten(PANE_RUHEND, pfad());
	assert.strictEqual(
		aufgeloest(ruhend[0].wert, { "--eco-fill": Number(ecoFillDerPane(PANE_RUHEND)) }), 0,
		"und eine ruhende Flaeche ist unsichtbar -- das heutige Bild, und der Loeser sieht es");
}

// ---- H1. DIE EIGENTLICHE ZUSICHERUNG: Wasser unter dem Zeiger traegt 1, nicht 0,8 --------------
const wasserHervor = fillOpacityKandidaten(PANE_AKTIV,
	pfad("ecosystem-area--wasser", "ecosystem-area--highlight"));
assert.strictEqual(aufgeloest(wasserHervor[0].wert, { "--eco-fill-art": 1 }), 1,
	"🔴 Eine WASSERFLAECHE behaelt beim Ueberfahren und Anklicken ihre Deckkraft 1 -- gewonnen hat aber: "
	+ wasserHervor[0].sel);
assert.ok(/ecosystem-area--wasser/.test(wasserHervor[0].sel),
	"und zwar ueber die Wasser-Regel, nicht zufaellig ueber eine andere");

// 💣 KEIN GLEICHSTAND. Bei gleicher Staerke entschiede die Reihenfolge im Blatt, und die kippt beim
// naechsten Verschieben eines Blocks -- genau die Abhaengigkeit, die dieses Blatt an drei Stellen
// ausdruecklich vermeidet.
assert.ok(wasserHervor.length > 1,
	"es gibt ueberhaupt eine Verfolgerin -- sonst prueft der Vergleich darunter nichts");
assert.ok(wasserHervor[0].gewicht > wasserHervor[1].gewicht,
	`Die Wasser-Regel hat ${wasserHervor[0].gewicht} Klassen, ihre staerkste Verfolgerin`
	+ ` ${wasserHervor[1].gewicht} (${wasserHervor[1].sel}). Bei Gleichstand entschiede die Reihenfolge im Blatt.`);

// Und dasselbe fuer die ZIELWAHL einer booleschen Operation (`--target`, eigene Zahl 0,42).
const wasserZiel = fillOpacityKandidaten(PANE_AKTIV,
	pfad("ecosystem-area--wasser", "ecosystem-area--selected", "ecosystem-area--target"));
assert.strictEqual(aufgeloest(wasserZiel[0].wert, { "--eco-fill-art": 1 }), 1,
	"auch die Zielwahl nimmt dem Wasser seine Deckkraft nicht -- gewonnen hat: " + wasserZiel[0].sel);

// ---- H2. DIE GEGENPROBE IST DIE WICHTIGERE: ausgenommen ist das WASSER, nicht der Zustand ------
// Ohne sie verlieren Hervorhebung und Zielwahl ihre Wirkung auf ALLEN Flaechen, und niemand merkt es,
// weil der gemeldete Fall dann trotzdem stimmt.
const gebirgeHervor = fillOpacityKandidaten(PANE_AKTIV, pfad("ecosystem-area--highlight"));
assert.strictEqual(aufgeloest(gebirgeHervor[0].wert, { "--eco-fill-art": 0.72 }), 0.8,
	"ein Gebirge unter dem Zeiger leuchtet weiterhin auf 0,8 -- gewonnen hat: " + gebirgeHervor[0].sel);
const gebirgeZiel = fillOpacityKandidaten(PANE_AKTIV, pfad("ecosystem-area--target"));
assert.strictEqual(aufgeloest(gebirgeZiel[0].wert, { "--eco-fill-art": 0.72 }), 0.42,
	"und die Zielwahl faerbt es weiter auf 0,42 -- gewonnen hat: " + gebirgeZiel[0].sel);

// ---- H3. 🔴 RUHEND BLEIBT UNSICHTBAR -- `--active` ist tragend ---------------------------------
// Ohne die Klasse im Selektor truege eine ruhende Wasserflaeche ihre Deckkraft mit, und ein
// Topographie-See stuende in der Vegetationsansicht. Ueber „Alle" laege wieder das Farbnetz, das
// AGENTS.md §12 abgeschafft hat.
const wasserRuhend = fillOpacityKandidaten(PANE_RUHEND, pfad("ecosystem-area--wasser"));
assert.strictEqual(
	aufgeloest(wasserRuhend[0].wert,
		{ "--eco-fill-art": 1, "--eco-fill": Number(ecoFillDerPane(PANE_RUHEND)) }), 0,
	"🔴 Eine ruhende Wasserflaeche bleibt unsichtbar -- gewonnen hat: " + wasserRuhend[0].sel);

// ---- H4. 🔴 DIE WAHL DES OWNERS GEWINNT AUCH HIER ---------------------------------------------
// `var(--eco-fill-art, 1)` und nicht `1`: mit festem 1 waere sein Regler fuer diese Flaeche tot, und
// ein Regler, dessen Wert nirgends gilt, ist von einem kaputten Formular nicht zu unterscheiden
// (AGENTS.md §11).
assert.strictEqual(aufgeloest(wasserHervor[0].wert, { "--eco-fill-art": 0.4 }), 0.4,
	"eine im Fenster gespeicherte Deckkraft von 0,4 gilt auch unter dem Zeiger");
// ⚠️ Der Rueckfall ist die 1, nicht der Panewert: ohne ecosystem-display.js setzt niemand die Klasse,
// die Regel passt dann nie -- aber wenn doch, soll der See deckend sein und nicht ruhend.
assert.strictEqual(aufgeloest(wasserHervor[0].wert, {}), 1,
	"ohne eigenen Wert faellt die Wasser-Regel auf 1 zurueck");

// ---- H5. Nur die DECKKRAFT -- Farbe und Kontur der Zustaende bleiben --------------------------
// ⚠️ Die Zielwahl faerbt weiter golden um und behaelt Schein und Trefferband, die Auswahl ihre weisse
// Kontur. Die Wasser-Regel nimmt den Zustaenden nur die ZAHL.
const wasserRegeln = alleRegeln.filter((r) => /ecosystem-area--wasser/.test(r.sel));
assert.strictEqual(wasserRegeln.length, 1,
	"es gibt GENAU eine Wasser-Regel -- zwei waeren zwei Wahrheiten ueber dieselbe Deckkraft");
assert.ok(/^\s*fill-opacity\s*:[^;]+;?\s*$/.test(wasserRegeln[0].body),
	"sie setzt AUSSCHLIESSLICH fill-opacity -- Rumpf: " + JSON.stringify(wasserRegeln[0].body.trim()));
assert.ok(alleRegeln.filter((r) => /ecosystem-area--target/.test(r.sel))
	.some((r) => /(^|[;\s])fill\s*:/.test(r.body)),
	"und die Zielwahl faerbt weiterhin um");

// ---- H6. Die Klasse kommt aus der GETEILTEN Liste, und sie wird wirklich gesetzt --------------
// ⭐ AUSGEFUEHRT, nicht gelesen: ein Regex kennt keinen Geltungsbereich, und eine Zusicherung, die nur
// den Quelltext sieht, bleibt gruen, wenn der Aufruf in einer anderen Funktion landet.
// ⚠️ Zeilenendenneutral geschnitten -- hier ist CRLF, im Deploy-Tor LF (AGENTS.md §9).
const renderingLF = rendering.split(String.fromCharCode(13)).join("");
const vonDeck = renderingLF.indexOf("function applyEcosystemAreaDeckkraft(");
assert.ok(vonDeck >= 0, "die Funktion, die die Deckkraft an den Pfad haengt");
const rumpfDeck = renderingLF.slice(vonDeck, renderingLF.indexOf(LF + "}", vonDeck) + 2);
assert.ok(rumpfDeck.endsWith("}"), "und ihr Rumpf ist vollstaendig ausgeschnitten");

// 💣 SIE NENNT KEINE ART. Welche Flaechen Wasser sind, sagt AVESMAPS_ECOSYSTEM_DISPLAY_WASSERFLAECHEN
// und sonst nichts -- eine zweite Liste liefe beim naechsten Zuwachs auseinander.
assert.ok(/avesmapsEcosystemDisplayGlobaleDeckkraftGilt/.test(rumpfDeck), "sie fragt die geteilte Regel");
assert.ok(!/"see"|'see'|WASSERFLAECHEN/.test(rumpfDeck),
	"und nennt selbst keine Art und keine zweite Liste");

function fahreDeckkraft(area, tafel) {
	avesmapsEcosystemDisplayInstall(tafel || null);
	const klassen = new Set();
	const element = {
		style: { props: {}, setProperty(n, v) { this.props[n] = v; } },
		classList: { toggle(name, an) { if (an) { klassen.add(name); } else { klassen.delete(name); } } },
	};
	vm.runInNewContext(
		rumpfDeck + LF + "applyEcosystemAreaDeckkraft(_layer);",
		{
			_layer: { getElement: () => element, _ecosystemArea: area },
			avesmapsEcosystemDisplayDeckkraft,
			avesmapsEcosystemDisplayGlobaleDeckkraftGilt,
		},
		{ filename: "applyEcosystemAreaDeckkraft (ausgeschnitten)" }
	);
	return { klassen, props: element.style.props };
}

const see = fahreDeckkraft({ kind: "topographie", region_type: "see" });
assert.ok(see.klassen.has("ecosystem-area--wasser"),
	"🔴 Die Seeflaeche bekommt die Klasse, mit der sie ihre Deckkraft gegen die Zustaende haelt");
assert.strictEqual(see.props["--eco-fill-art"], "1", "und ihren Wert dazu");

assert.ok(!fahreDeckkraft({ kind: "topographie", region_type: "gebirge" })
	.klassen.has("ecosystem-area--wasser"),
	"💣 Das Gebirge derselben Ebene bekommt sie NICHT -- sonst verloeren die Zustaende ueberall ihre Wirkung");
assert.ok(!fahreDeckkraft({ kind: "topographie", region_type: "meer" })
	.klassen.has("ecosystem-area--wasser"),
	"und das Meer ebenso: die Liste sagt, was Wasser ist, nicht der Name");

// ⚠️ Auch mit gespeichertem eigenem Wert bleibt die Klasse -- sie entscheidet, WER uebersteuern darf,
// nicht WELCHE Zahl gilt. Ohne sie fiele der durchscheinende See unter dem Zeiger wieder auf 0,8.
const seeGestellt = fahreDeckkraft({ kind: "topographie", region_type: "see" },
	{ deckkraft: { "topographie:see": 0.4 } });
assert.ok(seeGestellt.klassen.has("ecosystem-area--wasser"),
	"die Klasse haengt an der ART, nicht an der Zahl");
assert.strictEqual(seeGestellt.props["--eco-fill-art"], "0.4", "und der gestellte Wert reist mit");
avesmapsEcosystemDisplayInstall(null);

// ---- H7. Nachgezogen wird sie an ALLEN Stellen, ohne eine eigene Verdrahtung ------------------
// 💣 Die Klasse haengt an der ART und sitzt deshalb IN applyEcosystemAreaDeckkraft -- damit laeuft sie
// beim frischen Aufbau und beim Umtypisieren (beide in Abschnitt C festgenagelt) und beim Nachziehen
// einer geladenen Tafel. Eine vierte Verdrahtung waere die Falle, die dieses Haus schon mehrfach
// bezahlt hat: eine Regel, die einen von vier Erzeugern bindet, ist keine Regel.
const vonRefresh = renderingLF.indexOf("function avesmapsRefreshEcosystemDisplay(");
assert.ok(vonRefresh >= 0, "den Nachzieher gibt es");
assert.ok(/applyEcosystemAreaDeckkraft\(/.test(
	renderingLF.slice(vonRefresh, renderingLF.indexOf(LF + "}", vonRefresh) + 2)),
	"und er geht durch dieselbe Funktion -- die Klasse kommt damit ohne eigene Zeile mit");
// 🪤 Und NICHT in applyEcosystemHighlightClass: dort waere sie ein Zustand, und ein Zustand, der die
// ART beschreibt, laeuft beim ersten Umtypisieren auseinander.
const vonHervor = renderingLF.indexOf("function applyEcosystemHighlightClass(");
assert.ok(!/ecosystem-area--wasser/.test(
	renderingLF.slice(vonHervor, renderingLF.indexOf(LF + "}", vonHervor) + 2)),
	"🪤 die Hervorhebung setzt sie nicht -- sie ist keine Zustandsklasse");

console.log("ecosystem-display-flaeche: alle Zusicherungen gruen");
