<?php

declare(strict_types=1);

// Der Kanal „Neuigkeiten" -- der einzige, der auf avesmaps SELBST veröffentlicht: er schreibt eine
// Zeile in `changelog_entry`, und die erscheint im Fenster „Hinweise → Neuigkeiten".
//
// Er braucht kein fremdes Konto, keinen Token und keine Freigabe von irgendwem. Damit ist er nach
// dem Probe-Kanal der zweite, der ohne jede Einrichtung läuft -- nur veröffentlicht er wirklich.
//
// 💣 EINE LEERE TABELLE FÄLLT AUF DIE SAAT ZURÜCK. `avesmapsChangelogReadPublished` gibt `null`,
// wenn nichts drinsteht, und der Lesepfad zeigt dann `avesmapsChangelogSeed()` -- die 42
// Meilensteine. Wer in diesem Zustand EINE Zeile einfügt, hat den Verlauf nicht ergänzt, sondern
// auf einen einzigen Eintrag zusammengestrichen, und niemandem fällt es auf, weil die Saat und ein
// gepflegter Verlauf gleich aussehen. Deshalb steht `avesmapsChangelogSeedIfEmpty` hier vor jedem
// Schreibvorgang, genau wie im Schreibendpunkt `api/edit/map/changelog.php`.
//
// 💣 DIE ÜBERSCHRIFT MUSS PASSEN. `changelog_entry.title` ist VARCHAR(190). Zu kürzen wäre die
// falsche Freundlichkeit -- eine stumm abgeschnittene Überschrift steht öffentlich und niemand
// erfährt, dass etwas fehlt. Also: absagen mit beiden Zahlen. Dieselbe Haltung wie beim
// Zeichenlimit der Netze.
//
// Woher sie kommt, entscheidet avesmapsSocialChangelogSplit: aus der **Titelzeile** des Hubs, wenn
// eine da ist, sonst aus der ersten Zeile des Textes. Die Titelzeile geht NUR hierher -- die Netze
// kennen keine Überschrift, dort bliebe sie unsichtbar oder stünde doppelt im Beitrag.

require_once __DIR__ . '/../../app/changelog.php';

// Die Kategorie, unter der ein Hub-Beitrag im Verlauf steht. Der Hub hat keine Kategoriewahl -- und
// soll auch keine bekommen, dafür ist er das falsche Fenster. `community` ist die ehrliche Vorgabe:
// ein Mensch aus dem Projekt hat das geschrieben. Gültige Werte: AVESMAPS_CHANGELOG_CATEGORIES.
const AVESMAPS_SOCIAL_CHANGELOG_CATEGORY = 'community';
const AVESMAPS_SOCIAL_CHANGELOG_TITLE_MAX = 190;

/**
 * Zerlegt den Beitrag in Überschrift und Rumpf. REIN -- deshalb prüfbar, und deshalb steht die Regel
 * hier und nicht mitten im Schreibvorgang.
 *
 * ZWEI Wege, und der ausdrückliche gewinnt:
 *   1. Der Hub hat eine **Titelzeile**. Ist sie gefüllt, IST sie die Überschrift und der ganze Text
 *      wird der Rumpf. Nichts wird abgeschnitten, nichts erraten.
 *   2. Ist sie leer, gilt die alte Regel: die erste Zeile wird die Überschrift, der Rest der Rumpf.
 *      Der Rückfall bleibt, weil ihn zwei Aufrufer brauchen -- die Routine (`routine-post.php`
 *      liefert nicht zwingend einen Titel) und jeder Beitrag, der vor dem 10.08.2026 entstand.
 *
 * @param string $title Die Titelzeile des Beitrags; '' bedeutet „keine".
 * @return array{title: string, body: string, error: ?string}
 */
function avesmapsSocialChangelogSplit(string $caption, string $title = ''): array
{
    $explicit = trim($title);
    if ($explicit !== '') {
        $length = mb_strlen($explicit);
        if ($length > AVESMAPS_SOCIAL_CHANGELOG_TITLE_MAX) {
            return ['title' => '', 'body' => '', 'error' =>
                'Neuigkeiten: die Titelzeile darf höchstens ' . AVESMAPS_SOCIAL_CHANGELOG_TITLE_MAX
                . ' Zeichen haben (hier: ' . $length . ').'];
        }
        // Der GANZE Text wird der Rumpf. Ihm hier die erste Zeile wegzunehmen, wäre der Fehler, den
        // die Titelzeile gerade abschafft: der Editor hat die Überschrift bereits separat gesagt.
        return ['title' => $explicit, 'body' => trim(str_replace(["\r\n", "\r"], "\n", $caption)), 'error' => null];
    }

    $normalized = str_replace(["\r\n", "\r"], "\n", $caption);
    $parts = explode("\n", $normalized, 2);
    $title = trim($parts[0]);
    $body = trim($parts[1] ?? '');

    if ($title === '') {
        return ['title' => '', 'body' => '', 'error' =>
            'Die erste Zeile ist leer — sie wird die Überschrift der Neuigkeit.'];
    }

    $length = mb_strlen($title);
    if ($length > AVESMAPS_SOCIAL_CHANGELOG_TITLE_MAX) {
        return ['title' => '', 'body' => '', 'error' =>
            'Neuigkeiten: die erste Zeile wird die Überschrift und darf höchstens '
            . AVESMAPS_SOCIAL_CHANGELOG_TITLE_MAX . ' Zeichen haben (hier: ' . $length
            . '). Setze nach der Überschrift einen Zeilenumbruch.'];
    }

    return ['title' => $title, 'body' => $body, 'error' => null];
}

