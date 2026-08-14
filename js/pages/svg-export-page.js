// Der Kitt zwischen der Seite und dem reinen Bauer (svg-export-build.js).
// Hier wohnt alles, was der Bauer per Vertrag nicht darf: fetch, DOM, Blob, Download.
//
// Entwurf: docs/superpowers/specs/2026-08-14-svg-export-design.md
"use strict";

(function () {
	const ENDPOINTS = {
		mapFeatures: "/api/app/map-features.php",
		territories: "/api/app/political-territories.php?action=layer",
		// ⚠️ EINE Anfrage je Art, nie in einer Schleife über Werte: der Landschaften- und
		// der Territorien-Endpunkt sind bekannte Perf-Brennpunkte auf dem Shared Hosting.
		ecosystemKinds: ["derographisch", "vegetation", "topographie", "klima"],
	};

	const el = (id) => document.getElementById(id);

	function status(text, isError) {
		const box = el("svgx-status");
		if (!box) { return; }
		box.textContent = text;
		box.classList.toggle("svgx-status--error", Boolean(isError));
	}

	// Ein Atemzug an den Browser, damit die Statuszeile mitläuft statt einzufrieren.
	const atmen = () => new Promise((resolve) => setTimeout(resolve, 0));

	function gewaehlteEbenen() {
		const an = {};
		document.querySelectorAll("[data-svgx-layer]").forEach((box) => {
			an[box.getAttribute("data-svgx-layer")] = box.checked;
		});
		return an;
	}

	function gewaehlterDialekt() {
		const gewaehlt = document.querySelector("[name=svgx-dialect]:checked");
		return gewaehlt ? gewaehlt.value : "inkscape";
	}

	async function holen(url) {
		const antwort = await fetch(url, { credentials: "same-origin" });
		if (!antwort.ok) {
			throw new Error(`${url} antwortete mit HTTP ${antwort.status}`);
		}
		return antwort.json();
	}

	function heute() {
		const d = new Date();
		const zwei = (n) => String(n).padStart(2, "0");
		return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
	}

	function statistikZeigen(stats, bytes) {
		const tbody = el("svgx-stats-body");
		if (!tbody) { return; }
		while (tbody.firstChild) { tbody.removeChild(tbody.firstChild); }
		Object.entries(stats).forEach(([name, anzahl]) => {
			const tr = document.createElement("tr");
			if (!anzahl) { tr.setAttribute("data-empty", "1"); }
			const td1 = document.createElement("td");
			td1.textContent = name;
			const td2 = document.createElement("td");
			td2.textContent = anzahl.toLocaleString("de-DE");
			tr.appendChild(td1);
			tr.appendChild(td2);
			tbody.appendChild(tr);
		});
		const tr = document.createElement("tr");
		const td1 = document.createElement("td");
		td1.textContent = "Dateigröße";
		const td2 = document.createElement("td");
		td2.textContent = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		tr.appendChild(td1);
		tr.appendChild(td2);
		tbody.appendChild(tr);
		const tabelle = el("svgx-stats");
		if (tabelle) { tabelle.hidden = false; }
	}

	async function erzeugen() {
		const knopf = el("svgx-start");
		if (knopf) { knopf.disabled = true; }
		const an = gewaehlteEbenen();
		const dialekt = gewaehlterDialekt();

		try {
			status("Kartendaten werden geladen … (das sind rund 20 MB, bitte Geduld)");
			const brauchtMapFeatures = an.regionen || an.wege || an.kraftlinien
				|| an.orte || an.beschriftungen;
			const mapFeatures = brauchtMapFeatures ? await holen(ENDPOINTS.mapFeatures) : null;

			let territories = null;
			if (an.gebiete) {
				status("Herrschaftsgebiete werden geladen …");
				territories = await holen(ENDPOINTS.territories);
			}

			let ecosystems = null;
			if (an.landschaften) {
				const gesammelt = [];
				for (const kind of ENDPOINTS.ecosystemKinds) {
					status(`Landschaften werden geladen … (${kind})`);
					const teil = await holen(`/api/app/ecosystem-areas.php?kind=${encodeURIComponent(kind)}`);
					window.AvesmapsSvgExport.asFeatures(teil).forEach((f) => gesammelt.push(f));
				}
				ecosystems = gesammelt;
			}

			status("Die Datei wird gebaut …");
			await atmen();

			const ergebnis = window.AvesmapsSvgExport.build({
				mapFeatures: mapFeatures,
				territories: territories,
				ecosystems: ecosystems,
				layers: an,
				dialect: dialekt,
			});

			// Nie ein einziger Riesenstring durch Aneinanderhängen -- die Stückliste geht
			// direkt in den Blob.
			const blob = new Blob(ergebnis.parts, { type: "image/svg+xml;charset=utf-8" });
			statistikZeigen(ergebnis.stats, blob.size);

			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `avesmaps-karte-${heute()}-${dialekt}.svg`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			setTimeout(() => URL.revokeObjectURL(url), 60000);

			status("Fertig — die Datei wurde heruntergeladen.");
		} catch (fehler) {
			status(`Fehlgeschlagen: ${fehler && fehler.message ? fehler.message : fehler}`, true);
		} finally {
			if (knopf) { knopf.disabled = false; }
		}
	}

	document.addEventListener("DOMContentLoaded", function () {
		const knopf = el("svgx-start");
		if (knopf) { knopf.addEventListener("click", erzeugen); }
		const alle = el("svgx-all");
		if (alle) {
			alle.addEventListener("click", function () {
				document.querySelectorAll("[data-svgx-layer]").forEach((box) => { box.checked = true; });
			});
		}
		const keine = el("svgx-none");
		if (keine) {
			keine.addEventListener("click", function () {
				document.querySelectorAll("[data-svgx-layer]").forEach((box) => { box.checked = false; });
			});
		}
	});
}());
