// Natur & Waren im Infopanel: Pflanzen, Tiere, Spezies und Handelswaren eines Ortes.
// Design: docs/flora-fauna-handelswaren-design.md. Backend: api/app/lore.php.
//
// WARUM KEIN VORGELADENER KATALOG (anders als Abenteuer/Kartensammlung): deren Kataloge
// sind klein genug, um komplett zum Client zu reisen. Hier sind es 5.104 Einträge mit
// 7.748 Ortsverknüpfungen -- das würde jeder Kartenbesucher mitladen, um es fast nie zu
// öffnen. Stattdessen wird PRO ORT geholt, sobald ein Panel ihn zeigt, und das Ergebnis
// im Speicher behalten.
//
// 💣 KEIN PANEL-NEUAUFBAU: buildLoreMarkup() liefert SOFORT einen leeren, markierten
// Container zurück und stößt den Abruf an; die Antwort füllt genau die Container mit
// passendem data-lore-place. Damit gibt es kein „Refresh ≠ Show"-Rennen wie beim
// Infopanel-Katalog -- ein spät eintreffender Ort überschreibt nichts, was inzwischen
// woanders steht, und ein bereits geschlossenes Panel hat einfach keinen Container mehr.

"use strict";

var AVESMAPS_LORE_API_URL = "api/app/lore.php";

// 🚨 NOT-AUS. Auf false gesetzt feuert der Client KEINE Lore-Abrufe mehr: keine
// Infobox-Zeilen, kein Dialog. Alles andere auf der Karte bleibt unberührt.
//
// Warum es den Schalter GIBT (2026-07-21, PHP-Pool gesättigt): die Abrufe starteten
// beim BAUEN des Markups, und bindPopup baut das für jedes Label schon beim
// Kartenaufbau -- hunderte gleichzeitige Anfragen, ohne Zeitlimit. Ein Request, der
// auf einem vollen Pool hängt, belegt bis zum Servertimeout einen Worker; danach hing
// die ganze API, auch game-literature.php, das damit nichts zu tun hat.
//
// Warum er wieder AUF TRUE steht: die Ursachen sind behoben -- geladen wird nur noch
// über den DOM-Beobachter (also je geöffnetem Panel einmal), jeder Abruf bricht nach
// 8 s ab, die Katalogliste braucht 3 statt 600 Abfragen, und die Hierarchietabellen
// werden je Anfrage nur einmal gelesen. Der Schalter bleibt trotzdem: er wirkt sofort
// und ohne PHP, weil ein reiner JS-Deploy ihn ausrollt.
// Anschalten OHNE Deploy, damit der Schalter auch dem Owner gehört und nicht nur dem
// nächsten Commit:
//   ?lore=1   schaltet für DIESEN Aufruf ein (zum gefahrlosen Nachmessen)
//   ?lore=0   schaltet aus, auch wenn der Default unten wieder true ist
//   localStorage: avesmaps.lore.enabled = "1" | "0"  -- gilt dauerhaft in diesem Browser
// Ist nichts gesetzt, gilt der Default darunter.
var AVESMAPS_LORE_DEFAULT_ENABLED = true;

var AVESMAPS_LORE_ENABLED = (function () {
	try {
		// 💣 avesmapsSearchParams(), NICHT new URLSearchParams(): die App parst URLs
		// TOLERANT -- ein zweites „?" gilt wie „&" (url-tolerant-parsing). Bei
		// „?siedlung=Punin?lore=1" liest der Standard-Parser den Schalter GAR NICHT,
		// und dann sieht es aus, als würde das Feature bei gesetztem Parameter
		// aussetzen. Fallback nur, falls die Hilfe noch nicht geladen ist.
		var params = typeof window.avesmapsSearchParams === "function"
			? window.avesmapsSearchParams()
			: new URLSearchParams(window.location.search);
		var fromUrl = params.get("lore");
		if (fromUrl === "1" || fromUrl === "0") {
			return fromUrl === "1";
		}
		var stored = window.localStorage.getItem("avesmaps.lore.enabled");
		if (stored === "1" || stored === "0") {
			return stored === "1";
		}
	} catch (error) {
		// Privater Modus o. ä.: dann eben der Default.
	}
	return AVESMAPS_LORE_DEFAULT_ENABLED;
})();

// Nie länger als das auf eine Antwort warten. Ein abgebrochener Request gibt den
// Worker frei; ohne Limit hält ein einziger hängender Aufruf ihn bis zum Servertimeout.
var AVESMAPS_LORE_TIMEOUT_MS = 8000;

// placeKey -> { data } | { pending: Promise }. Ein Ort wird höchstens einmal geholt.
var avesmapsLoreCache = new Map();

