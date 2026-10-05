<?php

declare(strict_types=1);

// GET /api/app/wiki-linkziele-export.php
//   -> { ok:true, map_revision, ecosystem_revision, territories_revision, aliase_stempel, dump:{run_id, abgeschlossen},
//        kopf:{ objekte_je_art, objekte_ohne_schluessel, artikel, haeufigste_ziele_ohne_kartenobjekt, vorlagen_in_feldern,
//               seiten_schluesselkollision },
//        artikel:[ { wiki_key, ns, ns_name, seite_art, seite_titel,
//                    felder:{ <feld>:[ { anzeige, ziel, art, vorlage?, ns, ns_name, ziel_key, weiterleitung_auf? } ] } } ],
//        ohne_wikitext:[ { wiki_key, grund, objekte } ] }
//
// X1 der Auftraege von Avesmaps3D (05.10.2026), je ARTIKEL (Owner-Entscheid 05.10.2026; die Zuordnung zu Objekten liefert X2):
// je Wiki-Feld die Wikilinks (und {{Pol|X}}/{{Reg|X}} als art "vorlage") des Infobox-Felds, in der
// Reihenfolge des Quelltexts, jeweils mit ROHEM Ziel (samt Namensraum-Praefix) und KANONISCHEM Key (`ziel_key`) --
// damit ein Link ueber seinen Wiki-Key zu einem Kartenobjekt wird (X2: api/app/wiki-zuordnung-export.php), nie ueber den
// Namen. Oeffentlich und nur lesend: kein Schreibweg, keine Schemaheilung, kein Live-Abruf am Wiki. Alles Weitere --
// woher der Wikitext kommt, die Schluesselregel, die Positivliste der Felder, die Luecke bei {{Pol|…}}-Vorlagen --
// steht in api/_internal/app/wiki-linkziele-export.php.
// ⚠️ Keine Drossel; die Antwort ist gross. Ein Werkzeug holt sie auf Zuruf, nie in einer Schleife (CLAUDE.md, STRATO).

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/wiki-linkziele-export.php';

avesmapsWikiLinkzieleEndpunkt('linkziele');
