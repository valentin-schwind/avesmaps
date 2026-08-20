// Landschaften (Erprobung) -- turning one area row from GET /api/app/ecosystem-areas.php into a
// Leaflet layer (plan V3.0, step 4). Nothing here fetches, schedules or owns the registry; the loader
// (map-features-ecosystem-loader.js) does that and hands single rows in here.
//
// 🔴 COORDINATE ORDER. The wire format is GeoJSON: positions are [x, y] and the API returns exactly
// what was POSTed (api/_internal/app/ecosystem.php header). Leaflet's L.CRS.Simple wants
// [lat, lng] = [y, x] (AGENTS.md §5) -- so the swap happens HERE, in the client, and nowhere else.
//
// 🔴 NO HARDCODED COLOURS (AGENTS.md §12). The three kind tones are tokens in css/base/tokens.css and
// are read back out of the computed style, the same way the location canvas layer reads
// --color-marker-active (map-features-location-canvas-layer.js:27). A literal here would be the
// fourth place the same brown is written down.

// Display order of the segment switch AND the pane stack, low to high: the derographic containers
// (continents, islands) sit at the bottom, topography on top. German values on purpose -- they are
// domain vocabulary like PATH_SUBTYPE_KEYS, not translatable words (AGENTS.md §2, plan "Namensgebung").
//
// `klima` (2026-08-03) ist die vierte und liegt ganz OBEN: ein Klimaband deckt die Karte in seiner
// vollen Breite, unter Vegetation und Topographie waere es nicht zu sehen. Seine Fuellung ist dafuer
// sehr leicht (css/features/ecosystem-layer.css).
//
// 🔴 Die Klima-Ebene wird NICHT GEZEICHNET, sondern ABGELEITET -- aus sechs Trennlinien
// (map-features-ecosystem-climate.js, api/_internal/app/climate-zones.php). Fuer alles Lesende ist sie
// trotzdem eine Ebene wie jede andere; nur die Bearbeitungsverben sind fuer sie gesperrt
// (isDerivedEcosystemKind unten).
const ECOSYSTEM_KINDS = ["derographisch", "vegetation", "topographie", "klima"];

const ECOSYSTEM_KIND_LABELS = {
	// Owner 2026-08-03: „Derographie" statt „Derographische Region" -- kuerzer, und es sagt dasselbe
	// wie der Fenstertitel-Praefix darunter, der es seit je so nennt. Der SCHLUESSEL bleibt
	// `derographisch`; er steht in zehn Tabellen und in jedem Test.
	derographisch: "Derographie",
	vegetation: "Vegetation",
	topographie: "Topographie",
	klima: "Klimazonen",
};

// Die Ebene als BESTIMMUNGSWORT, für zusammengesetzte Titel: „Vegetations-Fläche bearbeiten",
// „Derographie-Label bearbeiten". Eigene Tabelle statt einer Ableitung aus ECOSYSTEM_KIND_LABELS --
// die trägt die Ebene als Substantiv („Derographische Region"), und „Derographische Region-Label"
// wäre kein Deutsch. Die Wörter sind die des Owners (2026-07-28), nicht gebeugte Varianten davon.
const ECOSYSTEM_KIND_PREFIX = {
	derographisch: "Derographie",
	vegetation: "Vegetations",
	topographie: "Topographie",
	klima: "Klimazonen",
};

// Der Titel eines Bearbeitungsfensters. `subject` ist "flaeche" oder "label".
//
// 🪤 Ohne Ebene bleibt es beim allgemeinen Titel: ein Kontinent, ein Meer oder ein freier Kartentitel
// gehört zu keiner Landschaftsebene, und „Vegetations-Label bearbeiten" darüberzuschreiben wäre eine
// Zuordnung, die es nicht gibt. Dasselbe gilt, solange die Zugehörigkeit noch nicht aufgelöst ist --
// deshalb wird der Titel zweistufig gesetzt (erst neutral, dann verfeinert).
function ecosystemDialogTitle(kind, subject) {
	const noun = String(subject) === "label" ? "Label" : "Fläche";
	const prefix = ECOSYSTEM_KIND_PREFIX[String(kind || "")] || "";

	return prefix === "" ? `${noun} bearbeiten` : `${prefix}-${noun} bearbeiten`;
}

const ECOSYSTEM_KIND_PANES = {
	derographisch: "ecosystemPaneDerographisch",
	vegetation: "ecosystemPaneVegetation",
	topographie: "ecosystemPaneTopographie",
	klima: "ecosystemPaneKlima",
};

const ECOSYSTEM_KIND_COLOR_TOKENS = {
	derographisch: "--color-ecosystem-derographisch",
	vegetation: "--color-ecosystem-vegetation",
	topographie: "--color-ecosystem-topographie",
	klima: "--color-ecosystem-klima",
};

// The public_id of the area the editor last clicked, or "" for none. Only an area in the ACTIVE pane
// can ever get here -- the resting panes do not take pointer events at all (see the CSS).
let selectedEcosystemAreaPublicId = "";

function isKnownEcosystemKind(kind) {
	return ECOSYSTEM_KINDS.includes(String(kind || ""));
}

// Wird diese Ebene ABGELEITET statt gezeichnet? Heute genau eine: die Klimazonen entstehen aus ihren
// sechs Trennlinien (map-features-ecosystem-climate.js). Eine Funktion statt eines verstreuten
// Vergleichs gegen "klima", weil fuenf Aufrufstellen dieselbe Frage stellen -- und die fuenfte sonst
// vergessen wird.
//
// 🔴 Der Riegel, der zaehlt, steht auf dem SERVER (avesmapsClimateAssertNotDerived). Dieser hier
// verhindert nur, dass ein Verb angeboten wird, das gleich darauf abgelehnt wuerde.
function isDerivedEcosystemKind(kind) {
	return String(kind || "") === "klima";
}

function readEcosystemColorToken(token) {
	return token ? getComputedStyle(document.documentElement).getPropertyValue(token).trim() : "";
}

// The tone of one area. Vegetation carries a tone per region_type -- Wald green, Wüste sand, Sümpfe
// murky (Owner 2026-07-26) -- because it is the layer that draws real ground cover; the other two draw
// containers and relief and get one colour each.
//
// The type token is derived BY RULE from the type_key, so a newly seeded type needs a token in
// tokens.css and nothing else: there is no type list in this file that could fall behind
// ecosystem_region_type. A type without a token, or a region without a type, falls back to the layer's
// base tone.
function ecosystemAreaColor(kind, regionType) {
	// One rule for every layer, not a special case for vegetation: topography draws relief AND water,
	// which no map has ever painted in one colour, and derographic containers may want the same
	// treatment tomorrow. A type without a token falls through to the layer's base tone, so adding a
	// tone is adding a token -- there is no type list in this file that could fall behind
	// ecosystem_region_type.
	if (kind && regionType) {
		const typeColor = readEcosystemColorToken(`--color-ecosystem-${kind}-${String(regionType).replace(/_/g, "-")}`);
		if (typeColor) {
			return typeColor;
		}
	}

	return readEcosystemColorToken(ECOSYSTEM_KIND_COLOR_TOKENS[kind]);
}

