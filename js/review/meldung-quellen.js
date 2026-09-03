// Die Quelle einer MELDUNG -- die eine Regel fuer beide Community-Formulare.
//
// Entwurf docs/superpowers/specs/2026-09-03-quellen-meldeformular-design.md (§2, §3). Owner 03.09.2026:
// „sowohl änderungen als auch neue vorschläge müssen das mit dem link machen … die sollen einfach den
// link pasten. erst wir im backend sollen sehen, ob der korpus passt oder ein neuer erkannt wurde.“
//
// 🔴 DER LINK IST DIE QUELLE. Das Hauptfeld nimmt eine Adresse ODER einen Titel: beginnt der Wert mit
//   http(s), ist es ein Link; sonst zaehlt nur ein Treffer aus der Vorschlagsliste des Katalogs
//   (`source_id`). Ein Titel OHNE Treffer ist keine Quelle -- ohne Link gibt es keine Identitaet
//   (`url_hash`), und genau so entstanden die zwei link-losen Zeilen im Livebestand vom 03.09.2026.
// 🔴 KEIN Korpus, KEINE Art, KEIN „offiziell“: die gehoeren dem Korpus bzw. dem Kanon und werden im
//   Backend aus der Adresse erkannt. Was der Melder sonst weiss (Titel, Seite, Abdeckung, Lizenz,
//   Namensnennung), reist als ANGEBOT mit -- es fuellt im Backend Leeres vor und ueberschreibt nichts.
// 🔴 Rein, kein DOM, kein Modulzustand: das Meldeformular („Karteneintrag melden“ / „Änderung
//   vorschlagen“) und der Kartenvorschlag lesen ihre Felder selbst und reichen die Werte hier herein.
//   Zwei Formulare, EINE Regel -- eine Regel, die einen von zwei Erzeugern bindet, ist keine.

"use strict";

var AVESMAPS_MELDUNG_QUELLE_ABDECKUNGEN = ["ausfuehrlich", "ergaenzend", "erwaehnung"];

/** Sieht der Wert nach einer Adresse aus? Nur die FORM -- ob es die Seite gibt, prueft das Backend. */
function avesmapsMeldungQuelleIstLink(wert) {
  return /^https?:\/\/\S+$/i.test(String(wert || "").trim());
}

/**
 * Aus den Eingaben eine Quelle -- oder eine benannte Absage.
 *
 * @param {object} w  { ref, source_id, pick_label, title, pages, reference_kind, license, attribution }
 *   ref         das Hauptfeld (Link oder Titel), source_id/pick_label der Treffer aus der Vorschlagsliste
 * @returns {{ok:true, quelle:object} | {ok:false, grund:"leer"|"kein_link"}}
 *   grund „leer“: nichts eingegeben · „kein_link“: ein Titel ohne Treffer aus dem Katalog
 */
function avesmapsMeldungQuelleAusEingabe(w) {
  var e = w || {};
  var ref = String(e.ref || "").trim();
  var sourceId = Math.max(0, Number(e.source_id) || 0);
  var pages = String(e.pages || "").trim().slice(0, 120);
  var title = String(e.title || "").trim().slice(0, 200);
  var kind = String(e.reference_kind || "").trim();
  if (AVESMAPS_MELDUNG_QUELLE_ABDECKUNGEN.indexOf(kind) === -1) {
    kind = "";
  }
  var license = String(e.license || "").trim().slice(0, 32);
  var attribution = String(e.attribution || "").trim().slice(0, 200);
  if (ref === "" && sourceId === 0) {
    return { ok: false, grund: "leer" };
  }
  // 🔴 Der Treffer aus dem Katalog gilt nur, solange das Feld noch seinen Titel zeigt: wer danach
  // weitertippt, meint die Zeile nicht mehr (der Aufrufer setzt source_id beim Tippen zurueck; hier
  // die zweite Sicherung, falls ein Formular das vergisst).
  var gepickt = sourceId > 0 && (ref === "" || ref === String(e.pick_label || "").trim());
  if (gepickt) {
    return {
      ok: true,
      quelle: {
        source_id: sourceId,
        url: "",
        label: String(e.pick_label || ref).trim().slice(0, 200),
        pages: pages,
        reference_kind: kind,
        license: license,
        attribution: attribution,
      },
    };
  }
  if (!avesmapsMeldungQuelleIstLink(ref)) {
    return { ok: false, grund: "kein_link" };
  }
  return {
    ok: true,
    quelle: {
      source_id: 0,
      url: ref.slice(0, 500),
      label: title,
      pages: pages,
      reference_kind: kind,
      license: license,
      attribution: attribution,
    },
  };
}

/**
 * Was die Liste des Melders von einer Quelle zeigt: der Titel (gepickt oder getippt), sonst die Adresse
 * ohne Schema -- und ob die Zeile aus dem Katalog kommt.
 */
function avesmapsMeldungQuelleAnzeige(quelle) {
  var q = quelle || {};
  var url = String(q.url || "");
  var label = String(q.label || "").trim();
  return {
    text: label !== "" ? label : url.replace(/^https?:\/\/(www\.)?/i, ""),
    url: url,
    ausKatalog: Number(q.source_id) > 0 && url === "",
    pages: String(q.pages || "").trim(),
  };
}

if (typeof window !== "undefined") {
  window.avesmapsMeldungQuelleIstLink = avesmapsMeldungQuelleIstLink;
  window.avesmapsMeldungQuelleAusEingabe = avesmapsMeldungQuelleAusEingabe;
  window.avesmapsMeldungQuelleAnzeige = avesmapsMeldungQuelleAnzeige;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    AVESMAPS_MELDUNG_QUELLE_ABDECKUNGEN: AVESMAPS_MELDUNG_QUELLE_ABDECKUNGEN,
    avesmapsMeldungQuelleIstLink: avesmapsMeldungQuelleIstLink,
    avesmapsMeldungQuelleAusEingabe: avesmapsMeldungQuelleAusEingabe,
    avesmapsMeldungQuelleAnzeige: avesmapsMeldungQuelleAnzeige,
  };
}
