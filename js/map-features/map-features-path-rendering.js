function pathHasWiki(path) {
	return Boolean(path && path.properties && path.properties.wiki_path && path.properties.wiki_path.wiki_key);
}

// Ab so vielen Stationen lohnt der Deckel. Darunter spart das Eindampfen nichts: die Vorschau zeigt
// erste → … → letzte, also zwei Namen plus Auslassung — bei vier Stationen ist das keine Ersparnis,
// nur ein Klick mehr. Gemessen an der Reichsstraße 2: 33 Stationen, elf Zeilen in einem 250 px
// schmalen Panel; das war der Anlass (Owner 2026-08-12).
const PATH_VERLAUF_LID_MIN_STATIONS = 5;

// „Verlauf" als Deckel: eingedampft auf erste → … → letzte, mit dem Satz „33 Orte auf dem Weg"
// darunter (Owner 2026-08-12, sein Wortlaut).
//
// ⚠️ Der volle Inhalt ist das UNVERÄNDERTE Markup von linkifyPathVerlauf -- die Fly-to-Verlinkungen
// der Stationen bleiben also, wie sie sind. Der Deckel ordnet nur an, er baut nicht um.
//
// 💣 Die Vorschau linkifiziert erste und letzte Station EINZELN, statt aus dem fertigen Markup zu
// schneiden. Ein Schnitt in fertiges HTML zerlegt Tags; und `linkifyPathVerlauf` ist auf genau diesen
// Trenner ausgelegt, nimmt also einen einzelnen Namen genauso an wie eine ganze Kette.
function pathVerlaufLidMarkup(verlauf, fullMarkup) {
	if (typeof buildInfoboxLid !== "function") {
		return "";   // Bauteil (noch) nicht geladen -> der Aufrufer bleibt bei seiner alten Zeile
	}
	const stations = String(verlauf || "").split(" → ").map((part) => part.trim()).filter(Boolean);
	if (stations.length === 0) {
		return "";
	}
	const openable = stations.length >= PATH_VERLAUF_LID_MIN_STATIONS;
	const link = (station) => (typeof linkifyPathVerlauf === "function"
		? (linkifyPathVerlauf(station) || escapeHtml(station))
		: escapeHtml(station));
	const preview = openable
		? `${link(stations[0])} → … → ${link(stations[stations.length - 1])}`
		: fullMarkup;
	return buildInfoboxLid({
		preview,
		full: fullMarkup,
		count: stations.length,
		singular: tr("infobox.lid.stationsOne", "Ort auf dem Weg"),
		plural: tr("infobox.lid.stationsMany", "Orte auf dem Weg"),
		openable,
	});
}

