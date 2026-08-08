<?php

declare(strict_types=1);

/*
 * Changelog -- die Meilensteine der Entwicklung, wie sie im "Hinweise"-Dialog nachzulesen sind.
 *
 * ZWEI QUELLEN, EINE RANGFOLGE. Die Tabelle `changelog_entry` ist die Wahrheit, sobald sie da ist;
 * solange sie fehlt oder leer ist, antwortet der Lesepfad aus der Konstante AVESMAPS_CHANGELOG_SEED
 * unten. Das ist Absicht und kein Provisorium:
 *
 *  - Der Verlauf ist nach dem Deploy SOFORT sichtbar, ohne dass jemand einen Knopf drueckt. Ein
 *    leerer Verlauf waere schlimmer als gar keiner -- er behauptet, es sei nichts passiert.
 *  - Der Lesepfad braucht damit KEIN DDL. Ein `CREATE TABLE IF NOT EXISTS` auf einem oeffentlichen
 *    Lesepfad laeuft bei jedem Aufruf, kostet auf STRATO messbar, und macht die Datei ohne
 *    lebende Datenbank untestbar. Angelegt wird ausschliesslich im Schreibpfad
 *    (api/edit/map/changelog.php), also genau dann, wenn wirklich jemand schreibt.
 *
 * Die Saat wird beim ersten Schreibzugriff EINMAL eingespielt und danach nie wieder angefasst --
 * `avesmapsChangelogSeedIfEmpty()` fuellt nur eine leere Tabelle. Wer einen Eintrag von Hand
 * nachschaerft, behaelt seine Fassung; die Konstante hier ist der Startbestand, nicht die Vorlage,
 * gegen die abgeglichen wird. (Anders als bei den Klimazonen gibt es hier nichts abzugleichen: ein
 * vergangener Meilenstein aendert sich nicht mehr.)
 *
 * Gepflegt wird der Verlauf kuenftig von der Routine "Avesmaps feature updates": sie liest die
 * Commits seit `source_ref` des juengsten Eintrags und haengt an, was dazugekommen ist.
 */

// Die vier Rubriken. Sie stehen als Marke unter jedem Eintrag und sind DATEN, keine Uebersetzung --
// wer eine fuenfte will, traegt sie hier ein und im Filter des Editors, sonst nirgends.
const AVESMAPS_CHANGELOG_CATEGORIES = ['karte', 'routenplaner', 'inhalte', 'community'];

// Was die Routine "Avesmaps feature updates" mit ihrem Token darf (Schreibpfad
// api/edit/map/changelog.php). Sie hat keine Session, nur ein Token -- also braucht sie einen Weg
// herein. Aber einen SCHMALEREN als ein Mensch:
// 💣 `delete` gehoert NICHT hierher und darf nie dazukommen. Die Routine hat keinen Grund zu
// loeschen, und ein abhandengekommenes Token soll den Verlauf ergaenzen koennen, nicht ausraeumen.
// Die Liste steht hier statt im Endpunkt, damit ein Test die echte Konstante lesen kann statt
// Quelltext zu greppen.
const AVESMAPS_CHANGELOG_TOKEN_ACTIONS = ['list', 'save'];

/**
 * Darf die Routine diese Aktion ausfuehren? Die Entscheidung steht als eigene Funktion hier und
 * nicht als in_array() im Endpunkt, damit ein Test sie WIRKLICH aufrufen kann -- der Endpunkt
 * laesst sich nicht requiren, sein try-Block beantwortete sofort eine Anfrage.
 *
 * Strikt verglichen: 'Delete' ist nicht 'delete', und '' ist keine Aktion.
 */
function avesmapsChangelogTokenMayRun(string $action): bool
{
    return in_array($action, AVESMAPS_CHANGELOG_TOKEN_ACTIONS, true);
}

