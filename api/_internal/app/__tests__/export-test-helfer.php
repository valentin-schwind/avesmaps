<?php

declare(strict_types=1);

/**
 * Geteilte Pruefwerkzeuge der Legacy-Exporte E1–E5 -- KEIN eigener Test.
 *
 * Das Deploy-Tor faehrt jede PHP-Datei unter `__tests__/` (Muster in .github/workflows/deploy-avesmaps-strato.yml);
 * allein gestartet definiert diese Datei nur Funktionen und endet mit Exit 0.
 *
 * Drei Werkzeuge, die jeder Exporttest benutzt:
 *   - `ExportTestNurLesePdo`: eine SQLite-Verbindung, die JEDE Anweisung mitschreibt. Der Test prueft danach, dass
 *     ausschliesslich SELECT lief -- auch ein `CREATE TABLE IF NOT EXISTS` auf eine vorhandene Tabelle, das in
 *     SQLite nichts schreibt und deshalb an `PRAGMA query_only` vorbeiginge, faellt hier auf.
 *   - `exportTestDatenbankAbdruck`: der GANZE Inhalt aller Tabellen samt Schema als Hash. Gleich vor und nach dem
 *     Lesen = nichts geschrieben.
 *   - `exportTestOhneKommentare`: Quelltext ohne Kommentare, mit dem TOKENIZER (nie zwei preg_replace: ein `/*` in
 *     einem Zeilenkommentar fraesse sonst echten Code bis zum naechsten `*\/`, AGENTS.md §11).
 */

if (!class_exists('ExportTestNurLesePdo')) {
    final class ExportTestNurLesePdo extends PDO
    {
        /** @var list<string> */
        public array $anweisungen = [];
        public bool $mitschreiben = false;

        public function prepare(string $query, array $options = []): PDOStatement|false
        {
            if ($this->mitschreiben) {
                $this->anweisungen[] = $query;
            }

            return parent::prepare($query, $options);
        }

        public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false
        {
            if ($this->mitschreiben) {
                $this->anweisungen[] = $query;
            }

            return $fetchMode === null ? parent::query($query) : parent::query($query, $fetchMode, ...$fetchModeArgs);
        }

        public function exec(string $statement): int|false
        {
            if ($this->mitschreiben) {
                $this->anweisungen[] = $statement;
            }

            return parent::exec($statement);
        }

        public function beginTransaction(): bool
        {
            if ($this->mitschreiben) {
                $this->anweisungen[] = 'BEGIN TRANSACTION';
            }

            return parent::beginTransaction();
        }
    }
}

