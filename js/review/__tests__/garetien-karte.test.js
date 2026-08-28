// Aufgabe 14 des Garetien Importers -- die Karte: was angehakt ist, leuchtet.
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
// Punkten, in welcher Reihenfolge.
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

// `_bauer` haelt fest, OB `L.polygon` oder `L.polyline` gerufen wurde -- eine Flaeche ist bei
// Leaflet ein anderer Bauer, nicht bloss eine andere Option, und genau das ist die Aussage.
function gefaelschteEbene(bauer, punkte, optionen) {
	return {
		_art: "polyline", _bauer: bauer, _punkte: punkte, _karte: null, options: optionen || {},
		addTo(k) { k.addLayer(this); return this; },
		remove() { if (this._karte) { this._karte.removeLayer(this); } return this; },
	};
}

global.L = {
	polyline(punkte, optionen) { return gefaelschteEbene("polyline", punkte, optionen); },
	polygon(punkte, optionen) { return gefaelschteEbene("polygon", punkte, optionen); },
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

// Der Goldton kommt aus dem Token, nie als Zahl aus dieser Datei (AGENTS.md §12). Leaflet-
// Pfadoptionen nehmen kein `var()`, also wird er ausgelesen -- hier gestellt, damit die Zusicherung
// darunter beweist, dass wirklich DIESER Weg genommen wird.
const GOLD = "#f0b429";
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
global.getComputedStyle = function (element) {
	return {
		getPropertyValue(name) {
			tokenAbfragen.push(name);
			return element === global.document.documentElement && name === "--color-marker-active" ? GOLD : "";
		},
	};
};

const mod = require(path.resolve(__dirname, "..", "review-garetien-karte.js"));
const {
	avesmapsGaretienNachLeaflet,
	avesmapsGaretienScheinIds,
	avesmapsGaretienKarteZeigen,
	avesmapsGaretienKarteFliegen,
	avesmapsGaretienKarteAus,
} = mod;

wahr(typeof avesmapsGaretienNachLeaflet === "function", "avesmapsGaretienNachLeaflet fehlt im Export");
wahr(typeof avesmapsGaretienScheinIds === "function", "avesmapsGaretienScheinIds fehlt im Export");
wahr(typeof avesmapsGaretienKarteZeigen === "function", "avesmapsGaretienKarteZeigen fehlt im Export");
wahr(typeof avesmapsGaretienKarteFliegen === "function", "avesmapsGaretienKarteFliegen fehlt im Export");
wahr(typeof avesmapsGaretienKarteAus === "function", "avesmapsGaretienKarteAus fehlt im Export");

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

// ---- 2. Der Schein gehoert NUR den Abschnitten, die das Haekchen wirklich aendert -------------
//
// 💣 Ihre Natter laeuft ueber fuenf unserer Abschnitte; geaendert wird EINER. Der ganzen Kette
// einen Schein zu geben behauptete, alle fuenf wuerden umbenannt -- genau der Fehler, den die
// Einzelansicht aus Aufgabe 13 verhindern soll. Quelle ist deshalb `item.abschnitt.public_id` der
// ANGEHAKTEN Items, nie `objekt.abschnitte`.
const natter = {
	key: "ggp:Gewaesser:Fluss:Natter",
	name: "Natter",
	urteil: "ergaenzung",
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
tief(avesmapsGaretienScheinIds(natter), ["w-6120"],
	"Der Schein gehoert NUR den Abschnitten, die das Haekchen aendert. Der ganzen Kette einen zu "
	+ "geben behauptet, alle fuenf wuerden umbenannt.");

// Die DIFFERENZ, ohne die der Filter Vakuum waere: mit beiden Haken sind es zwei, und die
// Reihenfolge ist die der Items.
const natterBeide = JSON.parse(JSON.stringify(natter));
natterBeide.items[1].selected = 1;
tief(avesmapsGaretienScheinIds(natterBeide), ["w-6120", "w-4471"],
	"mit zwei Haken glimmen zwei Abschnitte -- sonst filtert die Zeile darueber gar nicht");

// `selected` kommt vom Server als 0/1-ZAHL, nie als Bool (garetien-liste.php: `(int) $roh[...]`).
// Ein `=== true` laese live „nichts angehakt" -- dieselbe Falle, die die Wiki-Zuweisung bezahlt hat.
tief(avesmapsGaretienScheinIds({ items: [{ id: 1, selected: 1, abschnitt: { public_id: "w-1" } }] }),
	["w-1"], "`selected` ist eine ZAHL -- ein Vergleich auf `=== true` sieht live nie ein Haekchen");
tief(avesmapsGaretienScheinIds({ items: [{ id: 1, selected: 0, abschnitt: { public_id: "w-1" } }] }),
	[], "ohne Haken glimmt nichts");

// Mehrere Items koennen denselben Abschnitt nennen (Luecke + Umbenennung + Geometrie) -- er
// bekommt EINEN Schein, nicht drei uebereinander.
tief(avesmapsGaretienScheinIds({ items: [
	{ id: 1, selected: 1, abschnitt: { public_id: "w-9" } },
	{ id: 2, selected: 1, abschnitt: { public_id: "w-9" } },
] }), ["w-9"], "derselbe Abschnitt zweimal genannt ergibt EINEN Schein");

// Ein Item ohne Abschnitt (reines Quellen-Item am Neu-Fall) nennt nichts -- und darf auch nichts
// erfinden.
tief(avesmapsGaretienScheinIds({ urteil: "neu", abschnitte: [], items: [{ id: 1, selected: 1 }] }),
	[], "ein neues Objekt hat nichts zu beleuchten");
tief(avesmapsGaretienScheinIds(null), [], "ohne Objekt glimmt nichts");
tief(avesmapsGaretienScheinIds({ items: [] }), [], "ohne Items glimmt nichts");

// ---- 3. Zeichnen: zwei Mittel, und der Schein liegt UNTER dem Strich --------------------------
//
// Die Zahlen unten sind aus DIESEN drei Objekten hergeleitet, nicht abgeschrieben:
//   natter   -> 1 Strich (ihre Geometrie) + 1 Schein (w-6120)
//   alke     -> 1 Strich                  + 1 Schein (w-5112)
//   blutmoor -> 1 Strich                  + 0 Scheine (Urteil `neu`: bei uns liegt dort nichts,
//               also nennt kein Item einen Abschnitt -- garetien-plan.php gibt einem `neu` gar
//               keine Trefferliste mit, avesmapsGaretienUrteilNenntTreffer)
// macht 3 Striche und 2 Scheine.
const alke = {
	key: "ggp:Gewaesser:Bach:Alke", name: "Alke", urteil: "ergaenzung",
	geometrie: [[500, 60], [520, 80]],
	abschnitte: [{ public_id: "w-5112", name: "", punkte: 12, geometrie: [[502, 62], [518, 78]] }],
	items: [{ id: 21, anlass: "ergaenzung", selected: 1, abschnitt: { public_id: "w-5112" } }],
};
const blutmoor = {
	key: "ggp:Gewaesser:Sumpf:Blutmoor", name: "Blutmoor", urteil: "neu",
	geometrie: [[800, 300], [860, 320], [840, 360], [800, 300]],
	abschnitte: [],
	items: [{ id: 31, anlass: null, selected: 1 }],
};

const karte = gefaelschteKarte();
tokenAbfragen = [];
avesmapsGaretienKarteZeigen([natter, blutmoor, alke], karte);

const ebenen = karte.ebenen();
gleich(ebenen.length, 5,
	"drei gestrichelte Geometrien plus ZWEI Scheine -- nur das Blutmoor ist `neu` und hat nichts "
	+ "zu beleuchten");

const striche = ebenen.filter((s) => s.options.dashArray);
const scheine = ebenen.filter((s) => !s.options.dashArray);
gleich(striche.length, 3, "jedes angehakte Objekt bekommt seine gestrichelte Geometrie");
gleich(scheine.length, 2, "nur natter und alke aendern einen Abschnitt von uns");

// 💣 Zwei Mittel, nicht eins: ihre Linie liegt oft GENAU auf unserer (Median 1,24 Meilen bei
// 3072 Meilen Kartenbreite). Ein durchgezogener goldener Strich waere optisch ein ERSATZ unserer
// Linie -- gestrichelt sagt „so wuerde es liegen", der breite blasse Schein darunter sagt „das
// hier von uns aendert sich".
scheine.forEach((schein) => {
	wahr(!schein.options.dashArray, "der Schein ist durchgezogen, nicht gestrichelt");
	wahr(schein.options.weight > striche[0].options.weight,
		"der Schein muss BREITER sein als der Strich, sonst ist er kein Schein");
	wahr(schein.options.opacity < 1, "der Schein ist halbdurchsichtig, sonst deckt er unsere Linie zu");
});
striche.forEach((strich) => {
	gleich(strich.options.opacity, 1, "der Strich ist die Aussage und wird nicht abgeschwaecht");
});

// Die Ordnung machen seit Review I1 die PANES (siehe unten). Die Einfuegereihenfolge ist damit
// nicht mehr tragend -- sie bleibt trotzdem festgenagelt, weil sie innerhalb EINER Pane wieder
// entscheiden wuerde, sollte jemand die zwei Panes je zusammenlegen.
const ersterStrich = ebenen.findIndex((s) => s.options.dashArray);
const letzterSchein = ebenen.map((s) => !s.options.dashArray).lastIndexOf(true);
wahr(letzterSchein < ersterStrich,
	"alle Scheine werden VOR allen Strichen gelegt -- in einer gemeinsamen Pane deckte der breite "
	+ "Schein sonst den Strich zu");

// Die Farbe kommt aus dem Token, nicht als Zahl aus dem Zeichner.
ebenen.forEach((schicht) => {
	gleich(schicht.options.color, GOLD, "die Goldfarbe kommt aus --color-marker-active");
});
wahr(tokenAbfragen.indexOf("--color-marker-active") !== -1,
	"das Token wurde gar nicht erst abgefragt -- dann steht die Farbe irgendwo als Zahl");

// Nichts davon nimmt Klicks: die Karte darunter bleibt bedienbar.
ebenen.forEach((schicht) => {
	gleich(schicht.options.interactive, false, "die Zeichnung darf keine Klicks der Karte schlucken");
});

// ZWEI eigene Panes, und ihre Ordnung ist die eigentliche Aussage (Review I1): der Schein ist eine
// HERVORHEBUNG UNSERER Geometrie und gehoert HINTER das, was er hervorhebt; der Strich ist IHR
// Vorschlag und gehoert nach oben. Im Mockup §2 ist die Malreihenfolge nachgemessen:
// Schein -> unsere Flusslinie -> ihr gestrichelter Strich.
const strichPane = karte.getPane("garetienImportPane");
const scheinPane = karte.getPane("garetienImportScheinPane");
wahr(strichPane, "der Zeichner legt keine Pane fuer den Strich an");
wahr(scheinPane, "der Zeichner legt keine eigene Pane fuer den Schein an");
gleich(strichPane.style.pointerEvents, "none", "die Strich-Pane darf keine Zeigerereignisse annehmen");
gleich(scheinPane.style.pointerEvents, "none", "die Schein-Pane darf keine Zeigerereignisse annehmen");

// 💣 UNTER unseren Wegen (roadsPane 400) -- sonst deckt ein 13px breites Goldband unsere 3px
// schmale blaue Linie zu, und aus dem Flussblau wird in der Mischung ein stumpfes Oliv.
wahr(Number(scheinPane.style.zIndex) < 400,
	"der Schein muss UNTER roadsPane (400) liegen, sonst deckt er unsere Linie zu -- gemessen ist "
	+ scheinPane.style.zIndex);
// 💣 Und UEBER der weissen Kontur (roadsOutlinePane 350): darunter zeigte sich vom 13px breiten
// Schein nur der Rand ausserhalb der 5,4px breiten Kontur -- ein duenner Ring statt eines Hofes.
wahr(Number(scheinPane.style.zIndex) > 355,
	"der Schein muss UEBER roadsOutlinePane (350) und regionHoverPane (355) liegen -- gemessen ist "
	+ scheinPane.style.zIndex);
wahr(Number(strichPane.style.zIndex) > 400 && Number(strichPane.style.zIndex) < 470,
	"der Strich liegt ueber den Wegen (roadsPane 400) und unter den Wegenamen (470) -- gemessen ist "
	+ strichPane.style.zIndex);
gleich(Number(strichPane.style.zIndex) === 460, false,
	"460 gehoert measurementPane (js/app/bootstrap.js) -- bei gleichem z-index entscheidet die "
	+ "Einfuegereihenfolge, und das ist keine Regel");
wahr(Number(scheinPane.style.zIndex) < Number(strichPane.style.zIndex),
	"der Schein muss unter dem Strich liegen");
striche.forEach((schicht) => {
	gleich(schicht.options.pane, "garetienImportPane", "der Strich gehoert in die obere Pane");
});
scheine.forEach((schicht) => {
	gleich(schicht.options.pane, "garetienImportScheinPane", "der Schein gehoert in die untere Pane");
});

// ---- 4. Der Schein liegt unter dem RICHTIGEN Abschnitt ----------------------------------------
//
// 💣 Die scharfe Probe: nicht „es gibt einen Schein", sondern „er hat die Punkte von w-6120 und
// NICHT die von w-4471". Ohne diesen Vergleich waere Abschnitt 2 oben halb blind.
const natterSchein = scheine.filter((s) => s._punkte.length === 2 && s._punkte[0][1] === 101)[0];
wahr(natterSchein, "der Schein der Natter ist nicht zu finden");
tief(natterSchein._punkte, [[702, 101], [758, 119]],
	"der Schein traegt die getauschten Punkte von w-6120 -- nicht die von w-4471 ([[900,300],...])");

const natterStrich = striche.filter((s) => s._punkte.length === 3)[0];
tief(natterStrich._punkte, [[700, 100], [720, 110], [760, 120]],
	"ihre Geometrie wird getauscht gezeichnet");

// ---- 5. Das Erloeschen, und dass es keine Leichen zuruecklaesst -------------------------------

avesmapsGaretienKarteZeigen([], karte);
gleich(karte.ebenen().length, 0, "das Erloeschen laesst Leichen zurueck");

// Und die Menge WAECHST und SCHRUMPFT mit den Haken -- der Kern der Owner-Entscheidung vom
// 27.08.2026: „man hakt sich durch die Liste und sieht die Auswahl auf der Karte wachsen".
avesmapsGaretienKarteZeigen([natter], karte);
gleich(karte.ebenen().length, 2, "ein Objekt: sein Strich und sein einer Schein");
avesmapsGaretienKarteZeigen([natter, alke], karte);
gleich(karte.ebenen().length, 4, "zwei Objekte: die Menge waechst");
avesmapsGaretienKarteZeigen([alke], karte);
gleich(karte.ebenen().length, 2, "ein Haken weg: nur dessen Zeichnung verschwindet");

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

// ---- 7. Fenster zu -> die Karte ist sauber ----------------------------------------------------
//
// 💣 Ein zurueckgelassener goldener Strich auf der oeffentlichen Karte waere der schlimmste
// Ausfall dieser Aufgabe: der Besucher saehe goldene Striche ohne jede Erklaerung.
avesmapsGaretienKarteAus(karte);
gleich(karte.ebenen().length, 0, "nach dem Schliessen darf nichts liegenbleiben");
gleich(karte.alles().length, 0, "auch die Ebenengruppe selbst muss von der Karte herunter");

// Zweimal abraeumen ist kein Fehler (das Fenster laesst sich zweimal schliessen).
avesmapsGaretienKarteAus(karte);
gleich(karte.ebenen().length, 0, "zweimal abraeumen darf nicht werfen");

// Und danach zeichnet es wieder -- der Zustand ist die Gruppe, kein Schalter daneben, der haengen
// bleiben koennte.
avesmapsGaretienKarteZeigen([alke], karte);
gleich(karte.ebenen().length, 2, "nach dem Abraeumen muss ein neues Zeichnen wieder ankommen");
avesmapsGaretienKarteAus(karte);

// ---- 8. „Auf der Karte zeigen" bewegt NUR die Ansicht -----------------------------------------

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
	key: "x", name: "Ohne", urteil: "ergaenzung",
	geometrie: [[10, 900], [20, 910]],
	abschnitte: [{ public_id: "w-77", name: "", punkte: 3, geometrie: [] }],
	items: [{ id: 1, selected: 1, abschnitt: { public_id: "w-77" } }],
};
avesmapsGaretienKarteZeigen([ohneAbschnittsGeometrie], karte3);
console.warn = echtesWarn;
gleich(karte3.ebenen().length, 1,
	"ihre Geometrie wird trotzdem gezeichnet -- nur der Schein faellt aus");
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
wahr(!/#[0-9a-fA-F]{3,8}\b/.test(quelle), "keine hartkodierte Farbe -- der Goldton kommt aus dem Token");
wahr(!/\brgba?\(/.test(quelle), "kein hartkodiertes rgb()/rgba()");
wahr(quelle.indexOf('getPropertyValue("--color-marker-active")') !== -1,
	"der Goldton muss aus --color-marker-active kommen (css/base/tokens.css)");

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
	key: "m", name: "Blutmoor", urteil: "neu", geometrie_typ: "Polygon",
	geometrie: [[800, 300], [860, 320], [840, 360], [800, 300]],
	abschnitte: [], items: [{ id: 1, selected: 1 }],
};
const bach = {
	key: "b", name: "Alke", urteil: "ergaenzung", geometrie_typ: "LineString",
	geometrie: [[500, 60], [520, 80]],
	abschnitte: [{ public_id: "w-5112", geometrie: [[502, 62], [518, 78]] }],
	items: [{ id: 2, selected: 1, abschnitt: { public_id: "w-5112" } }],
};
avesmapsGaretienKarteZeigen([moor, bach], karte4);
const moorStrich = karte4.ebenen().filter((e) => e._punkte.length === 4)[0];
const bachStrich = karte4.ebenen().filter((e) => e.options.dashArray && e._punkte.length === 2)[0];
wahr(moorStrich && bachStrich, "die zwei Striche sind nicht zu finden");
gleich(moorStrich._bauer, "polygon", "eine Flaeche wird mit L.polygon gebaut, nicht als Linie");
gleich(moorStrich.options.fill, true, "eine Flaeche bekommt eine Fuellung (Mockup: Blutmoor)");
gleich(moorStrich.options.fillColor, GOLD, "die Fuellung kommt aus demselben Token");
wahr(moorStrich.options.fillOpacity > 0 && moorStrich.options.fillOpacity < 0.3,
	"die Fuellung ist LEICHT, damit die Landschaft darunter lesbar bleibt -- gemessen "
	+ moorStrich.options.fillOpacity);
// Die DIFFERENZ, ohne die die Zeilen darueber nichts filtern: dieselbe Zeichnung fuer eine LINIE.
gleich(bachStrich._bauer, "polyline", "eine Linie bleibt eine Linie");
gleich(bachStrich.options.fill, false, "eine Linie bekommt KEINE Fuellung");
gleich(bachStrich.options.fillOpacity, 0, "eine Linie bekommt keine Fuelldeckkraft");
// 🔴 Der SCHEIN bleibt immer ein Strich, auch unter einer Flaeche: eine zu 55 % gefuellte Flaeche
// ueberdeckte einen See vollstaendig -- man saehe die Hervorhebung, aber nicht das Hervorgehobene.
const bachSchein = karte4.ebenen().filter((e) => !e.options.dashArray)[0];
gleich(bachSchein._bauer, "polyline", "der Schein ist immer ein Strich");
gleich(bachSchein.options.fill, false, "der Schein wird nie gefuellt");
avesmapsGaretienKarteAus(karte4);

// ---- 11c. Fehlt ein Abschnitt in `objekt.abschnitte`, wird er GEMELDET -------------------------
//
// 🪤 Review M1: hier stand ein Rueckfall auf `item.abschnitt`, und er war TOTER CODE mit einem
// beruhigenden Kommentar darueber -- avesmapsGaretienListeAbschnitteVereinen haengt jeden von
// einem Item genannten Abschnitt an die Liste an, die zwei Mengen fallen also zusammen. Entfernt;
// gepruefte Zusicherung ist jetzt das VERHALTEN ohne ihn: kein stiller Flick, sondern ein Befund.
const karte5 = gefaelschteKarte();
const lueckeMeldungen = [];
const warnVorher5 = console.warn;
console.warn = function () { lueckeMeldungen.push(Array.prototype.join.call(arguments, " ")); };
avesmapsGaretienKarteZeigen([{
	key: "l", name: "Luecke", urteil: "ergaenzung", geometrie: [[10, 900], [20, 910]],
	abschnitte: [],
	items: [{ id: 1, selected: 1, abschnitt: { public_id: "w-88", geometrie: [[1, 2], [3, 4]] } }],
}], karte5);
console.warn = warnVorher5;
gleich(karte5.ebenen().length, 1, "ihr Strich wird gezeichnet, der Schein faellt aus");
wahr(lueckeMeldungen.length === 1 && lueckeMeldungen[0].indexOf("w-88") !== -1,
	"ein Abschnitt, der nur am Item haengt, wird GEMELDET statt still nachgeschlagen -- gemeldet "
	+ "wurde: " + JSON.stringify(lueckeMeldungen));
avesmapsGaretienKarteAus(karte5);

// ---- 11d. Der Schein hat eine WEICHE Kante ----------------------------------------------------
//
// Review M2: im Mockup §2 traegt der Schein `filter=url(#glow)` mit `stdDeviation="7"`. Die Buehne
// ist 1360px breit bei viewBox 1360, also 1 SVG-Einheit = 1 CSS-Pixel, und der Radius von
// `drop-shadow` ist das DOPPELTE der Standardabweichung: 14px.
// 💣 Er steht im CSS und nicht im JavaScript, weil nur dort das Farbtoken benutzbar ist.
const kartenCss = fs.readFileSync(path.join(WURZEL, "css", "components", "garetien-importer.css"), "utf8");
const scheinBlock = (kartenCss.match(/\.gi-map-schein\s*\{[^}]*\}/) || [""])[0];
wahr(scheinBlock !== "", "die Regel fuer .gi-map-schein fehlt -- die Gegenprobe misst sonst nichts");
wahr(/drop-shadow\(\s*0\s+0\s+14px/.test(scheinBlock),
	"der Schein braucht die weiche Kante des Mockups (stdDeviation 7 = 14px Radius): " + scheinBlock);
wahr(/var\(--color-marker-active\)/.test(scheinBlock),
	"auch der Weichzeichner nimmt seine Farbe aus dem Token");
// 🪤 `\b` MUSS hier als Wortgrenze stehen. Beim Erzeugen dieser Datei wurde es einmal zu einem
// echten Rueckschritt-Zeichen (0x08) -- das Muster traf dann NIE, und die Zusicherung war Vakuum.
// Die Gegenprobe darunter faengt genau das.
wahr(!/#[0-9a-fA-F]{3,8}\b/.test(scheinBlock) && !/\brgba?\(/.test(scheinBlock),
	"kein hartkodierter Farbwert im .gi-map-schein-Block");
wahr(/#[0-9a-fA-F]{3,8}\b/.test(".gi-x { color: #abcdef; }"),
	"das Farbmuster findet nicht einmal eine echte Farbe -- dann ist die Zeile darueber Vakuum");

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
	"beim Schliessen des Fensters muss die Karte abgeraeumt werden -- sonst bleibt der goldene "
	+ "Strich fuer jeden Besucher liegen");

// Der Knopf steht in der Einzelansicht und nennt sein Objekt selbst.
const detailMarkup = importer.garetienDetailMarkup(natter);
// 🪤 Das gerade Schlusszeichen der Hausform „…" muss in einer doppelt gequoteten Zeichenkette
// ESCAPED werden -- sonst endet sie dort, und die Datei ist syntaktisch kaputt (hier live passiert).
wahr(detailMarkup.indexOf('class="gi-show"') !== -1, "der Knopf „Auf der Karte zeigen\" fehlt");
wahr(detailMarkup.indexOf('data-key="ggp:Gewaesser:Fluss:Natter"') !== -1,
	"der Knopf muss sein Objekt selbst nennen -- sonst braeuchte der Verteiler einen Modulzustand");

// Die DIFFERENZ: ohne Geometrie gibt es nichts anzufliegen, also steht der Knopf auch nicht da.
// Ein Knopf, der nichts tut, ist eine sichtbare Stoerung.
const ohneGeometrie = importer.garetienDetailMarkup({ key: "k", name: "N", abschnitte: [], items: [] });
wahr(ohneGeometrie.indexOf("gi-show") === -1,
	"ohne Geometrie darf der Knopf nicht dastehen -- sonst filtert die Zeile darueber gar nicht");

// Sein Aussehen kommt aus Tokens, wie alles in diesem Fenster (AGENTS.md §12).
const css = fs.readFileSync(path.join(WURZEL, "css", "components", "garetien-importer.css"), "utf8");
const showBlock = (css.match(/\.gi-show\s*\{[^}]*\}/) || [""])[0];
wahr(showBlock !== "", "der .gi-show-Block fehlt -- die Gegenprobe misst sonst nichts");
wahr(!/#[0-9a-fA-F]{3,8}\b/.test(showBlock) && !/\brgba?\(/.test(showBlock),
	"kein hartkodierter Farbwert im .gi-show-Block");
wahr(/var\(--color-button-soft\)/.test(showBlock),
	"eine Zeilen-/Nebenhandlung ist WEICH, nicht gefuellt -- die Haupthandlung heisst „Angehakte "
	+ "uebernehmen\" und steht in der Fusszeile");

// Und der Knopf „Auf der Karte zeigen" fliegt das Objekt an, das er nennt.
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

console.log(`garetien-karte: ${checks} Pruefungen bestanden.`);
