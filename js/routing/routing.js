function buildRouteOptionsFromPlannerControls() {
	const allowLand = $("#allowLand").is(":checked"),
		allowRiver = $("#allowRiver").is(":checked"),
		allowSea = $("#allowSea").is(":checked");

	return {
		allowLand,
		landOption: allowLand ? $("#landTransport").val() : null,
		allowRiver,
		riverOption: allowRiver ? $("#riverTransport").val() : null,
		allowSea,
		seaOption: allowSea ? $("#seaTransport").val() : null,
	};
}

function getTransportOptionForRouteType(routeType, routeOptions) {
	const resolvedRouteOptions = routeOptions || {};
	const landOption = resolvedRouteOptions.allowLand ? resolvedRouteOptions.landOption : null;
	const riverOption = resolvedRouteOptions.allowRiver ? resolvedRouteOptions.riverOption : null;
	const seaOption = resolvedRouteOptions.allowSea ? resolvedRouteOptions.seaOption : null;

	if (["Pfad", "Weg", "Strasse", "Reichsstrasse", "Gebirgspass", "Wuestenpfad", SYNTHETIC_ROUTE_TYPE].includes(routeType)) return landOption;
	if (routeType === "Flussweg") return riverOption;
	if (routeType === "Seeweg") return seaOption;
	console.warn(`Kein gültiges Transportmittel für ${routeType}.`);
	return null;
}

function resolveSpeedForRouteType(routeType, transportOption) {
	return SPEED_TABLE[transportOption]?.[routeType];
}

// Validates a SETTLEMENT key. It is deliberately not a classifier: use
// resolveLocationTypeFromFeature() to find out what a feature is (crossings included), and this one
// only to check an already-resolved settlement type. Anything unknown is reported instead of
// silently becoming a village -- that silence hid Discord #48 for as long as it lived.
function normalizeLocationType(value) {
	if (isKnownLocationTypeKey(value)) {
		return value;
	}

	reportUnknownLocationType(value, "normalizeLocationType");
	return DEFAULT_LOCATION_TYPE;
}

function locationTypeFromProperties(properties) {
	const settlementClass = properties?.settlement_class;
	if (settlementClass) {
		return normalizeLocationType(settlementClass);
	}

	const placeTypeMap = {
		m: "metropole",
		gs: "grossstadt",
		s: "stadt",
		ks: "kleinstadt",
		sz: "dorf",
		d: "dorf",
	};
	return normalizeLocationType(placeTypeMap[String(properties?.["data-place-type"] || "d").toLowerCase()]);
}

/**
 * Die drei Reisetage aus der Kartennutzlast übernehmen — Land, Wasser, Nachtfahrt.
 *
 * 🔴 EINE QUELLE. `TRANSPORT_TRAVEL_HOURS` (js/config.js) und die Markup-Vorgabe `value="8.0"` sind
 * beide nur Rückfälle für den Fall, dass der Server nichts sagt. Sobald er etwas sagt, gilt er —
 * sonst rechnete der Router mit dem eingestellten Reisetag, während der Planer nach dem alten
 * rastete, und die Tagesleistung fiele um genau das Verhältnis der beiden, ohne dass irgendeine
 * Zahl falsch aussieht.
 *
 * 💣 DAS FELD WIRD NUR GESETZT, WENN DER BENUTZER ES NICHT ANGEFASST HAT. Erkannt am Vergleich
 * `value` (lebendiger Wert) gegen das ATTRIBUT `value` (Markup-Vorgabe): getippte Eingaben und ein
 * geteilter Link mit `?restHours=` ändern nur den lebendigen Wert. Ohne diese Bedingung überschriebe
 * die Kartennutzlast die Wahl des Reisenden — und zwar erst Sekunden nach dem Laden.
 */
function applyServerTravelHours(data) {
	const hours = data && data.travel_hours;
	if (!hours || typeof hours !== "object") return;
	const zahl = (raw) => {
		const value = Number(raw);
		return Number.isFinite(value) && value >= 0.5 && value <= 24 ? value : null;
	};
	const land = zahl(hours.land);
	const water = zahl(hours.water);
	const night = zahl(hours.night);

	if (typeof TRANSPORT_TRAVEL_HOURS === "object" && TRANSPORT_TRAVEL_HOURS) {
		Object.keys(TRANSPORT_TRAVEL_HOURS).forEach((transport) => {
			const istNacht = transport === "fastShip";
			const istLand = typeof VALID_TRANSPORT_OPTIONS === "object" && VALID_TRANSPORT_OPTIONS
				&& VALID_TRANSPORT_OPTIONS.land && VALID_TRANSPORT_OPTIONS.land.has(transport);
			const wert = istNacht ? night : (istLand ? land : water);
			if (wert !== null) TRANSPORT_TRAVEL_HOURS[transport] = wert;
		});
	}

	const feld = document.getElementById("travelHoursPerDay");
	if (!feld || land === null) return;
	const markup = feld.getAttribute("value");
	if (markup === null || String(feld.value) !== String(markup)) return;
	const gesetzt = land.toFixed(1);
	feld.value = gesetzt;
	feld.setAttribute("value", gesetzt);
}

/**
 * Die Tempotabelle aus der Kartennutzlast uebernehmen -- Reisemittel x Wegart in Meilen je Stunde.
 *
 * 🔴 EINE QUELLE, DIESELBE LEITUNG WIE DIE REISETAGE DARUEBER. Der Router liest sein Raster ueber
 * avesmapsTravelValuesRead(): die Konstante, darueber die im Fenster „Tempowerte" gespeicherten
 * Werte. `SPEED_TABLE` (js/config.js) war bis zum 26.08.2026 eine zweite Behauptung ueber dieselbe
 * Zahl -- und sie war live auseinander: 5,07 gegen 5,18 fuer die Reisegruppe zu Fuss auf der
 * Reichsstrasse, 5,95 gegen 6,00 fuer den Flusssegler. Der Reiseplan zeigte dadurch rund 2 %
 * kuerzere Zeiten, als der Router gerechnet hatte; aufgefallen ist es erst, als jemand die stabile
 * API gegen die Karte gehalten hat (Meldung #101).
 *
 * ⚠️ DIE KONSTANTE BLEIBT -- als Rueckfall, nicht als zweiter Anspruch. Sagt der Server nichts
 * (alte Nutzlast, ausgefallener Lesevorgang), rechnet die Karte wie vorher. Dieselbe Ausfallart wie
 * bei den Reisetagen.
 *
 * 💣 ZELLE FUER ZELLE, NIE DAS GANZE RASTER. Ein Reisemittel oder eine Wegart, die der Server
 * nicht nennt, behaelt ihren Wert; ein Schluessel, den es hier nicht gibt, wird NICHT angelegt.
 * Ein ersetztes Raster liesse den Rest als `undefined` zurueck -- und `SPEED_TABLE[t]?.[type] || 1`
 * macht daraus klaglos Tempo 1, also eine Reise, die viermal so lange dauert, ohne Fehlermeldung.
 */
function applyServerTravelSpeeds(data) {
	const gesendet = data && data.travel_speeds;
	if (!gesendet || typeof gesendet !== "object" || Array.isArray(gesendet)) return;
	if (typeof SPEED_TABLE !== "object" || !SPEED_TABLE) return;
	Object.keys(SPEED_TABLE).forEach((transport) => {
		const zeile = gesendet[transport];
		if (!zeile || typeof zeile !== "object" || Array.isArray(zeile)) return;
		Object.keys(SPEED_TABLE[transport]).forEach((pathType) => {
			const wert = Number(zeile[pathType]);
			if (Number.isFinite(wert) && wert > 0) SPEED_TABLE[transport][pathType] = wert;
		});
	});
}