function avesmapsLoreEscape(value) {
	return String(value == null ? "" : value)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Server-wiki_key -> Ortsschlüssel der Lore-Tabellen. Territorien tragen die
// 'wiki:'-Form (avesmapsPoliticalBuildWikiKey), lore_place führt den reinen Slug.
// Ein Schlüssel -- oder mehrere, kommagetrennt. api/app/lore.php nimmt Listen schon
// entgegen (es teilt selbst an Kommas) und avesmapsLoreFetch reicht sie durch; nur
// hier fielen sie bisher durch, weil die Zeichenklasse kein Komma kannte. V10 braucht
// das: eine Routen-Etappe hat mehrere Landschaften und soll EINEN Abruf auslösen, nicht
// drei -- das Fan-out je Popup ist genau das, was 2026-07-21 den PHP-Pool sättigte.
//
// 💣 Jeder Teil wird EINZELN geprüft, und ein schlechter Teil verwirft nur sich selbst.
// „darpatien,<script>" wird „darpatien" -- ein kaputter Name darf nicht die Flora der
// ganzen Etappe verstummen lassen.
function avesmapsLoreNormalizeKey(raw) {
	var parts = String(raw == null ? "" : raw).split(",");
	var keys = [];
	for (var index = 0; index < parts.length; index++) {
		var key = parts[index].trim().toLowerCase();
		if (key.indexOf("wiki:") === 0) {
			key = key.slice(5);
		}
		if (key.indexOf("name:") === 0) {
			key = key.slice(5);
		}
		if (/^[a-z0-9_-]{1,190}$/.test(key) && keys.indexOf(key) < 0) {
			keys.push(key);
		}
	}
	return keys.join(",");
}

// 💣 Jeder Wert hier stammt aus dem Wiki, also aus FREMDINHALT: ein Artikel könnte
// alles Mögliche in einem Infobox-Feld stehen haben. Escapen allein reicht für ein
// href nicht -- "javascript:…" überlebt jedes Escaping. Deshalb wird eine URL nur
// akzeptiert, wenn sie auf die Wiki-Domain zeigt; alles andere wird zu "" und der
// Eintrag erscheint als reiner Text statt als Link.
var AVESMAPS_LORE_URL_PREFIX = "https://de.wiki-aventurica.de/";

function avesmapsLoreSafeUrl(raw) {
	var url = String(raw == null ? "" : raw).trim();
	return url.indexOf(AVESMAPS_LORE_URL_PREFIX) === 0 ? url : "";
}

// Der Abrufschlüssel des Lore-Panels -- eigene, prüfbare Funktion, weil sie ZWEIMAL
// gebraucht wird: als Zwischenspeicher-Schlüssel hier UND als Container-Schlüssel in
// buildLoreMarkup (dort selbst nachgebaut, siehe Kommentar an containerKey).
//
// 💣 Er muss die IDENTITÄT mittragen (area/location/territory -- die public_id des Objekts,
// dessen Infobox gerade gebaut wird): zwei Objekte können denselben Ortsschlüssel (`key`) haben
// und trotzdem verschiedene Lebensraum-Regeln treffen -- eine Siedlung und die Fläche, in
// der sie liegt, sind der Normalfall davon. Ein Schlüssel, der die Identität verschweigt,
// liefert der Siedlung die Regeln ihrer Fläche (oder umgekehrt), sobald beide denselben
// `key` tragen. Fehlt die Identität in BEIDEN Aufrufen, bleibt der Schlüssel unverändert
// -- das alte Verhalten.
// Task 9: `territory` kommt als DRITTES Identitätsfeld dazu (neben area/location), fuer
// Herrschaftsgebiete -- dieselbe Begruendung, eigenes Praefix, damit ein Gebiet und eine
// Landschaftsflaeche mit zufaellig gleicher public_id nie denselben Schluessel tragen.
function avesmapsLoreRequestKey(placeRef) {
	var ref = placeRef || {};
	var key = ref.key || "";
	var titles = ref.titles || "";
	var goods = ref.goods || "";
	var area = ref.area || "";
	var location = ref.location || "";
	var territory = ref.territory || "";
	return key
		+ (titles ? "|t:" + titles : "")
		+ (goods ? "|g:" + goods : "")
		+ (ref.full ? "|full" : "")
		+ (area ? "|a:" + area : "")
		+ (location ? "|l:" + location : "")
		+ (territory ? "|te:" + territory : "");
}

// Holt die Lore eines Ortes (einmal je Bezug). Mehrere Schlüssel werden kommagetrennt
// übergeben -- so kann Abschnitt 3 die Territorienkette hereinreichen, ohne dass sich
// hier etwas ändert.
//
// request: { key, full, titles, goods, area, location, territory } -- area/location/territory
// sind die IDENTITÄT (public_id) und optional; sie reisen sowohl in den Zwischenspeicher-Schlüssel
// (avesmapsLoreRequestKey) als auch in die URL, damit der Server seine Lebensraum-Regeln
// gegen das richtige Objekt prüfen kann.
// 💣 `area` nimmt die public_id der REGION (Feld `region_public_id` in
// api/app/ecosystem-areas.php), NICHT die der Fläche (Feld `public_id` dort) -- mit der
// falschen ID antwortet der Server 200 und liefert lautlos nichts. Seit Task 9 darf `area`
// auch eine KOMMALISTE mehrerer Regions-public_id sein (Weg/Etappe beruehren mehrere).
// `territory` nimmt die public_id EINES Herrschaftsgebiets -- der Server loest dessen
// Flaechen selbst auf (er kennt sie, der Client nicht).
function avesmapsLoreFetch(request) {
	if (!AVESMAPS_LORE_ENABLED) {
		return Promise.resolve(null); // Not-Aus: kein Request, keine Zeile
	}
	var req = request || {};
	var placeKey = req.key || "";
	var full = req.full;
	var titles = req.titles || "";
	var goods = req.goods || "";
	var area = req.area || "";
	var location = req.location || "";
	var territory = req.territory || "";
	var cacheKey = avesmapsLoreRequestKey(req);
	var cached = avesmapsLoreCache.get(cacheKey);
	if (cached) {
		return cached.pending || Promise.resolve(cached.data);
	}
	var url = AVESMAPS_LORE_API_URL + "?place=" + encodeURIComponent(placeKey)
		+ (titles ? "&title=" + encodeURIComponent(titles) : "")
		+ (goods ? "&goods=" + encodeURIComponent(goods) : "")
		+ (full ? "&full=1" : "")
		+ (area ? "&area=" + encodeURIComponent(area) : "")
		+ (location ? "&location=" + encodeURIComponent(location) : "")
		+ (territory ? "&territory=" + encodeURIComponent(territory) : "");
	// Hartes Zeitlimit: ein hängender Request hält sonst bis zum Servertimeout einen
	// PHP-Worker fest, und mehrere offene Panels legen damit die ganze API lahm.
	var controller = typeof AbortController === "function" ? new AbortController() : null;
	var timer = controller ? window.setTimeout(function () { controller.abort(); }, AVESMAPS_LORE_TIMEOUT_MS) : null;
	var pending = fetch(url, {
		credentials: "same-origin",
		headers: { Accept: "application/json" },
		signal: controller ? controller.signal : undefined,
	})
		.then(function (response) {
			if (timer) { window.clearTimeout(timer); }
			return response;
		})
		.then(function (response) {
			return response.ok ? response.json() : null;
		})
		.then(function (data) {
			var payload = data && data.ok === true ? data : null;
			avesmapsLoreCache.set(cacheKey, { data: payload });
			return payload;
		})
		.catch(function () {
			// Ein Netzfehler darf das Panel nicht mitreißen: Abschnitt entfällt still,
			// wie bei der Kartensammlung ohne Katalog.
			avesmapsLoreCache.set(cacheKey, { data: null });
			return null;
		});
	avesmapsLoreCache.set(cacheKey, { pending: pending });
	return pending;
}

// Reihenfolge und Beschriftung der Infobox-ZEILEN (Owner): Waren, Fauna, Flora,
// Spezies -- als Zeilen in derselben Feldliste wie Oberhaupt/Einwohner/Verkehrswege,
// nicht als eigene Blöcke daneben.
//
// SPEZIES WIRD NICHT ANGEZEIGT (Owner 2026-07-21): das Feld „Regionen" der
// {{Infobox Spezies}} ist in Wiki Aventurica schlecht gepflegt, die Zuordnungen sind
// zu unzuverlässig für eine Infobox-Zeile. Das ist eine Aussage über die
// DATENGRUNDLAGE, nicht über die Technik -- der Rang-3-Filter unten hatte den
// auffälligsten Auswuchs („überall Tiefzwerg") bereits behoben.
//
// Die Daten bleiben vollständig erhalten: Katalog, Editor-Reiter und der Endpoint
// führen Spezies weiter. Nur die öffentliche Anzeige verzichtet darauf, bis die
// Pflege im Wiki besser ist.
// Der Satz unter jedem Deckel, in Mehrzahl und Einzahl (Owner 2026-08-12, sein Wortlaut).
//
// ⚠️ „hier" und nicht „in der Nähe": dieselbe Zeile steht an FÜNF Oberflächen -- Siedlung,
// Landschaftsregion, Herrschaftsgebiet, Weg und Routen-Etappe. „Tierarten leben in der Nähe" liest
// sich an einer Straße richtig, bei einem Königreich aber schief; dort leben sie darin. „hier" trägt
// Punkt, Fläche und Linie gleichermaßen.
// Der Satz je Zeile, in Einzahl und Mehrzahl (Owner 2026-08-12: „können wir die title kürzen?").
//
// 🔴 EIN Satz, und er gilt in BEIDEN Zuständen -- zugeklappt wie aufgeklappt (Owner: „11
// Handelswaren gelistet sollte es auch heißen, wenn es zugeklappt is … und wenn es aufgeklappt
// ist"). Eine kurze Zwischenfassung hatte zwei Sätze und tauschte sie beim Aufklappen; das ist
// dieselbe Unruhe wie der springende Satz von zwei Stunden vorher, nur in Worten statt in Pixeln.
// Was an derselben Stelle steht, soll auch dasselbe sagen.
//
// ⭐ Die Sätze sagen, was ERFASST ist -- eine Aussage über den Datenbestand, nicht über den Ort.
// „gelistet / beobachtet / gesehen" trägt beide Zustände; „werden hier gehandelt / leben hier"
// wäre aufgeklappt schöner gewesen und zugeklappt zu lang, und genau dieser Kompromiss war der
// Fehler.
var AVESMAPS_LORE_ROWS = [
	{ kind: "ware", label: "Waren", singular: "Handelsware gelistet", plural: "Handelswaren gelistet" },
	{ kind: "fauna", label: "Fauna", singular: "Tierart beobachtet", plural: "Tierarten beobachtet" },
	{ kind: "flora", label: "Flora", singular: "Pflanzenart gesehen", plural: "Pflanzenarten gesehen" },
];

// EINE Infobox-Zeile im Hausformat (.region-info-box__row + dt/dd), damit sie sich in
// die bestehende Feldliste einreiht statt daneben zu stehen. Leere Arten entfallen.
//
// 💣 KONTINENTWEITE EINTRÄGE (rank 3) STEHEN NICHT IN DER VORSCHAU. „Tiefzwerg" ist für ganz
// [[Aventurien]] gelistet und erschien deshalb bei JEDEM Ort -- formal richtig, praktisch wertlos:
// was überall gilt, sagt über diesen Ort nichts. Im AUFGEKLAPPTEN stehen sie weiterhin, dort unter
// ihrer eigenen Überschrift, wo die Einordnung mitgeliefert wird.

// 🪤 Hier standen bis zum 2026-08-12 ZWEI Stellschrauben, und beide sind weg:
//
//   AVESMAPS_LORE_PREVIEW_NAMES -- wie viele Namen zugeklappt dastanden. Erst 8, dann 3, jetzt
//   keine: zugeklappt trägt die Zeile nur ihren knappen Satz (Owner: „ohne weitere Angaben").
//
//   AVESMAPS_LORE_LID_MIN -- ab wann ein Deckel überhaupt aufklappte. Darunter stand alles offen da,
//   ein Deckel ohne Öffner. Owner 2026-08-12 zu genau so einer Zeile: „auch 2 Tierarten leben hier /
//   Berglöwe, Griswolf <- einklappen".
//
// ⭐ JEDE Lore-Zeile ist jetzt ein Deckel, der aufklappt -- unabhängig davon, ob zwei Namen darin
// stecken oder einundfünfzig. Der Gewinn ist nicht der gesparte Platz bei zwei Namen, sondern dass
// alle Zeilen einer Box GLEICH aussehen und sich gleich verhalten. Ein Auge, das an drei Zeilen
// dasselbe lernt, muss bei der vierten nicht raten.

// Ein Name als Markup -- verlinkt, wo es einen Wiki-Artikel gibt. EINE Stelle, damit ein Eintrag im
// statischen Deckel nicht anders aussieht als im aufgeklappten.
function avesmapsLoreNameMarkup(item) {
	var href = avesmapsLoreSafeUrl(item && item.wiki_url);
	var name = avesmapsLoreEscape(item && item.name);
	return href
		? '<a class="avesmaps-lore__name" href="' + avesmapsLoreEscape(href) + '" target="_blank" rel="noopener">' + name + "</a>"
		: name;
}

// Die Gliederung des aufgeklappten Inhalts (Owner 2026-08-12: „geht das nicht überall?").
//
// 🔴 NACH NÄHE, UND DAS GILT FÜR ALLE DREI ARTEN. Gemessen am Live-Bestand: von 21 Tierarten und
// 10 Pflanzen trägt im Wiki KEINE eine Herkunft, alle nur eine Verbreitung -- „Von hier / Hier
// erhältlich" dort hinzuschreiben wäre eine erfundene Unterscheidung. Was überall trägt, ist der
// Rang: direkt hier, aus einem Untergebiet, oder überall in Aventurien.
//
// ⭐ „Von hier" ist der ZUSATZ, den nur die Waren hergeben (relation `herkunft`, 3 von 51 an der
// gemessenen Etappe) -- und weil das die stärkste Aussage über einen Ort ist, steht sie oben. Ein
// Eintrag mit Herkunft erscheint NUR dort, nie zusätzlich in seiner Rang-Gruppe.
var AVESMAPS_LORE_GROUPS = [
	{ key: "origin", label: "Von hier" },
	{ key: "rank0", label: "Direkt hier" },
	{ key: "rank1", label: "Aus Untergebieten" },
	{ key: "rank3", label: "Überall in Aventurien" },
];

// Ab wann eine Gruppe zugeklappt startet, und ab wann ihre Namen Buchstabenmarken bekommen
// (Owner 12.08.2026, an der Reichsstrasse 2 mit 126 Handelswaren entschieden).
//
// ⭐ ZWEI Schwellen, weil zwei verschiedene Fragen: „ist die ZEILE zu lang?" entscheidet sich an der
// Gesamtzahl (dann klappen die Gruppen zu), „ist die GRUPPE zu lang zum Lesen?" an ihrer eigenen
// (dann kommen Marken). Eine Etappe mit 12 Tierarten sieht damit aus wie bisher; nur die grossen
// Faelle werden gebaendigt.
var AVESMAPS_LORE_GROUP_LID_MIN = 25;
// 🔴 NULL, also IMMER -- jede Gruppe bekommt ihre Buchstabenmarken, egal wie klein sie ist.
//
// Der Weg dahin: 30 → 10 → 0, alle drei am selben Tag vom Owner entschieden. Bei 30 sah er die
// Marken an seinem Beispiel nie; bei 10 sah er sie mal so, mal so. Sein Befund zu 0
// (12.08.2026): „es macht mein durchblättern keinen sinn dass in einem menü welche dranstehen und
// im andern nicht."
//
// ⭐ Das ist derselbe Gedanke, der schon den statischen Deckel abgeschafft hat: **eine Schwelle
// spart Platz im Einzelfall und kostet Verlässlichkeit über die Fläche.** Wer durch zwanzig
// Infoboxen blättert, sieht nicht zwanzig sinnvoll abgestufte Sonderfälle, sondern ein Bauteil,
// das sich nicht entscheiden kann. Die Marke bei drei Namen ist überflüssig -- aber sie steht da,
// wo das Auge sie erwartet, und das ist mehr wert.
//
// ⚠️ Bleibt eine Schraube, weil die andere (AVESMAPS_LORE_GROUP_LID_MIN) eine ANDERE Frage
// beantwortet: „ist die ZEILE zu lang?" gegen „wie lese ich diese GRUPPE?".
var AVESMAPS_LORE_LETTER_MIN = 0;

// Der Buchstabe, unter dem ein Name einsortiert wird. Umlaute fallen auf ihren Grundbuchstaben
// (Ä -> A), sonst haette „Älbler" eine eigene Marke hinter Z.
function avesmapsLoreLetterOf(name) {
	var first = String(name || "").trim().charAt(0);
	if (!first) {
		return "#";
	}
	var folded = first.normalize ? first.normalize("NFD").replace(/[̀-ͯ]/g, "") : first;
	folded = folded.toUpperCase();
	return /[A-Z]/.test(folded) ? folded : "#";
}

function avesmapsLoreGroupOf(entry) {
	if ((entry.relations || []).indexOf("herkunft") >= 0) {
		return "origin";
	}
	var rank = Number(entry && entry.rank);
	return rank >= 3 ? "rank3" : (rank >= 1 ? "rank1" : "rank0");
}

// Der volle Inhalt eines Deckels: alle Einträge, nach Nähe gegliedert.
//
// ⚠️ Eine leere Gruppe entfällt samt Überschrift -- eine Überschrift ohne Inhalt ist kein Aufbau,
// sondern Lärm. Bei den meisten Orten bleibt genau eine Gruppe übrig, und dann steht deren
// Überschrift auch nicht da: eine einzige Gruppe gliedert nichts.
function avesmapsLoreGroupedMarkup(entries, lead) {
	var buckets = {};
	(entries || []).forEach(function (entry) {
		var key = avesmapsLoreGroupOf(entry);
		(buckets[key] = buckets[key] || []).push(entry);
	});
	// Die Freitext-Handelswaren führen die erste Gruppe an -- erst die Gattungen der Gegend
	// („Vieh, Holz, Wolltuch"), dann die Stücke mit Namen („Bräubier"). Getrennt lasen sie sich wie
	// ein widersprüchlicher Doppeleintrag (Owner 2026-07-22).
	var leadItems = lead || [];

	var used = AVESMAPS_LORE_GROUPS.filter(function (group) {
		return (buckets[group.key] || []).length > 0;
	});
	var single = used.length <= 1;
	// Zugeklappt startet eine Gruppe erst, wenn die ZEILE lang ist -- nicht die Gruppe. Sonst
	// verstecke ich bei „3 Waren, davon 2 von hier" zwei Namen hinter einem Klick.
	var klappen = !single && (leadItems.length + (entries || []).length) >= AVESMAPS_LORE_GROUP_LID_MIN;

	var out = "";
	used.forEach(function (group, index) {
		var items = (buckets[group.key] || []).slice();
		if (index === 0) {
			// Die Freitext-Handelswaren gehören in die erste Gruppe, nicht daneben (Owner
			// 2026-07-22) -- und ab den Buchstabenmarken reihen sie sich mit ein, statt vorneweg
			// zu stehen: getrennt lasen sie sich wie ein widersprüchlicher Doppeleintrag, und
			// genau das war der Grund, sie zusammenzulegen.
			items = leadItems.concat(items);
		}
		var inhalt = avesmapsLoreNamesBlockMarkup(items);
		if (single) {
			out += inhalt;
			return;
		}
		var kopf = '<span class="avesmaps-lore__gruppe-name">' + avesmapsLoreEscape(group.label) + "</span>"
			+ '<span class="avesmaps-lore__gruppe-zahl">' + items.length + "</span>";
		out += klappen
			// 💣 Natives <details> wie beim Deckel selbst: nur so findet Strg+F einen Namen in einer
			// ZUgeklappten Gruppe und klappt sie auf. Die erste Gruppe steht offen -- bei den Waren
			// ist das „Von hier", die stärkste Aussage über den Ort.
			? '<details class="avesmaps-lore__gruppe"' + (index === 0 ? " open" : "") + ">"
				+ '<summary class="avesmaps-lore__gruppe-kopf">' + kopf + "</summary>" + inhalt + "</details>"
			: '<div class="avesmaps-lore__gruppe avesmaps-lore__gruppe--fest">'
				+ '<div class="avesmaps-lore__gruppe-kopf">' + kopf + "</div>" + inhalt + "</div>";
	});
	if (out === "" && leadItems.length) {
		out = avesmapsLoreNamesBlockMarkup(leadItems);
	}
	return out;
}

// Die Namen EINER Gruppe. Wenige stehen als Komma-Liste da, wie bisher; viele bekommen
// Buchstabenmarken und laufen in Spalten (Owner 12.08.2026, an 126 Handelswaren entschieden).
//
// ⭐ `columns: 2 150px` im Stylesheet ist EINE Regel für beide Fälle: am Telefon ist für eine zweite
// Spalte kein Platz, also fällt es von selbst auf eine zurück. Eine Breiten-Query wäre eine zweite
// Fassung von „schmal" -- genau die Divergenz, vor der AGENTS.md §12 warnt.
//
// 💣 Sortiert wird mit `localeCompare(…, "de")`, nicht mit `<`: sonst stünde „Älbler" hinter „Zwerg"
// und bekäme eine eigene Marke am Ende, während seine Marke „A" heißt.
function avesmapsLoreNamesBlockMarkup(items) {
	var list = items || [];
	// ⚠️ Leere Liste zuerst: bei Schwelle 0 greift der Komma-Zweig nie mehr, und ohne diesen Riegel
	// entstünde ein leerer Spalten-Kasten. Erreichbar ist der Fall heute nicht (leere Gruppen werden
	// vorher aussortiert) -- er kostet eine Zeile und schließt die Lücke, die die 0 aufgemacht hat.
	if (list.length === 0) {
		return "";
	}
	if (list.length < AVESMAPS_LORE_LETTER_MIN) {
		return '<span class="avesmaps-lore__names">' + list.map(avesmapsLoreNameMarkup).join(", ") + "</span>";
	}
	var sorted = list.slice().sort(function (left, right) {
		return String((left && left.name) || "").localeCompare(String((right && right.name) || ""), "de");
	});
	var blocks = [];
	var current = null;
	sorted.forEach(function (item) {
		var letter = avesmapsLoreLetterOf(item && item.name);
		if (!current || current.letter !== letter) {
			current = { letter: letter, names: [] };
			blocks.push(current);
		}
		current.names.push(avesmapsLoreNameMarkup(item));
	});
	return '<div class="avesmaps-lore__spalten">' + blocks.map(function (block) {
		return '<div class="avesmaps-lore__buchstabenblock">'
			+ '<span class="avesmaps-lore__buchstabe">' + avesmapsLoreEscape(block.letter) + "</span>"
			+ '<span class="avesmaps-lore__names">' + block.names.join(", ") + "</span></div>";
	}).join("") + "</div>";
}

// EINE Infobox-Zeile im Hausformat (.region-info-box__row + dt/dd) -- ihr Wert ist ein Deckel.
function avesmapsLoreInfoRowMarkup(row, entries, total, placeKey, extras) {
	if (typeof buildInfoboxLid !== "function") {
		return "";   // Bauteil nicht geladen: lieber keine Zeile als eine kaputte
	}
	var all = entries || [];
	// Doppelungen vermeiden: „Salz" kann als Freitext-Ware UND im Katalog stehen.
	var seen = {};
	(extras || []).forEach(function (item) {
		seen[String((item && item.name) || "").toLowerCase()] = true;
	});
	all = all.filter(function (entry) {
		return !seen[String((entry && entry.name) || "").toLowerCase()];
	});
	var lead = extras || [];
	if (all.length === 0 && lead.length === 0) {
		return "";
	}

	// 🔴 DIE ZAHL IM SATZ IST, WAS AUFGEKLAPPT DASTEHT -- nicht die Serverzahl `total`. Seit der
	// Abruf vollständig ist (full=1), sind beide gleich; auseinander liefen sie nur, wenn jemand die
	// Grenze wieder einzöge. Ein Satz, der mehr verspricht als das Aufgeklappte zeigt, ist genau die
	// stille Lüge, die niemand bemerkt.
	var count = lead.length + all.length;

	// 🔴 ZUGEKLAPPT STEHEN KEINE NAMEN DA (Owner 2026-08-12: „ohne weitere Angaben"). Die Zeile ist
	// dann nur ihr knapper Satz -- „11 Handelswaren gelistet" -- und der Öffner daneben. Aufgeklappt
	// tritt der volle Satz an dieselbe Stelle und darunter die Gruppen.
	//
	// ⭐ OHNE AUSNAHME, auch bei zwei Einträgen (Owner 2026-08-12: „auch 2 Tierarten leben hier /
	// Berglöwe, Griswolf <- einklappen"). Der Gewinn ist nicht der Platz, sondern dass alle Zeilen
	// einer Box gleich aussehen und sich gleich verhalten.
	var lid = buildInfoboxLid({
		preview: "",
		full: avesmapsLoreGroupedMarkup(all, lead),
		count: count,
		singular: row.singular,
		plural: row.plural,
	});
	return '<div class="region-info-box__row avesmaps-lore__row"><dt>' + avesmapsLoreEscape(row.label)
		+ "</dt><dd>" + lid + "</dd></div>";
}

// Füllt jeden offenen Container dieses Ortes. Wird nach dem Abruf aufgerufen und ist
// idempotent -- ein zweiter Lauf schreibt dasselbe.
function avesmapsLoreFillContainers(placeKey, placeName, data) {
	var containers = document.querySelectorAll('[data-lore-place="' + placeKey + '"]');
	if (!containers.length) {
		return; // Panel inzwischen geschlossen -- nichts zu tun
	}
	var markup = "";
	if (data && data.sections) {
		// Die aufgelösten Handelswaren gehen VORNE in die Waren-Zeile. Reihenfolge wie
		// im Infobox-Feld, damit man sie wiedererkennt; verlinkt, wo es einen Artikel gibt.
		var goodsLead = [];
		if (data.goods_order && data.goods_order.length) {
			data.goods_order.forEach(function (name) {
				var hit = data.goods && data.goods[name];
				goodsLead.push({ name: name, wiki_url: hit ? hit.wiki_url : "" });
			});
		}
		// Welche Zeilen dieser Container zeigen will. Ohne Angabe: alle -- jede bestehende
		// Aufrufstelle (Siedlung, Region, Label) bleibt damit unverändert.
		//
		// 💣 AVESMAPS_LORE_ROWS WIRD NICHT ANGEFASST. Die Liste steht auf Modulebene und
		// speist AUCH die Siedlungs-Infobox; wer die Waren dort herausnähme, nähme sie
		// überall heraus, und niemand sähe den Zusammenhang. Die Auswahl gehört an den
		// Container. (V10: eine Routen-Etappe zeigt nur Flora und Fauna, Owner 2026-07-29.)
		var wantedKinds = null;
		for (var kindIndex = 0; kindIndex < containers.length; kindIndex++) {
			var declared = containers[kindIndex].getAttribute("data-lore-kinds") || "";
			if (declared) {
				wantedKinds = declared.split("|");
				break;
			}
		}
		AVESMAPS_LORE_ROWS.forEach(function (row) {
			if (wantedKinds && wantedKinds.indexOf(row.kind) < 0) {
				return;
			}
			markup += avesmapsLoreInfoRowMarkup(
				row,
				data.sections[row.kind] || [],
				(data.counts && data.counts[row.kind]) || 0,
				placeKey,
				row.kind === "ware" ? goodsLead : null
			);
		});
	}
	for (var i = 0; i < containers.length; i++) {
		containers[i].innerHTML = markup;
	}
}

// Lädt die Lore für jeden Container, der NEU im Dokument steht. Das ist der einzige
// Ort, an dem ein Abruf startet.
//
// Warum überhaupt ein Beobachter: das Markup entsteht lange bevor es angezeigt wird
// (bindPopup bekommt fertiges HTML für JEDES Label). Erst wenn ein Container wirklich
// im DOM hängt, schaut jemand hin -- und nur dann lohnt der Abruf. So wird aus
// „hunderte Anfragen beim Kartenaufbau" „eine Anfrage pro geöffnetem Panel".
function avesmapsLoreLoadPendingContainers() {
	if (!AVESMAPS_LORE_ENABLED) {
		return;
	}
	var pending = document.querySelectorAll("[data-lore-place]:not([data-lore-loaded])");
	for (var i = 0; i < pending.length; i++) {
		var el = pending[i];
		el.setAttribute("data-lore-loaded", "1"); // sofort markieren: kein Doppelabruf
		(function (element) {
			var containerKey = element.getAttribute("data-lore-place") || "";
			var name = element.getAttribute("data-lore-name") || "";
			avesmapsLoreFetch({
				key: element.getAttribute("data-lore-fetch") || "",
				// 🔴 VOLLSTÄNDIG, seit der Deckel den „+N"-Dialog ersetzt hat (2026-08-12). Der Deckel
				// trägt seinen ganzen Inhalt im Dokument -- nur so findet ihn Strg+F im zugeklappten
				// Zustand, und nur so kann er ohne zweiten Abruf aufklappen. Es ist derselbe EINE
				// Abruf wie vorher: `full` steuert allein, ob der Server seine Liste noch beschneidet
				// (array_slice in avesmapsLoreReadForPlaces), nicht wie er sie holt. Die Abfrage ist
				// Zeile für Zeile dieselbe, nur die Antwort ist länger.
				full: true,
				titles: element.getAttribute("data-lore-titles") || "",
				goods: element.getAttribute("data-lore-goods") || "",
				// Identität: reist mit dem Container von buildLoreMarkup bis hierher, siehe
				// data-lore-area/data-lore-location/data-lore-territory dort.
				area: element.getAttribute("data-lore-area") || "",
				location: element.getAttribute("data-lore-location") || "",
				territory: element.getAttribute("data-lore-territory") || "",
			}).then(function (data) {
				if (data && data.total > 0) {
					avesmapsLoreFillContainers(containerKey, name, data);
				}
			});
		})(el);
	}
}

if (typeof document !== "undefined" && !document.__avesmapsLoreObserverBound) {
	document.__avesmapsLoreObserverBound = true;
	var avesmapsLoreScanTimer = null;
	var scheduleScan = function () {
		// Entprellt: ein geöffnetes Popup löst viele Mutationen aus, gescannt wird einmal.
		window.clearTimeout(avesmapsLoreScanTimer);
		avesmapsLoreScanTimer = window.setTimeout(avesmapsLoreLoadPendingContainers, 120);
	};
	if (typeof MutationObserver === "function") {
		new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
	}
	document.addEventListener("DOMContentLoaded", scheduleScan);
}

// Ortsreferenz aus einem regionEntry des Infopanels. Zwei Quellen, wie beim
// Abenteuer-Block: ein politisches Territorium trägt seinen Server-wiki_key erst in
// regionEntry.detail (territory-detail.php), eine Landschaftsregion in
// properties.wiki_region. Vor dem Detail-Fetch gibt es noch keinen Schlüssel -> "" ->
// kein Abschnitt; die zweite Renderrunde holt ihn nach.
function avesmapsLorePlaceRefFromRegion(regionEntry) {
	if (!regionEntry) {
		return null;
	}
	var detail = (regionEntry.detail && regionEntry.detail.ok) ? regionEntry.detail : null;
	var wikiRegion = regionEntry.wikiRegion || regionEntry.wiki_region || null;
	var raw = (detail && detail.wiki_key)
		|| (wikiRegion && wikiRegion.wiki_key)
		|| regionEntry.wikiKey || regionEntry.wiki_key || "";
	var key = avesmapsLoreNormalizeKey(raw);
	if (!key) {
		return null;
	}
	return { key: key, name: regionEntry.displayName || regionEntry.name || "" };
}

// Wiki-Titel aus einer Wiki-URL: „…/wiki/Thorwal_(Siedlung)" -> „Thorwal (Siedlung)".
// Der Titel geht an den Server, DER sluggt -- siehe Umlaut-Falle in api/app/lore.php.
function avesmapsLoreTitleFromUrl(wikiUrl) {
	var url = String(wikiUrl || "");
	if (url.indexOf(AVESMAPS_LORE_URL_PREFIX) !== 0 || url.indexOf("/wiki/") < 0) {
		return "";
	}
	try {
		return decodeURIComponent(url.split("/wiki/")[1] || "").replace(/_/g, " ").trim();
	} catch (error) {
		return "";
	}
}

// Öffentlicher Einstieg: liefert SOFORT den (leeren) Container und stößt den Abruf an.
// placeRef: { key, name, titles, area, location, territory } -- key ist ein fertiger
// Server-Schlüssel, titles sind Wiki-Titel, die der Server selbst sluggt (mit | getrennt).
// area/location/territory sind die IDENTITÄT (public_id) des Objekts hinter diesem Container --
// alle drei optional, siehe avesmapsLoreRequestKey.
function buildLoreMarkup(placeRef) {
	if (!AVESMAPS_LORE_ENABLED) {
		return ""; // Not-Aus: gar kein Container, also auch kein Abruf
	}
	var key = avesmapsLoreNormalizeKey(placeRef && (placeRef.key || placeRef.wikiKey || placeRef.wiki_key));
	var titles = (placeRef && placeRef.titles) || "";
	// Identität des Objekts, dessen Infobox dieser Container füllt -- public_id einer
	// Landschaftsfläche (area, seit Task 9 auch eine Kommaliste mehrerer), einer Siedlung
	// (location) oder eines Herrschaftsgebiets (territory). Optional, wie titles/goods unten:
	// nur gesetzt, wenn der Aufrufer sie kennt.
	var area = String((placeRef && placeRef.area) || "");
	var location = String((placeRef && placeRef.location) || "");
	var territory = String((placeRef && placeRef.territory) || "");
	// 💣 Task 4b/9: der Riegel muss auch bei GESETZTER IDENTITÄT ohne key/titles öffnen -- ein Ort
	// oder ein Gebiet ganz ohne Wiki-Artikel hat weder key noch titles, aber seine public_id
	// (location/territory) reicht dem Server, um die Lebensraum-Regel gegen genau dieses Objekt
	// zu prüfen. Fehlen alle fünf, gibt es nichts, das der Server treffen könnte: "".
	if (!key && !titles && !area && !location && !territory) {
		return "";
	}
	// Container-Id: bei reiner Titel-Anfrage der Titel selbst, sonst der Schlüssel. Ohne beides
	// (nur Identität) bleibt containerKey hier "" -- der Identitäts-Block direkt darunter macht
	// ihn aus area/location/territory allein eindeutig und stabil, siehe dort.
	var containerKey = key || titles.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase().slice(0, 190);
	// 💣 Identität gehört IN den Container-Schlüssel, nicht nur in den Abruf (siehe
	// avesmapsLoreRequestKey): avesmapsLoreFillContainers sucht Container über
	// `[data-lore-place="<containerKey>"]`. Zwei Container mit gleichem Ortsschlüssel, aber
	// verschiedener Identität (Siedlung + die Fläche, in der sie liegt, ist der Normalfall)
	// träfen sonst denselben Selektor und würden beide mit der zuerst eintreffenden Antwort
	// gefüllt. Nur aktiv, wenn Identität da ist -- ohne sie bleibt der Schlüssel exakt wie
	// vor dieser Änderung. Landet in einem HTML-Attribut und einem CSS-Attributselektor,
	// deshalb dieselbe Filterung/Kürzung wie beim Titel-Zweig oben.
	//
	// 💣 SYMMETRISCH zu avesmapsLoreRequestKey: alle drei Felder tragen UNABHÄNGIG voneinander
	// bei, nicht als Entweder-Oder. Ein Entweder-Oder ließe zwei Container mit gleichem `key` +
	// `area`, aber verschiedener `location`/`territory` wieder auf denselben Selektor fallen.
	if (area || location || territory) {
		var identityTag = (area ? "-a-" + area : "") + (location ? "-l-" + location : "")
			+ (territory ? "-te-" + territory : "");
		containerKey = (containerKey + identityTag).replace(/[^a-z0-9_-]+/gi, "-").toLowerCase().slice(0, 190);
	}
	var name = (placeRef && (placeRef.name || placeRef.displayName)) || "";
	// 💣 HIER WIRD NICHT GELADEN. buildLoreMarkup() läuft für JEDES Label schon beim
	// Anlegen des Markers (map-features-labels.js:469 ruft bindPopup mit fertigem
	// HTML), nicht erst beim Öffnen. Ein Abruf an dieser Stelle bedeutete hunderte
	// gleichzeitige Anfragen beim Kartenaufbau -- genau das hat den PHP-Pool
	// gesättigt. Geladen wird erst, wenn der Container WIRKLICH im DOM steht; darum
	// kümmert sich der Beobachter weiter unten.
	// Container OHNE eigene Hülle: er sitzt mitten in der Feldliste der Infobox und
	// füllt sich mit .region-info-box__row-Zeilen. display:contents lässt seine Kinder
	// direkt ins Zeilenraster greifen, statt es zu brechen.
	// Die Freitext-Handelswaren reisen mit, damit der Server sie gegen den Warenkatalog
	// auflösen kann -- Ergebnis: eine Zeile statt zweier, mit Links wo es Artikel gibt.
	var goods = String((placeRef && placeRef.tradeGoods) || "").split(/\s*[,;]\s*/)
		.map(function (part) { return part.trim(); }).filter(Boolean).join("|");

	// Welche Arten dieser Container zeigen soll („flora|fauna" an einer Routen-Etappe).
	// Leer = alle, also unverändert für jede bestehende Aufrufstelle.
	var kinds = String((placeRef && placeRef.kinds) || "");

	return '<div class="avesmaps-lore-rows" data-lore-place="' + avesmapsLoreEscape(containerKey)
		+ '" data-lore-fetch="' + avesmapsLoreEscape(key)
		+ '" data-lore-name="' + avesmapsLoreEscape(name)
		+ '" data-lore-kinds="' + avesmapsLoreEscape(kinds)
		+ '" data-lore-goods="' + avesmapsLoreEscape(goods)
		+ '" data-lore-area="' + avesmapsLoreEscape(area)
		+ '" data-lore-location="' + avesmapsLoreEscape(location)
		+ '" data-lore-territory="' + avesmapsLoreEscape(territory)
		+ '" data-lore-titles="' + avesmapsLoreEscape(titles) + '"></div>';
}

// Ortsreferenz einer SIEDLUNG. Zwei Wege, beide gebraucht:
//   1. die Siedlung selbst -- manche sind direkt gelistet (Ork nennt „Thorwal (Siedlung)")
//   2. ihr Territorium aus dem Raycast -- darüber erreicht sie die Lore ihrer Region,
//      denn Siedlungen tragen selbst kein Region-Feld im Staging
// Beides geht als TITEL an den Server, der sluggt (Umlaut-Falle, siehe lore.php).
function avesmapsLorePlaceRefFromLocation(location) {
	if (!location) {
		return null;
	}
	var wiki = location.wikiSettlement || {};
	var titles = [];
	var ownTitle = avesmapsLoreTitleFromUrl(wiki.wiki_url || location.wiki_url || location.wikiUrl || "");
	if (ownTitle) {
		titles.push(ownTitle);
	}
	var territoryKey = avesmapsLoreNormalizeKey(
		location.territoryWikiKey || location.territory_wiki_key
		|| (location.properties && location.properties.territory_wiki_key) || ""
	);
	// Identität der SIEDLUNG selbst (nicht die ihres Territoriums -- territoryKey oben ist der
	// Ortsschlüssel, nicht die Identität). Der Server braucht sie, um seine Lebensraum-Regeln
	// gegen genau dieses Objekt zu prüfen.
	var locationId = String(location.publicId || location.public_id || "");
	// 💣 Task 4b: OHNE Wiki-Artikel und OHNE Territorium bleibt nur die public_id -- und die
	// reicht dem Server (siehe api/app/lore.php), um die Lebensraum-Regel gegen den Ort zu
	// prüfen. Das betrifft die MEHRHEIT der Siedlungen (2.885 von 4.883, gemessen): genau für
	// sie wurde die Regel erfunden. Erst wenn auch die public_id fehlt, bleibt es bei null.
	if (!titles.length && !territoryKey && !locationId) {
		return null;
	}
	return {
		key: territoryKey,
		titles: titles.join("|"),
		name: wiki.name || location.name || "",
		location: locationId,
	};
}
