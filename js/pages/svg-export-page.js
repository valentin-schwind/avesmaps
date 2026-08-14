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

	// Der Auswahlbaum ist generisch: jedes Kästchen kennt seinen Pfad
	// (`landschaften/topographie/see`) und den seines Elternteils. Damit braucht keine
	// Stufe eigenen Code -- eine vierte Stufe käme ohne Änderung hier aus.
	const alleKnoten = () => [...document.querySelectorAll("[data-svgx-node]")];
	const knoten = (pfad) => document.querySelector(`[data-svgx-node="${pfad}"]`);
	const kinderVon = (pfad) => [...document.querySelectorAll(`[data-svgx-parent="${pfad}"]`)];

	// Ebenen sind die Knoten ohne Elternteil.
	function gewaehlteEbenen() {
		const an = {};
		alleKnoten().filter((b) => !b.dataset.svgxParent)
			.forEach((b) => { an[b.dataset.svgxNode] = b.checked; });
		return an;
	}

	// {wege: {Seeweg: true, …}, orte: {…}, landschaften: {topographie: …}, landschaftstypen: {see: …}}
	// ⚠️ Nur ein ausdrückliches false schließt aus (svgxSubgroupEnabled im Bauer): eine Art,
	// die es hier nicht als Kästchen gibt, bleibt in der Datei. So verschwindet keine
	// Datenleiche lautlos, bloß weil sie in keiner Liste steht.
	function gewaehlteUnterarten() {
		const unter = {};
		const setz = (topf, schluessel, wert) => {
			if (!unter[topf]) { unter[topf] = {}; }
			unter[topf][schluessel] = wert;
		};
		alleKnoten().forEach((b) => {
			const teile = b.dataset.svgxNode.split("/");
			if (teile.length === 2) {
				// zweite Stufe: Wegart, Ortsgröße -- bei den Landschaften die Ebenen-Art
				setz(teile[0], b.value, b.checked);
			} else if (teile.length === 3 && teile[0] === "landschaften") {
				// dritte Stufe: der Geländetyp, nach dem der Bauer die Flächen gruppiert.
				// Er liegt in EINEM Topf über alle vier Arten hinweg, weil `region_type`
				// die Gruppierung ist und die Art nur bestimmt, was geladen wird.
				setz("landschaftstypen", b.value, b.checked);
			}
		});
		return unter;
	}

	// Ein Häkchen setzt alles darunter; ist nur ein Teil an, zeigt der Elternteil den
	// Zwischenzustand -- sonst behauptet ein volles Häkchen etwas Falsches.
	function nachUntenSetzen(box) {
		kinderVon(box.dataset.svgxNode).forEach((kind) => {
			kind.checked = box.checked;
			kind.indeterminate = false;
			nachUntenSetzen(kind);
		});
	}

	function nachObenAusrichten(box) {
		const elternPfad = box.dataset.svgxParent;
		if (!elternPfad) { return; }
		const eltern = knoten(elternPfad);
		if (!eltern) { return; }
		const geschwister = kinderVon(elternPfad);
		const an = geschwister.filter((g) => g.checked).length;
		const halb = geschwister.some((g) => g.indeterminate);
		eltern.checked = an > 0;
		eltern.indeterminate = halb || (an > 0 && an < geschwister.length);
		nachObenAusrichten(eltern);
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
		alleKnoten().forEach((box) => {
			box.checked = zustand;
			box.indeterminate = false;
		});
	}

	document.addEventListener("DOMContentLoaded", function () {
		const knopf = el("svgx-start");
		if (knopf) { knopf.addEventListener("click", erzeugen); }
		const alle = el("svgx-all");
		if (alle) { alle.addEventListener("click", () => alleSetzen(true)); }
		const keine = el("svgx-none");
		if (keine) { keine.addEventListener("click", () => alleSetzen(false)); }

		// Ein Zuhörer für den ganzen Baum, gleich auf welcher Stufe.
		alleKnoten().forEach((box) => {
			box.addEventListener("change", function () {
				box.indeterminate = false;
				nachUntenSetzen(box);
				nachObenAusrichten(box);
			});
		});
	});
}());
