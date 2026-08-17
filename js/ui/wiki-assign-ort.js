// Der Datenweg des ORTS -- EINE Fassung fuer BEIDE Oberflaechen (Kartendialog + Orte-Editor).
//
// Entwurf: docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md
// Bauteil: js/ui/wiki-assign.js -- das weiss nichts ueber Orte. Was objektart-eigen ist, steht hier.
// Vorbild: js/ui/wiki-assign-weg.js (Aufgabe 4), dieselbe Rollenteilung.
//
// 💣 WARUM DIESE DATEI EXISTIERT: der Ort hat ZWEI Oberflaechen in ZWEI Dokumenten -- den
// Kartendialog „Ort bearbeiten" (index.html) und den Orte-Editor im iframe
// (html/wiki-sync-settlement-editor.html) mit eigenem `window`. Keine der beiden sieht eine Funktion
// der anderen. Ohne diese Datei stuende die Abbildung „Wiki-Ortsklasse -> Kartenfeld" zweimal da.
//
// 🔴 SIE IST REIN: kein DOM, kein `fetch`, kein Zustand -- mit EINER benannten Ausnahme
// (avesmapsWikiAssignOrtTrefferAnreichern, siehe dort). Beide Oberflaechen bringen ihren eigenen
// Netzweg mit und schicken die Antwort hier durch die Pruefung.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 💣 DIE FALLE DIESER OBJEKTART -- ZWEIERLEI HEISST HIER „WIKI", UND ES SIND VERSCHIEDENE FELDER
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
//   · `properties.wiki_settlement`  -- das NEST: die geparste {{Infobox Siedlung}}, als Ganzes
//     geschrieben von `assign_to` und als Ganzes geloescht von `clear_assign`
//     (api/_internal/wiki/settlements.php). DIESE Datei arbeitet ausschliesslich damit; es ist die
//     Zuweisung.
//   · `properties.wiki_url`         -- ein FLACHES Feld daneben, das jedes Speichern des Ortes
//     mitschickt (buildLocationEditPayload, js/review/review-locations.js; buildSettlementSavePayload,
//     html/wiki-sync-settlement-editor.html) und das der Leseweg bei Leere per Namensraten wieder
//     fuellt (avesmapsEnrichMapFeatureWikiUrl, api/app/map-features.php). Es ist NICHT die Zuweisung,
//     es haengt nur daran.
//   · `properties.wiki_no_article` -- der DRITTE Zustand, seit 16.08.2026 auch vom Ort schreibbar
//     (avesmapsApplyPointWikiFields, api/_internal/map/features.php). Er sagt „ein Editor hat
//     nachgesehen, es gibt keinen Artikel", und genau diese negative Aussage laesst den Leseweg das
//     Raten unterlassen. Ohne ihn hielt kein „Entfernen" ueber ein Neuladen der Karte (Discord #38).
//
// 🔴 Dieselbe Verwechslungsklasse wie bei den Stadtplaenen (`wiki_key` gegen `wiki_url`, Entwurf §8).
// Wer hier `wiki_url` liest, wo `wiki_settlement` gemeint ist, baut die Falle nach.

// Die sechs Ortsgroessen. 🔴 STABILE SCHLUESSEL, keine Beschriftungen (AGENTS.md §2) -- dieselben
// sechs, die beide Oberflaechen als `<option value>` fuehren (index.html „location-edit-type",
// SETTLEMENT_EDIT_TYPE_OPTIONS in html/wiki-sync-settlement-editor.html) und die der Server als
// AVESMAPS_WIKI_SETTLEMENT_CLASS_LABELS kennt (api/edit/wiki/sync.php:14-21).
const AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN = ["dorf", "kleinstadt", "stadt", "grossstadt", "metropole", "gebaeude"];

