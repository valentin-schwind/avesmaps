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
// voellig anderen Zeile. Das ist hier ZWEIMAL passiert (`art`, dann `bottom: 100%`); benutze
// einfache Anfuehrungszeichen. Gegenprobe: `grep -c '`' auf diese Datei` muss 5 ergeben --
// die drei Kommentar-Backticks oben plus die zwei Template-Grenzen.
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
//   Vegetation -- --color-ecosystem-vegetation / -wald / -steppe.
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

	// 🔴 VIER FLAECHENARTEN, jede in ihrer echten Farbe (Owner 26.08.2026: "gruen fuer wald, blau
	// fuer see, braun fuer gebirge"):
	//   Wald      --color-ecosystem-vegetation-wald      #3f6b2c
	//   Grasland  --color-ecosystem-vegetation           #5f7d33
	//   Steppe    --color-ecosystem-vegetation-steppe    #a8bd8a
	//   See       --color-ecosystem-topographie-see      #4a86b8
	//   Gebirge   --color-ecosystem-topographie-gebirge  #7a6c5e
	//   Huegel    --color-ecosystem-topographie-huegelland #7d8f6e
	// ⚠️ Die Waldflecken liegen dort, wo die Vorlagekachel ihre Waelder hat, und der See auf ihrem
	// Flusslauf -- dieselbe Regel wie bei den Strassen: nachgezeichnet, nicht danebengelegt.
	// 💣 Ausgefranste Raender, keine Baender: so liegen die Flaechen auf der Karte.
	ecosystem:
		'<path d="M0 22 C7 17 12 23 18 19 26 14 33 20 40 15 44 12 46 16 48 14 V30 C43 33 38 27 31 31 24 35 18 29 11 33 6 36 3 31 0 34 Z" fill="#5f7d33" fill-opacity=".8"/>' +
		'<path d="M0 34 C3 31 6 36 11 33 18 29 24 35 31 31 38 27 43 33 48 30 V40 C42 43 37 38 30 41 23 44 17 39 10 42 5 44 3 41 0 43 Z" fill="#a8bd8a" fill-opacity=".78"/>' +
		'<g fill="#3f6b2c" fill-opacity=".85">' +
		'<path d="M2 3 C6 0 11 1 13 4 15 8 11 11 7 10 3 9 0 6 2 3 Z"/>' +
		'<path d="M30 2 C35 0 40 2 41 6 42 10 37 12 33 10 29 8 27 4 30 2 Z"/>' +
		'<path d="M36 20 C41 18 46 21 46 25 46 29 41 30 38 27 35 25 33 22 36 20 Z"/>' +
		'<path d="M13 24 C17 22 21 24 21 27 21 30 17 31 15 29 12 27 11 25 13 24 Z"/>' +
		'<path d="M22 41 C27 39 32 41 32 45 32 48 27 48 24 47 21 45 20 42 22 41 Z"/></g>' +
		'<g fill="#7a6c5e" fill-opacity=".8">' +
		'<path d="M0 44 C4 40 8 45 13 42 18 39 22 44 26 42 L28 48 H0 Z"/></g>' +
		'<path d="M40 44 C43 41 46 44 48 42 V48 H38 Z" fill="#7d8f6e" fill-opacity=".78"/>' +
		'<g fill="#4a86b8" fill-opacity=".85">' +
		'<path d="M0 13 C6 12 10 15 16 15 24 15 32 17 48 18 V21 C32 20 24 18 16 18 10 18 6 16 0 16 Z"/>' +
		'<ellipse cx="20" cy="6" rx="3.4" ry="2"/><ellipse cx="27" cy="9" rx="2.6" ry="1.6"/></g>',

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

// 🔴 Die Landschaften-Ansicht BLENDET den Untergrund ab (Owner 26.08.2026). Der echte Wert fuer
// Besucher ist ECOSYSTEM_UNDERGROUND_FRONTEND = 25 (%), nicht 50 -- Editoren haben dafuer einen
// Regler. Ausgeblendet wird gegen --color-ecosystem-underground (#d3cec2), NICHT gegen Weiss:
// deshalb steht hinter dem Bild eine Flaeche in genau diesem Ton, sonst schiene das Panel durch
// und der Farbeindruck waere ein anderer als auf der Karte.
const GRUND_DECKKRAFT = {
	ecosystem: 0.25
};

const daten = JSON.stringify({
	ansichten: ANSICHTEN.map((a) => Object.assign({}, a, {
		overlay: OVERLAYS[a.wert] || "",
		grundFilter: GRUND_FILTER[a.wert] || "",
		grundDeckkraft: GRUND_DECKKRAFT[a.wert] || 0
	})),
	untergruende: UNTERGRUENDE,
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
	const img = document.createElement("img");
	img.src = grundBild || eintrag.bild; img.alt = ""; img.width = 48; img.height = 48;
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

const docsFassung = loeseRelativ(html);
fs.writeFileSync(path.join(WURZEL, "docs/ansicht-untergrund-mockup.html"), docsFassung);
console.log("geschrieben: docs/ansicht-untergrund-mockup.html  (" + Math.round(docsFassung.length / 1024) + " KB, relative Bildpfade)");

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
