// WikiSync „Siedlungen": (1) Status-Tabs (Offen/Zurückgestellt/Archiviert) blenden die schon
// vorhandenen Fall-Sektionen per data-active-status ein/aus (CSS). (2) Vollständige Siedlungsliste
// vom Server (list_locations) — Name, Größe, ✓verbunden/–, Suche + „nur unverbundene". Klick →
// zur Karte fliegen + „Ort bearbeiten" öffnen. (3) Bulk-Verbinden aller eindeutigen Treffer.

const SETTLEMENT_LIST_API_URL = "/api/edit/wiki/settlements.php";
let settlementListView = "all"; // "all" | "onmap" | "wiki"
const settlementTypeFilter = new Set(); // ausgewählte Ortsgrößen (leer = alle)
const settlementContinentFilter = new Set(["Aventurien"]); // Default: nur Aventurien (Karte ist Aventurien)
const settlementSourceFilter = { value: "" }; // Quelle: "" = alle | "wiki" | "andere" | "keine"
const settlementCoatFilter = { value: "" };   // Wappen: "" = alle | "ja" | "nein"
const settlementImageFilter = { value: "" };  // Bilder: "" = alle | "ja" | "nein"

// ===== Facetten-Werte AUS DEN ZEILEN =====================================================
// Die Registry (js/review/review-subjects.js) sagt, WELCHES Feld eine Facette liest; welche
// Werte es gibt, sagen ausschliesslich die geladenen Zeilen -- mit Zaehler, wie pathTypeOptions()
// es seit jeher tut. Owner 2026-07-22.
//
// Warum das keine Formsache ist: der Abenteuereditor fuehrt den Fehler gerade vor. Seine feste
// Liste EDITIONS (html/adventure-editor.html:573) endet bei DSA5 und kennt DSA4.1 nicht -- im
// Bestand stehen aber Abenteuer mit genau dieser Angabe. Eine solche Liste bietet an, was es nicht
// gibt, und verschluckt, was es gibt.
//
// Anzeigenamen sind ein GETRENNTES Nachschlagen mit Rueckfall auf den Rohwert. Es entscheidet nie,
// welche Optionen erscheinen -- nur, wie sie heissen. Ein Wert, den diese Tabelle nicht kennt,
// steht als er selbst in der Liste, statt zu fehlen.
const WIKI_SYNC_FACET_VALUE_LABELS = {
	product_type: {
		gruppenabenteuer: "Gruppenabenteuer", soloabenteuer: "Soloabenteuer", kurzabenteuer: "Kurzabenteuer",
		szenario: "Szenario", anthologie: "Anthologie", kampagne: "Kampagne", kampagnenband: "Kampagnenband",
		metaband: "Metaband",
	},
	thumb_origin: { manual: "selbst hochgeladen", auto: "automatisch geholt" },
};

// Ein Wert, den es gibt -- naemlich „hier steht nichts". Als sichtbare Option und nicht als
// stilles Wegfallen: „Abenteuer ohne DSA-Version" ist eine Frage, die ein Redakteur wirklich hat.
const WIKI_SYNC_FACET_EMPTY = "(ohne Angabe)";

function wikiSyncFacetValueLabel(field, value) {
	const table = WIKI_SYNC_FACET_VALUE_LABELS[field];
	return (table && table[value]) || value;
}

// „ist das Feld gefuellt?" fuer kind:"flag" -- 0, "", null und undefined heissen alle nein.
function wikiSyncFacetIsFilled(value) {
	if (Array.isArray(value)) {
		return value.length > 0;
	}
	if (typeof value === "number") {
		return value > 0;
	}
	return value !== null && value !== undefined && String(value).trim() !== "";
}

// Der Wert EINER Zeile fuer EINE Facette. Optionsbau und Trefferpruefung rufen beide hierher --
// sonst koennten die angebotene Option und der Filter, der sie anwendet, auseinanderlaufen, und
// eine Option zeigte einen Zaehler an, den ihr eigener Filter dann nicht erreicht.
function wikiSyncFacetRowValue(row, facet) {
	if (facet.kind === "source") {
		// Die Quelle liest MEHRERE Felder und hat deshalb keins. Ohne diesen Zweig fiele sie in
		// den generischen unten, laese row[""] und antwortete fuer jede Zeile „(ohne Angabe)" --
		// eine Facette, die still das Falsche tut, statt zu fehlen. Heute nimmt die Siedlungsliste
		// noch ihren eigenen Weg dorthin; das hier ist der Vertrag fuer den naechsten Aufrufer.
		return getItemSourceCategory(row);
	}
	const raw = row ? row[facet.field] : null;
	if (facet.kind === "flag") {
		return wikiSyncFacetIsFilled(raw) ? "ja" : "nein";
	}
	if (facet.kind === "tri") {
		// null ist ein EIGENER Wert. Die dreiwertigen Karten-Spalten meinen mit NULL „weiss
		// niemand", und das zu „nein" zu falten wuerde behaupten, jemand haette es geprueft.
		return raw === true ? "ja" : (raw === false ? "nein" : "unbekannt");
	}
	const value = String(raw === null || raw === undefined ? "" : raw).trim();
	return value === "" ? WIKI_SYNC_FACET_EMPTY : value;
}

// Eine Auswahl, die in den aktuellen Daten nicht mehr vorkommt, filtert die Liste auf leer UND
// verschwindet aus dem Menue -- der Trichter zaehlt sie dann, aber es gibt kein Kaestchen mehr,
// um sie wieder abzuwaehlen. Genau das passiert beim Reiterwechsel: auf „Fehlt" stammt jede Zeile
// aus dem Wiki, also faellt „Andere" aus den Quelle-Optionen heraus, waehrend die Auswahl stehen
// bleibt. Was es nicht mehr gibt, wird deshalb abgewaehlt, statt unsichtbar weiterzufiltern.
function wikiSyncPruneFacetState(state, options) {
	if (!state) {
		return;
	}
	const values = new Set(options.map((option) => option.value));
	if (state instanceof Set) {
		[...state].forEach((value) => {
			if (!values.has(value)) {
				state.delete(value);
			}
		});
		return;
	}
	if (state.value && !values.has(state.value)) {
		state.value = "";
	}
}

// [{value, label, count}] aus den Zeilen. Eine Option ohne Zeile entsteht gar nicht erst -- der
// Filter kann also nie ins Leere fuehren, und ein leeres Ergebnis heisst wirklich „nichts da".
// `state` ist freiwillig; wird es uebergeben, raeumt der Optionsbau gestrandete Auswahlen weg.
function wikiSyncFacetOptions(rows, facet, state) {
	const byValue = new Map();
	(rows || []).forEach((row) => {
		const value = wikiSyncFacetRowValue(row, facet);
		if (!byValue.has(value)) {
			byValue.set(value, { value, label: wikiSyncFacetValueLabel(facet.field, value), count: 0 });
		}
		byValue.get(value).count += 1;
	});
	const options = [...byValue.values()];
	wikiSyncPruneFacetState(state, options);
	if (facet.kind === "flag" || facet.kind === "tri") {
		const order = ["ja", "nein", "unbekannt"];
		return options.sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value));
	}
	// „(ohne Angabe)" ans Ende, sonst alphabetisch -- es ist eine Restkategorie und soll nicht
	// zwischen den echten Werten einsortiert stehen.
	return options.sort((a, b) => {
		if (a.value === WIKI_SYNC_FACET_EMPTY) return 1;
		if (b.value === WIKI_SYNC_FACET_EMPTY) return -1;
		return a.label.localeCompare(b.label, "de");
	});
}