// Verarbeitung der Locations (GeoJSON Points)
const prepareLocationData = (data) => {
	applyServerTravelHours(data);
	// 💣 HIER, NICHT SPAETER: unter dieser Zeile entsteht `locationData`, und ohne die kann niemand
	// eine Route rechnen. Damit gibt es kein Wettrennen zwischen der Tempotabelle und der ersten
	// Reise -- auch nicht bei einem geteilten Link, der sofort eine Route mitbringt.
	applyServerTravelSpeeds(data);
	let crossingCount = 1;
	locationNameLabels.forEach((entry) => map.removeLayer(entry.marker));
	locationNameLabels = [];
	locationMarkers = [];
	locationData = data.features
		.filter((feature) => feature.geometry.type === "Point" && feature.properties?.name && feature.properties?.feature_type !== "label")
		.map((feature) => {
			// Shared classifier first (server truth: feature_type/feature_subtype, name only as the
			// legacy fallback); locationTypeFromProperties keeps the older data-place-type mapping
			// for rows that carry neither.
			const locationType = resolveLocationTypeFromFeature(feature) || locationTypeFromProperties(feature.properties);
			const isCrossing = locationType === CROSSING_LOCATION_TYPE;
			const locationConfig = locationType ? LOCATION_TYPE_CONFIG[locationType] : null;
			return {
				publicId: feature.id || feature.properties.public_id || "",
				name: isCrossing ? `Kreuzung-${crossingCount++}` : feature.properties.name,
				coordinates: [feature.geometry.coordinates[1], feature.geometry.coordinates[0]],
				locationType,
				locationTypeLabel: isCrossing
					? tr("locationType.crossing", "Kreuzung")
					// settlement_class_label is a DENORMALIZED display string persisted with the feature,
					// written by two different savers (map editor vs WikiSync) that had drifted apart --
					// which is how 38 places ended up stuck on the old "Grosse Stadt"/"Kleine Stadt"
					// wording (Discord #42). The type is always derivable from settlement_class, so the
					// config label wins; the stored string is only a last resort for an unmapped type.
					: tr(`type.${locationType}.singular`, locationConfig?.singularLabel || feature.properties.settlement_class_label || "Dorf"),
				description: feature.properties.description || "",
				wikiUrl: readFeatureWikiUrl(feature.properties),
				otherSource: readFeatureOtherSource(feature.properties),
				wikiSettlement: feature.properties.wiki_settlement || null,
				// 🔴 Der dritte Zustand: „ein Editor hat nachgesehen, es gibt KEINEN Wiki-Artikel."
				// Er ist nicht dasselbe wie eine fehlende Zuweisung (das hiesse „noch niemand hat
				// nachgesehen") -- und ohne ihn im Marker-Eintrag startet das Häkchen im Dialog
				// „Ort bearbeiten" immer leer, ein beliebiges Speichern nähme die Entscheidung
				// zurück, und der Leseweg riete die Adresse wieder her (Discord #38).
				wikiNoArticle: Boolean(feature.properties.wiki_no_article),
				// 🔴 Die FELDHERKUNFT: welcher der fünf Wiki-Werte kam aus dem Wiki, welchen haben
				// WIR gesetzt (Entwurf 2026-08-17-wiki-override-fuer-alle-design.md). Sie muss hier
				// stehen, weil die Nutzlast FLACH projiziert wird -- ein `location.properties` gibt
				// es nicht, und wer danach greift, liest für immer `undefined`, ohne dass irgendwo
				// ein Fehler entsteht.
				fieldOrigins: feature.properties.field_origins || null,
				// Einwohner · Lage · Herrscher: seit 16.08.2026 eigene Kartenfelder, die der
				// Wiki-Sync füllen kann. ⚠️ NUR Daten — die Infobox zeigt sie (noch) nicht; sichtbar
				// werden sie erst mit einer eigenen, einzeln live gehenden Änderung (AGENTS.md §9).
				einwohner: String(feature.properties.einwohner || ""),
				lage: String(feature.properties.lage || ""),
				oberhaupt: String(feature.properties.oberhaupt || ""),
				// Ortsart, vom Editor gesetzt ("Brücke", "Oase", ...). Beschreibt den Ort; sie
				// aendert seine Darstellung NICHT -- nur die Typzeile der Infobox (siehe
				// locationTypeLabelForDisplay in map-features-location-marker-entry.js).
				placeKind: String(feature.properties.place_kind || ""),
				// Political context line (resolved server-side in map-features.php): {kind,name,type,
				// territory_public_id} or absent. Rendered under the settlement type in the infobox.
				political: feature.properties.political || null,
				// Klimazone (serverseitig aus den sieben Bändern bestimmt, api/_internal/app/
				// climate-membership.php): EIN Schlüssel, denn ein Punkt liegt in genau einem Band.
				// Der Anzeigename steht einmal im Payload-Vokabular, nicht 4.650-mal hier.
				climateZone: String(feature.properties.climate_zone || ""),
				coat: feature.properties.coat || null,
				// Eigene Editor-Bilder (Owner) -- ueberschreiben das generische Header-Bild; Lightbox im Infopanel.
				images: Array.isArray(feature.properties.images) ? feature.properties.images : [],
				isNodix: Boolean(feature.properties.is_nodix),
				isRuined: Boolean(feature.properties.is_ruined),
				isHidden: Boolean(feature.properties.is_hidden),
				revision: Number(feature.properties.revision) || null,
			};
		});
	locationData
		.filter((location) => IS_EDIT_MODE || !isCrossingLocation(location))
		.forEach((location) => {
			const { publicId, name, coordinates, locationType, locationTypeLabel } = location;
			const marker = L.marker(coordinates, {
				icon: createLocationMarkerIcon(locationType),
				pane: "locationsPane",
				keyboard: true,
				draggable: false,
				zIndexOffset: locationType === CROSSING_LOCATION_TYPE ? 1000 : 0,
			});
			const markerEntry = { marker, locationType, name, publicId, location };
			marker.on("dragend", async () => {
				const saveSucceeded = await saveMovedLocationMarker(markerEntry, marker.getLatLng());
				if (!saveSucceeded && activeLocationEdit?.originalLatLng) {
					marker.setLatLng(activeLocationEdit.originalLatLng);
					syncLocationNameLabelVisibility();
				}
				setLocationEditActive(markerEntry, false);
			});
			refreshLocationMarkerPopup(markerEntry);
			locationMarkers.push(markerEntry);
			addLocationNameLabel(markerEntry);
		});
	syncLocationMarkerVisibility();
	map.off("zoomend", syncLocationMarkerVisibility);
	map.on("zoomend", syncLocationMarkerVisibility);
};

// Der frueher hier wohnende Temp-Marker-Mechanismus (routeWaypointTempMarkerEntries) blendete den
// darunterliegenden Ort-Marker ein, solange die Wegpunkt-Infobox offen war. Mit den sichtbaren
// Wegpunkt-Markern (route-render.js) ergaebe das ZWEI Symbole uebereinander -- genau die unruhige Optik,
// an der der erste Icon-Versuch scheiterte. Deshalb entfaellt er ersatzlos.

function loadRouteDataFromApi() {
	if (!MAP_FEATURES_API_URL) {
		return Promise.reject(new Error("Keine Map-Features-API für diese Umgebung konfiguriert."));
	}

	// edit_mode=1 asks the server for the EDITOR's view of the payload. Today that is exactly one thing:
	// the global "Wappen: Aus" switch replaces coats with a placeholder for the public side only, so an
	// editor keeps seeing the real ones. The ETag carries the same marker, so the two variants cannot be
	// served to each other from the browser cache.
	const mapFeaturesUrl = new URL(MAP_FEATURES_API_URL, window.location.href);
	if (IS_EDIT_MODE) {
		mapFeaturesUrl.searchParams.set("edit_mode", "1");
	}

	// Aus der rohen Antwort wird der Kartenstand. Beide Wege -- frisch geholt und aus dem Speicher
	// hydriert -- muenden hier, damit „Revision " und `avesmapsSource` nicht zweimal entstehen.
	const auswerten = (data) => {
		if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
			throw new Error("Map-Features-API liefert kein gültiges GeoJSON.");
		}

		data.avesmapsSource = {
			label: "SQL",
			revision: data.revision ?? null,
			featureCount: data.features.length,
		};
		return data;
	};

	// 🔴 DER TAG KOMMT AUS `X-Avesmaps-ETag`, NIE AUS `ETag`. Live gemessen (27.08.2026, mit
	// `cache: "no-store"`, also wirklich von der Leitung): die 200 dieses Endpunkts traegt keinen
	// `ETag` -- STRATOs Zwischenschicht entfernt ihn aus jeder Antwort MIT Rumpf. `headers.get("ETag")`
	// ist hier also `null`, und ein darauf gebauter Riegel waere fuer immer wirkungslos.
	// 🪤 Und er sieht trotzdem manchmal richtig aus: beantwortet der Browser die Anfrage aus seinem
	// EIGENEN Cache, steht `ETag` sehr wohl da -- er stammt dann aus einer frueheren 304.
	const aus200 = (response) =>
		response.text().then((text) => {
			const data = auswerten(JSON.parse(text));
			const tag = response.headers.get("X-Avesmaps-ETag") || "";
			// ⚠️ Nur die oeffentliche Fassung wird abgelegt (Begruendung in kartendaten-speicher.js),
			// und erst im Leerlauf -- die Ablage kostet gemessen 37 ms und gehoert nicht zwischen
			// Antwort und Kartenaufbau.
			if (tag && !IS_EDIT_MODE && typeof avesmapsKartendatenSpaeterAblegen === "function") {
				avesmapsKartendatenSpaeterAblegen(tag, text);
			}
			return data;
		});

	// 🔴 OHNE EIGENE KOPFZEILEN, SOLANGE ES KEINEN TAG GIBT, UND DAS IST TRAGEND. Diese Anfrage wird
	// im Kopf von index.html per <link rel="preload" as="fetch"> vorangemeldet; ein `Accept:
	// application/json` hier gegen das `*/*` des Vorabrufs laesst Chrome den Vorabruf verwerfen -- und
	// dann reisen die ~3 MB ZWEIMAL, also schlechter als ohne Vorabruf. Serverseitig liest den Kopf
	// niemand (kein HTTP_ACCEPT in api/), er war reine Hoeflichkeit.
	// 💣 UND GENAU DESHALB HAENGEN DIE ZWEI SEITEN ZUSAMMEN: sobald wir `If-None-Match` mitschicken,
	// verfehlt die Anfrage den Vorabruf. Aufgeloest wird das im KOPF von index.html, nicht hier --
	// liegt ein Tag in localStorage, meldet das Skript dort gar keinen Vorabruf an (die Anfrage wird
	// ohnehin bedingt und winzig). Wer hier eine Kopfzeile ergaenzt, muss diese Weiche mitnehmen.
	const abrufen = (tag) =>
		fetch(mapFeaturesUrl.toString(), tag ? { headers: { "If-None-Match": tag } } : undefined).then((response) => {
			if (response.status === 304) {
				// 💣 Ein 304 OHNE mitgeschickten Tag kann es nicht geben -- und wenn doch, waere der
				// Rueckfall unten ein Kreis. Der Riegel bricht ihn nach genau einer Runde.
				if (!tag) {
					throw new Error("Map-Features-API antwortet mit HTTP 304 ohne bedingte Anfrage.");
				}
				return avesmapsKartendatenLesen(tag).then((data) => {
					if (data) {
						return auswerten(data);
					}
					// Der Tag lag vor, die Nutzlast nicht (Kontingent geraeumt, halber Eintrag). Dann
					// ist der gemerkte Tag eine Luege: wegwerfen und voll holen.
					return avesmapsKartendatenVergessen().then(() => abrufen(""));
				});
			}
			if (!response.ok) {
				throw new Error(`Map-Features-API antwortet mit HTTP ${response.status}.`);
			}
			return aus200(response);
		});

	const gemerkterTag = IS_EDIT_MODE || typeof avesmapsKartendatenTagLesen !== "function" ? "" : avesmapsKartendatenTagLesen();

	return abrufen(gemerkterTag).then((data) => {
		console.info(`Avesmaps geladen: ${data.features.length} Features, Revision ${data.revision ?? "unbekannt"}.`);
		return data;
	});
}

function updateMapDataStatus(data) {
	const source = data?.avesmapsSource || {};
	mapDataSourceStatus = {
		label: source.label || "unbekannt",
		revision: source.revision ?? null,
		featureCount: Number.isFinite(source.featureCount) ? source.featureCount : Array.isArray(data?.features) ? data.features.length : 0,
	};
	const revisionText = mapDataSourceStatus.revision === null || mapDataSourceStatus.revision === undefined ? "-" : mapDataSourceStatus.revision;

	$("#map-data-status")
		.text(`Map: ${mapDataSourceStatus.label} | Rev ${revisionText} | ${mapDataSourceStatus.featureCount.toLocaleString("de-DE")} Features | `)
		.append(
			// Built as an element, never via .html(): the line above carries dynamic values, so
			// injecting markup here would open an XSS surface for whatever the API returns.
			// aria-label keeps the emoji out of the accessible name ("Handbuch", not "open book").
			$("<a>", {
				href: "https://avesmaps.de/html/editor-handbuch.html",
				target: "_blank",
				rel: "noopener",
				text: "📖 Handbuch",
				title: "Editor-Handbuch öffnen",
				"aria-label": "Handbuch",
			})
		)
		.prop("hidden", false);
}

function loadRouteData() {
	return loadRouteDataFromApi();
}

// Pure decision for the live-sync poll: skip the expensive map-features delta fetch only when the cheap
// revision probe is trustworthy AND reports no advance past what we already have. A failed/omitted probe
// returns false -> fall through to the delta fetch (old behaviour), never a silent miss.
function avesmapsLiveSyncShouldSkipDelta(localRevision, probeOk, probeRevision) {
	const probed = Number(probeRevision);
	return probeOk === true && Number.isFinite(probed) && probed <= (Number(localRevision) || 0);
}

