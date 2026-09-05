/* 🪤 04.09.2026 Stempel-Heilung nach einem abgebrochenen Deploy -- die Begruendung steht in css/components/fenster.css. */
"use strict";

/*
 * Landschaften — das Höhenfeld ZEICHNEN (V8).
 *
 * Canvas-Overlay über den Topographie-Flächen. Muster: map-features-contested-hatch-overlay.js --
 * eigene Pane, `leaflet-zoom-animated`, Neuzeichnen auf moveend/zoomend/viewreset/resize.
 *
 * 🔴 NUR bei aktiver Landschaften-Ebene UND aktiver Topographie. In jeder anderen Lage ist das Canvas
 * leer; das Umschalten der Ebene löscht es also von selbst.
 *
 * ⭐ `is_trial` wird hier nicht gefiltert und wurde es nie. Seit dem 2026-08-01 ist das keine Ausnahme
 * mehr, sondern der Normalfall: die Erprobung ist abgeschafft, und die Spalte trägt für jede neue
 * Fläche 0. Wer hier je einen Filter einzieht, blendet Gebirge aus, die es längst gibt.
 *
 * 🔴 Farben NUR aus css/base/tokens.css (AGENTS.md §12). Der Prototyp trug seine Rampe als rohe
 * RGB-Tripel im Code (:589); hier steht sie in fünf Token.
 *
 * Liest die Globalen `map`, `L`, `ecosystemLayers`, `labelData` sowie die beiden Höhenmodule.
 */