// Baut die Abschnitte eines Trichter-Menues AUS DER REGISTRY -- Titel und Reihenfolge stehen dort,
// nicht im Markup. index.html traegt fuer diese Menues nur die leere Huelle. (Die drei Siedlungs-
// Abschnitte stehen noch als festes Markup dort; sie sind aelter als die Registry.)
function wikiSyncBuildFacetMenu(menuId, facets, sectionMenuId) {
	const menu = document.getElementById(menuId);
	if (!menu) {
		return;
	}
	menu.innerHTML = facets.map((facet) =>
		'<div class="type-filter__section"><div class="type-filter__section-title">'
		+ escapeHtml(facet.label) + '</div><div id="' + escapeHtml(sectionMenuId(facet.key)) + '"></div></div>'
	).join("");
}

// Die rebuild-Rueckgaben aller Trichter dieses Panels. Ein Verwerfen aus dem Programm heraus
// aendert nur den Zustand -- die Zahl IM KNOPF („Filter (2) ▾") zeichnet attachFilterMenu sonst
// erst beim naechsten Klick neu, und bis dahin nennt der Knopf Filter, die es nicht mehr gibt.
const AVESMAPS_WIKISYNC_FILTER_REBUILDS = [];

// Trefferpruefung. Mehrfachauswahl: leer = alle. Einfachauswahl: "" = alle.
function wikiSyncFacetMatches(row, facet, state) {
	if (facet.kind === "multi") {
		return state.size === 0 || state.has(wikiSyncFacetRowValue(row, facet));
	}
	return !state.value || state.value === wikiSyncFacetRowValue(row, facet);
}

// Kontinent eines Eintrags; leer -> Aventurien (On-Map-Orte tragen 'Aventurien', Wiki-only ihren Wert).
function settlementItemContinent(item) {
	return String(item.continent || "").trim() || "Aventurien";
}
function settlementContinentMatch(item) {
	return settlementContinentFilter.size === 0 || settlementContinentFilter.has(settlementItemContinent(item));
}
// Kontinent-Filter-Optionen: distinct Kontinente (Aventurien zuerst), Zähler aus ALLEN Einträgen.
function settlementContinentOptions() {
	const byCont = new Map();
	for (const item of settlementListItems) {
		const c = settlementItemContinent(item);
		if (!byCont.has(c)) {
			byCont.set(c, { value: c, label: c, count: 0 });
		}
		byCont.get(c).count += 1;
	}
	return [...byCont.values()].sort((a, b) =>
		/aventurien/i.test(a.value) ? -1 : /aventurien/i.test(b.value) ? 1 : a.label.localeCompare(b.label));
}

function settlementListQuery() {
	return (document.getElementById("settlement-list-filter")?.value || "").trim().toLowerCase();
}

function settlementMatchesView(item, view) {
	if (view === "onmap") {
		return Boolean(item.on_map);
	}
	if (view === "wiki") {
		return !item.on_map;
	}
	return true;
}

// Basismenge für die Typ-Zähler: View-Tab + Suche, aber OHNE den Typ-Filter selbst.
function settlementBaseFilteredItems() {
	const query = settlementListQuery();
	let items = settlementListItems.filter(settlementContinentMatch);
	items = items.filter((item) => settlementMatchesView(item, settlementListView));
	if (query) {
		items = items.filter((item) => String(item.name).toLowerCase().includes(query));
	}
	return items;
}

// Basismenge für die REITER-Zähler: alle aktiven Filter (Kontinent, Suche, Typ, Quelle),
// aber OHNE den Reiter selbst — sonst zählte jeder Reiter nur seine eigene Auswahl.
// Gleiches Prinzip wie bei den Typ-Zählern: die eigene Dimension bleibt außen vor.
function settlementItemsIgnoringView() {
	const query = settlementListQuery();
	let items = settlementListItems.filter(settlementContinentMatch);
	if (query) {
		items = items.filter((item) => String(item.name).toLowerCase().includes(query));
	}
	if (settlementTypeFilter.size > 0) {
		items = items.filter((item) => settlementTypeFilter.has(item.settlement_label || "—"));
	}
	if (settlementSourceFilter.value) {
		items = items.filter((item) => getItemSourceCategory(item) === settlementSourceFilter.value);
	}
	items = items.filter((item) => wikiSyncFacetMatches(item, SETTLEMENT_COAT_FACET, settlementCoatFilter));
	items = items.filter((item) => wikiSyncFacetMatches(item, SETTLEMENT_IMAGE_FACET, settlementImageFilter));
	return items;
}

// Die beiden Facetten, die der Siedlungseditor schon hatte und die Panel-Liste bis jetzt nicht
// (html/wiki-sync-settlement-editor.html:2411). Sie kommen aus der Registry, damit Fenster und
// Liste nicht zwei Fassungen derselben Frage pflegen.
const SETTLEMENT_COAT_FACET = wikiSyncSubjectFacets("locations").find((facet) => facet.key === "coat");
const SETTLEMENT_IMAGE_FACET = wikiSyncSubjectFacets("locations").find((facet) => facet.key === "image");

// Ihre Optionen kommen bewusst aus der Basismenge OHNE die eigene Auswahl: sonst verschwindet
// „nein", sobald „ja" gewaehlt ist (eine Option entsteht ja nur fuer Werte, die vorkommen) -- und
// man kaeme aus dem Filter nicht mehr heraus, ohne ihn zu erraten.
function settlementCoatOptions() {
	return wikiSyncFacetOptions(settlementBaseFilteredItems(), SETTLEMENT_COAT_FACET, settlementCoatFilter);
}
function settlementImageOptions() {
	return wikiSyncFacetOptions(settlementBaseFilteredItems(), SETTLEMENT_IMAGE_FACET, settlementImageFilter);
}

// Optionen für den Typ-Filter: distinct Ortsgrößen (Zähler aus der aktuellen Basismenge).
function settlementTypeOptions() {
	const order = ["dorf", "kleinstadt", "stadt", "grossstadt", "metropole", "gebaeude"];
	const byLabel = new Map();
	for (const item of settlementBaseFilteredItems()) {
		const label = item.settlement_label || "—";
		if (!byLabel.has(label)) {
			byLabel.set(label, { value: label, label, count: 0, order: order.indexOf(item.settlement_class || "") });
		}
		byLabel.get(label).count += 1;
	}
	return [...byLabel.values()].sort((a, b) => (a.order < 0 ? 99 : a.order) - (b.order < 0 ? 99 : b.order) || a.label.localeCompare(b.label));
}
let settlementListItems = [];

// The textContent→innerHTML trick escapes & < > but NOT the double quote — and this helper is used
// inside double-quoted attributes (data-settlement-title, href, title). A wiki title containing a "
// therefore broke out of the attribute and could add its own (e.g. an event handler). Delegate to the
// canonical escapeHtml() from js/app/utils.js (loaded before this file), which also covers " and '.
function settlementListEscape(value) {
	return escapeHtml(value === null || value === undefined ? "" : value);
}

async function loadSettlementList() {
	const list = document.getElementById("settlement-list");
	if (!list) {
		return;
	}
	if (settlementListItems.length === 0) {
		list.innerHTML = '<p class="region-sync__empty">Lädt ...</p>';
	}
	try {
		const response = await fetch(`${SETTLEMENT_LIST_API_URL}?action=list_locations`, { credentials: "same-origin" });
		const data = await response.json();
		if (!data || data.ok !== true) {
			throw new Error(apiErrorMessage(data, "Liste konnte nicht geladen werden"));
		}
		settlementListItems = Array.isArray(data.items) ? data.items : [];
	} catch (error) {
		list.innerHTML = `<p class="region-sync__empty">Fehler: ${settlementListEscape(error.message || error)}</p>`;
		return;
	}
	renderSettlementList();
}

// (Settlement bulk operations moved to review-settlement-list-bulk-ops.js - M5 split.)
// Unsichtbarer Status-Marker wie im Herrschaftsgebiet-Tree; steuert per :has() die Kreis-Füllung:
// voll = auf Karte + verbunden (--all), halb = auf Karte ohne Wiki (--own-only),
// leer = fehlt auf der Karte (nur im Wiki).
function settlementStatusMarker(item) {
	let modifier = "";
	if (item.state === "full") {
		modifier = " tree-map-status--all";
	} else if (item.state === "empty") {
		modifier = " tree-map-status--own-only";
	}
	return `<span class="tree-map-status${modifier}" aria-hidden="true"></span>`;
}

