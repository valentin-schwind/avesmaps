function populateRegionParentSelect(region) {
	const inputElement = document.getElementById("region-edit-parent");
	const treeElement = document.getElementById("region-edit-parent-tree");
	if (!inputElement || !treeElement) {
		return;
	}

	inputElement.value = region.parentPublicId || "";
	treeElement.innerHTML = "";
	const hasTreeData = (Array.isArray(politicalTerritoryHierarchy) && politicalTerritoryHierarchy.length > 0)
		|| (Array.isArray(politicalTerritoryOptions) && politicalTerritoryOptions.length > 0);
	if (politicalTerritoryOptionsLoading && politicalTerritoryOptionsSource !== "wiki" && !hasTreeData) {
		const loadingElement = document.createElement("p");
		loadingElement.className = "political-territory-parent-tree__empty";
		loadingElement.textContent = "Hierarchie wird geladen...";
		treeElement.append(loadingElement);
		return;
	}

	const tree = buildPoliticalTerritoryTree(region.territoryPublicId || "");
	tree.forEach((node) => {
		const renderedNode = renderPoliticalTerritoryTreeNode(node, region, 0);
		if (renderedNode) {
			treeElement.append(renderedNode);
		}
	});
	if (treeElement.childElementCount === 0) {
		const emptyElement = document.createElement("p");
		emptyElement.className = "political-territory-parent-tree__empty";
		emptyElement.textContent = regionParentFilterQuery !== "" ? "Keine Treffer" : "Keine Hierarchie geladen";
		treeElement.append(emptyElement);
	}
}

function buildPoliticalTerritoryTree(excludedPublicId) {
	if (Array.isArray(politicalTerritoryHierarchy) && politicalTerritoryHierarchy.length > 0) {
		const hierarchyTree = politicalTerritoryHierarchy
			.map((node) => clonePoliticalTerritoryHierarchyNode(node))
			.filter(Boolean);
		const dedupedTree = dedupePoliticalTerritoryTreeNodes(hierarchyTree);
		return prunePoliticalTerritoryTreeDuplicatesGlobally(dedupedTree);
	}

	const byId = new Map();
	politicalTerritoryOptions
		.forEach((territory) => {
			byId.set(territory.public_id, {
				key: `territory:${territory.public_id}`,
				territory,
				children: [],
				isGroup: false,
			});
		});

	const territoryRoots = [];
	byId.forEach((node) => {
		const parentId = node.territory.parent_public_id || "";
		const parent = byId.get(parentId);
		if (parent) {
			parent.children.push(node);
			return;
		}

		territoryRoots.push(node);
	});

	const sortNodes = (nodes) => {
		nodes.sort((left, right) => String(left.territory.name || "").localeCompare(String(right.territory.name || ""), "de"));
		nodes.forEach((node) => sortNodes(node.children));
	};
	sortNodes(territoryRoots);
	return territoryRoots;
}

function prunePoliticalTerritoryTreeDuplicatesGlobally(nodes, seenKeys = new Set()) {
	const result = [];
	for (const node of Array.isArray(nodes) ? nodes : []) {
		if (!node || typeof node !== "object") {
			continue;
		}

		const territory = node.territory || {};
		const dedupeKey = [
			normalizeSearchText(territory.name || ""),
			normalizeSearchText(territory.valid_label || buildWikiReferencePeriod(territory)),
		].filter(Boolean).join("|");
		const key = dedupeKey || `id:${territory.public_id || node.key || ""}`;
		if (seenKeys.has(key)) {
			continue;
		}

		seenKeys.add(key);
		result.push({
			...node,
			children: prunePoliticalTerritoryTreeDuplicatesGlobally(node.children || [], seenKeys),
		});
	}

	return result;
}

