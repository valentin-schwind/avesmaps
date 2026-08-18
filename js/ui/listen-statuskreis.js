// Der grüne Statuskreis der Listenzeilen -- EIN Bauer je Objektart, für BEIDE Oberflächen.
//
// Owner 18.08.2026, Objektart für Objektart: „ich will dass du die grünen kreise bei der ortsliste
// im ortseditor (nicht nur im editorpanel) anwendest" · „… bei der regionenliste im regionseditor"
// · „… bei der wegeliste im wegeeditor" · „literatur (voll wenn mindestens ein ort zugewiesen
// wurde, halb wenn mindestens ein ort nicht aufgelöst ist) -> im Editorpanel UND im
// Literatureditor" · „karten genauso".
//
// 💣 WARUM DIESE DATEI EXISTIERT: jede Objektart hat ZWEI Listen in ZWEI Dokumenten -- das
// WikiSync-Panel (index.html) und ihr Editorfenster (eigene HTML-Seite mit eigenem `window`).
// Keine der beiden sieht eine Funktion der anderen. Ohne eine Datei, die BEIDE laden, stünde jede
// Regel zweimal da, und die zwei Fassungen liefen auseinander, ohne dass es jemandem auffällt --
// genau die Divergenz, die die Listenvereinheitlichung vom 14.08.2026 beseitigt hat (sieben
// Zeilenformen, vier davon Abschriften).
// ⭐ Das Vorbild steht seit dem 18.08.2026 daneben: `avesmapsPowerlineStatusMarker` in
// js/map-features/powerline-topology.js bedient Panel und Kraftlinien-Editor aus einer Hand.
// 🪤 Für Literatur und Karten gab es KEIN gemeinsam geladenes Modul -- index.html lädt
// js/ui/wiki-assign-{weg,ort,landschaft,territorium}.js, aber weder `-literatur.js` noch
// `-karte.js` (gemessen 18.08.2026). Deshalb diese Datei, statt zwei weitere Skripte in den
// Startpfad jedes anonymen Besuchers zu hängen.
//
// 🔴 SIE IST REIN: kein DOM, kein `fetch`, kein Modulzustand. Jeder Bauer bekommt Daten und gibt
// eine Zeichenkette zurück. Die FELDER holt jede Oberfläche selbst -- die zwei Endpunkte einer
// Objektart liefern verschiedene Formen, und diese Abbildung steht je an ihrer Aufrufstelle,
// begründet. Die REGEL steht nur hier.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DIE FORM (css/components/map-status-circle.css) -- überall dasselbe:
//   voll (`--all`)       = fertig
//   halb (`--own-only`)  = da, aber nicht verbunden
//   leer (kein Modifier) = nicht auf der Karte
//
// 💣 WORAN „fertig" gemessen wird, entscheidet die OBJEKTART -- und es sind DREI Regeln, jede
//    begründet, keine davon ein Versehen:
//      · Wiki-Zuweisung  -- Ort, Landschaft   (hängt das Ding an einem Artikel?)
//      · `every`         -- Weg, Kraftlinie   (eine Namensgruppe aus Segmenten; teilweise ist HALB)
//      · Ortsbezug       -- Literatur, Karte  (liegt das Werk überhaupt irgendwo?)
//    Wer sie „vereinheitlicht", dreht mindestens eine Aussage um.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// Die Klassenliste der Markierung -- die EINZIGE Stelle, an der die drei Modifier stehen.
// ⚠️ Sie ist einzeln herausgegeben, weil EINE der sieben Listen ihre Zeile aus Knoten baut statt
// aus einer Zeichenkette (der Ortseditor). Ohne diese Fassung schriebe die sich ihre Klassen selbst
// zusammen -- und hätte damit die zweite Fassung, die dieses Modul gerade verhindern soll.
function avesmapsStatuskreisKlasse(zustand) {
	const stufe = zustand === "voll" ? " tree-map-status--all"
		: (zustand === "halb" ? " tree-map-status--own-only" : "");
	return "tree-map-status" + stufe;
}

