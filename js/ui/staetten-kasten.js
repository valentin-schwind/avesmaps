// Der Kasten "Stätten" -- gespeicherte Innerorts-Objekte (`settlement_place`) eines Ortes
// loeschen und an einen anderen Ort haengen.
//
// Entwurf: docs/superpowers/specs/2026-09-26-staetten-loeschen-umhaengen-design.md (§5)
// Mockup: docs/staetten-kasten-mockup.html · Endpunkt: api/edit/map/settlement-places.php
//
// mountStaettenKasten(host, opts) kennt keine Montagestelle -- sie wird zweimal montiert (Dialog
// "Ort bearbeiten" und das Detailfeld des Ortseditors), jeweils direkt vor "Quellen" (Quellen
// bleiben immer ganz unten, Owner 03.09.2026). Nur die GESPEICHERTEN Stätten sind hier
// bearbeitbar; die aus dem Wiki abgeleiteten (siehe AGENTS.md §11 "Staetten loeschen und
// umhaengen -- und der offene Folgeauftrag 'innerorts als eigenes Praedikat'", offen) zaehlt nur
// die graue Zeile.
//
// 🔴 DIE fs-KLASSEN DES QUELLENKASTENS WERDEN MITBENUTZT (`.fs-row__edit`/`.fs-row__remove` fuer
// die Knoepfe, `.fs-row--open` fuer die offene Zeile, `.fs-actions`/`__prim`/`__sek`,
// `.fs-add-note`/`--ok` fuer die Meldezeile) -- `feature-sources.css` ist an beiden
// Montagestellen ohnehin geladen. Neu ist nur, was in css/components/staetten-kasten.css steht.
//
// 💣 GENAU EINE FALTE OFFEN. Sie liegt als `.st-falte` direkt nach der Zeile, deren ⇄/✕ sie
// aufgeklappt hat; ein zweiter Klick auf denselben Knopf schliesst sie wieder, ein Klick auf
// einen anderen Knopf ersetzt sie.
//
// ⭐ DIE ORTSSUCHE LAEUFT UEBER DEN GETEILTEN TYPEAHEAD (js/ui/source-autocomplete.js,
// `attachTypeahead`) -- keine eigene Vorschlagsliste, keine eigene Tastatursteuerung. Injizierbar
// als `opts.attachTypeaheadImpl` (Tests brauchen so kein DOM fuer die Dropdown-Mechanik selbst).

// Root-absolut: das Bauteil haengt auch im Ortseditor-iframe (html/wiki-sync-settlement-editor.html),
// wo ein relativer Pfad unter html/ aufgeloest wuerde -- derselbe Grund wie bei
// SOURCE_AUTOCOMPLETE_API_URL in source-autocomplete.js.
var STAETTEN_KASTEN_API_URL = "/api/edit/map/settlement-places.php";