async function pollLiveMapUpdates() {
	if (!IS_EDIT_MODE || !MAP_FEATURES_API_URL || isLiveMapUpdatePending || !mapDataSourceStatus?.revision) {
		return;
	}
	// Hidden tab: nobody is watching -> don't poll. Cuts idle load from backgrounded editor tabs.
	if (typeof document !== "undefined" && document.hidden) {
		return;
	}

	isLiveMapUpdatePending = true;
	try {
		// Cheap "did anything change?" probe first. The full delta fetch below runs table-wide enrichment
		// loaders server-side, so we only pay it when the revision actually advanced. A failed probe falls
		// through to the delta fetch (unchanged behaviour), never a skipped update.
		if (MAP_REVISION_API_URL) {
			const probe = await fetch(MAP_REVISION_API_URL, { headers: { Accept: "application/json" } });
			const probeData = await probe.json().catch(() => ({}));
			if (avesmapsLiveSyncShouldSkipDelta(mapDataSourceStatus.revision, probe.ok && probeData?.ok === true, probeData?.revision)) {
				return; // finally clears isLiveMapUpdatePending
			}
		}

		const url = new URL(MAP_FEATURES_API_URL, window.location.href);
		url.searchParams.set("since_revision", String(mapDataSourceStatus.revision));
		url.searchParams.set("edit_mode", "1"); // this delta loop only ever runs in edit mode (guard above)
		const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
		const data = await response.json().catch(() => ({}));
		if (!response.ok || data?.ok !== true) {
			throw new Error(apiErrorMessage(data, "Live-Aktualisierung fehlgeschlagen."));
		}

		const features = Array.isArray(data.features) ? data.features : [];
		if (features.length > 0) {
			features.forEach(applyLiveMapFeatureUpdate);
			refreshPlannerAfterFeatureChange({ updateRoute: true });
			void loadChangeLog();
			showFeedbackToast(`${features.length} Kartenänderung(en) aktualisiert.`, "info");
		}

		if (data.revision && mapDataSourceStatus) {
			mapDataSourceStatus.revision = data.revision;
			updateMapDataStatus({ avesmapsSource: mapDataSourceStatus });
		}
	} catch (error) {
		console.warn("Live-Aktualisierung konnte nicht geladen werden:", error);
	} finally {
		isLiveMapUpdatePending = false;
	}
}

function startLiveMapUpdates() {
	if (!IS_EDIT_MODE || liveMapUpdateTimerId || !MAP_FEATURES_API_URL) {
		return;
	}

	liveMapUpdateTimerId = window.setInterval(() => {
		void pollLiveMapUpdates();
	}, 15000);
}

// Deep-Link ?place=<public_id>: nach dem Laden zur verknuepften Siedlung springen
// (z. B. Hauptstadt-Link aus dem Wiki-Sync-Editor). Read-only Fokus, keine Seiteneffekte.
// Param FRUEH abfangen: der Routenplaner schreibt die URL beim Laden um (entfernt ?place),
// daher beim Script-Load lesen (synchron, vor dem async Daten-Load) und merken.
const PLACE_FOCUS_PUBLIC_ID = (function () {
	try {
		return (typeof window.avesmapsSearchParams === "function" ? window.avesmapsSearchParams() : new URLSearchParams(window.location.search)).get("place") || "";
	} catch (error) {
		return "";
	}
})();
// Fokussiert ein geteiltes Label (Wiki-Landschaft/Region) per public_id: Ebene auf
// Landschaften, hinfliegen, sichtbar machen und Infobox-Popup öffnen. Gibt true zurück,
// wenn ein passendes Label gefunden wurde.
function focusSharedLabelFromUrl(publicId) {
	const labelEntry = typeof findLabelEntryByPublicId === "function" ? findLabelEntryByPublicId(publicId) : null;
	if (!labelEntry || !labelEntry.marker) {
		return false;
	}
	if (typeof setSelectedMapLayerMode === "function") {
		setSelectedMapLayerMode("deregraphic");
	}
	const label = labelEntry.label || {};
	const visualMax = typeof VISUAL_MAX_ZOOM_LEVEL !== "undefined" ? VISUAL_MAX_ZOOM_LEVEL : map.getMaxZoom();
	const labelMax = Number.isFinite(Number(label.maxZoom)) ? Number(label.maxZoom) : visualMax;
	const targetZoom = Math.max(Number(label.minZoom) || 0, Math.min(labelMax, visualMax));
	map.setView(labelEntry.marker.getLatLng(), targetZoom, { animate: false });
	if (typeof syncLabelVisibility === "function") {
		syncLabelVisibility();
	}
	// Popup erst nach dem Sichtbar-Schalten öffnen (Marker kann gerade erst hinzugefügt werden).
	window.setTimeout(() => {
		try {
			labelEntry.marker.openPopup();
		} catch (error) {
			/* Popup ist optional */
		}
	}, 0);
	return true;
}

function applyPlaceFocusFromUrl() {
	if (!PLACE_FOCUS_PUBLIC_ID) {
		return;
	}
	const entry = typeof findLocationMarkerByPublicId === "function" ? findLocationMarkerByPublicId(PLACE_FOCUS_PUBLIC_ID) : null;
	if (!entry) {
		// ?place= links must keep their URL exactly like the wiki deep-links (js/app/wiki-deeplink.js):
		// suppress the next syncPlannerStateToUrl writes around the focus hand-off, whichever branch below.
		if (typeof suppressPlannerUrlSyncForWikiDeeplink === "function") {
			suppressPlannerUrlSyncForWikiDeeplink();
		}
		// Kein Ort -> Label (Landschaft/Region) versuchen: hinfliegen + Infobox öffnen.
		if (focusSharedLabelFromUrl(PLACE_FOCUS_PUBLIC_ID)) {
			return;
		}
		// Marker (noch) nicht geladen -> vorhandene Logik (zeigt ggf. Hinweis-Toast).
		if (typeof focusRegionPlace === "function") {
			focusRegionPlace(PLACE_FOCUS_PUBLIC_ID);
		}
		return;
	}
	// ?place= links must keep their URL exactly like the wiki deep-links (js/app/wiki-deeplink.js):
	// suppress the syncPlannerStateToUrl call below (and any other sync a marker/category toggle triggers).
	if (typeof suppressPlannerUrlSyncForWikiDeeplink === "function") {
		suppressPlannerUrlSyncForWikiDeeplink();
	}
	// setView (synchron) statt flyTo: läuft als letzte View-Operation des Ladens und wird
	// nicht vom Overview-fitBounds überfahren. Marker einblenden + Popup öffnen.
	const targetLatLng = entry.marker.getLatLng();
	map.setView(targetLatLng, Math.max(map.getZoom(), 4), { animate: false });
	// Kategorie der Ortschaft einschalten, damit der Marker DAUERHAFT sichtbar bleibt (sonst
	// entfernt ihn der nächste Sichtbarkeits-Sync wieder). Erzwingen (kein Toggle), die
	// Stufe + alle darunter aktivieren -- analog setVisibleLocationTypesThrough, aber ohne
	// dessen Aus-Schalt-Eigenheit, falls die Zielstufe gerade der aktiven entspricht.
	let categoryEnabled = false;
	if (typeof LOCATION_TYPE_VISIBILITY_ORDER !== "undefined" && typeof getLocationToggleButton === "function") {
		const targetIndex = LOCATION_TYPE_VISIBILITY_ORDER.indexOf(entry.locationType);
		if (targetIndex >= 0) {
			LOCATION_TYPE_VISIBILITY_ORDER.forEach((locationType, index) => {
				if (index <= targetIndex) {
					getLocationToggleButton(locationType).addClass("is-active");
				}
			});
			if (typeof syncLocationMarkerVisibility === "function") {
				syncLocationMarkerVisibility();
			}
			if (typeof syncPlannerStateToUrl === "function") {
				syncPlannerStateToUrl();
			}
			categoryEnabled = true;
		}
	}
	if (!categoryEnabled && !map.hasLayer(entry.marker)) {
		try {
			map.addLayer(entry.marker);
		} catch (error) {
			/* Sichtbarkeit wird ohnehin per zoomend synchronisiert */
		}
	}
	try {
		entry.marker.openPopup();
	} catch (error) {
		/* Popup ist optional */
	}
}

// Nur für Editoren (?edit=1): bei Zoom-Änderung kurz die aktuelle Zoom-Stufe einblenden,
// damit man weiss, welcher Wert in "Zoom von/bis" der Sichtbarkeit entspricht (ganzzahlig).
function notifyEditorZoomLevel() {
	if (typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) {
		return;
	}
	if (typeof map === "undefined" || typeof showFeedbackToast !== "function") {
		return;
	}
	showFeedbackToast(`Zoom-Stufe ${Math.round(map.getZoom())}`, "info");
}

// 💣 IST DIE KARTE UEBERHAUPT SCHON DA? Diese Frage ist seit dem 27.08.2026 noetig, und sie hat
// eine Fangfrage in sich.
//
// `<div id="map">` (index.html) legt `window.map` an -- HTML-Kennungen werden globale Variablen.
// Die ECHTE Karte entsteht erst in js/app/bootstrap.js (`const map = L.map("map", …)`), und diese
// globale lexikalische Bindung existiert erst, wenn bootstrap.js ausgewertet wird. Bis dahin ist
// `map` also NICHT undefiniert, sondern das DIV. Jede Pruefung der Form `typeof map !== "undefined"`
// ist hier deshalb wirkungslos -- gefragt werden muss nach `map.getZoom`.
//
// 🪤 UND WARUM DAS ERST JETZT AUFFIEL: routing.js laedt VOR bootstrap.js, die Nutzlast brauchte aber
// bisher 2,1-2,5 s. Bis die Antwort da war, stand die Karte laengst. Am 27.08.2026 kamen zwei
// Beschleunigungen zusammen -- der Vorabruf im Kopf und der Ganzkoerper-Dateicache -- und die
// Antwort traf nach 88 ms ein, also VOR bootstrap.js. Ergebnis live: „map.getZoom is not a
// function", die ganze Hydrierung brach ab, und die Karte blieb ohne Grenzen und ohne Wege.
// ⭐ Die Lehre ist groesser als die Zeile: eine Beschleunigung kann eine Reihenfolge umdrehen, die
// vorher nur durch Langsamkeit gehalten wurde. Wer hier etwas schneller macht, prueft die
// Wettlaeufe mit.
//
// ⚠️ DOMContentLoaded ist die harte Zusage: bootstrap.js ist ein gewoehnliches <script src> im
// Rumpf und laeuft damit waehrend des Parsens, also davor. Kein Nachfragen im Kreis noetig.
function avesmapsKarteBereit() {
	const bereit = () => {
		try {
			return typeof map !== "undefined" && map !== null && typeof map.getZoom === "function";
		} catch (fehler) {
			return false; // die Bindung steht noch im toten Bereich
		}
	};
	if (bereit() || document.readyState !== "loading") {
		return Promise.resolve();
	}
	return new Promise((aufloesen) => {
		document.addEventListener("DOMContentLoaded", () => aufloesen(), { once: true });
	});
}

