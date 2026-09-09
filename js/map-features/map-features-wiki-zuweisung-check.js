// Der Prüfhaken „Keine Wiki-Zuweisung" -- der Teil, der das DOM anfasst.
//
// Owner 01.09.2026: „das objekt ohne wiki-eintrag auffällig rot markieren", egal ob Ort, Fläche oder
// Weg. Die REGEL („hat dieses Objekt eine Zuweisung?") steht nebenan in wiki-zuweisung.js und ist
// bewusst rein -- kein DOM, kein Modulzustand, damit sie testbar bleibt. Hier steht alles, was sie
// nicht darf: der Haken, der Farbtoken und das Nachziehen der vier Zeichenflächen.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 💣 DIESER HAKEN BLENDET ALS EINZIGER DER GRUPPE NICHTS EIN
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// „Ein Prüfhaken ZEIGT seine Funde" (resolveLocationCheckFinding, Owner 14.08.2026) gilt für seine
// vier Nachbarn: ein unverbundener Ort holt seinen Marker an der Größenkaskade und an der
// Zoomstufe vorbei auf die Karte. Das ist richtig für eine Handvoll Anbindungslücken -- man sucht
// Nadeln und würde sie sonst wegzoomen.
// Hier ist es falsch, und zwar gemessen: 983 der 2912 Orte haben keine Zuweisung, ein DRITTEL des
// Bestands. Eingeblendet wäre das keine Fundstelle mehr, sondern eine zweite Ortsebene -- und die
// Zoombänder, die die Karte lesbar halten, wären für ein Drittel der Orte ausgehebelt. Der Owner
// hat außerdem „markieren" gesagt, nicht „einblenden": eine Marke setzt voraus, dass das Objekt
// schon da ist. Bei den Landschaftsflächen ginge „einblenden" ohnehin nicht -- die gibt es nur in
// der Landschaften-Ansicht.
// ⚠️ Deshalb ruft NUR der Icon-Bau resolveLocationWikiMark, nie shouldShowLocationMarker. Wer das
// je zusammenlegt, legt die 983 auf die Karte.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