// I2: die EINZIGE Maskierung, die dieses Bauteil benutzt -- vollstaendig (& < > " '), weil
// escape()-Ergebnisse hier auch in ATTRIBUTEN landen (href, data-st-id, title, aria-label,
// value), nicht nur in Textknoten. `opts.escape` wird deshalb absichtlich NICHT mehr gereicht
// (siehe mountStaettenKasten): der Ortseditor uebergab `settlementEscape`
// (html/wiki-sync-settlement-editor.html), das bis zum 26.09.2026 nur `textContent` ->
// `innerHTML` maskierte und damit `"` NICHT abdeckte -- ein Name oder eine Wiki-Adresse mit `"`
// haette ein Attribut aufgebrochen. Seither maskiert es vollstaendig; die eigene Maskierung
// bleibt trotzdem, weil ein Bauteil, das in Attribute schreibt, seine Sicherheit nicht vom Wirt
// leiht.
function staettenKastenDefaultEscape(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Uebersetzung: opts.tr, sonst ein globales tr/window.tr (falls die Seite eine i18n-Schicht hat),
// sonst der deutsche Fallback-Text. Schluessel tragen das Praefix "staetten." (Controller-Vorgabe).
function staettenKastenTr(options, key, fallback) {
  if (options && typeof options.tr === "function") {
    return options.tr(key, fallback);
  }
  if (typeof window !== "undefined" && typeof window.tr === "function") {
    return window.tr(key, fallback);
  }
  if (typeof tr === "function") {
    return tr(key, fallback);
  }
  return fallback;
}

// Die fuenf Siedlungsklassen, aus denen die Ortssuche des Endpunkts ueberhaupt waehlt
// (api/_internal/app/settlement-places.php filtert auf dieselbe Liste wie
// AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES). Rueckfall, siehe staettenKastenOrtsklassenLabel.
var STAETTEN_KASTEN_ORTSKLASSEN_FALLBACK = {
  dorf: "Dorf",
  kleinstadt: "Kleinstadt",
  stadt: "Stadt",
  grossstadt: "Großstadt",
  metropole: "Metropole",
};

/**
 * Die Beschriftung einer Ortsklasse fuer die Trefferliste der Ortssuche ("Dorf · Garetien").
 *
 * 🔴 `LOCATION_TYPE_CONFIG` (js/config.js) traegt dieselben Label laengst -- aber js/config.js ist
 * im Ortseditor-iframe (html/wiki-sync-settlement-editor.html) NICHT geladen, an dieser
 * Montagestelle waere der Zugriff `undefined`. Die Tafel oben ist deshalb ein eigener, kleiner
 * Rueckfall statt einer Abschrift der ganzen Konfiguration -- sie deckt genau die fuenf
 * Siedlungsklassen ab, aus denen der Server ueberhaupt waehlt.
 */
function staettenKastenOrtsklassenLabel(subtype) {
  var key = String(subtype || "");
  if (typeof window !== "undefined") {
    if (typeof window.avesmapsOrtsklassenLabel === "function") {
      var eigens = window.avesmapsOrtsklassenLabel(key);
      if (eigens) {
        return eigens;
      }
    }
    if (window.LOCATION_TYPE_CONFIG && window.LOCATION_TYPE_CONFIG[key]) {
      return window.LOCATION_TYPE_CONFIG[key].singularLabel || window.LOCATION_TYPE_CONFIG[key].label || key;
    }
  }
  return STAETTEN_KASTEN_ORTSKLASSEN_FALLBACK[key] || key;
}

// Der Wirt einer Wiki-Adresse ohne "www." -- fuer die Zeile 2 einer Staette ("garetien.de ↗").
// Liefert "" bei einer nicht parsebaren Adresse UND bei einer ohne Host (z. B. "javascript:…" --
// eine solche URL wirft nicht, hat aber keine Autoritaet und damit keinen `host`).
function staettenKastenWirt(url) {
  try {
    var geparst = new URL(String(url || ""));
    return geparst.host.replace(/^www\./i, "");
  } catch (fehler) {
    return "";
  }
}

/**
 * Darf eine Wiki-Adresse als `<a href>` erscheinen? Nur http/https (Protokoll, Gross/Klein egal).
 *
 * 🔴 Alles andere -- `javascript:`, `data:`, `mailto:`, … -- wird NIE zu einem echten Link:
 * `javascript:` waere in einem `<a href>` ein Sicherheitsloch (Klick fuehrt Code aus), die
 * anderen sind fuer eine Kartenquelle sinnlos. Review-Vorgabe (Task 4, Punkt 3).
 *
 * 🔴 SEIT 26.09.2026 FRAGT DER KASTEN DIE GETEILTE REGEL (featureSourceSichereUrl,
 * js/ui/feature-source-markup.js) -- dieselbe, die Infobox und Quellen-Editor fuer ihre Links
 * nehmen. Vorher stand hier eine eigene Fassung ueber `new URL()`; sie liess `https:foo` (ohne
 * `//`) durch, die geteilte nicht. Weiterreicher wie in review-feature-sources.js: laut ohne die
 * Datei, bei jedem Aufruf nachgeschlagen. Jede Seite, die diesen Kasten laedt, laedt die Datei davor.
 */
function staettenKastenIstVerlinkbareAdresse(url) {
  var geteilt = (typeof module !== "undefined" && module.exports)
    ? require("./feature-source-markup.js").featureSourceSichereUrl
    : (typeof featureSourceSichereUrl === "function" ? featureSourceSichereUrl : null);
  if (typeof geteilt !== "function") {
    throw new Error("feature-source-markup.js fehlt -- sie traegt die Regel, welche Adresse ein Link wird");
  }
  return geteilt(url) !== "";
}

// Hebt jedes Vorkommen des Suchworts in einem Namen hervor -- wie renderSourceAutocompleteLabel
// in source-autocomplete.js, aber lokal: jene Funktion haengt im Browser nicht an window (nur
// unter Node exportiert), und eine dritte Abschrift ist billiger als eine unsichtbare Abhaengigkeit.
function staettenKastenHervorhebung(text, suchwort, escape) {
  var roh = String(text === null || text === undefined ? "" : text);
  var wort = String(suchwort || "").trim();
  if (wort === "") {
    return escape(roh);
  }
  var kleinRoh = roh.toLowerCase();
  var kleinWort = wort.toLowerCase();
  var out = "";
  var cursor = 0;
  var treffer = kleinRoh.indexOf(kleinWort);
  while (treffer !== -1) {
    out += escape(roh.slice(cursor, treffer)) + "<mark>" + escape(roh.slice(treffer, treffer + wort.length)) + "</mark>";
    cursor = treffer + wort.length;
    treffer = kleinRoh.indexOf(kleinWort, cursor);
  }
  return out + escape(roh.slice(cursor));
}

// ── Rein: das Markup einer Stätten-Zeile -- DREI Sorten (Spec §6.3, Mockup Szene 5/6) ────────────
// 🔴 „Sorte" entscheidet `staette.art` (nur ein innerorts-PUNKT traegt `art: "punkt"`, gesetzt vom
// Server in avesmapsInnerortsPunkteEinerStadt/avesmapsStaettenEndpunktListe -- eine gespeicherte
// Staette hat das Feld nicht) und `staette.auf_der_karte` (nur bei einem Punkt sinnvoll):
//   1. Punkt AUF der Karte           -- "auf der Karte" + ⊕, nur ⇄ (geloescht wird auf der Karte)
//   2. Punkt VON der Karte genommen  -- "nicht auf der Karte", ⦿ zurueck · ⇄ · ✕ (endgueltig)
//   3. gespeicherte Staette          -- unveraendert: Link + ⇄ · ✕
function staettenKastenZeileMarkup(staette, offenId, offenArt, escape, tr, aufDieKarteSendetId) {
  var id = String(staette.public_id);
  var offenFuerDiese = offenId !== null && offenId === id;
  var istPunkt = staette.art === "punkt";
  var aufDerKarte = istPunkt && staette.auf_der_karte === true;
  // B1: `.fs-row--open` hebt nur das ⇄ hervor (`.fs-row--open .fs-row__edit`,
  // feature-sources.css) -- bei offener LOESCHEN-Rueckfrage waere das falsch benannt: es gibt
  // dort nichts zum Umhaengen zu betonen. `aria-expanded` bleibt unabhaengig davon am jeweils
  // oeffnenden Knopf stehen.
  var alsUmhaengenHervorgehoben = offenFuerDiese && offenArt === "umhaengen";

  var l2;
  if (istPunkt) {
    var punktText = aufDerKarte
      ? tr("staetten.row.onMap", "auf der Karte")
      : tr("staetten.row.notOnMap", "nicht auf der Karte");
    // ⊕ nur, solange der Punkt wirklich auf der Karte liegt -- von der Karte genommen springt
    // nichts an (die Suche fuehrt dann auf die Stadt, Spec §6.2).
    var sprung = aufDerKarte
      ? '<button type="button" class="innerorts-sprung" data-public-id="' + escape(id) + '"'
        + ' title="' + escape(tr("staetten.row.jumpTitle", "Auf der Karte zeigen")) + '"'
        + ' aria-label="' + escape(tr("staetten.row.jumpLabel", "Auf der Karte zeigen")) + '">⊕</button>'
      : "";
    l2 = '<div class="avm-row__l2">' + escape(punktText) + sprung + "</div>";
  } else {
    var wikiUrl = String(staette.wiki_url || "");
    var wirtText = staettenKastenWirt(wikiUrl);
    // 🔴 NUR http/https wird zu einem <a href> -- alles andere (nicht parsebar, ohne Host, oder ein
    // anderes Protokoll wie "javascript:") zeigt hoechstens den Wirtstext, nie einen Link und nie
    // den Pfeil (Review-Vorgabe, Task 4 Punkte 3+4). Ist auch der Text leer, traegt die Zeile 2
    // NICHTS aus dieser Haelfte -- kein "nur ↗" und kein fuehrendes " · " vor dem Namensnachbar-Hinweis.
    var verlinkbar = wirtText !== "" && staettenKastenIstVerlinkbareAdresse(wikiUrl);
    var gleichnamig = staette.gleichnamig_auf_der_karte === true;
    var warnText = gleichnamig ? tr("staetten.row.duplicateOnMap", "gleichnamiger Punkt auf der Karte") : "";
    var teile = [];
    if (wirtText !== "") {
      teile.push(verlinkbar
        ? '<a href="' + escape(wikiUrl) + '" target="_blank" rel="noopener noreferrer">' + escape(wirtText) + " ↗</a>"
        : escape(wirtText));
    }
    if (gleichnamig) {
      teile.push(escape(warnText));
    }
    l2 = teile.length > 0
      ? '<div class="avm-row__l2' + (gleichnamig ? " warn" : "") + '">' + teile.join(" · ") + "</div>"
      : "";
  }

  var ariaUmhaengen = offenFuerDiese && offenArt === "umhaengen" ? ' aria-expanded="true"' : "";
  var ariaLoeschen = offenFuerDiese && offenArt === "loeschen" ? ' aria-expanded="true"' : "";
  var umhaengenKnopf = istPunkt
    // Ein Punkt haengt an einer STADT, keiner "Staette" -- eigene Beschriftung, dieselbe Aktion
    // (data-st-aktion="umhaengen") und dieselbe Falte wie bei einer gespeicherten Staette.
    ? '<button type="button" class="fs-row__edit" data-st-aktion="umhaengen"' + ariaUmhaengen
      + ' title="' + escape(tr("staetten.row.moveCityTitle", "Zu einer anderen Stadt")) + '"'
      + ' aria-label="' + escape(tr("staetten.row.moveCityLabel", "Stadt ändern")) + '">⇄</button>'
    : '<button type="button" class="fs-row__edit" data-st-aktion="umhaengen"' + ariaUmhaengen
      + ' title="' + escape(tr("staetten.row.moveTitle", "An einen anderen Ort hängen")) + '"'
      + ' aria-label="' + escape(tr("staetten.row.moveLabel", "Umhängen")) + '">⇄</button>';

  var aktionen;
  if (istPunkt && aufDerKarte) {
    // Sorte 1: nur ⇄ -- ein Punkt auf der Karte hat hier kein ✕, geloescht wird auf der Karte,
    // wo man sieht, was man loescht (Spec §6.3).
    aktionen = umhaengenKnopf;
  } else if (istPunkt) {
    // Sorte 2: von der Karte genommen -- ⦿ zurueck · ⇄ · ✕ (Merker weg, bleibt geloescht; die
    // Rueckfrage dazu nennt es "Löschen", nicht "Endgültig löschen" -- ueber "Rückgängig" im
    // Aenderungsverlauf umkehrbar, Ruling der Fix-Runde 1).
    var sendetDiese = aufDieKarteSendetId !== null && aufDieKarteSendetId !== undefined && aufDieKarteSendetId === id;
    aktionen = '<button type="button" class="fs-row__edit" data-st-aktion="auf_die_karte"' + (sendetDiese ? " disabled" : "")
      + ' title="' + escape(tr("staetten.row.putOnMapTitle", "Wieder an seiner alten Stelle auf die Karte")) + '"'
      + ' aria-label="' + escape(tr("staetten.row.putOnMapLabel", "Auf die Karte setzen")) + '">⦿</button>'
      + umhaengenKnopf
      + '<button type="button" class="fs-row__remove" data-st-aktion="loeschen"' + ariaLoeschen
      + ' title="' + escape(tr("staetten.row.deleteOffMapTitle", "Löschen")) + '"'
      + ' aria-label="' + escape(tr("staetten.row.deleteOffMapLabel", "Löschen")) + '">✕</button>';
  } else {
    // Sorte 3: gespeicherte Staette -- unveraendert.
    aktionen = umhaengenKnopf
      + '<button type="button" class="fs-row__remove" data-st-aktion="loeschen"' + ariaLoeschen
      + ' title="' + escape(tr("staetten.row.deleteTitle", "Stätte löschen")) + '"'
      + ' aria-label="' + escape(tr("staetten.row.deleteLabel", "Löschen")) + '">✕</button>';
  }

  return (
    '<div class="avm-row' + (alsUmhaengenHervorgehoben ? " fs-row--open" : "") + '" data-st-id="' + escape(id) + '">'
    + '<div class="avm-row__text">'
    + '<div class="avm-row__l1"><span class="avm-row__name">' + escape(staette.name) + "</span>"
    + '<span class="avm-row__kind">' + escape(staette.place_type) + "</span></div>"
    + l2
    + "</div>"
    + '<div class="st-aktionen">' + aktionen + "</div></div>"
  );
}

// ── Rein: die Falte "Umhängen" -- Suche, gewaehltes Ziel, Bestaetigung ────────────────────────
// `sendetGerade`: waehrend die Anfrage laeuft, sind Primaerknopf UND Abbrechen deaktiviert (Review
// Task 4 Punkt 2) -- ein zweiter Klick vor der Antwort darf keine zweite Anfrage ausloesen.
function staettenKastenFalteUmhaengenMarkup(staette, suchtext, ziel, falteFehler, sendetGerade, escape, tr) {
  var satz = "";
  if (ziel) {
    var vorlage = tr("staetten.move.confirm", "„{name}“ nach {ziel} umhängen?");
    // B3: eine eigene Klasse am Satz -- der Input-Zuhoerer (siehe onHostInput) entfernt genau
    // diesen Knoten direkt aus dem DOM, ohne die Falte neu zu zeichnen (Fokus bleibt im Feld).
    satz = '<div class="st-falte__satz">' + vorlage
      .replace("{name}", escape(staette.name))
      .replace("{ziel}", "<b>" + escape(ziel.name) + "</b>") + "</div>";
  }
  var fehlerZeile = falteFehler
    ? '<p class="fs-add-note" role="status">' + escape(falteFehler) + "</p>"
    : "";
  return (
    '<div class="st-falte">'
    // B2: `type="text"`, nicht `type="search"` -- die geteilte Ortssuche (attachTypeahead)
    // braucht keinen bestimmten Feldtyp, und Chromes natives Loeschkreuz in einem `type="search"`
    // waere der einzige blaue/native Bedienteil im Kasten (AGENTS.md §12, kein Blau im Chrome).
    + '<input class="st-falte__suche" type="text"'
    + ' aria-label="' + escape(tr("staetten.move.searchLabel", "Neuer Ort")) + '"'
    + ' placeholder="' + escape(tr("staetten.move.searchPlaceholder", "Neuer Ort …")) + '"'
    + ' value="' + escape(suchtext || "") + '">'
    + satz
    + fehlerZeile
    + '<div class="fs-actions">'
    + '<button type="button" class="fs-actions__sek" data-st-cancel' + (sendetGerade ? " disabled" : "") + ">"
    + escape(tr("staetten.actions.cancel", "Abbrechen")) + "</button>"
    + '<button type="button" class="fs-actions__prim" data-st-confirm' + ((ziel && !sendetGerade) ? "" : " disabled") + ">"
    + escape(tr("staetten.actions.move", "Umhängen")) + "</button>"
    + "</div></div>"
  );
}

// ── Rein: die Falte "Löschen" -- Rückfrage ─────────────────────────────────────────────────────
function staettenKastenFalteLoeschenMarkup(staette, ortName, falteFehler, sendetGerade, escape, tr) {
  // Ein innerorts-PUNKT, der schon von der Karte genommen ist, bekommt die Rueckfrage aus dem
  // Ruling der Fix-Runde 1 -- "Löschen", nicht "Endgültig löschen", weil "Rückgängig" im
  // Aenderungsverlauf es zurueckholt (avesmapsInnerortsEndgueltigEntfernen ist Undo-faehig).
  var istPunkt = staette.art === "punkt";
  var vorlage = istPunkt
    ? tr("staetten.delete.confirmPoint", "„{name}“ löschen? Es wird auch nicht mehr als Stätte von {ort} geführt.")
    : tr("staetten.delete.confirm", "Stätte „{name}“ löschen? Sie verschwindet aus der Infobox von {ort}; ihre Quellen bleiben an ihr hängen.");
  var satz = "<div>" + vorlage
    .replace("{name}", escape(staette.name))
    .replace("{ort}", escape(ortName)) + "</div>";
  var fehlerZeile = falteFehler
    ? '<p class="fs-add-note" role="status">' + escape(falteFehler) + "</p>"
    : "";
  return (
    '<div class="st-falte">'
    + satz
    + fehlerZeile
    + '<div class="fs-actions">'
    + '<button type="button" class="fs-actions__sek" data-st-cancel' + (sendetGerade ? " disabled" : "") + ">"
    + escape(tr("staetten.actions.cancel", "Abbrechen")) + "</button>"
    + '<button type="button" class="fs-actions__prim" data-st-confirm' + (sendetGerade ? " disabled" : "") + ">"
    + escape(tr("staetten.actions.delete", "Löschen")) + "</button>"
    + "</div></div>"
  );
}

// Die Zeile "Sonstiges" reicht -- pure Trefferlisten-Markup fuer den Typeahead der Ortssuche.
// state = { items, activeIndex, query } (derselbe Vertrag wie renderSourceAutocompleteHtml).
function staettenKastenTrefferListeHtml(state, opts) {
  var options = opts || {};
  var escape = options.escape || staettenKastenDefaultEscape;
  var tr = typeof options.tr === "function" ? options.tr : function (_k, f) { return f; };
  var items = Array.isArray(state && state.items) ? state.items : [];
  var query = String((state && state.query) || "");
  var head = '<div class="sac-head">' + escape(tr("staetten.move.searchHeading", "Orte auf der Karte")) + "</div>";
  var zeilen = items.map(function (item, index) {
    var aktiv = index === (state && state.activeIndex);
    var art = staettenKastenOrtsklassenLabel(item.subtype);
    var lage = String(item.lage || "").trim();
    var uses = art + (lage ? " · " + lage : "");
    return (
      '<li class="sac-item' + (aktiv ? " is-active" : "") + '" role="option"'
      + ' id="' + escape(staettenKastenTrefferId(item, index)) + '"'
      + ' aria-selected="' + (aktiv ? "true" : "false") + '"'
      + ' data-sac-index="' + index + '">'
      + '<span class="sac-name">' + staettenKastenHervorhebung(item.name, query, escape) + "</span>"
      + '<span class="sac-uses">' + escape(uses) + "</span>"
      + "</li>"
    );
  }).join("");
  return head + '<ul class="sac-list" role="listbox">' + zeilen + "</ul>";
}

function staettenKastenTrefferId(item, index) {
  return "st-treffer-" + staettenKastenIdTeil(item && item.public_id, index);
}
// Nur Zeichen, die in einer DOM-id gefahrlos stehen -- eine public_id ist ein Server-Schlüssel,
// kein garantiert id-sicherer String.
function staettenKastenIdTeil(value, index) {
  var raw = String(value === null || value === undefined || value === "" ? index : value);
  return raw.replace(/[^a-zA-Z0-9_-]/g, "");
}

async function staettenKastenPost(fetchImpl, body, signal) {
  var f = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!f) {
    throw new Error("kein fetch verfügbar");
  }
  var antwort = await f(STAETTEN_KASTEN_API_URL, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal,
  });
  return await antwort.json();
}