/**
 * Vergleicht das mitgeschickte Token mit dem konfigurierten ($config['changelog']['app_token']).
 *
 * 💣 Faellt ZU, sobald eine der beiden Seiten leer ist -- und beide Richtungen zaehlen. Ohne die
 * erste Haelfte kaeme jede Installation, in der der Schluessel fehlt, mit einem leeren Header
 * herein; das ist genau der Zustand direkt nach diesem Deploy und vor dem Eintrag in
 * config.local.php. hash_equals() vergleicht in konstanter Zeit, damit die Antwortzeit das Token
 * nicht Zeichen fuer Zeichen verraet.
 *
 * ⚠️ Bewusst eine EIGENE Pruefung statt avesmapsDiscordCheckAppToken(): der Verlauf hat seit
 * 2026-08-08 seinen eigenen Schluessel (Owner-Entscheid). Drei Zeilen doppelt sind der Preis dafuer,
 * dass die beiden Tueren nichts voneinander wissen -- wer den Discord-Schluessel tauscht, faellt dem
 * Verlauf nicht ins Schloss, und ein Leck auf der einen Seite oeffnet die andere nicht mit.
 */
function avesmapsChangelogTokenMatches(string $configured, string $provided): bool
{
    if ($configured === '' || $provided === '') {
        return false;
    }

    return hash_equals($configured, $provided);
}

/**
 * Der Startbestand: 42 Meilensteine, destilliert aus 4.655 Commits (22.04.2026 - 03.08.2026).
 *
 * Erzaehlt fuer Leser, die weder Commits noch Code kennen: was sich fuer SIE geaendert hat, nicht
 * welche Datei angefasst wurde. `sort_order` ordnet nur INNERHALB eines Tages (kleiner = weiter
 * oben); zwischen den Tagen entscheidet allein das Datum.
 *
 * @return array<int, array<string, mixed>>
 */
