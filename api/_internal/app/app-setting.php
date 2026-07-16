<?php

declare(strict_types=1);

// Global app settings: a tiny, self-healing key/value store for runtime-toggleable flags.
//
// This lives in its own file because it is genuinely FEATURE-AGNOSTIC. It started inside adventures.php
// for the cover kill switch, and the Kartensammlung (Spec §3.3) needs the same store for
// 'citymaps_enabled'. Requiring adventures.php from citymaps.php just to reach three generic functions
// would make the map collection depend on the adventure catalog -- and PHP fatals on a redeclaration, so
// copying them was never an option either. Only the store moved out; the per-feature part (the key
// constant plus the default-on reader/writer pair) stays with the feature it belongs to.
//
// KILL-SWITCH POLARITY (convention, both features follow it): default ENABLED. Only an explicitly stored
// '0' disables, so a flag that was never written works out of the box on a fresh deploy.

function avesmapsAppSettingEnsureTable(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS app_setting (
            setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
            setting_value VARCHAR(255) NOT NULL,
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
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
