// Die Infobox-Zeile „Stätten" — was an besonderen Bauwerken IN einem Ort liegt.
// ============================================================================
// Ein Ort trägt im Wiki Dutzende Bauwerke, die keine eigene Kartenposition haben: Stadttempel,
// Akademien, Plätze, Brücken, Kontore. Sie reisen längst im Kartenpayload mit
// (`in_settlement_places`, api/_internal/app/in-settlement-search.php) und wurden bisher nur von
// der Suche und dem Wegpunkt-Autocomplete gelesen. Diese Datei ist der dritte Leser: sie zeigt
// sie dort, wo man sie sucht -- in der Infobox des Ortes selbst (Owner 2026-08-15).
//
// ⭐ KEINE eigene Abfrage, kein Nachladen. Die Zeile steht synchron da, sobald das Popup gebaut
// wird -- wie die Klimazone und anders als Waren/Fauna/Flora, die auf api/app/lore.php warten.
//
// 💣 Die Optik kommt von den LORE-Klassen, und das ist Absicht. `buildInfoboxLid` liefert den
// Deckel, `avesmaps-lore__gruppe*` die Gruppenköpfe. Eine dritte Rezeptur für „Liste von Namen
// in einer Infobox-Klappzeile" wäre genau die Divergenz, vor der AGENTS.md §11 bei den
// Listenzeilen warnt („es gibt ZWEI, und das ist die Obergrenze"). Wer die Lore-Gruppen
// umbaut, baut diese Zeile mit um -- das ist der Preis und er ist billiger als zwei Fassungen.

// Einzahl und Mehrzahl, sonst entsteht „1 besondere Stätten" (dieselbe Regel wie bei den
// Lore-Zeilen). ⭐ Der Satz sagt, was ERFASST ist, nicht was am Ort gilt: er muss zugeklappt
// wie aufgeklappt an derselben Stelle dasselbe sagen (Owner-Entscheid 2026-08-12 am Deckel).
var AVESMAPS_STAETTEN_SINGULAR = "besondere Stätte verzeichnet";
var AVESMAPS_STAETTEN_PLURAL = "besondere Stätten verzeichnet";

// Ab wie vielen Einträgen die Art-Gruppen selbst zuklappen. Gemessen am Livebestand
// (15.08.2026): 266 Orte tragen Stätten, der Median ist 2 -- aber Gareth hat 154, Punin 120,
// Al'Anfa 83. Ohne diese Schwelle wäre die Zeile bei den drei Großen unlesbar und bei den 107
// Orten mit einem einzigen Eintrag albern. Derselbe Wert wie bei den Lore-Gruppen.
var AVESMAPS_STAETTEN_GRUPPEN_KLAPP_AB = 25;

// Der Index Stadtname -> Stätten, EINMAL gebaut. Der Payload bringt eine flache Liste über alle
// Orte (1774 Einträge); je Popup durchzusuchen wäre eine lineare Suche pro Öffnen.
var avesmapsStaettenIndex = null;
var avesmapsStaettenIndexGroesse = -1;

// Namen falten, damit „Grangor" und „grangor" denselben Eimer treffen. Bewusst KEIN
// Umlaut-Mapping: der Stadtname im Payload stammt aus derselben Quelle wie der Ortsname der
// Karte (avesmapsPlaceScopeFoldName hat ihn schon gegeneinander aufgelöst), es geht hier nur
// um Groß-/Kleinschreibung und Ränder.
function avesmapsStaettenSchluessel(name) {
	return String(name || "").trim().toLowerCase();
}

