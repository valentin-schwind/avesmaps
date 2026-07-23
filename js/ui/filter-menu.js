// Der EINE Trichter. Ein Knopf „Filter ▾" öffnet ein Overlay mit beschrifteten Abschnitten; die
// Zahl der aktiven Abschnitte steht IM Knopf, damit nichts unter der Liste aufklappt und sie nach
// unten schiebt.
//
// Warum diese Datei existiert: das Muster gab es zweimal unabhängig -- einmal in js/app/utils.js
// für das Hauptfenster, einmal von Hand nachgebaut in html/wiki-sync-settlement-editor.html. Die
// dortige Begründung („standalone iframe document with no access to the parent's module state")
// stimmt für ZUSTAND, nicht für FUNKTIONEN: ein iframe-Dokument darf sich dieselbe Datei laden,
// es bekommt dann nur seine eigenen Globalen. Genau das tut es jetzt. Wer hier etwas ändert,
// ändert es für alle sechs Filterflächen -- und muss es nicht fünfmal abtippen.
//
// Bewusst OHNE Abhängigkeiten (eigener Escaper), damit auch die Seiten sie laden können, die sonst
// gar kein externes Skript einbinden: html/wiki-sync-monitor.html und html/adventure-editor.html.
//
// Abschnittsarten:
//   "multi"  -> state = Set,                    Ankreuzfelder, leer = alle
//   "single" -> state = { value: "" },          Radios, "" = alle
//   "range"  -> state = { mode, fromText, toText }, Zahlenbereich mit benannten Vorauswahlen
//
// section = { menuId, kind, state, label, isActive(), getOptions?(), options?, presets? }

