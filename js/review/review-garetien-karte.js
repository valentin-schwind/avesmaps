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
	// Der Radius eines Punktobjekts (Ortschaft, Berggipfel, Bauwerk). Gross genug, um neben einer
	// Ortsmarkierung als eigener Ring lesbar zu sein, klein genug, um sie nicht zuzudecken.
	var AVESMAPS_GARETIEN_PUNKT_RADIUS = 8;
	var AVESMAPS_GARETIEN_SCHEIN_BREITE = 13;
	var AVESMAPS_GARETIEN_SCHEIN_DECKKRAFT = 0.55;
	// Die Fuellung einer Flaeche (Mockup §2, Blutmoor: `fill=var(--color-marker-active) opacity=".14"`).
	// Sehr leicht, damit die Landschaft darunter lesbar bleibt -- dieselbe Zurueckhaltung wie bei den
	// Klimabaendern (css/features/ecosystem-layer.css). Beide Parteien nehmen denselben Wert: bei
	// zwei uebereinanderliegenden Seen ist die Ueberlappung dann sichtbar kraeftiger, und genau das
	// ist die Auskunft „hier sind sie sich einig".
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

	// 🔴 DIE FARBEN KOMMEN AUS TOKENS (AGENTS.md §12) — sie stehen nirgends als Zahl in dieser Datei.
	var AVESMAPS_GARETIEN_TOKEN_IHRE = "--color-marker-active";
	var AVESMAPS_GARETIEN_TOKEN_UNSERE = "--color-garetien-unsere";

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
	function avesmapsGaretienNachLeaflet(punkte) {
		var raus = [];
		(punkte || []).forEach(function (punkt) {
			if (!punkt || punkt.length < 2) { return; }
			var x = Number(punkt[0]);
			var y = Number(punkt[1]);
			if (!isFinite(x) || !isFinite(y)) { return; }
			raus.push([y, x]);
		});
		return raus;
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
		Waelder:       { form: "flaeche", token: "--color-ecosystem-vegetation-wald",     breite: 2 },
		Ortschaften_1: { form: "punkt",   token: "--color-marker-settlement",             breite: 3 },
		Ortschaften_2: { form: "punkt",   token: "--color-marker-settlement",             breite: 3 },
		Ortschaften_3: { form: "punkt",   token: "--color-marker-settlement",             breite: 3 },
		Ortschaften_4: { form: "punkt",   token: "--color-marker-settlement",             breite: 3 },
		Detail_1:      { form: "punkt",   token: "--color-marker-settlement",             breite: 3 },
		Detail_2:      { form: "punkt",   token: "--color-marker-settlement",             breite: 3 },
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
		if (punkte.length === 1) {
			if (typeof l.circleMarker !== "function") { return null; }
			basis.radius = AVESMAPS_GARETIEN_PUNKT_RADIUS;
			// Ungefuellt, damit der Ring den Ort darunter nicht zudeckt.
			basis.fill = false;
			basis.fillOpacity = 0;
			ebene = l.circleMarker(punkte[0], basis);
		} else {
			basis.fill = opt.flaeche === true;
			basis.fillColor = opt.farbe;
			basis.fillOpacity = opt.flaeche === true ? AVESMAPS_GARETIEN_FLAECHE_DECKKRAFT : 0;
			var bauer = (opt.flaeche === true && typeof l.polygon === "function")
				? l.polygon
				: l.polyline;
			ebene = bauer(punkte, basis);
		}
		if (ebene && opt.titel && typeof ebene.bindTooltip === "function") {
			// `sticky` laesst den Tooltip dem Zeiger folgen -- an einer langen Flusslinie stuende er
			// sonst an deren Mittelpunkt, oft weit weg von der Stelle, auf die man zeigt.
			ebene.bindTooltip(opt.titel, { sticky: true, direction: "top" });
		}
		return ebene;
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
					titel: garetienTitelUnsere(objekt, publicId),
					// 🔴 Eine Flaeche nur dann als Flaeche, wenn die Punktliste sich zu EINEM Ring
					// schliesst -- siehe garetienRingSchliesst.
					flaeche: garetienIstFlaeche(objekt) && garetienRingSchliesst(punkte),
				});
			});
		});

		// 🔴 Der Hof ist IMMER ein Strich, auch unter einer Flaeche: eine gefuellte Flaeche zu 55 %
		// ueberdeckte einen See vollstaendig -- man saehe die Hervorhebung, aber nicht mehr, was
		// hervorgehoben ist.
		unsere.forEach(function (eintrag) {
			var hof = garetienForm(l, eintrag.punkte, {
				pane: AVESMAPS_GARETIEN_UNSERE_PANE,
				klasse: AVESMAPS_GARETIEN_KLASSE_SCHEIN,
				farbe: farbeUnsere,
				breite: AVESMAPS_GARETIEN_SCHEIN_BREITE,
				deckkraft: AVESMAPS_GARETIEN_SCHEIN_DECKKRAFT,
				flaeche: false,
				strichelung: null,
				titel: eintrag.titel,
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
				titel: garetienTitelIhre(objekt),
				flaeche: sicht.form === "flaeche",
				farbe: farbe,
				breite: sicht.breite,
			});
		});

		// 🔴 IHR HOF: GOLD, NEU seit RULING R8. Die Form darueber traegt seither ihre ECHTE
		// Kartenfarbe (Sicht-Tafel) statt immer Gold -- der Hof haelt die Herkunft trotzdem lesbar:
		// „das ist ihr Vorschlag" bleibt sichtbar, auch wenn die Form selbst nicht mehr golden ist.
		// Wie bei „unsere" IMMER ein Strich, auch unter einer Flaeche.
		ihre.forEach(function (eintrag) {
			var hof = garetienForm(l, eintrag.punkte, {
				pane: AVESMAPS_GARETIEN_IHRE_PANE,
				klasse: AVESMAPS_GARETIEN_KLASSE_SCHEIN_IHRE,
				farbe: farbeIhre,
				breite: AVESMAPS_GARETIEN_SCHEIN_BREITE,
				deckkraft: AVESMAPS_GARETIEN_SCHEIN_DECKKRAFT,
				flaeche: false,
				strichelung: null,
				titel: eintrag.titel,
			});
			if (hof) { gruppe.addLayer(hof); }
		});

		// 🔴 IHRE FORM: die ECHTE Kartenform, -farbe und -breite aus der Sicht-Tafel (Entwurf §4.1).
		// Die Strichelung BLEIBT -- sie haengt an der Kante, nicht an der Farbe, und sagt weiterhin
		// „das ist ihre Fassung, sie steht noch nicht bei uns"; ein Ring traegt sie deshalb genauso
		// wie eine Linie.
		ihre.forEach(function (eintrag) {
			var form = garetienForm(l, eintrag.punkte, {
				pane: AVESMAPS_GARETIEN_IHRE_PANE,
				klasse: AVESMAPS_GARETIEN_KLASSE_IHRE,
				farbe: eintrag.farbe,
				breite: eintrag.breite,
				deckkraft: 1,
				flaeche: eintrag.flaeche,
				strichelung: AVESMAPS_GARETIEN_STRICHELUNG,
				titel: eintrag.titel,
			});
			if (form) { gruppe.addLayer(form); }
		});

		return gruppe;
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
		window.avesmapsGaretienKarteFliegen = avesmapsGaretienKarteFliegen;
		window.avesmapsGaretienKarteAus = avesmapsGaretienKarteAus;
		window.avesmapsGaretienKarteSicht = avesmapsGaretienKarteSicht;
		window.avesmapsGaretienKarteUmschalten = avesmapsGaretienKarteUmschalten;
		window.avesmapsGaretienUnsereIds = avesmapsGaretienUnsereIds;
		// Aufgabe 3: die Sicht-Tafel -- review-garetien-importer.js liest sie fuer die
		// Neutral-Meldung der Bilanzzeile (Schritt 5), ohne diese Datei vorauszusetzen.
		window.avesmapsGaretienSichtFuer = avesmapsGaretienSichtFuer;
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
			avesmapsGaretienKarteZeigen,
			avesmapsGaretienKarteFliegen,
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
			// Aufgabe 3: die Sicht-Tafel (Entwurf §4.1)
			avesmapsGaretienSichtFuer,
			AVESMAPS_GARETIEN_SICHT_EBENE,
			AVESMAPS_GARETIEN_SICHT_NEUTRAL,
		};
	}
})();