// GeoJSON Polygon | MultiPolygon -> Leaflet latlngs, [x, y] -> [y, x]. A Polygon becomes a
// single-part MultiPolygon so both shapes take one code path (the server normalizes the same way).
function ecosystemAreaLatLngs(geometry) {
	const type = String(geometry?.type || "");
	const coordinates = geometry?.coordinates;
	if (!Array.isArray(coordinates) || coordinates.length === 0) {
		return null;
	}

	const parts = type === "Polygon" ? [coordinates] : (type === "MultiPolygon" ? coordinates : null);
	if (!parts) {
		return null;
	}

	const latlngs = parts.map((part) => (Array.isArray(part) ? part : []).map(
		(ring) => (Array.isArray(ring) ? ring : []).map(([x, y]) => [Number(y), Number(x)])
	));

	// A ring that lost its numbers somewhere would render as NaN and silently take the whole pane's
	// SVG with it -- refuse the row instead (the same guard the route pan learned the hard way).
	const hasBrokenPosition = latlngs.some((part) => part.some(
		(ring) => ring.length < 3 || ring.some(([lat, lng]) => !Number.isFinite(lat) || !Number.isFinite(lng))
	));

	return hasBrokenPosition ? null : latlngs;
}

// 🔴 COLOUR ONLY. fill-opacity and stroke-opacity belong to the matrix in css/features/ecosystem-layer.css
// and are deliberately NOT passed here: they depend on the pane's state (resting / active / selected),
// and a second set of numbers in JS would have to be kept in step with that table forever. Leaflet writes
// its style as SVG presentation ATTRIBUTES, which CSS outranks, so the stylesheet wins cleanly.
// The contour of an area. Every layer carries its own, markedly darker line (Owner 2026-07-26 for the
// first two, 2026-07-29 for vegetation) -- a wash at 30% opacity does not tell you where the boundary
// runs, and the edge is what you trace against the terrain.
//
// 🪤 Vegetation was the LAST one without a token, on the reasoning that its fill already varies per
// region_type and the contour could simply follow it. That was wrong in the one place it mattered: a
// forest edge was forest-green on forest-green and disappeared. A missing token still means "use the
// fill", which is why this stays one lookup rather than a second colour table -- but no layer relies
// on that fallback any more.
function ecosystemAreaContourColor(kind, regionType) {
	return readEcosystemColorToken(`--color-ecosystem-${kind}-contour`) || ecosystemAreaColor(kind, regionType);
}

// Läuft gerade irgendeine Bearbeitung? Eine Frage, mehrere Werkzeuge -- Zeichnen, Pinsel/Radiergummi,
// der Ecken-Editor und die Gesten aus dem Kontextmenü (verschieben, zerschneiden, boolesch).
function isEcosystemEditingInProgress() {
	if (typeof isEcosystemDrawing === "function" && isEcosystemDrawing()) {
		return true;
	}
	if (window.AvesmapsEcosystemBrush?.isActive?.()) {
		return true;
	}
	if (typeof activeEcosystemGeometryEdit !== "undefined" && activeEcosystemGeometryEdit) {
		return true;
	}
	if (window.AvesmapsEcosystemGeometryOps?.isPending?.()) {
		return true;
	}

	return false;
}

function ecosystemAreaStyle(kind, regionType) {
	return {
		color: ecosystemAreaContourColor(kind, regionType),
		fillColor: ecosystemAreaColor(kind, regionType),
		weight: 2,
	};
}

// Selection is a class on the path, not a style: the matrix in the stylesheet turns it into the
// stronger fill and the full contour. Re-applied after every (re)build, because a rebuilt layer gets a
// fresh <path> element.
function applyEcosystemSelectionClass(layer) {
	const element = typeof layer?.getElement === "function" ? layer.getElement() : null;
	if (!element) {
		return;
	}
	element.classList.toggle("ecosystem-area--selected", layer._ecosystemArea?.public_id === selectedEcosystemAreaPublicId);
}

// ---- Der Schwebezettel, der stehen blieb (Owner 2026-08-04) -----------------------------------------
// „manchmal verschwinden die Tooltips über den Regionen nicht" -- zwei davon standen gleichzeitig auf
// der Karte, aus zwei verschiedenen Ebenen.
//
// 🔴 URSACHE, nachgemessen: ein Leaflet-Tooltip geht von selbst NUR bei `mouseout` der Fläche zu (und
// beim Entfernen der Ebene -- das macht Leaflet selbst). Diese App schaltet aber bei jedem Ebenen- und
// Moduswechsel ganze Panes auf `pointer-events: none` (`--resting`, klima in „Alle", `--picking`) --
// und ein Element, das unter dem Zeiger klickdurchlässig wird, bekommt vom Browser KEIN mouseout mehr.
// Im Versuch bestätigt: nach `pointerEvents = "none"` kommt kein einziges Ereignis mehr an. Der Zettel
// erfährt also nie, dass die Maus weg ist, und bleibt für immer stehen.
//
// Das erklärt auch das „manchmal": es passiert genau dann, wenn der Zeiger im Augenblick des Wechsels
// zufällig auf einer Fläche liegt.
//
// 🔴 DIE REPARATUR GEHÖRT AN DIE URSACHE, nicht an den Zettel: wer die Klickbarkeit umschaltet, macht
// das Überfahren ungültig und hat es zu sagen. Deshalb steht der Aufruf in syncEcosystemPaneStates und
// in setLayerPicking -- den zwei Stellen, die Panes umschalten -- und nicht in einem Zeitgeber, der
// hinterherräumt.
function closeAllEcosystemAreaTooltips() {
	if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
		return;
	}
	ecosystemLayers.forEach((layer) => {
		if (typeof layer?.closeTooltip === "function") {
			layer.closeTooltip();
		}
	});
}

// ---- Hervorhebung: welche REGION der Leser gerade meint ---------------------------------------------
// Owner 2026-08-04, in drei Schritten gewachsen und deshalb hier und nicht im Klima-Modul: erst hob ein
// Klick auf einen Zonennamen sein Band hervor, dann sollte das Überfahren dasselbe zeigen -- und
// zuletzt: „ein Klick auf die Labels sollte immer auch die entsprechende Fläche markieren (in allen
// Landschaftsmodi), ein Klick auf Aventurien soll auch die aventurische Fläche highlighten."
//
// 🔴 GEMERKT WIRD DIE REGION, NICHT DIE FLÄCHE UND NICHT DAS LABEL. Eine Region kann mehrere Flächen
// haben (Fläche↔Label ist 1:N, und die Flächen erst recht) -- gemeint ist immer die Region als Ganzes,
// und genau die verbindet ein Label mit ihr (properties.ecosystem_region_public_id).
//
// 🔴 ZWEI ZUSTÄNDE, NICHT EINER. Der angeklickte bleibt, der überfahrene ist geliehen -- und beim
// Verlassen muss der angeklickte wieder hervorkommen. Mit einer einzigen Variablen ginge er beim ersten
// Mauszeiger über einen fremden Namen verloren, und das Loslassen liesse die Karte leer zurück.
//
// 🪤 Das ist NICHT dieselbe Sache wie `selectedEcosystemAreaPublicId` darüber. Die Auswahl ist die
// Arbeitsfläche des Editors (weisse Kontur, Griffe, Ziel der Werkzeuge); die Hervorhebung ist eine
// Leseauskunft für jeden Besucher. Sie leben nebeneinander und dürfen sich nicht vermischen.
let clickedEcosystemRegionId = "";
let hoveredEcosystemRegionId = "";

