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

// placeKey -> { data } | { pending: Promise }. Ein Ort wird höchstens einmal geholt.
var avesmapsLoreCache = new Map();

// Sektionen in Anzeigereihenfolge + ihre Überschriften. Reihenfolge ist bewusst
// Pflanzen -> Tiere -> Waren: Flora/Fauna sind die dichteren, aussagekräftigeren Daten,
// Handelswaren sind breiter gestreut (rund die Hälfte trägt gar keinen Ort).
var AVESMAPS_LORE_SECTIONS = [
	{ kind: "flora", label: "Pflanzen" },
	{ kind: "fauna", label: "Tiere" },
	{ kind: "spezies", label: "Spezies" },
	{ kind: "ware", label: "Handelswaren" },
];

function avesmapsLoreEscape(value) {
	return String(value == null ? "" : value)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Server-wiki_key -> Ortsschlüssel der Lore-Tabellen. Territorien tragen die
// 'wiki:'-Form (avesmapsPoliticalBuildWikiKey), lore_place führt den reinen Slug.
function avesmapsLoreNormalizeKey(raw) {
	var key = String(raw == null ? "" : raw).trim().toLowerCase();
	if (key.indexOf("wiki:") === 0) {
		key = key.slice(5);
	}
	if (key.indexOf("name:") === 0) {
		key = key.slice(5);
	}
	return /^[a-z0-9_-]{1,190}$/.test(key) ? key : "";
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

// EIN Listeneintrag -- von der Sektion UND vom „alle anzeigen"-Handler genutzt, damit
// die aufgeklappte Liste nicht anders aussieht als die kurze.
function avesmapsLoreItemMarkup(entry) {
	var name = avesmapsLoreEscape(entry && entry.name);
	var href = avesmapsLoreSafeUrl(entry && entry.wiki_url);
	var link = href
		? '<a class="avesmaps-lore__name" href="' + avesmapsLoreEscape(href) + '" target="_blank" rel="noopener">' + name + " ↗</a>"
		: '<span class="avesmaps-lore__name">' + name + "</span>";
	var meta = avesmapsLoreRenderWikiText((entry && (entry.typ || entry.gruppe)) || "");
	return '<li class="avesmaps-lore__item">' + link
		+ (meta ? ' <span class="avesmaps-lore__meta">' + meta + "</span>" : "")
		+ "</li>";
}

// Wandelt Wiki-Rohmarkup eines Feldwerts in echte Links um: „[[Laubbaum]]" wird
// klickbar, „[[Inseln im Nebel (Globule)|Inseln im Nebel]]" zeigt den Anzeigetext.
// Alles außerhalb der Klammern bleibt Text (und wird escaped).
function avesmapsLoreRenderWikiText(raw) {
	var text = String(raw == null ? "" : raw);
	if (!text) {
		return "";
	}
	var out = "";
	var lastIndex = 0;
	var pattern = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
	var match;
	while ((match = pattern.exec(text)) !== null) {
		out += avesmapsLoreEscape(text.slice(lastIndex, match.index));
		var target = match[1].trim();
		var label = (match[2] || match[1]).trim();
		var href = "https://de.wiki-aventurica.de/wiki/" + encodeURIComponent(target.replace(/ /g, "_")).replace(/%2F/g, "/");
		out += '<a class="avesmaps-lore__link" href="' + avesmapsLoreEscape(href) + '" target="_blank" rel="noopener">'
			+ avesmapsLoreEscape(label) + "</a>";
		lastIndex = pattern.lastIndex;
	}
	out += avesmapsLoreEscape(text.slice(lastIndex));
	return out;
}

// Holt die Lore eines Ortes (einmal je Ort). Mehrere Schlüssel werden kommagetrennt
// übergeben -- so kann Abschnitt 3 die Territorienkette hereinreichen, ohne dass sich
// hier etwas ändert.
function avesmapsLoreFetch(placeKey, full) {
	var cacheKey = placeKey + (full ? "|full" : "");
	var cached = avesmapsLoreCache.get(cacheKey);
	if (cached) {
		return cached.pending || Promise.resolve(cached.data);
	}
	var url = AVESMAPS_LORE_API_URL + "?place=" + encodeURIComponent(placeKey) + (full ? "&full=1" : "");
	var pending = fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } })
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