// Laden und Verarbeiten der GeoJSON-Daten aus SQL.
const routeDataRequest = loadRouteData();

routeDataRequest
	// 🔴 ERST die Karte, dann hydrieren. Der Abruf selbst laeuft weiter so frueh wie moeglich -- nur
	// die VERARBEITUNG wartet. Beides zu verzoegern haette den Vorabruf wieder aufgehoben.
	.then((data) => avesmapsKarteBereit().then(() => data))
	.then((data) => {
		updateMapDataStatus(data);
		// Multi-source system: stash the shared source catalog + per-entity references from the
		// payload so every popup/infobox renders its sources synchronously (resolveFeatureSourceList
		// in js/ui/popups.js). No lazy per-popup fetch.
		window.__sourceCatalog = (data && data.source_catalog) || {};
		window.__featureSourceRefs = (data && data.feature_sources) || {};
		// Das Kanon-Etikett je Objekt. 🔴 NUR DIE ABWEICHUNGEN reisen mit, die Regel dazu steht als
		// `vorgabe` IN der Antwort -- die Nutzlast traegt ihre eigene Legende, statt sie durch
		// Abwesenheit zu behaupten (api/app/map-features.php).
		// 💣 NUR HIER, NIE IM DELTA-ZWEIG (`since_revision`, weiter oben). Die Karte entsteht aus
		// Eingaengen mit VERSCHIEDENEN Geltungsbereichen: Katalog und Verweise global, die
		// Kartenzeilen gefiltert. Eine Delta-Antwort traegt den Namensraum-Rang deshalb nur fuer
		// die geaenderten Objekte -- hier ueberschrieben, verloeren alle uebrigen ihr Etikett.
		// Der Preis ist ein bis zum Neuladen altes Etikett, wenn ein Editor eine wiki_url aendert;
		// das betrifft nur den Editiermodus, und Stehenlassen ist das kleinere Uebel.
		window.__featureKanon = (data && data.feature_kanon) || null;
		// Objekte, die IN einer Stadt liegen (Villen, Plätze, Stadttempel, Gassen). Sie sind KEINE
		// features -- sie haben keine Position --, sondern eine schlanke Namensliste je Stadt. Der
		// Wegpunkt-Autocomplete schlägt sie vor und setzt die Stadt als Ziel
		// (getInSettlementWaypointEntries, js/map-features/map-features-waypoints.js).
		window.avesmapsInSettlementPlaces = (data && Array.isArray(data.in_settlement_places))
			? data.in_settlement_places
			: [];
		// Die sieben Klimazonen-Namen (Nord nach Süd) aus dem Payload. 🔴 MUSS VOR prepareLocationData
		// und prepareLabelData stehen: beide bauen ihre Popups sofort, und ein Ort trägt nur den
		// SCHLÜSSEL seiner Zone -- ohne das Vokabular bliebe seine Zeile beim ersten Aufbau leer.
		if (typeof avesmapsClimateSetVocabulary === "function") {
			avesmapsClimateSetVocabulary((data && data.climate_zones) || []);
		}
		prepareLocationData(data);
		preparePowerlineData(data);
		// LOAD-BEARING ORDER: labels BEFORE paths. preparePathData pre-builds every way popup
		// (createPathLayer -> refreshPathLayerPopup), and a way's "Verlauf" links the landscapes it names
		// ("Trollzacken", "Goldene Bucht") -- those are labelMarkers, and the index is built from them at that
		// moment (map-features-path-item-links.js). Hydrating labels afterwards would leave every landscape
		// unlinked in markup that is already cached. prepareLabelData only reads data.features + map, so it has
		// no path dependency of its own.
		prepareLabelData(data);
		preparePathData(data);
		prepareRegionData(data);

		// Standardmäßig ersten Waypoint hinzufügen
		initializeWaypointSorting();
		$("#inputLocation").off("click").on("click", () => {
			appendWaypointInput().trigger("focus");
		});
		resetWaypointInputs();

		const hasSharedRoute = applyPlannerStateFromUrl();
		applyDisplayOptions();

		if (hasSharedRoute) {
			updateMapView();
		} else {
			focusMapOnActiveTargets();
		}
		// Geteilte/geladene Route im Infopanel-Modus -> Panel mit den Wegpunkt-Breadcrumbs automatisch
		// zeigen (erster aufloesbarer Wegpunkt aktiv). Die Marker sind hier bereits geladen
		// (prepareLocationData oben), also loest findLocationMarkerByName die Wegpunkte auf.
		if (hasSharedRoute && typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE
			&& typeof window.avesmapsAutoOpenRouteInInfopanel === "function") {
			window.avesmapsAutoOpenRouteInInfopanel();
		}
		startLiveMapUpdates(); applyPlaceFocusFromUrl(); applyWikiDeeplinkFromUrl(); map.on("zoomend", notifyEditorZoomLevel);
	})
	.catch((err) => console.error("Fehler beim Laden der GeoJSON-Datei:", err))
		// Signalisiert dem Lade-Balken (loading-bar.js), dass die Karte einsatzbereit ist -- egal ob der
		// Datenload erfolgreich war oder nicht (sonst haengt der Balken bei einem Fehler).
		.finally(() => document.dispatchEvent(new Event("avesmaps:map-ready")));

// Controls, die die ROUTE BERECHNEN (nicht bloss die Kartendarstellung): Transportmittel, die
// Land/Fluss/Meer-Haken und die Routenoptionen. Eine Aenderung muss die Route neu rechnen.
//
// Bis 7a898af4 war der "Suche"-Button der EINZIGE Recompute-Trigger; mit seinem Wegfall wurde er nur
// fuer Wegpunkt-Aktionen (Autocomplete/Enter/Loeschen/Sortieren) ersetzt. Transport- und Optionswechsel
// aktualisierten seither nur die URL -- die angezeigte Route blieb stehen, bis man einen Wegpunkt anfasste.
// Der generische Selektor unten trifft auch die Karten-Selects (#mapLayerModeSelect, #mapStyleSelect);
// die duerfen NICHT neu rechnen, daher die explizite Liste. #travelHoursPerDay fehlt hier absichtlich --
// es rechnet erst in seinem eigenen Handler weiter unten neu, NACH dem Clamping.
const ROUTE_RECOMPUTE_CONTROL_SELECTOR = '#transport-options select, #transport-options input[type="checkbox"], input[name="pathType"], #minimizeTransfers';

// Rechnet die Route neu, ohne den Kartenausschnitt zu verreissen -- ein Optionswechsel soll die Ansicht
// nicht wegspringen lassen. Erst ab 2 Wegpunkten gibt es eine Route (darunter wuerde updateMapView die
// Karte auf die blossen Ziele zoomen).
function recomputeRouteAfterOptionChange() {
	if (typeof getWaypointInputValues !== "function" || getWaypointInputValues().length < 2) {
		return;
	}
	if (typeof updateRouteKeepingCurrentMapView === "function") {
		updateRouteKeepingCurrentMapView();
	}
}

$("#search").on("change", 'input[type="checkbox"], input[type="radio"], select, input[type="number"]', function () {
	syncPlannerStateToUrl();
	if ($(this).is(ROUTE_RECOMPUTE_CONTROL_SELECTOR)) {
		recomputeRouteAfterOptionChange();
	}
});
$("#search").on("input", "#travelHoursPerDay, .waypoint-input", () => syncPlannerStateToUrl());

// Unterbringung und Reisendenzahl aendern die ROUTE nicht, nur ihren Preis -- deshalb NICHT in
// ROUTE_RECOMPUTE_CONTROL_SELECTOR, sondern hier: nur die Kostenzeilen neu setzen.
//
// 💣 Diese Bindung stand zuerst am Ende von route-plan.js und brach dort SECHS Tests: die
// Test-Harness laedt die Datei ohne jQuery, und ein `$(...)` auf oberster Ebene wirft beim Laden.
// route-plan.js enthaelt sonst nur Deklarationen -- genau darum ist sie ladbar. Verdrahtung
// gehoert hierher.
$("#search").on("change input", "#travelLodging, #travelTravellers", () => {
	if (typeof renderRoutePlanTravelCosts === "function") {
		renderRoutePlanTravelCosts();
	}
});

// Reisestunden-Feld: gueltiger Bereich 0,5-24 Stunden/Tag (24 = durchreisen ohne Rast); leer -> Standard.
// Anzeige immer mit einer Nachkommastelle (11 -> "11.0").
$("#search").on("change", "#travelHoursPerDay", function () {
	const $travelHoursField = $(this);
	const parsedTravelHours = parseFloat($travelHoursField.val());
	const clampedTravelHours = Number.isFinite(parsedTravelHours)
		? Math.min(Math.max(parsedTravelHours, 0.5), 24)
		: 24 - DEFAULT_PLANNER_STATE.restHours;
	$travelHoursField.val(clampedTravelHours.toFixed(1));
	if (typeof syncPlannerStateToUrl === "function") syncPlannerStateToUrl();
	// Erst JETZT neu rechnen -- mit dem geclampten Wert (die Reisestunden bestimmen die Etappen/Reisetage).
	recomputeRouteAfterOptionChange();
});
$(document).ajaxError((event, jqXHR, settings, thrownError) => {
	const requestUrl = settings?.url || tr("routing.alert.unknownRequest", "unbekannte Anfrage");
	const requestError = thrownError || jqXHR?.statusText || tr("routing.alert.requestFailedGeneric", "XMLHttpRequest fehlgeschlagen");
	alert(tr("routing.alert.requestFailed", "Fehler bei der Anfrage {url}: {error}", { url: requestUrl, error: requestError }));
});

$(document).on("click", (event) => {
	const clickedElement = event.target instanceof Element ? event.target : null;
	if (!clickedElement?.closest("#map-context-menu")) {
		closeMapContextMenu();
	}
	if (!clickedElement?.closest("#region-context-menu")) {
		closeRegionContextMenu();
	}
});

$(document).on("click", ".remove-waypoint", function (event) {
	event.preventDefault();
	removeWaypointElement($(this).closest(".waypoint-container"));
});

$(document).on("click", ".review-report__focus", function (event) {
	event.preventDefault();
	const report = findReviewReportFromElement(this);
	if (!report) {
		showFeedbackToast("Meldung konnte nicht gefunden werden.", "warning");
		return;
	}

	focusReviewReport(report);
});

// Bewertungsliste: Klick auf den Eintrag -> zum Ort zoomen + Infobox oeffnen.
$(document).on("click", ".review-rating__focus", function (event) {
	event.preventDefault();
	const item = this.closest(".review-rating");
	focusReviewRatingLocation(item ? item.dataset.locationPublicId || "" : "");
});