// Die bearbeitbaren KARTENFELDER des Orts -- die einzige Liste davon im Browser.
//
// 🔴 SIE IST DIE GEGENPROBE ZUM FELDREGISTER, nicht seine Wiederholung: das Register erklaert, WELCHES
// Wiki-Feld auf welches Kartenfeld zeigt; diese Liste sagt, welche Kartenfelder es ueberhaupt gibt.
// Beide muessen sich decken, und genau das nagelt js/ui/__tests__/wiki-assign-ort.test.js fest --
// laeuft eines der zwei weiter, zeigt das Bauteil eine Sync-Zeile, die die Uebernahme lautlos
// ignoriert (oder umgekehrt).
//
// 🔴 DIE DREI LETZTEN SIND SEIT DEM 16.08.2026 KARTENFELDER (Owner-Entscheid). Bis dahin hatten
// Einwohner, Lage und Herrscher auf der Karte GAR KEIN Feld -- der Ort hatte damit nur die Ortsgroesse
// als Sync-Ziel, und das zentrale Beispiel des Entwurfs („beim Ort sind es fuenf, darunter
// Einwohnerzahl und Herrscher") beschrieb Felder, die es nicht gab.
// ⚠️ Sie heissen wie im Nest `properties.wiki_settlement` (einwohner/lage/oberhaupt) -- deshalb ist
// die Erklaerung im Register je eine Zeile mit gleichem `wiki` und `karte`, und niemand uebersetzt.
const AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER = ["name", "feature_subtype", "einwohner", "lage", "oberhaupt"];

function avesmapsWikiAssignOrtText(wert) {
	return String(wert === null || wert === undefined ? "" : wert).trim();
}

/**
 * REIN: die Wiki-Ortsklasse auf den Kartenschluessel abbilden. Unbekannt heisst `""`.
 *
 * 🔴 KEIN RUECKFALL, UND DAS IST DER GANZE PUNKT. Die Hausfassung `normalizeLocationType`
 * (js/routing/routing.js:37) gibt bei unbekanntem Wert `DEFAULT_LOCATION_TYPE` ("dorf") zurueck --
 * als Vorbelegung eines Auswahlfelds vertretbar, als SYNC-VORSCHLAG eine Vermutung, die echte Daten
 * schreibt: aus einer gepflegten Metropole wuerde kommentarlos ein Dorf, sobald die Klasse einmal
 * anders heisst. Genau derselbe Fehler wie `pathWikiGuessWegtyp` beim Weg (Aufgabe 4), und er ist
 * hier teurer, weil die Ortsgroesse die DARSTELLUNG entscheidet (Symbol, Radius, Label-Zoom).
 * Unbekannt heisst deshalb `""` -- die Diff-Rechnung macht daraus die Zeile „das Wiki sagt nichts —
 * würde die Angabe leeren", und die ist NIE vorangehakt (Aufgabe 2).
 *
 * 🪤 HIER STAND: „Der Server setzt die Klasse selbst schon auf ‚dorf‘, wenn die Registry keine
 * kennt … Diese Funktion kann den Fall also heute kaum sehen." Der erste Halbsatz stimmt, der
 * zweite war die Beruhigung -- und sie war falsch. Am 17.08.2026 hat der Fall die METROPOLE
 * GARETH getroffen, sichtbar gemacht vom neuen Ruecksetzer. Ein Umbau macht auch die eigenen
 * SAETZE unwahr, nicht nur die Zahlen; der Satz steht hier korrigiert statt geloescht, damit die
 * Beruhigung nicht wiederkehrt. Was den Fall jetzt abfaengt, steht direkt darunter.
 */
function avesmapsWikiAssignOrtOrtsgroesse(settlementClass, nest) {
	const wert = avesmapsWikiAssignOrtText(settlementClass).toLowerCase();
	if (AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN.indexOf(wert) === -1) {
		return "";
	}
	return avesmapsWikiAssignOrtGroesseIstGeraten(wert, nest) ? "" : wert;
}