// Eine Sektion als HTML. Leere Sektionen entfallen -- eine Überschrift ohne Inhalt ist
// keine Information, sondern Lärm.
function avesmapsLoreSectionMarkup(section, entries, total, placeName, placeKey) {
	if (!entries || entries.length === 0) {
		return "";
	}
	// gruppe/typ tragen Wiki-Markup ([[Laubbaum]]) -- als Link gerendert ist das ein
	// Gewinn: von „Espe" führt ein Klick zu „Laubbaum".
	var items = entries.map(avesmapsLoreItemMarkup).join("");

	var more = "";
	if (total > entries.length) {
		more = '<button type="button" class="avesmaps-lore__more" data-lore-more="' + avesmapsLoreEscape(placeKey)
			+ '" data-lore-kind="' + avesmapsLoreEscape(section.kind) + '">alle ' + total + " anzeigen</button>";
	}

	return '<div class="avesmaps-lore__section">'
		+ '<h4 class="avesmaps-lore__heading">' + avesmapsLoreEscape(section.label)
		+ (placeName ? " in " + avesmapsLoreEscape(placeName) : "")
		+ ' <span class="avesmaps-lore__count">(' + total + ")</span></h4>"
		+ '<ul class="avesmaps-lore__list">' + items + "</ul>"
		+ more
		+ "</div>";
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
		AVESMAPS_LORE_SECTIONS.forEach(function (section) {
			markup += avesmapsLoreSectionMarkup(
				section,
				data.sections[section.kind] || [],
				(data.counts && data.counts[section.kind]) || 0,
				placeName,
				placeKey
			);
		});
	}
	for (var i = 0; i < containers.length; i++) {
		containers[i].innerHTML = markup;
	}
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

// Öffentlicher Einstieg: liefert SOFORT den (leeren) Container und stößt den Abruf an.
// placeRef: { key, name } -- der Aufrufer weiß, wo sein wiki_key herkommt.
function buildLoreMarkup(placeRef) {
	var key = avesmapsLoreNormalizeKey(placeRef && (placeRef.key || placeRef.wikiKey || placeRef.wiki_key));
	if (!key) {
		return "";
	}
	var name = (placeRef && (placeRef.name || placeRef.displayName)) || "";
	avesmapsLoreFetch(key, false).then(function (data) {
		if (data && data.total > 0) {
			avesmapsLoreFillContainers(key, name, data);
		}
	});
	return '<div class="avesmaps-lore" data-lore-place="' + avesmapsLoreEscape(key) + '"></div>';
}

// „alle N anzeigen": holt die vollständige Liste und ersetzt die Sektion an Ort und
// Stelle. Document-Delegation, damit es im schwebenden Popup wie im Infopanel wirkt --
// und BEWUSST nur ein Handler, einmal registriert: ein Handler je Öffnung hätte sich
// gestapelt (dieselbe Falle wie beim Spoiler-Sammelschalter der Kartensammlung).
if (typeof document !== "undefined" && !document.__avesmapsLoreMoreBound) {
	document.__avesmapsLoreMoreBound = true;
	document.addEventListener("click", function (event) {
		var button = event.target && event.target.closest ? event.target.closest("[data-lore-more]") : null;
		if (!button) {
			return;
		}
		event.preventDefault();
		var placeKey = button.getAttribute("data-lore-more") || "";
		var kind = button.getAttribute("data-lore-kind") || "";
		if (!placeKey || !kind) {
			return;
		}
		button.disabled = true;
		button.textContent = "wird geladen …";
		avesmapsLoreFetch(placeKey, true).then(function (data) {
			var list = data && data.sections ? data.sections[kind] : null;
			var section = button.closest(".avesmaps-lore__section");
			if (!list || !section) {
				button.disabled = false;
				button.textContent = "alle anzeigen";
				return;
			}
			var ul = section.querySelector(".avesmaps-lore__list");
			if (ul) {
				ul.innerHTML = list.map(avesmapsLoreItemMarkup).join("");
			}
			button.remove();
		});
	});
}