function dedupePoliticalTerritoryTreeNodes(nodes) {
	const normalizedNodes = (Array.isArray(nodes) ? nodes : [])
		.map((node) => dedupePoliticalTerritoryTreeNode(node))
		.filter(Boolean);
	const nodesByKey = new Map();
	for (const node of normalizedNodes) {
		const dedupeKey = buildPoliticalTerritoryTreeDedupeKey(node?.territory);
		const existingNode = nodesByKey.get(dedupeKey);
		if (!existingNode) {
			nodesByKey.set(dedupeKey, node);
			continue;
		}

		const winningNode = scorePoliticalTerritoryTreeNode(node) > scorePoliticalTerritoryTreeNode(existingNode) ? node : existingNode;
		const losingNode = winningNode === node ? existingNode : node;
		winningNode.children = dedupePoliticalTerritoryTreeNodes([
			...(Array.isArray(winningNode.children) ? winningNode.children : []),
			...(Array.isArray(losingNode.children) ? losingNode.children : []),
		]);
		winningNode.territory = mergePoliticalTerritoryTreeDuplicateTerritory(winningNode.territory, losingNode.territory);
		winningNode.key = `territory:${winningNode.territory.public_id || winningNode.territory.name}`;
		nodesByKey.set(dedupeKey, winningNode);
	}

	return Array.from(nodesByKey.values()).sort((left, right) => {
		return String(left?.territory?.name || "").localeCompare(String(right?.territory?.name || ""), "de");
	});
}

function dedupePoliticalTerritoryTreeNode(node) {
	if (!node || typeof node !== "object") {
		return null;
	}

	return {
		...node,
		children: dedupePoliticalTerritoryTreeNodes(node.children || []),
	};
}

function buildPoliticalTerritoryTreeDedupeKey(territory) {
	const name = normalizeSearchText(territory?.name || "");
	const period = normalizeSearchText(territory?.valid_label || buildWikiReferencePeriod(territory));
	return [name, period].filter(Boolean).join("|");
}

function scorePoliticalTerritoryTreeNode(node) {
	if (!node || typeof node !== "object") {
		return Number.NEGATIVE_INFINITY;
	}

	const territory = node.territory || {};
	const directChildren = Array.isArray(node.children) ? node.children.length : 0;
	const filledFields = [
		territory.wiki_url,
		territory.wiki_name,
		territory.type,
		territory.status,
		territory.form_of_government,
		territory.coat_of_arms_url,
		territory.capital_name,
		territory.seat_name,
	].filter((value) => String(value || "").trim() !== "").length;
	return (directChildren * 100) + (filledFields * 10);
}

function mergePoliticalTerritoryTreeDuplicateTerritory(primaryTerritory, secondaryTerritory) {
	const primary = primaryTerritory || {};
	const secondary = secondaryTerritory || {};
	const mergedAliases = Array.from(new Set([
		...(Array.isArray(primary.aliases) ? primary.aliases : []),
		...(Array.isArray(secondary.aliases) ? secondary.aliases : []),
	]));
	return {
		...secondary,
		...primary,
		public_id: String(primary.public_id || secondary.public_id || ""),
		name: primary.name || secondary.name || "",
		short_name: primary.short_name || secondary.short_name || "",
		type: primary.type || secondary.type || "",
		status: primary.status || secondary.status || "",
		form_of_government: primary.form_of_government || secondary.form_of_government || "",
		valid_label: primary.valid_label || secondary.valid_label || "",
		parent_public_id: primary.parent_public_id || secondary.parent_public_id || "",
		parent_name: primary.parent_name || secondary.parent_name || "",
		wiki_name: primary.wiki_name || secondary.wiki_name || "",
		wiki_url: primary.wiki_url || secondary.wiki_url || "",
		coat_of_arms_url: primary.coat_of_arms_url || secondary.coat_of_arms_url || "",
		valid_label: primary.valid_label || secondary.valid_label || "",
		founded_text: primary.founded_text || secondary.founded_text || "",
		dissolved_text: primary.dissolved_text || secondary.dissolved_text || "",
		aliases: mergedAliases,
	};
}

