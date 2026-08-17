// Kraftlinien-Editor overlay -- the sixth list editor. Same shared shell
// (css/components/editor-shell.css, avm-editor-* classes) as the settlement editor
// (openAvesmapsSettlementEditorOverlay in review-settlement-list.js), its own self-contained iframe
// page html/wiki-sync-powerline-editor.html loaded with ?v=Date.now() (no ASSET_VERSION -- the host
// cache-busts the document; the deploy stamps the CSS/JS it links). A powerline is line-centric but
// segment-backed; the editor page groups over the shared name and delegates topology to
// js/map-features/powerline-topology.js. Design: docs/superpowers/specs/2026-07-23-kraftlinien-editor-design.md
//
// Optional preselect by line NAME: the map popup's "Bearbeiten" opens this editor already on the
// clicked line (§11) via postMessage into the same-origin iframe.
window.openAvesmapsPowerlineEditorOverlay = window.openAvesmapsPowerlineEditorOverlay || function openAvesmapsPowerlineEditorOverlay(preselectName) {
	const overlayId = "avesmaps-powerline-editor-overlay";
	const buildSrc = () => "/html/wiki-sync-powerline-editor.html?v=" + Date.now();
	const postSelect = (frame) => {
		const name = (preselectName == null ? "" : String(preselectName)).trim();
		if (!name || !frame || !frame.contentWindow) {
			return;
		}
		try { frame.contentWindow.postMessage({ avesmapsPowerlineSelect: name }, location.origin); } catch (e) { /* noop */ }
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
	overlay.className = "avm-editor-overlay";
	const dialog = document.createElement("div");
	dialog.className = "avm-editor-dialog";
	const header = document.createElement("div");
	header.className = "avm-editor-dialog__header";
	const headingEl = document.createElement("h2");
	headingEl.textContent = "Kraftlinien bearbeiten";
	const closeButton = document.createElement("button");
	closeButton.type = "button";
	closeButton.className = "avm-editor-dialog__close";
	closeButton.setAttribute("aria-label", "Schließen");
	closeButton.textContent = "✕";
	const closeOverlay = () => { overlay.hidden = true; document.body.style.overflow = ""; };
	closeButton.addEventListener("click", closeOverlay);
	header.appendChild(headingEl);
	header.appendChild(closeButton);
	const frame = document.createElement("iframe");
	frame.className = "avm-editor-dialog__frame";
	frame.src = buildSrc();
	frame.title = "Kraftlinien-Editor";
	// A newly built iframe is not loaded yet -- post the preselect once it is.
	frame.addEventListener("load", () => postSelect(frame));
	dialog.appendChild(header);
	dialog.appendChild(frame);
	overlay.appendChild(dialog);
	overlay.addEventListener("click", (event) => { if (event.target === overlay) closeOverlay(); });
	document.body.appendChild(overlay);
	document.body.style.overflow = "hidden";
};

// The editor iframe asks the parent to fly the live map to a node ("◎ auf Karte zeigen" in the
// Knoten column). Kept here rather than in the iframe because only the parent holds the map + marker
// index. No-op if the map is not ready or the node is not on the map.
window.avesmapsFlyToLocationPublicId = window.avesmapsFlyToLocationPublicId || function avesmapsFlyToLocationPublicId(publicId) {
	try {
		if (typeof findLocationMarkerByPublicId !== "function" || typeof map === "undefined" || !map) {
			return;
		}
		const entry = findLocationMarkerByPublicId(publicId);
		if (entry && entry.marker && typeof entry.marker.getLatLng === "function") {
			map.flyTo(entry.marker.getLatLng(), Math.max(map.getZoom(), 4), { duration: 0.6 });
		}
	} catch (e) { /* noop */ }
};

// ---------------------------------------------------------------------------------------------
// Panel list (WikiSync „Kraftlinien" tab): the ~40 lines grouped by name, so the tab shows a list
// like every other subject instead of a static hint. Double-clicking a line switches the map to
// powerline mode and zooms to it. Read straight from the app's powerlineData (no API -- a powerline
// is many segments sharing a name), grouped with the same shared topology helpers the editor uses.
// The loader is wired in setWikiSyncPanelTab (review-wiki-sync.js); rendering also re-runs when the
// data (re)loads (preparePowerlineData / applyLivePowerlineFeature).
// ---------------------------------------------------------------------------------------------
let avesmapsPowerlineSyncFilterText = "";

// ---------------------------------------------------------------------------------------------
// „Wie steht diese Zeile zum Wiki?" -- die dritte Spalte der Zeile (Stufe 1). Fuenf Formen, alle in
// js/review/review-list-wikistatus.js begruendet; die Leitidee lautet dort: durchgezogen = erledigt,
// gestrichelt = offen.
//
// Die Kraftlinien haben das Symbol als erste bekommen, und der Grund ist der
// Zuschnitt, nicht der Zufall: ihr Katalog reist ohnehin in DERSELBEN Antwort mit, in der die
// Segmente stehen (`GET /api/edit/map/powerlines.php` -> `segments` + `wiki_articles`, gemessen
// 165 und 23 am 17.08.2026). Ein Aufruf, kein zweiter -- und NIE das Wiki: die Vorschlagsliste
// kommt aus dem eingelesenen Dump, nicht von einer Live-Abfrage. Bei Wegen, Orten und Regionen
// staenden Tausende Kandidaten, die kein Payload mitschleppt; deshalb ist das Opt-in der
// eigentliche Zuschnitt und nicht Zierrat.
//
// 💣 OHNE KATALOG KEINE SPALTE. Seit dem Owner-Entscheid vom 17.08.2026 traegt JEDE Zeile ein
// Symbol, und „offen, kein Kandidat gefunden" ist eine ausgesprochene Aussage (gestrichelte
// Kontur). Genau deshalb darf sie nicht erscheinen, wenn der Abruf scheitert (nicht angemeldet,
// Netz weg, `dump_state.problem`): dann waere gar nicht gesucht worden, und 58 Zeilen behaupteten
// „offen", weil niemand nachgesehen hat. Faellt der Katalog aus, faellt die ganze Spalte -- so
// sieht die Liste aus wie jede Liste ohne Symbolspalte und sagt nichts Falsches.
const AVESMAPS_POWERLINE_WIKI_API = "/api/edit/map/powerlines.php";
let avesmapsPowerlineWikiKatalog = [];
// Name der Gruppe -> {teile, zugewieseneTeile, keinArtikel}. 💣 ZAEHLER UND NENNER AUS DERSELBEN
// POPULATION: beide zaehlen die Segmente, die DIESE Antwort fuehrt. Der Nenner aus `powerlineData`
// (der oeffentlichen Kartennutzlast, aus der die Zeilen entstehen) waere eine zweite Population --
// die beiden gruppieren ueber verschiedene Felder (`map_features.name` hier, `properties.name`
// dort), und wo sie auseinanderlaufen, stuende im Tooltip „5 von 3".
let avesmapsPowerlineWikiSegmentbilanz = new Map();
// Eine Namensgruppe, die diese Antwort gar nicht kennt: keine Zuweisung, kein Merker -- der
// Abgleich entscheidet dann allein am Katalog. Die sichere Richtung.
const AVESMAPS_POWERLINE_WIKI_BILANZ_LEER = { teile: 0, zugewieseneTeile: 0, keinArtikel: false };
// offen -> laeuft -> fertig | fehler. Nur "offen" loest einen Abruf aus.
// 💣 Diese Sperre ist TRAGEND, nicht bloss sparsam: der Erfolgszweig zeichnet die Liste neu, und
// das Neuzeichnen ruft den Lader wieder -- ohne sie dreht sich das im Kreis und schickt Anfrage
// um Anfrage. „fehler" wird ebenfalls nicht wiederholt, sonst haengt an jedem Tastendruck in der
// Suche eine neue vergebliche Anfrage.
let avesmapsPowerlineWikiLadezustand = "offen";
// 🔴 Erst wenn der Reiter „Kraftlinien" einmal geoeffnet war. Der Zeichner laeuft naemlich auch
// fuer JEDEN Besucher: preparePowerlineData ruft ihn, sobald die Kartendaten da sind. Ohne dieses
// Tor schickte jeder anonyme Seitenaufruf eine Anfrage an einen Endpunkt der Faehigkeit `edit` --
// eine 401 je Besuch, fuer nichts. Dieselbe Faulheit haben loadRegionWikiSync und loadPathWikiSync.
let avesmapsPowerlineWikiTabOffen = false;

// Einmal je Sitzung. Ergebnis: der Katalog und je Namensgruppe ihre Segmentbilanz.
function avesmapsPowerlineWikiKatalogLaden() {
	if (!avesmapsPowerlineWikiTabOffen || avesmapsPowerlineWikiLadezustand !== "offen") { return; }
	avesmapsPowerlineWikiLadezustand = "laeuft";
	fetch(AVESMAPS_POWERLINE_WIKI_API, { credentials: "same-origin" })
		.then((antwort) => antwort.json())
		.then((daten) => {
			if (!daten || daten.ok !== true) { throw new Error("keine Nutzlast"); }
			avesmapsPowerlineWikiKatalog = Array.isArray(daten.wiki_articles) ? daten.wiki_articles : [];
			// „Zugewiesen" ist genau das, was auch der Editor so nennt: properties.wiki_url auf
			// EINEM Segment der Namensgruppe (dort `fieldSample(line, "wiki_url")`). Das Nest
			// wiki_powerline zaehlt bewusst NICHT -- das schreibt der Namensabgleich von selbst, es
			// ist keine Entscheidung eines Editors und niemand hat es zugewiesen.
			// 🔴 Der Merker „kein Wiki-Artikel vorhanden" wird GEODERT, nicht gezaehlt -- genau wie
			// der Editor ihn liest (`segments.some(s.wiki_no_article)`). Zwei Leser desselben Merkers mit
			// verschiedener Rechnung waeren zwei Wahrheiten ueber dieselbe Zeile.
			avesmapsPowerlineWikiSegmentbilanz = new Map();
			(Array.isArray(daten.segments) ? daten.segments : []).forEach((segment) => {
				const gruppe = String((segment && segment.name) || "").trim();
				if (gruppe === "") { return; }
				if (!avesmapsPowerlineWikiSegmentbilanz.has(gruppe)) {
					avesmapsPowerlineWikiSegmentbilanz.set(gruppe, { teile: 0, zugewieseneTeile: 0, keinArtikel: false });
				}
				const bilanz = avesmapsPowerlineWikiSegmentbilanz.get(gruppe);
				bilanz.teile++;
				if (String(segment.wiki_url || "").trim() !== "") { bilanz.zugewieseneTeile++; }
				if (segment.wiki_no_article) { bilanz.keinArtikel = true; }
			});
			avesmapsPowerlineWikiLadezustand = "fertig";
			renderPowerlineSyncList();
		})
		.catch(() => {
			avesmapsPowerlineWikiLadezustand = "fehler";
			avesmapsPowerlineWikiKatalog = [];
			avesmapsPowerlineWikiSegmentbilanz = new Map();
		});
}

// Der Einstieg des Reiters (setWikiSyncPanelTab in review-wiki-sync.js) -- benannt wie die
// Geschwister loadRegionWikiSync / loadPathWikiSync, weil er dasselbe tut: beim ersten Oeffnen
// holen, danach nur noch zeichnen.
function loadPowerlineWikiSync() {
	avesmapsPowerlineWikiTabOffen = true;
	renderPowerlineSyncList();
}

function avesmapsPowerlinePanelNodeName(publicId) {
	if (typeof findLocationMarkerByPublicId !== "function") { return ""; }
	const entry = findLocationMarkerByPublicId(publicId);
	return entry ? String(entry.name || "").trim() : "";
}

function avesmapsPowerlinePanelSpanText(topology) {
	if (!topology) { return ""; }
	if (topology.endpointIds.length === 2) {
		const a = avesmapsPowerlinePanelNodeName(topology.endpointIds[0]);
		const b = avesmapsPowerlinePanelNodeName(topology.endpointIds[1]);
		return (a && b) ? (a + " ↔ " + b) : "";
	}
	if (topology.isRing) { return "geschlossener Ring"; }
	if (topology.endpointIds.length > 0) { return topology.endpointIds.length + " Enden"; }
	return "";
}

// Group all powerline segments by name and attach the shared topology. Sorted by name (de).
function avesmapsPowerlinePanelGroups() {
	const all = (typeof powerlineData !== "undefined" && Array.isArray(powerlineData)) ? powerlineData : [];
	const byName = new Map();
	all.forEach((segment) => {
		const name = String((segment && segment.properties && segment.properties.name) || "").trim();
		if (name === "") { return; }
		if (!byName.has(name)) { byName.set(name, []); }
		byName.get(name).push(segment);
	});
	const lookup = (typeof powerlineAppNodeLookup === "function") ? powerlineAppNodeLookup : (() => null);
	return [...byName.entries()].map(([name, segments]) => ({
		name,
		segments,
		topology: (typeof avesmapsPowerlineTopology === "function") ? avesmapsPowerlineTopology(segments, lookup) : null,
	})).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

// Render the list into #powerline-sync-list. Idempotent: re-run on data load, tab switch, search.
function renderPowerlineSyncList() {
	const list = document.getElementById("powerline-sync-list");
	if (!list) { return; }
	const esc = (typeof escapeHtml === "function") ? escapeHtml : ((s) => String(s == null ? "" : s));
	avesmapsPowerlineWikiKatalogLaden();
	// Das Opt-in haengt am Katalog, nicht am Reiter: ohne Artikel gibt es nichts zu sagen, und eine
	// leere dritte Spalte kostet trotzdem ihre 16px plus 7px Spalt in einem 400px-Panel.
	const zeigeWikistatus = avesmapsPowerlineWikiKatalog.length > 0
		&& typeof avesmapsWikistatusZustand === "function";
	list.classList.toggle("wikisync-itemlist--wikistatus", zeigeWikistatus);
	const groups = avesmapsPowerlinePanelGroups();
	const summary = document.getElementById("powerline-sync-summary");
	if (summary) {
		const segCount = (typeof powerlineData !== "undefined" && Array.isArray(powerlineData)) ? powerlineData.length : 0;
		// 💣 "N Kraftlinien" stand hier UND steht seit 14.08.2026 in der Bilanzzeile -- beides ist
		// groups.length, also zweimal wortgleich untereinander. Hier bleiben die Segmente, die die
		// Bilanzzeile nicht kennt. Keine Information verloren, nur die Dopplung.
		summary.textContent = segCount + " Segmente";
	}
	if (groups.length === 0) {
		avesmapsListBalanceRender("powerline-sync-balance", "Kraftlinien", 0, 0);
		list.innerHTML = '<div class="wikisync-itemlist__empty" style="padding:8px;color:var(--color-text-muted);">Keine Kraftlinien geladen.</div>';
		return;
	}
	const term = avesmapsPowerlineSyncFilterText.trim().toLowerCase();
	const visible = term ? groups.filter((g) => g.name.toLowerCase().indexOf(term) !== -1) : groups;
	// ⚠️ VOR dem "nichts gefunden"-Ausstieg: sonst steht bei 0 Treffern noch die alte Zahl da.
	avesmapsListBalanceRender("powerline-sync-balance", "Kraftlinien", visible.length, groups.length);
	if (visible.length === 0) {
		list.innerHTML = '<div class="wikisync-itemlist__empty" style="padding:8px;color:var(--color-text-muted);">Nichts gefunden.</div>';
		return;
	}
	list.innerHTML = visible.map((g) => {
		const nodeCount = g.topology ? g.topology.adjacency.size : 0;
		const span = avesmapsPowerlinePanelSpanText(g.topology);
		const meta = nodeCount + " Nodices · " + g.segments.length + " Segmente" + (span ? " · " + span : "");
		// Der Abgleich ist eine eigene, gepruefte Funktion (js/review/review-list-wikistatus.js) --
		// keine Bedingung hier im Zeichner. Nur so ist seine Abnahmeliste ueberhaupt pruefbar.
		let wikistatus = "";
		if (zeigeWikistatus) {
			const bilanz = avesmapsPowerlineWikiSegmentbilanz.get(g.name) || AVESMAPS_POWERLINE_WIKI_BILANZ_LEER;
			wikistatus = avesmapsWikistatusMarkup(
				avesmapsWikistatusZustand(g.name, avesmapsPowerlineWikiKatalog, bilanz));
		}
		return '<div class="tree-item has-map-status region-sync__item powerline-sync__item" data-powerline-name="' + esc(g.name) + '"'
			+ ' title="Doppelklick: im Kraftlinienmodus auf diese Linie zoomen" style="cursor:pointer;">'
			+ '<span class="tree-item-name">' + esc(g.name) + '</span>'
			+ '<span class="tree-item-meta">' + esc(meta) + '</span>'
			+ wikistatus
			+ '</div>';
	}).join("");
}

// Double-click a line -> powerline mode + zoom to the whole line (delegated, attached once).
document.addEventListener("dblclick", (event) => {
	const target = event.target;
	const row = (target && target.closest) ? target.closest(".powerline-sync__item[data-powerline-name]") : null;
	if (!row) { return; }
	const name = String(row.getAttribute("data-powerline-name") || "").trim();
	const all = (typeof powerlineData !== "undefined" && Array.isArray(powerlineData)) ? powerlineData : [];
	const rep = all.find((s) => String((s && s.properties && s.properties.name) || "").trim() === name);
	if (!rep) { return; }
	if (typeof setSelectedMapLayerMode === "function") { setSelectedMapLayerMode("powerlines"); }
	if (typeof showWholePowerlineFromInfobox === "function") { showWholePowerlineFromInfobox(rep); }
});

// Search box over the list (same document-input pattern as review-path-sync.js's #path-sync-filter).
document.addEventListener("input", (event) => {
	if (event.target && event.target.id === "powerline-sync-filter") {
		avesmapsPowerlineSyncFilterText = event.target.value || "";
		renderPowerlineSyncList();
	}
});