// Struktur 1:1 wie die Territorien-Items (tree-item-Grid): (1) Drag-Handle in Spalte 1 (⠿ wenn
// ziehbar, sonst leer), (2) Name mit Kreis daneben, (3) Meta + Wiki-Link unter dem Namen.
function renderSettlementRow(item) {
	const draggable = !item.on_map;
	const handle = `<span class="drag-handle" aria-hidden="true">${draggable ? "⠿" : ""}</span>`;
	const dragAttrs = draggable
		? ` draggable="true" data-settlement-title="${settlementListEscape(item.name)}" data-settlement-class="${settlementListEscape(item.settlement_class)}"`
		: "";
	const classes = "tree-item settlement-list__item" + (draggable ? " is-draggable" : "");
	const title = draggable ? "Auf die Karte ziehen, um die Siedlung anzulegen" : "";

	const metaParts = [];
	if (item.settlement_label) {
		metaParts.push(settlementListEscape(item.settlement_label));
	}
	if (item.building_type) {
		metaParts.push(settlementListEscape(item.building_type));
	}
	if (item.region) {
		metaParts.push(settlementListEscape(item.region));
	}
	if (item.is_nodix) {
		metaParts.push("Nodix");
	}
	if (item.is_ruined) {
		metaParts.push("Ruine");
	}
	let metaHtml = metaParts.join(" · ");
	if (item.wiki_url) {
		const wikiLink = `<a class="settlement-list__wiki" href="${settlementListEscape(item.wiki_url)}" target="_blank" rel="noopener">Wiki ↗</a>`;
		metaHtml = metaHtml ? `${metaHtml} · ${wikiLink}` : wikiLink;
	}
	return (
		`<span class="${classes}"${dragAttrs} data-public-id="${settlementListEscape(item.public_id)}" data-on-map="${item.on_map ? "1" : "0"}" title="${settlementListEscape(title)}">` +
		handle +
		`<span class="tree-item-name">${settlementListEscape(item.name)}</span>` +
		(metaHtml ? `<span class="tree-item-meta">${metaHtml}</span>` : "") +
		settlementStatusMarker(item) +
		"</span>"
	);
}

function renderSettlementList() {
	const list = document.getElementById("settlement-list");
	if (!list) {
		return;
	}
	// Reiter-Zähler und Liste stammen aus DERSELBEN Menge: alle aktiven Filter (Kontinent, Suche,
	// Typ, Quelle) sind angewandt, nur der Reiter selbst nicht. So zeigt „Alle (N)" beim Suchen die
	// Treffer, nicht den Gesamtbestand — und Alle = Platziert + Fehlt geht immer auf.
	const counted = settlementItemsIgnoringView();
	const allCount = counted.length;
	const onMap = counted.filter((item) => item.on_map).length;
	const wikiOnly = allCount - onMap;

	const items = counted
		.filter((item) => settlementMatchesView(item, settlementListView))
		.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "de"));
	// Typ-Dropdown-Zähler an die aktuelle Basismenge (View+Suche) anpassen.
	renderTypeFilter("settlement-type-filter-toggle", "settlement-type-filter-menu", settlementTypeOptions(), settlementTypeFilter);
	renderTypeFilter("settlement-continent-filter-toggle", "settlement-continent-filter-menu", settlementContinentOptions(), settlementContinentFilter, "Kontinent");
	renderRadioFilter("settlement-source-filter-toggle", "settlement-source-filter-menu", SOURCE_FILTER_OPTIONS, settlementSourceFilter, "Quelle");
	renderRadioFilter("", "settlement-coat-filter-menu", settlementCoatOptions(), settlementCoatFilter, SETTLEMENT_COAT_FACET.label);
	renderRadioFilter("", "settlement-image-filter-menu", settlementImageOptions(), settlementImageFilter, SETTLEMENT_IMAGE_FACET.label);

	// Toggle-Buttons (gegenseitig exklusiv, einer aktiv) — in eigenem Container unter dem
	// Suchfeld, NICHT in der scrollbaren Liste.
	const tabsHost = wikiSyncViewTabsHostFor("locations");
	if (tabsHost) {
		const tab = (view, label, count) =>
			`<button type="button" data-settlement-view="${view}" class="region-sync__viewtab${settlementListView === view ? " is-active" : ""}">${label} (${count})</button>`;
		tabsHost.innerHTML = tab("all", "Alle", allCount) + tab("onmap", "Platziert", onMap) + tab("wiki", "Fehlt", wikiOnly);
	}

	if (items.length === 0) {
		settlementCancelLazyRender();
		list.innerHTML = '<p class="region-sync__empty">Keine Treffer.</p>';
		return;
	}
	settlementStartLazyRender(list, items);
}

// ===== Lazy-Rendering der (langen) Siedlungsliste via IntersectionObserver =====
const SETTLEMENT_RENDER_BATCH = 80;
let settlementLazyItems = [];
let settlementLazyRendered = 0;
let settlementLazyObserver = null;

function settlementCancelLazyRender() {
	if (settlementLazyObserver) {
		settlementLazyObserver.disconnect();
	}
}

function settlementEnsureObserver() {
	if (settlementLazyObserver) {
		return;
	}
	settlementLazyObserver = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					settlementLazyObserver.unobserve(entry.target);
					settlementRenderNextBatch();
				}
			}
		},
		{ rootMargin: "400px 0px" }
	);
}

function settlementStartLazyRender(list, items) {
	settlementCancelLazyRender();
	settlementLazyItems = items;
	settlementLazyRendered = 0;
	list.innerHTML = "";
	settlementRenderNextBatch(list);
}

function settlementRenderNextBatch(list) {
	list = list || document.getElementById("settlement-list");
	if (!list) {
		return;
	}
	const oldSentinel = document.getElementById("settlement-list-sentinel");
	if (oldSentinel) {
		oldSentinel.remove();
	}
	const next = settlementLazyItems.slice(settlementLazyRendered, settlementLazyRendered + SETTLEMENT_RENDER_BATCH);
	if (next.length) {
		list.insertAdjacentHTML("beforeend", next.map(renderSettlementRow).join(""));
		settlementLazyRendered += next.length;
	}
	if (settlementLazyRendered < settlementLazyItems.length) {
		list.insertAdjacentHTML("beforeend", '<div id="settlement-list-sentinel" aria-hidden="true" style="height:1px"></div>');
		settlementEnsureObserver();
		settlementLazyObserver.observe(document.getElementById("settlement-list-sentinel"));
	}
}

function settlementListOpen(publicId) {
	if (!publicId) {
		showFeedbackToast?.("Diese Siedlung ist im Wiki, aber (noch) nicht auf der Karte — über den Wiki-Link ↗ öffnen.", "info");
		return;
	}
	const entry = typeof findLocationMarkerByPublicId === "function" ? findLocationMarkerByPublicId(publicId) : null;
	if (!entry || !entry.marker) {
		showFeedbackToast?.("Ort ist auf der Karte (noch) nicht geladen.", "info");
		return;
	}
	if (typeof map !== "undefined" && map) {
		map.flyTo(entry.marker.getLatLng(), Math.max(map.getZoom(), 4), { duration: 0.5 });
	}
	// Infobox öffnen + Marker temporaer zeigen (auch wenn die Ortsgroesse nicht eingeblendet ist);
	// verschwindet wieder beim Schliessen der Infobox.
	if (typeof openLocationPopupForMarkerEntry === "function") {
		openLocationPopupForMarkerEntry(entry, { pan: false });
	} else {
		entry.marker.openPopup();
	}
}

