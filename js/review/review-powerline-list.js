/* 🪤 04.09.2026 Stempel-Heilung nach einem abgebrochenen Deploy -- die Begruendung steht in css/components/fenster.css. */
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
	// 🔴 DURCHSICHTIG VON ANFANG AN (Owner 29.08.2026): keine Unschaerfe, kein Schleier, und das
	// Overlay faengt keine Klicks ab -- die Karte bleibt daneben sichtbar UND bedienbar. Der Grund
	// ist die Kurvenform: man stellt sie ein, waehrend man die Linie sieht.
	// ⚠️ Nur DIESER Editor. Die fuenf anderen behalten den Schleier: sie arbeiten nicht gegen die
	// Karte, und ein abgedunkelter Hintergrund haelt den Blick beim Formular.
	overlay.className = "avm-editor-overlay avm-editor-overlay--durchsichtig";
	const dialog = document.createElement("div");
	dialog.className = "avm-editor-dialog avm-fenster avm-fenster--werkzeug";
	const closeOverlay = () => { overlay.hidden = true; document.body.style.overflow = ""; };
	// 🔴 EIN Bauteil fuer alle sieben Fenster-Koepfe (js/ui/fenster-kopf.js).
	const kopfteile = avesmapsFensterKopf("Kraftlinien bearbeiten", {
		wirtsklasse: "avm-editor-dialog__header",
		aufSchliessen: closeOverlay,
	});
	const header = kopfteile.kopf;
	const closeButton = kopfteile.schliessen;
	avesmapsEditorDialogZiehbar(header, dialog);
	const frame = document.createElement("iframe");
	frame.className = "avm-editor-dialog__frame";
	frame.src = buildSrc();
	frame.title = "Kraftlinien-Editor";
	// A newly built iframe is not loaded yet -- post the preselect once it is.
	frame.addEventListener("load", () => postSelect(frame));
	dialog.appendChild(header);
	dialog.appendChild(frame);
	overlay.appendChild(dialog);
	// 🔴 KEIN „Klick auf den Hintergrund schliesst" mehr: der Hintergrund IST die Karte, und ein
	// Klick darauf soll sie bedienen, nicht den Editor zuwerfen, an dem man gerade arbeitet. Das
	// Overlay bekommt ohnehin keine Klicks mehr (pointer-events: none).
	// ⚠️ Geschlossen wird ueber das ✕ im Kopf -- der einzige Weg, und er ist sichtbar.
	document.body.appendChild(overlay);
	document.body.style.overflow = "hidden";
};