// Baut den Index neu, wenn die Payload-Liste sich in der LÄNGE geändert hat.
// ⚠️ Die Länge ist der Wächter, nicht der Inhalt -- dieselbe Regel wie beim Wegpunkt-Cache.
// Ein Eintrag, der bei gleicher Anzahl umbenannt wird, wird also erst nach einem Neuladen
// sichtbar. Das ist billig und für einen Bestand, der nur beim WikiSync wächst, ausreichend.
function avesmapsStaettenBaueIndex() {
	var liste = (typeof window !== "undefined" && Array.isArray(window.avesmapsInSettlementPlaces))
		? window.avesmapsInSettlementPlaces
		: [];
	if (avesmapsStaettenIndex && avesmapsStaettenIndexGroesse === liste.length) {
		return avesmapsStaettenIndex;
	}
	var index = {};
	liste.forEach(function (eintrag) {
		var stadt = avesmapsStaettenSchluessel(eintrag && eintrag.settlement);
		var name = String((eintrag && eintrag.name) || "").trim();
		if (stadt === "" || name === "") {
			return;
		}
		(index[stadt] = index[stadt] || []).push({
			name: name,
			// Ohne Art steht „Bauwerk" da -- dieselbe Ersatzangabe, die der Server der Suche gibt
			// (in-settlement-search.php). Eine leere Gruppenüberschrift wäre schlimmer.
			art: String((eintrag && eintrag.type) || "").trim() || "Bauwerk",
			wiki_url: String((eintrag && eintrag.wiki_url) || "").trim(),
		});
	});
	avesmapsStaettenIndex = index;
	avesmapsStaettenIndexGroesse = liste.length;
	return index;
}

// Die Stätten EINES Ortes. Öffentlich, damit Tests und andere Oberflächen sie ohne das Markup
// bekommen können.
function avesmapsStaettenFuerOrt(ortsname) {
	var index = avesmapsStaettenBaueIndex();
	return index[avesmapsStaettenSchluessel(ortsname)] || [];
}

// Die Namen einer Art -- ⭐ ÜBER DIE LORE-FUNKTION, nicht abgeschrieben.
// avesmapsLoreNamesBlockMarkup nimmt genau unsere Form ({name, wiki_url}) und verlinkt, wo es
// einen Artikel gibt. Ihr Markup von Hand zu spiegeln hiesse, drei CSS-Klassen zu erraten.
//
// 🔴 BUCHSTABENMARKEN ERST AB ZWEI NAMEN (Owner 2026-08-15, in zwei Schritten: erst „das mit den
// buchstaben ist hier übertrieben", dann „kannst du ab >1 wieder buchstaben machen?").
//
// Der Streitpunkt war nie die Marke selbst, sondern die Marke über einem EINZIGEN Namen:
// „H · Herzog-Cusimo-Aquädukt" ist eine Gliederung von einem Element. Bei „Tempel 10" trägt sie
// dagegen -- dort steht sonst eine Komma-Wurst über sechs Zeilen. Der Default der Funktion (0 =
// immer) passt zu den Vorkommen, wo 126 Handelswaren in EINER Gruppe stehen; hier gliedert schon
// die ART vor, und Grangors 23 Arten haben im Schnitt 1,8 Einträge.
// ⚠️ Sie stammt aus map-features-lore.js -- diese Datei wird in index.html DANACH geladen.
var AVESMAPS_STAETTEN_BUCHSTABEN_AB = 2;

function avesmapsStaettenNamenMarkup(items) {
	if (typeof avesmapsLoreNamesBlockMarkup === "function") {
		return avesmapsLoreNamesBlockMarkup(items, AVESMAPS_STAETTEN_BUCHSTABEN_AB);
	}
	// Rückfall, falls die Lore-Datei fehlt: blanke Namen, ohne Link. Lieber schlicht als leer.
	return '<span class="avesmaps-lore__names">'
		+ items.map(function (i) { return escapeHtml(i.name); }).join(", ") + "</span>";
}

