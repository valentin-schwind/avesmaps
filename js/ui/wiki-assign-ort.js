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
//     es haengt nur daran -- und weil es das tut, ist „dieser Ort hat keinen Wiki-Artikel" heute
//     nicht speicherbar (Discord #38, im Bericht zu Aufgabe 5 gemessen).
//
// 🔴 Dieselbe Verwechslungsklasse wie bei den Stadtplaenen (`wiki_key` gegen `wiki_url`, Entwurf §8).
// Wer hier `wiki_url` liest, wo `wiki_settlement` gemeint ist, baut die Falle nach.

// Die sechs Ortsgroessen. 🔴 STABILE SCHLUESSEL, keine Beschriftungen (AGENTS.md §2) -- dieselben
// sechs, die beide Oberflaechen als `<option value>` fuehren (index.html „location-edit-type",
// SETTLEMENT_EDIT_TYPE_OPTIONS in html/wiki-sync-settlement-editor.html) und die der Server als
// AVESMAPS_WIKI_SETTLEMENT_CLASS_LABELS kennt (api/edit/wiki/sync.php:14-21).
const AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN = ["dorf", "kleinstadt", "stadt", "grossstadt", "metropole", "gebaeude"];

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
 * ⚠️ Der Server setzt die Klasse selbst schon auf „dorf", wenn die Registry keine kennt
 * (avesmapsWikiSettlementParseInfobox: `$class = $settlementClass !== '' ? $settlementClass :
 * 'dorf'`). Diese Funktion kann den Fall also heute kaum sehen -- sie steht trotzdem streng da,
 * weil die einzige Stelle, an der geraten werden koennte, keine sein soll.
 */
function avesmapsWikiAssignOrtOrtsgroesse(settlementClass) {
	const wert = avesmapsWikiAssignOrtText(settlementClass).toLowerCase();
	return AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN.indexOf(wert) === -1 ? "" : wert;
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
 * ⚠️ `lage` fehlt mit Absicht. Der Parser liest `region` und `staat` einzeln und setzt daraus erst
 * die Anzeigezeile `lage = "Region · Staat"` zusammen (settlements.php:607-610). Beide Haelften
 * einzeln zu zeigen ist dieselbe Auskunft mit einem Feldnamen weniger -- und der Orte-Editor zeigte
 * sie ohnehin schon so.
 */
function avesmapsWikiAssignOrtWerte(quelle) {
	const q = quelle || {};
	return {
		name: avesmapsWikiAssignOrtText(q.name),
		art: avesmapsWikiAssignOrtText(q.art),
		ortsgroesse: avesmapsWikiAssignOrtOrtsgroesse(q.settlement_class),
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
 * @param {Object|null} quelle { wiki_settlement, name, feature_subtype } -- `name` und
 *   `feature_subtype` je Wert ODER Lesefunktion.
 */
function avesmapsWikiAssignOrtZustand(quelle) {
	if (!quelle || typeof quelle !== "object" || Array.isArray(quelle)) {
		throw new Error("Wiki-Ort: kein Ort gewählt — der Stand ist unbekannt.");
	}
	const kartenwerte = {};
	["name", "feature_subtype"].forEach((feld) => {
		if (typeof quelle[feld] === "function") {
			Object.defineProperty(kartenwerte, feld, {
				enumerable: true,
				get: () => avesmapsWikiAssignOrtText(quelle[feld]()),
			});
		} else {
			kartenwerte[feld] = avesmapsWikiAssignOrtText(quelle[feld]);
		}
	});
	return { artikel: avesmapsWikiAssignOrtArtikel(quelle.wiki_settlement), kartenwerte: kartenwerte };
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
 * ⚠️ Genau zwei Ziele, und mehr kann es nach der Erklaerung `ort` auch nicht geben
 * (js/ui/wiki-assign-registry.js): `name` und `feature_subtype`. Einwohnerzahl, Lage und Herrscher
 * haben auf der Karte KEIN bearbeitbares Feld -- sie sind Anzeige und stehen deshalb nie in der
 * Vorschau (Aufgabe 2: eine Zeile mit `karte: ""` kann per Definition nichts uebernehmen).
 */
function avesmapsWikiAssignOrtSyncWerte(zeilen) {
	const liste = Array.isArray(zeilen) ? zeilen : [];
	const werte = { name: null, feature_subtype: null };
	liste.forEach((zeile) => {
		if (!zeile || !Object.prototype.hasOwnProperty.call(werte, zeile.karte)) {
			return;
		}
		const wert = avesmapsWikiAssignOrtText(zeile.neu);
		werte[zeile.karte] = wert === "" ? null : wert;
	});
	return werte;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN: AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN,
		avesmapsWikiAssignOrtOrtsgroesse: avesmapsWikiAssignOrtOrtsgroesse,
		avesmapsWikiAssignOrtWerte: avesmapsWikiAssignOrtWerte,
		avesmapsWikiAssignOrtTreffer: avesmapsWikiAssignOrtTreffer,
		avesmapsWikiAssignOrtTitel: avesmapsWikiAssignOrtTitel,
		avesmapsWikiAssignOrtTrefferAnreichern: avesmapsWikiAssignOrtTrefferAnreichern,
		avesmapsWikiAssignOrtArtikel: avesmapsWikiAssignOrtArtikel,
		avesmapsWikiAssignOrtZustand: avesmapsWikiAssignOrtZustand,
		avesmapsWikiAssignOrtZuweisungsKoerper: avesmapsWikiAssignOrtZuweisungsKoerper,
		avesmapsWikiAssignOrtAntwortPruefen: avesmapsWikiAssignOrtAntwortPruefen,
		avesmapsWikiAssignOrtSyncWerte: avesmapsWikiAssignOrtSyncWerte,
	};
}