async function staettenKastenSuche(fetchImpl, term, signal) {
  var daten = await staettenKastenPost(fetchImpl, { action: "orte", q: term }, signal);
  return daten && daten.ok === true && Array.isArray(daten.orte) ? daten.orte : [];
}

/**
 * Das Zielfenster einer Anfrage: das eigene, wenn es `avesmapsInSettlementPlaces` traegt --
 * sonst (in einem iframe wie dem Ortseditor) das Elternfenster, wenn ES die Liste traegt.
 *
 * 🔴 EIN Vertrag fuer `staettenKastenWikiZahl` UND `staettenKastenNutzlastNachziehen` -- beide
 * lesen/schreiben dieselbe Liste und muessen dasselbe Fenster meinen, sonst zaehlt die graue
 * Zeile am eigenen Fenster, waehrend das Nachziehen am Elternfenster ins Leere schreibt.
 * ⚠️ `try`: ein fremdes `window.parent` (Cross-Origin) wirft beim blossen Lesen -- das ist dann
 * "keine Liste erreichbar", kein Fehler, den der Aufrufer sehen muesste.
 */
function staettenKastenZielfenster(win) {
  var eigenesFenster = win || (typeof window !== "undefined" ? window : null);
  if (!eigenesFenster) {
    return null;
  }
  if (Array.isArray(eigenesFenster.avesmapsInSettlementPlaces)) {
    return eigenesFenster;
  }
  try {
    if (eigenesFenster.parent && eigenesFenster.parent !== eigenesFenster
      && Array.isArray(eigenesFenster.parent.avesmapsInSettlementPlaces)) {
      return eigenesFenster.parent;
    }
  } catch (fehler) {
    // fremde Herkunft (Cross-Origin) -> keine Liste erreichbar
  }
  return null;
}

