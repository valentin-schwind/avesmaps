// Aufgabe 14 des Garetien Importers -- die Karte: was gezeigt wird, leuchtet, und man sieht,
// WESSEN Fassung es ist.
// Auftrag: docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md §5.5
// Brief:   .superpowers/sdd/2026-08-27-garetien-importer-fenster/task-14-brief.md
// Mockup:  docs/garetien-importer-mockup.html §2
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-karte.test.js
//
// 🔴 Gefahren wird der ECHTE Zeichner gegen eine gefaelschte Leaflet-Karte -- nicht der Quelltext
// gelesen. Der Zeichner nimmt seine Karte HEREIN (dieselbe Bauform wie js/ui/karten-abzug.js), und
// `L` liest er zur Laufzeit aus dem globalen Raum; beides laesst sich in Node stellen. Gemessen
// wird deshalb ueberall am ERGEBNIS: welche Ebenen liegen danach auf der Karte, mit welchen
// Punkten, in welcher Farbe, in welcher Reihenfolge.
// 🪤 Die Fehlerklasse dieses Vorhabens ist die VAKUUM-Zusicherung. Jede Zahl hier ist deshalb aus
// der Fixture herleitbar und im Kommentar hergeleitet, und jeder Filter wird an der DIFFERENZ
// gemessen (was faellt weg) statt an einem Vorhandensein.

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const WURZEL = path.resolve(__dirname, "..", "..", "..");

let checks = 0;
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}
function tief(ist, soll, warum) {
	assert.deepStrictEqual(ist, soll, warum || "");
	checks++;
}

// ---- Die gefaelschte Karte und das gefaelschte Leaflet -----------------------------------------
//
// Sie bilden genau die Zuege nach, die der Zeichner benutzt, und zwar mit Leaflets Semantik:
// `layerGroup.addLayer` legt das Kind auf die Karte, WENN die Gruppe darauf liegt; `clearLayers`
// nimmt es wieder herunter. Ohne diese Kopplung waere „das Erloeschen laesst Leichen zurueck"
// nicht messbar.
// 💣 `createPane` ZAEHLT hier seine Aufrufe. Leaflet 1.9.4 prueft NICHT, ob es die Pane schon
// gibt -- es legt jedes Mal ein NEUES <div> an und haengt das alte, samt der darin gezeichneten
// Ebenen, unerreichbar im DOM ab. Ein zweiter Aufruf ist deshalb kein Leerlauf, sondern genau die
// Doppelanmeldung, die dieses Haus schon zweimal bezahlt hat.
function gefaelschteKarte() {
	const drin = [];
	return {
		panes: {},
		paneAufrufe: 0,
		fluege: [],
		createPane(name) {
			this.paneAufrufe++;
			this.panes[name] = { name: name, style: {}, classList: { add() {} } };
			return this.panes[name];
		},
		getPane(name) { return this.panes[name]; },
		addLayer(schicht) {
			if (drin.indexOf(schicht) === -1) {
				drin.push(schicht);
				schicht._karte = this;
				(schicht._kinder || []).forEach((kind) => this.addLayer(kind));
			}
			return this;
		},
		removeLayer(schicht) {
			const i = drin.indexOf(schicht);
			if (i !== -1) { drin.splice(i, 1); }
			schicht._karte = null;
			(schicht._kinder || []).slice().forEach((kind) => this.removeLayer(kind));
			return this;
		},
		hasLayer(schicht) { return drin.indexOf(schicht) !== -1; },
		flyToBounds(kasten, optionen) { this.fluege.push({ art: "fly", kasten, optionen }); },
		fitBounds(kasten, optionen) { this.fluege.push({ art: "fit", kasten, optionen }); },
		// Die gezeichneten Ebenen -- die Gruppe selbst zaehlt nicht mit, sie ist der Behaelter.
		ebenen() { return drin.filter((s) => s._art === "polyline"); },
		alles() { return drin.slice(); },
	};
}

// `_bauer` haelt fest, OB `L.polygon`, `L.polyline` oder `L.circleMarker` gerufen wurde -- eine
// Flaeche ist bei Leaflet ein anderer Bauer, nicht bloss eine andere Option, und genau das ist die
// Aussage. `_tooltip` haelt fest, WAS `bindTooltip` bekommen hat: der Tooltip ist die zweite
// Haelfte dieser Aufgabe („dass ich seh welches objekt welchs ist"), und im DOM waere er nicht
// messbar -- ein Leaflet-Tooltip bleibt nach dem Schliessen noch rund 400 ms als Leiche stehen.
function gefaelschteEbene(bauer, punkte, optionen) {
	return {
		_art: "polyline", _bauer: bauer, _punkte: punkte, _karte: null, _tooltip: null,
		options: optionen || {},
		bindTooltip(text, opt) { this._tooltip = { text: text, optionen: opt || {} }; return this; },
		addTo(k) { k.addLayer(this); return this; },
		remove() { if (this._karte) { this._karte.removeLayer(this); } return this; },
	};
}

global.L = {
	polyline(punkte, optionen) { return gefaelschteEbene("polyline", punkte, optionen); },
	polygon(punkte, optionen) { return gefaelschteEbene("polygon", punkte, optionen); },
	circleMarker(punkt, optionen) { return gefaelschteEbene("circleMarker", [punkt], optionen); },
	layerGroup() {
		return {
			_art: "group", _kinder: [], _karte: null,
			addTo(k) { k.addLayer(this); return this; },
			addLayer(s) {
				this._kinder.push(s);
				if (this._karte) { this._karte.addLayer(s); }
				return this;
			},
			clearLayers() {
				this._kinder.slice().forEach((s) => { if (this._karte) { this._karte.removeLayer(s); } });
				this._kinder = [];
				return this;
			},
			getLayers() { return this._kinder.slice(); },
			remove() {
				this.clearLayers();
				if (this._karte) { this._karte.removeLayer(this); }
				return this;
			},
		};
	},
	latLngBounds(punkte) { return { _punkte: punkte }; },
};

