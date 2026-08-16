// Die Wiki-Zuweisung — EIN Bauteil, das seine Felder aus einer Erklaerung liest.
//
// Entwurf: docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md
// Mockup:  docs/wiki-zuweisung-mockup.html (die Zielform, mit den echten Klassen)
// Bausteine: js/ui/wiki-assign-registry.js (Aufgabe 1) + js/ui/wiki-assign-diff.js (Aufgabe 2).
//
// Zehn Oberflaechen fuehren dieselbe Handlung aus („welcher Wiki-Artikel gehoert zu diesem
// Objekt“) und taten es in sechs Fassungen, rund 1.400 Zeilen. Dieses Bauteil weiss NICHTS ueber
// Orte, Wege oder Kraftlinien: Zustaende, Trefferliste, Sync-Vorschau und Diff fallen aus der
// Erklaerung ab.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DIE SCHNITTSTELLE — die Aufgaben 4–9 lesen GENAU diesen Block
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
//   const steuerung = avesmapsWikiAssignMount(behaelter, {
//       subject:         "kraftlinie",       // Schluessel im Feldregister (wiki-assign-registry.js)
//       skin:            "dt",               // "dt" (Editorfenster) | "label-wiki" (Kartendialog)
//       laden:           () => zustand,      // Wert ODER Promise — siehe ZUSTAND unten
//       zuweisen:        (treffer) => {},    // Wert ODER Promise; danach zeichnet das Bauteil neu
//       loesen:          () => {},           // Wert ODER Promise
//       syncUebernehmen: (zeilen) => {},     // NUR die angehakten Diff-Zeilen (Aufgabe 2)
//       keinArtikelGeaendert: (wert) => {},  // OPTIONAL — nur, wer sofort schreibt, braucht ihn
//   });
//
// 🔴 Eine Oberflaeche steuert NUR ihren Datenweg bei. Sie erfaehrt nie, welcher Zustand gerade
// gezeichnet ist, ob gesucht wird oder wie die Vorschau aussieht — sonst waere das Bauteil zum
// elften Mal nachgebaut, nur verteilt.
//
// ⚠️ WO DIE DREI DATEIEN GELADEN WERDEN MUESSEN: registry, diff, dann DIESE -- in der Reihenfolge.
// Ein Editorfenster ist ein iframe mit eigenem Dokument und bindet sie selbst (Vorbild:
// html/wiki-sync-powerline-editor.html). Fuer die Kartendialoge (Huelle `label-wiki`) gehoeren sie
// in die Skriptliste von index.html — dort stehen sie am 16.08.2026 noch NICHT, weil noch keine
// Kartenoberflaeche angeschlossen ist. Wer die erste anschliesst (Aufgabe 4), traegt sie ein.
//
// ZUSTAND (die Rueckgabe von `laden`), jede Angabe optional:
//   {
//     artikel:     { name, wiki_url, wiki_key, werte: {<wikiFeld>: wert} } | null,
//     keinArtikel: false,                     // der dritte Zustand (Entwurf §2.7)
//     kartenwerte: { <kartenFeld>: wert },    // heutiger Stand auf der Karte — fuer die Vorschau
//     handgesetzt: ["<kartenFeld>", …],       // von Hand korrigiert -> gelistet, NICHT gehakt
//     gesperrt:    { "<kartenFeld>": "Grund" },// z. B. parent_locked (Entwurf §7)
//     listen:      { "<quelle>": [<treffer>] },// nur bei `suche.art === "liste"`
//   }
//   Ein <treffer> ist { name, wiki_url, wiki_key, werte: {<wikiFeld>: wert}, haengtAn?: "…" }.
//
// 🪤 `haengtAn` fuellt der AUFRUFER, und Entwurf §5 sagt dazu etwas Falsches: „Die Label-Liste kann
// das heute schon, die anderen fuenf nicht." Sie kann es nicht. Am 16.08.2026 gemessen — der im
// Brief verlangte grep gegen js/review/review-label-wiki.js liefert NICHTS, und keiner der drei
// Server-Suchendpunkte gibt eine Belegt-Angabe heraus. Die Kraftlinien fuellen es exakt, weil ihr
// Editor alle Linien samt Zuweisung ohnehin im Speicher haelt; wer eine Objektart mit SERVER-Suche
// anschliesst, laesst das Feld weg, bis ein Endpunkt es liefert. 💣 Nicht raten und nicht
// nachbauen: eine erfundene Belegt-Anzeige, die manchmal stimmt, ist schlimmer als keine.
//
// RUECKGABE von `mount`:
//   lies()      -> { name, wiki_url, wiki_key, kein_artikel } — der Stand, den ein „Speichern“
//                  schreiben soll. Fuer Oberflaechen, die NICHT sofort schreiben (Kraftlinien:
//                  das Formular wird als Ganzes gespeichert), ist das der einzige Rueckkanal.
//   neuLaden()  -> ruft `laden` erneut und zeichnet neu.
//   zerstoeren()-> nimmt die Zuhoerer ab und leert den Behaelter.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// 💣 DER SYNC-KNOPF HAENGT AN DEN FELDERN, NICHT AM ABGLEICH (Entwurf §4). Die Kraftlinien haben
// einen Massenlauf, aber kein bearbeitbares Kartenfeld, das er fuellen koennte — dort erscheint
// kein Knopf. Die Erklaerung sagt das mit `sync: false`, und Aufgabe 1 haelt per Test fest, dass
// `sync` und das Vorhandensein von Feldzielen sich nie widersprechen.
//
// 💣 LEERE FELDER FALLEN WEG, sie stehen nicht leer da (Entwurf §4). Von fuenf geprueften
// Kraftlinien-Artikeln haben zwei Luecken („Madas Kelch“ fuehrt weder Staerke noch Laenge) — ein
// Kasten mit fester Zeilenzahl verspraeche, was das Wiki oft nicht hergibt.
//
// 💣 KEIN FREITEXTFELD FUER EINE ADRESSE (Entwurf §5). Wer eine Nicht-Wiki-Quelle hinterlegen
// will, tut das im Quellen-Abschnitt. Ein Zuweisungsfeld, in das man alles tippen kann, ist der
// Grund, warum bei den Kraftlinien ein Tippfehler unsichtbar blieb (15.08.2026). Das Suchfeld ist
// ein `type="search"`, es traegt KEINEN `value` in die Zuweisung und hat KEIN `<datalist>`.
//
// 🔴 ZWEI HUELLEN, UND DAS IST DIE OBERGRENZE (Entwurf §4a, dieselbe Regel wie bei den
// Listenzeilen, AGENTS.md §11): `.dt-*` im Editorfenster, `.label-wiki-*` im Kartendialog. Der
// Skin ist eine TABELLE — Klassennamen plus die drei Stellen, an denen die zwei Huellen
// verschiedene ELEMENTE benutzen (die Feldliste ist hier ein Raster aus `div`, dort ein `dl`).
// Ein dritter Skin ist verboten; wer eine Oberflaeche findet, in die keine der zwei passt, meldet
// das, statt eine dritte zu bauen.

// Wie viele Treffer hoechstens angeboten werden. Dieselbe Zahl, die die drei Server-Suchen seit
// jeher als `limit=40` schicken (js/review/review-label-wiki.js:215 u. a.) — nicht neu erfunden.
const AVESMAPS_WIKI_ASSIGN_TREFFER_LIMIT = 40;

// Wartezeit vor einer SERVER-Suche. Die Listensuche laeuft im Browser und wartet nicht.
const AVESMAPS_WIKI_ASSIGN_TIPP_PAUSE_MS = 180;

