// Landschaften -- the segment switch "Derographie · Vegetation · Topographie · Klimazonen"
// (plan V3.0, steps 1 and 5). It owns exactly two things: which kind is ACTIVE, and how the three
// panes look because of it. It never loads and never re-renders a layer.
//
// 🔴 THREE VISIBILITY GATES, NOT ONE. The template (#political-timeline) hangs on
// `getSelectedMapLayerMode() === "political"` AND an edit/read-only gate
// (map-features-political-timeline.js:19). Copying only the mode check would show this switch to an
// anonymous visitor who landed in the mode through somebody else's link. The dead-man switch has a
// station here (plan, global rule 4, station 6): mode + IS_EDIT_MODE + IS_ECOSYSTEM_ENABLED.
//
// 🔴 Switching does NOT reload and does NOT drop anything. All three layers stay on the map; only the
// pane classes change, which is why `pointer-events` had to be a pane property in the first place.
// (Once V3.3 brings a vertex editor, an open edit has to be committed BEFORE the switch runs -- there
// is no edit session to protect yet, so there is nothing to hook here now.)

const ECOSYSTEM_ACTIVE_KIND_STORAGE_KEY = "avesmaps.ecosystem.activeKind";

// Vegetation first: that is where most of the drawing work is (plan V3.0, step 1).
const ECOSYSTEM_DEFAULT_KIND = "vegetation";

let ecosystemLayerSwitchBound = false;

function readStoredEcosystemLayerKind() {
	try {
		const stored = window.localStorage?.getItem(ECOSYSTEM_ACTIVE_KIND_STORAGE_KEY) || "";
		return isKnownEcosystemKind(stored) ? stored : ECOSYSTEM_DEFAULT_KIND;
	} catch (error) {
		// Blocked storage (private mode, hardened profile) is not an error worth a console line.
		return ECOSYSTEM_DEFAULT_KIND;
	}
}

function storeEcosystemLayerKind(kind) {
	try {
		window.localStorage?.setItem(ECOSYSTEM_ACTIVE_KIND_STORAGE_KEY, kind);
	} catch (error) {
		// see above
	}
}

function getActiveEcosystemLayerKind() {
	if (!isKnownEcosystemKind(activeEcosystemLayerKind)) {
		activeEcosystemLayerKind = readStoredEcosystemLayerKind();
	}
	return activeEcosystemLayerKind;
}

// 🔴 SEIT 2026-08-04 SIND ES ZWEI FRAGEN, NICHT EINE (Owner: „das, was jetzt unter ‚Alle' ist, dem
// Frontendnutzer freischalten"):
//
//   ANSEHEN   -- isEcosystemLayerModeActive(): darf jeder. Die Ebene ist eine Ansicht der Karte wie
//                „Politisch" auch, und die Daten dahinter sind ohnehin öffentlich lesbar
//                (api/app/ecosystem-areas.php). Es gibt hier nichts mehr zu verriegeln.
//   BEDIENEN  -- canOperateEcosystemLayers(): Ebenenwahl, Untergrund-Regler, Zeichnen. Braucht ZWEI
//                Dinge: den Editor-Kontext UND das Recht.
//
// 💣 WER DIE BEIDEN WIEDER ZUSAMMENZIEHT, NIMMT ENTWEDER JEDEM BESUCHER DIE ANSICHT ODER GIBT JEDEM
// DIE WERKZEUGE. Der frühere Einzelriegel konnte nur das eine oder das andere.
// ⚠️ Die ZEICHNEN-Wege (context-action, territory-import) fragen weiterhin zusätzlich IS_EDIT_MODE.
function isEcosystemLayerModeActive() {
	return typeof getSelectedMapLayerMode === "function"
		&& getSelectedMapLayerMode() === "ecosystem";
}

// 💣 ZWEI BEDINGUNGEN, UND DIE ERSTE IST DER KONTEXT. Owner 2026-08-04, auf avesmaps.de stehend: „ich
// seh immer noch die Leiste -- die sollte ausgeblendet sein, egal was ich da noch für ein Flag im
// Hintergrund hab." Das Recht allein genügt also nicht: wer angemeldet ist, sieht die ÖFFENTLICHE Karte
// trotzdem so, wie jeder andere sie sieht. Die Werkzeuge gehören dem Editor (`?edit=1` / die
// Editor-Hülle), nicht dem Konto.
//
// 🪤 IS_EDIT_MODE ist hier KEIN Riegel und soll keiner sein -- es ist ein ungeprüfter URL-Parameter
// (siehe js/config.js). Der Riegel ist IS_ECOSYSTEM_ENABLED daneben; `?edit=1` sagt nur, WELCHE der
// beiden Oberflächen gemeint ist. Wer den Parameter anhängt, ohne das Recht zu haben, bekommt weiterhin
// nichts -- und der Schreibendpunkt fragt ohnehin selbst.
function canOperateEcosystemLayers() {
	return typeof IS_EDIT_MODE !== "undefined" && Boolean(IS_EDIT_MODE)
		&& typeof IS_ECOSYSTEM_ENABLED !== "undefined" && Boolean(IS_ECOSYSTEM_ENABLED);
}

// 🔴 SEIT 23.08.2026 SIND ES DREI FRAGEN. Die dritte ist nicht das Recht, sondern der ORT: „Alle“ ist
// eine ANSICHT, kein Arbeitsplatz (Owner: „anklicken (auch die flächen) ist ok, aber nix bearbeiten“).
// Wer dort steht, bekommt genau das, was der gewöhnliche Besucher im Landschaftsmodus bekommt.
//
// 💣 DER ANLASS. In „Alle“ antworten alle drei Ebenen, aber die gemerkte ARBEITSEBENE läuft darunter
// unverändert weiter — und KEINE Kachel ist hervorgehoben (syncEcosystemLayerSwitchControls, mit
// Absicht). Jede Geste arbeitete deshalb in einer Ebene, die niemand mehr im Blick hatte. So bekam die
// Weiden-Region den Namen „Harpyienbuckel“ und dazu eine Fläche im Süden der Heldentrutz; danach hiess
// auf der Karte ganz Weiden „Harpyienbuckel“. Eine Region trägt den Namen und darf VIELE Flächen
// halten — der Fehlgriff ist damit nicht auf die angefasste Fläche begrenzt.
//
// 🔴 SIE NIMMT DEM EDITOR NICHT SEIN RECHT. canOperateEcosystemLayers bleibt wahr — das Bedienfeld,
// der Untergrund-Regler und die Fenster, die ihre Ebene SELBST benennen („Reihenfolge und Sperren“,
// WikiSync → Regionen, das Änderungsprotokoll), arbeiten in „Alle“ weiter. Dort ist nie unklar, worauf
// geschrieben wird; auf der Karte war es das.
//
// 💣 WER DIE BEIDEN ZUSAMMENZIEHT, NIMMT ENTWEDER DEM EDITOR SEINE FENSTER ODER GIBT „ALLE“ DIE
// WERKZEUGE ZURÜCK.
function canEditEcosystemOnMap() {
	return canOperateEcosystemLayers() && !isEcosystemShowAllLayers();
}

