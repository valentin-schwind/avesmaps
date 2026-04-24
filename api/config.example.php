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
];