// Alle sichtbaren Woerter an EINER Stelle. Was objektart-abhaengig ist, steht nicht hier, sondern
// in der Erklaerung (`label`, `art`, `extra.keinArtikelHinweis`).
const AVESMAPS_WIKI_ASSIGN_TEXTE = {
	titel: "Wiki-Artikel",
	zuordnung: "Zuordnung",
	keine: "— keine —",
	artikel: "Artikel",
	schluessel: "Schlüssel",
	suchen: "Suchen",
	wikiLink: "Wiki ↗",
	zuweisen: "Zuweisen",
	aendern: "Ändern",
	sync: "Sync",
	entfernen: "Entfernen",
	abbrechen: "Abbrechen",
	keinArtikel: "Kein Wiki-Artikel vorhanden",
	keinArtikelHinweis: "Nimmt das Objekt aus der Konfliktliste — bis im Wiki einer auftaucht.",
	suchPlatzhalter: "Artikel suchen …",
	suchHinweis: "↑ ↓ wählen · Enter zuweisen · Esc schließt",
	keineTreffer: "Keine Treffer.",
	haengtAn: "hängt schon an",
	syncTitel: "Aus dem Wiki übernehmen",
	syncNichts: "Alles stimmt bereits mit dem Wiki überein — nichts zu übernehmen.",
	syncAlleAnhaken: "Alle anhaken",
	syncFuss: "Übernehmen füllt nur das Formular — gespeichert wird mit „Speichern“.",
};

// ── Die zwei Huellen ──────────────────────────────────────────────────────────────────────────
// 🔴 Eine TABELLE, keine zweite Umsetzung: derselbe Bauer liest sie, nur die Namen (und an drei
// Stellen der Elementname) wechseln.
//
// 💣 `wurzel` ist die Klasse, die das Bauteil SELBST erzeugt. Der Behaelter, den ein Aufrufer
// uebergibt, ist ein blankes `<div>` -- wer beim Anschliessen der Kartendialoge das vorhandene
// `<div class="label-wiki-reference">` aus index.html als Behaelter uebergibt, bekommt den Kasten
// doppelt geschachtelt (Rahmen im Rahmen, Polsterung doppelt). Behaelter hinein, Huelle heraus.
//
// ⚠️ Verdrahtet und geprueft ist in Aufgabe 3 nur `dt`. Die `label-wiki`-Zeile ist aus dem Bestand
// abgelesen (css/components/region-sync.css, js/review/review-label-wiki.js, index.html). Diese
// Namen gibt es dort heute noch NICHT und sie brauchen in Aufgabe 4 je eine Regel in
// region-sync.css — Vorlage ist jeweils die gleichnamige `.dt-*`-Regel in editor-page.css:
//   .label-wiki-reference__hint
//   .label-wiki-reference__check          (der dritte Zustand)
//   .label-wiki-picker-list__warn
//   .label-wiki-picker-list__item.is-active   (region-sync.css:163 kennt nur :hover -- OHNE diese
//                                              Regel waere die TASTATURAUSWAHL ↑ ↓ in dieser Huelle
//                                              unsichtbar, und die Tastatur ist der halbe Zweck)
//   .label-wiki-sync-rows / -row / -row__k / -row__alt / -row__pfeil / -row__neu / -row__grund
// 💣 Hier steht bewusst KEINE ZAHL. In der ersten Fassung stand „DREI ihrer Namen" -- es waren elf,
// und die zwei wichtigsten (der dritte Zustand und die Tastaturmarkierung) fehlten in der Liste.
// Eine Zahl liest sich wie eine vollstaendige Liste und niemand zaehlt nach; genau daran ist am
// 14.08.2026 die Verkehrsmittel-Sperre („ERZEUGER 1 VON 2") gescheitert (AGENTS.md §11).
// Wer hier etwas hinzufuegt, ergaenzt die Aufzaehlung.
const AVESMAPS_WIKI_ASSIGN_SKINS = {
	// Editorfenster (iframes). Regeln: css/components/editor-page.css.
	dt: {
		wurzel: "avm-wiki-assign",
		kopf: "dt-grp",
		kopfTitel: "",
		kopfKnoepfe: "dt-grp__sp",
		knopf: "",                     // blanker <button>: die Editorseiten stylen ihn weich/outline
		listeTag: "div",
		listeKlasse: "dt-grid",
		nameTag: "div",
		nameKlasse: "k",
		wertTag: "div",
		wertKlasse: "",
		link: "dt-link",
		haken: "dt-check",
		hinweis: "dt-hint",
		aktionen: "dt-actions",
		trefferListe: "dt-picker-list",
		treffer: "dt-picker-list__item",
		trefferAktiv: "is-active",
		trefferName: "dt-picker-list__name",
		trefferMeta: "dt-picker-list__meta",
		trefferWarn: "dt-picker-list__warn",
		trefferLeer: "dt-picker-list__empty",
		syncListe: "dt-sync-rows",
		syncZeile: "dt-sync-row",
		syncName: "dt-sync-row__k",
		syncAlt: "dt-sync-row__alt",
		syncPfeil: "dt-sync-row__pfeil",
		syncNeu: "dt-sync-row__neu",
		syncGrund: "dt-sync-row__grund",
	},
	// Kartendialoge. Regeln: css/components/region-sync.css.
	"label-wiki": {
		wurzel: "label-wiki-reference",
		kopf: "label-wiki-reference__head",
		kopfTitel: "label-wiki-reference__title",
		kopfKnoepfe: "label-wiki-reference__buttons",
		knopf: "location-report-form__button location-report-form__button--secondary",
		listeTag: "dl",
		listeKlasse: "label-wiki-reference__dl",
		nameTag: "dt",
		nameKlasse: "",
		wertTag: "dd",
		wertKlasse: "",
		link: "label-wiki-reference__link",
		haken: "label-wiki-reference__check",
		hinweis: "label-wiki-reference__hint",
		aktionen: "label-wiki-reference__buttons",
		trefferListe: "label-wiki-picker-list",
		treffer: "label-wiki-picker-list__item",
		trefferAktiv: "is-active",
		trefferName: "label-wiki-picker-list__name",
		trefferMeta: "label-wiki-picker-list__meta",
		trefferWarn: "label-wiki-picker-list__warn",
		trefferLeer: "label-wiki-picker-list__empty",
		syncListe: "label-wiki-sync-rows",
		syncZeile: "label-wiki-sync-row",
		syncName: "label-wiki-sync-row__k",
		syncAlt: "label-wiki-sync-row__alt",
		syncPfeil: "label-wiki-sync-row__pfeil",
		syncNeu: "label-wiki-sync-row__neu",
		syncGrund: "label-wiki-sync-row__grund",
	},
};

/** REIN: Huelle nachschlagen. Unbekannter Name -> null (kein Rueckfall auf `dt`: eine falsch
 *  geschriebene Huelle soll auffallen, nicht heimlich die andere sein). */
function avesmapsWikiAssignSkin(name) {
	return AVESMAPS_WIKI_ASSIGN_SKINS[name] || null;
}

// Eigener Maskierer: diese Datei laeuft auch in den Editor-iframes, und dort gibt es das globale
// `escapeHtml` der App nicht. 💣 Kein Rueckfall auf "unveraendert durchreichen" — ein Artikelname
// kommt aus dem Wiki, also von aussen.
function avesmapsWikiAssignEsc(wert) {
	return String(wert === null || wert === undefined ? "" : wert).replace(/[&<>"']/g, (zeichen) => ({
		"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
	}[zeichen]));
}

function avesmapsWikiAssignText(wert) {
	return String(wert === null || wert === undefined ? "" : wert).trim();
}

// 💣 Eine Adresse kommt aus dem Wiki-Dump, also von aussen, und landet in einem `href`. Maskieren
// allein reicht dort NICHT: `javascript:` ueberlebt jede Maskierung. Durch duerfen nur http/https.
function avesmapsWikiAssignSichereUrl(wert) {
	const url = avesmapsWikiAssignText(wert);
	return /^https?:\/\//i.test(url) ? url : "";
}

/**
 * REIN: Die Beschriftung einer Feldzeile. Reihenfolge aus der Schnittstelle von Aufgabe 1: fehlt
 * `label`, gilt der `karte`-Name — und wenn auch der leer ist (Anzeige-Zeile ohne Ziel, wie bei
 * den Kraftlinien), bleibt der Wiki-Feldname.
 */