// Active pane: visible and takes clicks. The two resting ones: drawn at 0% fill AND 0% contour, so you
// only ever see the layer you are working in (Owner 2026-07-26, third pass). They stay on the map as
// layers -- switching back is a class swap, not a reload -- and stay click-through, so the question
// "which polygon did I just hit" cannot arise even while something invisible lies underneath.
function syncEcosystemPaneStates() {
	if (typeof map === "undefined" || !map || typeof map.getPane !== "function") {
		return;
	}

	// 💣 ZUERST die offenen Schwebezettel schliessen, DANN umschalten. Gleich darunter bekommen Panes
	// `pointer-events: none` -- und eine Fläche, die unter dem Zeiger klickdurchlässig wird, sieht nie
	// wieder ein `mouseout`. Ihr Zettel bliebe für immer stehen (Owner 2026-08-04, zwei davon auf einmal;
	// Begründung an closeAllEcosystemAreaTooltips).
	if (typeof closeAllEcosystemAreaTooltips === "function") {
		closeAllEcosystemAreaTooltips();
	}

	const activeKind = getActiveEcosystemLayerKind();
	const showAll = isEcosystemShowAllLayers();
	ECOSYSTEM_KINDS.forEach((kind) => {
		const pane = map.getPane(ECOSYSTEM_KIND_PANES[kind]);
		if (!pane) {
			return;
		}
		// In „Alle" ist JEDE gezeichnete Ebene aktiv: sichtbar und anklickbar. Die Hausregel „immer nur
		// eine Ebene antwortet" (§2) wird hier bewusst ausgesetzt -- ihr Zweck ist, beim ZEICHNEN die Frage
		// „welches Polygon habe ich erwischt" gar nicht erst entstehen zu lassen, und „Alle" ist der Modus,
		// in dem man genau diese Überlappungen sehen WILL. Was ein Klick trifft, sagt danach die weisse
		// Auswahlkontur.
		//
		// 💣 GEFRAGT WIRD isEcosystemKindVisible, NICHT `showAll || kind === activeKind` NACHGEBAUT. Genau
		// das stand hier bis zum 27.08.2026 -- eine zweite Fassung derselben Frage, obwohl der Kommentar
		// jener Funktion behauptet, diese Stelle lese sie. Die Ausnahme der Klimazonen hätte sie nie
		// erreicht, und die Bänder wären in „Alle" stehengeblieben, während alles andere sie ausblendet.
		const kindSichtbar = isEcosystemKindVisible(kind);
		pane.classList.toggle("ecosystem-pane--active", kindSichtbar);
		pane.classList.toggle("ecosystem-pane--resting", !kindSichtbar);
		// Eigene Klasse für „Alle", statt es aus „alle drei sind aktiv" zu erraten: das CSS braucht den
		// Modus, um die derographischen Flächen dort zurückzunehmen (siehe ecosystem-layer.css).
		pane.classList.toggle("ecosystem-pane--showall", showAll);
		// Owner 2026-08-03: die Konturen gehören dem BEARBEITEN, nicht dem Ansehen. Der Zustand sitzt
		// hier an der Pane wie jeder andere -- das CSS entscheidet daraus, ob eine Kante gezeichnet wird
		// (Deckkraft-Matrix in css/features/ecosystem-layer.css).
		//
		// 🪤 IS_EDIT_MODE, nicht IS_ECOSYSTEM_ENABLED. Das zweite sagt nur, ob die EBENE angeboten wird
		// -- ein angemeldeter Admin sieht sie seit 2026-08-01 auch auf der normalen Karte, und genau
		// dort soll die Kontur weg. Die Zeichenwege fragen dasselbe Flag (context-action,
		// territory-import), diese Klasse ist also keine zweite Definition von „ich bearbeite gerade".
		pane.classList.toggle("ecosystem-pane--editable",
			typeof IS_EDIT_MODE !== "undefined" && Boolean(IS_EDIT_MODE));
	});

	// Owner 2026-07-26: Karten-Labels benennen die DEROGRAPHISCHE Ebene. Beim Zeichnen von Vegetation
	// oder Topographie sind die fremden davon Störung, und schlimmer: sie liegen (gewollt) über den
	// Flächen und schlucken den Klick, der dem Polygon darunter galt.
	// Owner 2026-07-27: das Klick-Durchreichen bleibt hier an der Pane -- es gilt für ALLE Labels, auch
	// die eigenen, denn ein Regionslabel sitzt am Point of Inaccessibility und damit mitten auf seiner
	// eigenen Fläche. Das Blassmachen ist dagegen ans einzelne Label gewandert (siehe unten).
	const labelsPane = map.getPane("labelsPane");
	if (labelsPane) {
		// 🔴 NUR BEIM BEARBEITEN (Owner 2026-08-04, mit den Kacheln im Frontend). Die Stummschaltung
		// nimmt den Labels die KLICKS -- ihr Zweck ist, dass ein fremder Name nicht den Klick schluckt,
		// der dem Polygon darunter galt. Das ist eine Zeichenfrage. Für den Besucher wäre es ein
		// Schaden: seit er selbst eine Ebene wählen kann, verlöre er in „Vegetation" jeden Klick auf
		// jedes Label -- die Infobox, das Hervorheben der Fläche, alles.
		labelsPane.classList.toggle("ecosystem-labels-dimmed",
			isEcosystemLayerModeActive() && canOperateEcosystemLayers()
			&& !showAll && activeKind !== "derographisch");
	}
	syncEcosystemLabelMuting();
	// 🔴 Und die Beschriftungen NEU BEWERTEN. Seit eine gewählte Ebene nur noch ihre eigenen zeigt
	// (isLabelOfActiveEcosystemLayer), ändert ein Ebenenwechsel, WELCHE Labels überhaupt auf der Karte
	// stehen -- nicht bloss, wie blass sie sind. Ohne diesen Aufruf bliebe der alte Satz stehen, bis
	// irgendetwas anderes die Sichtbarkeit anfasst (ein Schwenk, ein Zoom), und das sähe aus, als wirke
	// der Reiter erst beim zweiten Anfassen.
	if (typeof syncLabelVisibility === "function") {
		syncLabelVisibility();
	}
	// V8: das Relief hängt an derselben Frage wie die Panes -- welche Ebene liegt vorn. Es zeichnet sich
	// bei jeder anderen Lage leer, das Umschalten löscht es also von selbst.
	window.AvesmapsEcosystemHeightRender?.redraw?.();
	// V-Klima: die Trennlinien hängen an derselben Frage wie das Relief -- welche Ebene liegt vorn. Sie
	// räumen sich bei jeder anderen Lage selbst ab, das Umschalten löscht sie also von allein, und es
	// braucht keinen zweiten Aufräumweg neben diesem.
	window.AvesmapsEcosystemClimate?.sync?.();
	// Die Fluesse hängen an derselben Frage (23.08.2026). 🔴 DIE EINZIGE Aufrufstelle -- Eintreten,
	// Ebenenwechsel und Verlassen kommen alle drei hier vorbei. Zwei Setzer einzeln zu verdrahten wäre
	// die Falle vom 14.08.2026, und ein zusätzlicher Aufruf im Verlassen-Zweig war genau das (er stand
	// hier kurz und ist wieder weg: syncEcosystemControlsVisibility endet ohnehin auf dieser Funktion).
	syncEcosystemRiverVisibility();
	// Und ihre Kontur, aus demselben Trichter: Eintreten, Ebenenwechsel und Verlassen kommen alle drei
	// hier vorbei. Steht NACH der Sichtbarkeit -- ein Fluss, der gleich ausgeblendet wird, braucht
	// keinen frischen Stil, und andersherum wäre die Reihenfolge nur zufällig richtig.
	syncEcosystemFlussKontur();
	// Und das Ansichtsprofil des Besuchers: Straßen, Grenzen, Ortsklassen, Untergrund samt Kacheln
	// (23.08.2026). Auch hier gilt: Eintreten, Ebenenwechsel und Verlassen kommen alle drei hier vorbei.
	// ⚠️ Der Untergrund läuft NICHT von hier, sondern aus syncEcosystemControlsVisibility -- er muss auch
	// beim Verlassen des Modus gesetzt werden, und zwar mit `active=false`, was diese Funktion nicht weiß.
	syncEcosystemFrontendFeatures();
	syncEcosystemSettlementVisibility(isEcosystemLayerModeActive());
	// 🔴 UND DER UNTERGRUND SAMT KACHELN. Er hing bis 23.08.2026 allein am MODUS-Wechsel
	// (syncEcosystemControlsVisibility) -- ein Wechsel der EBENE liess ihn stehen. Aufgefallen ist das
	// damals, weil der Wert je Ebene verschieden war: von „Alle“ nach Vegetation blieb er auf 0 und die
	// Kacheln abgehängt, obwohl jene Ebene 25 % vorschrieb. Im Browser gemessen, nicht hergeleitet.
	// ⚠️ Seit 09.09.2026 tragen alle fünf Ebenen denselben Wert (0 %), der ANLASS dieser Aufrufstelle ist
	// also weg -- sie bleibt trotzdem, und zwar nicht aus Vorsicht: der Besucher kann seinen Untergrund
	// nicht wählen, der Editor aber seinen Regler ziehen, und BEIDE Rollen laufen bei einem Ebenenwechsel
	// genau hier vorbei. Die Stelle zu streichen, weil fünf gleiche Zahlen dastehen, hiesse sie beim
	// ersten je-Ebene-Wert von Aufgabe 8 neu zu finden.
	applyEcosystemUndergroundOpacity(isEcosystemLayerModeActive());
}

// 🔴 Welche Labels sind in der gerade bearbeiteten Ebene FREMD? Nur die werden blass. Seit jede Region
// ihr eigenes Label hat (label_public_id), gehört zu JEDER Ebene ein Teil der Beschriftungen -- ein
// Waldlabel in der Vegetationsebene blass zu zeichnen war der Fehler, den der Owner gemeldet hat.
//
// Die Zugehörigkeit steht in den geladenen FLÄCHEN: jede trägt ihr `label_public_id` und ihren `kind`.
// Ein Label ohne Fläche (Siedlungen, Gipfel, die grosse Mehrheit) gehört zu keiner Ebene und bleibt
// blass -- ausser in der derographischen, in der noch nie gedimmt wurde.
// Ist dieses Label ein Gipfel? Über `labelData` und nicht über den Marker, weil die Frage auch
// gestellt wird, bevor ein Marker existiert (createLabelIcon baut das Icon mit).
function isEcosystemPeakLabel(labelPublicId) {
	const publicId = String(labelPublicId || "");
	if (!publicId || typeof labelData === "undefined" || !Array.isArray(labelData)) {
		return false;
	}

	// 🪤 Bewacht: diese Funktion hängt an syncEcosystemPaneStates, und ein Wurf hier reisst den ganzen
	// Ebenenwechsel mit. Fehlt das Höhenmodul, gilt „kein Gipfel" -- das Vorverhalten, nicht ein Fehler.
	if (typeof isEcosystemPeakSubtype !== "function") {
		return false;
	}

	return labelData.some((label) => String(label?.publicId || "") === publicId
		&& isEcosystemPeakSubtype(label?.labelType));
}

// Ein Gipfel in der Topographie-Ebene: sichtbar, anklickbar und direkt ziehbar. Die Klasse hebt für
// ihn die Klickdurchlässigkeit der Labels-Pane wieder auf (css/features/ecosystem-layer.css).
function isEcosystemPeakActive(labelPublicId) {
	return typeof isEcosystemLayerModeActive === "function" && isEcosystemLayerModeActive()
		// 💣 UND DAS BEDIENRECHT (Owner 2026-08-05). Ein Gipfel ist der ARBEITSPUNKT dieser Ebene: die
		// Klasse gibt ihm `cursor: grab`, und syncEcosystemPeakDragging schaltet daraufhin sein Ziehen
		// frei. Ohne diese Zeile bekam der gewöhnliche Besucher in der Topographie beides -- Leaflet legt
		// `marker.dragging` an JEDEM anklickbaren Marker an, `draggable: false` unterdrückt nur das
		// Einschalten. Gespeichert hätte er nichts (der `dragend`-Schreiber hängt an IS_EDIT_MODE), aber
		// die Beschriftung wäre ihm unter der Maus weggerutscht und hätte Bearbeiten versprochen.
		//
		// 🪤 Die Pane-Ausnahme darunter verliert er nicht: `ecosystem-labels-dimmed` wird für ihn seit
		// 2026-08-04 gar nicht mehr gesetzt, es gibt also nichts mehr aufzuheben.
		//
		// 🔴 UND NICHT IN „ALLE“ (23.08.2026). Die gemerkte Ebene sagt dort weiterhin „topographie“, der
		// Gipfel bliebe also ziehbar — in einer Ansicht, die sonst nichts bearbeitet.
		&& canEditEcosystemOnMap()
		&& getActiveEcosystemLayerKind() === "topographie"
		&& isEcosystemPeakLabel(labelPublicId);
}

// 🔴 NIMMT DAS LABEL, NICHT NUR SEINE KENNUNG (Owner 2026-07-29: „wenn ich ein Label dupliziere wird
// das neue nur halb transparent"). Vorher entschied diese Funktion allein über den Zeiger an der
// REGION (`label_public_id`) -- und der nennt nur das PRIMÄRE Label. Ein Klon trägt seine
// Zugehörigkeit am eigenen Zeiger (`ecosystem_region_public_id`, gesetzt beim Duplizieren) und galt
// deshalb als fremd: blass und klickdurchlässig, mitten in seiner eigenen Ebene.
//
// 💣 Dieselbe Falle wie bei der Kollisionsauflösung: eine Beziehung, die auf BEIDEN Seiten gespeichert
// ist, nur von einer Seite zu lesen. Seit eine Fläche mehrere Labels tragen darf, ist das kein
// Randfall -- das zweite und dritte Label einer Fläche haben nie einen Regionszeiger auf sich.
function isEcosystemLabelMuted(label) {
	if (typeof isEcosystemLayerModeActive !== "function" || !isEcosystemLayerModeActive()) {
		return false;
	}
	if (isEcosystemShowAllLayers()) {
		return false;
	}
	const activeKind = getActiveEcosystemLayerKind();
	if (activeKind === "derographisch") {
		return false;
	}
	// Nimmt weiterhin auch eine blosse Kennung an -- ältere Aufrufe reichen eine solche herein, und ein
	// Gipfel trägt ohnehin keinen Regionszeiger.
	const publicId = String((label && typeof label === "object" ? label.publicId : label) || "");
	const eigenerZeiger = String((label && typeof label === "object" ? label.ecosystemRegionPublicId : "") || "");
	// 🔴 V8: ein Gipfel ist in der TOPOGRAPHIE kein fremdes Label, sondern deren Arbeitspunkt. Er trägt
	// die Höhe, aus der das Höhenfeld entsteht (oekosystem-editor-leitfaden.md §1.4), und wer ihn blass
	// und klickdurchlässig macht, macht genau das unbedienbar, was diese Ebene bearbeitet.
	//
	// Welche Subtypen als Gipfel zählen, steht an EINER Stelle (ECOSYSTEM_PEAK_SUBTYPES): heute
	// `berggipfel` und `vulkan`. Jeder andere Label-Typ behält sein bisheriges Verhalten.
	//
	// 💣 Das ist der Grund, warum in der Topographie „keine Gipfel zu sehen" waren: KEINER der 62 trägt
	// ein `ecosystem_region_public_id`, sie galten also allesamt als fremd -- blass und klickdurchlässig.
	if (activeKind === "topographie" && isEcosystemPeakLabel(publicId)) {
		return false;
	}
	if (!publicId || typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
		return true;
	}
	// BEIDE Richtungen: die Fläche nennt ihr primäres Label, und jedes weitere Label nennt seine Fläche.
	// Nur die erste zu lesen hiess, jedes zweite und dritte Label einer Fläche für fremd zu halten.
	let eigen = false;
	ecosystemLayers.forEach((layer) => {
		const area = layer?._ecosystemArea;
		if (!area || area.kind !== activeKind) {
			return;
		}
		if (String(area.label_public_id || "") === publicId) {
			eigen = true;
		}
		if (eigenerZeiger !== "" && String(area.region_public_id || "") === eigenerZeiger) {
			eigen = true;
		}
	});
	return !eigen;
}