function clonePoliticalTerritoryHierarchyNode(node) {
	if (!node || typeof node !== "object") {
		return null;
	}

	const isGroup = node.is_group === true || node.isGroup === true;
	const children = Array.isArray(node.children) ? node.children.map((child) => clonePoliticalTerritoryHierarchyNode(child)).filter(Boolean) : [];
	const territory = {
		public_id: node.public_id || "",
		name: node.name || "",
		short_name: node.short_name || "",
		type: node.type || "",
		status: node.status || "",
		form_of_government: node.form_of_government || "",
		valid_label: node.valid_label || "",
		parent_public_id: node.parent_public_id || "",
		parent_name: node.parent_name || "",
		wiki_name: node.wiki_name || "",
		wiki_affiliation_raw: node.wiki_affiliation_raw || "",
		wiki_affiliation_root: node.wiki_affiliation_root || "",
		wiki_url: node.wiki_url || "",
		capital_name: node.capital_name || "",
		seat_name: node.seat_name || "",
		ruler: node.ruler || "",
		founder: node.founder || "",
		language: node.language || "",
		currency: node.currency || "",
		trade_goods: node.trade_goods || "",
		population: node.population || "",
		founded_text: node.founded_text || "",
		dissolved_text: node.dissolved_text || "",
		coat_of_arms_url: node.coat_of_arms_url || "",
		aliases: Array.isArray(node.aliases) ? node.aliases : [],
	};
	const option = territory.public_id ? findPoliticalTerritoryOption(territory.public_id) : null;
	let mergedTerritory = option ? { ...option, ...territory } : territory;
	if (isGroup && !hasPoliticalTerritoryTreeDisplayDetails(mergedTerritory)) {
		const representative = findRepresentativePoliticalTerritoryNode({
			territory: mergedTerritory,
			children,
		});
		if (representative?.territory?.public_id) {
			mergedTerritory = mergePoliticalTerritoryTreeGroupNode(territory, representative.territory, option);
		}
	}
	return {
		key: `territory:${mergedTerritory.public_id || mergedTerritory.name}`,
		territory: mergedTerritory,
		children,
		isGroup,
	};
}

function hasPoliticalTerritoryTreeDisplayDetails(territory) {
	if (!territory || typeof territory !== "object") {
		return false;
	}

	return [
		territory.type,
		territory.status,
		territory.form_of_government,
		territory.valid_label || buildWikiReferencePeriod(territory),
		territory.wiki_name,
		territory.capital_name,
		territory.seat_name,
		territory.ruler,
		territory.founded_text,
		territory.dissolved_text,
	].some((value) => String(value || "").trim() !== "");
}

function mergePoliticalTerritoryTreeGroupNode(groupTerritory, representativeTerritory, option = null) {
	const mergedAliases = Array.from(new Set([
		...(Array.isArray(groupTerritory?.aliases) ? groupTerritory.aliases : []),
		...(Array.isArray(representativeTerritory?.aliases) ? representativeTerritory.aliases : []),
	]));

	return {
		...(option || {}),
		...(representativeTerritory || {}),
		...(groupTerritory || {}),
		public_id: String(groupTerritory?.public_id || representativeTerritory?.public_id || ""),
		name: groupTerritory?.name || representativeTerritory?.name || "",
		short_name: groupTerritory?.short_name || representativeTerritory?.short_name || "",
		type: groupTerritory?.type || representativeTerritory?.type || "",
		status: groupTerritory?.status || representativeTerritory?.status || "",
		form_of_government: groupTerritory?.form_of_government || representativeTerritory?.form_of_government || "",
		valid_label: groupTerritory?.valid_label || representativeTerritory?.valid_label || "",
		parent_public_id: groupTerritory?.parent_public_id || representativeTerritory?.parent_public_id || "",
		parent_name: groupTerritory?.parent_name || representativeTerritory?.parent_name || "",
		wiki_name: groupTerritory?.wiki_name || representativeTerritory?.wiki_name || representativeTerritory?.name || "",
		wiki_affiliation_raw: groupTerritory?.wiki_affiliation_raw || representativeTerritory?.wiki_affiliation_raw || "",
		wiki_affiliation_root: groupTerritory?.wiki_affiliation_root || representativeTerritory?.wiki_affiliation_root || "",
		wiki_url: groupTerritory?.wiki_url || representativeTerritory?.wiki_url || "",
		capital_name: groupTerritory?.capital_name || representativeTerritory?.capital_name || "",
		seat_name: groupTerritory?.seat_name || representativeTerritory?.seat_name || "",
		ruler: groupTerritory?.ruler || representativeTerritory?.ruler || "",
		founder: groupTerritory?.founder || representativeTerritory?.founder || "",
		language: groupTerritory?.language || representativeTerritory?.language || "",
		currency: groupTerritory?.currency || representativeTerritory?.currency || "",
		trade_goods: groupTerritory?.trade_goods || representativeTerritory?.trade_goods || "",
		population: groupTerritory?.population || representativeTerritory?.population || "",
		founded_text: groupTerritory?.founded_text || representativeTerritory?.founded_text || "",
		dissolved_text: groupTerritory?.dissolved_text || representativeTerritory?.dissolved_text || "",
		coat_of_arms_url: groupTerritory?.coat_of_arms_url || representativeTerritory?.coat_of_arms_url || "",
		aliases: mergedAliases,
	};
}

