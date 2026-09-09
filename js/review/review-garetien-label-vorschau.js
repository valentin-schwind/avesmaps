/*
 * Die Beschriftungs-VORSCHAU des Garetien-Importers -- die reine Regel.
 * =================================================================================================
 *
 * Owner 09.09.2026 (ein alter, nie umgesetzter Wunsch): „labels von flaechen siedlungen etc, die im
 * importer auf der stage eingestellt werden koennen, sollen so erscheinen, wie sie im endprodukt
 * (nach Stage importieren) sichtbar sein wird. das label verschwindet natuerlich, wenn ein objekt
 * von der stage genommen oder die option 'Auf der Karte anzeigen' aus ist."
 *
 * 🔴 UND „AUF DER KARTE ANZEIGEN" GEHOERT DEM LABEL, NICHT DER FLAECHE -- nachgemessen, weil der
 * Owner ausdruecklich danach gefragt hat. Die Begruendung steht woertlich im Markup des
 * Landschaftsdialogs (index.html: „Jede Region HAT ihr Karten-Label …; dieser Haken entscheidet nur,
 * ob es gezeichnet wird"), und im Importer reist der Haken als `show_name` ueber
 * avesmapsGaretienLabelUebersteuerung in avesmapsCreateLabelFeature -- also ans Label. Die Flaeche
 * bleibt sichtbar, wenn der Haken faellt.
 *
 * 🔴 DIESE DATEI ENTSCHEIDET, SIE ZEICHNET NICHT. Kein DOM, kein Leaflet, kein Modulzustand, kein
 * `fetch` -- dieselbe Zweiteilung wie bei `wiki-zuweisung.js` / `…-check.js` und bei
 * `freie-label-markierung.js` daneben. Gezeichnet wird in review-garetien-karte.js, und zwar mit den
 * BAUERN DER ECHTEN KARTE (createLabelIcon / createLocationNameLabelIcon) -- eine zweite Fassung
 * waere die zweite Wahrheit ueber das Aussehen der Karte (AGENTS.md §5).
 *
 * 🔴 SIE LEBT MIT DEM IMPORTER (Abbau-Vertrag): alles Importer-eigene steht in
 * js/review/review-garetien-*.js, css/components/garetien-importer.css, api/_internal/import/ und
 * dem `garetien`-Zweig von api/edit/wiki/sync-plan.php. Wer den Importer je abbaut, loescht diese
 * Datei mit und muss dafuer keine Kartendatei anfassen.
 */