// 💣 Die Klasse muss ins ICON, nicht nur aufs Element: `syncLabelIcons` baut das Icon bei jedem
// Zoomwechsel neu und `syncLabelMarkerVisibility` hängt Marker aus und wieder ein. Beides ersetzt das
// DOM-Element -- eine Klasse, die nur dort sässe, wäre nach dem ersten Zoom weg. `createLabelIcon`
// ruft dafür `ecosystemLabelMutedClass()` auf.
function ecosystemLabelMutedClass(label) {
	// 🪤 Das LABEL, nicht seine Kennung: nur so kennt isEcosystemLabelMuted den eigenen Regionszeiger,
	// und nur der verrät die Zugehörigkeit eines duplizierten Labels.
	return (isEcosystemLabelMuted(label) ? " map-label--eco-muted" : "")
		+ (isEcosystemPeakActive(label?.publicId) ? " map-label--eco-peak" : "");
}

// 🔴 Ziehen ohne Zwischenschritt (V8). Ausserhalb der Topographie braucht ein Label erst den
// Verschiebemodus, damit ein Fehlgriff beim Kartenziehen nicht gleich etwas verrückt. In dieser Ebene
// ist das Verschieben der Gipfel aber die Hauptarbeit -- dort jedes Mal erst ein Menü aufzumachen wäre
// dieselbe Zumutung wie ein Zeichenmodus, den man vor jedem Strich einschaltet.
//
// 💣 Nicht in setLabelMoveActive einhängen: das nimmt eine Sperre und wirft eine Toast-Meldung. Beim
// Ebenenwechsel liefen daraus so viele Sperren und Meldungen, wie Gipfel im Bild sind.
function syncEcosystemPeakDragging() {
	if (typeof labelMarkers === "undefined" || !Array.isArray(labelMarkers)) {
		return;
	}
	labelMarkers.forEach((entry) => {
		const dragging = entry?.marker?.dragging;
		// 🪤 Nur Gipfel anfassen. Ein anderes Label kann gerade im gewöhnlichen Verschiebemodus stehen
		// (setLabelMoveActive, mit Sperre); es hier mit abzuschalten risse dem Editor das Label unter
		// der Maus weg, bloss weil er nebenbei die Ebene gewechselt hat.
		if (!dragging || !isEcosystemPeakLabel(entry.label?.publicId)) {
			return;
		}
		if (isEcosystemPeakActive(entry.label?.publicId)) {
			dragging.enable();
		} else {
			dragging.disable();
		}
	});
}

// Und der Weg andersherum: beim Ebenenwechsel sollen die schon gezeichneten Labels sofort umschalten,
// ohne auf einen Icon-Neubau zu warten.
function syncEcosystemLabelMuting() {
	if (typeof labelMarkers === "undefined" || !Array.isArray(labelMarkers)) {
		return;
	}
	labelMarkers.forEach((entry) => {
		const element = typeof entry?.marker?.getElement === "function" ? entry.marker.getElement() : null;
		if (element) {
			element.classList.toggle("map-label--eco-muted", isEcosystemLabelMuted(entry.label));
			element.classList.toggle("map-label--eco-peak", isEcosystemPeakActive(entry.label?.publicId));
		}
	});
	syncEcosystemPeakDragging();
}

// ---- underground opacity (Owner 2026-07-26) --------------------------------------------------------
// The painted terrain and the drawn areas are hard to tell apart, so the base tiles can be faded out
// towards white until the areas stand alone. 0% looks like no base map at all.
//
// 🔴 On the tilePane, NOT on baseTileLayer.getContainer(). setMapStyle() DESTROYS and recreates that
// container on every style switch (bootstrap.js) -- which is exactly why syncPowerlineMapTint has to be
// re-applied there. The pane survives, so this needs no second call site and cannot fall out of sync.
const ECOSYSTEM_UNDERGROUND_STORAGE_KEY = "avesmaps.ecosystem.undergroundOpacity";
// 50%, not 100% (Owner 2026-07-26): the layer is entered to draw on it, and at full strength the
// painted terrain and the drawn areas are hard to tell apart -- which is what the slider exists for.
// Half is where the terrain still guides the pen without competing with it. The slider stays, so
// anyone who wants the full map back is one drag away.
const ECOSYSTEM_UNDERGROUND_DEFAULT = 50;

// Was der gewöhnliche Besucher sieht (Owner 2026-08-04: „den Untergrund musst du noch ausblenden,
// 25 % haben wie gesagt"). Er bekommt den Regler nicht -- also auch nicht den gespeicherten Wert:
// 💣 der liegt je BROWSER, und wer irgendwann einmal auf 0 gezogen hat, bekäme eine leere weisse
// Karte, ohne einen Weg zurück. Ein fester Wert ist hier das Gegenteil einer Einschränkung.
const ECOSYSTEM_UNDERGROUND_FRONTEND = 25;

// 🪤 The raw string is checked for "nothing stored" BEFORE the number conversion. Number(null) is 0 --
// a perfectly finite 0 that passes a 0..100 range check, so converting first made an editor entering
// the layer for the very first time land on 0% and stare at a blank white map. Same shape of trap as
// the active kind, which starts empty for the mirror-image reason.
function readStoredEcosystemUndergroundOpacity() {
	try {
		const raw = window.localStorage?.getItem(ECOSYSTEM_UNDERGROUND_STORAGE_KEY);
		if (raw === null || raw === undefined || String(raw).trim() === "") {
			return ECOSYSTEM_UNDERGROUND_DEFAULT;
		}
		const stored = Number(raw);
		return Number.isFinite(stored) && stored >= 0 && stored <= 100 ? stored : ECOSYSTEM_UNDERGROUND_DEFAULT;
	} catch (error) {
		return ECOSYSTEM_UNDERGROUND_DEFAULT;
	}
}

function storeEcosystemUndergroundOpacity(percent) {
	try {
		window.localStorage?.setItem(ECOSYSTEM_UNDERGROUND_STORAGE_KEY, String(percent));
	} catch (error) {
		// blocked storage -- the slider still works, it just forgets across reloads
	}
}

// `active` false restores the map completely: this must never leak into the other view modes, where a
// half-faded base map would look like a broken tile server.
// ---- Das Anzeigeprofil der Landschaften (Owner 09.09.2026) ----------------------------------------
//
// 🔴 EIN PROFIL FÜR ALLE FÜNF EBENEN. Owner: „auch die sollen in allen landschaftsansichten default
// aktiviert und sichtbar sein". Damit fällt die „ruhige Zeichenfläche", die vier der fünf Ebenen seit
// dem 05.08.2026 waren, und mit ihr DREI Tabellen: ECOSYSTEM_FRONTEND_PROFILES,
// ECOSYSTEM_FRONTEND_PROFILE_RUHIG und ECOSYSTEM_RIVER_KINDS. Sie beantworteten alle dieselbe Frage
// („was zeigt DIESE Ebene"), und die gibt es nicht mehr.
// 💣 Eine Tabelle mit fünf gleichen Zeilen wäre schlimmer als keine: sie liest sich wie eine getroffene
// Entscheidung und lädt zum Differenzieren ein, das hier ausdrücklich nicht gewollt ist.
//
// 🔴 NUR DER BESUCHER. Der Editor bekommt weiterhin GAR KEIN Profil -- er hat seine Haken und seinen
// Untergrund-Regler gleich daneben, und ein Profil legte sich über seine eigene Wahl.
//
// ⚠️ DIE FLÜSSE STEHEN MIT DRIN -- ABER NUR FÜR DEN BESUCHER. Ein erster Entwurf liess den Editor bei
// fehlendem Profil auf GENAU DIESEN Wert zurückfallen und gab ihm die Flüsse dadurch in jeder Ebene,
// obwohl seine eigene Ebenenregel (an syncEcosystemRiverVisibility) das nie vorsah -- eine Lücke im
// Entwurf, keine gewollte Ausweitung. syncEcosystemRiverVisibility liest `fluesse` deshalb nur für
// den Besucher aus diesem Profil; der Editor behält seine eigene, unveränderte Ebenentabelle (siehe
// dort).
const ECOSYSTEM_FRONTEND_PROFIL = Object.freeze({
	orte: true, wege: true, labels: true, grenzen: true, fluesse: true, untergrund: 0,
});

// 🔴 IST DIE RECHTEAUSKUNFT DA? „Besucher" und „Rechte noch unbekannt" sind ZWEI Zustände, und bis
// zum 10.09.2026 waren sie einer -- `canOperateEcosystemLayers()` antwortet auf beides „nein".
//
// 💣 DER FALL, DER DAS GEKOSTET HAT. Ein Editor kommt mit `mapLayerMode=ecosystem` aus dem
// localStorage herein (applyPlannerStateFromUrl, map-features-layer-state.js) -- er steht also in der
// Ebene, BEVOR seine Sitzungsantwort eintrifft. Der Besucher-Zweig von
// syncEcosystemSettlementVisibility lief daraufhin für ihn, lieh sich seine Ortsklassen und schaltete
// alle sechs AN; als die Auskunft dann kam, stieg der Editor-Zweig an seinem eigenen „nur beim
// Eintreten leihen" aus (`ecosystemSettlementMemory !== null`) und nahm nichts mehr zurück. Seine
// leere Zeichenfläche war weg, und nichts daran sah kaputt aus.
//
// 🔴 DIE REGEL: solange die Auskunft fehlt, wird NICHTS angefasst -- weder geliehen noch gesetzt.
// Sobald sie da ist, wird angewendet (applyEcosystemAccess ruft dafür syncEcosystemControlsVisibility,
// js/config.js). Der Preis ist ein kurzer Moment, in dem die Karte unprofiliert dasteht; die
// Gegenrichtung kostet einem Editor seine Arbeitsfläche.
//
// ⚠️ FÄLLT OFFEN AUS. Ohne js/config.js (ein Testaufbau, eine Seite ohne Konfiguration) gilt
// „bekannt" -- dasselbe Muster wie bei IS_ECOSYSTEM_ENABLED daneben: eine fehlende fremde Globale
// heisst hier „verhalte dich wie bisher", nicht „halt für immer still".
// 💣 DREI LESER, und jeder steht dort, wo sonst etwas angefasst würde: dieses Profil (und über
// ecosystemAnzeigeSoll damit die Haken, die Ortsklassen und die Nutzerwahl), der Fluss-Haken und der
// Untergrund. syncEcosystemSettlementVisibility braucht keinen eigenen -- siehe die Begründung dort.
function ecosystemAnzeigeAuskunftDa() {
	return typeof avesmapsEcosystemAccessBekannt !== "function" || avesmapsEcosystemAccessBekannt();
}

// Das Profil des GERADE zusehenden Besuchers -- oder `null` für „hier wird nichts angefasst“.
//
// 💣 `null` ist kein Rückfall auf eine ruhigere Fassung, sondern eine eigene Aussage: der Editor und
// jede andere Kartenansicht bekommen GAR KEIN Profil. Wer die beiden zusammenzieht, nimmt dem Editor
// seine Haken oder greift in „Politisch“ hinein.
function ecosystemFrontendProfile() {
	if (typeof isEcosystemLayerModeActive !== "function" || !isEcosystemLayerModeActive()) {
		return null;
	}
	// 🔴 VOR der Rechtefrage, nicht danach: „noch nicht beantwortet" ist kein „nein" (siehe oben).
	if (!ecosystemAnzeigeAuskunftDa()) {
		return null;
	}
	if (canOperateEcosystemLayers()) {
		return null;
	}
	return ECOSYSTEM_FRONTEND_PROFIL;
}

