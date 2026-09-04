(function () {
	"use strict";

	/*
	 * Was der Garetien Importer auf die Karte zeichnet — ZWEI FARBEN, eine je Partei.
	 *
	 * 🔴 VERSCHWINDET BEIM ABBAU (Auftrag §5.5) — eigene Datei, ein <script> in index.html, kein
	 *    Aufrufer ausserhalb des Importer-Fensters. Sie kennt die internen Speichertabellen des
	 *    Importers nicht und darf sie nie kennen (Waechter
	 *    api/_internal/import/__tests__/garetien-abbau-waechter-test.php).
	 * 🔴 ER RECHNET NICHTS. Die Geometrien kommen fertig in unseren Karteneinheiten aus after_json
	 *    (`objekt.geometrie` = ihre, `abschnitt.geometrie` = unsere getroffenen). Er tauscht x/y,
	 *    waehlt aus und zeichnet — kein Abstand, kein Urteil, kein zweiter Abruf.
	 * 🔴 ER HOLT NICHTS NACH. Alles steht schon in der Antwort von action:'liste'. Fehlt eine
	 *    Geometrie, wird das GEMELDET (console.warn) — ein stiller Ausfall saehe aus wie „da liegt
	 *    eben nichts", und ein eigenes fetch() waere der zweite Netzweg, den der Auftrag verbietet.
	 *
	 * 🔴 DER GLOW HAENGT AM HAEKCHEN (Owner 27.08.2026) — und zusaetzlich am ANGEKLICKTEN Objekt
	 * (Owner 29.08.2026, `avesmapsGaretienAufDerKarte` in review-garetien-importer.js). Was gezeichnet
	 * wird, entscheidet also der Aufrufer; diese Datei bekommt eine fertige Liste.
	 *
	 * 💣 ZWEI FARBEN, NICHT EINE — UND DAS IST DER GANZE SINN DIESER FASSUNG. Bis zum 29.08.2026
	 * waren beide Parteien GOLD: ihre Geometrie als gestrichelter Strich, unsere als breiter goldener
	 * Hof darunter. Auf einer Flaeche (Kraehensee) lagen damit zwei goldene Formen uebereinander.
	 * Owner, woertlich: „ich weiss aber nicht, ob das die Garetien-Geometrie oder unsere eigene ist.
	 * voellig unklar." Seither:
	 *   - IHRE Geometrie: GESTRICHELT („so wuerde es liegen, es steht noch nicht bei uns")
	 *   - UNSERE Geometrie: MAGENTA (`--color-garetien-unsere`), DURCHGEZOGEN
	 *     („das liegt schon da") — als ECHTE FORM, nicht mehr nur als Hof
	 * 🔴 Die Strichelung ist damit die zweite, unabhaengige Aussage: sie sagt „Vorschlag", nicht
	 * „ihre". Wer sie auf unsere Form uebertraegt, nimmt der Farbe ihre Arbeit wieder ab.
	 * 🔴 Farbe kodiert hier DATEN, nicht Chrome — AGENTS.md §12 laesst das ausdruecklich zu.
	 *
	 * 🔴 UND SEIT AUFGABE 3 (RULING R8, Entwurf §4.1, task-3-nachtrag.md §1) IST IHRE FORM NICHT
	 * MEHR GOLD: sie „tut so, als laege sie schon auf der Karte" und traegt ihre ECHTE Kartenfarbe,
	 * -form (Punkt/Linie/Flaeche) und -breite aus der SICHT-TAFEL (avesmapsGaretienSichtFuer,
	 * geschluesselt auf `ebene`, mit `subtyp`/`kind` als feinerer Vorrang, wenn ein Vorschlag
	 * vorliegt). Owner woertlich: „Ideal waer wenn der import das eigentliche objekt bereits anzeigt
	 * (farblich und von der groesse aber gelb leuchtend) und 'so tut', als sei es auf der Karte."
	 * Das GELBE LEUCHTEN ist seither ein EIGENER, NEUER goldener Hof unter ihrer Form
	 * (AVESMAPS_GARETIEN_KLASSE_SCHEIN_IHRE) — dieselbe Rolle, die der magentafarbene Hof schon
	 * fuer unsere Seite spielt: die Herkunft bleibt lesbar, auch wenn die Form selbst nicht mehr
	 * golden ist. Kennt die Sicht-Tafel eine Ebene nicht, faellt die Form auf Gold + Linie zurueck
	 * (AVESMAPS_GARETIEN_SICHT_NEUTRAL) — dann liegen Hof UND Form beide golden uebereinander, und
	 * das ist das Bild von VOR dieser Aufgabe.
	 *
	 * 🔴 IHR STRICH LIEGT OBEN, UNSERER DARUNTER, und das ist gerechnet, nicht Geschmack: ihre Linie
	 * liegt oft GENAU auf unserer (Median 1,24 Meilen bei 3072 Meilen Kartenbreite = 0,413
	 * Karteneinheiten; bei L.CRS.Simple sind das 2^z Pixel, also 3,3 px bei Zoom 3 und 13,2 px bei
	 * Zoom 5). Bei den Zoomstufen, auf denen ein langes Objekt ganz ins Bild passt, decken sich die
	 * zwei 3 px breiten Striche also. Ihre Strichelung ist „9 5": von 14 Pixeln Lauflaenge deckt sie
	 * 9 zu, in den restlichen 5 scheint unsere Farbe durch. Andersherum — unsere DURCHGEZOGENE Linie
	 * oben — waere ihre gestrichelte vollstaendig verdeckt, und man saehe von ihrem Vorschlag nichts.
	 *
	 * 💣 DER HOF BLEIBT, ALS HOF UNTER UNSERER MAGENTA-FORM. Er ist das einzige Mittel, das unsere
	 * Anwesenheit AUCH DORT zeigt, wo ihr Strich sie zudeckt — und das sind bei deckungsgleicher Lage
	 * rund 64 % der Lauflaenge (9 von 14). Ohne ihn ist unsere Linie unter ihrer eine gepunktete
	 * Ahnung. Er ist jetzt MAGENTA statt Gold, sonst behauptete die Farbe wieder das Gegenteil der
	 * Form.
	 * ⚠️ Seine alte Begruendung („die Hervorhebung gehoert HINTER das, was sie hervorhebt") gilt
	 * unveraendert — nur ist das, was er hervorhebt, seit dieser Fassung unsere MAGENTA-FORM und
	 * nicht mehr unsere blaue Flusslinie auf der Karte. Deshalb ist er mit ihr in EINE Pane gewandert
	 * und liegt dort als erster Eintrag darunter.
	 */

	// ---- Die zwei Panes -------------------------------------------------------------------------
	//
	// 🔴 EINE PANE JE PARTEI, und das ist zugleich der ZUSTAND der zwei Sicht-Knoepfe: sichtbar
	// heisst `display: ""`, ausgeblendet `display: "none"`. Kein Schalter daneben, der auseinander-
	// laufen kann — dieselbe Bauform wie das `hidden` des Sammelmenues (AGENTS.md §11) und aus
	// demselben Grund: an genau so einem zweiten Zustand sind das Anzeige-Menue der Karte und die
	// Ansichts-Kacheln schon gescheitert.
	//
	// 🔴 UNSERE 462, IHRE 465. Was diese zwei Zahlen zusichern:
	//
	//   (a) BEIDE liegen UEBER `roadsPane` (400). Das ist die Aenderung vom 29.08.2026 und sie ist
	//       tragend: unsere Magenta-Linie ist 3 px breit, und laege sie wie der alte Hof bei 360,
	//       zeichnete unsere EIGENE, gleich breite Flusslinie (PATH_CENTER_WEIGHTS.Flussweg = 3)
	//       sich vollstaendig darueber — die neue Farbe waere unsichtbar, und zwar genau dort, wo
	//       man sie braucht. Ein Hof darf unter dem liegen, was er hervorhebt; eine eigene Aussage
	//       nicht.
	//   (b) 462 < 465, damit ihr gestrichelter Strich oben liegt (siehe Kopf).
	//   (c) Beide Zahlen sind sonst UNBELEGT, und 460 ist es NICHT — die gehoert `measurementPane`
	//       (js/app/bootstrap.js). Bei gleichem z-index entscheidet die Einfuegereihenfolge im DOM,
	//       und das ist keine Regel, sondern ein Zufall, der beim naechsten Umbau kippt.
	//   (d) Beide bleiben UNTER 470 (`map-features-path-label-canvas-overlay.js`) und damit unter
	//       den Wegenamen und den Ortsmarkierungen (500) — eine Import-Ueberlagerung verdeckt die
	//       Beschriftung der Karte nicht.
	//
	// 🪤 HIER STAND EINE AUFZAEHLUNG DER BELEGTEN WERTE, und sie war unvollstaendig: auf 455 liegt
	// nicht nur `ecosystemPaneKlimaLines`, sondern auch `avesmapsRouteSpeedArrowPane`
	// (js/routing/route-speed-arrows.js). An der Richtigkeit der Zahlen aendert das nichts -- aber es
	// war in diesem Vorhaben die fuenfte Liste, die beim Nachzaehlen kuerzer war als die
	// Wirklichkeit. Eine Zahl im Kommentar liest sich wie eine vollstaendige Liste, und niemand
	// zaehlt nach. Deshalb steht hier die ZUSICHERUNG und der Griff, mit dem man sie nachprueft --
	// nicht ihr Ergebnis (dieselbe Form wie in AGENTS.md §11 an den Rauschfiltern):
	//
	//   grep -rn 'style\.zIndex = [0-9]' js/ --include=*.js | grep -v third-party \
	//     | sed -E 's/^([^:]+):([0-9]+):.*zIndex = ([0-9]+).*/\3 \1:\2/' | sort -n
	//
	// 💣 UND DIESER GRIFF FINDET DIE EIGENEN ZWEI NICHT. Er sucht eine ZIFFER hinter `zIndex =`;
	// hier steht dort eine Variable (`pane.style.zIndex = z`, weiter unten), weil beide Panes durch
	// dieselbe Funktion gehen. Wer nur ihn faehrt, haelt 462 und 465 fuer frei und vergibt sie ein
	// zweites Mal -- dieselbe Fehlerform wie ein Suchmuster, das eine Zugriffssyntax voraussetzt
	// (AGENTS.md §11, Zoombaender: das Inventar-Grep mit Klammer fand die Punktzugriffe nie).
	// Die Konstanten dazu:
	//
	//   grep -rn 'PANE_Z = [0-9]' js/ --include=*.js | grep -v third-party
	//
	// ⚠️ Eine Pane kann ihren z-Wert auch anderswo bekommen (CSS, ein anderes Muster); wer die
	// Zahlen aendert, misst zusaetzlich im Browser nach -- `getComputedStyle` ueber die Kinder von
	// `map.getPane("mapPane")` gibt die tatsaechliche Stapelung.
	//
	// 💣 `getPane` ZUERST, dann erst `createPane` — und nicht umgekehrt. Leaflet 1.9.4 prueft in
	// `createPane` NICHT, ob es die Pane schon gibt: es legt jedes Mal ein NEUES <div> an und haengt
	// das alte, samt aller darin gezeichneten Ebenen, unerreichbar im DOM ab. Und es ist schlimmer
	// als „doppelt": `_getPaneRenderer` merkt sich EIN `L.SVG` je Pane-NAMEN, dessen Container im
	// abgehaengten <div> zurueckbliebe -- die Zeichnung waere danach UNSICHTBAR. `getPane` selbst
	// LEGT NICHTS AN und liefert `undefined` — deshalb die Oder-Verkettung und nicht der blosse
	// Zugriff auf `.style`.
	// ⚠️ Und `garetienPaneSicherstellen` fasst `display` NIE an: das ist der Sichtzustand, und ein
	// Neuzeichnen darf eine ausgeblendete Partei nicht wieder einblenden.
	var AVESMAPS_GARETIEN_IHRE_PANE = "garetienImportIhrePane";
	var AVESMAPS_GARETIEN_IHRE_PANE_Z = 465;
	var AVESMAPS_GARETIEN_UNSERE_PANE = "garetienImportUnserePane";
	var AVESMAPS_GARETIEN_UNSERE_PANE_Z = 462;

	// ---- Die Masse ----------------------------------------------------------------------------
	//
	// Aus dem freigegebenen Mockup (docs/garetien-importer-mockup.html §2, dort als SVG in
	// Bildschirm-Pixeln gezeichnet — dieselbe Einheit, in der Leaflet `weight` misst).
	// ⚠️ Der Hof muss deutlich breiter sein als die Linie darin: ein `Flussweg` zeichnet
	// mit `PATH_CENTER_WEIGHTS.Flussweg = 3` (js/config.js) plus Kontur. Kein Token: `tokens.css`
	// fuehrt keine Strichbreiten fuer Kartengeometrie, jede Kartenebene im Haus haelt ihre eigene
	// Zahl (map-features.js, ecosystem-*.js). Fuer FARBEN gilt das Gegenteil — siehe unten.
	var AVESMAPS_GARETIEN_STRICH_BREITE = 3;
	var AVESMAPS_GARETIEN_STRICHELUNG = "9 5";
	// 🔴 NUR NOCH DER RUECKFALL (30.08.2026, Owner: „das Design dessen, was es werden wird,
	// uebernehmen -- z.b. ... die Ortsmarkierung"). Fuer eine ERKANNTE Siedlungsklasse (metropole
	// .. gebaeude) kommt die Groesse jetzt aus DEMSELBEN Zoomband, das die echte Ortsmarkierung
	// zeichnet (garetienPunktDurchmesser, location-zoom-bands.js) -- ein dorf ist kleiner als eine
	// metropole, und beide wachsen mit dem Zoom. Diese eine Zahl bleibt nur fuer Punkte, denen keine
	// Zoombandklasse zugeordnet werden kann: Berggipfel und Bauwerk kennen KEIN eigenes Band (die
	// Tafel fuehrt ausschliesslich Siedlungsklassen), und ein Punkt ohne jeden Vorschlag (die
	// Ebenen-Tafel kennt seine Klasse noch nicht).
	var AVESMAPS_GARETIEN_PUNKT_RADIUS = 8;
	var AVESMAPS_GARETIEN_SCHEIN_BREITE = 13;
	var AVESMAPS_GARETIEN_SCHEIN_DECKKRAFT = 0.55;
	// 🔴 NUR NOCH DER RUECKFALL (30.08.2026, Owner: „das Design dessen, was es werden wird,
	// uebernehmen -- z.b. die Farbe einer Sumpflaeche"). Wie voll eine ECHTE Flaeche gefuellt ist,
	// haengt von ihrer Art ab -- derographisch 0,16, Vegetation/Topographie 0,72, Klima 0,30
	// (css/features/ecosystem-layer.css), plus einer moeglichen Uebersteuerung je Typ
	// (Darstellungstafel, js/map-features/ecosystem-display.js, Entwurf §5.2). Diese eine Zahl bleibt
	// nur stehen, wenn die ART nicht bekannt ist -- siehe garetienFlaechenDeckkraft weiter unten, die
	// die VORHANDENE Regel (avesmapsEcosystemDisplayDeckkraft) ruft, statt ihre Zahlen ein zweites
	// Mal aufzuschreiben (AGENTS.md §12: eine Deckkraft zweimal hingeschrieben ist Divergenz mit
	// Anlauf, dieselbe Lehre wie bei den Zoombaendern). Beide Parteien nehmen weiterhin denselben
	// Wert je Objekt: bei zwei uebereinanderliegenden Seen ist die Ueberlappung dann sichtbar
	// kraeftiger, und genau das ist die Auskunft „hier sind sie sich einig".
	var AVESMAPS_GARETIEN_FLAECHE_DECKKRAFT = 0.14;

	// Sie stehen im `class`-Attribut der erzeugten SVG-Pfade. Nicht Zierde: so laesst sich in der
	// Abnahme im echten Browser trennen, wessen Form welche ist, ohne die Leaflet-Interna
	// anzufassen -- und die Klasse traegt zusaetzlich die Zeigerregel
	// (css/components/garetien-importer.css).
	var AVESMAPS_GARETIEN_KLASSE_IHRE = "gi-map-ihre";
	var AVESMAPS_GARETIEN_KLASSE_UNSERE = "gi-map-unsere";
	var AVESMAPS_GARETIEN_KLASSE_SCHEIN = "gi-map-schein";
	// 🔴 NEU seit RULING R8 (task-3-nachtrag.md §1): IHRE Form traegt seither ihre ECHTE
	// Kartenfarbe (Sicht-Tafel) statt immer Gold -- der Hof haelt die Herkunft trotzdem lesbar
	// und braucht deshalb eine EIGENE Klasse mit einem EIGENEN (goldenen) Weichzeichner. Ein
	// gemeinsamer Hof mit `AVESMAPS_GARETIEN_KLASSE_SCHEIN` ginge nicht: dessen Farbe ist an
	// UNSERE Partei gebunden (Magenta) und muss es bleiben, siehe der Kommentar dort.
	var AVESMAPS_GARETIEN_KLASSE_SCHEIN_IHRE = "gi-map-schein-ihre";
	// 🔴 NEU seit Aufgabe 4 (Entwurf §4.2): die KOLLISION -- ein Objekt, bei dem an derselben
	// Stelle bei UNS etwas liegt UND eine Frage offen ist. Sie haengt NEBEN der Hof-Klasse am
	// selben Element (Leaflets `className` nimmt mehrere, durch Leerzeichen getrennt) -- eine
	// eigenstaendige Ebene waere die zweite Bauform fuer denselben Sinn (task-4-nachtrag.md §1).
	var AVESMAPS_GARETIEN_KLASSE_KOLLISION = "gi-map-kollision";

	// 🔴 DIE FARBEN KOMMEN AUS TOKENS (AGENTS.md §12) — sie stehen nirgends als Zahl in dieser Datei.
	var AVESMAPS_GARETIEN_TOKEN_IHRE = "--color-marker-active";
	var AVESMAPS_GARETIEN_TOKEN_UNSERE = "--color-garetien-unsere";
	// EIN Name fuer das Marker-Token einer Siedlung -- es steht seit heute SIEBEN statt sechs Mal in
	// dieser Datei (sechs Ebenen-Zeilen plus die dynamische Siedlungsklasse in
	// avesmapsGaretienSichtFuer), und ein neuer Umton soll nicht sieben Stellen finden muessen.
	var AVESMAPS_GARETIEN_TOKEN_SIEDLUNG = "--color-marker-settlement";

	/*
	 * Die sechs Siedlungsklassen (AGENTS.md §2: „Settlement type slugs (stable keys)") -- ein FESTES
	 * Vokabular wie PATH_SUBTYPE_KEYS, keine Regel, die sich aendern koennte. `garetien-abgleich.php`
	 * setzt bei `ziel: 'location'` `subtyp` auf genau eine davon und `kind` auf `null` (leer im
	 * Client) -- dieselbe Form wie ein WEG-Ziel (Flussweg/Strasse/...), das ebenfalls `kind: null`
	 * traegt. Ohne diese Liste liesse sich ein leeres `kind` nicht auseinanderhalten: ein
	 * Weg-`subtyp` braucht die Ableitung `--color-path-<subtyp>`, eine Siedlungsklasse braucht
	 * `AVESMAPS_GARETIEN_TOKEN_SIEDLUNG` -- und die zwei Wertevorraete ueberschneiden sich nicht
	 * (klein-deutsche Siedlungsklassen gegen grossgeschriebene Wegarten).
	 * ⚠️ Sie entscheidet NUR Zugehoerigkeit, nie Aussehen: die tatsaechliche GROESSE je Klasse UND
	 * Zoomstufe bleibt ausschliesslich in location-zoom-bands.js (garetienPunktDurchmesser weiter
	 * unten).
	 */
	var AVESMAPS_GARETIEN_SIEDLUNGSKLASSEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];

	// Traegt `objekt.subtyp` eine der sechs Siedlungsklassen? "" sonst (z.B. ein Weg-Subtyp oder gar
	// keiner). REIN.
	function garetienSiedlungsKlasse(objekt) {
		var subtyp = String((objekt || {}).subtyp || "");
		return AVESMAPS_GARETIEN_SIEDLUNGSKLASSEN.indexOf(subtyp) !== -1 ? subtyp : "";
	}

	/*
	 * Die zwei Parteinamen — sie stehen in JEDEM Tooltip vorn, und das ist ihr Zweck (Owner
	 * 29.08.2026: „dass ich seh welches objekt welchs ist").
	 *
	 * 💣 SIE STEHEN EIN ZWEITES MAL IN review-garetien-importer.js, auf den zwei Sicht-Knoepfen.
	 * Das ist ein GEKOPPELTER WERT in zwei Dateien und kein Versehen: der Importer laeuft auch auf
	 * Seiten ohne Karte (die Editorfenster laden diese Datei nicht), er darf sie also nicht
	 * voraussetzen, und diese Datei wird im Test allein geladen, kann also den Importer nicht
	 * voraussetzen. Ein Rueckfall in eine der beiden Richtungen waere genau die stille Divergenz,
	 * die ein gekoppelter Wert vermeiden soll. Zusammengehalten werden sie von
	 * js/review/__tests__/garetien-karte.test.js, das beide Exporte gegeneinander haelt.
	 * ⚠️ „Garetien" ist hier die PARTEI (der Name des Fensters), nicht die Website: die Zeilen kommen
	 * aus garetien.de UND koschwiki.de. Welche Seite es je Objekt war, steht in `objekt.wiki` und
	 * wird im Importer beschriftet (AVESMAPS_GARETIEN_WIKI_LABEL) — diese Tabelle wird hier bewusst
	 * NICHT kopiert.
	 */
	var AVESMAPS_GARETIEN_PARTEI_IHRE = "Garetien";
	var AVESMAPS_GARETIEN_PARTEI_UNSERE = "Avesmaps";

	/*
	 * Traegt ein Objekt dieses Feld, wird nur IHRE Seite gemalt (Owner 30.08.2026: „der button
	 * sollte nur imports nicht unsere eigenen anzeigen").
	 *
	 * 💣 DERSELBE GEKOPPELTE WERT WIE DIE ZWEI PARTEINAMEN DARUEBER, aus demselben Grund: das
	 * Fenster laeuft auch auf Seiten ohne Karte und darf den Zeichner nicht voraussetzen, der
	 * Zeichner wird im Test allein geladen und kann das Fenster nicht voraussetzen.
	 * Zusammengehalten von js/review/__tests__/garetien-karte.test.js.
	 * 🔴 ENTSCHIEDEN WIRD IM FENSTER, nicht hier: der Zeichner weiss nicht, WARUM ein Objekt nur
	 * halb gezeigt wird, und soll es nicht wissen.
	 */
	var AVESMAPS_GARETIEN_FELD_NUR_IHRE = "nur_ihre";

	/*
	 * Und dasselbe fuer „das ist die gerade GEWAEHLTE Zeile" (Owner 30.08.2026, an einem
	 * Bildschirmfoto: „kannst du einer selektierten Flaeche einen durchgehende kontur geben
	 * (anstelle der gestrichelten)").
	 *
	 * 💣 GEKOPPELTER WERT IN ZWEI DATEIEN, gesetzt in review-garetien-importer.js
	 * (garetienGewaehltStempeln), gelesen hier -- dieselbe Begruendung und derselbe Waechter wie
	 * beim Feld darueber.
	 * 🔴 ENTSCHIEDEN WIRD IM FENSTER: der Zeichner weiss nicht, WELCHE Zeile offen ist.
	 */
	var AVESMAPS_GARETIEN_FELD_GEWAEHLT = "gewaehlt";
	// 🔴 GEKOPPELTER WERT IN ZWEI DATEIEN (siehe die Zeile darüber). Der Importer stempelt die
	// GEWÄHLTE Strömungsrichtung an das Objekt; hier wird sie zu Dreiecken.
	var AVESMAPS_GARETIEN_FELD_FLOW = "flowDir";

	// 💣 DIE EBENENGRUPPE IST DER ZUSTAND — kein Schalter, keine Liste, kein „ist offen" daneben,
	// das auseinanderlaufen koennte. Gezeichnet wird immer: erst alles abraeumen, dann alles neu.
	var gruppe = null;

	// ---- Zugriffe, alle defensiv ------------------------------------------------------------------
	//
	// 💣 `typeof map !== "undefined"` allein ist als Riegel WERTLOS: `<div id="map">` legt in jedem
	// Browser ein globales `map` an. Gefragt wird deshalb nach einem Zug, den nur eine Leaflet-Karte
	// kann.
	function garetienKarte(karte) {
		if (karte) { return karte; }
		if (typeof map !== "undefined" && map && typeof map.getPane === "function") { return map; }
		return null;
	}

	function garetienLeaflet() {
		return typeof L !== "undefined" && L ? L : null;
	}

	// ⚠️ Leaflet-Pfadoptionen nehmen kein `var(--…)`, der Wert wird deshalb ausgelesen; dasselbe
	// Mittel wie in map-features-ecosystem-draw.js und -simplify.js.
	// ⚠️ Und KEIN abgeschriebener Rueckfall: eine hartkodierte Ersatzfarbe waere genau die zweite
	// Fassung, die das Token verhindern soll. Fehlt das Token, faellt die Farbe leer aus und der
	// Fehler ist sichtbar, statt in einer veraltenden Kopie zu ueberleben.
	function garetienTokenFarbe(name) {
		if (typeof document === "undefined" || typeof getComputedStyle !== "function") { return ""; }
		return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	}

	// EINE Regel fuer BEIDE Panes -- eine zweite Fassung liefe beim ersten geaenderten Wert
	// auseinander, und der Riegel „nimmt keine Klicks" muss fuer beide gelten.
	function garetienPaneSicherstellen(karte, name, z) {
		if (!karte || typeof karte.getPane !== "function" || typeof karte.createPane !== "function") {
			return null;
		}
		var pane = karte.getPane(name) || karte.createPane(name);
		if (!pane || !pane.style) { return null; }
		pane.style.zIndex = z;
		// 🔴 DIE PANE NIMMT KEINE ZEIGEREREIGNISSE — die einzelnen Formen darin schon.
		// `pointer-events: none` an einem Element verhindert NICHT, dass ein Nachkomme mit einem
		// eigenen Wert Ziel wird (so ausdruecklich in CSS UI festgelegt). Die leeren Flaechen der
		// Pane bleiben damit durchlaessig — Ziehen und Zoomen der Karte, ein Rechtsklick auf „Was
		// ist hier?", ein Klick auf eine Ortsmarkierung: alles unveraendert. Nur die 3 px breite
		// KONTUR einer gezeichneten Form faengt den Zeiger, und genau die braucht der Tooltip.
		// ⚠️ `display` wird hier NIE angefasst: das ist der Zustand der zwei Sicht-Knoepfe.
		pane.style.pointerEvents = "none";
		return pane;
	}

	// 🔴 Kein zweiter Abruf (Entscheidung des Auftraggebers): fehlt eine Geometrie, ist das ein
	// Befund am Server und wird als solcher gemeldet. Still auszufallen saehe aus wie „da liegt
	// eben nichts" — und genau diese Ununterscheidbarkeit hat „Was ist hier?" schon einmal gekostet.
	function garetienGeometrieFehlt(objekt, publicId) {
		if (typeof console === "undefined" || typeof console.warn !== "function") { return; }
		var name = String((objekt && objekt.name) || (objekt && objekt.key) || "ohne Namen");
		console.warn("Garetien Importer: keine Geometrie fuer "
			+ (publicId === null ? ("das Objekt \"" + name + "\"") : ("den Abschnitt " + publicId
				+ " von \"" + name + "\""))
			+ " — der Server hat sie nicht mitgeschickt (action:'liste').");
	}

	/*
	 * Fix-Runde 1 zu Aufgabe 3: ein Riegel gegen die STILLE UNSICHTBARKEIT.
	 *
	 * 🔴 DAS TEURE AN DIESEM FEHLER IST NICHT DAS FEHLENDE TOKEN, SONDERN DASS ES AUSSIEHT WIE
	 * „DA LIEGT NICHTS" -- dieselbe Ununterscheidbarkeit, die „Was ist hier?" in diesem Projekt
	 * schon einmal gekostet hat (AGENTS.md §11). `avesmapsGaretienSichtFuer` kann das selbst nicht
	 * pruefen: sie ist REIN (kein DOM), der einzige Ort, an dem ein Tokenname wirklich existiert
	 * oder eben nicht, ist `getComputedStyle` -- und der ist nur hier, am Zeichenort, verfuegbar.
	 *
	 * 🔴 BEIDE Wege aus der Rueckmeldung, nicht nur einer: Sichtbarkeit UND Diagnose sind zwei
	 * verschiedene Adressaten. Der Owner soll das Objekt trotzdem SEHEN (deshalb der Fall auf
	 * `AVESMAPS_GARETIEN_SICHT_NEUTRAL` zurueck, dieselbe Form wie eine unbekannte Ebene) -- ein
	 * Entwickler soll aber auch NACHVOLLZIEHEN koennen, WARUM die Farbe nicht der Ebene entspricht,
	 * und das leistet nur eine Meldung, die den Tokennamen nennt (`garetienGeometrieFehlt` daneben
	 * ist das Vorbild). Nur der Fallback allein liesse einen kaputten Tokennamen ununterscheidbar
	 * von einer echten unbekannten Ebene aussehen; nur die Meldung allein liesse den Besucher
	 * weiter vor einer Luecke stehen.
	 * ⚠️ Betrifft NUR den `subtyp`/`kind`-Zweig (dynamisch aus der Hauskonvention gebaut, siehe
	 * `avesmapsGaretienSichtFuer`) -- die `ebene`-Tafel selbst ist vorab gegen tokens.css geprueft
	 * (garetien-sicht-tafel.test.js Abschnitt 5) und der Neutral-Rueckfall nimmt ohnehin
	 * `AVESMAPS_GARETIEN_TOKEN_IHRE`, dasselbe Token wie hier -- ein zirkulaerer Fehlschlag ist
	 * damit ausgeschlossen, so lange dieses eine Token existiert.
	 */
	function garetienSichtTokenFehlt(objekt, token) {
		if (typeof console === "undefined" || typeof console.warn !== "function") { return; }
		var name = String((objekt && objekt.name) || (objekt && objekt.key) || "ohne Namen");
		console.warn("Garetien Importer: die Sicht-Tafel hat fuer \"" + name + "\" den Tokennamen \""
			+ token + "\" hergeleitet, aber css/base/tokens.css kennt ihn nicht — das Objekt wird "
			+ "stattdessen neutral (Gold) gezeichnet, statt gar nicht.");
	}

	// ---- Die reinen Regeln ------------------------------------------------------------------------

	/*
	 * GeoJSON steht als [x, y] da, Leaflet mit L.CRS.Simple liest [lat, lng] = [y, x].
	 *
	 * 💣 DER TAUSCH STEHT AN EINER STELLE, und das ist Absicht: es ist die Falle aus AGENTS.md §5,
	 * und sie hat in Aufgabe 4b dieses Vorhabens schon einen Critical gekostet (jeder importierte
	 * Weg lag gespiegelt). Sie faellt bei einem Objekt NAHE DER DIAGONALE nicht auf — dort ist
	 * getauscht wie ungetauscht.
	 * ⚠️ Die Eingabe bleibt unberuehrt: sie ist die Serverantwort, und die Einzelansicht liest sie
	 * weiter. Eine an Ort und Stelle gedrehte Liste laege beim zweiten Zeichnen wieder richtig herum.
	 * ⚠️ Ein halber oder unzahliger Punkt faellt heraus statt mitzureisen — Leaflet rechnet mit einem
	 * NaN klaglos weiter, bis eine Transformation kippt, und dann ist die ganze Karte weg.
	 */
	/*
	 * Ist dieser Knoten ein Punktpaar? REIN.
	 *
	 * 🪤 `!Array.isArray` an beiden Stellen ist tragend: `Number([5])` ist 5, nicht NaN -- ohne die
	 * zwei Wachen saehe `[[5], [6]]` wie ein Punkt aus, und ein ganzer Ring verschwaende in ihm.
	 */
	function garetienIstPunkt(knoten) {
		return Array.isArray(knoten) && knoten.length >= 2
			&& !Array.isArray(knoten[0]) && !Array.isArray(knoten[1])
			&& isFinite(Number(knoten[0])) && isFinite(Number(knoten[1]));
	}

	/*
	 * Ist dieser Knoten eine PUNKTLISTE -- ein Ring, eine Linie, ein einzelner Ort? REIN.
	 *
	 * 🔴 SIE IST DIE WEICHE ZWISCHEN DEN ZWEI FORMEN, DIE GLEICHZEITIG IM FELD LIEGEN: seit dem
	 * 30.08.2026 liefert der Server unsere Geometrie MIT ihrer Ringstruktur, aber die alte flache
	 * Liste ist beim Rechnen abgelegt worden -- ein Lauf von gestern traegt sie, bis jemand
	 * „Holen & Rechnen" neu faehrt. Der Zeichner muss also beide lesen koennen.
	 */
	function garetienIstPunktliste(knoten) {
		return Array.isArray(knoten) && knoten.length > 0 && garetienIstPunkt(knoten[0]);
	}

	/*
	 * GeoJSON [x, y] -> Leaflet [lat, lng] = [y, x], auf JEDER Ebene, und die Verschachtelung
	 * bleibt stehen. REIN -- die Eingabe wird nie an Ort und Stelle gedreht.
	 *
	 * 🔴 Sie ist rekursiv, seit unsere Geometrie ihre Ringe behaelt (Owner-Meldung 30.08.2026,
	 * „diese wirre rosa linie"): `L.polygon` liest eine Liste von Ringen als Flaeche mit Loechern
	 * und eine Liste von Teilen als Mehrfachpolygon -- es braucht also kein zweites Format, nur
	 * den Verzicht aufs Flachklopfen. Eine flache Liste kommt flach wieder heraus.
	 * ⚠️ Unfug faellt still heraus, auch tief unten: eine NaN-Koordinate reisst sonst die ganze
	 * Karte mit (Leaflet rechnet damit weiter, bis eine Transformation NaN wird).
	 */
	function avesmapsGaretienNachLeaflet(knoten) {
		if (!Array.isArray(knoten)) { return []; }
		if (garetienIstPunktliste(knoten)) {
			var raus = [];
			knoten.forEach(function (punkt) {
				if (!garetienIstPunkt(punkt)) { return; }
				raus.push([Number(punkt[1]), Number(punkt[0])]);
			});
			return raus;
		}
		var aeste = [];
		knoten.forEach(function (kind) {
			var gebaut = avesmapsGaretienNachLeaflet(kind);
			if (gebaut.length > 0) { aeste.push(gebaut); }
		});
		return aeste;
	}

	/*
	 * Die public_ids UNSERER Abschnitte, die gezeichnet werden duerfen. REIN — kein DOM, keine Karte.
	 *
	 * 🔴 GEFRAGT WIRD, WAS DAS HAEKCHEN AENDERT, NICHT WAS DER ABGLEICH GETROFFEN HAT. Deshalb
	 * `items[].abschnitt.public_id` der angehakten Items und nicht `objekt.abschnitte` — jene Liste
	 * ist die der BERUEHRTEN Abschnitte und bei der Natter fuenfmal so lang.
	 *
	 * 🔴 UND DESHALB GIBT ES HIER KEINEN ZWEIG `urteil === 'neu'`. Der Brief verlangte ihn; die
	 * Regel oben erfuellt seine Aussage bereits und ohne Sonderfall: einem `neu` gibt
	 * `avesmapsGaretienUrteilNenntTreffer` (api/_internal/import/garetien-plan.php) gar keine
	 * Trefferliste mit, seine Items nennen also keinen Abschnitt, und es kommt [] heraus. Ein
	 * eigener Zweig waere die hartkodierte Urteilsliste, die Ruling R21 desselben Vorhabens
	 * ausdruecklich verworfen hat („bei der naechsten Urteilsart still falsch, und niemand merkt
	 * es"). Der Test faehrt beide Formulierungen gegeneinander.
	 *
	 * 💣 `selected` kommt vom Server als 0/1-ZAHL (`(int) $roh['selected']` in garetien-liste.php),
	 * nie als Bool. Ein `=== true` laese live ausnahmslos „nichts angehakt".
	 * ⚠️ Entdoppelt: mehrere Items (Luecke, Umbenennung, Geometrie) koennen denselben Abschnitt
	 * nennen — er bekommt EINE Form, nicht drei uebereinander.
	 * 🪤 Sie hiess bis zum 29.08.2026 `avesmapsGaretienScheinIds`. „Schein" heisst seither nur noch
	 * der Hof; entschieden wird hier, welche unserer Abschnitte ueberhaupt auf die Karte kommen.
	 */
	function avesmapsGaretienUnsereIds(objekt) {
		// 🔴 DER EINE RIEGEL FUER „nur ihre Seite" (Owner 30.08.2026). Er sitzt hier, weil diese
		// Funktion die EINZIGE Stelle ist, die entscheidet, welche unserer Abschnitte auf die Karte
		// kommen -- der Zeichner ruft sie, und garetienUnsereVorhanden (die Sperre des Knopfes
		// „Avesmaps", review-garetien-importer.js) misst an derselben. Ein zweiter Riegel im
		// Zeichenlauf liesse den Knopf bedienbar aussehen, wo nichts mehr zu sehen ist.
		if (objekt && objekt[AVESMAPS_GARETIEN_FELD_NUR_IHRE] === true) { return []; }
		var raus = [];
		var gesehen = {};
		(((objekt || {}).items) || []).forEach(function (item) {
			if (!item || !item.selected) { return; }
			var abschnitt = item.abschnitt;
			var id = (abschnitt && abschnitt.public_id !== undefined && abschnitt.public_id !== null)
				? String(abschnitt.public_id)
				: "";
			if (id === "" || gesehen[id] === true) { return; }
			gesehen[id] = true;
			raus.push(id);
		});
		return raus;
	}

	/*
	 * UNSER Abschnitt zu einer public_id. REIN.
	 *
	 * 🔴 GELESEN WIRD NUR `objekt.abschnitte`, und das ist die EINE Quelle -- dieselbe Liste, die
	 * auch die Einzelansicht zeigt; so koennen Karte und Zeile nicht auseinanderlaufen.
	 * 🪤 Hier stand bis zur Pruefung ein Rueckfall auf `item.abschnitt`. Er war TOTER CODE mit einem
	 * beruhigenden Kommentar darueber: `avesmapsGaretienListeAbschnitteVereinen`
	 * (api/_internal/import/garetien-liste.php) haengt JEDEN von einem Item genannten Abschnitt an
	 * die Liste an, und `avesmapsGaretienUnsereIds` liest genau dieselben Items -- die zwei Mengen
	 * fallen zusammen. Eine Mutation `if (treffer === null)` → `if (false)` liess alle Zusicherungen
	 * gruen, was den Zweig als unerreichbar auswies. Faellt der Abschnitt je doch heraus, ist das
	 * ein BEFUND am Server und wird gemeldet (garetienGeometrieFehlt) statt still geflickt.
	 */
	function garetienAbschnitt(objekt, publicId) {
		var treffer = null;
		(((objekt || {}).abschnitte) || []).forEach(function (abschnitt) {
			if (treffer === null && abschnitt && String(abschnitt.public_id) === publicId) {
				treffer = abschnitt;
			}
		});
		return treffer;
	}

	function garetienAbschnittsPunkte(objekt, publicId) {
		var treffer = garetienAbschnitt(objekt, publicId);
		return (treffer && treffer.geometrie) || [];
	}

	/*
	 * Ist IHR Objekt eine Flaeche? REIN.
	 *
	 * 🔴 GEFRAGT WIRD DAS SERVERFELD, NIE `typ`/`subtyp`. Der Typ reist zwar mit, aber ihn
	 * auszuwerten waere die hartkodierte Typenliste, die Ruling R21 dieses Vorhabens verworfen hat
	 * ("bei der naechsten Art still falsch, und niemand merkt es"). `geometrie_typ` kommt aus
	 * `after.geometry.type` und ist die Auskunft des Erzeugers ueber sich selbst.
	 * ⚠️ Ein LEERES Feld heisst "keine Auskunft" und gilt als Linie -- das ist die zurueckhaltende
	 * Richtung: ein zu Unrecht gefuellter Umriss ueberdeckte die Karte, ein zu Unrecht ungefuellter
	 * zeigt nur weniger. Leer ist es bei einem Objekt OHNE Items (dort gibt es kein `after`), und
	 * genau die werden nie gezeichnet: ohne Item gibt es kein Haekchen.
	 * 🔴 UND ES GILT FUER BEIDE PARTEIEN. `ziel` entscheidet in garetien-abgleich.php ueber beides:
	 * `ziel: 'path'` heisst ihre Geometrie ist ein LineString UND unser Kandidat ein `map_features`-
	 * Weg; `ziel: 'region'` heisst ihre ist ein Polygon UND unser Kandidat eine `ecosystem_area`.
	 * Ein eigenes Feld fuer unsere Seite gibt es deshalb nicht — und braucht es nicht.
	 */
	function garetienIstFlaeche(objekt) {
		return String((objekt || {}).geometrie_typ || "") === "Polygon";
	}

	/*
	 * 🔴 DIE SICHT-TAFEL (Entwurf §4.1, Aufgabe 3): wie ein importiertes Objekt AUSSIEHT, wenn es
	 * (noch) keinen Vorschlag traegt. Sie sagt NIE, was daraus wird -- ein Eintrag hier legt nichts
	 * an und aendert keine Zuordnung. Das ist der Unterschied zu AVESMAPS_GARETIEN_TYP_MAP
	 * (api/_internal/import/garetien-abgleich.php), und er ist der Grund, warum diese Tafel Ruling
	 * R21 nicht verletzt: R21 verbot eine hartkodierte Typenliste, die SEMANTIK entscheidet. Hier
	 * entscheidet nichts, hier wird gezeichnet.
	 *
	 * 🔴 GESCHLUESSELT AUF `ebene`, NICHT AUF `typ`:
	 *   · `ebene` traegt JEDES Objekt, aus einem festen Katalog (AVESMAPS_GARETIEN_EBENEN,
	 *     api/_internal/import/garetien-abruf.php) -- wer die genaue Zahl der moeglichen Werte
	 *     braucht, zaehlt sie DORT nach, statt einer Zahl hier zu glauben (AGENTS.md §9: eine Zahl
	 *     im Kommentar liest sich wie eine vollstaendige Liste und veraltet lautlos).
	 *   · `typ` traegt viele verschiedene Werte, von denen nur ein Teil einem Kartenziel zugeordnet
	 *     ist (Uebergabe §7.4). Eine Tafel darauf waere weitgehend geraten und muesste bei jedem
	 *     neuen Quelltyp nachgezogen werden.
	 * ⚠️ Grob, aber immer richtig: „Gewaesser" ist Wasser, auch wenn der einzelne Eintrag ein
	 * Wasserfall ist. Wer es feiner braucht, gibt dem Objekt einen Vorschlag -- dann gewinnt
	 * ohnehin die Server-Auskunft (Stufe 1 der Ordnung unten).
	 *
	 * 🔴 `Wege`, `Grenzen` UND `Sonstiges` FEHLEN, UND DAS IST ABSICHT (RULING R3,
	 * task-3-nachtrag.md §3). Fuer Wege und Grenzen gibt es KEIN Kartentoken -- tokens.css sagt an
	 * ihrer Stelle ausdruecklich, dass Reichsstrasse/Strasse/Weg als TEXTFARBE Rauschen waeren, und
	 * eine Karten-KONTUR braucht dieselbe Farbe erst recht nicht; `Sonstiges` ist der Sammeltopf
	 * ohne eigene Bedeutung. Alle drei fallen deshalb auf AVESMAPS_GARETIEN_SICHT_NEUTRAL zurueck
	 * -- und die Bilanzzeile meldet das (Schritt 5), statt es zu verschweigen.
	 * 💣 VOR JEDEM NEUEN EINTRAG: `grep -c -- "<token>:" css/base/tokens.css` muss >= 1 sein. Ein
	 * Tokenname, den es nicht gibt, liefert bei `garetienTokenFarbe` "" zurueck -- die Form
	 * verschwindet dann lautlos, kein Fehler, kein Warnhinweis.
	 */
	var AVESMAPS_GARETIEN_SICHT_EBENE = {
		Gewaesser:     { form: "linie",   token: "--color-path-flussweg",                breite: 3 },
		Berge:         { form: "punkt",   token: "--color-ecosystem-topographie-gebirge", breite: 3 },
		// 🔴 30.08.2026: `kind` ist NEU und dient NUR der Flaechen-Deckkraft (garetienObjektKind /
		// garetienFlaechenDeckkraft weiter unten) -- „Wald" ist UNZWEIDEUTIG Vegetation, auch ohne
		// Vorschlag. Bei `Gewaesser` fehlt dieselbe Angabe bewusst: die Ebene deckt
		// Fluss/Bach/Strom/See/Meer/Sumpf zugleich ab und koennte je nach Objekt TOPOGRAPHISCH oder
		// VEGETATIV werden -- eine geratene Art waere schlimmer als der zurueckhaltende Rueckfall
		// (js/review/__tests__/garetien-karte.test.js haelt genau das an "Blutmoor" fest, das ohne
		// Vorschlag bewusst bei der alten, niedrigen Deckkraft bleibt).
		Waelder:       { form: "flaeche", token: "--color-ecosystem-vegetation-wald",     breite: 2, kind: "vegetation" },
		Ortschaften_1: { form: "punkt",   token: AVESMAPS_GARETIEN_TOKEN_SIEDLUNG,        breite: 3 },
		Ortschaften_2: { form: "punkt",   token: AVESMAPS_GARETIEN_TOKEN_SIEDLUNG,        breite: 3 },
		Ortschaften_3: { form: "punkt",   token: AVESMAPS_GARETIEN_TOKEN_SIEDLUNG,        breite: 3 },
		Ortschaften_4: { form: "punkt",   token: AVESMAPS_GARETIEN_TOKEN_SIEDLUNG,        breite: 3 },
		Detail_1:      { form: "punkt",   token: AVESMAPS_GARETIEN_TOKEN_SIEDLUNG,        breite: 3 },
		Detail_2:      { form: "punkt",   token: AVESMAPS_GARETIEN_TOKEN_SIEDLUNG,        breite: 3 },
	};

	// Der Rueckfall. 🔴 Er ist das BILD VOR DIESER AUFGABE -- wer die Tafel entfernt, bekommt genau
	// diesen Stand zurueck, nicht eine leere Karte. Derselbe Goldton wie
	// AVESMAPS_GARETIEN_TOKEN_IHRE, absichtlich ueber die Konstante bezogen statt als zweites
	// Zeichenkettenliteral -- zwei Literale mit demselben Tokennamen liefen beim naechsten Umton
	// auseinander.
	var AVESMAPS_GARETIEN_SICHT_NEUTRAL = { form: "linie", token: AVESMAPS_GARETIEN_TOKEN_IHRE, breite: 3 };

	/*
	 * Die Sicht fuer EIN Objekt: Form, Farbtoken, Breite -- und ob geraten wurde. REIN, kein DOM,
	 * keine Karte (Entwurf §4.1).
	 *
	 * 🔴 EINE ORDNUNG, KEINE AUSWAHL -- dieselbe Bauform wie die Art-Regel der Landschaft
	 * (AGENTS.md §11): erst die Server-Auskunft (`subtyp`), dann die Tafel (`ebene`), dann neutral.
	 * ⚠️ Der Tokenname wird bei einem Vorschlag nach der HAUSKONVENTION hergeleitet
	 * (`--color-ecosystem-<kind>-<subtyp mit _ als ->`, css/base/tokens.css:282) -- eine zweite
	 * Tabelle, die dieselbe Abbildung noch einmal auflistet, liefe beim ersten neuen Typ
	 * auseinander. Ein WEG-Ziel (Fluss/Bach/Strom) traegt kein `kind` und leitet stattdessen aus
	 * `--color-path-<subtyp klein geschrieben>` her.
	 * ⚠️ `neutral: true` heisst NICHT „falsch gezeichnet" -- es heisst „nach der zurueckhaltenden
	 * Regel gezeichnet, weil es (noch) keine eigene gibt". Das ist die Information, die Schritt 5
	 * an die Bilanzzeile weiterreicht.
	 */
	function avesmapsGaretienSichtFuer(objekt) {
		var o = objekt || {};
		var kind = String(o.kind || "");
		var subtyp = String(o.subtyp || "");
		var geoTyp = String(o.geometrie_typ || "");

		if (subtyp !== "") {
			/*
			 * 🔴 GEFUNDEN BEIM BAU DER ORTSMARKIERUNGS-GROESSE (30.08.2026): eine Siedlungsklasse
			 * (subtyp='dorf'..'gebaeude') traegt bei `ziel:'location'` IMMER `kind: null` -- genau
			 * wie ein Weg-Subtyp. Ohne diese Weiche liefe „dorf" in den Weg-Zweig darunter und
			 * ergaebe `--color-path-dorf`, ein Tokenname, den es nicht gibt -> Meldung + Gold-
			 * Rueckfall, obwohl die Sicht-Tafel ein paar Zeilen weiter unten genau dafuer schon
			 * `AVESMAPS_GARETIEN_TOKEN_SIEDLUNG` bereithaelt (Ortschaften_1..4/Detail_1..2). Jede
			 * Ortschaft/jedes Bauwerk mit einem aufgeloesten Vorschlag traf also lautlos den
			 * Warnpfad, statt seine echte (rote) Markerfarbe zu bekommen.
			 */
			if (kind === "" && garetienSiedlungsKlasse(o) !== "") {
				return { form: "punkt", token: AVESMAPS_GARETIEN_TOKEN_SIEDLUNG, breite: 3, neutral: false };
			}
			var token = kind !== ""
				? "--color-ecosystem-" + kind + "-" + subtyp.replace(/_/g, "-")
				: "--color-path-" + subtyp.toLowerCase();
			return {
				form: geoTyp === "Polygon" ? "flaeche" : "linie",
				token: token,
				breite: 3,
				neutral: false,
			};
		}

		var eintrag = AVESMAPS_GARETIEN_SICHT_EBENE[String(o.ebene || "")];
		if (!eintrag) {
			return {
				form: AVESMAPS_GARETIEN_SICHT_NEUTRAL.form,
				token: AVESMAPS_GARETIEN_SICHT_NEUTRAL.token,
				breite: AVESMAPS_GARETIEN_SICHT_NEUTRAL.breite,
				neutral: true,
			};
		}
		// ⚠️ `geometrie_typ` schlaegt die Tafel auch hier, falls es doch einmal gefuellt ist -- es
		// ist die Auskunft des Erzeugers, die Tafel ist nur die Faustregel.
		return {
			form: geoTyp === "Polygon" ? "flaeche" : eintrag.form,
			token: eintrag.token,
			breite: eintrag.breite,
			neutral: false,
		};
	}

	/*
	 * Das `kind` EINES Objekts, fuer die Flaechen-Deckkraft -- unabhaengig von der Partei, denn
	 * `kind` beschreibt das ZIEL (topographie/vegetation/...), nicht wessen Geometrie gerade
	 * gezeichnet wird. REIN.
	 *
	 * 🔴 EINE ORDNUNG: erst die Server-Auskunft (`objekt.kind`, gefuellt sobald ein Vorschlag
	 * vorliegt), dann die Ebenen-Tafel -- aber NUR fuer die Zeilen, die dort ausdruecklich ein
	 * `kind` tragen (heute: `Waelder`). Eine Ebene OHNE `kind`-Eintrag (z.B. `Gewaesser`, das
	 * Fluss/Bach/Strom/See/Meer/Sumpf gemeinsam traegt) bleibt ABSICHTLICH ohne Antwort -- eine
	 * geratene Art waere schlimmer als der zurueckhaltende Rueckfall in garetienFlaechenDeckkraft.
	 */
	function garetienObjektKind(objekt) {
		var kind = String((objekt || {}).kind || "");
		if (kind !== "") { return kind; }
		var eintrag = AVESMAPS_GARETIEN_SICHT_EBENE[String((objekt || {}).ebene || "")];
		return (eintrag && eintrag.kind) ? eintrag.kind : "";
	}

	/*
	 * Die Deckkraft, mit der eine Flaeche gefuellt wird -- „die Farbe einer Sumpflaeche" (Owner
	 * 30.08.2026). REIN, kein DOM, keine Karte.
	 *
	 * 🔴 DIE VORHANDENE REGEL, NICHT IHRE ZAHLEN: `avesmapsEcosystemDisplayDeckkraft`
	 * (js/map-features/ecosystem-display.js, geladen VOR dieser Datei) ist die dokumentierte
	 * einzige Quelle dieser Zahlen (derographisch 0,16 / Vegetation+Topographie 0,72 / Klima 0,30,
	 * plus eine moegliche Uebersteuerung je Typ). Ein zweiter Satz Zahlen hier wuerde beim naechsten
	 * "die Farben kraeftiger" (wie am 2026-08-04 bei genau dieser Tafel geschehen) stillschweigend
	 * veralten.
	 * ⚠️ OHNE bekanntes `kind` bleibt es beim alten, niedrigen Festwert
	 * (AVESMAPS_GARETIEN_FLAECHE_DECKKRAFT) -- eine mehrdeutige Ebene (`Gewaesser`) rundet damit
	 * NICHT auf 0,72 hoch, siehe garetienObjektKind. Genauso, wenn die Regel selbst fehlt (z.B. ein
	 * Testlauf, der review-garetien-karte.js allein laedt): kein Werfen, sondern derselbe
	 * zurueckhaltende Rueckfall.
	 */
	function garetienFlaechenDeckkraft(objekt) {
		var kind = garetienObjektKind(objekt);
		if (kind === "") { return AVESMAPS_GARETIEN_FLAECHE_DECKKRAFT; }
		var subtyp = String((objekt || {}).subtyp || "");
		return typeof avesmapsEcosystemDisplayDeckkraft === "function"
			? avesmapsEcosystemDisplayDeckkraft(kind, subtyp)
			: AVESMAPS_GARETIEN_FLAECHE_DECKKRAFT;
	}

	/*
	 * Der Aussendurchmesser (px) eines Punktobjekts -- „die Ortsmarkierung ... von der Groesse"
	 * (Owner 30.08.2026). Gilt fuer BEIDE Parteien: die Siedlungsklasse beschreibt das Ziel, nicht
	 * wessen Geometrie gerade gezeichnet wird.
	 *
	 * 🔴 DIE VORHANDENE REGEL: `avesmapsLocationZoomBandValue("marker", klasse, zoom)`
	 * (js/map-features/location-zoom-bands.js, geladen VOR dieser Datei) ist die EINZIGE Quelle der
	 * Zoombaender (AGENTS.md §11: „vorher stand `0/0/0/1/2/3` zweimal im Code" -- eine zweite Kurve
	 * hier waere derselbe Fehler ein drittes Mal).
	 * ⚠️ EIN Klassenwert kann an der AKTUELLEN Zoomstufe `null` sein ("auf dieser Stufe gibt es diese
	 * Klasse nicht", z.B. ein `dorf` bei Zoom 0). Der Vorschau-Punkt darf deshalb NICHT verschwinden
	 * -- ihr Zweck ist der Vergleich, unabhaengig davon, wo die Karte gerade steht. Der Rueckfall ist
	 * deshalb die ERSTE Zoomstufe, auf der die Klasse ueberhaupt erscheint
	 * (avesmapsLocationZoomBandMinZoom), nie eine geratene Zahl.
	 * ⚠️ Ohne erkannte Siedlungsklasse (Berggipfel, Bauwerk ohne Vorschlag, unbekannt) oder ohne die
	 * Regel selbst bleibt es beim alten Festwert (AVESMAPS_GARETIEN_PUNKT_RADIUS).
	 */
	function garetienPunktDurchmesser(objekt, karte) {
		var klasse = garetienSiedlungsKlasse(objekt);
		if (klasse === "" || typeof avesmapsLocationZoomBandValue !== "function") {
			return AVESMAPS_GARETIEN_PUNKT_RADIUS * 2;
		}
		var zoom = (karte && typeof karte.getZoom === "function") ? Number(karte.getZoom()) : NaN;
		if (!isFinite(zoom)) { zoom = 0; }
		var minZoom = (typeof avesmapsLocationZoomBandMinZoom === "function")
			? avesmapsLocationZoomBandMinZoom("marker", klasse)
			: null;
		var effektiverZoom = (minZoom !== null && zoom < minZoom) ? minZoom : zoom;
		var wert = avesmapsLocationZoomBandValue("marker", klasse, effektiverZoom);
		return typeof wert === "number" ? wert : (AVESMAPS_GARETIEN_PUNKT_RADIUS * 2);
	}

	/*
	 * Kollidiert dieses Objekt mit unserem Bestand? REIN, kein DOM, keine Karte (Entwurf §4.2).
	 *
	 * 🔴 Genau die drei Urteile, bei denen bei uns etwas an derselben Stelle liegt UND eine Frage
	 * offen ist. `neu` faellt heraus (da liegt bei uns nichts), `deckt_sich` faellt heraus (da ist
	 * nichts zu entscheiden), `uebersprungen` faellt heraus (es wurde gar nicht abgeglichen).
	 * ⚠️ Eine LISTE, kein `if`-Baum: bei der naechsten Urteilsart ist eine Kette still falsch, und
	 * niemand merkt es (Ruling R21).
	 * 💣 Der Wert heisst in den Daten `widerspruch`, NICHT `widerspricht` (task-4-nachtrag.md §4)
	 * -- der Abgleich normalisiert das, hier steht der normalisierte Wert.
	 */
	var AVESMAPS_GARETIEN_KOLLISION_URTEILE = ["widerspruch", "zweifel", "ergaenzung"];

	function avesmapsGaretienKollidiert(objekt) {
		return AVESMAPS_GARETIEN_KOLLISION_URTEILE.indexOf(String((objekt || {}).urteil || "")) !== -1;
	}

	/*
	 * Schliesst sich diese Punktliste zu EINEM Ring? REIN.
	 *
	 * 💣 DER MULTIPOLYGON-RIEGEL, und er ist gemessen, nicht geraten. UNSERE Flaechen liegen in
	 * `ecosystem_area.geometry_geojson` und duerfen Polygon ODER MultiPolygon sein, mit Loechern
	 * (api/_internal/app/ecosystem.php prueft genau das). Auf dem Weg ins Fenster verlieren sie ihre
	 * Ringstruktur zweimal: `avesmapsGaretienGeoJsonPunkte` (garetien-abgleich.php) sammelt ALLE
	 * Ringe in EINE flache Punktliste, und `avesmapsGaretienProbepunkteN` duennt sie auf 64 Punkte
	 * aus. Was hier ankommt, ist eine flache Liste ohne jede Auskunft darueber, ob sie ein Ring war.
	 * 💣 Sie als `L.polygon` zu zeichnen ergaebe bei mehreren Ringen EINE Schleife, die zwischen den
	 * Teilen hin und her springt — bei einem See mit 224 Teilen ein Gespinst statt einer Flaeche.
	 * ⭐ Der Schlusstest trennt beide Faelle EXAKT, und das ist am Livebestand nachgemessen
	 * (GET /api/app/ecosystem-areas.php, 29.08.2026, die drei Familien der Stufe 1 — see, meer,
	 * suempfe_moore): von 281 einringigen Flaechen schliesst der 64er-Abzug 281, von 105
	 * mehrringigen schliesst er 0. Null Fehlurteile in beide Richtungen. Der Grund ist strukturell:
	 * ein GeoJSON-Ring ist geschlossen (erster Punkt = letzter), und `ProbepunkteN` behaelt Index 0
	 * und Index n-1; eine Verkettung mehrerer Ringe endet dagegen auf dem Anfang des LETZTEN Rings.
	 * 🔴 GILT NUR FUER UNSERE SEITE. IHRE Punktliste kommt roh aus garetien.de und wird beim Planbau
	 * nur in `[$punkte]` gewickelt — ein unsauber geschlossener Ring ist dort moeglich, und deshalb
	 * entscheidet bei ihnen `geometrie_typ` und niemals dieser Test (der Kommentar an
	 * `'geometrie_typ'` in garetien-liste.php sagt genau das).
	 * 🔧 OFFEN: 28 der 105 mehrringigen Flaechen tragen hoechstens 64 Punkte, ihre Ringgrenzen
	 * ueberleben das Ausduennen also und liessen sich zurueckgewinnen. Bewusst nicht gebaut — eine
	 * zweite Regel fuer 7 % der Flaechen, waehrend die ehrliche Loesung ein Feld am Server ist
	 * (die Ringe selbst statt einer flachen Liste), das ein neues „Holen & Rechnen" braucht.
	 */
	function garetienRingSchliesst(punkte) {
		var n = (punkte || []).length;
		if (n < 4) { return false; }
		return punkte[0][0] === punkte[n - 1][0] && punkte[0][1] === punkte[n - 1][1];
	}

	/*
	 * Darf diese Geometrie als FLAECHE gezeichnet werden? REIN.
	 *
	 * 🔴 ZWEI FORMEN, ZWEI ANTWORTEN, und beide liegen gleichzeitig im Feld (siehe
	 * garetienIstPunktliste):
	 *  · VERSCHACHTELT (seit 30.08.2026): die Struktur ist bekannt, `L.polygon` kann sie fuellen --
	 *    der Schlusstest darf hier gar nicht mehr entscheiden. Die aeusserste Liste eines
	 *    MultiPolygons „schliesst" naemlich NIE (ihr erstes Element ist ein Ring, ihr letztes ein
	 *    anderer), er saegte also genau die Form ab, fuer die dieser Umbau gemacht ist.
	 *  · FLACH (jeder gespeicherte Lauf davor): die Ringgrenzen sind fort, und nur der Schlusstest
	 *    trennt einen echten Ring von einer Verkettung mehrerer. Ihn hier fallenzulassen machte
	 *    einen alten Lauf SCHLIMMER -- aus dem ungefuellten Gespinst wuerde ein gefuelltes.
	 */
	function garetienFlaecheZeichenbar(punkte) {
		if (garetienIstPunktliste(punkte)) { return garetienRingSchliesst(punkte); }
		return Array.isArray(punkte) && punkte.length > 0;
	}

	/*
	 * Der Tooltip-Text. REIN.
	 *
	 * 🔴 DIE PARTEI STEHT VORN — das ist der ganze Zweck (Owner 29.08.2026: „dass ich seh welches
	 * objekt welchs ist").
	 * 🔴 UNSERE Seite nennt UNSEREN Namen, nicht ihren. Das ist der Unterschied, um den es geht:
	 * ihre „Natter" laeuft ueber unseren „Gardel". Ein Tooltip, der beidesmal ihren Namen zeigte,
	 * beantwortete genau die Frage nicht, fuer die er da ist.
	 * ⚠️ Die public_id steht IMMER dabei, nicht nur bei leerem Namen: 25 von 76 Geometrietreffern
	 * trugen bei uns gar keinen Namen (garetien-abgleich.php), und „Avesmaps: ohne Namen" allein
	 * benennt nichts, was ein Editor nachschlagen koennte.
	 */
	function garetienTitelIhre(objekt) {
		return AVESMAPS_GARETIEN_PARTEI_IHRE + ": "
			+ String((objekt && objekt.name) || "ohne Namen");
	}

	function garetienTitelUnsere(objekt, publicId) {
		var abschnitt = garetienAbschnitt(objekt, publicId);
		var name = String((abschnitt && abschnitt.name) || "").trim();
		return AVESMAPS_GARETIEN_PARTEI_UNSERE + ": " + (name === "" ? "ohne Namen" : name)
			+ " (" + publicId + ")";
	}

	// ---- Zeichnen ---------------------------------------------------------------------------------

	/*
	 * EINE Form bauen — Punkt, Linie oder Flaeche, in der Farbe und Strichelung ihrer Partei.
	 *
	 * 🔴 EIN BAUER FUER BEIDE PARTEIEN. Zwei Fassungen liefen beim ersten geaenderten Mass
	 * auseinander, und der Sinn dieser Aufgabe ist, dass die zwei Formen sich NUR in Farbe und
	 * Strichelung unterscheiden — die Form selbst muss dieselbe Regel sein.
	 * 🔴 EIN PUNKT IST EIN RING, KEINE LINIE (Owner-Meldung 29.08.2026: „warum kann ich die nicht
	 * sehen?" bei den Ortschaften). Hier stand einmal `if (punkte.length < 2) return;` -- ein Objekt
	 * mit genau EINER Koordinate galt als „Geometrie fehlt" und wurde nie gezeichnet. `L.polyline`
	 * mit einem Punkt zeichnet auch nichts: eine Linie ohne zweiten Punkt hat keine Ausdehnung.
	 * 💣 Und es faellt in Stufe 1 nicht auf: Gewaesser sind Linien und Flaechen, kein einziger Punkt.
	 * Punkte kommen mit den Ortschaften, den Berggipfeln und den Bauwerken -- also mit dem groessten
	 * Teil des Bestands (rund 2519 Zeilen allein auf den zwei Ortschaftsseiten, gegen 289
	 * Gewaesserzeilen).
	 * ⚠️ `L.polygon` schliesst den Ring selbst; ein bereits geschlossener Ring schadet nicht.
	 * 🔴 `interactive: true` — ohne das gibt es keinen Tooltip. Was das kostet, steht an
	 * `garetienPaneSicherstellen` und an der Zeigerregel in css/components/garetien-importer.css.
	 */
	/*
	 * Der Name des globalen Hakens, ueber den ein Klick auf eine Form dem IMPORTER gemeldet wird.
	 *
	 * 💣 GEKOPPELTER WERT IN ZWEI DATEIEN, wie die zwei Feldnamen daneben -- und aus demselben
	 * Grund: der Zeichner darf das Fenster nicht voraussetzen (er wird im Test allein geladen),
	 * das Fenster nicht die Karte (es laeuft auch auf Seiten ohne). Liefe der Name auseinander,
	 * riefe der Zeichner ins Leere, und zwar STILL. Zusammengehalten von
	 * js/review/__tests__/garetien-karte-klick.test.js, das beide Exporte gegeneinander haelt.
	 *
	 * 🔴 Die Meldung waehlt AUS (Einzelansicht), sie haekelt NICHT an. „Ausgewaehlt" und
	 * „markiert" sind im Importer zwei verschiedene Dinge, und ein Blick darf keine Entscheidung
	 * treffen, die der Editor spaeter in einer Sammelhandlung wiederfindet (Owner 30.08.2026).
	 * Was daraus wird, entscheidet allein der Importer -- der Zeichner meldet nur den Schluessel.
	 */
	var AVESMAPS_GARETIEN_HAKEN_KLICK = "avesmapsGaretienKarteKlick";

	function garetienForm(l, punkte, opt) {
		var basis = {
			pane: opt.pane,
			className: opt.klasse,
			color: opt.farbe,
			weight: opt.breite,
			opacity: opt.deckkraft,
			lineCap: "round",
			lineJoin: "round",
			interactive: true,
		};
		if (opt.strichelung) { basis.dashArray = opt.strichelung; }
		var ebene = null;
		// 💣 `punkte.length === 1` ALLEIN reicht seit der Ringstruktur NICHT mehr: bei einer
		// verschachtelten Geometrie zaehlt die Laenge die RINGE, nicht die Punkte. Eine einteilige
		// Flaeche waere damit ein 8-px-Ring an der Stelle ihres ersten Ringpunkts geworden.
		if (garetienIstPunktliste(punkte) && punkte.length === 1) {
			if (typeof l.circleMarker !== "function") { return null; }
			// 🔴 30.08.2026: `opt.durchmesser` traegt, wenn bekannt, den ECHTEN Aussendurchmesser aus
			// dem Zoomband der Siedlungsklasse (garetienPunktDurchmesser) -- der alte Festwert bleibt
			// nur der Rueckfall. Hof UND Form desselben Punktobjekts bekommen IMMER denselben
			// Durchmesser (beide Aufrufer in avesmapsGaretienKarteZeigen reichen `eintrag.durchmesser`
			// durch): das Leuchten entsteht daraus, dass der dicke halbdurchsichtige Hofring und der
			// duenne volldeckende Form-Ring auf demselben Radius liegen -- verschiedene Radien rissen
			// den Schein neben den Punkt.
			var aussenDurchmesser = typeof opt.durchmesser === "number"
				? opt.durchmesser
				: AVESMAPS_GARETIEN_PUNKT_RADIUS * 2;
			basis.radius = aussenDurchmesser / 2;
			// Ungefuellt, damit der Ring den Ort darunter nicht zudeckt.
			basis.fill = false;
			basis.fillOpacity = 0;
			ebene = l.circleMarker(punkte[0], basis);
		} else {
			basis.fill = opt.flaeche === true;
			basis.fillColor = opt.farbe;
			// 🔴 30.08.2026: `opt.fuellwert` traegt, wenn bekannt, die ECHTE Deckkraft nach Art
			// (garetienFlaechenDeckkraft) -- der alte Festwert bleibt der Rueckfall fuer eine
			// unbekannte/mehrdeutige Art. Der Hof reicht ihn nie mit (er zeichnet nie eine Flaeche,
			// `opt.flaeche` ist dort immer `false`), also bleibt diese Zeile fuer ihn wirkungslos.
			basis.fillOpacity = opt.flaeche === true
				? (typeof opt.fuellwert === "number" ? opt.fuellwert : AVESMAPS_GARETIEN_FLAECHE_DECKKRAFT)
				: 0;
			var bauer = (opt.flaeche === true && typeof l.polygon === "function")
				? l.polygon
				: l.polyline;
			ebene = bauer(punkte, basis);
		}
		// 🔴 Der Klick meldet den Schluessel -- mehr nicht. Der Zeichner weiss nicht, was der
		// Importer daraus macht, und darf es nicht wissen.
		// ⚠️ `typeof === "function"` auf BEIDEN Seiten: das Fenster kann geschlossen oder gar nicht
		// geladen sein, und ein Wurf im Klick-Handler risse Leaflets Ereigniskette fuer die GANZE
		// Karte mit -- nicht nur fuer diese eine Form.
		if (ebene && opt.schluessel && typeof ebene.on === "function") {
			ebene.on("click", function () {
				var haken = (typeof window !== "undefined") ? window[AVESMAPS_GARETIEN_HAKEN_KLICK] : null;
				if (typeof haken === "function") { haken(opt.schluessel); }
			});
		}
		if (ebene && opt.titel && typeof ebene.bindTooltip === "function") {
			// `sticky` laesst den Tooltip dem Zeiger folgen -- an einer langen Flusslinie stuende er
			// sonst an deren Mittelpunkt, oft weit weg von der Stelle, auf die man zeigt.
			ebene.bindTooltip(opt.titel, { sticky: true, direction: "top" });
		}
		return ebene;
	}

	/*
	 * Die Kollisions-Klasse haengt NEBEN der Hof-Klasse, nie an ihrer Stelle (Entwurf §4.2:
	 * „Ergaenzung, kein Ersatz"). EIN Bauer fuer BEIDE Seiten -- unsere und ihre Paarung binden
	 * dieselbe Regel (task-4-nachtrag.md §1: „eine Regel, die einen von zwei Erzeugern bindet, ist
	 * keine Regel").
	 */
	function garetienHofKlasse(basisKlasse, kollidiert) {
		return kollidiert === true ? (basisKlasse + " " + AVESMAPS_GARETIEN_KLASSE_KOLLISION) : basisKlasse;
	}

	/*
	 * Die Menge der zu zeigenden Objekte auf die Karte legen.
	 *
	 * 💣 IDEMPOTENT: erst alles abraeumen, dann alles neu. Derselbe Aufruf zweimal ergibt dieselben
	 * Ebenen, nicht die doppelte Menge — der Listenlauf ruft ihn nach JEDEM Neuzeichnen.
	 * 🔴 DIE REIHENFOLGE MACHEN DIE PANES: unsere Partei liegt in ihrer eigenen (462), ihre in ihrer
	 * (465). Innerhalb UNSERER Pane entscheidet die Einfuegereihenfolge, und dort ist sie tragend:
	 * der Hof kommt VOR der Form, sonst deckt ein 13 px breites Band die 3 px schmale Linie zu.
	 * ⚠️ Der Sichtzustand wird hier NICHT gesetzt: er steht im `display` der Panes und ueberlebt
	 * jedes Neuzeichnen (siehe avesmapsGaretienKarteUmschalten).
	 */
	function avesmapsGaretienKarteZeigen(objekte, karte) {
		var k = garetienKarte(karte);
		var l = garetienLeaflet();
		if (!k || !l || typeof l.polyline !== "function" || typeof l.layerGroup !== "function") {
			return null;
		}
		garetienPaneSicherstellen(k, AVESMAPS_GARETIEN_UNSERE_PANE, AVESMAPS_GARETIEN_UNSERE_PANE_Z);
		garetienPaneSicherstellen(k, AVESMAPS_GARETIEN_IHRE_PANE, AVESMAPS_GARETIEN_IHRE_PANE_Z);

		if (gruppe === null) { gruppe = l.layerGroup(); }
		// ⚠️ Nur anhaengen, wenn sie nicht schon dort liegt — sonst laege die Gruppe nach zehn
		// Listenlaeufen zehnmal auf der Karte. Liegt sie auf einer ANDEREN Karte (im Produkt gibt es
		// nur eine, in Pruefstaenden mehrere), wird sie zuerst dort abgenommen.
		if (typeof k.hasLayer !== "function" || !k.hasLayer(gruppe)) {
			if (typeof gruppe.remove === "function") { gruppe.remove(); }
			gruppe.addTo(k);
		}
		gruppe.clearLayers();

		var liste = objekte || [];
		var farbeIhre = garetienTokenFarbe(AVESMAPS_GARETIEN_TOKEN_IHRE);
		var farbeUnsere = garetienTokenFarbe(AVESMAPS_GARETIEN_TOKEN_UNSERE);

		// 💣 ERST SAMMELN, DANN IN ZWEI DURCHGAENGEN ZEICHNEN -- Hof und Form je Abschnitt direkt
		// hintereinander zu legen reicht NICHT: der Hof des zweiten Objekts laege dann ueber der
		// Form des ersten, und zwei benachbarte Abschnitte desselben Flusses beruehren sich
		// naturgemaess. In EINER Pane entscheidet die Einfuegereihenfolge, also gehoeren ALLE Hoefe
		// vor ALLE Formen.
		var unsere = [];
		liste.forEach(function (objekt) {
			avesmapsGaretienUnsereIds(objekt).forEach(function (publicId) {
				var punkte = avesmapsGaretienNachLeaflet(garetienAbschnittsPunkte(objekt, publicId));
				if (punkte.length === 0) { garetienGeometrieFehlt(objekt, publicId); return; }
				unsere.push({
					punkte: punkte,
					// Der Schluessel reist mit, damit ein Klick auf die Form sagen kann, WELCHES
					// Objekt getroffen wurde. Ihre und unsere Form tragen denselben -- es ist
					// dasselbe Stueck, nur zweimal gezeichnet.
					schluessel: objekt && objekt.key,
					titel: garetienTitelUnsere(objekt, publicId),
					// 🔴 Eine Flaeche nur dann als Flaeche, wenn ihre Gestalt das hergibt -- siehe
					// garetienFlaecheZeichenbar (verschachtelt: immer; flach: nur als echter Ring).
					flaeche: garetienIstFlaeche(objekt) && garetienFlaecheZeichenbar(punkte),
					// Aufgabe 4 (Entwurf §4.2): kollidiert das GANZE Objekt, glueht auch UNSER Hof rot.
					kollidiert: avesmapsGaretienKollidiert(objekt),
					// 30.08.2026: „das Design dessen, was es werden wird" -- beide Werte haengen am
					// ZIEL (`objekt`), nicht an der Partei, siehe garetienFlaechenDeckkraft /
					// garetienPunktDurchmesser.
					deckkraft: garetienFlaechenDeckkraft(objekt),
					durchmesser: garetienPunktDurchmesser(objekt, k),
				});
			});
		});

		// 🔴 Der Hof ist IMMER ein Strich, auch unter einer Flaeche: eine gefuellte Flaeche zu 55 %
		// ueberdeckte einen See vollstaendig -- man saehe die Hervorhebung, aber nicht mehr, was
		// hervorgehoben ist.
		unsere.forEach(function (eintrag) {
			var hof = garetienForm(l, eintrag.punkte, {
				pane: AVESMAPS_GARETIEN_UNSERE_PANE,
				klasse: garetienHofKlasse(AVESMAPS_GARETIEN_KLASSE_SCHEIN, eintrag.kollidiert),
				farbe: farbeUnsere,
				breite: AVESMAPS_GARETIEN_SCHEIN_BREITE,
				deckkraft: AVESMAPS_GARETIEN_SCHEIN_DECKKRAFT,
				flaeche: false,
				strichelung: null,
				titel: eintrag.titel,
				schluessel: eintrag.schluessel,
				// Derselbe Durchmesser wie die Form (siehe garetienForm) -- sonst liegt der Schein
				// eines Punktobjekts neben statt um seinen Ring.
				durchmesser: eintrag.durchmesser,
			});
			if (hof) { gruppe.addLayer(hof); }
		});

		// 🔴 UNSERE FORM: dieselbe Gestalt wie ihre, aber MAGENTA und DURCHGEZOGEN.
		unsere.forEach(function (eintrag) {
			var form = garetienForm(l, eintrag.punkte, {
				pane: AVESMAPS_GARETIEN_UNSERE_PANE,
				klasse: AVESMAPS_GARETIEN_KLASSE_UNSERE,
				farbe: farbeUnsere,
				breite: AVESMAPS_GARETIEN_STRICH_BREITE,
				deckkraft: 1,
				flaeche: eintrag.flaeche,
				strichelung: null,
				titel: eintrag.titel,
				schluessel: eintrag.schluessel,
				durchmesser: eintrag.durchmesser,
				fuellwert: eintrag.deckkraft,
			});
			if (form) { gruppe.addLayer(form); }
		});

		// 🔴 IHRE SEITE SAMMELT GENAUSO (RULING R8, task-3-nachtrag.md §1): der Hof des naechsten
		// Objekts darf nicht ueber die Form des vorigen geraten, deshalb ALLE ihre Hoefe vor ALLEN
		// ihren Formen -- derselbe Grund wie oben bei „unsere".
		var ihre = [];
		liste.forEach(function (objekt) {
			var punkte = avesmapsGaretienNachLeaflet((objekt || {}).geometrie);
			if (punkte.length === 0) { garetienGeometrieFehlt(objekt, null); return; }
			var sicht = avesmapsGaretienSichtFuer(objekt);
			var farbe = garetienTokenFarbe(sicht.token);
			// 🔴 Fix-Runde 1 zu Aufgabe 3: ein Tokenname, der in tokens.css nicht existiert, darf
			// nicht lautlos zu einer unsichtbaren Form fuehren -- siehe garetienSichtTokenFehlt.
			// 🔧 Fix-Runde 2: `!sicht.neutral` deckt STRUKTURELL beide nicht-neutralen Zweige ab --
			// den dynamisch aus `subtyp`/`kind` hergeleiteten TOKEN ebenso wie einen Treffer in
			// AVESMAPS_GARETIEN_SICHT_EBENE. Dass der Riegel in der PRAXIS heute nur den ersten
			// je auslöst, liegt nicht an dieser Bedingung, sondern daran, dass jeder Tafel-Token
			// vorab gegen tokens.css geprueft ist (garetien-sicht-tafel.test.js Abschnitt 5) -- ein
			// kaputter Tafel-Eintrag wuerde denselben Riegel genauso treffen.
			if (farbe === "" && !sicht.neutral) {
				garetienSichtTokenFehlt(objekt, sicht.token);
				sicht = AVESMAPS_GARETIEN_SICHT_NEUTRAL;
				farbe = farbeIhre;
			}
			ihre.push({
				punkte: punkte,
				schluessel: objekt && objekt.key,
				titel: garetienTitelIhre(objekt),
				flaeche: sicht.form === "flaeche",
				farbe: farbe,
				breite: sicht.breite,
				// Aufgabe 4 (Entwurf §4.2): kollidiert das GANZE Objekt, glueht auch IHR Hof rot.
				kollidiert: avesmapsGaretienKollidiert(objekt),
				// Owner 30.08.2026: die GEWAEHLTE Zeile zeichnet durchgehend statt gestrichelt.
				gewaehlt: objekt && objekt[AVESMAPS_GARETIEN_FELD_GEWAEHLT] === true,
				// Die vom Editor gewaehlte Stroemungsrichtung -- nur ein Flussweg traegt sie
				// (der Importer stempelt sie nur dort an).
				flowDir: objekt ? objekt[AVESMAPS_GARETIEN_FELD_FLOW] : null,
				// Die vom Editor gewaehlte Endkreuzungs-Option -- nur ein Weg traegt sie (der Importer
				// stempelt sie nur dort an). Die Groesse reist mit, damit garetienEndkreuzungsRinge
				// ohne Karte pruefbar bleibt.
				endkreuzungen: objekt ? objekt[AVESMAPS_GARETIEN_FELD_ENDKREUZUNGEN] === true : false,
				kreuzungGroesse: garetienKreuzungDurchmesser(k),
				// 30.08.2026: dasselbe Ziel wie bei „unsere" -- die Werte haengen NICHT von `sicht`
				// ab (die kennt nur Form/Farbe/Breite), sondern direkt vom Objekt.
				deckkraft: garetienFlaechenDeckkraft(objekt),
				durchmesser: garetienPunktDurchmesser(objekt, k),
			});
		});

		// 🔴 IHR HOF: GOLD, NEU seit RULING R8. Die Form darueber traegt seither ihre ECHTE
		// Kartenfarbe (Sicht-Tafel) statt immer Gold -- der Hof haelt die Herkunft trotzdem lesbar:
		// „das ist ihr Vorschlag" bleibt sichtbar, auch wenn die Form selbst nicht mehr golden ist.
		// Wie bei „unsere" IMMER ein Strich, auch unter einer Flaeche.
		ihre.forEach(function (eintrag) {
			var hof = garetienForm(l, eintrag.punkte, {
				pane: AVESMAPS_GARETIEN_IHRE_PANE,
				klasse: garetienHofKlasse(AVESMAPS_GARETIEN_KLASSE_SCHEIN_IHRE, eintrag.kollidiert),
				farbe: farbeIhre,
				breite: AVESMAPS_GARETIEN_SCHEIN_BREITE,
				deckkraft: AVESMAPS_GARETIEN_SCHEIN_DECKKRAFT,
				flaeche: false,
				strichelung: null,
				titel: eintrag.titel,
				schluessel: eintrag.schluessel,
				// Derselbe Durchmesser wie die Form -- siehe der Kommentar bei „unsere" oben.
				durchmesser: eintrag.durchmesser,
			});
			if (hof) { gruppe.addLayer(hof); }
		});

		// 🔴 IHRE FORM: die ECHTE Kartenform, -farbe und -breite aus der Sicht-Tafel (Entwurf §4.1).
		// Die Strichelung BLEIBT -- sie haengt an der Kante, nicht an der Farbe, und sagt weiterhin
		// „das ist ihre Fassung, sie steht noch nicht bei uns"; ein Ring traegt sie deshalb genauso
		// wie eine Linie.
		//
		// 🔴 MIT GENAU EINER AUSNAHME (Owner 30.08.2026): die gerade GEWAEHLTE Zeile zeichnet
		// DURCHGEHEND. Auf einer Karte voller gestrichelter Importe war nicht zu sehen, welche
		// Flaeche zu der Zeile gehoert, die man gerade offen hat -- und genau das Vergleichen ist
		// der Zweck dieses Fensters.
		// ⚠️ Die Aussage der Strichelung geht dabei NICHT verloren: sie tritt fuer EIN Objekt
		// zurueck, und zwar fuer das, dessen Einzelansicht daneben aufgeschlagen ist und in Worten
		// sagt, was es ist. Die Farbe (ihre Partei) bleibt unberuehrt -- sie ist die Aussage, die
		// nie zurueckstehen darf.
		ihre.forEach(function (eintrag) {
			var form = garetienForm(l, eintrag.punkte, {
				pane: AVESMAPS_GARETIEN_IHRE_PANE,
				klasse: AVESMAPS_GARETIEN_KLASSE_IHRE,
				farbe: eintrag.farbe,
				breite: eintrag.breite,
				deckkraft: 1,
				flaeche: eintrag.flaeche,
				strichelung: eintrag.gewaehlt ? null : AVESMAPS_GARETIEN_STRICHELUNG,
				titel: eintrag.titel,
				schluessel: eintrag.schluessel,
				durchmesser: eintrag.durchmesser,
				fuellwert: eintrag.deckkraft,
			});
			if (form) { gruppe.addLayer(form); }
		});

		// 🔴 DIE STRÖMUNGSDREIECKE -- zuletzt, damit sie über der Linie liegen, der sie gehören
		// (Owner 02.09.2026: „die richtung anzeigen (dreieckchen in der farbe des import-flusses)").
		ihre.forEach(function (eintrag) {
			garetienStroemungsdreiecke(l, eintrag, farbeIhre).forEach(function (marke) {
				gruppe.addLayer(marke);
			});
		});

		// 🔴 UND DIE ENDKREUZUNGS-RAHMEN ganz zuletzt (Owner 04.09.2026). Sie liegen auf den zwei
		// Enden der Linie, also genau dort, wo ihr Strich am dichtesten ist -- unter der Linie waeren
		// sie halb verdeckt, und ein halber Ring liest sich nicht als Kreuzung.
		// ⚠️ Die Dreiecke sitzen bewusst NIE auf dem ersten oder letzten Stuetzpunkt (siehe dort);
		// die zwei Marken kollidieren also nicht.
		ihre.forEach(function (eintrag) {
			garetienEndkreuzungsRinge(l, eintrag, farbeIhre).forEach(function (marke) {
				gruppe.addLayer(marke);
			});
		});

		return gruppe;
	}

	/*
	 * Die Strömungsdreiecke EINES importierten Flusses.
	 *
	 * 🔴 SIE ZEIGEN DIE WAHL, NICHT DIE QUELLE. Der Editor entscheidet die Richtung im Kasten
	 * „Eingefügt wird"; hier wird sie sichtbar, bevor irgendetwas angelegt ist. Deshalb hängen sie
	 * an `eintrag.flowDir` (vom Importer gereicht) und nicht an einer Eigenschaft des Objekts.
	 *
	 * 🔴 IN DER FARBE DES IMPORT-FLUSSES, nicht in der unseren -- sie gehören zu IHRER Linie. Das
	 * ist derselbe Grund, aus dem dieses Modul überhaupt zwei Farben führt.
	 *
	 * 💣 DOM-MARKEN, KEIN CANVAS. Die Karte hat schon einen Pfeil-Canvas
	 * (map-features-river-flow-arrows.js), aber der zeichnet ANGELEGTE Flüsse aus `pathData` -- ein
	 * Import ist dort nicht drin. Ihn dafür zu erweitern hieße, ihm eine zweite Datenquelle und
	 * einen zweiten Lebenszyklus zu geben; eine Handvoll `divIcon`-Marken in der ohnehin
	 * vorhandenen Gruppe verschwindet dagegen mit `clearLayers()` wie alles andere hier.
	 *
	 * ⚠️ FESTE BILDSCHIRMGRÖSSE, deshalb Marken und keine Polygone: ein Dreieck aus Kartenpunkten
	 * wüchse beim Zoomen mit und wäre bei Zoom 6 so groß wie eine Baronie.
	 */
	var AVESMAPS_GARETIEN_DREIECK_ANZAHL = 3;
	var AVESMAPS_GARETIEN_KLASSE_DREIECK = "gi-map-flow";

	function garetienStroemungsdreiecke(l, eintrag, farbe) {
		if (!eintrag || eintrag.flowDir !== "forward" && eintrag.flowDir !== "reverse") { return []; }
		if (typeof l.marker !== "function" || typeof l.divIcon !== "function") { return []; }
		var punkte = eintrag.punkte || [];
		if (!garetienIstPunktliste(punkte) || punkte.length < 2) { return []; }

		// ⚠️ Bei „reverse" wird die LISTE gedreht, nicht der Winkel um 180° geschoben: so ist die
		// Rechnung darunter für beide Richtungen dieselbe, und es gibt keinen zweiten Zweig, der
		// beim nächsten Umbau vergessen wird.
		var lauf = eintrag.flowDir === "reverse" ? punkte.slice().reverse() : punkte;
		var marken = [];
		for (var i = 1; i <= AVESMAPS_GARETIEN_DREIECK_ANZAHL; i++) {
			// Gleichmäßig über die Stützpunkte, nie auf dem ersten oder letzten: dort liegt die
			// Endkreuzung, und ein Dreieck darauf sähe aus wie ein Teil von ihr.
			var stelle = Math.round(lauf.length * i / (AVESMAPS_GARETIEN_DREIECK_ANZAHL + 1));
			if (stelle < 1 || stelle >= lauf.length) { continue; }
			var a = lauf[stelle - 1];
			var b = lauf[stelle];
			if (!a || !b) { continue; }
			// 💣 `atan2(dx, dy)` MIT VERTAUSCHTEN ARGUMENTEN, damit 0° nach Norden zeigt und im
			// Uhrzeigersinn gezählt wird wie bei CSS `rotate()`. Mit der Schulform zeigt jeder
			// Pfeil an der Diagonale gespiegelt -- und bei genau N/O/S/W fällt das NICHT auf.
			// Dieselbe Falle wie beim Peil-Pfeilchen in „Was ist hier?" (AGENTS.md §11).
			var dx = b[1] - a[1];
			var dy = b[0] - a[0];
			if (dx === 0 && dy === 0) { continue; }
			var winkel = Math.atan2(dx, dy) * 180 / Math.PI;
			marken.push(l.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], {
				pane: AVESMAPS_GARETIEN_IHRE_PANE,
				interactive: false,
				keyboard: false,
				icon: l.divIcon({
					className: AVESMAPS_GARETIEN_KLASSE_DREIECK,
					iconSize: [12, 12],
					iconAnchor: [6, 6],
					// ⚠️ Die Farbe steht am ELEMENT, nicht in der CSS-Regel: sie kommt aus dem Token
					// des Import-Flusses und wechselt mit dem Thema (garetienTokenFarbe liest sie
					// bei jedem Zeichnen neu).
					html: '<span style="transform:rotate(' + winkel.toFixed(1) + 'deg);'
						+ "border-bottom-color:" + farbe + '"></span>',
				}),
			}));
		}

		return marken;
	}

	/*
	 * DIE ENDKREUZUNGS-RAHMEN — was das Haekchen „Kreuzung an Anfang und Ende" auf der Karte
	 * verspricht, BEVOR etwas angelegt ist.
	 *
	 * Owner 04.09.2026: „es waere praktisch wenn man in der voransicht (beim anklicken und in
	 * 'anzeigen') sehen koennte (mit gelben rahmen), wenn die option aktiviert ist."
	 *
	 * 🔴 SIE ZEIGEN DIE WAHL, NICHT DIE DATEN — genau wie die Stroemungsdreiecke darueber. Der
	 * Editor entscheidet im Kasten „Eingefuegt wird"; hier wird die Entscheidung sichtbar. Deshalb
	 * haengen sie an `eintrag.endkreuzungen` (vom Importer gestempelt) und an keiner Eigenschaft
	 * des Objekts.
	 * 🔴 IN DER FARBE DES IMPORTS (Gold), weil sie zu IHRER Linie gehoeren -- derselbe Grund, aus
	 * dem dieses Modul ueberhaupt zwei Farben fuehrt.
	 * 🔴 EIN HOHLER RING, kein gefuellter Punkt: die echte Kreuzung ist gefuellt
	 * (getLocationMarkerBorderWidth gibt fuer sie 0 zurueck), aber hier liegt sie auf IHRER
	 * gestrichelten Linie, und ein gefuellter Punkt verdeckte genau das Ende, das er markiert.
	 * ⚠️ FESTE BILDSCHIRMGROESSE, deshalb Marken und keine `circleMarker`: derselbe Grund wie bei
	 * den Dreiecken -- ein Ring aus Kartenpunkten wuechse beim Zoomen mit.
	 */
	var AVESMAPS_GARETIEN_KLASSE_ENDKREUZUNG = "gi-map-endkreuzung";
	// 💣 GEKOPPELTER WERT IN ZWEI DATEIEN, wie AVESMAPS_GARETIEN_FELD_FLOW und ...FELD_GEWAEHLT
	// darueber -- gesetzt in review-garetien-importer.js, gelesen hier. Liefe der Name auseinander,
	// stempelte das Fenster, was der Zeichner nie liest, und zwar STILL. Zusammengehalten von
	// js/review/__tests__/garetien-endkreuzung-stroemung.test.js.
	var AVESMAPS_GARETIEN_FELD_ENDKREUZUNGEN = "endkreuzungen";
	// Nur der Rueckfall, wenn die Kartenregel nicht erreichbar ist (der Zeichner laeuft im Test
	// allein, und die Editorseiten laden `map-features-location-marker-rendering.js` nicht). Er
	// entspricht dem, was getLocationMarkerSize fuer eine Kreuzung bei Zoom 4 liefert (5 + 4*1,5).
	var AVESMAPS_GARETIEN_KREUZUNG_RUECKFALL = 11;
	/*
	 * 💣 DIE UNTERGRENZE, UND SIE IST GERECHNET, NICHT GESCHMACK. Eine echte Kreuzung misst bei
	 * Zoom 3 und darunter 5 px (getLocationMarkerSize: `visualZoomLevel <= 3 ? 5 : ...`), und der
	 * Rahmen ist 2 px stark -- von 5 px bleiben INNEN 1 px uebrig. Das ist kein Ring mehr,
	 * sondern ein Punkt, und damit sagt er genau das nicht mehr, wofuer er da ist.
	 * 🔴 Und es ist kein Randfall: AVESMAPS_DEFAULT_MAP_ZOOM ist 3 (am Telefon 2) -- die
	 * Startansicht der Karte ist genau die, in der er verschwaende.
	 * ⚠️ Der Preis ist benannt: unterhalb von 9 px ist der Rahmen GROESSER als die Kreuzung, die
	 * daraus wird. Das ist die bewusste Abweichung von „so gross wie eine echte Kreuzung" -- ein
	 * Rahmen, den man nicht als Rahmen erkennt, erfuellt seinen Zweck gar nicht, und die Groesse
	 * einer Kreuzung bei Zoom 3 ist ohnehin keine Aussage, sondern eine Untergrenze der
	 * Kartenlesbarkeit (dieselbe `Math.max`-Bauform steht in getLocationMarkerSize selbst).
	 * 9 px mit 2 px Rahmen lassen 5 px Loch -- die kleinste Groesse, bei der die Linie darunter
	 * noch durchscheint.
	 */
	var AVESMAPS_GARETIEN_KREUZUNG_MINDEST = 9;

	/*
	 * WO Kreuzungen entstehen wuerden. REIN.
	 *
	 * 💣 EIN GESCHLOSSENER WEG BEKOMMT NUR EINE, und das ist keine Kosmetik: der Server legt an
	 * einem Ring genau EINEN Knoten an (`avesmapsGaretienEndkreuzungenAnlegen`,
	 * api/_internal/import/garetien-uebernahme.php -- „zwei Kreuzungen auf demselben Punkt waeren
	 * eine Dublette, die niemand mehr auseinanderhaelt"). Zwei Rahmen waeren hier eine Behauptung
	 * ueber ein Objekt, das es nachher nicht gibt.
	 *
	 * 💣 UND DIE REGEL IST EINE RUNDUNG, KEINE TOLERANZ. Der Server vergleicht `round($v, 5)`;
	 * `10.000004` und `10.000006` liegen 2e-6 auseinander -- unter jeder 5e-6-Schwelle -- runden
	 * aber auf verschiedene Werte und sind damit ZWEI Enden. Wer hier einen Abstand einsetzt, weil
	 * das „robuster" aussieht, faellt an genau diesen Zahlen auseinander (AGENTS.md §11: eine
	 * Rundung ist keine Toleranz).
	 *
	 * ⚠️ Gerundet werden BEIDE Achsen. Hier liegen die Punkte als Leaflet-[lat, lng] und beim
	 * Server als GeoJSON-[x, y] -- die Reihenfolge ist getauscht, das Urteil „beide Achsen gleich"
	 * ist davon unberuehrt.
	 */
	function garetienEndkreuzungsStellen(punkte) {
		if (!garetienIstPunktliste(punkte)) { return []; }
		var n = punkte.length;
		if (n < 2) { return []; }
		var a = punkte[0];
		var b = punkte[n - 1];
		if (!a || !b) { return []; }
		if (garetienAuf5Gerundet(a[0]) === garetienAuf5Gerundet(b[0])
			&& garetienAuf5Gerundet(a[1]) === garetienAuf5Gerundet(b[1])) {
			return [a];
		}
		return [a, b];
	}

	function garetienAuf5Gerundet(wert) {
		return Math.round(Number(wert) * 100000) / 100000;
	}

	/*
	 * Der Durchmesser eines Rahmens -- die Groesse, die eine ECHTE Kreuzung bei dieser Zoomstufe
	 * haette (Owner-Wahl 04.09.2026: „Ring wie eine echte Kreuzung").
	 *
	 * 🔴 DIE REGEL WIRD GERUFEN, NICHT ABGESCHRIEBEN. `getLocationMarkerSize` fuehrt fuer eine
	 * Kreuzung eine eigene Kurve (kein Zoomband -- sie erscheinen ueber ihren eigenen Haken, ohne
	 * Zoomuntergrenze); sie hier ein zweites Mal hinzuschreiben waere die Divergenz mit Anlauf,
	 * gegen die AGENTS.md §12 und die Zoombaender geschrieben sind. Dieselbe Bauform wie
	 * garetienPunktDurchmesser daneben, das die Zoomband-Tafel ruft.
	 * ⚠️ Defensiv, weil dieser Zeichner im Test allein laeuft und auf den Editorseiten kein
	 * `map-features-location-marker-rendering.js` liegt.
	 */
	function garetienKreuzungDurchmesser(karte) {
		if (typeof getLocationMarkerSize !== "function"
			|| typeof CROSSING_LOCATION_TYPE === "undefined") {
			return AVESMAPS_GARETIEN_KREUZUNG_RUECKFALL;
		}
		var zoom = (karte && typeof karte.getZoom === "function") ? Number(karte.getZoom()) : NaN;
		if (!isFinite(zoom)) { return AVESMAPS_GARETIEN_KREUZUNG_RUECKFALL; }
		var wert = getLocationMarkerSize(CROSSING_LOCATION_TYPE, zoom);
		return (typeof wert === "number" && isFinite(wert) && wert > 0)
			? wert
			: AVESMAPS_GARETIEN_KREUZUNG_RUECKFALL;
	}

	/*
	 * Die Rahmen EINES importierten Weges.
	 *
	 * ⚠️ Die Groesse reist am `eintrag` mit, statt hier gerechnet zu werden: so bleibt diese
	 * Funktion ohne Karte pruefbar -- dieselbe Trennung wie bei `durchmesser` und `deckkraft`.
	 */
	function garetienEndkreuzungsRinge(l, eintrag, farbe) {
		if (!eintrag || eintrag[AVESMAPS_GARETIEN_FELD_ENDKREUZUNGEN] !== true) { return []; }
		if (!l || typeof l.marker !== "function" || typeof l.divIcon !== "function") { return []; }
		var stellen = garetienEndkreuzungsStellen(eintrag.punkte || []);
		if (stellen.length === 0) { return []; }
		var gemessen = (typeof eintrag.kreuzungGroesse === "number" && eintrag.kreuzungGroesse > 0)
			? eintrag.kreuzungGroesse
			: AVESMAPS_GARETIEN_KREUZUNG_RUECKFALL;
		// 💣 Die Untergrenze steht HIER und nicht in garetienKreuzungDurchmesser: jene Funktion
		// beantwortet „wie gross waere die Kreuzung", diese „wie gross zeichne ich den Rahmen".
		// Zusammengelegt liesse sich nicht mehr sagen, welche der beiden Zahlen gemeint ist.
		var groesse = Math.max(AVESMAPS_GARETIEN_KREUZUNG_MINDEST, gemessen);
		var halb = groesse / 2;

		return stellen.map(function (stelle) {
			return l.marker(stelle, {
				pane: AVESMAPS_GARETIEN_IHRE_PANE,
				// ⚠️ Wie das Dreieck: der Klick gehoert dem Objekt darunter, nicht seiner Marke.
				interactive: false,
				keyboard: false,
				icon: l.divIcon({
					className: AVESMAPS_GARETIEN_KLASSE_ENDKREUZUNG,
					iconSize: [groesse, groesse],
					// 💣 DER ANKER IST DIE MITTE. Leaflets Vorgabe ist die linke obere Ecke; ohne
					// diese Zeile haengt der Ring um einen halben Durchmesser versetzt am
					// Endpunkt -- und bei 11 px faellt das genau so wenig auf, wie es falsch ist.
					iconAnchor: [halb, halb],
					// ⚠️ Farbe und Groesse stehen am ELEMENT, nicht in der CSS-Regel: die Farbe
					// kommt aus dem Token (wechselt mit dem Thema), die Groesse aus der
					// Kreuzungsregel (wechselt mit dem Zoom).
					// ⭐ `color`, nicht `border-color`: das Blatt liest daraus BEIDES, Rahmen und
					// Schein (`currentColor`) -- eine zweite Farbdeklaration waere eine zweite Stelle,
					// an der ein Themenwechsel haengenbleiben kann.
					html: '<span style="width:' + groesse + "px;height:" + groesse + "px;"
						+ "color:" + farbe + '"></span>',
				}),
			});
		});
	}
	/*
	 * „✦ Zentrieren" — die Ansicht fliegt auf ihr Objekt.
	 *
	 * 🔴 UND DAS OBJEKT LEUCHTET DABEI, ohne dass hier etwas dafuer getan wird: seit dem 29.08.2026
	 * zeichnet `avesmapsGaretienAufDerKarte` (review-garetien-importer.js) das ANGEKLICKTE Objekt
	 * mit, und die Einzelansicht — in der dieser Knopf steht — ist nur offen, wenn es angeklickt ist.
	 * Ein zweiter Zeichenbefehl hier waere die zweite Regel darueber, was auf der Karte liegt.
	 * ⚠️ Angeflogen wird IHRE Geometrie, nicht zusaetzlich unsere getroffenen Abschnitte: der Knopf
	 * steht in der Ansicht ihres Objekts, und ein Kasten, der die Haekchen mitliest, veraenderte den
	 * Bildausschnitt beim Anhaken.
	 * 🪤 MESSFALLE: in der Browser-Flaeche wirft JEDER Leaflet-Flug NaN — ein Artefakt der Flaeche,
	 * kein Fehler hier. Die Kontrollprobe ist `fitBounds` an derselben Stelle; im echten Browser
	 * fliegt es.
	 */
	function avesmapsGaretienKarteFliegen(objekt, karte) {
		var k = garetienKarte(karte);
		var l = garetienLeaflet();
		if (!k || !l || typeof l.latLngBounds !== "function") { return null; }
		var punkte = avesmapsGaretienNachLeaflet((objekt || {}).geometrie);
		if (punkte.length === 0) { garetienGeometrieFehlt(objekt, null); return null; }
		return garetienFliegenAuf(k, l, punkte);
	}

	/*
	 * „Alle zentrieren" (Owner 30.08.2026) — die Ansicht zoomt auf ALLE uebergebenen Objekte
	 * zusammen, also auf den gemeinsamen Kasten der Anzeige-Menge.
	 *
	 * 🔴 EIN KASTEN AUS ALLEN PUNKTEN, kein gerechneter Mittelpunkt mit geratener Zoomstufe:
	 * `fitBounds` bestimmt beides selbst und trifft auch den Fall, in dem die Objekte sehr
	 * ungleich verteilt liegen (ein Ausreisser weit im Norden zoege einen Mittelpunkt dorthin,
	 * waehrend der Kasten einfach groesser wird).
	 * ⚠️ Objekte OHNE Geometrie werden ueberSPRUNGEN, nicht gemeldet: bei einem Einzelflug ist eine
	 * fehlende Geometrie ein Befund (der Knopf taete sonst nichts), hier ist sie einer von vielen --
	 * eine Warnung je Objekt waere bei 300 Zeilen eine Wand aus Meldungen.
	 * 🔴 Ohne einen einzigen Punkt wird NICHT geflogen und `null` zurueckgegeben: eine Karte auf
	 * einen leeren Kasten zu zwingen, springt in Leaflet an eine unbestimmte Stelle.
	 */
	function avesmapsGaretienKarteAlleZentrieren(objekte, karte) {
		var k = garetienKarte(karte);
		var l = garetienLeaflet();
		if (!k || !l || typeof l.latLngBounds !== "function") { return null; }
		var alle = [];
		(objekte || []).forEach(function (objekt) {
			var punkte = avesmapsGaretienNachLeaflet((objekt || {}).geometrie);
			for (var i = 0; i < punkte.length; i++) { alle.push(punkte[i]); }
		});
		if (alle.length === 0) { return null; }
		return garetienFliegenAuf(k, l, alle);
	}

	// Der gemeinsame Schluss beider Fluege -- dieselbe Polsterung, dieselbe Vorliebe fuer
	// `flyToBounds`. 🪤 In der Browser-Flaeche wirft JEDER Leaflet-Flug NaN (Artefakt der Flaeche,
	// kein Fehler hier); `fitBounds` an derselben Stelle ist die Kontrollprobe.
	function garetienFliegenAuf(k, l, punkte) {
		var kasten = l.latLngBounds(punkte);
		var optionen = { padding: [40, 40] };
		if (typeof k.flyToBounds === "function") { k.flyToBounds(kasten, optionen); }
		else if (typeof k.fitBounds === "function") { k.fitBounds(kasten, optionen); }
		return kasten;
	}

	// ---- Die zwei Sicht-Knoepfe -------------------------------------------------------------------

	function garetienPaneSichtbar(karte, name) {
		var pane = (karte && typeof karte.getPane === "function") ? karte.getPane(name) : null;
		return !(pane && pane.style && pane.style.display === "none");
	}

	/*
	 * Was liegt gerade auf der Karte? — DER ZUSTAND WIRD GELESEN, NICHT GEFUEHRT.
	 *
	 * 🔴 Die Auskunft kommt aus dem `display` der zwei Panes und aus sonst nichts. Ein Modulzustand
	 * daneben waere die zweite Wahrheit, an der im Haus schon das Anzeige-Menue der Karte und die
	 * Ansichts-Kacheln gescheitert sind.
	 * ⚠️ Ohne Karte und vor dem ersten Zeichnen gibt es keine Pane — dann sind beide Parteien
	 * sichtbar, und das ist der Startzustand, den der Owner verlangt hat („Beide starten AN").
	 */
	function avesmapsGaretienKarteSicht(karte) {
		var k = garetienKarte(karte);
		return {
			ihre: k === null ? true : garetienPaneSichtbar(k, AVESMAPS_GARETIEN_IHRE_PANE),
			unsere: k === null ? true : garetienPaneSichtbar(k, AVESMAPS_GARETIEN_UNSERE_PANE),
		};
	}

	/*
	 * Eine Partei ein- oder ausblenden.
	 *
	 * 💣 EIN UNBEKANNTER NAME SCHALTET NICHTS. Ohne diesen Riegel blendete ein Tippfehler im
	 * `data-sicht`-Attribut die falsche Partei aus, und der Knopf saehe dabei richtig aus.
	 * ⚠️ Zurueckgegeben wird der GEMESSENE Zustand, nicht der erwartete: der Knopf beschriftet sich
	 * daraus, und ohne Karte (Editorseiten) hat er dann nichts umgeschaltet und behauptet es auch
	 * nicht.
	 */
	function avesmapsGaretienKarteUmschalten(seite, karte) {
		var k = garetienKarte(karte);
		var name = null;
		var z = 0;
		if (seite === "ihre") {
			name = AVESMAPS_GARETIEN_IHRE_PANE;
			z = AVESMAPS_GARETIEN_IHRE_PANE_Z;
		}
		if (seite === "unsere") {
			name = AVESMAPS_GARETIEN_UNSERE_PANE;
			z = AVESMAPS_GARETIEN_UNSERE_PANE_Z;
		}
		if (k === null || name === null) { return avesmapsGaretienKarteSicht(k); }
		var pane = garetienPaneSicherstellen(k, name, z);
		if (pane) { pane.style.display = pane.style.display === "none" ? "" : "none"; }
		return avesmapsGaretienKarteSicht(k);
	}

	/*
	 * Alles weg — das Fenster ist zu.
	 *
	 * 💣 Ein zurueckgelassener Strich auf der oeffentlichen Karte waere der schlimmste Ausfall
	 * dieser Aufgabe: der Besucher saehe farbige Striche ohne jede Erklaerung.
	 * 💣 UND DIE SICHT WIRD ZURUECKGESETZT. Ohne das bliebe eine ausgeblendete Partei ueber das
	 * Schliessen hinaus versteckt — beim naechsten Oeffnen zeigte die Karte nur eine Farbe, die
	 * Knoepfe saehen richtig aus, und niemand haette einen Anhaltspunkt. „Beide starten AN" ist eine
	 * Owner-Vorgabe und muss deshalb an der Stelle stehen, an der eine Sitzung endet.
	 * ⚠️ Die Panes bleiben stehen, und das ist richtig: ein leeres <div> zeichnet nichts, Leaflet hat
	 * kein oeffentliches `removePane`, und ein spaeteres `createPane` legte ohnehin ein neues an
	 * (siehe oben). Sauber heisst „keine Geometrie mehr", nicht „kein Knoten mehr".
	 */
	function avesmapsGaretienKarteAus(karte) {
		var k = garetienKarte(karte);
		if (k !== null && typeof k.getPane === "function") {
			[AVESMAPS_GARETIEN_IHRE_PANE, AVESMAPS_GARETIEN_UNSERE_PANE].forEach(function (name) {
				var pane = k.getPane(name);
				if (pane && pane.style) { pane.style.display = ""; }
			});
		}
		if (gruppe !== null) {
			if (typeof gruppe.clearLayers === "function") { gruppe.clearLayers(); }
			if (typeof gruppe.remove === "function") { gruppe.remove(); }
			gruppe = null;
		}
		return null;
	}

	if (typeof window !== "undefined") {
		// 🔴 Namen im globalen Raum, so wie das Fenster sie sucht (`typeof … === "function"`).
		// Kein Sammelobjekt: review-garetien-importer.js fragt jeden einzeln ab und bleibt damit
		// ohne diese Datei lauffaehig — der Importer laeuft auch auf Seiten ohne Karte.
		window.avesmapsGaretienKarteZeigen = avesmapsGaretienKarteZeigen;
		window.AVESMAPS_GARETIEN_HAKEN_KLICK = AVESMAPS_GARETIEN_HAKEN_KLICK;
		window.avesmapsGaretienKarteFliegen = avesmapsGaretienKarteFliegen;
		window.avesmapsGaretienKarteAlleZentrieren = avesmapsGaretienKarteAlleZentrieren;
		window.avesmapsGaretienKarteAus = avesmapsGaretienKarteAus;
		window.avesmapsGaretienKarteSicht = avesmapsGaretienKarteSicht;
		window.avesmapsGaretienKarteUmschalten = avesmapsGaretienKarteUmschalten;
		window.avesmapsGaretienUnsereIds = avesmapsGaretienUnsereIds;
		// Aufgabe 3: die Sicht-Tafel -- review-garetien-importer.js liest sie fuer die
		// Neutral-Meldung der Bilanzzeile (Schritt 5), ohne diese Datei vorauszusetzen.
		window.avesmapsGaretienSichtFuer = avesmapsGaretienSichtFuer;
		// Aufgabe 4: kollidiert das Objekt mit unserem Bestand? (Entwurf §4.2)
		window.avesmapsGaretienKollidiert = avesmapsGaretienKollidiert;
		// 04.09.2026: der Feldname der Endkreuzungs-Marke -- review-garetien-importer.js stempelt
		// damit, ohne diese Datei vorauszusetzen (das Fenster laeuft auch auf Seiten ohne Karte).
		window.AVESMAPS_GARETIEN_FELD_ENDKREUZUNGEN = AVESMAPS_GARETIEN_FELD_ENDKREUZUNGEN;
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = {
			avesmapsGaretienNachLeaflet,
			avesmapsGaretienUnsereIds,
			garetienAbschnittsPunkte,
			garetienIstFlaeche,
			garetienRingSchliesst,
			garetienTitelIhre,
			garetienTitelUnsere,
			garetienStroemungsdreiecke,
			AVESMAPS_GARETIEN_FELD_FLOW,
			avesmapsGaretienKarteZeigen,
			AVESMAPS_GARETIEN_HAKEN_KLICK,
			avesmapsGaretienKarteFliegen,
			avesmapsGaretienKarteAlleZentrieren,
			avesmapsGaretienKarteSicht,
			avesmapsGaretienKarteUmschalten,
			avesmapsGaretienKarteAus,
			AVESMAPS_GARETIEN_IHRE_PANE,
			AVESMAPS_GARETIEN_IHRE_PANE_Z,
			AVESMAPS_GARETIEN_UNSERE_PANE,
			AVESMAPS_GARETIEN_UNSERE_PANE_Z,
			AVESMAPS_GARETIEN_KLASSE_IHRE,
			AVESMAPS_GARETIEN_KLASSE_UNSERE,
			AVESMAPS_GARETIEN_KLASSE_SCHEIN,
			AVESMAPS_GARETIEN_KLASSE_SCHEIN_IHRE,
			AVESMAPS_GARETIEN_PARTEI_IHRE,
			AVESMAPS_GARETIEN_PARTEI_UNSERE,
			AVESMAPS_GARETIEN_FELD_NUR_IHRE,
			AVESMAPS_GARETIEN_FELD_GEWAEHLT,
			// Aufgabe 3: die Sicht-Tafel (Entwurf §4.1)
			avesmapsGaretienSichtFuer,
			AVESMAPS_GARETIEN_SICHT_EBENE,
			AVESMAPS_GARETIEN_SICHT_NEUTRAL,
			// Aufgabe 4: die Kollision (Entwurf §4.2)
			avesmapsGaretienKollidiert,
			AVESMAPS_GARETIEN_KLASSE_KOLLISION,
			// 30.08.2026: „das Design dessen, was es werden wird" -- Flaechen-Deckkraft und
			// Punkt-Durchmesser nach echter Art/Klasse/Zoomstufe.
			AVESMAPS_GARETIEN_TOKEN_SIEDLUNG,
			AVESMAPS_GARETIEN_SIEDLUNGSKLASSEN,
			garetienSiedlungsKlasse,
			garetienObjektKind,
			garetienFlaechenDeckkraft,
			garetienPunktDurchmesser,
			// 04.09.2026: die Endkreuzungs-Rahmen der Voransicht
			garetienEndkreuzungsStellen,
			garetienEndkreuzungsRinge,
			garetienKreuzungDurchmesser,
			AVESMAPS_GARETIEN_FELD_ENDKREUZUNGEN,
			AVESMAPS_GARETIEN_KLASSE_ENDKREUZUNG,
		};
	}
})();
