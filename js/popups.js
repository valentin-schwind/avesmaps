function popupActionButtonMarkup({ label, className = "", attributes = {} }) {
	const safeClassName = className ? ` ${escapeHtml(className)}` : "";
	return `<button type="button" class="location-popup__action-button${safeClassName}"${buildHtmlAttributes(attributes)}>${escapeHtml(label)}</button>`;
}

function locationPopupActionsMarkup(actionButtons = []) {
	if (!actionButtons.length) {
		return "";
	}

	return `<div class="location-popup__actions">${actionButtons.join("")}</div>`;
}

function getWikiLocationLink(name, wikiUrlOverride = "") {
	if (wikiUrlOverride) {
		return {
			url: wikiUrlOverride,
			title: name,
		};
	}

	return wikiLocationLinks[name] || null;
}

function wikiLocationLinkMarkup(name, wikiUrlOverride = "") {
	const wikiLocationLink = getWikiLocationLink(name, wikiUrlOverride);

	if (!wikiLocationLink?.url) {
		return "";
	}

	const wikiTitle = wikiLocationLink.title || name;
	const linkText = `${name} im Wiki Aventurica`;
	const titleText = wikiTitle === name ? linkText : `${linkText}: ${wikiTitle}`;
	return `
		<a class="location-popup__wiki-link" href="${escapeHtml(wikiLocationLink.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(titleText)}">
			${escapeHtml(linkText)}
			<span class="location-popup__link-icon" aria-hidden="true">&#8599;</span>
		</a>`;
}

function locationIconMarkup(locationType, locationTypeLabel) {
	const iconPath = LOCATION_ICON_PATHS[locationType] || LOCATION_ICON_PATHS.dorf;
	const altText = `${locationTypeLabel}-Icon`;
	return `<img class="location-popup__icon" src="${escapeHtml(withAssetVersion(iconPath))}" alt="${escapeHtml(altText)}" />`;
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

	const wikiLocationLink = getWikiLocationLink(name);
	const rawDescription = (wikiLocationLink?.description || "").trim();

	if (!rawDescription) {
		return "";
	}

	const prefixPattern = new RegExp(`^${escapeRegExp(name)}\\s+ist\\s+`, "i");
	let normalizedDescription = rawDescription.replace(prefixPattern, "");

	normalizedDescription = normalizedDescription.replace(/^(ein|eine)\s+/i, "");

	if (/^in Avesmaps als\s+/i.test(normalizedDescription)) {
		return "";
	}

	return normalizedDescription.charAt(0).toUpperCase() + normalizedDescription.slice(1);
}

function locationDescriptionMarkup(name, descriptionOverride = "", isRuined = false) {
	const description = getLocationDescriptionText(name, descriptionOverride);
	const statusText = isRuined ? "Ruine oder zerstoert." : "";

	if (!description && !statusText) {
		return "";
	}

	return `<div class="location-popup__description">${escapeHtml([statusText, description].filter(Boolean).join(" "))}</div>`;
}

function locationAddToRouteActionMarkup(name) {
	return locationPopupActionsMarkup([
		popupActionButtonMarkup({
			label: "➕ Zur Route hinzufügen",
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

function locationActionsMarkup(name, publicId, location = null) {
	const actionButtons = [
		popupActionButtonMarkup({
			label: "Zur Route hinzufuegen",
			className: "location-popup__action-button--accent",
			attributes: {
				"data-popup-action": "add-location-to-route",
				"data-location-name": name,
			},
		}),
	];

	if (IS_EDIT_MODE && publicId) {
		actionButtons.push(
			popupActionButtonMarkup({
				label: pendingPathCreationStart ? "Weg abschliessen" : "Neuer Weg",
				attributes: {
					"data-popup-action": pendingPathCreationStart ? "finish-path-at-location" : "start-path-from-location",
					"data-public-id": publicId,
				},
			})
		);
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
					label: pendingPowerlineCreationStart ? "Kraftlinie abschliessen" : "Neue Kraftlinie",
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
				label: "Details bearbeiten",
				attributes: {
					"data-popup-action": "edit-location-details",
					"data-location-name": name,
					"data-public-id": publicId,
				},
			})
		);
		actionButtons.push(
			popupActionButtonMarkup({
				label: "Ort loeschen",
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
		popupActionButtonMarkup({
			label: pendingPathCreationStart ? "Weg abschliessen" : "Neuer Weg",
			attributes: {
				"data-popup-action": pendingPathCreationStart ? "finish-path-at-location" : "start-path-from-location",
				"data-public-id": publicId,
			},
		}),
		popupActionButtonMarkup({
			label: pendingPowerlineCreationStart ? "Kraftlinie abschliessen" : "Neue Kraftlinie",
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
			label: "Kreuzung loeschen",
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
				label: pendingPowerlineCreationStart ? "Kraftlinie abschliessen" : "Neue Kraftlinie",
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
			label: "Details bearbeiten",
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
			label: "Label loeschen",
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
			label: "➖ Aus Route entfernen",
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
			${showDescription ? locationDescriptionMarkup(name, description, isRuined) : ""}
			${actionsMarkup}
			${showWikiLink ? wikiLocationLinkMarkup(name, wikiUrl) : ""}
		</div>`;
}

function labelPopupMarkup(entry) {
	return locationPopupMarkup({
		name: entry.label.text || "Label",
		locationTypeLabel: "Label",
		showHeaderIcon: false,
		compact: true,
		showType: false,
		showDescription: false,
		showWikiLink: false,
		actionsMarkup: labelActionsMarkup(entry.label.publicId),
	});
}

function sharePinPopupMarkup() {
	return locationPopupMarkup({
		name: "Markierte Stelle",
		locationType: "dorf",
		locationTypeLabel: "Markierte Stelle",
		headerIconMarkup: sharePinPopupIconMarkup(),
		showHeaderIcon: true,
		compact: true,
		showType: false,
		showDescription: false,
		showWikiLink: false,
		actionsMarkup: locationPopupActionsMarkup([
			popupActionButtonMarkup({
				label: "🗑️ Markierung entfernen",
				className: "location-popup__action-button--danger",
				attributes: {
					"data-popup-action": "remove-share-pin",
				},
			}),
		]),
	});
}
