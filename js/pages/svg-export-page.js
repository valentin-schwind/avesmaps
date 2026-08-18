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
		//
		// 💣 DIESE REIHENFOLGE IST DIE ZEICHENREIHENFOLGE, nicht Geschmack. Der Bauer
		// gruppiert die Flächen in der Reihenfolge, in der sie ankommen, und in SVG liegt
		// das Erste unten. Solange alles beige war, fiel das nicht auf; mit den echten
		// Farben schon: die acht Klimabänder decken die GANZE Karte, kämen sie zuletzt,
		// läge ein Farbschleier über Wald, Meer und Gebirge. Also von hinten nach vorn --
		// Klima als Grund, dann die Behälter, dann der Bewuchs, zuoberst Wasser und Relief.
		ecosystemKinds: ["klima", "derographisch", "vegetation", "topographie"],
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

	// 🔴 Die Farbe JEDER Landschaftsfläche, nach DERSELBEN Regel, mit der die Karte sie
	// ableitet (map-features-ecosystem-rendering.js, ecosystemAreaColor): erst der Token des
	// Geländetyps, sonst der Token der Art. Also keine Abschrift, sondern dieselbe Quelle --
	// ein neu eingeführter Typ braucht auch hier nur seinen Token in tokens.css, und der
	// Export folgt von selbst. Wald grün, Wüste gelb, See blau, Meer dunkelblau.
	// 💣 Der Unterstrich wird zum Bindestrich:
	//    suempfe_moore -> --color-ecosystem-vegetation-suempfe-moore
	// 💣 Gelesen wird HIER und nicht im Bauer: getComputedStyle braucht ein DOM, und der
	// Bauer hat per Vertrag keins. Er bekommt die fertige Tafel gereicht.
	function landschaftsFarben(features) {
		const stil = getComputedStyle(document.documentElement);
		const token = (name) => (stil.getPropertyValue(name) || "").trim();
		const farben = {};
		(features || []).forEach((f) => {
			const p = f.properties || f;
			const typ = p.region_type || "ohne_typ";
			if (farben[typ]) { return; }
			const art = p.kind || "";
			farben[typ] = token(`--color-ecosystem-${art}-${typ.replace(/_/g, "-")}`)
				|| token(`--color-ecosystem-${art}`)
				|| "#dfd6bd";
		});
		return farben;
	}

	// 🔴 Die Vorgaben des Owners (15.08.2026), sie schlagen die Kartenfarbe. Alles, was hier
	// NICHT steht, kommt weiter aus dem Programm -- Token für Flächen, SVGX_WAY_COLORS für
	// Wege. Der Owner: „seen sind 82befe, flüsse 4c89c6, wege f5ffe9, wälder 589a64,
	// gebirge acaea2, der rest wie aus dem programm."
	// ⚠️ „wege" heißt hier die sechs LANDwege. Seeweg bleibt bei seinem Kartenton, weil er
	// eine Schiffsroute ist und kein Landweg; der Flussweg hat seinen eigenen Wert bekommen.
	// Falls das anders gemeint war: die Farbfelder auf der Seite ändern es in einem Klick.
	const SVGX_COLOR_PRESETS = {
		"landschaften/topographie/see": "#82befe",
		"landschaften/vegetation/wald": "#589a64",
		"landschaften/topographie/gebirge": "#acaea2",
		"wege/Flussweg": "#4c89c6",
		"wege/Reichsstrasse": "#f5ffe9",
		"wege/Strasse": "#f5ffe9",
		"wege/Weg": "#f5ffe9",
		"wege/Pfad": "#f5ffe9",
		"wege/Gebirgspass": "#f5ffe9",
		"wege/Wuestenpfad": "#f5ffe9",
	};

	// Farbe eines Knotens, wenn niemand etwas eingestellt hat: erst die Vorgabe oben, dann
	// das, was das Programm ohnehin zeichnen würde.
	function vorgabeFuer(pfad) {
		if (SVGX_COLOR_PRESETS[pfad]) { return SVGX_COLOR_PRESETS[pfad]; }
		const teile = pfad.split("/");
		const stil = getComputedStyle(document.documentElement);
		const token = (name) => (stil.getPropertyValue(name) || "").trim();

		if (teile[0] === "landschaften" && teile.length === 3) {
			return token(`--color-ecosystem-${teile[1]}-${teile[2].replace(/_/g, "-")}`)
				|| token(`--color-ecosystem-${teile[1]}`) || "#dfd6bd";
		}
		if (teile[0] === "wege" && teile.length === 2) {
			const W = (window.AvesmapsSvgExport && window.AvesmapsSvgExport.WAY_COLORS) || {};
			return W[teile[1]] || "#888888";
		}
		if (teile[0] === "kraftlinien") { return "#7a5ea8"; }
		if (teile[0] === "gebiete") { return "#8a6a3f"; }
		// 🔴 Orte in der Farbe der Kartenmarkierung (--color-marker-waypoint), nicht im
		// Braun der Schrift -- Owner 16.08.2026. Beschriftungen bleiben braun.
		if (teile[0] === "orte") {
			return token("--color-marker-waypoint")
				|| (window.AvesmapsSvgExport && window.AvesmapsSvgExport.PLACE_COLOR) || "#e33b35";
		}
		return "#3b2a18";   // Beschriftungen
	}

	// Die eingestellten Farben, nach Ebene sortiert, wie der Bauer sie erwartet.
	function eingestellteFarben() {
		const aus = { wayColors: {}, wayOutlines: {}, placeColors: {}, areaColors: {}, areaOutlines: {} };
		document.querySelectorAll("[data-svgx-color]").forEach((feld) => {
			const teile = feld.getAttribute("data-svgx-color").split("/");
			if (teile[0] === "wege") { aus.wayColors[teile[1]] = feld.value; }
			else if (teile[0] === "orte") { aus.placeColors[teile[1]] = feld.value; }
			else if (teile[0] === "landschaften") { aus.areaColors[teile[2]] = feld.value; }
			else if (teile[0] === "gebiete") { aus.boundaryColor = feld.value; }
			else if (teile[0] === "kraftlinien") { aus.powerlineColor = feld.value; }
			else if (teile[0] === "beschriftungen") { aus.labelColor = feld.value; }
		});
		// Eine Kontur nur, wenn ihr Häkchen sitzt -- sonst verdoppeln sich die Pfade.
		document.querySelectorAll("[data-svgx-outline]").forEach((feld) => {
			const pfad = feld.getAttribute("data-svgx-outline");
			const an = document.querySelector(`[data-svgx-outline-on="${pfad}"]`);
			if (!an || !an.checked) { return; }
			const teile = pfad.split("/");
			if (teile[0] === "wege") { aus.wayOutlines[teile[1]] = feld.value; }
			// Flächenkonturen: standardmäßig AUS, wie auf der Karte -- eine Kontur gehört
			// dem Bearbeiten, nicht dem Ansehen (AGENTS.md §12).
			else if (teile[0] === "landschaften") { aus.areaOutlines[teile[2]] = feld.value; }
		});
		return aus;
	}

	function farbfelderVorbelegen() {
		document.querySelectorAll("[data-svgx-color]").forEach((feld) => {
			feld.value = vorgabeFuer(feld.getAttribute("data-svgx-color"));
		});
		document.querySelectorAll("[data-svgx-outline]").forEach((feld) => {
			// Die Karte legt eine weiße Kontur unter ihre Wege; hier ist sie vorbelegt, aber
			// AUS -- wer sie will, hakt sie an.
			feld.value = "#ffffff";
		});
	}

	// Die Linienstärke als Faktor. 100 % = der Kartenzustand (siehe SVGX_WAY_WIDTHS).
	function gewaehlteStrichstaerke() {
		const feld = el("svgx-stroke");
		const wert = Number(feld && feld.value);
		if (!Number.isFinite(wert) || wert <= 0) { return 1; }
		return Math.min(Math.max(wert, 5), 400) / 100;
	}

	function glaettung() {
		const an = el("svgx-smooth");
		const spannung = Number((el("svgx-tension") || {}).value);
		const flaechen = el("svgx-smooth-areas");
		return {
			smooth: Boolean(an && an.checked),
			smoothAreas: Boolean(flaechen && flaechen.checked),
			tension: Number.isFinite(spannung) ? Math.min(Math.max(spannung, 0), 1) : 0.5,
		};
	}

	// Die gewünschte Kantenlänge in Bildpunkten. Leer oder unsinnig -> Standard.
	function gewaehlteGroesse() {
		const feld = el("svgx-size");
		const wert = Math.round(Number(feld && feld.value));
		if (!Number.isFinite(wert) || wert < 256) { return 32768; }
		return Math.min(wert, 200000);
	}

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

			const farben = eingestellteFarben();
			const kurve = glaettung();

			// 💣 Die Flächenfarben kommen aus ZWEI Quellen, und die Reihenfolge ist tragend:
			// zuerst die aus den DATEN abgeleiteten (deckt auch einen Geländetyp ab, den es
			// auf dieser Seite noch gar nicht als Feld gibt), darüber die eingestellten.
			// Nur die Felder zu nehmen hieße: ein neu eingeführter Typ verlöre seine Farbe,
			// ohne dass es jemandem auffiele.
			const flaechenFarben = Object.assign({}, landschaftsFarben(ecosystems), farben.areaColors);

			const ergebnis = window.AvesmapsSvgExport.build({
				mapFeatures: mapFeatures,
				territories: territories,
				ecosystems: ecosystems,
				layers: an,
				subgroups: unterarten,
				dialect: dialekt,
				sizePx: gewaehlteGroesse(),
				strokeScale: gewaehlteStrichstaerke(),
				smooth: kurve.smooth,
				smoothAreas: kurve.smoothAreas,
				registrationMarks: Boolean((el("svgx-regmarks") || {}).checked),
				semantics: Boolean((el("svgx-semantics") || {}).checked),
				tension: kurve.tension,
				wayColors: farben.wayColors,
				wayOutlines: farben.wayOutlines,
				areaOutlines: farben.areaOutlines,
				placeColors: farben.placeColors,
				areaColors: flaechenFarben,
				boundaryColor: farben.boundaryColor,
				powerlineColor: farben.powerlineColor,
				labelColor: farben.labelColor,
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

		// Größe: Schnellwahl schreibt ins Feld, das Feld spiegelt sich in die Anzeige.
		const feld = el("svgx-size");
		const echo = el("svgx-size-echo");
		const spiegeln = () => {
			if (echo) { echo.textContent = gewaehlteGroesse().toLocaleString("de-DE"); }
		};
		if (feld) { feld.addEventListener("input", spiegeln); }
		const strichFeld = el("svgx-stroke");
		document.querySelectorAll("[data-svgx-stroke]").forEach((knopf) => {
			knopf.addEventListener("click", function () {
				if (strichFeld) { strichFeld.value = knopf.getAttribute("data-svgx-stroke"); }
			});
		});
		document.querySelectorAll("[data-svgx-size]").forEach((knopf) => {
			knopf.addEventListener("click", function () {
				if (feld) { feld.value = knopf.getAttribute("data-svgx-size"); }
				spiegeln();
			});
		});
		spiegeln();
		// 💣 BEIM LADEN, nicht im Klick-Handler einer Schnellwahl. Genau dort war der Aufruf
		// zuerst gelandet -- alle Farbfelder standen auf Schwarz, bis jemand zufällig auf eine
		// Größe klickte. Ein Fehler, den kein Test sieht: der Bauer war richtig, nur nie mit
		// den Vorgaben gefüttert.
		farbfelderVorbelegen();

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
