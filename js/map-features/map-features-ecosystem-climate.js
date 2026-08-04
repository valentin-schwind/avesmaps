// Klimazonen -- der Trennlinien-Editor auf der Karte (Entwurf
// docs/superpowers/specs/2026-08-03-klimazonen-design.md §8.4).
//
// 🔴 DIESE DATEI BEARBEITET LINIEN, NIE FLÄCHEN. Die sieben Bänder sind abgeleitet; sie kommen als
// gewöhnliche Flächen aus dem Loader und werden hier nur neu angefordert, nachdem der Server sie
// nachgerechnet hat. Wer hier anfängt, ein Band anzufassen, baut die zweite Wahrheit ein, die der
// ganze Entwurf vermeidet -- und sie wäre beim nächsten Ableiten stillschweigend wieder weg.
//
// 🔴 KOORDINATEN. Auf dem Draht GeoJSON [x, y]; Leaflet will [lat, lng] = [y, x]. Gedreht wird HIER
// und nur hier (AGENTS.md §5). Norden ist hohes y, Trennlinie 1 liegt also am höchsten.

const CLIMATE_MIN_XY = 0;
const CLIMATE_MAX_XY = 1024;

// Derselbe Mindestabstand, den der Server erzwingt (AVESMAPS_CLIMATE_MIN_GAP). Der Client klemmt damit
// VOR dem Speichern, statt eine Fehlermeldung abzuholen -- aber die Wahrheit steht auf dem Server, und
// der prüft noch einmal: ein zweiter Editor kann die Nachbarlinie inzwischen bewegt haben, und nur der
// Server sieht beide Bewegungen.
const CLIMATE_MIN_GAP = 1;

// Unter dieser Bandhöhe (Karteneinheiten) wird der Name weggelassen. Ein Name, der über seine eigene
// Zone hinausragt, beschriftet die Nachbarzone mit.
// Der ABSTAND zum Kartenrand steht dagegen im CSS (`.ecosystem-climate-name`, padding-left): er ist ein
// Pixelmaß und soll beim Zoomen nicht mitwachsen.
const CLIMATE_NAME_MIN_HEIGHT = 8;

// ---- reine Rechnerei (unit-getestet, js/map-features/__tests__/ecosystem-climate.test.js) ----------

function climateClampToMap(value) {
	return Math.max(CLIMATE_MIN_XY, Math.min(CLIMATE_MAX_XY, value));
}

// Schneiden sich die Strecken a1-a2 und b1-b2? Wortgleich zu avesmapsClimateSegmentsCross in
// api/_internal/app/climate-zones.php -- der Client soll dasselbe verbieten wie der Server, sonst zieht
// man eine Linie, die beim Loslassen abgelehnt wird.
function climateSegmentsCross(a1, a2, b1, b2) {
	const orient = (p, q, r) => {
		const value = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
		return Math.abs(value) < 1e-9 ? 0 : (value > 0 ? 1 : 2);
	};
	const onSegment = (p, q, r) =>
		q[0] <= Math.max(p[0], r[0]) + 1e-9 && q[0] >= Math.min(p[0], r[0]) - 1e-9
		&& q[1] <= Math.max(p[1], r[1]) + 1e-9 && q[1] >= Math.min(p[1], r[1]) - 1e-9;

	const o1 = orient(a1, a2, b1), o2 = orient(a1, a2, b2);
	const o3 = orient(b1, b2, a1), o4 = orient(b1, b2, a2);
	if (o1 !== o2 && o3 !== o4) {
		return true;
	}
	return (o1 === 0 && onSegment(a1, b1, a2)) || (o2 === 0 && onSegment(a1, b2, a2))
		|| (o3 === 0 && onSegment(b1, a1, b2)) || (o4 === 0 && onSegment(b1, a2, b2));
}

