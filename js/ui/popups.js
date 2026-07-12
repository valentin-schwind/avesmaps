function popupActionButtonMarkup({ label, className = "", attributes = {}, iconMarkup = "" }) {
	const safeClassName = className ? ` ${escapeHtml(className)}` : "";
	return `<button type="button" class="location-popup__action-button${safeClassName}"${buildHtmlAttributes(attributes)}>${iconMarkup}${escapeHtml(label)}</button>`;
}

function locationPopupActionsMarkup(actionButtons = []) {
	if (!actionButtons.length) {
		return "";
	}

	return `<div class="location-popup__actions">${actionButtons.join("")}</div>`;
}

// "Link teilen": kopiert einen direkten Link auf diese Stelle (Siedlung/Region), der beim
// Öffnen hinfliegt und die Infobox triggert. Sichtbar in beiden Modi. Hat das Objekt einen
// verknüpften Wiki-Artikel, bevorzugt buildPlaceShareLink (map-features-share-pin.js) den
// dokumentierten Deep-Link-Parameter (?siedlung/?staat/?region/?strasse/?fluss) statt
// ?place=<publicId> -- wikiUrl/wikiParam werden dafür als data-Attribute mitgegeben (der
// Klick-Handler in routing.js liest sie zurück). Ohne wikiUrl bleibt der bisherige
// ?place=<publicId>-Link unverändert.
function sharePlaceActionButtonMarkup(publicId, { wikiUrl = "", wikiParam = "" } = {}) {
	if (!publicId) {
		return "";
	}
	return popupActionButtonMarkup({
		// Aventurisches Icon (Signalhorn+Wimpel, Owner-Set img/menu/) statt des 🔗-Emojis -- als eigenes
		// Element ueber dem Label (Kachel, flex-column). Groesse per CSS (.location-popup__action-img): inline
		// klein, 40px im Kachel-Slot (Floating-Box/Panel). Das Emoji aus dem Label ziehen (DE/EN tragen es dort
		// im String), sonst stuende es doppelt. Regex strippt ein fuehrendes 🔗 samt Leerzeichen.
		label: tr("popup.shareLink", "🔗 Link teilen").replace(/^\s*🔗\s*/u, ""),
		iconMarkup: '<img class="location-popup__action-img" src="img/menu/linkteilen.webp?v=2" alt="" width="20" height="20" />',
		attributes: {
			"data-popup-action": "share-place-link",
			"data-public-id": publicId,
			"data-wiki-url": wikiUrl || undefined,
			"data-wiki-param": wikiUrl ? wikiParam : undefined,
		},
	});
}

function getWikiLocationLink(name, wikiUrlOverride = "") {
	if (wikiUrlOverride) {
		return {
			url: wikiUrlOverride,
			title: name,
		};
	}

	return null;
}

// Gemeinsame Quellenangabe fuer WA-Inhalte in ALLEN oeffentlichen Infoboxen (Siedlung/Territorium/Landschaft):
// die Kurzbeschreibungen stammen aus dem Wiki Aventurica -> Uebernahme kenntlich machen + "Mehr hier"-Link auf
// den Artikel (wie bisher). Rendert nichts ohne URL.
function wikiSourceCreditMarkup(url, linkClass = "region-info-box__link") {
	if (!url) {
		return "";
	}
	const credit = tr("popup.wikiSourceCredit", "Informationen aus dem Wiki Aventurica.");
	const more = tr("popup.wikiSourceMore", "Mehr hier");
	return `<div class="wiki-source-credit">${escapeHtml(credit)} <a class="${escapeHtml(linkClass)}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(more)}<span class="wiki-source-credit__arrow" aria-hidden="true"> &#8599;</span></a></div>`;
}

function wikiLocationLinkMarkup(name, wikiUrlOverride = "") {
	return wikiSourceCreditMarkup(wikiUrlOverride, "location-popup__wiki-link");
}