// Der überfahrene gewinnt, solange die Maus liegt -- das ist die Vorschau. Danach fällt es auf den
// angeklickten zurück.
function effectiveEcosystemRegionId() {
	return hoveredEcosystemRegionId || clickedEcosystemRegionId;
}

// Welche Region bekommt zusätzlich eine KONTUR? Die angeklickte -- aber nur, solange sie auch leuchtet.
//
// 🔴 Damit unterscheiden sich Vorschau und Wahl: Überfahren füllt, Anklicken füllt UND umreisst. Ohne
// die zweite Bedingung bliebe die Kontur bei einer Fläche liegen, die gerade gar nicht leuchtet, sobald
// die Maus auf ein anderes Label zeigt -- eine umrandete Fläche ohne Füllung neben einer gefüllten ohne
// Rand, und keine von beiden sähe nach einer Antwort aus.
function contouredEcosystemRegionId() {
	return effectiveEcosystemRegionId() === clickedEcosystemRegionId ? clickedEcosystemRegionId : "";
}

// PUR (und deshalb prüfbar): gehört diese Fläche zur hervorgehobenen Region?
function shouldHighlightEcosystemArea(area, regionPublicId) {
	if (!area || !regionPublicId) {
		return false;
	}

	return String(area.region_public_id || "") === String(regionPublicId);
}

// Zustand als Klasse am <path>, Werte im CSS -- dieselbe Bauart wie applyEcosystemSelectionClass. Ein
// zweiter Satz Zahlen im JavaScript wäre die zweite Wahrheit über dieselbe Deckkraft.
function applyEcosystemHighlightClass(layer) {
	const element = typeof layer?.getElement === "function" ? layer.getElement() : null;
	if (!element) {
		return;
	}
	const area = layer._ecosystemArea;
	element.classList.toggle("ecosystem-area--highlight",
		shouldHighlightEcosystemArea(area, effectiveEcosystemRegionId()));
	element.classList.toggle("ecosystem-area--picked",
		shouldHighlightEcosystemArea(area, contouredEcosystemRegionId()));
}

function applyEcosystemHighlight() {
	if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
		return;
	}
	ecosystemLayers.forEach(applyEcosystemHighlightClass);
}

// Beide Setzer gehen durch denselben Trichter: erst den Zustand ändern, dann prüfen, ob sich die
// WIRKUNG überhaupt geändert hat.
//
// 💣 BEIDE Ableitungen vergleichen, nicht nur die leuchtende. Solange es nur die Füllung gab, genügte
// die eine -- mit der Kontur nicht mehr, und der Fall sieht harmlos aus: Maus auf das Label (leuchtet),
// dann KLICK. Die leuchtende Region bleibt dieselbe, die Kontur aber müsste dazukommen. Wer nur die
// eine vergleicht, überspringt genau den Klick, um den es geht -- und die Kontur erscheint erst, wenn
// die Maus einmal woanders war. Gefunden im Durchlauf, nicht im Kopf.
function updateEcosystemHighlight(change) {
	const vorher = effectiveEcosystemRegionId() + "|" + contouredEcosystemRegionId();
	change();
	if (effectiveEcosystemRegionId() + "|" + contouredEcosystemRegionId() !== vorher) {
		applyEcosystemHighlight();
	}
}

function setHighlightedEcosystemRegion(regionPublicId) {
	updateEcosystemHighlight(() => {
		clickedEcosystemRegionId = String(regionPublicId || "");
		// Ein Klick beendet die Vorschau: von hier an gilt, was angeklickt wurde. Ohne das bliebe der
		// geliehene Zustand liegen und überstimmte beim nächsten Zeichnen die frische Wahl.
		hoveredEcosystemRegionId = "";
	});
}

function setHoveredEcosystemRegion(regionPublicId) {
	updateEcosystemHighlight(() => {
		hoveredEcosystemRegionId = String(regionPublicId || "");
	});
}

// 💣 EIN Zuhörer, im DOKUMENT und in der EINFANGPHASE. Nicht `map.on("click")`: der feuert nicht, wenn
// der Klick einen Ort, einen Weg oder ein Popup trifft -- die Hervorhebung bliebe dann stehen, während
// nebenan eine Infobox aufgeht. In der Einfangphase läuft dieser Zuhörer VOR den eigenen Handlern der
// Ziele; trifft der Klick eines der beiden Ziele selbst, hält er sich heraus und der Marker setzt die
// Region gleich neu.
//
// 🪤 ZWEI Ziele, und beide müssen hier stehen: der Zonenname am Kartenrand und ein Karten-Label, das an
// einer Fläche hängt. Wer eines vergisst, bekommt ein Aufblitzen -- gesetzt und im selben Wimpernschlag
// wieder gelöscht.
//
// 🔴 Und NUR ein Label mit Fläche (`--has-eco-region`, gesetzt in map-features-labels.js). Stünde hier
// `.map-label`, liesse ein Klick auf einen beliebigen Ortsnamen die vorige Fläche stehen -- der Nutzer
// hat woanders hingeklickt, und es passierte nichts.
const ECOSYSTEM_HIGHLIGHT_SOURCES = ".ecosystem-climate-name, .map-label--has-eco-region";

if (typeof document !== "undefined" && !document.__avesmapsEcosystemHighlightBound) {
	document.__avesmapsEcosystemHighlightBound = true;
	document.addEventListener("click", (event) => {
		const aufQuelle = event.target && typeof event.target.closest === "function"
			&& event.target.closest(ECOSYSTEM_HIGHLIGHT_SOURCES);
		if (!aufQuelle) {
			setHighlightedEcosystemRegion("");
		}
	}, true);
}