// Würde dieser Punkt an dieser Stelle etwas kaputt machen?
//
// 🔴 SEIT DEN ÜBERHÄNGEN IST DAS DIE GANZE REGEL (Owner 2026-08-03). Vorher klemmten zwei Schranken:
// y zwischen den Nachbarlinien, x zwischen den Nachbarpunkten. Beide setzten voraus, dass jede Linie
// eine Funktion y(x) ist -- und genau das verbot die Blase um die Wüste Khôm.
//
// An ihre Stelle tritt der Test, um den es wirklich geht: die beiden Strecken AN DIESEM PUNKT dürfen
// weder eine andere Strecke derselben Linie noch eine der Nachbarlinien schneiden. Alles andere ist
// erlaubt -- auch zurücklaufen, auch senkrecht.
//
// Geprüft werden nur die beiden betroffenen Strecken, nicht die ganze Linie: alles andere hat sich
// nicht bewegt und war vorher gültig.
function climateVertexWouldCross(coordinates, pointIndex, candidate, neighbours) {
	const probe = coordinates.slice();
	probe[pointIndex] = candidate;

	const betroffen = [];
	if (pointIndex > 0) { betroffen.push([pointIndex - 1, pointIndex]); }
	if (pointIndex < probe.length - 1) { betroffen.push([pointIndex, pointIndex + 1]); }

	for (const [from, to] of betroffen) {
		// gegen die eigene Linie, ohne die anstossenden Strecken (die teilen naturgemäss einen Punkt)
		for (let index = 0; index < probe.length - 1; index += 1) {
			if (index >= from - 1 && index <= to) { continue; }
			if (climateSegmentsCross(probe[from], probe[to], probe[index], probe[index + 1])) {
				return true;
			}
		}
		// gegen die Nachbarlinien
		for (const nachbar of (neighbours || [])) {
			if (!Array.isArray(nachbar)) { continue; }
			for (let index = 0; index < nachbar.length - 1; index += 1) {
				if (climateSegmentsCross(probe[from], probe[to], nachbar[index], nachbar[index + 1])) {
					return true;
				}
			}
		}
	}

	return false;
}

// An welcher Stelle der Punktliste landet ein Klick?
//
// 🔴 Über den ABSTAND zur Strecke, nicht mehr über den x-Bereich: mit einem Überhang deckt derselbe x
// mehrere Strecken ab, und „die erste, deren Bereich passt" wäre dann geraten.
//
// 🔴 Immer mindestens 1 und höchstens length - 1: die beiden Randpunkte sind Pflicht, und ein Einfügen
// ausserhalb von ihnen schöbe einen aus seiner Ecke -- das Band darunter hörte dann vor dem Kartenrand
// auf und hinterliesse einen Streifen, der zu keiner Zone gehört.
function climateInsertionIndex(coordinates, x, y) {
	let beste = 1;
	let bester = Infinity;
	for (let index = 0; index < coordinates.length - 1; index += 1) {
		const [ax, ay] = coordinates[index];
		const [bx, by] = coordinates[index + 1];
		const dx = bx - ax, dy = by - ay;
		const laenge = dx * dx + dy * dy;
		const t = laenge === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / laenge));
		const abstand = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
		if (abstand < bester) {
			bester = abstand;
			beste = index + 1;
		}
	}
	return beste;
}

// ---- Zustand ---------------------------------------------------------------------------------------

let climateDividers = null;      // [{seq, geometry:{type,coordinates}, revision}] -- null = nie geholt
let climateZones = [];           // [{type_key, label, sort_order, region_public_id}]
let climateLineLayers = [];
let climateHandleLayers = [];
let climateNameLayers = [];
let climateSaving = false;
let climateLoading = false;

function climateSay(message, tone) {
	if (typeof showFeedbackToast === "function") {
		showFeedbackToast(message, tone);
	}
}

// 🔴 ZWEI Fragen, nicht eine (Owner 2026-08-03: „die labels auch im frontend anzeigen").
//
//   SICHTBAR   = Modus + gewählte Ebene. Dann werden die ZONENNAMEN gezeichnet -- sie sind die Auskunft
//                der Ebene, und ohne sie ist ein farbiges Band eine Farbe ohne Aussage.
//   BEARBEITBAR = zusätzlich IS_EDIT_MODE. Erst dann kommen Trennlinien und Griffe dazu.
//
// Die Trennung ist der ganze Punkt: im Frontend soll man die Zonen LESEN, nicht ihre Konstruktion
// sehen. Dieselbe Linie, an der auch die Konturen hängen (ecosystem-pane--editable im Layer-Switch).
function isClimateLayerVisible() {
	if (!(typeof isEcosystemLayerModeActive === "function" && isEcosystemLayerModeActive())) {
		return false;
	}
	// 🪤 „Alle" ZÄHLT MIT (Owner 2026-08-04). Bis dahin war es ausdrücklich ausgenommen -- die Ebene
	// nimmt sich dort auf 10 % Füllung zurück, und sieben Namen quer darüber galten als Beiwerk. In der
	// Praxis war das Gegenteil der Fall: die zurückgenommene Fläche ist ohne ihren Namen eine Färbung,
	// die man nicht mehr zuordnen kann. Der Name ist die Auskunft der Ebene, gerade wenn die Farbe
	// leise ist.
	//
	// 💣 Es hängt NICHT am gemerkten Ebenenwert. „Alle" lässt den stehen, und genau deshalb wird er
	// hier gar nicht erst gefragt -- sonst wären die Namen mal da und mal nicht, je nachdem was zuletzt
	// gewählt war, und das ist kein Zustand, den man erklären kann.
	if (typeof isEcosystemShowAllLayers === "function" && isEcosystemShowAllLayers()) {
		return true;
	}

	return typeof getActiveEcosystemLayerKind === "function" && getActiveEcosystemLayerKind() === "klima";
}

