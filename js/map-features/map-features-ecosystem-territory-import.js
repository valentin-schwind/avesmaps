/*
 * Landschaften -- „Grenze aus Territorien …" (Plan V7): eine Landschaftsfläche aus VORHANDENEN
 * Territoriengrenzen erzeugen, statt sie nachzuzeichnen.
 *
 * 🔴 KOPIE, NIE VERKNÜPFUNG. Die eingefügte Fläche ist ab dem Einfügen ein eigenständiges Objekt in
 * `ecosystem_area`. Sie merkt sich NICHT, aus welchen Territorien sie entstand, und sie folgt ihnen
 * NICHT, wenn dort jemand eine Grenze verschiebt. Das ist kein Versehen, sondern der Unterschied
 * zwischen den beiden Ebenen: eine politische Grenze IST eine Linie und wird verhandelt; ein Waldrand
 * ist keine Grenze, Wald läuft in Steppe aus (oekosystem-editor-verhalten.md §5). Eine mitwandernde
 * Landschaftsgrenze wäre eine stille Lüge -- der Wald zöge um, weil eine Baronie neu vermessen wurde.
 * Deshalb gibt es hier keine `source_territory_id` und keinen Zeiger irgendeiner Art.
 *
 * 🔴 POLITISCHE DATEIEN WERDEN GELESEN, NIE GESCHRIEBEN (Owner-Freigabe 2026-07-28 für den LESEweg).
 * Gelesen wird über `loadAllTerritoryGeometry()` -- denselben Helfer, den der Siedlungseditor benutzt
 * und den der Landschaften-Editor für „Liegt in" schon ruft. Geschrieben wird ausschliesslich über
 * `postEcosystemEdit`, also in die Landschaftstabellen.
 *
 * 💣 TERRITORIEN SIND ZOOM-GEBÄNDERT. Ein einzelner `?action=layer`-Aufruf liefert die meisten NICHT.
 * `loadAllTerritoryGeometry` fächert deshalb über Zoom 0..6 auf und entdoppelt nach
 * `territory_public_id`. Das sind SIEBEN Anfragen an den Politik-Layer, und CLAUDE.md verbietet, diesen
 * Endpunkt zu schleifen -- er hat einmal die PHP-Worker gesättigt und wie ein DB-Ausfall ausgesehen.
 * Der Fächer bleibt deshalb hinter dieser ausdrücklichen Aktion und läuft je Sitzung HÖCHSTENS EINMAL
 * (`importTerritories` hält das Ergebnis). Dieselbe Regel wie bei der Kachel „Zugehörigkeit rechnen“.
 *
 * 💣 DIE ENTDOPPLUNG BEHÄLT EINE GEOMETRIE JE GEBIET -- „erste Zoomstufe, die es zeigt, gewinnt".
 * Aggregat ODER roh, je nachdem was der Layer für dieses Gebiet zeigt; beide zugleich gibt dieser Weg
 * nicht her (Owner-Entscheid 2026-07-28: „nehmen, was der Layer zeigt"). Jede Zeile sagt deshalb,
 * welche es wurde („Außengrenze" bzw. „Grenze"), statt die Wahl vorzutäuschen.
 *
 * Drei Entscheidungen des Owners (2026-07-28), weil sie die Oberfläche bestimmen:
 *   1. Die EBENE fragt der Dialog, vorausgewählt ist „Derographische Region" -- politische Grenzen
 *      folgen oft derographischen, aber eben nicht immer, und das Menü wächst so um EINEN Eintrag
 *      statt um drei.
 *   2. Genommen wird, was der Layer zeigt (siehe oben).
 *   3. VEREINFACHT WIRD DANACH, im vorhandenen Dialog „Fläche vereinfachen". Er hat den Regler, die
 *      Vorschau und die Douglas-Peucker-Rechnung in KARTENkoordinaten schon; ihn hier nachzubauen wäre
 *      die zweite Fassung derselben Sache. Er geht nach dem Einfügen von selbst auf, weil eine
 *      importierte Grenze politische Vertex-Dichte mitbringt und genau das der Grund für V7 ist.
 */