// Infobox eines Wiki-Wegs (Fluss/Strasse) — gleiche .region-info-box-Struktur wie Regionen/Gebiete.
function pathWikiInfoboxMarkup(path) {
	const wiki = (path.properties && path.properties.wiki_path) || {};
	const name = wiki.name || getPathDisplayName(path) || "";
	const row = (dtLabel, value) => {
		if (!value || String(value).trim() === "") {
			return "";
		}
		return `<div class="region-info-box__row"><dt>${escapeHtml(dtLabel)}</dt><dd>${escapeHtml(value)}</dd></div>`;
	};
	const art = String(wiki.art || "").trim() || (wiki.kind === "fluss" ? "Fluss" : (wiki.kind === "strasse" ? "Straße" : ""));
	// Same row, but the value is already-escaped MARKUP (linkified) instead of a raw string.
	const rowHtml = (dtLabel, valueHtml) => {
		if (!valueHtml || String(valueHtml).trim() === "") {
			return "";
		}
		return `<div class="region-info-box__row"><dt>${escapeHtml(dtLabel)}</dt><dd>${valueHtml}</dd></div>`;
	};
	// Owner 2026-07-17: the objects "Verlauf"/"Lage" name are on our map too -> gold fly-to links
	// (map-features-path-item-links.js). Sea routes are excluded and every token we cannot resolve stays plain
	// text, so both linkify calls fall back to the escaping `row` when they come back empty.
	const linksSupported = typeof pathSupportsItemLinks === "function" && pathSupportsItemLinks(path);
	const lageHtml = (linksSupported && typeof linkifyPathLage === "function") ? linkifyPathLage(wiki.lage) : "";
	const verlaufHtml = (linksSupported && typeof linkifyPathVerlauf === "function") ? linkifyPathVerlauf(wiki.verlauf) : "";
	let rows = "";
	rows += lageHtml ? rowHtml("Lage", lageHtml) : row("Lage", wiki.lage);
	rows += row("Länge", wiki.laenge);
	// 🔴 „Eingeschränkt befahrbar" (Owner 01.09.2026) -- dieselbe Regel, die auf der Karte den Namen
	// kursiv setzt (avesmapsWegEinschraenkungFuerPfad, gelesen in getPathLabelStyle). Zwei Anzeigen,
	// eine Regel; liefe hier eine zweite, stünde irgendwann ein kursiver Name ohne Zeile da.
	// ⚠️ Der Plural ist Owner-Wort: es können zwei Aussagen sein (Zeitfenster UND Reisemittel).
	// ⚠️ Die Monatsnamen kommen über routePlanMonthLabel aus dem <select> des Routenplaners -- es gibt
	// nur EINE Liste der zwölf Monate, und die steht im Markup (AGENTS.md §2).
	if (typeof avesmapsWegEinschraenkungFuerPfad === "function") {
		const einschraenkung = avesmapsWegEinschraenkungFuerPfad(path);
		const monatsName = typeof routePlanMonthLabel === "function" ? routePlanMonthLabel : null;
		rows += row("Einschränkungen", avesmapsWegEinschraenkungSatz(einschraenkung, monatsName));
	}
	// „Verlauf" im Deckel, wenn er lang ist. ⚠️ Der Rückfall ist zweistufig und beide Stufen tragen:
	// ohne Fly-to-Links (Seeweg) gibt es kein verlaufHtml und die escapende `row` übernimmt; ohne das
	// Bauteil liefert pathVerlaufLidMarkup "" und es bleibt bei der Zeile von vorher.
	//
	// 🔴 DIE ZEILE STEHT NICHT HIER, SONDERN IM LANDSCHAFTS-CONTAINER. Owner 2026-08-12: „Verlauf"
	// gehört unter „Führt durch" -- und das entsteht erst nach einem Abruf, ganz am Ende der
	// Feldliste. Statt die fertige Zeile hier einzusetzen, wird sie dem Container als Anfangsinhalt
	// mitgegeben; der Beobachter schiebt „Führt durch" davor und den Rest dahinter
	// (avesmapsPathLandscapesFillPending).
	//
	// ⭐ Der Nebengewinn ist der eigentliche Grund, es SO zu lösen und nicht über einen zweiten
	// Container: bleibt der Abruf aus oder scheitert er, steht der Verlauf trotzdem da -- er ist ja
	// schon drin. Ein leerer Platzhalter, den erst der Beobachter füllt, wäre bei jedem Netzfehler
	// eine verschwundene Zeile.
	const verlaufLid = verlaufHtml ? pathVerlaufLidMarkup(wiki.verlauf, verlaufHtml) : "";
	const verlaufRow = verlaufLid
		? rowHtml("Verlauf", verlaufLid)
		: (verlaufHtml ? rowHtml("Verlauf", verlaufHtml) : row("Verlauf", wiki.verlauf));
	rows += row("Beschreibung", typeof settlementFirstSentence === "function" ? settlementFirstSentence(wiki.description) : String(wiki.description || "").trim());
	// Multi-source system: paths get a source line for the FIRST time here (previously the wiki
	// credit only rendered when a wiki article was linked at all). Rendered synchronously from the
	// map-features payload (renderFeatureSourceLine in js/ui/popups.js resolves approved sources).
	const sourceMarkup = typeof renderFeatureSourceLine === "function"
		? renderFeatureSourceLine("path", getPathPublicId(path), wiki.wiki_url || "", "location-popup__wiki-link")
		: "";
	// Kopflos (Name + Typ zeigt der Popup-Kopf schon) + gleiche Klasse wie Siedlungen -> erbt
	// Trenner/Breite/Padding der .settlement-popup-Styles. Der "Link teilen"-Button lebt (Owner) NICHT mehr
	// hier am Ende, sondern direkt unter dem Kopf -- createPathPopupMarkup setzt ihn via pathShareMarkup davor.
	// V10 „Führt durch": ein LEERER, markierter Container -- hier wird NICHT geladen. Dieses Markup
	// entsteht fuer ALLE 5.650 Wege beim Kartenaufbau (bindPopup bekommt fertiges HTML); ein fetch an
	// dieser Stelle waeren 5.650 gleichzeitige Anfragen, und genau das hat 2026-07-21 den PHP-Pool
	// gesaettigt. Der Beobachter in map-features-path-landscapes.js fuellt ihn, sobald er wirklich im
	// DOM steht -- also erst, wenn jemand die Infobox geoeffnet hat.
	// Ohne eigene Huelle (display:contents wie .avesmaps-lore-rows): er sitzt mitten in der Feldliste
	// und seine Kinder sollen direkt ins Zeilenraster greifen, statt es zu brechen.
	// Der Container kommt NICHT leer: der Verlauf steht schon darin (siehe oben). Der Beobachter liest
	// ihn als „das, was hier bereits steht" und ordnet drumherum an.
	const landscapeContainer = `<div class="avesmaps-path-landscapes" data-path-landscapes="${escapeHtml(getPathPublicId(path))}">${verlaufRow}</div>`;
	return (
		'<div class="region-info-box region-info-box--settlement">' +
		`<dl class="region-info-box__data">${rows}${landscapeContainer}</dl>` +
		sourceMarkup +
		"</div>"
	);
}