// 🔴 Der EDITOR bleibt auf der gewählten Klima-Ebene, „Alle" ist ausgenommen. Die Namen darf man überall
// lesen; Trennlinien und Griffe wären dort Werkzeug über drei fremden Ebenen -- und ein Griff, der auf
// einer Vegetationsfläche zu liegen scheint, verwirrt mehr, als er nützt. Deshalb fragt diese Funktion
// die Ebene ein zweites Mal, statt sich auf isClimateLayerVisible() zu verlassen.
function isClimateEditorActive() {
	if (typeof isEcosystemShowAllLayers === "function" && isEcosystemShowAllLayers()) {
		return false;
	}

	return isClimateLayerVisible() && typeof IS_EDIT_MODE !== "undefined" && Boolean(IS_EDIT_MODE);
}

function climateNeighbourCoordinates(dividerIndex, offset) {
	const neighbour = (climateDividers || [])[dividerIndex + offset];
	return neighbour ? neighbour.geometry.coordinates : null;
}

// ---- Hervorhebung einer Zone -----------------------------------------------------------------------
// Owner 2026-08-04: ein Klick auf den NAMEN hebt sein Band von der leisen auf eine kräftige Füllung,
// ein Klick woanders nimmt sie zurück.
//
// 🔴 DER NAME IST DAS EINZIGE ZIEL, und das ist keine Bequemlichkeit. Ein Klimaband ist exakt so breit
// wie die Karte und liegt über allen anderen Ebenen; in „Alle" nimmt es deshalb ausdrücklich KEINE
// Klicks an (Regel in ecosystem-layer.css), sonst verschluckte es jeden Klick, der einem Wald oder
// einem See darunter galt. Ein Wort am Kartenrand verschluckt nichts -- deshalb hängt die Geste dort.
//
// Gemerkt wird die REGION, nicht die Fläche: eine Zone hat heute genau eine Fläche, aber die Zone ist
// das, was der Name meint. Käme je eine zweite Fläche dazu, leuchtete die Zone weiter als Ganzes.
//
// 🔴 ZWEI ZUSTÄNDE, NICHT EINER (Owner 2026-08-04: „wenn mans hovert sollen auch die Klimazonen
// leuchten"). Der angeklickte bleibt, der überfahrene ist geliehen -- und beim Verlassen muss der
// angeklickte wieder hervorkommen. Mit einer einzigen Variablen ginge er beim ersten Mauszeiger über
// einen fremden Namen verloren, und das Loslassen liesse die Karte leer zurück.
let clickedClimateRegionId = "";
let hoveredClimateRegionId = "";

// Der überfahrene gewinnt, solange die Maus liegt -- das ist die Vorschau. Danach fällt es auf den
// angeklickten zurück.
function effectiveClimateRegionId() {
	return hoveredClimateRegionId || clickedClimateRegionId;
}

// Welche Zone bekommt zusätzlich eine KONTUR? Die angeklickte -- aber nur, solange sie auch leuchtet.
//
// 🔴 Damit unterscheiden sich Vorschau und Wahl: Überfahren füllt, Anklicken füllt UND umreisst. Ohne
// die zweite Bedingung bliebe die Kontur bei einer Zone liegen, die gerade gar nicht leuchtet, sobald
// die Maus auf einen anderen Namen zeigt -- eine umrandete Fläche ohne Füllung neben einer gefüllten
// ohne Rand, und keine von beiden sähe nach einer Antwort aus.
function contouredClimateRegionId() {
	return effectiveClimateRegionId() === clickedClimateRegionId ? clickedClimateRegionId : "";
}

// PUR (und deshalb prüfbar): gehört diese Fläche zur hervorgehobenen Zone?
function shouldHighlightClimateArea(area, regionPublicId) {
	if (!area || String(area.kind || "") !== "klima" || !regionPublicId) {
		return false;
	}

	return String(area.region_public_id || "") === String(regionPublicId);
}

