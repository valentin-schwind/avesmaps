// Tolerant reader for the API error envelope. Endpoints are being migrated
// (M3) from a flat `error:"string"` to the gold-standard `error:{code,message}`.
// Reading the message through this helper keeps the frontend working with BOTH
// shapes, so the backend shape-flip never surfaces "[object Object]" to users.
function apiErrorMessage(data, fallback) {
	const error = data?.error;
	if (typeof error === "string") {
		return error || fallback;
	}
	return error?.message || fallback;
}

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
				message: apiErrorMessage(responsePayload, "Die Meldung konnte nicht gespeichert werden."),
			};
		}

		if (!responsePayload || responsePayload.ok !== true) {
			return {
				ok: false,
				message: apiErrorMessage(responsePayload, "Die Meldung konnte nicht verarbeitet werden."),
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
		throw new Error(apiErrorMessage(result, `Speichern fehlgeschlagen (${response.status}).`));
	}

	return result;
}

// Pan-invarianter Layer (haengt an zoom/year/edit, NICHT an bbox): pro Param-Signatur cachen UND
// laufende Anfragen teilen. Killt den moveend-Refetch-Sturm (cache:no-store bei jedem Pan), der
// sonst mehrere teure 1.2MB-Queries gleichzeitig auf die DB wirft und sie ueberlastet.
const POLITICAL_LAYER_CACHE = new Map(); // paramKey -> { ts, promise }
const POLITICAL_LAYER_CACHE_TTL_MS = 5000;

function buildPoliticalTerritoriesParamKey(params) {
	const parts = [];
	Object.keys(params).sort().forEach((key) => {
		if (key === "_") return;
		const value = params[key];
		if (value !== undefined && value !== null && value !== "") {
			parts.push(`${key}=${value}`);
		}
	});
	return parts.join("&");
}

// Nach einem Edit aufrufen, damit der naechste Layer-Load garantiert frisch ist (kein stale Cache).
function invalidatePoliticalLayerCache() {
	POLITICAL_LAYER_CACHE.clear();
}

async function fetchPoliticalTerritories(params = {}) {
	if (!POLITICAL_TERRITORIES_API_URL) {
		throw new Error("Keine Herrschaftsgebiet-API für diese Umgebung konfiguriert.");
	}

	const cacheable = params.action === "layer";
	const cacheKey = cacheable ? buildPoliticalTerritoriesParamKey(params) : "";
	if (cacheable) {
		const hit = POLITICAL_LAYER_CACHE.get(cacheKey);
		if (hit && (Date.now() - hit.ts) < POLITICAL_LAYER_CACHE_TTL_MS) {
			return hit.promise; // laufende ODER frische Antwort teilen -> kein erneuter DB-Query
		}
	}

	const requestPromise = (async () => {
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
			throw new Error(apiErrorMessage(data, `Herrschaftsgebiet-API antwortet mit HTTP ${response.status}.`));
		}

		return data;
	})();

	if (cacheable) {
		POLITICAL_LAYER_CACHE.set(cacheKey, { ts: Date.now(), promise: requestPromise });
		// Fehlschlag nicht cachen -> beim naechsten Mal neu versuchen.
		requestPromise.catch(() => {
			const current = POLITICAL_LAYER_CACHE.get(cacheKey);
			if (current && current.promise === requestPromise) {
				POLITICAL_LAYER_CACHE.delete(cacheKey);
			}
		});
	}

	return requestPromise;
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
			error: apiErrorMessage(data, ""),
			response: data,
		});
		throw new Error(apiErrorMessage(data, `Herrschaftsgebiet-API antwortet mit HTTP ${response.status}.`));
	}

	invalidatePoliticalLayerCache(); // Edit gespeichert -> Layer-Cache verwerfen, naechster Load ist frisch.
	return data;
}