function avmFilterEscape(value) {
	return String(value === null || value === undefined ? "" : value)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

const AVM_FILTER_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16l-6 8v5l-4 2v-7z"/></svg>';

// Die Vorauswahlen des Zeitraum-Abschnitts. „heute" ist hier eine benannte SPANNE und kein
// separates Häkchen mehr -- vorher schaltete das Häkchen die von/bis-Felder auf `disabled`, eine
// Kopplung, die man in jeder der fünf Kopien einzeln richtig hinbekommen musste. Als dritte
// Vorauswahl neben „Alle" und „Zeitraum" ist dieselbe Aussage ohne Kopplung ausdrückbar.
const AVM_RANGE_PRESETS = [
	{ value: "off", label: "Alle" },
	{ value: "today", label: "heute" },
	{ value: "range", label: "Zeitraum" },
];

function avmRangeStateCreate(mode = "off") {
	return { mode, fromText: "", toText: "" };
}

// PURE: der Zustand des Zeitraum-Abschnitts als das `{mode, from, to}`-Objekt, das die
// Baum-Filter seit jeher erwarten (territory-wiki-tree.js readTimeFilter). Der Vertrag der
// Verbraucher bleibt damit unangetastet -- es wechselt nur die Fläche, die ihn erzeugt.
function avmRangeValue(state) {
	if (!state || state.mode === "off") {
		return { mode: "off", from: -Infinity, to: Infinity };
	}
	if (state.mode === "today") {
		return { mode: "today", from: -Infinity, to: Infinity };
	}
	const from = parseInt(state.fromText, 10);
	const to = parseInt(state.toText, 10);
	// Beide Felder leer heißt „keine Einschränkung" -- ein Bereich ohne Grenzen ist keiner.
	if (Number.isNaN(from) && Number.isNaN(to)) {
		return { mode: "off", from: -Infinity, to: Infinity };
	}
	return {
		mode: "range",
		from: Number.isNaN(from) ? -Infinity : from,
		to: Number.isNaN(to) ? Infinity : to,
	};
}

// PURE: zählt eine Zeitraum-Auswahl als aktiv? „heute" zählt MIT, auch als Vorgabe -- es blendet
// alle historischen Gebiete aus, und ein standardmäßig eingeschalteter Filter, den der Knopf
// verschweigt, ist genau der unsichtbare Lügner, den der Trichter vermeiden soll. (Die Ausnahme
// für Kontinent=Aventurien gilt hier nicht: das ist die Identität der Karte, keine Einschränkung.)
function avmRangeIsActive(state) {
	return avmRangeValue(state).mode !== "off";
}

function avmRenderCheckboxSection(menuId, options, state) {
	const menu = typeof document !== "undefined" ? document.getElementById(menuId) : null;
	if (!menu) return;
	const parts = [
		`<label class="type-filter__opt"><input type="checkbox" value="__all__"${state.size === 0 ? " checked" : ""} /><span class="type-filter__label">Alle</span></label>`,
	];
	for (const option of options) {
		parts.push(
			`<label class="type-filter__opt"><input type="checkbox" value="${avmFilterEscape(option.value)}"${state.has(option.value) ? " checked" : ""} /><span class="type-filter__label">${avmFilterEscape(option.label)}</span>${option.count != null ? `<span class="type-filter__count">${option.count}</span>` : ""}</label>`
		);
	}
	menu.innerHTML = parts.join("");
}

function avmRenderRadioSection(menuId, options, state) {
	const menu = typeof document !== "undefined" ? document.getElementById(menuId) : null;
	if (!menu) return;
	const parts = [
		`<label class="type-filter__opt"><input type="radio" name="${avmFilterEscape(menuId)}" value="__all__"${!state.value ? " checked" : ""} /><span class="type-filter__label">Alle</span></label>`,
	];
	for (const option of options) {
		parts.push(
			`<label class="type-filter__opt"><input type="radio" name="${avmFilterEscape(menuId)}" value="${avmFilterEscape(option.value)}"${state.value === option.value ? " checked" : ""} /><span class="type-filter__label">${avmFilterEscape(option.label)}</span>${option.count != null ? `<span class="type-filter__count">${option.count}</span>` : ""}</label>`
		);
	}
	menu.innerHTML = parts.join("");
}

// 💣 Der Zeitraum-Abschnitt wird EINMAL gebaut und danach nur noch abgeglichen. Würde er wie die
// anderen bei jedem rebuild sein innerHTML ersetzen, verlöre das Zahlenfeld beim Tippen nach dem
// ersten Zeichen den Fokus -- und der Filter wäre unbenutzbar, ohne dass irgendwo ein Fehler steht.
function avmRenderRangeSection(menuId, state, presets) {
	if (typeof document === "undefined") return;
	const menu = document.getElementById(menuId);
	if (!menu) return;
	if (!menu.dataset.avmRangeBuilt) {
		const radios = presets.map((preset) =>
			`<label class="type-filter__opt"><input type="radio" name="${avmFilterEscape(menuId)}-mode" value="${avmFilterEscape(preset.value)}" data-avm-range-mode /><span class="type-filter__label">${avmFilterEscape(preset.label)}</span></label>`
		).join("");
		menu.innerHTML = radios
			+ '<div class="type-filter__range">'
			+ '<input type="number" class="type-filter__rangefield" data-avm-range="from" placeholder="von" aria-label="Zeitraum von (BF)" />'
			+ '<span class="type-filter__rangedash">–</span>'
			+ '<input type="number" class="type-filter__rangefield" data-avm-range="to" placeholder="bis" aria-label="Zeitraum bis (BF)" />'
			+ '<span class="type-filter__rangeunit">BF</span>'
			+ "</div>";
		menu.dataset.avmRangeBuilt = "1";
	}
	menu.querySelectorAll("[data-avm-range-mode]").forEach((radio) => {
		radio.checked = radio.value === state.mode;
	});
	menu.querySelectorAll("[data-avm-range]").forEach((input) => {
		const next = input.dataset.avmRange === "from" ? state.fromText : state.toText;
		// Nur schreiben, wenn es sich unterscheidet: ein Zuweisen setzt sonst die Schreibmarke ans Ende.
		if (input.value !== next) input.value = next;
		// Die Felder bleiben BEDIENBAR, auch wenn „Alle"/„heute" gewählt ist -- hineinzutippen ist die
		// natürliche Art, einen Zeitraum zu wählen, und schaltet die Vorauswahl selbst um (unten).
	});
}

function avmFilterSectionIsActive(section) {
	if (typeof section.isActive === "function") return section.isActive();
	if (section.kind === "range") return avmRangeIsActive(section.state);
	if (section.kind === "multi") return section.state.size > 0;
	return Boolean(section.state.value);
}

/**
 * Verdrahtet einen Trichter. Gibt die rebuild-Funktion zurück -- wer den Zustand aus dem Programm
 * heraus ändert (z. B. „verwerfen"), MUSS sie rufen, sonst nennt der Knopf weiter die alte Zahl.
 */
function avmFilterMenuAttach(toggleId, panelId, sections, applyFilter, label = "Filter") {
	const toggle = document.getElementById(toggleId);
	const panel = document.getElementById(panelId);
	if (!toggle || !panel) {
		return () => {};
	}

	const rebuild = () => {
		let active = 0;
		sections.forEach((section) => {
			if (section.kind === "range") {
				avmRenderRangeSection(section.menuId, section.state, section.presets || AVM_RANGE_PRESETS);
			} else if (section.kind === "single") {
				avmRenderRadioSection(section.menuId, section.getOptions ? section.getOptions() : (section.options || []), section.state);
			} else {
				avmRenderCheckboxSection(section.menuId, section.getOptions ? section.getOptions() : (section.options || []), section.state);
			}
			if (avmFilterSectionIsActive(section)) active += 1;
		});
		// Zähler in Klammern (Owner 2026-07-23): eine nackte „1" in der schmalen, gedämpften
		// Zählerschrift ist nur ~3px breit und liest sich wie ein „|" -- „(1)" ist eindeutig eine Zahl.
		toggle.innerHTML = `${AVM_FILTER_ICON} ${avmFilterEscape(label)}${active > 0 ? ` <span class="type-filter__count">(${active})</span>` : ""} ▾`;
		toggle.title = active > 0 ? `${label} (${active})` : label;
		toggle.setAttribute("aria-label", toggle.title);
	};

	const sectionFor = (element) => sections.find((section) => {
		const container = document.getElementById(section.menuId);
		return container && container.contains(element);
	});

	toggle.addEventListener("click", (event) => {
		event.stopPropagation();
		panel.hidden = !panel.hidden;
		if (!panel.hidden) rebuild();
	});
	document.addEventListener("click", (event) => {
		if (!panel.hidden && !toggle.contains(event.target) && !panel.contains(event.target)) {
			panel.hidden = true;
		}
	});

	panel.addEventListener("change", (event) => {
		const input = event.target;
		if (!input || (input.type !== "checkbox" && input.type !== "radio")) return;
		const section = sectionFor(input);
		if (!section) return;
		if (section.kind === "range") {
			section.state.mode = input.value;
		} else if (section.kind === "single") {
			section.state.value = input.value === "__all__" ? "" : input.value;
		} else if (input.value === "__all__") {
			section.state.clear();
		} else if (input.checked) {
			section.state.add(input.value);
		} else {
			section.state.delete(input.value);
		}
		rebuild();
		applyFilter();
	});

	// Tippen in ein Jahresfeld schaltet die Vorauswahl selbst auf „Zeitraum" -- sonst müsste man
	// erst den Radioknopf treffen und dann tippen, und ein getippter Wert ohne Wirkung sieht nach
	// einem kaputten Feld aus.
	panel.addEventListener("input", (event) => {
		const input = event.target;
		if (!input || !input.dataset || !input.dataset.avmRange) return;
		const section = sectionFor(input);
		if (!section || section.kind !== "range") return;
		if (input.dataset.avmRange === "from") section.state.fromText = input.value;
		else section.state.toText = input.value;
		if (input.value.trim() !== "") section.state.mode = "range";
		rebuild();
		applyFilter();
	});

	rebuild();
	return rebuild;
}

// Node-Export für den Unit-Test; im Browser lädt die Datei als schlichtes Skript und alles oben
// ist eine Globale. Nur die REINEN Teile -- der Rest braucht ein DOM.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avmFilterEscape,
		avmRangeStateCreate,
		avmRangeValue,
		avmRangeIsActive,
		AVM_RANGE_PRESETS,
	};
}