// Zustand als Klasse am <path>, Werte im CSS -- dieselbe Bauart wie applyEcosystemSelectionClass
// (map-features-ecosystem-rendering.js). Ein zweiter Satz Zahlen im JavaScript wäre die zweite Wahrheit
// über dieselbe Deckkraft.
function applyClimateHighlightClass(layer) {
	const element = typeof layer?.getElement === "function" ? layer.getElement() : null;
	if (!element) {
		return;
	}
	const area = layer._ecosystemArea;
	element.classList.toggle(
		"ecosystem-climate-area--highlight",
		shouldHighlightClimateArea(area, effectiveClimateRegionId())
	);
	element.classList.toggle(
		"ecosystem-climate-area--picked",
		shouldHighlightClimateArea(area, contouredClimateRegionId())
	);
}

function applyClimateHighlight() {
	if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
		return;
	}
	ecosystemLayers.forEach(applyClimateHighlightClass);
}

// Beide Setzer gehen durch denselben Trichter: erst den Zustand ändern, dann prüfen, ob sich die
// WIRKUNG überhaupt geändert hat. Ein Mauszeiger, der über den angeklickten Namen fährt, ändert den
// Zustand -- aber nichts am Bild, und dann wird auch nichts neu gezeichnet.
// 💣 BEIDE Ableitungen vergleichen, nicht nur die leuchtende. Solange es nur die Füllung gab, genügte
// effectiveClimateRegionId() -- mit der Kontur nicht mehr, und der Fall sieht harmlos aus: Maus auf den
// Namen (leuchtet), dann KLICK. Die leuchtende Zone bleibt dabei dieselbe, die Kontur aber müsste
// dazukommen. Wer nur die eine vergleicht, überspringt genau den Klick, um den es geht -- und die
// Kontur erscheint erst, wenn die Maus einmal woanders war. Gefunden im Durchlauf, nicht im Kopf.
function updateClimateHighlight(change) {
	const vorher = effectiveClimateRegionId() + "|" + contouredClimateRegionId();
	change();
	if (effectiveClimateRegionId() + "|" + contouredClimateRegionId() !== vorher) {
		applyClimateHighlight();
	}
}

function setHighlightedClimateRegion(regionPublicId) {
	updateClimateHighlight(() => {
		clickedClimateRegionId = String(regionPublicId || "");
		// Ein Klick beendet die Vorschau: von hier an gilt, was angeklickt wurde. Ohne das bliebe der
		// geliehene Zustand liegen und überstimmte beim nächsten Zeichnen die frische Wahl.
		hoveredClimateRegionId = "";
	});
}

function setHoveredClimateRegion(regionPublicId) {
	updateClimateHighlight(() => {
		hoveredClimateRegionId = String(regionPublicId || "");
	});
}

// 💣 EIN Zuhörer, im DOKUMENT und in der EINFANGPHASE. Nicht `map.on("click")`: der feuert nicht, wenn
// der Klick einen Ort, einen Weg oder ein Popup trifft -- die Hervorhebung bliebe dann stehen, während
// nebenan eine Infobox aufgeht. In der Einfangphase läuft dieser Zuhörer VOR Leaflets eigenem Handler;
// trifft der Klick den Namen selbst, hält er sich heraus und der Marker setzt die Zone gleich neu.
if (typeof document !== "undefined" && !document.__avesmapsClimateHighlightBound) {
	document.__avesmapsClimateHighlightBound = true;
	document.addEventListener("click", (event) => {
		const onName = event.target && typeof event.target.closest === "function"
			&& event.target.closest(".ecosystem-climate-name");
		if (!onName) {
			setHighlightedClimateRegion("");
		}
	}, true);
}

// ---- Zeichnen --------------------------------------------------------------------------------------

function clearClimateOverlay() {
	// 🪤 Die Hervorhebung sitzt an der FLÄCHE, nicht am Namen -- sie verschwindet also nicht mit den
	// Namensmarkern. Wer die Ebene wechselt, liesse sonst ein kräftig gefärbtes Band zurück, dessen
	// Beschriftung weg ist und das niemand mehr loswird.
	setHighlightedClimateRegion("");
	[...climateLineLayers, ...climateHandleLayers, ...climateNameLayers].forEach((layer) => {
		if (typeof map !== "undefined" && map && map.hasLayer(layer)) {
			map.removeLayer(layer);
		}
	});
	climateLineLayers = [];
	climateHandleLayers = [];
	climateNameLayers = [];
}

