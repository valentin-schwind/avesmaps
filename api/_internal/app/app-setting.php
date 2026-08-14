<?php

declare(strict_types=1);

// Global app settings: a tiny, self-healing key/value store for runtime-toggleable flags.
//
// This lives in its own file because it is genuinely FEATURE-AGNOSTIC. It started inside game-literature.php
// for the cover kill switch, and the Kartensammlung (Spec §3.3) needs the same store for
// 'citymaps_enabled'. Requiring game-literature.php from citymaps.php just to reach three generic functions
// would make the map collection depend on the adventure catalog -- and PHP fatals on a redeclaration, so
// copying them was never an option either. Only the store moved out; the per-feature part (the key
// constant plus the default-on reader/writer pair) stays with the feature it belongs to.
//
// KILL-SWITCH POLARITY (convention, both features follow it): default ENABLED. Only an explicitly stored
// '0' disables, so a flag that was never written works out of the box on a fresh deploy.

// 💣 MEDIUMTEXT, NICHT VARCHAR(255) -- gemessen am 14.08.2026 an der Live-Anlage. Die 255 waren für
// Kill-Switch-Flags („0"/„1") gedacht und haben dreieinhalb Monate gereicht; der erste Schlüssel mit
// einem echten Wert, `travel_values`, ist über 1.400 Zeichen lang. MySQL schneidet außerhalb des
// strikten Modus STILL ab: `json_decode` liefert danach NULL, der Leser fällt auf seine Konstante
// zurück, und das ist von „es wurde nie etwas gespeichert" nicht zu unterscheiden. Genau so hat der
// „Speichern"-Knopf des Tempowerte-Fensters seit dem 14.08.2026 nichts getan, ohne je zu klagen.
// ⚠️ Eine bestehende Anlage heilt das NICHT von selbst: `CREATE TABLE IF NOT EXISTS` ist auf einer
// vorhandenen Tabelle ein No-op. Dafür gibt es avesmapsAppSettingEnsureWideValue() weiter unten.
function avesmapsAppSettingEnsureTable(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS app_setting (
            setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
            setting_value MEDIUMTEXT NOT NULL,
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}

/**
 * Eine bestehende `app_setting`-Tabelle auf MEDIUMTEXT nachziehen — einmalig, mit einer Sonde davor.
 *
 * 🔴 NUR VON SCHREIBERN GROSSER WERTE AUFZURUFEN, nie aus avesmapsAppSettingGet/Set. Die
 * information_schema-Sonde ist genau die Last, die AGENTS.md §10 für territories-endpoint.php
 * aufführt und die am 2026-07-17 den PHP-Pool sättigte; auf dem Kill-Switch-Pfad wäre sie auf jedem
 * Besucheraufruf. Die beiden Aufrufer (das Tempowerte-Fenster und seine Migration) sind kalte Pfade.
 *
 * 💣 DDL, ALSO NIE IN EINER TRANSAKTION — ein ALTER committet sie still (dieselbe Falle wie bei jedem
 * `*EnsureTables`).
 *
 * ⚠️ Fällt INERT aus. Kann sie nicht sondieren oder nicht ändern, wird nur weiterhin abgeschnitten —
 * und der Aufrufer merkt das an seiner eigenen Rückleseprobe, nicht an einer Ausnahme von hier.
 * Verbreitern ist verlustfrei: MEDIUMTEXT fasst jeden Wert, der vorher hineinpasste.
 */
function avesmapsAppSettingEnsureWideValue(PDO $pdo): void
{
    try {
        $statement = $pdo->prepare(
            "SELECT DATA_TYPE FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_setting' AND COLUMN_NAME = 'setting_value'"
        );
        $statement->execute();
        $type = strtolower(trim((string) $statement->fetchColumn()));
        // Leer heißt „die Tabelle gibt es hier nicht" (oder es ist gar kein MySQL) -- dann ist auch
        // nichts nachzuziehen.
        if ($type === '' || str_contains($type, 'text')) {
            return;
        }
        $pdo->exec('ALTER TABLE app_setting MODIFY setting_value MEDIUMTEXT NOT NULL');
    } catch (Throwable) {
        return;
    }
}

function avesmapsAppSettingGet(PDO $pdo, string $key, string $default = ''): string
{
    avesmapsAppSettingEnsureTable($pdo);
    $stmt = $pdo->prepare('SELECT setting_value FROM app_setting WHERE setting_key = :k LIMIT 1');
    $stmt->execute(['k' => $key]);
    $value = $stmt->fetchColumn();
    return $value === false ? $default : (string) $value;
}

function avesmapsAppSettingSet(PDO $pdo, string $key, string $value): void
{
    avesmapsAppSettingEnsureTable($pdo);
    $stmt = $pdo->prepare(
        'INSERT INTO app_setting (setting_key, setting_value) VALUES (:k, :v)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)'
    );
    $stmt->execute(['k' => $key, 'v' => $value]);
}

/**
 * Read a setting WITHOUT the self-healing DDL. For read paths that run on every visitor request.
 *
 * 💣 `avesmapsAppSettingGet` runs `CREATE TABLE IF NOT EXISTS app_setting` on EVERY call. In an
 * editor path that is fine and deliberate; in front of a public read it is precisely the hotspot
 * AGENTS.md §10 already lists for territories-endpoint.php, and the information_schema load of the
 * pool incident of 2026-07-17.
 *
 * A missing table returns the default, it does not create one: if the table does not exist, nobody
 * has ever switched anything on.
 *
 * ⚠️ This function exists BECAUSE the rule was about to be written a third time. V10 wrote it as
 * avesmapsPathLandscapesEcosystemEnabled and V11 needed the same thing for its own key -- so it
 * moved here. V10's caller went away with the dead-man switch on 2026-08-01; V11's
 * (avesmapsRouteTerrainEnabled, 'terrain_travel_enabled') stays, and it is the reason this lives here
 * rather than next to it.
 */
function avesmapsAppSettingGetWithoutDdl(PDO $pdo, string $key, string $default = ''): string
{
    try {
        $statement = $pdo->prepare('SELECT setting_value FROM app_setting WHERE setting_key = :k LIMIT 1');
        $statement->execute(['k' => $key]);
        $value = $statement->fetchColumn();
    } catch (PDOException) {
        return $default;
    }

    return $value === false ? $default : (string) $value;
}

/**
 * Read MANY settings in ONE query, WITHOUT the self-healing DDL. Same motivation as
 * avesmapsAppSettingGetWithoutDdl, extended to a caller that needs several keys at once: map-search.php
 * used to read citymaps_enabled, adventures_enabled and four lore_kind_*_enabled keys as SIX separate
 * round trips on the hottest public path -- each already DDL-free on its own, but six queries where one
 * would do.
 *
 * Returns key => value only for the rows that EXIST -- a key nobody ever wrote is simply absent from
 * the result, not present with an empty string. Callers apply their own per-key default exactly as they
 * would for a single avesmapsAppSettingGetWithoutDdl call.
 *
 * Same degradation as avesmapsAppSettingGetWithoutDdl: a missing table (nobody has ever switched
 * anything) or any other PDOException yields [], not a 500.
 *
 * @param list<string> $keys
 * @return array<string, string>
 */
function avesmapsAppSettingGetManyWithoutDdl(PDO $pdo, array $keys): array
{
    $keys = array_values(array_unique(array_map('strval', $keys)));
    if ($keys === []) {
        return [];
    }

    try {
        $placeholders = implode(',', array_fill(0, count($keys), '?'));
        $statement = $pdo->prepare(
            'SELECT setting_key, setting_value FROM app_setting WHERE setting_key IN (' . $placeholders . ')'
        );
        $statement->execute($keys);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (PDOException) {
        return [];
    }

    $result = [];
    foreach ($rows as $row) {
        $result[(string) $row['setting_key']] = (string) $row['setting_value'];
    }

    return $result;
}