async function syncPoliticalTerritoryDisplayStyles(territoryPublicId) {
	const normalizedTerritoryPublicId = String(territoryPublicId || "").trim();
	if (!normalizedTerritoryPublicId || !POLITICAL_TERRITORIES_API_URL) {
		return null;
	}

	const syncUrl = new URL("political-territory-display-sync.php", new URL(POLITICAL_TERRITORIES_API_URL, window.location.href));
	const response = await fetch(syncUrl.toString(), {
		method: "PATCH",
		credentials: "same-origin",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			territory_public_id: normalizedTerritoryPublicId,
		}),
	});
	const data = await readJsonResponse(response, {});

	if (!response.ok || data?.ok !== true) {
		console.warn("Herrschaftsgebiet-Anzeige konnte nicht synchronisiert werden:", {
			status: response.status,
			territoryPublicId: normalizedTerritoryPublicId,
			error: apiErrorMessage(data, ""),
			response: data,
		});
		return null;
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
		throw new Error(apiErrorMessage(data, `Review-API antwortet mit HTTP ${response.status}.`));
	}
}

async function submitWikiSyncLocationAction(action, payload = {}) {
	const response = await fetch(WIKI_SYNC_LOCATIONS_API_URL, {
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
		const debugInfo = data?.debug ? ` [${data.debug.message || ""} @ ${data.debug.file || ""}:${data.debug.line || ""}]` : "";
		throw new Error(apiErrorMessage(data, `WikiSyncLocations-API antwortet mit HTTP ${response.status}.`) + debugInfo);
	}

	return data;
}

// WikiDump control endpoint (api/edit/wiki/dump.php): start_read / read_step / apply /
// set_dump_credentials. Mirrors submitWikiSyncLocationAction. IMPORTANT: apiErrorMessage
// drops error.code, so the credential-prompt trigger reads data.error.code DIRECTLY and
// tags the thrown Error so the caller can open the inline cred-prompt instead of just
// surfacing the message (mirrors the 409 special-case above). NOTE: dump.php calls
// avesmapsRequireUserWithCapability('edit') BEFORE the action switch, so an expired
// editor session ALSO returns HTTP 401 (error.code "unauthenticated") -- that must NOT
// be confused with the true dump-fetch rejection (error.code "dump_unauthorized" from
// avesmapsWikiDumpEnsureDumpPresentOrFail / the fetch_dump branch). Status alone can't
// tell them apart; only the body's error.code can.
async function submitWikiSyncDumpAction(action, payload = {}) {
	const response = await fetch(WIKI_SYNC_DUMP_API_URL, {
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
		const error = new Error(apiErrorMessage(data, `WikiDump-API antwortet mit HTTP ${response.status}.`));
		// Only the true dump-fetch rejection opens the inline credential prompt (O1).
		// A generic session 401 ("unauthenticated", or no code at all) must fall through
		// to a normal error instead of wrongly asking for dump credentials.
		error.dumpUnauthorized = response.status === 401 && data?.error?.code === "dump_unauthorized";
		error.httpStatus = response.status;
		throw error;
	}

	return data;
}

async function fetchWikiSyncLocationData(params = {}) {
	const url = new URL(WIKI_SYNC_LOCATIONS_API_URL, window.location.href);
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
		throw new Error(apiErrorMessage(data, `WikiSyncLocations-API antwortet mit HTTP ${response.status}.`));
	}

	return data;
}

async function submitWikiSyncTerritoryAction(action, payload = {}) {
	const response = await fetch(WIKI_SYNC_TERRITORIES_API_URL, {
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
		throw new Error(apiErrorMessage(data, `WikiSyncTerritories-API antwortet mit HTTP ${response.status}.`));
	}

	return data;
}

async function fetchWikiSyncTerritoryData(params = {}) {
	const url = new URL(WIKI_SYNC_TERRITORIES_API_URL, window.location.href);
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
		throw new Error(apiErrorMessage(data, `WikiSyncTerritories-API antwortet mit HTTP ${response.status}.`));
	}

	return data;
}