function findRepresentativePoliticalTerritoryNode(node) {
	if (!node || typeof node !== "object") {
		return null;
	}

	const rootName = normalizeSearchText(node.territory?.name || "");
	let bestNode = null;
	let bestScore = Number.NEGATIVE_INFINITY;
	let bestNameMatchScore = Number.NEGATIVE_INFINITY;

	const visit = (currentNode) => {
		if (!currentNode || typeof currentNode !== "object") {
			return 0;
		}

		let descendantCount = 0;
		for (const child of Array.isArray(currentNode.children) ? currentNode.children : []) {
			descendantCount += visit(child);
		}

		const territory = currentNode.territory || {};
		const publicId = String(territory.public_id || "").trim();
		if (publicId) {
			let nameMatchScore = 0;
			let score = descendantCount * 100;
			const aliases = [
				territory.name,
				territory.short_name,
				territory.wiki_name,
				...(Array.isArray(territory.aliases) ? territory.aliases : []),
			].map((value) => normalizeSearchText(value)).filter(Boolean);
			for (const alias of aliases) {
				if (!rootName || !alias) {
					continue;
				}
				if (alias === rootName) {
					nameMatchScore = 1000000;
					break;
				}
				if (alias.includes(rootName) || rootName.includes(alias)) {
					nameMatchScore = Math.max(nameMatchScore, 100000 - Math.abs(alias.length - rootName.length));
				}
			}
			score += nameMatchScore;

			if (nameMatchScore > bestNameMatchScore || (nameMatchScore === bestNameMatchScore && score > bestScore)) {
				bestNameMatchScore = nameMatchScore;
				bestScore = score;
				bestNode = currentNode;
			}
			descendantCount += 1;
		}

		return descendantCount;
	};

	visit(node);
	if (rootName && bestNameMatchScore <= 0) {
		return null;
	}
	return bestNode;
}

function renderPoliticalTerritoryTreeNode(node, region, depth) {
	if (!doesPoliticalTerritoryTreeNodeMatchFilter(node)) {
		return null;
	}

	const wrapper = document.createElement("div");
	wrapper.className = node.isGroup
		? "political-territory-parent-tree__node political-territory-parent-tree__node--group"
		: "political-territory-parent-tree__node";
	wrapper.style.setProperty("--territory-tree-depth", String(Math.min(depth, 8)));
	const hasChildren = node.children.length > 0;
	const button = createRegionParentTreeButton(node.territory, region, { isGroup: node.isGroup, hasChildren });
	if (hasChildren) {
		button.dataset.regionTreeToggle = node.key;
		const isNodeCollapsed = isPoliticalTerritoryTreeNodeCollapsed(node);
		button.classList.toggle("is-collapsed", isNodeCollapsed);
		button.setAttribute("aria-expanded", isNodeCollapsed ? "false" : "true");
	}
	wrapper.append(button);
	const isCollapsed = isPoliticalTerritoryTreeNodeCollapsed(node);
	if (node.children.length > 0 && depth < 12 && !isCollapsed) {
		const childrenElement = document.createElement("div");
		childrenElement.className = "political-territory-parent-tree__children";
		node.children.forEach((child) => {
			const renderedChild = renderPoliticalTerritoryTreeNode(child, region, depth + 1);
			if (renderedChild) {
				childrenElement.append(renderedChild);
			}
		});
		if (childrenElement.childElementCount > 0) {
			wrapper.append(childrenElement);
		}
	}

	return wrapper;
}

function isPoliticalTerritoryTreeNodeCollapsed(node) {
	return regionParentFilterQuery === "" && node.children.length > 0 && !regionParentCollapsedKeys.has(node.key);
}

function doesPoliticalTerritoryTreeNodeMatchFilter(node) {
	const query = normalizeSearchText(regionParentFilterQuery);
	if (query === "") {
		return true;
	}

	return getPoliticalTerritoryTreeSearchText(node.territory).includes(query)
		|| node.children.some((child) => doesPoliticalTerritoryTreeNodeMatchFilter(child));
}