// "Link teilen"-Button eines Weges -- gehoert (Owner) in DASSELBE Kachelband wie "Änderung vorschlagen",
// direkt unter dem Kopf (nicht als eigenes Band dahinter). Nur bei verlinktem Wiki-Artikel (Wege sind nicht
// ueber ?place= aufloesbar). wikiParam nach Subtyp: Fluss/Seeweg -> "fluss", sonst "strasse" (wiki-deeplink.js).
function pathShareButtonMarkup(path) {
	const wiki = (path.properties && path.properties.wiki_path) || {};
	if (!wiki.wiki_url) {
		return "";
	}
	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	const wikiParam = (pathSubtype === "Flussweg" || pathSubtype === "Seeweg") ? "fluss" : "strasse";
	return sharePlaceActionButtonMarkup(getPathPublicId(path), { wikiUrl: wiki.wiki_url, wikiParam });
}

// "Anzeigen" (Owner 2026-07-17): highlights the WHOLE way and zooms to its full extent -- the same thing the
// ?strasse=/?fluss= deep link does, through the same resolver. Filled (--accent) because it is the only tile
// that acts on the MAP; the other two open dialogs. Gated like "Link teilen" on a linked wiki article (that
// URL identifies the way), and off for sea routes like the item links.
// The sextant is what "Anzeigen" already looks like elsewhere (the show-in-panel tile on the "nächster Ort"
// box, js/map-features/map-features-location-marker-entry.js) -- same word, same icon, even though the
// actions differ. Kept unversioned like that one: the file never changes.
// (The route-waypoint box had the same tile until 2026-08-04; there a click on the disc opens the place
// itself now, so the tile was dropped -- see buildRoutePopupHtml in js/routing/routing.js.)
function pathShowActionButtonMarkup(path) {
	const wiki = (path.properties && path.properties.wiki_path) || {};
	const supported = typeof pathSupportsItemLinks === "function" && pathSupportsItemLinks(path);
	if (!wiki.wiki_url || !supported) {
		return "";
	}
	return popupActionButtonMarkup({
		label: (typeof tr === "function" ? tr("popup.showWholePath", "Anzeigen") : "Anzeigen"),
		className: "location-popup__action-button--accent",
		iconMarkup: '<img class="location-popup__action-img" src="icons/sextant.webp" alt="" width="20" height="20" />',
		attributes: {
			"data-popup-action": "show-whole-path",
			"data-public-id": getPathPublicId(path),
		},
	});
}

