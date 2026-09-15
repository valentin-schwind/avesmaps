// Der Kasten „Weitere Wiki-Zuweisungen" -- EIN Bauteil fuer den Wege-Editor (Huelle „dt") und den
// Kartendialog „Weg bearbeiten" (Huelle „label-wiki").
// Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §2.3, §3.5 und Nachtrag §9.5.
// 🔴 SEIT DEM NACHTRAG 15.09.2026 NUR NOCH EINGEBETTET: der Kasten haengt in der Einhaengestelle `anhang` des Kastens
// „Wiki-Weg" (js/ui/wiki-assign.js). Keine eigene Ueberschrift, keine Zeile „Hauptzuweisung".
//
// 🔴 Eine weitere Zuweisung benennt nie um und aendert keine Gruppe; der Server prueft das
// (api/_internal/wiki/path-weitere.php). Der Kasten schreibt sofort, ohne „Speichern".
// 🔴 Die Abschnitte liefert der WIRT (opts.abschnitte), bei jeder Aktion frisch gelesen. Der Kasten
// bildet keine Gruppe nach.
// ⚠️ Normales Skript, NICHT in <template data-nur-editor>: js/app/__tests__/nur-editor-skripte.test.js
// prueft Vorlagen-Namen gegen alle Skripte ausserhalb der Vorlagen.

const AVESMAPS_WIKI_WEITERE_URL = "/api/edit/wiki/paths.php";
const AVESMAPS_WIKI_WEITERE_TREFFER_LIMIT = 40;
const AVESMAPS_WIKI_WEITERE_TIPP_PAUSE_MS = 180;

