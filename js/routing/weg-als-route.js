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

// Namensindex der Orte, einmal je Kartenstand gebaut -- wie avesmapsWegOrtIndexStand in weg-abschnitte.js.
// avesmapsWegAlsRouteAuslassen durchsuchte vorher bei JEDEM Namen die ganze Liste (Array.prototype.find); live
// gemessen kostete das 64 statt 19 ms fuer alle 409 Strassen, weil refreshPathLayerPopup das Popup jedes der
// 1964 Wege beim Kartenaufbau vorbaut (preparePathData).
let avesmapsWegAlsRouteOrtNachNameStand = { schluessel: null, nachName: null };

function avesmapsWegAlsRouteOrtNachName() {
	const orte = typeof locationData !== "undefined" && Array.isArray(locationData) ? locationData : [];
	const schluessel = typeof avesmapsWegKartenStand === "function" ? avesmapsWegKartenStand(orte) : String(orte.length);
	if (avesmapsWegAlsRouteOrtNachNameStand.schluessel !== schluessel) {
		const nachName = new Map();
		// Der ERSTE Ort mit dem Namen gewinnt -- wie Array.prototype.find es zuvor tat.
		orte.forEach((ort) => {
			const name = ort && ort.name;
			if (typeof name === "string" && !nachName.has(name)) { nachName.set(name, ort); }
		});
		avesmapsWegAlsRouteOrtNachNameStand = { schluessel, nachName };
	}
	return avesmapsWegAlsRouteOrtNachNameStand.nachName;
}

/** Kreuzungen, offene Wegenden und verborgene Orte fahren nicht mit (§5.2). */
function avesmapsWegAlsRouteAuslassen(name) {
	if (name === AVESMAPS_WEG_ENDE_KREUZUNG || name === AVESMAPS_WEG_ENDE_OFFEN) { return true; }
	const ort = avesmapsWegAlsRouteOrtNachName().get(name);
	// 🔴 Am gespeicherten Merkmal, nicht an der Aufdeckung dieses Besuchs (isHiddenLocation kennt beides): eine Route
	// aus derselben Strasse soll fuer jeden dieselben Orte haben.
	return Boolean(ort && (ort.isHidden === true || (typeof isCrossingLocation === "function" && isCrossingLocation(ort))));
}

/**
 * Die ganze Strasse: alle Abschnitte der Gruppe plus jeder fremde Abschnitt, der den Artikel als WEITERE
 * Zuweisung traegt (§5.2). IMMER die ganze Strasse, nie die Editor-Auswahl -- avesmapsWegAlsRouteHatZweiOrte
 * (unten) haengt genau daran, damit die Kachel fuer Besucher und Editoren gleich sichtbar ist.
 */
function avesmapsWegAlsRouteGanzeStrasse(path) {
	const abschnitt = typeof avesmapsWegAbschnittAufKarte === "function" ? avesmapsWegAbschnittAufKarte(path) : null;
	if (!abschnitt) { return []; }
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
	// Sonst die ganze Strasse.
	return avesmapsWegAlsRouteGanzeStrasse(path);
}

// Ob die Kachel „Weg als Route" ueberhaupt erscheint (Owner 14.09.2026: „Die Kachel soll bei zu kurzen Wegen
// ausgeblendet werden"). IMMER die ganze Strasse, NIE die Editor-Auswahl -- sonst zeigte dieselbe Strasse
// Besuchern und Editoren mit markiertem Abschnitt eine unterschiedliche Anzahl Kacheln.
//
// 💣 GEMERKT JE STRASSE (Gruppenschluessel), nicht je Abschnitt: refreshPathLayerPopup baut beim Kartenaufbau
// (preparePathData) fuer JEDEN Abschnitt einer Strasse das Popup vorab -- eine Reichsstrasse mit 57 Abschnitten
// zaehlte ihre Orte sonst 57 Mal fuer dieselbe Antwort. Zwischenspeicher folgt demselben Muster wie
// avesmapsWegOrtIndexStand/avesmapsWegGruppenStand in weg-abschnitte.js: ein Schluessel aus BEIDEN
// Kartenstaenden (Wege UND Orte), je gehobenem Schluessel eine frische Karte je Gruppenschluessel.
let avesmapsWegAlsRouteZweiOrteStand = { schluessel: null, nachGruppe: null };

function avesmapsWegAlsRouteHatZweiOrte(path) {
	const abschnitt = typeof avesmapsWegAbschnittAufKarte === "function" ? avesmapsWegAbschnittAufKarte(path) : null;
	if (!abschnitt) { return false; }
	const pfade = typeof pathData !== "undefined" && Array.isArray(pathData) ? pathData : [];
	const orte = typeof locationData !== "undefined" && Array.isArray(locationData) ? locationData : [];
	const schluessel = (typeof avesmapsWegKartenStand === "function" ? avesmapsWegKartenStand(pfade) : String(pfade.length))
		+ "|" + (typeof avesmapsWegKartenStand === "function" ? avesmapsWegKartenStand(orte) : String(orte.length));
	if (avesmapsWegAlsRouteZweiOrteStand.schluessel !== schluessel) {
		avesmapsWegAlsRouteZweiOrteStand = { schluessel, nachGruppe: new Map() };
	}
	const gruppenSchluessel = abschnitt.gruppe.key;
	if (!avesmapsWegAlsRouteZweiOrteStand.nachGruppe.has(gruppenSchluessel)) {
		avesmapsWegAlsRouteZweiOrteStand.nachGruppe.set(gruppenSchluessel, avesmapsWegAlsRouteGanzeStrasse(path).length >= 2);
	}
	return avesmapsWegAlsRouteZweiOrteStand.nachGruppe.get(gruppenSchluessel);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWegAlsRouteOrte, avesmapsWegAlsRouteAuslassen, avesmapsWegAlsRouteGanzeStrasse,
		avesmapsWegAlsRouteFuerPfad, avesmapsWegAlsRouteHatZweiOrte,
	};
}
