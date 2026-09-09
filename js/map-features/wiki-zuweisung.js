// „Hat dieses Kartenobjekt eine Wiki-Zuweisung?" -- die EINE Regel hinter dem Pruefhaken
// „Keine Wiki-Zuweisung" (Owner 01.09.2026: „das objekt ohne wiki-eintrag auffaellig rot
// markieren", egal ob Ort, Flaeche oder Weg).
//
// 🔴 SIE IST REIN: kein DOM, kein `fetch`, kein Modulzustand. Jeder Zeichner reicht sein Objekt
// herein und bekommt einen von drei Zustaenden zurueck. Die FELDER holt jede Objektart selbst --
// die vier Zeichner bekommen verschiedene Formen aus verschiedenen Endpunkten --, aber die REGEL
// steht nur hier. Dasselbe Muster wie js/ui/listen-statuskreis.js, aus demselben Grund.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 💣 GEMESSEN WIRD DAS ZUWEISUNGSFELD, NIE DAS DANEBENSTEHENDE `wiki_url`
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// `properties.wiki_url` ist eine ABGELEITETE Adresse, keine Zuweisung. Bis zum 08.09.2026 riet der
// Lesepfad sie bei Leere sogar aus dem NAMEN nach (99 Phantome bei den Orten, 12 bei den Wegen);
// dieser Rateweg ist mit `420f12cfc` gefallen, aber `avesmapsEnrichMapFeatureWikiUrl` liefert
// weiterhin ein GESPEICHERTES flaches Feld als Rueckfall fuer Objekte OHNE Zuweisung -- ein Haken,
// der es liest, faerbt also weiter Objekte gruen, die niemand zugewiesen hat. Die Zuweisung ist das
// NEST:
//     Ort           location.wikiSettlement.wiki_key   (payload: properties.wiki_settlement)
//     Weg           properties.wiki_path.wiki_key      (Name ueber getPathTitleName, s. u.)
//     Beschriftung  label.wikiRegion.wiki_key          (payload: properties.wiki_region)
//     Flaeche       area.wiki_region_key               (Endpunkt api/app/ecosystem-areas.php)
// Es sind dieselben vier Familien, die auch der Statuskreis vergleicht (AGENTS.md §11).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Am Livebestand vom 01.09.2026 gemessen -- was dieser Haken faerbt:
//     Orte           988 offen,  1923 zugewiesen   (+ 2079 Kreuzungen = ausserhalb)
//     Wege           268 offen,  1975 zugewiesen   (3798 ohne Menschennamen = ausserhalb)
//     Flaechen       889 offen,   426 zugewiesen   (8 Klimabaender = ausserhalb)
//     Beschriftungen 361 offen,   616 zugewiesen
// Zusammen 2506 offene Objekte.
// ⚠️ Die 6 Orte, die bis zum 09.09.2026 als „nachgesehen" blass markiert waren, stehen seit dem
// Ausbau des Merkers in dieser Spalte mit -- 982 + 6. Sie sind nicht neu, sie sind nur nicht mehr
// unterschieden.
// ⚠️ IM BROWSER GEZAEHLT, nicht in der rohen Nutzlast -- die beiden weichen ab, und der Browser hat
// recht: er erkennt eine Kreuzung zusaetzlich am Namen (isCrossingName, letzter Rueckfall), und er
// schreibt die Wegenamen beim Laden um. Wer diese Zahlen an der Nutzlast nachrechnet, bekommt 983
// Orte und alle 6041 Wege als „ohne Namen".
// 💣 DAS IST DER GRUND, WARUM DIESER HAKEN NICHTS EINBLENDET. Die drei Pruefhaken neben ihm tun das
// (resolveLocationCheckFinding, „ein Pruefhaken ZEIGT seine Funde“, Owner 14.08.2026) -- richtig fuer
// eine Handvoll Anbindungsluecken, die man sonst wegzoomt. 988 Orte sind aber ein DRITTEL aller 2911
// Orte: eingeblendet waere das keine Fundstelle mehr, sondern eine zweite Ortsebene. Und der Owner
// hat „markieren“ gesagt, nicht „einblenden“. Naeheres am Riegel in
// map-features-location-marker-rendering.js.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 ES GIBT DREI ZUSTAENDE -- „nachgesehen, es gibt keinen Artikel" IST GEFALLEN (09.09.2026)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Der vierte Zustand kam aus `properties.wiki_no_article`, und dieser Merker ist auf Owner-Entscheid
// global ausgebaut. Sein Aequivalent ist die ZUWEISUNG selbst: wer sich frueher des Merkers
// bediente, fragt das Nest ab.
//
// 💣 WARUM ES IHN GAB -- damit ihn niemand wieder einfuehrt: er war der Notausgang gegen das
// Namensraten der Kartennutzlast (Discord #38). Bis zum 08.09.2026 fuellte
// `avesmapsEnrichMapFeatureWikiUrl` (api/app/map-features.php) die Adresse aus dem NAMEN des
// Objekts; eine geloeste Zuweisung kam beim naechsten Lesen zurueck, also brauchte es eine zweite,
// NEGATIVE Aussage, damit 》Trennen《 ueberhaupt halten konnte. Commit `420f12cfc` hat den Rateweg
// zurueckgebaut -- der Server schlaegt nichts mehr vor, 》Trennen《 haelt von allein, und der Merker
// hat keinen Gegenstand mehr.
//
// ⚠️ DER PREIS IST BENANNT UND GEWOLLT: die Unterscheidung „nachgesehen, es gibt nichts" gegen „hat
// noch niemand angesehen" gibt es nicht mehr. Die 10 Traeger waren ohnehin markiert, nur blasser;
// vollstaendig ausgenommen waren sie allein in der Konfliktliste. Wer die Unterscheidung vermisst,
// hat KEINEN Fehler gefunden -- er sieht die Entscheidung.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// Die drei Zustaende. "" heisst „nicht im Umfang" und ist KEIN Befund -- ein Objekt, das gar
// keinen Artikel haben kann, ist nicht offen, sondern gar nicht gemeint.
const AVESMAPS_WIKI_ZUWEISUNG_ZUGEWIESEN = "zugewiesen";
const AVESMAPS_WIKI_ZUWEISUNG_OFFEN = "offen";         // der eigentliche Befund
const AVESMAPS_WIKI_ZUWEISUNG_AUSSERHALB = "";