// Quellenangabe für eine "Andere Quelle" (externer Nicht-Wiki-Link, z. B. ein Briefspiel-Beitrag).
// Wird in Infoboxen angezeigt, wenn KEIN Wiki-Eintrag vorhanden ist. Rendert nichts ohne gültige URL.
// Erwartet das bereits normalisierte { url, label }-Objekt (readFeatureOtherSource) oder null.
function otherSourceCreditMarkup(otherSource, linkClass = "region-info-box__link") {
	const url = String(otherSource?.url || "").trim();
	if (!url) {
		return "";
	}
	const label = String(otherSource?.label || "").trim() || tr("popup.otherSource", "Andere Quelle");
	return `<div class="wiki-source-credit"><a class="${escapeHtml(linkClass)}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}<span class="wiki-source-credit__arrow" aria-hidden="true"> &#8599;</span></a></div>`;
}

// Quellen-Zeile für eine Infobox: bevorzugt den Wiki-Link, fällt auf die "Andere Quelle" zurück.
// Leerer String, wenn weder Wiki noch andere Quelle vorhanden ist.
function featureSourceCreditMarkup(wikiUrl, otherSource, linkClass = "region-info-box__link") {
	return wikiSourceCreditMarkup(wikiUrl, linkClass) || otherSourceCreditMarkup(otherSource, linkClass);
}

// Multi-source system: the map-features payload ships a shared source catalog + per-entity
// references (see api/app/map-features.php); routing.js stashes them on window.__sourceCatalog /
// window.__featureSourceRefs when the payload loads. resolveFeatureSourceList turns an
// (entityType, publicId) pair into the array buildSourceListMarkup expects -- resolved fully
// synchronously, so popups render their sources on open with no lazy fetch and no flash.
function resolveFeatureSourceList(entityType, entityPublicId) {
	const catalog = typeof window !== "undefined" ? window.__sourceCatalog : null;
	const refsMap = typeof window !== "undefined" ? window.__featureSourceRefs : null;
	if (!catalog || !refsMap || !entityPublicId) {
		return [];
	}
	const refs = refsMap[`${entityType}:${entityPublicId}`];
	if (!Array.isArray(refs)) {
		return [];
	}
	const resolved = [];
	for (const ref of refs) {
		const source = ref && catalog[ref.source_id];
		if (!source) {
			continue;
		}
		resolved.push({
			url: source.url || "",
			label: source.label || "",
			official: Boolean(source.official),
			type: source.type || "",
			pages: ref.pages || "",
			reference_kind: ref.reference_kind || "",
			note: ref.note || "",
		});
	}
	return resolved;
}

// The full "Quellen: …" line for a popup/infobox, rendered synchronously from the payload globals.
// Replaces the old lazy placeholder: same wrapper class (.feature-sources, styled in region-sync.css)
// and same German label/fallback, but the source list is resolved and rendered up front. entityType
// in {settlement,region,path,territory}; wikiUrl is the fixed Wiki-Aventurica link (may be empty).
function renderFeatureSourceLine(entityType, entityPublicId, wikiUrl, linkClass, opts) {
	const sources = resolveFeatureSourceList(entityType, entityPublicId);
	const list = window.buildSourceListMarkup(wikiUrl, sources, {
		linkClass,
		officialTooltip: tr("popup.officialSource", "offizielle Quelle"),
		wikiLabel: tr("popup.wiki", "Wiki Aventurica"),
		mentionTooltip: tr("popup.sourceMention", "nur Erwähnung"),
		// Floating map box (infopanel mode): drop the "Publikationen" tabs -- they live in the panel only.
		omitPublications: Boolean(opts && opts.omitPublications),
	});
	// buildSourceListMarkup now owns the "Quelle(n):" / "Publikationen:" labels; an element with no
	// wiki link and no sources renders nothing at all (no empty "Keine Quelle gefunden" placeholder).
	if (!list) {
		return "";
	}
	return `<div class="feature-sources">${list}</div>`;
}
if (typeof window !== "undefined") {
	window.resolveFeatureSourceList = resolveFeatureSourceList;
	window.renderFeatureSourceLine = renderFeatureSourceLine;
}

function locationIconMarkup(locationType, locationTypeLabel) {
	const iconPath = LOCATION_ICON_PATHS[locationType] || LOCATION_ICON_PATHS.dorf;
	const altText = `${locationTypeLabel}-Icon`;
	return `<img class="location-popup__icon" src="${escapeHtml(withAssetVersion(iconPath))}" alt="${escapeHtml(altText)}" />`;
}