function avesmapsChangelogSeed(): array
{
    return [
        ['date' => '2026-08-03', 'order' => 1, 'category' => 'routenplaner',
         'title' => 'Ein Kalender für die Reise',
         'body' => 'Der Routenplaner fragt jetzt, wann ihr aufbrecht — Tag und aventurischer Monat. Jede Etappe nennt ihr Datum, der Plan nennt Abreise und Ankunft. Und die Jahreszeit rechnet mit: im Firun ist der Boden schwerer als im Efferd, manche Pässe sind im Winter gar nicht begehbar.'],

        ['date' => '2026-08-03', 'order' => 2, 'category' => 'karte',
         'title' => 'Klimazonen',
         'body' => 'Von den Ewigen Eisfeldern bis in die Tropen liegen jetzt acht Klimazonen über der Karte. Orte, Landschaften und Wege sagen in ihrer Infobox, in welcher sie liegen.'],

        ['date' => '2026-08-03', 'order' => 3, 'category' => 'routenplaner',
         'title' => 'Was die Reise kostet',
         'body' => 'Unter den Etappen steht, was unterwegs zusammenkommt — je nachdem, wie viele reisen und ob sie im Freien schlafen, auf dem Strohsack oder im eigenen Zimmer.'],

        ['date' => '2026-08-02', 'order' => 1, 'category' => 'karte',
         'title' => 'Die Suche findet mehr',
         'body' => 'Mehrere Wörter dürfen jetzt in verschiedene Felder treffen — „schänke imdal" findet die Schänke in Imdal. Neu durchsucht werden außerdem die Kartensammlung, die Abenteuer und die Vorkommen: ein Treffer springt dorthin, wo das Abenteuer beginnt oder wo die Pflanze wächst.'],

        ['date' => '2026-08-01', 'order' => 1, 'category' => 'routenplaner',
         'title' => 'Hierher reisen',
         'body' => 'Ein Rechtsklick auf irgendeinen Punkt der Karte — auch mitten im Nirgendwo — und der Planer legt eine Route bis genau dorthin. Das letzte Stück geht querfeldein, sucht sich seinen Weg ums Wasser herum und lässt die Kutsche stehen, wo keine Kutsche fährt.'],

        ['date' => '2026-07-30', 'order' => 1, 'category' => 'routenplaner',
         'title' => 'Berge kosten Zeit',
         'body' => 'Für jeden Weg ist hinterlegt, wie viel er steigt und wie viel er fällt. Eine Etappe über einen Gebirgspass dauert jetzt länger als dieselbe Strecke im Flachland — und der Plan sagt euch, warum.'],

        ['date' => '2026-07-29', 'order' => 1, 'category' => 'routenplaner',
         'title' => 'Wodurch die Reise führt',
         'body' => 'Jede Etappe nennt die Landschaften, durch die sie läuft — Wald, Steppe, Wüste, Moor. Die Namen sind angeklickt und führen auf die Karte.'],

        ['date' => '2026-07-26', 'order' => 1, 'category' => 'karte',
         'title' => 'Die Landschaften',
         'body' => 'Eine neue Ebene, in drei Schichten: was wächst (Wald, Steppe, Wüste), wie das Land geformt ist (Gebirge, Hügel, Küste) und wie es großräumig heißt (Inseln, Kontinente). Gezeichnet wird sie im Editor mit Pinsel, Radierer und exakten Ecken — und die Berge tragen ihre Höhe in Schritt.'],

        ['date' => '2026-07-21', 'order' => 1, 'category' => 'inhalte',
         'title' => 'Natur und Waren',
         'body' => 'Was wächst hier, was lebt hier, was wird hier gehandelt? Regionen und Orte zeigen ihre Pflanzen, Tiere und Handelswaren — zusammengetragen aus Wiki Aventurica.'],

        ['date' => '2026-07-16', 'order' => 1, 'category' => 'inhalte',
         'title' => 'Die Kartensammlung',
         'body' => 'Stadtpläne, Regionalkarten, Schlachtpläne: zu vielen Orten gibt es Karten, und Avesmaps sagt euch, wo ihr sie findet. Mit Vorschaubild, Maßstab, Verlag — und einem Spoiler-Schleier über allem, was eine Spielrunde verderben könnte.'],

        ['date' => '2026-07-13', 'order' => 1, 'category' => 'karte',
         'title' => 'Bilder zu den Orten',
         'body' => 'Städte und Regionen bekommen ein Kopfbild und eine kleine Galerie. Wir zeigen nur, was gemeinfrei oder eigens erzeugt ist — Scans aus Publikationen und fremde Fanart bleiben draußen.'],

        ['date' => '2026-07-12', 'order' => 1, 'category' => 'inhalte',
         'title' => 'Abenteuer',
         'body' => 'Welche DSA-Abenteuer spielen in diesem Ort? Die Infobox zeigt sie mit Cover, Edition und Verlagslink. Wer sich nichts verraten lassen will, lässt den Spoiler-Schalter zu — und wer mag, sieht die Questroute eines Abenteuers auf der Karte.'],

        ['date' => '2026-07-11', 'order' => 1, 'category' => 'karte',
         'title' => 'Ein neues Gesicht',
         'body' => 'Alle Fenster, Panels und Dialoge sprechen ab jetzt dieselbe Sprache: warme Brauntöne, Pergament, Wappengold — und kein Blau mehr. Dazu ein Umschalter zwischen hell und dunkel, oben rechts.'],

        ['date' => '2026-07-10', 'order' => 1, 'category' => 'karte',
         'title' => 'Das Infopanel',
         'body' => 'Statt kleiner Popups, die sich gegenseitig verdecken, klappt rechts eine Seitenleiste auf. Sie hat Platz für Wappen, Bild, Beschreibung, Quellen — und merkt sich, wo ihr auf eurer Route gerade seid.'],

        ['date' => '2026-07-08', 'order' => 1, 'category' => 'inhalte',
         'title' => 'Woher wir das wissen',
         'body' => 'Jede Angabe darf ihre Quelle nennen — Wiki-Artikel, Publikation mit Seitenzahl, oder eine eigene. Die Publikationen zieht Avesmaps automatisch aus dem Wiki und verlinkt sie, wo es sie zu kaufen gibt.'],

        ['date' => '2026-07-06', 'order' => 1, 'category' => 'community',
         'title' => 'Ein Bot auf dem Discord',
         'body' => 'Fehler, Ideen und Fragen lassen sich mit /bug direkt im Discord melden. Der Bot legt daraus einen nummerierten Fall an, und wir arbeiten ihn ab.'],

        ['date' => '2026-07-05', 'order' => 1, 'category' => 'routenplaner',
         'title' => 'Flüsse haben eine Richtung',
         'body' => 'Flussabwärts kommt ihr schneller voran als flussaufwärts. Avesmaps kennt für jeden Fluss seine Fließrichtung und rechnet sie in die Reisezeit ein — der Plan sagt bei jeder Etappe, welche der beiden es ist.'],

        ['date' => '2026-07-05', 'order' => 2, 'category' => 'routenplaner',
         'title' => 'Reisestunden statt Rastzeiten',
         'body' => 'Ihr sagt, wie viele Stunden am Tag ihr unterwegs seid — den Rest rechnet der Planer. Entfernungen stehen jetzt in Meilen, wie es sich für Aventurien gehört.'],

        ['date' => '2026-07-01', 'order' => 1, 'category' => 'karte',
         'title' => 'Weiche Übergänge',
         'body' => 'Ortsmarken und Beschriftungen blenden beim Zoomen ein und aus, statt zu springen. Oben läuft ein schmaler Ladebalken, solange die Karte noch nachlädt.'],

        ['date' => '2026-06-29', 'order' => 1, 'category' => 'community',
         'title' => 'Schreibt uns',
         'body' => 'Ein Kontaktformular direkt in den Hinweisen. Die Hinweise selbst sind in Themengruppen sortiert — Projekt, Lizenzen, Datenquellen, Technik, Datenschutz — und nennen offen, woher unsere Daten kommen.'],

        ['date' => '2026-06-14', 'order' => 1, 'category' => 'karte',
         'title' => 'Avesmaps auf Englisch',
         'body' => 'Die Oberfläche gibt es auf Englisch. Deutsch bleibt die Sprache des Hauses; Aventurien und seine Namen werden nicht übersetzt.'],

        ['date' => '2026-06-12', 'order' => 1, 'category' => 'karte',
         'title' => 'Umstrittene Gebiete',
         'body' => 'Wo zwei Reiche dasselbe Land beanspruchen, liegt eine Schraffur — und die Infobox nennt beide Parteien.'],

        ['date' => '2026-06-10', 'order' => 1, 'category' => 'karte',
         'title' => 'Magiersicht',
         'body' => 'Im Kraftlinien-Modus verblasst die Karte ins Graue, Straßen und Grenzen treten zurück — und nur die Ley-Knoten leuchten noch.'],

        ['date' => '2026-06-09', 'order' => 1, 'category' => 'karte',
         'title' => 'Namen an den Grenzen',
         'body' => 'Herrschaftsgebiete schreiben ihren Namen an der eigenen Grenze entlang, und zwei Nachbarn stellen sich gegenüber. Alle Beschriftungen sind nun in die Landschaft eingebettet statt daraufgelegt.'],

        ['date' => '2026-06-08', 'order' => 1, 'category' => 'karte',
         'title' => 'Neue Ortsmarken',
         'body' => 'Von der Metropole bis zum Dorf eine einheitliche Formenfamilie mit Goldakzent, Stätten als Raute. Sie wachsen und schrumpfen sauber mit dem Zoom — und die Karte läuft dabei spürbar flüssiger.'],

        ['date' => '2026-06-07', 'order' => 1, 'category' => 'community',
         'title' => 'Bewertungen und Kurzlinks',
         'body' => 'Orte lassen sich mit Sternen bewerten und kurz kommentieren. Und jede Route, jede Ansicht wird zu einem kurzen Link statt zu einer endlosen Adresszeile — teilbar in einer Zeile Chat.'],

        ['date' => '2026-06-06', 'order' => 1, 'category' => 'inhalte',
         'title' => 'Wappen, Regionen, Flüsse und Straßen aus dem Wiki',
         'body' => 'Der Abgleich mit Wiki Aventurica erfasst jetzt auch Landschaften, Flüsse, Straßen, Bauwerke und Wappen. Herrschaftsgebiete und Orte tragen ihr Wappen — nur, wenn dessen Lizenz das zulässt.'],

        ['date' => '2026-06-04', 'order' => 1, 'category' => 'karte',
         'title' => 'Die politische Ansicht geht live',
         'body' => 'Zum ersten Mal für alle sichtbar: Reiche, Grafschaften und Baronien auf der Karte. Die Maus hebt ein Gebiet hervor, ein Klick öffnet seine Infobox, ein Doppelklick zoomt hinein.'],

        ['date' => '2026-06-02', 'order' => 1, 'category' => 'karte',
         'title' => 'Die Karte lädt schneller',
         'body' => 'Die Kartendaten kommen komprimiert und werden im Browser behalten — wer wiederkommt, wartet nicht noch einmal.'],

        ['date' => '2026-05-29', 'order' => 1, 'category' => 'karte',
         'title' => 'Reiche zeichnen ihre eigenen Grenzen',
         'body' => 'Wer alle Baronien eines Reichs kennt, kennt auch dessen Außengrenze — Avesmaps rechnet sie sich jetzt selbst aus. Beim Hineinzoomen wandert die Füllung die Hierarchie hinunter: erst das Reich, dann die Grafschaft, dann die Baronie.'],

        ['date' => '2026-05-25', 'order' => 1, 'category' => 'routenplaner',
         'title' => 'Wegfindung auch auf dem Server',
         'body' => 'Routen werden nicht mehr nur im Browser gerechnet. Damit hat Avesmaps eine offene Schnittstelle, über die auch andere Werkzeuge Strecken abfragen können.'],

        ['date' => '2026-05-19', 'order' => 1, 'category' => 'inhalte',
         'title' => 'Abgleich mit Wiki Aventurica',
         'body' => 'Ein Werkzeug liest Wiki Aventurica und schlägt vor, was auf der Karte fehlt oder abweicht. Übernommen wird nichts automatisch — jeder Vorschlag geht durch eine Prüfung von Hand.'],

        ['date' => '2026-05-15', 'order' => 1, 'category' => 'inhalte',
         'title' => 'Herrschaftsgebiete',
         'body' => 'Der Anfang der politischen Ebene: Reiche, Grafschaften und Baronien mit ihrer Hierarchie — und mit ihrem Zeitraum, gemessen in Jahren nach Bosparans Fall.'],

        ['date' => '2026-05-14', 'order' => 1, 'category' => 'karte',
         'title' => 'Kompass und Maßstab',
         'body' => 'Die Karte bekommt ihren Zierrat: ein Kompass in der Ecke und ein Maßstabsband, beide mitwachsend mit dem Zoom.'],

        ['date' => '2026-05-13', 'order' => 1, 'category' => 'karte',
         'title' => 'Die Suche',
         'body' => 'Ein Suchfeld, das Orte, Wege und Regionen findet und direkt hinspringt.'],

        ['date' => '2026-05-09', 'order' => 1, 'category' => 'karte',
         'title' => 'Die Kraftlinien',
         'body' => 'Das Nodix-Netz zieht als eigene Ebene über Aventurien: leuchtende Linien zwischen den Kraftknoten, die leise wabern.'],

        ['date' => '2026-05-08', 'order' => 1, 'category' => 'karte',
         'title' => 'Wege bekommen Kurven und Namen',
         'body' => 'Straßen und Flüsse werden weich gezeichnet statt eckig, und ihr Name läuft an der Linie entlang.'],

        ['date' => '2026-05-07', 'order' => 1, 'category' => 'karte',
         'title' => 'Eine eigene Kartenoptik',
         'body' => 'Statt einer gescannten Vorlage entsteht ein eigener Kachelsatz: gezeichnete Landschaft, eigene Farben, eigene Beschriftungen — die Karte, die ihr heute seht.'],

        ['date' => '2026-05-06', 'order' => 1, 'category' => 'community',
         'title' => 'Die Karte wird bearbeitbar',
         'body' => 'Ein geschützter Editorbereich: Orte anlegen und verschieben, Kreuzungen setzen, Wege zeichnen, Beschriftungen platzieren. Ab hier wächst Aventurien nicht mehr durch Dateien, sondern durch Menschen.'],

        ['date' => '2026-04-24', 'order' => 1, 'category' => 'community',
         'title' => 'Ihr könnt uns Orte melden',
         'body' => 'Wer einen fehlenden oder falsch gesetzten Ort findet, meldet ihn direkt auf der Karte. Wir schauen ihn uns an, bevor er erscheint.'],

        ['date' => '2026-04-23', 'order' => 1, 'category' => 'routenplaner',
         'title' => 'Zu Fuß, zu Pferd, zu Schiff',
         'body' => 'Für jede Etappe lässt sich das Reisemittel wählen — und jeder Ort bekommt ein Fenster mit Beschreibung und einem Link ins Wiki Aventurica.'],

        ['date' => '2026-04-22', 'order' => 1, 'category' => 'karte',
         'title' => 'Avesmaps geht online',
         'body' => 'Die erste Fassung: eine Karte von Aventurien im Browser und ein Planer, der zwischen zwei Orten den Weg sucht. Klein, statisch, aber die Idee stand.'],
    ];
}

