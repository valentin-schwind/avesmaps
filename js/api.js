async function readJsonResponse(response, fallback = null) {
	try {
		return await response.json();
	} catch (error) {
		return fallback;
	}
}

async function fetchWithRetry(url, options = {}, retryOptions = {}) {
	const retries = Number.isInteger(retryOptions.retries) ? retryOptions.retries : 1;
	const delayMs = Number.isFinite(retryOptions.delayMs) ? retryOptions.delayMs : 350;
	const retryMethods = new Set(retryOptions.retryMethods || ["GET"]);
	const method = String(options.method || "GET").toUpperCase();

	let lastError = null;

	for (let attempt = 0; attempt <= retries; attempt += 1) {
		try {
			return await fetch(url, options);
		} catch (error) {
			lastError = error;

			if (!retryMethods.has(method) || attempt >= retries) {
				throw error;
			}

			await new Promise(resolve => window.setTimeout(resolve, delayMs * (attempt + 1)));
		}
	}

	throw lastError;
}

async function submitLocationReportRequest(payload) {
	const abortController = new AbortController();
	const timeoutId = window.setTimeout(() => abortController.abort(), LOCATION_REPORT_REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(LOCATION_REPORT_FORM_ENDPOINT_URL, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
			signal: abortController.signal,
		});
		const responsePayload = await readJsonResponse(response);

		if (!response.ok) {
			return {
				ok: false,
				message: responsePayload?.error || "Die Meldung konnte nicht gespeichert werden.",
			};
		}

		if (!responsePayload || responsePayload.ok !== true) {
			return {
				ok: false,
				message: responsePayload?.error || "Die Meldung konnte nicht verarbeitet werden.",
			};
		}

		return {
			ok: true,
			message: responsePayload.message || "Karteneintrag wurde gemeldet.",
		};
	} catch (error) {
		if (error?.name === "AbortError") {
			return {
				ok: false,
				message: "Der Avesmaps-Server hat zu lange nicht geantwortet.",
			};
		}

		console.error("Meldung konnte nicht gesendet werden:", error, LOCATION_REPORT_FORM_ENDPOINT_URL);
		return {
			ok: false,
			message: "Die Meldung konnte nicht an den Avesmaps-Server gesendet werden.",
		};
	} finally {
		window.clearTimeout(timeoutId);
	}
}

async function submitMapFeatureEdit(payload) {
	const requestPayload = withExpectedRevision(payload);
	const response = await fetch(MAP_FEATURE_UPDATE_API_URL, {
		method: "PATCH",
		credentials: "same-origin",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify(requestPayload),
	});
	const result = await readJsonResponse(response, {});

	if (!response.ok || result?.ok !== true) {
		if (response.status === 409) {
			void pollLiveMapUpdates();
		}
		throw new Error(result?.error || `Speichern fehlgeschlagen (${response.status}).`);
	}

	return result;
}

async function fetchPoliticalTerritories(params = {}) {
	if (!POLITICAL_TERRITORIES_API_URL) {
		throw new Error("Keine Herrschaftsgebiet-API fuer diese Umgebung konfiguriert.");
	}

	const url = new URL(POLITICAL_TERRITORIES_API_URL, window.location.href);
	url.searchParams.set("_", String(Date.now()));
	Object.entries(params).forEach(([key, value]) => {
		if (value !== undefined && value !== null && value !== "") {
			url.searchParams.set(key, String(value));
		}
	});

	const response = await fetchWithRetry(url.toString(), {
		cache: "no-store",
		credentials: "same-origin",
		headers: {
			Accept: "application/json",
			"Cache-Control": "no-cache",
			Pragma: "no-cache",
		},
	}, {
		retries: 2,
		delayMs: 300,
		retryMethods: ["GET"],
	});
	
	const data = await readJsonResponse(response, {});
	if (!response.ok || data?.ok !== true) {
		throw new Error(data?.error || `Herrschaftsgebiet-API antwortet mit HTTP ${response.status}.`);
	}

	return data;
}

async function submitPoliticalTerritoryEdit(payload) {
	let response = null;

	try {
		response = await fetch(POLITICAL_TERRITORIES_API_URL, {
			method: "PATCH",
			credentials: "same-origin",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});
	} catch (error) {
		console.error("Herrschaftsgebiet-API Netzwerkfehler:", {
			action: payload?.action || "",
			error,
		});

		throw new Error("Die Herrschaftsgebiet-API hat die Verbindung unterbrochen. Die Änderung wurde möglicherweise trotzdem gespeichert.");
	}

	const data = await readJsonResponse(response, {});
	if (!response.ok || data?.ok !== true) {
		console.error("Herrschaftsgebiet-API Fehler:", {
			status: response.status,
			action: payload?.action || "",
			error: data?.error || "",
			response: data,
		});
		throw new Error(data?.error || `Herrschaftsgebiet-API antwortet mit HTTP ${response.status}.`);
	}

	return data;
}

async function undoMapAuditChange(changeId) {
	return submitMapFeatureEdit({
		action: "undo_audit_change",
		audit_id: changeId,
	});
}

async function fetchPoliticalChangeLog() {
	return fetchPoliticalTerritories({
		action: "change_log",
	});
}

async function undoPoliticalAuditChange(changeId) {
	return submitPoliticalTerritoryEdit({
		action: "undo_audit_change",
		audit_id: changeId,
	});
}

async function updateReviewReportStatus(reportId, status, reportSource = "location_reports") {
	const response = await fetch(LOCATION_REPORT_REVIEW_API_URL, {
		method: "POST",
		credentials: "same-origin",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({
			action: "update_status",
			report_id: reportId,
			report_source: reportSource,
			status,
		}),
	});
	const data = await readJsonResponse(response);

	if (!response.ok || !data?.ok) {
		throw new Error(data?.error || `Review-API antwortet mit HTTP ${response.status}.`);
	}
}

async function submitWikiSyncAction(action, payload = {}) {
	const response = await fetch(WIKI_SYNC_API_URL, {
		method: "POST",
		credentials: "same-origin",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({
			action,
			...payload,
		}),
	});
	const data = await readJsonResponse(response, {});

	if (!response.ok || data?.ok !== true) {
		if (response.status === 409) {
			void pollLiveMapUpdates();
		}
		throw new Error(data?.error || `WikiSync-API antwortet mit HTTP ${response.status}.`);
	}

	return data;
}

async function fetchWikiSyncData(params = {}) {
	const url = new URL(WIKI_SYNC_API_URL, window.location.href);
	Object.entries(params).forEach(([key, value]) => {
		if (value !== undefined && value !== null && value !== "") {
			url.searchParams.set(key, String(value));
		}
	});
	url.searchParams.set("_", String(Date.now()));

	const response = await fetch(url.toString(), {
		cache: "no-store",
		credentials: "same-origin",
		headers: {
			Accept: "application/json",
			"Cache-Control": "no-cache",
			Pragma: "no-cache",
		},
	});
	const data = await readJsonResponse(response, {});

	if (!response.ok || data?.ok !== true) {
		throw new Error(data?.error || `WikiSync-API antwortet mit HTTP ${response.status}.`);
	}

	return data;
}