// Realistic settlement illustration by size (icons/realistic/) -- the floating-box header image
// (Owner: "ersetze das wappen durch die stadtgroesse"). Full-colour asset, frameless, decorative.
function settlementRealisticIconMarkup(locationType, locationTypeLabel) {
	const path = (typeof LOCATION_REALISTIC_ICON_PATHS !== "undefined" && LOCATION_REALISTIC_ICON_PATHS[locationType])
		|| (typeof LOCATION_REALISTIC_ICON_PATHS !== "undefined" ? LOCATION_REALISTIC_ICON_PATHS.dorf : "");
	if (!path) {
		return "";
	}
	const altText = `${locationTypeLabel || ""}`.trim();
	return `<img class="location-popup__icon location-popup__icon--realistic" src="${escapeHtml(withAssetVersion(path))}" alt="${escapeHtml(altText)}" />`;
}

// Wappen-Icon (ersetzt das Siedlungs-Icon), wenn ein erlaubtes Wappen vorhanden ist. Das
// properties.coat wird nur für gemeinfreie Wiki-Wappen oder eigene Uploads gesetzt — die
// Lizenz-Prüfung passiert also beim Schreiben. Wiki-Wappen über den Cache-Proxy laden.
function settlementCoatIconMarkup(coat) {
	if (!coat || !coat.url) {
		return "";
	}
	const src = coat.source === "own" ? coat.url : `/api/app/coat.php?u=${encodeURIComponent(coat.url)}`;
	return `<img class="location-popup__icon location-popup__icon--coat" src="${escapeHtml(src)}" alt="${escapeHtml(tr("popup.coatOfArmsAlt", "Wappen"))}" />`;
}

function sharePinVisualMarkup(rootClassName = "", { includeDot = true } = {}) {
	const safeRootClassName = rootClassName ? ` ${escapeHtml(rootClassName)}` : "";
	const dotMarkup = includeDot ? '<span class="share-pin-visual__dot"></span>' : "";
	return `
		<span class="share-pin-visual${safeRootClassName}" aria-hidden="true">
			${dotMarkup}
			<span class="share-pin-visual__flag-pole"></span>
			<span class="share-pin-visual__flag"></span>
		</span>`;
}

function sharePinPopupIconMarkup() {
	return `<span class="location-popup__icon location-popup__icon--share-pin">${sharePinVisualMarkup("share-pin-visual--popup", { includeDot: false })}</span>`;
}

// Info-Header-Grafiken (Owner): 16:9-Landschaftsbild oben in der Infobox, der Titel liegt als Overlay
// darueber (Banner unten-links + Schatten). Landschaftsregionen per art, Wege per Subtyp, Territorien/
// Strassen generisch "region", Siedlungen vorerst "metropole" (weitere Siedlungsbilder folgen). Die
// Basenamen zeigen auf icons/header/<name>.webp.
const INFO_HEADER_IMAGE_BY_ART = {
	gebirge: "gebirge", berge: "gebirge", berg: "gebirge", berggruppe: "gebirge", bergkamm: "gebirge",
	hochland: "gebirge", schlucht: "gebirge", vulkan: "gebirge",
	berggipfel: "berggipfel",
	wald: "wald",
	fluss: "fluss", flusstal: "fluss", wasserfall: "fluss",
	meer: "meer", golf: "meer", ozean: "meer", meerenge: "meer", meeresteil: "meer", bucht: "meer",
	see: "see", seenlandschaft: "see",
	kueste: "kueste", halbinsel: "kueste", klippe: "kueste", sandbank: "kueste",
	insel: "insel", inselgruppe: "insel",
	sumpf: "sumpfmoor", moor: "sumpfmoor", marschland: "sumpfmoor",
	wueste: "wueste",
	steppe: "steppe", heide: "steppe",
	huegelland: "huegel", huegel: "huegel",
	graslandschaft: "graslandschaft", wiese: "graslandschaft",
	auenlandschaft: "auenlandschaft",
	tundra: "tundra",
	ebene: "ebene", talkessel: "ebene", tal: "ebene",
};
// Siedlungstyp -> Header-Bild. Aktuell nur die Metropole-Grafik; weitere Groessen folgen (Owner) -> alle
// fallen vorerst auf "metropole" zurueck.
const INFO_HEADER_IMAGE_BY_SETTLEMENT = {
	metropole: "metropole",
};