// Die zehn Schalter, um die es geht: die vier Zeilen der Gruppe „Ebenen" im Anzeige-Menü und die sechs
// Ortsklassen. 🔴 Die Ortsklassen kommen aus LOCATION_TYPE_VISIBILITY_ORDER, nie abgeschrieben -- die
// letzte heisst `gebaeude` und trägt im Menü die Beschriftung „Besondere Bauwerke/Stätten".
const ECOSYSTEM_ANZEIGE_HAKEN = Object.freeze({
	wege: "togglePaths",
	labels: "toggleMapLabels",
	grenzen: "toggleTerritoryBorders",
	fluesse: "toggleRivers",
});

// Die Lage, die der Besucher INNERHALB der Landschaften selbst hergestellt hat. `null` = er hat noch
// keine getroffen.
// 🔴 SIE GILT FÜR DEN GANZEN BESUCH (Owner 09.09.2026) -- über Ebenenwechsel UND über das Verlassen und
// Wiederbetreten der Landschaften hinweg. Kein localStorage: ein Neuladen fängt wieder mit der Vorgabe
// an, sonst bekäme jemand, der einmal etwas abschaltet, es nie wieder zu sehen, ohne es selbst zu
// suchen.
// 💣 SIE IST NICHT DAS AUSLEIH-GEDÄCHTNIS. ecosystemSettlementMemory und ecosystemRiverMemory
// beantworten „was hatte er VOR den Landschaften" und geben es beim Verlassen zurück; diese hier
// beantwortet „was will er IN den Landschaften". Zwei Fragen, zwei Merker -- zusammengelegt fällt eine
// von beiden Antworten weg.
let ecosystemAnzeigeWahl = null;

let ecosystemAnzeigeWahlGebunden = false;

// 💣 UND HIER STEHT ABSICHTLICH KEINE WACHE UM LOCATION_TYPE_VISIBILITY_ORDER, anders als in
// ecosystemAnzeigeSoll darunter. Faellt die Liste hier aus, wirft diese Funktion -- und dann bleibt
// `ecosystemAnzeigeWahl` unangetastet, weil die Zuweisung nie stattfindet. Genau das ist die sichere
// Richtung: eine Wahl mit LEERER Ortstafel saehe aus wie „der Nutzer will keine Orte sehen" und
// schaltete ihm ab dem naechsten Ebenenwechsel alle sechs Klassen aus. Ein lauter Fehlschlag in einem
// Ereignis-Zuhoerer ist dagegen folgenlos.
// 💣 UND OHNE `untergrund`. Der Besucher hat den Regler nicht -- er KANN den Untergrund also gar nicht
// wählen, und was er nicht wählen kann, gehört nicht in den Satz „das hat er gewählt". Bis zum
// 10.09.2026 stand hier ein abgeschriebenes `untergrund: 0` neben dem `untergrund: 0` des Profils:
// derselbe Wert, zwei Schreiber, von keinem Test gehalten. Ab der ersten echten Hand hätte ein
// künftiger Profilwert damit still auf 0 gefallen -- und genau dieses Feld liest Aufgabe 8. Gefüllt
// wird es jetzt an EINER Stelle, in ecosystemAnzeigeSoll, und immer aus dem Profil.
function ecosystemAnzeigeLesen() {
	const stand = { orte: {} };
	Object.keys(ECOSYSTEM_ANZEIGE_HAKEN).forEach((feld) => {
		const haken = document.getElementById(ECOSYSTEM_ANZEIGE_HAKEN[feld]);
		stand[feld] = Boolean(haken && haken.checked);
	});
	LOCATION_TYPE_VISIBILITY_ORDER.forEach((typ) => {
		stand.orte[typ] = getLocationToggleButton(typ).hasClass("is-active") === true;
	});
	return stand;
}

/**
 * Was JETZT gelten soll: die Wahl des Besuchers, sobald er eine getroffen hat -- sonst die Vorgabe.
 *
 * ⭐ Und genau deshalb braucht es kein „nur beim Betreten anwenden". Die Appliers hängen an
 * syncEcosystemPaneStates und laufen bei jedem Ebenenwechsel; früher hätten sie damit die Wahl des
 * Nutzers plattgemacht. Jetzt schreiben sie SEINE Lage zurück -- ein Leerlauf, denn jeder Applier
 * steigt bei `checked === soll` aus, ohne ein Ereignis zu feuern.
 */
function ecosystemAnzeigeSoll() {
	const profil = ecosystemFrontendProfile();
	if (!profil) {
		return null;
	}
	if (ecosystemAnzeigeWahl) {
		// 🔴 DER UNTERGRUND KOMMT AUCH HIER AUS DEM PROFIL, nie aus der Wahl. Er ist das einzige Feld des
		// Solls, für das es im Anzeige-Menü des Besuchers kein Bedienelement gibt (der Regler gehört dem
		// Editor) -- er kann ihn also nicht gewählt haben. Ein zweiter Schreiber dafür wäre ein gekoppelter
		// Wert an zwei Stellen, und Aufgabe 8 liest genau dieses Feld.
		return Object.assign({}, ecosystemAnzeigeWahl, { untergrund: profil.untergrund });
	}
	// Die Vorgabe in DIE Form bringen, in der auch die Nutzerwahl steht -- eine Form, ein Leser.
	// ⚠️ MIT DERSELBEN WACHE WIE syncEcosystemSettlementVisibility DARUNTER. Die Liste kommt aus
	// js/config.js, also aus einer fremden Datei; dieses Modul erklärt sie seit jeher für möglicherweise
	// abwesend. Neu ist, dass auch der Untergrund und die Flüsse durch dieses Soll gehen -- an denen
	// hing vor dem 09.09.2026 gar keine Ortsliste, und ein ReferenceError liefe dort bei JEDEM
	// Moduswechsel und nähme die Kachelebene mit. Ohne Liste bleibt `orte` leer; der Applier der
	// Ortsklassen steigt an seiner eigenen Wache ohnehin aus.
	const orte = {};
	if (typeof LOCATION_TYPE_VISIBILITY_ORDER !== "undefined") {
		LOCATION_TYPE_VISIBILITY_ORDER.forEach((typ) => { orte[typ] = profil.orte === true; });
	}
	return {
		orte, wege: profil.wege, labels: profil.labels, grenzen: profil.grenzen,
		fluesse: profil.fluesse, untergrund: profil.untergrund
	};
}

/** Nur für den Test: gibt es eine Wahl? (Die Wahl selbst bleibt drinnen -- ein Test, der sie setzen
 *  könnte, prüft den Weg nicht mehr, der sie setzen soll.) */
function ecosystemAnzeigeWahlGesetzt() {
	return ecosystemAnzeigeWahl !== null;
}

/**
 * 💣 NUR EINE ECHTE HAND ZÄHLT. `dispatchEvent` liefert `isTrusted === false` -- und genau so setzt
 * diese Datei ihre Haken selbst (das Ereignis ist Pflicht, die Zeichner hängen daran). Ohne diese Frage
 * schriebe das Anwenden der Vorgabe die Vorgabe als „Nutzerwahl" fest; ab da wäre das Profil für den
 * Rest des Besuchs wirkungslos, UND ES SÄHE RICHTIG AUS -- die Karte zeigt ja genau, was die Vorgabe
 * wollte. Auffallen würde es erst beim zweiten Betreten.
 * ⚠️ Der Zuhörer hängt per addEventListener dran, NICHT per jQuery: nur so ist `isTrusted` das native
 * Feld und nicht das, was eine Normalisierungsschicht daraus macht.
 * ⚠️ Er hält auch gegen die anderen programmatischen Schreiber dieser Haken (URL-Persistenz
 * ?togglePaths=0, applyFrontendLayerModeDefaults) -- die sind ebenfalls keine Hand. Nachgezählt am
 * 10.09.2026: ALLE schreiben mit `$(…).prop("checked", …)`, und das feuert überhaupt kein Ereignis;
 * keiner von ihnen ruft `.click()` oder `.trigger("change")` auf einem der vier.
 *
 * 🪤 UND GENAU DAS IST DIE BEDINGUNG, DIE HIER GEMESSEN WURDE UND NICHT ANGENOMMEN WERDEN DARF.
 * Live gegengemessen (avesmaps.de, 10.09.2026):
 *   - Klick auf die `<label>`-Zeile („Wege", weit weg vom 1px breiten `<input>`)  → isTrusted TRUE
 *   - `i.dispatchEvent(new Event("change"))`, also unser eigener Weg                → isTrusted FALSE
 *   - 💣 `labelZeile.click()` aus einem Skript                                      → isTrusted TRUE
 * Der dritte ist der Haken an der Sache: ein synthetischer `click()` trägt selbst `isTrusted: false`,
 * aber das ANKREUZEN erledigt danach der Browser, und SEIN `change` ist vertrauenswürdig. Wer also je
 * einen dieser Haken per `.click()` umlegt, schreibt damit eine „Nutzerwahl" fest, ohne dass ein
 * Mensch etwas angefasst hat -- und das Profil wäre für den Rest des Besuchs wirkungslos. Heute tut
 * das niemand (nachgezählt, siehe oben); wer es einführt, muss diesen Riegel mitdenken.
 * ⚠️ Die Tastatur-Gegenprobe (Leertaste auf dem fokussierten Haken) liess sich mit der Browser-Pane
 * NICHT fahren -- ihre Tasteneingabe erreicht den Haken mit leerem `key` und löst das Ankreuzen des
 * Browsers gar nicht erst aus. Das ist eine Werkzeuggrenze, keine Aussage über die Seite.
 */
function ecosystemAnzeigeWahlMerken(ereignis) {
	if (!ereignis || ereignis.isTrusted !== true) {
		return;
	}
	ecosystemAnzeigeNutzerhand();
}

/**
 * „HIER WAR DER BENUTZER." Der ZWEITE Weg, und er ist ausdrücklich statt gemessen.
 *
 * 🔴 ES GIBT ZWEI WEGE, WEIL DIE FRAGE NICHT „kam das Ereignis vom Browser" LAUTET, SONDERN „war das
 * der Benutzer". Für Maus und Label-Klick beantwortet `isTrusted` das richtig. Für die TASTATUR nicht:
 * die Tastenkürzel 1–6 legen eine Ortsklasse über `button.click()` um (SHORTCUTS-Zeile `locationTier`,
 * js/app/keyboard-shortcuts.js), und ein synthetischer Klick trägt `isTrusted: false`. Ohne diesen
 * zweiten Weg wäre eine gedrückte Taste keine Wahl -- der nächste Ebenenwechsel schriebe die Vorgabe
 * darüber, und der Benutzer sähe seine Ziffer wirkungslos werden.
 *
 * 💣 DIE GEGENRICHTUNG IST VERWORFEN: alle programmatischen Schreiber als Wahl zu zählen und nur die
 * eigenen auszuklammern. Dann verbuchte `applyFrontendLayerModeDefaults` beim Moduswechsel die
 * MODUS-Vorgaben als Wahl, und das Profil wäre sofort tot. Darum bleibt `isTrusted` die Regel und
 * diese Funktion die benannte Ausnahme -- mit genau EINEM Aufrufer von aussen.
 *
 * ⚠️ Wer einen weiteren Bedienweg baut, der ohne echtes Ereignis an diesen Schaltern dreht, ruft sie
 * hier -- nicht einen dritten Merker daneben.
 */
function ecosystemAnzeigeNutzerhand() {
	// 🔴 EINE Regel, EIN Ort: „gibt es hier überhaupt eine Besucherwahl zu merken" beantwortet
	// ecosystemFrontendProfile -- Landschaftsmodus, Rechteauskunft da, und kein Editor (die Wahl gehört
	// dem Besucher; der Editor hat seine eigenen Haken). Bis zum 10.09.2026 standen zwei dieser drei
	// Fragen hier noch einmal abgeschrieben, und die dritte fehlte dadurch.
	if (!ecosystemFrontendProfile()) {
		return;
	}
	ecosystemAnzeigeWahl = ecosystemAnzeigeLesen();
}

