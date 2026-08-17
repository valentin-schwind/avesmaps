// Der Datenweg der KARTE (Stadtplan) -- die Objektart, bei der schon ZWEIERLEI „wiki" heisst.
//
// Entwurf: docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md (§8 ist
// diese Aufgabe). Bauteil: js/ui/wiki-assign.js -- das weiss nichts ueber Karten. Vorbild:
// js/ui/wiki-assign-literatur.js (Aufgabe 8), die dieselbe Lage hat (kein Wiki-Nest, Suchendpunkt
// erst mit der Aufgabe entstanden).
//
// 🔴 SIE IST REIN: kein DOM, kein `fetch`, kein Zustand. Die Oberflaeche bringt ihren Netzweg mit
// und schickt die Antworten hier durch.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 💣 DIE FALLE DIESER OBJEKTART -- DREI DINGE, DIE ALLE „wiki" HEISSEN. GEMESSEN AM 16.08.2026
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
//   `citymap.wiki_key`   BAUSCHLUESSEL aus vier Teilen, `index:stadt:quelle:variante`
//                        (avesmapsCitymapWikiKey, api/_internal/wiki/citymap-sync.php:103; gebaut
//                        :584/:754/:818). Er sagt, aus welcher INDEX-SEITE die Zeile stammt.
//                        KEINE Seitenidentitaet. 🔴 Unangetastet -- daran haengt der Abgleich.
//   `citymap.map_url`    der Karten-Link. Bei einer Wiki-Karte aus der QUELLE gebaut, also aus der
//                        Publikation (avesmapsCitymapWikiUrlForSource, :1508): er zeigt auf das
//                        BUCH, in dem die Karte steckt, nie auf die Karte. 🔴 Unangetastet.
//   `citymap.article_*`  DER EIGENE ARTIKEL DER KARTE -- was diese Datei bedient.
//
// 🪤 Und eine Spalte `citymap.wiki_url` GIBT ES NICHT. Entwurf §8 fuehrt sie in seiner Tabelle;
// nachgemessen ist das `map_url`. Der Vermerk steht hier, damit die falsche Angabe nicht das
// naechste Mal als Beleg wiederkehrt.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WAS DIESE OBJEKTART SONST VON DEN UEBRIGEN UNTERSCHEIDET
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// 1. EINE Oberflaeche, nicht zwei. Gezaehlt, nicht angenommen: `grep -rln citymap --include=*.html
//    html/` liefert zwei Dateien, und eine davon (html/game-literature-editor.html) nennt das Wort
//    nur nebenbei. Der Kartendialog auf der Karte selbst
//    (js/map-features/map-features-citymaps-dialog.js, 434 Zeilen) zeigt nur an und hat genau EINEN
//    Schreibknopf -- der oeffnet den Editor. Es bleibt html/citymap-editor.html.
//
// 2. KEIN KARTENZIEL, ALSO KEIN SYNC-KNOPF. Die weisse Liste des Schreibwegs fuehrt Titel, Links,
//    Lizenzen, Art, Format, BF-Jahre, Urheber, Verlag und Notiz -- zu KEINEM davon sagt eine
//    Registry-Zeile etwas: sie beschreibt die SEITE, nicht die Karte. Dieselbe Bauform wie bei den
//    Kraftlinien (`sync: false`), und deshalb hat diese Datei auch keine `…SyncWerte`-Funktion:
//    es gaebe nichts zu uebernehmen.
//
// 3. 💣 KEIN WIKI-NEST. `citymap` hat kein `properties_json`; gespeichert werden nur
//    article_url/article_key/article_title, also reine Identitaet. Die Anzeigewerte des Kastens
//    (Seitenart, Kontinent) stehen in der Registry und muessen eigens geholt werden
//    (`?action=entry&title=…`) -- sonst zeigte der Kasten sie genau einmal, direkt nach der Wahl,
//    und nach dem naechsten Oeffnen nicht mehr. Dieselbe Lage wie bei der Literatur.
//
// 4. 🔴 KEIN `haengtAn`. Der Suchendpunkt liest `wiki_sync_pages`, nicht `citymap` -- er weiss gar
//    nicht, ob eine Karte den Artikel schon beansprucht. Und `citymap.article_key` traegt bewusst
//    KEINEN UNIQUE-Key: zwei Karten duerfen denselben Artikel nennen (Farb- und s/w-Fassung
//    desselben Plans). Der Kopf von js/ui/wiki-assign.js sagt dazu: wer eine Objektart mit
//    Server-Suche anschliesst, laesst das Feld weg, bis ein Endpunkt es liefert -- eine erfundene
//    Belegt-Anzeige waere schlimmer als keine.
//
// 5. ⭐ DER DRITTE ZUSTAND IST HIER OWNER-WUNSCH (Entwurf §2.5: „gibt natuerlich auch welche von
//    uns"). Er ist tragbar, weil diese Aufgabe ohnehin Spalten anlegt -- `no_article` steht neben
//    `article_url`. Territorium und Literatur konnten ihn nicht tragen; dort haette er eine
//    Schemaaenderung ohne eigenen Anlass gekostet.

