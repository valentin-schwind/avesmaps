// Die Infobox-Zeilen der weiteren Wiki-Zuweisungen (Entwurf 2026-09-14 §2.4, §3.4):
//   „Auch Teil von"      -- die weiteren Artikel DIESES Abschnitts (bei markierter ganzer Strasse: aller ihrer Abschnitte)
//   „Verläuft auch über" -- fremde Abschnitte, die den Hauptartikel dieses Wegs als WEITERE Zuweisung tragen
// Ein Klick hebt den ganzen Weg hervor: die Links sind Stations-Links (focusPathItemStation -> focusWholeWikiDeeplinkPath).
// ⚠️ Normales Skript: auch Besucher sehen die Zeilen.

function avesmapsWegWeiterePlatzhalter(publicId) {
	return '<div class="avesmaps-path-weitere" data-path-weitere="' + escapeHtml(String(publicId || "")) + '"></div>';
}

/** REIN: zwei Zeilen als dl-Inhalt. Eintraege {name, ref, zusatz}; ohne ref reiner Text. */
function avesmapsWegWeitereZeilen(daten, linkMarkup) {
	const eintrag = (e) => (e.ref ? linkMarkup(e.name, { kind: "path", ref: e.ref }) : escapeHtml(e.name))
		+ (e.zusatz ? " (" + escapeHtml(e.zusatz) + ")" : "");
	const zeile = (titel, eintraege) => (eintraege.length
		? '<div class="region-info-box__row"><dt>' + escapeHtml(titel) + "</dt><dd>" + eintraege.map(eintrag).join("<br>") + "</dd></div>"
		: "");
	return zeile("Auch Teil von", daten.auchTeil || []) + zeile("Verläuft auch über", daten.verlaeuftUeber || []);
}

let avesmapsWegTraegerStand = { schluessel: null, nachKey: null };

/** Welche Abschnitte tragen welchen Artikel als WEITERE Zuweisung? Einmal je Kartenstand gerechnet. */
function avesmapsWegTraegerIndex() {
	const daten = typeof pathData !== "undefined" && Array.isArray(pathData) ? pathData : [];
	const schluessel = avesmapsWegKartenStand(daten);
	if (avesmapsWegTraegerStand.schluessel !== schluessel) {
		const nachKey = new Map();
		daten.forEach((path) => {
			(Array.isArray(path?.properties?.wiki_path_weitere) ? path.properties.wiki_path_weitere : []).forEach((eintrag) => {
				const key = String(eintrag?.wiki_key || "").trim();
				if (!key) { return; }
				if (!nachKey.has(key)) { nachKey.set(key, []); }
				nachKey.get(key).push(path);
			});
		});
		avesmapsWegTraegerStand = { schluessel, nachKey };
	}
	return avesmapsWegTraegerStand.nachKey;
}

function avesmapsWegWeitereLabel(way) {
	const abschnitt = avesmapsWegGruppenAufKarte().nachId.get(way.public_id);
	return abschnitt ? wpAbschnittLabel(abschnitt.way, abschnitt.nummer) : "";
}

function avesmapsWegWeitereZeilenMarkup(path, auswahl) {
	const ganz = Boolean(auswahl && auswahl.publicId === null);
	const eigene = ganz ? avesmapsWegGruppeAufKarte(path) : [avesmapsWegAlsWay(path)];

	// „Auch Teil von": je Artikel einmal; bei der ganzen Strasse mit den Abschnitten, die ihn tragen (alle = ohne Zusatz).
	const auchTeil = new Map();
	eigene.forEach((way) => {
		(way.wiki_path_weitere || []).forEach((eintrag) => {
			const key = String(eintrag?.wiki_key || "").trim();
			if (!key) { return; }
			if (!auchTeil.has(key)) {
				auchTeil.set(key, { name: String(eintrag.name || key), ref: wikiUrlToDeeplinkKey(eintrag.wiki_url), labels: [] });
			}
			auchTeil.get(key).labels.push(avesmapsWegWeitereLabel(way));
		});
	});

	// „Verläuft auch über": fremde Traeger der eigenen Hauptartikel, je fremdem Weg einmal. 🔴 An der GANZEN Strasse alle Artikel,
	// die in ihr stehen -- seit die Strasse der Name ist (Owner 15.09.2026), kann sie gemischt sein, und die Zeile darf nicht davon
	// abhaengen, welchen Abschnitt man angeklickt hat. Am Abschnitt nur sein eigener.
	const eigeneWays = avesmapsWegGruppeAufKarte(path);
	const eigeneIds = new Set(eigeneWays.map((way) => way.public_id));
	const hauptKeys = ganz
		? wpGruppeHauptzuweisungen(eigeneWays).filter(Boolean)
		: [String(path?.properties?.wiki_path?.wiki_key || "").trim()].filter(Boolean);
	const ueber = new Map();
	hauptKeys.forEach((hauptKey) => {
		(avesmapsWegTraegerIndex().get(hauptKey) || []).forEach((traeger) => {
			const way = avesmapsWegAlsWay(traeger);
			if (eigeneIds.has(way.public_id)) { return; }
			const fremderKey = String(way.wiki_path?.wiki_key || way.name);
			if (!ueber.has(fremderKey)) {
				ueber.set(fremderKey, { name: String(way.wiki_path?.name || way.name), ref: wikiUrlToDeeplinkKey(way.wiki_path?.wiki_url), labels: [] });
			}
			const label = avesmapsWegWeitereLabel(way);
			if (ueber.get(fremderKey).labels.indexOf(label) === -1) { ueber.get(fremderKey).labels.push(label); }
		});
	});

	const alsEintraege = (karte, gesamt) => Array.from(karte.values()).map((e) => ({
		name: e.name,
		ref: e.ref,
		zusatz: gesamt && e.labels.length === gesamt ? "" : e.labels.filter(Boolean).join(", "),
	}));
	return avesmapsWegWeitereZeilen({
		// R27 (Task 11 Fix 2): `eigene.length` gilt in BEIDEN Faellen -- am Abschnitt ist es 1 und der einzige
		// Traeger deckt sie immer, die Klammer nennte sonst den eben geoeffneten Abschnitt noch einmal.
		auchTeil: alsEintraege(auchTeil, eigene.length),
		verlaeuftUeber: alsEintraege(ueber, 0),
	}, pathItemStationLinkMarkup);
}

/** Ersetzt den Platzhalter im fertigen Markup durch die Zeilen (Aufruf beim Oeffnen der Infobox). */
function avesmapsWegWeitereFuellen(markup, path) {
	const platzhalter = avesmapsWegWeiterePlatzhalter(getPathPublicId(path));
	if (typeof markup !== "string" || markup.indexOf(platzhalter) === -1) { return markup; }
	const auswahl = typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE && typeof avesmapsWegAuswahlFuerPfad === "function"
		? avesmapsWegAuswahlFuerPfad(path) : null;
	const inhalt = avesmapsWegWeitereZeilenMarkup(path, auswahl);
	// 💣 Ersetzt per FUNKTION: in einer Ersatz-Zeichenkette waere ein „$" im Namen eines Artikels ein Muster.
	return markup.replace(platzhalter, () => platzhalter.replace("></div>", () => ">" + inhalt + "</div>"));
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsWegWeiterePlatzhalter, avesmapsWegWeitereZeilen, avesmapsWegWeitereZeilenMarkup, avesmapsWegWeitereFuellen, avesmapsWegTraegerIndex };
}