function avesmapsWikiAssignFeldLabel(feld) {
	return avesmapsWikiAssignText(feld && feld.label)
		|| avesmapsWikiAssignText(feld && feld.karte)
		|| avesmapsWikiAssignText(feld && feld.wiki);
}

/**
 * REIN: Die zweite Zeile eines Treffers. Die Erklaerung sagt mit `treffer: [...]`, WELCHE
 * Wiki-Felder sie bilden; `art` stellt die Objektart voran (Mockup: „Kraftlinie · kontinental ·
 * Maraskan“). 💣 Leere Werte fallen auch hier weg — der zweite Treffer im Mockup traegt genau
 * deshalb nur zwei Teile.
 */
function avesmapsWikiAssignTrefferMeta(erklaerung, treffer) {
	const felder = Array.isArray(erklaerung && erklaerung.treffer) ? erklaerung.treffer : [];
	const werte = (treffer && treffer.werte) || {};
	const teile = [];
	const art = avesmapsWikiAssignText(erklaerung && erklaerung.art);
	if (art !== "") {
		teile.push(art);
	}
	felder.forEach((feld) => {
		const wert = avesmapsWikiAssignText(werte[feld]);
		if (wert !== "") {
			teile.push(wert);
		}
	});
	return teile.join(" · ");
}

/**
 * REIN: Aus Erklaerung + Daten + Bedienzustand faellt das Modell, das gezeichnet wird. KEIN DOM,
 * kein `fetch` — genau deshalb sind die Entscheidungen ohne Browser pruefbar (dasselbe Muster wie
 * js/ui/filter-bar.js).
 *
 * @param {Object} erklaerung  aus avesmapsWikiAssignSubject(subject)
 * @param {Object} daten       die Rueckgabe von `laden` (siehe Kopf)
 * @param {Object} ui          { modus, suchtext, treffer, aktiv, syncZeilen }
 */
function avesmapsWikiAssignModell(erklaerung, daten, ui) {
	const e = erklaerung || {};
	const d = daten || {};
	const z = ui || {};
	const artikel = d.artikel || null;
	const felder = Array.isArray(e.felder) ? e.felder : [];
	const modus = z.modus || (artikel ? "zugewiesen" : "offen");

	// Die Kennung der Trefferliste. Sie verbindet Suchfeld und Liste fuer Hilfsmittel
	// (`aria-controls`/`aria-activedescendant`) und muss je Bauteil eindeutig sein -- auf einer Seite
	// koennen mehrere stehen. `mount` reicht eine laufende Nummer herein; der Rueckfall ist nur fuer
	// die reinen Proben da.
	const listenId = avesmapsWikiAssignText(z.listenId) || "avm-wiki-assign-liste";

	const modell = {
		modus: modus,
		titel: avesmapsWikiAssignText(e.label) || AVESMAPS_WIKI_ASSIGN_TEXTE.titel,
		listenId: listenId,
		aktiveId: "",
		knoepfe: [],
		felder: [],
		suchfeld: null,
		treffer: [],
		trefferLeerText: "",
		hinweis: "",
		haken: null,
		syncZeilen: [],
		syncAktionen: [],
	};

	if (modus === "sync") {
		// 💣 Nur Unterschiede stehen in der Liste (Aufgabe 2). Ist sie leer, kommt EIN Satz statt
		// einer leeren Haekchenliste.
		modell.titel = AVESMAPS_WIKI_ASSIGN_TEXTE.syncTitel;
		// ⚠️ BEWUSSTE ABWEICHUNG vom Mockup: dort traegt die Karte „Sync gedrückt · nichts zu tun"
		// (docs/wiki-zuweisung-mockup.html:234-238) keinen „Abbrechen"-Knopf. Ein Standbild braucht
		// keinen Ausgang, eine Oberflaeche schon -- ohne ihn bliebe der Kasten in der Vorschau
		// stehen und die Zuweisung waere unerreichbar. Der Knopf steht deshalb in BEIDEN Faellen.
		modell.knoepfe.push({ aktion: "abbrechen", text: AVESMAPS_WIKI_ASSIGN_TEXTE.abbrechen });
		// 🔴 Hier steht der Hinweis OBEN, nicht wie sonst unten (Mockup, Karte „Sync gedrückt"): er
		// sagt, was die Liste darunter ueberhaupt ist. Unter den Knoepfen gelesen kaeme er zu spaet.
		modell.hinweisOben = true;
		modell.syncZeilen = Array.isArray(z.syncZeilen) ? z.syncZeilen : [];
		if (modell.syncZeilen.length === 0) {
			modell.hinweis = AVESMAPS_WIKI_ASSIGN_TEXTE.syncNichts;
			return modell;
		}
		const gehakt = modell.syncZeilen.filter((zeile) => zeile.gehakt).length;
		// 💣 Der Nenner zaehlt nur Felder MIT Kartenziel. Anzeige-Zeilen (`karte: ""`) koennen sich
		// per Definition nie aendern -- sie mitzuzaehlen liesse „2 von 6" dastehen, wo es nur zwei
		// veraenderbare Angaben gibt, und der Satz waere lautlos falsch.
		const veraenderbar = felder.filter((feld) => String((feld && feld.karte) || "") !== "").length;
		modell.hinweis = modell.syncZeilen.length + " von " + veraenderbar
			+ " Angaben würden sich ändern. Angehakt wird übernommen.";
		modell.syncAktionen = [
			{ aktion: "sync-uebernehmen", text: gehakt + (gehakt === 1 ? " Angabe übernehmen" : " Angaben übernehmen"), aus: gehakt === 0 },
			{ aktion: "sync-alle", text: AVESMAPS_WIKI_ASSIGN_TEXTE.syncAlleAnhaken },
		];
		modell.fuss = AVESMAPS_WIKI_ASSIGN_TEXTE.syncFuss;
		return modell;
	}

	if (modus === "suche") {
		modell.knoepfe.push({ aktion: "abbrechen", text: AVESMAPS_WIKI_ASSIGN_TEXTE.abbrechen });
		modell.suchfeld = {
			label: AVESMAPS_WIKI_ASSIGN_TEXTE.suchen,
			wert: avesmapsWikiAssignText(z.suchtext),
			platzhalter: AVESMAPS_WIKI_ASSIGN_TEXTE.suchPlatzhalter,
		};
		const rohe = Array.isArray(z.treffer) ? z.treffer : [];
		modell.treffer = rohe.map((treffer, index) => ({
			index: index,
			id: listenId + "-" + index,
			name: avesmapsWikiAssignText(treffer && treffer.name) || avesmapsWikiAssignText(treffer && treffer.wiki_url),
			meta: avesmapsWikiAssignTrefferMeta(e, treffer),
			// 🔴 Ein Treffer sagt IM Treffer, wenn er schon woanders haengt — vor dem Klick, nicht
			// danach (Entwurf §5). Woher: aus der Suche. Liefert sie nichts, bleibt die Zeile leer;
			// eine erfundene Belegt-Anzeige waere schlimmer als keine.
			warnung: avesmapsWikiAssignText(treffer && treffer.haengtAn) === ""
				? ""
				: AVESMAPS_WIKI_ASSIGN_TEXTE.haengtAn + " „" + avesmapsWikiAssignText(treffer.haengtAn) + "“",
			aktiv: index === (typeof z.aktiv === "number" ? z.aktiv : 0),
		}));
		// Auf welchen Treffer zeigt `aria-activedescendant`? Ohne Treffer auf keinen -- ein Verweis
		// auf eine Kennung, die es nicht gibt, ist fuer ein Hilfsmittel schlimmer als keiner.
		const aktiver = modell.treffer.filter((treffer) => treffer.aktiv)[0];
		modell.aktiveId = aktiver ? aktiver.id : "";
		modell.trefferLeerText = AVESMAPS_WIKI_ASSIGN_TEXTE.keineTreffer;
		// „Treffer" heisst im Deutschen in beiden Zahlen gleich -- keine Mehrzahlweiche noetig.
		// ⚠️ Der Leerfall steht seit 16.08.2026 AUCH hier: der Kasten mit „Keine Treffer." ist fuer
		// Hilfsmittel ausgeblendet (role=presentation, siehe Trefferlisten-Bauer), also muss die
		// Auskunft an der Stelle stehen, die ohnehin die Trefferzahl traegt.
		modell.hinweis = (modell.treffer.length === 0
			? "Keine Treffer · "
			: modell.treffer.length + " Treffer · ") + AVESMAPS_WIKI_ASSIGN_TEXTE.suchHinweis;
		return modell;
	}

	if (modus === "zugewiesen" && artikel) {
		modell.knoepfe.push({ aktion: "aendern", text: AVESMAPS_WIKI_ASSIGN_TEXTE.aendern });
		// 💣 Der Knopf haengt an den FELDERN, nicht am Abgleich: `sync: false` heisst „es gaebe
		// nichts ins Formular zu holen“, und dann steht dort auch kein Knopf.
		if (e.sync === true) {
			modell.knoepfe.push({ aktion: "sync", text: AVESMAPS_WIKI_ASSIGN_TEXTE.sync });
		}
		modell.knoepfe.push({ aktion: "entfernen", text: AVESMAPS_WIKI_ASSIGN_TEXTE.entfernen });

		const werte = artikel.werte || {};
		const zeilen = [{
			label: AVESMAPS_WIKI_ASSIGN_TEXTE.artikel,
			wert: avesmapsWikiAssignText(artikel.name) || avesmapsWikiAssignText(artikel.wiki_url),
			link: avesmapsWikiAssignSichereUrl(artikel.wiki_url),
		}, {
			label: AVESMAPS_WIKI_ASSIGN_TEXTE.schluessel,
			wert: avesmapsWikiAssignText(artikel.wiki_key),
			link: "",
		}];
		felder.forEach((feld) => {
			zeilen.push({
				label: avesmapsWikiAssignFeldLabel(feld),
				wert: avesmapsWikiAssignText(werte[feld && feld.wiki]),
				link: "",
			});
		});
		// 💣 Leere Felder fallen weg — sie stehen nicht leer da.
		modell.felder = zeilen.filter((zeile) => zeile.wert !== "");
	} else {
		modell.knoepfe.push({ aktion: "zuweisen", text: AVESMAPS_WIKI_ASSIGN_TEXTE.zuweisen });
		modell.felder = [{
			label: AVESMAPS_WIKI_ASSIGN_TEXTE.zuordnung,
			wert: AVESMAPS_WIKI_ASSIGN_TEXTE.keine,
			link: "",
		}];
	}

	// Der dritte Zustand gilt fuer ALLE Objektarten (Entwurf §2.7) — aber nur die, deren Erklaerung
	// ihn fuehrt, zeigen ihn heute schon.
	//
	// 🔴 Er steht im ZUSTAND „offen“, nicht neben einer Zuweisung (Mockup, Karte 1 gegen Karte 3):
	// „es gibt keinen Artikel“ und „hier ist er“ schliessen einander aus, und der Server lehnt das
	// Speichern beider Werte zugleich ohnehin ab.
	// 💣 Die eine Ausnahme ist der Ausweg: ist der Merker GESETZT, wird er auch neben einer
	// Zuweisung gezeigt. Sonst kaeme man aus einem widerspruechlichen Zustand nicht mehr heraus --
	// das Speichern schickt immer BEIDE Werte, der Server lehnte danach jede Aenderung an diesem
	// Objekt ab, auch eine reine Beschreibungsaenderung. Genau davor warnte der Kommentar, der bis
	// 16.08.2026 in html/wiki-sync-powerline-editor.html stand.
	const extra = e.extra || {};
	const hakenZeigen = modus === "offen" || d.keinArtikel === true;
	if (extra.keinArtikelHaken === true && hakenZeigen) {
		modell.haken = {
			text: AVESMAPS_WIKI_ASSIGN_TEXTE.keinArtikel,
			gesetzt: d.keinArtikel === true,
		};
		modell.hinweis = avesmapsWikiAssignText(extra.keinArtikelHinweis)
			|| AVESMAPS_WIKI_ASSIGN_TEXTE.keinArtikelHinweis;
	}

	return modell;
}

