/*
 * Landschaften (Erprobung) -- "Senden an ..." (plan V3.6): the same outline, once more, in one of the
 * other two layers.
 *
 * 🔴 A COPY, NEVER A LINK. The analysis calls taking over geometry "die wichtigste einzelne Funktion des
 * ganzen Editors" (§4.4), because ~266 of the 500 areas are twins: the Farindel is a wood in Vegetation
 * AND relief in Topographie, traced twice today. What comes out here is a NEW row with its OWN public_id
 * and its own geometry_revision. Moving a corner in the copy later must not move the source, and moving
 * the source must not move the copy -- that is the one thing that can really go wrong, so the geometry is
 * deep-cloned before it is sent rather than handed on by reference.
 *
 * 🔴 NO NEW SERVER ACTION. avesmapsCreateEcosystemArea (api/_internal/app/ecosystem.php:945-998) already
 * mints a fresh public_id from region_public_id + geometry_geojson. So the copy is create_region (or pick
 * an existing one) + create_area -- two actions that exist. There is deliberately no copy_area and no
 * copy_regions: the bulk run over a whole layer is the server-side job the plan puts AFTER the V4
 * measurement, and V3.6 is the single-handed version that measurement is supposed to price
 * (~15-18 s of menu per area).
 *
 * 🔴 is_trial IS NOT SENT. When the field is absent the server decides from app_setting['ecosystem_trial']
 * (:960-962 via :304-307) -- "a client that never heard of the trial cannot smuggle a permanent area into
 * a trial run or the other way round". A copy is a new area and gets whatever the run it is made in says.
 *
 * ONE ENTRY, ONE DIALOG. The area menu (V3.4) is flat and built in JS; the map menu's submenu is static
 * markup and not reusable. A submenu "Senden an > Topographie" would therefore be new mechanics AND still
 * need a dialog afterwards, because the target REGION has to be chosen either way (owner decision 1: a
 * region carries many areas). So the target layer moved into that same dialog and the submenu is gone.
 *
 * 🪤 region_type does NOT travel. `wald` is vegetation, never topography -- avesmapsEcosystemAssertRegionType
 * would answer 400. The Art select is filled from the TARGET kind's vocabulary and starts empty.
 */
