// Place-Extras (Infopanel Phase 6): die Abschnitte "Stadtkarten" (kuratierte externe Karten-Links)
// und "Abenteuer in <Ort>" (aus der Wiki-<Ort>/Abenteuer-Unterseite) fuer das Siedlungs-Popup/-Panel.
//
// HEUTE nur STATISCHE PLATZHALTER-Daten (leicht ersetzbar): sobald echte Daten im map-features-
// Payload ankommen (location.adventures / location.cityMaps), liefern getPlaceAdventures /
// getPlaceCityMaps diese statt der Platzhalter -- der Rest (Markup, Sortierung, "mehr") bleibt gleich.
// Geplant: Abenteuer via Dump-Pipeline (analog Wiki-Publikationen), Stadtkarten kuratiert (Editor).
//
// Sortierung ("neueste/Art/alphabetisch") und "mehr" laufen ueber Document-Delegation und funktionieren
// daher gleich im schwebenden Popup UND im Infopanel. buildLocationMarkerPopupHtml haengt die beiden
// Abschnitte ein (nur fuer Wiki-Siedlungen).

// ---- Platzhalter-Daten (Demo: Gareth; echte Daten von der Wiki-Seite <Ort>/Abenteuer) ----
var AVESMAPS_PLACEHOLDER_ADVENTURES = [
	{ title: "Jagd nach dem Primoptolithen", type: "Soloabenteuer", edition: "", year: 1046, yearLabel: "1046 BF" },
	{ title: "Siegelbruch", type: "Gruppenabenteuer", edition: "DSA5", year: 1044, yearLabel: "1044 BF" },
	{ title: "Aus den Augen, aber nicht aus dem Sinn", type: "Gruppenabenteuer", edition: "DSA5", year: 1041, yearLabel: "1041 BF" },
	{ title: "Feuchte Albträume", type: "Szenario", edition: "DSA5", year: 1040, yearLabel: "1040 BF" },
	{ title: "Der Schattenmarschall", type: "Gruppenabenteuer", edition: "DSA4.1", year: 1040, yearLabel: "Sommer 1040 BF" },
	{ title: "Seelanders Eleven", type: "Kurzabenteuer", edition: "DSA5", year: 1040, yearLabel: "etwa 1040 BF" },
	{ title: "Niobaras Vermächtnis", type: "Gruppenabenteuer", edition: "DSA5", year: 1038, yearLabel: "bis RAH 1038 BF" },
	{ title: "Steinerne Schwingen", type: "Gruppenabenteuer", edition: "DSA4.1", year: 1038, yearLabel: "1038 BF" },
	{ title: "Herren der Unterwelt", type: "Gruppenabenteuer", edition: "DSA4.1", year: 1037, yearLabel: "Anfang 1037 BF" },
	{ title: "Sturm der Gewalt", type: "Gruppenabenteuer", edition: "DSA4.1", year: 1037, yearLabel: "Hochsommer ab 1037 BF" },
];
var AVESMAPS_PLACEHOLDER_ADVENTURES_TOTAL = 57;
var AVESMAPS_PLACEHOLDER_CITYMAPS = [
	{ label: "Gesamtplan", url: "" },
	{ label: "Kaiserviertel", url: "" },
	{ label: "Südquartier", url: "" },
	{ label: "Tempelviertel", url: "" },
];

var AVESMAPS_CITYMAP_THUMB_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>';

// Datenzugriff: echte Payload-Daten bevorzugen, sonst Platzhalter (Demo). So bleibt der Tausch trivial.
function getPlaceAdventures(location) {
	if (location && Array.isArray(location.adventures)) {
		return location.adventures;
	}
	return AVESMAPS_PLACEHOLDER_ADVENTURES;
}
function getPlaceAdventuresTotal(location) {
	if (location && typeof location.adventuresTotal === "number") {
		return location.adventuresTotal;
	}
	return AVESMAPS_PLACEHOLDER_ADVENTURES_TOTAL;
}
function getPlaceCityMaps(location) {
	if (location && Array.isArray(location.cityMaps)) {
		return location.cityMaps;
	}
	return AVESMAPS_PLACEHOLDER_CITYMAPS;
}

function placeExtrasEscape(value) {
	return typeof escapeHtml === "function" ? escapeHtml(String(value == null ? "" : value)) : String(value == null ? "" : value);
}

// ---- Stadtkarten: waagrechter Streifen mit Thumbnail-Karten (externe Links) ----
function buildPlaceCityMapsMarkup(location) {
	var maps = getPlaceCityMaps(location);
	if (!maps || !maps.length) {
		return "";
	}
	var cards = maps.map(function (m) {
		var hasUrl = m && m.url;
		var href = hasUrl ? m.url : "#";
		return '<a class="avesmaps-citymaps__card" href="' + placeExtrasEscape(href) + '"'
			+ (hasUrl ? ' target="_blank" rel="noopener"' : ' onclick="return false"') + '>'
			+ '<span class="avesmaps-citymaps__thumb">' + AVESMAPS_CITYMAP_THUMB_SVG + '</span>'
			+ '<span class="avesmaps-citymaps__label">' + placeExtrasEscape(m && m.label) + '</span>'
			+ '</a>';
	}).join("");
	return '<div class="avesmaps-citymaps">'
		+ '<div class="avesmaps-citymaps__head">Stadtkarten <span class="avesmaps-citymaps__note">· Platzhalter · externe Links</span></div>'
		+ '<div class="avesmaps-citymaps__scroll">' + cards + '</div>'
		+ '</div>';
}