// Status-Tabs: blenden die passende Fall-Sektion ein (CSS via data-active-status).
function setWikiSyncCaseStatus(status) {
	const valid = ["open", "deferred", "archived"].includes(status) ? status : "open";
	document.querySelectorAll("[data-wiki-sync-case-status]").forEach((button) => {
		button.classList.toggle("is-active", button.dataset.wikiSyncCaseStatus === valid);
	});
	const caseList = document.getElementById("wiki-sync-case-list");
	if (caseList) {
		caseList.dataset.activeStatus = valid;
	}
}

document.addEventListener("click", (event) => {
	if (!event.target.closest) {
		return;
	}
	const statusTab = event.target.closest("[data-wiki-sync-case-status]");
	if (statusTab) {
		setWikiSyncCaseStatus(statusTab.dataset.wikiSyncCaseStatus);
		return;
	}
	const viewTab = event.target.closest("[data-settlement-view]");
	if (viewTab) {
		settlementListView = viewTab.dataset.settlementView || "all";
		renderSettlementList();
		return;
	}
	if (event.target.closest(".settlement-list__wiki")) {
		return; // Wiki-Link selbst öffnen lassen
	}
	const item = event.target.closest(".settlement-list__item");
	if (item) {
		settlementListOpen(item.dataset.publicId);
	}
});

document.addEventListener("input", (event) => {
	if (event.target && event.target.id === "settlement-list-filter") {
		renderSettlementList();
	}
});

// ===== Drag & Drop: fehlende Wiki-Siedlung auf die Karte ziehen -> Editor an der Stelle =====
let settlementDragTitle = "";
let settlementDragClass = "";
let settlementMapDropReady = false;

// Drop a known wiki settlement onto the map: CREATE the point feature and ASSIGN the wiki
// link BEFORE opening "Siedlung bearbeiten", so the dialog opens already linked and shows
// the "Wiki-Siedlung" reference immediately -- no more blank-on-open + manual "Zuweisen"
// 2nd step, and no post-save auto-assign either (single write, not two). Reuses the exact
// same actions the manual flow uses (create_point via submitMapFeatureEdit, then assign_to
// via settlementWikiPost -- the same call selectSettlementWikiResult makes); no new
// assignment mechanism. On any failure (duplicate name, network, assign error) falls back
// to opening the dialog pre-filled but unlinked, same as before this change, so the drop
// still lets the user create the location manually.
async function createAndAssignDraggedSettlement(latlng, presetName, presetType) {
	const fallbackToPresetDialog = () => {
		if (typeof openLocationEditDialog === "function") {
			openLocationEditDialog({ latlng, presetName, presetLocationType: presetType || "dorf" });
		}
	};

	let feature;
	try {
		const createResult = await submitMapFeatureEdit({
			action: "create_point",
			name: presetName,
			feature_subtype: presetType || "dorf",
			description: "",
			wiki_url: "",
			is_nodix: false,
			is_ruined: false,
			lat: latlng.lat,
			lng: latlng.lng,
		});
		feature = createResult?.feature;
	} catch (error) {
		console.error("Siedlung konnte nicht angelegt werden:", error);
		showFeedbackToast?.("Siedlung konnte nicht angelegt werden: " + (error.message || error), "warning");
		fallbackToPresetDialog();
		return;
	}
	if (!feature || !feature.public_id) {
		fallbackToPresetDialog();
		return;
	}

	try {
		const assignResult = await settlementWikiPost({ action: "assign_to", title: presetName, public_id: feature.public_id, dry_run: false, confirm: "apply" });
		if (assignResult && assignResult.ok === true) {
			feature = { ...feature, wiki_settlement: assignResult.settlement || null, revision: assignResult.revision || feature.revision };
			if (assignResult.settlement) {
				feature.description = "";
			}
		} else {
			showFeedbackToast?.("Wiki-Siedlung „" + presetName + "\" konnte nicht automatisch zugewiesen werden: " + apiErrorMessage(assignResult, ""), "warning");
		}
	} catch (error) {
		console.error("Wiki-Siedlung konnte nicht automatisch zugewiesen werden:", error);
		showFeedbackToast?.("Wiki-Siedlung konnte nicht automatisch zugewiesen werden: " + (error.message || error), "warning");
	}

	addCreatedLocationMarker(feature, { openPopup: false });
	if (typeof refreshActiveWikiSyncPanelAfterAssignment === "function") {
		void refreshActiveWikiSyncPanelAfterAssignment();
	}
	const markerEntry = typeof findLocationMarkerByPublicId === "function" ? findLocationMarkerByPublicId(feature.public_id) : null;
	if (typeof openLocationEditDialog === "function") {
		openLocationEditDialog({ markerEntry, latlng });
	}
}

function ensureSettlementMapDropTarget() {
	if (settlementMapDropReady || typeof map === "undefined" || !map || typeof map.getContainer !== "function") {
		return;
	}
	const container = map.getContainer();
	container.addEventListener("dragover", (event) => {
		if (settlementDragTitle) {
			event.preventDefault();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = "copy";
			}
		}
	});
	container.addEventListener("drop", (event) => {
		if (!settlementDragTitle) {
			return;
		}
		event.preventDefault();
		const presetName = settlementDragTitle;
		const presetType = settlementDragClass;
		settlementDragTitle = "";
		settlementDragClass = "";
		const latlng = map.mouseEventToLatLng(event);
		void createAndAssignDraggedSettlement(latlng, presetName, presetType);
	});
	settlementMapDropReady = true;
}

document.addEventListener("dragstart", (event) => {
	const item = event.target.closest ? event.target.closest(".settlement-list__item.is-draggable") : null;
	if (!item || !item.dataset.settlementTitle) {
		return;
	}
	settlementDragTitle = item.dataset.settlementTitle;
	settlementDragClass = item.dataset.settlementClass || "";
	if (event.dataTransfer) {
		event.dataTransfer.setData("text/plain", "settlement:" + item.dataset.settlementTitle);
		event.dataTransfer.effectAllowed = "copy";
	}
	ensureSettlementMapDropTarget();
});

document.addEventListener("dragend", () => {
	settlementDragTitle = "";
	settlementDragClass = "";
});

AVESMAPS_WIKISYNC_FILTER_REBUILDS.push(attachFilterMenu("settlement-filter-toggle", "settlement-filter-menu", [
	{ menuId: "settlement-type-filter-menu", kind: "multi", state: settlementTypeFilter, getOptions: settlementTypeOptions, label: "Typ", isActive: () => settlementTypeFilter.size > 0 },
	{ menuId: "settlement-continent-filter-menu", kind: "multi", state: settlementContinentFilter, getOptions: settlementContinentOptions, label: "Kontinent", isActive: () => !(settlementContinentFilter.size === 1 && settlementContinentFilter.has("Aventurien")) },
	{ menuId: "settlement-source-filter-menu", kind: "single", state: settlementSourceFilter, options: SOURCE_FILTER_OPTIONS, label: "Quelle", isActive: () => Boolean(settlementSourceFilter.value) },
	{ menuId: "settlement-coat-filter-menu", kind: "single", state: settlementCoatFilter, getOptions: settlementCoatOptions, label: SETTLEMENT_COAT_FACET.label, isActive: () => Boolean(settlementCoatFilter.value) },
	{ menuId: "settlement-image-filter-menu", kind: "single", state: settlementImageFilter, getOptions: settlementImageOptions, label: SETTLEMENT_IMAGE_FACET.label, isActive: () => Boolean(settlementImageFilter.value) },
], renderSettlementList, "Filter"));