// Bewertungsliste: verbergen/einblenden bzw. loeschen.
$(document).on("click", ".review-rating__hide", function (event) {
	event.preventDefault();
	const item = this.closest(".review-rating");
	if (!item) {
		return;
	}
	moderateReviewRating(item.dataset.reviewId, this.dataset.ratingAction === "unhide" ? "unhide" : "hide", item.dataset.locationPublicId || "");
});

$(document).on("click", ".review-rating__delete", function (event) {
	event.preventDefault();
	const item = this.closest(".review-rating");
	if (!item || !window.confirm(tr("review.confirmDeleteRating", "Diese Bewertung wirklich endgültig löschen?"))) {
		return;
	}
	moderateReviewRating(item.dataset.reviewId, "delete", item.dataset.locationPublicId || "");
});

$(document).on("click", ".change-log-entry", function (event) {
	event.preventDefault();
	// Eine Zeile ohne Kartenobjekt (Moderation einer Meldung) ist kein Knopf und bekommt auch keine
	// Fehlermeldung -- der Zuhoerer haengt am Dokument, die fehlende role allein haelt ihn nicht ab.
	if (this.classList.contains("change-log-entry--static")) {
		return;
	}
	const changeId = Number(this.dataset.changeId || 0);
	const changeEntry = changeLogEntries.find((entry) => Number(entry.id) === changeId);
	if (!changeEntry) {
		showFeedbackToast("Änderung konnte nicht gefunden werden.", "warning");
		return;
	}

	focusChangeLogEntry(changeEntry);
});

$(document).on("keydown", ".change-log-entry", function (event) {
	if (event.key !== "Enter" && event.key !== " ") {
		return;
	}
	if (event.target !== this) {
		return;
	}

	event.preventDefault();
	this.click();
});

$(document).on("click", ".change-log-entry__undo", function (event) {
	event.preventDefault();
	event.stopPropagation();
	const changeId = Number(this.closest(".change-log-entry")?.dataset.changeId || 0);
	const changeEntry = changeLogEntries.find((entry) => Number(entry.id) === changeId);
	if (!changeEntry) {
		showFeedbackToast("Änderung konnte nicht gefunden werden.", "warning");
		return;
	}

	void undoChangeLogEntry(changeEntry);
});

$(document).on("click", ".review-report__reject", function (event) {
	event.preventDefault();
	event.stopPropagation();
	const report = findReviewReportFromElement(this);
	if (!report) {
		showFeedbackToast("Meldung konnte nicht gefunden werden.", "warning");
		return;
	}

	void rejectReviewReport(report);
});

$(document).on("click", ".review-report__create", function (event) {
	event.preventDefault();
	event.stopPropagation();
	const report = findReviewReportFromElement(this);
	if (!report) {
		showFeedbackToast("Meldung konnte nicht gefunden werden.", "warning");
		return;
	}

	const latlng = L.latLng(Number(report.lat), Number(report.lng));
	focusReviewReport(report);
	if (isCommentReport(report)) {
		void updateReviewReportStatus(Number(report.id), "approved", report.report_source || "map_reports")
			.then(() => {
				clearReviewReportMarker();
				showFeedbackToast("Kommentar erledigt.", "success");
				return loadReviewReports();
			})
			.catch((error) => showFeedbackToast(error.message || "Kommentar konnte nicht erledigt werden.", "warning"));
		return;
	}
	if (isLocationReport(report)) {
		if (report.report_mode === "change" && report.entity_public_id) {
			openLocationEditDialogFromChangeReport(report);
		} else {
			openLocationEditDialogFromReport(report, latlng);
		}
		return;
	}
	// Kartensammlungs-Vorschlag (§3.8) VOR dem Label-Zweig: der faellt am Ende ungeprueft durch, und eine
	// Kartenmeldung landete sonst im Label-Editor -- als Label mit dem Kartentitel als Text.
	if (isCitymapReport(report)) {
		void createCitymapFromReport(report);
		return;
	}
	// Fundort-Meldung: aus demselben Grund hier oben und nicht weiter unten. Sie legt nichts an, sondern
	// haengt Fundorte an eine bestehende Karte.
	if (isCitymapLinkReport(report)) {
		void addCitymapLinksFromReport(report);
		return;
	}

	openLabelEditDialogFromReport(report, latlng);
});

$(document).on("click", ".map-context-menu__item", function (event) {
	event.preventDefault();
	event.stopPropagation();

	const action = this.dataset.contextAction;
	const contextMenuLatLng = pendingContextMenuLatLng ? L.latLng(pendingContextMenuLatLng) : null;
	if (action === "open-spotlight-search") {
		closeMapContextMenu();
		openSpotlightSearch();
		return;
	}

	// 🔴 Owner-Entscheid 15.08.2026: „Stelle markieren und teilen hat durch 'Was ist hier?' keine
	// richtige Funktion und kann weg" -- der eigene Zweig (action === "share-pin") ist damit
	// ersatzlos gefallen. Was blieb noetig war: die Markierung setzen und die Auskunft zeigen, und
	// GENAU das tut der Zweig unten. Ein sofortiger Link-Kopf ohne Panel geht seither nicht mehr per
	// Kartenmenue -- nur noch ueber die Kachel „Link teilen" im geoeffneten Panel (share-what-is-here
	// weiter unten, dieselben Funktionen: setSharePin, copySharePinLinkWithFeedback).
	if (action === "what-is-here" && contextMenuLatLng) {
		closeMapContextMenu();
		if (setSharePin(contextMenuLatLng)) {
			window.avesmapsShowWhatIsHere(contextMenuLatLng);
		}
		if (typeof trackVisitorEvent === "function") {
			trackVisitorEvent("map_option", "was ist hier");
		}
		return;
	}

	if (action === "report-location" && contextMenuLatLng) {
		closeMapContextMenu();
		openLocationReportDialog(contextMenuLatLng);
		return;
	}

	if (action === "create-location" && contextMenuLatLng) {
		closeMapContextMenu();
		void createLocationAt(contextMenuLatLng);
		return;
	}

	if (action === "create-crossing" && contextMenuLatLng) {
		closeMapContextMenu();
		void createCrossingAt(contextMenuLatLng);
		return;
	}

	if (action === "split-path-at-node") {
		const splitState = pendingPathSplit;
		closeMapContextMenu();
		ensureCrossingsEnabled();
		void splitPathAtNode(splitState);
		return;
	}

	if (action === "create-path" && contextMenuLatLng) {
		closeMapContextMenu();
		startPathCreationAt(contextMenuLatLng);
		return;
	}

	if (action === "create-powerline" && contextMenuLatLng) {
		closeMapContextMenu();
		const nearest = findNearestLocationToLatLng(contextMenuLatLng);
		startPowerlineCreationFromEndpoint(getPowerlineEndpointByPublicId(nearest?.publicId || "") || nearest);
		return;
	}

	if (action === "create-label" && contextMenuLatLng) {
		closeMapContextMenu();
		createLabelAt(contextMenuLatLng);
		return;
	}

	if (action === "create-region" && contextMenuLatLng) {
		closeMapContextMenu();
		void createRegionAt(contextMenuLatLng);
		return;
	}

	if (action === "find-nearest-location" && contextMenuLatLng) {
		const nearestLocation = findNearestLocationToLatLng(contextMenuLatLng);
		closeMapContextMenu();
		if (!nearestLocation) {
			showFeedbackToast(tr("toast.findNearest.none", "Kein Ort gefunden."), "warning");
			return;
		}

		// Schlanke Infobox als Karten-Popup am gefundenen Ort zeigen (Owner: "muss wieder die infobox
		// zeigen"). Marker-Entry robust ueber publicId, sonst ueber den Namen.
		const nearestEntry = (typeof findLocationMarkerByPublicId === "function" && nearestLocation.publicId
			? findLocationMarkerByPublicId(nearestLocation.publicId)
			: null)
			|| (typeof findLocationMarkerByName === "function" ? findLocationMarkerByName(nearestLocation.name) : null);
		if (!nearestEntry || !openSlimLocationPopupForMarkerEntry(nearestEntry)) {
			showFeedbackToast(tr("toast.findNearest.openFailed", "Der nächste Ort konnte nicht geöffnet werden."), "warning");
		}
		return;
	}

	// „Hierher reisen": eine Route vom Startpunkt des Planers bis GENAU hierhin -- ueber den Graphen
	// bis zum naechsten Knoten, von dort querfeldein. Die Arbeit steht in route-travel-here.js.
	if (action === "travel-here" && contextMenuLatLng) {
		closeMapContextMenu();
		void travelToMapPoint(contextMenuLatLng);
		return;
	}

	if (action === "start-distance-measurement" && contextMenuLatLng) {
		closeMapContextMenu();
		startDistanceMeasurementAt(contextMenuLatLng);
		showFeedbackToast(tr("toast.measure.startSet", "Startpunkt gesetzt. Jetzt den zweiten Punkt anklicken."), "info");
		return;
	}

	if (action === "clear-distance-measurement") {
		closeMapContextMenu();
		if (clearDistanceMeasurement()) {
			showFeedbackToast(tr("toast.measure.cleared", "Entfernungsmessung gelöscht."), "success");
		}
	}
});

// Political context link in a settlement infobox (buildSettlementPoliticalLineMarkup): fly to + open the
// territory it names. Separate delegated handler because it is a text link, not a .location-popup__action-
// button, and must not inherit that button's styling/dispatch. Works in the floating box AND the panel
// (document-level delegation).
$(document).on("click", ".location-popup__political-link", function (event) {
	event.preventDefault();
	event.stopPropagation();
	const territoryName = this.dataset.politicalTerritory || "";
	const territoryPublicId = this.dataset.politicalPublicId || "";
	if (territoryName && typeof avesmapsFocusPoliticalTerritory === "function") {
		avesmapsFocusPoliticalTerritory(territoryName, territoryPublicId);
	}
});

// Resolved "Verlauf" station in a way's infobox (map-features-path-item-links.js): fly to whatever it names --
// a settlement, another way (junction) or a landscape. Sibling of the political link above: same gold look, but
// its own handler because that one aims at territories. kind+ref were resolved when the markup was built, so
// this is a pure route: no lookup by name, no request.
$(document).on("click", ".location-popup__station-link", function (event) {
	event.preventDefault();
	event.stopPropagation();
	if (typeof focusPathItemStation === "function") {
		focusPathItemStation(this.dataset.stationKind || "", this.dataset.stationRef || "");
	}
});