// 🔴 DIE ART STEHT HIER MIT IHRER BEZEICHNUNG, NICHT MIT IHREM SCHLÜSSEL (Owner 2026-07-28). Bis heute
// stand `region_type` im Zettel -- das ist ein Verbindungsschlüssel (`wald`, `suempfe_moore`) und
// kleingeschrieben, weil Schlüssel so aussehen. Im Zettel las sich das wie ein Tippfehler. Die
// lesbare Form kommt aus `ecosystem_region_type.label` und reist seit heute als `region_type_label`
// im Lesepfad mit (api/_internal/app/ecosystem.php). Fehlt sie, bleibt der Schlüssel stehen -- besser
// ein Schlüssel als ein leerer Zettel.
//
// 🔴 DIE ZAHLEN KOMMEN VOM SERVER. Die geladenen Ebenen halten nur, was im Ausschnitt liegt (der
// Endpunkt filtert nach bbox); daraus gezählt hiesse der Zettel „Flächen im Bild" und änderte seine
// Aussage beim Verschieben der Karte. Dieselbe Lehre steht an der Trägerzeile im Label-Dialog.
//
// Der Zusatz „· Erprobung" ist am 2026-07-28 entfallen (Owner: „das Erprobungs-Kennzeichen kann
// insgesamt raus — die brauchen wir weder in den Flächen noch im Derographiemenü"). Die Spalte
// `is_trial` bleibt vorerst in der Datenbank; sie wird hier nur nicht mehr angezeigt.
// Name und Art einer Fläche in lesbarer Form -- EINE Stelle, mehrere Leser (Schwebezettel, Panel-
// Rückfall). Getrennt gepflegt driften sie auseinander, und dann nennt der Zettel etwas anderes als die
// Überschrift, die auf ihn folgt.
function ecosystemAreaDisplayName(area) {
	return String(area?.region_name || "").trim() || "Ohne Namen";
}

function ecosystemAreaTypeLabel(area) {
	return String(area?.region_type_label || area?.region_type || "").trim()
		|| ECOSYSTEM_KIND_LABELS[area?.kind] || String(area?.kind || "").trim();
}

function formatEcosystemAreaTooltip(area) {
	const regionName = ecosystemAreaDisplayName(area);
	// Die ART, und sonst die Ebene. Owner 2026-08-03: „Eisenwald (Gebirge)" reicht -- die Ebene und
	// die Zählung „· Flächen (3) und Labels (2)" sind aus dem Zettel raus. Wer zeichnet, weiss in
	// welcher Ebene er arbeitet, und wie viele Teile eine Region hat, sagt ihr Dialog.
	// ⚠️ Die Ebene bleibt der Rückfall: eine Fläche ohne Art ist ein gültiger Zustand (der Dialog
	// bietet ihn als „— keine Vegetation —" an), und „Namenlos ()" wäre schlechter als gar keine
	// Klammer.
	const typeLabel = ecosystemAreaTypeLabel(area);

	return typeLabel ? `${regionName} (${typeLabel})` : regionName;
}

// ---- Der Klick auf eine Fläche: wer beantwortet ihn? -----------------------------------------------
//
// 🔴 IM FRONTEND BEANTWORTET EIN KLICK AUF DIE FLÄCHE DASSELBE WIE EINER AUF IHR LABEL (Owner
// 2026-08-12: „ein Klick auf die Regionen soll auch das Infopanel öffnen"). Bis dahin leuchtete die
// Fläche nur und ein Schwebezettel nannte ihren Namen -- dieselbe Frage mit zwei Antworten, und die
// schlechtere traf den weitaus grösseren Anfasser: eine Fläche ist tausendmal grösser als ihr Schriftzug.
// Entwurf: docs/superpowers/specs/2026-08-12-landschaften-flaechenklick-infopanel-design.md
//
// 🔴 EINE FRAGE FÜR LEUCHTEN UND PANEL (§5.2). Beide sind die Antwort auf DIESELBE Geste; an zwei
// getrennten Bedingungen hängend liessen sie sich auseinander pflegen, und der Klick täte danach die
// Hälfte. Der Editor beantwortet denselben Klick mit „daran arbeite ich" -- Auswahl, Griffe, Ziel der
// Werkzeuge -- und bekommt deshalb keins von beidem.
//
// ⚠️ Wortgleich zur Bedingung, die die Hervorhebung seit 2026-08-04 trägt, inklusive ihrer Lesart bei
// fehlendem Nachbarn (dann passiert nichts). Hier steht sie nur EINMAL statt zweimal ausgeschrieben.
function isEcosystemReaderClick() {
	return typeof canOperateEcosystemLayers === "function" && !canOperateEcosystemLayers();
}

// Welche Quelle füllt das Panel: das Label der Fläche, oder die Fläche selbst?
//
// 🔴 DIE WAHL IST DIE REGEL, DAS MARKUP NUR IHRE AUSGABE. Deshalb hier getrennt vom Bauen: diese
// Funktion entscheidet ohne Leaflet, ohne DOM und ohne die Markup-Bauer -- und ist damit prüfbar, ohne
// dass ein Stub die Antwort vorwegnimmt. Zusammengelegt bewiese ein Test „es kam Markup", nicht „es kam
// das richtige".
//
// Das primäre Label reist mit der Fläche mit (`label_public_id`, aus `ecosystem_region` --
// avesmapsEcosystemReadAreas). Es muss also nichts geraten und nichts nachgeladen werden.
//
// 💣 EIN ZEIGER IST KEIN LABEL: `ecosystem_region.label_public_id` überlebt ein von Hand gelöschtes
// Label. Der Rückfall auf die Fläche fängt deshalb DREI Zustände in einem einzigen Zweig -- kein
// primäres Label, toter Zeiger, Label nicht im geladenen Bestand. Keiner braucht eine eigene Frage:
// wer nicht gefunden wird, bekommt das Flächen-Panel.
function ecosystemAreaInfoSource(area, labels) {
	if (!area) {
		return null;
	}
	const labelPublicId = String(area.label_public_id || "");
	const list = Array.isArray(labels) ? labels : [];
	const label = labelPublicId
		? list.find((row) => String(row?.publicId || "") === labelPublicId)
		: null;

	return label ? { kind: "label", label } : { kind: "area", area };
}