// Subjektwechsel verwirft die Auswahl (Owner 2026-07-22). Die Zustaende sind je Subjekt getrennt,
// koennten sich also gar nicht vermischen -- aber ein Filter, den man vor drei Subjekten gesetzt
// hat, laesst die Liste beim Zurueckkommen unvollstaendig aussehen, und das faellt erst auf,
// nachdem man den fehlenden Eintrag schon gesucht hat.
window.avesmapsResetWikiSyncListFilters = function avesmapsResetWikiSyncListFilters() {
	[settlementTypeFilter, settlementContinentFilter, avesmapsAdvTypeFilter, avesmapsAdvEditionFilter,
		avesmapsAdvRegionFilter, avesmapsCmThumbOriginFilter].forEach((state) => state.clear());
	// Kontinent kehrt auf seinen VORGABEWERT zurueck, nicht auf ein leeres Set: „alle Kontinente"
	// ist nicht der Ruhezustand dieser Liste, die Karte ist Aventurien (siehe Deklaration oben).
	settlementContinentFilter.add("Aventurien");
	[settlementSourceFilter, settlementCoatFilter, settlementImageFilter, avesmapsAdvCoverFilter,
		avesmapsAdvFshopFilter, avesmapsCmPaidFilter, avesmapsCmScaleFilter, avesmapsCmPreviewFilter]
		.forEach((state) => { state.value = ""; });
	AVESMAPS_WIKISYNC_FILTER_REBUILDS.forEach((rebuild) => {
		if (typeof rebuild === "function") {
			rebuild();
		}
	});
};

window.loadSettlementList = loadSettlementList;

// Inline-Dialog fuer den Siedlungseditor — im Stil des Herrschaftsgebiet-Sync-Editors
// (gleiche CSS-Klassen wie der politische Territoriumseditor-Overlay), siehe
// openAvesmapsSyncEditorOverlay() in review-wiki-sync.js. Kein Deep-Link-Parameter noetig
// und kein Tree-Refresh beim Schliessen (Siedlungseditor hat keinen Eltern-Baum).
window.openAvesmapsSettlementEditorOverlay = window.openAvesmapsSettlementEditorOverlay || function openAvesmapsSettlementEditorOverlay() {
	const overlayId = "avesmaps-settlement-editor-overlay";
	// Cache-Buster: das Tool-HTML laedt sonst gecacht (kein ?v=) -> immer frisch holen.
	const buildSettlementEditorSrc = () => "/html/wiki-sync-settlement-editor.html?v=" + Date.now();
	let overlay = document.getElementById(overlayId);
	if (overlay) {
		overlay.hidden = false;
		document.body.style.overflow = "hidden";
		return;
	}
	overlay = document.createElement("div");
	overlay.id = overlayId;
	// Umgestellt auf die gemeinsame Huelle (css/components/editor-shell.css, Spec §3).
	// Die Maße stehen jetzt dort und nicht mehr als Inline-Style hier -- die drei
	// uebrigen Editoren unten benutzen noch die alten political-territory-editor-*
	// Klassen und ihre Inline-Maße, bis sie einzeln nachziehen (Spec §14 Schritt 4).
	overlay.className = "avm-editor-overlay";
	const dialog = document.createElement("div");
	dialog.className = "avm-editor-dialog";
	const header = document.createElement("div");
	header.className = "avm-editor-dialog__header";
	const headingEl = document.createElement("h2");
	headingEl.textContent = "Siedlungen bearbeiten";
	const closeButton = document.createElement("button");
	closeButton.type = "button";
	closeButton.className = "avm-editor-dialog__close";
	closeButton.setAttribute("aria-label", "Schließen");
	closeButton.textContent = "✕";
	const closeOverlay = () => {
		overlay.hidden = true;
		document.body.style.overflow = "";
	};
	closeButton.addEventListener("click", closeOverlay);
	header.appendChild(headingEl);
	header.appendChild(closeButton);
	const frame = document.createElement("iframe");
	frame.className = "avm-editor-dialog__frame";
	frame.src = buildSettlementEditorSrc();
	frame.title = "Siedlungseditor";
	dialog.appendChild(header);
	dialog.appendChild(frame);
	overlay.appendChild(dialog);
	overlay.addEventListener("click", (event) => { if (event.target === overlay) closeOverlay(); });
	document.body.appendChild(overlay);
	document.body.style.overflow = "hidden";
};

// Abenteuer-Editor overlay (Phase 3 / P2) — same overlay chrome as the settlement editor, own iframe page.
// Self-contained html/adventure-editor.html loaded with ?v=Date.now() (no ASSET_VERSION). No deep-link
// param and no tree refresh on close (the adventure editor has no parent tree).
window.openAvesmapsAdventureEditorOverlay = window.openAvesmapsAdventureEditorOverlay || function openAvesmapsAdventureEditorOverlay(selectPublicId) {
	const overlayId = "avesmaps-adventure-editor-overlay";
	const buildSrc = () => "/html/adventure-editor.html?v=" + Date.now();
	// Optional pre-selection: tell the (same-origin) editor iframe to jump to an adventure by public_id.
	const postSelect = (frame) => {
		const id = (selectPublicId == null ? "" : String(selectPublicId)).trim();
		if (!id || !frame || !frame.contentWindow) { return; }
		try { frame.contentWindow.postMessage({ avesmapsAdvSelect: id }, location.origin); } catch (e) { /* noop */ }
	};
	let overlay = document.getElementById(overlayId);
	if (overlay) {
		overlay.hidden = false;
		document.body.style.overflow = "hidden";
		postSelect(overlay.querySelector("iframe"));
		return;
	}
	overlay = document.createElement("div");
	overlay.id = overlayId;
	overlay.className = "political-territory-editor-overlay";
	const dialog = document.createElement("div");
	dialog.className = "political-territory-editor-dialog";
	dialog.style.width = "min(1400px, calc(100vw - 24px))";
	dialog.style.height = "min(880px, calc(100vh - 24px))";
	const header = document.createElement("div");
	header.className = "political-territory-editor-dialog__header";
	const headingEl = document.createElement("h2");
	headingEl.textContent = "Abenteuer bearbeiten";
	const closeButton = document.createElement("button");
	closeButton.type = "button";
	closeButton.className = "political-territory-editor-dialog__close";
	closeButton.setAttribute("aria-label", "Schließen");
	closeButton.textContent = "✕";
	const closeOverlay = () => {
		overlay.hidden = true;
		document.body.style.overflow = "";
		// Beim SCHLIESSEN nachladen, nicht beim Speichern (Owner 2026-07-17): waehrend das Overlay offen ist,
		// verdeckt es die Karte -- ein Refresh dahinter saehe niemand. Ohne das blieb der Katalog der von der
		// Seitenladung, und man sah seine eigene Aenderung erst nach F5. Bedingungslos, weil der Editor uns
		// nicht sagt, ob er gespeichert hat; der Katalog ist ~1 KB, ein Abruf je Schliessen faellt nicht auf.
		if (typeof window.avesmapsReloadAdventureCatalog === "function") {
			void window.avesmapsReloadAdventureCatalog();
		}
	};
	closeButton.addEventListener("click", closeOverlay);
	// Exposed so the editor iframe can close itself after a save (owner 2026-07-17: "beim speichern
	// zugehen"). Re-assigned on every open, which is correct: closeOverlay closes over THIS overlay.
	window.closeAvesmapsAdventureEditorOverlay = closeOverlay;
	header.appendChild(headingEl);
	header.appendChild(closeButton);
	const frame = document.createElement("iframe");
	frame.className = "political-territory-editor-dialog__frame";
	frame.addEventListener("load", () => postSelect(frame));
	frame.src = buildSrc();
	frame.title = "Abenteuereditor";
	dialog.appendChild(header);
	dialog.appendChild(frame);
	overlay.appendChild(dialog);
	overlay.addEventListener("click", (event) => { if (event.target === overlay) closeOverlay(); });
	document.body.appendChild(overlay);
	document.body.style.overflow = "hidden";
};