// Kopf-Icon fuer den Weg-Kopf (Owner: einheitlicher grosser Kopf -- Wege haben kein Wappen, bekommen
// aber ein Typ-Icon, damit der Kopf nicht leer wirkt). Fluss/Seeweg -> Wellen, sonst Strassen-Symbol.
// Inline-SVG (kein Asset noetig), fuellt die location-popup__icon-Groesse.
function pathHeaderIconMarkup(pathType) {
	// ⚠️ „Bach" ist hier der ANZEIGE-Typ (pathAnzeigeSubtyp) -- er kommt nie aus der Datenbank,
	// aber genau er steht in `pathType`, sobald das Haekchen gesetzt ist. Ohne ihn bekaeme ein
	// Bach das STRASSEN-Symbol.
	const isWater = pathType === "Flussweg" || pathType === "Seeweg" || pathType === "Bach";
	const svg = isWater
		? '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="#3f6fa0" stroke-width="1.7" stroke-linecap="round"><path d="M3 7q3 -2.4 6 0t6 0 6 0"/><path d="M3 12q3 -2.4 6 0t6 0 6 0"/><path d="M3 17q3 -2.4 6 0t6 0 6 0"/></svg>'
		: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="#7a6647" stroke-width="1.7" stroke-linecap="round"><path d="M8.5 21 11 3"/><path d="M15.5 21 13 3"/><path d="M12 5.5v2.5M12 11v2.5M12 16.5v2.5"/></svg>';
	return `<span class="location-popup__icon location-popup__icon--path" style="display:inline-flex" aria-hidden="true">${svg}</span>`;
}

