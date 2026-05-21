/******************************************************************
 * PriorityQueue (Min-Heap) - Optimierung fuer den Dijkstra-Algorithmus
 ******************************************************************/
class PriorityQueue {
	constructor() {
		this.heap = [];
	}

	enqueue(item, priority) {
		const node = { item, priority };
		this.heap.push(node);
		this._bubbleUp();
	}

	_bubbleUp() {
		let idx = this.heap.length - 1;
		const node = this.heap[idx];
		while (idx > 0) {
			const parentIdx = Math.floor((idx - 1) / 2);
			if (this.heap[parentIdx].priority <= node.priority) break;
			this.heap[idx] = this.heap[parentIdx];
			idx = parentIdx;
		}
		this.heap[idx] = node;
	}

	dequeue() {
		if (this.isEmpty()) return null;
		const min = this.heap[0];
		const lastNode = this.heap.pop();
		if (this.heap.length > 0) {
			this.heap[0] = lastNode;
			this._sinkDown(0);
		}
		return min;
	}

	_sinkDown(idx) {
		const length = this.heap.length;
		const node = this.heap[idx];
		while (true) {
			const leftIdx = 2 * idx + 1,
				rightIdx = 2 * idx + 2;
			let swapIdx = null;
			if (leftIdx < length && this.heap[leftIdx].priority < node.priority) {
				swapIdx = leftIdx;
			}
			if (
				rightIdx < length &&
				((swapIdx === null && this.heap[rightIdx].priority < node.priority) || (swapIdx !== null && this.heap[rightIdx].priority < this.heap[leftIdx].priority))
			) {
				swapIdx = rightIdx;
			}
			if (swapIdx === null) break;
			this.heap[idx] = this.heap[swapIdx];
			idx = swapIdx;
		}
		this.heap[idx] = node;
	}

	isEmpty() {
		return this.heap.length === 0;
	}
}

(function initReviewEditorTabMemory() {
	if (new URLSearchParams(window.location.search).get("edit") !== "1") return;

	const MAIN_KEY = "avesmaps.review.activeTab";
	const WIKI_KEY = "avesmaps.review.wikiSync.activeTab";

	function setActive(tabSelector, panelSelector, attributeName, value) {
		const normalizedValue = String(value || "").trim();
		if (!normalizedValue) return false;
		const tab = document.querySelector(`${tabSelector}[${attributeName}="${CSS.escape(normalizedValue)}"]`);
		const panel = document.querySelector(`${panelSelector}[${attributeName.replace("tab", "section")}="${CSS.escape(normalizedValue)}"]`);
		if (!tab || !panel) return false;
		document.querySelectorAll(tabSelector).forEach((element) => element.classList.toggle("is-active", element === tab));
		document.querySelectorAll(panelSelector).forEach((element) => element.classList.toggle("is-active", element === panel));
		return true;
	}

	function rememberClicks(tabSelector, storageKey, dataAttribute) {
		document.querySelectorAll(tabSelector).forEach((tab) => {
			tab.addEventListener("click", () => {
				const value = tab.getAttribute(dataAttribute) || "";
				if (value) localStorage.setItem(storageKey, value);
			});
		});
	}

	function restore() {
		const mainTab = localStorage.getItem(MAIN_KEY) || "";
		const wikiTab = localStorage.getItem(WIKI_KEY) || "";
		setActive(".review-panel__tab", ".review-panel__section", "data-editor-panel-tab", mainTab);
		setActive(".wiki-sync-panel__tab", ".wiki-sync-panel__tab-panel", "data-wiki-sync-panel-tab", wikiTab);
		rememberClicks(".review-panel__tab", MAIN_KEY, "data-editor-panel-tab");
		rememberClicks(".wiki-sync-panel__tab", WIKI_KEY, "data-wiki-sync-panel-tab");
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", restore, { once: true });
	else restore();
})();

(function initWikiSyncTerritoryTreeBridge() {
	if (new URLSearchParams(window.location.search).get("edit") !== "1") return;

	async function loadRows() {
		const response = await fetch("api/political-territory-wiki.php", { cache: "no-store", headers: { Accept: "application/json" } });
		const payload = await response.json();
		return payload && payload.ok && Array.isArray(payload.items) ? payload.items : [];
	}

	function normalize(value) {
		return String(value ?? "").replace(/\s+/g, " ").trim();
	}

	function filterRows(rows) {
		const input = document.getElementById("wiki-sync-territory-filter");
		const query = normalize(input?.value || "").toLowerCase();
		if (!query) return rows;
		return rows.filter((row) => [row.name, row.type, row.status, row.affiliation_raw, row.affiliation_root, row.wiki_url].map((value) => normalize(value).toLowerCase()).join(" ").includes(query));
	}

	function render(rows) {
		const container = document.getElementById("wiki-sync-territory-tree");
		const summary = document.getElementById("wiki-sync-territories-summary");
		const treeModule = window.AvesmapsPoliticalTerritoryWikiTree;
		if (!container || !treeModule || typeof treeModule.buildTree !== "function" || typeof treeModule.renderTree !== "function") return;
		const visibleRows = filterRows(rows);
		const tree = treeModule.buildTree(visibleRows);
		treeModule.renderTree({ container, root: tree.root, rowCount: visibleRows.length, totalRowCount: rows.length, searchText: document.getElementById("wiki-sync-territory-filter")?.value || "", infoElement: summary, enableDrag: true });
	}

	function bind(rows) {
		const container = document.getElementById("wiki-sync-territory-tree");
		if (!container || container.dataset.territoryBridgeBound === "1") return;
		container.dataset.territoryBridgeBound = "1";
		document.getElementById("wiki-sync-territory-filter")?.addEventListener("input", () => render(rows));
		document.getElementById("wiki-sync-territories")?.addEventListener("click", () => render(rows));
		render(rows);
	}

	function init() {
		loadRows().then((rows) => {
			window.wikiSyncTerritoryTreeRowsCache = rows;
			bind(rows);
		}).catch((error) => console.warn("Herrschaftsgebiete konnten nicht geladen werden:", error));
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
	else init();
})();