// Kartensammlung-Editor overlay (Spec §3.6) — same overlay chrome + iframe pattern as the adventure
// editor above. Self-contained html/citymap-editor.html loaded with ?v=Date.now() (no ASSET_VERSION bump
// needed, §7). No deep-link param and no tree refresh on close.
//
// The overlay is HIDDEN, not destroyed, on close (like its two siblings) — so a re-open reuses a live
// iframe whose list is as old as the first open. The adventure editor lives with that; this one posts a
// refresh on every open instead, because a map you just created in another tab silently missing from the
// list is the kind of thing you debug for ten minutes before realising.
window.openAvesmapsCitymapEditorOverlay = window.openAvesmapsCitymapEditorOverlay || function openAvesmapsCitymapEditorOverlay(selectPublicId) {
	const overlayId = "avesmaps-citymap-editor-overlay";
	const buildSrc = () => "/html/citymap-editor.html?v=" + Date.now();
	const postRefresh = (frame) => {
		if (!frame || !frame.contentWindow) { return; }
		const id = (selectPublicId == null ? "" : String(selectPublicId)).trim();
		try { frame.contentWindow.postMessage({ avesmapsCitymapRefresh: true, selectPublicId: id }, location.origin); } catch (e) { /* noop */ }
	};
	let overlay = document.getElementById(overlayId);
	if (overlay) {
		overlay.hidden = false;
		document.body.style.overflow = "hidden";
		postRefresh(overlay.querySelector("iframe"));
		return;
	}
	overlay = document.createElement("div");
	overlay.id = overlayId;
	overlay.className = "political-territory-editor-overlay";
	const dialog = document.createElement("div");
	dialog.className = "political-territory-editor-dialog";
	dialog.style.width = "min(1400px, calc(100vw - 24px))";
	dialog.style.height = "min(880px, calc(100vh - 24px))";
	const header = document.createElement("div");
	header.className = "political-territory-editor-dialog__header";
	const headingEl = document.createElement("h2");
	headingEl.textContent = "Karten bearbeiten";
	const closeButton = document.createElement("button");
	closeButton.type = "button";
	closeButton.className = "political-territory-editor-dialog__close";
	closeButton.setAttribute("aria-label", "Schließen");
	closeButton.textContent = "✕";
	const closeOverlay = () => {
		overlay.hidden = true;
		document.body.style.overflow = "";
		// Nachladen beim Schliessen -- Begruendung beim Abenteuer-Editor oben.
		if (typeof window.avesmapsReloadCitymapCatalog === "function") {
			void window.avesmapsReloadCitymapCatalog();
		}
	};
	closeButton.addEventListener("click", closeOverlay);
	// Exposed so the editor iframe can close itself after a save (owner 2026-07-17: "beim speichern
	// zugehen"). Re-assigned on every open, which is correct: closeOverlay closes over THIS overlay.
	window.closeAvesmapsCitymapEditorOverlay = closeOverlay;
	header.appendChild(headingEl);
	header.appendChild(closeButton);
	const frame = document.createElement("iframe");
	frame.className = "political-territory-editor-dialog__frame";
	frame.addEventListener("load", () => postRefresh(frame));
	frame.src = buildSrc();
	frame.title = "Kartensammlungs-Editor";
	dialog.appendChild(header);
	dialog.appendChild(frame);
	overlay.appendChild(dialog);
	overlay.addEventListener("click", (event) => { if (event.target === overlay) closeOverlay(); });
	document.body.appendChild(overlay);
	document.body.style.overflow = "hidden";
};

// ---- Abenteuer-Liste im WikiSync-"Abenteuer"-Tab (ersetzt den alten Beschreibungstext) ------------------
// Same catalog the editor uses (POST /api/edit/map/adventures.php {action:list} -> approved + drafts). Lazily
// loaded when the tab opens (setWikiSyncPanelTab). Double-click a row -> open the editor pre-selected there.
var avesmapsAdvPickerCache = null; // [{ public_id, title, edition, product_type, status, ... }]
var avesmapsAdvPickerWired = false;

// avesmapsSetMaterialCount stood here. It wrote a total onto the material sub-tab pills
// ("Abenteuer (349)"); those pills went away with the data-material-subtab level on 2026-07-22,
// after which it only fed the subject rail's count -- and that went too. Both callers keep their
// own "X / Y" line right below, which is the number an editor actually reads.

// --- Filter der Abenteuerliste ------------------------------------------------------------
// Der Facettensatz ist DER DES EDITORS (html/adventure-editor.html:432), soweit er in den
// Trichter passt. „Jahr von/bis" und „Ort" bleiben dort: das eine ist ein Zahlenbereich, das
// andere eine Autovervollstaendigung, und attachFilterMenu kennt nur Ankreuz- und Radioabschnitte.
// Eine dritte Art dafuer waere groesser als diese Aufgabe -- und die Panel-Liste ist die Flaeche,
// von der man in den Editor abspringt, nicht die, auf der man recherchiert.
var AVESMAPS_ADV_FACETS = wikiSyncSubjectFacets("adventures");
function avesmapsAdvFacet(key) {
	return AVESMAPS_ADV_FACETS.find(function (facet) { return facet.key === key; });
}
var avesmapsAdvTypeFilter = new Set();
var avesmapsAdvEditionFilter = new Set();
var avesmapsAdvRegionFilter = new Set();
var avesmapsAdvCoverFilter = { value: "" };
var avesmapsAdvFshopFilter = { value: "" };

// Die Regionen EINER Zeile: die Rohnamen ihrer Orte vom Typ region/territory, wie sie auch der
// Editor zieht (populateRegionFilter, html/adventure-editor.html:681). Eine Zeile kann mehrere
// haben, deshalb eine eigene Lesart -- wikiSyncFacetRowValue liefert genau einen Wert je Zeile.
function avesmapsAdvRegionNames(adventure) {
	return ((adventure && adventure.places) || [])
		.filter(function (place) { return (place.kind === "region" || place.kind === "territory") && place.name; })
		.map(function (place) { return place.name; });
}

// Alle Filter ausser dem genannten. Fuer die Liste selbst mit null aufgerufen, fuer die Optionen
// EINER Facette mit deren Schluessel: sonst zaehlte jede Option nur ihre eigene Auswahl, und die
// nicht gewaehlten Werte verschwaenden aus dem Menue, sobald man einmal etwas angeklickt hat.
function avesmapsAdvFilteredRows(skipKey) {
	var searchEl = document.getElementById("wiki-sync-adv-search");
	var q = (searchEl && searchEl.value ? searchEl.value : "").trim().toLowerCase();
	return (avesmapsAdvPickerCache || []).filter(function (a) {
		if (q && (a.title || "").toLowerCase().indexOf(q) < 0) { return false; }
		if (skipKey !== "type" && !wikiSyncFacetMatches(a, avesmapsAdvFacet("type"), avesmapsAdvTypeFilter)) { return false; }
		if (skipKey !== "edition" && !wikiSyncFacetMatches(a, avesmapsAdvFacet("edition"), avesmapsAdvEditionFilter)) { return false; }
		if (skipKey !== "cover" && !wikiSyncFacetMatches(a, avesmapsAdvFacet("cover"), avesmapsAdvCoverFilter)) { return false; }
		if (skipKey !== "fshop" && !wikiSyncFacetMatches(a, avesmapsAdvFacet("fshop"), avesmapsAdvFshopFilter)) { return false; }
		if (skipKey !== "region" && avesmapsAdvRegionFilter.size > 0) {
			var names = avesmapsAdvRegionNames(a);
			if (!names.some(function (name) { return avesmapsAdvRegionFilter.has(name); })) { return false; }
		}
		return true;
	});
}

// Zustand je Facettenschluessel -- der Optionsbau braucht ihn, um gestrandete Auswahlen wegzuraeumen.
var AVESMAPS_ADV_FILTER_STATES = {
	type: avesmapsAdvTypeFilter, edition: avesmapsAdvEditionFilter, region: avesmapsAdvRegionFilter,
	cover: avesmapsAdvCoverFilter, fshop: avesmapsAdvFshopFilter,
};