function avesmapsWikiAssignKarteText(wert) {
	return String(wert === null || wert === undefined ? "" : wert).trim();
}

/**
 * REIN: der Satz, der im Kasten unter „Zuweisung" steht -- WOHER der Artikel kommt.
 *
 * 🔴 ER MUSS DASTEHEN, UND ZWAR AUSGESCHRIEBEN. Seit dem Massenlauf vom 17.08.2026 traegt
 * `article_url` bei einer Wiki-Karte die Seite der PUBLIKATION, in der die Karte abgedruckt ist --
 * nicht ihren eigenen Artikel (den gibt es fast nie: 11 von 521 Titeln). Genau diese Verwechslung
 * hat den ganzen Strang gekostet; sie stillschweigend zu lassen hiesse, die Publikation als eigenen
 * Artikel auszugeben. Owner-Entscheid 17.08.2026, woertlich: „weil ich sehen will, was gesynct und
 * was von uns editiert ist."
 *
 * ⚠️ BEIDE Faelle sagen etwas -- „von Hand" ist keine Selbstverstaendlichkeit, die man weglassen
 * kann: der Owner will die zwei Herkuenfte UNTERSCHEIDEN, und ein Feld, das nur bei einer von beiden
 * erscheint, beantwortet die Frage nur halb.
 * ⚠️ Ein UNBEKANNTER Wert ergibt "" -- das Bauteil laesst leere Zeilen weg (`modell.felder.filter`),
 * also steht dann keine Zeile da statt einer falschen Behauptung.
 */
function avesmapsWikiAssignKarteHerkunft(wert) {
	const h = avesmapsWikiAssignKarteText(wert);
	if (h === "wiki_publication") {
		return "Publikation, in der die Karte steht — nicht ihr eigener Artikel";
	}
	if (h === "manual") {
		return "Von Hand gewählt";
	}
	return "";
}

/**
 * REIN: die Werte, die die Erklaerung `karte` erwartet -- aus einer Zeile des Suchendpunkts.
 *
 * ⚠️ DIE NAMEN SIND DIE DER ANTWORT, nicht huebschere: `settlement_label` und `continent` heissen so,
 * weil die Spalten von `wiki_sync_pages` so heissen. Die Beschriftung macht `label` im Register --
 * dieselbe Regel wie bei Ort und Landschaft.
 * 🔴 BEIDE beschreiben die SEITE, nicht die Karte. Genau deshalb tragen sie kein Kartenziel: „diese
 * Seite ist eine Metropole in Aventurien" ist keine Aussage ueber einen Stadtplan.
 */
function avesmapsWikiAssignKarteWerte(quelle) {
	const q = quelle || {};
	return {
		settlement_label: avesmapsWikiAssignKarteText(q.settlement_label),
		continent: avesmapsWikiAssignKarteText(q.continent),
		// 🔴 `herkunft` steht hier LEER, und der Schluessel muss trotzdem da sein: die Erklaerung
		// `karte` fuehrt das Feld, und der Hausriegel verlangt, dass der Datenweg JEDES erklaerte
		// Feld liefert -- sonst faellt eine Zeile im Kasten stumm weg. Leer ist hier die richtige
		// Antwort: eine Zeile der Wiki-Registry beschreibt die SEITE und weiss nicht, warum eine
		// Karte auf sie zeigt. Gefuellt wird sie erst in avesmapsWikiAssignKarteArtikel, aus der
		// gespeicherten Spalte `citymap.article_origin`.
		herkunft: "",
	};
}

/**
 * REIN: eine Zeile des Suchendpunkts in die Treffer-Form des Bauteils.
 *
 * 🔴 KEIN `haengtAn` -- siehe Kopf, Punkt 4. Nicht raten und nicht nachbauen.
 * ⚠️ `roh` reist mit, wie bei jeder Objektart: die Oberflaeche liest daraus nichts, aber der Vertrag
 * des Bauteils sieht es vor.
 */
function avesmapsWikiAssignKarteTreffer(zeile) {
	const z = zeile || {};
	return {
		name: avesmapsWikiAssignKarteText(z.name) || avesmapsWikiAssignKarteText(z.title),
		wiki_url: avesmapsWikiAssignKarteText(z.wiki_url),
		wiki_key: avesmapsWikiAssignKarteText(z.wiki_key),
		werte: avesmapsWikiAssignKarteWerte(z),
		roh: z,
	};
}