$(document).on("click", ".location-popup__action-button", function (event) {
	event.preventDefault();
	event.stopPropagation();

	const action = this.dataset.popupAction;

	// 🔴 EIN KLICK AUF EINEN AKTIONSKNOPF SCHLIESST DAS POPUP (Owner 2026-07-29). Jeder dieser Knöpfe
	// führt woanders hin: er öffnet einen Dialog, startet einen Modus, hebt einen Weg hervor oder holt
	// die Info ins Panel. Das Popup hat damit seine Arbeit getan -- und blieb bisher als Kasten mitten
	// auf der Karte stehen, meist genau über dem, was der Klick gerade zeigen wollte.
	//
	// 🪤 EINMAL HIER, nicht in jedem der 25 Zweige. NEUN von ihnen riefen es bisher selbst, die übrigen
	// sechzehn nicht -- darunter alle vier Knöpfe des Label-Popups, mit dem der Owner es gemeldet hat.
	// Genau so sieht eine Regel aus, die je Zweig gepflegt wird: sie gilt für die Hälfte. Die neun
	// eigenen Aufrufe sind mit diesem Commit entfallen, damit niemand aus einem übriggebliebenen
	// schliesst, es werde eben NICHT allgemein geschlossen.
	//
	// 💣 Sicher an dieser Stelle, weil KEIN Zweig danach das Popup-DOM anfasst: alle lesen ausschliesslich
	// `this.dataset`, und die Attribute überleben das Aushängen des Elements. Geprüft, nicht vermutet.
	if (typeof map !== "undefined" && map && typeof map.closePopup === "function") {
		map.closePopup();
	}

	if (action === "add-location-to-route") {
		const locationName = this.dataset.locationName;
		if (locationName) {
			fillLastEmptyWaypointOrAppend(locationName);
			updateMapView();
		}
		return;
	}

	if (action === "show-in-panel") {
		// "Anzeigen": die volle Info dieser Stadt ins rechte Panel holen + ihren Wegpunkt-Tab aktivieren
		// UND die Karte auf sie zentrieren (Owner: "Anzeigen" zentriert IMMER die Ansicht und zeigt die
		// Infoleiste). panTo statt flyTo -- die Zoomstufe ist die Wahl des Nutzers und bleibt, wie sie ist.
		const placeName = this.dataset.placeName;
		const entry = placeName && typeof findLocationMarkerByName === "function" ? findLocationMarkerByName(placeName) : null;
		if (entry && typeof window.avesmapsShowLocationInInfopanel === "function") {
			window.avesmapsShowLocationInInfopanel(entry);
		}
		// Erst das Panel, dann zentrieren: das Panel liegt rechts ueber der Karte, und bei einem Ort dicht am
		// rechten Rand soll er danach frei liegen. Number.isFinite-Guard, weil ein Pan mit NaN das Map-Center
		// dauerhaft zerstoert (siehe die Recenter-Guards weiter unten); getLatLng faellt aus, wenn der Marker
		// gerade nicht auf der Karte liegt (Kategorie aus, ausserhalb des Zoom-Bands).
		const showLatLng = entry && entry.marker && typeof entry.marker.getLatLng === "function" ? entry.marker.getLatLng() : null;
		if (showLatLng && Number.isFinite(showLatLng.lat) && Number.isFinite(showLatLng.lng)) {
			map.panTo(showLatLng);
		}
		return;
	}

	// "Anzeigen" in a way's infobox (Owner 2026-07-17): mark the WHOLE way and zoom to its full extent --
	// the same thing ?strasse=/?fluss= does, through the same resolver. Distinct from "show-in-panel" above,
	// which shares the label but means "put THIS city in the panel" in a waypoint popup.
	if (action === "show-whole-path") {
		const path = typeof findPathByPublicId === "function" ? findPathByPublicId(this.dataset.publicId) : null;
		if (!path) {
			showFeedbackToast(tr("toast.path.notFound", "Weg konnte nicht gefunden werden."), "warning");
			return;
		}
		if (typeof showWholePathFromInfobox === "function") {
			showWholePathFromInfobox(path);
		}
		return;
	}

	if (action === "show-whole-powerline") {
		const powerline = typeof findPowerlineByPublicId === "function" ? findPowerlineByPublicId(this.dataset.publicId) : null;
		if (!powerline) {
			showFeedbackToast("Kraftlinie konnte nicht gefunden werden.", "warning");
			return;
		}
		if (typeof showWholePowerlineFromInfobox === "function") {
			showWholePowerlineFromInfobox(powerline);
		}
		return;
	}

	if (action === "remove-waypoint") {
		const waypointId = this.dataset.waypointId;
		if (waypointId) {
			removeWaypointById(waypointId);
		}
		return;
	}

	// „Verschieben" am freien Kartenpunkt: der naechste Klick auf die Karte setzt ihn um. Die zweite,
	// unsichtbare Art ist der Marker selbst -- er laesst sich direkt ziehen (route-render.js).
	if (action === "move-map-point") {
		const waypointId = this.dataset.waypointId;
		if (waypointId && typeof beginMapPointRelocation === "function") {
			beginMapPointRelocation(waypointId);
		}
		return;
	}

	// 🔴 KEIN „move-share-pin" mehr (Owner 15.08.2026: „verschieben kann wieder weg, drag n drop geht
	// ja immer"). Die gesetzte Markierung wird am Marker gezogen -- bindSharePinDragging in
	// js/map-features/map-features-share-pin.js. Der freie Kartenpunkt BEHAELT seine Kachel: ihn gibt
	// es auch als Wegpunkt-Zeile im Planer, wo kein Marker zum Anfassen danebensteht.

	// „Als Reiseziel hinzufuegen" an der gesetzten Markierung. Es ruft DIESELBE Funktion wie
	// „Hierher reisen" im Kartenmenue (travelToMapPoint in route-travel-here.js) -- die traegt den
	// Punkt als Wegpunkt ein und laesst den Planer rechnen. Ein eigener Routenweg fuer die Markierung
	// waere ein zweiter neben dem des Planers, und genau den hat travelToMapPoint abgeschafft.
	//
	// 💣 Die Koordinaten kommen aus `sharePinCoordinates`, NICHT aus `contextMenuLatLng`: dieses Menue
	// haengt am Marker, nicht an einem Rechtsklick -- contextMenuLatLng truege noch die Stelle des
	// letzten Rechtsklicks irgendwo anders auf der Karte, und die Reise ginge dorthin.
	if (action === "travel-to-share-pin") {
		if (sharePinCoordinates && typeof travelToMapPoint === "function") {
			void travelToMapPoint(sharePinCoordinates);
		}
		return;
	}

	// „Link teilen" im Aktionsband der Auskunft -- kopiert den ?pin=<lat,lng>-Deep-Link der
	// gesetzten Markierung (copySharePinLinkWithFeedback, map-features-share-pin.js). Seit dem
	// Wegfall von „Stelle markieren und teilen" (Owner-Entscheid 15.08.2026) ist das der EINZIGE
	// Weg, diesen Link zu kopieren. Die Koordinaten kommen aus `sharePinCoordinates`, aus demselben
	// Grund wie bei „Reiseziel hinzufuegen" oben: dieses Aktionsband haengt an der Markierung.
	if (action === "share-what-is-here") {
		if (sharePinCoordinates) {
			void copySharePinLinkWithFeedback(sharePinCoordinates);
		}
		return;
	}

	if (action === "remove-share-pin") {
		clearSharePin();
		return;
	}

	// „Kreuzung melden": Aufbau/Zwischenablage/Toast stehen in reportCrossingWithFeedback
	// (map-features-share-pin.js, neben buildSharePinLink/copySharePinLinkWithFeedback -- dort lebt
	// das Pin-Link-Vokabular), derselbe Zuschnitt wie share-place-link gleich daneben.
	if (action === "report-crossing") {
		void reportCrossingWithFeedback(this.dataset.publicId);
		return;
	}

	if (action === "share-place-link") {
		const publicId = this.dataset.publicId;
		if (publicId) {
			// wikiUrl/wikiParam kommen aus data-Attributen (sharePlaceActionButtonMarkup, js/ui/popups.js):
			// buildPlaceShareLink bevorzugt dann den Wiki-Deep-Link-Parameter statt ?place=<publicId>.
			void sharePlaceLinkWithFeedback(publicId, {
				wikiUrl: this.dataset.wikiUrl || "",
				wikiParam: this.dataset.wikiParam || "",
			});
		}
		return;
	}

	if (action === "suggest-change") {
		if (typeof openChangeSuggestionDialog === "function") {
			openChangeSuggestionDialog({
				entityType: this.dataset.entityType || "",
				entityId: this.dataset.entityId || "",
				name: this.dataset.name || "",
				reportType: this.dataset.reportType || "sonstiges",
				size: this.dataset.size || "",
				lat: this.dataset.lat || "",
				lng: this.dataset.lng || "",
			});
		}
		return;
	}

	if (action === "write-review") {
		const publicId = this.dataset.publicId;
		const locationName = this.dataset.locationName || "";
		if (publicId && typeof openReviewDialog === "function") {
			openReviewDialog(publicId, locationName);
		}
		return;
	}

	if (action === "start-location-edit") {
		const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
		if (!markerEntry) {
			showFeedbackToast("Ort konnte nicht für die Bearbeitung gefunden werden.", "warning");
			return;
		}

		setLocationEditActive(markerEntry, true);
		return;
	}

	if (action === "convert-crossing-to-location") {
		const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
		if (!markerEntry) {
			showFeedbackToast("Kreuzung konnte nicht gefunden werden.", "warning");
			return;
		}

		void convertCrossingToLocation(markerEntry);
		return;
	}

	if (action === "edit-location-details") {
		const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
		if (!markerEntry) {
			showFeedbackToast("Ort konnte nicht für die Bearbeitung gefunden werden.", "warning");
			return;
		}

		void editLocationDetails(markerEntry);
		return;
	}

	if (action === "start-path-from-location") {
		const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
		if (!markerEntry) {
			showFeedbackToast("Startknoten konnte nicht gefunden werden.", "warning");
			return;
		}

		startPathCreationFromLocation(markerEntry.location);
		return;
	}

	if (action === "continue-path-at-location") {
		const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
		if (!markerEntry) {
			showFeedbackToast("Zielknoten konnte nicht gefunden werden.", "warning");
			return;
		}

		void extendPendingPathCreationAtLocation(markerEntry.location);
		return;
	}

	if (action === "finish-path-at-location") {
		const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
		if (!markerEntry) {
			showFeedbackToast("Zielknoten konnte nicht gefunden werden.", "warning");
			return;
		}

		void completePendingPathCreationAtLocation(markerEntry.location);
		return;
	}

	if (action === "start-powerline-from-location") {
		const endpoint = getPowerlineEndpointByPublicId(this.dataset.publicId)
			|| (() => {
				const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
				return markerEntry?.location || null;
			})();
		startPowerlineCreationFromEndpoint(endpoint);
		return;
	}

	if (action === "finish-powerline-at-location") {
		const endpoint = getPowerlineEndpointByPublicId(this.dataset.publicId)
			|| (() => {
				const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
				return markerEntry?.location || null;
			})();
		void completePendingPowerlineAtEndpoint(endpoint);
		return;
	}

	if (action === "delete-location") {
		const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
		if (!markerEntry) {
			showFeedbackToast("Ort konnte nicht für die Bearbeitung gefunden werden.", "warning");
			return;
		}

		void deleteLocationMarker(markerEntry);
		return;
	}

	if (action === "flip-river-flow") {
		const path = findPathByPublicId(this.dataset.publicId);
		if (!path) {
			showFeedbackToast("Weg konnte nicht gefunden werden.", "warning");
			return;
		}

		void submitPathFlowShortcut(path);
		return;
	}

	if (action === "edit-path-details") {
		const path = findPathByPublicId(this.dataset.publicId);
		if (!path) {
			showFeedbackToast("Weg konnte nicht gefunden werden.", "warning");
			return;
		}

		openPathEditDialog(path);
		return;
	}

	if (action === "edit-path-geometry") {
		const path = findPathByPublicId(this.dataset.publicId);
		if (!path) {
			showFeedbackToast("Weg konnte nicht gefunden werden.", "warning");
			return;
		}

		startPathGeometryEdit(path);
		return;
	}

	if (action === "delete-path") {
		const path = findPathByPublicId(this.dataset.publicId);
		if (!path) {
			showFeedbackToast("Weg konnte nicht gefunden werden.", "warning");
			return;
		}

		void deletePathFeature(path);
		return;
	}

	if (action === "edit-powerline-details") {
		const powerline = findPowerlineByPublicId(this.dataset.publicId);
		if (!powerline) {
			showFeedbackToast("Kraftlinie konnte nicht gefunden werden.", "warning");
			return;
		}

		// The line editor owns editing now (docs/superpowers/specs/2026-07-23-kraftlinien-editor-design.md
		// §11): with "line = all segments", renaming a single segment via the old one-segment dialog
		// would split the line, so open the list editor on this line instead. Fall back if unavailable.
		if (typeof openAvesmapsPowerlineEditorOverlay === "function") {
			openAvesmapsPowerlineEditorOverlay(getPowerlineDisplayName(powerline));
		} else {
			openPowerlineEditDialog(powerline);
		}
		return;
	}

	if (action === "delete-powerline") {
		const powerline = findPowerlineByPublicId(this.dataset.publicId);
		if (!powerline) {
			showFeedbackToast("Kraftlinie konnte nicht gefunden werden.", "warning");
			return;
		}

		void deletePowerlineFeature(powerline);
		return;
	}

	if (action === "start-label-edit") {
		const labelEntry = findLabelEntryByPublicId(this.dataset.publicId);
		if (!labelEntry) {
			showFeedbackToast("Label konnte nicht gefunden werden.", "warning");
			return;
		}

		setLabelMoveActive(labelEntry, true);
		return;
	}

	if (action === "edit-label-details") {
		const labelEntry = findLabelEntryByPublicId(this.dataset.publicId);
		if (!labelEntry) {
			showFeedbackToast("Label konnte nicht gefunden werden.", "warning");
			return;
		}

		openLabelEditDialog({ labelEntry });
		return;
	}

	if (action === "delete-label") {
		const labelEntry = findLabelEntryByPublicId(this.dataset.publicId);
		if (!labelEntry) {
			showFeedbackToast("Label konnte nicht gefunden werden.", "warning");
			return;
		}

		void deleteLabelEntry(labelEntry);
		return;
	}

	if (action === "duplicate-label") {
		const labelEntry = findLabelEntryByPublicId(this.dataset.publicId);
		if (!labelEntry) {
			showFeedbackToast("Label konnte nicht gefunden werden.", "warning");
			return;
		}

		void duplicateLabelEntry(labelEntry);
		return;
	}

	// Die beiden Handgriffe an der FLAECHE unter dem Namen (Owner 24.08.2026). Sie fuehren in dieselben
	// zwei Werkzeuge wie die gleichnamigen Eintraege im Kontextmenue der Flaeche -- die Aufloesung
	// Label -> Region -> naechste Flaeche und der noetige Ansichtswechsel stecken in EINER Funktion
	// (avesmapsLabelFlaechenHandgriff, map-features-labels.js), damit hier kein zweiter Weg entsteht.
	if (action === "label-area-properties" || action === "label-area-geometry") {
		const labelEntry = findLabelEntryByPublicId(this.dataset.publicId);
		if (!labelEntry) {
			showFeedbackToast("Label konnte nicht gefunden werden.", "warning");
			return;
		}

		void avesmapsLabelFlaechenHandgriff(
			labelEntry.label,
			action === "label-area-properties" ? "eigenschaften" : "geometrie"
		);
		return;
	}

	// „Position zurücksetzen“: die Beschriftung geht an den Point of Inaccessibility ihrer Fläche
	// zurück. Die ganze Rechnung samt Rückfrage steckt in avesmapsLabelPositionZuruecksetzen
	// (map-features-labels.js), damit hier kein zweiter Weg entsteht.
	// Gewacht von js/map-features/__tests__/label-position-zuruecksetzen.test.js.
	if (action === "reset-label-position") {
		const labelEntry = findLabelEntryByPublicId(this.dataset.publicId);
		if (!labelEntry) {
			showFeedbackToast("Label konnte nicht gefunden werden.", "warning");
			return;
		}

		void avesmapsLabelPositionZuruecksetzen(labelEntry);
		return;
	}

});