// art/Bezeichnung -> Header-Bild-Basename: erster Bestandteil vor |,/ ; Umlaute normalisiert.
function normalizeInfoHeaderKey(value) {
	return String(value || "")
		.split(/[|,/]/)[0]
		.trim()
		.toLowerCase()
		.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
		.replace(/[^a-z]/g, "");
}
function regionHeaderImageBasename(art) {
	return INFO_HEADER_IMAGE_BY_ART[normalizeInfoHeaderKey(art)] || "region";
}
function settlementHeaderImageBasename(locationType) {
	return INFO_HEADER_IMAGE_BY_SETTLEMENT[locationType] || "metropole";
}
function pathHeaderImageBasename(pathSubtype) {
	if (pathSubtype === "Flussweg") {
		return "fluss";
	}
	if (pathSubtype === "Seeweg") {
		return "meer";
	}
	return "region";
}

// Baut den 16:9-Bild-Header mit Titel-Overlay (Banner unten-links + Schatten). imageBasename ->
// icons/header/<name>.webp. Ersetzt den bisherigen Icon-Kopf; subtitle optional (Typ/art).
function infoHeaderImageMarkup(imageBasename, title, subtitle) {
	const src = `icons/header/${imageBasename}.webp`;
	const sub = subtitle ? `<div class="info-header__subtitle">${escapeHtml(subtitle)}</div>` : "";
	return '<div class="info-header">'
		+ `<img class="info-header__img" src="${escapeHtml(withAssetVersion(src))}" alt="" decoding="async">`
		+ `<div class="info-header__overlay"><div class="info-header__title">${escapeHtml(title)}</div>${sub}</div>`
		+ '</div>';
}

function getLocationDescriptionText(name, descriptionOverride = "") {
	if (descriptionOverride) {
		return descriptionOverride;
	}

	return "";
}

function locationDescriptionMarkup(name, descriptionOverride = "", isRuined = false) {
	const description = getLocationDescriptionText(name, descriptionOverride);
	const statusText = isRuined ? tr("popup.statusRuined", "Ruine oder zerstoert.") : "";

	if (!description && !statusText) {
		return "";
	}

	return `<div class="location-popup__description">${escapeHtml([statusText, description].filter(Boolean).join(" "))}</div>`;
}

function locationAddToRouteActionMarkup(name) {
	return locationPopupActionsMarkup([
		popupActionButtonMarkup({
			label: tr("popup.addToRoute", "➕ Reiseziel hinzufügen"),
			className: "location-popup__action-button--accent",
			attributes: {
				"data-popup-action": "add-location-to-route",
				"data-location-name": name,
			},
		}),
	]);
}

function getPowerlineEndpointByPublicId(publicId) {
	const markerEntry = findLocationMarkerByPublicId(publicId);
	if (markerEntry) {
		return {
			publicId: markerEntry.publicId,
			name: markerEntry.name,
			coordinates: markerEntry.location.coordinates,
			isNodix: Boolean(markerEntry.location.isNodix),
			locationType: markerEntry.locationType,
			featureKind: "location",
		};
	}

	const labelEntry = findLabelEntryByPublicId(publicId);
	if (labelEntry) {
		return {
			publicId: labelEntry.label.publicId,
			name: labelEntry.label.text,
			coordinates: labelEntry.label.coordinates,
			isNodix: Boolean(labelEntry.label.isNodix),
			locationType: labelEntry.label.labelType,
			featureKind: "label",
		};
	}

	return null;
}

function isEligiblePowerlineEndpoint(endpoint) {
	return Boolean(endpoint) && (Boolean(endpoint.isNodix) || endpoint.locationType === CROSSING_LOCATION_TYPE);
}