function drawClimateDividerLine(divider, dividerIndex, color) {
	const latlngs = divider.geometry.coordinates.map(([x, y]) => [y, x]);
	const line = L.polyline(latlngs, {
		pane: "ecosystemPaneKlimaLines",
		color,
		weight: 2,
		interactive: true,
	}).addTo(map);
	// Klick auf die Linie setzt einen Punkt. L.DomEvent.stop verhindert, dass derselbe Klick zusätzlich
	// die Karte trifft -- dort hebt er sonst die Flächenauswahl auf.
	line.on("click", (event) => {
		L.DomEvent.stop(event);
		insertClimateVertex(dividerIndex, event.latlng);
	});
	climateLineLayers.push(line);
	return line;
}

function drawClimateHandle(divider, dividerIndex, pointIndex) {
	const position = divider.geometry.coordinates[pointIndex];
	const isEdge = pointIndex === 0 || pointIndex === divider.geometry.coordinates.length - 1;
	const handle = L.marker([position[1], position[0]], {
		draggable: true,
		keyboard: false,
		bubblingMouseEvents: false,
		icon: L.divIcon({
			className: "path-edit-handle-marker ecosystem-edit-handle-marker"
				+ (isEdge ? " ecosystem-climate-handle--pinned" : ""),
			html: '<span class="path-edit-handle-marker__dot"></span>',
			iconSize: [14, 14],
			iconAnchor: [7, 7],
		}),
	}).addTo(map);

	handle.on("drag", (event) => {
		const moved = climateVertexTarget(dividerIndex, pointIndex, isEdge, event.target.getLatLng());
		event.target.setLatLng([moved[1], moved[0]]);
		divider.geometry.coordinates[pointIndex] = moved;
		climateLineLayers[dividerIndex]?.setLatLngs(divider.geometry.coordinates.map(([x, y]) => [y, x]));
	});
	// 💣 Beim `dragend` NICHT synchron neu zeichnen. Genau das hat der Kartenpunkt-Editor gekostet:
	// Speichern anstossen, Antwort abwarten, dann zeichnen (siehe saveClimateDivider).
	handle.on("dragend", () => { void saveClimateDivider(dividerIndex); });

	const element = handle.getElement?.();
	if (element) {
		L.DomEvent.disableClickPropagation(element);
		// 💣 LÖSCHEN HÄNGT AN EINEM NATIVEN LISTENER, nicht an handle.on("dblclick"). An genau dieser
		// Stelle ist der Flächen-Editor schon einmal gescheitert -- der Leaflet-Weg feuert dort nicht
		// zuverlässig (map-features-ecosystem-edit.js, Kommentar an den Ecken-Griffen).
		//
		// 🪤 Nur für die MITTLEREN Griffe. Ein Randgriff bekommt gar keinen Listener: er ist Pflicht,
		// und ein Doppelklick auf ihn soll spürbar nichts tun statt eine Fehlermeldung zu werfen.
		if (!isEdge) {
			element.addEventListener("dblclick", (nativeEvent) => {
				nativeEvent.preventDefault();
				nativeEvent.stopPropagation();
				removeClimateVertex(dividerIndex, pointIndex);
			});
		}
	}
	climateHandleLayers.push(handle);
}

// Wo sitzt der Name eines Bandes? An seiner WESTKANTE, mittig zwischen oberer und unterer Grenze.
//
// 🔴 Aus der FLÄCHE gerechnet, nicht aus den Trennlinien. Die Namen sollen auch im Frontend stehen, und
// dort gibt es die Trennlinien nicht: sie kommen vom Editor-Endpunkt. Die Bänder dagegen reisen im
// öffentlichen Flächen-Payload, mitsamt ihrem Regionsnamen -- also ist die Fläche die richtige Quelle.
//
// Die Rechnung ist exakt statt geschätzt: ein Band beginnt und endet auf dem Kartenrand, sein Ring hat
// bei x = 0 deshalb GENAU zwei Ecken (oben links und unten links). Deren Mitte ist die Bandmitte an der
// Westkante. Ein `bounds`-Mittelwert wäre bei einer schrägen Grenze daneben.
function climateAreaEdgeSpan(geometry, edgeX) {
	const parts = geometry?.type === "MultiPolygon" ? geometry.coordinates : [geometry?.coordinates];
	let min = null;
	let max = null;
	(parts || []).forEach((polygon) => {
		(polygon?.[0] || []).forEach((position) => {
			if (Math.abs(Number(position?.[0]) - edgeX) > 0.5) {
				return;
			}
			const y = Number(position[1]);
			if (!Number.isFinite(y)) {
				return;
			}
			min = min === null ? y : Math.min(min, y);
			max = max === null ? y : Math.max(max, y);
		});
	});
	return min === null ? null : { min, max };
}

