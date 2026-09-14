// Baut docs/ansicht-untergrund-mockup.html -- den Entwurf "Ansicht x Untergrund kreuzen".
//
// 💣 DAS MOCKUP IST EIN BUILD-PRODUKT. Von Hand hineingeschriebene Regeln wirken sofort und sind
// beim naechsten Lauf weg -- dieselbe Falle wie bei css/pages/political-territory-editor-inline.css
// (AGENTS.md §10). Quelle ist DIESE Datei; danach neu erzeugen:
//   node tools/bau-ansicht-untergrund-mockup.js
// Optional als zweites Argument ein Pfad fuer die Fassung ohne <html>/<head>/<body> (Artefakt).
//
// 🔴 Tokens und Picker-CSS werden WOERTLICH aus den echten Dateien kopiert, und die Demos benutzen
// die ECHTEN Klassen (.map-layer-picker__menu/.is-open/__cell). Damit sind Aufrollen, Staffelung
// und Zeiten nicht nachgeahmt, sondern dieselben.
//
// 🔴 GEOMETRIE (26.08.2026 vom Owner richtiggestellt): der Bund #map-corner-actions ist
// `position: fixed; right: 12px; bottom: …` -- er haengt UNTEN RECHTS und waechst nach OBEN.
// Die erste Fassung dieses Mockups liess alles nach unten aufklappen und beantwortete die Frage
// "wie fuehlt sich das an" damit fuer eine Ecke, die es nicht gibt.
//
// 💣 IM TEMPLATE-STRING UNTEN DARF KEIN BACKTICK STEHEN -- auch nicht in einem Kommentar. Er
// beendet den String, und der Fehler zeigt sich als "SyntaxError: Unexpected identifier" an einer
// voellig anderen Zeile. Das ist hier ZWEIMAL passiert (art, dann bottom: 100%); benutze einfache
// Anfuehrungszeichen.
// 🔴 HIER STAND EINE ZAHL -- "grep -c muss 5 ergeben" -- UND SIE WAR FALSCH. Zweifach: grep -c
// zaehlt ZEILEN, nicht Backticks, und seit dem Eintrag waren weitere Kommentarzeilen mit
// Backtick dazugekommen. Eine Zahl liest sich wie eine vollstaendige Liste, die niemand
// nachzaehlt (AGENTS.md §11) -- als Gegenprobe taugt sie nicht.
// 🪤 DANACH STAND HIER NUR PROSA: "node --check auf diese Datei faellt um, sobald es anders
// ist." Auch das ist keine Zusicherung, und der Satz ist sogar falsch: ein EINZELNER Backtick
// bricht den Parser, ein PAAR um etwas Operator-artiges parst anstandslos durch. Nachgemessen
// am 10.09.2026 mit einem eingesetzten Paar um einen gleichwertigen String-Ausdruck:
// node --check GRUEN, Ausgabe zeichengleich -- weder der Parser noch der Gleichheits-Waechter
// haette etwas gesehen.
// ⭐ Geprueft wird deshalb die Sache selbst, mechanisch und ohne Zahl, in
// tools/__tests__/ansicht-untergrund-mockup.test.js (erste Zusicherung, noch VOR dem
// Generatorlauf): ZWISCHEN der Zeile mit dem oeffnenden Template-Backtick und ihrer
// schliessenden Zeile steht kein einziger Backtick; die beiden Grenzen selbst sind die einzigen
// erlaubten. 💣 Die Grenzen sucht sie ZEILENVERANKERT -- ein blankes indexOf("const html =")
// trifft genau DIESEN Absatz, der ueber die Regel spricht.
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..");
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), "utf8");

// 💣 Bilder wandern als PLATZHALTER ins Markup und werden je Fassung verschieden aufgeloest:
// die docs-Fassung verweist relativ (wie docs/layer-kacheln-mockup.html), die Artefakt-Fassung
// bettet als data:-URI ein, weil sie self-contained sein muss.
// 🔴 Der Grund ist nicht Groesse, sondern .gitignore: `tiles/` ist ausgenommen (AGENTS.md §10).
const bild = (p) => "@@" + p + "@@";
const alsDatei = (p) => "data:image/webp;base64," + fs.readFileSync(path.join(WURZEL, p)).toString("base64");
const loeseRelativ = (text) => text.replace(/@@([^@]+)@@/g, (_, pfad) => "../" + pfad);
const loeseEingebettet = (text) => text.replace(/@@([^@]+)@@/g, (_, pfad) => alsDatei(pfad));

const tokens = lies("css/base/tokens.css");
const pickerCss = lies("css/components/map-layer-picker.css");

// 🔴 AUSZUG aus der Quelldatei, keine abgeschriebene Zahl.
const groessenTokens = pickerCss.match(/--map-layer-[a-z-]+:[^;]+;/g) || [];
if (!groessenTokens.length) {
	console.error("ABBRUCH -- in map-layer-picker.css steht kein --map-layer-*-Token mehr.");
	process.exit(1);
}

// 🔴 Die echten Zeiten aus js/ui/map-layer-picker.js.
const SCHWEBE_AUF_MS = 140;
const SCHWEBE_ZU_MS = 260;
const BLENDE_ZU_MS = 130;

const ANSICHTEN = [
	{ wert: "deregraphic", name: "Standard",     bild: bild("icons/layer-tiles/deregraphic.webp") },
	{ wert: "political",   name: "Politisch",    bild: bild("icons/layer-tiles/political.webp") },
	{ wert: "powerlines",  name: "Kraftlinien",  bild: bild("icons/layer-tiles/powerlines.webp") },
	{ wert: "ecosystem",   name: "Landschaften", bild: bild("icons/layer-tiles/ecosystem.webp") },
	{ wert: "none",        name: "Nur Karte",    bild: bild("icons/layer-tiles/none.webp") },
];
// 🔴 „Old" ist seit dem Owner-Entscheid vom 26.08.2026 NUR fuer Editoren sichtbar; im Frontend
// bleiben zwei Untergruende. Das Feld `nurEditor` traegt genau diese eine Regel.
// ⚠️ „spaeter werden es mehr" (Owner) -- deshalb nirgends eine feste Spaltenzahl im CSS.
// 🔴 „Modern" statt „Stilisiert" (Owner 26.08.2026). Verworfen wurden: „Gemalt" (schreibt die
// Arbeit einem Menschen zu, der sie nicht gemacht hat -- eine falsche Angabe, keine
// Geschmacksfrage), „Gelaendekarte" (staende im Menue neben der Ansicht „Landschaften" und
// waere von ihr nicht zu unterscheiden), „Illustriert" (klingt nach Design) sowie
// Generiert / Erzeugt / Errechnet / Synthetisch. Als Satz gelesen traegt Old/Original/Modern.
// 💣 Die KENNUNG bleibt `stylized` -- sie steckt im Ordner tiles/stylized, in geteilten Links
// und in der gemerkten Editor-Einstellung. Dieselbe Trennung wie „Neuigkeiten"/changelog.
const UNTERGRUENDE = [
	{ wert: "old",       name: "Old",        bild: bild("tiles/old/3/map_17_-17.webp"),      nurEditor: true,  labels: true },
	{ wert: "original",  name: "Original",   bild: bild("tiles/original/3/map_17_-17.webp"), nurEditor: false, labels: false },
	{ wert: "stylized",  name: "Modern",    bild: bild("tiles/stylized/3/map_17_-17.webp"), nurEditor: false, labels: false },
];