// ── Der Auszeichnungs-Bauer ───────────────────────────────────────────────────────────────────
// REIN: Modell + Huelle -> HTML. Ein einziger Bauer fuer beide Huellen.

function avesmapsWikiAssignKlasse(wert) {
	const klasse = avesmapsWikiAssignText(wert);
	return klasse === "" ? "" : ' class="' + avesmapsWikiAssignEsc(klasse) + '"';
}

function avesmapsWikiAssignKnopfMarkup(skin, knopf) {
	return "<button type=\"button\"" + avesmapsWikiAssignKlasse(skin.knopf)
		+ ' data-wa-aktion="' + avesmapsWikiAssignEsc(knopf.aktion) + '"'
		+ (knopf.aus ? " disabled" : "") + ">"
		+ avesmapsWikiAssignEsc(knopf.text) + "</button>";
}

function avesmapsWikiAssignFeldMarkup(skin, zeile) {
	const wert = zeile.link !== ""
		? avesmapsWikiAssignEsc(zeile.wert) + ' <a' + avesmapsWikiAssignKlasse(skin.link)
			+ ' href="' + avesmapsWikiAssignEsc(zeile.link) + '" target="_blank" rel="noopener">'
			+ avesmapsWikiAssignEsc(AVESMAPS_WIKI_ASSIGN_TEXTE.wikiLink) + "</a>"
		: avesmapsWikiAssignEsc(zeile.wert);
	return "<" + skin.nameTag + avesmapsWikiAssignKlasse(skin.nameKlasse) + ">"
		+ avesmapsWikiAssignEsc(zeile.label) + "</" + skin.nameTag + ">"
		+ "<" + skin.wertTag + avesmapsWikiAssignKlasse(skin.wertKlasse) + ">" + wert + "</" + skin.wertTag + ">";
}

function avesmapsWikiAssignTrefferMarkup(skin, treffer) {
	return '<div class="' + avesmapsWikiAssignEsc(skin.treffer)
		+ (treffer.aktiv ? " " + avesmapsWikiAssignEsc(skin.trefferAktiv) : "") + '"'
		+ ' id="' + avesmapsWikiAssignEsc(treffer.id) + '"'
		+ ' role="option" aria-selected="' + (treffer.aktiv ? "true" : "false") + '"'
		+ ' data-wa-treffer="' + avesmapsWikiAssignEsc(treffer.index) + '">'
		+ "<div" + avesmapsWikiAssignKlasse(skin.trefferName) + ">" + avesmapsWikiAssignEsc(treffer.name) + "</div>"
		+ (treffer.meta === "" ? "" : "<div" + avesmapsWikiAssignKlasse(skin.trefferMeta) + ">" + avesmapsWikiAssignEsc(treffer.meta) + "</div>")
		+ (treffer.warnung === "" ? "" : "<div" + avesmapsWikiAssignKlasse(skin.trefferWarn) + ">" + avesmapsWikiAssignEsc(treffer.warnung) + "</div>")
		+ "</div>";
}

function avesmapsWikiAssignSyncZeileMarkup(skin, zeile, index) {
	const neu = zeile.neu === "" ? "—" : zeile.neu;
	return '<label class="' + avesmapsWikiAssignEsc(skin.syncZeile) + '">'
		+ '<input type="checkbox" data-wa-sync-haken="' + avesmapsWikiAssignEsc(index) + '"'
		+ (zeile.gehakt ? " checked" : "") + (zeile.gesperrt ? " disabled" : "") + ">"
		+ "<span" + avesmapsWikiAssignKlasse(skin.syncName) + ">" + avesmapsWikiAssignEsc(zeile.label) + "</span>"
		+ "<span>"
			+ "<span" + avesmapsWikiAssignKlasse(skin.syncAlt) + ">" + avesmapsWikiAssignEsc(zeile.alt === "" ? "—" : zeile.alt) + "</span> "
			+ "<span" + avesmapsWikiAssignKlasse(skin.syncPfeil) + ">→</span> "
			+ "<span" + avesmapsWikiAssignKlasse(skin.syncNeu) + ">" + avesmapsWikiAssignEsc(neu) + "</span>"
			+ (avesmapsWikiAssignText(zeile.grund) === ""
				? ""
				: "<span" + avesmapsWikiAssignKlasse(skin.syncGrund) + ">" + avesmapsWikiAssignEsc(zeile.grund) + "</span>")
		+ "</span></label>";
}

