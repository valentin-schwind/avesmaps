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

	// {wege: {Seeweg: true, Pfad: false, …}, orte: {…}, landschaften: {…}}
	// ⚠️ Nur ein ausdrückliches false schließt aus (siehe svgxSubgroupEnabled im Bauer):
	// eine Unterart, die es hier nicht als Kästchen gibt, bleibt in der Datei.
	function gewaehlteUnterarten() {
		const unter = {};
		document.querySelectorAll("[data-svgx-sub]").forEach((box) => {
			const ebene = box.getAttribute("data-svgx-sub");
			if (!unter[ebene]) { unter[ebene] = {}; }
			unter[ebene][box.value] = box.checked;
		});
		return unter;
	}

	// Ein Häkchen an der Ebene setzt alle ihre Unterarten; sind nur einige an, zeigt die
	// Ebene den Zwischenzustand -- sonst behauptet ein volles Häkchen etwas Falsches.
	function ebeneNachKindernAusrichten(ebene) {
		const haupt = document.querySelector(`[data-svgx-layer="${ebene}"]`);
		const kinder = [...document.querySelectorAll(`[data-svgx-sub="${ebene}"]`)];
		if (!haupt || kinder.length === 0) { return; }
		const an = kinder.filter((k) => k.checked).length;
		haupt.checked = an > 0;
		haupt.indeterminate = an > 0 && an < kinder.length;
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

	function zeile(tbody, text, wert, klasse) {
		const tr = document.createElement("tr");
		if (klasse) { tr.className = klasse; }
		if (!wert) { tr.setAttribute("data-empty", "1"); }
		const td1 = document.createElement("td");
		td1.textContent = text;
		const td2 = document.createElement("td");
		td2.textContent = typeof wert === "number" ? wert.toLocaleString("de-DE") : String(wert);
		tr.appendChild(td1);
		tr.appendChild(td2);
		tbody.appendChild(tr);
	}

	function statistikZeigen(stats, detail, bytes) {
		const tbody = el("svgx-stats-body");
		if (!tbody) { return; }
		while (tbody.firstChild) { tbody.removeChild(tbody.firstChild); }
		Object.entries(stats).forEach(([name, anzahl]) => {
			zeile(tbody, name, anzahl, "svgx-stats__layer");
			// Die Untergruppen eingerückt darunter -- so steht hier, was die Datei WIRKLICH
			// enthält, und nicht nur, was angehakt war.
			(detail || []).filter((d) => d.layer === name)
				.forEach((d) => zeile(tbody, d.group, d.count, "svgx-stats__group"));
		});
		zeile(tbody, "Dateigröße", `${(bytes / (1024 * 1024)).toFixed(1)} MB`, "svgx-stats__layer");
		const tabelle = el("svgx-stats");
		if (tabelle) { tabelle.hidden = false; }
	}

	async function erzeugen() {
		const knopf = el("svgx-start");
		if (knopf) { knopf.disabled = true; }
		const an = gewaehlteEbenen();
		const unterarten = gewaehlteUnterarten();
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
				// Nur die angehakten Arten holen. Das spart hier echte Ladezeit, nicht nur
				// Dateigröße: jede Art ist eine eigene Anfrage an einen teuren Endpunkt.
				const arten = ENDPOINTS.ecosystemKinds.filter((k) => unterarten.landschaften
					? unterarten.landschaften[k] !== false : true);
				for (const kind of arten) {
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
				subgroups: unterarten,
				dialect: dialekt,
			});

			// Nie ein einziger Riesenstring durch Aneinanderhängen -- die Stückliste geht
			// direkt in den Blob.
			const blob = new Blob(ergebnis.parts, { type: "image/svg+xml;charset=utf-8" });
			statistikZeigen(ergebnis.stats, ergebnis.detail, blob.size);

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

	function alleSetzen(zustand) {
		document.querySelectorAll("[data-svgx-layer]").forEach((box) => {
			box.checked = zustand;
			box.indeterminate = false;
		});
		document.querySelectorAll("[data-svgx-sub]").forEach((box) => { box.checked = zustand; });
	}

	document.addEventListener("DOMContentLoaded", function () {
		const knopf = el("svgx-start");
		if (knopf) { knopf.addEventListener("click", erzeugen); }
		const alle = el("svgx-all");
		if (alle) { alle.addEventListener("click", () => alleSetzen(true)); }
		const keine = el("svgx-none");
		if (keine) { keine.addEventListener("click", () => alleSetzen(false)); }

		// Ebene an -> alle ihre Unterarten an, und umgekehrt.
		document.querySelectorAll("[data-svgx-layer]").forEach((haupt) => {
			const ebene = haupt.getAttribute("data-svgx-layer");
			haupt.addEventListener("change", function () {
				haupt.indeterminate = false;
				document.querySelectorAll(`[data-svgx-sub="${ebene}"]`)
					.forEach((kind) => { kind.checked = haupt.checked; });
			});
		});
		document.querySelectorAll("[data-svgx-sub]").forEach((kind) => {
			kind.addEventListener("change", function () {
				ebeneNachKindernAusrichten(kind.getAttribute("data-svgx-sub"));
			});
		});
	});
}());