function pathCreationActionButtonsMarkup(publicId) {
	if (pendingPathCreationStart) {
		return [
			popupActionButtonMarkup({
				label: "Ort verbinden und Straße weiterführen",
				className: "location-popup__action-button--accent",
				attributes: {
					"data-popup-action": "continue-path-at-location",
					"data-public-id": publicId,
				},
			}),
			popupActionButtonMarkup({
				label: "Weg abschließen",
				attributes: {
					"data-popup-action": "finish-path-at-location",
					"data-public-id": publicId,
				},
			}),
		];
	}

	return [
		popupActionButtonMarkup({
			label: "Neuer Weg",
			attributes: {
				"data-popup-action": "start-path-from-location",
				"data-public-id": publicId,
			},
		}),
	];
}

function routeToggleActionButtonMarkup(name) {
	// Kontextabhaengig: ist der Ort bereits Wegpunkt -> "Reiseziel entfernen" (verhindert Doppel-Add
	// und den "from == to"-Routingfehler), sonst "Reiseziel hinzufügen".
	const waypointId = typeof findWaypointIdByLocationName === "function" ? findWaypointIdByLocationName(name) : "";
	if (waypointId) {
		return popupActionButtonMarkup({
			label: tr("popup.removeFromRoute", "Reiseziel entfernen"),
			className: "location-popup__action-button--danger",
			iconMarkup: '<span class="location-popup__action-icon location-popup__action-icon--remove" aria-hidden="true">✕</span>',
			attributes: {
				"data-popup-action": "remove-waypoint",
				"data-waypoint-id": waypointId,
			},
		});
	}
	return popupActionButtonMarkup({
		label: tr("popup.addToRoutePlain", "Reiseziel hinzufügen"),
		className: "location-popup__action-button--accent",
		iconMarkup: '<span class="location-popup__action-icon" aria-hidden="true">+</span>',
		attributes: {
			"data-popup-action": "add-location-to-route",
			"data-location-name": name,
		},
	});
}

function locationActionsMarkup(name, publicId, location = null, extraButtons = []) {
	// Reihenfolge: "Reiseziel hinzufügen", "Link teilen", (Extra-Kacheln z. B. "Abenteuer"), Editier-Aktionen.
	const actionButtons = [routeToggleActionButtonMarkup(name)];

	// wikiParam "siedlung" -- deckt sich mit dem Deep-Link-Parameter fuer Siedlungen (js/app/wiki-deeplink.js).
	const shareButton = sharePlaceActionButtonMarkup(publicId, { wikiUrl: location?.wikiUrl || "", wikiParam: "siedlung" });
	if (shareButton) {
		actionButtons.push(shareButton);
	}

	// Kontext-Kacheln, die der Aufrufer beisteuert (z. B. der Floating-Box-"Abenteuer"-Button aus
	// place-extras.js) -- generisch gehalten, damit dieses UI-Modul keine Feature-Logik kennt.
	if (extraButtons && extraButtons.length) {
		actionButtons.push(...extraButtons.filter(Boolean));
	}

	// "Bewertung schreiben" wanderte nach unten zu den Bewertungen (js/community/location-reviews.js,
	// reviewWriteButtonMarkup) -- daher hier nicht mehr in der Aktionsleiste.

	if (IS_EDIT_MODE && publicId) {
		actionButtons.push(...pathCreationActionButtonsMarkup(publicId));
		if (isEligiblePowerlineEndpoint(getPowerlineEndpointByPublicId(publicId) || (location ? {
			publicId,
			name,
			coordinates: location.coordinates,
			isNodix: Boolean(location.isNodix),
			locationType: location.locationType,
			featureKind: "location",
		} : null))) {
			actionButtons.push(
				popupActionButtonMarkup({
					label: pendingPowerlineCreationStart ? "Kraftlinie abschließen" : "Neue Kraftlinie",
					attributes: {
						"data-popup-action": pendingPowerlineCreationStart ? "finish-powerline-at-location" : "start-powerline-from-location",
						"data-public-id": publicId,
					},
				})
			);
		}
		actionButtons.push(
			popupActionButtonMarkup({
				label: "Ort verschieben",
				attributes: {
					"data-popup-action": "start-location-edit",
					"data-location-name": name,
					"data-public-id": publicId,
				},
			})
		);
		actionButtons.push(
			popupActionButtonMarkup({
				label: "Bearbeiten",
				attributes: {
					"data-popup-action": "edit-location-details",
					"data-location-name": name,
					"data-public-id": publicId,
				},
			})
		);
		actionButtons.push(
			popupActionButtonMarkup({
				label: "Ort löschen",
				className: "location-popup__action-button--danger",
				attributes: {
					"data-popup-action": "delete-location",
					"data-location-name": name,
					"data-public-id": publicId,
				},
			})
		);
	}

	return locationPopupActionsMarkup(actionButtons);
}

