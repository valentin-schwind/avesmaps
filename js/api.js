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
		throw new Error(data?.error || `WikiSyncLocations-API antwortet mit HTTP ${response.status}.`);
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
		throw new Error(data?.error || `WikiSyncLocations-API antwortet mit HTTP ${response.status}.`);
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
		throw new Error(data?.error || `WikiSyncTerritories-API antwortet mit HTTP ${response.status}.`);
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
		throw new Error(data?.error || `WikiSyncTerritories-API antwortet mit HTTP ${response.status}.`);
	}

	return data;
}

(function installNoSyntheticPoliticalTerritoryWikiTreePatch() {
	function normalizeText(value) {
		return String(value ?? "")
			.replace(/\u00a0/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	function makeKey(value) {
		return normalizeText(value)
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/\u00df/g, "ss")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	}

	function rowKey(row) {
		return makeKey(row?.name || row?.wiki_key || row?.id || "");
	}

	function wikiTitleFromUrl(url) {
		const rawUrl = normalizeText(url);
		if (!rawUrl) {
			return "";
		}

		try {
			const parsed = new URL(rawUrl, window.location?.origin || "https://avesmaps.de");
			const marker = "/wiki/";
			const path = parsed.pathname || "";
			const markerIndex = path.indexOf(marker);
			if (markerIndex < 0) {
				return "";
			}

			return decodeURIComponent(path.slice(markerIndex + marker.length)).replace(/_/g, " ").trim();
		} catch (error) {
			return "";
		}
	}

	function rowIdentityKey(row) {
		if (!row || typeof row !== "object") {
			return "";
		}

		const wikiKey = makeKey(row.wiki_key || "");
		if (wikiKey !== "") {
			return `wiki_key:${wikiKey}`;
		}

		const wikiTitle = wikiTitleFromUrl(row.wiki_url || "");
		if (wikiTitle !== "") {
			return `wiki_title:${makeKey(wikiTitle)}|name:${makeKey(row.name || "")}|type:${makeKey(row.type || "")}`;
		}

		const nameKey = makeKey(row.name || "");
		const typeKey = makeKey(row.type || "");
		if (nameKey !== "") {
			return `name:${nameKey}|type:${typeKey}`;
		}

		const id = normalizeText(row.id);
		return id ? `id:${id}` : "";
	}

	function stripDisplaySuffix(name) {
		let normalizedName = normalizeText(name);
		for (const suffix of ["Staat", "Imperium", "Reich", "Kalifat"]) {
			const pattern = new RegExp(`\\s*\\(${suffix}\\)\\s*$`, "iu");
			normalizedName = normalizeText(normalizedName.replace(pattern, ""));
		}

		return normalizedName;
	}

	function rowAliases(row) {
		const aliases = new Set();
		const name = normalizeText(row?.name);
		if (name) {
			aliases.add(name);
			aliases.add(stripDisplaySuffix(name));
		}

		const title = wikiTitleFromUrl(row?.wiki_url || "");
		if (title) {
			aliases.add(title);
			aliases.add(stripDisplaySuffix(title));
		}

		const fixedAliases = {
			"Wiedererstandenes Reich des Horas": ["Horasreich"],
			"Heiliges Neues Kaiserreich vom Greifenthron zu Gareth": ["Mittelreich"],
			"Theaterritterliche Republik an Born und Walsach": ["Bornland"],
		};

		for (const alias of fixedAliases[name] || []) {
			aliases.add(alias);
		}

		return [...aliases].filter(Boolean);
	}

	function buildRowIndex(rows) {
		const index = new Map();
		for (const row of rows) {
			for (const alias of rowAliases(row)) {
				const key = makeKey(alias);
				if (key && !index.has(key)) {
					index.set(key, row);
				}
			}
		}

		return index;
	}

	function createTreeNode(id, label, kind, row = null) {
		return {
			id,
			label,
			kind,
			row,
			parent: null,
			children: [],
			childMap: new Map(),
		};
	}

	function rowMergeScore(row) {
		let score = 0;
		score += Number(row?.map_geometry_count || 0) * 100;
		score += Number(row?.map_territory_count || 0) * 20;
		for (const field of ["wiki_url", "wiki_key", "coat_of_arms_url", "founded_text", "dissolved_text", "type", "status", "affiliation_raw", "capital_name", "seat_name", "ruler"]) {
			if (normalizeText(row?.[field]) !== "") {
				score += 1;
			}
		}

		return score;
	}

	function mergeRowsByIdentity(primary, secondary) {
		const merged = rowMergeScore(secondary) > rowMergeScore(primary) ? { ...secondary } : { ...primary };
		const fallback = merged === primary ? secondary : primary;
		for (const key of Object.keys(fallback || {})) {
			if ((merged[key] === null || typeof merged[key] === "undefined" || merged[key] === "")
				&& fallback[key] !== null
				&& typeof fallback[key] !== "undefined"
				&& fallback[key] !== "") {
				merged[key] = fallback[key];
			}
		}

		merged.map_territory_count = Math.max(Number(merged.map_territory_count || 0), Number(fallback?.map_territory_count || 0));
		merged.map_geometry_count = Math.max(Number(merged.map_geometry_count || 0), Number(fallback?.map_geometry_count || 0));
		merged.map_assigned = Boolean(merged.map_assigned) || merged.map_geometry_count > 0;
		return merged;
	}

	function registerNode(node, nodeRegistry) {
		if (node.id !== "root") {
			nodeRegistry.set(node.id, node);
		}
		for (const child of node.children) {
			registerNode(child, nodeRegistry);
		}
	}

	function sortTree(node) {
		node.children.sort((left, right) => {
			const leftFolder = left.children.length > 0 ? 0 : 1;
			const rightFolder = right.children.length > 0 ? 0 : 1;
			if (leftFolder !== rightFolder) {
				return leftFolder - rightFolder;
			}
			return String(left.label || "").localeCompare(String(right.label || ""), "de");
		});
		for (const child of node.children) {
			sortTree(child);
		}
	}

	function attachChild(parent, node) {
		if (node.parent && node.parent !== parent) {
			node.parent.children = node.parent.children.filter((child) => child !== node);
		}

		node.parent = parent;
		if (!parent.children.includes(node)) {
			parent.children.push(node);
		}
		parent.childMap.set(node.id, node);
		if (node.row?.name) {
			parent.childMap.set(makeKey(node.row.name), node);
		}
	}

	function installPatch() {
		const treeModule = window.AvesmapsPoliticalTerritoryWikiTree;
		if (!treeModule || treeModule.__avesmapsNoSyntheticBuildTree === true) {
			return Boolean(treeModule?.__avesmapsNoSyntheticBuildTree);
		}

		treeModule.buildTree = function buildPoliticalTerritoryTreeWithoutSyntheticNodes(rows) {
			const normalizedRows = Array.isArray(rows) ? rows : [];
			const root = createTreeNode("root", "Herrschaftsgebiete", "root");
			const rowIndex = buildRowIndex(normalizedRows);
			const nodeByIdentity = new Map();

			for (const row of normalizedRows) {
				const identityKey = rowIdentityKey(row);
				if (!identityKey) {
					continue;
				}

				let current = root;
				for (const segment of Array.isArray(row.affiliation_path) ? row.affiliation_path : []) {
					const segmentKey = makeKey(segment);
					if (!segmentKey) {
						continue;
					}

					const matchingRow = rowIndex.get(segmentKey) || null;
					if (!matchingRow) {
						continue;
					}

					const matchingIdentityKey = rowIdentityKey(matchingRow);
					if (!matchingIdentityKey || matchingIdentityKey === identityKey) {
						continue;
					}

					let pathNode = nodeByIdentity.get(matchingIdentityKey) || null;
					if (!pathNode) {
						pathNode = createTreeNode(rowKey(matchingRow) || makeKey(matchingRow.name) || matchingIdentityKey, matchingRow.name || segment, "territory-group", matchingRow);
						nodeByIdentity.set(matchingIdentityKey, pathNode);
					}

					attachChild(current, pathNode);
					current = pathNode;
				}

				let ownNode = nodeByIdentity.get(identityKey) || null;
				if (!ownNode) {
					ownNode = createTreeNode(rowKey(row) || makeKey(row.name) || identityKey, row.name, "territory", row);
					nodeByIdentity.set(identityKey, ownNode);
				} else {
					ownNode.row = mergeRowsByIdentity(ownNode.row || row, row);
					ownNode.label = ownNode.label || row.name;
					ownNode.kind = ownNode.children.length > 0 ? "territory-group" : "territory";
				}

				attachChild(current, ownNode);
			}

			sortTree(root);
			const nodeRegistry = new Map();
			registerNode(root, nodeRegistry);
			return { root, nodeRegistry };
		};

		treeModule.__avesmapsNoSyntheticBuildTree = true;
		return true;
	}

	if (installPatch()) {
		return;
	}

	let attempts = 0;
	const timerId = window.setInterval(() => {
		attempts += 1;
		if (installPatch() || attempts > 120) {
			window.clearInterval(timerId);
		}
	}, 25);
})();
