// Der Kasten „Wiki-Weg" der GANZEN Strasse -- eine Zeile je Hauptzuweisung, jede fuer genau ihre Abschnitte bearbeitbar.
// EIN Bauteil fuer die Weg-Ebene des Wege-Editors (Huelle „dt", js/pages/wege-editor.js) und den Gruppendialog der Karte
// (Huelle „label-wiki", js/review/review-path-wiki.js). Nur die Huelle unterscheidet sich (avesmapsWikiAssignSkin).
//
// 🔴 Owner 15.09.2026: „bearbeiten des segments: zeigt mir alle wiki-zuweisungen auf dieses segment an / bearbeiten der ganzen
// straße: zeigt mir wiki-zuweisungen per segmente an", auf Rueckfrage „Gleiche zusammenfassen" und „Je Zeile bearbeitbar".
// Die Strasse ist der NAME (wpGroupKeyOf) und kann gemischte Hauptzuweisungen tragen -- live Reichsstraße 2: 49 Abschnitte mit
// Artikel, 18 ohne. Bis dahin stand hier EIN Bauteil mit der ersten gefundenen Zuweisung, das je nach Klick „keine" oder
// „Reichsstraße 2" zeigte und auf alle Abschnitte schrieb.
//
// Wer was tut:
//  - die REGEL (welche Zeilen, welche Abschnitte, welche Nummern) steht im Modell: wpGruppeZuweisungsZeilen und
//    wpAbschnittNummernText (js/pages/wege-editor-model.js) -- keine zweite Fassung hier;
//  - je Zeile arbeitet das GETEILTE Bauteil (avesmapsWikiAssignMount, js/ui/wiki-assign.js) samt seiner Suche -- kein eigener
//    Suchbaustein, keine Kopie der Trefferliste;
//  - den DATENWEG bringt der Wirt je Zeile mit (opts.datenweg): `laden` liefert den Stand des ersten Abschnitts der Zeile,
//    `zuweisen`/`loesen` schreiben per `public_ids` GENAU ihre Abschnitte (Anker ist der erste) und zeichnen danach neu.
// Dieses Bauteil kennt keinen Endpunkt und kein `fetch`.
//
// ⚠️ Liegt in index.html in derselben <template data-nur-editor> wie js/ui/wiki-assign.js (nur review-path-wiki.js ruft es);
// html/wege-editor.html laedt es selbst. Ein NORMALES Skript, das es je braucht, muss es per `typeof` schuetzen
// (js/app/__tests__/nur-editor-skripte.test.js, Teil C).

const AVESMAPS_WIKI_WEG_ZEILEN_TEXTE = {
	titel: "Wiki-Weg",
	keine: "keine",
	hinweis: "Eine Zeile je Wiki-Zuweisung — Zuweisen und Entfernen gelten nur den Abschnitten ihrer Zeile.",
	leer: "Keine Abschnitte.",
	weitere: "weitere",
	anAllen: "an allen",
	fehlt: "Wiki-Weg: das geteilte Bauteil ist nicht geladen (js/ui/wiki-assign.js).",
	keinEntfernen: "Diese Abschnitte tragen keine Wiki-Zuweisung.",
};

