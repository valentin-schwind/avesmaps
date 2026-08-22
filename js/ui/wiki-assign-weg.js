// Der Datenweg des WEGS -- EINE Fassung fuer BEIDE Oberflaechen (Kartendialog + Wege-Editor).
//
// Entwurf: docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md
// Bauteil: js/ui/wiki-assign.js -- das weiss nichts ueber Wege. Was objektart-eigen ist, steht hier.
//
// 💣 WARUM DIESE DATEI UEBERHAUPT EXISTIERT: der Weg ist die erste Objektart mit ZWEI Oberflaechen
// in ZWEI Dokumenten. Der Kartendialog laeuft in index.html, der Wege-Editor in einem iframe
// (html/wege-editor.html) mit eigenem `window` -- keine der beiden kann eine Funktion der anderen
// sehen. Ohne diese Datei stuende die Abbildung „Wiki-Art -> Wegtyp“ ZWEIMAL da, und genau daran
// ist die Listenzeile siebenmal auseinandergelaufen (AGENTS.md §11).
//
// 🔴 SIE IST REIN: kein DOM, kein `fetch`, kein Zustand. Beide Oberflaechen bringen ihren eigenen
// Netzweg mit und schicken die Antwort hier durch die Pruefung.

// ── Wiki-Art -> Wegtyp ────────────────────────────────────────────────────────────────────────
// 💣 DIE ORDNUNG IST BEDEUTUNG: „Reichsstraße“ traegt „straße“ in sich, „Wüstenpfad“ traegt „pfad“.
// Wer die Liste umsortiert, macht aus jeder Reichsstrasse eine Strasse. Uebernommen aus
// pathWikiGuessWegtyp (js/review/review-path-wiki.js, Stand 16.08.2026) -- gleiche Muster, gleiche
// Reihenfolge.
const AVESMAPS_WIKI_ASSIGN_WEG_ART_MUSTER = [
	{ muster: /reichsstra/i, wegtyp: "Reichsstrasse" },
	{ muster: /gebirgspass|gebirgs|\bpass\b/i, wegtyp: "Gebirgspass" },
	{ muster: /(wüsten|wuesten)pfad/i, wegtyp: "Wuestenpfad" },
	{ muster: /pfad/i, wegtyp: "Pfad" },
	{ muster: /stra(ß|ss)e/i, wegtyp: "Strasse" },
];

function avesmapsWikiAssignWegText(wert) {
	return String(wert === null || wert === undefined ? "" : wert).trim();
}

/** REIN: „Fluss“ / „Straße/Weg“ -- die erste Angabe der Trefferzeile. Wortgleich zu dem, was der
 *  Weg-Picker seit jeher zeigt (pathWikiKindLabel). */
function avesmapsWikiAssignWegKindLabel(kind) {
	const wert = avesmapsWikiAssignWegText(kind).toLowerCase();
	if (wert === "fluss") {
		return "Fluss";
	}
	return wert === "strasse" ? "Straße/Weg" : "";
}

