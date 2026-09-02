<?php

declare(strict_types=1);

/**
 * „Was ist das fuer eine Adresse?" — die Auskunft, die die Eingabezeile beim Einfuegen holt.
 *
 * Entwurf: docs/superpowers/specs/2026-09-01-bekannte-quellen-design.md §3.4 + §4
 *
 * Sie beantwortet drei Fragen auf einmal:
 *   1. Steht diese SEITE schon im Katalog?      (lokal, sofort)
 *   2. Zu welchem KORPUS gehoert sie?           (lokal, gerechnet)
 *   3. Wie heisst die Seite, und wie der Wirt?  (Abruf -- nur wenn 1. verneint)
 *
 * 🔴 ERST IM KATALOG NACHSEHEN, DANN ERST NACH DRAUSSEN GREIFEN. Eine bekannte Adresse wird
 * SOFORT gruen, ohne den fremden Server zu fragen: ihr Titel steht ohnehin fest, und der Upsert
 * wuerde einen abgerufenen verwerfen (`label` fuellt nur eine Luecke). Andersherum zahlte der
 * HAEUFIGSTE Weg eine Wartezeit fuer ein Ergebnis, das anschliessend weggeworfen wird.
 */

require_once __DIR__ . '/source-corpus.php';
require_once __DIR__ . '/../linkcheck/page-title.php';
require_once __DIR__ . '/../linkcheck/probe.php';

/**
 * 🔴 DREI ZUSTAENDE FUER DEN ABRUF, NICHT ZWEI -- und das ist die Korrektur am ersten Entwurf des
 * Knopfes (Owner 02.09.2026: „gruen, wenn der Link existiert und ausgelesen werden konnte").
 *
 * `bekannt`      Die Seite steht schon im Katalog. Gruen, ohne Abruf.
 * `gelesen`      Erreichbar UND eine Ueberschrift gefunden. Gruen.
 * `erreichbar`   Antwortet, aber nichts zu lesen. Der Link ist gut, der Titel kommt von Hand.
 * `unerreichbar` Keine brauchbare Antwort.
 * `keine_pruefung` Es wurde gar nicht gefragt (leere Adresse, unpruefbares Schema).
 *
 * 💣 „Erreichbar" und „gelesen" in EINEN gruenen Zustand zu werfen, liesse Gruen zwei Dinge
 * heissen. Eine Seite kann sauber mit 200 antworten und keine brauchbare `<h1>` haben; waere das
 * rot, suchte der Editor einen Fehler am Link, den es nicht gibt.
 */
const AVESMAPS_SOURCE_INSPECT_STATES = ['bekannt', 'gelesen', 'erreichbar', 'unerreichbar', 'keine_pruefung'];

/**
 * @param bool $fetch  false = nur die lokale Auskunft (Katalog + Korpus), kein Abruf nach draussen.
 *                     ⚠️ Der Aufrufer entscheidet das, nie diese Funktion: die Oberflaeche fragt
 *                     beim TIPPEN lokal und erst beim Einfuegen/Knopfdruck nach draussen.
 */