function crossingActionsMarkup(name, publicId) {
	if (!IS_EDIT_MODE || !publicId) {
		return "";
	}

	return locationPopupActionsMarkup([
		popupActionButtonMarkup({
			label: "Zu Ort konvertieren",
			attributes: {
				"data-popup-action": "convert-crossing-to-location",
				"data-public-id": publicId,
			},
		}),
		...pathCreationActionButtonsMarkup(publicId),
		popupActionButtonMarkup({
			label: pendingPowerlineCreationStart ? "Kraftlinie abschließen" : "Neue Kraftlinie",
			attributes: {
				"data-popup-action": pendingPowerlineCreationStart ? "finish-powerline-at-location" : "start-powerline-from-location",
				"data-public-id": publicId,
			},
		}),
		popupActionButtonMarkup({
			label: "Kreuzung verschieben",
			attributes: {
				"data-popup-action": "start-location-edit",
				"data-location-name": name,
				"data-public-id": publicId,
			},
		}),
		popupActionButtonMarkup({
			label: "Kreuzung löschen",
			className: "location-popup__action-button--danger",
			attributes: {
				"data-popup-action": "delete-location",
				"data-location-name": name,
				"data-public-id": publicId,
			},
		}),
	]);
}

function labelActionsMarkup(publicId) {
	if (!IS_EDIT_MODE || !publicId) {
		return "";
	}

	const actionButtons = [];
	if (isEligiblePowerlineEndpoint(getPowerlineEndpointByPublicId(publicId))) {
		actionButtons.push(
			popupActionButtonMarkup({
				label: pendingPowerlineCreationStart ? "Kraftlinie abschließen" : "Neue Kraftlinie",
				attributes: {
					"data-popup-action": pendingPowerlineCreationStart ? "finish-powerline-at-location" : "start-powerline-from-location",
					"data-public-id": publicId,
				},
			})
		);
	}

	actionButtons.push(
		popupActionButtonMarkup({
			label: "Label verschieben",
			className: "location-popup__action-button--accent",
			attributes: {
				"data-popup-action": "start-label-edit",
				"data-public-id": publicId,
			},
		}),
		popupActionButtonMarkup({
			label: "Bearbeiten",
			attributes: {
				"data-popup-action": "edit-label-details",
				"data-public-id": publicId,
			},
		}),
		popupActionButtonMarkup({
			label: "Label duplizieren",
			attributes: {
				"data-popup-action": "duplicate-label",
				"data-public-id": publicId,
			},
		}),
		popupActionButtonMarkup({
			label: "Label löschen",
			className: "location-popup__action-button--danger",
			attributes: {
				"data-popup-action": "delete-label",
				"data-public-id": publicId,
			},
		}),
	);

	return locationPopupActionsMarkup(actionButtons);
}

function waypointRemoveActionMarkup(waypointId) {
	if (!waypointId) {
		return "";
	}

	return locationPopupActionsMarkup([
		popupActionButtonMarkup({
			label: tr("popup.removeFromRouteX", "✕ Reiseziel entfernen"),
			className: "location-popup__action-button--danger",
			attributes: {
				"data-popup-action": "remove-waypoint",
				"data-waypoint-id": waypointId,
			},
		}),
	]);
}

// Shared display name for a political territory (Owner: "'Kaiserreich' ist unspezifisch"): the CURATED
// short_name when present ("Mittelreich"), otherwise the FULL political name ("Heiliges Neues Kaiserreich
// vom Greifenthron zu Gareth") -- never the bare rank type, which loses the territory's identity. short_name
// is data (political_territory.short_name, editor-curated) -- nothing is hardcoded here; when it gets filled
// the shorter label flows through automatically. Used by BOTH the political line and the breadcrumb.
function settlementTerritoryDisplayName(name, shortName) {
	const short = String(shortName || "").trim();
	if (short !== "") {
		return short;
	}
	return String(name || "").trim();
}