// 🔴 DIE ANSICHTEN SIND VEKTOREN, KEINE AUFNAHMEN (Owner-Vorschlag 26.08.2026).
// Der Grund ist nicht Bequemlichkeit: eine Aufnahme traegt IHREN Untergrund eingebrannt mit, also
// braeuchte jede Kreuzung ein eigenes Bild (5x3, spaeter 5x4 ...). Ein Vektor ist untergrundfrei
// und liegt ueber JEDER Kachel -- damit ist auch die Bedingung vom Tisch, dass alle Ansichten
// denselben Kartenausschnitt zeigen muessen.
// 💣 Die Farben sind die ECHTEN Kartenfarben, nicht erfundene:
//   Strassen   -- Weiss/Grau/Hellwarm; sie haben BEWUSST kein Token (Vermerk in tokens.css:
//                 "als Text waeren das keine Farben, sondern Rauschen").
//   Orte       -- --color-marker-settlement (#cc2f2a) mit weisser Kontur, wie auf der Karte.
//   Grenzen    -- #d3d3d3, die Aussenkontur aus map-features-boundary-canvas-overlay.js.
//   Kraftlinien-- #ff5f82 aus js/map-features/map-features-powerlines.js.
//   Vegetation -- --color-ecosystem-vegetation / -wald.
// ⚠️ Jede Form traegt eine dunkle Kontur bzw. einen Halo: die Vektoren liegen auf Kacheln von
// hellem Sand bis dunklem Wald, und ohne Absetzung verschwindet die Haelfte davon.
const HALO = 'stroke="#2b2119" stroke-opacity=".45"';
const OVERLAYS = {
	// Ein VERZWEIGTES Netz statt zweier Linien (Owner 26.08.2026): eine Reichsstrasse quer durch,
	// zwei Abzweige, ein Feldweg -- und die Orte sitzen an den Kreuzungen, wie auf der Karte.
	// Jede Strasse liegt doppelt: dunkler Unterzug, heller Kern. Genau so zeichnet sie die Karte
	// (roadsOutline-Pane unter roads-Pane).
	// 🔴 DIE STRASSEN SIND NACHGEZEICHNET, nicht erfunden (Owner 26.08.2026: "zeichne doch einfach
	// die strassen aus der grafik nach"). Vorlage ist die Kachel, die alle drei Untergruende zeigen
	// (z3 / map_17_-17, der Sternknoten Gareth) -- deshalb DECKT sich der Vektor mit dem, was im
	// Bild darunter ohnehin zu sehen ist, statt daneben zu liegen.
	// ⚠️ Koordinaten aus dem 256er-Bild geteilt durch 5,33. Wechselt die Vorlagekachel, wandern
	// diese Zahlen mit -- sie gehoeren zu IHR, nicht zur Ansicht.
	// 💣 Jede Strasse liegt doppelt: dunkler Unterzug, heller Kern. Genau so zeichnet die Karte sie
	// (roadsOutline-Pane unter roads-Pane); ohne den Unterzug verschwinden helle Strassen auf
	// hellem Grund.
	// 🔴 ALLE STRASSEN SIND KURVEN, und jede MUENDET in einem Ort (Owner 26.08.2026). Deshalb
	// haben die drei langen Strassen ZWEI Kurvenstuecke: das erste endet auf dem Ortspunkt, das
	// zweite laeuft von dort weiter aus dem Bild. Eine durchgehende Kurve ginge am Ort vorbei --
	// sie traefe ihn nur zufaellig, und beim naechsten Nachjustieren nicht mehr.
	// ⚠️ Die Endpunkte liegen ABSICHTLICH ausserhalb (-2, 50): eine Strasse, die am Kachelrand
	// aufhoert, sieht aus wie eine Sackgasse.
	deregraphic:
		'<g fill="none" stroke="#2b2119" stroke-opacity=".45" stroke-linecap="round" stroke-linejoin="round">' +
		'<path d="M-2 17 C3 16.3 7.5 15.6 11.5 14.5" stroke-width="4.5"/>' +
		'<path d="M11.5 14.5 C9.6 9.9 7 5.2 4.5 0.5" stroke-width="4"/>' +
		'<path d="M11.5 14.5 C12.8 9.4 14 4.4 14.6 -2" stroke-width="3.6"/>' +
		'<path d="M11.5 14.5 C15.2 10.8 19.4 6.2 24 2" stroke-width="3.6"/>' +
		'<path d="M11.5 14.5 C18 16.4 24.4 17.7 30 18 C37 18.4 43 19 50 19.6" stroke-width="5"/>' +
		'<path d="M11.5 14.5 C17.6 20.4 28.4 29.8 40 39 C43 41.4 46 43.8 49.5 46.5" stroke-width="4.5"/>' +
		'<path d="M11.5 14.5 C10.4 21 8.6 27.4 7 34 C6.2 39.4 5.6 44.6 5 50" stroke-width="4"/>' +
		'<path d="M28 30 C27.4 36 26.6 43 26 50" stroke-width="3"/></g>' +
		'<g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
		'<path d="M-2 17 C3 16.3 7.5 15.6 11.5 14.5" stroke="#efe3cb" stroke-width="2.4"/>' +
		'<path d="M11.5 14.5 C9.6 9.9 7 5.2 4.5 0.5" stroke="#e4d6ba" stroke-width="2"/>' +
		'<path d="M11.5 14.5 C12.8 9.4 14 4.4 14.6 -2" stroke="#e4d6ba" stroke-width="1.8"/>' +
		'<path d="M11.5 14.5 C15.2 10.8 19.4 6.2 24 2" stroke="#d8c8a8" stroke-width="1.8"/>' +
		'<path d="M11.5 14.5 C18 16.4 24.4 17.7 30 18 C37 18.4 43 19 50 19.6" stroke="#fdf8ee" stroke-width="2.8"/>' +
		'<path d="M11.5 14.5 C17.6 20.4 28.4 29.8 40 39 C43 41.4 46 43.8 49.5 46.5" stroke="#efe3cb" stroke-width="2.4"/>' +
		'<path d="M11.5 14.5 C10.4 21 8.6 27.4 7 34 C6.2 39.4 5.6 44.6 5 50" stroke="#e4d6ba" stroke-width="2"/>' +
		'<path d="M28 30 C27.4 36 26.6 43 26 50" stroke="#cbbb9e" stroke-width="1.3" stroke-dasharray="2 2"/></g>' +
		'<g fill="#cc2f2a" stroke="#fff">' +
		'<circle cx="11.5" cy="14.5" r="3.6" stroke-width="1.5"/>' +
		'<circle cx="7" cy="34" r="2.1" stroke-width="1.2"/>' +
		'<circle cx="24" cy="2" r="1.9" stroke-width="1.1"/>' +
		'<circle cx="30" cy="18" r="1.7" stroke-width="1"/>' +
		'<circle cx="40" cy="39" r="1.7" stroke-width="1"/>' +
		'<circle cx="4.5" cy="0.5" r="1.5" stroke-width="1"/></g>',

	// Deckender als zuvor (Owner: "etwas mehr deckend") und mit drei Gebieten statt zweier, damit
	// eine Innengrenze sichtbar wird -- die zeichnet der Layer duenner und gestrichelt.
	political:
		'<path d="M0 0 H25 C23 13 29 19 25 29 L19 48 H0 Z" fill="#a4543f" fill-opacity=".8"/>' +
		'<path d="M25 0 H48 V19 C39 17 33 23 25 29 29 19 23 13 25 0 Z" fill="#5b7a8c" fill-opacity=".8"/>' +
		'<path d="M25 29 C33 23 39 17 48 19 V48 H19 Z" fill="#8a7f4e" fill-opacity=".8"/>' +
		'<g fill="none" stroke="#d3d3d3">' +
		'<path d="M19 48 L25 29 C33 23 39 17 48 19" stroke-width="2.4"/>' +
		'<path d="M25 0 C23 13 29 19 25 29" stroke-width="2.4"/>' +
		'<path d="M25 29 L19 48" stroke-width="1.2" stroke-dasharray="3 2.5" stroke-opacity=".85"/></g>',

	// 🔴 ZWEI KNOTEN, und die Straenge WANDERN AUS DEM BILD (Owner 26.08.2026). Ein Netz, das
	// vollstaendig in 48px passt, sieht aus wie ein Diagramm; Kraftlinien laufen weiter, als man
	// sieht -- deshalb enden alle Linien ausserhalb des viewBox-Randes.
	// 💣 DER GLOW IST EIN DREIFACHER STRANG, kein Schatten -- css/features/powerlines.css:
	//   .powerline--aura  rgba(255, 70, 90, .42)   breit, aussen
	//   .powerline--mid   rgba(255, 105, 130, .82) mittig
	//   .powerline--core  rgba(255, 235, 240, 1)   fast weisser Kern
	// Genau diese drei Lagen, in dieser Reihenfolge. Mit EINER Linie in #ff5f82 (der Zeichenfarbe
	// aus dem JS) fehlt dem Ganzen das Leuchten, das die Ansicht ausmacht.
	// ⚠️ Der Untergrund ist dabei entsaettigt (GRUND_FILTER) -- graue Karte, leuchtende Straenge:
	// das IST das Bild der Kraftlinien-Ansicht.
	powerlines:
		'<g fill="none" stroke-linecap="round">' +
		'<g stroke="rgba(255,70,90,.42)" stroke-width="6">' +
		'<path d="M-4 6 L15 17 L34 31 L54 40"/><path d="M15 17 L21 -4"/><path d="M15 17 L-4 27"/>' +
		'<path d="M34 31 L54 20"/><path d="M34 31 L28 52"/></g>' +
		'<g stroke="rgba(255,105,130,.82)" stroke-width="2.8">' +
		'<path d="M-4 6 L15 17 L34 31 L54 40"/><path d="M15 17 L21 -4"/><path d="M15 17 L-4 27"/>' +
		'<path d="M34 31 L54 20"/><path d="M34 31 L28 52"/></g>' +
		'<g stroke="rgba(255,235,240,1)" stroke-width="1">' +
		'<path d="M-4 6 L15 17 L34 31 L54 40"/><path d="M15 17 L21 -4"/><path d="M15 17 L-4 27"/>' +
		'<path d="M34 31 L54 20"/><path d="M34 31 L28 52"/></g></g>' +
		'<g fill="rgba(255,70,90,.38)"><circle cx="15" cy="17" r="6.5"/><circle cx="34" cy="31" r="5.5"/></g>' +
		'<g fill="rgba(255,105,130,.9)"><circle cx="15" cy="17" r="3.6"/><circle cx="34" cy="31" r="3"/></g>' +
		'<g fill="rgba(255,235,240,1)"><circle cx="15" cy="17" r="1.7"/><circle cx="34" cy="31" r="1.4"/></g>',

	// 🔴 „ALLE" IST DIE UEBERLAGERUNG DER DREI EBENEN-ICONS (Owner 14.09.2026, am gerenderten Bild
	// abgenommen: „du musst dir fuer die icons merken"). Der Wert ist GENAU, in dieser Reihenfolge:
	//   1. die Flaechengruppe aus eco_derographisch (die Gruppe mit fill #575757),
	//   2. eco_vegetation,
	//   3. eco_topographie,
	//   4. die gestrichelte Grenzgruppe aus eco_derographisch.
	// Die Grenzen liegen OBEN -- darunter verschwaenden sie unter Wald und Gebirge. Die Klimazonen
	// gehoeren nicht hinein, und „Alle" traegt nichts Eigenes: kein eigenes Wasser, keinen eigenen Huegel.
	// 💣 Die Teile stehen hier ein ZWEITES Mal, nicht als Verweis: nur dieses Literal laeuft im
	// Zwillings-Test unter vm, eine Konstante davor waere dort unbekannt (ReferenceError). Wer eine
	// der drei Ebenen aendert, aendert „Alle" mit -- der Zwillings-Test haelt die Summe fest und nennt
	// den Teil, der abweicht: tools/__tests__/ansicht-untergrund-vektoren-zwilling.test.js
	// ⚠️ Die zarten Derographie-Fuellungen reisen mit, obwohl die Karte in „Alle" ungefuellt zeichnet:
	// das Icon ist die Summe der Ebenen-Icons, kein Abbild der Karte in dieser Ansicht.
	// Dieselbe Zeichnung ist zugleich die Landschaften-Kachel der ersten Stufe.
	ecosystem:
		'<g fill="#575757">' +
		'<path d="M14 -2 C16.2 2.6 17.4 6.8 19.4 10 21.6 13.5 22.2 17.5 24 22 22.4 27 18.4 31 16.4 36 14.6 40.6 10.4 45 8 50 H-2 V-2 Z" fill-opacity=".13"/>' +
		'<path d="M24 22 C22.2 17.5 21.6 13.5 19.4 10 17.4 6.8 16.2 2.6 14 -2 H50 V34 C45.5 32.6 41.5 28.8 37 27.8 32.5 26.8 28.5 23.2 24 22 Z" fill-opacity=".2"/>' +
		'<path d="M24 22 C28.5 23.2 32.5 26.8 37 27.8 41.5 28.8 45.5 32.6 50 34 V50 H8 C10.4 45 14.6 40.6 16.4 36 18.4 31 22.4 27 24 22 Z" fill-opacity=".09"/></g>' +
		'<path d="M-0.3 9L0 6.4L0.6 6L3 3.7L4.3 3L6 1.5L7.7 0L9 -0.1L12 -0.2L15 -0.2L18 -0.2L21 -0.1L24 0L24.2 0L27 2.3L27.3 3L29.2 6L30 7L33 9L32.3 12L30.1 15L30 15.1L27.5 18L27 21L24 18.8L22.3 21L21 23L20.5 24L21 25.3L21.9 27L22.7 30L24 30.8L27 30.4L27.3 30L27 29.4L26 27L27 25.9L28.6 24L27 21L30 19.9L33 20.6L34.8 21L36 21.4L39 21.9L42 23.2L42.9 24L42.2 27L45 28.9L48 29.5L48 30L48.2 33L48.2 36L48.2 39L48 42L48 42.3L45 42.1L44.9 42L43.2 39L43.2 36L42 34.1L41.2 33L39.1 30L39 29.9L38.1 30L36 30.2L33.3 33L33 33.5L32.5 36L32.3 39L30.7 42L30 42.9L29.1 45L28.6 48L27 48.2L24 48.2L21 48.2L18 48.1L16.9 48L15 45.8L12 45.2L11.3 45L12 42.9L12.7 42L15 41.3L17.3 39L17 36L15 35.4L12 33.3L11.8 33L9 30.1L7.3 30L6 30L5.9 30L3 31.2L2 33L1.8 36L1.8 39L1 42L0.7 45L0.8 48L0 48.1L-0.1 48L-0.1 45L-0.1 42L-0.2 39L-0.2 36L-0.2 33L-0.1 30L-0.2 27L-0.1 24L-0.3 21L-0.4 18L-0.4 15L-0.4 12ZM46.3 0L48 -0.2L48.2 0L48.2 3L48.1 6L48 9L48 9.9L47.6 9L47.1 6L46.4 3Z" fill="#5f7d33" fill-opacity=".62" fill-rule="evenodd"/>' +
		'<path d="M0 9L0 8.6L3 7.7L5.5 9L4.8 12L3 13.1L1.7 15L0.9 18L3 20.8L6 20L8.5 18L9 16.9L11.6 15L9 13.1L7.7 12L6.9 9L9 8.3L12 7.9L14 6L14.3 3L15 1.9L18 3L18 3L20.5 6L21 6.1L24 6.3L27 6.9L28.7 9L28.8 12L27 13.7L24.7 15L24 15.5L21.4 15L21 14.9L18 14.6L16.9 15L15.6 18L15 21L18 23.7L18.1 24L18 24.5L16.4 27L15 29.4L12 28.5L9 28.4L6 28.1L3 27.7L1.9 27L1.4 24L0 21.3L0 21L-0.1 18L-0.1 15L-0.2 12ZM20.8 36L21 35.3L24 34.4L27 34.7L29.6 36L29.6 39L27.7 42L27.1 45L27 45.4L24 45.5L21 47L19.8 45L19.4 42L20.7 39Z" fill="#3f6b2c" fill-opacity=".72" fill-rule="evenodd"/>' +
		'<g fill="#7a6c5e">' +
		'<path d="M-0.1 0L0 -0.1L3 -0.1L6 -0.1L9 -0.1L12 0L15 0L18 -0.1L21 -0.1L24 -0.1L27 -0.1L30 -0.1L33 -0.1L36 -0.1L39 -0.1L42 -0.1L45 -0.1L48 -0.1L48.1 0L48 3L48.1 6L48 9L48.1 12L48 15L48 15.3L45 15L42 15L43.9 12L43 9L42 7.7L39 7.3L36 7.4L33 7.6L30 6.1L29.9 6L27 3.3L24 3.3L23.7 3L21 0.4L18 0.3L15 1.4L12 2.1L10.9 3L9 5.4L8.7 6L7.8 9L6 9.2L3 9.4L0 9.5L-0.1 9L-0.1 6L-0.1 3ZM30.4 42L33 40.3L36 40.4L39 41.1L40.5 42L42 42.9L43.9 42L42.3 39L42 38.3L41.2 36L40.2 33L40.8 30L42 27.9L43.3 27L45 25.6L45.9 24L48 23.8L48 24L48.1 27L48.1 30L48.1 33L48.1 36L48.1 39L48 42L48 45L48 47.5L47.7 48L45 48L42 48.1L39 48.1L36 48.1L35.6 48L33 45.4L32.6 45ZM-0.1 18L0 17.5L0.5 18L3 20.7L5.7 21L5.1 24L5.2 27L4 30L3.2 33L3.1 36L3 37.1L2.8 39L1.9 42L1.3 45L3 47.6L6 46.3L7.5 45L9 44L11.4 42L12 41.6L15 40.9L18 41.6L19 42L21 43.2L24 43.9L24.1 45L27 47.5L27.5 48L27 48.1L24 48.1L21 48.1L18 48.1L15 48.1L12 48.1L9 48.1L6 48L3 48L0 48L0 48L0 45L0 42L-0.1 39L-0.1 36L-0.1 33L-0.1 30L-0.1 27L-0.1 24L-0.1 21Z" fill-opacity=".62"/>' +
		'<path d="M-0.1 0L0 -0.1L3 -0.1L6 0L9 0L12 0L12.5 0L12 0.1L9 2.2L8.3 3L7 6L6.3 9L6 9L3 9.2L0 9.4L-0.1 9L-0.1 6L-0.1 3ZM-0.1 18L0 17.6L0.4 18L3 20.9L4.1 21L3.4 24L3.2 27L3 27.6L2.5 30L2.2 33L2 36L1.4 39L0.3 42L0 42.9L0 42L0 39L-0.1 36L-0.1 33L-0.1 30L0 27L0 24L-0.1 21ZM6.8 48L9 46L10.1 45L12 43.4L15 42L18 43.2L21 44.8L21.7 45L24 45.4L27 47.7L27.3 48L27 48.1L24 48.1L21 48.1L18 48.1L15 48.1L12 48.1L9 48ZM15.9 0L18 0L21 0L24 -0.1L27 -0.1L30 0L33 0L36 0L39 -0.1L42 -0.1L45 0L48 0L48 0L48 3L48 6L48 9L48 12L48 15L48 15.1L46.9 15L46.5 12L46.2 9L45 7.1L44.2 6L42 4.6L39 5.2L36 5.1L33 4.6L30 4.8L27 3.1L24 3.1L23.9 3L21 0.2L18 0.1ZM32.9 42L33 42L35.9 42L36 42L39 43.9L41.8 45L42 45L44.6 48L42 48L39 48L36 48.1L35.7 48L33 45.2L32.8 45ZM42.6 30L45 28.2L46.1 27L47.8 24L48 24L48 24L48 27L48.1 30L48.1 33L48.1 36L48 39L48 42L48 42.9L47.3 42L45 39.2L44.8 39L43.2 36L42.6 33Z" fill-opacity=".55"/></g>' +
		'<path d="M9.5 20.8L10 20.1L10.8 19.4L12.4 18.3L14.8 17.7L15.9 17.4L16.6 17L17.3 16.3L18 16L19.8 15.9L20.7 16.3L21.2 16.3L21.5 16.1L22.5 14.9L24 14.4L24.7 14.3L26.1 14.9L26.6 15.2L27.1 15.3L27.8 15.3L28.5 15.5L29.2 16.1L29.9 16.9L30.2 18L30.9 18.6L32.3 19.9L33.4 20.5L33.6 20.8L33.6 21.2L33.1 21.7L31.3 22.9L30.6 23.3L29.9 24.2L29.8 24.3L29.8 24.7L31.1 26.1L32.3 27.8L32.7 28.9L32.8 29.9L32.7 30.9L32.3 32L31.2 33.8L29.9 35.4L28.6 36.9L27.5 38.7L27.1 39.7L27.1 40.8L27.4 41.8L27.8 42.6L29.1 44.3L30.6 45.7L33.3 48.4L34.6 50.6L33.2 50.6L32.8 49.8L31.7 48.4L28.8 45.7L27.5 44.2L26.3 42.5L25.9 41.4L25.8 40.1L26.1 38.9L26.4 37.9L27.6 36.2L28.9 34.7L30.2 33.1L31.3 31.3L31.5 30.3L31.4 28.9L30.9 28L30.3 27.1L29.7 26.4L29.2 26.1L28.7 27.1L28.4 28.2L28.1 28.5L27.5 28.6L26.4 28.5L25.3 27.9L24.3 27.6L23.6 27.1L22.4 25.3L21.5 24.9L20.8 24.8L20.2 25L18.7 26.1L18 26.9L17.3 27.5L14.8 27.9L14.5 27.8L14.2 27.4L13.6 26.4L12.3 25L11.3 24L10.7 22.2L9.6 21.2Z" fill="#4c89c6" fill-opacity=".9"/>' +
		'<g fill="none" stroke="#2e2e2e" stroke-opacity=".85" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3.4 2.6">' +
		'<path d="M24 22 C22.2 17.5 21.6 13.5 19.4 10 17.4 6.8 16.2 2.6 14 -2" stroke-width="1.7"/>' +
		'<path d="M24 22 C28.5 23.2 32.5 26.8 37 27.8 41.5 28.8 45.5 32.6 50 34" stroke-width="1.7"/>' +
		'<path d="M24 22 C22.4 27 18.4 31 16.4 36 14.6 40.6 10.4 45 8 50" stroke-width="1.5"/>' +
		'</g>',

	// ---- Die fuenf Ebenen als zweite Stufe (09.09.2026) ---------------------------------------
	// 🔴 „Alle" hat KEINEN eigenen Vektor -- es nimmt ecosystem oben. „Alle" ist alle Ebenen
	// uebereinander; zwei getrennte Zeichnungen liefen beim naechsten Umton auseinander.
	// 🔴 Seit 14.09.2026 IST ecosystem die Ueberlagerung von Derographie, Vegetation und Topographie
	// (Regel und Reihenfolge am Eintrag oben). Dieselbe Zeichnung bleibt zugleich die
	// Landschaften-Kachel der ersten Stufe (Owner-Entscheid 09.09.2026, siehe oben).
	// 💣 Die Farben sind die ECHTEN aus css/base/tokens.css, jede aus der Stelle, die sie auf
	// der Karte zeichnet. Wer sie „aufraeumt", macht die Zelle zu einem Symbol, das etwas
	// anderes ankuendigt als die Karte zeigt.
	// ⚠️ KEIN Kachelbild darunter: der Untergrund steht in den Landschaften auf 0 %, und der
	// Grund ist --color-ecosystem-underground (#d3cec2).

	// 🔴 GESTRICHELT, weil die KARTE sie gestrichelt zeichnet (Owner 26.07.2026, Begruendung in
	// css/features/ecosystem-layer.css): eine derographische Flaeche ist ein Verwaltungsbehaelter,
	// und „a container's edge is a convention, not a thing you could walk up to like a forest edge
	// or a ridge" -- die Strichelung gehoert zur ART der Ebene, nicht zu einem Zustand, und bleibt
	// darum in jedem Zustand gestrichelt. Der gebaute Vektor zog sie zuvor DURCHGEHEND -- falsch.
	// ⚠️ Die drei zarten Fuellungen machen den Behaelter auf 48 px erst LESBAR (ungefuellt las sich
	// die Zelle als „nicht geladen"), ohne die Zelle zu einer Landschaftsebene zu machen. Auf der
	// Karte gilt dasselbe: in ihrer EIGENEN Ansicht fuellt die Flaeche ebenso (--eco-fill: 0.16,
	// css/features/ecosystem-layer.css); ungefuellt (0) bleibt sie nur in „Alle".
	// 🔴 Seit 14.09.2026 „deutlich schraeger" (Owner-Abnahme am gerenderten Bild): DREI Gebiete
	// treffen sich in EINEM Punkt, keine Grenze laeuft mehr waag- oder senkrecht -- drei Flaechen mit
	// je eigener Fuellopazitaet (.13 / .2 / .09) statt einer gemeinsamen, plus dieselben drei
	// gestrichelten Grenzlinien wie zuvor. Das runde Element ist ERSATZLOS gefallen: eine Ebene, die
	// Behaelter mit Ecken zeichnet, braucht kein rundes Zeichen darin.
	eco_derographisch:
		'<g fill="#575757">' +
		'<path d="M14 -2 C16.2 2.6 17.4 6.8 19.4 10 21.6 13.5 22.2 17.5 24 22 22.4 27 18.4 31 16.4 36 14.6 40.6 10.4 45 8 50 H-2 V-2 Z" fill-opacity=".13"/>' +
		'<path d="M24 22 C22.2 17.5 21.6 13.5 19.4 10 17.4 6.8 16.2 2.6 14 -2 H50 V34 C45.5 32.6 41.5 28.8 37 27.8 32.5 26.8 28.5 23.2 24 22 Z" fill-opacity=".2"/>' +
		'<path d="M24 22 C28.5 23.2 32.5 26.8 37 27.8 41.5 28.8 45.5 32.6 50 34 V50 H8 C10.4 45 14.6 40.6 16.4 36 18.4 31 22.4 27 24 22 Z" fill-opacity=".09"/></g>' +
		'<g fill="none" stroke="#2e2e2e" stroke-opacity=".85" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3.4 2.6">' +
		'<path d="M24 22 C22.2 17.5 21.6 13.5 19.4 10 17.4 6.8 16.2 2.6 14 -2" stroke-width="1.7"/>' +
		'<path d="M24 22 C28.5 23.2 32.5 26.8 37 27.8 41.5 28.8 45.5 32.6 50 34" stroke-width="1.7"/>' +
		'<path d="M24 22 C22.4 27 18.4 31 16.4 36 14.6 40.6 10.4 45 8 50" stroke-width="1.5"/>' +
		'</g>',

	// Grasland (--color-ecosystem-vegetation #5f7d33) und Wald (--color-ecosystem-vegetation-wald
	// #3f6b2c), je EIN Pfad aus mehreren Teilflaechen (evenodd).
	// 🔴 ZUFAELLIG-ECKIG, NICHT VON HAND GESETZT (Owner 14.09.2026): die Umrisse sind aus einem
	// Rauschfeld mit festem Samen (101) ERZEUGT und vom Owner aus Vorschauen gewaehlt -- ein Ergebnis,
	// keine Zeichnung. Wer hier einen Punkt „glaettet", liefert ein anderes Icon aus, als abgenommen
	// wurde. Steppe, Wuestenfleck und die runden Waldflecken sind dabei gefallen.
	eco_vegetation:
		'<path d="M-0.3 9L0 6.4L0.6 6L3 3.7L4.3 3L6 1.5L7.7 0L9 -0.1L12 -0.2L15 -0.2L18 -0.2L21 -0.1L24 0L24.2 0L27 2.3L27.3 3L29.2 6L30 7L33 9L32.3 12L30.1 15L30 15.1L27.5 18L27 21L24 18.8L22.3 21L21 23L20.5 24L21 25.3L21.9 27L22.7 30L24 30.8L27 30.4L27.3 30L27 29.4L26 27L27 25.9L28.6 24L27 21L30 19.9L33 20.6L34.8 21L36 21.4L39 21.9L42 23.2L42.9 24L42.2 27L45 28.9L48 29.5L48 30L48.2 33L48.2 36L48.2 39L48 42L48 42.3L45 42.1L44.9 42L43.2 39L43.2 36L42 34.1L41.2 33L39.1 30L39 29.9L38.1 30L36 30.2L33.3 33L33 33.5L32.5 36L32.3 39L30.7 42L30 42.9L29.1 45L28.6 48L27 48.2L24 48.2L21 48.2L18 48.1L16.9 48L15 45.8L12 45.2L11.3 45L12 42.9L12.7 42L15 41.3L17.3 39L17 36L15 35.4L12 33.3L11.8 33L9 30.1L7.3 30L6 30L5.9 30L3 31.2L2 33L1.8 36L1.8 39L1 42L0.7 45L0.8 48L0 48.1L-0.1 48L-0.1 45L-0.1 42L-0.2 39L-0.2 36L-0.2 33L-0.1 30L-0.2 27L-0.1 24L-0.3 21L-0.4 18L-0.4 15L-0.4 12ZM46.3 0L48 -0.2L48.2 0L48.2 3L48.1 6L48 9L48 9.9L47.6 9L47.1 6L46.4 3Z" fill="#5f7d33" fill-opacity=".62" fill-rule="evenodd"/>' +
		'<path d="M0 9L0 8.6L3 7.7L5.5 9L4.8 12L3 13.1L1.7 15L0.9 18L3 20.8L6 20L8.5 18L9 16.9L11.6 15L9 13.1L7.7 12L6.9 9L9 8.3L12 7.9L14 6L14.3 3L15 1.9L18 3L18 3L20.5 6L21 6.1L24 6.3L27 6.9L28.7 9L28.8 12L27 13.7L24.7 15L24 15.5L21.4 15L21 14.9L18 14.6L16.9 15L15.6 18L15 21L18 23.7L18.1 24L18 24.5L16.4 27L15 29.4L12 28.5L9 28.4L6 28.1L3 27.7L1.9 27L1.4 24L0 21.3L0 21L-0.1 18L-0.1 15L-0.2 12ZM20.8 36L21 35.3L24 34.4L27 34.7L29.6 36L29.6 39L27.7 42L27.1 45L27 45.4L24 45.5L21 47L19.8 45L19.4 42L20.7 39Z" fill="#3f6b2c" fill-opacity=".72" fill-rule="evenodd"/>',

	// Drei grosse Gebirgsflecken (--color-ecosystem-topographie-gebirge #7a6c5e, zwei Deckkraftlagen)
	// ueber den Rand, in der Mitte ein unregelmaessiger See (--color-water #4c89c6) mit einem duennen,
	// geschlaengelten Fluss, der unten aus der Kachel laeuft -- See und Fluss sind EIN Pfad.
	// 🔴 Wie die Vegetation aus Rauschfeldern mit festem Samen ERZEUGT und vom Owner aus Vorschauen
	// gewaehlt (14.09.2026) -- ein Ergebnis, nicht von Hand gesetzt.
	// ⚠️ Gefallen sind Kamm, Schneekappen, die alte See-Ellipse, das Meer und das Huegelband. Das Meer
	// bleibt auf der Karte anders als der See (--color-ecosystem-topographie-meer), steht aber nicht
	// mehr in der Zelle.
	eco_topographie:
		'<g fill="#7a6c5e">' +
		'<path d="M-0.1 0L0 -0.1L3 -0.1L6 -0.1L9 -0.1L12 0L15 0L18 -0.1L21 -0.1L24 -0.1L27 -0.1L30 -0.1L33 -0.1L36 -0.1L39 -0.1L42 -0.1L45 -0.1L48 -0.1L48.1 0L48 3L48.1 6L48 9L48.1 12L48 15L48 15.3L45 15L42 15L43.9 12L43 9L42 7.7L39 7.3L36 7.4L33 7.6L30 6.1L29.9 6L27 3.3L24 3.3L23.7 3L21 0.4L18 0.3L15 1.4L12 2.1L10.9 3L9 5.4L8.7 6L7.8 9L6 9.2L3 9.4L0 9.5L-0.1 9L-0.1 6L-0.1 3ZM30.4 42L33 40.3L36 40.4L39 41.1L40.5 42L42 42.9L43.9 42L42.3 39L42 38.3L41.2 36L40.2 33L40.8 30L42 27.9L43.3 27L45 25.6L45.9 24L48 23.8L48 24L48.1 27L48.1 30L48.1 33L48.1 36L48.1 39L48 42L48 45L48 47.5L47.7 48L45 48L42 48.1L39 48.1L36 48.1L35.6 48L33 45.4L32.6 45ZM-0.1 18L0 17.5L0.5 18L3 20.7L5.7 21L5.1 24L5.2 27L4 30L3.2 33L3.1 36L3 37.1L2.8 39L1.9 42L1.3 45L3 47.6L6 46.3L7.5 45L9 44L11.4 42L12 41.6L15 40.9L18 41.6L19 42L21 43.2L24 43.9L24.1 45L27 47.5L27.5 48L27 48.1L24 48.1L21 48.1L18 48.1L15 48.1L12 48.1L9 48.1L6 48L3 48L0 48L0 48L0 45L0 42L-0.1 39L-0.1 36L-0.1 33L-0.1 30L-0.1 27L-0.1 24L-0.1 21Z" fill-opacity=".62"/>' +
		'<path d="M-0.1 0L0 -0.1L3 -0.1L6 0L9 0L12 0L12.5 0L12 0.1L9 2.2L8.3 3L7 6L6.3 9L6 9L3 9.2L0 9.4L-0.1 9L-0.1 6L-0.1 3ZM-0.1 18L0 17.6L0.4 18L3 20.9L4.1 21L3.4 24L3.2 27L3 27.6L2.5 30L2.2 33L2 36L1.4 39L0.3 42L0 42.9L0 42L0 39L-0.1 36L-0.1 33L-0.1 30L0 27L0 24L-0.1 21ZM6.8 48L9 46L10.1 45L12 43.4L15 42L18 43.2L21 44.8L21.7 45L24 45.4L27 47.7L27.3 48L27 48.1L24 48.1L21 48.1L18 48.1L15 48.1L12 48.1L9 48ZM15.9 0L18 0L21 0L24 -0.1L27 -0.1L30 0L33 0L36 0L39 -0.1L42 -0.1L45 0L48 0L48 0L48 3L48 6L48 9L48 12L48 15L48 15.1L46.9 15L46.5 12L46.2 9L45 7.1L44.2 6L42 4.6L39 5.2L36 5.1L33 4.6L30 4.8L27 3.1L24 3.1L23.9 3L21 0.2L18 0.1ZM32.9 42L33 42L35.9 42L36 42L39 43.9L41.8 45L42 45L44.6 48L42 48L39 48L36 48.1L35.7 48L33 45.2L32.8 45ZM42.6 30L45 28.2L46.1 27L47.8 24L48 24L48 24L48 27L48.1 30L48.1 33L48.1 36L48 39L48 42L48 42.9L47.3 42L45 39.2L44.8 39L43.2 36L42.6 33Z" fill-opacity=".55"/></g>' +
		'<path d="M9.5 20.8L10 20.1L10.8 19.4L12.4 18.3L14.8 17.7L15.9 17.4L16.6 17L17.3 16.3L18 16L19.8 15.9L20.7 16.3L21.2 16.3L21.5 16.1L22.5 14.9L24 14.4L24.7 14.3L26.1 14.9L26.6 15.2L27.1 15.3L27.8 15.3L28.5 15.5L29.2 16.1L29.9 16.9L30.2 18L30.9 18.6L32.3 19.9L33.4 20.5L33.6 20.8L33.6 21.2L33.1 21.7L31.3 22.9L30.6 23.3L29.9 24.2L29.8 24.3L29.8 24.7L31.1 26.1L32.3 27.8L32.7 28.9L32.8 29.9L32.7 30.9L32.3 32L31.2 33.8L29.9 35.4L28.6 36.9L27.5 38.7L27.1 39.7L27.1 40.8L27.4 41.8L27.8 42.6L29.1 44.3L30.6 45.7L33.3 48.4L34.6 50.6L33.2 50.6L32.8 49.8L31.7 48.4L28.8 45.7L27.5 44.2L26.3 42.5L25.9 41.4L25.8 40.1L26.1 38.9L26.4 37.9L27.6 36.2L28.9 34.7L30.2 33.1L31.3 31.3L31.5 30.3L31.4 28.9L30.9 28L30.3 27.1L29.7 26.4L29.2 26.1L28.7 27.1L28.4 28.2L28.1 28.5L27.5 28.6L26.4 28.5L25.3 27.9L24.3 27.6L23.6 27.1L22.4 25.3L21.5 24.9L20.8 24.8L20.2 25L18.7 26.1L18 26.9L17.3 27.5L14.8 27.9L14.5 27.8L14.2 27.4L13.6 26.4L12.3 25L11.3 24L10.7 22.2L9.6 21.2Z" fill="#4c89c6" fill-opacity=".9"/>',

	// 🔴 Die echten Toene der Temperaturskala, kalt oben nach warm unten. Die Ebene wird nicht
	// gezeichnet, sondern aus Trennlinien ABGELEITET -- deshalb sind die Kanten hier leicht
	// bewegt und nicht schnurgerade: so liegen sie auf der Karte.
	// 🔴 HIER STAND EINE ZAHL ("ACHT Baender"). Eine Zahl liest sich wie eine vollstaendige
	// Liste, und niemand zaehlt nach (AGENTS.md §11): die Zonen sind DATEN
	// (AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED in api/_internal/app/ecosystem.php), und die Zelle
	// zeichnet eine Staffel, keine Zaehlung. Die Veralterung ist daneben schon eingetreten --
	// css/base/tokens.css spricht bei derselben Skala von „Sieben Bändern … aus sechs
	// Trennlinien" und fuehrt acht Toene (fremder Umfang, hier bewusst nicht angefasst).
	eco_klima:
		'<path d="M0 0 H48 V6 C36 7.4 24 4.8 12 6.2 8 6.7 4 6 0 6.6 Z" fill="#cfe0eb" fill-opacity=".9"/>' +
		'<path d="M0 6.6 C4 6 8 6.7 12 6.2 24 4.8 36 7.4 48 6 V12 C36 13.6 24 10.8 12 12.4 8 12.9 4 12.2 0 12.8 Z" fill="#a2c3d1" fill-opacity=".9"/>' +
		'<path d="M0 12.8 C4 12.2 8 12.9 12 12.4 24 10.8 36 13.6 48 12 V18.4 C36 19.6 24 17.2 12 18.6 8 19 4 18.4 0 19 Z" fill="#7aada9" fill-opacity=".9"/>' +
		'<path d="M0 19 C4 18.4 8 19 12 18.6 24 17.2 36 19.6 48 18.4 V24.6 C36 26 24 23.4 12 24.8 8 25.2 4 24.6 0 25.2 Z" fill="#bfc888" fill-opacity=".9"/>' +
		'<path d="M0 25.2 C4 24.6 8 25.2 12 24.8 24 23.4 36 26 48 24.6 V31 C36 32.4 24 29.8 12 31.2 8 31.6 4 31 0 31.6 Z" fill="#dcb857" fill-opacity=".9"/>' +
		'<path d="M0 31.6 C4 31 8 31.6 12 31.2 24 29.8 36 32.4 48 31 V37.2 C36 38.6 24 36 12 37.4 8 37.8 4 37.2 0 37.8 Z" fill="#cdb083" fill-opacity=".9"/>' +
		'<path d="M0 37.8 C4 37.2 8 37.8 12 37.4 24 36 36 38.6 48 37.2 V43.4 C36 44.8 24 42.2 12 43.6 8 44 4 43.4 0 44 Z" fill="#d98f3c" fill-opacity=".9"/>' +
		'<path d="M0 44 C4 43.4 8 44 12 43.6 24 42.2 36 44.8 48 43.4 V48 H0 Z" fill="#c65e2e" fill-opacity=".9"/>',

	// „Nur Karte" ist LEER, und das ist die Aussage: hier liegt nichts ueber dem Untergrund.
	none: ""
};