// Die Markierung selbst. 🔴 Genau EIN unsichtbarer <span> -- ein zweites Zeichen daneben ist
// ausdrücklich unerwünscht (am 17.08.2026 wurde für die Kraftlinienliste ein Rauten-Symbol gebaut
// und auf Owner-Entscheid vollständig zurückgebaut, 94889119).
function avesmapsStatuskreisMarkup(zustand) {
	return '<span class="' + avesmapsStatuskreisKlasse(zustand) + '" aria-hidden="true"></span>';
}

function avesmapsStatuskreisText(wert) {
	return String(wert === null || wert === undefined ? "" : wert).trim();
}

// ── ORT ─────────────────────────────────────────────────────────────────────────────────────────
// Drei Zustände, und alle drei kommen im Bestand vor: die Listen führen Kartenorte UND reine
// Wiki-Zeilen („Fehlt"), in beiden Oberflächen.
//
// 💣 `hatWikiZuweisung` MUSS aus `properties.wiki_settlement` kommen, nie aus `properties.wiki_url`.
//    Das flache `wiki_url` schickt jedes Speichern des Ortes mit, und der öffentliche Leseweg füllt
//    es bei Leere per Namensraten wieder auf (avesmapsEnrichMapFeatureWikiUrl, api/app/map-features.php).
//    Gemessen am oeffentlichen Kartenpayload, 18.08.2026: 1914 Orte tragen `wiki_settlement`, 1991
//    ein `wiki_url` -- und 99 davon ein `wiki_url` OHNE Nest (Liepenstein, Dommel, Burg Arkenheim).
// 🚩 99, nicht 77: die Differenz zweier Summen ist nicht die Schnittmenge. 22 Orte tragen das
//    Nest OHNE flaches `wiki_url` (Askja und Askjahaven, Dâl am Yaquir, Burg Madaleth), also
//    1991 − (1914 − 22) = 99. Dieselbe Verwechslung hat am 17.08.2026 eine Messung um den
//    Faktor 17 danebenliegen lassen.
// ⚠️ Die REGEL ist eigens herausgegeben (nicht nur ihr Markup): der Ortseditor baut seine Zeile
//    aus Knoten und braucht den Zustand, nicht die Zeichenkette. Beide Wege entscheiden hier.
function avesmapsStatuskreisOrtZustand(aufKarte, hatWikiZuweisung) {
	if (aufKarte !== true) { return "leer"; }
	return hatWikiZuweisung === true ? "voll" : "halb";
}

function avesmapsStatuskreisOrt(aufKarte, hatWikiZuweisung) {
	return avesmapsStatuskreisMarkup(avesmapsStatuskreisOrtZustand(aufKarte, hatWikiZuweisung));
}

// ── LANDSCHAFT ──────────────────────────────────────────────────────────────────────────────────
// Eine Zeile der Landschaftsliste ist eine VEREINIGUNG: eine Wiki-Region, die gezeichneten Flächen
// an ihrem Schlüssel, und ggf. ein Kartenlabel. Der Kreis fragt in dieser Reihenfolge:
//   1. Steht überhaupt etwas auf der Karte (Fläche ODER Label)? Sonst leer -- die Zeile ist eine
//      reine Wiki-Zeile, es gibt nichts zuzuweisen.
//   2. Trägt JEDE gezeichnete Fläche einen `wiki_region_key`? Dann voll, sonst halb.
// 💣 Der Schlüssel ist `ecosystem_region.wiki_region_key` (abgeleitet aus `wiki_url`, api/_internal/
//    app/ecosystem.php) -- die beiden dürfen nie auseinanderlaufen, deshalb wird nur einer gelesen.
// ⚠️ Ein Label OHNE Fläche ist damit halb: es steht auf der Karte, aber am Artikel hängt keine
//    Fläche. Das ist die Aussage, nicht ein Mangel der Rechnung.
function avesmapsStatuskreisLandschaft(flaechen, hatKartenLabel) {
	const liste = Array.isArray(flaechen) ? flaechen : [];
	if (liste.length === 0) {
		return avesmapsStatuskreisMarkup(hatKartenLabel === true ? "halb" : "leer");
	}
	const alle = liste.every((f) => avesmapsStatuskreisText(f && f.wiki_region_key) !== "");
	return avesmapsStatuskreisMarkup(alle ? "voll" : "halb");
}