/**
 * REIN: Ist diese Ortsklasse der geratene Rueckfall des Parsers statt einer Aussage des Wiki?
 *
 * 💣 DIE FRAGE MUSSTE AM 17.08.2026 GESTELLT WERDEN, WEIL DER RUECKSETZER SIE SICHTBAR MACHTE.
 * avesmapsWikiSettlementParseInfobox (api/_internal/wiki/settlements.php) setzt die Klasse auf
 * `'dorf'`, wenn die Wiki-KATEGORIE keine hergibt -- und schreibt die Vermutung als Datum ins Nest.
 * Bei „Gareth" war genau das der Fall: das ↺ bot an, die Metropole zum Dorf zu machen, und der
 * Owner hat es geklickt. Die Sync-Vorschau bot dieselbe Herabstufung schon seit dem 16.08.2026 an;
 * sie war nur zwei Klicks tiefer versteckt.
 *
 * 🔴 ZWEI REGELN, UND DIE ZWEITE IST DIE STUMPFE:
 *   1. Sagt das Nest `settlement_class_guessed`, gilt genau das -- eine Messung, keine Vermutung.
 *   2. FEHLT der Schluessel (jedes vor dem 17.08.2026 geschriebene Nest), gilt `'dorf'` als
 *      geraten. Das ist bewusst zu streng: eine echte Dorf-Angabe aus dem Wiki wird dann nicht
 *      mehr angeboten. Der Preis ist die SICHERE Richtung -- ein nicht angebotener Wert kostet
 *      einen Handgriff, eine kommentarlos herabgestufte Metropole kostet Daten. Die Strenge
 *      loest sich mit jedem Abgleich von selbst auf, weil das Nest dann den Schluessel traegt.
 *
 * ⚠️ Sie gilt NUR fuer `'dorf'`. Jede andere Klasse kann der Parser gar nicht raten.
 */
function avesmapsWikiAssignOrtGroesseIstGeraten(klasse, nest) {
	if (klasse !== "dorf") {
		return false;
	}
	const n = (nest && typeof nest === "object" && !Array.isArray(nest)) ? nest : {};
	if (Object.prototype.hasOwnProperty.call(n, "settlement_class_guessed")) {
		return n.settlement_class_guessed === true;
	}
	return true; // altes Nest -- nicht unterscheidbar, also die sichere Richtung
}

/**
 * REIN: die Werte, die die Erklaerung `ort` erwartet -- aus dem Nest `properties.wiki_settlement`,
 * aus der Antwort von `assign_to`/`?action=preview` (beides dasselbe Objekt,
 * avesmapsWikiSettlementParseInfobox) oder aus einer Suchzeile (die traegt nur `settlement_label`).
 *
 * 🔴 `ortsgroesse` ist ABGELEITET, nicht geliefert: `settlement_class` ist der Wert des Servers,
 * `ortsgroesse` derselbe Wert NACH der Pruefung gegen die sechs Schluessel. Er steht unter eigenem
 * Namen, damit die rohe Wiki-Angabe daneben sichtbar bleibt -- der Editor soll sehen, WAS das Wiki
 * sagt („Art": freier Infoboxtext) und WOHIN das abgebildet wird.
 *
 * 🔴 `lage` IST SEIT DEM 16.08.2026 DABEI, und zwar als Kartenziel. Der Parser liest `region` und
 * `staat` einzeln und setzt daraus erst `lage = "Region · Staat"` zusammen (settlements.php:607-610)
 * -- es ist also ein ABGELEITETES Wiki-Feld, wie `ortsgroesse` daneben. Die zwei Haelften bleiben
 * trotzdem stehen: sie sind eigene Infoboxfelder und muessen im Register eine Erklaerung tragen,
 * sonst meldet Pruefung 2 sie als vergessen. Angezeigt werden damit drei Zeilen, die dasselbe sagen
 * -- gewollt: nur EINE davon hat ein Kartenfeld, und das ist die, die der Sync fuellen kann.
 */
function avesmapsWikiAssignOrtWerte(quelle) {
	const q = quelle || {};
	return {
		name: avesmapsWikiAssignOrtText(q.name),
		art: avesmapsWikiAssignOrtText(q.art),
		// ⚠️ Das GANZE Nest reist mit, nicht nur die Klasse: nur dort steht, ob sie geraten ist.
		ortsgroesse: avesmapsWikiAssignOrtOrtsgroesse(q.settlement_class, q),
		lage: avesmapsWikiAssignOrtText(q.lage),
		einwohner: avesmapsWikiAssignOrtText(q.einwohner),
		bevoelkerung: avesmapsWikiAssignOrtText(q.bevoelkerung),
		oberhaupt: avesmapsWikiAssignOrtText(q.oberhaupt),
		region: avesmapsWikiAssignOrtText(q.region),
		staat: avesmapsWikiAssignOrtText(q.staat),
		handelszone: avesmapsWikiAssignOrtText(q.handelszone),
		verkehrswege: avesmapsWikiAssignOrtText(q.verkehrswege),
		tempel: avesmapsWikiAssignOrtText(q.tempel),
		// Nur fuer die zweite Trefferzeile („Stadt", „Dorf") -- das EINZIGE Anzeigefeld, das die
		// Suche ueberhaupt liefert (siehe avesmapsWikiAssignOrtTreffer).
		settlement_label: avesmapsWikiAssignOrtText(q.settlement_label),
	};
}