function avesmapsWikiZuweisungText(wert) {
	return String(wert === null || wert === undefined ? "" : wert).trim();
}

/**
 * Der Zuweisungszustand eines ORTES.
 * 🔴 KREUZUNGEN sind ausserhalb: sie sind Knoten des Routennetzes, keine Orte, und koennen keinen
 * Artikel haben. Live sind es 2079 von 4990 Ortseintraegen -- ohne den Riegel waere die Karte im
 * Kreuzungsmodus vor allem rot.
 * ⚠️ `locationType` ist die BEREITS AUFGELOESTE Art, nicht das rohe `feature_subtype` der Nutzlast.
 * Der Browser erkennt eine Kreuzung ueber drei Kanaele (feature_type, subtype und -- als letzten
 * Rueckfall -- den Namen, resolveLocationTypeFromFeature in map-features-location-lookup.js); genau
 * einer der 2079 haengt am Namensrueckfall. Wer hier das rohe Feld hereinreicht, faerbt ihn.
 */
function avesmapsWikiZuweisungOrt(location, locationType) {
	const typ = avesmapsWikiZuweisungText(locationType);
	const kreuzung = typeof CROSSING_LOCATION_TYPE !== "undefined" ? CROSSING_LOCATION_TYPE : "crossing";
	if (typ === kreuzung) { return AVESMAPS_WIKI_ZUWEISUNG_AUSSERHALB; }
	const ort = location || {};

	return avesmapsWikiZuweisungText(ort.wikiSettlement && ort.wikiSettlement.wiki_key) !== ""
		? AVESMAPS_WIKI_ZUWEISUNG_ZUGEWIESEN
		: AVESMAPS_WIKI_ZUWEISUNG_OFFEN;
}

/**
 * Der Zuweisungszustand eines WEGES.
 *
 * 🔴 MASCHINELL BENANNTE SEGMENTE SIND AUSSERHALB -- Owner-Entscheid 01.09.2026, und dieselbe
 * Begruendung wie in der Konfliktzentrale: ein „Strasse-17" kann per Konstruktion keinen
 * Wiki-Artikel haben. Am Livebestand gemessen: von 6041 Wegen tragen nur 2236 einen von Menschen
 * gegebenen Namen; 1968 davon sind zugewiesen, OFFEN bleiben 268. Ohne den Riegel waeren es 4066 --
 * also vor allem Rauschen.
 *
 * 💣 DIE NAMENSFRAGE BEANTWORTET DER AUFRUFER, UND DAS IST DIE GANZE POINTE DIESER SIGNATUR.
 * Hier stand bis zum 01.09.2026 eine eigene Nachbildung der Regel („heisst der Weg <Art>-<n>?"),
 * gelesen aus `properties.name`. Sie war zweimal falsch:
 *   1. Das FELD stimmte nicht. Im Browser traegt `properties.name` den MASCHINENnamen und
 *      `display_name`/`original_name` den echten -- normalizeRoutePathFeature schreibt das beim
 *      Laden um (map-features-path-prepare.js). Gemessen: die Nachbildung erklaerte ALLE 6041 Wege
 *      fuer maschinell und der Haken faerbte keinen einzigen. In der rohen Nutzlast stimmte
 *      dieselbe Zeile noch -- der Test, der die Nutzlast las, war gruen.
 *   2. Es war die VIERTE Abschrift derselben Regel. Sie steht in PHP
 *      (avesmapsWikiPathNameIsGeneric, api/_internal/wiki/path-naming.php), im Router
 *      (shouldShowRoutePathDisplayName, js/routing/route-node.js) und faehrt von dort in
 *      `getPathTitleName` (map-features-path-domain.js) -- „wie heisst dieser Weg fuer einen
 *      Menschen, und heisst er ueberhaupt?". Genau diese Frage ist gemeint.
 * ⚠️ `getPathTitleName` heilt nebenbei 7 Faelle, die die Nachbildung falsch hatte: ein Weg, der dem
 * Wiki-Artikel „Seeweg" zugewiesen ist, TRAEGT einen Namen -- er sieht nur aus wie eine Wegart.
 *
 * @param properties     die Eigenschaften des Weges (das Nest `wiki_path`, der Merker)
 * @param hatEchtenNamen `true`, wenn ein Mensch diesem Weg einen Namen gegeben hat
 *                       (`getPathTitleName(path) !== ""`). Der Pruefer errechnet das NICHT selbst.
 */