function createPathPopupMarkup(path) {
	// 🔴 DER ANZEIGE-TYP, nicht der gespeicherte: ein Flussweg mit Haekchen „Bach" heisst hier
	// „Bach" (Owner 30.08.2026). Diese eine Zeile traegt DREI Anzeigen -- die Typzeile
	// (getPathTypeLabel), den Titel eines unbenannten Weges (getUnnamedPathTitle) und das Kopfbild
	// (pathHeaderImageBasename); alle drei lesen `pathType`. Genau deshalb steht die Weiche hier
	// und nicht dreimal weiter unten.
	// ⚠️ Der Rueckfall auf den NAMEN bleibt: Altbestaende ohne `feature_subtype` haengen daran.
	const speicherTyp = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	const pathType = (typeof pathIstBach === "function" && pathIstBach(path)) ? "Bach" : speicherTyp;
	// Titel wie in der Routen-Etappe (Owner): echter Name -> Name im Titel, Typ als Untertitel; kein Name
	// -> "Unbenannte Straße" tritt an die Titelstelle und der Untertitel entfaellt (stuende sonst doppelt).
	// getPathTitleName nimmt den WIKI-Namen zuerst -- genau wie die Spotlight-Suche. Vorher stand hier roh
	// getPathDisplayName, deshalb zeigte die Infobox als EINZIGE Flaeche "Reichsstrasse-16", waehrend die
	// Suche "Reichsstraße 2" sagte (12 Altsegmente verletzen R1; die Anzeige heilt das jetzt von selbst).
	const realName = typeof getPathTitleName === "function" ? getPathTitleName(path) : getPathDisplayName(path);
	const typeLabel = getPathTypeLabel(pathType);
	const pathName = realName || (typeof getUnnamedPathTitle === "function" ? getUnnamedPathTitle(pathType) : typeLabel);
	// 🔴 BEIM WASSER AUCH OHNE NAMEN. Ein namenloser Weg trug bisher gar keinen Untertitel --
	// „Unbenannte Straße" über „Straße" liest sich doppelt. Der Fluss heißt oben seit dem
	// 31.08.2026 „Unbenannter Fluss", darunter passt die Wegart „Flussweg" wie bei einem
	// benannten Fluss (Owner).
	// ⚠️ Beim Bach steht das Wort dann zweimal („Unbenannter Bach" / „Bach") -- ausdrücklicher
	// Owner-Entscheid vom 31.08.2026, nicht übersehen. Die Landwege bleiben ohne Untertitel.
	const istWasserweg = pathType === "Flussweg" || pathType === "Bach";
	const subtitle = (realName || istWasserweg) ? typeLabel : "";
	// Owner: 16:9 header image per way subtype + title overlay.
	const headerImg = typeof infoHeaderImageMarkup === "function"
		? infoHeaderImageMarkup(pathHeaderImageBasename(pathType), pathName, subtitle)
		: "";
	return locationPopupMarkup({
		name: pathName,
		locationType: "dorf",
		locationTypeLabel: subtitle,
		headerImageMarkup: headerImg,
		headerIconMarkup: pathHeaderIconMarkup(pathType),
		// Derselbe Schluessel wie die Quellenzeile weiter oben (getPathPublicId): Wege kennen keine
		// Ankergruppierung wie die Kraftlinien, jedes Segment steht fuer sich.
		kanonMarkup: typeof renderFeatureKanonBadge === "function"
			? renderFeatureKanonBadge("path", getPathPublicId(path)) : "",
		showHeaderIcon: true,
		showDescription: false,
		showWikiLink: false,
		showType: Boolean(subtitle),
		actionsMarkup: (function () {
			const buttons = [];
			// "Anzeigen" zuerst (Owner): [Anzeigen] [Link teilen] [Änderung vorschlagen] in EINEM Band.
			const showButton = pathShowActionButtonMarkup(path);
			if (showButton) { buttons.push(showButton); }
			// "Link teilen" danach -- alle drei gehoeren in EIN Band unter dem Kopf, nicht in ein eigenes dahinter.
			const shareButton = pathShareButtonMarkup(path);
			if (shareButton) { buttons.push(shareButton); }
			// Community "Änderung vorschlagen" -- paths get a public action band here for the first time.
			const suggestSpec = typeof buildSuggestChangeButtonSpec === "function"
				? buildSuggestChangeButtonSpec({
					entityType: "path",
					entityId: getPathPublicId(path),
					name: pathName,
					reportType: "weg",
					label: (typeof tr === "function" ? tr("popup.suggestChange", "Änderungen vorschlagen") : "Änderungen vorschlagen"),
				})
				: null;
			if (suggestSpec) {
				buttons.push(popupActionButtonMarkup(suggestSpec));
			}
			// Ab hier, was nur ein Editor sieht -- eigene Liste, eigenes Band unter der Trennlinie
			// (locationPopupEditorBandMarkup in js/ui/popups.js). Bis zum 13.08.2026 standen diese
			// drei bis vier Kacheln ununterscheidbar neben "Link teilen".
			const editorButtons = [];
			if (IS_EDIT_MODE) {
				// Fluss-Shortcut: Stroemung direkt am Segment umkehren/festlegen, ohne den
				// "Weg bearbeiten"-Dialog (weg-weite Wirkung wie die Panel-Buttons).
				// 🔴 DER SPEICHER-TYP, NICHT DER ANZEIGE-TYP. `pathType` sagt bei einem Bach "Bach"
				// -- richtig fuer Typzeile, Titel und Kopfbild, falsch fuer eine FUNKTION: ein Bach ist
				// ein Flussweg und hat eine Fliessrichtung. Die Pfeile zeichnen fuer ihn weiter (sie
				// fragen normalizePathSubtype), der Knopf war aber weg -- der Editor sah die Pfeile und
				// hatte keinen Griff mehr, sie zu drehen (Owner 31.08.2026).
				if (speicherTyp === "Flussweg" && typeof pathFlowShortcutLabelFor === "function") {
					editorButtons.push(popupActionButtonMarkup({
						label: pathFlowShortcutLabelFor(path),
						className: "location-popup__action-button--accent",
						iconMarkup: popupActionGlyphMarkup("fluss"),
						attributes: {
							"data-popup-action": "flip-river-flow",
							"data-public-id": getPathPublicId(path),
						},
					}));
				}
				editorButtons.push(popupActionButtonMarkup({
					label: "Bearbeiten",
					// Dasselbe Zahnrad wie am Ort: dieselbe Geste an einem anderen Gegenstand.
					iconMarkup: popupActionGlyphMarkup("bearbeiten"),
					attributes: {
						"data-popup-action": "edit-path-details",
						"data-public-id": getPathPublicId(path),
					},
				}));
				editorButtons.push(popupActionButtonMarkup({
					label: "Verlauf bearbeiten",
					// Der Stift, nicht das Zahnrad: hier werden keine Eigenschaften geaendert, sondern
					// die LINIE angefasst -- genau die Trennung, die das Kontextmenue zwischen
					// „Grenzen bearbeiten" (✎) und „Territoriumseditor oeffnen" (⚙) macht. Die beiden
					// Kacheln stehen nebeneinander und muessen sich auf einen Blick unterscheiden.
					iconMarkup: popupActionGlyphMarkup("verlauf"),
					attributes: {
						"data-popup-action": "edit-path-geometry",
						"data-public-id": getPathPublicId(path),
					},
				}));
				editorButtons.push(popupActionButtonMarkup({
					label: "Weg löschen",
					className: "location-popup__action-button--danger",
					iconMarkup: popupActionGlyphMarkup("loeschen"),
					attributes: {
						"data-popup-action": "delete-path",
						"data-public-id": getPathPublicId(path),
					},
				}));
			}
			return (buttons.length ? locationPopupActionsMarkup(buttons) : "")
				+ locationPopupEditorBandMarkup(editorButtons);
		})() + pathWikiInfoboxMarkup(path),
	});
}