/**
 * REIN: eine Zeile der Server-Suche (`?action=search`) in die Treffer-Form des Bauteils.
 *
 * 💣 DIE SUCHE LIEFERT KEINE INFOBOXWERTE. Gemessen an avesmapsWikiSettlementSearch
 * (api/_internal/wiki/settlements.php:710-758): sie liest `wiki_sync_pages` und gibt genau
 * `title, name, wiki_key, settlement_class, settlement_label, wiki_url` heraus -- kein `art`, kein
 * `einwohner`, kein `oberhaupt`. Die Infobox wird erst beim ZUWEISEN geparst
 * (avesmapsWikiSettlementBuildFromTitle). Deshalb traegt die Trefferzeile hier nur die Ortsgroesse
 * -- wortgleich zu dem, was der alte Picker zeigte (`row.settlement_label`) --, und der
 * Zuweisungskasten wird nach dem Schreiben nachgereicht
 * (avesmapsWikiAssignOrtTrefferAnreichern). Wer das uebersieht, baut einen Kasten, der nach der
 * Wahl nur den Namen zeigt, obwohl der Server gerade alles geliefert hat.
 *
 * 🔴 `roh` reist mit, weil `assign_to` den TITEL will, nicht den `wiki_key`
 * (avesmapsWikiSettlementAssignTo nimmt `title`). Der Schluessel ist beim Ort Anzeige, die Adresse
 * ist der Titel.
 */
function avesmapsWikiAssignOrtTreffer(zeile) {
	const z = zeile || {};
	return {
		name: avesmapsWikiAssignOrtText(z.name) || avesmapsWikiAssignOrtText(z.title),
		wiki_url: avesmapsWikiAssignOrtText(z.wiki_url),
		wiki_key: avesmapsWikiAssignOrtText(z.wiki_key),
		werte: avesmapsWikiAssignOrtWerte(z),
		roh: z,
	};
}

/** REIN: der Titel, unter dem `assign_to` diesen Treffer kennt. Leer heisst „nicht zuweisbar". */
function avesmapsWikiAssignOrtTitel(treffer) {
	const t = treffer || {};
	const roh = t.roh || {};
	return avesmapsWikiAssignOrtText(roh.title) || avesmapsWikiAssignOrtText(t.name);
}

/**
 * 🔴 DIE EINE UNREINE FUNKTION DIESER DATEI -- SIE VERAENDERT DEN UEBERGEBENEN TREFFER, und das ist
 * ihr Zweck, kein Versehen.
 *
 * 💣 WARUM ES SO SEIN MUSS: `trefferWaehlen` (js/ui/wiki-assign.js) uebernimmt `treffer.werte` in
 * den Artikel -- und zwar NACHDEM `zuweisen` aufgeloest hat. Die Suchzeile bringt aber nur die
 * Ortsgroesse mit; die Infoboxwerte entstehen erst im Schreibvorgang und kommen in dessen Antwort
 * (`assign_to` -> `settlement`) bzw. beim Anlegen in `?action=preview` -> `settlement` zurueck.
 * Ohne diese Zeile staende der Zuweisungskasten unmittelbar nach der Wahl fast leer da, obwohl der
 * Server alles geliefert hat -- und erst ein Neuoeffnen des Dialogs zeigte die Angaben.
 *
 * ⚠️ Der Weg hatte das Problem nicht: dort traegt schon die SUCHE alle Anzeigefelder
 * (avesmapsWikiPathSearch, Suchspalten). Der Ort ist die erste Objektart, bei der die Werte aus der
 * SCHREIB-Antwort kommen. Deshalb steht die Erklaerung hier und nicht im Bauteil: eine Objektart,
 * deren Suche schon alles liefert, braucht sie nicht.
 *
 * 🔴 `roh` bleibt die SUCHZEILE. Sie traegt den Titel, unter dem der Server den Ort kennt, und ein
 * spaeterer Griff darauf soll nicht davon abhaengen, ob eine Anreicherung stattgefunden hat.
 */