function staettenKastenSchluesselFn(fenster) {
  if (fenster && typeof fenster.avesmapsStaettenSchluessel === "function") {
    return fenster.avesmapsStaettenSchluessel;
  }
  return function (x) { return String(x === null || x === undefined ? "" : x).trim().toLowerCase(); };
}

/**
 * Wie viele der aus dem Wiki abgeleiteten Stätten dieses Ortes NICHT unter den gespeicherten
 * sind -- die Zahl der grauen Zeile. `null` heisst "die Liste ist nicht erreichbar" (Seite ohne
 * Karte, fremdes iframe) und ist etwas anderes als 0.
 */
function staettenKastenWikiZahl(ortName, gespeicherteNamen, win) {
  var fenster = staettenKastenZielfenster(win);
  if (!fenster) {
    return null;
  }
  var schluesselFn = staettenKastenSchluesselFn(fenster);
  var ortSchluessel = schluesselFn(ortName);
  var gespeicherteSet = {};
  (gespeicherteNamen || []).forEach(function (name) {
    gespeicherteSet[schluesselFn(name)] = true;
  });
  var zahl = 0;
  fenster.avesmapsInSettlementPlaces.forEach(function (eintrag) {
    var stadt = schluesselFn(eintrag && eintrag.settlement);
    if (stadt !== ortSchluessel) {
      return;
    }
    var name = String((eintrag && eintrag.name) || "").trim();
    if (name === "") {
      return;
    }
    if (!gespeicherteSet[schluesselFn(name)]) {
      zahl += 1;
    }
  });
  return zahl;
}