// Small coat-of-arms thumbnail rendered INSIDE a territory link, before the name (decorative: alt="", the
// name follows). node.coat_url is already public-domain-gated server-side (map-features.php mirrors the
// territory-detail.php license gate) -- an empty string means no coat / not allowed, so no thumb. Loaded
// through the same cache proxy as the settlement coat icon + region infobox coats (/api/app/coat.php).
function settlementTerritoryCoatThumbMarkup(coatUrl) {
	const url = String(coatUrl || "").trim();
	if (url === "") {
		return "";
	}
	// Own uploads (/uploads/wappen/*.png) load DIRECTLY; only EXTERNAL wiki coats go through the cache proxy.
	// coat.php rejects a relative /uploads URL with 400, and territory coats are almost all own uploads --
	// so proxying them all would break every thumb. Mirrors settlementCoatIconMarkup's own-vs-proxy split.
	const src = /^https?:\/\//i.test(url) ? `/api/app/coat.php?u=${encodeURIComponent(url)}` : url;
	return `<img class="location-popup__breadcrumb-coat" src="${escapeHtml(src)}" alt="" aria-hidden="true" />`;
}

// One fly-to link to a political territory (reused by the political line AND each breadcrumb level): the
// visible text is the display name, but data-political-territory carries the FULL name so the map-search
// fly-to resolves it. Shares .location-popup__political-link -> gold styling + the delegated click handler.
// options.withCoat prepends the gated coat thumbnail (breadcrumb only -- the compact head political line
// stays text-only).
function settlementTerritoryLinkMarkup(node, extraClass, options) {
	const nm = String((node && node.name) || "").trim();
	if (nm === "") {
		return "";
	}
	const pid = String((node && node.territory_public_id) || "").trim();
	const display = settlementTerritoryDisplayName(nm, node && node.short_name);
	const cls = "location-popup__political-link" + (extraClass ? " " + extraClass : "");
	const coatThumb = (options && options.withCoat)
		? settlementTerritoryCoatThumbMarkup(node && node.coat_url)
		: "";
	return `<button type="button" class="${cls}" `
		+ `data-political-territory="${escapeHtml(nm)}" data-political-public-id="${escapeHtml(pid)}">`
		+ `${coatThumb}${escapeHtml(display)}</button>`;
}

// Political context line under the settlement type: "Hauptstadt von <Gebiet>" (the place IS the capital of
// that territory -- the broadest it is the capital of) or "in <Gebiet>" (it just lies in its ray-cast
// territory). The territory is a gold fly-to link, the prefix plain. Returns "" when nothing resolved.
function buildSettlementPoliticalLineMarkup(political) {
	if (!political || typeof political !== "object") {
		return "";
	}
	const link = settlementTerritoryLinkMarkup(political);
	if (link === "") {
		return "";
	}
	const prefix = political.kind === "capital"
		? tr("popup.capitalOf", "Hauptstadt von")
		: tr("popup.locatedInShort", "in");
	return `${escapeHtml(prefix)} ${link}`;
}

// "Liegt in" breadcrumb (Owner Variante A): the full leaf -> root territory chain, each level a gold
// fly-to link separated by "›", rendered as its own labelled section in the panel infobox. hierarchy =
// [{name, type, territory_public_id}] from map-features.php (the parent_id walk). Empty -> "" (no section).
function buildSettlementHierarchyMarkup(hierarchy) {
	if (!Array.isArray(hierarchy) || hierarchy.length === 0) {
		return "";
	}
	const links = hierarchy
		.map(function (node) { return settlementTerritoryLinkMarkup(node, "location-popup__breadcrumb-link", { withCoat: true }); })
		.filter(Boolean);
	if (links.length === 0) {
		return "";
	}
	const sep = `<span class="location-popup__breadcrumb-sep" aria-hidden="true">›</span>`;
	const label = tr("popup.locatedIn", "Liegt in");
	return `<div class="location-popup__breadcrumb">`
		+ `<div class="location-popup__breadcrumb-label">${escapeHtml(label)}</div>`
		+ `<div class="location-popup__breadcrumb-chain">${links.join(sep)}</div>`
		+ `</div>`;
}