const normalizeLocationSearchName = (name) => {
	return typeof name === "string" ? name.normalize("NFC").trim().toLowerCase() : "";
};

const normalizeLocationDuplicateName = (name) => {
	return typeof name === "string"
		? name
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "")
		: "";
};

// Mirrors the SERVER duplicate rule 1:1 (avesmapsNormalizeDuplicateLocationName,
// api/_internal/map/features.php): lowercase, then drop everything that is neither a letter nor a
// digit. Deliberately NOT normalizeLocationDuplicateName above -- that one also strips accents, so
// it folded "Grötz" onto "Grotz" and refused names the server would happily have accepted. The
// accent-folding variant stays where being generous is the point (matching what a user typed into
// a waypoint field); the duplicate CHECK must predict the server exactly, or the editor is told
// "already exists" about a name that is in fact free.
const normalizeServerDuplicateLocationName = (name) => {
	return typeof name === "string" ? name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") : "";
};

// Same sentence the server throws (avesmapsDuplicateLocationNameMessage) -- one rule, one wording,
// whichever side rejects first. Bug #46: name the place that blocks, then say what to do about it.
function duplicateLocationNameMessage(existingName) {
	return `Ein Ort namens "${existingName}" existiert bereits. Ortsnamen bleiben eindeutig - gib dem zweiten Ort einen Zusatz in Klammern, so wie im Wiki (z. B. "${existingName} (Region)").`;
}

const validateLocation = (name) => {
	const normalizedName = normalizeLocationSearchName(name);

	if (!normalizedName) {
		return null;
	}

	const location = locationData.find((loc) => normalizeLocationSearchName(loc.name) === normalizedName) || null;
	if (location) {
		return location;
	}

	// „Hierher reisen": ein angeklickter Kartenpunkt ist kein Ort und steht in keiner Liste -- er
	// TRAEGT seine Koordinaten im Namen („Kartenpunkt (657.150, 270.990)"). Ohne diese Zeile faellt
	// seine Wegpunkt-Zeile beim naechsten Neuberechnen als „Ort nicht gefunden" heraus.
	//
	// ⚠️ ERST NACH der Ortssuche: ein echter Ort gewinnt immer. Das Muster haengt ohnehin an den
	// Klammern am Ende, und kein Ortsname endet auf „(Zahl, Zahl)".
	return typeof parseMapPointWaypoint === "function" ? parseMapPointWaypoint(name) : null;
};

function findDuplicateLocationByName(name, { excludePublicId = "", allowCurrentName = "" } = {}) {
	const normalizedName = normalizeServerDuplicateLocationName(name);
	if (!normalizedName) {
		return null;
	}

	const normalizedCurrentName = normalizeServerDuplicateLocationName(allowCurrentName);
	if (normalizedCurrentName !== "" && normalizedCurrentName === normalizedName) {
		return null;
	}

	return locationData.find((location) => {
		// Crossings are skipped even though the server DOES compare against them: prepareLocationData
		// renumbers them client-side (`Kreuzung-${crossingCount++}`), so the names in locationData are
		// synthetic labels, not the stored ones. Checking them here would compare against fabricated
		// data. A settlement colliding with a real crossing name is caught server-side instead.
		if (isCrossingLocation(location)) {
			return false;
		}

		if (excludePublicId !== "" && location.publicId === excludePublicId) {
			return false;
		}

		return normalizeServerDuplicateLocationName(location.name) === normalizedName;
	}) || null;
}

// Liefert die waypoint-ID, falls der Ort bereits in der Route ist (sonst ""). So weiss die
// normale Marker-Infobox, ob sie "Reiseziel hinzufügen" oder "Reiseziel entfernen" zeigt.
function findWaypointIdByLocationName(name) {
	const target = normalizeLocationDuplicateName(name);
	if (!target) {
		return "";
	}
	let foundId = "";
	getWaypointContainers().each(function () {
		const inputValue = String($(this).find(".waypoint-input").val() || "").trim();
		if (inputValue && normalizeLocationDuplicateName(inputValue) === target) {
			foundId = String($(this).data("waypointId") || "");
			return false;
		}
	});
	return foundId;
}

// Inhalt der Wegpunkt-Box: Kopf (Name + Typ + Rolle in der Reise) und darunter DASSELBE Menue, das die
// normal angeklickte Ortsbox zeigt -- Reiseziel entfernen · Link teilen · Abenteuer · Kartensammlung,
// mit der kompakten Bewertungszeile darunter (Owner 2026-08-04). Weiterhin OHNE Attribut-Tabelle: die
// volle Ortsinfo steht im rechten Panel, und dorthin bringt sie seither der Klick auf den Marker selbst.
function routeWaypointRoleLabel(role) {
	if (role === "start") return tr("route.role.start", "Startpunkt");
	if (role === "between") return tr("route.role.between", "Zwischenziel");
	if (role === "end") return tr("route.role.end", "Ziel");
	return "";
}