// Rückwärtskompatibler Name für die Westkante -- der Test und ältere Aufrufe kennen ihn.
function climateAreaWestEdgeSpan(geometry) {
	return climateAreaEdgeSpan(geometry, CLIMATE_MIN_XY);
}

// Der Zonenname am Westrand seines Bandes.
//
// 🔴 KEIN map_features-Label. Ein echtes Karten-Label bräuchte einen neuen Subtyp in der Allowlist,
// liefe durch die Kollisionsauflösung und stünde auf der normalen Karte -- wo eine „Tropische Zone"
// mit echter Geographie um Platz konkurrierte. Der Name gehört zur Ebene und verschwindet mit ihr.
function drawClimateZoneNames() {
	if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
		return;
	}
	const escape = typeof escapeHtml === "function" ? escapeHtml : ((value) => String(value));
	ecosystemLayers.forEach((layer) => {
		const area = layer?._ecosystemArea;
		if (!area || area.kind !== "klima") {
			return;
		}
		const name = String(area.region_name || "").trim();
		if (name === "") {
			return;
		}
		// 🔴 BEIDE Kanten (Owner 2026-08-03). Die Karte ist 1024 breit; wer rechts arbeitet, hatte die
		// Beschriftung ausserhalb des Bildschirms. Jede Kante wird für sich gemessen -- bei einer
		// schrägen Grenze liegt die Bandmitte links woanders als rechts, und ein gespiegelter Wert
		// wäre dort daneben.
		[
			{ x: CLIMATE_MIN_XY, klasse: "ecosystem-climate-name" },
			{ x: CLIMATE_MAX_XY, klasse: "ecosystem-climate-name ecosystem-climate-name--east" },
		].forEach(({ x, klasse }) => {
			const span = climateAreaEdgeSpan(area.geometry, x);
			// Kein Rand getroffen (kann nur ein Fremdkörper in dieser Ebene sein) oder das Band ist zu
			// dünn: dann lieber kein Name als einer, der in die Nachbarzone ragt und sie mitbeschriftet.
			if (!span || span.max - span.min < CLIMATE_NAME_MIN_HEIGHT) {
				return;
			}
			const marker = L.marker([(span.min + span.max) / 2, x], {
				pane: "ecosystemPaneKlimaLines",
				// Anklickbar seit 2026-08-04 -- der Name ist der Griff, mit dem man sein Band hervorhebt.
				interactive: true,
				keyboard: false,
				icon: L.divIcon({
					className: klasse,
					html: `<span>${escape(name)}</span>`,
					iconSize: null,
				}),
			}).addTo(map);
			// 🪤 Die Zone wird über die REGION der Fläche gemerkt, die diesen Namen trägt -- nicht über den
			// Namenstext. Zwei Bänder dürfen gleich heissen (der Name ist im Regionen-Editor frei), und
			// dann leuchtete sonst das falsche.
			const regionPublicId = String(area.region_public_id || "");
			marker.on("click", (event) => {
				// Der Klick gilt dem Namen und sonst niemandem: Leaflet reicht einen Marker-Klick sonst
				// an die KARTE weiter, und deren Handler beantworten ihn als Klick ins Gelände.
				// 🪤 Das ist NICHT, was den Zuhörer oben zurückhält -- der läuft in der Einfangphase und
				// damit ohnehin vorher; er hält sich selbst heraus, weil das Ziel im Namen liegt.
				if (event && event.originalEvent) {
					L.DomEvent.stopPropagation(event.originalEvent);
				}
				setHighlightedClimateRegion(regionPublicId);
			});
			// Überfahren zeigt dasselbe wie ein Klick, nur geliehen (Owner 2026-08-04). Das ist der
			// eigentliche „man kann hier klicken"-Hinweis: das Band selbst antwortet.
			// 🪤 `mouseout`, nicht `mouseleave`: Leaflet reicht nur das erste als Ereignis der Ebene
			// durch. Der Name hat keine verschachtelten Kinder ausser seinem einen <span>, deshalb kostet
			// der Unterschied hier nichts.
			marker.on("mouseover", () => setHoveredClimateRegion(regionPublicId));
			marker.on("mouseout", () => setHoveredClimateRegion(""));
			climateNameLayers.push(marker);
		});
	});
}

