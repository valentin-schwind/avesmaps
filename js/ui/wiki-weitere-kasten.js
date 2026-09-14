// Der Kasten „Weitere Wiki-Zuweisungen" -- EIN Bauteil fuer den Wege-Editor (Huelle „dt") und den
// Kartendialog „Weg bearbeiten" (Huelle „label-wiki").
// Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §2.3, §3.5.
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

/** Die Klassen der Huelle: die der Wiki-Zuweisung plus eine Ueberschrift im Stil des Wirts. */
function avesmapsWikiWeitereSkin(name) {
	const basis = typeof avesmapsWikiAssignSkin === "function" ? (avesmapsWikiAssignSkin(name) || {}) : {};
	return { ...basis, titel: name === "dt" ? "dt-grp" : "label-edit-section-title" };
}

/** REIN: der Kasten als HTML. modell = {hauptKey, umfang, zuordnungen, haupt?, hauptWo?}. */
function avesmapsWikiWeitereMarkup(modell, skin) {
	const esc = avesmapsWikiWeitereEsc;
	const kopf = '<div class="' + esc(skin.titel) + '">Weitere Wiki-Zuweisungen</div>';
	if (!modell.hauptKey) {
		return kopf + '<div class="' + esc(skin.hinweis) + '">Erst eine Wiki-Zuweisung setzen — danach lassen sich weitere hinzufügen.</div>';
	}
	const artikel = (z) => (z.wiki_url
		? '<a class="' + esc(skin.link) + '" href="' + esc(z.wiki_url) + '" target="_blank" rel="noopener">' + esc(z.name) + " ↗</a>"
		: esc(z.name))
		+ ' <span class="wiki-weitere__schluessel">' + esc(z.wiki_key) + "</span>";
	// Entwurf §3.5: zuerst die Hauptzuweisung -- ohne ✕, geloest wird sie im Kasten „Wiki-Weg" darueber.
	const haupt = modell.haupt && modell.haupt.wiki_key
		? '<tr class="wiki-weitere__haupt"><td class="wiki-weitere__wo">' + esc(modell.hauptWo || "") + "</td><td>" + artikel(modell.haupt)
			+ '</td><td class="wiki-weitere__art">Hauptzuweisung</td></tr>'
		: "";
	const zeilen = haupt + modell.zuordnungen.map((z) => '<tr><td class="wiki-weitere__wo">' + esc(z.wo) + "</td><td>" + artikel(z) + "</td>"
		+ '<td class="wiki-weitere__art">weitere <button type="button" class="wiki-weitere__weg" data-weitere-weg="' + esc(z.wiki_key)
		+ '" aria-label="Weitere Zuweisung ' + esc(z.name) + ' entfernen">✕</button></td></tr>').join("");
	return kopf
		+ (zeilen ? '<table class="wiki-weitere">' + zeilen + "</table>" : "")
		+ '<div class="wiki-weitere__titel">Weitere Wiki-Zuweisung für ' + esc(modell.umfang) + "</div>"
		+ '<input type="search" class="wiki-weitere__suche" data-weitere-suche placeholder="Wiki-Artikel suchen …" autocomplete="off">'
		+ '<div class="' + esc(skin.trefferListe) + '" data-weitere-treffer hidden></div>'
		+ '<div class="' + esc(skin.hinweis) + '">Zuweisen und Entfernen wirken sofort — ohne „Speichern“. Eine weitere Zuweisung ändert den Wegnamen nie.</div>'
		+ '<div class="' + esc(skin.hinweis) + '" data-weitere-status role="status" aria-live="polite"></div>';
}

/** REIN: die Suchtreffer als Knoepfe. */
function avesmapsWikiWeitereTrefferMarkup(treffer, skin) {
	const esc = avesmapsWikiWeitereEsc;
	if (!treffer.length) {
		return '<div class="' + esc(skin.hinweis) + '">Kein passender Wiki-Weg.</div>';
	}
	return treffer.map((t) => '<button type="button" class="' + esc(skin.treffer) + '" data-weitere-hinzu="' + esc(t.wiki_key) + '">'
		+ '<span class="' + esc(skin.trefferName) + '">' + esc(t.name || t.wiki_key) + "</span>"
		+ '<span class="' + esc(skin.trefferMeta) + '">' + esc([t.art, t.wiki_key].filter(Boolean).join(" · ")) + "</span></button>").join("");
}

function avesmapsWikiWeitereKastenMount(host, opts) {
	const skin = typeof opts.skin === "object" && opts.skin !== null ? opts.skin : avesmapsWikiWeitereSkin(opts.skin);
	const holen = opts.fetchImpl || ((url, init) => fetch(url, init));
	let tippTimer = null;

	function modell() {
		const abschnitte = (opts.abschnitte && opts.abschnitte()) || [];
		const gesamt = opts.gesamtText ? opts.gesamtText() : "ganze Straße";
		const umfang = String((opts.umfangText && opts.umfangText()) || "");
		return {
			hauptKey: String((opts.hauptKey && opts.hauptKey()) || ""),
			haupt: opts.haupt ? opts.haupt() : null,
			// Wo die Hauptzuweisung gilt: bei mehreren Abschnitten die ganze Strasse, sonst dieser eine Abschnitt.
			hauptWo: abschnitte.length > 1 ? gesamt : String((abschnitte[0] && abschnitte[0].label) || umfang),
			umfang,
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
			.then((daten) => Promise.resolve(opts.geschrieben ? opts.geschrieben(daten) : null).then(() => daten))
			.catch((fehler) => {
				status("Fehlgeschlagen: " + (fehler && fehler.message ? fehler.message : fehler));
			});
	}
	function suchen(text) {
		const liste = host.querySelector("[data-weitere-treffer]");
		if (!liste) { return; }
		const suchtext = String(text || "").trim();
		if (suchtext === "") { liste.hidden = true; liste.innerHTML = ""; return; }
		const url = AVESMAPS_WIKI_WEITERE_URL + "?action=search&q=" + encodeURIComponent(suchtext) + "&limit=" + AVESMAPS_WIKI_WEITERE_TREFFER_LIMIT;
		holen(url, { credentials: "same-origin", headers: { Accept: "application/json" } })
			.then((antwort) => antwort.json())
			.then((daten) => {
				const m = modell();
				const treffer = avesmapsWikiWeitereTrefferFiltern(daten && daten.rows, m.hauptKey, m.zuordnungen.map((z) => z.wiki_key));
				liste.innerHTML = avesmapsWikiWeitereTrefferMarkup(treffer, skin);
				liste.hidden = false;
			})
			.catch((fehler) => { status("Suche fehlgeschlagen: " + (fehler && fehler.message ? fehler.message : fehler)); });
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

	host.addEventListener("click", klick);
	host.addEventListener("input", tippen);
	zeichnen();
	return {
		neuZeichnen: zeichnen,
		zerstoeren() {
			clearTimeout(tippTimer);
			host.removeEventListener("click", klick);
			host.removeEventListener("input", tippen);
			host.innerHTML = "";
		},
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWikiWeitereZuordnungen,
		avesmapsWikiWeitereKoerper,
		avesmapsWikiWeitereTrefferFiltern,
		avesmapsWikiWeitereSkin,
		avesmapsWikiWeitereMarkup,
		avesmapsWikiWeitereTrefferMarkup,
		avesmapsWikiWeitereKastenMount,
	};
}
