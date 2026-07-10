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
// cover: TEMPORAER hotgelinkte Wiki-Aventurica-Thumbnails (Owner-Freigabe fuer die Demo) -- spaeter
// ersetzt durch echte Payload-Daten (location.adventures[].cover), idealerweise ueber den coat.php-artigen
// Cache-Proxy statt Hotlink.
var AVESMAPS_PLACEHOLDER_ADVENTURES = [
	{ title: "Jagd nach dem Primoptolithen", type: "Soloabenteuer", edition: "", year: 1046, yearLabel: "1046 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/c/c5/Jagd_nach_dem_Primoptolithen.jpg/240px-Jagd_nach_dem_Primoptolithen.jpg" },
	{ title: "Siegelbruch", type: "Gruppenabenteuer", edition: "DSA5", year: 1044, yearLabel: "1044 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/5/55/AB_VA62.jpg/240px-AB_VA62.jpg" },
	{ title: "Aus den Augen, aber nicht aus dem Sinn", type: "Gruppenabenteuer", edition: "DSA5", year: 1041, yearLabel: "1041 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/a/a0/40_Jahre_und_ein_Schelm.jpg/240px-40_Jahre_und_ein_Schelm.jpg" },
	{ title: "Feuchte Albträume", type: "Szenario", edition: "DSA5", year: 1040, yearLabel: "1040 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/6/63/Kurtisanen_%26_Bordelle.jpg/240px-Kurtisanen_%26_Bordelle.jpg" },
	{ title: "Der Schattenmarschall", type: "Gruppenabenteuer", edition: "DSA4.1", year: 1040, yearLabel: "Sommer 1040 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/0/04/AB_A212.jpg/240px-AB_A212.jpg" },
	{ title: "Seelanders Eleven", type: "Kurzabenteuer", edition: "DSA5", year: 1040, yearLabel: "etwa 1040 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/1/14/AB_KRK1.jpg/240px-AB_KRK1.jpg" },
	{ title: "Niobaras Vermächtnis", type: "Gruppenabenteuer", edition: "DSA5", year: 1038, yearLabel: "bis RAH 1038 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/3/3a/AB_VA14.jpg/240px-AB_VA14.jpg" },
	{ title: "Steinerne Schwingen", type: "Gruppenabenteuer", edition: "DSA4.1", year: 1038, yearLabel: "1038 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/e/ea/AB_A201.jpg/240px-AB_A201.jpg" },
	{ title: "Herren der Unterwelt", type: "Gruppenabenteuer", edition: "DSA4.1", year: 1037, yearLabel: "Anfang 1037 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/4/47/Box-AB_Gh.png/240px-Box-AB_Gh.png" },
	{ title: "Sturm der Gewalt", type: "Gruppenabenteuer", edition: "DSA4.1", year: 1037, yearLabel: "Hochsommer ab 1037 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/4/47/Box-AB_Gh.png/240px-Box-AB_Gh.png" },
];
var AVESMAPS_PLACEHOLDER_ADVENTURES_TOTAL = 57;
var AVESMAPS_PLACEHOLDER_CITYMAPS = [
	{ label: "Gesamtplan", url: "" },
	{ label: "Kaiserviertel", url: "" },
	{ label: "Südquartier", url: "" },
	{ label: "Tempelviertel", url: "" },
];