function avesmapsAdvRegionOptions() {
	var byName = new Map();
	avesmapsAdvFilteredRows("region").forEach(function (a) {
		// Ein Abenteuer, das dieselbe Region zweimal auffuehrt, zaehlt einmal -- der Zaehler
		// beantwortet „wie viele Abenteuer", nicht „wie viele Ortszeilen".
		new Set(avesmapsAdvRegionNames(a)).forEach(function (name) {
			if (!byName.has(name)) { byName.set(name, { value: name, label: name, count: 0 }); }
			byName.get(name).count += 1;
		});
	});
	var options = [...byName.values()].sort(function (a, b) { return a.label.localeCompare(b.label, "de"); });
	wikiSyncPruneFacetState(avesmapsAdvRegionFilter, options);
	return options;
}

function avesmapsAdvFacetOptions(key) {
	return wikiSyncFacetOptions(avesmapsAdvFilteredRows(key), avesmapsAdvFacet(key), AVESMAPS_ADV_FILTER_STATES[key]);
}

function avesmapsRenderAdventurePicker() {
	var scroll = document.getElementById("wiki-sync-adv-scroll");
	if (!scroll) { return; }
	var countEl = document.getElementById("wiki-sync-adv-count");
	var all = avesmapsAdvPickerCache || [];
	var rows = avesmapsAdvFilteredRows(null);
	if (countEl) { countEl.textContent = rows.length + " / " + all.length; }
	if (!rows.length) {
		scroll.innerHTML = '<p class="wiki-sync-panel__summary">' + (all.length ? "Kein Treffer." : "Keine Abenteuer.") + '</p>';
		return;
	}
	var esc = typeof escapeHtml === "function" ? escapeHtml : function (s) { return String(s == null ? "" : s); };
	scroll.innerHTML = rows.map(function (a) {
		var meta = [a.edition, a.product_type].filter(Boolean).join(" · ");
		var draft = a.status && a.status !== "approved" ? " · Entwurf" : "";
		return '<button type="button" class="wiki-sync-adv-picker__row" data-adv-id="' + esc(a.public_id) + '" title="Doppelklick: im Abenteuereditor öffnen">'
			+ '<span class="wiki-sync-adv-picker__title">' + esc(a.title || "(ohne Titel)") + '</span>'
			+ '<span class="wiki-sync-adv-picker__meta">' + esc(meta + draft) + '</span>'
			+ '</button>';
	}).join("");
}

function avesmapsWireAdventurePicker() {
	if (avesmapsAdvPickerWired) { return; }
	var searchEl = document.getElementById("wiki-sync-adv-search");
	var scroll = document.getElementById("wiki-sync-adv-scroll");
	if (!searchEl || !scroll) { return; }
	avesmapsAdvPickerWired = true;
	wikiSyncBuildFacetMenu("wiki-sync-adv-filter-menu", AVESMAPS_ADV_FACETS, function (key) {
		return "wiki-sync-adv-" + key.toLowerCase() + "-menu";
	});
	AVESMAPS_WIKISYNC_FILTER_REBUILDS.push(attachFilterMenu("wiki-sync-adv-filter-toggle", "wiki-sync-adv-filter-menu", [
		{ menuId: "wiki-sync-adv-type-menu", kind: "multi", state: avesmapsAdvTypeFilter, getOptions: function () { return avesmapsAdvFacetOptions("type"); }, label: avesmapsAdvFacet("type").label, isActive: function () { return avesmapsAdvTypeFilter.size > 0; } },
		{ menuId: "wiki-sync-adv-edition-menu", kind: "multi", state: avesmapsAdvEditionFilter, getOptions: function () { return avesmapsAdvFacetOptions("edition"); }, label: avesmapsAdvFacet("edition").label, isActive: function () { return avesmapsAdvEditionFilter.size > 0; } },
		{ menuId: "wiki-sync-adv-region-menu", kind: "multi", state: avesmapsAdvRegionFilter, getOptions: avesmapsAdvRegionOptions, label: avesmapsAdvFacet("region").label, isActive: function () { return avesmapsAdvRegionFilter.size > 0; } },
		{ menuId: "wiki-sync-adv-cover-menu", kind: "single", state: avesmapsAdvCoverFilter, getOptions: function () { return avesmapsAdvFacetOptions("cover"); }, label: avesmapsAdvFacet("cover").label, isActive: function () { return Boolean(avesmapsAdvCoverFilter.value); } },
		{ menuId: "wiki-sync-adv-fshop-menu", kind: "single", state: avesmapsAdvFshopFilter, getOptions: function () { return avesmapsAdvFacetOptions("fshop"); }, label: avesmapsAdvFacet("fshop").label, isActive: function () { return Boolean(avesmapsAdvFshopFilter.value); } },
	], avesmapsRenderAdventurePicker, "Filter"));
	searchEl.addEventListener("input", avesmapsRenderAdventurePicker);
	scroll.addEventListener("dblclick", function (e) {
		var row = e.target && e.target.closest ? e.target.closest("[data-adv-id]") : null;
		if (!row) { return; }
		var id = row.getAttribute("data-adv-id");
		if (id && typeof window.openAvesmapsAdventureEditorOverlay === "function") {
			window.openAvesmapsAdventureEditorOverlay(id);
		}
	});
}

window.loadWikiSyncAdventureList = window.loadWikiSyncAdventureList || function loadWikiSyncAdventureList(force) {
	avesmapsWireAdventurePicker();
	if (avesmapsAdvPickerCache && !force) {
		avesmapsRenderAdventurePicker();
		return Promise.resolve();
	}
	var scroll = document.getElementById("wiki-sync-adv-scroll");
	return fetch("/api/edit/map/adventures.php", {
		method: "POST", credentials: "same-origin",
		headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list" }),
	}).then(function (r) { return r.json().catch(function () { return null; }); }).then(function (p) {
		if (!p || p.ok !== true || !Array.isArray(p.adventures)) {
			throw new Error((p && p.error && p.error.message) || "Laden fehlgeschlagen");
		}
		avesmapsAdvPickerCache = p.adventures;
		avesmapsRenderAdventurePicker();
	}).catch(function (e) {
		if (scroll) { scroll.innerHTML = '<p class="wiki-sync-panel__summary">Fehler: ' + (e && e.message ? e.message : "Laden fehlgeschlagen") + '</p>'; }
	});
};

// ---- Karten-Liste im "Materialien"-Tab, Untertab "Karten" ----------------------------------------
// The adventure picker's twin, deliberately built as a near-copy of the three functions above rather
// than a shared abstraction: they differ in catalog endpoint, row meta, empty text and which editor a
// double-click opens -- parameterising all four leaves a function whose body is one big conditional.
// Same DOM component (.wiki-sync-adv-picker) and same stylesheet, so they cannot drift apart visually,
// which is what actually matters here.
var avesmapsCmPickerCache = null; // [{ public_id, title, origin, status, place_count, types, ... }]
var avesmapsCmPickerWired = false;

// --- Filter der Kartenliste ---------------------------------------------------------------
// Hier gab es nichts zu uebernehmen: der Karteneditor hat selbst nur eine Titelsuche
// (citymapMatchesSearch, html/citymap-editor.html:672). Die vier Facetten kommen daher aus den
// echten Spalten. „kostenpflichtig" und „mit Maßstab" heissen woertlich wie im Editorformular
// (html/citymap-editor.html:995) und sind DREIWERTIG -- NULL heisst dort „weiss niemand".
var AVESMAPS_CM_FACETS = wikiSyncSubjectFacets("citymaps");
function avesmapsCmFacet(key) {
	return AVESMAPS_CM_FACETS.find(function (facet) { return facet.key === key; });
}
var avesmapsCmPaidFilter = { value: "" };
var avesmapsCmScaleFilter = { value: "" };
var avesmapsCmPreviewFilter = { value: "" };
var avesmapsCmThumbOriginFilter = new Set();