function avesmapsWikiAssignOrtTrefferAnreichern(treffer, settlement) {
	if (!treffer || !settlement || typeof settlement !== "object") {
		return treffer;
	}
	treffer.werte = avesmapsWikiAssignOrtWerte(settlement);
	treffer.name = avesmapsWikiAssignOrtText(settlement.name)
		|| avesmapsWikiAssignOrtText(settlement.title)
		|| treffer.name;
	treffer.wiki_url = avesmapsWikiAssignOrtText(settlement.wiki_url) || treffer.wiki_url;
	treffer.wiki_key = avesmapsWikiAssignOrtText(settlement.wiki_key) || treffer.wiki_key;
	return treffer;
}

/**
 * REIN: das Nest `properties.wiki_settlement` in die Artikel-Form des Bauteils. `null` heisst
 * „nichts zugewiesen" -- ein gueltiger Zustand, kein Fehler.
 *
 * ⚠️ Die Identitaet haengt am TITEL, nicht am Schluessel: beim Anlegen merkt sich der Kartendialog
 * eine Wahl, bevor irgendetwas geschrieben ist (`locationEditPendingWikiSettlement`), und die
 * Typeahead-Zeile des Namensfeldes legt dort nur `{title, name, wiki_url}` ab. Ein Riegel auf
 * `wiki_key` liesse diese Wahl unsichtbar -- der Schluessel entsteht erst beim Parsen.
 */
function avesmapsWikiAssignOrtArtikel(wikiSettlement) {
	const w = wikiSettlement || null;
	if (!w || typeof w !== "object") {
		return null;
	}
	const titel = avesmapsWikiAssignOrtText(w.title) || avesmapsWikiAssignOrtText(w.name);
	if (titel === "") {
		return null;
	}
	return {
		name: avesmapsWikiAssignOrtText(w.name) || titel,
		wiki_url: avesmapsWikiAssignOrtText(w.wiki_url),
		wiki_key: avesmapsWikiAssignOrtText(w.wiki_key),
		werte: avesmapsWikiAssignOrtWerte(w),
	};
}

/**
 * 🔴 DER ZUSTAND -- UND ER WIRFT, STATT ETWAS LEERES ZU LIEFERN.
 *
 * Der Vertrag aus dem Kopfkommentar von js/ui/wiki-assign.js: ein `laden`, das im Fehlerfall
 * AUFLOEST, ist ununterscheidbar von „nichts zugewiesen". Das Bauteil malte dann den offenen
 * Zustand, `lies()` gaebe Leerstrings, und `bereit` bliebe `true`.
 *
 * ⚠️ Beide Ort-Oberflaechen lesen ihren Stand aus dem SPEICHER (der Kartendialog aus dem
 * Marker-Eintrag, der Orte-Editor aus seinem geladenen Detail) -- hier laeuft kein HTTP. Der
 * Fehlerfall ist deshalb „es steht gar kein Ort da", und der wird genauso behandelt: geworfen.
 *
 * 💣 DIE KARTENWERTE WERDEN ERST BEIM LESEN GEHOLT, wenn der Aufrufer eine Funktion uebergibt.
 * Der Grund ist derselbe wie beim Weg (Aufgabe 4) und hier noch schaerfer, weil es ZWEI Ziele gibt:
 * `laden` laeuft EINMAL, die Sync-Vorschau entsteht erst beim Druck auf „Sync" -- dazwischen kann
 * der Editor Namensfeld und Groessenauswahl angefasst haben. Eingefroren verglichen boete die
 * Vorschau eine Aenderung an, die das Formular daneben laengst zeigt.
 *
 * 🔴 DER DRITTE ZUSTAND REIST MIT (`kein_artikel`). Er ist NICHT aus der Zuweisung ableitbar: „keine
 * Zuweisung" heisst „noch niemand hat nachgesehen", der Merker heisst „jemand HAT nachgesehen und es
 * gibt keinen". Genau diese negative Aussage fehlte dem Leseweg, weshalb ein entferntes
 * `properties.wiki_url` beim naechsten Kartenladen zurueckgeraten wurde (Discord #38).
 *
 * @param {Object|null} quelle { wiki_settlement, kein_artikel, name, feature_subtype, einwohner,
 *   lage, oberhaupt } -- jedes Kartenfeld je Wert ODER Lesefunktion.
 */