function bindEcosystemAnzeigeWahl() {
	if (ecosystemAnzeigeWahlGebunden) {
		return;
	}
	const haken = Object.keys(ECOSYSTEM_ANZEIGE_HAKEN)
		.map((feld) => document.getElementById(ECOSYSTEM_ANZEIGE_HAKEN[feld]))
		.filter(Boolean);
	if (!haken.length) {
		return;   // das Anzeige-Menü steht noch nicht -- der nächste Aufruf holt es nach
	}
	ecosystemAnzeigeWahlGebunden = true;
	haken.forEach((element) => element.addEventListener("change", ecosystemAnzeigeWahlMerken));
	// ⚠️ Die Ortsklassen sind KEINE Checkboxen, sondern jQuery-Knöpfe mit `is-active` -- ein
	// programmatisches toggleClass feuert dort ohnehin nichts. Gehorcht wird deshalb dem Klick.
	// ⚠️ Und im nächsten Takt gelesen: der eigene Handler des Knopfes setzt die Klasse erst.
	document.addEventListener("click", (ereignis) => {
		const knopf = ereignis.target && ereignis.target.closest
			? ereignis.target.closest(".location-toggle") : null;
		if (!knopf) {
			return;
		}
		const vertrauenswuerdig = ereignis.isTrusted === true;
		setTimeout(() => ecosystemAnzeigeWahlMerken({ isTrusted: vertrauenswuerdig }), 0);
	});
}

// Setzt einen Haken des Anzeige-Menüs und meldet, ob sich dabei etwas geändert hat.
//
// 💣 Ein programmatisch gesetztes `checked` feuert KEIN `change` -- und an genau diesem Ereignis hängen
// die Zeichner (syncPathVisibility für die Wege, die Grenz-Leinwand für die Grenzen). Ohne das Signal
// stünde der Haken richtig und die Karte falsch.
// ⚠️ Und nur bei echter Änderung: diese Wege laufen bei JEDEM Ebenenwechsel, und ein blindes Setzen
// zeichnete jedes Mal ~6.000 Wege neu.
function ecosystemSetzeAnzeigeHaken(id, soll) {
	const haken = document.getElementById(id);
	if (!haken || haken.checked === Boolean(soll)) {
		return false;
	}
	haken.checked = Boolean(soll);
	haken.dispatchEvent(new Event("change", { bubbles: true }));
	return true;
}

// Straßen, Beschriftungen und Grenzen nach dem SOLL (der Wahl des Besuchers, sonst der Vorgabe). Die
// Ortsklassen laufen über syncEcosystemSettlementVisibility (sie werden GELIEHEN und beim Verlassen
// zurückgegeben), die Flüsse über syncEcosystemRiverVisibility (dito), der Untergrund über
// applyEcosystemUndergroundOpacity.
//
// 🔴 `toggleMapLabels` STEHT SEIT DEM 09.09.2026 MIT DRIN. Bis dahin fasste diese Funktion die
// Beschriftungen gar nicht an -- die vier ruhigen Ebenen waren ohnehin leer, und in „Alle" stand der
// Haken meist schon richtig. Mit „alles an in allen Ebenen" ist er ein Schalter wie die anderen drei.
//
// ⚠️ ALLE DREI brauchen hier KEINE Erinnerung -- Straßen, Grenzen UND Beschriftungen: jeder der drei
// Haken wird bei jedem Kartenmodus-Wechsel ohnehin neu gesetzt, alle aus `setSelectedMapLayerMode`
// (map-features-display-mode.js). Die Wege und die Grenzen dort direkt, `#toggleMapLabels` über
// `syncEditorDisplayTogglesToMode` gegen `MAP_LABEL_MODES` (js/config.js: `deregraphic` und
// `ecosystem`). Das Verlassen des Modus stellt sie also von selbst richtig, und eine zweite Erinnerung
// daneben liefe genau dort auseinander, wo es niemandem auffiele.
// 💣 Bis 10.09.2026 nannte dieser Absatz nur Wege und Grenzen, obwohl die Beschriftungen am Tag davor
// dazugekommen waren -- der dritte Haken stand ohne Begründung da, und wer sie gesucht hätte, hätte
// sie an der falschen Stelle (bei `setSelectedMapLayerMode` selbst) nicht gefunden.
// 💣 Bis 26.08.2026 stand hier „die Wege von applyFrontendLayerModeDefaults" -- und DIE laeuft nur aus
// dem Umschalter und aus restorePlannerState, im Editor gar nicht bis zu den Wegen. Die Zusicherung
// galt damit fuer jeden anderen Weg in die Standardansicht nicht: wer aus den Landschaften heraus den
// Spotlight, den Routenplaner oder eine Editorliste benutzte, stand in „Standard" ohne Wege.
function syncEcosystemFrontendFeatures() {
	const soll = ecosystemAnzeigeSoll();
	if (!soll) {
		return;
	}
	const wege = ecosystemSetzeAnzeigeHaken("togglePaths", soll.wege);
	ecosystemSetzeAnzeigeHaken("toggleMapLabels", soll.labels);
	ecosystemSetzeAnzeigeHaken("toggleTerritoryBorders", soll.grenzen);
	// Die Grenzen zeichnet ihr eigener `change`-Zuhörer; die Wege brauchen den direkten Anstoss, weil
	// diese Datei vor map-features.js lädt und ihr Zuhörer beim ersten Aufruf noch fehlen kann.
	if (wege && typeof syncPathVisibility === "function") {
		syncPathVisibility();
	}
}

// 🔴 Die Kachel-Ebene wird GENOMMEN, nicht nur ausgeblendet (Owner: „du brauchst auch keine tiles
// nachladen“). Leaflet fordert Kacheln nur an, solange die Ebene auf der Karte liegt -- bei 0 %
// Deckkraft lädt der Browser sonst Bilder, die niemand sieht.
//
// 💣 ZURÜCKGEGEBEN WIRD NUR, WAS DIESE EBENE SELBST GENOMMEN HAT. Der Editor kann die Kacheln über
// `mapstyle=none` abschalten (js/ui/route-planner-toggle.js) -- diese Lage gehört ihm. Ohne die Marke
// schaltete das Verlassen der Landschaften ihm die Kacheln wieder ein.
// ⚠️ `baseTileLayer` wird dabei NICHT geleert: an der Variablen hängen der Stil-Umschalter und die
// Kraftlinien-Entsättigung. Bei `mapstyle=none` ist sie bereits `null`, und dann tut diese Funktion
// nichts -- die sichere Richtung.
let ecosystemKachelnGenommen = false;

function syncEcosystemBaseTiles(sichtbar) {
	if (typeof map === "undefined" || !map || typeof baseTileLayer === "undefined" || !baseTileLayer) {
		return;
	}
	if (!sichtbar) {
		if (map.hasLayer(baseTileLayer)) {
			map.removeLayer(baseTileLayer);
			ecosystemKachelnGenommen = true;
		}
		return;
	}
	if (ecosystemKachelnGenommen && !map.hasLayer(baseTileLayer)) {
		map.addLayer(baseTileLayer);
		// Ganz nach hinten -- sonst lägen die Kacheln über den Landschaftsflächen.
		baseTileLayer.bringToBack?.();
	}
	ecosystemKachelnGenommen = false;
}

function applyEcosystemUndergroundOpacity(active) {
	if (typeof map === "undefined" || !map || typeof map.getPane !== "function") {
		return;
	}

	// 🔴 SOLANGE DIE RECHTEAUSKUNFT FEHLT, WIRD NICHTS ANGEFASST. Ohne Soll faellt der Wert unten auf
	// ECOSYSTEM_UNDERGROUND_FRONTEND (25 %) -- und bei 0 % nimmt diese Funktion sogar die Kachelebene von
	// der Karte. Wer gleich als Editor erkannt wird, saehe seinen Untergrund also erst auf 25 springen und
	// dann auf seinen Reglerwert; wer Besucher ist, saehe ihn auf 25 und dann auf 0 samt verschwindenden
	// Kacheln. Der kurze Moment mit vollem Untergrund ist die ruhigere Haelfte.
	// ⚠️ NUR mit `active`. Das Verlassen des Modus (`active === false`) setzt auf 100 % zurueck und muss
	// immer laufen -- ein halb ausgeblasster Untergrund in „Politisch" saehe wie ein kaputter Kachelserver
	// aus, und genau dagegen steht dieser Pfad seit 2026-07-26.
	if (active && !ecosystemAnzeigeAuskunftDa()) {
		return;
	}

	const tilePane = map.getPane("tilePane");
	const container = typeof map.getContainer === "function" ? map.getContainer() : null;
	// Wer den Regler hat, bekommt seinen Wert; wer ihn nicht hat, den seines SOLLS -- seit 09.09.2026 in
	// allen fünf Ebenen 0 % (Owner). Vom 23.08. bis dahin hing der Wert an der EBENE, davor waren es für
	// den Besucher überall dieselben 25 %.
	// ⚠️ ECOSYSTEM_UNDERGROUND_FRONTEND ist damit nur noch der Rückfall für den Fall, dass `active`
	// wahr ist, der Modus aber schon nicht mehr -- die sichere Richtung, unverändert seit 23.08.2026.
	const soll = ecosystemAnzeigeSoll();
	const percent = active
		? (canOperateEcosystemLayers()
			? readStoredEcosystemUndergroundOpacity()
			: (soll ? soll.untergrund : ECOSYSTEM_UNDERGROUND_FRONTEND))
		: 100;
	// 🔴 Bei 0 % gar nicht erst laden. Steht VOR dem Setzen der Deckkraft, damit ein laufender
	// Kachel-Abruf so früh wie möglich abbricht.
	syncEcosystemBaseTiles(!(active && percent <= 0));

	if (tilePane) {
		tilePane.style.opacity = percent >= 100 ? "" : String(percent / 100);
	}
	if (container) {
		// The white shows THROUGH the fading tiles, so it has to sit behind them. Set after
		// setSelectedMapLayerMode has written its own background, which is why this runs from
		// syncEcosystemControlsVisibility and not from the mode setter.
		container.style.background = (active && percent < 100)
			? getComputedStyle(document.documentElement).getPropertyValue("--color-ecosystem-underground").trim()
			: "";
	}
}

// ---- Orte treten im Landschaftsmodus zurück (Owner 2026-08-04) --------------------------------------
// „Städte sollen im Landschaftsmodus standardmässig ausgeblendet werden." Eine Landschaftsansicht handelt
// von Flächen; ein paar tausend Ortspunkte darüber sind dort Streuung, nicht Auskunft.
//
// 🔴 STANDARDMÄSSIG, NICHT ZWANGSWEISE. Die Schalter bleiben da und bedienbar -- wer die Orte im Modus
// zurückhaben will, holt sie sich mit einem Klick.
//
// 💣 UND DIE LAGE VORHER WIRD GEMERKT UND ZURÜCKGEGEBEN. Ohne das nähme ein Besuch der Landschaften dem
// Nutzer seine Ortsauswahl dauerhaft weg: er kommt zurück nach „Politisch" und seine Metropolen sind
// fort, ohne dass irgendetwas sagt, wer sie ausgeschaltet hat.
//
// 💣 KEIN syncPlannerStateToUrl(). Das hier ist keine Wahl des Nutzers, sondern eine Eigenschaft der
// Ansicht -- sie in die Adresszeile zu schreiben hiesse, seinen Teilen-Link hinter seinem Rücken zu
// ändern (URL-Policy: die Adresszeile wird nie automatisch umgeschrieben).
let ecosystemSettlementMemory = null;   // die Schalterlage VOR dem Modus, oder null = nicht im Modus