/**
 * Schreibt den Beitrag in den Änderungsverlauf.
 *
 * ⚠️ Idempotent über `source_ref = social:<id>`: ein „Erneut" schreibt DIESELBE Zeile fort, statt
 * eine zweite anzulegen. Die Spalte trägt keinen UNIQUE-Schlüssel (sie gehört dem Verlauf, nicht
 * uns), also wird vorher gelesen -- ein zweiter Eintrag zum selben Beitrag wäre im öffentlichen
 * Fenster eine sichtbare Dublette.
 *
 * @param array<string, mixed> $post
 * @param array<string, mixed> $channel
 * @param array<string, mixed> $context Braucht `pdo`; Zugangsdaten braucht dieser Kanal keine.
 * @return array{ok: bool, remote_id?: string, error?: string}
 */
function avesmapsSocialAdapterChangelog(
    array $post,
    array $channel,
    string $caption,
    string $mediaUrl,
    array $context = []
): array {
    // Die Textabsage steht VOR der Verbindungsprüfung, und zwar bewusst: sie ist das, was der Editor
    // beheben kann, also soll sie ihn erreichen, wann immer sie zutrifft. Die fehlende Verbindung ist
    // dagegen ein Fehler des Servers, kein Zustand, den jemand herbeiführt -- und weil die Reihenfolge
    // so ist, lässt sich die ganze Absage ohne Datenbank prüfen.
    $split = avesmapsSocialChangelogSplit($caption, (string) ($post['title'] ?? ''));
    if ($split['error'] !== null) {
        return ['ok' => false, 'error' => $split['error']];
    }

    $pdo = $context['pdo'] ?? null;
    if (!$pdo instanceof PDO) {
        return ['ok' => false, 'error' => 'Der Kanal „Neuigkeiten" hat keine Datenbankverbindung bekommen.'];
    }

    try {
        avesmapsChangelogEnsureTable($pdo);
        // 💣 Siehe Dateikopf: ohne das schrumpft ein leerer Verlauf auf diesen einen Eintrag.
        avesmapsChangelogSeedIfEmpty($pdo);

        $sourceRef = 'social:' . (int) ($post['id'] ?? 0);
        $existing = $pdo->prepare('SELECT id FROM changelog_entry WHERE source_ref = :ref LIMIT 1');
        $existing->execute(['ref' => $sourceRef]);
        $entryId = (int) ($existing->fetchColumn() ?: 0);

        if ($entryId > 0) {
            $pdo->prepare(
                'UPDATE changelog_entry SET title = :title, body = :body, is_published = 1 WHERE id = :id'
            )->execute(['title' => $split['title'], 'body' => $split['body'], 'id' => $entryId]);
        } else {
            $pdo->prepare(
                'INSERT INTO changelog_entry (entry_date, title, body, category, sort_order, source_ref)
                 VALUES (:entry_date, :title, :body, :category, 0, :source_ref)'
            )->execute([
                // Das Datum des Beitrags, nicht das des Sendeversuchs: ein Vorschlag, der zwei Tage
                // auf seine Freigabe wartet, gehört in den Verlauf des Tages, an dem er entstand.
                'entry_date' => mb_substr((string) ($post['created_at'] ?? ''), 0, 10) ?: date('Y-m-d'),
                'title' => $split['title'],
                'body' => $split['body'],
                'category' => AVESMAPS_SOCIAL_CHANGELOG_CATEGORY,
                'source_ref' => $sourceRef,
            ]);
            $entryId = (int) $pdo->lastInsertId();
        }
    } catch (Throwable) {
        // Kein getMessage() nach draußen (AGENTS.md §10) -- die Zeile landet sichtbar in der Liste.
        return ['ok' => false, 'error' => 'Der Eintrag konnte nicht in den Verlauf geschrieben werden.'];
    }

    return ['ok' => true, 'remote_id' => 'changelog-' . $entryId];
}