/**
 * REIN: die Wiki-Art (freier Text) auf einen Wegtyp-SCHLUESSEL abbilden. Leer heisst „das Wiki
 * sagt dazu nichts“.
 *
 * 🔴 DAS IST DER GRUND, WARUM DIE SYNC-VORSCHAU NICHT DIREKT `art` GEGEN `feature_subtype`
 * VERGLEICHEN DARF. `art` ist freier Wikitext („Reichsstraße“, mit ß), `feature_subtype` ist ein
 * stabiler Schluessel aus PATH_SUBTYPE_KEYS („Reichsstrasse“, mit ss). Roh verglichen sind die
 * beiden IMMER verschieden, und die Vorschau boete an, „Reichsstraße“ in ein Feld zu schreiben,
 * das den Wert nie annehmen darf. Deshalb traegt die Erklaerung ein eigenes Wiki-Feld `wegtyp`,
 * und diese Funktion fuellt es -- verglichen wird also genau der Wert, der geschrieben wuerde.
 *
 * 💣 KEIN RUECKFALL. pathWikiGuessWegtyp gab bei unbekannter Art „Strasse“ zurueck (und bei einem
 * Fluss „Flussweg“). Als Vorbelegung eines Auswahlfelds war das vertretbar; als Sync-Vorschlag ist
 * es eine Vermutung, die echte Daten schreibt: aus einer gepflegten „Reichsstrasse“ wuerde
 * kommentarlos eine „Strasse“, sobald die Wiki-Art „Handelsweg“ heisst. Unbekannt heisst hier
 * deshalb `""` -- die Diff-Rechnung macht daraus die Zeile „das Wiki sagt nichts — würde die
 * Angabe leeren“, und die ist NIE vorangehakt (Aufgabe 2).
 *
 * 💣 EIN WIKI-FLUSS SAGT UEBER UNSERE UNTERSCHEIDUNG FLUSSWEG/SEEWEG NICHTS. Das Wiki kennt
 * „Fluss“ als Art des Artikels, nicht als Wegtyp der Karte; der alte Rueckfall auf „Flussweg“
 * haette jeden zugewiesenen SEEWEG zum Flussweg heruntergestuft. Der Typriegel des Servers
 * (avesmapsWikiPathAssignTo) laesst einen Wiki-Fluss ohnehin nur an Flussweg/Seeweg -- die Karte
 * weiss also bereits mehr als das Wiki.
 */
function avesmapsWikiAssignWegWegtyp(art, kind) {
	if (avesmapsWikiAssignWegText(kind).toLowerCase() === "fluss") {
		return "";
	}
	const text = avesmapsWikiAssignWegText(art);
	if (text === "") {
		return "";
	}
	for (let i = 0; i < AVESMAPS_WIKI_ASSIGN_WEG_ART_MUSTER.length; i++) {
		if (AVESMAPS_WIKI_ASSIGN_WEG_ART_MUSTER[i].muster.test(text)) {
			return AVESMAPS_WIKI_ASSIGN_WEG_ART_MUSTER[i].wegtyp;
		}
	}
	return "";
}

/**
 * REIN: der Name, den der SERVER dem Weg gibt -- Spiegel von avesmapsWikiPathCanonicalName
 * (api/_internal/wiki/path-naming.php): der Staging-Name, sonst das entschluesselte
 * /wiki/<Seite>-Stueck der Adresse (Unterstriche werden Leerzeichen).
 *
 * ⚠️ Das ist kein Schoenheitsgriff: `assign_to` schreibt genau diesen Namen auf alle getroffenen
 * Segmente. Zeigte der Kasten den rohen Staging-Namen, staende im Zuweisungsblock ein anderer Name
 * als im Namensfeld daneben.
 */