// Zeichen-Reihenfolge der Wege, von UNTEN nach OBEN. Reichsstrassen liegen ganz oben, dann Strassen, Wege,
// Pfade, Gebirgspaesse, Wuestenpfade; das Wasser (Fluesse, dann Meer/Seewege) liegt ganz unten. Damit liegen
// Strassen immer ueber Fluessen. Die App kennt nur zwei Wasser-Subtypen: Flussweg (Fluss) und Seeweg (Meerwege).
const PATH_DRAW_ORDER_BOTTOM_TO_TOP = ["Seeweg", "Flussweg", "Wuestenpfad", "Gebirgspass", "Pfad", "Weg", "Strasse", "Reichsstrasse"];

// SVG zeichnet in DOM-Reihenfolge (spaeter = oben). Wir holen die Subtypen von unten nach oben per
// bringToFront() nach vorne -> Reichsstrassen landen zuletzt = obenauf. Muss nach jedem Ein-/Ausblenden
// laufen, weil neu hinzugefuegte Layer ans Ende (= oben) gehaengt werden. Betrifft nur sichtbare Linien.
function applyPathDrawOrder() {
	if (!Array.isArray(pathData) || !pathData.length) {
		return;
	}
	const bySubtype = new Map();
	pathData.forEach((path) => {
		if (!path?._pathLines?.length) {
			return;
		}
		const subtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
		if (!bySubtype.has(subtype)) {
			bySubtype.set(subtype, []);
		}
		bySubtype.get(subtype).push(path);
	});
	PATH_DRAW_ORDER_BOTTOM_TO_TOP.forEach((subtype) => {
		const paths = bySubtype.get(subtype);
		if (!paths) {
			return;
		}
		paths.forEach((path) => {
			path._pathLines.forEach((line) => {
				if (typeof line.bringToFront === "function" && map.hasLayer(line)) {
					line.bringToFront();
				}
			});
		});
	});
}

function updatePathLayerStyle(path) {
	if (!path?._pathLines?.length) {
		return;
	}

	const colors = getPathStyleColors(path);
	path._pathLines[0]?.setStyle({ color: colors.outline, weight: colors.outlineWeight, opacity: colors.outlineOpacity });
	path._pathLines[1]?.setStyle({ color: colors.center, weight: colors.centerWeight });
	refreshPathLayerText(path);
}

function getPathVisualLatLngCoordinates(coordinates, zoomLevel = map.getZoom()) {
	return smoothLineCoordinatesForDisplay(coordinates, VISUAL_LINE_CATMULL_ROM_CONFIG).map(([x, y]) => [y, x]);
}

