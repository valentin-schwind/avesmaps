function setLabelEditDialogOpen(isOpen, { resetForm = false } = {}) {
	$("#label-edit-overlay").prop("hidden", !isOpen);
	syncModalDialogBodyState();

	if (isOpen) {
		getLabelEditDialogElement()?.focus();
		document.getElementById("label-edit-text")?.focus();
		return;
	}

	if (resetForm) {
		resetLabelEditForm();
	}
}

function populateLabelEditForm({ labelEntry = null, latlng = null } = {}) {
	labelEditEntry = labelEntry;
	labelEditLatLng = latlng ? L.latLng(latlng) : labelEntry?.marker.getLatLng() || null;
	const label = labelEntry?.label || {};
	// Fuer NEUE Labels (kein labelEntry) die zuletzt genutzte DARSTELLUNG als Default uebernehmen; bestehende
	// Labels behalten ihre eigenen Werte. Text & Kategorie werden bewusst NICHT gemerkt.
	const remembered = labelEntry ? {} : (readRememberedLabelDisplaySettings() || {});
	document.getElementById("label-edit-public-id").value = label.publicId || "";
	void acquireFeatureSoftLock(label.publicId || "");
	document.getElementById("label-edit-text").value = label.text || "";
	document.getElementById("label-edit-type").value = label.labelType || "region";
	document.getElementById("label-edit-size").value = label.size || remembered.size || 18;
	document.getElementById("label-edit-rotation").value = ((Number(label.rotation ?? remembered.rotation ?? 0) % 360) + 360) % 360;
	document.getElementById("label-edit-min-zoom").value = label.minZoom ?? remembered.minZoom ?? 0;
	document.getElementById("label-edit-max-zoom").value = label.maxZoom ?? remembered.maxZoom ?? 7;
	document.getElementById("label-edit-priority").value = label.priority ?? remembered.priority ?? 3;
	document.getElementById("label-edit-is-nodix").checked = Boolean(labelEntry ? label.isNodix : (remembered.isNodix ?? false));
	if (typeof setLabelWikiRegion === "function") {
		setLabelWikiRegion(label.wikiRegion || null);
	}
	// „Andere Quelle" ist aus diesem Dialog raus (Owner 2026-07-28) -- weder gelesen noch geschrieben.
	// Ein bereits gespeicherter Wert bleibt am Feature liegen, weil der Save den Schluessel nicht mehr
	// mitschickt und der Server nur schreibt, was im Payload steht.
	if (typeof writeOtherSourceToForm === "function") {
		writeOtherSourceToForm("label-edit", label.otherSource);
	}
	renderLabelCarrierNote(label);
	syncLabelZoomRangeOutputs();
	syncLabelSliderRowsFromNumbers();
	syncLabelPriorityOutput();
	document.getElementById("label-edit-delete").hidden = !labelEntry;
	if (labelEditLatLng) {
		document.getElementById("label-edit-lat").value = labelEditLatLng.lat.toFixed(3);
		document.getElementById("label-edit-lng").value = labelEditLatLng.lng.toFixed(3);
	}
}

// 🔴 „Dieses Label wird von N Flächen getragen." — die andere Hälfte der Kopplung. Der Dialog bearbeitet
// eine Beschriftung, aber seit jede Landschaftsregion ihr Label bekommt, hängt an vielen von ihnen eine
// Fläche, die mitverschwindet, wenn man hier auf „Löschen" geht. Wer das nicht sieht, löscht blind.
//
// Die Zahl kommt aus list_regions (area_count + label_public_id), NICHT aus den geladenen Flächen:
// ecosystemLayers hält nur, was gerade im Bild ist, und würde bei einer Region, die halb aus dem
// Ausschnitt ragt, zu wenig zählen.
async function renderLabelCarrierNote(label) {
	const note = document.getElementById("label-edit-carriers");
	if (!note) {
		return;
	}
	note.hidden = true;
	const publicId = String(label?.publicId || "");
	if (!publicId || typeof loadEcosystemRegions !== "function" || typeof ecosystemRegionsByKind === "undefined") {
		return;
	}

	const kinds = typeof ECOSYSTEM_KINDS !== "undefined" ? ECOSYSTEM_KINDS : ["derographisch", "vegetation", "topographie"];
	await Promise.all(kinds.map((kind) => loadEcosystemRegions(kind)));
	// Der Dialog kann inzwischen ein anderes Label zeigen -- dann gehört diese Antwort nicht mehr hierher.
	if (String(document.getElementById("label-edit-public-id")?.value || "") !== publicId) {
		return;
	}

	// Aus BEIDEN Richtungen: der Zeiger am Label (mehrere Labels je Flaeche) und der an der Region
	// (ihr primaeres). Nur die Regionsrichtung zu lesen hiesse, das zweite und dritte Label einer
	// Flaeche als heimatlos anzuzeigen -- und genau die sind der Sinn der Sache.
	const region = typeof ecosystemRegionOfLabel === "function" ? ecosystemRegionOfLabel(label) : null;
	applyLabelTypeVocabulary(region, label);
	if (!region) {
		return;
	}
	const count = Number(region.area_count || 0);
	note.textContent = count === 1
		? `Dieses Label wird von 1 Fläche getragen („${region.name}").`
		: `Dieses Label wird von ${count} Flächen getragen („${region.name}").`;
	note.hidden = false;
}