// Das Panel-Markup zur gewählten Quelle.
//
// ⚠️ KEIN eigener Bauplan und KEIN eigener Bildkatalog. Der Label-Zweig ruft denselben Bauer wie der
// Label-Klick; der Rückfall nutzt dieselbe Hülle (`locationPopupMarkup`) und dieselbe Bildtabelle
// (`regionHeaderImageBasename`, deren Rückfall „region" ein gültiges Bild ist). Ein zweites Markup wäre
// die Divergenz, gegen die dieses Feature überhaupt gebaut wurde.
function ecosystemAreaInfoMarkup(source) {
	if (!source) {
		return "";
	}
	if (source.kind === "label") {
		return typeof buildRegionLabelViewPopupHtml === "function"
			? buildRegionLabelViewPopupHtml(source.label)
			: "";
	}
	if (typeof locationPopupMarkup !== "function") {
		return "";
	}
	// Name + Art, also wörtlich das, was bis heute im Schwebezettel stand -- nur an dem Ort, an dem der
	// Leser Auskunft erwartet. Mehr weiss die Fläche nicht: Wiki-Zeilen hängen am Label, und wo eines
	// ist, greift der Zweig darüber.
	const name = ecosystemAreaDisplayName(source.area);
	const typeLabel = ecosystemAreaTypeLabel(source.area);
	// Untertitel: Art und Ebene, „Gebirge · Topographie" -- dieselbe Bauart wie bei einer Siedlung
	// („Metropole · Hauptstadt von X").
	//
	// 💣 JEDES WORT NUR EINMAL, UND KEINES, DAS SCHON IN DER ÜBERSCHRIFT STEHT. Die Landschaftsdaten
	// lassen beide Wiederholungen zu, und beide standen live auf dem Schirm:
	//   · Name = Art -- „Gemäßigte Zone" heisst so UND ist von dieser Art. Ungefiltert las sich das
	//     Panel „Gemäßigte Zone / Gemäßigte Zone · Klimazonen".
	//   · Art = Ebene -- eine Fläche ohne eigene Art trägt die Ebene bereits als ihre Art (siehe
	//     ecosystemAreaTypeLabel), und daraus wurde „Klimazonen · Klimazonen".
	// Deshalb hier eine Liste, die sich selbst bereinigt, statt zweier Sonderfragen: die Regel ist
	// „sag nichts zweimal", nicht „prüfe diese beiden Paare".
	//
	// ⚠️ Gefunden erst im echten Durchlauf auf der Karte -- die Unit-Tests waren dabei alle grün.
	const kindLabel = ECOSYSTEM_KIND_LABELS[source.area?.kind] || "";
	const untertitelTeile = [typeLabel, kindLabel]
		.map((wort) => String(wort || "").trim())
		.filter((wort, index, liste) => wort !== "" && wort !== name && liste.indexOf(wort) === index);
	// 🔴 Das Kopfbild kommt aus der ART, auch wenn die im Untertitel weggefiltert wurde: es bebildert,
	// WAS die Fläche ist, nicht was danebensteht.
	const headerImg = typeof infoHeaderImageMarkup === "function" && typeof regionHeaderImageBasename === "function"
		? infoHeaderImageMarkup(
			regionHeaderImageBasename(typeLabel),
			name,
			untertitelTeile[0] || "",
			null,
			null,
			untertitelTeile[1] && typeof escapeHtml === "function" ? escapeHtml(untertitelTeile[1]) : ""
		)
		: "";

	return locationPopupMarkup({
		name,
		locationTypeLabel: typeLabel,
		headerImageMarkup: headerImg,
		showHeaderIcon: false,
		compact: true,
		showType: Boolean(typeLabel),
		showDescription: false,
		showWikiLink: false,
	});
}

// Zeigt das Panel zu dieser Fläche. Rückgabe: hat es etwas gezeigt? Der Aufrufer entscheidet daran, ob
// sein Schwebezettel noch nötig ist -- zwei Meldungen mit demselben Satz sind eine zu viel.
//
// 💣 KEIN panTo. Der Label-Klick zentriert die Karte; hier wäre das falsch -- der Leser klickt auf das,
// was er ohnehin vor sich hat, und ein Sprung unter dem Zeiger ist Lärm. Der Unterschied ist gewollt
// und darf nicht „vereinheitlicht" werden (§5.1).
function showEcosystemAreaInfopanel(area) {
	if (!isEcosystemReaderClick()) {
		return false;
	}
	// Ohne Panel-Modus gibt es kein Ziel, und dann bleibt alles wie zuvor -- so hält es der Label-Klick
	// auch (map-features-labels.js).
	if (typeof IS_INFOPANEL_MODE === "undefined" || !IS_INFOPANEL_MODE
		|| typeof window === "undefined" || typeof window.avesmapsShowInfopanel !== "function") {
		return false;
	}
	const source = ecosystemAreaInfoSource(area, typeof labelData === "undefined" ? [] : labelData);
	const markup = ecosystemAreaInfoMarkup(source);
	if (!markup) {
		return false;
	}
	const activeName = source.kind === "label"
		? (source.label.text || (source.label.wikiRegion && source.label.wikiRegion.name) || "")
		: ecosystemAreaDisplayName(area);
	window.avesmapsShowInfopanel(markup, activeName);

	return true;
}

// ---- Stapelreihenfolge -------------------------------------------------------------------------
//
// 🔴 SIE STEHT IN DER DATENBANK (Owner 19.08.2026: „die sortierung muss eine karteneigenschaft
// werden"). Alle Flächen einer Ebene liegen in EINER SVG-Gruppe, und dort gewinnt, wer zuletzt
// gezeichnet wurde -- wer oben liegt, nimmt auch den Klick. Diese Reihenfolge ist jetzt ein Wert an
// der Region (`stack_order`, api/_internal/app/ecosystem.php) und keine Rechnung mehr.
//
// 💣 BIS ZUM 19.08.2026 RECHNETE SIE HIER: nach Flächeninhalt, gross unten, klein oben (Owner
// 2026-07-28, Punkt 9). Die Regel ist EINMAL gelaufen, als Startaufstellung auf dem Server
// (`avesmapsEcosystemSeedStackOrder`, api/_internal/app/ecosystem-stapel.php), und danach aufgelöst.
// SIE NICHT WIEDERBELEBEN: eine zweite, gerechnete Ordnung neben der gespeicherten sieht auf dem
// Bildschirm gleich aus und widerspricht dem, was im Fenster „Reihenfolge und Sperren" steht.
//
// ⚠️ `ecosystemGeometryArea` bleibt und ist NICHT die Regel -- sie trägt die Plausibilitätsprüfung
// der booleschen Operationen (map-features-ecosystem-boolean.js) und die Höhenkombination.
//
// ⭐ Die gespeicherte Zahl verträgt sich zudem besser mit dem Nachladen: der Loader lädt nach bbox,
// und eine Zahl ordnet auch eine Teilmenge richtig, während eine Größenregel über eine Teilmenge nur
// zufällig dasselbe Ergebnis hatte.
//
// 🪤 STABIL bei Gleichstand. Zwei Flächen mit derselben Zahl behalten ihre Eingangsreihenfolge --
// sonst würfelte jedes Nachladen die Stapelung neu, und ein Klick träfe beim zweiten Mal etwas
// anderes. Array.prototype.sort IST seit ES2019 stabil; der Index-Vergleich macht es unabhängig
// davon ausdrücklich.
//
// Rein und ohne Leaflet, damit die Regel prüfbar ist: der Aufrufer holt die Flächen in dieser
// Reihenfolge nach vorn (bringToFront), womit die vorderste zuletzt und damit ganz oben landet.
function ecosystemStapelOrdnung(areas) {
	const list = Array.isArray(areas) ? areas : [];
	const gemessen = list.map((area, index) => ({
		publicId: String(area?.public_id || ""),
		index,
		// Ohne Zahl zählt 0: die Fläche ist noch nicht einsortiert (frisch angelegt, alter Payload)
		// und liegt hinten. `|| 0` fängt zugleich NaN ab -- eine NaN-Sortierung ist keine.
		rang: Number(area?.stack_order) || 0,
	})).filter((eintrag) => eintrag.publicId !== "");

	gemessen.sort((links, rechts) => (links.rang - rechts.rang) || (links.index - rechts.index));

	return gemessen.map((eintrag) => eintrag.publicId);
}

