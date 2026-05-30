"use strict";

/*
 * Zweispaltiges Panel-Layout fuer den Herrschaftsgebiet-Editor.
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
 * zunaechst im alten .manual-data-columns-Container; ein MutationObserver zieht
 * es dann in die Spalten nach. Rein additiv, keine bestehenden Klassen/IDs
 * geaendert.
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

		// Dokumentreihenfolge bewahren (querySelectorAll liefert sie).
		const sections = Array.from(form.querySelectorAll(".manual-data-section"));

		// Waehrend des Umsortierens den Observer pausieren (kein Re-Trigger).
		if (observer) observer.disconnect();
		for (const section of sections) {
			const target = (left.offsetHeight <= right.offsetHeight) ? left : right;
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
