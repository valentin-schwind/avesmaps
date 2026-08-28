(function () {
	"use strict";

	/*
	 * Der goldgelbe Schein des Garetien Importers — was angehakt ist, leuchtet auf der Karte.
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
	 * 🔴 DER GLOW HAENGT AM HAEKCHEN, nicht an der Einzelansicht (Owner 27.08.2026): man hakt sich
	 * durch die Liste und sieht die Auswahl auf der Karte WACHSEN. „Auf der Karte zeigen" bewegt
	 * ausschliesslich die Ansicht.
	 *
	 * 💣 ZWEI MITTEL, NICHT EINS (Mockup §2). Ihre Linie liegt oft GENAU auf unserer — Median
	 * 1,24 Meilen bei 3072 Meilen Kartenbreite. Ein durchgezogener goldener Strich waere optisch
	 * ein ERSATZ unserer Linie, und genau das ist es nicht:
	 *   - ihre Geometrie: goldgelb GESTRICHELT  („so wuerde es liegen, es steht noch nicht bei uns")
	 *   - unsere betroffenen Abschnitte: ein breiter, halbdurchsichtiger SCHEIN darunter
	 *     („das hier von uns aendert sich, wenn du das Haekchen stehen laesst")
	 *
	 * 💣 DER SCHEIN SITZT NUR UNTER DEN ABSCHNITTEN, DIE DAS HAEKCHEN WIRKLICH AENDERT. Bei ihrer
	 * Natter ist das einer von fuenf. Der ganzen Kette einen Schein zu geben behauptete, alle fuenf
	 * wuerden umbenannt — genau der Fehler, den die Einzelansicht aus Aufgabe 13 verhindern soll.
	 * Die Quelle ist deshalb `item.abschnitt.public_id` der ANGEHAKTEN Items, nie `objekt.abschnitte`.
	 */

	// ---- Die zwei Panes -------------------------------------------------------------------------
	//
	// 🔴 ZWEI, weil die zwei Mittel in verschiedene Richtungen zeigen. Im Mockup §2 ist die
	// Malreihenfolge: Schein → UNSERE Flusslinie → ihr gestrichelter Strich.
	//
	//   - DER SCHEIN IST EINE HERVORHEBUNG UNSERER GEOMETRIE und gehoert deshalb HINTER das, was er
	//     hervorhebt. Laege er darueber, deckte ein 13px breites Goldband unsere 3px schmale blaue
	//     Linie zu: aus Flussblau (#6ec6ff) und 55 % Gold mischt sich rgb(182,188,137), ein stumpfes
	//     Oliv. Sichtbar waere ein goldener Hof mit olivfarbenem KERN genau dort, wo der Fluss liegt.
	//     Darunter bleibt unser Blau rein und der Hof reines Gold auf Pergament.
	//   - IHR STRICH IST DER VORSCHLAG und gehoert nach oben, sonst sieht man ihn nicht.
	//
	// 🔴 SCHEIN 360, STRICH 465. Was diese zwei Zahlen zusichern:
	//
	//   (a) 360 liegt UNTER `roadsPane` -- das ist die Regel des Scheins -- und UEBER
	//       `roadsOutlinePane`, der weissen Kontur unserer Wege. Darunter zeigte sich vom 13px
	//       breiten Schein nur der Rand ausserhalb der 5,4px breiten Kontur: aus dem Hof wuerde
	//       ein duenner Saum.
	//   (b) 465 ist frei, und 460 ist es NICHT -- die gehoert `measurementPane`
	//       (js/app/bootstrap.js). Bei gleichem z-index entscheidet die Einfuegereihenfolge im DOM,
	//       und das ist keine Regel, sondern ein Zufall, der beim naechsten Umbau kippt.
	//   (c) Beide Zahlen sind sonst UNBELEGT.
	//
	// 🪤 HIER STAND EINE AUFZAEHLUNG DER BELEGTEN WERTE, und sie war unvollstaendig: auf 455 liegt
	// nicht nur `ecosystemPaneKlimaLines`, sondern auch `avesmapsRouteSpeedArrowPane`
	// (js/routing/route-speed-arrows.js). An der Richtigkeit von 465 aendert das nichts -- aber es
	// war in diesem Vorhaben die fuenfte Liste, die beim Nachzaehlen kuerzer war als die
	// Wirklichkeit. Eine Zahl im Kommentar liest sich wie eine vollstaendige Liste, und niemand
	// zaehlt nach. Deshalb steht hier die ZUSICHERUNG und der Griff, mit dem man sie nachprueft --
	// nicht ihr Ergebnis (dieselbe Form wie in AGENTS.md §11 an den Rauschfiltern):
	//
	//   grep -rn 'style\.zIndex = [0-9]' js/ --include=*.js | grep -v third-party \
	//     | sed -E 's/^([^:]+):([0-9]+):.*zIndex = ([0-9]+).*/\3 \1:\2/' | sort -n
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
	var AVESMAPS_GARETIEN_PANE = "garetienImportPane";
	var AVESMAPS_GARETIEN_PANE_Z = 465;
	var AVESMAPS_GARETIEN_SCHEIN_PANE = "garetienImportScheinPane";
	var AVESMAPS_GARETIEN_SCHEIN_PANE_Z = 360;

	// ---- Die Masse ----------------------------------------------------------------------------
	//
	// Aus dem freigegebenen Mockup (docs/garetien-importer-mockup.html §2, dort als SVG in
	// Bildschirm-Pixeln gezeichnet — dieselbe Einheit, in der Leaflet `weight` misst).
	// ⚠️ Der Schein muss deutlich breiter sein als unsere Linie darunter: ein `Flussweg` zeichnet
	// mit `PATH_CENTER_WEIGHTS.Flussweg = 3` (js/config.js) plus Kontur. Kein Token: `tokens.css`
	// fuehrt keine Strichbreiten fuer Kartengeometrie, jede Kartenebene im Haus haelt ihre eigene
	// Zahl (map-features.js, ecosystem-*.js). Fuer FARBEN gilt das Gegenteil — siehe unten.
	// 🔧 OFFEN FUER DEN OWNER: die Deckkraft des Scheins ueber einer blauen Flusslinie ist die eine
	// Zahl, die nur das Auge beantwortet.
	var AVESMAPS_GARETIEN_STRICH_BREITE = 3;
	var AVESMAPS_GARETIEN_STRICHELUNG = "9 5";
	var AVESMAPS_GARETIEN_SCHEIN_BREITE = 13;
	var AVESMAPS_GARETIEN_SCHEIN_DECKKRAFT = 0.55;
	// Die Fuellung IHRER Flaechen (Mockup §2, Blutmoor: `fill=var(--color-marker-active) opacity=".14"`).
	// Sehr leicht, damit die Landschaft darunter lesbar bleibt -- dieselbe Zurueckhaltung wie bei den
	// Klimabaendern (css/features/ecosystem-layer.css).
	var AVESMAPS_GARETIEN_FLAECHE_DECKKRAFT = 0.14;

	// Sie stehen im `class`-Attribut der erzeugten SVG-Pfade. Nicht Zierde: so laesst sich in der
	// Abnahme im echten Browser trennen, was Strich und was Schein ist, ohne die Leaflet-Interna
	// anzufassen.
	var AVESMAPS_GARETIEN_KLASSE_STRICH = "gi-map-strich";
	var AVESMAPS_GARETIEN_KLASSE_SCHEIN = "gi-map-schein";

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

	// 🔴 DIE FARBE KOMMT AUS DEM TOKEN (AGENTS.md §12) — sie steht nirgends als Zahl in dieser Datei.
	// ⚠️ Leaflet-Pfadoptionen nehmen kein `var(--…)`, der Wert wird deshalb ausgelesen; dasselbe
	// Mittel wie in map-features-ecosystem-draw.js und -simplify.js.
	// ⚠️ Und KEIN abgeschriebener Rueckfall: eine hartkodierte Ersatzfarbe waere genau die zweite
	// Fassung, die das Token verhindern soll. Fehlt das Token, faellt die Farbe leer aus und der
	// Fehler ist sichtbar, statt in einer veraltenden Kopie zu ueberleben.
	function garetienGoldton() {
		if (typeof document === "undefined" || typeof getComputedStyle !== "function") { return ""; }
		return getComputedStyle(document.documentElement).getPropertyValue("--color-marker-active").trim();
	}

	// EINE Regel fuer BEIDE Panes -- eine zweite Fassung liefe beim ersten geaenderten Wert
	// auseinander, und der Riegel „nimmt keine Klicks" muss fuer beide gelten.
	function garetienPaneSicherstellen(karte, name, z) {
		if (typeof karte.getPane !== "function" || typeof karte.createPane !== "function") { return null; }
		var pane = karte.getPane(name) || karte.createPane(name);
		if (!pane || !pane.style) { return null; }
		pane.style.zIndex = z;
		// 🔴 Die Zeichnung ist eine AUSKUNFT, kein Bedienelement: sie darf weder Klicks auf unsere
		// Wege noch das Ziehen der Karte schlucken. `pointer-events` ist eine Eigenschaft der PANE,
		// nicht der einzelnen Ebene — dieselbe Begruendung wie bei den Landschaften-Panes.
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
	 * Die public_ids, die gluehen duerfen. REIN — kein DOM, keine Karte.
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
	 * nennen — er bekommt EINEN Schein, nicht drei uebereinander.
	 */
	function avesmapsGaretienScheinIds(objekt) {
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
	 * Die Punkte UNSERES Abschnitts. REIN.
	 *
	 * 🔴 GELESEN WIRD NUR `objekt.abschnitte`, und das ist die EINE Quelle -- dieselbe Liste, die
	 * auch die Einzelansicht zeigt; so koennen Schein und Zeile nicht auseinanderlaufen.
	 * 🪤 Hier stand bis zur Pruefung ein Rueckfall auf `item.abschnitt`. Er war TOTER CODE mit einem
	 * beruhigenden Kommentar darueber: `avesmapsGaretienListeAbschnitteVereinen`
	 * (api/_internal/import/garetien-liste.php) haengt JEDEN von einem Item genannten Abschnitt an
	 * die Liste an, und `avesmapsGaretienScheinIds` liest genau dieselben Items -- die zwei Mengen
	 * fallen zusammen. Eine Mutation `if (treffer === null)` → `if (false)` liess alle Zusicherungen
	 * gruen, was den Zweig als unerreichbar auswies. Faellt der Abschnitt je doch heraus, ist das
	 * ein BEFUND am Server und wird gemeldet (garetienGeometrieFehlt) statt still geflickt.
	 */
	function garetienAbschnittsPunkte(objekt, publicId) {
		var treffer = null;
		(((objekt || {}).abschnitte) || []).forEach(function (abschnitt) {
			if (treffer === null && abschnitt && String(abschnitt.public_id) === publicId) {
				treffer = abschnitt;
			}
		});
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
	 */
	function garetienIstFlaeche(objekt) {
		return String((objekt || {}).geometrie_typ || "") === "Polygon";
	}

	// ---- Zeichnen ---------------------------------------------------------------------------------

	/*
	 * Die Menge der ANGEHAKTEN Objekte auf die Karte legen.
	 *
	 * 💣 IDEMPOTENT: erst alles abraeumen, dann alles neu. Derselbe Aufruf zweimal ergibt dieselben
	 * Ebenen, nicht die doppelte Menge — der Listenlauf ruft ihn nach JEDEM Neuzeichnen.
	 * 🔴 DIE REIHENFOLGE MACHEN DIE PANES, nicht die Einfuegereihenfolge: der Schein liegt in einer
	 * eigenen Pane UNTER unseren Wegen (360), der Strich in seiner ueber allem (465). Die Trennung
	 * ist der ganze Punkt -- die Hervorhebung gehoert hinter das, was sie hervorhebt.
	 * ⚠️ Innerhalb einer Pane entscheidet weiterhin die Einfuegereihenfolge; sie ist hier nur nicht
	 * mehr tragend, weil in jeder Pane genau eine Sorte liegt.
	 */
	function avesmapsGaretienKarteZeigen(objekte, karte) {
		var k = garetienKarte(karte);
		var l = garetienLeaflet();
		if (!k || !l || typeof l.polyline !== "function" || typeof l.layerGroup !== "function") {
			return null;
		}
		garetienPaneSicherstellen(k, AVESMAPS_GARETIEN_SCHEIN_PANE, AVESMAPS_GARETIEN_SCHEIN_PANE_Z);
		garetienPaneSicherstellen(k, AVESMAPS_GARETIEN_PANE, AVESMAPS_GARETIEN_PANE_Z);

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
		var farbe = garetienGoldton();

		liste.forEach(function (objekt) {
			avesmapsGaretienScheinIds(objekt).forEach(function (publicId) {
				var punkte = avesmapsGaretienNachLeaflet(garetienAbschnittsPunkte(objekt, publicId));
				if (punkte.length < 2) { garetienGeometrieFehlt(objekt, publicId); return; }
				// 🔴 Der Schein ist IMMER ein Strich, auch unter einer Flaeche: er ist der Hof um
				// unsere Geometrie. Eine gefuellte Flaeche zu 55 % Gold ueberdeckte einen See
				// vollstaendig -- man saehe die Hervorhebung, aber nicht mehr, was hervorgehoben ist.
				gruppe.addLayer(l.polyline(punkte, {
					pane: AVESMAPS_GARETIEN_SCHEIN_PANE,
					className: AVESMAPS_GARETIEN_KLASSE_SCHEIN,
					color: farbe,
					weight: AVESMAPS_GARETIEN_SCHEIN_BREITE,
					opacity: AVESMAPS_GARETIEN_SCHEIN_DECKKRAFT,
					lineCap: "round",
					lineJoin: "round",
					fill: false,
					interactive: false,
				}));
			});
		});

		liste.forEach(function (objekt) {
			var punkte = avesmapsGaretienNachLeaflet((objekt || {}).geometrie);
			if (punkte.length < 2) { garetienGeometrieFehlt(objekt, null); return; }
			// 🔴 EINE FLAECHE WIRD ALS FLAECHE GEZEICHNET (Mockup §2, Blutmoor: leichte Fuellung
			// plus gestrichelte Kante). Von den Objekten der Stufe 1 sind 113 von 288 Flaechen --
			// 96 Seen, 15 Suempfe, 2 Meere. Als blosser Umriss saehe ein See aus wie ein Fluss.
			// ⚠️ `L.polygon` schliesst den Ring selbst; ein bereits geschlossener Ring (GeoJSON
			// verlangt ihn) schadet nicht.
			var flaeche = garetienIstFlaeche(objekt);
			var bauer = (flaeche && typeof l.polygon === "function") ? l.polygon : l.polyline;
			gruppe.addLayer(bauer(punkte, {
				pane: AVESMAPS_GARETIEN_PANE,
				className: AVESMAPS_GARETIEN_KLASSE_STRICH,
				color: farbe,
				weight: AVESMAPS_GARETIEN_STRICH_BREITE,
				opacity: 1,
				dashArray: AVESMAPS_GARETIEN_STRICHELUNG,
				lineCap: "round",
				lineJoin: "round",
				fill: flaeche,
				fillColor: farbe,
				fillOpacity: flaeche ? AVESMAPS_GARETIEN_FLAECHE_DECKKRAFT : 0,
				interactive: false,
			}));
		});

		return gruppe;
	}

	/*
	 * „Auf der Karte zeigen" — NUR die Ansicht.
	 *
	 * 🔴 Der Glow haengt am Haekchen und wird hier nicht angefasst (Owner 27.08.2026).
	 * ⚠️ Angeflogen wird IHRE Geometrie, nicht zusaetzlich unsere getroffenen Abschnitte: der Knopf
	 * steht in der Ansicht ihres Objekts, und ein Kasten, der die Haekchen mitliest, veraenderte den
	 * Bildausschnitt beim Anhaken — dann bewegt der Knopf eben doch mehr als die Ansicht.
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

	/*
	 * Alles weg — das Fenster ist zu.
	 *
	 * 💣 Ein zurueckgelassener goldener Strich auf der oeffentlichen Karte waere der schlimmste
	 * Ausfall dieser Aufgabe: der Besucher saehe goldene Striche ohne jede Erklaerung.
	 * ⚠️ Die Pane bleibt stehen, und das ist richtig: ein leeres <div> zeichnet nichts, Leaflet hat
	 * kein oeffentliches `removePane`, und ein spaeteres `createPane` legte ohnehin ein neues an
	 * (siehe oben). Sauber heisst „keine Geometrie mehr", nicht „kein Knoten mehr".
	 */
	function avesmapsGaretienKarteAus() {
		if (gruppe !== null) {
			if (typeof gruppe.clearLayers === "function") { gruppe.clearLayers(); }
			if (typeof gruppe.remove === "function") { gruppe.remove(); }
			gruppe = null;
		}
		return null;
	}

	if (typeof window !== "undefined") {
		// 🔴 Vier Namen im globalen Raum, so wie das Fenster sie sucht (`typeof … === "function"`).
		// Kein Sammelobjekt: review-garetien-importer.js fragt jeden einzeln ab und bleibt damit
		// ohne diese Datei lauffaehig — der Importer laeuft auch auf Seiten ohne Karte.
		window.avesmapsGaretienKarteZeigen = avesmapsGaretienKarteZeigen;
		window.avesmapsGaretienKarteFliegen = avesmapsGaretienKarteFliegen;
		window.avesmapsGaretienKarteAus = avesmapsGaretienKarteAus;
		window.avesmapsGaretienScheinIds = avesmapsGaretienScheinIds;
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = {
			avesmapsGaretienNachLeaflet,
			avesmapsGaretienScheinIds,
			garetienAbschnittsPunkte,
			garetienIstFlaeche,
			avesmapsGaretienKarteZeigen,
			avesmapsGaretienKarteFliegen,
			avesmapsGaretienKarteAus,
			AVESMAPS_GARETIEN_PANE,
			AVESMAPS_GARETIEN_PANE_Z,
			AVESMAPS_GARETIEN_SCHEIN_PANE,
			AVESMAPS_GARETIEN_SCHEIN_PANE_Z,
		};
	}
})();