// Die berechnete Reihenfolge auf die Karte anwenden. Getrennt von der Regel, weil hier Leaflet ins
// Spiel kommt und die Regel ohne Karte testbar bleiben soll.
function applyEcosystemStackingOrder() {
	if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
		return;
	}
	const areas = [];
	ecosystemLayers.forEach((layer) => {
		if (layer?._ecosystemArea) {
			areas.push(layer._ecosystemArea);
		}
	});
	// Je Ebene getrennt: die drei Panes sind ohnehin gestapelt (derographisch unten, Topographie oben),
	// und eine gemeinsame Sortierung über alle drei würde nur innerhalb jeder Pane wirken -- aber die
	// Reihenfolge dazwischen unnötig durcheinanderbringen.
	ECOSYSTEM_KINDS.forEach((kind) => {
		ecosystemStapelOrdnung(areas.filter((area) => String(area?.kind || "") === kind)).forEach((publicId) => {
			ecosystemLayers.get(publicId)?.bringToFront?.();
		});
	});
}

// Selecting is what proves "only the active layer answers" (plan V3.0, step 7). It is deliberately
// the whole of the interaction in V3.0 -- the vertex editor is V3.3 and the context menu is V3.4.
function setSelectedEcosystemArea(publicId) {
	const nextId = String(publicId || "");
	if (nextId === selectedEcosystemAreaPublicId) {
		return;
	}

	const previousId = selectedEcosystemAreaPublicId;
	selectedEcosystemAreaPublicId = nextId;
	[previousId, nextId].forEach((id) => {
		const layer = id && ecosystemLayers instanceof Map ? ecosystemLayers.get(id) : null;
		if (layer) {
			applyEcosystemSelectionClass(layer);
		}
	});

	// V3.3: the selection IS the vertex-edit session -- a selected area grows handles, a deselected one
	// loses them and flushes whatever is still pending. Routing it through here means switching the
	// layer, leaving the mode and clearing the registry all close an open edit without any of them
	// having to know the editor exists. Guarded, so V3.0's behaviour survives the file being absent.
	if (typeof syncEcosystemGeometryEdit === "function") {
		syncEcosystemGeometryEdit();
	}
	syncEcosystemDoubleClickZoom();
}

// 🔴 IN DER LANDSCHAFTEN-EBENE ZOOMT EIN DOPPELKLICK ÜBERHAUPT NICHT (Owner 2026-07-27).
//
// Zuerst hing das an drei Zuständen -- ausgewählt, in Bearbeitung, im Zeichnen. Das war zu fein
// gedacht: der Doppelklick ist in dieser Ebene eine ARBEITSGESTE und sonst nichts. Er schliesst eine
// Zeichnung ab, öffnet den Ecken-Editor, löscht eine Ecke, beendet eine Sitzung. Jeder Doppelklick,
// der keine davon trifft, ist ein Verklicken -- und die Antwort darauf war ein Zoomsprung, der die
// Karte unter der Arbeit wegzieht. Es gibt in dieser Ebene keinen Doppelklick, der Zoom BEDEUTEN soll.
//
// 💣 EINE Stelle entscheidet. Leaflets doubleClickZoom zählt nicht mit, also darf niemand sonst
// enable() rufen: der Ecken-Editor tat das beim Schliessen und machte den Zoom damit mitten in der
// Arbeit wieder scharf. Die anderen rufen jetzt diese Funktion.
function syncEcosystemDoubleClickZoom() {
	if (typeof map === "undefined" || !map || !map.doubleClickZoom) {
		return;
	}
	// 🔴 „In der Ebene" reicht seit 2026-08-04 NICHT mehr. Seit sie jedem Besucher offensteht, säße er
	// sonst auf einer Karte, die nicht mehr auf Doppelklick zoomt -- und er hat nichts zu zeichnen, was
	// den Entzug rechtfertigte. Der Doppelklick gehört dem, der auch die Werkzeuge bekommt.
	const inEcosystemLayer = typeof isEcosystemLayerModeActive === "function" && isEcosystemLayerModeActive()
		&& (typeof canOperateEcosystemLayers !== "function" || canOperateEcosystemLayers());
	// Zeichnen und Ecken-Bearbeitung sind ohnehin nur dort möglich; sie stehen trotzdem hier, damit die
	// Antwort auch dann stimmt, wenn der Moduswechsel noch nicht durchgelaufen ist.
	const editing = typeof activeEcosystemGeometryEdit !== "undefined" && Boolean(activeEcosystemGeometryEdit);
	const drawing = typeof isEcosystemDrawing === "function" && isEcosystemDrawing();
	if (inEcosystemLayer || editing || drawing) {
		map.doubleClickZoom.disable();
	} else {
		map.doubleClickZoom.enable();
	}
}

function getSelectedEcosystemAreaPublicId() {
	return selectedEcosystemAreaPublicId;
}

