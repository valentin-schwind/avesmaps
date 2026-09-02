<?php

declare(strict_types=1);

/**
 * „Titel aus den Seiten holen" — der Lauf, der am 02.09.2026 noch von Hand als SQL lief.
 *
 * Entwurf: docs/superpowers/specs/2026-09-01-bekannte-quellen-design.md §4.3
 * Belegte Vorlage: docs/quellen-mapping-tabelle.html — 133 Zeilen, jede Seite wirklich abgerufen.
 *
 * 🔴 DIE REGELN HIER SIND AN ECHTEN DATEN GEMESSEN, nicht ausgedacht. Owner-Frage 02.09.2026:
 * „warum muss ich das manuell machen, warum kann das eine funktion nicht automatisch?" -- eben.
 * Was der Hand-Lauf konnte, kann diese Datei; was er ausnahm, nimmt sie aus, und aus demselben
 * Grund.
 *
 * 💣 KEIN STILLER MASSENSCHREIBVORGANG. `…Probe` schlaegt vor, `…Apply` schreibt -- und nur, was
 * der Aufrufer ihm nennt. Dieselbe Zweiteilung wie bei jeder Uebernahme-Vorschau des Hauses
 * (AGENTS.md §11): die Rechen-Haelfte fasst keine Nutztabelle an.
 */

require_once __DIR__ . '/source-corpus.php';
require_once __DIR__ . '/../linkcheck/page-title.php';
require_once __DIR__ . '/../linkcheck/probe.php';

/**
 * Zeigt diese Adresse auf die STARTSEITE eines Wirts?
 *
 * 💣 WEDER PFAD NOCH ABFRAGE -- der Pfad allein reicht nicht. `herzogtum-weiden.net/?view=article
 * &id=94:drachenstein` hat den Pfad „/" und ist trotzdem ein Artikel: Joomla traegt die Seite in
 * der ABFRAGE. Am 02.09.2026 waeren mit der Pfad-Regel allein DREI echte Artikel ausgenommen
 * worden, darunter der eine, dessen Titel leer war und der „Baronie Drachenstein" heisst.
 */
function avesmapsSourceUrlIsStartPage(string $url): bool
{
    $pfad = (string) (parse_url($url, PHP_URL_PATH) ?? '');
    $abfrage = (string) (parse_url($url, PHP_URL_QUERY) ?? '');

    return rtrim($pfad, '/') === '' && $abfrage === '';
}

/**
 * Was mit EINER Zeile geschehen soll. Rein: nimmt die Katalogzeile und das Ergebnis des Abrufs.
 *
 * @param array $zeile  ['url' => string, 'label' => string]
 * @param array $seite  ['ok' => bool, 'status' => int, 'title' => string]
 * @return array{aktion:string, titel:string, grund:string}
 *         aktion ∈ ersetzen | fuellen | aussen
 */
function avesmapsSourceTitleVerdict(array $zeile, array $seite): array
{
    $url = (string) ($zeile['url'] ?? '');
    $alt = (string) ($zeile['label'] ?? '');
    $neu = trim((string) ($seite['title'] ?? ''));
    $status = (int) ($seite['status'] ?? 0);

    if (($seite['ok'] ?? false) !== true || $neu === '') {
        return ['aktion' => 'aussen', 'titel' => '', 'grund' => $status === 404
            ? 'tote Adresse (HTTP 404)'
            : ($status > 0 ? 'keine Ueberschrift auf der Seite (HTTP ' . $status . ')' : 'nicht erreichbar')];
    }
    // 💣 Bei einer STARTSEITE macht der Lauf es schlechter: die Ueberschrift heisst dort
    // „Hauptseite". www.garetien.de stuende danach als „Hauptseite" statt „Briefspiel (Garetien)".
    if (avesmapsSourceUrlIsStartPage($url)) {
        return ['aktion' => 'aussen', 'titel' => $neu, 'grund' => 'Startseite -- „' . $neu . '" sagt weniger als heute'];
    }
    // 💣 Bei einem ANKER verliert die Ueberschrift die Aussage: drei Adressen zeigten auf
    // …Die_wichtigsten_Siedlungen_in_Orbatal#Doggenried / #Botzenberg / #Steinau_in_den_Bergen --
    // drei verschiedene Orte, EIN <h1>. Die Sprungmarke ist genauer als die Ueberschrift.
    if (strpos($url, '#') !== false) {
        return ['aktion' => 'aussen', 'titel' => $neu, 'grund' => 'Anker -- die Sprungmarke ist genauer als die Ueberschrift'];
    }
    if ($alt === $neu) {
        return ['aktion' => 'aussen', 'titel' => $neu, 'grund' => 'steht schon richtig'];
    }

    return ['aktion' => $alt === '' ? 'fuellen' : 'ersetzen', 'titel' => $neu, 'grund' => ''];
}