// 🔴 Was die ANSICHT mit dem Untergrund macht -- nicht mit sich selbst. Der Wert ist der echte aus
// js/map-features/map-features-powerlines.js bzw. dem Kommentar in tools/layer-tiles/capture.js
// ("Die Entsaettigung ist NICHT erfunden: syncPowerlineMapTint faerbt die Grundkarte mit genau
// diesen Werten"). Als Filter auf der Untergrund-Schicht stimmt er auf JEDEM Kachelsatz --
// eingebrannt in eine Aufnahme galt er nur fuer den einen, auf dem sie entstand.
const GRUND_FILTER = {
	powerlines: "saturate(0.1) brightness(0.6)"
};

// 🔴 Die Landschaften-Ansicht BLENDET den Untergrund ab (Owner 26.08.2026). Ausgeblendet wird
// gegen --color-ecosystem-underground (#d3cec2), NICHT gegen Weiss: deshalb steht hinter dem Bild
// eine Flaeche in genau diesem Ton, sonst schiene das Panel durch und der Farbeindruck waere ein
// anderer als auf der Karte.
//
// ⚠️ DIE 0.25 SIND SEIT DEM 09.09.2026 NICHT MEHR DER ECHTE WERT. Bis 10.09.2026 stand hier, der
// Besucher sehe ECOSYSTEM_UNDERGROUND_FRONTEND = 25 (%) -- das galt bis zum 23.08.2026 und danach
// nur noch fuer „Alle"; seit dem 09.09.2026 schreibt das Anzeigeprofil allen fuenf Ebenen 0 % vor
// (ECOSYSTEM_FRONTEND_PROFIL in js/map-features/map-features-ecosystem-layer-switch.js), und bei
// 0 % nimmt syncEcosystemBaseTiles die Kachelebene ganz von der Karte. Die Kachel zeigt also einen
// Untergrund, den es auf der Karte nicht mehr gibt. 🔧 Die ZAHL hier aendert Aufgabe 8 des Umbaus
// -- absichtlich nicht hier, damit eine Kommentarkorrektur nicht nebenbei das Bild umstellt.
// ⚠️ Derselbe Absatz steht im Picker (js/ui/map-layer-picker.js). Er stand dort seit dem
// 10.09.2026 richtig und HIER noch falsch: ein Zwilling wird an BEIDEN Haelften nachgezogen,
// sonst liest der naechste die Haelfte, die ihm zuerst unterkommt.
const GRUND_DECKKRAFT = {
	ecosystem: 0.25
};