/**
 * REIN: der INHALT der Trefferliste, ohne ihren Behaelter.
 *
 * 🔴 Eigene Funktion, weil beim Tippen NUR sie neu gezeichnet wird. Ein `innerHTML` auf dem ganzen
 * Kasten ersetzt auch das Suchfeld -- und damit gehen Zeigerstelle und Textmarkierung verloren:
 * eine Korrektur mitten im Suchbegriff waere unmoeglich, der Zeiger spraenge nach jedem Zeichen ans
 * Ende. Das faellt in einer Tastaturabnahme sofort auf.
 */
function avesmapsWikiAssignTrefferListeInhalt(modell, skin) {
	if (!modell || !skin) {
		return "";
	}
	if (modell.treffer.length === 0) {
		// 💣 `role="presentation"`. Der Kasten ist ein `role="listbox"`, und darin sind nur
		// `option`/`group` zulaessige Kinder -- ein nackter `<div>` ist ein Verstoss, den kein
		// Browser meldet und der die Liste fuer ein Hilfsmittel kaputtmacht. Die Rolle nimmt ihn aus
		// dem Barrierefreiheitsbaum; angesagt wird der Leerzustand ueber den Hinweis darunter
		// („Keine Treffer · …“), der ohnehin die Trefferzahl traegt.
		return '<div role="presentation"' + avesmapsWikiAssignKlasse(skin.trefferLeer) + ">"
			+ avesmapsWikiAssignEsc(modell.trefferLeerText) + "</div>";
	}
	return modell.treffer.map((treffer) => avesmapsWikiAssignTrefferMarkup(skin, treffer)).join("");
}

/** REIN: Modell + Huelle -> HTML-Zeichenkette. Ohne DOM, ohne Zustand. */
function avesmapsWikiAssignMarkup(modell, skin) {
	if (!modell || !skin) {
		return "";
	}
	const teile = [];

	teile.push("<div" + avesmapsWikiAssignKlasse(skin.kopf) + ">"
		+ "<span" + avesmapsWikiAssignKlasse(skin.kopfTitel) + ">" + avesmapsWikiAssignEsc(modell.titel) + "</span>"
		+ (modell.knoepfe.length === 0 ? "" : "<span" + avesmapsWikiAssignKlasse(skin.kopfKnoepfe) + ">"
			+ modell.knoepfe.map((knopf) => avesmapsWikiAssignKnopfMarkup(skin, knopf)).join("")
			+ "</span>")
		+ "</div>");

	const hinweisMarkup = avesmapsWikiAssignText(modell.hinweis) === ""
		? ""
		// `data-wa-hinweis`: beim Tippen wird nur die Trefferliste neu gezeichnet, der Zaehlsatz
		// darunter aber trotzdem nachgezogen (zeichneTreffer) -- dafuer muss er auffindbar sein.
		: "<div data-wa-hinweis" + avesmapsWikiAssignKlasse(skin.hinweis) + ">" + avesmapsWikiAssignEsc(modell.hinweis) + "</div>";
	if (modell.hinweisOben) {
		teile.push(hinweisMarkup);
	}

	if (modell.suchfeld) {
		// 💣 `type="search"`, kein `value` in die Zuweisung, kein `<datalist>`: hier wird gesucht,
		// nicht eine Adresse getippt (Entwurf §5).
		//
		// Die ARIA-Rollen sind vollstaendig, nicht halb: `combobox` am Feld, `listbox` an der Liste,
		// `option` samt eigener `id` an jedem Treffer, und `aria-activedescendant` sagt, WELCHER
		// gerade gewaehlt ist. ⚠️ Halbe Rollen waeren schlechter als keine -- eine Liste mit
		// `role="option"`, deren Auswahl nirgends gemeldet wird, sieht fuer ein Hilfsmittel
		// vollstaendig aus und ist stumm.
		teile.push("<" + skin.listeTag + avesmapsWikiAssignKlasse(skin.listeKlasse) + ">"
			+ "<" + skin.nameTag + avesmapsWikiAssignKlasse(skin.nameKlasse) + ">"
			+ '<label for="' + avesmapsWikiAssignEsc(modell.listenId) + '-feld">'
			+ avesmapsWikiAssignEsc(modell.suchfeld.label) + "</label></" + skin.nameTag + ">"
			+ "<" + skin.wertTag + avesmapsWikiAssignKlasse(skin.wertKlasse) + ">"
			+ '<input type="search" data-wa-suche autocomplete="off" spellcheck="false"'
			+ ' id="' + avesmapsWikiAssignEsc(modell.listenId) + '-feld"'
			// ⚠️ `aria-expanded` sagt, ob die Liste etwas ANBIETET -- fest auf "true" verdrahtet
			// meldete es auch bei null Treffern eine offene Auswahl, die es nicht gibt.
			+ ' role="combobox" aria-expanded="' + (modell.treffer.length > 0 ? "true" : "false") + '"'
			+ ' aria-autocomplete="list"'
			+ ' aria-controls="' + avesmapsWikiAssignEsc(modell.listenId) + '"'
			+ (modell.aktiveId === "" ? "" : ' aria-activedescendant="' + avesmapsWikiAssignEsc(modell.aktiveId) + '"')
			+ ' placeholder="' + avesmapsWikiAssignEsc(modell.suchfeld.platzhalter) + '"'
			+ ' value="' + avesmapsWikiAssignEsc(modell.suchfeld.wert) + '">'
			+ "</" + skin.wertTag + "></" + skin.listeTag + ">");
		// 🔴 `data-wa-liste` ist der Angriffspunkt fuer das TEILWEISE Neuzeichnen: beim Tippen wird
		// nur dieser Kasten neu gefuellt, nie das Suchfeld darueber (siehe zeichneTreffer).
		teile.push('<div class="' + avesmapsWikiAssignEsc(skin.trefferListe) + '" data-wa-liste'
			+ ' id="' + avesmapsWikiAssignEsc(modell.listenId) + '" role="listbox">'
			+ avesmapsWikiAssignTrefferListeInhalt(modell, skin)
			+ "</div>");
	} else if (modell.felder.length > 0) {
		teile.push("<" + skin.listeTag + avesmapsWikiAssignKlasse(skin.listeKlasse) + ">"
			+ modell.felder.map((zeile) => avesmapsWikiAssignFeldMarkup(skin, zeile)).join("")
			+ "</" + skin.listeTag + ">");
	}

	if (modell.syncZeilen.length > 0) {
		teile.push('<div class="' + avesmapsWikiAssignEsc(skin.syncListe) + '">'
			+ modell.syncZeilen.map((zeile, index) => avesmapsWikiAssignSyncZeileMarkup(skin, zeile, index)).join("")
			+ "</div>");
	}

	if (modell.haken) {
		teile.push("<label" + avesmapsWikiAssignKlasse(skin.haken) + ">"
			+ '<input type="checkbox" data-wa-kein-artikel' + (modell.haken.gesetzt ? " checked" : "") + ">"
			+ "<span>" + avesmapsWikiAssignEsc(modell.haken.text) + "</span></label>");
	}

	if (modell.syncAktionen.length > 0) {
		teile.push("<div" + avesmapsWikiAssignKlasse(skin.aktionen) + ">"
			+ modell.syncAktionen.map((knopf) => avesmapsWikiAssignKnopfMarkup(skin, knopf)).join("")
			+ "</div>");
	}

	if (!modell.hinweisOben) {
		teile.push(hinweisMarkup);
	}
	if (avesmapsWikiAssignText(modell.fuss) !== "") {
		teile.push("<div" + avesmapsWikiAssignKlasse(skin.hinweis) + ">" + avesmapsWikiAssignEsc(modell.fuss) + "</div>");
	}

	return '<div class="' + avesmapsWikiAssignEsc(skin.wurzel) + '">' + teile.join("") + "</div>";
}

