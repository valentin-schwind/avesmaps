// „Weg als Route" (Entwurf 2026-09-14 §5): die Orte eines Wegs der Reihe nach -- sie ERSETZEN die Wegpunkte des
// Routenplaners. Besucher bekommen immer die ganze Strasse, Editoren das Markierte.
// ⚠️ Normales Skript, NICHT in <template data-nur-editor> (nur-editor-skripte.test.js, Teil C).

/**
 * REIN: die Ortsnamen in Reihenfolge.
 * Reihenfolge = die Ketten aus wpChainSegments; mehrere Stuecke (Luecken) haengen vom Ende der laengsten Kette aus am
 * jeweils NAECHSTEN Ende an, das Stueck dafuer notfalls umgedreht (§5.2). Danach fallen `istAuslassen`-Namen weg und
 * aufeinanderfolgende Dopplungen.
 * @param {Array} ways  Editorzeilen mit `ends: {from, to}` und `enden: {von, bis}`
 */
function avesmapsWegAlsRouteOrte(ways, istAuslassen) {
	const liste = (Array.isArray(ways) ? ways : []).filter((way) => way && way.ends && way.enden);
	const ketten = wpChainSegments(liste);
	if (!ketten.length) { return []; }
	const stationenVon = (kette) => {
		const stationen = [];
		kette.forEach((glied, i) => {
			const way = liste[glied.index];
			const anfang = glied.gedreht ? { name: way.enden.bis, punkt: way.ends.to } : { name: way.enden.von, punkt: way.ends.from };
			const ende = glied.gedreht ? { name: way.enden.von, punkt: way.ends.from } : { name: way.enden.bis, punkt: way.ends.to };
			if (i === 0) { stationen.push(anfang); }
			stationen.push(ende);
		});
		return stationen;
	};
	const abstand = (a, b) => Math.hypot(Number(a[0]) - Number(b[0]), Number(a[1]) - Number(b[1]));

	let folge = stationenVon(ketten[0]);
	const rest = ketten.slice(1).map(stationenVon);
	while (rest.length) {
		const hier = folge[folge.length - 1].punkt;
		let bester = 0;
		let umdrehen = false;
		let kuerzester = Infinity;
		rest.forEach((stationen, i) => {
			const vorn = abstand(hier, stationen[0].punkt);
			const hinten = abstand(hier, stationen[stationen.length - 1].punkt);
			if (vorn < kuerzester) { kuerzester = vorn; bester = i; umdrehen = false; }
			if (hinten < kuerzester) { kuerzester = hinten; bester = i; umdrehen = true; }
		});
		const naechste = rest.splice(bester, 1)[0];
		folge = folge.concat(umdrehen ? naechste.slice().reverse() : naechste);
	}

	const orte = [];
	folge.forEach((station) => {
		const name = String(station.name || "");
		if (!name || (typeof istAuslassen === "function" && istAuslassen(name))) { return; }
		if (orte[orte.length - 1] !== name) { orte.push(name); }
	});
	return orte;
}

/** Kreuzungen, offene Wegenden und verborgene Orte fahren nicht mit (§5.2). */
function avesmapsWegAlsRouteAuslassen(name) {
	if (name === AVESMAPS_WEG_ENDE_KREUZUNG || name === AVESMAPS_WEG_ENDE_OFFEN) { return true; }
	const orte = typeof locationData !== "undefined" && Array.isArray(locationData) ? locationData : [];
	const ort = orte.find((kandidat) => kandidat && kandidat.name === name);
	// 🔴 Am gespeicherten Merkmal, nicht an der Aufdeckung dieses Besuchs (isHiddenLocation kennt beides): eine Route
	// aus derselben Strasse soll fuer jeden dieselben Orte haben.
	return Boolean(ort && (ort.isHidden === true || (typeof isCrossingLocation === "function" && isCrossingLocation(ort))));
}

function avesmapsWegAlsRouteFuerPfad(path) {
	const abschnitt = typeof avesmapsWegAbschnittAufKarte === "function" ? avesmapsWegAbschnittAufKarte(path) : null;
	if (!abschnitt) { return []; }
	const auswahl = typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE && typeof avesmapsWegAuswahlFuerPfad === "function"
		? avesmapsWegAuswahlFuerPfad(path)
		: null;
	// Editoren mit markiertem Abschnitt: nur er.
	if (auswahl && auswahl.publicId !== null && auswahl.publicId !== undefined) {
		const way = abschnitt.gruppe.segments.find((kandidat) => kandidat.public_id === auswahl.publicId) || abschnitt.way;
		return avesmapsWegAlsRouteOrte([way], avesmapsWegAlsRouteAuslassen);
	}
	// Sonst die ganze Strasse -- plus jeder fremde Abschnitt, der den Artikel als WEITERE Zuweisung traegt (§5.2).
	const ways = abschnitt.gruppe.segments.slice();
	const key = String((path && path.properties && path.properties.wiki_path && path.properties.wiki_path.wiki_key) || "");
	if (key && typeof avesmapsWegTraegerIndex === "function") {
		const ids = new Set(ways.map((way) => way.public_id));
		(avesmapsWegTraegerIndex().get(key) || []).forEach((traeger) => {
			const way = avesmapsWegAlsWay(traeger);
			if (!ids.has(way.public_id)) {
				ids.add(way.public_id);
				ways.push(way);
			}
		});
	}
	return avesmapsWegAlsRouteOrte(ways, avesmapsWegAlsRouteAuslassen);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsWegAlsRouteOrte, avesmapsWegAlsRouteAuslassen, avesmapsWegAlsRouteFuerPfad };
}