function locationPopupMarkup({
	name,
	locationType,
	locationTypeLabel,
	headerIconMarkup = "",
	showHeaderIcon = true,
	// Owner: 16:9 image header with the title overlaid. When set, it REPLACES the icon+title header.
	headerImageMarkup = "",
	compact = false,
	showType = false,
	typeSuffixMarkup = "",
	showDivider = false,
	showDescription = true,
	showWikiLink = true,
	description = "",
	wikiUrl = "",
	isRuined = false,
	actionsMarkup = "",
}) {
	const popupClassName = compact ? "location-popup location-popup--compact" : "location-popup";
	const nameClassName = isRuined ? "location-popup__name location-popup__name--ruined" : "location-popup__name";
	return `
		<div class="${popupClassName}">
			${headerImageMarkup || `<div class="location-popup__header">
				${showHeaderIcon ? (headerIconMarkup || locationIconMarkup(locationType, locationTypeLabel)) : ""}
				<div class="location-popup__title-group">
					<div class="${nameClassName}">${escapeHtml(name)}</div>
					${showType ? `<div class="location-popup__type">${escapeHtml(locationTypeLabel)}${typeSuffixMarkup ? ` · ${typeSuffixMarkup}` : ""}</div>` : ""}
				</div>
			</div>`}
			${showDivider ? `<div class="location-popup__divider"></div>` : ""}
			${showDescription ? locationDescriptionMarkup(name, description, isRuined) : ""}
			${actionsMarkup}
			${showWikiLink ? wikiLocationLinkMarkup(name, wikiUrl) : ""}
		</div>`;
}

function labelPopupMarkup(entry) {
	const hasWiki = entry.label.wikiRegion && entry.label.wikiRegion.wiki_key;
	// Kopflose Infobox (Name + Typ zeigt der Popup-Kopf bereits -> kein Doppel-Titel); Infobox oben,
	// Aktions-Buttons darunter — wie Siedlungs-/Weg-Popup.
	const wikiInfobox = hasWiki && typeof labelWikiInfoboxMarkup === "function" ? labelWikiInfoboxMarkup(entry.label, { headless: true }) : "";
	// Multi-source system: without a wiki region, labelWikiInfoboxMarkup never runs (no rows to
	// show) -- still surface the source line so the edit popup covers non-wiki labels too, same as
	// the settlement/path popups. Empty wikiUrl is fine: any manual sources still resolve.
	const sourceMarkup = !hasWiki && typeof renderFeatureSourceLine === "function"
		? renderFeatureSourceLine("region", entry.label.publicId, "", "region-info-box__link")
		: "";
	const typeLabel = (hasWiki && entry.label.wikiRegion.art) ? entry.label.wikiRegion.art : tr("popup.labelTypeRegion", "Region");
	return locationPopupMarkup({
		name: entry.label.text || tr("popup.labelNameFallback", "Label"),
		locationTypeLabel: typeLabel,
		showHeaderIcon: false,
		compact: true,
		showType: hasWiki,
		showDescription: false,
		showWikiLink: false,
		actionsMarkup: wikiInfobox + sourceMarkup + labelActionsMarkup(entry.label.publicId),
	});
}

function sharePinPopupMarkup() {
	return locationPopupMarkup({
		name: tr("popup.sharePinName", "Markierte Stelle"),
		locationType: "dorf",
		locationTypeLabel: tr("popup.sharePinName", "Markierte Stelle"),
		headerIconMarkup: sharePinPopupIconMarkup(),
		showHeaderIcon: true,
		compact: true,
		showType: false,
		showDescription: false,
		showWikiLink: false,
		actionsMarkup: locationPopupActionsMarkup([
			popupActionButtonMarkup({
				label: tr("popup.removeMarker", "🗑️ Markierung entfernen"),
				className: "location-popup__action-button--danger",
				attributes: {
					"data-popup-action": "remove-share-pin",
				},
			}),
		]),
	});
}
