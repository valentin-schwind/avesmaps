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
	// ersten Wert, der je Ebene verschieden ist, neu zu finden.
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

