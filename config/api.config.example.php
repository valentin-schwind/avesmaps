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