(function initEcosystemTransfer() {
	"use strict";

	const SEND_TO_ACTION = "send-to";
	const OVERLAY_ELEMENT_ID = "ecosystem-transfer-overlay";
	const DIALOG_ELEMENT_ID = "ecosystem-transfer-dialog";

	// The twin pair. Of the 500 areas, 181 topographie + 119 vegetation are the ~266 twins the plan counts;
	// the 234 derographic ones are containers (continents, islands) and have no counterpart. So for a
	// vegetation source the useful default is topographie and the other way round -- offering
	// "derographisch" first would be wrong on nearly every real transfer.
	const ECOSYSTEM_TRANSFER_TWIN = { vegetation: "topographie", topographie: "vegetation" };

	let transferBound = false;
	let transferBusy = false;
	// The area the dialog is currently about. Read out of the registry again on submit, so a row that was
	// reloaded in between is not saved from a stale copy.
	let transferSourcePublicId = "";
	// 💣 Set when create_region succeeded but create_area did NOT. Without it every retry would mint
	// another empty region in the target layer, and after three attempts the picker offers three
	// "Farindel"s of which two are empty. Cleared when the dialog closes or the target layer changes.
	let transferCreatedRegion = null;

	function label(key, german) {
		return typeof tr === "function" ? tr(key, german) : german;
	}

	function say(message, tone) {
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(message, tone);
		}
	}

	function kindLabel(kind) {
		return (typeof ECOSYSTEM_KIND_LABELS !== "undefined" && ECOSYSTEM_KIND_LABELS?.[kind]) || String(kind || "");
	}

	// ---- pure helpers (unit-tested) ------------------------------------------------------------------

	// The two other layers, twin first. `kinds` is passed in rather than read off the ECOSYSTEM_KINDS
	// global so the rule can be tested without loading the rendering file.
	function ecosystemTransferTargetKinds(sourceKind, kinds = []) {
		const source = String(sourceKind || "");
		if (!Array.isArray(kinds) || !kinds.includes(source)) {
			return [];
		}

		const others = kinds.filter((kind) => kind !== source);
		const twin = ECOSYSTEM_TRANSFER_TWIN[source];

		return twin && others.includes(twin) ? [twin, ...others.filter((kind) => kind !== twin)] : others;
	}

	// Only shapes create_area accepts. The server validates properly (avesmapsEcosystemNormalizeGeometry);
	// this is here so an unusable row produces a sentence in the dialog instead of a 400 from the wire.
	function isUsableEcosystemGeometry(geometry) {
		const type = String(geometry?.type || "");
		return (type === "Polygon" || type === "MultiPolygon")
			&& Array.isArray(geometry?.coordinates)
			&& geometry.coordinates.length > 0;
	}

	// Everything the two writes need, decided in one place so the rules are testable rather than spread
	// through the submit handler. Returns { error } or the plan.
	function ecosystemTransferPlan({
		area = null,
		targetKind = "",
		targetRegionPublicId = "",
		newRegionName = "",
		newRegionType = "",
		kinds = [],
	} = {}) {
		const sourceKind = String(area?.kind || "");
		const allowedTargets = ecosystemTransferTargetKinds(sourceKind, kinds);
		if (!allowedTargets.includes(String(targetKind))) {
			return { error: "Bitte eine Zielebene wählen." };
		}
		if (!isUsableEcosystemGeometry(area?.geometry)) {
			return { error: "Diese Fläche hat keine übertragbare Geometrie." };
		}

		// 💣 The deep copy. Handing area.geometry on by reference would put the SOURCE's object into the
		// request body -- harmless today because nothing mutates it in place, and exactly the kind of
		// shared reference that turns into "the copy moved with the original" the first time something
		// does. Cloning here costs one pass over a few hundred numbers.
		const geometry = JSON.parse(JSON.stringify(area.geometry));
		const existingRegionId = String(targetRegionPublicId || "").trim();
		if (existingRegionId) {
			return { targetKind: String(targetKind), regionPublicId: existingRegionId, createRegion: null, geometry };
		}

		const name = String(newRegionName || "").trim();
		if (name === "") {
			return { error: "Bitte einen Namen für die neue Region eingeben." };
		}

		return {
			targetKind: String(targetKind),
			regionPublicId: "",
			createRegion: {
				kind: String(targetKind),
				name,
				// 🪤 NEVER area.region_type -- it belongs to the source's kind and would be refused with 400.
				region_type: String(newRegionType || ""),
				// The wiki article only travels while the name still IS the source's name. Rename the copy
				// and the link would point at an article about something else, which is worse than no link:
				// wiki_region_key is derived from it server-side and joins on it.
				wiki_url: ecosystemTransferCarriesWiki(area, name) ? String(area.wiki_url) : "",
			},
			geometry,
		};
	}

	function ecosystemTransferCarriesWiki(area, name) {
		const wikiUrl = String(area?.wiki_url || "").trim();
		const sourceName = String(area?.region_name || "").trim();

		return wikiUrl !== "" && sourceName !== "" && String(name || "").trim() === sourceName;
	}

	// Names BOTH the layer and the region: "gespeichert" alone would not say where it landed, and where it
	// landed is the whole question the dialog just asked.
	function formatEcosystemTransferSuccess(targetKindLabel, regionName) {
		const name = String(regionName || "").trim() || "Ohne Namen";
		return `Kopie in „${String(targetKindLabel || "")}“ angelegt — Region „${name}“.`;
	}

	// ---- the dialog ----------------------------------------------------------------------------------

	function transferElement(suffix) {
		return document.getElementById(`ecosystem-transfer-${suffix}`);
	}

	function currentTransferArea() {
		const layer = typeof ecosystemLayers !== "undefined" && ecosystemLayers instanceof Map
			? ecosystemLayers.get(transferSourcePublicId)
			: null;

		return layer?._ecosystemArea || null;
	}

	function setTransferError(message) {
		const errorElement = transferElement("error");
		if (!errorElement) {
			return;
		}
		errorElement.textContent = String(message || "");
		errorElement.hidden = !message;
	}

	function isEcosystemTransferDialogOpen() {
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		return Boolean(overlayElement) && !overlayElement.hidden;
	}

	// Which of the two "new region" fields are on show, plus the honest sentence about the wiki link.
	function syncTransferRegionFields() {
		const area = currentTransferArea();
		const isNewRegion = String(transferElement("region")?.value || "") === "";
		const nameField = transferElement("name-field");
		const typeField = transferElement("type-field");
		const wikiNote = transferElement("wiki-note");

		if (nameField) {
			nameField.hidden = !isNewRegion;
		}
		if (typeField) {
			typeField.hidden = !isNewRegion;
		}
		if (!wikiNote) {
			return;
		}

		// Said out loud rather than decided quietly: the link travels with the name, so the editor can see
		// what renaming the copy costs at the moment they rename it.
		const hasWiki = isNewRegion && String(area?.wiki_url || "").trim() !== "";
		wikiNote.hidden = !hasWiki;
		if (hasWiki) {
			wikiNote.textContent = ecosystemTransferCarriesWiki(area, transferElement("name")?.value)
				? label("ecosystem.transfer.wikiKept", "Der Wiki-Artikel der Quelle wird mit übernommen.")
				: label("ecosystem.transfer.wikiDropped", "Anderer Name als die Quelle — der Wiki-Artikel wird nicht übernommen.");
		}
	}

	function renderTransferTypeOptions(targetKind) {
		const typeSelect = transferElement("type");
		if (!typeSelect) {
			return;
		}

		// 🔴 From ecosystem_region_type through list_regions, never from a list written into the client --
		// the server validates writes against exactly those rows.
		const types = (typeof ecosystemRegionTypesByKind !== "undefined" && ecosystemRegionTypesByKind?.[targetKind]) || [];
		typeSelect.innerHTML = "";
		typeSelect.appendChild(new Option(label("ecosystem.transfer.typeNone", "— ohne Art —"), "", true, true));
		types.forEach((type) => typeSelect.appendChild(new Option(type.label, type.type_key)));
		typeSelect.value = "";
	}

	function renderTransferRegionOptions(targetKind) {
		const regionSelect = transferElement("region");
		if (!regionSelect) {
			return;
		}

		const regions = (typeof ecosystemRegionsByKind !== "undefined" && ecosystemRegionsByKind?.[targetKind]) || null;
		regionSelect.innerHTML = "";
		// Default, and first: the common case is that the target does not exist yet ("Farindel"-Vegetation
		// -> "Farindel"-Topographie). Appending to an existing region is the exception and sits below.
		regionSelect.appendChild(new Option(label("ecosystem.transfer.regionNew", "Neue Region anlegen"), "", true, true));

		if (!Array.isArray(regions)) {
			regionSelect.appendChild(new Option(label("ecosystem.transfer.regionLoading", "Regionen werden geladen …"), "", false, false));
			regionSelect.options[1].disabled = true;
		} else {
			regions.forEach((region) => {
				const optionLabel = typeof formatEcosystemRegionOptionLabel === "function"
					? formatEcosystemRegionOptionLabel(region)
					: String(region.name || "");
				regionSelect.appendChild(new Option(optionLabel, region.public_id));
			});
		}

		// A region from a failed attempt is real on the server but not yet in the picker's cache (only a
		// COMPLETED send puts it there). Without this line the retry would find no option to select and
		// would create a second one under the same name.
		if (transferCreatedRegion?.kind === targetKind
			&& !Array.from(regionSelect.options).some((option) => option.value === transferCreatedRegion.publicId)) {
			regionSelect.appendChild(new Option(String(transferCreatedRegion.name || ""), transferCreatedRegion.publicId));
		}

		// 🪤 Back to "Neue Region anlegen" on every render, and deliberately NOT to whatever the select
		// held before. Carrying the previous value over would survive the dialog being CLOSED and
		// reopened for a different area -- measured: the second "Senden an ..." offered to append to
		// whatever the first one picked, which is the one answer nobody meant. The single exception is a
		// region created by a FAILED attempt: that one stays selected so the retry appends to it instead
		// of minting a second empty one.
		const keep = transferCreatedRegion?.kind === targetKind ? transferCreatedRegion.publicId : "";
		regionSelect.value = keep && Array.from(regionSelect.options).some((option) => option.value === keep && !option.disabled)
			? keep
			: "";
		syncTransferRegionFields();
	}

	async function applyTransferTargetKind(targetKind) {
		renderTransferTypeOptions(targetKind);
		renderTransferRegionOptions(targetKind);

		// Cached per kind and invalidated on every write (the loader watches ecosystem_revision), so this
		// is at most one request per kind per campaign -- not one per dialog. STRATO does not get a query
		// for a menu that is opened hundreds of times.
		if (typeof loadEcosystemRegions === "function") {
			await loadEcosystemRegions(targetKind);
		}
		if (!isEcosystemTransferDialogOpen() || String(transferElement("kind")?.value || "") !== targetKind) {
			return;
		}
		renderTransferTypeOptions(targetKind);
		renderTransferRegionOptions(targetKind);
	}

	function openEcosystemTransferDialog(publicId) {
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		const kindSelect = transferElement("kind");
		if (!overlayElement || !kindSelect) {
			return;
		}

		transferSourcePublicId = String(publicId || "");
		const area = currentTransferArea();
		if (!area) {
			// Panned out of the viewport between the right-click and the click on the entry: the loader
			// drops such a layer, and guessing from a stale copy is exactly what "copy, not link" forbids.
			say("Diese Fläche ist nicht mehr geladen. Bitte neu laden.", "warning");
			return;
		}

		const kinds = typeof ECOSYSTEM_KINDS !== "undefined" ? ECOSYSTEM_KINDS : [];
		const targets = ecosystemTransferTargetKinds(area.kind, kinds);
		if (targets.length === 0) {
			say("Diese Fläche kann nicht gesendet werden.", "warning");
			return;
		}

		transferCreatedRegion = null;
		kindSelect.innerHTML = "";
		targets.forEach((kind, index) => kindSelect.appendChild(new Option(kindLabel(kind), kind, index === 0, index === 0)));
		kindSelect.value = targets[0];

		const sourceLine = transferElement("source");
		if (sourceLine) {
			// The same sentence the tooltip under the cursor shows, so dialog and map agree on what was
			// right-clicked. Reused rather than re-formatted -- one wording, one place.
			sourceLine.textContent = typeof formatEcosystemAreaTooltip === "function"
				? formatEcosystemAreaTooltip(area)
				: String(area.region_name || "");
		}
		const nameInput = transferElement("name");
		if (nameInput) {
			nameInput.value = String(area.region_name || "");
		}
		setTransferError("");
		bindEcosystemTransferDialog();
		overlayElement.hidden = false;
		void applyTransferTargetKind(targets[0]);

		// 💣 DEFERRED. This runs inside a CAPTURE-phase click handler on document (the menu entry), so the
		// browser is still dispatching that very click: focus set here can be taken away again on the way
		// back up. setTimeout and not requestAnimationFrame -- rAF does not fire in a hidden tab, which is
		// where this gets verified.
		window.setTimeout(() => {
			if (isEcosystemTransferDialogOpen()) {
				(transferElement("kind") || document.getElementById(DIALOG_ELEMENT_ID))?.focus();
			}
		}, 0);
	}

	// Where the keyboard goes when the dialog is gone. Not "back to what opened it" -- that was an entry in
	// a menu that has since closed. The active layer tab is where the editor now IS, which after a
	// successful send is the target layer.
	function restoreFocusAfterEcosystemTransfer() {
		const activeKind = typeof getActiveEcosystemLayerKind === "function" ? getActiveEcosystemLayerKind() : "";
		const tab = activeKind ? document.querySelector(`[data-ecosystem-kind="${activeKind}"]`) : null;
		if (tab && tab.offsetParent !== null) {
			tab.focus();
			return;
		}
		const active = document.activeElement;
		if (active && typeof active.blur === "function") {
			active.blur();
		}
	}

	function closeEcosystemTransferDialog() {
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		if (!overlayElement || overlayElement.hidden) {
			return;
		}
		overlayElement.hidden = true;
		transferSourcePublicId = "";
		transferCreatedRegion = null;

		// 🪤 A tick late, always. A successful send has just changed the active layer, and the segment
		// switch re-stamps tabindex on all three tabs while doing it -- focusing in the same turn would
		// land on a tab that is about to become tabindex="-1".
		window.setTimeout(restoreFocusAfterEcosystemTransfer, 0);
	}

	// ---- the two writes ------------------------------------------------------------------------------

	async function submitEcosystemTransfer(event) {
		event?.preventDefault();
		if (transferBusy) {
			return;
		}

		const area = currentTransferArea();
		const targetKind = String(transferElement("kind")?.value || "");
		const plan = ecosystemTransferPlan({
			area,
			targetKind,
			targetRegionPublicId: transferElement("region")?.value,
			newRegionName: transferElement("name")?.value,
			newRegionType: transferElement("type")?.value,
			kinds: typeof ECOSYSTEM_KINDS !== "undefined" ? ECOSYSTEM_KINDS : [],
		});
		if (plan.error) {
			setTransferError(plan.error);
			return;
		}

		const saveButton = transferElement("save");
		transferBusy = true;
		setTransferError("");
		if (saveButton) {
			saveButton.disabled = true;
			saveButton.textContent = label("ecosystem.transfer.saving", "Wird gesendet …");
		}

		try {
			let regionPublicId = plan.regionPublicId;
			let regionName = "";
			if (plan.createRegion) {
				// 🔴 wiki_url travels, wiki_region_key does not: the key is derived server-side through the
				// fixed fold table (AGENTS.md §5).
				const created = await postEcosystemEdit("create_region", plan.createRegion);
				regionPublicId = String(created?.region?.public_id || "");
				regionName = String(created?.region?.name || plan.createRegion.name);
				transferCreatedRegion = {
					kind: plan.targetKind,
					publicId: regionPublicId,
					name: regionName,
					regionType: plan.createRegion.region_type || null,
				};
			} else if (transferCreatedRegion?.publicId === regionPublicId) {
				// Retry after a create_area that failed: the region exists on the server, but only a
				// COMPLETED send puts it into the picker's cache -- so its name has to come from here.
				regionName = String(transferCreatedRegion.name || "");
			} else {
				const regions = (typeof ecosystemRegionsByKind !== "undefined" && ecosystemRegionsByKind?.[plan.targetKind]) || [];
				regionName = String(regions.find((region) => region.public_id === regionPublicId)?.name || "");
			}

			// 🔴 No is_trial in this payload, on purpose -- see the file header.
			const saved = await postEcosystemEdit("create_area", {
				region_public_id: regionPublicId,
				geometry_geojson: plan.geometry,
			});
			// 🪤 NOT `plan.createRegion` -- on a retry that is null while the region very much exists, and
			// reading .region_type off it threw a TypeError that surfaced as "the send failed" AFTER the
			// area had already been written (measured). The question is "did THIS transfer create the
			// region the area went into", and transferCreatedRegion is what answers it.
			const createdRegion = transferCreatedRegion?.publicId === regionPublicId
				? { public_id: regionPublicId, name: regionName, kind: plan.targetKind, region_type: transferCreatedRegion.regionType || null }
				: null;
			transferCreatedRegion = null;
			closeEcosystemTransferDialog();
			await jumpIntoEcosystemCopy(plan.targetKind, regionPublicId, String(saved?.area?.public_id || ""), createdRegion);
			say(formatEcosystemTransferSuccess(kindLabel(plan.targetKind), regionName));
		} catch (error) {
			console.error("Landschaftsflaeche konnte nicht gesendet werden:", error);
			setTransferError(transferCreatedRegion
				? `${error?.message || "Die Fläche konnte nicht gesendet werden."} Die Region wurde bereits angelegt — ein erneutes Senden hängt die Fläche dort an.`
				: (error?.message || "Die Fläche konnte nicht gesendet werden."));
			// The region select now has to offer the region that DID get created, so the retry finds it.
			renderTransferRegionOptions(plan.targetKind);
		} finally {
			transferBusy = false;
			if (saveButton) {
				saveButton.disabled = false;
				saveButton.textContent = label("ecosystem.transfer.save", "Senden");
			}
		}
	}

	// "Danach ist die Zielebene aktiv und die Kopie ausgewählt" -- three pieces of state, in this order.
	//
	// 🪤 KIND BEFORE REGION. Switching the layer runs syncEcosystemRegionCache, which re-renders from the
	// cached rows and falls back to the FIRST region of that kind -- setting the active region first would
	// simply be overwritten a line later.
	//
	// The areas are then pulled through the ordinary read path, never rendered from the write's answer:
	// one way onto the map, so a copy and a reloaded area can never look or behave differently. That
	// reload also bumps past the changed ecosystem_revision, which is what makes the picker refetch its
	// rows -- so the new region appears in the row with its area count without a second request from here.
	async function jumpIntoEcosystemCopy(targetKind, regionPublicId, copyPublicId, createdRegion = null) {
		if (typeof setActiveEcosystemLayerKind === "function") {
			setActiveEcosystemLayerKind(targetKind);
		}

		// 💣 MEASURED, not assumed: the line above repaints the picker from the cached rows and falls back
		// to the FIRST region of that kind. Setting the active region afterwards fixes the STATE but not
		// the row -- the bar above the map went on naming "Windhagberge" while the next drawn area would
		// have gone into "Farindel". A visible state that lies about a real one is worse than no state.
		// So the new row goes into the cache (the same thing the "Neue Region" dialog does after its own
		// create_region, and cheaper than a second list_regions) and the row is repainted.
		if (createdRegion?.public_id && typeof ecosystemRegionsByKind !== "undefined" && ecosystemRegionsByKind) {
			const cached = Array.isArray(ecosystemRegionsByKind[targetKind]) ? ecosystemRegionsByKind[targetKind] : [];
			ecosystemRegionsByKind[targetKind] = cached.concat([{ ...createdRegion, area_count: 1 }]);
		}
		// Hier wurde die Zielregion früher zur „aktiven" gemacht und der Wähler neu gezeichnet. Beides
		// gibt es seit dem 2026-07-27 nicht mehr: es gibt keine aktive Region, weil jede gezeichnete
		// Fläche ihre eigene bekommt (map-features-ecosystem-region-store.js). Die Kopie landet
		// unverändert in ihrer Zielregion -- sie wird danach nur nicht mehr vorausgewählt.

		if (typeof loadEcosystemAreas === "function") {
			await loadEcosystemAreas();
		}
		if (typeof setSelectedEcosystemArea === "function" && copyPublicId) {
			setSelectedEcosystemArea(copyPublicId);
		}
	}

	// ---- wiring --------------------------------------------------------------------------------------

	function bindEcosystemTransferDialog() {
		if (transferBound) {
			return;
		}
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		if (!overlayElement) {
			return;
		}

		transferBound = true;
		transferElement("close")?.addEventListener("click", closeEcosystemTransferDialog);
		transferElement("cancel")?.addEventListener("click", closeEcosystemTransferDialog);
		transferElement("form")?.addEventListener("submit", submitEcosystemTransfer);
		transferElement("kind")?.addEventListener("change", (event) => {
			// A region created by a failed attempt belongs to the layer it was created in; pointing at
			// another layer makes it irrelevant.
			transferCreatedRegion = null;
			void applyTransferTargetKind(String(event.target.value || ""));
		});
		transferElement("region")?.addEventListener("change", syncTransferRegionFields);
		transferElement("name")?.addEventListener("input", syncTransferRegionFields);
		// Click on the scrim closes; a click inside the dialog must not.
		overlayElement.addEventListener("click", (event) => {
			if (event.target === overlayElement) {
				closeEcosystemTransferDialog();
			}
		});
		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && isEcosystemTransferDialogOpen()) {
				// Stopped, so the layer's own Escape does not ALSO drop the selection of the area the
				// dialog is about -- closing a dialog is one gesture, not two.
				event.stopPropagation();
				closeEcosystemTransferDialog();
			}
		});
	}

	// The entry goes in through the menu's own extension point (V3.4, addEntry), not by touching its DOM:
	// the menu is built and owned there, and it puts destructive entries last on its own.
	function registerEcosystemTransferEntry() {
		window.AvesmapsEcosystemAreaMenu?.addEntry?.({
			action: SEND_TO_ACTION,
			label: label("ecosystem.ctxmenu.sendTo", "Senden an …"),
			onClick: openEcosystemTransferDialog,
		});
	}

	if (typeof document !== "undefined") {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", registerEcosystemTransferEntry, { once: true });
		} else {
			registerEcosystemTransferEntry();
		}
	}

	// One global, a namespace object -- everything else stays inside the IIFE and cannot collide with the
	// 164 <script> tags sharing one scope (plan, global rule 6).
	if (typeof window !== "undefined") {
		window.AvesmapsEcosystemTransfer = {
			open: openEcosystemTransferDialog,
			close: closeEcosystemTransferDialog,
			isOpen: isEcosystemTransferDialogOpen,
		};
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = {
			ecosystemTransferTargetKinds,
			ecosystemTransferPlan,
			ecosystemTransferCarriesWiki,
			formatEcosystemTransferSuccess,
		};
	}
})();