function syncEcosystemSettlementVisibility(inLayer) {
	if (typeof LOCATION_TYPE_VISIBILITY_ORDER === "undefined"
		|| typeof getLocationToggleButton !== "function"
		|| typeof syncLocationMarkerVisibility !== "function") {
		return;
	}

	// 🔴 SEIT 09.09.2026 WERDEN DIE ORTE AKTIV EINGESCHALTET, nicht nur „nicht weggenommen". Bis dahin
	// fragte diese Funktion allein, ob sie ZURÜCKTRETEN sollen -- für „Alle" tat sie schlicht nichts,
	// und der Besucher sah dort, was er ohnehin eingestellt hatte. Für „default aktiviert und sichtbar"
	// (Owner) reicht das nicht.
	//
	// 💣 DREI FÄLLE, UND DER MITTLERE IST DER, DEN MAN BEIM UMBAU VERLIERT:
	//   (A) Besucher DRIN   -> leihen und nach dem Soll SETZEN
	//   (B) Editor   DRIN   -> leihen und WEGNEHMEN (die leere Zeichenfläche, Owner 04.08.2026)
	//   (C) draussen        -> zurückgeben
	// `ecosystemAnzeigeSoll()` gibt dem Editor `null` -- wer nur danach fragt, lässt ihn in den
	// Rückgabe-Zweig fallen, und er bekäme mitten in der Ebene seine Ortsknöpfe zurück. Das wäre ein
	// Verhaltenswechsel, den niemand bestellt hat; deshalb steht `canOperateEcosystemLayers()` hier
	// ausdrücklich noch einmal und nicht nur in ecosystemFrontendProfile.
	//
	// 🔴 UND EIN VIERTER ZUSTAND, DER KEINEN EIGENEN RIEGEL BRAUCHT: die Rechteauskunft ist noch nicht da
	// (10.09.2026, ecosystemAnzeigeAuskunftDa). Dann fassen alle drei Zweige von selbst nichts an --
	// (A) fällt weg, weil `ecosystemAnzeigeSoll()` ohne Auskunft `null` gibt; (B) fällt weg, weil
	// `canOperateEcosystemLayers()` ohne Auskunft „nein" sagt; (C) kehrt an `ecosystemSettlementMemory
	// === null` zurück, denn vorher kann nichts geliehen worden sein. Ein zusätzlicher `return` hier wäre
	// dieselbe Aussage ein viertes Mal.
	// 💣 WER DARAN DREHT, MUSS DIESE KETTE NACHRECHNEN. Genau sie war am 10.09.2026 gebrochen: (A) lief
	// für einen Editor, weil „unbekannt" wie „Besucher" aussah, lieh sich seine Ortsklassen und schaltete
	// sie an -- und (B) stieg danach an seinem eigenen „nur beim Eintreten leihen" aus. Festgenagelt ist
	// das als ROLLENUMSCHLAG in js/map-features/__tests__/anzeigewahl-schlaegt-vorgabe.test.js.
	const drin = Boolean(inLayer);
	const soll = drin ? ecosystemAnzeigeSoll() : null;
	const editorDrin = drin && !soll && canOperateEcosystemLayers();

	if (soll) {
		// Nur beim EINTRETEN merken -- diese Funktion läuft auch mitten im Modus (etwa wenn die
		// Rechteauskunft eintrifft), und ein zweites Merken schriebe die bereits gesetzte Lage fest.
		if (ecosystemSettlementMemory === null) {
			ecosystemSettlementMemory = LOCATION_TYPE_VISIBILITY_ORDER.map(
				(locationType) => getLocationToggleButton(locationType).hasClass("is-active")
			);
		}
		LOCATION_TYPE_VISIBILITY_ORDER.forEach((locationType) => {
			getLocationToggleButton(locationType).toggleClass("is-active", soll.orte[locationType] === true);
		});
	} else if (editorDrin) {
		// Wort für Wort der Zweig von 2026-08-04: nur beim EINTRETEN merken, sonst schriebe ein zweiter
		// Durchlauf mitten im Modus die bereits leere Lage fest und gäbe ihm seine Orte nie wieder.
		if (ecosystemSettlementMemory !== null) {
			return;
		}
		ecosystemSettlementMemory = LOCATION_TYPE_VISIBILITY_ORDER.map(
			(locationType) => getLocationToggleButton(locationType).hasClass("is-active")
		);
		LOCATION_TYPE_VISIBILITY_ORDER.forEach((locationType) => {
			getLocationToggleButton(locationType).removeClass("is-active");
		});
	} else {
		if (ecosystemSettlementMemory === null) {
			return;   // nichts geliehen -- dann gibt es auch nichts zurückzugeben
		}
		LOCATION_TYPE_VISIBILITY_ORDER.forEach((locationType, index) => {
			getLocationToggleButton(locationType).toggleClass("is-active", ecosystemSettlementMemory[index] === true);
		});
		ecosystemSettlementMemory = null;
	}

	// Die Knöpfe sagen die Wahrheit (aria-pressed, blasse Darstellung), und die Marker folgen.
	if (typeof syncLocationToggleButtons === "function") {
		syncLocationToggleButtons();
	}
	syncLocationMarkerVisibility();
}

// ---- Die Fluesse: der Besucher sieht sie ueberall, der Editor nur nach Ebene ----------------------
//
// 🔴 SEIT DEM 09.09.2026 GILT „UEBERALL" NUR FUER DEN BESUCHER. Sein Wert steht in
// ECOSYSTEM_FRONTEND_PROFIL und sonst nirgends -- „auch die sollen in allen landschaftsansichten
// default aktiviert und sichtbar sein" (Owner) meinte den Besucher, nicht die Werkstatt.
//
// 🔴 DER EDITOR TRAEGT SEINE EIGENE TABELLE WEITER, UND DAS IST KEIN VERSEHEN. Der Nachtrag vom
// 09.09.2026 schob `fluesse` in ein Profil, das der Editor per Definition nie bekommt
// (`ecosystemAnzeigeSoll()` ist fuer ihn `null`) -- ohne einen eigenen Rueckfall waere sein Haken damit
// in jeder Ebene an gewesen, nicht nur in denen, fuer die der Owner das am 23.08.2026 entschieden hat.
// Die Tabelle darunter ist deshalb keine Kopie von damals, sondern die einzige Stelle, die die alte
// Entscheidung noch kennt.
//
// 🔴 DIE EBENE LEIHT SICH DEN HAKEN UND GIBT IHN ZURUECK -- dieselbe Bauart wie
// syncEcosystemSettlementVisibility darueber, und aus demselben Grund: `#toggleRivers` gehoert dem
// Anzeige-Menue der GANZEN Karte. Ohne Gedaechtnis saesse der Benutzer nach dem Verlassen in
// „Standard“ mit einer Fluss-Lage, die er nie gewaehlt hat.
//
// ⚠️ Der Haken bleibt dabei benutzbar (Owner-Entscheid): der Wechsel setzt ihn, die naechste eigene
// Entscheidung sticht ihn. 🔴 Fuer den BESUCHER faellt das „bis zum naechsten Wechsel" seit dem
// 09.09.2026 weg -- seine Entscheidung steht im Soll und wird beim Wechsel zurueckgeschrieben, nicht
// ueberschrieben. Fuer den Editor gilt der Satz weiter, denn fuer ihn gibt es diese eigene Wahl gar
// nicht -- er hat nur seine Ebenentabelle.
const ECOSYSTEM_EDITOR_RIVER_KINDS = new Set(["alle", "topographie"]);

let ecosystemRiverMemory = null;   // die Hakenlage VOR dem Modus, oder null = nicht im Modus

// 🔴 OHNE PARAMETER, UND DAS IST DER PUNKT. Eintreten, Ebenenwechsel und Verlassen kommen alle drei
// bei syncEcosystemPaneStates vorbei; welcher davon es gerade ist, liest diese Funktion selbst am
// Modus ab. Ein „drinnen/draussen"-Argument haette der Aufrufer mitfuehren muessen -- und der zweite
// Aufrufer haette es falsch gesetzt.
function syncEcosystemRiverVisibility() {
	const haken = document.getElementById("toggleRivers");
	if (!haken) {
		return;
	}

	// 💣 syncEcosystemPaneStates laeuft AUCH in anderen Ansichten -- syncEcosystemControlsVisibility
	// ruft es auf BEIDEN Wegen. Ohne diese Frage naehme die Landschaften-Ebene den Fluss-Haken der
	// ganzen Karte in Beschlag, und „Standard" haette danach keine Fluesse mehr.
	const drin = typeof isEcosystemLayerModeActive === "function" && isEcosystemLayerModeActive();

	// 🔴 SOLANGE DIE RECHTEAUSKUNFT FEHLT, WIRD NICHTS ANGEFASST -- UND „NICHTS" HEISST AUCH: NICHT
	// GELIEHEN. Diese Funktion braucht den Riegel ausdruecklich, anders als ihre Nachbarn: ohne Soll
	// faellt sie auf die EDITOR-Tabelle zurueck, und bei unbekannten Rechten hat sie gar kein Soll. Sie
	// wuerde also einem Besucher die Ebenenregel des Editors aufdruecken -- und dabei seinen Hakenstand
	// in einem Moment leihen, in dem applyPlannerStateFromUrl ihn vielleicht noch gar nicht gesetzt hat.
	// Beides heilt die Auskunft danach nicht mehr, weil das Leihen nur EINMAL geschieht.
	// ⚠️ Nur im DRIN-Fall. Der Rueckgabe-Zweig darunter muss laufen duerfen: er gibt zurueck, was diese
	// Ebene sich geliehen hat, und das kann nur passiert sein, als die Auskunft schon da war.
	if (drin && !ecosystemAnzeigeAuskunftDa()) {
		return;
	}

	let soll;
	if (drin) {
		// Nur beim EINTRETEN merken. syncEcosystemControlsVisibility laeuft auch mitten im Modus (etwa
		// wenn die Rechteauskunft eintrifft) -- ein zweites Merken schriebe die GELIEHENE Lage fest, und
		// der Benutzer bekaeme seine eigene nie wieder.
		if (ecosystemRiverMemory === null) {
			ecosystemRiverMemory = haken.checked === true;
		}
		// Besucher: sein Soll (die Vorgabe, oder ab der ersten eigenen Entscheidung seine Wahl). Editor:
		// kein Soll, also die Ebenentabelle -- unveraendert seit dem 23.08.2026.
		const anzeigeSoll = ecosystemAnzeigeSoll();
		soll = anzeigeSoll
			? anzeigeSoll.fluesse === true
			: ECOSYSTEM_EDITOR_RIVER_KINDS.has(isEcosystemShowAllLayers() ? "alle" : getActiveEcosystemLayerKind());
	} else {
		if (ecosystemRiverMemory === null) {
			return;   // war gar nicht im Modus -- dann gibt es auch nichts zurueckzugeben
		}
		soll = ecosystemRiverMemory;
		ecosystemRiverMemory = null;
	}

	if (haken.checked === soll) {
		return;   // sonst zeichnete jeder Kachelklick die Wege neu
	}
	haken.checked = soll;
	// 💣 Ein programmatisch gesetztes `checked` feuert KEIN `change`. Ohne dieses Signal blieben die
	// Fluesse unsichtbar (syncPathVisibility, map-features.js) und die Fliessrichtungs-Pfeile stuenden
	// auf altem Stand (map-features-river-flow-arrows.js) -- beide haengen an genau diesem Haken.
	haken.dispatchEvent(new Event("change", { bubbles: true }));
	// Und zusaetzlich direkt: das Ereignis erreicht nur, wer schon zugehoert hat, und diese Datei laedt
	// vor map-features.js. Doppelt gezeichnet wird deshalb nicht -- syncPathVisibility ist idempotent.
	if (typeof syncPathVisibility === "function") {
		syncPathVisibility();
	}
}