// Der aufgeklappte Inhalt: nach ART gegliedert, Arten deutsch sortiert, innerhalb einer Art die
// Namen ebenfalls.
//
// 🔴 GEGLIEDERT, nicht flach. Bei den Waren war die Bündelung nach Kategorie verworfen worden,
// weil `gruppe` dort 50-mal „profan" sagte. Hier trägt die Art echte Information und teilt gut:
// Gareths 154 Stätten fallen in rund 20 Arten, Grangors 41 in etwa 15. Eine flache Liste von 154
// Namen wäre die Zeile, die niemand aufklappt.
//
// ⚠️ EINE Art bekommt keine Überschrift -- wie bei den Lore-Gruppen. Bei „1 besondere Stätte" ist
// der Kopf „Tempel 1" über einem einzigen Namen nur Lärm.
function avesmapsStaettenGruppenMarkup(eintraege) {
	var eimer = {};
	(eintraege || []).forEach(function (eintrag) {
		(eimer[eintrag.art] = eimer[eintrag.art] || []).push(eintrag);
	});
	var arten = Object.keys(eimer).sort(function (a, b) {
		return a.localeCompare(b, "de");
	});
	var einzeln = arten.length <= 1;
	var klappen = !einzeln && (eintraege || []).length >= AVESMAPS_STAETTEN_GRUPPEN_KLAPP_AB;

	var out = "";
	arten.forEach(function (art, i) {
		var items = eimer[art].slice().sort(function (a, b) {
			return a.name.localeCompare(b.name, "de");
		});
		var namen = avesmapsStaettenNamenMarkup(items);
		if (einzeln) {
			out += namen;
			return;
		}
		var kopf = '<span class="avesmaps-lore__gruppe-name">' + escapeHtml(art) + "</span>"
			+ '<span class="avesmaps-lore__gruppe-zahl">' + items.length + "</span>";
		out += klappen
			// 💣 Natives <details> wie beim Deckel selbst -- nur so findet Strg+F einen Namen in
			// einer ZUgeklappten Gruppe und klappt sie auf. Die erste Art steht offen.
			? '<details class="avesmaps-lore__gruppe"' + (i === 0 ? " open" : "") + ">"
				+ '<summary class="avesmaps-lore__gruppe-kopf">' + kopf + "</summary>" + namen + "</details>"
			: '<div class="avesmaps-lore__gruppe avesmaps-lore__gruppe--fest">'
				+ '<div class="avesmaps-lore__gruppe-kopf">' + kopf + "</div>" + namen + "</div>";
	});
	return out;
}

// Die fertige Infobox-Zeile für einen Ort. Leerer String, wenn der Ort keine Stätten hat -- eine
// Zeile „0 besondere Stätten" wäre eine Aussage über unseren Datenbestand, die niemanden
// interessiert, und sie stünde bei den meisten der 4653 Orte da.
//
// 💣 Ohne buildInfoboxLid gibt es KEINE Zeile statt einer kaputten (dieselbe Regel wie bei den
// Lore-Zeilen): das Bauteil liegt in js/ui/infobox-lid.js und wird vor dieser Datei geladen.
function avesmapsStaettenRowMarkup(ortsname) {
	if (typeof buildInfoboxLid !== "function") {
		return "";
	}
	var eintraege = avesmapsStaettenFuerOrt(ortsname);
	if (!eintraege.length) {
		return "";
	}
	var lid = buildInfoboxLid({
		preview: "",
		full: avesmapsStaettenGruppenMarkup(eintraege),
		count: eintraege.length,
		singular: AVESMAPS_STAETTEN_SINGULAR,
		plural: AVESMAPS_STAETTEN_PLURAL,
	});
	var label = (typeof tr === "function") ? tr("popup.fieldPlaces", "Stätten") : "Stätten";
	return '<div class="region-info-box__row avesmaps-lore__row"><dt>' + escapeHtml(label)
		+ "</dt><dd>" + lid + "</dd></div>";
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsStaettenFuerOrt: avesmapsStaettenFuerOrt,
		avesmapsStaettenGruppenMarkup: avesmapsStaettenGruppenMarkup,
		avesmapsStaettenRowMarkup: avesmapsStaettenRowMarkup,
	};
}