/**
 * Die Kartennutzlast im Browser nach einem Schreibvorgang nachziehen: den ersten Eintrag mit
 * gleichem Namen+Ort in `avesmapsInSettlementPlaces` entfernen (Löschen) bzw. seinen Ortsnamen auf
 * das Ziel setzen (Umhängen), danach den Stätten-Index der Infobox verwerfen (er prüft nur die
 * LÄNGE der Liste -- ein Umhängen ändert sie nicht und bliebe unsichtbar) und das offene Infopanel
 * auffrischen.
 *
 * 🔴 ALLES IN `try` -- ein Fehler hier (z. B. weil die Karte gar nicht geladen ist) darf den
 * Schreiberfolg, den der Server längst bestätigt hat, nicht nachträglich als Fehler melden.
 */
function staettenKastenNutzlastNachziehen(win, art, staette, alterOrt, zielName) {
  try {
    var fenster = staettenKastenZielfenster(win);
    if (!fenster) {
      return;
    }
    var schluesselFn = staettenKastenSchluesselFn(fenster);
    var namensSchluessel = schluesselFn(staette && staette.name);
    var ortSchluessel = schluesselFn(alterOrt);
    // Ein innerorts-PUNKT traegt eine public_id -- ueber SIE zu suchen ist eindeutig (Task 4);
    // eine gespeicherte Staette hat in dieser Liste keine, dort bleibt Name+Ort der einzige Weg.
    var istPunkt = staette && staette.art === "punkt";
    var staettePublicId = String((staette && staette.public_id) || "");
    var liste = fenster.avesmapsInSettlementPlaces;
    var index = -1;
    for (var i = 0; i < liste.length; i += 1) {
      var eintrag = liste[i];
      if (istPunkt) {
        if (staettePublicId !== "" && String((eintrag && eintrag.public_id) || "") === staettePublicId) {
          index = i;
          break;
        }
        continue;
      }
      if (schluesselFn(eintrag && eintrag.name) === namensSchluessel
        && schluesselFn(eintrag && eintrag.settlement) === ortSchluessel) {
        index = i;
        break;
      }
    }
    if (index === -1) {
      return;
    }
    if (art === "loeschen") {
      liste.splice(index, 1);
    } else if (art === "umhaengen") {
      liste[index].settlement = zielName;
    } else if (art === "auf_die_karte") {
      // „⦿ Auf die Karte setzen" (Spec §4.2) -- der Punkt bleibt derselbe Eintrag, nur sein
      // Merker dreht um; die Infobox-Zeile „Stätten" bekommt damit wieder ihren Sprung ⊕.
      liste[index].auf_der_karte = true;
    }
    fenster.avesmapsStaettenIndex = null;
    if (typeof fenster.avesmapsRefreshInfopanel === "function") {
      fenster.avesmapsRefreshInfopanel();
    }
  } catch (fehler) {
    // Ein Fehler hier darf den Schreiberfolg nicht als Fehler melden (siehe Kommentar oben).
  }
}

/**
 * Nach „⦿ Auf die Karte setzen" (Spec §4.2): den Marker der wieder aktiven Kartenposition auf der
 * Karte herstellen (falls er dort noch nicht steht -- ein Live-Abgleich koennte ihn zwischenzeitlich
 * schon nachgezogen haben) und hinfliegen. `feature` ist die Punktantwort des Servers
 * (avesmapsBuildFeatureResponseFromStoredFeature), wie sie jeder andere Punkt-Endpunkt liefert.
 *
 * 🔴 IM ORTSEDITOR-IFRAME "falls erreichbar" (Spec §4.2): `staettenKastenZielfenster` findet nur ein
 * Fenster, das die Kartennutzlast wirklich traegt -- gibt es keins, passiert hier nichts weiter als
 * die Meldung, die `fuehrePutOnMapAus` ohnehin zeigt.
 */
function staettenKastenAufDieKarteFliegen(win, feature) {
  try {
    var fenster = staettenKastenZielfenster(win);
    if (!fenster || !feature) {
      return;
    }
    var publicId = String(feature.public_id || "");
    if (publicId === "") {
      return;
    }
    var schonDa = typeof fenster.findLocationMarkerByPublicId === "function"
      && fenster.findLocationMarkerByPublicId(publicId);
    if (!schonDa && typeof fenster.addCreatedLocationMarker === "function") {
      fenster.addCreatedLocationMarker(feature, { openPopup: false });
    }
    if (typeof fenster.avesmapsSpringeZuInnerortsPunkt === "function") {
      fenster.avesmapsSpringeZuInnerortsPunkt(publicId);
    }
  } catch (fehler) {
    // Ein Fehler hier darf den Schreiberfolg nicht als Fehler melden (siehe Kommentar oben).
  }
}

// ── Der Kasten insgesamt, aus dem Modulzustand ─────────────────────────────────────────────────
function staettenKastenKastenHtml(state, ortName, escape, tr) {
  if (state.laedt) {
    return '<p class="st-wiki">' + escape(tr("staetten.loading", "Stätten werden geladen …")) + "</p>";
  }
  var zeilen = "";
  state.staetten.forEach(function (staette) {
    zeilen += staettenKastenZeileMarkup(staette, state.offenId, state.offenArt, escape, tr, state.aufDieKarteSendetId);
    if (state.offenId !== null && state.offenId === String(staette.public_id)) {
      zeilen += state.offenArt === "umhaengen"
        ? staettenKastenFalteUmhaengenMarkup(staette, state.suchtext, state.ziel, state.falteFehler, state.sendetGerade, escape, tr)
        : staettenKastenFalteLoeschenMarkup(staette, ortName, state.falteFehler, state.sendetGerade, escape, tr);
    }
  });
  var note = "";
  if (state.note) {
    note = '<p class="fs-add-note' + (state.note.ok ? " fs-add-note--ok" : "") + '" role="status">'
      + escape(state.note.text) + "</p>";
  }
  var grau = "";
  if (state.wikiZahl !== null && state.wikiZahl > 0) {
    var text;
    if (state.staetten.length > 0) {
      text = tr("staetten.wiki.more", "+ {n} weitere aus dem Wiki — hier nicht bearbeitbar.")
        .replace("{n}", String(state.wikiZahl));
    } else if (state.wikiZahl === 1) {
      text = tr("staetten.wiki.oneOnly", "1 Stätte aus dem Wiki — hier nicht bearbeitbar.");
    } else {
      text = tr("staetten.wiki.onlyMany", "{n} Stätten aus dem Wiki — hier nicht bearbeitbar.")
        .replace("{n}", String(state.wikiZahl));
    }
    grau = '<p class="st-wiki">' + escape(text) + "</p>";
  }
  return zeilen + note + grau;
}

