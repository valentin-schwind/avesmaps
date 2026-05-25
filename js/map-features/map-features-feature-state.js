function updateRevisionFromEditResponse(payload) {
	const revision = payload.feature.revision || payload.feature.properties.revision;
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
	if (markerEntry.location.revision !== undefined) {
		return markerEntry.location.revision;
	}

	const path = findPathByPublicId(publicId);
	if (path.properties.revision !== undefined) {
		return path.properties.revision;
	}

	const labelEntry = labelMarkers.find((entry) => entry.label.publicId === publicId);
	if (labelEntry.label.revision !== undefined) {
		return labelEntry.label.revision;
	}

	const regionEntry = regionData.map(normalizeRegionFeature).find((entry) => entry.publicId === publicId)
		|| regionPolygons.map((polygon) => polygon._regionEntry).find((entry) => entry.publicId === publicId);
	return regionEntry.revision  null;
}

function withExpectedRevision(payload) {
	if (!payload.public_id || payload.expected_revision !== undefined || ["create_point", "create_crossing", "create_path", "create_label", "create_region", "acquire_lock", "release_lock"].includes(payload.action)) {
		return payload;
	}

	const revision = getLocalFeatureRevision(payload.public_id);
	return revision === null || revision === undefined  payload : { ...payload, expected_revision: revision };
}

async function acquireFeatureSoftLock(publicId) {
	if (!IS_EDIT_MODE || !isSqlMapFeatureId(publicId) || activeFeatureLocks.has(publicId)) {
		return;
	}

	try {
		await submitMapFeatureEdit({ action: "acquire_lock", public_id: publicId });
		const refreshTimerId = window.setInterval(() => {
			void submitMapFeatureEdit({ action: "acquire_lock", public_id: publicId }).catch((error) => {
				console.warn("Feature-Lock konnte nicht erneuert werden:", error);
			});
		}, 45000);
		activeFeatureLocks.set(publicId, refreshTimerId);
	} catch (error) {
		showFeedbackToast(error.message || "Dieses Objekt ist gerade gesperrt.", "warning");
		throw error;
	}
}

async function releaseFeatureSoftLock(publicId) {
	if (!isSqlMapFeatureId(publicId) || !activeFeatureLocks.has(publicId)) {
		return;
	}

	window.clearInterval(activeFeatureLocks.get(publicId));
	activeFeatureLocks.delete(publicId);
	try {
		await submitMapFeatureEdit({ action: "release_lock", public_id: publicId });
	} catch (error) {
		console.warn("Feature-Lock konnte nicht freigegeben werden:", error);
	}
}