function buildRoutePopupHtml(loc, { showRemoveAction = false, role = "" } = {}) {
	const markerEntry = typeof findLocationMarkerByName === "function" ? findLocationMarkerByName(loc.name) : null;

	const buttons = [];
	// KEIN "Anzeigen" mehr (Owner 2026-08-04). Ein Klick auf die Scheibe holt die Ortschaft jetzt selbst
	// ins Panel -- genau wie ein Klick auf jeden anderen Ort (bindRouteWaypointHoverPopup in
	// route-render.js). Eine Kachel, die nur nachholt, was der Klick schon getan hat, ist eine Kachel zu
	// viel; der Platz gehoert den vier Kacheln, die auch die normal angeklickte Ortsbox zeigt.
	// „Verschieben" -- nur am freien Kartenpunkt, und VOR dem Entfernen: wer einen Punkt danebengesetzt
	// hat, will ihn ruecken, nicht wegwerfen und neu anlegen. Am Marker allein waere das nicht zu sehen
	// (er laesst sich zwar ziehen, sagt es aber nicht), und auf Touch zieht ein Finger die Karte.
	if (showRemoveAction && loc.isMapPoint && loc.waypointId) {
		buttons.push(popupActionButtonMarkup({
			label: tr("popup.moveMapPoint", "Verschieben"),
			// Das Kreuz wohnt seit dem 14.08.2026 in popupMoveIconMarkup() (js/ui/popups.js) -- die
			// gesetzte Markierung traegt dieselbe Kachel, und zwei Abschriften desselben SVG laufen
			// auseinander.
			iconMarkup: popupMoveIconMarkup(),
			attributes: { "data-popup-action": "move-map-point", "data-waypoint-id": loc.waypointId },
		}));
	}
	if (showRemoveAction && loc.waypointId) {
		buttons.push(popupActionButtonMarkup({
			label: tr("popup.removeFromRoute", "Reiseziel entfernen"),
			className: "location-popup__action-button--danger",
			iconMarkup: '<span class="location-popup__action-icon location-popup__action-icon--remove" aria-hidden="true">✕</span>',
			attributes: { "data-popup-action": "remove-waypoint", "data-waypoint-id": loc.waypointId },
		}));
	}
	// "Link teilen" like the normal marker infobox -- now always shown (no more expand step).
	// wikiParam "siedlung" matches the settlement deep-link parameter (js/app/wiki-deeplink.js).
	if (markerEntry && markerEntry.publicId) {
		const shareButton = typeof sharePlaceActionButtonMarkup === "function"
			? sharePlaceActionButtonMarkup(markerEntry.publicId, { wikiUrl: markerEntry.location?.wikiUrl || "", wikiParam: "siedlung" })
			: "";
		if (shareButton) {
			buttons.push(shareButton);
		}
	}
	// "Abenteuer" + "Kartensammlung" wie in der normal angeklickten Ortsbox (Owner 2026-08-04): die
	// Wegpunkt-Box zeigt dasselbe Menue -- Reiseziel entfernen · Link teilen · Abenteuer · Kartensammlung.
	// Beide Kacheln stehen auch dann da, wenn nichts vorliegt (Katalog nicht geladen -> deaktiviert; Ort
	// ohne Eintraege -> Dialog mit Vorschlagen-Angebot), damit die Leiste beim Nachladen nicht springt.
	// Ein freier Kartenpunkt hat keine publicId und bekommt darum keine von beiden.
	if (markerEntry && markerEntry.publicId) {
		if (typeof buildFloatingGameLiteratureButtonMarkup === "function") {
			buttons.push(buildFloatingGameLiteratureButtonMarkup(markerEntry.location, markerEntry.publicId));
		}
		if (typeof buildFloatingCityMapsButtonMarkup === "function") {
			buttons.push(buildFloatingCityMapsButtonMarkup(markerEntry.location, markerEntry.publicId));
		}
	}
	const actionButtons = buttons.filter(Boolean);
	const actionsBar = actionButtons.length ? locationPopupActionsMarkup(actionButtons) : "";
	// Bewertungen in der kompakten Fassung (Schnitt als Link ins Panel + "Bewertung schreiben") -- dieselbe
	// Zeile, die unten in der normal angeklickten Ortsbox steht. Gefuellt wird sie beim OEFFNEN der Box
	// (hydrateLocationReviews in bindRouteWaypointHoverPopup), nicht hier: dieses Markup entsteht einmal je
	// Routenberechnung, der Netzabruf gehoert an den Moment, in dem jemand hinsieht.
	const reviewsSlot = markerEntry && markerEntry.publicId
		? `<div class="location-reviews" data-reviews-compact="1" data-reviews-public-id="${escapeHtml(markerEntry.publicId)}" data-reviews-name="${escapeHtml(markerEntry.name)}"></div>`
		: "";

	// Slim waypoint box: header (name + type) + action buttons only. No Wiki link / infobox here --
	// that lives in the normal marker popup.
	const settlementTypeLabel = (markerEntry && markerEntry.location && markerEntry.location.locationTypeLabel) || loc.locationTypeLabel || "";
	// Die Rolle in der Route ("Dorf · Startpunkt") steht mit in der Typ-Zeile -- so ist sie auch dann
	// lesbar, wenn man die Markerform nicht auf Anhieb zuordnet.
	const roleLabel = routeWaypointRoleLabel(role);
	const routeTypeLabel = [settlementTypeLabel, roleLabel].filter(Boolean).join(" · ");
	// Header icon: the SAME realistic settlement illustration (by size) as the normal floating box, so the
	// waypoint box header matches it -- rendered 50x50 via `.floating-location-popup .location-popup__icon--realistic`
	// (Owner: "das icon der stadt 50x50"). Empty markup falls back to the default type icon in locationPopupMarkup.
	// Waehlt die Illustration nach der SIEDLUNGSGROESSE -- also mit dem reinen Typ-Label ("Dorf"), nicht
	// mit der um die Rolle ergaenzten Anzeige-Zeile.
	// 💣 Ein freier Kartenpunkt ist KEINE Ortschaft. settlementRealisticIconMarkup faellt bei unbekanntem
	// Typ auf LOCATION_REALISTIC_ICON_PATHS.dorf zurueck (js/ui/popups.js) -- die Box behauptete damit ein
	// Dorf an einer Stelle, an der nichts steht (Owner 2026-08-14: „das dorf symbol mach keinen sinn wenn
	// man frei reist"). Er bekommt den Wanderschuh: dasselbe Zeichen, mit dem die Karte ohnehin „zu Fuss"
	// und „hierher reisen" meint.
	// Die Klasse bleibt --realistic, damit er dieselben 50x50 bekommt wie die Illustration daneben; alt=""
	// ist richtig, denn der Name der Box nennt den Punkt bereits samt Koordinaten.
	const headerIcon = loc.isMapPoint
		? `<img class="location-popup__icon location-popup__icon--realistic" src="${escapeHtml(withAssetVersion("icons/schuh.webp"))}" alt="" />`
		: (typeof settlementRealisticIconMarkup === "function"
			? settlementRealisticIconMarkup(loc.locationType, settlementTypeLabel)
			: "");
	return locationPopupMarkup({
		name: loc.name,
		locationType: loc.locationType,
		locationTypeLabel: routeTypeLabel,
		headerIconMarkup: headerIcon,
		showType: Boolean(routeTypeLabel),
		// Full-bleed divider between the header and the action tiles (Owner: "trenner zwischen den buttons
		// und dem header"). CSS (.route-waypoint-popup .location-popup__divider) pulls it edge-to-edge.
		showDivider: Boolean(actionsBar),
		showDescription: false,
		showWikiLink: false,
		isRuined: loc.isRuined,
		actionsMarkup: actionsBar + reviewsSlot,
	});
}

// Die permanent offenen Wegpunkt-Infoboxen (frueher addTooltip/removeAllTooltips) sind ersetzt: die
// Wegpunkte tragen jetzt eigene Marker, deren Infobox beim Hover erscheint (renderRouteWaypointMarkers
// in route-render.js). Aufgeraeumt wird dort ueber removeHighlightedRouteNodes.

// Hebt fehlerhafte Eingaben hervor
const highlightError = ($input) => {
	$input.css("border", "2px solid red");
	setTimeout(() => $input.css("border", ""), 3000);
};

function collectAndValidateSelectedLocations() {
	selectedLocations = [];
	invalidLocationInputs = [];

	getWaypointContainers().each(function () {
		const $waypoint = $(this);
		const $input = $waypoint.find(".waypoint-input");
		const inputVal = ($input.val() || "").trim();

		if (!inputVal) {
			return;
		}

		const loc = validateLocation(inputVal);
		if (loc) {
			selectedLocations.push({
				...loc,
				waypointId: String($waypoint.data("waypointId") || ""),
			});
			// 🔴 DER TRICHTER ALLER WEGPUNKT-WEGE: die Vorschlagsliste, der von Hand getippte Name und
			// der geteilte Link, der die Felder vorbefuellt, laufen alle hier durch. Deshalb steht die
			// Aufdeckung HIER und nicht zusaetzlich im select-Handler der Vorschlagsliste -- der ruft
			// updateMapView, und das kommt ohnehin hierher. Ohne sie waere ein geteilter Link auf einen
			// versteckten Ort eine Route zu einem unsichtbaren Punkt.
			if (typeof avesmapsRevealHiddenLocationByName === "function") {
				avesmapsRevealHiddenLocationByName(inputVal);
			}
		} else {
			invalidLocationInputs.push(inputVal);
			highlightError($input);
		}
	});
}

/******************************************************************
 * Aktualisiert Kartenansicht und berechnet die Route
 ******************************************************************/
function updateMapView() {
	// The live UI is server-primary. installServerPrimaryRouting() normally aliases this function to
	// updateMapViewServerPrimary, but that setTimeout-based alias is load-order fragile and can be
	// overwritten by this very declaration -- leaving the UI on the legacy CLIENT graph, which (since
	// the crossing-split revert) returns the long detour route and then fits the map to its big bounds
	// (zoom ~4). Delegate explicitly so a search ALWAYS uses the split-aware server path + route fit.
	if (typeof shouldUseServerPrimaryRouting === "function" && shouldUseServerPrimaryRouting()
		&& typeof updateMapViewServerPrimary === "function") {
		return updateMapViewServerPrimary();
	}
	const useShortest = $('input[name="pathType"]:checked').val() === "shortest";
	const routeOptions = buildRouteOptionsFromPlannerControls();
	syncPlannerStateToUrl();
	graphData = createGraph(routeOptions);
	console.log("Graph:", graphData);

	resetRoutePresentation();
	collectAndValidateSelectedLocations();

	renderRouteWaypointMarkers();

	console.log("Ausgewählte Locations:", selectedLocations);
	console.log("Ungültige Eingaben:", invalidLocationInputs);

	focusMapOnActiveTargets();
	if (invalidLocationInputs.length) alert(tr("routing.alert.locationsNotFound", "Orte nicht gefunden: {list}", { list: invalidLocationInputs.join(", ") }));

	if (selectedLocations.length >= 2) {
		const routeResult = buildRouteResultFromSelectedLocations(useShortest);
		if (!routeResult) {
			return;
		}
		let { routeNodeNames, segments } = routeResult;
		console.log("Komplette Route (Knoten):", routeNodeNames);
		console.log("Routensegmente:", segments);
		if (segments.length) {
			logRoutePoints(segments);
			drawRoute(segments);
			showRoutePlan(routeNodeNames, segments);
		} else {
			alert(tr("routing.alert.noValidSegments", "Keine gültigen Routensegmente gefunden."));
		}
	}
}