// 🔴 DIE FUENF EBENEN DER ZWEITEN STUFE. Die vier Vektoren kommen aus OVERLAYS oben -- „Alle" hat
// KEINEN eigenen: es nimmt den der Ansicht (OVERLAYS.ecosystem), denn „Alle" IST alle Ebenen
// uebereinander. Zwei getrennte Zeichnungen liefen beim naechsten Umton auseinander.
// 🔴 Namen und Schluessel sind die ECHTEN aus index.html (#ecosystem-layer-switch):
// data-ecosystem-kind traegt derographisch / vegetation / topographie / klima, und „Alle" traegt
// dort bewusst gar keines -- deshalb steht hier der Schluessel alle und kein erfundenes Kind.
const EBENEN = [
	{ kind: "alle",          name: "Alle",        overlay: OVERLAYS.ecosystem },
	{ kind: "derographisch", name: "Derographie", overlay: OVERLAYS.eco_derographisch },
	{ kind: "vegetation",    name: "Vegetation",  overlay: OVERLAYS.eco_vegetation },
	{ kind: "topographie",   name: "Topographie", overlay: OVERLAYS.eco_topographie },
	{ kind: "klima",         name: "Klimazonen",  overlay: OVERLAYS.eco_klima },
];
// 💣 GEGENPROBE: ein Tippfehler im Schluessel gaebe hier lautlos undefined, und die Zelle waere
// leer -- von der absichtlich leeren Zelle von „Nur Karte" nicht zu unterscheiden.
EBENEN.forEach((e) => {
	if (typeof e.overlay !== "string" || !e.overlay.length) {
		console.error("ABBRUCH -- die Ebene " + e.kind + " hat keinen Vektor in OVERLAYS.");
		process.exit(1);
	}
});

