// Der MASSENLAUF der Wiki-Zuweisung -- der eine Knopf, der tausende Zeilen schreiben kann.
//
// Anlass (Owner, 16.08.2026): „warum viele Sachen nicht zugewiesen sind, obwohl die wiki-keys
// stimmen". Der Schluessel und die ZUWEISUNG sind zwei Dinge -- der Schluessel sagt nur, wie das
// Objekt heissen wuerde, die Zuweisung ist ein eigenes Nest (`properties.wiki_path`,
// `properties.wiki_region`), das erst entsteht, wenn sie jemand ausfuehrt. Die Endpunkte dafuer gab
// es seit Monaten; was fehlte, war der Ausloeser.
//
// 🔴 ZWEI ANFRAGEN, NIE MEHR. Erst die Vorschau (`dry_run` ist die Vorgabe des Servers), dann --
// und nur nach Zustimmung -- der scharfe Lauf. Kein Nachfassen je Objekt, kein Fortschrittspolling:
// beide Endpunkte lesen die ganze Staging-Tabelle UND alle passenden map_features, und STRATO ist
// geteiltes Hosting (AGENTS.md §9: ein teurer Endpunkt in Wiederholung saettigt die PHP-Worker und
// sieht aus wie ein Datenbankausfall).
//
// 🔴 DER SCHARFE LAUF BRAUCHT BEIDE HAELFTEN -- `dry_run:false` UND `confirm:"apply"`. Der Server
// prueft genau diese Kombination (api/edit/wiki/paths.php, api/edit/wiki/regions.php); eine Haelfte
// allein ist stillschweigend wieder nur eine Vorschau. Deshalb wird die Antwort des scharfen Laufs
// ZURUECKGELESEN (`dry_run === false`), statt ihr zu glauben: ein Knopf, der „geschrieben" meldet,
// waehrend nichts steht, ist der teuerste Fehler dieser Bauform.
//
// Kein DOM, kein fetch, keine Globalen ausser dem Export unten: dieselbe Abfolge laeuft im
// Wege-Editor und im Landschaften-Editor, und sie bleibt in node pruefbar
// (js/ui/__tests__/wiki-massenzuweisung.test.js).

"use strict";