if (!function_exists('exportTestNeuePdo')) {
    function exportTestNeuePdo(): ExportTestNurLesePdo
    {
        $pdo = new ExportTestNurLesePdo('sqlite::memory:');
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        return $pdo;
    }

    /**
     * Der ganze Datenbankinhalt als Hash: Schema UND jede Zeile jeder Tabelle.
     */
    function exportTestDatenbankAbdruck(PDO $pdo): string
    {
        $schema = $pdo->query("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")->fetchAll(PDO::FETCH_ASSOC);
        $teile = [json_encode($schema)];
        foreach ($schema as $eintrag) {
            if ($eintrag['type'] !== 'table' || str_starts_with((string) $eintrag['name'], 'sqlite_')) {
                continue;
            }
            $zeilen = $pdo->query('SELECT * FROM "' . $eintrag['name'] . '" ORDER BY rowid')->fetchAll(PDO::FETCH_ASSOC);
            $teile[] = $eintrag['name'] . '=' . json_encode($zeilen);
        }

        return hash('sha256', implode("\n", $teile));
    }

    /**
     * Fuehrt `$lesen` gegen eine mitschreibende, auf „nur lesen" gestellte Verbindung aus und prueft die
     * Schreibfreiheit DREIFACH: (1) SQLite selbst verweigert jede Schreibwirkung (`PRAGMA query_only`), (2) jede
     * Anweisung beginnt mit SELECT, (3) der ganze Datenbankinhalt ist danach Byte fuer Byte derselbe.
     *
     * @return mixed das Ergebnis von `$lesen`
     */
    function exportTestSchreibfrei(ExportTestNurLesePdo $pdo, callable $lesen, string $kennung): mixed
    {
        $vorher = exportTestDatenbankAbdruck($pdo);
        $pdo->exec('PRAGMA query_only = ON');
        $pdo->anweisungen = [];
        $pdo->mitschreiben = true;
        try {
            $ergebnis = $lesen();
        } finally {
            $pdo->mitschreiben = false;
            $pdo->exec('PRAGMA query_only = OFF');
        }
        assert($pdo->anweisungen !== [], "{$kennung}: das Lesen hat ueberhaupt keine Abfrage gestellt -- die Probe waere leer");
        foreach ($pdo->anweisungen as $anweisung) {
            $kopf = strtoupper(ltrim($anweisung));
            assert(
                str_starts_with($kopf, 'SELECT') || str_starts_with($kopf, 'WITH'),
                "{$kennung}: 🔴 nur SELECT ist erlaubt, gelaufen ist: " . substr(trim($anweisung), 0, 120)
            );
        }
        assert(exportTestDatenbankAbdruck($pdo) === $vorher, "{$kennung}: 🔴 der Datenbankinhalt hat sich durch das Lesen veraendert");

        return $ergebnis;
    }

    function exportTestOhneKommentare(string $quelle): string
    {
        $aus = '';
        foreach (token_get_all($quelle) as $token) {
            if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            $aus .= is_array($token) ? $token[1] : $token;
        }

        return $aus;
    }

    /**
     * Die Schluesselmenge eines Objekts, sortiert -- fuer „genau diese Felder, kein weiteres".
     */
    function exportTestSchluessel(array $objekt): array
    {
        $schluessel = array_map('strval', array_keys($objekt));
        sort($schluessel);

        return $schluessel;
    }

    /**
     * Prueft, dass eine Liste von Objekten GENAU die freigegebenen Felder traegt (keines mehr, keines weniger).
     */
    function exportTestGenauFelder(array $liste, array $felder, string $kennung): void
    {
        $erwartet = $felder;
        sort($erwartet);
        assert($liste !== [], "{$kennung}: die Liste ist leer -- die Probe waere wirkungslos");
        foreach ($liste as $index => $objekt) {
            assert(
                exportTestSchluessel($objekt) === $erwartet,
                "{$kennung}: Eintrag {$index} traegt " . json_encode(exportTestSchluessel($objekt)) . ', erwartet ' . json_encode($erwartet)
            );
        }
    }

    /**
     * Sucht rekursiv nach einer Zeichenkette in einer Antwort -- fuer „dieses Geheimnis taucht NIRGENDS auf".
     */
    function exportTestEnthaelt(mixed $wert, string $nadel): bool
    {
        if (is_array($wert)) {
            foreach ($wert as $schluessel => $kind) {
                if (str_contains((string) $schluessel, $nadel) || exportTestEnthaelt($kind, $nadel)) {
                    return true;
                }
            }

            return false;
        }

        return is_string($wert) && str_contains($wert, $nadel);
    }

    /**
     * Prueft einen Export-ENDPUNKT am Quelltext (er endet mit exit und laesst sich nicht ausfuehren):
     * Reihenfolge Herkunft -> Methode -> (Riegel) -> Lesen -> Senden, die Fehlerantworten, kein getMessage,
     * kein Schreibweg. `$privat`: der Endpunkt verlangt eine Admin-Sitzung VOR dem Lesen; sonst darf er keine
     * Sitzung kennen.
     */
    function exportTestEndpunktPruefen(string $datei, string $leseFunktion, bool $privat, string $kennung): void
    {
        $quelle = exportTestOhneKommentare((string) file_get_contents($datei));
        $stelle = static function (string $nadel) use ($quelle, $kennung): int {
            $pos = strpos($quelle, $nadel);
            assert($pos !== false, "{$kennung}: im Endpunkt fehlt '{$nadel}'");

            return (int) $pos;
        };
        $herkunft = $stelle('avesmapsApplyCorsPolicy(');
        $methode = $stelle("!== 'GET'");
        $lesen = $stelle($leseFunktion . '(');
        $senden = $stelle('avesmapsExportSenden(');
        assert($herkunft < $methode && $methode < $lesen && $lesen < $senden, "{$kennung}: Reihenfolge Herkunft -> Methode -> Lesen -> Senden");
        assert(strpos($quelle, 'header(') === false, "{$kennung}: 💣 keine eigene Kopfzeile -- die setzt allein avesmapsExportSenden, NACH dem Lesen");
        assert(preg_match('/avesmapsErrorResponse\(\s*403\b/', $quelle) === 1, "{$kennung}: 403 fuer eine fremde Herkunft");
        assert(preg_match('/avesmapsErrorResponse\(\s*405\b/', $quelle) === 1, "{$kennung}: 405 fuer jede andere Methode als GET");
        assert(str_contains($quelle, 'catch (AvesmapsExportInBewegung)') && str_contains($quelle, 'avesmapsExportInBewegungAntworten('), "{$kennung}: bewegter Stand = 503 data_changing, kein 500");
        assert(!str_contains($quelle, 'getMessage'), "{$kennung}: 🔴 kein getMessage() an den Aufrufer (AGENTS.md §10)");
        foreach (['avesmapsReadJsonRequest', '$_POST', 'INSERT INTO', 'UPDATE ', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', '->exec(', 'Ensure', 'beginTransaction'] as $verboten) {
            assert(!str_contains($quelle, $verboten), "{$kennung}: der Endpunkt darf '{$verboten}' nicht enthalten");
        }
        if ($privat) {
            $riegel = $stelle("avesmapsRequireUserWithCapabilityOhneNeueSitzung('admin')");
            assert($methode < $riegel && $riegel < $lesen, "{$kennung}: 🔴 die Admin-Pruefung steht VOR dem Lesen");
            assert(preg_match("/avesmapsExportSenden\([^;]*,\s*true\s*\)/", $quelle) === 1, "{$kennung}: ein privater Export liegt in keinem geteilten Zwischenspeicher");
        } else {
            foreach (['avesmapsRequireUser', 'avesmapsCurrentUser', 'session_start', 'auth.php'] as $verboten) {
                assert(!str_contains($quelle, $verboten), "{$kennung}: ein oeffentlicher Export darf '{$verboten}' nicht kennen");
            }
        }
    }

    /**
     * Prueft eine Export-BIBLIOTHEK am Quelltext: kein Schreibweg, kein DDL, kein Platzhalter doppelt
     * (MySQL mit nativen Prepares lehnt das mit HY093 ab, SQLite nicht -- ein Fehler, der hier nie rot wuerde).
     */
    function exportTestBibliothekPruefen(string $datei, string $kennung): void
    {
        $quelle = exportTestOhneKommentare((string) file_get_contents($datei));
        foreach (['INSERT INTO', 'UPDATE ', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP ', 'TRUNCATE', '->exec(', 'beginTransaction', 'Ensure', 'avesmapsAppSettingGet(', 'file_put_contents', 'session_start', 'avesmapsCoatSchalterFast', 'avesmapsCoatSwitchEnabledFast', 'avesmapsAppSettingGetWithoutDdl'] as $verboten) {
            assert(!str_contains($quelle, $verboten), "{$kennung}: die Bibliothek darf '{$verboten}' nicht enthalten");
        }
        preg_match_all('/->prepare\((.*?)\);/s', $quelle, $abfragen);
        foreach ($abfragen[1] as $sql) {
            preg_match_all('/:([a-z_]+)\b/', $sql, $namen);
            assert(count($namen[1]) === count(array_unique($namen[1])), "{$kennung}: 💣 ein Platzhalter steht zweimal in derselben Abfrage: " . substr(trim($sql), 0, 160));
        }
    }

    /**
     * Die FORM einer Beispielantwort (docs/legacy-exporte/*.json) gegen die echte Antwort: jedes Objekt der
     * Beispielantwort traegt dieselben Schluessel wie das erste Objekt derselben Stelle in der echten Antwort.
     * So bleibt die Doku ehrlich -- ein Feld, das dazukommt oder wegfaellt, macht den Test rot, bis das
     * Beispiel nachgezogen ist.
     */
    function exportTestFormGleich(mixed $beispiel, mixed $echt, string $pfad): void
    {
        if (!is_array($beispiel) || !is_array($echt) || $beispiel === [] || $echt === []) {
            return;
        }
        $beispielListe = array_is_list($beispiel);
        $echtListe = array_is_list($echt);
        assert($beispielListe === $echtListe, "Form {$pfad}: Liste gegen Objekt");
        if ($beispielListe) {
            foreach ($beispiel as $index => $eintrag) {
                exportTestFormGleich($eintrag, $echt[0], $pfad . '[' . $index . ']');
            }

            return;
        }
        assert(
            exportTestSchluessel($beispiel) === exportTestSchluessel($echt),
            "Form {$pfad}: Beispiel " . json_encode(exportTestSchluessel($beispiel)) . ' gegen echt ' . json_encode(exportTestSchluessel($echt))
        );
        foreach ($beispiel as $schluessel => $kind) {
            exportTestFormGleich($kind, $echt[$schluessel], $pfad . '.' . $schluessel);
        }
    }
}