// One area row -> one Leaflet layer, or null when the row is unusable. The caller registers it.
function buildEcosystemAreaLayer(area) {
	const kind = String(area?.kind || "");
	const paneName = ECOSYSTEM_KIND_PANES[kind];
	const latlngs = ecosystemAreaLatLngs(area?.geometry);
	if (!paneName || !latlngs) {
		return null;
	}

	const layer = L.polygon(latlngs, {
		pane: paneName,
		// Every area stays interactive; whether it actually answers is decided by the PANE it sits in
		// (see .ecosystem-pane--resting in css/features/ecosystem-layer.css). That is the whole reason
		// there are three panes: switching must not have to rebuild layers.
		interactive: true,
		...ecosystemAreaStyle(kind, area.region_type),
	});

	layer._ecosystemArea = area;
	layer.bindTooltip(formatEcosystemAreaTooltip(area), { sticky: true, direction: "top" });
	// 🔴 WÄHREND EINER BEARBEITUNG SCHWEIGT ER (Owner 2026-07-28). Der Tooltip ist eine Auskunft für den,
	// der die Karte LIEST -- beim Malen, Zeichnen, Ziehen oder Eckenschieben klebt er am Zeiger, verdeckt
	// genau die Stelle, an der gearbeitet wird, und beantwortet eine Frage, die niemand gestellt hat.
	//
	// 🪤 Am `tooltipopen` abgefangen und nicht an den Zuständen vorbei entschieden: die Bearbeitung kann
	// beginnen, während er schon offen steht, und sie kann enden, ohne dass der Zeiger sich bewegt. Hier
	// wird beides richtig -- er geht sofort zu und kommt erst wieder, wenn wirklich nichts mehr läuft.
	// 🔴 MIT EINER AUSNAHME: DER ZIELWAHL (Owner 20.08.2026). Bei den Zwei-Flächen-Gesten („Mit anderer
	// vereinigen" …) ist der Zeiger kein WERKZEUG, sondern ein AUSWÄHLER -- und dann ist der Zettel
	// genau die Antwort auf die Frage, die man gerade stellt: welche Fläche ist das? Die Begründung
	// oben trifft weiterhin auf Malen, Zeichnen, Verschieben und Zerschneiden zu, und dort schweigt er.
	//
	// ⚠️ Die Frage lautet „wartet eine ZIELWAHL", nicht „läuft irgendetwas" -- `isPickingTarget` und
	// nicht `isPending`. Sonst käme der Zettel auch beim Verschieben zurück, wo er die Stelle verdeckt.
	layer.on("tooltipopen", () => {
		if (isEcosystemEditingInProgress() && !window.AvesmapsEcosystemGeometryOps?.isPickingTarget?.()) {
			layer.closeTooltip();
		}
	});
	layer.on("click", (event) => {
		// 💣 While the drawing tool is running, a click on an existing area is a CORNER, not a
		// selection -- so this handler must neither select nor stop the event, or no area could ever
		// be drawn across another one. Overlap and nesting are normal here (Schneckenkamm lies inside
		// the Windhagberge), so that case is the rule, not the exception.
		if (typeof isEcosystemDrawing === "function" && isEcosystemDrawing()) {
			return;
		}
		// 🔴 DIESELBE REGEL, ZWEITER FALL: eine Geste, die den Klick schon vergeben hat, bekommt ihn
		// zuerst. Verschieben und Zerschneiden schliessen über KARTENklicks ab (handleAreaClick weist
		// beide ausdrücklich zurück) -- also darf dieser Handler den Klick nicht vorher schlucken.
		//
		// 💣 Genau daran war „Fläche verschieben" unbenutzbar: previewGeometry zieht die ECHTE Ebene mit
		// dem Zeiger, die Fläche liegt also immer darunter, und ihr eigenes stopPropagation fing den
		// platzierenden Klick ab, bevor map.on("click") ihn je sah. Die Fläche klebte am Cursor, bis ESC
		// half. Beim Zerschneiden dasselbe -- Schnittpunkte liegen zwangsläufig AUF der Fläche.
		if (window.AvesmapsEcosystemGeometryOps?.claimsMapClick?.()) {
			return;
		}
		// 🔴 Dasselbe für „Grenze aus Territorien" (Fall #68): solange dieses Fenster offen ist, IST ein
		// Kartenklick die Wahl eines Territoriums. Ohne diesen Ausstieg schluckte die Fläche darunter ihn,
		// und da die Ebene fast lückenlos gezeichnet ist, gäbe es kaum eine Stelle, an der er ankäme.
		if (window.AvesmapsEcosystemTerritoryImport?.claimsMapClick?.()) {
			return;
		}
		// 🔴 GESPERRT HEISST: DIESER KLICK GEHÖRT MIR NICHT. Er geht an das, was darunter liegt, oder
		// an die Karte. VOR dem stopPropagation darunter -- danach wäre er geschluckt. Begründung und
		// Verfahren in map-features-ecosystem-sperre.js.
		//
		// ⭐ Damit ist auch die ZIELWAHL erledigt: `handleAreaClick` weiter unten bekommt den Klick
		// erst, wenn diese Weiche ihn durchgelassen hat. Bei einer gesperrten Region läuft der
		// Handler der Fläche DARUNTER, und die wird zum Ziel -- ohne zweite Sperre an zweiter Stelle.
		if (window.avesmapsEcosystemReichtWeiter?.(layer, event)) {
			return;
		}
		if (event?.originalEvent && typeof L?.DomEvent?.stopPropagation === "function") {
			L.DomEvent.stopPropagation(event);
		}
		// Der Schwebezettel hat seine Arbeit getan, sobald geklickt wurde -- er ist eine Vorschau auf das,
		// was der Klick trifft. Er bleibt sonst stehen und legt sich über das, was danach aufgeht.
		layer.closeTooltip?.();
		// 🔴 Läuft gerade eine Zwei-Flächen-Operation, IST dieser Klick die Zielwahl -- nicht das
		// gewohnte Auswählen. Dieselbe Bauart wie der isEcosystemDrawing()-Riegel oben: eine Geste, die
		// den Klick schon vergeben hat, bekommt ihn zuerst. Gewacht, damit diese Datei ohne
		// map-features-ecosystem-geometry-ops.js weiterläuft.
		if (window.AvesmapsEcosystemGeometryOps?.handleAreaClick?.(area.public_id)) {
			return;
		}
		// In „Alle" antworten alle drei Ebenen. Wer hier eine Fläche anklickt, meint sie -- und meint
		// damit auch ihre Ebene: die Arbeitsebene zieht mit, sonst legte das nächste „Neue Vegetation"
		// oder das nächste Zeichnen in einer Ebene an, die niemand mehr im Blick hat. „Alle" bleibt dabei
		// stehen, und die Auswahl überlebt (der Wechsel räumt sie in diesem Modus nicht weg).
		if (typeof isEcosystemShowAllLayers === "function" && isEcosystemShowAllLayers()
			&& typeof setActiveEcosystemLayerKind === "function" && area.kind) {
			setActiveEcosystemLayerKind(area.kind);
		}
		// 🔴 Im FRONTEND beantwortet ein Klick auf die Fläche dasselbe wie einer auf ihr Label: die
		// Fläche leuchtet auf (Owner 2026-08-04: „beim Frontendmodus dürfen die Klimazonen anklickbar
		// sein"). Ein Klimaband ist genau dann anklickbar, wenn es die GEWÄHLTE Ebene ist -- in „Alle"
		// bleibt es klickdurchlässig, sonst verschluckte es jeden Klick auf den Wald darunter.
		//
		// Der Editor behält stattdessen seine Auswahl: dort heisst ein Klick „daran arbeite ich", und
		// zwei Konturen mit verschiedener Bedeutung auf einer Fläche sagen nichts mehr.
		//
		// 🔴 UND SEIT 2026-08-12 GEHT DABEI DAS INFOPANEL AUF -- dieselbe Auskunft, die ein Klick auf
		// das Label schon immer gab (Owner: „ein Klick auf die Regionen soll auch das Infopanel
		// öffnen"). 💣 An DERSELBEN Frage wie das Leuchten (`isEcosystemReaderClick`), nicht an einer
		// zweiten daneben: es ist EINE Geste, und zwei Bedingungen liessen sich auseinander pflegen --
		// danach täte der Klick die Hälfte.
		let zeigtPanel = false;
		if (isEcosystemReaderClick()) {
			if (typeof setHighlightedEcosystemRegion === "function") {
				setHighlightedEcosystemRegion(area.region_public_id || "");
			}
			zeigtPanel = showEcosystemAreaInfopanel(area);
		}
		setSelectedEcosystemArea(area.public_id);
		// Der Schwebezettel nur noch dort, wo KEIN Panel aufgeht: er sagt denselben Satz, den das Panel
		// als Überschrift trägt. Im Editor bleibt er stehen -- dort ist er die einzige Rückmeldung.
		if (!zeigtPanel && typeof showFeedbackToast === "function") {
			showFeedbackToast(formatEcosystemAreaTooltip(area));
		}
	});

	// V3.3: DOUBLE-CLICK opens the vertex editor -- a single click still only selects (owner
	// 2026-07-26). Not merely taste: opening on the selection would let the FIRST click of a
	// double-click raise the handles and the second one land on a handle that has just appeared, and a
	// double-click on a handle deletes a corner. That is the collision V3.2 flagged for the drawing
	// tool. Stopping the event also keeps it from reaching the map, where doubleClickZoom would fire and
	// where a double-click means "finish editing".
	layer.on("dblclick", (event) => {
		if (typeof isEcosystemDrawing === "function" && isEcosystemDrawing()) {
			return;
		}
		// 🔴 EINE FLÄCHE BEARBEITET NUR, WER DIE WERKZEUGE HAT (Owner 2026-08-05: „ohne avesmaps.de/edit/
		// darf ich nirgendwo Regionen editieren"). Bis 2026-08-04 war der MODUS der Riegel -- in die Ebene
		// kam nur ein Editor mit Recht, also brauchte diese Geste keinen eigenen. Seit die Ebene jedem
		// Besucher offensteht, trägt sie ihre Frage selbst.
		//
		// 🪤 OHNE `stop` aussteigen, also VOR der Zeile darunter. Das Ereignis läuft dann weiter zur Karte,
		// und der Besucher behält seinen Doppelklick-Zoom -- den syncEcosystemDoubleClickZoom ihm seit
		// 2026-08-04 ohnehin lässt. Mit `stop` wäre der Doppelklick auf einer Fläche schlicht tot.
		//
		// 💣 FEHLT DIE FRAGE, IST DIE ANTWORT NEIN. `!== "function"` und nicht das im Haus übliche
		// `typeof … === "function" && …`: das ist ein Recht, kein Komfort, und ein Riegel, der bei
		// fehlendem Nachbarn aufgeht, ist keiner.
		if (typeof canOperateEcosystemLayers !== "function" || !canOperateEcosystemLayers()) {
			return;
		}
		// 🔴 Gesperrt: dieselbe Weiche wie beim Klick, und aus demselben Grund VOR dem `stop`.
		// map-features-ecosystem-sperre.js
		if (window.avesmapsEcosystemReichtWeiter?.(layer, event)) {
			return;
		}
		if (event?.originalEvent) {
			L.DomEvent.stop(event);
		}
		// Already editing? Then a double-click on an EDGE inserts one corner there (owner 2026-07-26).
		if (typeof handleEcosystemEditEdgeDoubleClick === "function" && handleEcosystemEditEdgeDoubleClick(event)) {
			return;
		}
		// 💣 And a double-click anywhere ELSE inside an area already being edited does NOTHING. Calling
		// open again would close and re-open the session, which throws the undo stack away -- a second
		// double-click would silently cost every step you could still have taken back.
		if (typeof isEcosystemGeometryEditOpen === "function" && isEcosystemGeometryEditOpen(area.public_id)) {
			return;
		}
		if (typeof openEcosystemGeometryEdit === "function") {
			openEcosystemGeometryEdit(area.public_id);
		}
	});

	// V3.4: a landscape area has its OWN context menu (delete first, "Kopieren ..." from V3.6). Stopping
	// the event is what keeps #map-context-menu from opening on top of it -- Leaflet would otherwise carry
	// the contextmenu on to map.on("contextmenu") (js/app/bootstrap.js:701), and L.DomEvent.stop is also
	// what suppresses the browser's own menu, since the map handler that normally does that never runs.
	//
	// 💣 While DRAWING it bails without stopping, exactly like the click handler above: a right-click is
	// not a corner, so the map menu staying reachable is the status quo, and swallowing the event here
	// would be a rule about a gesture this file has no opinion on.
	layer.on("contextmenu", (event) => {
		if (typeof isEcosystemDrawing === "function" && isEcosystemDrawing()) {
			return;
		}
		// 🔴 DASSELBE AM RECHTSKLICK -- und hier wog es schwerer: dieses Menü trägt „Eigenschaften …",
		// „Fläche löschen", malen, radieren, vereinfachen, verschmelzen, zerschneiden, verschieben.
		// Für einen ANGEMELDETEN Editor auf der öffentlichen Karte gingen die Schreibvorgänge WIRKLICH
		// durch: api/edit/map/ecosystem.php fragt das Sitzungs-Cookie, nicht ob jemand in /edit/ steht.
		//
		// 🪤 OHNE `stop`, genau wie der Strg-Notausgang darunter: so bekommt der Besucher hier das
		// gewöhnliche Kartenmenü („Hierher reisen", „Entfernung messen", „Hier melden") statt eines
		// verschluckten Klicks. Begründung zur Fehlerrichtung: siehe dblclick oben.
		if (typeof canOperateEcosystemLayers !== "function" || !canOperateEcosystemLayers()) {
			return;
		}
		// 🔴 STRG + RECHTSKLICK ERZWINGT DAS KARTENMENÜ (Owner 2026-07-29). Die Ebene ist so dicht
		// gezeichnet, dass es kaum noch freie Karte gibt -- und ohne freie Karte war „Entfernung messen",
		// „Suchen", „Hier melden" und „Stelle markieren" schlicht nicht mehr erreichbar. Die vier
		// Anlege-Einträge führt das Flächenmenü inzwischen selbst mit; für den ganzen Rest ist das hier
		// der Notausgang.
		//
		// 🪤 Ohne `stop` aussteigen, nicht mit. Genau das reicht das Ereignis an map.on("contextmenu")
		// weiter, und DORT wird preventDefault gerufen -- das Browsermenü bleibt also weg, ohne dass
		// diese Zeile es selbst unterdrücken müsste. Ein `L.DomEvent.stop` hier täte das Gegenteil von
		// dem, was der Griff bezweckt.
		//
		// 💣 Strg ist in dieser Ebene dreifach belegt -- Rad = Pinselgröße, Klick auf eine Kante = vier
		// Ecken, Strg+Z = zurück. Alle drei sind andere Gesten; die RECHTE Maustaste war frei.
		if (event?.originalEvent?.ctrlKey || event?.originalEvent?.metaKey) {
			return;
		}
		// 🔴 Gesperrt: derselbe Weg wie beim Klick. Liegt eine Fläche darunter, geht IHR Menü auf;
		// liegt keine darunter, fällt das Ereignis ohne `stop` durch und die Karte öffnet ihr Menü --
		// genau der Notausgang, den der Strg-Griff darüber von Hand anbietet, hier von selbst.
		// map-features-ecosystem-sperre.js
		if (window.avesmapsEcosystemReichtWeiter?.(layer, event)) {
			return;
		}
		if (!window.AvesmapsEcosystemAreaMenu) {
			return;
		}
		if (event?.originalEvent) {
			L.DomEvent.stop(event);
		}
		// 💣 VOR dem Öffnen des Menüs. Der Zettel ist `sticky` und hängt am Zeiger -- genau dort, wo das
		// Menü aufgeht. Er verdeckte sonst die oberen Einträge (Owner-Screenshot 2026-07-27).
		layer.closeTooltip?.();
		window.AvesmapsEcosystemAreaMenu.open(area, event);
	});

	return layer;
}

// Node-Export für die Einheitentests (Hausmuster, wie map-features-ecosystem-boolean.js). Im Browser
// existiert `module` nicht, dort bleiben die Funktionen schlicht global.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		ECOSYSTEM_KINDS,
		ECOSYSTEM_KIND_LABELS,
		ECOSYSTEM_KIND_PREFIX,
		isKnownEcosystemKind,
		isDerivedEcosystemKind,
		ecosystemDialogTitle,
		formatEcosystemAreaTooltip,
		ecosystemStapelOrdnung,
	};
}