const daten = JSON.stringify({
	ansichten: ANSICHTEN.map((a) => Object.assign({}, a, {
		overlay: OVERLAYS[a.wert] || "",
		grundFilter: GRUND_FILTER[a.wert] || "",
		grundDeckkraft: GRUND_DECKKRAFT[a.wert] || 0
	})),
	untergruende: UNTERGRUENDE,
	ebenen: EBENEN,
	zeiten: { auf: SCHWEBE_AUF_MS, zu: SCHWEBE_ZU_MS, blende: BLENDE_ZU_MS },
});

const html = `<!doctype html>
<html lang="de" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Mockup — Ansicht × Untergrund kreuzen</title>
<style>

/* ===== base/tokens.css (woertlich kopiert) ===== */
${tokens}

/* ===== components/map-layer-picker.css (woertlich kopiert) ===== */
${pickerCss}

/* ===== nur fuer dieses Mockup ===== */
:root {
	${groessenTokens.join("\n\t")}
}
body {
	margin: 0;
	padding: 24px 20px 96px;
	background: var(--color-page-bg);
	color: var(--color-text);
	font-family: var(--font-ui);
	font-size: var(--font-size-body);
	line-height: 1.5;
}
.mk-kopf { max-width: 1060px; margin: 0 auto 24px; }
h1 { font-size: var(--font-size-title); margin: 0 0 6px; }
h2 { font-size: var(--font-size-subhead); margin: 0 0 4px; }
.mk-lead { max-width: 70ch; margin: 0 0 6px; }
.mk-dim { color: var(--color-text-muted); font-size: var(--font-size-small); }

.mk-bar { display: flex; gap: 8px; align-items: center; margin: 14px 0 0; flex-wrap: wrap; }
.mk-btn {
	font: inherit; font-size: var(--font-size-small);
	padding: 6px 12px; border-radius: var(--radius-md);
	border: 1px solid var(--color-button-soft-border); background: var(--color-button-soft);
	color: var(--color-text); cursor: pointer;
}
.mk-btn[aria-pressed="true"] { background: var(--color-button); color: var(--color-button-text); border-color: transparent; }

.mk-karten { max-width: 1060px; margin: 0 auto; display: flex; flex-direction: column; gap: 22px; }
.mk-karte {
	background: var(--color-panel); border-radius: var(--radius-md);
	padding: 18px 20px 20px; border: 1px solid var(--color-divider);
}
.mk-karte__kopf { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 2px; }
.mk-tag {
	font-size: var(--font-size-caption); padding: 2px 8px; border-radius: var(--radius-sm);
	background: var(--color-panel-muted); color: var(--color-text-muted);
}
.mk-tag--idee { background: var(--color-link); color: var(--color-panel); }
.mk-tag--tipp { background: var(--color-accent-brown); color: var(--color-panel); }

/* 🔴 Die Buehne bildet die ECHTE Ecke nach: der Bund haengt UNTEN RECHTS und waechst nach oben,
   genau wie #map-corner-actions (position: fixed, right, bottom, flex-column, align-items: end). */
.mk-ecke {
	margin: 14px 0 12px;
	border-radius: var(--radius-sm);
	background-size: 256px 256px;
	min-height: 380px;
	padding: 14px;
	display: flex; flex-direction: column;
	align-items: flex-end;
	justify-content: flex-end;
	gap: 6px;
	position: relative;
}
/* Die beiden Verweise unter der Kachel -- sie zeigen, dass der Bund nach OBEN waechst. */
.mk-ecke__verweise { display: flex; gap: 6px; }
.mk-ecke__verweise span {
	background: var(--color-panel); border: 1px solid var(--color-border-strong);
	border-radius: var(--radius-sm); padding: 5px 10px;
	font-size: var(--font-size-caption); color: var(--color-text);
}
/* Die Telefon-Lage: 375px breit, wie das kleinste uebliche Geraet. Die Buehne bleibt
   rechtsbuendig, damit der Bund dort steht, wo er auch am Telefon steht. */
.mk-ecke--telefon { max-width: 375px; margin-left: auto; }
.mk-ecke__hinweis {
	position: absolute; left: 14px; top: 14px; max-width: 32ch;
	background: var(--color-panel-translucent); color: var(--color-text-muted);
	font-size: var(--font-size-caption); padding: 6px 9px; border-radius: var(--radius-sm);
}

/* Die zwei Stufen stehen uebereinander: das Ansichts-Raster im Fluss, die Untergrund-Reihe
   DARUEBER -- wie das Anzeige-Menue nebenan, das ebenfalls mit 'bottom: 100%' nach oben geht. */
.mk-stufen { position: relative; display: flex; flex-direction: column; align-items: flex-end; }

/* 🔴 DIE TEILUNG. Das Untermenue faehrt als EINE Kachelbreite aus der Ansichtszelle heraus und
   faechert sich in seine Optionen auf. Getragen von 'clip-path' -- derselbe Grund wie beim
   Aufrollen des Hauptrasters: es verschiebt nicht und blendet nicht, und die Zellen darin
   behalten ihre eigene Staffelung.
   💣 Die Startbreite ist --map-layer-tile (die Silhouette EINER Kachel), nie eine abgeschriebene
   Zahl -- waechst das laengste Wort, waechst die Zelle, und der Spalt begaenne sonst daneben.
   💣 Die Mitte des Spalts setzt das JS als --mk-spalt aus der Lage der Quellzelle: die Reihe
   teilt sich GENAU ueber der Ansicht, auf der der Zeiger steht, nicht in ihrer eigenen Mitte. */
.mk-unterreihe {
	position: absolute;
	bottom: calc(100% + 6px);
	margin: 0;
	--mk-spalt: 50%;
	clip-path: inset(-40px calc(100% - var(--mk-spalt) - var(--map-layer-tile) / 2) -40px
	                 calc(var(--mk-spalt) - var(--map-layer-tile) / 2) round var(--radius-sm));
	transition: clip-path 110ms cubic-bezier(0.4, 0, 1, 1);
}
.mk-unterreihe.is-open {
	clip-path: inset(-40px 0 -40px 0 round var(--radius-sm));
	/* ⚠️ 'left' NUR hier, nicht in der Grundregel: beim ersten Oeffnen soll die Reihe an ihrer
	   Stelle erscheinen, nicht von links hereinfahren. Offen traegt derselbe Wert das Wandern
	   von einer Ansicht zur naechsten. */
	transition: clip-path 190ms cubic-bezier(0.22, 0.61, 0.36, 1), left 160ms cubic-bezier(0.22, 0.61, 0.36, 1);
}
/* Die Zellen der zweiten Stufe blenden von der Teilungsstelle nach aussen auf. Anders als beim
   Hauptraster wird von VORN gezaehlt: hier gibt es keine aktive Zelle, die auf dem Fleck der
   zugeklappten Kachel liegen muesste. */
.mk-unterreihe .map-layer-picker__cell { opacity: 0; transform: translateY(3px); transition: opacity 110ms ease, transform 110ms ease; }
.mk-unterreihe.is-open .map-layer-picker__cell { opacity: 1; transform: none; }
.mk-unterreihe.is-open .map-layer-picker__cell:nth-child(2) { transition-delay: 25ms; }
.mk-unterreihe.is-open .map-layer-picker__cell:nth-child(3) { transition-delay: 50ms; }
.mk-unterreihe.is-open .map-layer-picker__cell:nth-child(4) { transition-delay: 75ms; }
.mk-unterreihe .map-layer-picker__thumb img { object-fit: cover; }

/* 🔴 DIESELBE Markierung wie im Hauptmenue -- nur lesbar gemacht, keine zweite Formensprache.
   Die aktive Zelle traegt schon 2px in --color-link (geteilte Regel, greift hier ebenso).
   Aber die Untergrund-Kacheln sind ECHTE Kartenausschnitte: auf Gruen, Blau und Braun geht ein
   goldbrauner Rand unter, waehrend er auf den ruhigeren Ansichts-Symbolen sofort auffaellt
   (Owner 26.08.2026: "markier auch deutlich die auswahl im untermenue").
   💣 Der helle Ring MUSS zwischen Bild und Goldring liegen, nicht aussen: er trennt die Marke vom
   Bild. Aussen herum wuerde er sie gegen das Panel abgrenzen, wo es gar kein Problem gibt.
   ⚠️ 2 + 2 = 4px nach aussen, bei 6px Spalte bleiben 2px Luft zur Nachbarzelle. */
/* ⚠️ Der Trennstrich liegt INNEN, zwischen Bild und Goldrand -- nicht aussen. Aussen wuerde er
   die Marke gegen das Panel abgrenzen, wo es gar kein Problem gibt; das Problem ist das BILD.
   Aufbau jetzt: Bild -> 1px hell -> 2px Gold. Vorher lag ein Gold-Hell-Gold-Aufbau von 6px
   um die Kachel, und der schob die Marke sichtbar vom Bild weg (Owner 26.08.2026).
   💣 Als Pseudo-Element, nicht als 'inset'-Schatten: das Bild fuellt den Thumb ganz aus und
   deckt einen Innenschatten zu. */
.mk-unterreihe .map-layer-picker__thumb { position: relative; }

/* Der Vektor liegt UEBER dem Untergrund und fuellt die Kachel genau aus. */
.map-layer-picker__thumb { position: relative; }
.mk-overlay { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; }
.mk-unterreihe .map-layer-picker__cell.is-active .map-layer-picker__thumb::before {
	content: "";
	position: absolute;
	inset: 0;
	z-index: 1;
	border: 1px solid var(--color-panel);
	border-radius: inherit;
	pointer-events: none;
}
/* Und der Name sagt es noch einmal -- fuer den Fall, dass die Kachel selbst goldbraune Stellen
   hat (Wueste, Steppe), wo auch der Ring nicht sicher traegt. */
.mk-unterreihe .map-layer-picker__cell.is-active .map-layer-picker__label {
	color: var(--color-link);
	font-weight: 600;
}

/* 💣 DIE LUECKE IST DER FEHLER, NICHT DIE ZEIT. Zwischen Ansichtsreihe und Untermenue liegen
   6px; wer hochfaehrt, ist fuer einen Moment ueber NICHTS, und ein mouseleave dort nimmt die
   Stufe weg, die der Benutzer gerade ansteuert (Owner 26.08.2026: "ziemlich empfindlich").
   Die Bruecke gehoert zur Unterreihe, ueberdeckt die Luecke und ist unsichtbar -- der Weg nach
   oben ist damit lueckenlos.
   ⚠️ Sie liegt INNERHALB des clip-path-Ueberhangs (-40px), wird also nicht weggeschnitten. */
.mk-unterreihe::after {
	content: "";
	position: absolute;
	left: 0; right: 0; bottom: -10px; height: 10px;
}

/* Die Ansicht, aus der die zweite Stufe herausfaehrt, ist markiert -- sonst ist nicht zu sehen,
   wozu die Reihe darueber gehoert. */
.mk-quelle .map-layer-picker__thumb { outline: 2px solid var(--color-accent-brown); outline-offset: 1px; }

/* 🔴 Mehr Luft zwischen Rahmen und Beschriftung (Owner 26.08.2026). Die Zelle ist GETEILT, das
   gilt also beiden Menues -- so soll es sein, sonst stuenden zwei Abstaende nebeneinander.
   ⚠️ Im Produktivcode gehoert der Wert in die Regel in css/components/map-layer-picker.css
   (dort steht heute gap: 3px), nicht als Sonderregel daneben. */
/* 💣 DIE OPTIK DER ZUGEKLAPPTEN KACHEL HAENGT AN EINER ID -- #map-layer-button, und zwar in ZWEI
   Dateien: das Innenmass in map-layer-picker.css (display/padding), Farbe, Kontur, Radius und
   Schatten in der Eckknoepfe-Regel in legal-dialog.css. Ein Mockup, das die KLASSE benutzt, trifft
   davon nichts: es zeigte den grauen Standard-Button des Browsers, und weil das Padding fehlte,
   sass die Kachel 10px enger als das Raster und sprang beim Aufklappen (Owner 26.08.2026).
   Hier als Klasse nachgezogen, mit denselben Werten.
   🔴 DAS IST ZUGLEICH EIN BEFUND FUER DEN BAU: das Menue soll kuenftig mehrfach vorkommen koennen
   (Karte, Editoren). Eine ID traegt genau ein Vorkommen -- die Regeln gehoeren an die Klasse,
   sonst ist das zweite Menue wieder grau.
   💣 Die 5px sind KEINE freie Zahl: Kachel und Raster tragen dieselbe Polsterung und denselben
   1px-Rahmen, nur dadurch enden beide an derselben Kante und die aktive Zelle faellt auf den
   Fleck der Kachel. Wer eine der beiden aendert, aendert beide. */
.map-layer-picker__tile {
	display: block;
	padding: 5px;
	border: 1px solid var(--color-border-strong);
	border-radius: var(--radius-sm);
	background: var(--color-panel);
	color: var(--color-text);
	box-shadow: var(--shadow-panel);
	font: inherit;
	cursor: pointer;
}
/* 💣 UND DER RIEGEL DAZU. 'display: block' schlaegt das hidden-Attribut, also blieb die Kachel
   beim Aufklappen im Fluss STEHEN und schob das Raster um ihre eigene Hoehe nach oben -- gemessen
   49px gegen 130px von der Unterkante (Owner 26.08.2026: "wenn ich mit der maus drueber geh,
   veraendert die grafik ihre position").
   ⚠️ Im Produktivcode faengt das ein GLOBALER Riegel in css/base/reset.css ([hidden] mit !important).
   Das Mockup laedt nur tokens.css und map-layer-picker.css -- ohne diese Zeile fehlt er hier.
   Dieselbe Falle steht als Warnung an .map-layer-picker__menu[hidden] im echten Stylesheet:
   "Muss NACH der display-Regel stehen: [hidden] allein verliert gegen display: grid." */
.map-layer-picker__tile[hidden] { display: none; }
.map-layer-picker__cell { cursor: pointer; gap: 6px; }

/* Die zweite Zeile -- der Untergrund unter dem Ansichtsnamen.
   🔴 VOLL DECKEND, aber in EIGENER FARBE (Owner 26.08.2026): --color-link ist im Menue ohnehin die
   Farbe des Gewaehlten (sie traegt den Rand der aktiven Zelle). Damit gehoert die Zeile sichtbar
   zur Auswahl, statt nur eine blasse Variante des Namens zu sein.
   ⚠️ Vorher stand hier opacity .5 -- gemessen 2,09:1 im hellen Thema, also unter jeder Lesbarkeits-
   schwelle. Bei voller Deckkraft traegt die Farbe den Unterschied, nicht die Blaesse. */
.mk-zweite-zeile {
	margin-top: -3px;
	font-size: var(--font-size-caption);
	color: var(--color-link);
	opacity: 1;
}

/* 🔴 UND SIE BLENDET AUS, SOBALD DAS MENUE AUFKLAPPT (Owner 26.08.2026). Das ist nicht nur Optik:
   im offenen Menue waehlt man den Untergrund in der zweiten Stufe -- die Auskunft in der Zeile
   waere dort veraltet, kaum dass man hinsieht.
   ⭐ Es braucht dafuer KEINEN Zustand im JS: die Zeile sitzt in den Menuezellen, und '.is-open'
   kommt erst im naechsten Bild (das Menue braucht das ohnehin fuer sein Aufrollen). Sie startet
   also bei 1 und blendet von selbst auf 0 -- der Uebergang faellt gratis ab.
   ⚠️ Damit loest sich auch die Frage nach den vier LEEREN Zeilen: offen ist die Zeile ueberall
   unsichtbar, die aktive Zelle bildet keine Ausnahme mehr. Der Platz bleibt reserviert, damit die
   Kachel beim Aufklappen nicht springt. */
.map-layer-picker__menu .mk-zweite-zeile {
	opacity: 1;
	transition: opacity 150ms ease;
}
.map-layer-picker__menu.is-open .mk-zweite-zeile {
	opacity: 0;
}
.mk-gut, .mk-schlecht { margin: 2px 0; padding-left: 20px; position: relative; font-size: var(--font-size-small); }
.mk-gut::before  { content: "+"; position: absolute; left: 6px; color: var(--color-accent-brown); font-weight: 700; }
.mk-schlecht::before { content: "−"; position: absolute; left: 6px; color: var(--color-text-muted); font-weight: 700; }

.mk-stand {
	font-size: var(--font-size-caption); color: var(--color-text-muted);
	margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--color-divider);
}
.mk-stand b { color: var(--color-text); font-weight: 600; }

.mk-grundvergleich { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; }
.mk-probe { width: 256px; }
.mk-probe img { width: 256px; height: 256px; display: block; border-radius: var(--radius-sm); }
.mk-probe figcaption { font-size: var(--font-size-caption); color: var(--color-text-muted); margin-top: 6px; }
.mk-probe b { color: var(--color-text); }
.mk-probe--aus { opacity: .5; }

/* Die fuenf Ebenen der zweiten Stufe (09.09.2026).
   🔴 KEIN Kachelbild darunter: der Untergrund steht in den Landschaften auf 0 %, und der Grund ist
   der Ausblendton der Ebene (--color-ecosystem-underground). Deshalb traegt die Huelle ihn selbst --
   genau so, wie die Ansichtszelle ihn beim Abblenden bekommt.
   ⚠️ Die Huelle hat feste 48x48 aus der Picker-Datei, faellt ohne Bild also nicht zusammen. */
.mk-ebenen { display: flex; gap: var(--mk-spalt); flex-wrap: wrap; margin-top: 12px; align-items: flex-start; }
.mk-ebenen .map-layer-picker__thumb { background: var(--color-ecosystem-underground); }
.mk-ebenen .map-layer-picker__cell { cursor: default; }
</style>
</head>
<body>

<div class="mk-kopf">
	<h1>Ansicht × Untergrund — wie es sich anfühlt</h1>
	<p class="mk-lead">Der Bund hängt <b>unten rechts</b> und wächst nach oben, wie in der echten
	Kartenecke. Beide Menüs sind bedienbar und benutzen die Zeiten des heutigen Pickers:
	${SCHWEBE_AUF_MS} ms bis zum Aufklappen beim Überfahren, ${SCHWEBE_ZU_MS} ms Nachlauf,
	Aufrollen per <code>clip-path</code>. <b>Mit der Maus hinfahren</b> — nicht klicken.</p>
	<div class="mk-bar">
		<button class="mk-btn" type="button" id="mk-thema" aria-pressed="false">Dunkles Thema</button>
		<button class="mk-btn" type="button" id="mk-rolle" aria-pressed="false">Rolle: Besucher</button>
		<button class="mk-btn" type="button" id="mk-langsam" aria-pressed="false">Zeitlupe (4×)</button>
		<button class="mk-btn" type="button" id="mk-telefon" aria-pressed="false">Telefon (375 px)</button>
		<span class="mk-dim">„Old“ sieht nur der Editor. Am Telefon trägt allein der Tipp: erster Tipp öffnet, zweiter wählt.</span>
	</div>
</div>

<div class="mk-karten">

	<section class="mk-karte" id="mk-e">
		<div class="mk-karte__kopf"><h2>E — Untermenü fährt nach oben heraus und teilt sich</h2><span class="mk-tag mk-tag--idee">deine Idee</span></div>
		<p class="mk-lead">Überfahren öffnet die Ansichten. Bleibt der Zeiger auf einer Ansicht,
		fährt darüber ein Untermenü heraus — es beginnt als <b>eine Kachelbreite genau über dieser
		Ansicht</b> und teilt sich dann in die Untergründe auf. Ein Klick darin wählt <b>beides</b>.</p>
		<div class="mk-ecke" data-ecke="e"></div>
		<p class="mk-gut">Eine Bewegung für eine Kombination: hinfahren, hochfahren, klicken.</p>
		<p class="mk-gut">Die Teilung sagt selbst, wozu die Reihe gehört — sie kommt sichtbar aus der Ansicht heraus.</p>
		<p class="mk-gut">Dieselbe Formensprache eine Ebene tiefer: die Kachel faltet sich in die Ansichten, die Ansicht in ihre Untergründe.</p>
		<p class="mk-gut">Wächst die Zahl der Untergründe, wächst nur die Breite dieser einen Reihe.</p>
		<p class="mk-schlecht">Ein zweiter Offen-Zustand — daran hing dieses Menü schon zweimal.</p>
		<p class="mk-schlecht">Am Telefon gibt es kein Überfahren; dort muss ein Tipp auf eine Ansicht sie <i>öffnen</i> statt sie zu <i>wählen</i>.</p>
		<div class="mk-stand" data-stand="e"></div>
	</section>

	<section class="mk-karte" id="mk-a">
		<div class="mk-karte__kopf"><h2>A — Beide Reihen zugleich</h2><span class="mk-tag mk-tag--tipp">zum Vergleich</span></div>
		<p class="mk-lead">Überfahren öffnet beide Reihen auf einmal. Keine zweite Stufe.</p>
		<div class="mk-ecke" data-ecke="a"></div>
		<p class="mk-gut">Nur ein Offen-Zustand, überall dieselbe Geste.</p>
		<p class="mk-schlecht">Zwei Klicks, wenn beides wechseln soll — und der Kasten ist immer eine Reihe höher.</p>
		<div class="mk-stand" data-stand="a"></div>
	</section>

	<section class="mk-karte">
		<div class="mk-karte__kopf"><h2>Worin sich die Untergründe unterscheiden</h2></div>
		<p class="mk-lead mk-dim">Dieselbe Stelle der Karte. Das ist der Grund für die Editor-Regel.</p>
		<div class="mk-grundvergleich" id="mk-proben"></div>
	</section>

	<section class="mk-karte">
		<div class="mk-karte__kopf"><h2>Die fünf Ebenen</h2></div>
		<p class="mk-lead">Die zweite Stufe unter der Ansicht „Landschaften“. Kein Kachelbild darunter —
		der Untergrund steht in den Landschaften auf 0 %, der Grund ist der Ausblendton der Ebene.
		<b>„Alle“ hat keinen eigenen Vektor</b>: es nimmt den der Ansicht, denn „Alle“ <i>ist</i> alle
		Ebenen übereinander — zwei getrennte Zeichnungen liefen beim nächsten Umton auseinander.</p>
		<p class="mk-gut">Seit 14.09.2026 <b>setzt sich „Alle“ zusammen</b>: Derographie-Flächen,
		Vegetation, Topographie und zuoberst die derographischen Grenzen — sonst verschwänden sie unter
		Wald und Gebirge. Die Klimazonen gehören nicht hinein, und „Alle“ trägt nichts Eigenes: kein
		eigenes Wasser, keinen eigenen Hügel.</p>
		<div class="mk-ebenen" id="mk-ebenen"></div>
		<p class="mk-gut">Derographie zieht eine <b>gestrichelte</b> Kontur — das ist die Konvention der
		Ebene: die Kante eines Behälters ist eine Konvention, kein Waldrand zum Anfassen. Sichtbar wird
		sie auf der Karte nur im <b>Bearbeiten-Modus</b> — ein Besucher sieht sie nie.</p>
		<p class="mk-gut">Ihre drei Füllungen bleiben <b>zart</b>. Sie machen den Behälter auf 48 px
		erst lesbar — ungefüllt las sich die Zelle als „nicht geladen“ —, ohne die Zelle zu einer
		Landschaftsebene zu machen; in ihrer <b>eigenen</b> Ansicht füllt die Fläche auf der Karte
		ebenso (0,16), ungefüllt bleibt sie nur in „Alle“.</p>
		<p class="mk-gut">Vegetation und Topographie sind aus Rauschfeldern mit festem Samen erzeugt und
		aus Vorschauen gewählt, nicht von Hand gezeichnet. Topographie trägt drei Gebirge und einen See
		mit Fluss im Wasserton; das Meer steht nicht mehr in der Zelle — auf der Karte bleibt es anders.</p>
		<p class="mk-gut">Die Klimazonen haben bewegte Kanten: die Ebene wird aus Trennlinien abgeleitet,
		nicht gezeichnet.</p>
	</section>

</div>

<script>
const DATEN = ${daten};
let istEditor = false;
let zeitlupe = 1;
let amTelefon = false;

function untergruende() {
	return DATEN.untergruende.filter((g) => istEditor || !g.nurEditor);
}

/**
 * Eine Zelle. 'grundBild' ist der Untergrund, der DARUNTER liegen soll -- bei einer Ansichtszelle
 * also der gerade gewaehlte Kachelsatz. Traegt der Eintrag ein 'overlay', wird es darueber gelegt.
 * 🔴 Genau hier steckt die Antwort auf "was sehe ich bei Kraftlinien x Original": die Kachel zeigt
 * die ECHTE Kreuzung, weil sie sie zusammensetzt statt sie als fertiges Bild zu erwarten.
 */
function zelle(eintrag, aktiv, grundBild) {
	const knopf = document.createElement("button");
	knopf.type = "button";
	knopf.className = "map-layer-picker__cell" + (aktiv ? " is-active" : "");
	knopf.dataset.wert = eintrag.wert;
	const huelle = document.createElement("span");
	huelle.className = "map-layer-picker__thumb";
	// 💣 OHNE Untergrundbild entsteht KEIN <img>. Die fuenf Ebenenzellen der zweiten Stufe
	// haben keinen Untergrund (0 % in den Landschaften), und ein img-Element mit leerem src
	// laedt die Seite selbst nach und zeigt je nach Browser ein Bruchsymbol -- mitten in der
	// Zelle, die nichts als ihren Vektor zeigen soll.
	// ⚠️ Die Huelle behaelt ihre festen 48x48 aus map-layer-picker.css, faellt also nicht
	// zusammen, wenn kein Bild darin liegt.
	const grundQuelle = grundBild || eintrag.bild;
	if (grundQuelle) {
		const img = document.createElement("img");
		img.src = grundQuelle; img.alt = ""; img.width = 48; img.height = 48;
		// 💣 Der Filter gehoert auf das BILD, nicht auf die Zelle: an der Zelle entsaettigte er den
		// Vektor gleich mit, und die Kraftlinien waeren grau statt rosa -- also genau das Merkmal weg,
		// das die Ansicht kenntlich macht.
		if (eintrag.grundFilter) { img.style.filter = eintrag.grundFilter; }
		// 💣 Abblenden heisst hier: durchscheinen lassen auf den Ausblendton der Ebene, nicht auf das
		// Panel. Deshalb bekommt die Huelle den Ton als Hintergrund -- ohne ihn schiene die Panelfarbe
		// durch und der Farbeindruck waere ein anderer als auf der Karte.
		if (eintrag.grundDeckkraft) {
			img.style.opacity = String(eintrag.grundDeckkraft);
			huelle.style.background = "var(--color-ecosystem-underground)";
		}
		huelle.appendChild(img);
	}
	if (eintrag.overlay) {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 48 48");
		svg.setAttribute("class", "mk-overlay");
		svg.setAttribute("aria-hidden", "true");
		svg.innerHTML = eintrag.overlay;
		huelle.appendChild(svg);
	}
	const name = document.createElement("span");
	name.className = "map-layer-picker__label";
	name.textContent = eintrag.name;
	knopf.appendChild(huelle); knopf.appendChild(name);
	return knopf;
}

// 💣 Die aktive Zelle steht ZULETZT -- dieselbe Regel wie im echten Picker: nur so faellt sie beim
// Aufklappen auf den Fleck der zugeklappten Kachel, ohne dass ein Versatz gerechnet wird.
function aktivZuletzt(liste, aktiv) {
	return liste.filter((e) => e.wert !== aktiv).concat(liste.filter((e) => e.wert === aktiv));
}

function baueDemo(art) {
	const ecke = document.querySelector('[data-ecke="' + art + '"]');
	const stand = document.querySelector('[data-stand="' + art + '"]');
	const zustand = { ansicht: "deregraphic", grund: "stylized" };
	let offen = false, festgehalten = false, schwebeTimer = null, blendeTimer = null, stufeTimer = null, stufeZwei = null;

	const huelle = document.createElement("div");
	huelle.className = "map-layer-picker";
	const stufen = document.createElement("div");
	stufen.className = "mk-stufen";
	const unterreihe = document.createElement("div");
	unterreihe.className = "map-layer-picker__menu mk-unterreihe";
	unterreihe.hidden = true;
	const menue = document.createElement("div");
	menue.className = "map-layer-picker__menu";
	menue.hidden = true;
	const kachel = document.createElement("button");
	kachel.type = "button";
	kachel.className = "map-layer-picker__tile";
	stufen.appendChild(unterreihe);
	stufen.appendChild(menue);
	huelle.appendChild(stufen);
	huelle.appendChild(kachel);

	const hinweis = document.createElement("p");
	hinweis.className = "mk-ecke__hinweis";
	const verweise = document.createElement("div");
	verweise.className = "mk-ecke__verweise";
	verweise.innerHTML = "<span>Neuigkeiten</span><span>Hinweise</span>";
	ecke.appendChild(hinweis);
	ecke.appendChild(huelle);
	ecke.appendChild(verweise);

	function zeichneKachel() {
		const a = DATEN.ansichten.find((x) => x.wert === zustand.ansicht);
		const g = untergruende().find((x) => x.wert === zustand.grund) || untergruende()[0];
		kachel.innerHTML = "";
		const z = zelle(a, false, g.bild);
		z.tabIndex = -1;
		// 💣 "Standard · Modern" passt NIE in eine Zeile: die Zelle ist 66px breit, gebunden
		// an das laengste Ansichtswort. Deshalb ZWEI Zeilen -- Ansicht oben, Untergrund darunter
		// gedaempft.
		// 🪤 Die verworfene Alternative war ein Kuerzel (OLD/ORIG/STIL) auf dem Bild. Sie hielt die
		// Kachel 15px flacher, verlangte aber, dass man drei Kuerzel lernt -- und "ORIG" gegen "OLD"
		// ist auf den ersten Blick nicht auseinanderzuhalten. Owner 26.08.2026: "kuerzel sind hier
		// doof". Nicht wieder einfuehren.
		// ⚠️ Die zweite Zeile bekommen ALLE Zellen, im Raster leer. Nur so bleiben Kachel und aktive
		// Zelle gleich hoch -- sonst springt die Kachel wieder, und genau das war eben erst behoben.
		z.querySelector(".map-layer-picker__label").textContent = a.name;
		const zwei = document.createElement("span");
		zwei.className = "map-layer-picker__label mk-zweite-zeile";
		zwei.textContent = g.name;
		z.appendChild(zwei);
		kachel.appendChild(z);
	}

	function zeichneMenue() {
		menue.innerHTML = "";
		// ⚠️ Der echte Picker stellt das per Media Query auf repeat(3, auto). Hier steht es im JS,
		// weil die Buehne nicht der Viewport ist -- die ZAHL ist dieselbe.
		menue.style.gridTemplateColumns = "repeat(" + (amTelefon ? 3 : DATEN.ansichten.length) + ", auto)";
		// 🔴 Jede Ansichtszelle zeigt den GEWAEHLTEN Untergrund unter ihrem Vektor -- wechselt der
		// Untergrund, wechselt das Bild aller fuenf Ansichten mit. Genau das konnte die alte
		// Aufnahme nicht: sie trug ihren Untergrund eingebrannt.
		const grund = untergruende().find((x) => x.wert === zustand.grund) || untergruende()[0];
		aktivZuletzt(DATEN.ansichten, zustand.ansicht).forEach((a) => {
			const k = zelle(a, a.wert === zustand.ansicht, grund.bild);
			// Die zweite Zeile tragen ALLE Zellen -- gefuellt nur die aktive, denn sie ist die Kachel
			// und darf beim Aufklappen ihren Text nicht wechseln. Sichtbar ist sie ohnehin keine:
			// das CSS blendet sie im offenen Menue aus (.map-layer-picker__menu.is-open).
			// ⚠️ Der Platz bleibt trotzdem stehen, sonst springt die Kachel.
			const zweite = document.createElement("span");
			zweite.className = "map-layer-picker__label mk-zweite-zeile";
			zweite.innerHTML = a.wert === zustand.ansicht ? "" : "&nbsp;";
			if (a.wert === zustand.ansicht) { zweite.textContent = grund.name; }
			k.appendChild(zweite);
			if (art === "e" && stufeZwei === a.wert) { k.classList.add("mk-quelle"); }
			if (art === "e") {
				// 💣 HIER STAND zeichneMenue() -- und das war der Animationsfehler: es warf alle fuenf
				// Zellen weg und baute sie neu. Neue Zellen starten bei opacity 0, also blendete bei
				// JEDEM Ueberfahren die ganze Reihe samt Staffelung erneut auf. Umgehaengt wird nur
				// noch die Marke.
				k.addEventListener("mouseenter", () => {
					if (amTelefon || stufeZwei === a.wert) { return; }
					stufeZwei = a.wert;
					markiereQuelle();
					oeffneStufeZwei();
				});
			}
			k.addEventListener("click", () => {
				festgehalten = true;
				if (art !== "e") { zustand.ansicht = a.wert; zeichneAlles(); return; }
				// 🔴 EIN KLICK HAELT DIE ZWEITE STUFE OFFEN (Owner 26.08.2026) -- er waehlt die
				// Ansicht NICHT sofort. Erst der zweite Klick auf dieselbe Ansicht waehlt sie
				// allein, mit dem eingestellten Untergrund. Ein Klick auf einen Untergrund waehlt
				// beides.
				// ⭐ Und genau daraus faellt das Telefon-Verhalten ab: ohne Ueberfahren ist
				// stufeZwei anfangs leer, also OEFFNET der erste Tipp und der zweite waehlt --
				// dasselbe Modell wie am Zeiger, kein zweiter Bedienweg.
				if (stufeZwei === a.wert) { zustand.ansicht = a.wert; schliesse(); return; }
				stufeZwei = a.wert;
				markiereQuelle();
				oeffneStufeZwei();
			});
			menue.appendChild(k);
		});
	}

	/** Haengt nur die Marke um -- ohne eine einzige Zelle neu zu bauen. */
	function markiereQuelle() {
		menue.querySelectorAll(".map-layer-picker__cell").forEach((z) => {
			z.classList.toggle("mk-quelle", art === "e" && z.dataset.wert === stufeZwei);
		});
	}

	function zeichneUnterreihe() {
		const liste = untergruende();
		unterreihe.innerHTML = "";
		unterreihe.style.gridTemplateColumns = "repeat(" + liste.length + ", auto)";
		// ⚠️ Ohne aktivZuletzt: die zweite Stufe hat keine Kachel, auf deren Fleck etwas liegen muss.
		liste.forEach((g) => {
			const k = zelle(g, g.wert === zustand.grund);
			k.addEventListener("click", () => {
				// 🔴 In der zweiten Stufe waehlt ein Klick BEIDES -- das ist ihr eigentlicher Gewinn.
				if (art === "e" && stufeZwei) { zustand.ansicht = stufeZwei; }
				zustand.grund = g.wert;
				// 🔴 UND DANN GEHT ES ZU (Owner 26.08.2026). Eine getroffene Auswahl schliesst das
				// Menue -- genau wie im heutigen Picker, wo waehle() auf schliesse() endet. Offen
				// stehenzubleiben hiesse: die Auswahl ist getroffen, aber das Menue verdeckt die
				// Karte, an der man sie gerade pruefen will.
				// ⚠️ Erst zeichnen, dann schliessen: die zugeklappte Kachel muss den NEUEN Stand
				// tragen, sonst zeigt sie fuer die Dauer der Blende noch den alten.
				zeichneAlles();
				schliesse();
			});
			unterreihe.appendChild(k);
		});
	}

	/** Legt die Reihe ueber die Quellzelle -- und klemmt sie am Rand des Bundes. */
	function positioniereUnterreihe() {
		const quelle = menue.querySelector('.map-layer-picker__cell[data-wert="' + stufeZwei + '"]');
		if (!quelle) { return; }
		const rS = stufen.getBoundingClientRect(), rQ = quelle.getBoundingClientRect();
		const mitte = rQ.left + rQ.width / 2 - rS.left;
		const breite = unterreihe.offsetWidth;
		let links = mitte - breite / 2;
		links = Math.max(0, Math.min(links, rS.width - breite));
		unterreihe.style.left = Math.round(links) + "px";
		unterreihe.style.right = "auto";
		// 💣 Die Teilung beginnt an der QUELLZELLE, nicht in der Mitte der Reihe.
		unterreihe.style.setProperty("--mk-spalt", Math.round(mitte - links) + "px");
	}

	/** Faehrt die zweite Stufe heraus -- oder laesst eine offene zur neuen Ansicht hinueberwandern. */
	function oeffneStufeZwei() {
		if (art !== "e" || !stufeZwei) { return; }
		// 💣 Eine bereits offene Reihe wird NICHT geschlossen und neu aufgefaechert. Genau das sah
		// kaputt aus: beim Wandern von einer Ansicht zur naechsten klappte sie jedes Mal komplett
		// neu auf. Offen heisst: nur die Stelle wechselt, und 'left' traegt den Uebergang
		// (die transition dafuer steht am .is-open-Zweig, damit das ERSTE Setzen springt).
		const warOffen = !unterreihe.hidden && unterreihe.classList.contains("is-open");
		if (warOffen) {
			positioniereUnterreihe();
			return;
		}
		zeichneUnterreihe();
		unterreihe.hidden = false;
		unterreihe.classList.remove("is-open");
		positioniereUnterreihe();
		window.requestAnimationFrame(() => unterreihe.classList.add("is-open"));
	}

	function schliesseStufeZwei() {
		stufeZwei = null;
		unterreihe.classList.remove("is-open");
		window.setTimeout(() => { if (!stufeZwei) { unterreihe.hidden = true; } }, DATEN.zeiten.blende * zeitlupe);
	}

	function oeffne() {
		window.clearTimeout(blendeTimer);
		zeichneMenue();
		offen = true;
		menue.hidden = false;
		kachel.hidden = true;
		if (art === "a") {
			zeichneUnterreihe();
			unterreihe.hidden = false;
			unterreihe.style.left = "auto";
			unterreihe.style.right = "0";
			unterreihe.style.setProperty("--mk-spalt", "100%");
		}
		window.requestAnimationFrame(() => {
			menue.classList.add("is-open");
			if (art === "a") { unterreihe.classList.add("is-open"); }
		});
		zeigeStand();
	}

	function schliesse() {
		if (!offen) { return; }
		offen = false; festgehalten = false; stufeZwei = null;
		menue.classList.remove("is-open");
		unterreihe.classList.remove("is-open");
		window.clearTimeout(blendeTimer);
		blendeTimer = window.setTimeout(() => {
			menue.hidden = true; unterreihe.hidden = true; kachel.hidden = false;
		}, DATEN.zeiten.blende * zeitlupe);
		zeigeStand();
	}

	huelle.addEventListener("mouseenter", () => {
		window.clearTimeout(schwebeTimer);
		// ⚠️ Am Telefon gibt es kein Ueberfahren -- dort traegt allein der Tipp (siehe der
		// Klick-Handler oben). Im echten Picker macht das 'amZeiger.matches' (pointer: fine).
		if (amTelefon || offen) { return; }
		schwebeTimer = window.setTimeout(() => { if (!offen) { oeffne(); } }, DATEN.zeiten.auf * zeitlupe);
	});
	huelle.addEventListener("mouseleave", () => {
		window.clearTimeout(schwebeTimer);
		if (amTelefon || festgehalten || !offen) { return; }
		schwebeTimer = window.setTimeout(() => { if (offen) { schliesse(); } }, DATEN.zeiten.zu * zeitlupe);
	});
	kachel.addEventListener("click", () => { oeffne(); festgehalten = true; });
	// Die zweite Stufe faellt weg, sobald der Zeiger die Ansichtsreihe verlaesst -- es sei denn,
	// er geht nach oben in die zweite Stufe hinein.
	/**
	 * Die zweite Stufe faellt NICHT sofort weg. Sie bekommt denselben Nachlauf wie das Hauptmenue
	 * (SCHWEBE_ZU_MS), und jede Rueckkehr auf Reihe oder Untermenue bricht ihn ab.
	 * 🔴 Zwei Riegel, nicht einer: die Bruecke im CSS schliesst die Luecke, der Nachlauf faengt
	 * alles Uebrige (ein Ausscheren ueber den oberen Rand, eine ruckende Maus).
	 */
	function stufeZweiSpaeterSchliessen() {
		window.clearTimeout(stufeTimer);
		if (festgehalten) { return; }
		stufeTimer = window.setTimeout(() => {
			schliesseStufeZwei();
			// ⚠️ markiereQuelle, NICHT zeichneMenue -- letzteres baute alle Zellen neu und war
			// genau der Animationsfehler, der hier schon einmal behoben wurde.
			markiereQuelle();
		}, DATEN.zeiten.zu * zeitlupe);
	}

	menue.addEventListener("mouseleave", (e) => {
		if (art !== "e" || festgehalten) { return; }
		if (unterreihe.contains(e.relatedTarget)) { return; }
		stufeZweiSpaeterSchliessen();
	});
	menue.addEventListener("mouseenter", () => { window.clearTimeout(stufeTimer); });
	unterreihe.addEventListener("mouseenter", () => {
		window.clearTimeout(schwebeTimer);
		window.clearTimeout(stufeTimer);
	});
	unterreihe.addEventListener("mouseleave", (e) => {
		if (art !== "e" || festgehalten) { return; }
		if (menue.contains(e.relatedTarget)) { return; }
		stufeZweiSpaeterSchliessen();
	});

	function zeigeStand() {
		const a = DATEN.ansichten.find((x) => x.wert === zustand.ansicht);
		const g = untergruende().find((x) => x.wert === zustand.grund) || untergruende()[0];
		const r = (offen ? menue : kachel).getBoundingClientRect();
		stand.innerHTML = "Gewählt: <b>" + a.name + "</b> auf <b>" + g.name + "</b>"
			+ " &nbsp;·&nbsp; " + (offen ? "offen" : "zugeklappt")
			+ " &nbsp;·&nbsp; gemessen: <b>" + Math.round(r.width) + " × " + Math.round(r.height) + " px</b>";
		hinweis.textContent = offen
			? "Der Bund ist nach OBEN gewachsen — die Verweise bleiben unten stehen."
			: "Mit der Maus auf die Kachel unten rechts fahren.";
	}

	function zeichneAlles() {
		if (!untergruende().some((g) => g.wert === zustand.grund)) { zustand.grund = untergruende()[0].wert; }
		zeichneKachel();
		if (offen) { zeichneMenue(); if (art === "a" || stufeZwei) { zeichneUnterreihe(); } }
		zeigeStand();
	}

	zeichneAlles();
	return zeichneAlles;
}

const demos = ["e", "a"].map(baueDemo);

function zeichneProben() {
	const proben = document.getElementById("mk-proben");
	proben.innerHTML = "";
	DATEN.untergruende.forEach((g) => {
		const fig = document.createElement("figure");
		fig.className = "mk-probe" + (g.nurEditor && !istEditor ? " mk-probe--aus" : "");
		const img = document.createElement("img");
		img.src = g.bild; img.alt = "Kachelausschnitt " + g.name;
		const cap = document.createElement("figcaption");
		const text = g.labels
			? "die alte Karte <b>mit aufgedruckten Namen</b> (GARETH, Vierok, Wiesengrund …)"
			: (g.wert === "original"
				? "dieselbe alte Karte, <b>ohne</b> Namen — das Update"
				: "die neu gerenderte Karte, ebenfalls ohne Namen");
		cap.innerHTML = "<b>" + g.name + "</b> — " + text
			+ (g.nurEditor ? ' <span style="color:var(--color-accent-brown)">· nur für Editoren</span>' : "");
		fig.appendChild(img); fig.appendChild(cap);
		proben.appendChild(fig);
	});
}
zeichneProben();

// Die fuenf Ebenen der zweiten Stufe -- dieselbe Zelle wie im Picker, nur ohne Untergrundbild.
// 🔴 Gebaut wird mit zelle(), nicht mit eigenem Markup: eine zweite Zellenform liefe beim naechsten
// Umbau am Picker auseinander, und genau das soll dieses Mockup zeigen koennen.
function zeichneEbenen() {
	const wirt = document.getElementById("mk-ebenen");
	wirt.innerHTML = "";
	DATEN.ebenen.forEach((e) => {
		const k = zelle({ name: e.name, wert: "eco-" + e.kind, overlay: e.overlay, bild: "" }, false, "");
		k.tabIndex = -1;
		wirt.appendChild(k);
	});
}
zeichneEbenen();

document.querySelectorAll(".mk-ecke").forEach((e) => {
	e.style.backgroundImage = "url(" + DATEN.untergruende[2].bild + ")";
});

document.getElementById("mk-thema").addEventListener("click", (e) => {
	const dunkel = document.documentElement.getAttribute("data-theme") === "dark";
	document.documentElement.setAttribute("data-theme", dunkel ? "light" : "dark");
	e.currentTarget.setAttribute("aria-pressed", dunkel ? "false" : "true");
	e.currentTarget.textContent = dunkel ? "Dunkles Thema" : "Helles Thema";
});
document.getElementById("mk-rolle").addEventListener("click", (e) => {
	istEditor = !istEditor;
	e.currentTarget.setAttribute("aria-pressed", istEditor ? "true" : "false");
	e.currentTarget.textContent = istEditor ? "Rolle: Editor" : "Rolle: Besucher";
	demos.forEach((neu) => neu());
	zeichneProben();
});
document.getElementById("mk-telefon").addEventListener("click", (e) => {
	amTelefon = !amTelefon;
	e.currentTarget.setAttribute("aria-pressed", amTelefon ? "true" : "false");
	e.currentTarget.textContent = amTelefon ? "Zeiger (breit)" : "Telefon (375 px)";
	document.querySelectorAll(".mk-ecke").forEach((el) => el.classList.toggle("mk-ecke--telefon", amTelefon));
	demos.forEach((neu) => neu());
});
document.getElementById("mk-langsam").addEventListener("click", (e) => {
	zeitlupe = zeitlupe === 1 ? 4 : 1;
	e.currentTarget.setAttribute("aria-pressed", zeitlupe > 1 ? "true" : "false");
	// Die CSS-Uebergaenge mitziehen -- sonst waeren nur die Wartezeiten langsam, nicht die Bewegung.
	document.querySelectorAll(".map-layer-picker__menu, .map-layer-picker__cell").forEach((el) => {
		el.style.transitionDuration = zeitlupe > 1 ? (150 * zeitlupe) + "ms" : "";
	});
});
</script>
</body>
</html>
`;

