<?php

declare(strict_types=1);

// GET /api/app/wiki-zuordnung-export.php
//   -> { ok:true, map_revision, ecosystem_revision, territories_revision, aliase_stempel,
//        kopf:{ objekte_mit_zuweisung, objekte_ohne_schluessel, verschiedene_schluessel, je_art:{ <art>:{ zugewiesen, ohne_zuweisung } } },
//        objekte:[ { public_id, art, wiki_url, wiki_key, wiki_titel, ns, ns_name, weiterleitung_auf? , … } ] }
//
// X2 der Auftraege von Avesmaps3D (05.10.2026): die Zuordnungstafel `wiki_key -> public_id` -- jedes Kartenobjekt (Siedlung,
// Weg, Region-Beschriftung, Kraftlinie), jede Landschaftsflaeche und jedes Herrschaftsgebiet MIT Wiki-Zuweisung, mit der
// Wiki-Adresse unveraendert und dem kanonischen Key (dieselbe Regel wie `ziel_key` in X1). Nur Zugewiesenes, nichts aus
// einem Namen abgeleitet; die Zahl der Objekte OHNE Zuweisung steht je Art im Kopf. Oeffentlich und nur lesend.
// Alles Weitere steht in api/_internal/app/wiki-linkziele-export.php.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/wiki-linkziele-export.php';

avesmapsWikiLinkzieleEndpunkt('zuordnung');