/**
 * Bringt einen Eintrag -- aus der Saat ODER aus der Datenbank -- in die Form, die der Endpunkt
 * ausliefert. PURE, damit sie ohne Datenbank pruefbar ist.
 *
 * Ein Eintrag ohne Datum oder ohne Titel ist keiner und faellt heraus (null): eine Zeile, die im
 * Fenster als leerer Streifen erscheint, ist schlimmer als eine fehlende.
 *
 * @param array<string, mixed> $raw
 * @return array<string, mixed>|null
 */
function avesmapsChangelogNormalizeEntry(array $raw): ?array
{
    // Die Saat schreibt 'date'/'order', die Tabelle 'entry_date'/'sort_order' -- beides zulassen,
    // damit derselbe Normalisierer fuer beide Quellen gilt und die Formen nicht auseinanderlaufen.
    $date = trim((string) ($raw['entry_date'] ?? $raw['date'] ?? ''));
    $title = trim((string) ($raw['title'] ?? ''));

    if ($title === '' || preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1) {
        return null;
    }

    $category = strtolower(trim((string) ($raw['category'] ?? '')));
    if (!in_array($category, AVESMAPS_CHANGELOG_CATEGORIES, true)) {
        $category = '';
    }

    return [
        'date' => $date,
        'title' => $title,
        'body' => trim((string) ($raw['body'] ?? '')),
        'category' => $category,
        'sort_order' => (int) ($raw['sort_order'] ?? $raw['order'] ?? 0),
    ];
}

