<?php

declare(strict_types=1);

const AVESMAPS_WIKI_SYNC_NO_AUTO_HANDLE = true;

// AVESMAPS_WIKI_FUZZY_CUTOFF / AVESMAPS_WIKI_SYNC_TYPE_LOCATION /
// AVESMAPS_DEREGLOBUS_TO_MAP / AVESMAPS_POSITIONKARTE_TO_MAP moved to
// _internal/wiki/sync-constants.php so api/edit/wiki/dump.php's settlement
// conflict-generation path can also require them (it never required this
// endpoint file). See that file's docblock for the live-500 history.
require __DIR__ . '/../../_internal/wiki/sync-constants.php';

// 🔴 HIER STANDEN BIS ZUM 07.09.2026 DREI WEITERE KOPIEN -- AVESMAPS_WIKI_SETTLEMENT_CLASS_LABELS,
// AVESMAPS_WIKI_CATEGORY_TO_CLASS und AVESMAPS_WIKI_LOCATION_SUBTYPE_LABELS. Sie sind aus genau dem
// Grund gefallen, den der Absatz darunter fuer AVESMAPS_WIKI_CASE_LABELS schon beschreibt, und sie
// haben denselben Schaden angerichtet, nur schwerer:
//
// 💣 DIE KOPIE VON AVESMAPS_WIKI_CATEGORY_TO_CLASS WAR VERALTET. Sie fuehrte „Stadt" und „Mittlere
// Stadt" -- zwei Kategorien, die es im Wiki NICHT gibt (die Messung steht als Kommentar an der
// Fassung in locations.php) -- und kannte die echte Kategorie „Mittelgrosse Stadt" nicht. Weil sie
// gewann, fragte der LIVE-Crawl ueber diesen Endpunkt zwei leere Kategorien ab und uebersah die
// eine, auf die es ankam. Ein Ort daraus bekam keine Ortsklasse, und dann RAET der Parser sie
// („dorf", `settlement_class_guessed`) -- genau die Falle, die am 17.08.2026 die Metropole Gareth
// zum Dorf machen wollte. Der Dump-Pfad, der locations.php ohne diesen Endpunkt laedt, las
// unterdessen die richtige Fassung: dieselbe Wiki-Kategorie, zwei Antworten.
//
// ⚠️ Den zwei Beschriftungstafeln fehlte dafuer in locations.php `stadtviertel`; es ist dort
// ergaenzt, damit nichts verlorengeht. Gewacht von wiki-konstanten-einmal-test.php.
//
// AVESMAPS_WIKI_CASE_LABELS is defined ONCE, in api/_internal/wiki/locations.php
// (required below via endpoint.php). This endpoint used to declare its OWN copy
// here; because both were file-scope `const` (which cannot be defined()-guarded)
// and this file is included FIRST, this copy silently WON the redeclare and the
// newer WikiDump labels added in locations.php (field_divergence / coat_available
// / coordinate_drift) never reached avesmapsWikiSyncCaseLabel() -> the cases-list
// endpoint. Removing the duplicate here makes locations.php the single source;
// avesmapsWikiSyncCaseLabel() only reads the const at request time, long after
// endpoint.php has required locations.php, so this is safe.

require __DIR__ . '/../../_internal/wiki/endpoint.php';

avesmapsWikiSyncHandleRequest('locations');