// Die Rezepturen. REINE DATEN -- je Oberflaeche eine Zeile.
//
// 🔴 BEI DEN LANDSCHAFTEN STEHT KEIN `art` MEHR. Der einzige Aufrufer, den es je gab, rief den
// Massenlauf fest mit `art:"Berggipfel"` (js/review/review-region-sync.js, gefallen mit diesem
// Umbau). Nachgemessen am Ursprungs-Commit 5bb92394 (06.06.2026): der Filter war der UMFANG jener
// einen Wanderung -- sie zog `Kategorie:Berg` in den Crawl, bildete die Wiki-Art `Berg` auf
// `Berggipfel` ab und brauchte einen Knopf fuer genau diese frisch gecrawlten Label. Er war NIE ein
// Schutz: gegen falsche Paarungen steht `avesmapsWikiRegionTypeConflict`, und die laeuft unabhaengig
// vom Art-Filter. Der PARAMETER bleibt am Endpunkt stehen (die GET-Aktion `assign_status` reicht
// ihn durch, api/edit/wiki/regions.php:95 -- ⚠️ sie hat mit dem Berge-Knopf ihren letzten Aufrufer
// verloren und wird von hier bewusst NICHT gerufen: das waere eine zweite teure Anfrage je
// Fensteroeffnung); die EINSCHRAENKUNG faellt, sonst blieben Heide, Huegelland, Wald, Insel und
// alle uebrigen Arten weiterhin unzugewiesen -- also genau das, was der Owner gemeldet hat.
//
// ⚠️ `continent: "Aventurien"` bleibt bei beiden -- dieselbe Vorgabe wie bei allen bisherigen
// Aufrufern und wie im Panel. Die Karte IST Aventurien; eine Wiki-Landschaft aus Myranor, die
// zufaellig wie ein hiesiges Label heisst, waere kein Treffer, sondern ein Fehlgriff.
const AVESMAPS_WIKI_MASSENLAUF = {
	weg: {
		url: "/api/edit/wiki/paths.php",
		koerper: { action: "assign_all", continent: "Aventurien" },
		// Was der Endpunkt WIRKLICH zurueckgibt (gemessen an avesmapsWikiPathAssignAll):
		// ok, dry_run, continent_filter, segments_affected, wiki_paths_linked, applied.
		zahl: function (antwort) { return Number((antwort && antwort.segments_affected) || 0); },
		wikiZahl: function (antwort) { return Number((antwort && antwort.wiki_paths_linked) || 0); },
		// ⚠️ KURZ, und das ist gerechnet, nicht Geschmack: die `t2`-Zeile steht in einer Menuebandkachel,
		// und mit der sechsten Kachel bleiben bei voller Fensterbreite (--avm-editor-w = 1400) noch
		// (1400 - 28 Polsterung - 5x6 Luecke) / 6 - 22 = rund 202 px Text. Bei --font-size-caption
		// (11px) sind das etwa 34 Zeichen; alles darueber kuerzt `.t2` mit Ellipse -- und dann faellt
		// ausgerechnet die zweite Zahl weg. Der ganze Satz steht in der Rueckfrage und im `title`.
		objekt: ["Abschnitt", "Abschnitte"],
		wikiObjekt: ["Weg", "Wege"],
		// 💣 DIE ZAHL BEDEUTET HIER ETWAS ANDERES ALS BEI DEN LANDSCHAFTEN, und das ist gemessen,
		// nicht vermutet: `avesmapsWikiPathAssignAll` zaehlt JEDES namensgleiche Wegstueck, auch
		// eines, das die Zuordnung schon traegt -- es schreibt sie unbesehen neu. Der Nachbar
		// darunter ueberspringt bereits richtig Verbundene. Zwei Knoepfe mit derselben Beschriftung
		// duerfen nicht dieselbe Zahl verschieden meinen, ohne dass es dasteht -- also steht es da.
		frage: function (zahl, wikiZahl) {
			return "Alle " + wikiZahl + " passenden Wiki-Wege mit ihren Karten-Abschnitten verknüpfen?"
				+ "\n\nGeschrieben werden " + zahl + " Abschnitte — alle, deren Name zu einem Wiki-Weg passt."
				+ " Bereits verknüpfte sind mitgezählt: ihre Angaben werden aufgefrischt, und eine"
				+ " abweichende Zuordnung wird überschrieben — auch eine von Hand gesetzte."
				+ "\n\nEin Weg mit dem Merker „kein Wiki-Artikel“ wird dabei mitverknüpft und verliert ihn.";
		},
	},
	landschaft: {
		url: "/api/edit/wiki/regions.php",
		koerper: { action: "assign_all", continent: "Aventurien" },
		// Gemessen an avesmapsWikiRegionAssignAll:
		// ok, dry_run, continent_filter, art_filter, labels_affected, regions_linked, applied.
		zahl: function (antwort) { return Number((antwort && antwort.labels_affected) || 0); },
		wikiZahl: function (antwort) { return Number((antwort && antwort.regions_linked) || 0); },
		// Kurz aus demselben Grund wie oben (rund 34 Zeichen); die lange Fassung
		// „63 Karten-Label · 63 Wiki-Landschaften" sind 38 und faellt in die Ellipse.
		objekt: ["Label", "Label"],
		wikiObjekt: ["Landschaft", "Landschaften"],
		frage: function (zahl, wikiZahl) {
			return "Alle " + wikiZahl + " passenden Wiki-Landschaften mit ihren Karten-Labeln verknüpfen?"
				+ "\n\nGeschrieben werden " + zahl + " Label. Bereits richtig Verbundene sind NICHT"
				+ " mitgezählt und bleiben unberührt; eine abweichende Zuordnung wird überschrieben —"
				+ " auch eine von Hand gesetzte. Passt die Wiki-Art nicht zum Label-Typ, wird"
				+ " übersprungen."
				+ "\n\nEin Label mit dem Merker „kein Wiki-Artikel“ wird dabei mitverknüpft und verliert ihn.";
		},
	},
	// 🔴 DIE DRITTE ART VERHÄLT SICH ANDERS ALS DIE ZWEI ÜBER IHR, UND DAS MUSS DASTEHEN.
	//
	// Zugewiesen wird nicht der EIGENE Artikel der Karte, sondern die Wikiseite der PUBLIKATION, in
	// der sie abgedruckt ist. Einen eigenen Artikel hat eine Karte im Wiki praktisch nie (gemessen:
	// 11 von 521 Titeln, und die 11 sind Ortsseiten oder Schuber) -- Owner-Entscheid 17.08.2026.
	// Festgehalten wird das in `citymap.article_origin = 'wiki_publication'`; ohne diese Marke
	// meldete das Konfliktzentrum 136 Gruppen mit 482 Objekten (363 Karten auf 140 Seiten, davon
	// 123 gemischt mit dem Literaturwerk, das denselben Artikel traegt).
	//
	// 💣 UND ER ERGAENZT NUR, ER ERSETZT NICHT -- anders als der Wege-Nachbar ganz oben, der bereits
	// Verknuepftes unbesehen neu schreibt. Karten mit vorhandener Zuweisung und Karten mit dem
	// Merker „Kein Wiki-Artikel vorhanden" bleiben unberuehrt. Der Server prueft das je ZEILE in
	// seiner WHERE-Klausel, nicht gegen eine Zahl von vorhin: zwischen Vorschau und Klick liegt eine
	// Rueckfrage, und in der Zeit kann ein zweiter Editor dieselbe Karte zuweisen. Owner-Regel vom
	// 16.08.2026: vorangehakt ist nur das Fuellen einer LUECKE.
	karte: {
		// ⚠️ NICHT api/edit/wiki/citymaps.php -- die ist ausdruecklich NUR-GET und liest die
		// Wiki-Registry. Geschrieben wird `citymap`, also der Karten-Schreibendpunkt (`edit`).
		url: "/api/edit/map/citymaps.php",
		koerper: { action: "assign_publication_articles" },
		// Gemessen an avesmapsCitymapAssignPublicationArticles: ok, dry_run, total,
		// citymaps_affected, articles_linked, applied, skipped{}, key_mismatch{}.
		zahl: function (antwort) { return Number((antwort && antwort.citymaps_affected) || 0); },
		wikiZahl: function (antwort) { return Number((antwort && antwort.articles_linked) || 0); },
		// Kurz aus demselben Grund wie bei den zwei Nachbarn: rund 34 Zeichen in der `t2`-Zeile.
		objekt: ["Karte", "Karten"],
		wikiObjekt: ["Publikation", "Publikationen"],
		frage: function (zahl, wikiZahl, antwort) {
			var uebersprungen = (antwort && antwort.skipped) || {};
			var unberuehrt = Number(uebersprungen.already_assigned || 0) + Number(uebersprungen.no_article_flag || 0);
			return "Alle " + zahl + " noch nicht zugewiesenen Karten mit ihrer Publikations-Wikiseite"
				+ " verknüpfen? (" + wikiZahl + " verschiedene Seiten)"
				+ "\n\nZugewiesen wird die Seite der PUBLIKATION, in der die Karte abgedruckt ist —"
				+ " nicht ein eigener Artikel der Karte. Den gibt es im Wiki fast nie."
				+ "\n\nDer Lauf ERGÄNZT nur: " + unberuehrt + " Karten tragen bereits eine Zuweisung oder"
				+ " den Merker „Kein Wiki-Artikel vorhanden“ und bleiben unberührt. Es wird nichts überschrieben."
				+ "\n\nWeitere " + Number(uebersprungen.no_publication || 0) + " Karten stecken in keiner"
				+ " Publikation mit Wikiseite (eigene und Fankarten) — sie kommen gar nicht in Frage.";
		},
	},
};