(function initEcosystemTerritoryImport() {
	"use strict";

	// 🪤 NICHT `data-ecosystem-context-action`: darauf hört der Abfang-Handler in
	// map-features-ecosystem-context-action.js, der jeden Treffer als „neue Fläche zeichnen" behandelt.
	const MENU_ATTRIBUTE = "data-ecosystem-import-action";
	const MENU_ACTION = "import-territory";
	const OVERLAY_ELEMENT_ID = "ecosystem-import-overlay";
	const DIALOG_ELEMENT_ID = "ecosystem-import-dialog";
	// Owner-Entscheid: derographisch. Politische Grenzen folgen am ehesten der Landgliederung.
	const DEFAULT_IMPORT_KIND = "derographisch";
	// 🔴 round(…, 4) beim Schreiben. Gemessen (Hauptplan, V7-Zeile): 500 Flächen à 800 Ecken sind
	// 14,8 MB bei ungerundeten Koordinaten, die vierte Stelle halbiert das. Auf einer Karte von 1024
	// Einheiten Breite liegt 0,0001 weit unter allem, was ein Zoom je zeigt.
	const IMPORT_COORDINATE_DIGITS = 4;

	let importBound = false;
	let importBusy = false;
	// Der Fächer über Zoom 0..6, je Sitzung höchstens einmal. null = noch nie geholt.
	let importTerritories = null;
	// Das laufende Versprechen desselben Fächers. Zweimal öffnen, während er läuft, darf ihn nicht ein
	// zweites Mal auslösen -- das wären vierzehn Anfragen an den Endpunkt, den CLAUDE.md zu schleifen
	// verbietet.
	let importTerritoriesPromise = null;
	let importTerritoryById = new Map();
	let importRows = [];
	let importDescendants = new Map();
	let importSelection = new Set();
	let importPreviewLayer = null;
	// 💣 Gesetzt, wenn `create_region` geklappt hat und `create_area` nicht. Ohne das legte jeder erneute
	// Versuch eine WEITERE leere Region an -- dieselbe Falle, die „Senden an …" dokumentiert.
	let importCreatedRegion = null;

	function label(key, german) {
		return typeof tr === "function" ? tr(key, german) : german;
	}

	function say(message, tone) {
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(message, tone);
		}
	}

	// Attrappen statt Politik-Layer. Es gibt keine lokale Datenbank und keinen lokalen Politik-Endpunkt,
	// also ist das der einzige Weg, Baum, Häkchen, Vereinigung und Vorschau vor dem Deploy im Browser zu
	// prüfen -- derselbe Behelf wie im Landschaften- und im Kraftlinien-Editor.
	function isTerritoryImportDemo() {
		return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo");
	}

	// ---- reine Helfer (unit-getestet) ----------------------------------------------------------------

	// 💣 DER TERRITORIUMSNAME TRÄGT SEINEN RANG SCHON. Am Live-Layer gemessen: 713 von 945 Namen beginnen
	// mit ihrem exakten `territory_type`, der Rest sind selbsterklärende Vollnamen („Alanfanisches
	// Imperium"). Ein vorangestellter Typ ergäbe „Baronie Baronie Schneehag". Der Typ wird deshalb NUR
	// angehängt, wo der Name ihn wirklich nicht trägt -- „Thorwal (Reich)". Verglichen wird am Kopfnomen,
	// damit „Herzogliche Baronie" von „Baronie Herzoglich Waldleuen" als getragen gilt.
	// Wortgleich zu territoryLabel() in html/landschaften-editor.html: dieselbe Regel, zwei Fenster.
	function territoryImportLabel(territory) {
		const name = String(territory?.name || "").trim();
		const type = String(territory?.type || "").trim();
		if (name === "" || type === "") {
			return name || type;
		}
		const head = type.split(/[\s,]+/).filter(Boolean).pop() || type;

		return name.toLowerCase().includes(head.toLowerCase()) ? name : `${name} (${type})`;
	}

	// Die Hierarchie kommt aus `parent_public_id`. Eine WAISE -- ein Elternteil, das in der Antwort des
	// Fächers gar nicht vorkommt -- wird zur Wurzel statt zu verschwinden: die Zoom-Bänderung kann ein
	// Elternteil weglassen, und ein Gebiet, das man auswählen könnte, darf daran nicht scheitern.
	function buildTerritoryImportRows(territories) {
		const byId = new Map();
		(Array.isArray(territories) ? territories : []).forEach((territory) => {
			const publicId = String(territory?.publicId || "").trim();
			if (publicId !== "" && !byId.has(publicId)) {
				byId.set(publicId, territory);
			}
		});

		const childrenByParent = new Map();
		const roots = [];
		byId.forEach((territory, publicId) => {
			const parentId = String(territory?.parentId || "").trim();
			if (parentId !== "" && parentId !== publicId && byId.has(parentId)) {
				const siblings = childrenByParent.get(parentId) || [];
				siblings.push(publicId);
				childrenByParent.set(parentId, siblings);
				return;
			}
			roots.push(publicId);
		});

		const labelOf = (publicId) => territoryImportLabel(byId.get(publicId));
		const byLabel = (left, right) => labelOf(left).localeCompare(labelOf(right), "de");
		roots.sort(byLabel);
		childrenByParent.forEach((children) => children.sort(byLabel));

		const rows = [];
		const visited = new Set();
		const walk = (publicId, depth, parentId) => {
			// 💣 Zyklenwächter. Ein auf sich selbst zeigendes Elternteil ist ein Datenfehler, kein Grund,
			// den Browser hängen zu lassen.
			if (visited.has(publicId)) {
				return;
			}
			visited.add(publicId);
			const children = childrenByParent.get(publicId) || [];
			rows.push({
				publicId,
				label: labelOf(publicId),
				depth,
				parentId,
				childIds: children.slice(),
				isAggregate: byId.get(publicId)?.isAggregate === true,
			});
			children.forEach((childId) => walk(childId, depth + 1, publicId));
		};
		roots.forEach((publicId) => walk(publicId, 0, ""));
		// Was jetzt noch fehlt, sass in einem Zyklus. Flach angehängt statt weggelassen -- unauffindbar
		// wäre schlimmer als falsch eingerückt.
		byId.forEach((_, publicId) => walk(publicId, 0, ""));

		return rows;
	}

	// publicId -> alle Nachfahren. Einmal beim Aufbau gerechnet, weil das Anhaken eines Herzogtums sonst
	// bei jedem Klick den halben Baum absteigen müsste.
	function territoryImportDescendants(rows) {
		const childIdsById = new Map((Array.isArray(rows) ? rows : []).map((row) => [row.publicId, row.childIds || []]));
		const result = new Map();
		const collect = (publicId, seen) => {
			if (result.has(publicId)) {
				return result.get(publicId);
			}
			const out = [];
			(childIdsById.get(publicId) || []).forEach((childId) => {
				if (seen.has(childId)) {
					return;
				}
				seen.add(childId);
				out.push(childId, ...collect(childId, seen));
			});
			result.set(publicId, out);
			return out;
		};
		childIdsById.forEach((_, publicId) => collect(publicId, new Set([publicId])));

		return result;
	}

	// Welche Zeilen die Suche zeigt. Ein Treffer zieht seine VORFAHREN mit -- eine Baumzeile ohne ihre
	// Eltern stünde in einer Einrückung, die nichts mehr bedeutet.
	function territoryImportVisibleRows(rows, query) {
		const list = Array.isArray(rows) ? rows : [];
		const needle = String(query || "").trim().toLowerCase();
		if (needle === "") {
			return list.slice();
		}

		const parentById = new Map(list.map((row) => [row.publicId, row.parentId]));
		const keep = new Set();
		list.forEach((row) => {
			if (!String(row.label || "").toLowerCase().includes(needle)) {
				return;
			}
			keep.add(row.publicId);
			let parentId = parentById.get(row.publicId) || "";
			while (parentId !== "" && !keep.has(parentId)) {
				keep.add(parentId);
				parentId = parentById.get(parentId) || "";
			}
		});

		return list.filter((row) => keep.has(row.publicId));
	}

	// Nur Formen, die `create_area` annimmt. Der Server prüft richtig
	// (avesmapsEcosystemNormalizeGeometry); das hier steht, damit eine unbrauchbare Zeile einen Satz im
	// Dialog ergibt statt einer 400 von der Leitung.
	function isUsableImportGeometry(geometry) {
		const type = String(geometry?.type || "");

		return (type === "Polygon" || type === "MultiPolygon")
			&& Array.isArray(geometry?.coordinates)
			&& geometry.coordinates.length > 0;
	}

	// Die gewählten Grenzen zu EINER Geometrie. Getrennt liegende Gebiete ergeben ein MultiPolygon --
	// `create_area` nimmt das an (api/_internal/app/ecosystem.php:346), und eine Fläche mit Inseln ist
	// genau das, was „Bilku-Archipel" braucht.
	//
	// 🪤 Ein angehaktes Elternteil macht seine angehakten Kinder NICHT überflüssig. Das wäre nur wahr,
	// wenn das Elternteil sein Aggregat zeigte -- zeigt der Layer für dieses Gebiet die rohe Geometrie,
	// kann ein Kind darüber hinausragen. Vereinigt wird deshalb ALLES Gewählte; 120 Territorien sind
	// gemessene 47,7 ms, das ist kein Grund für eine Abkürzung, die manchmal falsch ist.
	//
	// 💣 Tief kopiert, bevor irgendetwas damit geschieht. Die Quellgeometrie gehört dem Politik-Layer;
	// eine geteilte Referenz ist der Weg, auf dem „die Kopie wanderte mit" entsteht.
	function unionTerritoryImportGeometries(entries) {
		const usable = (Array.isArray(entries) ? entries : []).filter((entry) => isUsableImportGeometry(entry?.geometry));
		if (usable.length === 0) {
			throw new Error("Keine der gewählten Grenzen hat eine brauchbare Geometrie.");
		}

		let result = JSON.parse(JSON.stringify(usable[0].geometry));
		for (let index = 1; index < usable.length; index += 1) {
			try {
				result = ecosystemBooleanGeometry("union", result, usable[index].geometry);
			} catch (error) {
				// 💣 `ecosystemBooleanGeometry` WIRFT bei leerem Ergebnis. Bei einer Vereinigung ist das
				// kein Normalfall -- aber es darf nicht als „das Einfügen ging nicht" ankommen, sondern
				// muss sagen, welche Grenze es war.
				throw new Error(`„${String(usable[index].label || "")}“ ließ sich nicht vereinigen: ${error?.message || "unbekannter Fehler"}`);
			}
		}

		return result;
	}

	// Ein Ring auf vier Nachkommastellen. Aufeinanderfolgende Dubletten fliegen raus -- Runden kann zwei
	// Ecken auf dieselbe Stelle legen -- und der Ringschluss wird danach neu gesetzt. Unter drei Ecken
	// gibt es kein Polygon mehr; ein solcher Ring wird verworfen statt geschrieben.
	function roundImportRing(ring, round) {
		const out = [];
		(Array.isArray(ring) ? ring : []).forEach((position) => {
			const x = round(Array.isArray(position) ? position[0] : NaN);
			const y = round(Array.isArray(position) ? position[1] : NaN);
			if (!Number.isFinite(x) || !Number.isFinite(y)) {
				return;
			}
			const last = out[out.length - 1];
			if (last && last[0] === x && last[1] === y) {
				return;
			}
			out.push([x, y]);
		});
		while (out.length >= 2 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) {
			out.pop();
		}
		if (out.length < 3) {
			return null;
		}
		out.push(out[0].slice());

		return out;
	}

	function roundImportGeometry(geometry, digits = IMPORT_COORDINATE_DIGITS) {
		const factor = 10 ** Math.max(0, Number(digits) || 0);
		const round = (value) => Math.round(Number(value) * factor) / factor;
		const parts = (typeof ecosystemGeometryParts === "function" ? ecosystemGeometryParts(geometry) : [])
			.map((part) => {
				const rings = (Array.isArray(part) ? part : []).map((ring) => roundImportRing(ring, round));
				// 💣 Stirbt der ÄUSSERE Ring, stirbt der ganze Teil. Sonst rückte ein Loch an seine Stelle
				// und aus einer Lichtung würde ein Wald.
				return rings[0] ? rings.filter(Boolean) : null;
			})
			.filter(Boolean);
		if (parts.length === 0) {
			throw new Error("Nach dem Runden bleibt keine Fläche übrig.");
		}

		return parts.length === 1
			? { type: "Polygon", coordinates: parts[0] }
			: { type: "MultiPolygon", coordinates: parts };
	}

	// Was die Statuszeile sagt: Zahl der Gebiete, Teile, Ecken -- und die Nutzlast, weil sie der Grund
	// für das Vereinfachen ist und eine Zahl mehr überzeugt als eine Mahnung.
	function formatImportSummary(selectedCount, geometry, byteLength) {
		if (selectedCount <= 0) {
			return "Nichts gewählt — häkchen Sie ein Gebiet an.";
		}
		if (!geometry) {
			return `${selectedCount} Gebiet${selectedCount === 1 ? "" : "e"} gewählt.`;
		}

		const parts = typeof ecosystemGeometryParts === "function" ? ecosystemGeometryParts(geometry).length : 1;
		const points = countImportGeometryPoints(geometry);
		const kilobytes = Number(byteLength) > 0 ? ` · ≈ ${(Number(byteLength) / 1024).toFixed(1)} KB` : "";

		return `${selectedCount} Gebiet${selectedCount === 1 ? "" : "e"} · ${parts} Teil${parts === 1 ? "" : "e"} · ${points} Ecken${kilobytes}`;
	}

	// Aus dem Vereinfachen-Modul, wo dieselbe Zählung schon steht. Der Rückfall ist da, weil die Zahl
	// auch dann stimmen soll, wenn dieses Modul einmal vor jenem geladen wird.
	function countImportGeometryPoints(geometry) {
		if (typeof window !== "undefined" && typeof window.AvesmapsEcosystemSimplify?.countGeometryPoints === "function") {
			return window.AvesmapsEcosystemSimplify.countGeometryPoints(geometry);
		}
		const parts = typeof ecosystemGeometryParts === "function" ? ecosystemGeometryParts(geometry) : [];

		return parts.reduce(
			(sum, part) => sum + (part || []).reduce((inner, ring) => inner + Math.max(0, (ring || []).length - 1), 0),
			0
		);
	}

	// ---- Territorien holen ---------------------------------------------------------------------------

	// Dieselbe Umformung, die der Landschaften-Editor für „Liegt in" macht -- eine flache Zeile je Gebiet
	// statt der GeoJSON-Merkmalshülle.
	function toImportTerritory(entry) {
		const properties = entry?.feature?.properties || {};
		const geometry = entry?.feature?.geometry || null;

		return {
			publicId: String(properties.territory_public_id || "").trim(),
			name: String(properties.name || properties.display_name || ""),
			type: String(properties.territory_type || properties.feature_subtype || ""),
			parentId: String(properties.parent_public_id || "").trim(),
			isAggregate: properties.is_aggregate === true,
			geometry,
		};
	}

	async function loadTerritoriesForImport() {
		if (Array.isArray(importTerritories)) {
			return importTerritories;
		}
		if (importTerritoriesPromise) {
			return importTerritoriesPromise;
		}
		if (isTerritoryImportDemo()) {
			importTerritories = territoryImportDemoTerritories();
			return importTerritories;
		}
		if (typeof loadAllTerritoryGeometry !== "function") {
			throw new Error("Das Territorien-Modul ist nicht geladen.");
		}

		importTerritoriesPromise = (async () => {
			const entries = await loadAllTerritoryGeometry();
			const territories = entries
				.map(toImportTerritory)
				.filter((territory) => territory.publicId !== "" && isUsableImportGeometry(territory.geometry));

			// 🪤 EIN LEERES ERGEBNIS WIRD NICHT GEMERKT. `loadAllTerritoryGeometry` fängt den Fehlschlag je
			// Zoomstufe ab und liefert dann eine leere Liste statt zu werfen -- ein weggebrochener Endpunkt
			// sieht also aus wie „es gibt keine Territorien". Gemerkt zementierte das den Ausfall für die
			// ganze Sitzung, und ein erneuter Versuch bekäme wieder nichts, ohne je gefragt zu haben.
			if (territories.length > 0) {
				importTerritories = territories;
			}

			return territories;
		})();

		try {
			return await importTerritoriesPromise;
		} finally {
			importTerritoriesPromise = null;
		}
	}

	// ---- Vorschau auf der Karte ----------------------------------------------------------------------

	function clearImportPreview() {
		if (importPreviewLayer && typeof map !== "undefined" && map && map.hasLayer(importPreviewLayer)) {
			map.removeLayer(importPreviewLayer);
		}
		importPreviewLayer = null;
	}

	// GeoJSON speichert [x, y], L.CRS.Simple nutzt [lat, lng] = [y, x] (AGENTS.md §5). Bewusst getauscht,
	// und nur hier.
	function importGeometryToLatLngs(geometry) {
		const parts = typeof ecosystemGeometryParts === "function" ? ecosystemGeometryParts(geometry) : [];

		return parts.map((part) => (part || []).map((ring) => (ring || []).map(([x, y]) => [y, x])));
	}

	function renderImportPreview(geometry) {
		clearImportPreview();
		if (!geometry || typeof map === "undefined" || !map || typeof L === "undefined") {
			return;
		}

		// Dieselbe Pane und dieselbe Farbe wie die Vorschau des Vereinfachen-Dialogs: der Editor sieht
		// zweimal dasselbe Signal für „so sähe es aus".
		importPreviewLayer = L.polygon(importGeometryToLatLngs(geometry), {
			pane: "measurementPane",
			color: getComputedStyle(document.documentElement).getPropertyValue("--color-marker-active").trim(),
			weight: 2,
			opacity: 0.95,
			fillOpacity: 0.2,
			interactive: false,
		}).addTo(map);
	}

	// ---- der Dialog ----------------------------------------------------------------------------------

	function importElement(suffix) {
		return document.getElementById(`ecosystem-import-${suffix}`);
	}

	function isTerritoryImportDialogOpen() {
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);

		return Boolean(overlayElement) && !overlayElement.hidden;
	}

	function setImportError(message) {
		const errorElement = importElement("error");
		if (!errorElement) {
			return;
		}
		errorElement.textContent = String(message || "");
		errorElement.hidden = !message;
	}

	function setImportStatus(message) {
		const statusElement = importElement("status");
		if (statusElement) {
			statusElement.textContent = String(message || "");
		}
	}

	function selectedImportEntries() {
		return importRows
			.filter((row) => importSelection.has(row.publicId))
			.map((row) => ({ label: row.label, geometry: importTerritoryById.get(row.publicId)?.geometry || null }));
	}

	// Auswahl -> Vereinigung -> Vorschau -> Statuszeile. Eine Stelle, damit Karte, Zahl und Knopf nie
	// auseinanderlaufen können.
	function syncImportSelection() {
		const entries = selectedImportEntries();
		const saveButton = importElement("save");
		setImportError("");

		if (entries.length === 0) {
			renderImportPreview(null);
			setImportStatus(formatImportSummary(0, null, 0));
			if (saveButton) {
				saveButton.disabled = true;
			}
			return;
		}

		try {
			const rounded = roundImportGeometry(unionTerritoryImportGeometries(entries));
			renderImportPreview(rounded);
			setImportStatus(formatImportSummary(entries.length, rounded, JSON.stringify(rounded).length));
			if (saveButton) {
				saveButton.disabled = false;
			}
		} catch (error) {
			renderImportPreview(null);
			setImportStatus(formatImportSummary(entries.length, null, 0));
			setImportError(error?.message || "Die gewählten Grenzen ließen sich nicht vereinigen.");
			if (saveButton) {
				saveButton.disabled = true;
			}
		}
	}

	// Ein Häkchen nimmt seinen ganzen Teilbaum mit: „nimm das Herzogtum" heisst das Herzogtum UND seine
	// Baronien, und ob der Layer für das Herzogtum ein Aggregat zeigt, weiss der Editor nicht.
	function setImportRowChecked(publicId, checked) {
		const affected = [publicId, ...(importDescendants.get(publicId) || [])];
		affected.forEach((id) => {
			if (checked) {
				importSelection.add(id);
			} else {
				importSelection.delete(id);
			}
		});
	}

	// Häkchen und Teilzustand aller sichtbaren Zeilen nachziehen. `indeterminate` lässt sich nur über die
	// Eigenschaft setzen, nicht über ein Attribut -- deshalb je Zeile und nicht über CSS.
	function syncImportCheckboxes() {
		const listElement = importElement("list");
		if (!listElement) {
			return;
		}
		listElement.querySelectorAll("input[type=checkbox][data-territory]").forEach((checkbox) => {
			const publicId = checkbox.getAttribute("data-territory") || "";
			const descendants = importDescendants.get(publicId) || [];
			checkbox.checked = importSelection.has(publicId);
			checkbox.indeterminate = !checkbox.checked && descendants.some((id) => importSelection.has(id));
		});
	}

	function renderImportTree() {
		const listElement = importElement("list");
		if (!listElement) {
			return;
		}

		const visible = territoryImportVisibleRows(importRows, importElement("filter")?.value);
		listElement.innerHTML = "";
		if (visible.length === 0) {
			const empty = document.createElement("p");
			empty.className = "ecosystem-import-dialog__empty";
			// „Nichts geladen" heisst fast immer „der Politik-Layer hat nicht geantwortet", nicht „es gibt
			// keine Territorien" -- gesagt wird deshalb beides, samt der Aufforderung, es noch einmal zu
			// versuchen (der Fächer läuft dann wirklich noch einmal, siehe loadTerritoriesForImport).
			empty.textContent = importRows.length === 0
				? label("ecosystem.import.emptyAll", "Es wurden keine Territorien geladen — der Politik-Layer hat nichts geliefert. Bitte noch einmal versuchen.")
				: label("ecosystem.import.emptyFilter", "Kein Gebiet passt zu dieser Suche.");
			listElement.appendChild(empty);
			return;
		}

		const fragment = document.createDocumentFragment();
		visible.forEach((row) => {
			const rowElement = document.createElement("label");
			rowElement.className = "ecosystem-import-dialog__row";
			// Einrückung über eine Custom Property statt über einen festen Wert im Markup: den Schritt
			// bestimmt das Token im CSS, nicht diese Datei (AGENTS.md §12).
			rowElement.style.setProperty("--import-depth", String(row.depth));

			const checkbox = document.createElement("input");
			checkbox.type = "checkbox";
			checkbox.setAttribute("data-territory", row.publicId);

			const name = document.createElement("span");
			name.className = "ecosystem-import-dialog__rowname";
			name.textContent = row.label;

			const meta = document.createElement("span");
			meta.className = "ecosystem-import-dialog__rowmeta";
			// 💣 Gesagt, nicht verschwiegen: welche Geometrie der Layer für dieses Gebiet hergibt, ist
			// nicht wählbar (siehe Kopf) -- also steht wenigstens da, welche es ist.
			meta.textContent = row.isAggregate
				? label("ecosystem.import.aggregate", "Außengrenze")
				: label("ecosystem.import.raw", "Grenze");

			rowElement.append(checkbox, name, meta);
			fragment.appendChild(rowElement);
		});
		listElement.appendChild(fragment);
		syncImportCheckboxes();
	}

	function renderImportKindOptions() {
		const kindSelect = importElement("kind");
		if (!kindSelect) {
			return;
		}

		const kinds = typeof ECOSYSTEM_KINDS !== "undefined" ? ECOSYSTEM_KINDS : [DEFAULT_IMPORT_KIND];
		kindSelect.innerHTML = "";
		kinds.forEach((kind) => {
			const kindLabel = (typeof ECOSYSTEM_KIND_LABELS !== "undefined" && ECOSYSTEM_KIND_LABELS?.[kind]) || String(kind);
			kindSelect.appendChild(new Option(kindLabel, kind));
		});
		kindSelect.value = kinds.includes(DEFAULT_IMPORT_KIND) ? DEFAULT_IMPORT_KIND : String(kinds[0] || "");
	}

	// Der Eintrag sitzt in „Hier hinzufügen", also muss „hier" etwas bedeuten: das TIEFSTE Gebiet unter
	// dem Klickpunkt ist vorausgehakt. Bei 945 Gebieten ist das der Unterschied zwischen „anhaken" und
	// „suchen". Nichts getroffen heisst nichts vorausgewählt -- kein Ratespiel.
	function preselectTerritoryAt(latlng) {
		if (!latlng || typeof pointInGeometry !== "function") {
			return;
		}

		const point = [Number(latlng.lng), Number(latlng.lat)];
		if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
			return;
		}
		const depthById = new Map(importRows.map((row) => [row.publicId, row.depth]));
		let best = null;
		importRows.forEach((row) => {
			const geometry = importTerritoryById.get(row.publicId)?.geometry;
			if (!geometry || !pointInGeometry(point, geometry)) {
				return;
			}
			if (!best || (depthById.get(row.publicId) || 0) > (depthById.get(best) || 0)) {
				best = row.publicId;
			}
		});
		if (best) {
			// Ohne den Teilbaum: unter dem Cursor lag EIN Gebiet, nicht seine Untergliederung.
			importSelection.add(best);
		}
	}

	async function openTerritoryImportDialog(latlng) {
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		if (!overlayElement) {
			return;
		}
		if (typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE
			|| typeof IS_ECOSYSTEM_ENABLED === "undefined" || !IS_ECOSYSTEM_ENABLED) {
			return;
		}

		bindTerritoryImportDialog();
		importCreatedRegion = null;
		importSelection = new Set();
		importRows = [];
		importDescendants = new Map();
		renderImportKindOptions();
		const filterInput = importElement("filter");
		if (filterInput) {
			filterInput.value = "";
		}
		setImportError("");
		const demoNote = importElement("demo");
		if (demoNote) {
			demoNote.hidden = !isTerritoryImportDemo();
		}
		const saveButton = importElement("save");
		if (saveButton) {
			saveButton.disabled = true;
		}
		overlayElement.hidden = false;

		// 💣 Der Fächer läuft HIER und nur hier -- hinter einer ausdrücklichen Aktion, je Sitzung einmal.
		const alreadyLoaded = Array.isArray(importTerritories);
		setImportStatus(alreadyLoaded ? "" : label("ecosystem.import.loading", "Territorien werden geladen — das sind sieben Anfragen, es dauert einen Moment …"));
		try {
			const territories = await loadTerritoriesForImport();
			if (!isTerritoryImportDialogOpen()) {
				return;
			}
			importTerritoryById = new Map(territories.map((territory) => [territory.publicId, territory]));
			importRows = buildTerritoryImportRows(territories);
			importDescendants = territoryImportDescendants(importRows);
			preselectTerritoryAt(latlng);
			renderImportTree();
			syncImportSelection();
		} catch (error) {
			console.error("Territorien konnten nicht geladen werden:", error);
			setImportStatus("");
			setImportError(error?.message || "Die Territorien konnten nicht geladen werden.");
			return;
		}

		// 💣 Verzögert. Das hier läuft in einem Klick-Handler der CAPTURE-Phase, der Browser stellt den
		// Klick also noch zu -- ein hier gesetzter Fokus kann auf dem Rückweg wieder weggenommen werden.
		// setTimeout und nicht requestAnimationFrame: rAF feuert in einem versteckten Reiter nicht, und
		// genau dort wird geprüft.
		window.setTimeout(() => {
			if (isTerritoryImportDialogOpen()) {
				(importElement("filter") || document.getElementById(DIALOG_ELEMENT_ID))?.focus();
			}
		}, 0);
	}

	function closeTerritoryImportDialog() {
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		if (!overlayElement || overlayElement.hidden) {
			return;
		}
		overlayElement.hidden = true;
		clearImportPreview();
		importSelection = new Set();
		importCreatedRegion = null;
	}

	// ---- Einfügen ------------------------------------------------------------------------------------

	// Die Karte auf die neue Fläche stellen, BEVOR nachgeladen wird. Der Flächenlader fragt mit der
	// Bounding Box des Ausschnitts (map-features-ecosystem-loader.js:32) -- eine Fläche ausserhalb käme
	// gar nicht erst in die Registry, und der Vereinfachen-Dialog danach fände sie nicht.
	// `animate: false`, damit `map.getBounds()` gleich danach schon den Zielausschnitt liefert.
	function frameImportedArea(geometry) {
		const bounds = typeof ecosystemGeometryBounds === "function" ? ecosystemGeometryBounds(geometry) : null;
		// 💣 snake_case, wie das `bounds`-Feld der API -- als {minX, …} gelesen ergäbe es lautlos NaN.
		if (!bounds || typeof map === "undefined" || !map || typeof L === "undefined") {
			return;
		}
		map.fitBounds(L.latLngBounds([bounds.min_y, bounds.min_x], [bounds.max_y, bounds.max_x]).pad(0.1), { animate: false });
	}

	async function submitTerritoryImport(event) {
		event?.preventDefault();
		if (importBusy) {
			return;
		}

		const kind = String(importElement("kind")?.value || "");
		const entries = selectedImportEntries();
		if (entries.length === 0) {
			setImportError("Bitte mindestens ein Gebiet anhaken.");
			return;
		}
		if (typeof ECOSYSTEM_KINDS !== "undefined" && !ECOSYSTEM_KINDS.includes(kind)) {
			setImportError("Bitte eine Ebene wählen.");
			return;
		}

		let geometry;
		try {
			geometry = roundImportGeometry(unionTerritoryImportGeometries(entries));
		} catch (error) {
			setImportError(error?.message || "Die gewählten Grenzen ließen sich nicht vereinigen.");
			return;
		}

		const saveButton = importElement("save");
		importBusy = true;
		setImportError("");
		if (saveButton) {
			saveButton.disabled = true;
			saveButton.textContent = label("ecosystem.import.saving", "Wird eingefügt …");
		}

		try {
			// 🔴 EIGENE REGION JE FLÄCHE (oekosystem-editor-verhalten.md §4). Sonst trüge sie den Namen
			// einer fremden, und ein Umbenennen träfe beide.
			// Auto-Name und noch keine Art -- genau wie beim Zeichnen; die Art kommt im
			// Eigenschaften-Dialog, und der Griff zieht dann nach.
			const name = typeof ecosystemDraftRegionName === "function" ? ecosystemDraftRegionName() : "Neue Fläche";
			let regionPublicId = String(importCreatedRegion?.publicId || "");
			if (regionPublicId === "" || importCreatedRegion?.kind !== kind) {
				// 🔴 Kein `wiki_url`: die Fläche entsteht aus Grenzen, nicht aus einem Wiki-Artikel. Und
				// kein `wiki_region_key` -- den leitet der Server aus `wiki_url` ab, der Client schickt nie
				// einen (Instruction §4.3).
				const created = await postEcosystemEdit("create_region", { kind, name, region_type: "" });
				regionPublicId = String(created?.region?.public_id || "");
				if (regionPublicId === "") {
					throw new Error("Die Region für die neue Fläche konnte nicht angelegt werden.");
				}
				importCreatedRegion = { kind, publicId: regionPublicId, name: String(created?.region?.name || name) };
			}

			const saved = await postEcosystemEdit("create_area", {
				region_public_id: regionPublicId,
				geometry_geojson: geometry,
			});
			const areaPublicId = String(saved?.area?.public_id || "");
			const regionName = String(importCreatedRegion?.name || name);
			importCreatedRegion = null;
			closeTerritoryImportDialog();
			say(`Grenze übernommen — Region „${regionName}“ mit ${countImportGeometryPoints(geometry)} Ecken.`);

			// 🪤 AB HIER IST GESCHRIEBEN, und das Fenster ist zu. Ein Fehlschlag dahinter darf deshalb NICHT
			// mehr in die Fehlerzeile des Dialogs laufen -- die sähe niemand mehr. Er ist auch kein
			// Fehlschlag des Einfügens: die Fläche steht. Also ein Hinweis, und der Rest läuft weiter.
			await settleImportedArea(kind, geometry, regionPublicId, regionName, areaPublicId);
		} catch (error) {
			console.error("Die Grenze konnte nicht übernommen werden:", error);
			setImportError(importCreatedRegion
				? `${error?.message || "Die Grenze konnte nicht übernommen werden."} Die Region wurde bereits angelegt — ein erneuter Versuch legt die Fläche dort hinein.`
				: (error?.message || "Die Grenze konnte nicht übernommen werden."));
		} finally {
			importBusy = false;
			if (saveButton) {
				saveButton.disabled = false;
				saveButton.textContent = label("ecosystem.import.save", "Einfügen");
			}
		}
	}

	// Was NACH dem Schreiben passiert: Label, Ebene, Ausschnitt, Nachladen, Auswahl -- und zum Schluss der
	// Vereinfachen-Dialog. Jeder dieser Schritte darf scheitern, ohne dass die geschriebene Fläche in
	// Frage steht; gesagt wird es trotzdem, als Hinweis statt als Fehler.
	async function settleImportedArea(kind, geometry, regionPublicId, regionName, areaPublicId) {
		try {
			// Wie beim Zeichnen: jede Region bekommt ihr Karten-Label (Owner 2026-07-27). Das Modul fängt
			// seinen eigenen Fehlschlag ab und sagt ihn -- die FLÄCHE bleibt in jedem Fall stehen.
			if (typeof createEcosystemRegionLabel === "function") {
				await createEcosystemRegionLabel(regionPublicId, geometry, regionName, true, "");
			}
			await enterImportedArea(kind, geometry, areaPublicId);
		} catch (error) {
			console.error("Nach dem Einfügen ist etwas schiefgegangen:", error);
			say("Die Fläche ist angelegt, aber die Karte konnte nicht nachgezogen werden. Bitte neu laden.", "warning");
			return;
		}

		// 🔴 Owner-Entscheid 3: JETZT der vorhandene Vereinfachen-Dialog, nicht ein zweiter hier. Er zeigt
		// „vorher → nachher" und die Wirkung auf der Karte; eine importierte Grenze bringt politische
		// Vertex-Dichte mit, und die loszuwerden ist der Zweck von V7.
		if (areaPublicId && typeof window !== "undefined" && window.AvesmapsEcosystemSimplify?.open) {
			window.AvesmapsEcosystemSimplify.open(areaPublicId);
		}
	}

	// Ebene, Ausschnitt, Nachladen, Auswahl -- in dieser Reihenfolge. Die Ebene zuerst, weil das Umschalten
	// den Regionen-Bestand für die neue Ebene neu zieht; der Ausschnitt vor dem Nachladen, weil der Lader
	// nach Bounding Box fragt.
	async function enterImportedArea(kind, geometry, areaPublicId) {
		if (typeof setActiveEcosystemLayerKind === "function") {
			setActiveEcosystemLayerKind(kind);
		}
		if (typeof setSelectedMapLayerMode === "function"
			&& (typeof getSelectedMapLayerMode !== "function" || getSelectedMapLayerMode() !== "ecosystem")) {
			setSelectedMapLayerMode("ecosystem");
		}
		frameImportedArea(geometry);
		if (typeof loadEcosystemAreas === "function") {
			await loadEcosystemAreas();
		}
		if (typeof invalidateEcosystemRegionCache === "function") {
			invalidateEcosystemRegionCache();
		}
		if (areaPublicId && typeof setSelectedEcosystemArea === "function") {
			setSelectedEcosystemArea(areaPublicId);
		}
	}

	// ---- der Menüeintrag -----------------------------------------------------------------------------

	// Eingehängt, nicht ins Markup geschrieben: `#map-context-menu` in index.html gehört niemandem hier,
	// und map-features-ecosystem-context-action.js macht es für seine drei „Neue …"-Einträge genauso.
	function ensureImportMenuEntry() {
		const submenu = document.querySelector('.map-context-menu__group[data-context-action="add-here"] .map-context-submenu');
		if (!submenu || submenu.querySelector(`[${MENU_ATTRIBUTE}="${MENU_ACTION}"]`)) {
			return;
		}

		const button = document.createElement("button");
		button.type = "button";
		button.className = "map-context-menu__item";
		button.setAttribute(MENU_ATTRIBUTE, MENU_ACTION);
		button.hidden = true;
		button.textContent = label("ecosystem.ctxmenu.importTerritory", "Grenze aus Territorien …");

		// Hinter die drei „Neue …"-Einträge: es ist derselbe Vorgang („eine neue Fläche entsteht"), nur
		// mit einer anderen Herkunft der Ecken. Steht deren Modul noch nicht, landet der Eintrag hinter
		// „Neues Herrschaftsgebiet" -- beim nächsten Rechtsklick sitzt er ohnehin richtig.
		const siblings = submenu.querySelectorAll('[data-ecosystem-context-action="new-area"]');
		const anchor = siblings[siblings.length - 1] || submenu.querySelector('[data-context-action="create-region"]');
		if (anchor) {
			anchor.after(button);
			return;
		}
		submenu.appendChild(button);
	}

	// Läuft bei jedem Rechtsklick in der CAPTURE-Phase, also bevor Leaflets eigener Handler das Menü
	// aufdeckt und seine Höhe MISST (js/app/bootstrap.js:701) -- danach zu schalten hiesse, eine Höhe zu
	// klemmen, die nicht mehr stimmt. Dasselbe Tor wie bei den drei „Neue …"-Einträgen: der Eintrag ist
	// der Weg IN die Ebene, also fragt er nur, ob dieser Zugang sie überhaupt benutzen darf.
	function syncImportMenuEntry() {
		ensureImportMenuEntry();
		const visible = (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE)
			&& (typeof IS_ECOSYSTEM_ENABLED !== "undefined" && IS_ECOSYSTEM_ENABLED);
		document.querySelectorAll(`[${MENU_ATTRIBUTE}="${MENU_ACTION}"]`).forEach((button) => {
			button.hidden = !visible;
		});
	}

	function handleImportMenuClick(event) {
		const actionElement = event.target?.closest?.(`[${MENU_ATTRIBUTE}="${MENU_ACTION}"]`);
		if (!actionElement) {
			return false;
		}

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();

		// 💣 Die Stelle VOR dem Schliessen lesen -- closeMapContextMenu() nullt pendingContextMenuLatLng
		// (js/app/bootstrap.js:627).
		const latlng = typeof pendingContextMenuLatLng !== "undefined" && pendingContextMenuLatLng
			? L.latLng(pendingContextMenuLatLng)
			: null;
		if (typeof closeMapContextMenu === "function") {
			closeMapContextMenu();
		}
		void openTerritoryImportDialog(latlng);

		return true;
	}

	// ---- Verdrahtung ---------------------------------------------------------------------------------

	function bindTerritoryImportDialog() {
		if (importBound) {
			return;
		}
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		if (!overlayElement) {
			return;
		}

		importBound = true;
		importElement("close")?.addEventListener("click", closeTerritoryImportDialog);
		importElement("cancel")?.addEventListener("click", closeTerritoryImportDialog);
		importElement("form")?.addEventListener("submit", submitTerritoryImport);
		importElement("filter")?.addEventListener("input", renderImportTree);
		importElement("list")?.addEventListener("change", (event) => {
			const checkbox = event.target?.closest?.("input[type=checkbox][data-territory]");
			if (!checkbox) {
				return;
			}
			setImportRowChecked(checkbox.getAttribute("data-territory") || "", checkbox.checked);
			syncImportCheckboxes();
			syncImportSelection();
		});
		// 🪤 KEIN Klick-auf-den-Schleier-schliesst-Handler. Diese Hülle hat keinen Schleier: sie reicht
		// Zeiger durch (dialog-overlays.css), damit die Karte unter dem Fenster bedienbar bleibt und man
		// die Vorschau verschieben und zoomen kann. Ein Handler darauf wäre tot -- geschlossen wird über
		// „Abbrechen", das × und Escape.
		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && isTerritoryImportDialogOpen()) {
				// Gestoppt, damit nicht zusätzlich das Escape der Ebene die Auswahl fallen lässt -- ein
				// Fenster zu schliessen ist eine Geste, nicht zwei.
				event.stopPropagation();
				closeTerritoryImportDialog();
			}
		});
	}

	if (typeof document !== "undefined") {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", ensureImportMenuEntry, { once: true });
		} else {
			ensureImportMenuEntry();
		}

		// CAPTURE, und damit vor den delegierten jQuery-Handlern der Bubble-Phase (routing.js:637);
		// stopImmediatePropagation() ist das, was sie zusätzlich stillhält.
		document.addEventListener("click", (event) => {
			handleImportMenuClick(event);
		}, true);
		document.addEventListener("contextmenu", syncImportMenuEntry, true);
	}

	// ---- Attrappen (?demo=1) -------------------------------------------------------------------------
	// Sieben Gebiete, zwei Ebenen tief, eines davon als Aggregat gekennzeichnet und zwei getrennt
	// liegend, damit die Vereinigung auch ihren MultiPolygon-Fall zeigt. Nur der LESEweg ist Attrappe --
	// „Einfügen" schreibt auch hier echt und scheitert ohne Anmeldung mit dem Satz des Servers.
	function territoryImportDemoTerritories() {
		const box = (x1, y1, x2, y2) => ({
			type: "Polygon",
			coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]],
		});

		return [
			{ publicId: "demo-reich", name: "Mittelreich", type: "Reich", parentId: "", isAggregate: true, geometry: box(430, 500, 530, 600) },
			{ publicId: "demo-kosch", name: "Fürstentum Kosch", type: "Fürstentum", parentId: "demo-reich", isAggregate: true, geometry: box(430, 500, 480, 550) },
			{ publicId: "demo-angbar", name: "Baronie Angbar", type: "Baronie", parentId: "demo-kosch", isAggregate: false, geometry: box(430, 500, 455, 525) },
			{ publicId: "demo-schneehag", name: "Baronie Schneehag", type: "Baronie", parentId: "demo-kosch", isAggregate: false, geometry: box(455, 525, 480, 550) },
			{ publicId: "demo-garetien", name: "Garetien", type: "Grafschaft", parentId: "demo-reich", isAggregate: false, geometry: box(490, 560, 530, 600) },
			{ publicId: "demo-thorwal", name: "Thorwal", type: "Reich", parentId: "", isAggregate: false, geometry: box(300, 700, 360, 760) },
			{ publicId: "demo-waise", name: "Baronie Ohneland", type: "Baronie", parentId: "demo-fehlt", isAggregate: false, geometry: box(600, 300, 620, 320) },
		];
	}

	// Ein Global, ein Namensraum-Objekt -- alles andere bleibt in der IIFE und kann mit den 164
	// <script>-Tags in einem Scope nicht kollidieren (Instruction §4.6).
	if (typeof window !== "undefined") {
		window.AvesmapsEcosystemTerritoryImport = {
			open: openTerritoryImportDialog,
			close: closeTerritoryImportDialog,
			isOpen: isTerritoryImportDialogOpen,
			// Für die Prüfung: die reine Rechnung, ohne Fenster und ohne Karte.
			territoryImportLabel,
			buildTerritoryImportRows,
			territoryImportDescendants,
			territoryImportVisibleRows,
			unionTerritoryImportGeometries,
			roundImportGeometry,
		};
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = {
			territoryImportLabel,
			buildTerritoryImportRows,
			territoryImportDescendants,
			territoryImportVisibleRows,
			isUsableImportGeometry,
			unionTerritoryImportGeometries,
			roundImportRing,
			roundImportGeometry,
			formatImportSummary,
		};
	}
})();