(function () {
	"use strict";

	// Der Zustand -> die Klassen-/Modifikator-Endung. EINE Stufe, ein Ton (tokens.css).
	// 🔴 BIS ZUM 09.09.2026 WAREN ES ZWEI: „offen" laut und „geprüft" derselbe Ton blass. Die zweite
	// Stufe kam aus `properties.wiki_no_article`, und dieser Merker ist auf Owner-Entscheid global
	// ausgebaut -- sein Äquivalent ist die WIKI-ZUWEISUNG. Die 6 Orte, die blass markiert waren,
	// tragen jetzt den vollen Ring; sie sind nicht neu, sie sind nur nicht mehr unterschieden.
	const MARKE_OFFEN = "no-wiki";

	function markeFuerZustand(zustand) {
		if (typeof avesmapsWikiZuweisungMarkiert !== "function" || !avesmapsWikiZuweisungMarkiert(zustand)) {
			return "";
		}
		return MARKE_OFFEN;
	}

	function istVerfuegbar() {
		return typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE
			&& typeof map !== "undefined" && Boolean(map);
	}

	// Ist der Haken an? 💣 Der Riegel `IS_EDIT_MODE` steht HIER und nicht nur am ausgeblendeten
	// Menüeintrag: `?toggleNoWikiAssignment=1` im geteilten Link erreicht sonst auch einen Besucher
	// -- dieselbe Falle, die bei „Offene Wegenden" schon einmal zugeschnappt ist.
	window.avesmapsIstWikiZuweisungCheckAktiv = function avesmapsIstWikiZuweisungCheckAktiv() {
		return istVerfuegbar() && $("#toggleNoWikiAssignment").is(":checked");
	};

	// --- die Farbe ------------------------------------------------------------------------------
	// 💣 DER TOKEN WIRD AUSGELESEN, NICHT DURCHGEREICHT. Leaflet schreibt `color` beim Canvas-Renderer
	// in den 2D-Kontext und beim SVG-Renderer in das Präsentationsattribut `stroke` -- in BEIDEN löst
	// `var()` nicht auf, die Linie bliebe schwarz bzw. unsichtbar. Hausmuster, siehe
	// avesmapsOpenPathEndStyle. Einmal gelesen und behalten: der Wert ist in tokens.css gepinnt (kein
	// Dark-Override, er liegt auf den immer hellen Kartenkacheln).
	// ⚠️ DER PARAMETER IST GEFALLEN, DIE VIER AUFRUFSTELLEN REICHEN IHN WEITER (map-features.js,
	// map-features-labels.js, …-ecosystem-rendering.js, …-path-label-canvas-overlay.js). Das ist
	// Absicht und kein vergessener Rest: sie uebergeben dort das Ergebnis von markeFuerZustand(),
	// und JS verwirft ein zuviel uebergebenes Argument. Sie einzeln nachzuziehen waere ein Diff an
	// vier Zeichenflaechen fuer null Wirkung -- der Merker faellt in vier Schritten, und diese
	// Stellen fasst der naechste ohnehin an. Es gibt seit dem 09.09.2026 nur noch EINEN Ton.
	const farben = {};
	window.avesmapsWikiZuweisungFarbe = function avesmapsWikiZuweisungFarbe() {
		const merkmal = "--color-check-no-wiki";
		if (!farben[merkmal]) {
			farben[merkmal] = getComputedStyle(document.documentElement).getPropertyValue(merkmal).trim()
				|| "#a01029";
		}
		return farben[merkmal];
	};

	// --- die vier Objektarten -------------------------------------------------------------------
	// Jede holt ihre eigenen Felder (vier Formen aus vier Endpunkten), die REGEL kommt von nebenan.

	window.avesmapsWikiZuweisungMarkeOrt = function avesmapsWikiZuweisungMarkeOrt(location, locationType) {
		if (!avesmapsIstWikiZuweisungCheckAktiv() || typeof avesmapsWikiZuweisungOrt !== "function") {
			return "";
		}
		return markeFuerZustand(avesmapsWikiZuweisungOrt(location, locationType));
	};

	// 💣 DIE NAMENSFRAGE KOMMT VON `getPathTitleName`, UND SIE WIRD NICHT NACHGEBAUT.
	// „Trägt dieser Weg einen von Menschen gegebenen Namen?" ist genau das, was jene Funktion
	// beantwortet (map-features-path-domain.js): sie kennt R1 (zugewiesen ⇒ Wiki-Name), sie liest
	// `display_name`/`original_name` statt des umgeschriebenen `name`, und sie erkennt die
	// Müll-Muster über shouldShowRoutePathDisplayName.
	// 🔴 EINE NACHBILDUNG STAND HIER BIS ZUM 01.09.2026 UND WAR STILL KAPUTT: sie las
	// `properties.name`, und das trägt im Browser den MASCHINENnamen -- normalizeRoutePathFeature
	// schreibt ihn beim Laden auf `<Art>-<n>` um und legt den echten nach `original_name`
	// (map-features-path-prepare.js). Der Haken erklärte damit ALLE 6041 Wege für „nicht gemeint"
	// und färbte keinen einzigen. In der rohen Nutzlast stimmte dieselbe Zeile noch -- ein Test, der
	// die Nutzlast liest, ist hier also grün und beweist nichts. Im Browser gemessen.
	window.avesmapsWikiZuweisungMarkeWeg = function avesmapsWikiZuweisungMarkeWeg(path) {
		if (!avesmapsIstWikiZuweisungCheckAktiv() || typeof avesmapsWikiZuweisungWeg !== "function"
			|| typeof getPathTitleName !== "function") {
			return "";
		}
		const hatEchtenNamen = getPathTitleName(path) !== "";
		return markeFuerZustand(avesmapsWikiZuweisungWeg(path?.properties, hatEchtenNamen));
	};

	window.avesmapsWikiZuweisungMarkeFlaeche = function avesmapsWikiZuweisungMarkeFlaeche(area) {
		if (!avesmapsIstWikiZuweisungCheckAktiv() || typeof avesmapsWikiZuweisungFlaeche !== "function") {
			return "";
		}
		return markeFuerZustand(avesmapsWikiZuweisungFlaeche(area));
	};

	window.avesmapsWikiZuweisungMarkeLabel = function avesmapsWikiZuweisungMarkeLabel(label) {
		if (!avesmapsIstWikiZuweisungCheckAktiv() || typeof avesmapsWikiZuweisungBeschriftung !== "function") {
			return "";
		}
		return markeFuerZustand(avesmapsWikiZuweisungBeschriftung(label));
	};

	// --- das Nachziehen -------------------------------------------------------------------------

	// Vier Zeichenflächen, ein Aufruf.
	//
	// 💣 GETRENNT GERUFEN GINGE DAS SCHIEF, und zwar sichtbar: der Haken färbt Orte, Wege, Flächen
	// UND Beschriftungen. Zöge nur eine der vier nach, stünde nach dem Umlegen die halbe Karte im
	// alten Zustand -- und beim Ausschalten bliebe sie rot. Genau diese Hälfte-rot-Hälfte-nicht-Lage
	// hat „Offene Wegenden" am 22.08.2026 gekostet (dort: Ringe weg, Linien blieben rot).
	// ⚠️ Kein eigener Index und keine Vorberechnung: die Regel ist ein Feldzugriff je Objekt, kein
	// Endpunktvergleich. Der Grund, warum avesmapsSyncOpenPathEndCheck seinen Index nur bei
	// eingeschaltetem Haken baut (465 ms), gilt hier nicht.
	window.avesmapsSyncWikiZuweisungCheck = function avesmapsSyncWikiZuweisungCheck() {
		if (!istVerfuegbar()) {
			return;
		}

		// 1. Orte -- zieht die Icons nach (syncLocationMarkerVisibility baut ein Icon neu, sobald sich
		//    sein Ring-Modifikator geändert hat; die Marke ist Teil davon).
		if (typeof syncLocationMarkerVisibility === "function") {
			syncLocationMarkerVisibility();
		}

		// 2. Wege -- der Saum sitzt im Stil, und der läuft sonst nur beim Anlegen des Layers.
		//    ⚠️ ALLE Wege, nicht nur die Funde: beim AUSSCHALTEN muss der Saum auch dort verschwinden,
		//    wo er eben noch lag. „Offene Wegenden" führt dafür eine Merkliste (`zuletztGefaerbt`);
		//    hier ist die Menge klein genug (6041 Wege, ein Feldzugriff je Weg), um einfach alle
		//    nachzuziehen -- eine Merkliste wäre ein zweiter Zustand, der auseinanderlaufen kann.
		if (typeof pathData !== "undefined" && Array.isArray(pathData) && typeof updatePathLayerStyle === "function") {
			pathData.forEach((path) => updatePathLayerStyle(path));
		}

		// 3. Landschaftsflächen -- Kontur über setStyle.
		if (typeof avesmapsRefreshEcosystemDisplay === "function") {
			avesmapsRefreshEcosystemDisplay();
		}

		// 4. Beschriftungen -- Halo über die Klasse am divIcon, also Icon neu bauen.
		//    💣 UND DIE KURVENLABELS DAZU. Ein gebogener Name wird auf CANVAS gemalt, nicht als
		//    divIcon (Entwurf §7.3) -- eine CSS-Klasse erreicht ihn nicht. Sein Halo kommt aus
		//    kurvenlabelHalo(), und die Ablage des Overlays ist nur nach Zoomstufe und Ausschnitt
		//    gestempelt: ohne das Verwerfen bliebe der gemalte Name in seiner alten Farbe stehen.
		//    Live betrifft das 16 der 361 offenen Beschriftungen.
		if (typeof avesmapsLabelIconsNeuBauen === "function") {
			avesmapsLabelIconsNeuBauen();
		}
		if (typeof avesmapsKurvenlabelAblageVerwerfen === "function") {
			avesmapsKurvenlabelAblageVerwerfen();
		}
	};
})();
