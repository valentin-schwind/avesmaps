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
		label: tr("popup.shareLink", "🔗 Link teilen"),
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

function locationActionsMarkup(name, publicId, location = null) {
	// Reihenfolge: "Reiseziel hinzufügen", "Link teilen", "Bewertung schreiben".
	const actionButtons = [routeToggleActionButtonMarkup(name)];

	// wikiParam "siedlung" -- deckt sich mit dem Deep-Link-Parameter fuer Siedlungen (js/app/wiki-deeplink.js).
	const shareButton = sharePlaceActionButtonMarkup(publicId, { wikiUrl: location?.wikiUrl || "", wikiParam: "siedlung" });
	if (shareButton) {
		actionButtons.push(shareButton);
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

function locationPopupMarkup({
	name,
	locationType,
	locationTypeLabel,
	headerIconMarkup = "",
	showHeaderIcon = true,
	compact = false,
	showType = false,
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
			<div class="location-popup__header">
				${showHeaderIcon ? (headerIconMarkup || locationIconMarkup(locationType, locationTypeLabel)) : ""}
				<div class="location-popup__title-group">
					<div class="${nameClassName}">${escapeHtml(name)}</div>
					${showType ? `<div class="location-popup__type">${escapeHtml(locationTypeLabel)}</div>` : ""}
				</div>
			</div>
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