function avesmapsWikiAssignOrtZustand(quelle) {
	if (!quelle || typeof quelle !== "object" || Array.isArray(quelle)) {
		throw new Error("Wiki-Ort: kein Ort gewählt — der Stand ist unbekannt.");
	}
	const kartenwerte = {};
	AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER.forEach((feld) => {
		if (typeof quelle[feld] === "function") {
			Object.defineProperty(kartenwerte, feld, {
				enumerable: true,
				get: () => avesmapsWikiAssignOrtText(quelle[feld]()),
			});
		} else {
			kartenwerte[feld] = avesmapsWikiAssignOrtText(quelle[feld]);
		}
	});
	return {
		artikel: avesmapsWikiAssignOrtArtikel(quelle.wiki_settlement),
		keinArtikel: quelle.kein_artikel === true,
		kartenwerte: kartenwerte,
		herkunft: avesmapsWikiAssignOrtHerkunft(quelle.field_origins),
	};
}

/**
 * REIN: `properties.field_origins` -> die Herkunftskarte der fuenf KARTENFELDER.
 *
 * 🔴 GEFILTERT AUF DIE FUENF ZIELE, nicht roh durchgereicht -- wortgleiche Begruendung wie bei der
 * Literatur (js/ui/wiki-assign-literatur.js): ein Eintrag fuer ein Feld ohne Zeile waere Ballast in
 * einer Karte, die ueber das Vorhaekeln entscheidet, und liest sich beim naechsten Mal wie eine Regel.
 *
 * ⚠️ Alles ausser `'manual'`/`'wiki'` faellt heraus. Eine kuenftige dritte Herkunft darf weder die
 * Beschriftung braun faerben noch vorhaken, sondern muss auf „nicht bekannt" zurueckfallen -- also
 * auf das Verhalten, das vor dem 17.08.2026 galt.
 */
function avesmapsWikiAssignOrtHerkunft(herkunft) {
	const h = (herkunft && typeof herkunft === "object" && !Array.isArray(herkunft)) ? herkunft : {};
	const karte = {};
	AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER.forEach((feld) => {
		const wert = avesmapsWikiAssignOrtText(h[feld]);
		if (wert === "manual" || wert === "wiki") {
			karte[feld] = wert;
		}
	});
	return karte;
}

/** REIN: der Rumpf der Zuweisung. Beide Oberflaechen schicken denselben -- mit `dry_run:false` UND
 *  `confirm:"apply"`, weil der Endpunkt sonst nur probeweise rechnet (api/edit/wiki/settlements.php).
 *  🔴 `title`, nicht `wiki_key`: avesmapsWikiSettlementAssignTo schlaegt die Seite ueber den Titel
 *  nach (settlements.php:807) -- der Schluessel entsteht dort erst als Ergebnis. */
function avesmapsWikiAssignOrtZuweisungsKoerper(title, publicId) {
	return {
		action: "assign_to",
		title: avesmapsWikiAssignOrtText(title),
		public_id: avesmapsWikiAssignOrtText(publicId),
		dry_run: false,
		confirm: "apply",
	};
}

/**
 * 🔴 WIRFT BEI JEDEM NEIN DES SERVERS.
 *
 * ⚠️ Anders als beim Weg gibt es hier KEINEN Typriegel mit HTTP 200 (`type_ok`): der Ort-Endpunkt
 * kennt ihn nicht. Was es gibt, ist `{ok:false}` samt `error.message` und -- bei `assign_to` --
 * die Moeglichkeit, dass die Seite gar keine {{Infobox Siedlung}} traegt; dann wirft der Server
 * schon serverseitig und antwortet mit `ok:false`. Ein `applied:0` bei `ok:true` waere ein
 * Trockenlauf; der kommt nur, wenn jemand `dry_run` schickt, und das tut der Rumpf oben nicht.
 */