/**
 * REIN: filtert eine im Browser liegende Kandidatenliste. Teilzeichenkette im Namen, ohne
 * Gross-/Kleinschreibung, gedeckelt auf dieselbe Zahl wie die Server-Suchen.
 */
function avesmapsWikiAssignListeFiltern(kandidaten, suchtext) {
	const begriff = avesmapsWikiAssignText(suchtext).toLowerCase();
	const alle = Array.isArray(kandidaten) ? kandidaten : [];
	const treffer = begriff === ""
		? alle.slice()
		: alle.filter((eintrag) => avesmapsWikiAssignText(eintrag && eintrag.name).toLowerCase().indexOf(begriff) !== -1);
	return treffer.slice(0, AVESMAPS_WIKI_ASSIGN_TREFFER_LIMIT);
}

// ── Das Anhaengen ans DOM ─────────────────────────────────────────────────────────────────────
// Alles darueber ist rein und ohne Browser pruefbar; ab hier faengt der Zustand an.

// Laufende Nummer je Bauteil -- die Kennungen von Suchfeld und Trefferliste muessen auf einer Seite
// eindeutig sein, und ein Kartendialog kann mehrere Zuweisungen zeigen.
let avesmapsWikiAssignZaehler = 0;

/**
 * 💣 DER BLINDGAENGER, UND WARUM ER SICH ZU ERKENNEN GIBT.
 *
 * Wenn `mount` nicht arbeiten kann (fehlende Erklaerung, unbekannte Huelle, fehlende Voraussetzung),
 * gibt es eine Steuerung zurueck, die nichts tut -- sonst muesste jeder Aufrufer das Ergebnis auf
 * `null` pruefen. 🔴 Aber sie ist ERKENNBAR: `bereit === false`, und `lies()` gibt `null` statt
 * lauter Leerstrings.
 *
 * Der Grund ist kein Stilempfinden. Eine Oberflaeche, die erst beim „Speichern“ schreibt (die
 * Kraftlinien), holt ihren Stand ueber `lies()`. Gaebe der Blindgaenger dort `{wiki_url: ""}`
 * zurueck, schriebe der naechste Klick auf „Speichern“ eine LEERE Zuweisung auf alle Segmente --
 * eine Loeschung, die niemand angeordnet hat, ununterscheidbar von „es war nie eine da“
 * (AGENTS.md §10). Und der Anlass ist nicht hypothetisch: ein Deploy-Fehlschlag vergiftet den
 * `?v=`-Stempel, Dateien stehen live auf 404, waehrend die Seite sie schon anfordert (§9). Laedt
 * dieses Bauteil, aber sein Feldregister nicht, ist genau dieser Zustand erreicht.
 *
 * `lies()` gibt `null`: wer die `bereit`-Weiche vergisst, bekommt einen lauten Fehler statt einer
 * stillen Loeschung.
 */
function avesmapsWikiAssignBlindgaenger() {
	return {
		bereit: false,
		lies: () => null,
		neuLaden: () => {},
		zerstoeren: () => {},
	};
}