/**
 * Montiert den Kasten "Stätten" in `host` (ein leeres <div>, direkt vor "Quellen"). Kennt keine
 * Montagestelle -- Task 5 ruft dieselbe Funktion an beiden Oberflächen.
 *
 * opts: { ortPublicId, ortName, sektion, escape?, tr?, fetchImpl?, win?, attachTypeaheadImpl? }
 * `sektion` ist der aeussere Abschnitt (Titel + Kasten), dessen `hidden` diese Funktion setzt --
 * `host` selbst bleibt immer da, nur sein Inhalt wechselt.
 *
 * @returns {Promise<void>} erfuellt nach dem ersten Zeichnen (dem geladenen Zustand, nicht dem
 *   Ladeplatzhalter).
 */
function mountStaettenKasten(host, opts) {
  if (!host) {
    return Promise.resolve();
  }
  var options = opts || {};
  // I1: der CSS-Vertrag (css/components/staetten-kasten.css) haengt an `.st-kasten` -- ohne die
  // Klasse am Host greifen weder das Zeilenraster (`gap`) noch der abgeschaltete Zeiger/Hover
  // noch die Link-Farbe der Zeile 2 (sonst blau statt `--color-link`).
  host.classList.add("st-kasten");
  // I2: `opts.escape` wird ABSICHTLICH IGNORIERT -- siehe der Kommentar an
  // staettenKastenDefaultEscape. Die Option bleibt im Vertrag stehen (fuer einen Aufrufer, der
  // sie irgendwann fuer reinen Text ausserhalb dieses Bauteils braucht), wird aber nicht mehr an
  // die eigene Maskierung gereicht.
  var escape = staettenKastenDefaultEscape;
  var trFn = function (key, fallback) { return staettenKastenTr(options, key, fallback); };
  var fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch : null);
  var win = options.win || (typeof window !== "undefined" ? window : null);
  var attachFn = options.attachTypeaheadImpl
    || (typeof attachTypeahead === "function" ? attachTypeahead : null);
  var ortId = String(options.ortPublicId || "");
  var ortName = String(options.ortName || "");
  var sektion = options.sektion || null;

  // Wiedermontage: der vorige Aufbau (Typeahead, Zuhoerer) wird zuerst geloest -- derselbe
  // Vertrag wie containerEl.__fsDetachAutocomplete in review-feature-sources.js, nur mit dem
  // Namen dieses Bauteils.
  if (typeof host.__staettenAbbau === "function") {
    host.__staettenAbbau();
    host.__staettenAbbau = null;
  }

  var state = {
    laedt: true,
    ladeFehlgeschlagen: false,
    staetten: [],
    wikiZahl: null,
    offenId: null,
    offenArt: null,
    ziel: null,
    suchtext: "",
    falteFehler: null,
    note: null,
    // Review Task 4 Punkt 2: waehrend eine delete/move-Anfrage laeuft, sind Primaerknopf und
    // Abbrechen deaktiviert und ein zweiter Klick auf den Primaerknopf loest keine zweite Anfrage
    // aus -- siehe bestaetigeAktion() und den Ruecksetzer in fuehreLoeschenAus/fuehreUmhaengenAus.
    sendetGerade: false,
    // Die public_id der Zeile, deren "⦿ Auf die Karte setzen" gerade unterwegs ist -- eigener
    // Riegel, weil diese Handlung KEINE Falte oeffnet (Spec §4.2, direkt statt Rueckfrage).
    aufDieKarteSendetId: null,
  };

  var detachTypeahead = null;
  // M4: nach host.__staettenAbbau() darf KEINE spaeter eintreffende Antwort mehr zeichnen -- eine
  // Wiedermontage auf demselben host (Reiterwechsel im Ortseditor) ruft __staettenAbbau() der
  // ALTEN Montage ganz oben in mountStaettenKasten. Ohne diese Sperre schriebe eine haengende
  // `list`-Antwort der alten Montage nachtraeglich ueber den Inhalt der neuen.
  var abgebaut = false;

  function detachAlleZuhoerer() {
    if (detachTypeahead) {
      detachTypeahead();
      detachTypeahead = null;
    }
  }

  function setzeSichtbarkeit() {
    if (!sektion) {
      return;
    }
    if (state.laedt || state.ladeFehlgeschlagen) {
      sektion.hidden = false;
      return;
    }
    var keineGespeicherte = state.staetten.length === 0;
    var keinWiki = state.wikiZahl === null || state.wikiZahl === 0;
    sektion.hidden = keineGespeicherte && keinWiki;
  }

  function verdrahteFalte() {
    if (state.offenId === null || state.offenArt !== "umhaengen" || !attachFn) {
      return;
    }
    var input = host.querySelector(".st-falte__suche");
    if (!input) {
      return;
    }
    detachTypeahead = attachFn(input, {
      minChars: 2,
      escape: escape,
      tr: trFn,
      renderHtml: staettenKastenTrefferListeHtml,
      itemId: function (item, index) { return staettenKastenTrefferId(item, index); },
      search: function (term, signal) {
        return staettenKastenSuche(fetchImpl, term, signal);
      },
      onPick: function (item) {
        var eingabe = host.querySelector(".st-falte__suche");
        state.suchtext = eingabe ? eingabe.value : state.suchtext;
        state.ziel = { id: String(item.public_id), name: String(item.name || "") };
        state.falteFehler = null;
        render();
      },
    });
  }

  function render() {
    if (abgebaut) {
      return; // M4: die Montage, zu der dieser Aufruf gehoert, ist laengst abgebaut
    }
    detachAlleZuhoerer();
    setzeSichtbarkeit();
    host.innerHTML = staettenKastenKastenHtml(state, ortName, escape, trFn);
    verdrahteFalte();
  }

  function findeStaette(id) {
    for (var i = 0; i < state.staetten.length; i += 1) {
      if (String(state.staetten[i].public_id) === id) {
        return state.staetten[i];
      }
    }
    return null;
  }

  function oeffneFalte(id, aktion) {
    state.offenId = id;
    state.offenArt = aktion;
    state.ziel = null;
    state.suchtext = "";
    state.falteFehler = null;
    state.note = null;
    render();
  }

  function schliesseFalte() {
    state.offenId = null;
    state.offenArt = null;
    state.ziel = null;
    state.suchtext = "";
    state.falteFehler = null;
    render();
  }

  function netzFehlerText() {
    return trFn("staetten.netError", "Keine Verbindung zum Server. Nichts wurde geändert.");
  }
  function serverFehlerText(antwort) {
    return (antwort && antwort.error && antwort.error.message)
      || trFn("staetten.serverError", "Die Stätte konnte nicht bearbeitet werden.");
  }
  // Eigener Rückfalltext (nicht serverFehlerText, dessen eigener Rückfall den hier gemeinten
  // immer verdeckte): die anfängliche Liste hat noch keine Stätte, über die der generische
  // Text reden könnte.
  function ladeFehlerText(antwort) {
    return (antwort && antwort.error && antwort.error.message)
      || trFn("staetten.loadError", "Die Stätten konnten nicht geladen werden.");
  }

  function fuehreLoeschenAus(staette) {
    var alterOrtName = ortName;
    return staettenKastenPost(fetchImpl, { action: "delete", public_id: staette.public_id })
      .catch(function () {
        state.sendetGerade = false;
        state.falteFehler = netzFehlerText();
        render();
        return null;
      })
      .then(function (antwort) {
        if (antwort === null) {
          return; // Netzfehler bereits behandelt
        }
        if (!antwort || antwort.ok !== true) {
          state.sendetGerade = false;
          state.falteFehler = serverFehlerText(antwort);
          render();
          return;
        }
        state.sendetGerade = false;
        state.staetten = Array.isArray(antwort.staetten) ? antwort.staetten : [];
        schliesseFalteOhneRender();
        state.note = {
          ok: true,
          text: trFn("staetten.delete.done", "Gelöscht: „{name}“.").replace("{name}", staette.name),
        };
        render();
        staettenKastenNutzlastNachziehen(win, "loeschen", staette, alterOrtName, null);
      });
  }

  function fuehreUmhaengenAus(staette) {
    var zielId = state.ziel.id;
    var zielNameVorabgleich = state.ziel.name;
    var alterOrtName = ortName;
    return staettenKastenPost(fetchImpl, { action: "move", public_id: staette.public_id, ziel_public_id: zielId })
      .catch(function () {
        state.sendetGerade = false;
        state.falteFehler = netzFehlerText();
        render();
        return null;
      })
      .then(function (antwort) {
        if (antwort === null) {
          return;
        }
        if (!antwort || antwort.ok !== true) {
          state.sendetGerade = false;
          state.falteFehler = serverFehlerText(antwort);
          render();
          return;
        }
        state.sendetGerade = false;
        var zielName = String(antwort.ziel_name || zielNameVorabgleich || "");
        state.staetten = Array.isArray(antwort.staetten) ? antwort.staetten : [];
        schliesseFalteOhneRender();
        state.note = {
          ok: true,
          text: trFn("staetten.move.done", "Umgehängt: „{name}“ liegt jetzt in {ziel}.")
            .replace("{name}", staette.name).replace("{ziel}", zielName),
        };
        render();
        staettenKastenNutzlastNachziehen(win, "umhaengen", staette, alterOrtName, zielName);
      });
  }

  // „⦿ Auf die Karte setzen" (Spec §4.2) -- eine DIREKTE Handlung ohne Falte (Mockup Szene 6), im
  // Unterschied zu Loeschen/Umhaengen. Eigener Riegel (state.aufDieKarteSendetId statt
  // state.sendetGerade), weil dafuer kein state.offenId reserviert wird.
  function fuehrePutOnMapAus(staette) {
    return staettenKastenPost(fetchImpl, { action: "put_on_map", public_id: staette.public_id })
      .catch(function () {
        state.aufDieKarteSendetId = null;
        state.note = { ok: false, text: netzFehlerText() };
        render();
        return null;
      })
      .then(function (antwort) {
        if (antwort === null) {
          return; // Netzfehler bereits behandelt
        }
        if (!antwort || antwort.ok !== true) {
          state.aufDieKarteSendetId = null;
          state.note = { ok: false, text: serverFehlerText(antwort) };
          render();
          return;
        }
        state.aufDieKarteSendetId = null;
        state.staetten = Array.isArray(antwort.staetten) ? antwort.staetten : [];
        state.note = {
          ok: true,
          text: trFn("staetten.putOnMap.done",
            '„{name}“ liegt wieder auf der Karte — an seiner alten Stelle. Verschieben mit „Ort verschieben“.')
            .replace("{name}", staette.name),
        };
        render();
        staettenKastenNutzlastNachziehen(win, "auf_die_karte", staette, ortName, null);
        staettenKastenAufDieKarteFliegen(win, antwort.feature);
      });
  }

  // Wie schliesseFalte(), aber ohne eigenes render() -- der Aufrufer zeichnet gleich darauf
  // ohnehin neu (mitsamt der neuen Liste und der Meldung), ein Zwischenschritt waere ein
  // sichtbares Flackern ohne Aussage.
  function schliesseFalteOhneRender() {
    state.offenId = null;
    state.offenArt = null;
    state.ziel = null;
    state.suchtext = "";
    state.falteFehler = null;
  }

  // 🔴 Review Task 4 Punkt 2: kehrt bei laufender Anfrage SOFORT zurueck -- kein zweites `delete`/
  // `move`. Der Riegel wird synchron gesetzt, BEVOR irgendetwas asynchrones passiert: ein zweiter,
  // rascher Klick landet als zweiter, aber ebenfalls synchroner Aufruf von bestaetigeAktion() (JS
  // ist single-threaded, der erste Klick-Handler ist laengst fertig, bevor der zweite ueberhaupt
  // startet) und sieht `state.sendetGerade === true`, unabhaengig davon, ob das `disabled` am Knopf
  // im jeweiligen DOM tatsaechlich verhindert haette, dass der Klick ueberhaupt ausgeloest wird.
  function bestaetigeAktion() {
    if (state.offenId === null || state.sendetGerade) {
      return;
    }
    var staette = findeStaette(state.offenId);
    if (!staette) {
      return;
    }
    if (state.offenArt === "loeschen") {
      state.sendetGerade = true;
      render();
      fuehreLoeschenAus(staette);
    } else if (state.offenArt === "umhaengen" && state.ziel) {
      state.sendetGerade = true;
      render();
      fuehreUmhaengenAus(staette);
    }
  }

  function onHostClick(event) {
    var target = event && event.target;
    if (!target || typeof target.closest !== "function") {
      return;
    }
    // „⊕" -- der Sprung auf einen innerorts-Punkt (Spec §6.3). Dieser Kasten kann in einem IFRAME
    // haengen (html/wiki-sync-settlement-editor.html) -- die document-weite Delegation aus
    // js/routing/routing.js erreicht ihn dort nicht, deshalb bedient er den Knopf selbst, ueber
    // sein Zielfenster (dieselbe Aufloesung wie beim Nachziehen der Nutzlast).
    // 🔴 `stopPropagation`, weil derselbe Kasten auch im HAUPTDOKUMENT haengt ("Ort bearbeiten") --
    // dort wuerde sonst ZUSAETZLICH der document-weite Zuhoerer aus routing.js feuern (Doppelklick).
    var sprungBtn = target.closest(".innerorts-sprung");
    if (sprungBtn) {
      event.preventDefault();
      event.stopPropagation();
      var sprungId = sprungBtn.getAttribute("data-public-id") || "";
      var sprungFenster = staettenKastenZielfenster(win);
      if (sprungId && sprungFenster && typeof sprungFenster.avesmapsSpringeZuInnerortsPunkt === "function") {
        sprungFenster.avesmapsSpringeZuInnerortsPunkt(sprungId);
      }
      return;
    }
    var confirmBtn = target.closest("[data-st-confirm]");
    if (confirmBtn) {
      event.preventDefault();
      bestaetigeAktion();
      return;
    }
    var cancelBtn = target.closest("[data-st-cancel]");
    if (cancelBtn) {
      event.preventDefault();
      // Waehrend eine Anfrage laeuft, ist Abbrechen ebenfalls gesperrt (Review Task 4 Punkt 2) --
      // die Falte gehoert bis zur Antwort der einen laufenden Anfrage.
      if (!state.sendetGerade) {
        schliesseFalte();
      }
      return;
    }
    var aktionBtn = target.closest("[data-st-aktion]");
    if (aktionBtn) {
      event.preventDefault();
      var zeile = aktionBtn.closest(".avm-row");
      var id = zeile ? zeile.getAttribute("data-st-id") : "";
      var aktion = aktionBtn.getAttribute("data-st-aktion");
      // „⦿ Auf die Karte setzen" (Spec §4.2) ist eine DIREKTE Handlung, keine Falte -- sie ist
      // umkehrbar und braucht kein "wirklich?" (anders als Loeschen/Umhaengen). Eigener Riegel
      // gegen Doppel-Absenden, weil kein `state.offenId` dafuer reserviert wird.
      if (aktion === "auf_die_karte") {
        if (state.sendetGerade || state.aufDieKarteSendetId) {
          return;
        }
        var staetteFuerKarte = findeStaette(id);
        if (!staetteFuerKarte) {
          return;
        }
        // Eine offene Falte (⇄/✕) DERSELBEN Zeile wird mitgeschlossen -- sonst haenge eine
        // Rueckfrage ueber einer Zeile, die nach dem Erfolg gar keinen dieser Knoepfe mehr traegt
        // (Sorte 1 hat kein ✕).
        if (state.offenId === id) {
          state.offenId = null;
          state.offenArt = null;
          state.ziel = null;
          state.suchtext = "";
          state.falteFehler = null;
        }
        state.aufDieKarteSendetId = id;
        render();
        fuehrePutOnMapAus(staetteFuerKarte);
        return;
      }
      if (state.sendetGerade) {
        // Keine andere Falte oeffnen/wechseln, solange eine Anfrage laeuft: sonst raeumt
        // schliesseFalteOhneRender() beim Eintreffen der Antwort eine inzwischen andere, gerade
        // geoeffnete Falte weg.
        return;
      }
      if (state.offenId === id && state.offenArt === aktion) {
        schliesseFalte();
      } else {
        oeffneFalte(id, aktion);
      }
    }
  }
  host.addEventListener("click", onHostClick);

  // B3: aendert der Editor den Suchtext NACH einer Wahl, verwirft das die Wahl -- Ruecksatz weg,
  // Primaerknopf deaktiviert. Direkte DOM-Aenderung statt render(): ein Neuzeichnen ersetzte das
  // fokussierte Eingabefeld durch ein neues und der Fokus (samt Cursorposition) ginge verloren,
  // mitten im Tippen.
  function onHostInput(event) {
    var target = event && event.target;
    if (!target || !target.classList || !target.classList.contains("st-falte__suche")) {
      return;
    }
    state.suchtext = target.value;
    if (!state.ziel || target.value === state.ziel.name) {
      return;
    }
    state.ziel = null;
    state.falteFehler = null;
    var falte = typeof target.closest === "function" ? target.closest(".st-falte") : null;
    if (!falte) {
      return;
    }
    var satz = falte.querySelector(".st-falte__satz");
    if (satz && satz.parentNode) {
      satz.parentNode.removeChild(satz);
    }
    var prim = falte.querySelector(".fs-actions__prim");
    if (prim) {
      prim.disabled = true;
    }
  }
  host.addEventListener("input", onHostInput);

  host.__staettenAbbau = function () {
    abgebaut = true;
    detachAlleZuhoerer();
    host.removeEventListener("click", onHostClick);
    host.removeEventListener("input", onHostInput);
  };

  render(); // Ladeplatzhalter, damit die Sektion sofort sichtbar ist, waehrend list laeuft

  return staettenKastenPost(fetchImpl, { action: "list", settlement_public_id: ortId })
    .then(function (antwort) {
      if (!antwort || antwort.ok !== true) {
        state.staetten = [];
        state.ladeFehlgeschlagen = true;
        state.note = { ok: false, text: ladeFehlerText(antwort) };
        return;
      }
      state.staetten = Array.isArray(antwort.staetten) ? antwort.staetten : [];
      state.ladeFehlgeschlagen = false;
    })
    .catch(function () {
      state.staetten = [];
      state.ladeFehlgeschlagen = true;
      state.note = { ok: false, text: netzFehlerText() };
    })
    .then(function () {
      state.wikiZahl = staettenKastenWikiZahl(
        ortName,
        state.staetten.map(function (s) { return s.name; }),
        win
      );
      state.laedt = false;
      render();
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    mountStaettenKasten: mountStaettenKasten,
    staettenKastenWikiZahl: staettenKastenWikiZahl,
    staettenKastenNutzlastNachziehen: staettenKastenNutzlastNachziehen,
    staettenKastenAufDieKarteFliegen: staettenKastenAufDieKarteFliegen,
    staettenKastenOrtsklassenLabel: staettenKastenOrtsklassenLabel,
    staettenKastenWirt: staettenKastenWirt,
    staettenKastenIstVerlinkbareAdresse: staettenKastenIstVerlinkbareAdresse,
    staettenKastenHervorhebung: staettenKastenHervorhebung,
    staettenKastenZeileMarkup: staettenKastenZeileMarkup,
    staettenKastenKastenHtml: staettenKastenKastenHtml,
    staettenKastenTrefferListeHtml: staettenKastenTrefferListeHtml,
  };
}