function avesmapsWikiWeitereEsc(wert) {
	return String(wert == null ? "" : wert)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** REIN: welche weiteren Artikel an welchen Abschnitten haengen. */
function avesmapsWikiWeitereZuordnungen(abschnitte, gesamtText) {
	const liste = Array.isArray(abschnitte) ? abschnitte : [];
	const nachKey = new Map();
	liste.forEach((abschnitt) => {
		(Array.isArray(abschnitt && abschnitt.wiki_path_weitere) ? abschnitt.wiki_path_weitere : []).forEach((eintrag) => {
			const key = String((eintrag && eintrag.wiki_key) || "").trim();
			if (!key) { return; }
			if (!nachKey.has(key)) {
				nachKey.set(key, { wiki_key: key, name: String(eintrag.name || key), wiki_url: String(eintrag.wiki_url || ""), publicIds: [], labels: [] });
			}
			const zuordnung = nachKey.get(key);
			zuordnung.publicIds.push(abschnitt.public_id);
			zuordnung.labels.push(String(abschnitt.label || ""));
		});
	});
	return Array.from(nachKey.values()).map((z) => ({
		wiki_key: z.wiki_key,
		name: z.name,
		wiki_url: z.wiki_url,
		publicIds: z.publicIds,
		// Tragen ALLE Abschnitte eines mehrteiligen Kastens den Artikel, heisst die Stelle „ganze Straße".
		wo: liste.length > 1 && z.publicIds.length === liste.length ? String(gesamtText || "") : z.labels.join(", "),
	}));
}

/** REIN: der Rumpf fuer add_weitere/remove_weitere (Task 3). */
function avesmapsWikiWeitereKoerper(modus, wikiKey, publicIds) {
	return {
		action: modus === "add" ? "add_weitere" : "remove_weitere",
		wiki_key: String(wikiKey),
		public_ids: (Array.isArray(publicIds) ? publicIds : []).slice(),
		dry_run: false,
		confirm: "apply",
	};
}

/** REIN: angeboten wird weder die Hauptzuweisung noch ein schon vorhandener Artikel. */
function avesmapsWikiWeitereTrefferFiltern(zeilen, hauptKey, vorhandeneKeys) {
	const aus = new Set([String(hauptKey || "")].concat(Array.isArray(vorhandeneKeys) ? vorhandeneKeys : []));
	return (Array.isArray(zeilen) ? zeilen : []).filter((zeile) => zeile && zeile.wiki_key && !aus.has(String(zeile.wiki_key)));
}

// Die Gruende, aus denen der Server einen Abschnitt uebersprungen hat (api/_internal/wiki/
// path-weitere.php: `avesmapsWikiPathWeitereHinzufuegen`/`…Entfernen`, dazu `nicht_gefunden` aus
// dem Endpunkt selbst). Ein unbekannter Code faellt auf sich selbst zurueck -- ROH statt
// verschluckt, sonst sieht ein neuer Server-Code aus wie gar kein Grund.
const AVESMAPS_WIKI_WEITERE_GRUND_TEXT = {
	ohne_schluessel: "ohne Schlüssel",
	ohne_hauptzuweisung: "ohne Hauptzuweisung",
	ist_hauptzuweisung: "dort schon Hauptzuweisung",
	schon_da: "steht dort schon",
	nicht_da: "steht dort nicht",
	nicht_gefunden: "Abschnitt nicht gefunden",
};

/**
 * REIN: die deutsche Statuszeile nach einem Schreibvorgang -- Fund-Item 1 der ersten Pruefrunde.
 * `{ok:true, applied, skipped}` ist KEIN unqualifizierter Erfolg: bei `applied === 0` sagt der Satz
 * nie „zugewiesen"/„entfernt", sonst laese sich ein Kasten, der ALLES uebersprungen hat, wie ein
 * gelungener Schreibvorgang. Jeder uebersprungene Abschnitt bekommt seinen LABEL aus `abschnitte`
 * (Fallback: die public_id), damit die Zeile nicht nur eine Kennung nennt.
 */
function avesmapsWikiWeitereErgebnisText(modus, antwort, abschnitte) {
	const applied = Number((antwort && antwort.applied) || 0);
	const skipped = Array.isArray(antwort && antwort.skipped) ? antwort.skipped : [];
	const liste = Array.isArray(abschnitte) ? abschnitte : [];
	const saetze = [];
	if (applied > 0) {
		const einheit = applied === 1 ? "Abschnitt" : "Abschnitten";
		saetze.push(modus === "add" ? "An " + applied + " " + einheit + " zugewiesen." : "Von " + applied + " " + einheit + " entfernt.");
	}
	if (skipped.length) {
		const namen = skipped.map((eintrag) => {
			const publicId = eintrag && eintrag.public_id;
			const treffer = liste.find((abschnitt) => abschnitt && abschnitt.public_id === publicId);
			const label = treffer ? treffer.label : String(publicId || "");
			const grund = String((eintrag && eintrag.grund) || "");
			const grundText = Object.prototype.hasOwnProperty.call(AVESMAPS_WIKI_WEITERE_GRUND_TEXT, grund)
				? AVESMAPS_WIKI_WEITERE_GRUND_TEXT[grund]
				: grund;
			return label + " (" + grundText + ")";
		});
		saetze.push("Übersprungen: " + namen.join(", ") + ".");
	}
	if (!saetze.length) {
		return modus === "add" ? "Nichts zugewiesen." : "Nichts entfernt.";
	}
	return saetze.join(" ");
}

/** Die Klassen der Huelle: dieselben wie die der Wiki-Zuweisung, in deren Kasten dieser haengt. */
function avesmapsWikiWeitereSkin(name) {
	return typeof avesmapsWikiAssignSkin === "function" ? (avesmapsWikiAssignSkin(name) || {}) : {};
}

/**
 * REIN: der Kasten als HTML. modell = {hauptKey, umfang, zuordnungen}.
 * 🔴 NUR DIE EINGEBETTETE FORM (Nachtrag 15.09.2026 §9.5). Keine eigene Ueberschrift, keine Zeile „Hauptzuweisung" -- die
 * zeigt das Bauteil darueber samt Sync-Feldliste. „Zuweisen und Entfernen wirken sofort" sagt dessen Schreibzeile darunter.
 * 🔴 Die Zeilen stehen AUCH ohne Hauptzuweisung da: §2.2 Nr. 5 laesst die weiteren stehen, wenn die Hauptzuweisung geht --
 * ohne Zeile waeren sie nicht mehr zu entfernen. Nur das Suchfeld braucht die Hauptzuweisung (§2.2 Nr. 1).
 */
function avesmapsWikiWeitereMarkup(modell, skin) {
	const esc = avesmapsWikiWeitereEsc;
	const artikel = (z) => (z.wiki_url
		? '<a class="' + esc(skin.link) + '" href="' + esc(z.wiki_url) + '" target="_blank" rel="noopener">' + esc(z.name) + " ↗</a>"
		: esc(z.name))
		+ ' <span class="wiki-weitere__schluessel">' + esc(z.wiki_key) + "</span>";
	const zeilen = modell.zuordnungen.map((z) => '<tr><td class="wiki-weitere__wo">' + esc(z.wo) + "</td><td>" + artikel(z) + "</td>"
		+ '<td class="wiki-weitere__art">weitere <button type="button" class="wiki-weitere__weg" data-weitere-weg="' + esc(z.wiki_key)
		+ '" aria-label="Weitere Zuweisung ' + esc(z.name) + ' entfernen">✕</button></td></tr>').join("");
	const liste = zeilen ? '<table class="wiki-weitere">' + zeilen + "</table>" : "";
	const status = '<div class="' + esc(skin.hinweis) + '" data-weitere-status role="status" aria-live="polite"></div>';
	if (!modell.hauptKey) {
		return liste
			+ '<div class="' + esc(skin.hinweis) + '">Erst eine Wiki-Zuweisung setzen — danach lassen sich weitere hinzufügen.</div>'
			+ status;
	}
	return liste
		+ '<div class="wiki-weitere__titel">Weitere Wiki-Zuweisung für ' + esc(modell.umfang) + "</div>"
		+ '<input type="search" class="wiki-weitere__suche" data-weitere-suche placeholder="Wiki-Artikel suchen …" autocomplete="off">'
		+ '<div class="' + esc(skin.trefferListe) + '" data-weitere-treffer role="listbox" hidden></div>'
		+ '<div class="' + esc(skin.hinweis) + '">Eine weitere Zuweisung ändert den Wegnamen nie.</div>'
		+ status;
}

/**
 * REIN: die Suchtreffer als Listenzeilen -- Fund-Item 5 der ersten Pruefrunde. `<button>` bekam auf
 * der Editorseite den vollen Rahmen/Radius jedes Seitenknopfs (`:where(.avm-editor-body) button`)
 * und sah aus wie ein rundes Knoepfchen statt einer vollbreiten Zeile. Die Referenzform steht in
 * js/ui/wiki-assign.js (avesmapsWikiAssignTrefferMarkup): `role="option"` in einem `role="listbox"`,
 * kein <button>.
 */
function avesmapsWikiWeitereTrefferMarkup(treffer, skin) {
	const esc = avesmapsWikiWeitereEsc;
	if (!treffer.length) {
		return '<div class="' + esc(skin.hinweis) + '">Kein passender Wiki-Weg.</div>';
	}
	return treffer.map((t) => '<div class="' + esc(skin.treffer) + '" role="option" tabindex="0" aria-selected="false" data-weitere-hinzu="'
		+ esc(t.wiki_key) + '">'
		+ '<div class="' + esc(skin.trefferName) + '">' + esc(t.name || t.wiki_key) + "</div>"
		+ '<div class="' + esc(skin.trefferMeta) + '">' + esc([t.art, t.wiki_key].filter(Boolean).join(" · ")) + "</div></div>").join("");
}

function avesmapsWikiWeitereKastenMount(host, opts) {
	const skin = typeof opts.skin === "object" && opts.skin !== null ? opts.skin : avesmapsWikiWeitereSkin(opts.skin);
	const holen = opts.fetchImpl || ((url, init) => fetch(url, init));
	let tippTimer = null;
	// Fund-Item 3 der ersten Pruefrunde: ein Doppelklick auf ✕ oder ein Treffer darf nicht zwei
	// gleichzeitige Schreibvorgaenge ausloesen -- solange einer laeuft, werden weitere Klicks/Tasten
	// stillschweigend verworfen. Freigegeben wird in BEIDEN Ausgaengen (`.finally`).
	let schreibtGerade = false;
	// Fund-Item 2: eine fortlaufende Nummer je Suchlauf. Nur die JUENGSTE Antwort darf die Liste
	// setzen -- das Netz ist keine Warteschlange, eine spaete Antwort auf ein laengst verlassenes
	// Wort darf ein neueres Ergebnis nie ueberschreiben.
	let suchLaufNr = 0;

	function modell() {
		const abschnitte = (opts.abschnitte && opts.abschnitte()) || [];
		const gesamt = opts.gesamtText ? opts.gesamtText() : "ganze Straße";
		return {
			hauptKey: String((opts.hauptKey && opts.hauptKey()) || ""),
			umfang: String((opts.umfangText && opts.umfangText()) || ""),
			zuordnungen: avesmapsWikiWeitereZuordnungen(abschnitte, gesamt),
			abschnitte,
		};
	}
	function status(text) {
		const zeile = host.querySelector("[data-weitere-status]");
		if (zeile) { zeile.textContent = text; }
	}
	function zeichnen() {
		host.innerHTML = avesmapsWikiWeitereMarkup(modell(), skin);
	}
	function schreiben(modus, wikiKey, publicIds) {
		if (schreibtGerade) { return Promise.resolve(); }
		schreibtGerade = true;
		status(modus === "add" ? "Wird zugewiesen …" : "Wird entfernt …");
		return holen(AVESMAPS_WIKI_WEITERE_URL, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify(avesmapsWikiWeitereKoerper(modus, wikiKey, publicIds)),
		})
			.then((antwort) => antwort.json().then((daten) => {
				if (!antwort.ok || !daten || daten.ok !== true) {
					const meldung = daten && daten.error ? (daten.error.message || daten.error) : "HTTP " + antwort.status;
					throw new Error(String(meldung));
				}
				return daten;
			}))
			.then((daten) => {
				// Fund-Item 1: {ok:true, applied, skipped} ist KEIN unqualifizierter Erfolg -- die
				// eigene Statuszeile nennt, was wirklich geschah (siehe avesmapsWikiWeitereErgebnisText).
				status(avesmapsWikiWeitereErgebnisText(modus, daten, modell().abschnitte));
				return Promise.resolve(opts.geschrieben ? opts.geschrieben(daten) : null).then(() => daten);
			})
			.catch((fehler) => {
				status("Fehlgeschlagen: " + (fehler && fehler.message ? fehler.message : fehler));
			})
			.finally(() => { schreibtGerade = false; });
	}
	function suchen(text) {
		const liste = host.querySelector("[data-weitere-treffer]");
		if (!liste) { return; }
		const suchtext = String(text || "").trim();
		suchLaufNr += 1;
		const eigeneNr = suchLaufNr;
		if (suchtext === "") { liste.hidden = true; liste.innerHTML = ""; return; }
		const url = AVESMAPS_WIKI_WEITERE_URL + "?action=search&q=" + encodeURIComponent(suchtext) + "&limit=" + AVESMAPS_WIKI_WEITERE_TREFFER_LIMIT;
		holen(url, { credentials: "same-origin", headers: { Accept: "application/json" } })
			.then((antwort) => antwort.json())
			.then((daten) => {
				// Fund-Item 2: veraltete Antwort verwerfen -- weder die JUENGSTE Anfrage noch, falls
				// das Suchfeld inzwischen einen anderen Text traegt, ueberhaupt noch passend.
				if (eigeneNr !== suchLaufNr) { return; }
				const eingabe = host.querySelector("[data-weitere-suche]");
				if (eingabe && String(eingabe.value == null ? "" : eingabe.value).trim() !== suchtext) { return; }
				const m = modell();
				const treffer = avesmapsWikiWeitereTrefferFiltern(daten && daten.rows, m.hauptKey, m.zuordnungen.map((z) => z.wiki_key));
				liste.innerHTML = avesmapsWikiWeitereTrefferMarkup(treffer, skin);
				liste.hidden = false;
			})
			.catch((fehler) => {
				if (eigeneNr !== suchLaufNr) { return; }
				status("Suche fehlgeschlagen: " + (fehler && fehler.message ? fehler.message : fehler));
			});
	}
	function klick(ereignis) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.closest !== "function") { return; }
		const weg = ziel.closest("[data-weitere-weg]");
		if (weg) {
			const zuordnung = modell().zuordnungen.find((z) => z.wiki_key === weg.dataset.weitereWeg);
			if (zuordnung) { schreiben("remove", zuordnung.wiki_key, zuordnung.publicIds); }
			return;
		}
		const hinzu = ziel.closest("[data-weitere-hinzu]");
		if (hinzu) {
			schreiben("add", hinzu.dataset.weitereHinzu, modell().abschnitte.map((a) => a.public_id));
		}
	}
	function tippen(ereignis) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.matches !== "function" || !ziel.matches("[data-weitere-suche]")) { return; }
		clearTimeout(tippTimer);
		const text = ziel.value;
		tippTimer = setTimeout(() => suchen(text), AVESMAPS_WIKI_WEITERE_TIPP_PAUSE_MS);
	}
	// Fund-Item 5: ein Treffer ist kein <button> mehr, sondern `role="option"` mit `tabindex="0"` --
	// Enter/Leertaste muessen ihn deshalb selbst auswaehlen (ein <div> hat kein eingebautes Klicken
	// auf Tastendruck). Leertaste bekommt `preventDefault` (sonst scrollt die Seite), Enter nicht.
	function tastatur(ereignis) {
		const taste = ereignis && ereignis.key;
		if (taste !== "Enter" && taste !== " ") { return; }
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.closest !== "function") { return; }
		const hinzu = ziel.closest("[data-weitere-hinzu]");
		if (!hinzu) { return; }
		if (taste === " ") { ereignis.preventDefault(); }
		schreiben("add", hinzu.dataset.weitereHinzu, modell().abschnitte.map((a) => a.public_id));
	}

	// Die Huelle traegt ihre Klasse: an ihr haengt die Trennlinie zur Hauptzuweisung darueber
	// (css/components/wiki-weitere-kasten.css, Nachtrag §9.5).
	if (host.classList && typeof host.classList.add === "function") { host.classList.add("wiki-weitere-kasten"); }
	host.addEventListener("click", klick);
	host.addEventListener("input", tippen);
	host.addEventListener("keydown", tastatur);
	zeichnen();
	return {
		neuZeichnen: zeichnen,
		zerstoeren() {
			clearTimeout(tippTimer);
			host.removeEventListener("click", klick);
			host.removeEventListener("input", tippen);
			host.removeEventListener("keydown", tastatur);
			if (host.classList && typeof host.classList.remove === "function") { host.classList.remove("wiki-weitere-kasten"); }
			host.innerHTML = "";
		},
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWikiWeitereZuordnungen,
		avesmapsWikiWeitereKoerper,
		avesmapsWikiWeitereTrefferFiltern,
		avesmapsWikiWeitereErgebnisText,
		avesmapsWikiWeitereSkin,
		avesmapsWikiWeitereMarkup,
		avesmapsWikiWeitereTrefferMarkup,
		avesmapsWikiWeitereKastenMount,
	};
}