// ---- Abenteuer in <Ort>: sortierbare Liste (neueste/Art/alphabetisch) + "mehr" ----
function buildPlaceAdventuresMarkup(location) {
	var list = getPlaceAdventures(location);
	if (!list || !list.length) {
		return "";
	}
	var total = getPlaceAdventuresTotal(location);
	var placeName = (location && location.name) ? location.name : "diesem Ort";
	var rows = list.map(function (a) {
		var metaParts = [];
		if (a.type) { metaParts.push(a.type); }
		if (a.edition) { metaParts.push(a.edition); }
		if (a.yearLabel) { metaParts.push(a.yearLabel); }
		var url = a.url || ("https://de.wiki-aventurica.de/wiki/" + encodeURIComponent(a.title || ""));
		return '<div class="avesmaps-adv__row" data-year="' + (Number(a.year) || 0) + '" data-type="' + placeExtrasEscape(a.type) + '" data-title="' + placeExtrasEscape(a.title) + '">'
			+ '<a class="avesmaps-adv__title" href="' + placeExtrasEscape(url) + '" target="_blank" rel="noopener">' + placeExtrasEscape(a.title) + '</a>'
			+ '<div class="avesmaps-adv__meta">' + placeExtrasEscape(metaParts.join(" · ")) + '</div>'
			+ '</div>';
	}).join("");
	var moreCount = Math.max(0, list.length - 3);
	var moreBtn = list.length > 3
		? '<button type="button" class="avesmaps-adv__more"><span class="avesmaps-adv__more-icon">▾</span><span class="avesmaps-adv__more-label">mehr (' + moreCount + ')</span></button>'
		: "";
	return '<div class="avesmaps-adv">'
		+ '<div class="avesmaps-adv__head">Abenteuer in ' + placeExtrasEscape(placeName) + ' <span class="avesmaps-adv__count">(' + placeExtrasEscape(total) + ')</span></div>'
		+ '<div class="avesmaps-adv__sorts">'
		+ '<span class="avesmaps-adv__sort is-active" data-adv-sort="year">neueste zuerst</span>'
		+ '<span class="avesmaps-adv__sortsep"> · </span>'
		+ '<span class="avesmaps-adv__sort" data-adv-sort="type">nach Art</span>'
		+ '<span class="avesmaps-adv__sortsep"> · </span>'
		+ '<span class="avesmaps-adv__sort" data-adv-sort="alpha">alphabetisch</span>'
		+ '</div>'
		+ '<div class="avesmaps-adv__placeholder">Platzhalter · echte Daten folgen</div>'
		+ '<div class="avesmaps-adv__list">' + rows + '</div>'
		+ moreBtn
		+ '</div>';
}

// ---- Interaktivitaet via Document-Delegation (funktioniert in Popup UND Panel) ----
(function initPlaceExtrasDelegation() {
	if (typeof window.__avesmapsPlaceExtrasBound !== "undefined") {
		return;
	}
	window.__avesmapsPlaceExtrasBound = true;
	if (typeof $ === "undefined") {
		return;
	}
	$(document).on("click", ".avesmaps-adv__sort", function () {
		var section = $(this).closest(".avesmaps-adv")[0];
		if (!section) {
			return;
		}
		var mode = this.getAttribute("data-adv-sort");
		var listEl = section.querySelector(".avesmaps-adv__list");
		if (!listEl) {
			return;
		}
		var rows = Array.prototype.slice.call(listEl.querySelectorAll(".avesmaps-adv__row"));
		rows.sort(function (a, b) {
			if (mode === "alpha") {
				return String(a.dataset.title).localeCompare(String(b.dataset.title), "de");
			}
			if (mode === "type") {
				return String(a.dataset.type).localeCompare(String(b.dataset.type), "de") || ((Number(b.dataset.year) || 0) - (Number(a.dataset.year) || 0));
			}
			return (Number(b.dataset.year) || 0) - (Number(a.dataset.year) || 0);
		});
		rows.forEach(function (r) { listEl.appendChild(r); });
		var sorts = section.querySelectorAll(".avesmaps-adv__sort");
		for (var i = 0; i < sorts.length; i += 1) {
			sorts[i].classList.toggle("is-active", sorts[i] === this);
		}
	});
	$(document).on("click", ".avesmaps-adv__more", function () {
		var section = $(this).closest(".avesmaps-adv")[0];
		if (!section) {
			return;
		}
		var expanded = section.classList.toggle("is-expanded");
		var total = section.querySelectorAll(".avesmaps-adv__row").length;
		var label = this.querySelector(".avesmaps-adv__more-label");
		var icon = this.querySelector(".avesmaps-adv__more-icon");
		if (label) { label.textContent = expanded ? "weniger" : ("mehr (" + Math.max(0, total - 3) + ")"); }
		if (icon) { icon.textContent = expanded ? "▴" : "▾"; }
	});
})();