// 🔴 UND DIE FLUSSKONTUR NACHZIEHEN (27.08.2026). `avesmapsFlussKonturSichtbar` (map-features.js)
// beantwortet die Frage richtig -- aber niemand STELLT sie noch einmal, wenn sich der Modus ändert.
// Live gemessen: beim Betreten der Landschaften rechnete die Regel bereits 0, und die 223
// gezeichneten Flüsse trugen weiter `stroke-opacity: 1`. Ein Stil, der von einem Zustand abhängt,
// braucht einen Anstoss, wenn der Zustand wandert.
//
// 💣 EIGENE AUFRUFSTELLE, NICHT AN syncEcosystemRiverVisibility ANGEHÄNGT. Jene Funktion hat DREI
// frühe Ausstiege -- unter anderem `haken.checked === soll`, und genau der greift im häufigsten Fall:
// wer die Flüsse ohnehin eingeschaltet hat, betritt die Topographie ohne jede Änderung am Haken. Ein
// Nachzieher in ihrem Rumpf liefe dann nie.
//
// ⚠️ NUR BEI ECHTER ÄNDERUNG. Diese Wege laufen bei jedem Ebenenwechsel; ein blindes Setzen zöge
// jedes Mal über tausend Flüsse neu -- dieselbe Überlegung wie bei ecosystemSetzeAnzeigeHaken.
// ⚠️ Und über ALLE Flüsse mit gebauten Linien, nicht nur die gerade sichtbaren: eine ausserhalb des
// Bildes liegende Linie behält sonst ihren alten Stil, bis jemand zufällig dorthin schwenkt.
// Frisch gebaute erben ihn ohnehin -- createPathLayer endet auf updatePathLayerStyle.
let ecosystemFlussKonturZuletzt = null;

function syncEcosystemFlussKontur() {
	if (typeof avesmapsFlussKonturSichtbar !== "function" || typeof updatePathLayerStyle !== "function"
		|| typeof normalizePathSubtype !== "function"
		|| typeof pathData === "undefined" || !Array.isArray(pathData)) {
		return;
	}
	const soll = avesmapsFlussKonturSichtbar();
	if (ecosystemFlussKonturZuletzt === soll) {
		return;
	}
	ecosystemFlussKonturZuletzt = soll;
	pathData.forEach((path) => {
		if (!path || !Array.isArray(path._pathLines) || path._pathLines.length === 0) {
			return;
		}
		if (normalizePathSubtype(path.properties?.feature_subtype) !== "Flussweg") {
			return;
		}
		updatePathLayerStyle(path);
	});
}

function syncEcosystemUndergroundControl() {
	const rangeElement = document.getElementById("ecosystem-underground-range");
	const valueElement = document.getElementById("ecosystem-underground-value");
	const percent = readStoredEcosystemUndergroundOpacity();
	if (rangeElement) {
		rangeElement.value = String(percent);
	}
	if (valueElement) {
		valueElement.textContent = `${percent} %`;
	}
}

function setEcosystemUndergroundOpacity(percent) {
	const normalized = Math.max(0, Math.min(100, Math.round(Number(percent))));
	if (!Number.isFinite(normalized)) {
		return;
	}
	storeEcosystemUndergroundOpacity(normalized);
	syncEcosystemUndergroundControl();
	applyEcosystemUndergroundOpacity(true);
}

// ---- „Alle" -- alle drei Ebenen gleichzeitig zeigen (Owner 2026-07-27) -----------------------------
// 🔴 EIN ANZEIGE-FLAG, KEIN VIERTER `kind`. Der Ebenen-Zustand reist zum Server (list_regions,
// create_region), und AVESMAPS_ECOSYSTEM_KINDS kennt genau drei Werte -- „alle" gäbe dort 400, und
// isKnownEcosystemKind lehnt ihn ab, sodass der gemerkte Wert still auf die Vorgabe zurückfiele. Die
// gemerkte Arbeitsebene bleibt also erhalten, „Alle" ändert nur, was SICHTBAR und anklickbar ist.
//
// Zweck: Überlappungen sehen. Genau dafür waren die ruhenden Ebenen auf 0 % gesetzt -- das macht das
// Zeichnen ruhig, verbirgt aber, dass ein Wald über einen See läuft.
const ECOSYSTEM_SHOW_ALL_STORAGE_KEY = "avesmaps.ecosystem.showAllLayers";

// 🔴 SEIT 2026-08-04 WÄHLT AUCH DER BESUCHER (Owner: „einfach die Toggle-Buttons anzeigen, die wir auch
// im Edit-Modus sehen"). Vorher stand er fest auf „Alle", weil er das Bedienfeld gar nicht bekam.
//
// 💣 DREI Zustände, nicht zwei. `undefined` heisst „im Speicher noch nicht nachgesehen", `null` heisst
// „nachgesehen, und dieser Browser hat noch nie gewählt". Nur der zweite Fall darf in die Vorgabe
// fallen -- und die hängt am RECHT, das über das Netz kommt. Würde die Vorgabe wie ein gewählter Wert
// zwischengespeichert, entschiede der Zufall: die Rechteauskunft ist beim ersten Lesen fast immer noch
// unterwegs, und ein Editor bliebe die ganze Sitzung in „Alle" hängen, ohne je etwas gewählt zu haben.
let ecosystemShowAllStored;

function isEcosystemShowAllLayers() {
	if (ecosystemShowAllStored === undefined) {
		ecosystemShowAllStored = null;
		try {
			const gespeichert = window.localStorage?.getItem(ECOSYSTEM_SHOW_ALL_STORAGE_KEY);
			if (gespeichert === "1" || gespeichert === "0") {
				ecosystemShowAllStored = gespeichert === "1";
			}
		} catch (error) {
			// gesperrter Speicher -- dann gilt eben die Vorgabe, und die Wahl überlebt kein Neuladen
		}
	}
	if (ecosystemShowAllStored !== null) {
		return ecosystemShowAllStored;
	}

	// Ohne eigene Wahl: der Besucher bekommt die Übersicht („Alle"), der Editor seine Arbeitsebene.
	return !canOperateEcosystemLayers();
}

// 🔴 WAS „ALLE" NICHT ZEIGT -- die EINE Liste (Owner 27.08.2026: „klimazonen sollen in ‚Alle‘ nicht
// angezeigt werden").
//
// Die Klimazonen sind das einzige, was hier nicht GEZEICHNET, sondern ABGELEITET ist: sieben
// kartenbreite Bänder, die quer über alles laufen, was „Alle" eigentlich zeigen soll. Genau darum
// ging schon der Streit um ihre Füllung -- erst 10 %, dann 16 % („kräftiger"); jetzt gar nicht.
//
// 💣 SIE STEHT HIER UND SONST NIRGENDS. Drei Stellen fragen sie -- die Pane-Klassen, der
// Beschriftungsfilter (map-features-labels.js) und das Klima-Modul selbst --, und ein `kind !==
// "klima"` an dreien wäre dieselbe Aussage dreimal. Das ist die Falle vom 14.08.2026: eine Regel,
// die einen von mehreren Erzeugern bindet, ist keine Regel.
// ⚠️ Und sie gilt NUR für „Alle". Wer die Klimazonen ausdrücklich wählt, bekommt sie -- sonst wäre
// die Ebene abgeschafft und nicht aus einer Übersicht genommen.
const ECOSYSTEM_SHOWALL_VERBORGEN = ["klima"];

function isEcosystemKindHiddenInShowAll(kind) {
	return ECOSYSTEM_SHOWALL_VERBORGEN.includes(String(kind || ""));
}

// Ist diese Ebene gerade SICHTBAR -- also voll gezeichnet und klickbar, nicht blass und
// durchlässig? In „Alle" sind es alle ausser den oben ausgenommenen, sonst nur die Arbeitsebene.
// Eine Frage, eine Antwort: syncEcosystemPaneStates verteilt daraus die Pane-Klassen, und der
// Vertex-Snap (V-Snap, map-features-ecosystem-edit.js) nimmt genau dieselbe Menge als Schnappziele.
// Sonst könnte eine Fläche anziehen, die man gar nicht sieht.
function isEcosystemKindVisible(kind) {
	if (isEcosystemShowAllLayers()) {
		return !isEcosystemKindHiddenInShowAll(kind);
	}
	return kind === getActiveEcosystemLayerKind();
}

// Beendet, was auf der Karte gerade in Arbeit ist. Die ANZAHL der Werkzeuge steht hier bewusst nicht:
// eine Zahl im Kommentar liest sich wie eine vollständige Liste, und genau daran ist die
// Verkehrsmittel-Sperre am 14.08.2026 gescheitert — es suchte niemand weiter. Wer ein weiteres baut,
// hängt es hier ein; js/map-features/__tests__/ecosystem-alle-gesperrt.test.js zählt zur Laufzeit mit.
//
// ⚠️ Die Ecken-Sitzung wird GESCHLOSSEN, nicht verworfen — closeEcosystemGeometryEdit schreibt die
// ausstehende Änderung heraus. Ein Wechsel der Ansicht darf keine getane Arbeit kosten. Der halb
// gezeichnete Umriss dagegen ist per Entwurf ungespeichert und fällt weg, mit Ansage.
function endEcosystemMapTools() {
	if (typeof isEcosystemDrawing === "function" && isEcosystemDrawing()
		&& typeof cancelEcosystemAreaDrawing === "function") {
		cancelEcosystemAreaDrawing("Zeichnen abgebrochen — in „Alle“ wird nicht bearbeitet. Es wurde nichts gespeichert.");
	}
	if (typeof activeEcosystemGeometryEdit !== "undefined" && activeEcosystemGeometryEdit
		&& typeof closeEcosystemGeometryEdit === "function") {
		closeEcosystemGeometryEdit();
	}
	const pinsel = typeof window !== "undefined" ? window.AvesmapsEcosystemBrush : null;
	if (pinsel?.isActive?.()) {
		pinsel.stop?.("Werkzeug beendet — in „Alle“ wird nicht bearbeitet.");
	}
	const operation = typeof window !== "undefined" ? window.AvesmapsEcosystemGeometryOps : null;
	if (operation?.isPending?.()) {
		operation.cancel?.();
	}
}

function setEcosystemShowAllLayers(on) {
	// 🔴 KEIN WERKZEUG ÜBERLEBT DEN WEG NACH „ALLE“. Sonst klebt ein halb gezeichneter Umriss weiter am
	// Zeiger, und sein abschliessender Doppelklick schreibt in eine Ansicht, die gar nichts mehr
	// bearbeitet. Beendet wird VOR dem Umlegen des Schalters: die Werkzeuge räumen selbst auf, und ihr
	// Aufräumen fragt teils dieselbe Bedingung, die gleich umspringt.
	//
	// ⚠️ Nur in DIESE Richtung. Der Weg zurück in eine Ebene gibt die Arbeit frei, er räumt sie nicht weg.
	if (Boolean(on) && !isEcosystemShowAllLayers()) {
		endEcosystemMapTools();
	}
	// Ab hier ist es eine eigene Wahl -- die Vorgabe oben greift für diesen Browser nie wieder.
	ecosystemShowAllStored = Boolean(on);
	try {
		window.localStorage?.setItem(ECOSYSTEM_SHOW_ALL_STORAGE_KEY, ecosystemShowAllStored ? "1" : "0");
	} catch (error) {
		// gesperrter Speicher -- der Schalter wirkt trotzdem, er überlebt nur kein Neuladen
	}
	syncEcosystemLayerSwitchControls();
	syncEcosystemPaneStates();
}