function avesmapsWikiMassenlaufRezept(art) {
	var rezept = Object.prototype.hasOwnProperty.call(AVESMAPS_WIKI_MASSENLAUF, String(art))
		? AVESMAPS_WIKI_MASSENLAUF[String(art)]
		: null;
	if (!rezept) {
		throw new Error("Unbekannte Massenlauf-Art: " + String(art));
	}
	return rezept;
}

// Der Rumpf der VORSCHAU. Bewusst OHNE `dry_run` und OHNE `confirm`: die Vorgabe des Servers ist
// der Trockenlauf, und ein hier hingeschriebenes `dry_run:true` waere eine zweite Wahrheit, die
// auseinanderlaufen kann.
function avesmapsWikiMassenlaufVorschauKoerper(art) {
	return Object.assign({}, avesmapsWikiMassenlaufRezept(art).koerper);
}

// Der Rumpf des SCHARFEN Laufs -- beide Haelften des Riegels, siehe Kopf.
function avesmapsWikiMassenlaufSchreibKoerper(art) {
	return Object.assign({}, avesmapsWikiMassenlaufRezept(art).koerper, { dry_run: false, confirm: "apply" });
}

// 🔴 Wirft bei jedem Nein. Ein stilles Auflösen hiesse fuer den Knopf „hat geklappt", und der
// Editor haelt einen Fehlschlag fuer einen leeren Bestand.
function avesmapsWikiMassenlaufAntwortPruefen(antwort) {
	if (!antwort || antwort.ok !== true) {
		var fehler = antwort && antwort.error;
		var text = (typeof fehler === "string" ? fehler : (fehler && fehler.message)) || "Der Massenlauf ist fehlgeschlagen.";
		throw new Error(text);
	}
	return antwort;
}

