<?php

declare(strict_types=1);

return [
    'database' => [
        'driver' => 'mysql',
        'host' => '127.0.0.1',
        'port' => 3306,
        'name' => 'avesmaps',
        'charset' => 'utf8mb4',
        'user' => 'avesmaps_user',
        'password' => 'replace-with-a-secret-password',
    ],
    'cors' => [
        'allowed_origins' => [
            'http://localhost:8000',
            'https://valentin-schwind.github.io',
        ],
    ],
    'import_api' => [
        'token' => 'replace-with-a-long-random-import-token',
    ],
    // 💣 SET THIS. Without it the visitor hash runs on the salt shipped in the repository, and a
    // stored hash covers an IP address plus a user agent -- the IPv4 space is small enough to walk
    // in seconds, so a published salt makes the hash reversible. The privacy notice promises it is
    // not. Any long random string does; `php -r "echo bin2hex(random_bytes(32));"` produces one.
    //
    // ⚠️ Changing it counts every returning visitor as new EXACTLY ONCE -- the daily numbers jump
    // on that day and are normal again afterwards. That is the price of setting it, and it is
    // cheaper the earlier it is paid. Whether it IS set is reported by the visitor-metrics answer
    // as `salt_configured` (behind the `edit` capability, so no visitor learns it).
    'analytics' => [
        'visitor_salt' => 'replace-with-a-long-random-visitor-salt',
    ],
    'discord' => [
        'public_key' => 'replace-with-the-application-public-key',
        'application_id' => 'replace-with-the-application-id',
        'bot_token' => 'replace-with-the-bot-token-SECRET',
        'app_token' => 'replace-with-a-long-random-app-token-SECRET',
        'bug_channel_id' => 'replace-with-the-bug-channel-id',
        'idea_channel_id' => 'replace-with-the-idea-channel-id',
        'faq_channel_id' => 'replace-with-the-faq-channel-id',
        'report_channel_id' => 'replace-with-the-report-channel-id',
        'feature_channel_id' => 'replace-with-the-new-feature-channel-id',
        // Optional: set guild_id (your server id) for instant command registration.
        'guild_id' => '',
    ],
];