// Der Editor bittet das Hauptfenster, die Kurve einer Linie auf der KARTE einstellen zu lassen.
// Hier und nicht im iframe, weil nur das Hauptfenster die Karte und die Kraftlinien-Ebenen haelt --
// dasselbe Verhaeltnis wie bei avesmapsFlyToLocationPublicId darunter.
// Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md Abschnitt 8.
//
// 🔴 Das Overlay wird WEGGEBLENDET, nicht geschlossen. closeOverlay() setzt zwar nur `hidden`, aber
// der Editor darin haelt seinen ungespeicherten Formularstand; ein spaeterer Neuaufbau des iframes
// waere ein leerer neuer Stand. Dasselbe Hausmuster wie beim Social-Hub, der sich fuers
// Kartenausschnitt-Ziehen wegblendet statt zu schliessen.
window.avesmapsPowerlineCurveEditStart = window.avesmapsPowerlineCurveEditStart
	|| function avesmapsPowerlineCurveEditStart(name, segmente) {
	const overlay = document.getElementById("avesmaps-powerline-editor-overlay");
	if (!overlay || typeof avesmapsKurveReglerZeigen !== "function") {
		// 🔴 Kein stiller Leerlauf: der Aufrufer muss erfahren, dass nichts passiert ist, damit er
		// es SAGEN kann. Ein Knopf, der nichts tut, ist von einem kaputten nicht zu unterscheiden.
		return false;
	}
	const linienName = String(name || "").trim();
	const stuecke = Array.isArray(segmente) ? segmente.filter((s) => s && s.public_id) : [];
	if (linienName === "" || stuecke.length === 0) {
		return false;
	}

	// ⚠️ Die Kraftlinien-Ebenen liegen nur im Modus „Kraftlinien" auf der Karte, und nur dort laeuft
	// ihre Animation (syncPowerlineVisibility). Steht die Karte anders, wird umgeschaltet -- und am
	// Ende zurueck, sonst nimmt der Regler dem Owner nebenbei seine Ansicht weg.
	// 💣 Das Element heisst `#mapLayerModeSelect` und wird per jQuery gelesen
	// (getSelectedMapLayerMode, js/map-features/map-features-display-mode.js) -- NICHT
	// `#mapStyleSelect`, das ist der UNTERGRUND (Old/Original/Modern). Und die Aenderung muss ueber
	// jQuery laufen: die Karte haengt an `.trigger("change")`, ein natives dispatchEvent erreicht
	// die jQuery-Handler nicht.
	const vorherigerModus = (typeof getSelectedMapLayerMode === "function") ? getSelectedMapLayerMode() : null;
	const setzeModus = (modus) => {
		if (modus === null || typeof $ !== "function") { return; }
		const feld = $("#mapLayerModeSelect");
		if (!feld.length || String(feld.val()) === modus) { return; }
		feld.val(modus).trigger("change");
	};
	setzeModus("powerlines");

	// 🔴 Das Overlay wird WEGGEBLENDET, nicht geschlossen. Der Editor darin haelt seinen
	// ungespeicherten Formularstand; ein Neuaufbau des iframes waere ein leerer neuer Stand.
	// Dasselbe Hausmuster wie beim Social-Hub, der sich fuers Kartenausschnitt-Ziehen wegblendet.
	overlay.hidden = true;
	document.body.style.overflow = "";

	const zeichneNeu = () => {
		if (typeof refreshPowerlineLayers === "function") { refreshPowerlineLayers(); }
	};
	const werte = {};
	stuecke.forEach((st) => { werte[st.public_id] = Number(st.curve) || 0; });
	avesmapsPowerlineCurveVorschau.werte = werte;
	avesmapsPowerlineCurveVorschau.aktiv = stuecke[0].public_id;
	zeichneNeu();

	// 💣 EIN KLICK AUF DER KARTE WAEHLT DAS STUECK (Owner 29.08.2026) -- das ist der Grund, hier
	// einzustellen statt im Editor. Der Handler haengt am Kartencontainer und faengt Klicks auf die
	// Kraftlinien-Ebenen ab; er wird beim „Fertig" wieder abgemeldet, sonst bliebe er fuer immer
	// liegen und stoerte den normalen Klick-Schiedsrichter.
	let steuerung = null;
	const beiKartenklick = (event) => {
		const treffer = event && event.target && event.target.closest
			? event.target.closest(".powerline")
			: null;
		if (!treffer) { return; }
		// Die angeklickte Linie ueber ihre Leaflet-Schicht finden -- nur Stuecke DIESER Linie zaehlen.
		const getroffen = (typeof powerlineData !== "undefined" ? powerlineData : []).find((pl) => {
			const gruppe = pl && pl._layerGroup;
			if (!gruppe) { return false; }
			let ja = false;
			gruppe.eachLayer((schicht) => {
				if (schicht._path === treffer || (schicht._path && schicht._path === treffer)) { ja = true; }
			});
			return ja;
		});
		const pid = getroffen && String(getroffen.properties?.public_id || getroffen.id || "");
		if (pid && steuerung && typeof steuerung.waehle === "function"
				&& Object.prototype.hasOwnProperty.call(werte, pid)) {
			steuerung.waehle(pid);
		}
	};
	const karteEl = (typeof map !== "undefined" && map && map.getContainer) ? map.getContainer() : null;
	if (karteEl) { karteEl.addEventListener("click", beiKartenklick, true); }

	steuerung = avesmapsKurveReglerZeigen({
		name: linienName,
		segmente: stuecke,
		aktiv: stuecke[0].public_id,
		aufWahl: (pid) => {
			avesmapsPowerlineCurveVorschau.aktiv = pid;
			zeichneNeu();
		},
		aufAenderung: (pid, wert) => {
			werte[pid] = wert;
			zeichneNeu();
		},
		aufFertig: (ergebnis) => {
			// 🔴 Die Vorschau wird IMMER zurueckgenommen, auch wenn gleich gespeichert wird: sie ist
			// ein fluechtiger Zustand, und einer, der ueber das Fenster hinaus lebt, ist genau die
			// Stoerung („meine Aenderung kommt nicht an"), die dieses Projekt schon bezahlt hat.
			avesmapsPowerlineCurveVorschau.werte = null;
			avesmapsPowerlineCurveVorschau.aktiv = null;
			if (karteEl) { karteEl.removeEventListener("click", beiKartenklick, true); }
			setzeModus(vorherigerModus);
			overlay.hidden = false;
			document.body.style.overflow = "hidden";
			zeichneNeu();
			const frame = overlay.querySelector("iframe");
			if (frame && frame.contentWindow) {
				try {
					frame.contentWindow.postMessage({ avesmapsPowerlineCurveResult: ergebnis }, location.origin);
				} catch (e) { /* noop */ }
			}
		},
	});
	return true;
};