function avesmapsSourceInspectUrl(PDO $pdo, string $url, bool $fetch = true): array
{
    $url = trim($url);
    $auskunft = [
        'url' => $url,
        'state' => 'keine_pruefung',
        'http_status' => 0,
        'title' => '',
        'site' => '',
        'corpus' => null,
        'existing' => null,
    ];
    if ($url === '') {
        return $auskunft;
    }

    // ── 1 · Der Korpus (lokal, gerechnet -- kein Abruf, keine Migration) ────────────────────────
    $auskunft['corpus'] = avesmapsSourceCorpusForUrl(avesmapsSourceCorpusReadAll($pdo), $url);

    // ── 2 · Steht die SEITE schon im Katalog? ───────────────────────────────────────────────────
    // 💣 Gefragt wird ueber `url_hash`, die IDENTITAET der Katalogzeile -- nicht ueber die Adresse
    // als Text. Wer mit `WHERE url = :u` sucht, sucht in einer TEXT-Spalte ohne Index.
    avesmapsEnsureFeatureSourceTables($pdo);
    $treffer = $pdo->prepare('SELECT id, label, source_type, is_official FROM sources WHERE url_hash = :h LIMIT 1');
    $treffer->execute(['h' => avesmapsFeatureSourceHash($url)]);
    $zeile = $treffer->fetch(PDO::FETCH_ASSOC);
    if (is_array($zeile)) {
        $sourceId = (int) $zeile['id'];
        $auskunft['existing'] = [
            'source_id' => $sourceId,
            'label' => (string) $zeile['label'],
            'source_type' => (string) $zeile['source_type'],
            'is_official' => (int) $zeile['is_official'] === 1,
            'usage_count' => avesmapsFeatureSourceUsageCount($pdo, $sourceId),
        ];
        $auskunft['state'] = 'bekannt';
        // ⚠️ Der gespeicherte Titel gewinnt, denn genau das tut der Upsert auch (`label` fuellt nur
        // eine Luecke). Ihn hier NICHT zu melden hiesse, die Oberflaeche muesste ihn erraten.
        $auskunft['title'] = (string) $zeile['label'];

        return $auskunft; // 🔴 KEIN Abruf. Das ist der ganze Sinn der Reihenfolge.
    }

    if (!$fetch) {
        return $auskunft;
    }

    // ── 3 · Erst jetzt nach draussen ────────────────────────────────────────────────────────────
    // ⚠️ EIN Abruf, nicht zwei. Der Linkchecker fragt sonst erst per HEAD und holt dann den Rumpf;
    // hier faellt der Statuscode aus demselben GET, aus dem auch der Titel kommt.
    // 🔴 `avesmapsLinkCheckFetchBody` ist der EINZIGE ausgehende Holer MIT SSRF-Riegel (private
    // Adressen, Weiterleitungsziele, Protokolle) -- und er traegt zugleich den Wiki-Datei-Riegel.
    // ⭐ Der greift hier NICHT: er gilt ausschliesslich `wiki-aventurica.de`
    // (`avesmapsWikiDateiIstWikiHost`), und die sieben Katalogzeilen von dort sind WERKE, deren
    // Titel bereits stimmen. Fuer diesen Umbau muss also keine Ausnahme gebaut werden.
    $antwort = avesmapsLinkCheckFetchBody($url, AVESMAPS_PAGE_TITLE_MAX_BYTES, 'text/html,*/*');
    $auskunft['http_status'] = (int) ($antwort['status'] ?? 0);
    if (($antwort['ok'] ?? false) !== true) {
        $auskunft['state'] = 'unerreichbar';

        return $auskunft;
    }

    // ⚠️ Ein PDF oder ein Bild ist erreichbar, hat aber keinen Titel zu bieten. Es waere falsch,
    // das als Fehlschlag zu melden -- der Link ist in Ordnung.
    $typ = (string) ($antwort['content_type'] ?? '');
    if ($typ !== '' && strpos($typ, 'html') === false) {
        $auskunft['state'] = 'erreichbar';

        return $auskunft;
    }

    $gelesen = avesmapsPageTitleRead((string) ($antwort['body'] ?? ''));
    $auskunft['title'] = $gelesen['title'];
    $auskunft['site'] = $gelesen['site'];
    $auskunft['state'] = $gelesen['title'] !== '' ? 'gelesen' : 'erreichbar';

    // 🔴 Der Wirtsname ist ein VORSCHLAG und ueberschreibt einen GEPFLEGTEN Korpusnamen nicht.
    // Ohne diese Zeile benennte der erste Abruf auf einer bekannten Domain den Korpus um -- und
    // das traefe alle seine Quellen auf einmal. Vorgeschlagen wird nur, wo noch nichts steht:
    // ein unbekannter Korpus traegt heute seinen Schluessel als Beschriftung.
    $korpus = $auskunft['corpus'];
    if (is_array($korpus) && ($korpus['known'] ?? false) !== true && $auskunft['site'] !== '') {
        $auskunft['corpus']['label_suggestion'] = $auskunft['site'];
    }

    return $auskunft;
}