var AVESMAPS_CITYMAP_THUMB_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>';
// Platzhalter-Icon fuer das Abenteuer-Cover (A4), solange kein echtes Cover-Bild (a.cover) vorliegt.
var AVESMAPS_ADV_COVER_PH_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 16 5-4 4 3 3-2 4 3"/></svg>';

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
	// Karten: Cover (A4) oben, Titel + Jahr zentriert darunter. Angeordnet als 2-reihiges, horizontal
	// scrollbares Grid (wie die Stadtkarten) -- Reihenfolge via Sortier-Links (Re-Append im Grid).
	var cards = list.map(function (a) {
		var url = a.url || ("https://de.wiki-aventurica.de/wiki/" + encodeURIComponent(a.title || ""));
		var coverInner = a.cover
			? '<img class="avesmaps-adv__cover-img" src="' + placeExtrasEscape(a.cover) + '" alt="" loading="lazy">'
			: AVESMAPS_ADV_COVER_PH_SVG;
		var metaLine = a.yearLabel ? '<div class="avesmaps-adv__meta">' + placeExtrasEscape(a.yearLabel) + '</div>' : "";
		var typeLine = a.type ? '<div class="avesmaps-adv__type">' + placeExtrasEscape(a.type) + '</div>' : "";
		return '<div class="avesmaps-adv__card" data-year="' + (Number(a.year) || 0) + '" data-type="' + placeExtrasEscape(a.type) + '" data-title="' + placeExtrasEscape(a.title) + '">'
			+ '<a class="avesmaps-adv__cover' + (a.cover ? " has-img" : "") + '" href="' + placeExtrasEscape(url) + '" target="_blank" rel="noopener" title="' + placeExtrasEscape(a.title) + '">' + coverInner + '</a>'
			+ '<a class="avesmaps-adv__title" href="' + placeExtrasEscape(url) + '" target="_blank" rel="noopener">' + placeExtrasEscape(a.title) + '</a>'
			+ metaLine
			+ typeLine
			+ '</div>';
	}).join("");
	return '<div class="avesmaps-adv">'
		+ '<div class="avesmaps-adv__head">Abenteuer in ' + placeExtrasEscape(placeName) + ' <span class="avesmaps-adv__count">(' + placeExtrasEscape(total) + ')</span></div>'
		+ '<div class="avesmaps-adv__sorts">'
		+ '<span class="avesmaps-adv__sort is-active" data-adv-sort="year">neueste zuerst</span>'
		+ '<span class="avesmaps-adv__sortsep"> · </span>'
		+ '<span class="avesmaps-adv__sort" data-adv-sort="type">nach Art</span>'
		+ '<span class="avesmaps-adv__sortsep"> · </span>'
		+ '<span class="avesmaps-adv__sort" data-adv-sort="alpha">alphabetisch</span>'
		+ '</div>'
		+ '<div class="avesmaps-adv__placeholder">Platzhalter · Cover temporär aus dem Wiki</div>'
		+ '<div class="avesmaps-adv__list">' + cards + '</div>'
		+ '<button type="button" class="avesmaps-adv__all">Alle anzeigen (' + placeExtrasEscape(total) + ')</button>'
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

	// Dialog "Alle Abenteuer": modaler Overlay, einmal lazy gebaut und wiederverwendet.
	function ensureAdventuresDialog() {
		var overlay = document.getElementById("avesmaps-adv-dialog");
		if (overlay) {
			return overlay;
		}
		overlay = document.createElement("div");
		overlay.id = "avesmaps-adv-dialog";
		overlay.className = "avesmaps-adv-dialog";
		overlay.innerHTML = '<div class="avesmaps-adv-dialog__box" role="dialog" aria-modal="true">'
			+ '<div class="avesmaps-adv-dialog__head"><span class="avesmaps-adv-dialog__title"></span>'
			+ '<button type="button" class="avesmaps-adv-dialog__close" aria-label="Schließen">✕</button></div>'
			+ '<div class="avesmaps-adv-dialog__grid"></div></div>';
		document.body.appendChild(overlay);
		var close = function () { overlay.classList.remove("is-open"); };
		overlay.addEventListener("click", function (e) { if (e.target === overlay) { close(); } });
		overlay.querySelector(".avesmaps-adv-dialog__close").addEventListener("click", close);
		document.addEventListener("keydown", function (e) { if (e.key === "Escape") { close(); } });
		return overlay;
	}
	// "Alle anzeigen" -> Dialog mit ALLEN Abenteuer-Karten (aus dem Streifen des Abschnitts geklont, damit
	// Cover/Titel/Jahr/Typ 1:1 uebernommen werden). Funktioniert in Popup UND Panel (Document-Delegation).
	$(document).on("click", ".avesmaps-adv__all", function () {
		var section = $(this).closest(".avesmaps-adv")[0];
		if (!section) {
			return;
		}
		var overlay = ensureAdventuresDialog();
		var head = section.querySelector(".avesmaps-adv__head");
		overlay.querySelector(".avesmaps-adv-dialog__title").textContent = head ? head.textContent.trim() : "Abenteuer";
		var grid = overlay.querySelector(".avesmaps-adv-dialog__grid");
		grid.innerHTML = "";
		var cards = section.querySelectorAll(".avesmaps-adv__card");
		Array.prototype.forEach.call(cards, function (card) { grid.appendChild(card.cloneNode(true)); });
		overlay.classList.add("is-open");
	});

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
		var cards = Array.prototype.slice.call(listEl.querySelectorAll(".avesmaps-adv__card"));
		cards.sort(function (a, b) {
			if (mode === "alpha") {
				return String(a.dataset.title).localeCompare(String(b.dataset.title), "de");
			}
			if (mode === "type") {
				return String(a.dataset.type).localeCompare(String(b.dataset.type), "de") || ((Number(b.dataset.year) || 0) - (Number(a.dataset.year) || 0));
			}
			return (Number(b.dataset.year) || 0) - (Number(a.dataset.year) || 0);
		});
		cards.forEach(function (c) { listEl.appendChild(c); });
		listEl.scrollLeft = 0;
		var sorts = section.querySelectorAll(".avesmaps-adv__sort");
		for (var i = 0; i < sorts.length; i += 1) {
			sorts[i].classList.toggle("is-active", sorts[i] === this);
		}
	});
})();