/**
 * Neueste zuerst; innerhalb eines Tages nach sort_order (kleiner = weiter oben), und bei Gleichstand
 * nach Titel, damit die Reihenfolge zwischen zwei Aufrufen nicht springt. PURE.
 *
 * @param array<int, array<string, mixed>> $entries
 * @return array<int, array<string, mixed>>
 */
function avesmapsChangelogSortEntries(array $entries): array
{
    usort($entries, static function (array $a, array $b): int {
        $byDate = strcmp((string) $b['date'], (string) $a['date']);   // absteigend
        if ($byDate !== 0) {
            return $byDate;
        }
        $byOrder = ((int) $a['sort_order']) <=> ((int) $b['sort_order']);   // aufsteigend
        if ($byOrder !== 0) {
            return $byOrder;
        }
        return strcmp((string) $a['title'], (string) $b['title']);
    });

    return $entries;
}

/**
 * Saat oder Tabellenzeilen -> die ausgelieferte Liste. PURE.
 *
 * @param array<int, array<string, mixed>> $rows
 * @return array<int, array<string, mixed>>
 */
function avesmapsChangelogPrepareEntries(array $rows): array
{
    $entries = [];
    foreach ($rows as $row) {
        $entry = avesmapsChangelogNormalizeEntry(is_array($row) ? $row : []);
        if ($entry !== null) {
            $entries[] = $entry;
        }
    }

    return avesmapsChangelogSortEntries($entries);
}