function drawClimateOverlay() {
	clearClimateOverlay();
	if (typeof map === "undefined" || !map || !isClimateLayerVisible()) {
		return;
	}

	// Die NAMEN immer, sobald die Ebene sichtbar ist -- auch ohne Editiermodus. Sie hängen an den
	// geladenen Flächen, nicht an den Trennlinien, und brauchen deshalb keinen Editor-Aufruf.
	drawClimateZoneNames();

	// Trennlinien und Griffe NUR im Editiermodus. Im Frontend soll man die Zonen lesen, nicht ihre
	// Konstruktion sehen -- dieselbe Linie, an der auch die Konturen hängen.
	if (!isClimateEditorActive() || !Array.isArray(climateDividers)) {
		return;
	}

	// Kein Literal (AGENTS.md §12): der Ton kommt aus dem Token, wie bei jeder anderen gezeichneten
	// Farbe dieser Ebene.
	const color = getComputedStyle(document.documentElement)
		.getPropertyValue("--color-ecosystem-klima-divider").trim();

	climateDividers.forEach((divider, dividerIndex) => drawClimateDividerLine(divider, dividerIndex, color));
	// Griffe ERST, wenn alle Linien liegen: climateLineLayers[dividerIndex] muss beim ersten Ziehen
	// schon da sein, sonst zieht der Griff eine Linie, die er nicht findet.
	climateDividers.forEach((divider, dividerIndex) => {
		divider.geometry.coordinates.forEach((position, pointIndex) => {
			drawClimateHandle(divider, dividerIndex, pointIndex);
		});
	});
}

// ---- Gesten ----------------------------------------------------------------------------------------

// Die Nachbarlinien dieser Trennlinie, als Koordinatenlisten -- gegen die wird geprüft.
function climateNeighbourList(dividerIndex) {
	return [climateNeighbourCoordinates(dividerIndex, -1), climateNeighbourCoordinates(dividerIndex, 1)]
		.filter(Boolean);
}

// Wohin darf dieser Griff?
//
// 🔴 „Es stoppt" bleibt das Verhalten, nur die Bedingung ist eine andere: würde der neue Punkt eine
// Linie schneiden lassen, folgt der Griff einfach nicht und bleibt an seiner letzten gültigen Stelle.
// Der Editor merkt das als Widerstand -- genau wie vorher an der Nachbarlinie, nur ohne die Regel,
// dass x steigen muss.
function climateVertexTarget(dividerIndex, pointIndex, isEdge, latlng) {
	const coordinates = climateDividers[dividerIndex].geometry.coordinates;
	// Ein Randgriff behält sein x -- er ist am Kartenrand festgenagelt und darf nur senkrecht.
	const x = isEdge ? coordinates[pointIndex][0] : climateClampToMap(latlng.lng);
	const y = climateClampToMap(latlng.lat);
	const kandidat = [x, y];

	// 🪤 Der Mindestabstand am WESTRAND wird weiter eingehalten -- dort entscheidet sich, welche Linie
	// über welcher liegt (avesmapsClimateAssertOrder), und ein Randgriff, der die Nachbarin überholt,
	// kehrte die Reihenfolge um.
	if (pointIndex === 0) {
		const north = climateNeighbourCoordinates(dividerIndex, -1);
		const south = climateNeighbourCoordinates(dividerIndex, 1);
		const oben = north ? north[0][1] - CLIMATE_MIN_GAP : CLIMATE_MAX_XY;
		const unten = south ? south[0][1] + CLIMATE_MIN_GAP : CLIMATE_MIN_XY;
		kandidat[1] = Math.max(unten, Math.min(oben, kandidat[1]));
	}

	return climateVertexWouldCross(coordinates, pointIndex, kandidat, climateNeighbourList(dividerIndex))
		? coordinates[pointIndex]
		: kandidat;
}

function insertClimateVertex(dividerIndex, latlng) {
	const divider = climateDividers?.[dividerIndex];
	if (!divider || climateSaving) {
		return;
	}
	const coordinates = divider.geometry.coordinates;
	// Die nächstliegende Strecke, nicht der x-Bereich: mit einem Überhang deckt derselbe x mehrere
	// Strecken ab.
	const index = climateInsertionIndex(coordinates, latlng.lng, latlng.lat);
	coordinates.splice(index, 0, [climateClampToMap(latlng.lng), climateClampToMap(latlng.lat)]);
	void saveClimateDivider(dividerIndex);
}