// Die (unsichtbare) Label-Linie, der die SVG-<textPath> folgt, IST jetzt die SICHTBARE Linie selbst (dieselbe
// Catmull-Kurve durch die Originalpunkte) -> der Text liegt EXAKT auf dem Weg/Fluss. "Glätten" = nur entlang
// dieser Kurve NEU ABTASTEN: Dichte<1 = AUSDÜNNEN (weniger Stützpunkte -> ruhiger, gegen Zerreissen an Bögen),
// Dichte>1 = UNTERTEILEN (dichter, bleibt exakt auf den Segmenten). KEIN Mittelwert-Verschieben mehr (das zog
// die Leitlinie von der sichtbaren Linie weg). Dichte=1 -> Leitlinie == sichtbare Linie. Steuergröße
// PATH_LABEL_GUIDE_DENSITY liegt in map-features-path-labels.js (laedt zuerst; Slider mutiert sie).
function resamplePathLabelPolyline(points, density) {
	const d = Number(density) || 1;
	if (!Array.isArray(points) || points.length < 3 || Math.abs(d - 1) < 0.001) {
		return points;
	}
	if (d < 1) {
		const step = Math.max(1, Math.round(1 / d));
		const out = [];
		for (let i = 0; i < points.length; i += step) out.push(points[i]);
		if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
		return out;
	}
	const sub = Math.max(1, Math.round(d)); // jedes Segment in `sub` Teile -> Punkte bleiben EXAKT auf der Linie
	const out = [points[0]];
	for (let i = 1; i < points.length; i += 1) {
		const a = points[i - 1], b = points[i];
		for (let k = 1; k <= sub; k += 1) {
			const t = k / sub;
			out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
		}
	}
	return out;
}

function getPathLabelVisualLatLngCoordinates(coordinates) {
	if (!Array.isArray(coordinates) || coordinates.length < 3) {
		return getPathVisualLatLngCoordinates(coordinates);
	}
	const onTheLine = getPathVisualLatLngCoordinates(coordinates); // = sichtbare Catmull-Linie [[lat,lng],...]
	const density = (typeof PATH_LABEL_GUIDE_DENSITY !== "undefined") ? PATH_LABEL_GUIDE_DENSITY : 1;
	return resamplePathLabelPolyline(onTheLine, density);
}

function refreshPathLayerPopup(path) {
	if (!path?._pathLines?.length) {
		return;
	}

	// Popup wird NICHT mehr per bindPopup automatisch geoeffnet, sondern manuell im click-Handler (siehe
	// createPathLayer). Grund: der Klick-Schiedsrichter (docs/click-arbiter-coordination.md) muss den Weg-Popup
	// unterdruecken koennen, wenn eine Siedlung auf dem Weg liegt -- ein bindPopup-Auto-Open liesse sich nicht
	// abbrechen (Leaflet feuert alle click-Listener). Wir merken uns nur Markup + Optionen am Pfad.
	path._popupMarkup = createPathPopupMarkup(path);
	// Dieselbe Huelle fuer JEDEN Weg. Vorher: ohne wiki_path ein leeres {} -> der 260px-Deckel aus
	// .location-popup blieb stehen und die Editor-Aktionen fielen untereinander; und selbst MIT wiki_path
	// fehlte "floating-location-popup", also die Kachel-Optik, die das Panel laengst zeigt. Nur der Inhalt
	// haengt an pathHasWiki (createPathPopupMarkup), nicht die Kiste.
	path._popupOptions = {
		className: (typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE)
			? "settlement-popup floating-location-popup"
			: "settlement-popup",
		minWidth: 320,
		maxWidth: 400,
	};
}