/**
 * Liest die veroeffentlichten Eintraege. Gibt `null` zurueck, wenn die Tabelle (noch) nicht
 * existiert -- der Aufrufer faellt dann auf die Saat zurueck. Legt NICHTS an: siehe Dateikopf.
 *
 * @return array<int, array<string, mixed>>|null
 */
function avesmapsChangelogReadPublished(PDO $pdo): ?array
{
    try {
        $rows = $pdo->query(
            'SELECT entry_date, title, body, category, sort_order
             FROM changelog_entry
             WHERE is_published = 1'
        )->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $ignored) {
        return null;   // Tabelle fehlt -> die Saat antwortet.
    }

    return avesmapsChangelogPrepareEntries($rows ?: []);
}

/**
 * Legt die Tabelle an. NUR aus dem Schreibpfad aufrufen (api/edit/map/changelog.php).
 *
 * `source_ref` merkt sich, woher ein Eintrag stammt -- fuer die Routine "Avesmaps feature updates"
 * der Commit-SHA, bis zu dem sie gelesen hat. Sie findet damit ihren Anschluss, ohne dass irgendwo
 * ein zweiter Zeiger gepflegt werden muesste.
 */
function avesmapsChangelogEnsureTable(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS changelog_entry (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            entry_date DATE NOT NULL,
            title VARCHAR(190) NOT NULL,
            body TEXT NULL,
            category VARCHAR(40) NOT NULL DEFAULT "",
            is_published TINYINT(1) NOT NULL DEFAULT 1,
            sort_order INT NOT NULL DEFAULT 0,
            source_ref VARCHAR(190) NOT NULL DEFAULT "",
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_changelog_date (entry_date, sort_order),
            KEY idx_changelog_published (is_published, entry_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

/**
 * Spielt die Saat ein -- aber nur in eine LEERE Tabelle. Ein einmal geschriebener Verlauf wird nie
 * wieder von der Konstante ueberfahren: wer einen Eintrag nachschaerft, behaelt seine Fassung.
 *
 * @return int Zahl der eingefuegten Zeilen (0 = es lag schon etwas drin).
 */
function avesmapsChangelogSeedIfEmpty(PDO $pdo): int
{
    $existing = (int) $pdo->query('SELECT COUNT(*) FROM changelog_entry')->fetchColumn();
    if ($existing > 0) {
        return 0;
    }

    $statement = $pdo->prepare(
        'INSERT INTO changelog_entry (entry_date, title, body, category, sort_order, source_ref)
         VALUES (:entry_date, :title, :body, :category, :sort_order, :source_ref)'
    );

    $inserted = 0;
    foreach (avesmapsChangelogSeed() as $raw) {
        $entry = avesmapsChangelogNormalizeEntry($raw);
        if ($entry === null) {
            continue;
        }
        $statement->execute([
            ':entry_date' => $entry['date'],
            ':title' => $entry['title'],
            ':body' => $entry['body'],
            ':category' => $entry['category'],
            ':sort_order' => $entry['sort_order'],
            ':source_ref' => 'seed',
        ]);
        $inserted++;
    }

    return $inserted;
}