// Wie bei den Abenteuern: mit null fuer die Liste, mit einem Schluessel fuer die Optionen dieser
// einen Facette -- sonst faellt jede nicht gewaehlte Option aus ihrem eigenen Menue heraus.
function avesmapsCmFilteredRows(skipKey) {
	var searchEl = document.getElementById("wiki-sync-cm-search");
	var q = (searchEl && searchEl.value ? searchEl.value : "").trim().toLowerCase();
	return (avesmapsCmPickerCache || []).filter(function (c) {
		if (q && (c.title || "").toLowerCase().indexOf(q) < 0) { return false; }
		if (skipKey !== "paid" && !wikiSyncFacetMatches(c, avesmapsCmFacet("paid"), avesmapsCmPaidFilter)) { return false; }
		if (skipKey !== "scale" && !wikiSyncFacetMatches(c, avesmapsCmFacet("scale"), avesmapsCmScaleFilter)) { return false; }
		if (skipKey !== "preview" && !wikiSyncFacetMatches(c, avesmapsCmFacet("preview"), avesmapsCmPreviewFilter)) { return false; }
		if (skipKey !== "thumbOrigin" && !wikiSyncFacetMatches(c, avesmapsCmFacet("thumbOrigin"), avesmapsCmThumbOriginFilter)) { return false; }
		return true;
	});
}

var AVESMAPS_CM_FILTER_STATES = {
	paid: avesmapsCmPaidFilter, scale: avesmapsCmScaleFilter,
	preview: avesmapsCmPreviewFilter, thumbOrigin: avesmapsCmThumbOriginFilter,
};

function avesmapsCmFacetOptions(key) {
	return wikiSyncFacetOptions(avesmapsCmFilteredRows(key), avesmapsCmFacet(key), AVESMAPS_CM_FILTER_STATES[key]);
}

function avesmapsRenderCitymapPicker() {
	var scroll = document.getElementById("wiki-sync-cm-scroll");
	if (!scroll) { return; }
	var countEl = document.getElementById("wiki-sync-cm-count");
	var all = avesmapsCmPickerCache || [];
	var rows = avesmapsCmFilteredRows(null);
	if (countEl) { countEl.textContent = rows.length + " / " + all.length; }
	if (!rows.length) {
		scroll.innerHTML = '<p class="wiki-sync-panel__summary">' + (all.length ? "Kein Treffer." : "Keine Karten.") + '</p>';
		return;
	}
	// escapeHtml (js/app/utils.js) is loaded well before this file, so the fallback is dead code -- but
	// it ESCAPES rather than passing the string through, unlike the older pickers'. A dead fallback that
	// silently disables escaping if the load order ever shifts is a footgun, not a safety net.
	var esc = typeof escapeHtml === "function" ? escapeHtml : function (s) {
		return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
			return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
		});
	};
	scroll.innerHTML = rows.map(function (c) {
		// Meta mirrors the adventure row's "edition · product_type": what tells two rows apart at a
		// glance. For maps that is the place it shows and where it came from -- 419 of 420 are 'wiki',
		// so only the exceptions are worth naming (same reasoning as the editor's provenance pill).
		var places = Array.isArray(c.places) ? c.places : [];
		var place = places.length ? (places[0].raw_name || "") : "";
		var origin = c.origin && c.origin !== "wiki" ? " · " + (c.origin === "community" ? "Community" : "eigen") : "";
		var draft = c.status && c.status !== "approved" ? " · verborgen" : "";
		var meta = [place, (c.types || []).join("/")].filter(Boolean).join(" · ");
		return '<button type="button" class="wiki-sync-adv-picker__row" data-cm-id="' + esc(c.public_id) + '" title="Doppelklick: im Karteneditor öffnen">'
			+ '<span class="wiki-sync-adv-picker__title">' + esc(c.title || "(ohne Titel)") + '</span>'
			+ '<span class="wiki-sync-adv-picker__meta">' + esc(meta + origin + draft) + '</span>'
			+ '</button>';
	}).join("");
}

function avesmapsWireCitymapPicker() {
	if (avesmapsCmPickerWired) { return; }
	var searchEl = document.getElementById("wiki-sync-cm-search");
	var scroll = document.getElementById("wiki-sync-cm-scroll");
	if (!searchEl || !scroll) { return; }
	avesmapsCmPickerWired = true;
	wikiSyncBuildFacetMenu("wiki-sync-cm-filter-menu", AVESMAPS_CM_FACETS, function (key) {
		return "wiki-sync-cm-" + key.toLowerCase() + "-menu";
	});
	AVESMAPS_WIKISYNC_FILTER_REBUILDS.push(attachFilterMenu("wiki-sync-cm-filter-toggle", "wiki-sync-cm-filter-menu", [
		{ menuId: "wiki-sync-cm-paid-menu", kind: "single", state: avesmapsCmPaidFilter, getOptions: function () { return avesmapsCmFacetOptions("paid"); }, label: avesmapsCmFacet("paid").label, isActive: function () { return Boolean(avesmapsCmPaidFilter.value); } },
		{ menuId: "wiki-sync-cm-scale-menu", kind: "single", state: avesmapsCmScaleFilter, getOptions: function () { return avesmapsCmFacetOptions("scale"); }, label: avesmapsCmFacet("scale").label, isActive: function () { return Boolean(avesmapsCmScaleFilter.value); } },
		{ menuId: "wiki-sync-cm-preview-menu", kind: "single", state: avesmapsCmPreviewFilter, getOptions: function () { return avesmapsCmFacetOptions("preview"); }, label: avesmapsCmFacet("preview").label, isActive: function () { return Boolean(avesmapsCmPreviewFilter.value); } },
		{ menuId: "wiki-sync-cm-thumborigin-menu", kind: "multi", state: avesmapsCmThumbOriginFilter, getOptions: function () { return avesmapsCmFacetOptions("thumbOrigin"); }, label: avesmapsCmFacet("thumbOrigin").label, isActive: function () { return avesmapsCmThumbOriginFilter.size > 0; } },
	], avesmapsRenderCitymapPicker, "Filter"));
	searchEl.addEventListener("input", avesmapsRenderCitymapPicker);
	scroll.addEventListener("dblclick", function (e) {
		var row = e.target && e.target.closest ? e.target.closest("[data-cm-id]") : null;
		if (!row) { return; }
		var id = row.getAttribute("data-cm-id");
		if (id && typeof window.openAvesmapsCitymapEditorOverlay === "function") {
			window.openAvesmapsCitymapEditorOverlay(id);
		}
	});
}

// The EDITOR catalog (POST {action:list}), not the public GET: the public read hides suppressed maps
// and applies the licence gate, so an editor list built on it would silently omit exactly the rows an
// editor needs to find. Same choice the adventure picker makes.
window.loadWikiSyncCitymapList = window.loadWikiSyncCitymapList || function loadWikiSyncCitymapList(force) {
	avesmapsWireCitymapPicker();
	if (avesmapsCmPickerCache && !force) {
		avesmapsRenderCitymapPicker();
		return Promise.resolve();
	}
	var scroll = document.getElementById("wiki-sync-cm-scroll");
	return fetch("/api/edit/map/citymaps.php", {
		method: "POST", credentials: "same-origin",
		headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list" }),
	}).then(function (r) { return r.json().catch(function () { return null; }); }).then(function (p) {
		if (!p || p.ok !== true || !Array.isArray(p.citymaps)) {
			throw new Error((p && p.error && p.error.message) || "Laden fehlgeschlagen");
		}
		avesmapsCmPickerCache = p.citymaps;
		avesmapsRenderCitymapPicker();
	}).catch(function (e) {
		if (scroll) { scroll.innerHTML = '<p class="wiki-sync-panel__summary">Fehler: ' + (e && e.message ? e.message : "Laden fehlgeschlagen") + '</p>'; }
	});
};