// Die zwei Farben kommen aus Tokens, nie als Zahl aus dem Zeichner (AGENTS.md §12). Leaflet-
// Pfadoptionen nehmen kein `var()`, sie werden also ausgelesen -- hier gestellt, damit die
// Zusicherungen darunter beweisen, dass wirklich DIESER Weg genommen wird.
// 🔴 ZWEI verschiedene Werte, und der Test haelt sie gegeneinander: waeren sie gleich, koennte
// „ihre ist Gold und unsere Magenta" nichts belegen -- das ist die Vakuum-Falle dieser Aufgabe.
const GOLD = "#f0b429";
const MAGENTA = "#b5279b";
// Aufgabe 3 (Sicht-Tafel): zwei weitere gestellte Werte, damit die Zusicherungen unten wirklich
// eine DIFFERENZ messen -- „ihre Form traegt jetzt ihre echte Kartenfarbe" waere mit GOLD als
// Fake-Wert Vakuum, weil man es nicht von der alten Farbe unterscheiden koennte.
const WASSER = "#2f7fae";
const GEBIRGE = "#7a6c5e";
let tokenAbfragen = [];
// ⚠️ Vollstaendig genug, dass auch review-garetien-importer.js (Abschnitt 12) darin starten kann:
// dessen `hasDocument` ist ein `typeof document !== "undefined"`, und sein boot() greift dann
// wirklich zu. Ein halbes `document` liesse ihn beim require werfen.
global.document = {
	documentElement: {},
	readyState: "complete",
	getElementById() { return null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
const TOKEN_WERTE = {
	"--color-marker-active": GOLD,
	"--color-garetien-unsere": MAGENTA,
	"--color-path-flussweg": WASSER,
	"--color-ecosystem-topographie-gebirge": GEBIRGE,
};
global.getComputedStyle = function (element) {
	return {
		getPropertyValue(name) {
			tokenAbfragen.push(name);
			if (element !== global.document.documentElement) { return ""; }
			return TOKEN_WERTE[name] || "";
		},
	};
};

const mod = require(path.resolve(__dirname, "..", "review-garetien-karte.js"));
const {
	avesmapsGaretienNachLeaflet,
	avesmapsGaretienUnsereIds,
	garetienRingSchliesst,
	garetienTitelIhre,
	garetienTitelUnsere,
	avesmapsGaretienKarteZeigen,
	avesmapsGaretienKarteFliegen,
	avesmapsGaretienKarteSicht,
	avesmapsGaretienKarteUmschalten,
	avesmapsGaretienKarteAus,
} = mod;

wahr(typeof avesmapsGaretienNachLeaflet === "function", "avesmapsGaretienNachLeaflet fehlt im Export");
wahr(typeof avesmapsGaretienUnsereIds === "function", "avesmapsGaretienUnsereIds fehlt im Export");
wahr(typeof avesmapsGaretienKarteZeigen === "function", "avesmapsGaretienKarteZeigen fehlt im Export");
wahr(typeof avesmapsGaretienKarteFliegen === "function", "avesmapsGaretienKarteFliegen fehlt im Export");
wahr(typeof avesmapsGaretienKarteAus === "function", "avesmapsGaretienKarteAus fehlt im Export");
wahr(typeof avesmapsGaretienKarteSicht === "function", "avesmapsGaretienKarteSicht fehlt im Export");
wahr(typeof avesmapsGaretienKarteUmschalten === "function",
	"avesmapsGaretienKarteUmschalten fehlt im Export");

const IHRE = mod.AVESMAPS_GARETIEN_KLASSE_IHRE;
const UNSERE = mod.AVESMAPS_GARETIEN_KLASSE_UNSERE;
const SCHEIN = mod.AVESMAPS_GARETIEN_KLASSE_SCHEIN;
// Aufgabe 3 (RULING R8): der NEUE goldene Hof unter IHRER Form -- eigene Klasse, siehe
// review-garetien-karte.js und css/components/garetien-importer.css.
const SCHEIN_IHRE = mod.AVESMAPS_GARETIEN_KLASSE_SCHEIN_IHRE;
const IHRE_PANE = mod.AVESMAPS_GARETIEN_IHRE_PANE;
const UNSERE_PANE = mod.AVESMAPS_GARETIEN_UNSERE_PANE;
// Ohne diese Zeilen misst alles darunter „irgendeine Klasse gegen sich selbst".
wahr(IHRE !== UNSERE && UNSERE !== SCHEIN && IHRE !== SCHEIN
	&& SCHEIN_IHRE !== IHRE && SCHEIN_IHRE !== UNSERE && SCHEIN_IHRE !== SCHEIN,
	"die vier Klassennamen muessen verschieden sein, sonst trennt keine Zusicherung darunter etwas");
wahr(IHRE_PANE !== UNSERE_PANE, "die zwei Panes muessen verschieden heissen");
wahr(typeof mod.avesmapsGaretienSichtFuer === "function",
	"avesmapsGaretienSichtFuer fehlt im Export -- Aufgabe 4 braucht ihn");

function nach(karte, klasse) {
	return karte.ebenen().filter((e) => e.options.className === klasse);
}

// ---- 1. GeoJSON [x, y] -> Leaflet [lat, lng] = [y, x] -----------------------------------------
//
// 💣 Die Falle aus AGENTS.md §5, und sie hat in Aufgabe 4b dieses Vorhabens schon einen Critical
// gekostet (jeder importierte Weg lag gespiegelt). Gemessen wird an einem Punkt WEIT ab der
// Diagonale und gegen ein LITERAL -- `f(x)` gegen `f(x)` zu halten waere Vakuum, und auf der
// Diagonale ist der Fehler unsichtbar.
tief(avesmapsGaretienNachLeaflet([[10, 20], [30, 40]]), [[20, 10], [40, 30]],
	"x und y muessen getauscht werden -- L.CRS.Simple liest [lat, lng].");

// Die Gegenprobe zur Gegenprobe: auf der Diagonale sagt dasselbe Ergebnis GAR NICHTS aus. Der
// Wert dieser Zeile ist, dass sie den blinden Fleck benennt, statt ihn zu benutzen.
tief(avesmapsGaretienNachLeaflet([[7, 7]]), [[7, 7]],
	"ein Punkt auf der Diagonale ist getauscht wie ungetauscht -- er darf nie der Beleg sein");

// Die Eingabe bleibt unberuehrt -- sie ist die Serverantwort, und die Einzelansicht liest sie
// weiter. Eine an Ort und Stelle gedrehte Liste laege beim zweiten Zeichnen wieder richtig herum.
const eingabe = [[1, 2]];
avesmapsGaretienNachLeaflet(eingabe);
tief(eingabe, [[1, 2]], "die Punktliste der Antwort darf nicht an Ort und Stelle gedreht werden");

// Nichts, Unfug und halbe Punkte fallen still heraus -- eine NaN-Koordinate reisst sonst die
// ganze Karte mit (Leaflet rechnet damit weiter, bis eine Transformation NaN wird).
tief(avesmapsGaretienNachLeaflet(null), [], "ohne Punkte kommt eine leere Liste heraus");
tief(avesmapsGaretienNachLeaflet([[1, 2], [3], ["a", "b"], [4, 5]]), [[2, 1], [5, 4]],
	"halbe und unzahlige Punkte fallen heraus, die gueltigen bleiben in ihrer Reihenfolge");

// ---- 2. Gezeichnet werden NUR die Abschnitte, die das Haekchen wirklich aendert ---------------
//
// 💣 Ihre Natter laeuft ueber fuenf unserer Abschnitte; geaendert wird EINER. Der ganzen Kette
// eine Magenta-Form zu geben behauptete, alle fuenf wuerden umbenannt -- genau der Fehler, den die
// Einzelansicht aus Aufgabe 13 verhindern soll. Quelle ist deshalb `item.abschnitt.public_id` der
// ANGEHAKTEN Items, nie `objekt.abschnitte`.
const natter = {
	key: "ggp:Gewaesser:Fluss:Natter",
	name: "Natter",
	urteil: "ergaenzung",
	// Aufgabe 3 (Sicht-Tafel): ohne `ebene` waere jedes Objekt hier NEUTRAL -- ein echtes
	// Serverobjekt traegt `ebene` immer, das gehoert also in die Fixture.
	ebene: "Gewaesser",
	geometrie_typ: "LineString",
	// Weit ab der Diagonale, und je Abschnitt anders -- nur so belegt der Vergleich unten, dass
	// wirklich w-6120 und nicht irgendein Abschnitt gezeichnet wurde.
	geometrie: [[100, 700], [110, 720], [120, 760]],
	abschnitte: [
		{ public_id: "w-4471", name: "Natter", punkte: 9, geometrie: [[300, 900], [310, 910]] },
		{ public_id: "w-5008", name: "Gardel", punkte: 6, geometrie: [[400, 200], [410, 210]] },
		{ public_id: "w-6120", name: "", punkte: 1, geometrie: [[101, 702], [119, 758]] },
	],
	items: [
		{ id: 12, anlass: "ergaenzung", selected: 1, abschnitt: { public_id: "w-6120" } },
		{ id: 11, anlass: "ergaenzung", selected: 0, abschnitt: { public_id: "w-4471" } },
	],
};
tief(avesmapsGaretienUnsereIds(natter), ["w-6120"],
	"Gezeichnet gehoeren NUR die Abschnitte, die das Haekchen aendert. Der ganzen Kette eine Form "
	+ "zu geben behauptet, alle fuenf wuerden umbenannt.");

// Die DIFFERENZ, ohne die der Filter Vakuum waere: mit beiden Haken sind es zwei, und die
// Reihenfolge ist die der Items.
const natterBeide = JSON.parse(JSON.stringify(natter));
natterBeide.items[1].selected = 1;
tief(avesmapsGaretienUnsereIds(natterBeide), ["w-6120", "w-4471"],
	"mit zwei Haken liegen zwei Abschnitte da -- sonst filtert die Zeile darueber gar nicht");

// `selected` kommt vom Server als 0/1-ZAHL, nie als Bool (garetien-liste.php: `(int) $roh[...]`).
// Ein `=== true` laese live „nichts angehakt" -- dieselbe Falle, die die Wiki-Zuweisung bezahlt hat.
tief(avesmapsGaretienUnsereIds({ items: [{ id: 1, selected: 1, abschnitt: { public_id: "w-1" } }] }),
	["w-1"], "`selected` ist eine ZAHL -- ein Vergleich auf `=== true` sieht live nie ein Haekchen");
tief(avesmapsGaretienUnsereIds({ items: [{ id: 1, selected: 0, abschnitt: { public_id: "w-1" } }] }),
	[], "ohne Haken liegt nichts da");

// Mehrere Items koennen denselben Abschnitt nennen (Luecke + Umbenennung + Geometrie) -- er
// bekommt EINE Form, nicht drei uebereinander.
tief(avesmapsGaretienUnsereIds({ items: [
	{ id: 1, selected: 1, abschnitt: { public_id: "w-9" } },
	{ id: 2, selected: 1, abschnitt: { public_id: "w-9" } },
] }), ["w-9"], "derselbe Abschnitt zweimal genannt ergibt EINE Form");

// Ein Item ohne Abschnitt (reines Quellen-Item am Neu-Fall) nennt nichts -- und darf auch nichts
// erfinden.
tief(avesmapsGaretienUnsereIds({ urteil: "neu", abschnitte: [], items: [{ id: 1, selected: 1 }] }),
	[], "ein neues Objekt hat von uns nichts zu zeigen");
tief(avesmapsGaretienUnsereIds(null), [], "ohne Objekt liegt nichts da");
tief(avesmapsGaretienUnsereIds({ items: [] }), [], "ohne Items liegt nichts da");

// ---- 3. Zeichnen: ZWEI FARBEN, und jede Partei in ihrer eigenen Pane --------------------------
//
// Die Zahlen unten sind aus DIESEN drei Objekten hergeleitet, nicht abgeschrieben:
//   natter   -> 1 ihr Hof + 1 ihre Form + 1 unsere Hof + 1 unsere Form (w-6120)
//   alke     -> 1 ihr Hof + 1 ihre Form + 1 unsere Hof + 1 unsere Form (w-5112)
//   blutmoor -> 1 ihr Hof + 1 ihre Form + 0             + 0             (Urteil `neu`: bei uns
//               liegt dort nichts, also nennt kein Item einen Abschnitt -- garetien-plan.php
//               gibt einem `neu` gar keine Trefferliste mit, avesmapsGaretienUrteilNenntTreffer)
// macht 3 ihre Hoefe, 3 ihre Formen, 2 unsere Hoefe, 2 unsere Formen = 10 Ebenen (seit Aufgabe 3,
// RULING R8: JEDES ihre Objekt bekommt jetzt unconditioned auch einen Hof, nicht nur unsere Seite).
const alke = {
	key: "ggp:Gewaesser:Bach:Alke", name: "Alke", urteil: "ergaenzung", ebene: "Gewaesser",
	geometrie_typ: "LineString",
	geometrie: [[500, 60], [520, 80]],
	abschnitte: [{ public_id: "w-5112", name: "", punkte: 12, geometrie: [[502, 62], [518, 78]] }],
	items: [{ id: 21, anlass: "ergaenzung", selected: 1, abschnitt: { public_id: "w-5112" } }],
};
const blutmoor = {
	key: "ggp:Gewaesser:Sumpf:Blutmoor", name: "Blutmoor", urteil: "neu", ebene: "Gewaesser",
	geometrie_typ: "Polygon",
	geometrie: [[800, 300], [860, 320], [840, 360], [800, 300]],
	abschnitte: [],
	items: [{ id: 31, anlass: null, selected: 1 }],
};

const karte = gefaelschteKarte();
tokenAbfragen = [];
avesmapsGaretienKarteZeigen([natter, blutmoor, alke], karte);

const ebenen = karte.ebenen();
gleich(ebenen.length, 10,
	"drei ihrer Geometrien MIT je einem eigenen Hof, zwei von uns MIT je einem eigenen Hof -- nur "
	+ "das Blutmoor ist `neu` und hat von uns nichts zu zeigen (Aufgabe 3, RULING R8)");
gleich(nach(karte, IHRE).length, 3, "jedes gezeigte Objekt bekommt seine gestrichelte Geometrie");
gleich(nach(karte, UNSERE).length, 2, "nur natter und alke aendern einen Abschnitt von uns");
gleich(nach(karte, SCHEIN).length, 2, "und jede unserer Formen bekommt genau EINEN Hof");
gleich(nach(karte, SCHEIN_IHRE).length, 3,
	"NEU seit Aufgabe 3: jede IHRER Formen bekommt jetzt ebenfalls genau EINEN (goldenen) Hof");

// 🔴 DIE TRAGENDSTE ZUSICHERUNG DIESER AUFGABE, und sie misst die DIFFERENZ in EINER Probe: seit
// RULING R8 traegt IHRE Form ihre ECHTE Kartenfarbe (hier: Gewaesser -> --color-path-flussweg),
// nicht mehr Gold -- das Gold WANDERT in ihren neuen Hof. Unsere Seite bleibt unveraendert Magenta.
// Owner 29.08.2026: „ich weiss aber nicht, ob das die Garetien-Geometrie oder unsere eigene ist.
// voellig unklar."
nach(karte, IHRE).forEach((e) => {
	gleich(e.options.color, WASSER,
		"IHRE Form traegt seit RULING R8 die echte Kartenfarbe der Ebene (--color-path-flussweg), "
		+ "nicht mehr Gold");
});
nach(karte, SCHEIN_IHRE).forEach((e) => {
	gleich(e.options.color, GOLD, "IHR Hof ist GOLD (--color-marker-active) -- die Herkunft bleibt "
		+ "lesbar, auch wenn die Form selbst nicht mehr golden ist");
});
nach(karte, UNSERE).concat(nach(karte, SCHEIN)).forEach((e) => {
	gleich(e.options.color, MAGENTA, "UNSERE Geometrie ist unveraendert Magenta (--color-garetien-unsere)");
});
wahr(new Set([GOLD, MAGENTA, WASSER]).size === 3,
	"die drei gestellten Tokenwerte muessen sich unterscheiden -- sonst belegen die Zeilen darueber nichts");
wahr(tokenAbfragen.indexOf("--color-marker-active") !== -1
	&& tokenAbfragen.indexOf("--color-garetien-unsere") !== -1
	&& tokenAbfragen.indexOf("--color-path-flussweg") !== -1,
	"alle drei Tokens muessen abgefragt werden -- sonst steht mindestens eine Farbe irgendwo als Zahl");

// 💣 Die Strichelung ist die ZWEITE, unabhaengige Aussage: „Vorschlag" gegen „liegt schon da". Sie
// haengt an der Kante, nicht an der Farbe -- deshalb bleibt sie GESTRICHELT, obwohl die Farbe sich
// seit Aufgabe 3 geaendert hat.
nach(karte, IHRE).forEach((e) => {
	wahr(!!e.options.dashArray, "ihre Fassung ist GESTRICHELT -- sie steht noch nicht bei uns");
});
nach(karte, UNSERE).forEach((e) => {
	wahr(!e.options.dashArray, "unsere Fassung ist DURCHGEZOGEN -- sie liegt schon da");
	gleich(e.options.opacity, 1, "unsere Form ist die Aussage und wird nicht abgeschwaecht");
});
nach(karte, SCHEIN).concat(nach(karte, SCHEIN_IHRE)).forEach((schein) => {
	wahr(!schein.options.dashArray, "der Hof ist durchgezogen, nicht gestrichelt");
	wahr(schein.options.opacity < 1, "der Hof ist halbdurchsichtig, sonst deckt er die Form zu");
});
nach(karte, SCHEIN).forEach((schein) => {
	wahr(schein.options.weight > nach(karte, UNSERE)[0].options.weight,
		"unser Hof muss BREITER sein als unsere Form, sonst ist er kein Hof");
});
nach(karte, SCHEIN_IHRE).forEach((schein) => {
	wahr(schein.options.weight > nach(karte, IHRE)[0].options.weight,
		"ihr Hof muss BREITER sein als ihre Form, sonst ist er kein Hof");
});

// 🔴 IHR STRICH LIEGT OBEN. Ihre Linie liegt oft genau auf unserer; ihre Strichelung „9 5" laesst
// in 5 von 14 Pixeln unsere Farbe durch. Andersherum -- unsere DURCHGEZOGENE Linie oben -- waere
// von ihrem Vorschlag nichts mehr zu sehen.
const zIhre = Number(karte.getPane(IHRE_PANE).style.zIndex);
const zUnsere = Number(karte.getPane(UNSERE_PANE).style.zIndex);
wahr(zUnsere < zIhre, "ihre Pane muss UEBER unserer liegen -- gemessen " + zUnsere + " / " + zIhre);

// 💣 BEIDE UEBER `roadsPane` (400). Das ist die Aenderung vom 29.08.2026: unsere Magenta-Linie ist
// 3 px breit wie unsere eigene Flusslinie (PATH_CENTER_WEIGHTS.Flussweg = 3). Laege sie darunter,
// zeichnete unser eigenes Blau sich vollstaendig darueber -- die neue Farbe waere genau dort
// unsichtbar, wo man sie braucht.
wahr(zUnsere > 400,
	"unsere Form muss UEBER roadsPane (400) liegen, sonst deckt unsere eigene Flusslinie sie zu "
	+ "-- gemessen " + zUnsere);
wahr(zIhre < 470,
	"beide bleiben UNTER den Wegenamen (470) und den Ortsmarkierungen (500) -- gemessen " + zIhre);
gleich(zUnsere === 460 || zIhre === 460, false,
	"460 gehoert measurementPane (js/app/bootstrap.js) -- bei gleichem z-index entscheidet die "
	+ "Einfuegereihenfolge, und das ist keine Regel");
gleich(karte.getPane(IHRE_PANE).style.pointerEvents, "none",
	"die Pane selbst darf keine Zeigerereignisse annehmen -- nur die Formen darin");
gleich(karte.getPane(UNSERE_PANE).style.pointerEvents, "none",
	"die Pane selbst darf keine Zeigerereignisse annehmen -- nur die Formen darin");
nach(karte, IHRE).concat(nach(karte, SCHEIN_IHRE)).forEach((e) => {
	gleich(e.options.pane, IHRE_PANE, "ihre Form und ihr NEUER Hof gehoeren beide in ihre Pane");
});
nach(karte, UNSERE).concat(nach(karte, SCHEIN)).forEach((e) => {
	gleich(e.options.pane, UNSERE_PANE, "unsere Form und ihr Hof gehoeren in unsere Pane");
});

// Innerhalb UNSERER Pane entscheidet die Einfuegereihenfolge, und dort ist sie tragend: der Hof
// kommt VOR der Form, sonst deckt ein 13 px breites Band die 3 px schmale Linie zu.
// 💣 Und zwar ALLE Hoefe vor ALLEN Formen, nicht paarweise: zwei benachbarte Abschnitte desselben
// Flusses beruehren sich, und der Hof des zweiten laege sonst ueber der Form des ersten.
const ersterUnserer = ebenen.findIndex((e) => e.options.className === UNSERE);
const letzterHof = ebenen.map((e) => e.options.className === SCHEIN).lastIndexOf(true);
wahr(letzterHof < ersterUnserer,
	"alle Hoefe werden VOR allen Formen gelegt -- sonst deckt der breite Hof die Form zu");

// Aufgabe 3 (RULING R8): dieselbe Regel gilt jetzt auch IHRER Pane -- ihr NEUER Hof muss vor ihrer
// Form liegen, sonst deckt er sie zu.
const ersterIhrer = ebenen.findIndex((e) => e.options.className === IHRE);
const letzterHofIhre = ebenen.map((e) => e.options.className === SCHEIN_IHRE).lastIndexOf(true);
wahr(letzterHofIhre < ersterIhrer,
	"auch IHRE Hoefe werden VOR allen IHREN Formen gelegt");
gleich(nach(karte, SCHEIN_IHRE).length >= 2 && nach(karte, IHRE).length >= 2, true,
	"mit nur einem Objekt belegt die Reihenfolge-Zusicherung darueber nichts");

// Die DIFFERENZ, ohne die die Zeile darueber auch bei EINEM Abschnitt hielte: es sind zwei, und
// beide Hoefe liegen vor beiden Formen.
gleich(nach(karte, SCHEIN).length >= 2 && nach(karte, UNSERE).length >= 2, true,
	"mit nur einem Abschnitt belegt die Reihenfolge-Zusicherung darueber nichts");

// ---- 3b. Der Tooltip: WESSEN Fassung und WELCHES Objekt ---------------------------------------
//
// 🔴 Owner 29.08.2026: „dass ich seh welches objekt welchs ist". Gemessen wird, was `bindTooltip`
// bekommen hat -- im DOM waere es nicht messbar: ein Leaflet-Tooltip bleibt nach dem Schliessen
// rund 400 ms als Leiche stehen, `.leaflet-tooltip` zu zaehlen luegt also.
ebenen.forEach((e) => {
	gleich(e.options.interactive, true,
		"ohne `interactive` gibt es keinen Tooltip -- und der ist der halbe Auftrag");
	wahr(e._tooltip && typeof e._tooltip.text === "string" && e._tooltip.text !== "",
		"jede gezeichnete Form braucht ihren Tooltip");
	gleich(e._tooltip.optionen.sticky, true,
		"der Tooltip folgt dem Zeiger -- an einer langen Flusslinie stuende er sonst an deren "
		+ "Mittelpunkt, oft weit weg von der Stelle, auf die man zeigt");
});
const titelIhre = nach(karte, IHRE).map((e) => e._tooltip.text).sort();
tief(titelIhre, ["Garetien: Alke", "Garetien: Blutmoor", "Garetien: Natter"],
	"ihre Tooltips nennen die Partei und ihren Namen");
// 🔴 UNSERE Seite nennt UNSEREN Namen, nicht ihren -- das ist der Unterschied, um den es geht.
tief(nach(karte, UNSERE).map((e) => e._tooltip.text).sort(),
	["Avesmaps: ohne Namen (w-5112)", "Avesmaps: ohne Namen (w-6120)"],
	"unsere Tooltips nennen unseren Abschnitt samt public_id -- 25 von 76 Geometrietreffern tragen "
	+ "bei uns gar keinen Namen");
// Die DIFFERENZ: ein Abschnitt MIT eigenem Namen nennt genau diesen -- und eben NICHT ihren.
// (Ihre „Natter" laeuft ueber unseren „Gardel"; ein Tooltip, der beidesmal „Natter" saegte,
// beantwortete genau die Frage nicht, fuer die er da ist.)
gleich(garetienTitelUnsere(natter, "w-5008"), "Avesmaps: Gardel (w-5008)",
	"unser Tooltip nennt UNSEREN Namen");
gleich(garetienTitelIhre(natter), "Garetien: Natter", "ihr Tooltip nennt IHREN Namen");
wahr(garetienTitelUnsere(natter, "w-5008").indexOf("Natter") === -1,
	"unser Tooltip darf ihren Namen nicht tragen -- sonst sagt er nichts ueber unsere Seite");

// ---- 4. Unsere Form liegt auf dem RICHTIGEN Abschnitt ----------------------------------------
//
// 💣 Die scharfe Probe: nicht „es gibt eine Form", sondern „sie hat die Punkte von w-6120 und
// NICHT die von w-4471". Ohne diesen Vergleich waere Abschnitt 2 oben halb blind.
const natterUnsere = nach(karte, UNSERE).filter((s) => s._punkte.length === 2
	&& s._punkte[0][1] === 101)[0];
wahr(natterUnsere, "unsere Form der Natter ist nicht zu finden");
tief(natterUnsere._punkte, [[702, 101], [758, 119]],
	"sie traegt die getauschten Punkte von w-6120 -- nicht die von w-4471 ([[900,300],...])");

const natterIhre = nach(karte, IHRE).filter((s) => s._punkte.length === 3)[0];
tief(natterIhre._punkte, [[700, 100], [720, 110], [760, 120]],
	"ihre Geometrie wird getauscht gezeichnet");

// ---- 5. Das Erloeschen, und dass es keine Leichen zuruecklaesst -------------------------------

avesmapsGaretienKarteZeigen([], karte);
gleich(karte.ebenen().length, 0, "das Erloeschen laesst Leichen zurueck");

// Und die Menge WAECHST und SCHRUMPFT mit den Haken -- der Kern der Owner-Entscheidung vom
// 27.08.2026: „man hakt sich durch die Liste und sieht die Auswahl auf der Karte wachsen".
avesmapsGaretienKarteZeigen([natter], karte);
gleich(karte.ebenen().length, 4,
	"ein Objekt: ihre Form + ihr Hof + unsere Form + unser Hof (Aufgabe 3, RULING R8)");
avesmapsGaretienKarteZeigen([natter, alke], karte);
gleich(karte.ebenen().length, 8, "zwei Objekte: die Menge waechst");
avesmapsGaretienKarteZeigen([alke], karte);
gleich(karte.ebenen().length, 4, "ein Haken weg: nur dessen Zeichnung verschwindet");

// ---- 6. Idempotent: derselbe Aufruf zweimal ergibt dieselben Ebenen ---------------------------
//
// 🪤 Im Haus ist zweimal etwas an einer Doppelanmeldung gescheitert. Hier sind es zwei Stellen:
// die Ebenen (die sonst stapeln) und die PANE (Leaflets createPane legt jedes Mal ein neues <div>
// an und haengt das alte samt Inhalt unerreichbar ab).
avesmapsGaretienKarteZeigen([natter], karte);
const einmal = karte.ebenen().length;
const paneAufrufeVorher = karte.paneAufrufe;
avesmapsGaretienKarteZeigen([natter], karte);
gleich(karte.ebenen().length, einmal, "ein zweiter Aufruf stapelt Ebenen");
gleich(karte.paneAufrufe, paneAufrufeVorher,
	"createPane wurde ein zweites Mal gerufen -- Leaflet legt dann ein NEUES <div> an und die "
	+ "bisher gezeichneten Ebenen haengen unerreichbar im alten");
gleich(paneAufrufeVorher, 2, "es sind ZWEI Panes, und jede wird genau EINMAL angelegt");

// Und die Gruppe liegt genau EINMAL auf der Karte, nicht einmal je Aufruf.
gleich(karte.alles().filter((s) => s._art === "group").length, 1,
	"die Ebenengruppe wurde mehrfach auf die Karte gelegt");

// ---- 6b. Die zwei Sicht-Knoepfe: EIN Zustand, und der steht im `display` der Panes ------------
//
// 🔴 Owner 29.08.2026: „mach zwei farbige knöpfe und jeder der knöpfe zeigt in seiner farbe seine
// fläche an oder blendet sie aus. Dann kann man direkt vergleichen was besser ist." — und BEIDE
// starten AN.
tief(avesmapsGaretienKarteSicht(karte), { ihre: true, unsere: true },
	"beide Parteien starten sichtbar");
tief(avesmapsGaretienKarteUmschalten("ihre", karte), { ihre: false, unsere: true },
	"„Garetien\" aus: nur ihre Partei verschwindet");
gleich(karte.getPane(IHRE_PANE).style.display, "none",
	"ausgeblendet heisst `display: none` an der Pane -- daran und an nichts sonst haengt der Zustand");
gleich(karte.getPane(UNSERE_PANE).style.display, undefined,
	"unsere Pane darf davon nicht beruehrt werden -- sonst schaltet ein Knopf beide");
tief(avesmapsGaretienKarteUmschalten("unsere", karte), { ihre: false, unsere: false },
	"beide aus: der zweite Knopf schaltet den zweiten");
tief(avesmapsGaretienKarteUmschalten("ihre", karte), { ihre: true, unsere: false },
	"und wieder an -- der Knopf schaltet, er blendet nicht nur aus");

// 💣 EIN UNBEKANNTER NAME SCHALTET NICHTS. Ohne diesen Riegel blendete ein Tippfehler im
// `data-sicht`-Attribut die falsche Partei aus, und der Knopf saehe dabei richtig aus.
tief(avesmapsGaretienKarteUmschalten("quatsch", karte), { ihre: true, unsere: false },
	"ein unbekannter Name darf nichts umschalten");
tief(avesmapsGaretienKarteUmschalten(undefined, karte), { ihre: true, unsere: false },
	"und `undefined` erst recht nicht");

// 💣 UND EIN NEUZEICHNEN DARF DEN ZUSTAND NICHT ZURUECKNEHMEN. `garetienPaneSicherstellen` laeuft
// bei JEDEM Zeichnen und setzt z-index und pointer-events neu -- fasste es dabei `display` an,
// waere jede Ausblendung beim naechsten Haekchen wieder weg.
avesmapsGaretienKarteZeigen([natter, alke], karte);
tief(avesmapsGaretienKarteSicht(karte), { ihre: true, unsere: false },
	"ein Neuzeichnen darf eine ausgeblendete Partei nicht wieder einblenden");

// ---- 7. Fenster zu -> die Karte ist sauber UND die Sicht zurueckgesetzt -----------------------
//
// 💣 Ein zurueckgelassener Strich auf der oeffentlichen Karte waere der schlimmste Ausfall dieser
// Aufgabe: der Besucher saehe farbige Striche ohne jede Erklaerung.
// 💣 Und die zweite Haelfte: bliebe eine Partei ueber das Schliessen hinaus ausgeblendet, zeigte
// die Karte beim naechsten Oeffnen nur eine Farbe -- waehrend beide Knoepfe „an" saegen, denn die
// Knoepfe lesen genau diesen Zustand. „Beide starten AN" ist eine Owner-Vorgabe.
avesmapsGaretienKarteAus(karte);
gleich(karte.ebenen().length, 0, "nach dem Schliessen darf nichts liegenbleiben");
gleich(karte.alles().length, 0, "auch die Ebenengruppe selbst muss von der Karte herunter");
tief(avesmapsGaretienKarteSicht(karte), { ihre: true, unsere: true },
	"das Schliessen setzt beide Parteien wieder auf sichtbar");

// Zweimal abraeumen ist kein Fehler (das Fenster laesst sich zweimal schliessen).
avesmapsGaretienKarteAus(karte);
gleich(karte.ebenen().length, 0, "zweimal abraeumen darf nicht werfen");

// Und danach zeichnet es wieder -- der Zustand ist die Gruppe, kein Schalter daneben, der haengen
// bleiben koennte.
avesmapsGaretienKarteZeigen([alke], karte);
gleich(karte.ebenen().length, 4, "nach dem Abraeumen muss ein neues Zeichnen wieder ankommen");
avesmapsGaretienKarteAus(karte);

// ---- 7b. Die Sicht-Tafel bestimmt IHRE Form, Farbe und Breite -- gemessen an der DIFFERENZ ------
//
// 🪤 Die teuerste Fehlerklasse dieser Aufgabe ist die VAKUUM-Zusicherung. Es reicht nicht zu
// zeigen, dass EIN Objekt eine bestimmte Farbe traegt -- es muss sich von einem ANDEREN
// unterscheiden, sonst koennte die Farbe zufaellig oder ueberall dieselbe sein. Diese Probe stellt
// eine bekannte Ebene mit Punktform (Berge) neben eine unbekannte Ebene (neutral).
// ⚠️ Eigene, frische Karte: `gruppe` in review-garetien-karte.js ist ein MODULWEITER Singleton
// (Kommentar dort: „kein Schalter daneben, der auseinanderlaufen koennte") -- er haengt an genau
// EINER Karte gleichzeitig. `karte` oben ist mit `avesmapsGaretienKarteAus(karte)` bereits saeuberlich
// geschlossen; erst DANACH darf eine andere Karte den Singleton uebernehmen, sonst reisst
// `gruppe.remove()` die Ebenen von der VORHERIGEN Karte mit herunter (hier live aufgetreten).
const karte3c = gefaelschteKarte();
const berg = {
	key: "berg1", name: "Rabenspitze", urteil: "ergaenzung", ebene: "Berge", geometrie_typ: "",
	geometrie: [[900, 400]], abschnitte: [], items: [{ id: 1, selected: 1 }],
};
const unbekannteEbene = {
	key: "sonst1", name: "Kometensturz", urteil: "ergaenzung", ebene: "Sternenhimmel",
	geometrie_typ: "LineString", geometrie: [[950, 450], [960, 460]], abschnitte: [], items: [],
};
tokenAbfragen = [];
avesmapsGaretienKarteZeigen([berg, unbekannteEbene], karte3c);

const bergForm = nach(karte3c, IHRE).filter((e) => e._punkte.length === 1)[0];
const bergHof = nach(karte3c, SCHEIN_IHRE).filter((e) => e._punkte.length === 1)[0];
wahr(bergForm && bergHof, "der Berg muss eine Form UND einen Hof bekommen");
gleich(bergForm._bauer, "circleMarker",
	"ein Berg ohne Vorschlag ist ein PUNKT (Sicht-Tafel) -- als Linie waere er auf der Karte unsichtbar");
gleich(bergForm.options.color, GEBIRGE,
	"seine Form traegt die Gebirgsfarbe (--color-ecosystem-topographie-gebirge), NICHT Gold");
gleich(bergHof.options.color, GOLD, "sein Hof bleibt trotzdem GOLD -- die Herkunft bleibt lesbar");

const unbekanntForm = nach(karte3c, IHRE).filter((e) => e._punkte.length === 2)[0];
const unbekanntHof = nach(karte3c, SCHEIN_IHRE).filter((e) => e._punkte.length === 2)[0];
wahr(unbekanntForm && unbekanntHof, "die unbekannte Ebene muss ebenfalls Form UND Hof bekommen");
// 🔴 Die DIFFERENZ zur bekannten Ebene: OHNE eigene Sicht-Regel bleibt die Form GOLD -- Hof UND
// Form liegen dann beide golden uebereinander, genau das Bild von VOR dieser Aufgabe.
gleich(unbekanntForm.options.color, GOLD,
	"eine unbekannte Ebene bleibt Gold -- Form und Hof unterscheiden sich dann NICHT");
gleich(unbekanntHof.options.color, GOLD, "und ihr Hof ist ebenfalls Gold");
wahr(bergForm.options.color !== unbekanntForm.options.color,
	"eine bekannte und eine unbekannte Ebene muessen sich in der Form-Farbe unterscheiden -- sonst "
	+ "waere die Sicht-Tafel wirkungslos verdrahtet");
wahr(bergForm.options.color !== bergHof.options.color,
	"Form und Hof duerfen bei einer BEKANNTEN Ebene nicht dieselbe Farbe tragen");
wahr(tokenAbfragen.indexOf("--color-ecosystem-topographie-gebirge") !== -1,
	"das Gebirgstoken muss wirklich abgefragt worden sein, sonst stuende die Farbe als Zahl da");
avesmapsGaretienKarteAus(karte3c);

// ---- 8. „✦ Zentrieren" bewegt NUR die Ansicht -------------------------------------------------
//
// 🔴 Das ANGEKLICKTE Objekt liegt ohnehin schon auf der Karte (avesmapsGaretienAufDerKarte in
// review-garetien-importer.js, gewacht von garetien-einzelansicht.test.js) -- der Knopf steht ja in
// dessen Einzelansicht. Ein zweiter Zeichenbefehl hier waere die zweite Regel darueber, was auf der
// Karte liegt; gemessen wird deshalb, dass er die Zeichnung NICHT anfasst.
const karte2 = gefaelschteKarte();
avesmapsGaretienKarteZeigen([natter, alke], karte2);
const vorFlug = karte2.ebenen().length;
avesmapsGaretienKarteFliegen(blutmoor, karte2);
gleich(karte2.ebenen().length, vorFlug,
	"der Flug hat die Zeichnung veraendert -- er darf NUR die Ansicht bewegen");
gleich(karte2.fluege.length, 1, "es wurde gar nicht geflogen");
gleich(karte2.fluege[0].art, "fly", "geflogen wird mit flyToBounds, nicht gesprungen");
tief(karte2.fluege[0].kasten._punkte,
	[[300, 800], [320, 860], [360, 840], [300, 800]],
	"der Kasten wird aus den GETAUSCHTEN Punkten gebaut -- sonst fliegt die Karte an den "
	+ "gespiegelten Ort");
tief(karte2.fluege[0].optionen, { padding: [40, 40] }, "der Rand fehlt -- das Objekt klebt am Fensterrand");

// Ohne Geometrie wird nicht geflogen (statt an [0,0] zu springen) -- und es wird gemeldet.
const stummeMeldungen = [];
const warnVorher = console.warn;
console.warn = function () { stummeMeldungen.push(Array.prototype.join.call(arguments, " ")); };
avesmapsGaretienKarteFliegen({ name: "ohne", geometrie: [] }, karte2);
console.warn = warnVorher;
gleich(karte2.fluege.length, 1, "ein Objekt ohne Geometrie darf keinen Flug ausloesen");
gleich(stummeMeldungen.length, 1, "auch der ausgefallene Flug wird gemeldet, nicht verschluckt");
avesmapsGaretienKarteAus(karte2);

// ---- 9. Fehlt eine Geometrie, wird sie GEMELDET -----------------------------------------------
//
// 🔴 Entscheidung des Auftraggebers: kein zweiter Abruf. Alle Geometrien stehen in der Antwort
// von action:'liste'. Fehlt eine, ist das ein Befund am Server -- und ein stiller Ausfall saehe
// aus wie „da liegt eben nichts".
const karte3 = gefaelschteKarte();
const meldungen = [];
const echtesWarn = console.warn;
console.warn = function () { meldungen.push(Array.prototype.join.call(arguments, " ")); };
const ohneAbschnittsGeometrie = {
	key: "x", name: "Ohne", urteil: "ergaenzung", geometrie_typ: "LineString",
	geometrie: [[10, 900], [20, 910]],
	abschnitte: [{ public_id: "w-77", name: "", punkte: 3, geometrie: [] }],
	items: [{ id: 1, selected: 1, abschnitt: { public_id: "w-77" } }],
};
avesmapsGaretienKarteZeigen([ohneAbschnittsGeometrie], karte3);
console.warn = echtesWarn;
gleich(karte3.ebenen().length, 2,
	"ihre Geometrie wird trotzdem gezeichnet, mit ihrem Hof (Aufgabe 3) -- nur unsere Seite faellt aus");
wahr(meldungen.length === 1 && meldungen[0].indexOf("w-77") !== -1,
	"die fehlende Abschnittsgeometrie muss gemeldet werden, sonst sieht der Ausfall aus wie "
	+ "„da liegt nichts\". Gemeldet wurde: " + JSON.stringify(meldungen));
avesmapsGaretienKarteAus(karte3);

// ---- 10. Ohne Karte und ohne Leaflet faellt alles OFFEN aus ------------------------------------
//
// Der Importer laeuft auf Seiten, auf denen es keine Karte gibt (die Editorfenster). Ein Wurf
// dort risse den Listenlauf mit, in dem der Aufruf steht.
const echtesL = global.L;
global.L = undefined;
gleich(avesmapsGaretienKarteZeigen([natter], gefaelschteKarte()), null, "ohne Leaflet: kein Wurf");
gleich(avesmapsGaretienKarteFliegen(natter, gefaelschteKarte()), null, "ohne Leaflet: kein Wurf");
global.L = echtesL;
gleich(avesmapsGaretienKarteZeigen([natter], null), null, "ohne Karte: kein Wurf");
// Und die zwei Knoepfe ebenso: ohne Karte sagen sie „beide an" und schalten nichts.
tief(avesmapsGaretienKarteSicht(null), { ihre: true, unsere: true },
	"ohne Karte gilt der Startzustand -- beide an");
tief(avesmapsGaretienKarteUmschalten("ihre", null), { ihre: true, unsere: true },
	"ohne Karte darf ein Knopf nichts behaupten, was er nicht getan hat");

// ---- 11. Der Zeichner rechnet nichts und ruft niemanden --------------------------------------
//
// 🔴 Auftrag §5.5: keine zweite Rechnung im Browser, kein zweiter Netzweg. Kommentare werden
// ZUERST gestrippt -- diese Datei erklaert in Prosa, was sie nicht tun darf, und ein ungestripptes
// Muster schluege an der Erklaerung an (die Falle aus Review I2, Aufgabe 12).
const quelleRoh = fs.readFileSync(path.resolve(__dirname, "..", "review-garetien-karte.js"), "utf8");
const quelle = quelleRoh.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
wahr(quelle.length > 1000, "die Gegenprobe liest nach dem Strippen fast nichts mehr -- dann misst "
	+ "keiner der Tests darunter etwas");
gleich((quelle.match(/\bfetch\(/g) || []).length, 0,
	"der Zeichner holt nichts nach -- alle Geometrien stehen schon in der Antwort von action:'liste'");
wahr(!/Math\.sqrt|Math\.hypot/.test(quelle),
	"ein Abstand im Browser waere die zweite Rechnung, die der Auftrag verbietet");
// 💣 DIE NADEL WIRD ZUR LAUFZEIT GEBAUT, und das ist keine Kosmetik: der Abbau-Waechter
// (api/_internal/import/__tests__/garetien-abbau-waechter-test.php) sucht mit `str_contains` in
// JEDER verfolgten Datei ausserhalb von api/_internal/import/ und docs/ nach genau dieser
// Zeichenfolge. Ein Regex-LITERAL enthaelt sie -- die Zusicherung, die belegen soll, dass der
// Zeichner die Speichertabellen nicht kennt, waere selbst der einzige Verstoss und machte das
// Deploy-Tor rot (hier live passiert, gefunden von der Pruefung).
// 🪤 Und sie faellt vor dem `git add` NICHT auf: der Waechter liest `git ls-files`, eine
// ungetrackte Datei ist fuer ihn unsichtbar. Ein Testfeld VOR dem Stagen ist hier gruen und
// nach dem Commit rot. Wer Quelltext oder Dateilisten prueft, faehrt das Feld NACH dem `git add`.
const NADEL_SPEICHERTABELLEN = "garetien" + "_import";
wahr(quelleRoh.indexOf(NADEL_SPEICHERTABELLEN) === -1,
	"nichts ausserhalb api/_internal/import/ darf die Speichertabellen kennen (Abbau-Waechter)");
// Gegenprobe, dass die Nadel ueberhaupt etwas finden KANN -- sonst ist die Zeile darueber Vakuum.
wahr(("x " + NADEL_SPEICHERTABELLEN + "_row y").indexOf(NADEL_SPEICHERTABELLEN) !== -1,
	"die zur Laufzeit gebaute Nadel trifft nicht einmal sich selbst");
wahr(!/#[0-9a-fA-F]{3,8}\b/.test(quelle), "keine hartkodierte Farbe -- beide Toene kommen aus Tokens");
wahr(!/\brgba?\(/.test(quelle), "kein hartkodiertes rgb()/rgba()");
wahr(quelle.indexOf('"--color-marker-active"') !== -1,
	"ihr Goldton muss aus --color-marker-active kommen (css/base/tokens.css)");
wahr(quelle.indexOf('"--color-garetien-unsere"') !== -1,
	"unser Magenta muss aus --color-garetien-unsere kommen (css/base/tokens.css)");
// Und die zwei Tokens muessen im Stylesheet auch WIRKLICH stehen -- ein Tokenname, den es nicht
// gibt, macht `var()` ungueltig und faellt erst im Browser auf.
const tokensCss = fs.readFileSync(path.join(WURZEL, "css", "base", "tokens.css"), "utf8");
// 🔴 HELL UND DUNKEL. Ein Token, das nur im hellen Block steht, erbt im dunklen Thema den hellen
// Wert -- Magenta #b5279b auf dunklem Gelaende laeuft zu, und die halbe Aufgabe waere dort blind.
// Gemessen wird an der STELLE: mindestens eine Definition vor und eine nach dem Beginn des
// dunklen Blocks. Blosses Zaehlen taugt nicht -- `--color-marker-active` steht dreimal da (hell,
// Telefon, dunkel), und eine feste Zahl waere beim naechsten Zusatz falsch.
// 🪤 Gesucht wird die REGEL am Zeilenanfang, nicht der blosse Name: `:root[data-theme="dark"]`
// steht schon im Kopfkommentar der Datei (Zeichen 455), und danach liegt JEDE Definition -- die
// Probe haette „fehlt im hellen Block" gemeldet und dabei nichts geprueft. Hier live passiert.
const DUNKEL_AB = tokensCss.search(/^:root\[data-theme="dark"\]\s*\{/m);
wahr(DUNKEL_AB > 1000, "der dunkle Block ist in tokens.css nicht zu finden -- die Probe misst nichts");
["--color-marker-active", "--color-garetien-unsere"].forEach((name) => {
	const stellen = [];
	const muster = new RegExp("^\\s*" + name + "\\s*:", "gm");
	let treffer = muster.exec(tokensCss);
	while (treffer !== null) { stellen.push(treffer.index); treffer = muster.exec(tokensCss); }
	wahr(stellen.some((i) => i < DUNKEL_AB), name + " fehlt im hellen Block von tokens.css");
	wahr(stellen.some((i) => i > DUNKEL_AB), name + " fehlt im dunklen Block von tokens.css");
});

// ---- 11b. Eine FLAECHE wird als Flaeche gezeichnet, eine Linie als Linie -----------------------
//
// 🔴 Review I2: `avesmapsGaretienListeGeometriePunkte` (garetien-liste.php) flacht einen Polygon
// auf seinen aeusseren RING ab -- eine flache Punktliste sieht danach aus wie eine Linie. Ohne die
// Auskunft des Servers zeichnete die Karte jeden See als gestrichelten Umriss. Von den 288
// Objekten der Stufe 1 sind 113 Flaechen (96 See, 15 Sumpf, 2 Meer), also 39 %.
// 🔴 Gefragt wird `geometrie_typ` (= `after.geometry.type`), NIE `typ`/`subtyp`: eine Typenliste
// im Browser waere die hartkodierte Aufzaehlung, die Ruling R21 verworfen hat.

const { garetienIstFlaeche } = mod;
wahr(typeof garetienIstFlaeche === "function", "garetienIstFlaeche fehlt im Export");
gleich(garetienIstFlaeche({ geometrie_typ: "Polygon" }), true, "ein Polygon ist eine Flaeche");
gleich(garetienIstFlaeche({ geometrie_typ: "LineString" }), false, "ein LineString ist keine Flaeche");
// ⚠️ Leer heisst "keine Auskunft" und gilt als Linie -- die zurueckhaltende Richtung. Und der Typ
// wird NICHT aus `typ`/`subtyp` geraten: ein Sumpf ohne `geometrie_typ` bleibt eine Linie.
gleich(garetienIstFlaeche({ geometrie_typ: "", typ: "Sumpf", subtyp: "suempfe_moore" }), false,
	"ohne Serverauskunft wird NICHT aus dem Typ geraten");
gleich(garetienIstFlaeche(null), false, "ohne Objekt keine Flaeche");

const karte4 = gefaelschteKarte();
const moor = {
	key: "m", name: "Blutmoor", urteil: "neu", ebene: "Gewaesser", geometrie_typ: "Polygon",
	geometrie: [[800, 300], [860, 320], [840, 360], [800, 300]],
	abschnitte: [], items: [{ id: 1, selected: 1 }],
};
const bach = {
	key: "b", name: "Alke", urteil: "ergaenzung", ebene: "Gewaesser", geometrie_typ: "LineString",
	geometrie: [[500, 60], [520, 80]],
	abschnitte: [{ public_id: "w-5112", name: "", geometrie: [[502, 62], [518, 78]] }],
	items: [{ id: 2, selected: 1, abschnitt: { public_id: "w-5112" } }],
};
avesmapsGaretienKarteZeigen([moor, bach], karte4);
const moorIhre = nach(karte4, IHRE).filter((e) => e._punkte.length === 4)[0];
const bachIhre = nach(karte4, IHRE).filter((e) => e._punkte.length === 2)[0];
wahr(moorIhre && bachIhre, "die zwei ihrer Formen sind nicht zu finden");
gleich(moorIhre._bauer, "polygon", "eine Flaeche wird mit L.polygon gebaut, nicht als Linie");
gleich(moorIhre.options.fill, true, "eine Flaeche bekommt eine Fuellung (Mockup: Blutmoor)");
// Seit Aufgabe 3 (RULING R8) traegt IHRE Flaeche ihre echte Kartenfarbe (Sicht-Tafel), nicht mehr
// Gold -- Gold liegt seither nur noch in ihrem Hof (siehe Abschnitt 3 oben).
gleich(moorIhre.options.fillColor, WASSER, "die Fuellung kommt aus demselben Token wie ihre Kante");
wahr(moorIhre.options.fillOpacity > 0 && moorIhre.options.fillOpacity < 0.3,
	"die Fuellung ist LEICHT, damit die Landschaft darunter lesbar bleibt -- gemessen "
	+ moorIhre.options.fillOpacity);
// Die DIFFERENZ, ohne die die Zeilen darueber nichts filtern: dieselbe Zeichnung fuer eine LINIE.
gleich(bachIhre._bauer, "polyline", "eine Linie bleibt eine Linie");
gleich(bachIhre.options.fill, false, "eine Linie bekommt KEINE Fuellung");
gleich(bachIhre.options.fillOpacity, 0, "eine Linie bekommt keine Fuelldeckkraft");
// 🔴 Der HOF bleibt immer ein Strich, auch unter einer Flaeche: eine zu 55 % gefuellte Flaeche
// ueberdeckte einen See vollstaendig -- man saehe die Hervorhebung, aber nicht das Hervorgehobene.
const bachHof = nach(karte4, SCHEIN)[0];
gleich(bachHof._bauer, "polyline", "der Hof ist immer ein Strich");
gleich(bachHof.options.fill, false, "der Hof wird nie gefuellt");
avesmapsGaretienKarteAus(karte4);

// ---- 11b2. UNSERE Flaeche: nur ein geschlossener Ring wird zur Flaeche ------------------------
//
// 💣 DER MULTIPOLYGON-RIEGEL. Unsere Flaechen liegen in `ecosystem_area.geometry_geojson` und
// duerfen Polygon ODER MultiPolygon sein, mit Loechern. Auf dem Weg ins Fenster verlieren sie ihre
// Ringstruktur: `avesmapsGaretienGeoJsonPunkte` sammelt ALLE Ringe in EINE flache Liste,
// `avesmapsGaretienProbepunkteN` duennt sie auf 64 Punkte aus. Als `L.polygon` gezeichnet ergaebe
// das bei mehreren Ringen eine Schleife, die zwischen den Teilen springt -- bei einem See mit 224
// Teilen ein Gespinst statt einer Flaeche.
// ⭐ Der Schlusstest trennt beide Faelle EXAKT, gemessen am Livebestand (ecosystem-areas.php,
// 29.08.2026, see + meer + suempfe_moore): 281 von 281 einringigen Flaechen schliessen, 0 von 105
// mehrringigen schliessen. Null Fehlurteile in beide Richtungen.
wahr(typeof garetienRingSchliesst === "function", "garetienRingSchliesst fehlt im Export");
gleich(garetienRingSchliesst([[1, 2], [3, 4], [5, 6], [1, 2]]), true,
	"ein geschlossener Ring schliesst");
gleich(garetienRingSchliesst([[1, 2], [3, 4], [5, 6], [7, 8]]), false,
	"eine Verkettung mehrerer Ringe endet auf dem Anfang des LETZTEN Rings, nicht des ersten");
gleich(garetienRingSchliesst([[1, 2], [3, 4], [1, 2]]), false,
	"drei Punkte koennen kein Ring sein -- ein Dreieck traegt vier (der erste steht am Ende noch einmal)");
gleich(garetienRingSchliesst([]), false, "nichts schliesst nicht");
gleich(garetienRingSchliesst(null), false, "und `null` erst recht nicht");

// Und jetzt am ERGEBNIS, in EINER Probe, mit der DIFFERENZ: zwei Seen, beide `Polygon`, beide mit
// einem Abschnitt von uns -- der eine ein Ring, der andere zwei aneinandergehaengte.
const karte5 = gefaelschteKarte();
const seeEinRing = {
	key: "see1", name: "Kraehensee", urteil: "ergaenzung", ebene: "Gewaesser", geometrie_typ: "Polygon",
	geometrie: [[800, 300], [860, 320], [840, 360], [800, 300]],
	abschnitte: [{ public_id: "a-1", name: "Kraehensee",
		geometrie: [[802, 302], [858, 318], [838, 358], [802, 302]] }],
	items: [{ id: 1, selected: 1, abschnitt: { public_id: "a-1" } }],
};
const seeZweiRinge = {
	key: "see2", name: "Inselsee", urteil: "ergaenzung", ebene: "Gewaesser", geometrie_typ: "Polygon",
	geometrie: [[700, 200], [720, 210], [710, 230], [700, 200]],
	abschnitte: [{ public_id: "a-2", name: "Inselsee", geometrie: [
		[701, 201], [719, 209], [709, 229], [701, 201],
		[601, 101], [619, 109], [609, 129], [601, 101],
	] }],
	items: [{ id: 2, selected: 1, abschnitt: { public_id: "a-2" } }],
};
avesmapsGaretienKarteZeigen([seeEinRing, seeZweiRinge], karte5);
const unsereEin = nach(karte5, UNSERE).filter((e) => e._punkte.length === 4)[0];
const unsereZwei = nach(karte5, UNSERE).filter((e) => e._punkte.length === 8)[0];
wahr(unsereEin && unsereZwei, "unsere zwei Formen sind nicht zu finden");
gleich(unsereEin._bauer, "polygon",
	"unsere einringige Flaeche wird als FLAECHE gezeichnet -- das ist der Auftrag");
gleich(unsereEin.options.fill, true, "und sie bekommt ihre leichte Fuellung");
gleich(unsereEin.options.fillColor, MAGENTA, "in UNSERER Farbe, nicht in ihrer");
gleich(unsereZwei._bauer, "polyline",
	"unsere mehrringige Flaeche bleibt ein Umriss -- als Polygon waere es ein Gespinst zwischen "
	+ "den Teilen");
gleich(unsereZwei.options.fill, false, "und sie bekommt keine Fuellung");
// Die Gegenprobe, die belegt, dass hier wirklich der SCHLUSSTEST entscheidet und nicht der Typ:
// beide Objekte sind `Polygon`, und IHRE Formen sind deshalb beide Flaechen.
gleich(nach(karte5, IHRE).filter((e) => e._bauer === "polygon").length, 2,
	"beide sind `Polygon` -- ihre Formen sind beide Flaechen; nur unsere Seite unterscheidet");
avesmapsGaretienKarteAus(karte5);

// ---- 11c. Fehlt ein Abschnitt in `objekt.abschnitte`, wird er GEMELDET -------------------------
//
// 🪤 Review M1: hier stand ein Rueckfall auf `item.abschnitt`, und er war TOTER CODE mit einem
// beruhigenden Kommentar darueber -- avesmapsGaretienListeAbschnitteVereinen haengt jeden von
// einem Item genannten Abschnitt an die Liste an, die zwei Mengen fallen also zusammen. Entfernt;
// gepruefte Zusicherung ist jetzt das VERHALTEN ohne ihn: kein stiller Flick, sondern ein Befund.
const karte6 = gefaelschteKarte();
const lueckeMeldungen = [];
const warnVorher5 = console.warn;
console.warn = function () { lueckeMeldungen.push(Array.prototype.join.call(arguments, " ")); };
avesmapsGaretienKarteZeigen([{
	key: "l", name: "Luecke", urteil: "ergaenzung", geometrie: [[10, 900], [20, 910]],
	abschnitte: [],
	items: [{ id: 1, selected: 1, abschnitt: { public_id: "w-88", geometrie: [[1, 2], [3, 4]] } }],
}], karte6);
console.warn = warnVorher5;
gleich(karte6.ebenen().length, 2,
	"ihre Form wird gezeichnet, mit ihrem Hof (Aufgabe 3) -- unsere Seite faellt aus");
wahr(lueckeMeldungen.length === 1 && lueckeMeldungen[0].indexOf("w-88") !== -1,
	"ein Abschnitt, der nur am Item haengt, wird GEMELDET statt still nachgeschlagen -- gemeldet "
	+ "wurde: " + JSON.stringify(lueckeMeldungen));
avesmapsGaretienKarteAus(karte6);

// ---- 11d. Der Hof hat eine WEICHE Kante -- und sie ist MAGENTA --------------------------------
//
// Review M2: im Mockup §2 traegt der Hof `filter=url(#glow)` mit `stdDeviation="7"`. Die Buehne
// ist 1360px breit bei viewBox 1360, also 1 SVG-Einheit = 1 CSS-Pixel, und der Radius von
// `drop-shadow` ist das DOPPELTE der Standardabweichung: 14px.
// 💣 Er steht im CSS und nicht im JavaScript, weil nur dort das Farbtoken benutzbar ist.
// 🔴 Und er ist seit dem 29.08.2026 MAGENTA: der Hof gehoert UNSERER Partei. Ein goldener Hof unter
// einer Magenta-Linie behauptete wieder das Gegenteil der Form.
const kartenCss = fs.readFileSync(path.join(WURZEL, "css", "components", "garetien-importer.css"), "utf8");
const scheinBlock = (kartenCss.match(/\.gi-map-schein\s*\{[^}]*\}/) || [""])[0];
wahr(scheinBlock !== "", "die Regel fuer .gi-map-schein fehlt -- die Gegenprobe misst sonst nichts");
wahr(/drop-shadow\(\s*0\s+0\s+14px/.test(scheinBlock),
	"der Hof braucht die weiche Kante des Mockups (stdDeviation 7 = 14px Radius): " + scheinBlock);
wahr(/var\(--color-garetien-unsere\)/.test(scheinBlock),
	"auch der Weichzeichner nimmt UNSERE Farbe aus dem Token: " + scheinBlock);
wahr(!/var\(--color-marker-active\)/.test(scheinBlock),
	"und nicht mehr ihr Gold -- sonst gehoert der Hof optisch der falschen Partei: " + scheinBlock);
// 🪤 `\b` MUSS hier als Wortgrenze stehen. Beim Erzeugen dieser Datei wurde es einmal zu einem
// echten Rueckschritt-Zeichen (0x08) -- das Muster traf dann NIE, und die Zusicherung war Vakuum.
// Die Gegenprobe darunter faengt genau das.
wahr(!/#[0-9a-fA-F]{3,8}\b/.test(scheinBlock) && !/\brgba?\(/.test(scheinBlock),
	"kein hartkodierter Farbwert im .gi-map-schein-Block");
wahr(/#[0-9a-fA-F]{3,8}\b/.test(".gi-x { color: #abcdef; }"),
	"das Farbmuster findet nicht einmal eine echte Farbe -- dann ist die Zeile darueber Vakuum");

// Aufgabe 3 (RULING R8): der NEUE Hof unter IHRER Form -- dieselbe weiche Kante, aber GOLD statt
// Magenta, und in einer EIGENEN Klasse/Regel (kein Teilen mit `.gi-map-schein`).
const scheinIhreBlock = (kartenCss.match(/\.gi-map-schein-ihre\s*\{[^}]*\}/) || [""])[0];
wahr(scheinIhreBlock !== "",
	"die Regel fuer .gi-map-schein-ihre fehlt -- die Gegenprobe misst sonst nichts");
wahr(/drop-shadow\(\s*0\s+0\s+14px/.test(scheinIhreBlock),
	"ihr Hof braucht dieselbe weiche Kante wie unserer: " + scheinIhreBlock);
wahr(/var\(--color-marker-active\)/.test(scheinIhreBlock),
	"ihr Hof nimmt GOLD aus dem Token: " + scheinIhreBlock);
wahr(!/var\(--color-garetien-unsere\)/.test(scheinIhreBlock),
	"und nicht unser Magenta -- sonst gehoert der Hof optisch der falschen Partei: " + scheinIhreBlock);
wahr(!/#[0-9a-fA-F]{3,8}\b/.test(scheinIhreBlock) && !/\brgba?\(/.test(scheinIhreBlock),
	"kein hartkodierter Farbwert im .gi-map-schein-ihre-Block");
// Die DIFFERENZ: die zwei Hof-Regeln muessen sich wirklich unterscheiden -- sonst waeren die vier
// Zeilen oben Vakuum (beide Bloecke identisch gelesen).
wahr(scheinBlock !== scheinIhreBlock,
	".gi-map-schein und .gi-map-schein-ihre muessen verschiedene Regeln sein");

// 💣 NUR DIE KONTUR FAENGT DEN ZEIGER. Bei einem See liegen ihre und unsere Flaeche fast
// deckungsgleich uebereinander; faengt die FUELLUNG, gewinnt ueberall die obere (ihre), und unsere
// Fassung waere im ganzen Ueberlappungsbereich nicht mehr anzeigbar -- also genau dort nicht, wo man
// vergleicht. Zusaetzlich bliebe das Innere eines Sees fuer die Karte darunter unklickbar.
// 💣 DIE SPEZIFITAET IST TRAGEND: Leaflets `.leaflet-pane > svg path.leaflet-interactive` waegt
// (0,2,2) und setzt `pointer-events: auto`. Eine schlichte `.gi-map-ihre`-Regel waege (0,1,0) und
// waere wirkungslos.
const zeigerRegel = (kartenCss.match(/[^}]*pointer-events:\s*stroke[^}]*\}/) || [""])[0];
wahr(zeigerRegel !== "", "die Zeigerregel `pointer-events: stroke` fehlt");
// 🔴 Aufgabe 3: VIER Klassen jetzt, nicht mehr drei -- der neue Hof braucht denselben Riegel wie
// die uebrigen drei, sonst faengt seine Kontur keinen Tooltip.
[".gi-map-ihre", ".gi-map-unsere", ".gi-map-schein", ".gi-map-schein-ihre"].forEach((klasse) => {
	wahr(zeigerRegel.indexOf("path.leaflet-interactive" + klasse) !== -1,
		"die Zeigerregel muss " + klasse + " MIT der Leaflet-Kette nennen, sonst ueberstimmt "
		+ "leaflet.css sie lautlos: " + zeigerRegel);
});
// Und die vier Klassen im CSS sind wirklich die vier, die der Zeichner vergibt.
[IHRE, UNSERE, SCHEIN, SCHEIN_IHRE].forEach((klasse) => {
	wahr(zeigerRegel.indexOf("." + klasse) !== -1,
		"die Klasse " + klasse + " kommt aus dem Zeichner und fehlt in der Zeigerregel");
});

// ---- 12. Verdrahtung: die Datei laedt, das Fenster ruft sie ------------------------------------
//
// 🪤 Der Anker traegt `src="`. Ohne ihn haelt ein Kommentar, der den Dateinamen nennt, den Test
// fuer erfuellt -- genau das ist in Aufgabe 13b aufgetreten.
const indexHtml = fs.readFileSync(path.join(WURZEL, "index.html"), "utf8");
wahr(indexHtml.indexOf('src="js/review/review-garetien-karte.js"') !== -1,
	"index.html laedt den Zeichner nicht");

// Und das Fenster raeumt beim Schliessen wirklich ab -- gemessen am ERGEBNIS (der Ruf kam an),
// nicht daran, dass irgendwo ein Wort im Quelltext steht.
global.window = global.window || {};
const importer = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
let ausGerufen = 0;
global.window.avesmapsGaretienKarteAus = function () { ausGerufen++; };
importer.avesmapsGaretienFensterSchliessen();
gleich(ausGerufen, 1,
	"beim Schliessen des Fensters muss die Karte abgeraeumt werden -- sonst bleibt der farbige "
	+ "Strich fuer jeden Besucher liegen");

// 💣 DER GEKOPPELTE WERT: die zwei Parteinamen stehen in ZWEI Dateien -- im Zeichner (Tooltip) und
// im Fenster (Knopfbeschriftung). Keine der beiden darf die andere voraussetzen (das Fenster laeuft
// ohne Karte, der Zeichner wird im Test allein geladen), also haelt der Test sie zusammen. Ohne
// diese Zeile hiesse der Knopf „Garetien" und der Tooltip irgendwann anders -- und die Frage
// „welche Form gehoert wem" waere wieder offen.
gleich(importer.AVESMAPS_GARETIEN_PARTEI_IHRE, mod.AVESMAPS_GARETIEN_PARTEI_IHRE,
	"Knopf und Tooltip muessen dieselbe Partei gleich nennen");
gleich(importer.AVESMAPS_GARETIEN_PARTEI_UNSERE, mod.AVESMAPS_GARETIEN_PARTEI_UNSERE,
	"Knopf und Tooltip muessen dieselbe Partei gleich nennen");
wahr(mod.AVESMAPS_GARETIEN_PARTEI_IHRE !== mod.AVESMAPS_GARETIEN_PARTEI_UNSERE,
	"waeren die zwei Parteinamen gleich, belegten die zwei Zeilen darueber nichts");

// Der Knopf steht in der Einzelansicht und nennt sein Objekt selbst.
const detailMarkup = importer.garetienDetailMarkup(natter);
// 🪤 Das gerade Schlusszeichen der Hausform „…" muss in einer doppelt gequoteten Zeichenkette
// ESCAPED werden -- sonst endet sie dort, und die Datei ist syntaktisch kaputt (hier live passiert).
wahr(detailMarkup.indexOf('class="gi-show"') !== -1, "der Knopf „Zentrieren\" fehlt");
wahr(detailMarkup.indexOf("✦ Zentrieren") !== -1,
	"der Knopf heisst seit dem 29.08.2026 „Zentrieren\" -- „Auf der Karte zeigen\" war eine Luege "
	+ "geworden, seit das angeklickte Objekt ohnehin gezeichnet wird");
wahr(detailMarkup.indexOf("Auf der Karte zeigen") === -1,
	"die alte Beschriftung darf nicht daneben stehenbleiben");
wahr(detailMarkup.indexOf('data-key="ggp:Gewaesser:Fluss:Natter"') !== -1,
	"der Knopf muss sein Objekt selbst nennen -- sonst braeuchte der Verteiler einen Modulzustand");

// Die zwei Sicht-Knoepfe, und BEIDE starten AN (Owner-Vorgabe).
wahr(detailMarkup.indexOf('data-sicht="ihre"') !== -1
	&& detailMarkup.indexOf('data-sicht="unsere"') !== -1,
	"die zwei Sicht-Knoepfe fehlen in der Einzelansicht");
gleich((detailMarkup.match(/aria-pressed="true"/g) || []).length, 2,
	"ohne uebergebenen Stand starten BEIDE Knoepfe an");
wahr(detailMarkup.indexOf(">" + importer.AVESMAPS_GARETIEN_PARTEI_IHRE + "<") !== -1
	&& detailMarkup.indexOf(">" + importer.AVESMAPS_GARETIEN_PARTEI_UNSERE + "<") !== -1,
	"jeder Knopf traegt seinen Parteinamen als Beschriftung");
// Die DIFFERENZ: ein ausgeblendeter Stand kommt auch an den Knoepfen an -- sonst zeigte der Knopf
// „an", waehrend die Karte die Partei verbirgt.
const markupAus = importer.garetienDetailMarkup(natter, { ihre: false, unsere: true });
wahr(/data-sicht="ihre" aria-pressed="false"/.test(markupAus),
	"ein ausgeblendeter Stand muss am Knopf ankommen: " + markupAus);
wahr(/data-sicht="unsere" aria-pressed="true"/.test(markupAus),
	"und der andere Knopf bleibt davon unberuehrt");

// Die DIFFERENZ: ohne Geometrie gibt es nichts anzufliegen und nichts umzuschalten, also stehen
// die drei Knoepfe auch nicht da. Ein Knopf, der nichts tut, ist eine sichtbare Stoerung.
const ohneGeometrie = importer.garetienDetailMarkup({ key: "k", name: "N", abschnitte: [], items: [] });
wahr(ohneGeometrie.indexOf("gi-show") === -1,
	"ohne Geometrie darf der Knopf nicht dastehen -- sonst filtert die Zeile darueber gar nicht");
wahr(ohneGeometrie.indexOf("data-sicht") === -1,
	"und die zwei Sicht-Knoepfe ebensowenig");

// Sein Aussehen kommt aus Tokens, wie alles in diesem Fenster (AGENTS.md §12).
const css = kartenCss;
const showBlock = (css.match(/\.gi-show\s*\{[^}]*\}/) || [""])[0];
wahr(showBlock !== "", "der .gi-show-Block fehlt -- die Gegenprobe misst sonst nichts");
wahr(!/#[0-9a-fA-F]{3,8}\b/.test(showBlock) && !/\brgba?\(/.test(showBlock),
	"kein hartkodierter Farbwert im .gi-show-Block");
wahr(/var\(--color-button-soft\)/.test(showBlock),
	"eine Zeilen-/Nebenhandlung ist WEICH, nicht gefuellt -- die Haupthandlung heisst „Angehakte "
	+ "uebernehmen\" und steht in der Fusszeile");
// Und die zwei Farbflecke nehmen GENAU die zwei Kartentokens -- kein dritter Wert daneben.
const sichtCss = css.slice(css.indexOf(".gi-sicht"));
wahr(/\.gi-sicht__knopf--ihre\s*\{[^}]*var\(--color-marker-active\)/.test(sichtCss),
	"der Knopf „Garetien\" muss ihr Gold-Token tragen");
wahr(/\.gi-sicht__knopf--unsere\s*\{[^}]*var\(--color-garetien-unsere\)/.test(sichtCss),
	"der Knopf „Avesmaps\" muss unser Magenta-Token tragen");
const fleckBlock = (css.match(/\.gi-sicht__fleck\s*\{[^}]*\}/) || [""])[0];
wahr(fleckBlock !== "" && !/#[0-9a-fA-F]{3,8}\b/.test(fleckBlock) && !/\brgba?\(/.test(fleckBlock),
	"kein hartkodierter Farbwert am Farbfleck: " + fleckBlock);
// 🔴 Nichts unter 11px (AGENTS.md §12). Die Knopfschrift erbt `--font-size-body` (13px); gemessen
// wird, dass NIRGENDS im Sicht-Block eine kleinere feste Groesse steht.
((sichtCss.match(/font-size:\s*(\d+)px/g) || [])).forEach((treffer) => {
	wahr(Number(treffer.replace(/\D/g, "")) >= 11,
		"nichts unter 11px (AGENTS.md §12) -- gefunden: " + treffer);
});

// Und der Knopf „✦ Zentrieren" fliegt das Objekt an, das er nennt.
let geflogen = null;
global.window.avesmapsGaretienKarteFliegen = function (objekt) { geflogen = objekt; };
const ereignis = {
	target: {
		closest(auswahl) { return auswahl === ".gi-show" ? { getAttribute: () => natter.key } : null; },
	},
};
importer.garetienDetailKlick(ereignis, [alke, natter, blutmoor]);
gleich(geflogen, natter, "der Knopf muss GENAU sein Objekt anfliegen");

// Ein Klick daneben fliegt nicht -- die Differenz, ohne die die Zeile darueber nichts filtert.
geflogen = null;
importer.garetienDetailKlick({ target: { closest: () => null } }, [natter]);
gleich(geflogen, null, "ein Klick neben den Knopf darf keinen Flug ausloesen");

// Und ein Klick auf einen Sicht-Knopf schaltet die genannte Partei -- am ERGEBNIS gemessen, ueber
// den echten Verteiler, samt der Rueckmeldung an `aria-pressed`.
let umgeschaltet = [];
let gesetzt = null;
global.window.avesmapsGaretienKarteUmschalten = function (seite) {
	umgeschaltet.push(seite);
	return { ihre: seite !== "ihre", unsere: true };
};
const sichtZiel = {
	getAttribute: (n) => (n === "data-sicht" ? "ihre" : null),
	setAttribute: (n, w) => { gesetzt = n + "=" + w; },
};
importer.garetienDetailKlick({
	target: { closest: (auswahl) => (auswahl === "[data-sicht]" ? sichtZiel : null) },
}, [natter]);
tief(umgeschaltet, ["ihre"], "der Sicht-Knopf muss GENAU seine Partei umschalten");
gleich(gesetzt, 'aria-pressed=false',
	"und der Knopf zieht seinen Stand aus der ANTWORT nach, nicht aus dem Klick");
// Die DIFFERENZ: ein Klick auf den Zentrieren-Knopf schaltet KEINE Partei um.
umgeschaltet = [];
importer.garetienDetailKlick(ereignis, [natter]);
tief(umgeschaltet, [], "der Zentrieren-Knopf darf keine Partei umschalten");

// ---- 13. Aufgabe 3, Schritt 5: die Neutral-Meldung der Bilanzzeile -----------------------------
//
// ⭐ Der Rueckfall wird GEMELDET, nicht verschwiegen (Entwurf §4.1) -- dieselbe Regel wie „ein
// Pruefhaken zeigt seine Funde". Getestet wird die REINE Logik (`garetienNeutraleObjekte` /
// `garetienNeutralHinweisMarkup`), nicht der volle DOM-Render von avesmapsGaretienListeRendern --
// diese Datei stellt ohnehin schon `window.avesmapsGaretienSichtFuer` von Hand, weil dieses Modul
// VOR `global.window` geladen wurde (derselbe Grund, aus dem `avesmapsGaretienKarteAus` &co. oben
// als Stubs gesetzt werden, nicht aus dem echten Modul).
wahr(typeof importer.garetienNeutraleObjekte === "function", "garetienNeutraleObjekte fehlt im Export");
wahr(typeof importer.garetienNeutralHinweisMarkup === "function",
	"garetienNeutralHinweisMarkup fehlt im Export");
global.window.avesmapsGaretienSichtFuer = mod.avesmapsGaretienSichtFuer;

// Kein neutrales Objekt in der Liste -> keine Meldung.
gleich(importer.garetienNeutralHinweisMarkup([alke]), "",
	"eine Ebene mit eigener Sicht-Regel (Gewaesser) darf keine Neutral-Meldung ausloesen");

// Die DIFFERENZ: eine unbekannte Ebene loest die Meldung aus, mit Zahl UND Ebenenname.
const neutralesObjekt = { key: "n1", name: "X", ebene: "Sternenhimmel" };
const neutraleGefunden = importer.garetienNeutraleObjekte([alke, neutralesObjekt]);
tief(neutraleGefunden, [neutralesObjekt],
	"nur das Objekt OHNE Sicht-Regel gilt als neutral -- Gewaesser (alke) nicht");
const hinweis = importer.garetienNeutralHinweisMarkup([alke, neutralesObjekt]);
wahr(hinweis.indexOf('class="gi-neutral"') !== -1, "die Meldung braucht ihre eigene Klasse fuer das CSS");
wahr(hinweis.indexOf("1 neutral gezeichnet") !== -1,
	"die Meldung nennt die ZAHL der neutralen Objekte: " + hinweis);
wahr(hinweis.indexOf("Sternenhimmel") !== -1,
	"die Meldung nennt die EBENE, die keine Sicht-Regel hat: " + hinweis);

// Mehrere neutrale Objekte derselben Ebene zaehlen als EINE Ebene, aber mehrere Objekte.
const hinweisZwei = importer.garetienNeutralHinweisMarkup([
	neutralesObjekt, { key: "n2", name: "Y", ebene: "Sternenhimmel" },
]);
wahr(hinweisZwei.indexOf("2 neutral gezeichnet") !== -1,
	"zwei neutrale Objekte werden gezaehlt, nicht auf eins entdoppelt: " + hinweisZwei);
wahr((hinweisZwei.match(/Sternenhimmel/g) || []).length === 1,
	"die Ebene selbst wird ENTDOPPELT genannt -- sonst stuende sie zweimal in der Meldung");

// Mehrere verschiedene neutrale Ebenen werden zusammen genannt.
const hinweisVerschieden = importer.garetienNeutralHinweisMarkup([
	neutralesObjekt, { key: "n3", name: "Z", ebene: "Wege" },
]);
wahr(hinweisVerschieden.indexOf("Sternenhimmel, Wege") !== -1,
	"mehrere Ebenen ohne Sicht-Regel werden zusammen genannt: " + hinweisVerschieden);

// Ein Ebenenname wird ESCAPED -- die Bilanzzeile ist HTML.
const hinweisEscape = importer.garetienNeutralHinweisMarkup([{ key: "n4", ebene: "<script>" }]);
wahr(hinweisEscape.indexOf("<script>") === -1 && hinweisEscape.indexOf("&lt;script&gt;") !== -1,
	"der Ebenenname muss escaped werden: " + hinweisEscape);

// Ohne `window.avesmapsGaretienSichtFuer` (Editorseiten ohne Karte) faellt es OFFEN aus -- keine
// falsche Meldung, aber auch kein Wurf.
delete global.window.avesmapsGaretienSichtFuer;
tief(importer.garetienNeutraleObjekte([neutralesObjekt]), [],
	"ohne die Sicht-Tafel-Funktion gilt NICHTS als neutral -- lieber schweigen als falsch behaupten");
gleich(importer.garetienNeutralHinweisMarkup([neutralesObjekt]), "",
	"und die Meldung bleibt leer, statt zu werfen");
global.window.avesmapsGaretienSichtFuer = mod.avesmapsGaretienSichtFuer;

console.log(`garetien-karte: ${checks} Pruefungen bestanden.`);