function avesmapsWikiWegZeilenEsc(wert) {
	return String(wert === null || wert === undefined ? "" : wert)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function avesmapsWikiWegZeilenKlasse(wert) {
	const klasse = String(wert === null || wert === undefined ? "" : wert).trim();
	return klasse === "" ? "" : ' class="' + avesmapsWikiWegZeilenEsc(klasse) + '"';
}

/** REIN: nur http(s) wird ein Link -- ueber die Pruefung des Bauteils, sonst dieselbe Regel. Eine Adresse kommt aus dem Wiki. */
function avesmapsWikiWegZeilenUrl(wert) {
	if (typeof avesmapsWikiAssignSichereUrl === "function") {
		return avesmapsWikiAssignSichereUrl(wert);
	}
	const text = String(wert === null || wert === undefined ? "" : wert).trim();
	return /^https?:\/\//i.test(text) ? text : "";
}

/** REIN: ein Artikel als Link mit ↗ (AGENTS.md §12: externe Links tragen ↗), ohne sichere Adresse nur der Name. */
function avesmapsWikiWegZeilenArtikel(eintrag, skin) {
	const url = avesmapsWikiWegZeilenUrl(eintrag.wiki_url);
	return url === ""
		? '<span class="wiki-weg-zeile__name">' + avesmapsWikiWegZeilenEsc(eintrag.name) + "</span>"
		: "<a" + avesmapsWikiWegZeilenKlasse(skin.link) + ' href="' + avesmapsWikiWegZeilenEsc(url) + '" target="_blank" rel="noopener">'
			+ avesmapsWikiWegZeilenEsc(eintrag.name) + " ↗</a>";
}

/**
 * REIN: EINE Zeile als natives <details> -- Suchbarkeit und Tastatur wie im Haus (Strg+F findet den Text einer zugeklappten Zeile,
 * AGENTS.md §11 „Hinweise"). Die Zusammenfassung: Artikel (Link ↗ bzw. „keine") · „N Abschnitte" · kompakte Nummern · weitere
 * Zuweisungen dieser Abschnitte („auf K", wenn nicht alle sie tragen). Der Koerper: der Platz fuer das Bauteil, darunter die weiteren
 * Zuweisungen mit ✕ -- sie gelten den Abschnitten DIESER Zeile.
 */
function avesmapsWikiWegZeileMarkup(zeile, index, skin, offen) {
	const esc = avesmapsWikiWegZeilenEsc;
	const texte = AVESMAPS_WIKI_WEG_ZEILEN_TEXTE;
	const anzahl = zeile.public_ids.length;
	const artikel = zeile.wiki_key === ""
		? '<span class="wiki-weg-zeile__keine">' + esc(texte.keine) + "</span>"
		: avesmapsWikiWegZeilenArtikel(zeile, skin);
	const nummern = typeof wpAbschnittNummernText === "function" ? wpAbschnittNummernText(zeile.nummern) : "";
	const umfang = [anzahl + (anzahl === 1 ? " Abschnitt" : " Abschnitte"), nummern].filter((teil) => teil !== "").join(" · ");
	const weitere = zeile.weitere.map((eintrag) => esc(eintrag.name) + (eintrag.anzahl < anzahl ? " auf " + eintrag.anzahl : "")).join(", ");
	const tabelle = zeile.weitere.length === 0 ? "" : '<table class="wiki-weitere">' + zeile.weitere.map((eintrag) => "<tr><td>"
		+ avesmapsWikiWegZeilenArtikel(eintrag, skin) + ' <span class="wiki-weitere__schluessel">' + esc(eintrag.wiki_key) + "</span></td>"
		+ '<td class="wiki-weitere__art">' + esc(eintrag.anzahl < anzahl ? "auf " + eintrag.anzahl + " von " + anzahl : (anzahl > 1 ? texte.anAllen : ""))
		+ ' <button type="button" class="wiki-weitere__weg" data-wiki-weg-weitere="' + esc(eintrag.wiki_key) + '" aria-label="'
		+ esc("Weitere Zuweisung " + eintrag.name + " von den Abschnitten dieser Zeile entfernen") + '">✕</button></td></tr>').join("")
		+ "</table>";
	return '<details class="wiki-weg-zeile" data-wiki-weg-zeile="' + index + '"' + (offen ? " open" : "") + ">"
		+ '<summary class="wiki-weg-zeile__kopf"><span class="wiki-weg-zeile__artikel">' + artikel + "</span>"
		+ ' <span class="wiki-weg-zeile__umfang">' + esc(umfang) + "</span>"
		+ (weitere === "" ? "" : '<span class="wiki-weg-zeile__weitere">' + esc(texte.weitere) + ": " + weitere + "</span>")
		+ "</summary>"
		+ '<div class="wiki-weg-zeile__koerper"><div data-wiki-weg-zeile-host></div>' + tabelle + "</div>"
		+ "</details>";
}

/**
 * REIN: der ganze Kasten als HTML -- Huelle und Ueberschrift des Wirts, die Zeilen, darunter EINMAL der Platz fuer den Kasten
 * „weitere Wiki-Zuweisung fuer die ganze Straße" (opts.anhang des Mounts).
 * 🔴 Eine Strasse mit nur EINER Zeile zeigt sie aufgeklappt: der Normalfall sieht aus wie vorher. Sonst ist offen, was in
 * `offeneKeys` steht (die Zeilen, die der Editor aufgeklappt hat -- ueber ein Neuzeichnen hinweg).
 */
function avesmapsWikiWegZeilenMarkup(zeilen, skin, offeneKeys) {
	const esc = avesmapsWikiWegZeilenEsc;
	const texte = AVESMAPS_WIKI_WEG_ZEILEN_TEXTE;
	const s = skin || {};
	const liste = Array.isArray(zeilen) ? zeilen : [];
	const offen = Array.isArray(offeneKeys) ? offeneKeys : [];
	const erklaerung = typeof avesmapsWikiAssignSubject === "function" ? avesmapsWikiAssignSubject("weg") : null;
	const titel = (erklaerung && erklaerung.label) || texte.titel;
	const teile = ["<div" + avesmapsWikiWegZeilenKlasse(s.kopf) + "><span" + avesmapsWikiWegZeilenKlasse(s.kopfTitel) + ">" + esc(titel) + "</span></div>"];
	if (liste.length > 1) {
		teile.push("<div" + avesmapsWikiWegZeilenKlasse(s.hinweis) + ">" + esc(texte.hinweis) + "</div>");
	}
	if (liste.length === 0) {
		teile.push("<div" + avesmapsWikiWegZeilenKlasse(s.hinweis) + ">" + esc(texte.leer) + "</div>");
	}
	liste.forEach((zeile, index) => {
		teile.push(avesmapsWikiWegZeileMarkup(zeile, index, s, liste.length === 1 || offen.indexOf(zeile.wiki_key) !== -1));
	});
	teile.push('<div data-wiki-weg-zeilen-anhang></div>');
	const wurzel = [s.wurzel, "wiki-weg-zeilen"].filter((klasse) => String(klasse || "").trim() !== "").join(" ");
	return '<div class="' + esc(wurzel) + '">' + teile.join("") + "</div>";
}

/** Ein Rueckruf des Wirts als Zusage -- ein synchroner Wurf ist eine Ablehnung (derselbe Riegel wie avesmapsWikiAssignRufen). */
function avesmapsWikiWegZeilenRufen(rueckruf, a, b) {
	try {
		return Promise.resolve(typeof rueckruf === "function" ? rueckruf(a, b) : null);
	} catch (fehler) {
		return Promise.reject(fehler);
	}
}

/**
 * Den Kasten in `behaelter` montieren.
 * @param {Object} optionen
 *   skin            "dt" | "label-wiki"
 *   zeilen()        die Zeilen, bei JEDEM Zeichnen frisch gelesen (wpGruppeZuweisungsZeilen des Wirts)
 *   datenweg(zeile) { laden, zuweisen, loesen, syncUebernehmen } fuer GENAU diese Zeile
 *   weitereEntfernen(zeile, eintrag)  das ✕ einer weiteren Zuweisung -- eintrag.public_ids sind ihre Traeger in dieser Zeile
 *   anhang          ein Element des Wirts (der Kasten der weiteren Zuweisungen der ganzen Strasse), unter den Zeilen eingehaengt
 * @return {{bereit: boolean, neuZeichnen: Function, zerstoeren: Function}}
 */
function avesmapsWikiWegZeilenMount(behaelter, optionen) {
	const opt = optionen || {};
	if (!behaelter || typeof avesmapsWikiAssignMount !== "function") {
		// 💣 Kein stiller Leerlauf: ein leerer Fleck saehe aus wie „diese Strasse hat keine Zuweisung".
		if (behaelter) {
			behaelter.textContent = AVESMAPS_WIKI_WEG_ZEILEN_TEXTE.fehlt;
		}
		return { bereit: false, neuZeichnen: () => {}, zerstoeren: () => {} };
	}
	const skin = (typeof avesmapsWikiAssignSkin === "function" && avesmapsWikiAssignSkin(opt.skin)) || {};
	let zeilen = [];
	// Welche Zeilen der Editor aufgeklappt hat -- am Schluessel, damit ein Neuzeichnen sie wiederfindet.
	const offeneKeys = [];
	// Je gezeichneter Zeile: ihr <details>, ihr Toggle-Zuhoerer und -- nur solange sie offen ist -- die Steuerung des Bauteils.
	let eintraege = [];
	let schreibtGerade = false;

	function abbauen(eintrag) {
		if (eintrag.steuerung) {
			eintrag.steuerung.zerstoeren();
			eintrag.steuerung = null;
		}
	}

	function montieren(eintrag) {
		const zeile = zeilen[eintrag.index];
		const platz = typeof eintrag.details.querySelector === "function" ? eintrag.details.querySelector("[data-wiki-weg-zeile-host]") : null;
		if (eintrag.steuerung || !zeile || !platz) {
			return;
		}
		const datenweg = (typeof opt.datenweg === "function" && opt.datenweg(zeile)) || {};
		eintrag.steuerung = avesmapsWikiAssignMount(platz, {
			subject: "weg",
			skin: opt.skin,
			laden: datenweg.laden,
			trefferAufbereiten: typeof avesmapsWikiAssignWegTreffer === "function" ? avesmapsWikiAssignWegTreffer : undefined,
			zuweisen: datenweg.zuweisen,
			// 🔴 Die Zeile „keine" hat kein Entfernen -- und wird es doch gerufen, LEHNT es ab. Ein fehlender Rueckruf loeste im
			// Bauteil auf (avesmapsWikiAssignRufen), und der Kasten zeigte „geloest" fuer etwas, das niemand geschrieben hat.
			loesen: zeile.wiki_key === "" ? () => Promise.reject(new Error(AVESMAPS_WIKI_WEG_ZEILEN_TEXTE.keinEntfernen)) : datenweg.loesen,
			syncUebernehmen: datenweg.syncUebernehmen,
		});
	}

	function alleAbbauen() {
		eintraege.forEach((eintrag) => {
			abbauen(eintrag);
			if (typeof eintrag.details.removeEventListener === "function") {
				eintrag.details.removeEventListener("toggle", eintrag.aufToggle);
			}
		});
		eintraege = [];
	}

	function zeichnen() {
		// 🔴 Erst abbauen, dann zeichnen: jedes offene Bauteil haengt Zuhoerer an seinen Platz, und `innerHTML` nimmt nur die Knoten mit.
		alleAbbauen();
		const neu = typeof opt.zeilen === "function" ? opt.zeilen() : [];
		zeilen = Array.isArray(neu) ? neu : [];
		behaelter.innerHTML = avesmapsWikiWegZeilenMarkup(zeilen, skin, offeneKeys);
		const gefunden = typeof behaelter.querySelectorAll === "function" ? behaelter.querySelectorAll("[data-wiki-weg-zeile]") : [];
		Array.prototype.forEach.call(gefunden, (details) => {
			const index = parseInt(details.getAttribute("data-wiki-weg-zeile"), 10);
			if (!(index >= 0 && index < zeilen.length)) {
				return;
			}
			const eintrag = { details, index, steuerung: null, aufToggle: null };
			// ⚠️ `toggle` blubbert nicht -- deshalb ein Zuhoerer je Zeile. Er kommt auch nach dem Einfuegen einer offenen Zeile noch
			// einmal (der Browser meldet das `open` des Markups), und `montieren` ist dafuer wiederholbar.
			eintrag.aufToggle = () => {
				const key = zeilen[eintrag.index] ? zeilen[eintrag.index].wiki_key : null;
				const stelle = key === null ? -1 : offeneKeys.indexOf(key);
				if (details.open) {
					if (key !== null && stelle === -1) {
						offeneKeys.push(key);
					}
					montieren(eintrag);
					return;
				}
				if (stelle !== -1) {
					offeneKeys.splice(stelle, 1);
				}
				abbauen(eintrag);
			};
			details.addEventListener("toggle", eintrag.aufToggle);
			eintraege.push(eintrag);
			if (details.open) {
				montieren(eintrag);
			}
		});
		if (opt.anhang && typeof behaelter.querySelector === "function") {
			const platz = behaelter.querySelector("[data-wiki-weg-zeilen-anhang]");
			if (platz && typeof platz.appendChild === "function") {
				platz.appendChild(opt.anhang);
			}
		}
	}

	function aufKlick(ereignis) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.closest !== "function") {
			return;
		}
		const knopf = ziel.closest("[data-wiki-weg-weitere]");
		if (!knopf) {
			return;
		}
		ereignis.preventDefault();
		// Ein Doppelklick auf ✕ schickt keinen zweiten Schreibvorgang -- freigegeben in BEIDEN Ausgaengen.
		if (schreibtGerade) {
			return;
		}
		const details = knopf.closest("[data-wiki-weg-zeile]");
		const zeile = details ? zeilen[parseInt(details.getAttribute("data-wiki-weg-zeile"), 10)] : null;
		const key = knopf.getAttribute("data-wiki-weg-weitere");
		const eintrag = zeile ? zeile.weitere.filter((weiter) => weiter.wiki_key === key)[0] : null;
		if (!eintrag || typeof opt.weitereEntfernen !== "function") {
			return;
		}
		schreibtGerade = true;
		const frei = () => { schreibtGerade = false; };
		avesmapsWikiWegZeilenRufen(opt.weitereEntfernen, zeile, eintrag).then(frei, frei);
	}

	behaelter.addEventListener("click", aufKlick);
	zeichnen();

	return {
		bereit: true,
		neuZeichnen: zeichnen,
		zerstoeren: function () {
			alleAbbauen();
			behaelter.removeEventListener("click", aufKlick);
			behaelter.innerHTML = "";
		},
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_WIKI_WEG_ZEILEN_TEXTE,
		avesmapsWikiWegZeileMarkup,
		avesmapsWikiWegZeilenMarkup,
		avesmapsWikiWegZeilenMount,
	};
}
