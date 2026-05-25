const regionAssignmentPersistedLoadPromises = new Map();

function normalizePoliticalTerritoryAssignmentState(chain) {
	const normalizedChain = clonePoliticalTerritoryChain(Array.isArray(chain) ? chain : []);
	if (normalizedChain.length < 1) {
		return {
			path: [],
			ensuredChain: [],
			activeTerritoryPublicId: "",
		};
	}

	const path = normalizedChain.map((node) => {
		const territory = node?.territory || {};
		const wiki = node?.wiki || {};
		const validLabel = territory.valid_label || territory.validLabel || wiki.valid_label || buildWikiReferencePeriod(wiki);
		return {
			territory: {
				...territory,
				name: normalizeParentheticalSpacing(wiki.name || territory.name || territory.displayName || "Herrschaftsgebiet"),
				type: normalizeParentheticalSpacing(wiki.type || territory.type || ""),
				status: wiki.status || territory.status || "",
				valid_label: validLabel,
				coat_of_arms_url: territory.coat_of_arms_url || territory.coatOfArmsUrl || wiki.coat_of_arms_url || "",
				wiki_url: territory.wiki_url || territory.wikiUrl || wiki.wiki_url || "",
			},
		};
	});

	const activeTerritoryPublicId = String(normalizedChain[normalizedChain.length - 1]?.territory?.public_id || "").trim();
	return {
		path,
		ensuredChain: normalizedChain,
		activeTerritoryPublicId,
	};
}