// Die Antwort des SCHARFEN Laufs wird zurueckgelesen: kam sie als Trockenlauf zurueck, wurde nichts
// geschrieben -- und ohne diese Probe meldete der Knopf trotzdem Erfolg.
function avesmapsWikiMassenlaufSchreibAntwortPruefen(antwort) {
	avesmapsWikiMassenlaufAntwortPruefen(antwort);
	if (antwort.dry_run !== false) {
		throw new Error("Der Server hat nur eine Vorschau gerechnet — es wurde nichts geschrieben.");
	}
	return antwort;
}

function avesmapsWikiMassenlaufWort(paar, anzahl) {
	return Number(anzahl) === 1 ? paar[0] : paar[1];
}

// Die Zeile IM Knopf (`t2`) -- Zustand gehoert in den Knopf, nicht daneben.
function avesmapsWikiMassenlaufKurztext(art, antwort) {
	var rezept = avesmapsWikiMassenlaufRezept(art);
	var zahl = rezept.zahl(antwort);
	if (zahl <= 0) {
		return "nichts offen";
	}
	return zahl + " " + avesmapsWikiMassenlaufWort(rezept.objekt, zahl)
		+ " · " + rezept.wikiZahl(antwort) + " " + avesmapsWikiMassenlaufWort(rezept.wikiObjekt, rezept.wikiZahl(antwort));
}

// ⚠️ DIE GANZE ANTWORT REIST ALS DRITTES ARGUMENT MIT, und die zwei aelteren Rezepturen ignorieren
// sie schlicht. Grund: die Karte muss in ihrer Rueckfrage sagen, WIE VIELE Karten unberuehrt bleiben --
// sie ergaenzt ja nur. Solange nichts zugewiesen ist, sind das 0; nach dem ersten Lauf sind es alle,
// und dann ist genau diese Zahl die Auskunft. Zwei Zahlen in die Signatur zu pressen und die dritte
// wegzulassen waere die halbe Auskunft, gegen die dieser Knopf gebaut ist.
function avesmapsWikiMassenlaufFrage(art, antwort) {
	var rezept = avesmapsWikiMassenlaufRezept(art);
	return rezept.frage(rezept.zahl(antwort), rezept.wikiZahl(antwort), antwort);
}