function createPathLayer(path) {
	const latLngCoords = getPathVisualLatLngCoordinates(path.geometry.coordinates);
	const colors = getPathStyleColors(path);
	const roadOutline = L.polyline(latLngCoords, {
		pane: "roadsOutlinePane",
		renderer: getVectorRenderer("roadsOutlinePane"),
		color: colors.outline,
		weight: colors.outlineWeight,
		opacity: 1,
		interactive: IS_EDIT_MODE || pathHasWiki(path),
		bubblingMouseEvents: false,
		lineCap: "round",
		lineJoin: "round",
	});
	const roadCenter = L.polyline(latLngCoords, {
		pane: "roadsPane",
		renderer: getVectorRenderer("roadsPane"),
		color: colors.center,
		weight: colors.centerWeight,
		opacity: 1,
		interactive: IS_EDIT_MODE || pathHasWiki(path),
		bubblingMouseEvents: false,
		lineCap: "round",
		lineJoin: "round",
	});
	const pathLabelLine = L.polyline(getReadablePathLabelLatLngCoordinates(getPathLabelVisualLatLngCoordinates(path.geometry.coordinates)), {
		pane: "labelsPane",
		color: "transparent",
		weight: 1,
		opacity: 0,
		interactive: false,
		lineCap: "round",
		lineJoin: "round",
	});

	// Die Label-Linie kommt NICHT in den umschaltbaren Group (sonst verschwände das Label, sobald der Pfad
	// ausgeblendet wird). syncPathVisibility hält sie dauerhaft auf der Karte; refreshPathLayerText entscheidet
	// über die Text-Sichtbarkeit (Zoom + Label-Schalter) -> Fluss-Labels bleiben auch ohne Fluss-Pfade sichtbar.
	const layerGroup = L.layerGroup([roadOutline, roadCenter]);
	path._layerGroup = layerGroup;
	path._pathLines = [roadOutline, roadCenter];
	path._pathLabelLine = pathLabelLine;
	if (IS_EDIT_MODE) {
		path._pathLines.forEach((line) => {
			line.on("dblclick", (event) => handleEditablePathDoubleClick(path, event));
		});
	}
	path._pathLines.forEach((line) => {
		line.on("click", (event) => {
			// Zuordnungs-Pick: im „Ziel wählen"-Modus faengt ein Klick das Segment ab (statt Popup).
			if (window.__pathAssignPending && typeof handlePathWikiAssignmentPick === "function" && handlePathWikiAssignmentPick(path)) {
				L.DomEvent.stopPropagation(event);
				if (typeof map !== "undefined") {
					setTimeout(() => {
						try {
							map.closePopup();
						} catch (error) {
							/* noop */
						}
					}, 0);
				}
				return;
			}
			// Klick-Schiedsrichter: liegt eine Siedlung auf diesem Weg, gewinnt sie den Klick (Priorität
			// Siedlung > Straße/Fluss). Der Weg-Popup wird dann NICHT geoeffnet. Siehe
			// docs/click-arbiter-coordination.md. Im Edit-Modus ist der Global undefined -> kein Effekt.
			if (typeof window.avesmapsTryOpenLocationAtContainerPoint === "function"
					&& window.avesmapsTryOpenLocationAtContainerPoint(event.containerPoint)) {
				L.DomEvent.stop(event);
				return;
			}
			// Infopanel (?infopanel=true): Weg-/Fluss-Info ins rechte Panel statt ins schwebende Popup.
			if (typeof window.avesmapsShowPathInInfopanel === "function" && window.avesmapsShowPathInInfopanel(path)) {
				return;
			}
			// Sonst den Weg-Popup manuell oeffnen (bindPopup-Ersatz, damit der Schiedsrichter ihn unterdruecken kann).
			if (path._popupMarkup && typeof map !== "undefined") {
				L.popup(path._popupOptions || {})
					.setLatLng(event.latlng)
					.setContent(path._popupMarkup)
					.openOn(map);
			}
		});
	});
	refreshPathLayerPopup(path);
	updatePathLayerStyle(path);
	return layerGroup;
}

function updatePathLayerGeometry(path) {
	if (!path?._pathLines) {
		return;
	}

	const latLngCoords = getPathVisualLatLngCoordinates(path.geometry.coordinates);
	path._pathLines.forEach((line) => line.setLatLngs(latLngCoords));
	path._pathLabelLine?.setLatLngs(getReadablePathLabelLatLngCoordinates(getPathLabelVisualLatLngCoordinates(path.geometry.coordinates)));
	path._geomBounds = undefined; // Bbox-Cache (Viewport-Culling) invalidieren -> Geometrie hat sich geändert.
	// Geometrie geändert -> Pfad-Namen-Canvas neu zeichnen.
	if (window.AvesmapsPathLabelCanvasOverlay) {
		window.AvesmapsPathLabelCanvasOverlay.redraw();
	}
}