function removeClimateVertex(dividerIndex, pointIndex) {
	const divider = climateDividers?.[dividerIndex];
	if (!divider || climateSaving) {
		return;
	}
	// Die beiden Randpunkte sind Pflicht: ohne sie hört die Linie vor dem Kartenrand auf, und das Band
	// darunter bekäme einen Streifen, der zu keiner Zone gehört. Der Doppelklick-Listener wird für sie
	// gar nicht erst gehängt; dies ist der zweite Riegel, falls jemand die Funktion anderswoher ruft.
	if (pointIndex <= 0 || pointIndex >= divider.geometry.coordinates.length - 1) {
		return;
	}
	divider.geometry.coordinates.splice(pointIndex, 1);
	void saveClimateDivider(dividerIndex);
}

// ---- Laden und Speichern ---------------------------------------------------------------------------

async function loadClimateDividers() {
	if (climateLoading) {
		return;
	}
	climateLoading = true;
	try {
		const result = await postEcosystemEdit("climate_get", {});
		climateDividers = Array.isArray(result?.dividers) ? result.dividers : [];
		climateZones = Array.isArray(result?.zones) ? result.zones : [];
		drawClimateOverlay();
	} finally {
		climateLoading = false;
	}
}

async function saveClimateDivider(dividerIndex) {
	const divider = climateDividers?.[dividerIndex];
	if (!divider || climateSaving) {
		return;
	}
	climateSaving = true;
	try {
		const result = await postEcosystemEdit("climate_save_divider", {
			seq: divider.seq,
			geometry_geojson: divider.geometry,
			expected_revision: divider.revision,
		});
		if (Array.isArray(result?.dividers)) {
			climateDividers = result.dividers;
		}
		drawClimateOverlay();
		// Die Bänder hat der Server nachgerechnet -- sie kommen über den gewöhnlichen Flächenweg zurück.
		if (typeof scheduleEcosystemAreaReload === "function") {
			scheduleEcosystemAreaReload({ immediate: true });
		}
	} catch (error) {
		// 🔴 Bei einem Fehlschlag den SERVERSTAND wiederherstellen, nicht den lokalen behalten. Sonst
		// sieht der Editor eine Linie, die es nicht gibt, und jeder weitere Zug baut darauf auf --
		// inklusive der `revision`, die dann bei jedem Speichern erneut in den 409 läuft.
		console.warn("Klimagrenze konnte nicht gespeichert werden:", error);
		climateSay("Die Trennlinie konnte nicht gespeichert werden: " + (error?.message || ""), "warning");
		climateDividers = null;
	} finally {
		climateSaving = false;
	}
	if (climateDividers === null) {
		await loadClimateDividers().catch(() => { clearClimateOverlay(); });
	}
}

// ---- Eintrittspunkt --------------------------------------------------------------------------------
// Von syncEcosystemPaneStates gerufen, also bei jedem Ebenen- und jedem Moduswechsel. Die Linien räumen
// sich damit bei jeder anderen Lage selbst ab -- es braucht keinen zweiten Aufräumweg.

function syncEcosystemClimateEditor() {
	if (!isClimateLayerVisible()) {
		clearClimateOverlay();
		return;
	}
	// 🪤 IMMER zuerst zeichnen, auch wenn gleich noch geladen wird. Die Namen hängen an den Flächen und
	// sind sofort da; sie auf die Antwort des Editor-Endpunkts warten zu lassen hiesse, sie im Frontend
	// gar nicht zu zeigen -- dort wird er nie gerufen.
	drawClimateOverlay();

	// Die Trennlinien braucht nur der Editiermodus, und nur dort wird der Endpunkt gerufen.
	if (isClimateEditorActive() && climateDividers === null && !climateLoading) {
		void loadClimateDividers().catch((error) => {
			console.warn("Klimazonen konnten nicht geladen werden:", error);
			climateDividers = null;
		});
	}
}

window.AvesmapsEcosystemClimate = { sync: syncEcosystemClimateEditor };

// Node-Export für die Einheitentests (Hausmuster, wie map-features-ecosystem-boolean.js). Im Browser
// existiert `module` nicht, dort bleiben die Funktionen schlicht global.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		climateSegmentsCross, climateVertexWouldCross, climateInsertionIndex,
		climateClampToMap, climateAreaWestEdgeSpan, climateAreaEdgeSpan,
	};
}