// ── WEG ─────────────────────────────────────────────────────────────────────────────────────────
// 💣 `every`, nicht `some`: ein Weg ist eine NAMENSGRUPPE aus Segmenten. Trägt nur ein Teil den
//    Artikel, ist er halb -- genau wofür der halbe Kreis da ist (wortgleich zur Kraftlinie,
//    avesmapsPowerlineStatusMarker).
// 💣 Gelesen wird `properties.wiki_path.wiki_key`, nie `wiki_url` -- dieselbe Phantom-Falle wie
//    beim Ort, hier mit 13 Fällen.
// 🔴 KEIN dritter Zustand: ein Weg IST eine gezeichnete Geometrie, er kann nicht „nicht auf der
//    Karte" sein. (Die Panel-Liste daneben ist eine WIKI-Liste und kennt den Zustand deshalb sehr
//    wohl -- sie führt Artikel, nicht Segmente. Verschiedene Grundmengen, nicht verschiedene Regeln.)
// ⚠️ Gemessen am Livebestand 18.08.2026: von 4160 Namensgruppen sind 410 voll und 3750 halb --
//    und NULL echt gemischt. Das ist kein Fehler der Regel, sondern eine Folge der Gruppierung
//    (wpGroupWays, js/pages/wege-editor-model.js schlüsselt zugewiesene Segmente über ihren
//    `wiki_key` und unzugewiesene über Art+Name, mischen kann eine Gruppe also nicht). `every`
//    steht trotzdem hier: es ist die Regel, und sie überlebt eine geänderte Gruppierung. Aber
//    NIEMAND darf behaupten, sie mache den Halb-Zustand sichtbar -- das tut sie hier nicht.
// ⚠️ UND 61 % DER ZEILEN TRAGEN DENSELBEN HALBEN KREIS: 2552 der 4157 Editorzeilen sind
//    maschinell benannt (`Pfad-1`, `Pfad-2`, …) und alle unzugewiesen. Das ist wahr und in Kauf
//    genommen, kein Fehler zum „Reparieren": sie auszuschließen bräuchte einen JS-Zwilling von
//    `avesmapsConflictPathNameIsAuto` (api/_internal/conflicts/core.php) -- eine zweite Wahrheit
//    darüber, was „maschinell benannt" heißt, und die kann auseinanderlaufen. Die Reiter
//    „Platziert"/„Fehlt" trennen die Menge ohnehin schon.
function avesmapsStatuskreisWeg(segmente) {
	const liste = Array.isArray(segmente) ? segmente : [];
	const alle = liste.length > 0 && liste.every(
		(s) => avesmapsStatuskreisText(s && s.wiki_path && s.wiki_path.wiki_key) !== ""
	);
	return avesmapsStatuskreisMarkup(alle ? "voll" : "halb");
}