function syncEcosystemLayerSwitchControls() {
	const activeKind = getActiveEcosystemLayerKind();
	const showAll = isEcosystemShowAllLayers();
	document.querySelectorAll("[data-ecosystem-kind]").forEach((tabElement) => {
		// In „Alle" trägt KEINE Ebenen-Kachel die Hervorhebung -- sonst sähe es aus, als sei sie allein
		// aktiv, während alle drei antworten. Die gemerkte Arbeitsebene bleibt darunter bestehen.
		const isActive = !showAll && tabElement.dataset.ecosystemKind === activeKind;
		tabElement.classList.toggle("is-active", isActive);
		tabElement.setAttribute("aria-selected", isActive ? "true" : "false");
		// Roving tabindex: one stop for the whole tablist, arrow keys move inside it.
		tabElement.tabIndex = isActive ? 0 : -1;
	});
	document.querySelectorAll("[data-ecosystem-show-all]").forEach((tabElement) => {
		tabElement.classList.toggle("is-active", showAll);
		tabElement.setAttribute("aria-selected", showAll ? "true" : "false");
		tabElement.tabIndex = showAll ? 0 : -1;
	});
	// Der Zähler der gesperrten Regionen gilt der AKTIVEN Ebene und wandert deshalb mit ihr
	// (19.08.2026). Er steht ausserhalb dieses Reiterbunds -- die Schleifen oben fassen ihn nicht an.
	window.AvesmapsEcosystemStapel?.zeichneZaehler?.();
}

function setActiveEcosystemLayerKind(kind, { focusTab = false } = {}) {
	if (!isKnownEcosystemKind(kind)) {
		return;
	}

	const changed = kind !== getActiveEcosystemLayerKind();
	activeEcosystemLayerKind = kind;
	storeEcosystemLayerKind(kind);
	syncEcosystemLayerSwitchControls();
	syncEcosystemPaneStates();

	// 🪤 In „Alle" NICHT abwählen. Der Grund unten gilt dort nicht -- es gibt keine ruhende Pane, die
	// Fläche bleibt sichtbar und anklickbar. Ohne diese Bedingung verlöre ein Klick auf eine Fläche
	// einer ANDEREN Ebene seine eigene Auswahl sofort wieder: der Klick stellt die Arbeitsebene um, und
	// das Umstellen räumte die gerade getroffene Auswahl weg.
	if (changed && !isEcosystemShowAllLayers() && typeof setSelectedEcosystemArea === "function") {
		// The selected area just moved into a resting pane, where it can no longer be clicked away.
		setSelectedEcosystemArea("");
	}
	// V3.0b: the active region is remembered per kind, so switching the layer switches the region the
	// next drawn area goes into. Guarded because V3.0 ships without the picker.
	if (changed && typeof syncEcosystemRegionCache === "function") {
		syncEcosystemRegionCache();
	}

	if (focusTab) {
		const activeTab = document.querySelector(`[data-ecosystem-kind="${kind}"]`);
		activeTab?.focus();
	}
}

function handleEcosystemLayerSwitchKeydown(event) {
	const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
	if (!keys.includes(event.key)) {
		return;
	}

	event.preventDefault();
	const currentIndex = ECOSYSTEM_KINDS.indexOf(getActiveEcosystemLayerKind());
	const lastIndex = ECOSYSTEM_KINDS.length - 1;
	let nextIndex = currentIndex;

	if (event.key === "Home") {
		nextIndex = 0;
	} else if (event.key === "End") {
		nextIndex = lastIndex;
	} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
		nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
	} else {
		nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1;
	}

	setActiveEcosystemLayerKind(ECOSYSTEM_KINDS[nextIndex], { focusTab: true });
}

function bindEcosystemLayerSwitch() {
	if (ecosystemLayerSwitchBound) {
		return;
	}
	const switchElement = document.getElementById("ecosystem-layer-switch");
	if (!switchElement) {
		return;
	}

	ecosystemLayerSwitchBound = true;
	switchElement.addEventListener("click", (event) => {
		if (event.target?.closest?.("[data-ecosystem-show-all]")) {
			setEcosystemShowAllLayers(true);
			return;
		}
		const tabElement = event.target?.closest?.("[data-ecosystem-kind]");
		if (tabElement) {
			// Eine Ebene zu wählen heisst, „Alle" zu verlassen -- die Kacheln sind EINE Auswahl, nicht ein
			// Schalter neben drei Knöpfen. Erst das Flag, dann die Ebene: sonst räumte der Wechsel noch
			// unter der alten Bedingung die Auswahl weg.
			setEcosystemShowAllLayers(false);
			setActiveEcosystemLayerKind(tabElement.dataset.ecosystemKind);
		}
	});
	switchElement.addEventListener("keydown", handleEcosystemLayerSwitchKeydown);

	// `input`, not `change`: the whole point of the slider is watching the terrain go while dragging.
	document.getElementById("ecosystem-underground-range")
		?.addEventListener("input", (event) => setEcosystemUndergroundOpacity(event.target.value));
}

// Called by syncEcosystemVisibility on every mode change -- the one entry point this feature has.
function syncEcosystemControlsVisibility() {
	const controlsElement = document.getElementById("ecosystem-controls");
	if (!controlsElement) {
		return;
	}

	bindEcosystemLayerSwitch();
	// ⚠️ Der Nachzieher: stand das Anzeige-Menü beim Laden dieser Datei noch nicht im Dokument, ist
	// unten nichts gebunden worden. Beide Aufrufe teilen sich denselben Riegel.
	bindEcosystemAnzeigeWahl();
	const shouldShow = isEcosystemLayerModeActive();
	const operable = shouldShow && canOperateEcosystemLayers();
	// 🔴 DIE EBENEN-KACHELN GEHÖREN JEDEM, DER DIE LANDSCHAFTEN ANSIEHT (Owner 2026-08-04: „einfach die
	// Toggle-Buttons anzeigen, die wir auch im Edit-Modus sehen"). Sie sind keine Werkzeuge, sondern die
	// Frage „welche Ebene schaue ich an" -- dieselbe Art Auswahl wie der Karten-Umschalter daneben.
	controlsElement.hidden = !shouldShow;
	// 🪤 DER UNTERGRUND-REGLER BLEIBT DEM EDITOR. Er ist eine Zeichenhilfe („die gemalte Landschaft soll
	// die gezogene nicht überstimmen"), und wer ihn bekommt, muss auch etwas zu zeichnen haben. Der
	// Besucher bekommt den festen Wert seines Anzeigeprofils -- seit 09.09.2026 0 %, und bei 0 % wird die
	// Kachelebene sogar von der Karte genommen (syncEcosystemBaseTiles). Er sieht unter den
	// Landschaftsflächen also gar keinen Untergrund mehr, nicht einen ausgeblassten.
	// 💣 Bis 10.09.2026 stand hier „nur mit festem Wert (25 %)" -- das war bis zum 23.08.2026 richtig, dann
	// hing der Wert an der Ebene, und seit dem 09.09.2026 ist er 0. Wer nach „warum sind die Kacheln weg"
	// suchte, las hier, sie seien da.
	const undergroundElement = controlsElement.querySelector(".ecosystem-underground");
	if (undergroundElement) {
		undergroundElement.hidden = !operable;
	}

	// Both effects are restored on the way OUT, before the early return: a half-faded base map or a
	// dimmed label pane left behind in "Politisch" would read as a broken map, not as a setting.
	//
	// 🔴 Der ausgeblasste Untergrund gehört zur ANSICHT, nicht zum Werkzeug (Owner 2026-08-04). Er
	// nimmt die gemalte Karte zurück, damit die Landschaftsflächen überhaupt zu lesen sind -- das gilt
	// für den Besucher genauso wie für den, der darauf zeichnet. Nur der WERT unterscheidet sich: der
	// Editor bekommt seinen Regler, der Besucher den seines Anzeigeprofils -- seit 09.09.2026 in allen
	// fünf Ebenen dieselben 0 % (ECOSYSTEM_FRONTEND_PROFIL, ecosystemAnzeigeSoll).
	//
	// 🪤 GESETZT WIRD ER IN syncEcosystemPaneStates, NICHT HIER. Diese Funktion läuft nur beim
	// MODUS-Wechsel, der Wert muss aber auch dem EBENEN-Wechsel folgen -- und der kommt nur dort vorbei.
	// Beide Wege dieser Funktion enden auf syncEcosystemPaneStates, das Verlassen des Modus ist damit
	// abgedeckt. ⚠️ Bis 10.09.2026 begründete diese Zeile das mit „seit der Wert je Ebene verschieden ist";
	// das galt vom 23.08. bis 09.09.2026 und stimmt seither nicht mehr. Der Grund, der bleibt, ist der
	// Regler des Editors: den kann er in jeder Ebene ziehen.
	// Die Orte treten für JEDEN zurück, der die Ebene ansieht -- nicht nur für den, der sie bedienen
	// darf. Deshalb `shouldShow` und nicht `operable`: es ist eine Eigenschaft der Ansicht, keine
	// Zeichenhilfe. Steht wie die Zeile darüber VOR dem frühen Ausstieg, damit das Verlassen des Modus
	// die Orte auf beiden Wegen zurückgibt.
	syncEcosystemSettlementVisibility(shouldShow);
	// 🔴 Auf BEIDEN Wegen. Der Doppelklick-Zoom ist in dieser Ebene aus und muss beim Verlassen wieder
	// an sein -- eine Karte, die nach einem Moduswechsel nicht mehr auf Doppelklick zoomt, wäre für
	// jeden ausserhalb des Editors einfach kaputt. Deshalb vor dem frühen Return und danach.
	if (typeof syncEcosystemDoubleClickZoom === "function") {
		syncEcosystemDoubleClickZoom();
	}
	// Die Kacheln zeigen ihren Zustand für JEDEN an, der sie sieht -- sonst wüsste der Besucher nicht,
	// welche Ebene er gerade betrachtet.
	syncEcosystemLayerSwitchControls();
	if (!operable) {
		// Der gewöhnliche Besucher endet hier: Panes einstellen, fertig. 💣 Vor allem NICHT
		// syncEcosystemRegionCache -- das liest den fähigkeitsgeschützten Editor-Endpunkt und
		// beantwortete ihm jeden Moduswechsel mit einem 403 in der Konsole.
		syncEcosystemPaneStates();
		return;
	}

	syncEcosystemUndergroundControl();
	syncEcosystemPaneStates();
	// V3.0b: the region picker lives in the same box and follows the active kind. Entering the mode
	// refetches, so the area counts in the row are the current ones.
	if (typeof syncEcosystemRegionCache === "function") {
		syncEcosystemRegionCache({ refresh: true });
	}
}

// 🔴 GEBUNDEN WIRD BEIM LADEN, nicht erst beim ersten Moduswechsel. Diese Datei steht in index.html
// NACH dem Anzeige-Menü (die vier Haken um Zeile 3030, das Skript um 3924), die Elemente sind also da
// -- und damit hängt der Zuhörer an ihnen, ohne dass irgendein anderer Weg vorher gelaufen sein muss.
// Ein Zustand, der von der Reihenfolge zweier Verdrahtungen abhängt, ist genau die Art Falle, die
// dieses Modul an anderer Stelle schon zweimal bezahlt hat.
// ⚠️ Fällt offen aus und ist idempotent: ohne Dokument oder ohne Anzeige-Menü passiert nichts, und
// syncEcosystemControlsVisibility holt es beim nächsten Moduswechsel nach.
if (typeof document !== "undefined" && document && typeof document.getElementById === "function") {
	bindEcosystemAnzeigeWahl();
}