function applyPersistedRegionAssignmentChain(chain, activeTerritoryPublicId = "") {
	const normalizedState = normalizePoliticalTerritoryAssignmentState(chain);
	if (normalizedState.path.length < 1) {
		return false;
	}

	regionAssignmentWikiPath = normalizedState.path;
	regionAssignmentEnsuredChain = normalizedState.ensuredChain;
	regionAssignmentActiveWikiPublicId = String(activeTerritoryPublicId || normalizedState.activeTerritoryPublicId || "").trim();
	storeRegionAssignmentBreadcrumbCaches(regionAssignmentWikiPath, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
	return true;
}

async function loadPersistedRegionAssignment(territoryPublicId) {
	const normalizedPublicId = String(territoryPublicId || "").trim();
	if (!normalizedPublicId) {
		return false;
	}

	if (regionAssignmentPersistedLoadPromises.has(normalizedPublicId)) {
		return regionAssignmentPersistedLoadPromises.get(normalizedPublicId);
	}

	const request = (async () => {
		try {
			const response = await fetchPoliticalTerritories({
				action: "get",
				public_id: normalizedPublicId,
			});
			const assignmentChain = Array.isArray(response.assignment_chain) ? response.assignment_chain : [];
			if (assignmentChain.length < 1) {
				return false;
			}

			const activeTab = findRegionEditTab(normalizedPublicId);
			if (activeTab && !isRegionEditTabDirty(activeTab)) {
				const normalizedRegion = normalizePoliticalTerritoryForRegionEdit({
					...(response.territory || {}),
					assignment_chain: response.assignment_chain || [],
				}, response.wiki || null);
				activeTab.region = {
					...(activeTab.region || {}),
					...normalizedRegion,
				};
				activeTab.savedPayload = regionEditPayloadToPayload(activeTab.region);
				if (activeRegionEditTabKey === activeTab.key) {
					regionEditEntry = activeTab.region;
				}
			}

			const applied = applyPersistedRegionAssignmentChain(assignmentChain, normalizedPublicId);
			if (!applied) {
				return false;
			}

			const currentActiveTerritoryPublicId = String(regionEditEntry?.territoryPublicId || regionEditEntry?.publicId || "").trim();
			if (currentActiveTerritoryPublicId === normalizedPublicId) {
				renderRegionAssignment(regionAssignmentWikiPath, regionAssignmentEnsuredChain, regionAssignmentActiveWikiPublicId);
			}

			return true;
		} catch (error) {
			if (String(error?.message || "").includes("nicht gefunden")) {
				return false;
			}

			console.error("Gespeicherte Herrschaftsgebiets-Zuweisung konnte nicht geladen werden:", error);
			return false;
		}
	})().finally(() => {
		regionAssignmentPersistedLoadPromises.delete(normalizedPublicId);
	});

	regionAssignmentPersistedLoadPromises.set(normalizedPublicId, request);
	return request;
}

function storeRegionAssignmentBreadcrumbCache(territoryPublicId, path, ensuredChain = [], activeWikiPublicId = "") {
	const cacheKey = String(territoryPublicId || "").trim();
	if (!cacheKey) {
		return;
	}

	regionAssignmentBreadcrumbCache.set(cacheKey, {
		path: clonePoliticalTerritoryPath(path),
		ensuredChain: clonePoliticalTerritoryChain(ensuredChain),
		activeWikiPublicId: String(activeWikiPublicId || "").trim(),
	});
}

function storeRegionAssignmentBreadcrumbCaches(path, ensuredChain = [], activeWikiPublicId = "") {
	const normalizedPath = Array.isArray(path) ? path : [];
	if (normalizedPath.length < 1) {
		return;
	}

	const snapshotPath = clonePoliticalTerritoryPath(normalizedPath);
	const snapshotChain = clonePoliticalTerritoryChain(ensuredChain);
	const territoryIds = Array.from(new Set(normalizedPath
		.map((node) => String(node?.territory?.public_id || "").trim())
		.filter(Boolean)));
	territoryIds.forEach((territoryId) => {
		regionAssignmentBreadcrumbCache.set(territoryId, {
			path: snapshotPath,
			ensuredChain: snapshotChain,
			activeWikiPublicId: territoryId,
		});
	});

	const explicitActiveId = String(activeWikiPublicId || "").trim();
	if (explicitActiveId && !regionAssignmentBreadcrumbCache.has(explicitActiveId)) {
		regionAssignmentBreadcrumbCache.set(explicitActiveId, {
			path: snapshotPath,
			ensuredChain: snapshotChain,
			activeWikiPublicId: explicitActiveId,
		});
	}
}

function updateRegionAssignmentBreadcrumbChain(territoryPublicId, territory = null, wiki = null) {
	const cacheKey = String(territoryPublicId || "").trim();
	if (!cacheKey) {
		return;
	}

	const territoryPatch = territory && typeof territory === "object" ? { ...territory } : null;
	const wikiPatch = wiki && typeof wiki === "object" ? { ...wiki } : null;
	const patchChain = (chain) => chain.map((node) => {
		if (String(node?.territory?.public_id || "").trim() !== cacheKey) {
			return node;
		}

		return {
			...node,
			territory: territoryPatch
				? {
					...(node.territory || {}),
					...territoryPatch,
				}
				: node.territory,
			wiki: wikiPatch
				? {
					...(node.wiki || {}),
					...wikiPatch,
				}
				: node.wiki,
		};
	});

	if (Array.isArray(regionAssignmentEnsuredChain) && regionAssignmentEnsuredChain.length > 0) {
		regionAssignmentEnsuredChain = patchChain(regionAssignmentEnsuredChain);
	}

	regionAssignmentBreadcrumbCache.forEach((snapshot, snapshotKey) => {
		if (!snapshot || typeof snapshot !== "object") {
			return;
		}

		const snapshotChain = Array.isArray(snapshot.ensuredChain) ? snapshot.ensuredChain : [];
		const hasMatch = snapshotChain.some((node) => String(node?.territory?.public_id || "").trim() === cacheKey);
		if (!hasMatch && String(snapshotKey || "").trim() !== cacheKey) {
			return;
		}

		regionAssignmentBreadcrumbCache.set(snapshotKey, {
			...snapshot,
			ensuredChain: patchChain(snapshotChain),
		});
	});

	if (Array.isArray(regionAssignmentWikiPath) && regionAssignmentWikiPath.length > 0) {
		regionAssignmentWikiPath = regionAssignmentWikiPath.map((node) => {
			if (String(node?.territory?.public_id || "").trim() !== cacheKey) {
				return node;
			}

			return {
				...node,
				territory: territoryPatch
					? {
						...(node.territory || {}),
						...territoryPatch,
					}
					: node.territory,
			};
		});
	}
}

function restoreRegionAssignmentBreadcrumbCache(territoryPublicId) {
	const cacheKey = String(territoryPublicId || "").trim();
	if (!cacheKey || !regionAssignmentBreadcrumbCache.has(cacheKey)) {
		return false;
	}

	const snapshot = regionAssignmentBreadcrumbCache.get(cacheKey) || {};
	regionAssignmentWikiPath = clonePoliticalTerritoryPath(snapshot.path);
	regionAssignmentEnsuredChain = clonePoliticalTerritoryChain(snapshot.ensuredChain);
	const lastBreadcrumbNode = regionAssignmentWikiPath.length > 0 ? regionAssignmentWikiPath[regionAssignmentWikiPath.length - 1] : null;
	regionAssignmentActiveWikiPublicId = String(snapshot.activeWikiPublicId || lastBreadcrumbNode?.territory?.public_id || "").trim();
	return regionAssignmentWikiPath.length > 0;
}