function avesmapsWikiAssignMount(behaelter, optionen) {
	const opt = optionen || {};
	// 🔴 BEIDE Voraussetzungen, nicht nur das Feldregister. Fehlt die Diff-Rechnung, faende eine
	// Objektart mit `sync: true` beim Druck auf „Sync“ nie einen Unterschied und meldete „Alles
	// stimmt bereits mit dem Wiki ueberein“ -- eine beruhigende Luege. Beides zusammen ist EIN
	// Riegel, und er steht vor allem anderen.
	const registerDa = typeof avesmapsWikiAssignSubject === "function";
	const diffDa = typeof avesmapsWikiAssignDiff === "function";
	const erklaerung = registerDa ? avesmapsWikiAssignSubject(opt.subject) : null;
	const skin = avesmapsWikiAssignSkin(opt.skin);
	if (!behaelter || !registerDa || !diffDa || !erklaerung || !skin) {
		// 💣 Kein stiller Leerlauf: eine fehlende Voraussetzung, eine unbekannte Objektart oder Huelle
		// ist ein Bau-, kein Datenfehler, und ein leerer Kasten sieht aus wie „hier gibt es nichts“.
		// Der Satz nennt die DATEI, damit niemand die Ursache bei den Daten sucht.
		if (behaelter) {
			behaelter.textContent = !registerDa
				? "Wiki-Zuweisung: das Feldregister ist nicht geladen (js/ui/wiki-assign-registry.js)."
				: !diffDa
					? "Wiki-Zuweisung: die Diff-Rechnung ist nicht geladen (js/ui/wiki-assign-diff.js)."
					: !erklaerung
						? 'Wiki-Zuweisung: keine Erklärung für „' + String(opt.subject) + '“.'
						: 'Wiki-Zuweisung: unbekannte Hülle „' + String(opt.skin) + '“.';
		}
		return avesmapsWikiAssignBlindgaenger();
	}

	const listenId = "avm-wiki-assign-" + (++avesmapsWikiAssignZaehler);
	let daten = { artikel: null, keinArtikel: false, kartenwerte: {}, handgesetzt: [], gesperrt: {}, listen: {} };
	let ui = { modus: "offen", suchtext: "", treffer: [], aktiv: 0, syncZeilen: [], listenId: listenId };
	let tippUhr = null;
	let laufendeSuche = 0;
	// 🔴 Das Merkmal hinter `bereit`: erst ein GEGLUECKTER Ladelauf macht `lies()` zu einem gueltigen
	// Schreibwert. Startet auf false -- zwischen `mount` und der ersten Antwort von `laden` (bei
	// einem Server-`laden` sind das echte Millisekunden) darf niemand speichern.
	let geladen = false;

	function neuerZustand(modus) {
		return { modus: modus, suchtext: "", treffer: [], aktiv: 0, syncZeilen: [], listenId: listenId };
	}

	function zeichne() {
		const modell = avesmapsWikiAssignModell(erklaerung, daten, ui);
		behaelter.innerHTML = avesmapsWikiAssignMarkup(modell, skin);
		const feld = behaelter.querySelector("[data-wa-suche]");
		if (feld) {
			feld.focus();
			// Beim VOLLEN Neuzeichnen ist das Feld frisch -- der Zeiger gehoert ans Ende. Beim Tippen
			// wird es gar nicht erst ersetzt (zeichneTreffer), dort bleibt er, wo er ist.
			try { feld.setSelectionRange(feld.value.length, feld.value.length); } catch (fehler) { /* type=search ohne Auswahl */ }
		}
	}

	/**
	 * 🔴 NUR die Trefferliste, nie das Suchfeld. Bis zum 16.08.2026 zeichnete jeder Tastendruck den
	 * ganzen Kasten per `innerHTML` neu und setzte Zeiger und Fokus ans Ende -- eine Korrektur mitten
	 * im Suchbegriff war damit unmoeglich und jede Textmarkierung weg. Der Plan verlangt
	 * Tastaturbedienung in Chrome UND Firefox; ein Suchfeld, in dem man nicht rueckwaerts korrigieren
	 * kann, faellt dort durch.
	 *
	 * ⚠️ Faellt auf das volle Zeichnen zurueck, wenn die Liste (noch) nicht dasteht -- der Zustand
	 * passt dann nicht zur Annahme, und ein halbes Bild waere schlimmer als ein volles.
	 */
	function zeichneTreffer() {
		const liste = behaelter.querySelector("[data-wa-liste]");
		const feld = behaelter.querySelector("[data-wa-suche]");
		if (!liste || !feld) {
			zeichne();
			return;
		}
		const modell = avesmapsWikiAssignModell(erklaerung, daten, ui);
		liste.innerHTML = avesmapsWikiAssignTrefferListeInhalt(modell, skin);
		// 💣 BEIDE Merkmale, nicht nur eines. Sie stehen am FELD, und das Feld wird hier bewusst
		// nicht neu gebaut -- also muessen sie von Hand nachgezogen werden. Bis zum 16.08.2026 zog
		// nur `aria-activedescendant` mit: `aria-expanded` wurde beim Oeffnen der Suche gerendert,
		// als die Trefferliste noch LEER war, blieb dadurch auf "false" stehen und wurde nie wieder
		// angefasst. Live gemessen: vier Treffer in der Liste, `aria-expanded="false"` am Feld --
		// genau die halbe ARIA, gegen die Klein B geschrieben wurde, eine Ebene tiefer.
		// 🔴 Wer hier ein drittes Merkmal ans Feld haengt, zieht es in DIESER Funktion mit.
		feld.setAttribute("aria-expanded", modell.treffer.length > 0 ? "true" : "false");
		if (modell.aktiveId === "") {
			feld.removeAttribute("aria-activedescendant");
		} else {
			feld.setAttribute("aria-activedescendant", modell.aktiveId);
		}
		const hinweis = behaelter.querySelector("[data-wa-hinweis]");
		if (hinweis) {
			hinweis.textContent = modell.hinweis;
		}
	}

	function zustandUebernehmen(roh) {
		const r = roh || {};
		daten = {
			artikel: r.artikel || null,
			keinArtikel: r.keinArtikel === true,
			kartenwerte: r.kartenwerte || {},
			handgesetzt: Array.isArray(r.handgesetzt) ? r.handgesetzt : [],
			gesperrt: r.gesperrt || {},
			listen: r.listen || {},
		};
	}

	// 💣 Der Datenweg gehoert der Oberflaeche, und ein Fehler darin darf NICHT den ganzen Kasten
	// mitreissen: `mount` laeuft mitten im Neuzeichnen einer Editorspalte, ein Wurf hier liesse den
	// Rest der Spalte ungezeichnet stehen. Statt dessen ein sichtbarer Satz -- ein leerer Fleck saehe
	// aus wie „dieses Objekt hat keine Zuweisung".
	function ladenGescheitert() {
		// 🔴 BEIDE Haelften, in dieser Reihenfolge gedacht: sichtbar (der Kasten sagt es) UND
		// wirksam (`geladen = false`, also `bereit === false` und `lies() === null`). Nur die erste
		// zu tun war der halbe Riegel -- ein Kasten mit Fehlermeldung, dessen Speicherpfad weiter
		// bedient wird, ist genau der dritte Zustand, den es nicht geben darf.
		geladen = false;
		behaelter.textContent = "Wiki-Zuweisung: der Stand konnte nicht gelesen werden.";
	}

	function neuLaden() {
		let roh = null;
		try {
			roh = typeof opt.laden === "function" ? opt.laden() : null;
		} catch (fehler) {
			// Fehlerart 1: `laden` WIRFT (synchron).
			ladenGescheitert();
			return Promise.resolve();
		}
		return Promise.resolve(roh).then((wert) => {
			zustandUebernehmen(wert);
			geladen = true;
			ui = neuerZustand(daten.artikel ? "zugewiesen" : "offen");
			zeichne();
		}, () => {
			// Fehlerart 2: `laden` gibt eine ZUSAGE zurueck, die abgelehnt wird. Die erste Objektart
			// mit Server-`laden` (Aufgabe 4) faellt genau hier hin.
			ladenGescheitert();
		});
	}

	// Die Erklaerung sagt, WOHER die Treffer kommen — das Bauteil merkt den Unterschied nicht
	// (Entwurf §5).
	function trefferHolen(suchtext) {
		const suche = erklaerung.suche || {};
		if (suche.art === "liste") {
			const kandidaten = daten.listen[suche.quelle] || [];
			return Promise.resolve(avesmapsWikiAssignListeFiltern(kandidaten, suchtext));
		}
		if (suche.art === "server" && avesmapsWikiAssignText(suche.url) !== "") {
			// ⚠️ `data.rows` ist die gemessene Form der drei vorhandenen Suchen
			// (review-label-wiki.js:219, review-settlement-wiki.js:148, review-path-wiki.js:186) —
			// abgelesen, nicht geraten. Gegen einen LIVE-Endpunkt ist dieser Zweig in Aufgabe 3
			// nicht gefahren worden; die Kraftlinien suchen im Browser. Aufgabe 4 misst ihn.
			const url = suche.url + "?action=search&q=" + encodeURIComponent(avesmapsWikiAssignText(suchtext))
				+ "&limit=" + AVESMAPS_WIKI_ASSIGN_TREFFER_LIMIT;
			return fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } })
				.then((antwort) => antwort.json())
				.then((data) => (data && Array.isArray(data.rows)) ? data.rows : [])
				.catch(() => []);
		}
		return Promise.resolve([]);
	}

	function sucheAnstossen(sofort) {
		const suchtext = ui.suchtext;
		const meine = ++laufendeSuche;
		const los = () => trefferHolen(suchtext).then((treffer) => {
			// Eine ueberholte Antwort darf die neuere nicht ueberschreiben.
			if (meine !== laufendeSuche || ui.modus !== "suche") {
				return;
			}
			ui.treffer = treffer;
			ui.aktiv = 0;
			// 🔴 NUR die Liste -- das Suchfeld bleibt stehen, samt Zeigerstelle und Markierung.
			zeichneTreffer();
		});
		if (tippUhr) {
			clearTimeout(tippUhr);
			tippUhr = null;
		}
		if (sofort || (erklaerung.suche || {}).art === "liste") {
			los();
			return;
		}
		tippUhr = setTimeout(los, AVESMAPS_WIKI_ASSIGN_TIPP_PAUSE_MS);
	}

	function trefferWaehlen(index) {
		const treffer = ui.treffer[index];
		if (!treffer) {
			return;
		}
		Promise.resolve(typeof opt.zuweisen === "function" ? opt.zuweisen(treffer) : null).then(() => {
			// 🔴 Das Bauteil uebernimmt den Treffer SELBST in seinen Zustand, statt neu zu laden:
			// eine Oberflaeche, die erst beim „Speichern“ schreibt (Kraftlinien), haette sonst
			// nichts zurueckzugeben, und der frisch gewaehlte Artikel verschwaende sofort wieder.
			daten.artikel = {
				name: avesmapsWikiAssignText(treffer.name),
				wiki_url: avesmapsWikiAssignText(treffer.wiki_url),
				wiki_key: avesmapsWikiAssignText(treffer.wiki_key),
				werte: treffer.werte || {},
			};
			// Ein zugewiesener Artikel und „es gibt keinen“ schliessen einander aus.
			daten.keinArtikel = false;
			ui = neuerZustand("zugewiesen");
			zeichne();
		});
	}

	function syncOeffnen() {
		const werte = (daten.artikel && daten.artikel.werte) || {};
		const zeilen = (typeof avesmapsWikiAssignDiff === "function")
			? avesmapsWikiAssignDiff(erklaerung.felder, daten.kartenwerte, werte, daten.handgesetzt)
			: [];
		// 🔴 Gesperrte Feldzeilen (Entwurf §7): der Riegel gehoert an die ZEILE, nicht an den Knopf
		// — sonst sperrt eine Entscheidung ueber die Hierarchie auch den Namen. Und er ist sichtbar,
		// nicht still uebersprungen.
		ui.syncZeilen = zeilen.map((zeile) => {
			const grund = avesmapsWikiAssignText(daten.gesperrt[zeile.karte]);
			return grund === "" ? zeile : Object.assign({}, zeile, { gehakt: false, gesperrt: true, grund: grund });
		});
		ui.modus = "sync";
		zeichne();
	}

	function aufAktion(aktion) {
		if (aktion === "zuweisen" || aktion === "aendern") {
			ui = neuerZustand("suche");
			zeichne();
			sucheAnstossen(true);
			return;
		}
		if (aktion === "abbrechen") {
			ui = neuerZustand(daten.artikel ? "zugewiesen" : "offen");
			zeichne();
			return;
		}
		if (aktion === "entfernen") {
			Promise.resolve(typeof opt.loesen === "function" ? opt.loesen() : null).then(() => {
				daten.artikel = null;
				ui = neuerZustand("offen");
				zeichne();
			});
			return;
		}
		if (aktion === "sync") {
			syncOeffnen();
			return;
		}
		if (aktion === "sync-alle") {
			ui.syncZeilen = ui.syncZeilen.map((zeile) => (zeile.gesperrt ? zeile : Object.assign({}, zeile, { gehakt: true })));
			zeichne();
			return;
		}
		if (aktion === "sync-uebernehmen") {
			const gehakt = ui.syncZeilen.filter((zeile) => zeile.gehakt);
			Promise.resolve(typeof opt.syncUebernehmen === "function" ? opt.syncUebernehmen(gehakt) : null).then(() => {
				ui = neuerZustand("zugewiesen");
				zeichne();
			});
		}
	}

	function aufKlick(ereignis) {
		const ziel = ereignis.target;
		if (!ziel || !ziel.closest) {
			return;
		}
		const knopf = ziel.closest("[data-wa-aktion]");
		if (knopf && behaelter.contains(knopf)) {
			ereignis.preventDefault();
			aufAktion(knopf.getAttribute("data-wa-aktion"));
			return;
		}
		const treffer = ziel.closest("[data-wa-treffer]");
		if (treffer && behaelter.contains(treffer)) {
			ereignis.preventDefault();
			trefferWaehlen(parseInt(treffer.getAttribute("data-wa-treffer"), 10));
		}
	}

	function aufEingabe(ereignis) {
		const ziel = ereignis.target;
		if (!ziel) {
			return;
		}
		if (ziel.hasAttribute && ziel.hasAttribute("data-wa-suche")) {
			ui.suchtext = ziel.value || "";
			sucheAnstossen(false);
		}
	}

	function aufAenderung(ereignis) {
		const ziel = ereignis.target;
		if (!ziel || !ziel.hasAttribute) {
			return;
		}
		if (ziel.hasAttribute("data-wa-kein-artikel")) {
			daten.keinArtikel = !!ziel.checked;
			if (typeof opt.keinArtikelGeaendert === "function") {
				opt.keinArtikelGeaendert(daten.keinArtikel);
			}
			return;
		}
		if (ziel.hasAttribute("data-wa-sync-haken")) {
			const index = parseInt(ziel.getAttribute("data-wa-sync-haken"), 10);
			if (ui.syncZeilen[index]) {
				ui.syncZeilen[index] = Object.assign({}, ui.syncZeilen[index], { gehakt: !!ziel.checked });
				zeichne();
			}
		}
	}

	// ↑ ↓ waehlen, Enter zuweisen, Esc schliesst (Entwurf §5). Bei vielen Zuweisungen hintereinander
	// spart das jedes Mal den Griff zur Maus.
	function aufTaste(ereignis) {
		const ziel = ereignis.target;
		if (!ziel || !ziel.hasAttribute || !ziel.hasAttribute("data-wa-suche")) {
			return;
		}
		if (ereignis.key === "ArrowDown" || ereignis.key === "ArrowUp") {
			ereignis.preventDefault();
			if (ui.treffer.length === 0) {
				return;
			}
			const schritt = ereignis.key === "ArrowDown" ? 1 : -1;
			ui.aktiv = (ui.aktiv + schritt + ui.treffer.length) % ui.treffer.length;
			// Auch hier nur die Liste: ↑ ↓ waehlt einen Treffer, es raeumt nicht das Suchfeld ab.
			zeichneTreffer();
			return;
		}
		if (ereignis.key === "Enter") {
			ereignis.preventDefault();
			trefferWaehlen(ui.aktiv);
			return;
		}
		if (ereignis.key === "Escape") {
			ereignis.preventDefault();
			aufAktion("abbrechen");
		}
	}

	behaelter.addEventListener("click", aufKlick);
	behaelter.addEventListener("input", aufEingabe);
	behaelter.addEventListener("change", aufAenderung);
	behaelter.addEventListener("keydown", aufTaste);

	neuLaden();

	return {
		// 🔴 EIN Merkmal, ausnahmslos: `bereit === true` heisst, dass `lies()` ein gueltiger
		// Schreibwert ist. Es ist eine ABFRAGE, kein fester Wert -- der Ladelauf kann jederzeit
		// scheitern, und dann darf das Merkmal nicht auf einer alten Zusage sitzenbleiben.
		//
		// 💣 Genau hier war der Riegel bis zum 16.08.2026 halb: er griff beim Mount, nicht auf dem
		// FEHLERPFAD. `neuLaden()` faengt einen Wurf aus `opt.laden()` ab, schreibt „der Stand konnte
		// nicht gelesen werden" in den Kasten -- und liess `bereit` auf `true` stehen. `lies()` gab
		// dann lauter Leerstrings, und ein „Speichern" haette die Zuweisung geloescht: derselbe
		// stille Verlust wie beim Blindgaenger, nur einen Trichter tiefer. Beim Kraftlinien-Editor
		// ist `laden` synchron und der Pfad damit latent -- die erste Objektart mit SERVER-`laden`
		// (Aufgabe 4) macht ihn lebendig.
		//
		// 🔴 Es darf keinen dritten Zustand geben, in dem der Kasten eine Fehlermeldung zeigt und der
		// Speicherpfad trotzdem bedient wird. Deshalb setzt JEDER Fehlschlag `geladen` zurueck --
		// auch der eines spaeteren Neuladens, nach einem geglueckten ersten: was dann im Kasten
		// steht, ist eine Fehlermeldung, und was in `daten` steht, ist veraltet.
		get bereit() {
			return geladen;
		},
		// Der Rueckkanal fuer Oberflaechen, die NICHT sofort schreiben: was ein „Speichern“
		// schreiben soll.
		lies: function () {
			if (!geladen) {
				return null;
			}
			return {
				name: daten.artikel ? avesmapsWikiAssignText(daten.artikel.name) : "",
				wiki_url: daten.artikel ? avesmapsWikiAssignText(daten.artikel.wiki_url) : "",
				wiki_key: daten.artikel ? avesmapsWikiAssignText(daten.artikel.wiki_key) : "",
				kein_artikel: daten.keinArtikel === true,
			};
		},
		neuLaden: neuLaden,
		zerstoeren: function () {
			if (tippUhr) {
				clearTimeout(tippUhr);
				tippUhr = null;
			}
			behaelter.removeEventListener("click", aufKlick);
			behaelter.removeEventListener("input", aufEingabe);
			behaelter.removeEventListener("change", aufAenderung);
			behaelter.removeEventListener("keydown", aufTaste);
			behaelter.innerHTML = "";
		},
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_WIKI_ASSIGN_SKINS: AVESMAPS_WIKI_ASSIGN_SKINS,
		AVESMAPS_WIKI_ASSIGN_TEXTE: AVESMAPS_WIKI_ASSIGN_TEXTE,
		avesmapsWikiAssignSkin: avesmapsWikiAssignSkin,
		avesmapsWikiAssignModell: avesmapsWikiAssignModell,
		avesmapsWikiAssignMarkup: avesmapsWikiAssignMarkup,
		avesmapsWikiAssignTrefferListeInhalt: avesmapsWikiAssignTrefferListeInhalt,
		// Nur fuer die Probe des Blindgaengers: der Zweig, der OHNE DOM zurueckkehrt.
		avesmapsWikiAssignMount: avesmapsWikiAssignMount,
		avesmapsWikiAssignListeFiltern: avesmapsWikiAssignListeFiltern,
		avesmapsWikiAssignTrefferMeta: avesmapsWikiAssignTrefferMeta,
		avesmapsWikiAssignFeldLabel: avesmapsWikiAssignFeldLabel,
	};
}