(function () {
	"use strict";

	/*
	 * Die drei Zielformen, die ueberhaupt eine Beschriftung erzeugen -- und WELCHE Art.
	 *
	 * 🔴 EINE TAFEL, KEIN `if`-BAUM. Bei der naechsten Zielform ist eine Kette still falsch, und
	 * niemand merkt es (dieselbe Lehre wie bei AVESMAPS_GARETIEN_KOLLISION_URTEILE nebenan).
	 * 🔴 `path` FEHLT ABSICHTLICH. Ein Wegname wird auf CANVAS gemalt, und der Zeichner dort laeuft
	 * strikt ueber `pathData` -- den Speicher der ECHTEN Karte; seine Malfunktionen liegen in einer
	 * IIFE und sind von aussen nicht erreichbar. Eine Vorschau braeuchte dort eine Attrappe in
	 * `pathData`, und ein Fehler darin trifft nicht die Vorschau, sondern die Karte jedes Besuchers.
	 * Eigenes Paket, eigener Blick. ⚠️ Dazu passt, dass der Kasten „Eingefuegt wird" fuer den Weg
	 * gar keine Beschriftungsfelder hat, nur `showLabel`.
	 * 🔴 `settlement_place` und `quelle` fehlen, weil sie auf der Karte NICHTS erzeugen: eine
	 * Staette liegt innerorts, „Nur Quelle + Artikel" faellt gar nicht auf die Karte.
	 */
	var AVESMAPS_GARETIEN_VORSCHAU_ARTEN = {
		region: "frei",
		label: "frei",
		location: "ort",
	};

	/*
	 * Der Mittelpunkt einer Geometrie -- der arithmetische Durchschnitt ihrer Punkte. REIN.
	 *
	 * 💣 DAS IST DIE REGEL DES SERVERS, UND SIE IST NICHT DER „POL DER UNZUGAENGLICHKEIT".
	 * `avesmapsGaretienRingMittelpunkt` (api/_internal/import/garetien-plan.php) rechnet genau das,
	 * und zwar fuer BEIDE Leser: die Flaeche setzt ihr Label darauf (avesmapsGaretienFlaecheAnlegen),
	 * und jedes PUNKTziel wird beim Planbau darauf reduziert (Owner 01.09.2026: „Bei Flaechen, die zu
	 * Punkten (label, orte, …) werden, soll der Flaechenmittelpunkt genommen werden").
	 * 🪤 Polylabel waere schoener -- die Karte setzt frisch gezeichnete Regionslabels damit --, und
	 * es waere hier FALSCH: der Kommentar am Server sagt warum („lebt aber im Browser; ihn hier in
	 * PHP nachzubauen waere eine zweite Wahrheit"). Eine Vorschau mit polylabel zeigte eine andere
	 * Stelle als das Endprodukt. Bei einer runden Flaeche faellt der Unterschied nicht auf, bei einer
	 * sichelfoermigen ist er gross -- also genau die Sorte Fehler, die man nicht bemerkt.
	 * 💣 UND ES IST DER DURCHSCHNITT DER ECKEN, kein Flaechenschwerpunkt: eine Kante mit vielen
	 * Stuetzpunkten zieht ihn zu sich. Das ist keine Nachlaessigkeit, sondern die Uebereinstimmung
	 * mit dem Server -- wer es hier „richtig" rechnet, zeigt wieder etwas anderes als das Endprodukt.
	 * ⚠️ Bei EINEM Punkt (Burg, Dorf, Tempel: eine Koordinate) ist er dieser Punkt.
	 */
	function garetienVorschauMittelpunkt(punkte) {
		var liste = punkte || [];
		var n = liste.length;
		if (n === 0) { return null; }
		var sx = 0;
		var sy = 0;
		for (var i = 0; i < n; i++) {
			var p = liste[i];
			if (!p || p.length < 2) { return null; }
			// 💣 ERST DEN ROHWERT PRUEFEN, DANN UMWANDELN. `Number(null)` und `Number("")` sind
			// BEIDE 0, und 0 ist endlich -- eine Pruefung allein ueber `isFinite(Number(x))` laesst
			// `null` durch und zieht den Mittelpunkt lautlos zur Kartenecke. Dieselbe Falle wie beim
			// Fadenkreuz der Verlaufszeile und beim Zoomband; sie hat beim Bau DIESER Funktion noch
			// einmal zugeschlagen, obwohl der Kommentar schon danebenstand.
			if (p[0] === null || p[0] === undefined || p[0] === ""
					|| p[1] === null || p[1] === undefined || p[1] === "") {
				return null;
			}
			var x = Number(p[0]);
			var y = Number(p[1]);
			if (!isFinite(x) || !isFinite(y)) { return null; }
			sx += x;
			sy += y;
		}
		return [sx / n, sy / n];
	}

	/*
	 * Die Beschreibung der Beschriftung, die dieses Objekt erzeugen wird -- oder `null`. REIN.
	 *
	 * 🔴 SIE ENTSCHEIDET NICHT UEBER DIE SICHTBARKEIT AM ZOOM. Das Zoomband liest der Zeichner mit
	 * der Regel der ECHTEN Karte (`avesmapsLabelImBand` bzw. der Zoomband-Wert des Ortes) -- hier
	 * stuende sonst eine zweite Fassung derselben Frage, und der Zoom ist ausserdem kein Zustand
	 * dieses Fensters.
	 *
	 * @param objekt   ein Eintrag der gezeichneten Menge (rohes Server-Objekt)
	 * @param wahl     `garetienZielWahlZu(objekt)` -- die GEWAEHLTE Form, nie der Server-Vorschlag
	 * @param eingaben `garetienEingabenZustandZu(objekt)`, oder `null`, wenn der Aufrufer ihn (noch)
	 *                 nicht anlegen darf -- dann gelten die Grundwerte des Kastens
	 */
	function garetienVorschauLabelAus(objekt, wahl, eingaben) {
		if (!objekt) { return null; }
		var ziel = String((wahl && wahl.ziel) || "");
		var art = AVESMAPS_GARETIEN_VORSCHAU_ARTEN[ziel] || "";
		if (art === "") { return null; }

		// Ohne Namen gibt es nichts zu zeigen -- und ein leerer Kasten mit goldenem Rand saehe wie
		// ein Fehler aus.
		var text = String(objekt.name || "").trim();
		if (text === "") { return null; }

		var punkt = garetienVorschauMittelpunkt(objekt.geometrie);
		if (punkt === null) { return null; }

		var e = eingaben || {};

		/*
		 * 💣 DER HAKEN GILT NUR DEN ZWEI FREIEN FORMEN -- BEIM ORT GIBT ES IHN NICHT, und das ist
		 * keine Luecke. „Auf Karte anzeigen" steht im Kasten nur bei Flaeche und freiem Label; ein
		 * Ort traegt im ganzen Haus keinen „Name anzeigen"-Schalter (`show_label` gibt es nur fuer
		 * Wege und Kraftlinien). Ein Ortsname folgt deshalb allein der Stage und seinem Zoomband.
		 * 🪤 Und er wird STRIKT gegen `false` geprueft, nicht auf Wahrheitswert: ein Eingabenzustand,
		 * den niemand angefasst hat, wird hier gar nicht erst angelegt (der Aufrufer reicht dann
		 * `null` herein), und `undefined` heisst „Grundwert", und der ist `showName: true`.
		 */
		if (art === "frei" && e.showName === false) { return null; }

		return {
			art: art,
			text: text,
			// 🔴 Der Subtyp der WAHL, nicht der des Vorschlags: wer ein Huegelland auf „Berggipfel"
			// umstellt, bekommt die Schrift eines Berggipfels. Er ist zugleich `labelType` der
			// echten Karte und `locationType` des Ortsnamens -- eine Zeichenkette, zwei Leser.
			subtyp: String((wahl && wahl.subtyp) || ""),
			punkt: punkt,
			// Die vier Werte des Kastens. `undefined` heisst „der Bauer nimmt seine eigene Vorgabe"
			// -- genau so, wie eine Beschriftung ohne eigenen Wert auf die Darstellungstafel faellt.
			size: e.size,
			priority: e.priority,
			minZoom: e.minZoom,
			maxZoom: e.maxZoom,
			// 🔴 Die weisse Fassung gehoert der GEOEFFNETEN Zeile -- dasselbe Feld, aus dem die
			// Geometrie ihre helle Kontur bekommt (Owner 08.09.2026), und derselbe Gedanke: ein
			// Vokabular fuer Form und Name.
			gewaehlt: objekt.gewaehlt === true,
		};
	}

	// Browser: globaler Raum wie alle Bauteile dieses Fensters. Node: `require` fuer die Tests.
	if (typeof window !== "undefined") {
		window.garetienVorschauLabelAus = garetienVorschauLabelAus;
		window.garetienVorschauMittelpunkt = garetienVorschauMittelpunkt;
		window.AVESMAPS_GARETIEN_VORSCHAU_ARTEN = AVESMAPS_GARETIEN_VORSCHAU_ARTEN;
	}
	if (typeof module !== "undefined" && module.exports) {
		module.exports = {
			garetienVorschauLabelAus: garetienVorschauLabelAus,
			garetienVorschauMittelpunkt: garetienVorschauMittelpunkt,
			AVESMAPS_GARETIEN_VORSCHAU_ARTEN: AVESMAPS_GARETIEN_VORSCHAU_ARTEN,
		};
	}
}());