function avesmapsWikiZuweisungWeg(properties, hatEchtenNamen) {
	if (hatEchtenNamen !== true) {
		return AVESMAPS_WIKI_ZUWEISUNG_AUSSERHALB;
	}
	const p = properties || {};

	return avesmapsWikiZuweisungText(p.wiki_path && p.wiki_path.wiki_key) !== ""
		? AVESMAPS_WIKI_ZUWEISUNG_ZUGEWIESEN
		: AVESMAPS_WIKI_ZUWEISUNG_OFFEN;
}

/**
 * Der Zuweisungszustand einer LANDSCHAFTSBESCHRIFTUNG.
 * ⚠️ Die Beschriftung traegt ihre Zuweisung UNABHAENGIG von der Flaeche -- der Statuskreis fuehrt
 * beide seit jeher als zwei getrennte Bits (linke Haelfte Label, rechte Flaeche). Eine Landschaft
 * kann eine zugewiesene Flaeche und eine unzugewiesene Beschriftung haben; beide werden markiert.
 */
function avesmapsWikiZuweisungBeschriftung(label) {
	const l = label || {};

	return avesmapsWikiZuweisungText(l.wikiRegion && l.wikiRegion.wiki_key) !== ""
		? AVESMAPS_WIKI_ZUWEISUNG_ZUGEWIESEN
		: AVESMAPS_WIKI_ZUWEISUNG_OFFEN;
}

/**
 * Der Zuweisungszustand einer LANDSCHAFTSFLAECHE.
 * ⚠️ KLIMABAENDER sind ausserhalb: sie sind ABGELEITET (aus den Trennlinien gerechnet, nicht
 * gezeichnet) und haben nie einen Wiki-Artikel. Live sind es 8.
 * ⭐ SIE WAR DIE VORLAGE. Der vierte Zustand war bei den Landschaftsflaechen schon am 16.08.2026
 * mit ihrem Haekchen gefallen; seit dem 09.09.2026 sehen alle vier Pruefer so aus wie dieser hier.
 * Wer einer Objektart wieder eine Sonderform gibt, baut die Divergenz zurueck, die der Ausbau
 * beseitigt hat.
 */
function avesmapsWikiZuweisungFlaeche(area) {
	const a = area || {};
	if (avesmapsWikiZuweisungText(a.kind) === "klima") { return AVESMAPS_WIKI_ZUWEISUNG_AUSSERHALB; }

	return avesmapsWikiZuweisungText(a.wiki_region_key) !== ""
		? AVESMAPS_WIKI_ZUWEISUNG_ZUGEWIESEN
		: AVESMAPS_WIKI_ZUWEISUNG_OFFEN;
}

/**
 * Traegt dieser Zustand eine Markierung? „zugewiesen" und „ausserhalb" bleiben unberuehrt.
 * 💣 GENAU EIN Zustand wird markiert, und die Pruefung ist deshalb eine GLEICHHEIT, keine Liste.
 * Bis zum 09.09.2026 standen hier zwei Zustaende mit `||`; waere nur ihr Erzeuger gefallen und die
 * Verzweigung geblieben, haette sie fuer einen Wert `true` geliefert, den niemand mehr erzeugt --
 * eine tote Verzweigung, die der naechste Leser fuer lebende Regel haelt.
 */
function avesmapsWikiZuweisungMarkiert(zustand) {
	return zustand === AVESMAPS_WIKI_ZUWEISUNG_OFFEN;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_WIKI_ZUWEISUNG_ZUGEWIESEN,
		AVESMAPS_WIKI_ZUWEISUNG_OFFEN,
		AVESMAPS_WIKI_ZUWEISUNG_AUSSERHALB,
		avesmapsWikiZuweisungOrt,
		avesmapsWikiZuweisungWeg,
		avesmapsWikiZuweisungBeschriftung,
		avesmapsWikiZuweisungFlaeche,
		avesmapsWikiZuweisungMarkiert,
	};
}