function avesmapsWikiAssignWegKanonischerName(wiki) {
	if (!wiki) {
		return "";
	}
	const name = avesmapsWikiAssignWegText(wiki.name);
	if (name !== "") {
		return name;
	}
	const treffer = /\/wiki\/([^?#]+)/i.exec(avesmapsWikiAssignWegText(wiki.wiki_url));
	if (!treffer) {
		return "";
	}
	let seite = treffer[1];
	try {
		seite = decodeURIComponent(seite);
	} catch (fehler) {
		// Kaputte Prozentfolge -- dann eben das rohe Stueck.
	}
	return seite.replace(/_/g, " ").trim();
}

/**
 * REIN: die Werte, die die Erklaerung `weg` erwartet -- aus einer Suchzeile ODER aus dem
 * gespeicherten Nest `properties.wiki_path`. Beide tragen dieselben Spaltennamen (die Suche liest
 * die Staging-Tabelle, das Nest wird aus derselben Zeile gebaut,
 * avesmapsWikiPathBuildAssignObject), deshalb genuegt EIN Bauer.
 *
 * 🔴 `kind` und `wegtyp` sind ABGELEITET, nicht geliefert: `kind` wird zur Beschriftung, `wegtyp`
 * zum Schluessel. Sie stehen unter eigenen Namen, damit die rohe Wiki-Art daneben sichtbar bleibt
 * -- der Editor soll sehen, WAS das Wiki sagt und WOHIN das abgebildet wird.
 */
function avesmapsWikiAssignWegWerte(zeile) {
	const z = zeile || {};
	return {
		kind: avesmapsWikiAssignWegKindLabel(z.kind),
		art: avesmapsWikiAssignWegText(z.art),
		wegtyp: avesmapsWikiAssignWegWegtyp(z.art, z.kind),
		lage: avesmapsWikiAssignWegText(z.lage),
		laenge: avesmapsWikiAssignWegText(z.laenge),
	};
}

/**
 * REIN: eine Zeile der Server-Suche (`?action=search`) in die Treffer-Form des Bauteils.
 *
 * 💣 DAS IST DER ERSTE ECHTE NUTZER DES SERVER-ZWEIGS, und dort fehlte genau dieser Schritt: die
 * Antwortzeilen sind FLACH (`row.art`, `row.lage`), das Bauteil liest aber `treffer.werte[feld]`.
 * Ohne Aufbereitung blieben die Trefferzeile und -- schlimmer -- der Zuweisungskasten nach der
 * Wahl LEER, weil `trefferWaehlen` `treffer.werte` in den Artikel uebernimmt.
 */
function avesmapsWikiAssignWegTreffer(zeile) {
	const z = zeile || {};
	return {
		name: avesmapsWikiAssignWegKanonischerName(z) || avesmapsWikiAssignWegText(z.name),
		wiki_url: avesmapsWikiAssignWegText(z.wiki_url),
		wiki_key: avesmapsWikiAssignWegText(z.wiki_key),
		werte: avesmapsWikiAssignWegWerte(z),
		// Die rohe Zeile reist mit: `zuweisen` bekommt den Treffer und braucht sie fuer das
		// oertliche Nest, falls der Server kein `segments_updated` liefert.
		roh: z,
	};
}

/** REIN: das gespeicherte Nest `properties.wiki_path` in die Artikel-Form des Bauteils. */
function avesmapsWikiAssignWegArtikel(wikiPath) {
	if (!wikiPath || avesmapsWikiAssignWegText(wikiPath.wiki_key) === "") {
		return null;
	}
	return {
		name: avesmapsWikiAssignWegKanonischerName(wikiPath),
		wiki_url: avesmapsWikiAssignWegText(wikiPath.wiki_url),
		wiki_key: avesmapsWikiAssignWegText(wikiPath.wiki_key),
		werte: avesmapsWikiAssignWegWerte(wikiPath),
	};
}

/**
 * 🔴 DER ZUSTAND -- UND ER WIRFT, STATT ETWAS LEERES ZU LIEFERN.
 *
 * Das ist der Vertrag aus dem Kopfkommentar von js/ui/wiki-assign.js, hier zum ersten Mal
 * eingeloest: ein `laden`, das im Fehlerfall AUFLOEST, ist ununterscheidbar von „nichts
 * zugewiesen“. Das Bauteil malte dann den offenen Zustand, `lies()` gaebe Leerstrings -- und beim
 * Weg traefe ein „Speichern“ danach ALLE gleichnamigen Segmente zugleich. Eine Loeschung, die
 * niemand angeordnet hat.
 *
 * ⚠️ Beide Weg-Oberflaechen lesen ihren Stand aus dem SPEICHER (das Feature im Kartendialog, der
 * Entwurf im Editorfenster) -- hier laeuft also kein HTTP. Der Fehlerfall ist deshalb nicht „der
 * Server antwortet nicht“, sondern „es ist gar kein Weg gewaehlt“, und der wird genauso behandelt:
 * geworfen, nicht beschoenigt.
 *
 * 🔴 DER DRITTE ZUSTAND REIST MIT (`kein_artikel`), seit 16.08.2026 auch beim Weg. Er ist NICHT aus
 * der Zuweisung ableitbar: „keine Zuweisung“ heisst „noch niemand hat nachgesehen“, der Merker
 * heisst „jemand HAT nachgesehen und es gibt keinen“. Genau diese negative Aussage nimmt den Weg aus
 * der Beobachtungsliste des Konfliktzentrums (api/_internal/conflicts/rules.php) und laesst die
 * Anreicherung das Adressraten bleiben (api/app/map-features.php).
 *
 * @param {Object|null} quelle  { wiki_path, kein_artikel, feature_subtype }
 */
function avesmapsWikiAssignWegZustand(quelle) {
	if (!quelle || typeof quelle !== "object" || Array.isArray(quelle)) {
		throw new Error("Wiki-Weg: kein Weg gewählt — der Stand ist unbekannt.");
	}
	// Der heutige Stand auf der Karte. 🔴 Gelesen wird der Wert des FORMULARS, nicht der
	// gespeicherte: „Uebernehmen fuellt nur das Formular“ (Entwurf §6) -- eine zweite Vorschau muss
	// sehen, was die erste schon hineingeschrieben hat.
	//
	// 💣 UND ER WIRD ERST BEIM LESEN GEHOLT, wenn der Aufrufer eine Funktion uebergibt. Der Grund
	// ist eine stille Falschauskunft: `laden` laeuft EINMAL, die Sync-Vorschau entsteht erst beim
	// Druck auf „Sync“ -- dazwischen kann der Editor die Wegtyp-Auswahl angefasst haben. Mit einem
	// eingefrorenen Wert vergliche die Vorschau gegen einen Stand, den das Formular nicht mehr
	// zeigt, und boete „Strasse → Reichsstrasse“ an, waehrend dort laengst „Reichsstrasse“ steht.
	// Eine Eigenschaft mit Lesefunktion loest das ohne jede Aenderung am Bauteil: die Diff-Rechnung
	// liest `kartenwerte[feld.karte]` ganz normal.
	const kartenwerte = {};
	if (typeof quelle.feature_subtype === "function") {
		Object.defineProperty(kartenwerte, "feature_subtype", {
			enumerable: true,
			get: () => avesmapsWikiAssignWegText(quelle.feature_subtype()),
		});
	} else {
		kartenwerte.feature_subtype = avesmapsWikiAssignWegText(quelle.feature_subtype);
	}
	return {
		artikel: avesmapsWikiAssignWegArtikel(quelle.wiki_path),
		keinArtikel: quelle.kein_artikel === true,
		kartenwerte: kartenwerte,
		herkunft: avesmapsWikiAssignWegHerkunft(quelle.field_origins),
	};
}

/**
 * REIN: `properties.field_origins` -> die Herkunftskarte, gefiltert auf das EINE Kartenfeld des
 * Weges. Wortgleich zu den Fassungen bei Ort, Landschaft und Literatur -- und aus demselben Grund
 * gefiltert: ein Eintrag fuer ein Feld ohne Zeile waere Ballast in einer Karte, die ueber das
 * Vorhaekeln entscheidet.
 *
 * 🔴 `name` KOMMT HIER NICHT VOR, obwohl das Wiki einen Namen liefert. Den schreibt `assign_to`
 * serverseitig auf den ganzen Namensverbund -- das Formular kann ihn gar nicht gegen das Wiki
 * setzen, und eine Herkunft dafuer gehoert an die Zuweisung, nicht an das Speichern. Die
 * Serverliste AVESMAPS_PATH_WIKI_ORIGIN_FIELDS fuehrt ihn aus demselben Grund nicht; die zwei
 * muessen uebereinstimmen, sonst zeigt der Editor eine Zeile, deren Herkunft niemand fortschreibt.
 *
 * ⚠️ Alles ausser `'manual'`/`'wiki'` faellt heraus. Eine kuenftige dritte Herkunft darf weder die
 * Beschriftung faerben noch vorhaken, sondern muss auf „nicht bekannt" zurueckfallen.
 */
function avesmapsWikiAssignWegHerkunft(herkunft) {
	const h = (herkunft && typeof herkunft === "object" && !Array.isArray(herkunft)) ? herkunft : {};
	const wert = avesmapsWikiAssignWegText(h.feature_subtype);

	return (wert === "manual" || wert === "wiki") ? { feature_subtype: wert } : {};
}

/** REIN: der Rumpf der Zuweisung. Beide Oberflaechen schicken denselben -- mit `dry_run:false` UND
 *  `confirm:"apply"`, weil der Endpunkt sonst nur probeweise rechnet (api/edit/wiki/paths.php). */
function avesmapsWikiAssignWegZuweisungsKoerper(wikiKey, publicId) {
	return {
		action: "assign_to",
		wiki_key: avesmapsWikiAssignWegText(wikiKey),
		public_id: avesmapsWikiAssignWegText(publicId),
		dry_run: false,
		confirm: "apply",
	};
}

/**
 * 🔴 WIRFT BEI JEDEM NEIN DES SERVERS -- und `type_ok === false` IST ein Nein.
 *
 * 💣 Der Typriegel ist die Falle, die man nur einmal uebersieht: `assign_to` antwortet auf einen
 * Fluss-an-Strasse-Versuch mit HTTP 200 und `{"ok":true,"type_ok":false,"applied":0}`. Wer nur
 * `ok` prueft, loest auf -- und das Bauteil malt danach eine Zuweisung, die es auf dem Server
 * nicht gibt. Beim naechsten Oeffnen des Dialogs ist sie weg, und es sieht aus, als haette das
 * Speichern versagt.
 */
function avesmapsWikiAssignWegAntwortPruefen(antwort) {
	if (!antwort || typeof antwort !== "object" || Array.isArray(antwort) || antwort.ok !== true) {
		const meldung = antwort && antwort.error
			? (antwort.error.message || antwort.error)
			: "Unerwartete Antwort";
		throw new Error(String(meldung));
	}
	if (antwort.type_ok === false) {
		throw new Error(avesmapsWikiAssignWegText(antwort.message) || "Der Typ passt nicht.");
	}
	return antwort;
}

/**
 * REIN: welchen Wegtyp die angehakten Sync-Zeilen setzen wollen -- oder `null`.
 *
 * ⚠️ Es kann nur diese eine Zeile geben: `feature_subtype` ist das einzige Kartenziel der
 * Erklaerung `weg` (js/ui/wiki-assign-registry.js). Der Wert stammt aus
 * avesmapsWikiAssignWegWegtyp und ist damit per Konstruktion einer der fuenf Strassen-Schluessel
 * -- eine sechste Liste zulaessiger Werte waere eine weitere Abschrift von PATH_SUBTYPE_KEYS.
 */
function avesmapsWikiAssignWegSyncWegtyp(zeilen) {
	const liste = Array.isArray(zeilen) ? zeilen : [];
	for (let i = 0; i < liste.length; i++) {
		if (liste[i] && liste[i].karte === "feature_subtype") {
			const wert = avesmapsWikiAssignWegText(liste[i].neu);
			return wert === "" ? null : wert;
		}
	}
	return null;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_WIKI_ASSIGN_WEG_ART_MUSTER: AVESMAPS_WIKI_ASSIGN_WEG_ART_MUSTER,
		avesmapsWikiAssignWegKindLabel: avesmapsWikiAssignWegKindLabel,
		avesmapsWikiAssignWegWegtyp: avesmapsWikiAssignWegWegtyp,
		avesmapsWikiAssignWegKanonischerName: avesmapsWikiAssignWegKanonischerName,
		avesmapsWikiAssignWegWerte: avesmapsWikiAssignWegWerte,
		avesmapsWikiAssignWegTreffer: avesmapsWikiAssignWegTreffer,
		avesmapsWikiAssignWegArtikel: avesmapsWikiAssignWegArtikel,
		avesmapsWikiAssignWegZustand: avesmapsWikiAssignWegZustand,
		avesmapsWikiAssignWegHerkunft: avesmapsWikiAssignWegHerkunft,
		avesmapsWikiAssignWegZuweisungsKoerper: avesmapsWikiAssignWegZuweisungsKoerper,
		avesmapsWikiAssignWegAntwortPruefen: avesmapsWikiAssignWegAntwortPruefen,
		avesmapsWikiAssignWegSyncWegtyp: avesmapsWikiAssignWegSyncWegtyp,
	};
}