function getPoliticalTerritoryTreeSearchText(territory) {
	return normalizeSearchText([
		territory.name,
		territory.short_name,
		territory.type,
		territory.status,
		territory.form_of_government,
		territory.valid_label,
		territory.wiki_name,
		territory.wiki_affiliation_root,
		territory.wiki_affiliation_raw,
		territory.parent_name,
		territory.capital_name,
		territory.seat_name,
		territory.ruler,
		...(Array.isArray(territory.aliases) ? territory.aliases : []),
	].filter(Boolean).join(" "));
}

function createRegionParentTreeButton(territory, region, { isGroup = false, hasChildren = false } = {}) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "political-territory-parent-tree__item";
	button.dataset.regionParentId = territory.public_id || "";
	button.dataset.regionTerritoryId = territory.public_id || "";
	button.setAttribute("role", "treeitem");
	if (isGroup) {
		button.dataset.regionTreeGroup = "1";
	}
	button.dataset.regionTreeLeaf = hasChildren ? "0" : "1";
	button.draggable = Boolean(territory.public_id) && !hasChildren;
	button.classList.toggle("is-selected", Boolean(territory.public_id) && territory.public_id === regionParentSelectedTreeId);
	button.innerHTML = `
		<span class="political-territory-parent-tree__toggle" aria-hidden="true"></span>
		<span class="political-territory-parent-tree__name"></span>
		<span class="political-territory-parent-tree__meta"></span>
		<span class="political-territory-parent-tree__summary"></span>
		<span class="political-territory-parent-tree__wiki"></span>
	`;
	button.querySelector(".political-territory-parent-tree__name").textContent = formatPoliticalTerritoryTreeDisplayName(territory);
	button.querySelector(".political-territory-parent-tree__meta").textContent = normalizeParentheticalSpacing([
		territory.type,
		territory.status,
	].filter(Boolean).join(" · "));
	button.querySelector(".political-territory-parent-tree__summary").textContent = normalizeParentheticalSpacing([
		territory.valid_label,
		territory.capital_name ? `Hauptstadt: ${territory.capital_name}` : "",
		territory.ruler ? `Oberhaupt: ${territory.ruler}` : "",
	].filter(Boolean).join(" · "));
	button.querySelector(".political-territory-parent-tree__wiki").textContent = normalizeParentheticalSpacing([
		territory.wiki_name ? `Wiki: ${territory.wiki_name}` : "",
		territory.wiki_affiliation_root || territory.wiki_affiliation_raw || "",
		territory.wiki_url ? "Wiki" : "",
	].filter(Boolean).join(" · "));
	return button;
}