/**
 * Der ganze Ablauf: zeigen, fragen, schreiben.
 *
 * umgebung.post(url, koerper) -> Zusage auf die gelesene Antwort (der Aufrufer bringt sein fetch mit)
 * umgebung.frage(text)        -> true/false (window.confirm)
 * umgebung.melde(schritt, antwort) -> optional; schritt ∈ pruefen|leer|vorschau|abgebrochen|schreiben|geschrieben
 *
 * Liefert { zustand, zahl, geschrieben, vorschau, ergebnis } mit
 * zustand ∈ "leer" | "abgebrochen" | "geschrieben". Wirft bei jedem Fehlschlag.
 */
function avesmapsWikiMassenlauf(art, umgebung) {
	var rezept = avesmapsWikiMassenlaufRezept(art);
	var post = umgebung && umgebung.post;
	var frage = umgebung && umgebung.frage;
	if (typeof post !== "function" || typeof frage !== "function") {
		return Promise.reject(new Error("Massenlauf ohne Umgebung: post und frage werden gebraucht."));
	}
	var melde = (umgebung && typeof umgebung.melde === "function") ? umgebung.melde : function () {};

	melde("pruefen", null);
	return Promise.resolve(post(rezept.url, avesmapsWikiMassenlaufVorschauKoerper(art)))
		.then(function (rohVorschau) {
			var vorschau = avesmapsWikiMassenlaufAntwortPruefen(rohVorschau);
			var zahl = rezept.zahl(vorschau);
			if (zahl <= 0) {
				melde("leer", vorschau);
				return { zustand: "leer", zahl: 0, geschrieben: 0, vorschau: vorschau, ergebnis: null };
			}
			// Die Zahl steht IM Knopf, BEVOR gefragt wird -- die Rueckfrage blockiert, und wer sie
			// wegklickt, soll den gemessenen Stand dort stehen sehen.
			melde("vorschau", vorschau);
			if (!frage(avesmapsWikiMassenlaufFrage(art, vorschau))) {
				melde("abgebrochen", vorschau);
				return { zustand: "abgebrochen", zahl: zahl, geschrieben: 0, vorschau: vorschau, ergebnis: null };
			}
			melde("schreiben", vorschau);
			return Promise.resolve(post(rezept.url, avesmapsWikiMassenlaufSchreibKoerper(art)))
				.then(function (rohErgebnis) {
					var ergebnis = avesmapsWikiMassenlaufSchreibAntwortPruefen(rohErgebnis);
					melde("geschrieben", ergebnis);
					return {
						zustand: "geschrieben",
						zahl: zahl,
						geschrieben: Number(ergebnis.applied || 0),
						vorschau: vorschau,
						ergebnis: ergebnis,
					};
				});
		});
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_WIKI_MASSENLAUF: AVESMAPS_WIKI_MASSENLAUF,
		avesmapsWikiMassenlaufRezept: avesmapsWikiMassenlaufRezept,
		avesmapsWikiMassenlaufVorschauKoerper: avesmapsWikiMassenlaufVorschauKoerper,
		avesmapsWikiMassenlaufSchreibKoerper: avesmapsWikiMassenlaufSchreibKoerper,
		avesmapsWikiMassenlaufAntwortPruefen: avesmapsWikiMassenlaufAntwortPruefen,
		avesmapsWikiMassenlaufSchreibAntwortPruefen: avesmapsWikiMassenlaufSchreibAntwortPruefen,
		avesmapsWikiMassenlaufKurztext: avesmapsWikiMassenlaufKurztext,
		avesmapsWikiMassenlaufFrage: avesmapsWikiMassenlaufFrage,
		avesmapsWikiMassenlauf: avesmapsWikiMassenlauf,
	};
}
