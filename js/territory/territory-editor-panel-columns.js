"use strict";

/*
 * Zweispaltiges Panel-Layout für den Herrschaftsgebiet-Editor.
 *
 * Problem: Die .manual-data-section-Panels liegen teils direkt im
 * <form.manual-data-box>, teils im Zwischen-Container .manual-data-columns.
 * Reines CSS-flex-wrap reiht sie nur zeilenweise -> ungerade/aussenliegende
 * Panels nehmen die volle Breite ein.
 *
 * Loesung (wie im vom Nutzer vorgegebenen Beispiel): zwei echte Spalten-
 * Container (.manual-data-column) in einem .manual-data-column-wrap, in die ALLE
 * Panels per Hoehen-Balancing einsortiert werden (jeweils in die aktuell
 * kuerzere Spalte). Panels werden per appendChild VERSCHOBEN -> Event-Listener
 * und IDs bleiben erhalten, vorhandenes JS funktioniert weiter.
 *
 * Das dynamisch injizierte Geometrie-Panel (#derivedGeometryPanel) landet
 * zunächst im alten .manual-data-columns-Container; ein MutationObserver zieht
 * es dann in die Spalten nach. Rein additiv, keine bestehenden Klassen/IDs
 * geändert.
 */
(function initPoliticalTerritoryEditorPanelColumns() {
	const HOST_SELECTOR = "#political-territory-editor-host";
	let observer = null;
	let scheduled = false;

	function getForm() {
		return document.querySelector(`${HOST_SELECTOR} .manual-data-box`)
			|| document.querySelector(".manual-data-box");
	}

	function ensureColumns(form) {
		let wrap = form.querySelector(":scope > .manual-data-column-wrap");
		if (!wrap) {
			wrap = document.createElement("div");
			wrap.className = "manual-data-column-wrap";
			const left = document.createElement("div");
			left.className = "manual-data-column";
			const right = document.createElement("div");
			right.className = "manual-data-column";
			wrap.appendChild(left);
			wrap.appendChild(right);
			form.appendChild(wrap);
		}
		return wrap;
	}

	// true, wenn mindestens ein Panel noch nicht in einer Spalte liegt.
	function needsLayout(form) {
		return Array.from(form.querySelectorAll(".manual-data-section"))
			.some((section) => !section.parentElement.classList.contains("manual-data-column"));
	}

	function layout() {
		const form = getForm();
		if (!form || !needsLayout(form)) {
			return;
		}
		const wrap = ensureColumns(form);
		const left = wrap.children[0];
		const right = wrap.children[1];

		const sections = Array.from(form.querySelectorAll(".manual-data-section"));

		// Deterministische Reihenfolge: nach FIXER Sektions-Ordnung sortieren statt nach wechselnder
		// Dokumentreihenfolge. Das dynamisch (async) injizierte Geometrie-Panel landete je nach
		// Injektionszeitpunkt mal vorne, mal hinten -> "springende" Panels bei jedem Öffnen. Unbekannte
		// Sektionen ans Ende.
		const SECTION_ORDER = ["Geometrie", "Anzeige", "Kartensichtbarkeit", "Farbe", "Transparenz"];
		// Sichtbare Überschrift (h3) zuerst: das Geometrie-Panel hat aria-label "Automatische
		// Außengrenzen", soll aber per "Geometrie" (= h3) in SECTION_ORDER einsortiert werden.
		const sectionKey = (section) => (section.querySelector("h3")?.textContent || section.getAttribute("aria-label") || "").trim();
		const sectionRank = (section) => {
			const index = SECTION_ORDER.indexOf(sectionKey(section));
			return index < 0 ? SECTION_ORDER.length : index;
		};
		sections.sort((a, b) => sectionRank(a) - sectionRank(b));

		// Während des Umsortierens den Observer pausieren (kein Re-Trigger).
		if (observer) observer.disconnect();
		for (const section of sections) {
			const target = section.querySelector("#infoBox") ? right : left;
			target.appendChild(section); // verschiebt das Panel, Listener bleiben
		}
		if (observer) observer.observe(form, { childList: true, subtree: true });
	}

	function schedule() {
		if (scheduled) return;
		scheduled = true;
		const run = () => { scheduled = false; layout(); };
		if (typeof window.requestAnimationFrame === "function") {
			window.requestAnimationFrame(run);
		} else {
			window.setTimeout(run, 16);
		}
	}

	function install() {
		const form = getForm();
		if (!form) {
			window.setTimeout(install, 100);
			return;
		}
		observer = new MutationObserver(() => schedule());
		observer.observe(form, { childList: true, subtree: true });
		schedule();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", install, { once: true });
	} else {
		install();
	}

	window.AvesmapsPoliticalTerritoryEditorPanelColumns = { relayout: layout };
})();