// 💣 GEGENPROBE: jeder Tokenname des MOCKUP-EIGENEN Blocks muss in einer der kopierten Quellen stehen.
// Ein erfundener Name macht die ganze Deklaration lautlos ungueltig -- beim ersten Bau standen hier
// --color-ink, --color-ink-muted und --color-page, zwei davon ohne Rueckfall.
const eigenerBlock = html.slice(html.indexOf("/* ===== nur fuer dieses Mockup ===== */"), html.indexOf("</style>"));
const benutzt = [...new Set([...eigenerBlock.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]))];
const quellen = tokens + pickerCss;
const eigene = ["--mk-spalt"]; // im Mockup selbst definiert
const fehlend = benutzt.filter((name) => !quellen.includes(name + ":") && !eigene.includes(name));
if (fehlend.length) {
	console.error("ABBRUCH -- diese Tokennamen gibt es weder in tokens.css noch in map-layer-picker.css:");
	fehlend.forEach((n) => console.error("  " + n));
	process.exit(1);
}
console.log("Tokens geprueft: " + benutzt.length + " Namen, alle vorhanden.");

// 🔴 EINE UMLEITUNG FUER DEN WAECHTER, sonst kann er nicht pruefen, was er pruefen soll.
// tools/__tests__/ansicht-untergrund-mockup.test.js laesst hier erzeugen und vergleicht mit der
// ausgelieferten Datei. Ohne die Umleitung schriebe der Lauf sein eigenes Pruefobjekt neu und
// meldete danach zwangslaeufig Gleichheit -- ein gruener Test, der nichts haelt.
// ⚠️ NICHT ueber process.argv[2]: das ist die ARTEFAKT-Fassung (ohne <html>/<head>/<body>, Bilder
// als data:-URI) und ein anderes Erzeugnis, kein Ziel fuer dieselbe.
const docsZiel = process.env.AVESMAPS_MOCKUP_ZIEL || path.join(WURZEL, "docs/ansicht-untergrund-mockup.html");
const docsFassung = loeseRelativ(html);
fs.writeFileSync(docsZiel, docsFassung);
console.log("geschrieben: " + docsZiel + "  (" + Math.round(docsFassung.length / 1024) + " KB, relative Bildpfade)");

// Zweite Ausgabe fuer die Artefakt-Veroeffentlichung: dieselbe Quelle, aber OHNE die eigenen
// <html>/<head>/<body>-Tags -- die Veroeffentlichung wickelt ihr eigenes Geruest darum.
// 🔴 Zwei Ausgaben aus EINER Quelle, nie zwei gepflegte Dateien.
const rumpf = html
	.replace(/^[\s\S]*?<head>\s*/, "")
	.replace(/<meta[^>]*>\s*/g, "")
	.replace(/<\/head>\s*<body>\s*/, "")
	.replace(/\s*<\/body>\s*<\/html>\s*$/, "");
const artefakt = rumpf
	.replace("<title>Mockup — Ansicht × Untergrund kreuzen</title>", "<title>Ansicht × Untergrund</title>")
	.replace("<script>", '<script>\ndocument.documentElement.setAttribute("data-theme", "light");');
const ziel = process.argv[2];
if (ziel) {
	const eingebettet = loeseEingebettet(artefakt);
	fs.writeFileSync(ziel, eingebettet);
	console.log("geschrieben: " + ziel + "  (" + Math.round(eingebettet.length / 1024) + " KB, Bilder eingebettet)");
}