/**
 * ⚠️ Wie viele Seiten ein Schritt hoechstens holt. STRATO: kein langer Lauf in einem Request --
 * der Client treibt die Wiederholung, wie beim Linkchecker und beim Dump.
 */
const AVESMAPS_SOURCE_TITLE_BATCH = 8;

/**
 * Ein begrenzter Schritt: holt bis zu $limit Seiten des Korpus und SCHLAEGT VOR.
 *
 * 🔴 SCHREIBT NICHTS. Auch nicht „nur den unstrittigen Teil" -- die Uebernahme-Vorschau des
 * Hauses lebt davon, dass die Rechen-Haelfte in keine Nutztabelle fasst
 * (`sync-plan-purity-test.php` haelt dieselbe Regel fuer die Wiki-Abgleiche fest).
 *
 * @return array{items:array, done:bool, next:int}
 */
function avesmapsSourceCorpusTitleProbe(PDO $pdo, string $corpusKey, int $offset = 0, int $limit = AVESMAPS_SOURCE_TITLE_BATCH): array
{
    $ids = avesmapsSourceCorpusSourceIds($pdo, $corpusKey);
    sort($ids);
    $teil = array_slice($ids, max(0, $offset), max(1, $limit));
    if ($teil === []) {
        return ['items' => [], 'done' => true, 'next' => $offset];
    }
    $platz = implode(',', array_fill(0, count($teil), '?'));
    $stmt = $pdo->prepare('SELECT id, url, label FROM sources WHERE id IN (' . $platz . ') ORDER BY id');
    $stmt->execute($teil);

    $items = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $zeile) {
        $url = (string) $zeile['url'];
        // ⚠️ EIN Abruf je Zeile, gedeckelt -- derselbe Holer wie die Adressauskunft, also mit
        // SSRF-Riegel, Wirtsdrossel und dem Wiki-Datei-Riegel.
        $antwort = avesmapsLinkCheckFetchBody($url, AVESMAPS_PAGE_TITLE_MAX_BYTES, 'text/html,*/*');
        $gelesen = ($antwort['ok'] ?? false) === true
            ? avesmapsPageTitleRead((string) ($antwort['body'] ?? ''))
            : ['title' => '', 'site' => ''];
        $urteil = avesmapsSourceTitleVerdict(
            ['url' => $url, 'label' => (string) $zeile['label']],
            ['ok' => $antwort['ok'] ?? false, 'status' => (int) ($antwort['status'] ?? 0), 'title' => $gelesen['title']]
        );
        $items[] = [
            'source_id' => (int) $zeile['id'],
            'url' => $url,
            'alt' => (string) $zeile['label'],
            'neu' => $urteil['titel'],
            'aktion' => $urteil['aktion'],
            'grund' => $urteil['grund'],
            'site' => $gelesen['site'],
        ];
    }
    $next = max(0, $offset) + count($teil);

    return ['items' => $items, 'done' => $next >= count($ids), 'next' => $next, 'total' => count($ids)];
}

/**
 * Schreibt, was der Aufrufer ausdruecklich nennt.
 *
 * 💣 JEDE ZEILE PRUEFT IHREN ALTEN TITEL MIT. Zwischen Vorschlag und Uebernahme koennen Minuten
 * liegen -- hat jemand die Zeile in der Zeit von Hand richtiggestellt, darf dieser Lauf die
 * Handarbeit nicht ueberschreiben. Der Hand-Lauf vom 02.09.2026 machte es genauso
 * (`sql/quellen-titel-aus-den-seiten.sql`).
 *
 * @param array $writes  [['source_id' => int, 'label' => string, 'expect' => string], …]
 * @return array{applied:int, skipped:int, ids:array}
 */
function avesmapsSourceCorpusTitleApply(PDO $pdo, array $writes): array
{
    $stmt = $pdo->prepare('UPDATE sources SET label = :neu WHERE id = :id AND label = :alt');
    $applied = 0;
    $skipped = 0;
    $ids = [];
    foreach ($writes as $w) {
        $id = (int) ($w['source_id'] ?? 0);
        $neu = avesmapsNormalizeSourceLabel((string) ($w['label'] ?? ''));
        if ($id <= 0 || $neu === '') {
            $skipped++;
            continue;
        }
        $stmt->execute(['neu' => $neu, 'id' => $id, 'alt' => (string) ($w['expect'] ?? '')]);
        if ($stmt->rowCount() > 0) {
            $applied++;
            $ids[] = $id;
        } else {
            $skipped++;
        }
    }
    // 💣 DER KARTENSTEMPEL. Die Titel reisen im `source_catalog` der ETag-zwischengespeicherten
    // Nutzlast; ohne ihn bekaeme jeder warme Browser sein 304 und zeigte die alten unbegrenzt.
    if ($applied > 0 && function_exists('avesmapsNextMapRevision')) {
        avesmapsNextMapRevision($pdo);
    }

    return ['applied' => $applied, 'skipped' => $skipped, 'ids' => $ids];
}
