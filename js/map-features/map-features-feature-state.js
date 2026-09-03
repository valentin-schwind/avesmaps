function updateRevisionFromEditResponse(payload) {
	const revision = payload?.feature?.revision || payload?.feature?.properties?.revision;
	if (revision && mapDataSourceStatus) {
		mapDataSourceStatus.revision = revision;
		updateMapDataStatus({ avesmapsSource: mapDataSourceStatus });
	}
}

function getLocalFeatureRevision(publicId) {
	if (!publicId) {
		return null;
	}

	const markerEntry = findLocationMarkerByPublicId(publicId);
	if (markerEntry?.location?.revision !== undefined) {
		return markerEntry.location.revision;
	}

	const path = findPathByPublicId(publicId);
	if (path?.properties?.revision !== undefined) {
		return path.properties.revision;
	}

	const labelEntry = labelMarkers.find((entry) => entry.label.publicId === publicId);
	if (labelEntry?.label?.revision !== undefined) {
		return labelEntry.label.revision;
	}

	const regionEntry = regionData.map(normalizeRegionFeature).find((entry) => entry.publicId === publicId)
		|| regionPolygons.map((polygon) => polygon._regionEntry).find((entry) => entry?.publicId === publicId);
	return regionEntry?.revision ?? null;
}

function withExpectedRevision(payload) {
	if (!payload?.public_id || payload.expected_revision !== undefined || ["create_point", "create_crossing", "create_path", "create_label", "create_region", "acquire_lock", "release_lock"].includes(payload.action)) {
		return payload;
	}

	const revision = getLocalFeatureRevision(payload.public_id);
	return revision === null || revision === undefined ? payload : { ...payload, expected_revision: revision };
}

// Heisst der Fehler „diese Sperre gibt es fuer uns nicht mehr"? Dann darf der Wecker nicht weiter
// schlagen: das Objekt ist geloescht (400, „nicht gefunden") oder jemand anders haelt es (409).
// ⚠️ Ein Netzfehler ist KEIN Verlust -- der naechste Tick darf es wieder versuchen.
function avesmapsFeatureLockIstVerloren(error) {
	const text = String((error && error.message) || "");
	return /nicht gefunden|wird gerade von/i.test(text);
}

async function acquireFeatureSoftLock(publicId) {
	if (!IS_EDIT_MODE || !isSqlMapFeatureId(publicId) || activeFeatureLocks.has(publicId)) {
		return;
	}

	// 🔴 DER PLATZHALTER STEHT VOR DEM AWAIT. Bis 03.09.2026 kam der Eintrag erst nach der Antwort;
	// ein releaseFeatureSoftLock waehrend der Anfrage fand nichts, gab auf, und der 45-s-Wecker
	// lief danach fuer immer -- jeder Tick ein POST mit zwei CREATE TABLE IF NOT EXISTS. Live
	// bestaetigt; der Owner sah den Effekt am 26.08.2026 an einem geloeschten Label.
	activeFeatureLocks.set(publicId, null);
	try {
		await submitMapFeatureEdit({ action: "acquire_lock", public_id: publicId });
	} catch (error) {
		activeFeatureLocks.delete(publicId);
		showFeedbackToast(error.message || "Dieses Objekt ist gerade gesperrt.", "warning");
		throw error;
	}
	// Waehrend der Anfrage freigegeben: kein Wecker, aber die Serversperre wieder loesen --
	// die Antwort hat sie gerade angelegt.
	if (!activeFeatureLocks.has(publicId)) {
		void submitMapFeatureEdit({ action: "release_lock", public_id: publicId }).catch(() => {});
		return;
	}
	const refreshTimerId = window.setInterval(() => {
		void submitMapFeatureEdit({ action: "acquire_lock", public_id: publicId }).catch((error) => {
			console.warn("Feature-Lock konnte nicht erneuert werden:", error);
			if (avesmapsFeatureLockIstVerloren(error)) {
				window.clearInterval(refreshTimerId);
				activeFeatureLocks.delete(publicId);
			}
		});
	}, 45000);
	activeFeatureLocks.set(publicId, refreshTimerId);
}

async function releaseFeatureSoftLock(publicId) {
	if (!isSqlMapFeatureId(publicId) || !activeFeatureLocks.has(publicId)) {
		return;
	}

	const timerId = activeFeatureLocks.get(publicId);
	activeFeatureLocks.delete(publicId);
	// Platzhalter: die Anfrage laeuft noch, acquireFeatureSoftLock loest die Serversperre selbst.
	if (timerId === null) {
		return;
	}
	window.clearInterval(timerId);
	try {
		await submitMapFeatureEdit({ action: "release_lock", public_id: publicId });
	} catch (error) {
		console.warn("Feature-Lock konnte nicht freigegeben werden:", error);
	}
}