// 🔴 Ein Label GEHÖRT einer Ebene -- über seine Region (Owner 2026-07-28). Ein Vegetationslabel darf
// deshalb nur Vegetations-Arten anbieten: „Gebirge" auf einem Waldstück ist keine Wahl, die jemand
// treffen können soll. Das Vokabular kommt aus `ecosystem_region_type` DIESER Ebene -- dieselbe Liste,
// aus der der Flächendialog seine Art-Auswahl füllt, nie eine zweite im Client.
//
// 🪤 Nur einschränken, wenn das Label wirklich an einer Fläche hängt. Kontinente, Meere und die freien
// Karten-Titel gehören zu keiner Ebene und behalten die volle Liste aus dem Markup -- ihnen die
// Vegetations-Arten vorzusetzen wäre die Einschränkung genau falsch herum.
//
// 💣 Der Subtyp des Labels IST der Art-Schlüssel der Region (`wald` ist beides; der V5-Import hat die
// beiden Vokabulare gleichgesetzt). Wer hier eine Übersetzungstabelle einzieht, baut die zweite
// Wahrheit, die es bisher nicht gibt.
// 💣 Die volle Liste EINMAL wegheben. Das Auswahlfeld ist über alle Dialoge dasselbe Element: wer es
// für ein Vegetationslabel eindampft und danach ein Label OHNE Fläche öffnet, bekäme dessen sieben
// Vegetations-Arten vorgesetzt -- ein Kontinent hätte plötzlich zwischen Wald und Tundra zu wählen.
let labelTypeFullMarkup = "";

function applyLabelTypeVocabulary(region, label) {
	const select = document.getElementById("label-edit-type");
	if (select && labelTypeFullMarkup === "") {
		labelTypeFullMarkup = select.innerHTML;
	}
	const kind = String(region?.kind || "");
	if (!select) {
		return;
	}
	if (kind === "" || typeof ecosystemRegionTypesByKind === "undefined") {
		select.innerHTML = labelTypeFullMarkup;    // gehört zu keiner Ebene -> alles erlaubt
		select.value = String(label?.labelType || "region");
		return;
	}
	const types = ecosystemRegionTypesByKind[kind];
	if (!Array.isArray(types) || types.length === 0) {
		select.innerHTML = labelTypeFullMarkup;    // Vokabular noch nicht da -- lieber alles als eine falsche Auswahl
		select.value = String(label?.labelType || "region");
		return;
	}

	// „Keine Art" heisst beim LABEL der neutrale Subtyp `region`, nicht ein leerer Wert: ein Label ohne
	// Subtyp hätte keinen Stil und würde ungezeichnet bleiben.
	const wanted = String(label?.labelType || "region");
	select.innerHTML = "";
	select.appendChild(new Option(labelEmptyTypeLabel(kind), "region"));
	types.forEach((type) => {
		select.appendChild(new Option(type.label, type.type_key));
	});
	// Trägt das Label eine Art, die dieses Vokabular nicht kennt (Altbestand, oder die Region hat die
	// Ebene gewechselt), bleibt sie als eigener Eintrag stehen -- sonst würde ein blosses Öffnen des
	// Dialogs sie stillschweigend auf etwas anderes umstellen.
	if (wanted !== "region" && !types.some((type) => String(type.type_key) === wanted)) {
		select.appendChild(new Option(wanted + " (fremde Art)", wanted));
	}
	select.value = wanted;
}

function labelEmptyTypeLabel(kind) {
	if (kind === "vegetation") {
		return "— keine Vegetation —";
	}
	if (kind === "topographie") {
		return "— keine Topographie —";
	}

	return "— keine Art —";
}

function openLabelEditDialog(options = {}) {
	resetLabelEditForm();
	populateLabelEditForm(options);
	setLabelEditDialogOpen(true);
}

function syncLabelZoomRangeOutputs(event = null) {
	const minInputElement = document.getElementById("label-edit-min-zoom");
	const maxInputElement = document.getElementById("label-edit-max-zoom");
	const minNumElement = document.getElementById("label-edit-min-zoom-num");
	const maxNumElement = document.getElementById("label-edit-max-zoom-num");
	if (!minInputElement || !maxInputElement) {
		return;
	}

	let minZoom = Number.parseInt(minInputElement.value, 10);
	let maxZoom = Number.parseInt(maxInputElement.value, 10);
	if (event?.currentTarget === minInputElement && minZoom > maxZoom) {
		maxZoom = minZoom;
		maxInputElement.value = String(maxZoom);
	} else if (event?.currentTarget === maxInputElement && maxZoom < minZoom) {
		minZoom = maxZoom;
		minInputElement.value = String(minZoom);
	}

	if (minNumElement) {
		minNumElement.value = String(minZoom);
	}
	if (maxNumElement) {
		maxNumElement.value = String(maxZoom);
	}
	if (event?.currentTarget && map.getZoom() !== Number(event.currentTarget.value)) {
		map.setZoom(Number(event.currentTarget.value));
	}
}