function avesmapsWikiAssignOrtAntwortPruefen(antwort) {
	if (!antwort || typeof antwort !== "object" || Array.isArray(antwort) || antwort.ok !== true) {
		const meldung = antwort && antwort.error
			? (antwort.error.message || antwort.error)
			: "Unerwartete Antwort";
		throw new Error(String(meldung));
	}
	return antwort;
}

/**
 * REIN: welche Kartenfelder die ANGEHAKTEN Sync-Zeilen setzen wollen. `null` heisst „diese Angabe
 * ist nicht dabei".
 *
 * 🔴 DIE ZIELE KOMMEN AUS `AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER`, nicht aus einer zweiten Liste hier.
 * Bis zum 16.08.2026 standen die zwei Namen hier ausgeschrieben; mit den drei neuen Feldern waeren es
 * fuenf an zwei Stellen gewesen, und ein sechstes im Register haette eine Sync-Zeile erzeugt, die
 * diese Funktion lautlos verwirft -- das Bauteil zeigt sie, der Haken tut nichts.
 *
 * ⚠️ Ein Feld ohne Kartenziel (`karte: ""`, z. B. „Art" oder „Tempel") kann hier gar nicht ankommen:
 * die Diff-Rechnung nimmt solche Zeilen erst gar nicht auf (Aufgabe 2).
 */
function avesmapsWikiAssignOrtSyncWerte(zeilen) {
	const liste = Array.isArray(zeilen) ? zeilen : [];
	const werte = {};
	AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER.forEach((feld) => { werte[feld] = null; });
	liste.forEach((zeile) => {
		if (!zeile || !Object.prototype.hasOwnProperty.call(werte, zeile.karte)) {
			return;
		}
		const wert = avesmapsWikiAssignOrtText(zeile.neu);
		werte[zeile.karte] = wert === "" ? null : wert;
	});
	return werte;
}

/**
 * REIN: hat die Uebernahme ueberhaupt etwas zu tun? `avesmapsWikiAssignOrtSyncWerte` gibt fuenf
 * Schluessel zurueck, und beide Oberflaechen mussten bisher zwei davon einzeln abfragen.
 *
 * 💣 Genau diese Abfrage waere beim Wachsen der Feldliste stehengeblieben: „nichts angehakt" haette
 * dann bei einer allein angehakten Einwohnerzahl `true` gesagt, die Oberflaeche haette geworfen, und
 * das Bauteil haette die Ablehnung als „es ist nichts passiert" gelesen -- ein Haken, der nichts tut.
 */
function avesmapsWikiAssignOrtSyncLeer(werte) {
	const w = werte || {};
	return AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER.every((feld) => w[feld] === null || w[feld] === undefined);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN: AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN,
		AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER: AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER,
		avesmapsWikiAssignOrtSyncLeer: avesmapsWikiAssignOrtSyncLeer,
		avesmapsWikiAssignOrtOrtsgroesse: avesmapsWikiAssignOrtOrtsgroesse,
		avesmapsWikiAssignOrtGroesseIstGeraten: avesmapsWikiAssignOrtGroesseIstGeraten,
		avesmapsWikiAssignOrtWerte: avesmapsWikiAssignOrtWerte,
		avesmapsWikiAssignOrtTreffer: avesmapsWikiAssignOrtTreffer,
		avesmapsWikiAssignOrtTitel: avesmapsWikiAssignOrtTitel,
		avesmapsWikiAssignOrtTrefferAnreichern: avesmapsWikiAssignOrtTrefferAnreichern,
		avesmapsWikiAssignOrtArtikel: avesmapsWikiAssignOrtArtikel,
		avesmapsWikiAssignOrtZustand: avesmapsWikiAssignOrtZustand,
		avesmapsWikiAssignOrtHerkunft: avesmapsWikiAssignOrtHerkunft,
		avesmapsWikiAssignOrtZuweisungsKoerper: avesmapsWikiAssignOrtZuweisungsKoerper,
		avesmapsWikiAssignOrtAntwortPruefen: avesmapsWikiAssignOrtAntwortPruefen,
		avesmapsWikiAssignOrtSyncWerte: avesmapsWikiAssignOrtSyncWerte,
	};
}