function formatPoliticalTerritoryDisplayBaseName(name) {
	let normalizedName = normalizeParentheticalSpacing(name || "");

	POLITICAL_TERRITORY_DISPLAY_SUFFIXES.forEach((suffix) => {
		const pattern = new RegExp(`\\s+\\(${escapeRegExp(suffix)}\\)\\s*$`, "iu");
		normalizedName = normalizedName.replace(pattern, "");
	});

	return normalizedName.trim();
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatPoliticalTerritoryTreeDisplayName(territory) {
	const baseName = formatPoliticalTerritoryDisplayBaseName(territory?.name || "Kein Parent");
	if (!territory || !territory.public_id || baseName === "Kein Parent") {
		return baseName;
	}

	const periodLabel = normalizeParentheticalSpacing(territory.valid_label || buildWikiReferencePeriod(territory));

	const normalizedNameKey = normalizeSearchText(baseName);
	if (normalizedNameKey === "") {
		return baseName;
	}

	const duplicates = (politicalTerritoryOptions || []).filter((candidate) => {
		if (!candidate || candidate.public_id === territory.public_id) {
			return false;
		}

		return normalizeSearchText(formatPoliticalTerritoryDisplayBaseName(candidate.name || "")) === normalizedNameKey;
	});

	if (duplicates.length < 1) {
		return periodLabel ? `${baseName} [${periodLabel}]` : baseName;
	}

	const disambiguator = normalizeParentheticalSpacing(territory.type || territory.wiki_name || territory.short_name || "");
	if (disambiguator !== "") {
		return periodLabel
			? `${baseName} (${disambiguator}) [${periodLabel}]`
			: `${baseName} (${disambiguator})`;
	}

	return periodLabel
		? `${baseName} (${String(territory.public_id).slice(0, 8)}) [${periodLabel}]`
		: `${baseName} (${String(territory.public_id).slice(0, 8)})`;
}

function renderRegionWikiReference(region) {
	const listElement = document.getElementById("region-edit-wiki-reference-list");
	if (!listElement) {
		return;
	}

	const wikiName = region.wikiName || region.wiki_name || region.name || "";
	const wikiUrl = region.wikiUrl || region.wiki_url || "";
	const rows = [
		["Name", wikiName],
		["Typ", region.wikiType || region.wiki_type || region.type],
		["Zeitraum", region.validLabel || region.valid_label || buildWikiReferencePeriod(region)],
		["Zugehoerigkeit", region.wikiAffiliationRaw || region.wiki_affiliation_raw || region.affiliation],
		["Wurzel", region.wikiAffiliationRoot || region.wiki_affiliation_root || region.affiliationRoot],
		["Hauptstadt", region.feature?.properties?.capital_name || region.wikiCapitalName || region.wiki_capital_name || ""],
		["Herrschaftssitz", region.feature?.properties?.seat_name || region.wikiSeatName || region.wiki_seat_name || ""],
		["Wiki", wikiUrl],
	].filter(([, value]) => String(value || "").trim() !== "");
	listElement.innerHTML = rows.map(([label, value]) => {
		const displayValue = normalizeParentheticalSpacing(value);
		const valueMarkup = label === "Wiki"
			? `<a href="${escapeHtml(displayValue)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayValue)}</a>`
			: escapeHtml(displayValue);
		return `<dt>${escapeHtml(label)}</dt><dd>${valueMarkup}</dd>`;
	}).join("");
}

function buildWikiReferencePeriod(region) {
	return [
		region.wikiFoundedText || region.wiki_founded_text || region.founded_text || "",
		region.wikiDissolvedText || region.wiki_dissolved_text || region.dissolved_text || "",
	]
		.filter(Boolean)
		.join(" - ");
}

function formatPoliticalTerritoryZoomRange(minZoom, maxZoom) {
	const parsedMin = Number.parseInt(String(minZoom ?? ""), 10);
	const parsedMax = Number.parseInt(String(maxZoom ?? ""), 10);
	const minValue = Number.isFinite(parsedMin) ? parsedMin : null;
	const maxValue = Number.isFinite(parsedMax) ? parsedMax : null;
	if (minValue === null && maxValue === null) {
		return "Zoom offen";
	}

	const minText = minValue === null ? "–" : String(minValue);
	const maxText = maxValue === null ? "–" : String(maxValue);
	return `Zoom ${minText}-${maxText}`;
}

function readOptionalPoliticalTerritoryZoomValue(value) {
	const text = String(value ?? "").trim();
	if (text === "") {
		return null;
	}

	const number = Number.parseInt(text, 10);
	if (!Number.isFinite(number)) {
		return null;
	}

	return Math.max(0, Math.min(6, number));
}

function normalizePoliticalTerritoryZoomDraft(minValue, maxValue, changedField = "") {
	let normalizedMin = readOptionalPoliticalTerritoryZoomValue(minValue);
	let normalizedMax = readOptionalPoliticalTerritoryZoomValue(maxValue);

	if (normalizedMin !== null && normalizedMax !== null && normalizedMin > normalizedMax) {
		if (changedField === "max") {
			normalizedMin = normalizedMax;
		} else {
			normalizedMax = normalizedMin;
		}
	}

	return {
		minNumber: normalizedMin,
		maxNumber: normalizedMax,
		minText: normalizedMin === null ? "" : String(normalizedMin),
		maxText: normalizedMax === null ? "" : String(normalizedMax),
	};
}

function clonePoliticalTerritoryPathNode(node) {
	return {
		territory: {
			...(node?.territory || {}),
		},
	};
}

function clonePoliticalTerritoryPath(path) {
	return Array.isArray(path) ? path.map((node) => clonePoliticalTerritoryPathNode(node)) : [];
}

function clonePoliticalTerritoryChain(chain) {
	return Array.isArray(chain)
		? chain.map((node) => ({
			...node,
			territory: node?.territory ? { ...node.territory } : node?.territory || null,
			wiki: node?.wiki ? { ...node.wiki } : node?.wiki || null,
		}))
		: [];
}
