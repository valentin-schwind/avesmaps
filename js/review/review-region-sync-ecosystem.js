// Der Landschaftsteil der Liste „WikiSync → Regionen" (Plan V6): welche Landschaftsflächen hängen an
// welcher Wiki-Region, und das Zuweisen selbst.
//
// Kept OUT of review-region-sync.js because that file already carries 457 lines and ONE data source
// (regions.php?action=match). This half has its own source (api/edit/map/ecosystem.php, action
// regions_by_wiki_key) and its own state; in one file two load paths would compete over the same render
// functions.
//
// 🔴 Zuweisen heisst: wiki_url auf ecosystem_region setzen. Der Schluessel wird SERVERSEITIG daraus
// abgeleitet -- der Client schickt nie einen. Mehrere Landschaftsregionen duerfen denselben Schluessel
// tragen; genau so entsteht „eine Wiki-Region auf mehrere Flaechen". Es wird nichts verschmolzen, nichts
// verschoben und nichts geloescht.
//
// 🔴 Keine politische Datei wird aufgerufen (Hauptplan, Regel 1).

// wiki_key -> [{public_id, name, kind, region_type, area_count}]. null = noch nie geladen.
let ecosystemRegionsByWikiKey = null;
let ecosystemAreaCountByWikiKey = null;
let ecosystemUnassignedRegionCount = 0;

// Ob der Landschaften-Endpunkt auf diesem Host ueberhaupt erreichbar ist. Ohne ihn bleibt die Liste
// vollstaendig benutzbar -- sie war es vor V6 auch --, nur ohne Flaechenspalte und ohne Zuweisen-Knopf.
function isEcosystemAssignAvailable() {
	return typeof postEcosystemEdit === "function" && Boolean(typeof ECOSYSTEM_EDIT_API_URL !== "undefined" && ECOSYSTEM_EDIT_API_URL);
}

async function loadEcosystemRegionsByWikiKey() {
	if (!isEcosystemAssignAvailable()) {
		ecosystemRegionsByWikiKey = {};
		ecosystemAreaCountByWikiKey = {};
		ecosystemUnassignedRegionCount = 0;
		return;
	}

	try {
		const data = await postEcosystemEdit("regions_by_wiki_key");
		ecosystemRegionsByWikiKey = data.regions_by_wiki_key || {};
		ecosystemAreaCountByWikiKey = data.area_count_by_wiki_key || {};
		ecosystemUnassignedRegionCount = Number(data.unassigned_count || 0);
	} catch (error) {
		// Eine fehlende Landschaftsebene darf die Regionenliste nicht kaputt machen. Leer statt „nie
		// geladen": sonst haenge die Zeile auf einem Ladezustand fest, den nichts mehr aufloest.
		ecosystemRegionsByWikiKey = {};
		ecosystemAreaCountByWikiKey = {};
		ecosystemUnassignedRegionCount = 0;
		console.warn("Landschaftsflächen konnten nicht geladen werden:", error);
	}
}

function ecosystemRegionsForWikiKey(wikiKey) {
	const key = String(wikiKey || "").trim();
	if (!key || !ecosystemRegionsByWikiKey) {
		return [];
	}
	return ecosystemRegionsByWikiKey[key] || [];
}

// Die „Fläche(n): …"-Zeile. Ein Chip je Landschaftsregion, ihre Flaechenzahl darin, dahinter der
// Zuweisen-Knopf. Der Knopf steht auch auf Zeilen OHNE Flaeche -- dort ist er der ganze Zweck.
function ecosystemAreaBadgeForWikiKey(wikiKey) {
	const key = String(wikiKey || "").trim();
	// Ohne wiki_key gibt es nichts zu verknuepfen: solche Zeilen sind Karten-Labels ohne Wiki-Eintrag
	// (regionMapOnlyRows), und ein Zuweisen-Knopf ohne Ziel waere eine Sackgasse.
	if (!key || !isEcosystemAssignAvailable()) {
		return "";
	}

	const regions = ecosystemRegionsForWikiKey(key);
	const chips = regions
		.map((region) => {
			const name = regionSyncEscapeText(region.name);
			const count = Number(region.area_count || 0);
			const countText = count === 1 ? "1 Fläche" : `${count} Flächen`;
			return `<span class="region-sync__areachip" title="${regionSyncEscapeAttr(`${region.name} — ${countText}`)}">${name}${count > 1 ? ` ×${count}` : ""}</span>`;
		})
		.join("");
	const body = chips || '<span class="region-sync__areas--none">—</span>';
	const assign = `<button type="button" class="region-sync__assign" data-assign-wiki-key="${regionSyncEscapeAttr(key)}" title="Landschaftsflächen mit dieser Wiki-Region verknüpfen">Fläche zuweisen</button>`;

	return `<span class="region-sync__areas">Fläche(n): ${body} ${assign}</span>`;
}