// ── LITERATUR und KARTE ─────────────────────────────────────────────────────────────────────────
// EIN Bauer für beide: die Regel ist wörtlich dieselbe und die Tabellen sind es auch
// (`adventure_place` und `citymap_place` tragen beide `raw_name` + `target_kind` mit dem Vorgabewert
// `'unresolved'`, api/_internal/app/{game-literature,citymaps}.php).
//
// 🔴 HIER MISST DER KREIS NICHT DIE WIKI-ZUWEISUNG DES WERKS, sondern seinen ORTSBEZUG -- Owner
//    18.08.2026. Ein Literaturwerk und eine Stadtkarte liegen nicht selbst auf der Karte; was sie
//    dorthin bringt, sind ihre zugeordneten Orte. Damit passt der Kreis zu seiner ursprünglichen
//    Bedeutung: leer = liegt nirgends · halb = teilweise verortet · voll = ganz verortet.
//    Wer das auf „hat das Werk einen Wiki-Artikel" umstellt, dreht die Aussage um.
//
// 💣 HALB SCHLÄGT VOLL, und diese Reihenfolge ist tragend. Die zwei Bedingungen des Owners
//    überschneiden sich (zwei aufgelöste Orte plus ein offener erfüllt beide); solange etwas
//    unaufgelöst ist, ist die Arbeit nicht fertig, und genau das soll der Kreis zeigen. Wer die
//    Prüfungen tauscht, lässt eine halb gepflegte Zeile sich als fertig melden.
// 💣 „Aufgelöst" ist `target_kind !== 'unresolved'` -- die Spalte sagt es selbst, geraten wird
//    nichts. Ein `raw_name` ohne Ziel bleibt auf dem Vorgabewert stehen. Am Livebestand
//    18.08.2026: 881 von 4122 Literatur-Ortszeilen und 89 von 556 Karten-Ortszeilen sind offen.
// ⚠️ `some(unaufgelöst)`, nicht `!every(aufgelöst)` -- bei einer leeren Liste liefern die beiden
//    Verschiedenes, und die leere Liste ist hier bereits vorher abgefangen.
//
// 🔴 ZWEI EINGÄNGE, EINE REGEL -- weil die zwei Objektarten ihre Orte verschieden ausliefern und
//    beide Male BEIDE Oberflächen denselben (Editor-)Endpunkt lesen:
//      · Literatur: `places` ist eine Liste von OBJEKTEN (…/game-literature.php {action:list}).
//      · Karte:     `places` ist eine Liste blanker NAMEN (…/citymaps.php {action:list}, „Names only,
//                   no ids"); die zwei Zahlen kommen dort aus eigenen Feldern der Antwort.
//    Entschieden wird trotzdem nur an EINER Stelle -- der Listen-Eingang rechnet und reicht weiter.
function avesmapsStatuskreisOrtsbezugZahlen(anzahlOrte, anzahlOffen) {
	const gesamt = Number(anzahlOrte) || 0;
	const offen = Number(anzahlOffen) || 0;
	if (gesamt <= 0) { return avesmapsStatuskreisMarkup("leer"); }
	// 💣 HIER steht der Vorrang, und er ist tragend: erst „offen", dann „voll". Nicht tauschen.
	return avesmapsStatuskreisMarkup(offen > 0 ? "halb" : "voll");
}

// 💣 DIESELBE SPALTE HEISST IM EINEN PAYLOAD `target_kind` UND IM ANDEREN `kind` -- gemessen
//    18.08.2026: Detailansicht und öffentlicher Katalog liefern `target_kind`, die LISTENantwort der
//    Literatur (api/_internal/app/game-literature.php, `$placesByAdvId`) liefert `kind`. Und die
//    Listenantwort ist genau die, die BEIDE Literatur-Oberflächen lesen. Wer nur einen der zwei
//    Namen prüft, bekommt lauter `undefined`, färbt jede Zeile gleich -- und sein Test bleibt grün,
//    weil `undefined` ja auch „nicht aufgelöst" heißt.
// ⚠️ Unbekannt zählt als OFFEN. Die sichere Richtung: lieber eine fertige Zeile halb zeigen als
//    eine unfertige als erledigt melden.
function avesmapsStatuskreisOrtIstOffen(ort) {
	if (!ort || typeof ort !== "object") { return true; }
	const art = Object.prototype.hasOwnProperty.call(ort, "target_kind")
		? avesmapsStatuskreisText(ort.target_kind)
		: avesmapsStatuskreisText(ort.kind);
	return art === "" || art === "unresolved";
}

function avesmapsStatuskreisOrtsbezug(orte) {
	const liste = Array.isArray(orte) ? orte : [];
	return avesmapsStatuskreisOrtsbezugZahlen(
		liste.length,
		liste.filter(avesmapsStatuskreisOrtIstOffen).length
	);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsStatuskreisKlasse,
		avesmapsStatuskreisMarkup,
		avesmapsStatuskreisOrtZustand,
		avesmapsStatuskreisOrt,
		avesmapsStatuskreisLandschaft,
		avesmapsStatuskreisWeg,
		avesmapsStatuskreisOrtsbezug,
		avesmapsStatuskreisOrtsbezugZahlen,
		avesmapsStatuskreisOrtIstOffen,
	};
}