function syncLabelZoomNumberInputs(event = null) {
	const minInputElement = document.getElementById("label-edit-min-zoom");
	const maxInputElement = document.getElementById("label-edit-max-zoom");
	const minNumElement = document.getElementById("label-edit-min-zoom-num");
	const maxNumElement = document.getElementById("label-edit-max-zoom-num");
	if (!minInputElement || !maxInputElement) {
		return;
	}
	const clamp = (value) => Math.max(0, Math.min(7, Number.parseInt(value, 10) || 0));
	if (minNumElement) {
		minInputElement.value = String(clamp(minNumElement.value));
	}
	if (maxNumElement) {
		maxInputElement.value = String(clamp(maxNumElement.value));
	}
	syncLabelZoomRangeOutputs({ currentTarget: event?.currentTarget === maxNumElement ? maxInputElement : minInputElement });
}

function syncLabelPriorityOutput() {
	const inputElement = document.getElementById("label-edit-priority");
	const outputElement = document.getElementById("label-edit-priority-output");
	if (!inputElement || !outputElement) {
		return;
	}

	outputElement.value = inputElement.value;
	outputElement.textContent = inputElement.value;
}

// Zahl+Slider-Reihen (Groesse/Rotation/Prioritaet): Slider aus den Zahlenwerten initialisieren.
function syncLabelSliderRowsFromNumbers() {
	document.querySelectorAll("#label-edit-dialog .label-edit-sliderrow").forEach((row) => {
		const numberInput = row.querySelector('input[type="number"]');
		const rangeInput = row.querySelector('input[type="range"]');
		if (numberInput && rangeInput) {
			rangeInput.value = numberInput.value;
		}
	});
}

// Zahl <-> Slider in einer Sliderrow spiegeln (ohne Seiteneffekt; Zoom hat eigene Logik).
document.addEventListener("input", (event) => {
	const target = event.target;
	if (!target || typeof target.closest !== "function") {
		return;
	}
	const row = target.closest(".label-edit-sliderrow");
	if (!row) {
		return;
	}
	const numberInput = row.querySelector('input[type="number"]');
	const rangeInput = row.querySelector('input[type="range"]');
	if (!numberInput || !rangeInput) {
		return;
	}
	if (target === rangeInput) {
		numberInput.value = rangeInput.value;
	} else {
		rangeInput.value = numberInput.value;
	}
});

// Zuletzt genutzte Label-DARSTELLUNG (Groesse/Rotation/Zoom-Band/Prioritaet/Nodix) merken bzw. lesen.
// Damit werden NEUE Labels vorbefuellt; Text & Kategorie werden bewusst NICHT gemerkt.
function persistLabelDisplaySettings(payload) {
	try {
		window.localStorage.setItem("avesmapsLabelEditorLastDisplay", JSON.stringify({
			size: payload.size,
			rotation: payload.rotation,
			minZoom: payload.min_zoom,
			maxZoom: payload.max_zoom,
			priority: payload.priority,
			isNodix: payload.is_nodix,
		}));
	} catch (error) {
		/* localStorage nicht verfuegbar -> Feature inaktiv */
	}
}

function readRememberedLabelDisplaySettings() {
	try {
		const raw = window.localStorage.getItem("avesmapsLabelEditorLastDisplay");
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch (error) {
		return null;
	}
}

function buildLabelEditPayload(formElement) {
	const formData = new FormData(formElement);
	const publicId = String(formData.get("public_id") || "").trim();
	const action = publicId ? "update_label" : "create_label";
	const payload = {
		action,
		public_id: publicId,
		text: String(formData.get("text") || "").trim(),
		feature_subtype: String(formData.get("feature_subtype") || "region").trim(),
		size: Number.parseInt(String(formData.get("size") || "18"), 10),
		rotation: Number.parseInt(String(formData.get("rotation") || "0"), 10),
		min_zoom: Number.parseInt(String(formData.get("min_zoom") || "0"), 10),
		max_zoom: Number.parseInt(String(formData.get("max_zoom") || "5"), 10),
		priority: Number.parseInt(String(formData.get("priority") || "3"), 10),
		is_nodix: formData.get("is_nodix") === "on",
		wiki_region: typeof getLabelWikiRegionPayload === "function" ? getLabelWikiRegionPayload() : null,
		// Manuelle Quellen bleiben am Label (Owner 2026-07-28). Der Server fasst other_source nur an,
		// wenn der Schlüssel mitkommt -- deshalb ist Mitschicken hier sicher und Weglassen wäre es auch.
		other_source: typeof readOtherSourceFromForm === "function" ? readOtherSourceFromForm("label-edit") : { url: "", label: "" },
	};

	if (action === "create_label") {
		payload.lat = Number.parseFloat(String(formData.get("lat") || ""));
		payload.lng = Number.parseFloat(String(formData.get("lng") || ""));
		delete payload.public_id;
	}

	// Zuletzt genutzte Darstellung merken -> neue Labels werden damit vorbefuellt (s. populateLabelEditForm).
	persistLabelDisplaySettings(payload);
	return payload;
}