(function initEcosystemHeightRender() {
	const PANE = "avesmapsEcosystemHeightPane";
	// Rasterschritt in Bildschirmpunkten. Der Prototyp lässt ihn einstellen (:601); hier fest, weil der
	// Wert eine Perf-Entscheidung ist und keine Gestaltungsfrage.
	//
	// 🔴 4 statt 3 (Owner-Entscheid 2026-07-28: „die auflösung etwas zu reduzieren"). Die Antwort auf ein
	// erschöpftes Rechenbudget ist hier gröber zu rechnen, nicht das Budget zu erhöhen -- ein Höhenfeld
	// ist ein weiches Gebilde aus überlagerten Buckeln, dem ein Pixel mehr Kantenlänge nichts nimmt.
	// Der Aufwand fällt quadratisch: 4 px kostet rund 44 % weniger Abfragen als 3 px (1/16 statt 1/9
	// der Pixel), und das kommt genau den Reglern zugute, die jetzt beim Ziehen live neu bauen.
	const STEP = 4;
	const RAMP_TOKENS = [
		"--color-ecosystem-height-0",
		"--color-ecosystem-height-1",
		"--color-ecosystem-height-2",
		"--color-ecosystem-height-3",
		"--color-ecosystem-height-4",
	];
	// 🔴 Die ungleichen Stützstellen des Prototyps (:589), auf Owner-Wunsch zurück. Der Übergang ins
	// Firn sitzt spät (0,8), damit nicht jeder Mittelhang schon weiss wird.
	//
	// Ein früherer Einwand gegen diese Krümmung lautete, sie sei bei einer reinen Graustufe eine
	// versteckte Behauptung über Höhen. Er trägt hier nicht mehr: die Skala ist nicht mehr die
	// Datenaussage (die steht in height_schritt), sondern ausdrücklich eine Lesehilfe, und eine
	// Lesehilfe darf ihre Auflösung dorthin legen, wo man sie braucht.
	const RAMP_STOPS = [0, 0.25, 0.55, 0.8, 1];
	// 🔴 Der Weisspunkt in SCHRITT, absolut (Owner 2026-07-28). Vorher war der Bezug der höchste Gipfel
	// der TREFFENDEN Fläche, die Skala also je Gebirge eine andere -- ein Grauwert bedeutete nichts, was
	// man zwischen zwei Flächen hätte vergleichen können.
	//
	// 💣 DIES ist die Stellschraube, nicht die Farben. Je höher der Wert, desto dunkler und flacher wird
	// alles darunter: bei 15.000 und Gipfeln, die per Vorgabe auf 5.000 stehen, spielt sich der halbe
	// Bestand im unteren Drittel ab. Wer das Relief „zu dunkel" findet, senkt diese Zahl -- er greift
	// nicht in die Rampe und nicht in die Deckkraft.
	//
	// Die Einheit ist SCHRITT, nicht Meter, und steht wie überall im Namen (avesmapsReadOptionalPeakHeight,
	// features.php): V11 multipliziert Höhen in Kantengewichte und trägt dort eine dokumentierte
	// Einheitenfalle. Der Regler im Label-Dialog läuft 0..20.000, dieser Wert liegt also drin.
	// 🔴 EINE DARSTELLUNGSSKALA, KEINE AUSSAGE ÜBER DIE DATEN (Owner-Entscheid 2026-07-28).
	//
	// Weiss heisst „5.000 Schritt ODER MEHR". Darüber wird gekappt: ein 13.000er sieht aus wie ein
	// 10.000er. Das ist ein bewusster Tausch, und der Owner hat ihn richtig begründet -- oben ist die
	// Auflösung verschenkt (den Unterschied sieht niemand), unten entscheidet sie alles (1.000 gegen
	// 5.000 ist Hügel gegen Wall, und genau dort wohnt der Bestand).
	//
	// 💣 DIE ZAHL BLEIBT DIE WAHRHEIT. V11 rechnet Reisezeiten aus `height_schritt`, NIE aus einem
	// Grauwert. Solange das gilt, darf die Anzeige klemmen und stauchen, ohne dass ein Berg dadurch
	// niedriger wird. Wer das je umdreht -- Kantengewichte aus dem gemalten Bild ziehen -- macht aus
	// einer Lesehilfe eine Datenquelle und aus dieser Kappung einen stillen Höhenverlust.
	const HEIGHT_WHITE_SCHRITT = 5000;
	// Ab dieser Höhe ist der Schleier voll deckend. Bewusst die VORGABEHÖHE eines Gipfels
	// (ECOSYSTEM_HEIGHT_DEFAULT): ein unbearbeiteter Gipfel soll deutlich zu sehen sein, sonst prüft
	// niemand, was er noch eintragen muss. Darüber ändert sich nur noch die FARBE, Richtung Weiss --
	// ein 10.000er ist damit heller als ein 5.000er, obwohl beide voll decken.
	// Deckkraft und Farbe fallen jetzt zusammen: bei 5.000 ist beides am Anschlag. Die Konstante
	// bleibt getrennt, weil die zwei Fragen es sind -- wer den Weisspunkt verschiebt, soll nicht
	// unbeabsichtigt auch die Lesbarkeit verschieben.
	const HEIGHT_FULL_VEIL_SCHRITT = 5000;

	function ready() {
		return typeof map !== "undefined" && map && typeof map.createPane === "function" && typeof L !== "undefined";
	}
	if (!ready()) {
		window.setTimeout(initEcosystemHeightRender, 50);
		return;
	}

	if (!map.getPane(PANE)) {
		map.createPane(PANE);
		const created = map.getPane(PANE);
		// 🔴 UNTER DEN FLUESSEN (Owner 04.09.2026: „die gebirge sollen unter flüssen und seen
		// dargestellt werden"), aber UEBER den Flaechenfuellungen der Landschaftsebenen.
		//
		// 💣 UND DAS IST EIN KOMPROMISS, KEIN VOLLTREFFER -- die beiden Haelften des Wunsches schliessen
		// einander aus. Seen UND Gebirgsflaechen liegen in DERSELBEN Pane
		// (`ecosystemPaneTopographie`, 250): ein Canvas kann nicht gleichzeitig ueber der einen und
		// unter der anderen liegen. Mit 249 lag es unter beiden -- und die gefuellte Gebirgsflaeche
		// verdeckte es vollstaendig. Live gemeldet: „ich [sehe] das gebirge gar nicht wenn ich es
		// editiere", gemessen am 04.09.2026 als 249 gegen 250.
		// 🔴 Erfuellt ist damit die Haelfte, die wirklich stoerte: die FLUESSE (`roadsPane`, 400)
		// liegen darueber, und sie sind es, die das Gelaende erklaeren. Ein See INNERHALB der
		// gezeigten Flaeche wird verdeckt -- das Hoehenfeld zeichnet ihn ohnehin als ebene
		// Wasserflaeche, seine Umrisse gehen aber verloren.
		// ⭐ Wer beide Haelften will, muss die Flaechenfuellung der GEZEIGTEN Flaeche durchsichtig
		// schalten, statt an der Stapelung zu drehen; dann kann das Canvas wieder unter 250.
		// ⚠️ 254 ist der letzte Platz ueber allen vier Landschaftsebenen (250-253) und weit unter
		// `avesmapsContestedHatchPane` (300) und `roadsPane` (400).
		created.style.zIndex = 254;
		created.style.pointerEvents = "none";
	}

	const canvas = document.createElement("canvas");
	canvas.style.position = "absolute";
	canvas.style.pointerEvents = "none";
	canvas.style.top = "0";
	canvas.style.left = "0";
	canvas.style.transformOrigin = "0 0";
	// Die Deckkraft steht im Token, nicht hier: sie ist eine Gestaltungsgrösse (AGENTS.md §12), und der
	// Schleier soll die Regionsfarbe darunter durchlassen statt sie zu ersetzen.
	canvas.classList.add("leaflet-zoom-animated", "avesmaps-ecosystem-height-canvas");
	map.getPane(PANE).appendChild(canvas);
	const context = canvas.getContext("2d");

	// Der gebaute Stapel, gültig bis sich Flächen oder Gipfel ändern. Neu zu bauen ist teuer (Buckel,
	// Index, Dämpfungsmessung je Fläche); neu zu ZEICHNEN ist es nicht.
	let heightStack = null;
	let stackDirty = true;
	let rampCache = null;
	let lastPaintMs = 0;
	// Zellen auf der längeren bbox-Seite. 🔴 256 ist keine Wahl, sondern die vorhandene
	// Randbedingung: `avesmapsTerrainGuardRasterShape` weist alles feiner als
	// AVESMAPS_TERRAIN_CELL_SIZE (0,25 Karteneinheiten) ab, weil der Anstieg eine TOTALVARIATION ist
	// und mit der Abtastdichte wächst -- zwei Flächen in verschiedener Auflösung hätten
	// unvergleichbare `ascent_schritt`. Bei der Roten Sichel (64,6 Einheiten) trifft 256 die 0,25
	// fast genau.
	const ECOSYSTEM_HYDRO_RASTER_N = 256;
	// Waehrend am Regler gezogen wird. Ein Viertel der Zellen, rund ein Viertel der Zeit.
	const ECOSYSTEM_HYDRO_RASTER_GROB = 128;
	// 🔴 DER LICHTEINFALL: VON LINKS UNTEN (Owner 04.09.2026). Vorher Nordwest -- die Konvention
	// jeder Reliefkarte, aber der Owner sieht dieses Bild neben einer Karte, deren Gebirge von links
	// unten beleuchtet gezeichnet sind; zwei Lichtquellen nebeneinander lesen sich als Widerspruch.
	//
	// 💣 IN KARTENKOORDINATEN WAECHST y NACH NORDEN (Riva 790, Al'Anfa 152). „Links unten" auf dem
	// Bildschirm ist damit SUEDwesten, also (−x, −y) -- und weil die Lambert-Formel das Skalarprodukt
	// mit dem NEGATIVEN Gradienten bildet, kehren sich beide Vorzeichen um: `+0,6·gx + 0,6·gy`.
	// ⚠️ Ein falsches Vorzeichen macht Berge zu Kratern, und das faellt erst beim zweiten Blick auf.
	// Deshalb ist nur `_LICHT_Y` gewandert, nicht beide: Nordwest war (+gx, −gy), Suedwest ist
	// (+gx, +gy) -- die Ost-West-Haelfte bleibt.
	//
	// 🔴 DAS IST REINE ANZEIGE. Was fuer die Wegfindung gespeichert wird, ist immer das WAHRE
	// Hoehenfeld (`o.h` im Uploader) -- die Schummerung entsteht erst beim Malen und wird nie
	// abgelegt. Owner ausdruecklich: „du speicherst für A* immer nur das wahre höhenfeld".
	const ECOSYSTEM_HYDRO_LICHT_X = 0.6;
	const ECOSYSTEM_HYDRO_LICHT_Y = 0.6;
	const ECOSYSTEM_HYDRO_LICHT_Z = 0.53;

	// Solange der Flächendialog offen ist: volle Deckung statt höhenabhängigem Alpha.
	let solidMode = false;
	let graustufen = false;
	// 🔴 EIN GEBIRGE UND SEINE ÜBERLAPPENDEN NACHBARN -- sonst nichts (Owner 04./05.09.2026). Bis
	// zum 04.09. malte die Leinwand den ganzen Stapel, jede Gebirgsfläche der Karte auf einmal. Das
	// war bei einer Buckelsumme billig (eine Abfrage je Punkt), ist es bei einem gerechneten Raster
	// aber nicht: jede Fläche kostet einen eigenen Erosionslauf. Und es war nie die Frage, die der
	// Editor stellt -- er stellt EINE Fläche ein und will sehen, was er einstellt.
	//
	// 🔴 DIE AUSNAHME SIND ECHTE ÜBERLAPPUNGEN (Owner 05.09.2026: „bei überlappungen kann man gerne
	// auch das andere gebirge angezeigt bekommen, damit man den übergang sieht" -- Anlass waren
	// Finsterkamm und Schwarzkuppen, die sich sechs Gipfel teilen). Sie kosten nichts extra: ihre
	// Raster werden für das Maximum ohnehin gebaut, das Zeichnen kommt gratis dazu.
	// 💣 „Überlappend" heißt POLYGONSCHNITT mit positiver Fläche, nie Rechteckberührung. Genau daran
	// ist der Zustand vom 04.09. gescheitert: `nachbarnVon()` verglich die Hüllrechtecke, und zwei
	// Gebirge, die einander nie berühren, wurden zu einem Verbund -- gemalt wurde er dann bis an das
	// Hüllrechteck der aktiven Fläche und dort schnurgerade abgeschnitten.
	// 🔴 UND ES IST DIESELBE LISTE FÜR BEIDES, Maximum wie Anzeige (`verbundGeometrien`). Zwei
	// Auswahlen wären zwei Begriffe von „gehört dazu", und sie liefen beim ersten Sonderfall
	// auseinander.
	let aktiveFlaeche = null;                // die public_id der Fläche, deren Dialog offen ist
	// Das gerechnete Raster dieser einen Fläche. Teuer (Randwertaufgabe + Erosion, ~1,5 s), also
	// einmal je Parameteränderung -- nicht je Bild. Zoom und Pan malen nur neu.
	let hydroRaster = null;
	let hydroSchluessel = "";
	let hydroLaeuft = null;
	let nachbarSchnittCache = new WeakMap();
	// 💣 EIN RASTERBAU KOSTET RUND 1,5 SEKUNDEN, und die Regler bauen bei JEDEM Zieh-Bild neu.
	// Ungedrosselt heisst das 1,5 s Blockade je Frame -- der Regler fuehlt sich an, als haenge der
	// Tab. Deshalb zwei Aufloesungen: waehrend des Ziehens ein grobes Vorschauraster, beim Loslassen
	// das feine. ⚠️ Der Deckel kann nur GROEBER machen -- feiner als die Speicherschranke wird es nie.
	let hydroGrob = false;
	let hydroFeinTimer = 0;
	// Der Weisspunkt, mit dem ZULETZT GEMALT wurde -- die Auskunft, aus der die Höhenskala im
	// Topographie-Dialog ihre Zahlen zieht (Fall #79).
	//
	// 🔴 SIE LIEST IHN, SIE RECHNET IHN NICHT NACH. Er entsteht unten in redraw() aus dem Stapel;
	// eine zweite Rechnung anderswo wäre eine zweite Wahrheit, und die Legende erklärte irgendwann
	// eine andere Karte als die sichtbare.
	// 🪤 `0` heisst „gerade wird nichts gemalt" (kein Dialog offen, leerer Stapel, Karte ohne
	// Ausdehnung) -- und NICHT „Weisspunkt null". Wer das verwechselt, zeigt eine Skala zu einem
	// Bild, das gar nicht auf der Karte liegt.
	let lastWhitePoint = 0;
	const paintListeners = new Set();

	function meldeAnstrich(weisspunkt) {
		if (weisspunkt === lastWhitePoint) {
			return;                          // redraw() läuft bei JEDER Kartenbewegung -- nur Änderungen melden
		}
		lastWhitePoint = weisspunkt;
		paintListeners.forEach((listener) => {
			try {
				listener(weisspunkt);
			} catch (fehler) {
				// Ein Zuhörer darf das Zeichnen nicht mitreissen: die Karte ist wichtiger als ihre Legende.
				console.warn("Höhenskala: Zuhörer hat geworfen", fehler);
			}
		});
	}

	function rampColors() {
		if (rampCache) {
			return rampCache;
		}
		const style = getComputedStyle(document.documentElement);
		rampCache = RAMP_TOKENS.map((token) => {
			const raw = String(style.getPropertyValue(token) || "").trim();
			const hex = /^#([0-9a-f]{6})$/i.exec(raw);
			if (!hex) {
				return [128, 128, 128];
			}
			const value = parseInt(hex[1], 16);
			return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
		});

		return rampCache;
	}

	// Lineare Interpolation zwischen den fünf Stützstellen (Prototyp ramp() :590).
	function rampAt(t) {
		const colors = rampColors();
		const clamped = Math.max(0, Math.min(1, t));
		for (let i = 0; i < RAMP_STOPS.length - 1; i++) {
			const from = RAMP_STOPS[i];
			const to = RAMP_STOPS[i + 1];
			if (clamped <= to) {
				const k = to === from ? 0 : (clamped - from) / (to - from);
				const a = colors[i];
				const b = colors[i + 1];
				return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
			}
		}

		return colors[colors.length - 1];
	}

	// Welche (Fläche, Stufe) schon gemeldet wurde. Ausserhalb der Felder, damit ein Neubau sie nicht
	// vergisst -- beim Reglerziehen entstehen sonst Dutzende gleicher Meldungen.
	const budgetReported = new Set();

	// Der Name, den der Editor kennt -- nicht die UUID.
	function areaName(publicId) {
		const layer = typeof ecosystemLayers !== "undefined" && ecosystemLayers instanceof Map
			? ecosystemLayers.get(String(publicId || ""))
			: null;

		return String(layer?._ecosystemArea?.region_name || publicId || "Ohne Namen");
	}

	function topographyAreas() {
		if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
			return [];
		}
		const areas = [];
		ecosystemLayers.forEach((layer) => {
			const area = layer?._ecosystemArea;
			// `is_trial` wird NICHT gefiltert -- siehe Kopf (die Erprobung ist abgeschafft).
			if (area && area.kind === "topographie" && String(area.region_type || "") === "gebirge") {
				areas.push(area);
			}
		});

		return areas;
	}

	// Gipfel als flache Liste in KARTENkoordinaten. 💣 Labels tragen [lat, lng] = [y, x], die Geometrie
	// will [x, y] -- bewusst tauschen (AGENTS.md §5).
	function peakList() {
		if (typeof labelData === "undefined" || !Array.isArray(labelData)) {
			return [];
		}

		return labelData
			.filter((label) => isEcosystemPeakSubtype(label?.labelType))
			.map((label) => ({
				publicId: String(label.publicId || ""),
				x: Number(label.coordinates?.[1]),
				y: Number(label.coordinates?.[0]),
				height: label.heightSchritt === undefined ? null : label.heightSchritt,
			}))
			.filter((peak) => Number.isFinite(peak.x) && Number.isFinite(peak.y));
	}

	function ensureStack() {
		if (!stackDirty && heightStack) {
			return heightStack;
		}
		if (typeof buildEcosystemHeightStack !== "function") {
			return null;
		}
		heightStack = buildEcosystemHeightStack(topographyAreas(), peakList());
		// 💣 EIN LEERES ERGEBNIS WIRD NICHT GEMERKT. Die Flächen kommen erst, wenn jemand die
		// Landschaften-Ebene betritt -- die Nachzügler-Durchgänge beim Seitenstart (150/500/1200 ms)
		// laufen also über eine LEERE `ecosystemLayers`. Wurde dieses Nichts als „sauber" abgelegt, baute
		// der Stapel nie wieder, und die Topographie blieb für den Rest der Sitzung leer.
		//
		// Am Livestand genau so gemessen (2026-07-28): 9 Flächen geladen, davon 2 Gebirge, und trotzdem
		// `fields: 0` -- ein `invalidate()` von Hand liess sofort 2 Felder und 1.005.335 gemalte Pixel
		// erscheinen. Die eigene Abnahme hatte das nicht gefunden, weil sie die Flächen VOR dem ersten
		// Zeichnen einspeiste und damit nie den echten Ablauf durchlief.
		//
		// Dieselbe Regel steht in V7 für den Territorien-Fächer, aus demselben Grund.
		stackDirty = !heightStack || heightStack.fields.length === 0;

		return heightStack;
	}

	// Von aussen: die Felder sind veraltet.
	// 💣 SIE MUSS BEIDE WELTEN TREFFEN. Bis zum 04.09.2026 setzte sie nur `stackDirty`/`heightStack`
	// -- die Buckelsumme. Seit der Trichter zeichnet, liest das niemand mehr, und eine Gipfelaenderung
	// liess das ALTE Relief stehen: der Editor verschiebt einen Gipfel und sieht nichts.
	// ⚠️ Ein stilles Falschbild ist schlimmer als ein fehlendes -- man haelt die Aenderung fuer
	// wirkungslos und dreht weiter.
	//
	// 🔴 UND GENAU DESHALB GIBT ES SEIT 05.09.2026 ZWEI ANLAESSE, NICHT EINEN (Owner: „beim pannen der
	// karte verschwindet das höhenbild für eine weile und kommt dann wieder, soll aber bleiben"):
	//
	//   EDIT   -- jemand hat etwas geaendert (Regler, Gipfel, Pinsel). Das Bild geht weg, bis das neue
	//             da ist; der Satz oben gilt unveraendert.
	//   NACHLADEN -- die Karte wurde geschwenkt und der Loader hat Flaechen ausgetauscht. Hier hat
	//             NIEMAND etwas geaendert, und ein leeres Bild waere keine ehrliche Auskunft, sondern
	//             eine Luecke von rund anderthalb Sekunden bei jedem Schwenk.
	//
	// 💣 Das ist keine Aufweichung der Regel darueber, sondern ihre Wiederherstellung: der GEWOEHNLICHE
	// Weg (Schluessel aendert sich, `ensureHydroRaster` startet den Rechner) laesst das alte Bild
	// ohnehin stehen, bis das neue kommt. Nur `invalidate()` fiel aus der Reihe -- und der Loader ruft
	// es bei JEDEM `moveend`, sobald ein Gebirge in den Ausschnitt kommt oder ihn verlaesst.
	// ⚠️ Die Korrektheit haengt nicht an dieser Weiche: `hydroSchluessel` wird in BEIDEN Faellen
	// geleert, und der Schluessel vergleicht WERTE (`hydroFlaechenSchluessel` serialisiert Regler,
	// Gipfel und Kammlinie). Ein Bild, das stehen bleibt, wird also in jedem Fall ersetzt.
	//
	// @param {boolean} [behalteBild] true = Nachladen; das zuletzt gemalte Raster bleibt sichtbar.
	function invalidateEcosystemHeightField(behalteBild) {
		nachbarSchnittCache = new WeakMap();
		hydroLaeuft?.abort();
		hydroLaeuft = null;
		if (behalteBild !== true) {
			hydroRaster = null;
		}
		hydroSchluessel = "";
		stackDirty = true;
		heightStack = null;
	}

	// Der höchste Gipfel über alle gezeichneten Felder -- der Bezug der Bearbeitungsansicht.
	// Die Untergrenze in der Aufrufstelle verhindert eine Division durch fast null, wenn eine Fläche
	// nur Gipfel ohne erfasste Höhe trägt.
	function stackFieldsHmax(stack) {
		return (stack?.fields || []).map((field) => Number(field.hmax) || 0);
	}

	// 🔴 NUR IN DER GRAUSTUFEN-ANSICHT ZEICHNEN (Owner 2026-07-29: „das transparente Höhenfeld bei
	// inaktiv markierten Gebirgen raustun … die schwarzweiß-Ansicht muss natürlich bleiben").
	//
	// Bis hierher lag das Relief IMMER auf der Karte, halbdurchsichtig, sobald die Topographie-Ebene
	// aktiv war -- und wurde erst deckend, wenn ein Flächendialog aufging (`setSolid`). Der Schleier war
	// damit ein Dauerzustand, der die Grundkarte einfärbte, ohne selbst gut lesbar zu sein. Jetzt gilt:
	// kein Dialog offen = kein Höhenfeld, Dialog offen = volle Graustufe wie bisher.
	//
	// 🪤 `redraw()` leert die Leinwand VOR dieser Prüfung, deshalb räumt `setSolid(false)` beim Schliessen
	// von selbst auf -- es ruft redraw(), und das kehrt hier zurück, nachdem geleert wurde.
	//
	// ⚠️ Damit ist der Schleier-Pfad (CSS-Opazität `--opacity-ecosystem-height` plus das Alpha je Pixel)
	// vorerst unerreichbar, aber absichtlich stehen geblieben: er ist die einzige Stelle, an der die
	// Deckkraft überhaupt beschrieben ist, und der Owner kann ihn zurückwollen. Wer ihn ausbaut, baut
	// zwei Dinge aus, nicht eins (siehe setHeightCanvasSolid).
	function shouldDraw() {
		return solidMode
			&& !!aktiveFlaeche
			&& typeof isEcosystemLayerModeActive === "function" && isEcosystemLayerModeActive()
			&& typeof getActiveEcosystemLayerKind === "function"
			&& getActiveEcosystemLayerKind() === "topographie";
	}

	/* ── Die Eingaben des Trichters ────────────────────────────────────────────────────────────
	   🔴 Sie kommen alle aus dem, was die Karte OHNEHIN geladen hat -- keine eigene Anfrage, kein
	   zweiter Endpunkt. Flüsse aus `pathData`, Seen aus den Landschaftsflächen, die Kammlinie aus
	   dem Label der Fläche. ⚠️ Dieselben Felder liest der Rasterlauf im Editor über seine eigenen
	   Endpunkte; die FORM muss übereinstimmen, sonst zeigt die Karte ein anderes Gelände als das
	   gespeicherte (siehe den Kopf von map-features-ecosystem-hydrologie.js). */

	// Jedes Gebirge trägt seine eigenen Gipfel. Überlappungen werden beim Lesen per Maximum
	// verbunden; eine exklusive Gipfelzuteilung würde das andere Gebirge künstlich absenken.
	function gipfelDieserFlaeche(area) {
		const geometry = geometrieVon(area);
		return geometry ? peakList()
			.filter((peak) => pointInGeometry([peak.x, peak.y], geometry))
			.map((peak) => ({ x: peak.x, y: peak.y, h: peak.height })) : [];
	}

	function flaecheMitId(publicId) {
		const treffer = topographyAreas().filter((a) => String(a.public_id || "") === String(publicId));

		return treffer.length ? treffer[0] : null;
	}

	function geometrieVon(area) {
		return area?.geometry_geojson || area?.geometry || null;
	}

	// Die Flüsse, die diese Fläche berühren. `Flussweg` aus der geladenen Kartennutzlast.
	function fluesseFuer(area) {
		if (typeof pathData === "undefined" || !Array.isArray(pathData)) {
			return [];
		}
		const geometry = geometrieVon(area);
		if (!geometry) {
			return [];
		}
		const raus = [];
		for (const feature of pathData) {
			const props = feature?.properties || {};
			if (String(props.feature_subtype || "") !== "Flussweg") {
				continue;
			}
			const g = feature.geometry;
			if (!g) { continue; }
			const linien = g.type === "LineString" ? [g.coordinates]
				: (g.type === "MultiLineString" ? g.coordinates : []);
			for (const linie of linien) {
				if (!Array.isArray(linie) || linie.length < 2) { continue; }
				let beruehrt = false;
				for (const c of linie) {
					if (pointInGeometry([c[0], c[1]], geometry)) { beruehrt = true; break; }
				}
				if (!beruehrt) { continue; }
				raus.push({
					n: String(props.name || props.public_id || ""),
					bach: props.is_bach === true,
					dir: props.flow?.dir || null,
					p: linie,
				});
			}
		}

		return raus;
	}

	// Die Seen, die diese Fläche schneiden -- `topographie/see` aus den geladenen Landschaftsflächen.
	function seenFuer(area) {
		if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
			return [];
		}
		const geometry = geometrieVon(area);
		if (!geometry) {
			return [];
		}
		const raus = [];
		ecosystemLayers.forEach((layer) => {
			const kandidat = layer?._ecosystemArea;
			if (!kandidat || kandidat.kind !== "topographie") { return; }
			if (String(kandidat.region_type || "") !== "see") { return; }
			const g = geometrieVon(kandidat);
			if (!g || !g.coordinates) { return; }
			// bbox-Vorfilter, dann ein Eckpunkt-Test -- derselbe Weg wie beim Rasterlauf.
			const b = kandidat.bounds;
			const a = area.bounds;
			if (b && a && (b.max_x < a.min_x || a.max_x < b.min_x || b.max_y < a.min_y || a.max_y < b.min_y)) {
				return;
			}
			raus.push({ n: String(kandidat.region_name || ""), g });
		});

		return raus;
	}

	// Die Kammlinie -- die EIGENE der Flaeche zuerst, die Beschriftungskurve als Rueckfall.
	//
	// 🔴 `terrain_ridge_line` ist eine GELAENDE-Eigenschaft und haengt an nichts anderem. Bis zum
	// 04.09.2026 gab es nur `curve_label_line`, und die entsteht NUR bei eingeschalteter
	// Kurvenbeschriftung (`avesmapsCurveRefreshCacheForRegion` ueberspringt jede Region mit
	// `enabled = false`) -- ein Editor haette also die Namensanzeige umstellen muessen, um sein
	// Gelaende zu formen. Owner: „ich will dass der button genau das mit tut - ohne die
	// kurvenbeschriftung anzuwenden".
	// ⚠️ Die Beschriftungskurve BLEIBT als Rueckfall: viele Flaechen tragen sie bereits, und sie ist
	// dieselbe Mittelachse aus demselben Rechner (`avesmapsCurveBaseline`). Wer sie wegnimmt, macht
	// fuer diese Flaechen aus einem gerechneten Kamm wieder einen Mittelachsen-Notbehelf.
	// ⚠️ Über `label_public_id` gesucht, NICHT über den Namen -- eine Fläche kann gleichnamige
	// Labels verschiedener Art haben (der Finsterkamm hat eines als `wald` und eines als `gebirge`).
	function kurveFuer(area) {
		const eigene = area?.terrain_ridge_line;
		if (Array.isArray(eigene) && eigene.length > 1) {
			return eigene;
		}
		const labelId = String(area?.label_public_id || "");
		if (!labelId || typeof labelData === "undefined" || !Array.isArray(labelData)) {
			return null;
		}
		for (const label of labelData) {
			if (String(label?.publicId || "") !== labelId) { continue; }
			const linie = label.curveLine || label.curve_label_line;

			return Array.isArray(linie) && linie.length > 1 ? linie : null;
		}

		return null;
	}

	// Die Regler der Fläche, in der Sprache des Trichters.
	// 🔴 `null` heisst „ableiten" -- dieselbe Regel wie in V8. Nichts wird mit `|| Vorgabe` gefüllt.
	function reglerFuer(area) {
		return {
			koernung: area?.terrain_grain ?? undefined,
			// 🔴 ZWEI SPALTEN, NICHT MEHR EINE. Hier stand zweimal `terrain_levels`: die Oktaven des
			// fraktalen Grundrauschens (`stufen`, 1..8) und die Erosionsstufe (`erosion`, 0..5) lasen
			// denselben Wert. Wer die Erosion auf 5 stellte, verstellte damit lautlos die Detailtiefe
			// des Rauschens mit -- zwei Groessen, die zufaellig denselben Wertebereich haben, sind
			// deshalb noch lange nicht dieselbe Groesse. Owner 04.09.2026: „terrain_levels trenn die
			// beiden!"
			stufen: area?.terrain_levels ?? undefined,
			erosion: area?.terrain_erosion ?? undefined,
			plateau: area?.terrain_plateau ?? undefined,
			hypsometrie: area?.terrain_hypsometrie ?? undefined,
			maximalhoehe: area?.terrain_avg_height ?? undefined,
			bergform: area?.terrain_bergform ?? undefined,
			rauschen: area?.terrain_rauschen ?? undefined,
			sattel: area?.terrain_sattel ?? undefined,
			talbreite: area?.terrain_talbreite ?? undefined,
			einschnitt: area?.terrain_einschnitt ?? undefined,
		};
	}

	// Nur Polygone mit positiver Schnittfläche sind Nachbarn. Randkontakt und überlappende
	// Rasterrechtecke reichen nicht; Löcher und MultiPolygone bleiben beim Schnitt erhalten.
	//
	// 🔴 EINE Rechnung, zwei Leser: `nachbarnVon` (wer wird mitgezeichnet) und `betrifftAnzeige`
	// (muss das Bild neu gerechnet werden). Wer die zweite Frage eigenständig beantwortet, hat zwei
	// Begriffe von „gehört dazu" -- und sie laufen beim ersten Sonderfall auseinander.
	function ueberlappen(geometry, eigen, kandidat) {
		const b = kandidat?.bounds;
		const g = geometrieVon(kandidat);
		if (!b || !g || b.min_x >= eigen.max_x || b.max_x <= eigen.min_x
			|| b.min_y >= eigen.max_y || b.max_y <= eigen.min_y) { return false; }
		// Rechtecke sind nur ein Vorfilter. Erst eine echte Schnittfläche verbindet Gebirge.
		let cache = nachbarSchnittCache.get(geometry);
		if (!cache) { cache = new WeakMap(); nachbarSchnittCache.set(geometry, cache); }
		if (!cache.has(g)) {
			cache.set(g, window.polygonClipping.intersection(geometry.coordinates, g.coordinates).length > 0);
		}

		return cache.get(g) === true;
	}

	function nachbarnVon(area) {
		const eigen = area?.bounds;
		const geometry = geometrieVon(area);
		if (!eigen || !geometry || !window.polygonClipping) { return []; }
		const meine = String(area.public_id || "");
		const nachbarn = [];
		for (const kandidat of topographyAreas()) {
			if (String(kandidat?.public_id || "") === meine) { continue; }
			if (ueberlappen(geometry, eigen, kandidat)) {
				nachbarn.push({ area: kandidat, geometry: geometrieVon(kandidat) });
			}
		}

		return nachbarn;
	}

	// Berührt diese Fläche das Bild, das GERADE gezeigt wird?
	//
	// 🔴 Der Loader fragt danach, bevor er ein Nachladen als „Höhenfeld veraltet" meldet (Owner
	// 05.09.2026). Vorher genügte ihm, dass überhaupt irgendein Gebirge in den Ausschnitt kam oder
	// ihn verliess -- unter V8 richtig, weil ein globaler Stapel ALLE Gebirge trug, seit V12 aber
	// bedeutungslos: das Bild trägt die angeklickte Fläche und ihre echten Überlappungen, sonst
	// nichts. Ein Gebirge zweihundert Einheiten weiter kostete so einen Erosionslauf für nichts.
	//
	// 💣 GEFRAGT WIRD MIT DEM FLÄCHENOBJEKT, nicht mit einer public_id. Die neu dazugekommene Fläche
	// steht zum Zeitpunkt der Frage noch nicht in `ecosystemLayers`, und die entfernte steht schon
	// nicht mehr darin -- eine Frage über die Registry wäre genau in den zwei Fällen blind, um
	// derentwillen es sie gibt.
	// ⚠️ Ohne angezeigtes Gebirge ist die Antwort NEIN: dann wird gar nichts gemalt, und es gibt
	// nichts, das veralten könnte.
	function betrifftAnzeige(kandidat) {
		if (!aktiveFlaeche || !kandidat) { return false; }
		if (String(kandidat.public_id || "") === String(aktiveFlaeche)) { return true; }
		const area = flaecheMitId(aktiveFlaeche);
		const eigen = area?.bounds;
		const geometry = geometrieVon(area);
		if (!eigen || !geometry || !window.polygonClipping) { return false; }

		return ueberlappen(geometry, eigen, kandidat);
	}

	function gebirgsEingabeFuer(area, deckel) {
		return {
			bounds: area.bounds,
			geometry: geometrieVon(area),
			peaks: gipfelDieserFlaeche(area),
			kurve: kurveFuer(area),
			fluesse: fluesseFuer(area),
			seen: seenFuer(area),
			deckel,
			regler: reglerFuer(area),
			saat: hydroSaatFuer(area),
		};
	}

	function hydroFlaechenSchluessel(area) {
		return JSON.stringify([
			area.public_id, area.geometry_revision, reglerFuer(area),
			gipfelDieserFlaeche(area), kurveFuer(area), hydroSaatFuer(area),
		]);
	}

	function hydroSchluesselFuer(area) {
		return JSON.stringify([
			hydroFlaechenSchluessel(area),
			nachbarnVon(area).map((n) => hydroFlaechenSchluessel(n.area)).sort(),
			hydroGrob,
		]);
	}

	// 🔴 Kein Math.random(): dieselbe Saat wie in V8, aus Identitaet und Geometrie-Revision.
	// 💣 Als EINE Funktion, nicht zweimal inline: Anzeige und Speicherlauf muessen dieselbe Saat
	// nehmen, sonst zeigt die Leinwand ein anderes Rauschen als die Wegfindung rechnet -- und der
	// Unterschied ist genau die Sorte, die niemand sieht (beides sieht wie ein Gebirge aus).
	function hydroSaatFuer(area) {
		return typeof ecosystemHeightSeed === "function" ? ecosystemHeightSeed(area) : 12345;
	}

	// Das Raster dieser Fläche -- gerechnet, wenn es fehlt oder ein Regler sich bewegt hat.
	function ensureHydroRaster() {
		const area = flaecheMitId(aktiveFlaeche);
		if (!area || typeof avesmapsGebirgsRasterBauen !== "function") {
			return null;
		}
		const schluessel = hydroSchluesselFuer(area);
		if (hydroRaster && hydroSchluessel === schluessel) {
			return hydroRaster;
		}
		if (hydroLaeuft?.schluessel === schluessel) {
			return hydroRaster;
		}
		const geometry = geometrieVon(area);
		if (!geometry || !area.bounds) {
			return null;
		}
		hydroLaeuft?.abort();
		const controller = new AbortController();
		controller.schluessel = schluessel;
		hydroLaeuft = controller;
		const deckel = hydroGrob ? ECOSYSTEM_HYDRO_RASTER_GROB : ECOSYSTEM_HYDRO_RASTER_N;
		void avesmapsGebirgsRasterImWorker({
			...gebirgsEingabeFuer(area, deckel),
			nachbarFelder: nachbarnVon(area).map((n) => gebirgsEingabeFuer(n.area, deckel)),
		}, controller.signal).then((raster) => {
			if (hydroLaeuft !== controller) { return; }
			hydroLaeuft = null;
			hydroRaster = raster;
			hydroSchluessel = schluessel;
			redraw();
		}).catch((error) => {
			if (hydroLaeuft !== controller) { return; }
			hydroLaeuft = null;
			hydroRaster = null;
			hydroSchluessel = "";
			console.warn("Höhenfeld konnte nicht gerechnet werden:", error);
		});

		return hydroRaster;
	}

	// Die Flächen, die das Bild zeigt: die angeklickte und jede, die sie wirklich überlappt.
	// Die Auswahl trifft `nachbarnVon()` -- hier wird sie nur ausgepackt.
	function verbundGeometrien(raster) {
		return [raster.geometry]
			.concat((raster.nachbarRaster || []).map((nachbar) => nachbar.geometry))
			.filter(Boolean);
	}

	// Vorzeichenbehaftete Fläche (Gauß-Trapezformel). Gebraucht wird NUR ihr Vorzeichen: die
	// Umlaufrichtung eines Rings, damit die Maske Löcher von Flächen unterscheiden kann.
	function ringFlaeche(punkte) {
		let summe = 0;
		for (let i = 0, j = punkte.length - 1; i < punkte.length; j = i++) {
			summe += (punkte[j][0] * punkte[i][1]) - (punkte[i][0] * punkte[j][1]);
		}

		return summe;
	}

	function redraw() {
		if (!map.getPane(PANE)) {
			return;
		}
		const size = map.getSize();
		// 💣 Eine Karte ohne Ausdehnung. Kommt vor, bevor das Layout steht, in einem verborgenen Reiter
		// und in jedem Prüfaufbau ohne sichtbaren Rahmen. `createImageData(0, 0)` WIRFT, und der Wurf
		// reisst den ganzen Ebenenwechsel mit -- redraw() hängt an syncEcosystemPaneStates. Erst
		// gemessen, dann gefangen: der Fehler trat beim ersten Prüflauf genau so auf.
		if (!(size.x > 0) || !(size.y > 0)) {
			meldeAnstrich(0);
			return;
		}
		const topLeft = map.containerPointToLayerPoint([0, 0]);
		L.DomUtil.setPosition(canvas, topLeft);

		// HiDPI: Backing-Store in Geräte-Pixeln, CSS-Größe in Layout-Pixeln.
		const dpr = window.devicePixelRatio || 1;
		const pixelWidth = Math.round(size.x * dpr);
		const pixelHeight = Math.round(size.y * dpr);
		if (canvas.width !== pixelWidth) { canvas.width = pixelWidth; }
		if (canvas.height !== pixelHeight) { canvas.height = pixelHeight; }
		if (canvas.style.width !== size.x + "px") { canvas.style.width = size.x + "px"; }
		if (canvas.style.height !== size.y + "px") { canvas.style.height = size.y + "px"; }
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (!shouldDraw()) {
			meldeAnstrich(0);                // kein Dialog offen = kein Höhenfeld = nichts zu erklären
			return;                          // Canvas ist oben schon geleert -> Ebenenwechsel löscht es
		}

		// 🔴 EIN GERECHNETES RASTER, KEINE FUNKTION MEHR (V12, Owner 04.09.2026). Bis dahin fragte
		// diese Schleife je Bildpunkt die Buckelsumme ab; jetzt liest sie aus dem Raster, mit dem
		// auch die Wegfindung rechnet. Das ist der ganze Punkt: „das was ich seh soll das sein mit
		// dem gerechnet wird."
		const raster = ensureHydroRaster();
		if (!raster || raster.leer || !raster.r) {
			meldeAnstrich(0);
			return;
		}
		// 🔴 DIE HÖHENSKALA GEHÖRT DER ANGEKLICKTEN FLÄCHE. `maximalhoehe` ist das Maximum über
		// IHRE Zellen; ein gezeigter Nachbar, der höher ist, läuft oben weiß aus. Seine FORM bleibt
		// lesbar (das Streiflicht moduliert weiter), und die Zahlen unter der Skala meinen weiterhin
		// die Fläche, deren Regler danebenstehen. Die Skala des Verbunds wäre eine Zahl, die zu
		// keinem Bedienelement des Dialogs gehört.
		const hoechster = raster.maximalhoehe;
		const reference = Math.max(HEIGHT_WHITE_SCHRITT * 0.02, hoechster);
		meldeAnstrich(reference);
		const started = performance.now();
		const image = context.createImageData(pixelWidth, pixelHeight);
		const data = image.data;

		// 💣 ZWEI Aufrufe, nicht einer je Punkt: `containerPointToLatLng` kostete je Punkt gemessen
		// 10,9 ms auf 60.000 Abfragen. Die Karte ist linear, also genügen Ursprung und Schrittweite.
		const originLatLng = map.containerPointToLatLng([0, 0]);
		const stepLatLng = map.containerPointToLatLng([STEP, STEP]);
		const deltaX = (stepLatLng.lng - originLatLng.lng) / STEP;
		const deltaY = (stepLatLng.lat - originLatLng.lat) / STEP;

		// Die Beleuchtung liest das Gefälle desselben unabhängigen Felds, das am tatsächlichen
		// Bildpunkt die größte Höhe liefert. Polygone maskieren auch Löcher.
		// ⭐ Und weil im Überlapp das Maximum gilt und jedes Feld an SEINER Kante auf null läuft,
		// geht `max(A,B)` an A's Rand stetig in B über: der Übergang trägt keine Helligkeitsstufe.
		// Deshalb wird der Nachbar auch nicht abgeschwächt oder eingefärbt -- das machte aus dem
		// Übergang wieder eine Kante. Welche Fläche die angeklickte ist, sagt ihre weiße Kontur.
		const liesRaster = (x, y) => avesmapsGebirgsVerbundProbe(raster, x, y);

		for (let sy = 0; sy < size.y; sy += STEP) {
			const y = originLatLng.lat + sy * deltaY;
			for (let sx = 0; sx < size.x; sx += STEP) {
				const x = originLatLng.lng + sx * deltaX;
				const probe = liesRaster(x, y);
				if (!probe || (!graustufen && !(probe.h > 0))) {
					continue;                // unbemalt = alpha 0, siehe oben
				}
				// 🔴 STREIFLICHT STATT GRAUSTUFEN (Owner 04.09.2026: „die streiflicht ansicht soll die
				// höhenfeldansicht ersetzen"). Eine Rinne ist in reinem Grau nur ein dunklerer Fleck,
				// im Streiflicht eine Rinne -- und genau die Rinnen sind das Ergebnis der Erosion.
				const nl = Math.hypot(probe.gx, probe.gy, 1);
				let licht = ((probe.gx * ECOSYSTEM_HYDRO_LICHT_X)
					+ (probe.gy * ECOSYSTEM_HYDRO_LICHT_Y) + ECOSYSTEM_HYDRO_LICHT_Z) / nl;
				licht = Math.max(0, Math.min(1, licht * 1.15));
				const t = Math.max(0, Math.min(1, probe.h / reference));
				// Höhe UND Licht: die Höhe trägt die Lesbarkeit der Skala (die Höhenskala im Dialog
				// nennt dieselben Zahlen), das Licht die Form.
				const wert = graustufen ? 255 * t : 255 * (0.25 + 0.75 * licht) * (0.35 + 0.65 * t);
				const r = wert;
				const g = wert;
				const b = graustufen ? wert : Math.min(255, wert * 1.04);
				const alpha = solidMode ? 255 : Math.round(255 * Math.min(1, Math.sqrt(t) / Math.sqrt(HEIGHT_FULL_VEIL_SCHRITT / HEIGHT_WHITE_SCHRITT)));
				const px0 = Math.round(sx * dpr);
				const py0 = Math.round(sy * dpr);
				const px1 = Math.min(pixelWidth, Math.round((sx + STEP) * dpr));
				const py1 = Math.min(pixelHeight, Math.round((sy + STEP) * dpr));
				for (let py = py0; py < py1; py++) {
					let offset = (py * pixelWidth + px0) * 4;
					for (let px = px0; px < px1; px++) {
						data[offset] = r; data[offset + 1] = g; data[offset + 2] = b; data[offset + 3] = alpha;
						offset += 4;
					}
				}
			}
		}
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.putImageData(image, 0, 0);
		// Die vier Pixel breiten Malblöcke enden exakt an den Konturen des Verbunds.
		// destination-in maskiert auch schmale Löcher, die zwischen Abtastpunkten liegen.
		//
		// 💣 EINE MASKE AUS MEHREREN FLÄCHEN VERTRÄGT KEIN `evenodd`: wo zwei Gebirge einander
		// überlappen, ist die Windungszahl 2 -- und damit fiele ausgerechnet der Überlapp als „Loch"
		// heraus, also genau das Stück, um dessentwillen der Nachbar überhaupt gezeigt wird. Mit
		// `nonzero` vereinigen sich die Flächen; dafür trägt dann die UMLAUFRICHTUNG der Ringe die
		// Bedeutung -- ein Loch muss andersherum laufen als sein Außenring, sonst ist es keins mehr.
		// 🔴 Die Richtung wird deshalb GERECHNET, nie geglaubt: `ring[0]` ist per Hausvertrag der
		// Außenring (`pointInPolygon` liest ihn so), aber seine Umlaufrichtung steht in keinem
		// Datum -- und die Karte spiegelt y, was jeden Ring zusätzlich dreht. Gerechnet wird darum
		// in BILDpunkten, nach der Projektion.
		// ⭐ Das Loch einer Fläche, über dem die andere liegt, bleibt damit richtig GEFÜLLT: dort
		// steht Windung +1 (Nachbar) +1 (Außenring) -1 (Loch). Der Anstrich sagt dasselbe -- die
		// Fläche mit dem Loch liefert dort nichts, der Nachbar seinen Wert.
		// ⚠️ Bei einem in sich selbst geschlagenen Ring gehen `nonzero` und der Punkttest (Even-Odd)
		// auseinander. Die Maske ist dann großzügiger als der Anstrich -- und weil sie nur wegnehmen
		// kann, bleibt schlimmstenfalls ein Malblock ungetrimmt stehen.
		context.save();
		context.globalCompositeOperation = "destination-in";
		context.fillStyle = "white";
		context.beginPath();
		for (const geometry of verbundGeometrien(raster)) {
			const polygons = geometry.type === "MultiPolygon"
				? geometry.coordinates : [geometry.coordinates];
			for (const polygon of polygons) {
				for (let ring = 0; ring < polygon.length; ring++) {
					const punkte = polygon[ring].map(([x, y]) => [
						(x - originLatLng.lng) / deltaX * dpr,
						(y - originLatLng.lat) / deltaY * dpr,
					]);
					if ((ringFlaeche(punkte) > 0) !== (ring === 0)) { punkte.reverse(); }
					punkte.forEach(([px, py], index) => {
						if (index === 0) { context.moveTo(px, py); } else { context.lineTo(px, py); }
					});
					context.closePath();
				}
			}
		}
		context.fill("nonzero");
		context.restore();
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		lastPaintMs = performance.now() - started;

		// 💣 HIER STAND DER BUDGET-MELDER DER BUCKELSUMME, und er hat den ganzen Umbau blockiert.
		// Er las `fields` und `stack` -- beides mit der alten Malschleife entfallen -- und warf unter
		// `"use strict"` bei JEDEM gelungenen Anstrich einen ReferenceError, NACH `putImageData`.
		// `node --check` bleibt dabei gruen: die Syntax stimmt, nur die Bezeichner gibt es nicht mehr.
		// Die Folge war nicht ein fehlendes Bild, sondern ein Dialog, der GAR NICHT AUFGING:
		// `setSolid(…)` steht in `map-features-ecosystem-properties.js` ohne `try` mitten in der
		// Dialogaufbereitung, und alles danach -- bis zu `avesmapsLandschaftDialogSichtbar(true)` --
		// lief nicht mehr. Gefunden von einem Pruefagenten, der die Funktion wirklich AUSGEFUEHRT hat.
		// 🔴 Der Melder ist ersatzlos weg, nicht portiert: `stoppedAtLevel` ist ein Begriff der
		// Buckelsumme (ausgelassene Verfeinerungsstufe). Der Trichter kennt kein Stufenbudget --
		// seine Kosten haengen an Zellzahl und Erosionsschritten, und beide stehen fest.
	}

	// ---- Die Invalidierungskante ----------------------------------------------------------------------
	//
	// Jede Gipfeländerung -- verschieben, anlegen, löschen, Höhe eintragen -- macht das Höhenfeld
	// ungültig (oekosystem-editor-leitfaden.md Z. 204-207). Gerufen aus drei Ecken: dem Zug auf der
	// Karte (map-features-labels.js), dem Höhenfeld im Landschaften-Panel und künftig dem Löschen.
	//
	// 🔴 ES WIRD ALLES NEU GEBAUT, NICHT NUR DIE ENTHALTENDE FLÄCHE -- und das ist eine Abweichung vom
	// Plan, die auf zwei Messungen beruht:
	//
	//  1. **Teilweise wäre falsch.** Das Gipfelfenster ist GLOBAL (das ist der Kern von V8), und aus ihm
	//     kommt die Radiusklemme jedes Gipfels: der Abstand zu seinem nächsten Nachbarn. Verschiebt sich
	//     ein Gipfel, kann er der neue nächste Nachbar eines Gipfels in einer ganz anderen Fläche
	//     werden. Nur die enthaltende Fläche neu zu rechnen liesse deren Radius stehen -- ein stiller
	//     Fehler, sichtbar erst als falsche Bergform irgendwo weit weg.
	//  2. **Teilweise wäre die Optimierung der billigen Hälfte.** Gemessen am Livebestand (2 Flächen,
	//     62 Gipfel): Stapel komplett neu = **3,7 ms**, davon das Fenster 0,4 ms. Das anschliessende
	//     Neuzeichnen kostet **36 ms** -- der Neubau ist ein Zehntel dessen, was ohnehin folgt.
	//
	// ⚠️ Das kippt, wenn die Zahl der Gebirgsflächen wächst. Bei den ~60, die der Bestand braucht, läge
	// der Neubau grob bei 110 ms und wäre den Aufwand wert. Dann ist der richtige Schnitt: Fenster immer
	// neu (billig), Felder nur dort, wo der Gipfel lag ODER jetzt liegt, PLUS bei jedem Gipfel, dessen
	// nächster Nachbar sich geändert hat. Vorher nicht -- es wäre Komplexität ohne Gegenwert.
	function invalidateEcosystemHeightForPeak(label) {
		// Welche Flächen es betrifft, wird ERMITTELT, bevor der Stapel weggeworfen wird -- danach ist die
		// Frage nicht mehr beantwortbar. Der Wert ist die Diagnose, nicht die Steuerung.
		let affected = [];
		const x = Number(label?.coordinates?.[1]);
		const y = Number(label?.coordinates?.[0]);
		if (heightStack && Number.isFinite(x) && Number.isFinite(y)
			&& typeof ecosystemHeightFieldsAtPoint === "function") {
			affected = ecosystemHeightFieldsAtPoint(heightStack, x, y);
		}
		invalidateEcosystemHeightField();
		redraw();

		return affected;
	}
	window.invalidateEcosystemHeightForPeak = invalidateEcosystemHeightForPeak;

	map.on("moveend zoomend viewreset resize", redraw);
	// Die Flächen können nach dem ersten Zeichnen eintreffen; ein paar Nachzügler-Durchgänge holen sie.
	[150, 500, 1200].forEach((delay) => window.setTimeout(redraw, delay));

	// Von aussen: den Schleier abschalten, SOLANGE der Flächendialog offen ist (Owner 2026-07-28:
	// „sie soll einfach nicht transparent sein, solange der dialog offen ist").
	//
	// 💣 KEIN ZEITGEBER. Eine frühere Fassung schaltete ihn je Reglerbewegung für 900 ms ab und liess
	// ihn danach zurückkommen -- dadurch wurde die Fläche beim Regeln immer wieder durchsichtig und
	// flackerte unter der Hand. Der Zustand gehört an das OFFENE FENSTER, nicht an die einzelne
	// Bewegung: wer den Dialog offen hat, stellt ein und will durchgehend sehen, was er einstellt.
	// ⚠️ `areaPublicId` ist der zweite Parameter und darf fehlen -- ein Aufrufer aus der Zeit vor
	// dem 04.09.2026 schaltet dann nur den Modus, und die Leinwand bleibt leer, statt den ganzen
	// Stapel zu malen. Das ist die sichere Richtung: lieber nichts zeigen als das Falsche.
	function setHeightCanvasSolid(on, areaPublicId) {
		const next = Boolean(on);
		if (!next || String(areaPublicId || "") !== aktiveFlaeche) {
			hydroLaeuft?.abort();
			hydroLaeuft = null;
		}
		const naechsteFlaeche = next ? String(areaPublicId || "") : null;
		if (next === solidMode && naechsteFlaeche === aktiveFlaeche) {
			return;
		}
		if (naechsteFlaeche !== aktiveFlaeche) {
			aktiveFlaeche = naechsteFlaeche;
			hydroRaster = null;              // andere Fläche = anderes Raster
			hydroSchluessel = "";
		}
		solidMode = next;
		canvas.classList.toggle("avesmaps-ecosystem-height-canvas--solid", solidMode);
		// 💣 NEU ZEICHNEN, nicht nur umklassen. Die Deckkraft steckt an ZWEI Stellen: in der CSS-Opazität
		// des Canvas UND im Alpha JE PIXEL, das der Höhe folgt (0 Schritt = durchsichtig). Nur die Klasse
		// zu tauschen liess das Feld an niedrigen Stellen weiter durchscheinen -- genau die Meldung
		// „werden immer noch nicht voll deckend". Das Pixel-Alpha entsteht in der Malschleife, also muss
		// sie noch einmal laufen.
		redraw();
	}

	// Waehrend am Regler gezogen wird: grob rechnen. Beim Loslassen kommt das feine Bild nach.
	// ⚠️ Der Nachlauf haengt an einem Zeitgeber, nicht am `change`-Ereignis: ein Regler feuert
	// `change` erst beim Loslassen, aber `input` bei jedem Ruck -- und die Vorschau soll schon
	// waehrend des Ziehens folgen.
	function setHeightPreviewCoarse(on) {
		const naechst = Boolean(on);
		if (naechst === hydroGrob) {
			return;
		}
		hydroGrob = naechst;
		hydroRaster = null;
		hydroSchluessel = "";
		if (hydroFeinTimer) {
			window.clearTimeout(hydroFeinTimer);
			hydroFeinTimer = 0;
		}
		if (naechst) {
			redraw();
			return;
		}
		// Beim Loslassen einen Atemzug warten -- sonst rechnet der letzte Ruck noch einmal fein.
		hydroFeinTimer = window.setTimeout(() => { hydroFeinTimer = 0; redraw(); }, 120);
	}

	/* ══════════════════════════════════════════════════════════════════════════════════════════
	   DAS RASTER SPEICHERN -- was der Editor sieht, wird zu dem, womit die Wegfindung rechnet
	   ══════════════════════════════════════════════════════════════════════════════════════════ */

	// 🔴 GERECHNET WIRD FUER DEN SPEICHERLAUF NEU, in voller Aufloesung -- nie das Bild von der
	// Leinwand genommen. Die Anzeige darf einen Deckel tragen (`ECOSYSTEM_HYDRO_RASTER_GROB` beim
	// Ziehen am Regler, `_N` sonst); der Speicher bekommt die Zellweite 0,25 ohne Deckel.
	// ⚠️ Das ist die eine Stelle, an der Anzeige und Speicherung auseinandergehen duerfen, und sie
	// gehen NUR in der Aufloesung auseinander: derselbe Trichter, dieselben Regler, dieselbe Saat.
	// Der Owner-Auftrag „das was ich seh soll das sein mit dem gerechnet wird" ist damit erfuellt --
	// dasselbe Gelaende, feiner abgetastet.
	//
	// 💣 UND ES WIRD NACH DEM SPEICHERN DER REGLER GERUFEN, nie davor. Der Server stempelt das
	// Raster mit einem Fingerabdruck aus den Reglern, die IN DER DATENBANK stehen
	// (`avesmapsTerrainAreaFingerprint`) -- kaeme das Raster zuerst, traege es den Abdruck der alten
	// Werte und gaelte im selben Moment als veraltet.
	let rasterBerechnung = null;

	function abbrechenGebirgsRaster() {
		rasterBerechnung?.abort();
		rasterBerechnung = null;
	}

	async function gebirgsRasterHochladen(area) {
		const geometry = geometrieVon(area);
		if (!area || !geometry || !area.bounds || typeof avesmapsGebirgsRasterBauen !== "function") {
			return { hochgeladen: false, grund: "keine Flaeche" };
		}
		if (typeof postEcosystemEdit !== "function") {
			return { hochgeladen: false, grund: "kein Schreibweg" };
		}

		abbrechenGebirgsRaster();
		const controller = new AbortController();
		rasterBerechnung = controller;
		let o;
		try {
			// Nur das eigene Feld speichern. Die Wegberechnung verbindet die gespeicherten
			// Felder im tatsächlichen Polygonüberlapp per Maximum, nie per Rasterrechteck.
			o = await avesmapsGebirgsRasterImWorker(gebirgsEingabeFuer(area), controller.signal);
		} finally {
			if (rasterBerechnung === controller) { rasterBerechnung = null; }
		}
		if (!o || !o.r || !o.r.drinN) {
			return { hochgeladen: false, grund: "leeres Raster" };
		}

		// 💣 uint16 SCHRITT, geklemmt -- dieselbe Kodierung, die `avesmapsHeightmapDecode` liest.
		// Ein negativer Wert (die Diffusion kann knapp unter null laufen) wuerde als 65.535 gelesen,
		// also als der hoechste Berg Aventuriens statt als Talsohle.
		const samples = new Uint16Array(o.r.w * o.r.hh);
		for (let k = 0; k < samples.length; k++) {
			// 🔴 `eigen`, NICHT `drin`: das Rechengebiet reicht in die Nachbarn hinein, das
			// Speichergebiet ist die eigene Flaeche. Wer hier `drin` nimmt, legt das Gelaende des
			// Nachbarn ein zweites Mal ab -- und beim Lesen entschiede dann die Reihenfolge.
			if (!o.r.eigen[k]) { continue; }       // ausserhalb bleibt 0 -- die Fusshoehen-Invariante
			const wert = Math.round(o.h[k]);
			samples[k] = wert > ECOSYSTEM_HEIGHTMAP_MAX_SCHRITT
				? ECOSYSTEM_HEIGHTMAP_MAX_SCHRITT
				: (wert > 0 ? wert : 0);
		}

		// 🔴 URSPRUNG UND WEITE KOMMEN AUS DEM GERECHNETEN RASTER, nie aus `ecosystemHeightmapGrid`.
		// Die beiden spannen NICHT dasselbe Gitter auf: jenes schnappt den Ursprung auf ein Vielfaches
		// der Zellweite (`Math.floor(min_x / cell) * cell`), `baueRaster` nimmt `bounds.min_x` roh.
		// Wer hier das andere Gitter meldet, verschiebt das ganze Gebirge um bis zu eine Zelle gegen
		// die Karte -- und zwar lautlos, weil beide Gitter dieselbe Zellzahl haben.
		return postEcosystemEdit("heightmap_put", {
			area: String(area.public_id || ""),
			width: o.r.w,
			height: o.r.hh,
			cell_size: o.r.cell,
			origin_x: o.r.bounds.min_x,
			origin_y: o.r.bounds.min_y,
			samples: typeof ecosystemHeightmapToBase64 === "function"
				? ecosystemHeightmapToBase64(samples)
				: null,
		}).then((antwort) => ({
			hochgeladen: Number(antwort?.written || 0) > 0,
			zellen: samples.length,
			bytes: samples.length * 2,
			antwort,
		}));
	}

	window.AvesmapsEcosystemHeightRender = {
		setGrayscale(on) { graustufen = Boolean(on); redraw(); },
		isGrayscale: () => graustufen,
		hochladen: gebirgsRasterHochladen,
		abbrechen: abbrechenGebirgsRaster,
		redraw,
		setPreviewCoarse: setHeightPreviewCoarse,
		invalidate: invalidateEcosystemHeightField,
		setSolid: setHeightCanvasSolid,
		lastPaintMs: () => lastPaintMs,
		stack: () => heightStack,
		// Gehört diese Fläche zu dem, was gerade gemalt ist? Der Loader fragt vor dem Nachladen.
		betrifftAnzeige,
		// 🔴 BERÜHRT EIN GEWÄSSER DIESE FLÄCHE? Das Fenster fragt es, um „Talbreite" und „Taltiefe"
		// auszugrauen, wenn sie nichts bewirken können -- und es fragt DIESE Rechnung, weil sie
		// dieselbe ist, mit der das Feld gebaut wird. Eine zweite Fassung im Dialog liefe beim
		// nächsten Umbau auseinander, und der Fehler wäre in beide Richtungen still.
		// ⚠️ TEUER: `fluesseFuer` prüft jeden Flussweg punktweise gegen die Geometrie. Der Aufrufer
		// fragt einmal je geöffneter Fläche, nicht bei jedem Reglerzug -- ob ein Fluss die Fläche
		// berührt, ändert sich beim Ziehen ohnehin nicht.
		gewaesserBeruehrt: (area) => fluesseFuer(area).length > 0 || seenFuer(area).length > 0,
		// Fall #79: der Weisspunkt des letzten Anstrichs, und wer davon erfahren will.
		whitePoint: () => lastWhitePoint,
		// 🔴 DIE DURCHSCHNITTSHOEHE DES GERECHNETEN FELDES (Owner 04.09.2026: „einfach die
		// durchschnittshöhe in der höhenskala unten anzeigen"). Sie beantwortet die Frage, die ein
		// Editor mit einer Wiki-Angabe wirklich hat -- „steht da 1500?" --, ohne dass er ein
		// Verhaeltnis in eine Hoehe umrechnen muss.
		// ⚠️ Aus dem RASTER, nicht aus einem Regler: der eingestellte Wert ist ein Ziel fuer das
		// Grundrelief, Talabzug und Erosion verschieben ihn danach noch. Gemeldet wird, was am Ende
		// dasteht.
		// ⚠️ Gemittelt wird ueber die Zellen INNERHALB der Flaeche -- ausserhalb steht 0, und die
		// zoegen den Schnitt beliebig weit herunter, je nachdem wie eckig die bbox um die Flaeche
		// sitzt.
		mittelhoehe: () => hydroRaster?.mittelhoehe || 0,
		onPaint: (listener) => {
			if (typeof listener !== "function") {
				return () => {};
			}
			paintListeners.add(listener);
			// Der Zuhörer kommt meist NACH dem ersten Anstrich (der Dialog geht später auf als die
			// Karte). Ohne diesen Nachschlag bliebe seine Skala leer, bis sich zufällig etwas bewegt.
			if (lastWhitePoint > 0) {
				listener(lastWhitePoint);
			}
			return () => paintListeners.delete(listener);
		},
	};
})();