// Der Editor meldet seine Kurven-Aenderungen hierher -- LIVE beim Ziehen und noch einmal nach dem
// Speichern. Owner 29.08.2026: „die aenderungen am kurven parameter muessen auf der karte sichtbar
// werden und gespeichert werden".
//
// 💣 ZWEI Faelle, und ihre Verwechslung waere die teure: eine VORSCHAU ist fluechtig (sie liegt in
// avesmapsPowerlineCurveVorschau und wird beim Schliessen zurueckgenommen), ein GESPEICHERTER Wert
// gehoert dauerhaft in die Kartendaten (properties.curve). Landete Gespeichertes nur in der
// Vorschau, waere die Kurve nach dem Schliessen des Editors wieder weg -- und der Owner haette
// gespeichert und saehe nichts. Landete eine Vorschau in den Kartendaten, stuende ein nie
// gespeicherter Wert auf der Karte, bis jemand neu laedt.
window.addEventListener("message", (event) => {
	if (event.origin !== location.origin) { return; }
	const kurven = event.data && event.data.avesmapsPowerlineCurvePreview;
	if (!kurven || typeof kurven !== "object") { return; }
	const gespeichert = event.data.avesmapsPowerlineCurveGespeichert === true;

	if (gespeichert) {
		// Dauerhaft in die Kartendaten -- ohne Neuladen, die Zahlen stehen ja schon in der Datenbank.
		if (typeof powerlineData !== "undefined" && Array.isArray(powerlineData)) {
			powerlineData.forEach((pl) => {
				const pid = String(pl?.properties?.public_id || pl?.id || "");
				if (pid && Object.prototype.hasOwnProperty.call(kurven, pid)) {
					const wert = Number(kurven[pid]);
					if (Number.isFinite(wert)) { pl.properties.curve = wert; }
				}
			});
		}
		// ⚠️ Und die Vorschau faellt: sonst laege ein fluechtiger Wert ueber dem gespeicherten und
		// die naechste Aenderung von aussen (Sync, zweiter Editor) waere unsichtbar.
		avesmapsPowerlineCurveVorschau.werte = null;
	} else {
		avesmapsPowerlineCurveVorschau.werte = Object.assign({}, kurven);
	}
	if (typeof refreshPowerlineLayers === "function") { refreshPowerlineLayers(); }
}, false);

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
	const groups = avesmapsPowerlinePanelGroups();
	// Owner 22.08.2026: die Statistikzeile „N Segmente" ist entfallen, und mit ihr ihr Wirt
	// #powerline-sync-summary in index.html. Was diese Liste über sich sagt, sagt die
	// Bilanzzeile darunter (avesmapsListBalanceRender). Kein zweiter Erzeuger mehr.
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
		return '<div class="tree-item has-map-status region-sync__item powerline-sync__item" data-powerline-name="' + esc(g.name) + '"'
			+ ' title="Doppelklick: im Kraftlinienmodus auf diese Linie zoomen" style="cursor:pointer;">'
			+ '<span class="tree-item-name">' + esc(g.name) + '</span>'
			// Der Statuskreis. 🪤 Die Zeile trug `has-map-status` seit jeher, emittierte aber NIE
			// diesen Marker -- der Ring war damit fuer JEDE Kraftlinie leer, ein unmoeglicher
			// Zustand (eine Kraftlinie liegt per Definition auf der Karte). Aufgefallen erst,
			// als der Editor daneben einen richtigen zeigte. EIN Bauer fuer beide Oberflaechen:
			// avesmapsPowerlineStatusMarker (js/map-features/powerline-topology.js), das einzige
			// Modul, das BEIDE Dokumente laden.
			+ ((typeof avesmapsPowerlineStatusMarker === "function") ? avesmapsPowerlineStatusMarker(g.segments) : "")
			+ '<span class="tree-item-meta">' + esc(meta) + '</span>'
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