/**
 * REIN: die gespeicherte Zuweisung in die Artikel-Form. `null` heisst „nichts zugewiesen" -- ein
 * gueltiger Zustand, kein Fehler (die meisten Karten sind unsere eigenen).
 *
 * 💣 DER NAME KOMMT AUS DER GESPEICHERTEN SPALTE, DIE ZWEI ANZEIGEWERTE AUS DEM REGISTRY-SATZ. Das
 * ist der Unterschied zur Literatur, wo BEIDES aus dem Katalogsatz kommt: dort traegt die Kartenzeile
 * dieselben Spaltennamen wie der Katalog, hier nicht. `article_title` ist unsere eigene Kopie des
 * Artikelnamens und ueberlebt auch, wenn ein spaeterer Dump die Seite aus der Registry nimmt.
 * ⚠️ Ein verwaister Titel (kein Registry-Satz mehr) ist kein Fehler -- der Artikel steht dann mit
 * Name, Adresse und Schluessel da, die zwei Anzeige-Zeilen fallen weg, wie jede leere Zeile.
 */
function avesmapsWikiAssignKarteArtikel(gespeichert, kandidat) {
	const g = gespeichert || {};
	const adresse = avesmapsWikiAssignKarteText(g.article_url);
	const schluessel = avesmapsWikiAssignKarteText(g.article_key);
	if (adresse === "" && schluessel === "") {
		return null;
	}
	const k = (kandidat && typeof kandidat === "object") ? kandidat : null;
	return {
		name: avesmapsWikiAssignKarteText(g.article_title)
			|| avesmapsWikiAssignKarteText(k && (k.name || k.title)),
		wiki_url: adresse || avesmapsWikiAssignKarteText(k && k.wiki_url),
		wiki_key: schluessel || avesmapsWikiAssignKarteText(k && k.wiki_key),
		// 💣 `herkunft` kommt aus der GESPEICHERTEN Zeile, die zwei Anzeigewerte daneben aus dem
		// Registry-Satz -- und das ist kein Schoenheitsfehler, sondern der Punkt: die Registry
		// beschreibt die SEITE und weiss nichts darueber, WARUM diese Karte auf sie zeigt. Ein
		// Treffer der Suche traegt deshalb kein `herkunft`, und die Zeile faellt dort weg.
		werte: Object.assign({}, avesmapsWikiAssignKarteWerte(k || {}), {
			herkunft: avesmapsWikiAssignKarteHerkunft(g.article_origin),
		}),
	};
}

/**
 * 🔴 DER ZUSTAND -- UND ER WIRFT, STATT ETWAS LEERES ZU LIEFERN.
 *
 * Der Vertrag aus dem Kopf von js/ui/wiki-assign.js: ein `laden`, das im Fehlerfall AUFLOEST, ist von
 * „nichts zugewiesen" nicht zu unterscheiden. Das Bauteil malte dann den offenen Zustand, `lies()`
 * gaebe Leerstrings -- und weil diese Oberflaeche erst beim „Speichern" schreibt, loeschte der
 * naechste Klick die Zuweisung, ohne dass es jemand angeordnet haette.
 *
 * ⚠️ KEINE `kartenwerte` und KEIN `handgesetzt`: diese Objektart hat kein Kartenziel (`sync: false`),
 * also gibt es nichts zu vergleichen und nichts zu sperren. Hier nichts auf Vorrat.
 *
 * @param {Object|null} quelle {
 *     article_url, article_key, article_title,  -- die gespeicherte Zuweisung
 *     article_origin,                           -- WOHER sie stammt (manual|wiki_publication)
 *     no_article,                               -- der dritte Zustand
 *     kandidat,                                 -- der Registry-Satz dazu (`?action=entry`) oder null
 *   }
 */
function avesmapsWikiAssignKarteZustand(quelle) {
	if (!quelle || typeof quelle !== "object" || Array.isArray(quelle)) {
		throw new Error("Wiki-Karte: keine Karte gewählt — der Stand ist unbekannt.");
	}
	return {
		artikel: avesmapsWikiAssignKarteArtikel(quelle, quelle.kandidat || null),
		keinArtikel: quelle.no_article === true,
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWikiAssignKarteWerte: avesmapsWikiAssignKarteWerte,
		avesmapsWikiAssignKarteHerkunft: avesmapsWikiAssignKarteHerkunft,
		avesmapsWikiAssignKarteTreffer: avesmapsWikiAssignKarteTreffer,
		avesmapsWikiAssignKarteArtikel: avesmapsWikiAssignKarteArtikel,
		avesmapsWikiAssignKarteZustand: avesmapsWikiAssignKarteZustand,
	};
}
