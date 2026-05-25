param(
    [string]$Root = ".",
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

$resolvedRoot = Resolve-Path $Root
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$phpFiles = Get-ChildItem -Path $resolvedRoot -Recurse -File -Filter "*.php" |
    Where-Object {
        $_.FullName -notmatch "[\\/](\.git|vendor|node_modules)[\\/]"
    }

$changedFiles = New-Object System.Collections.Generic.List[string]
$failedFiles = New-Object System.Collections.Generic.List[string]

foreach ($file in $phpFiles) {
    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF

    if (-not $hasBom) {
        continue
    }

    $relativePath = [System.IO.Path]::GetRelativePath($resolvedRoot, $file.FullName)
    $changedFiles.Add($relativePath)

    if ($CheckOnly) {
        continue
    }

    $content = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
    [System.IO.File]::WriteAllText($file.FullName, $content, $utf8NoBom)
}

foreach ($file in $phpFiles) {
    $relativePath = [System.IO.Path]::GetRelativePath($resolvedRoot, $file.FullName)
    $content = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)

    if (-not $content.StartsWith("<?php")) {
        $failedFiles.Add($relativePath)
    }
}

if ($changedFiles.Count -gt 0) {
    if ($CheckOnly) {
        Write-Host "BOM gefunden:" -ForegroundColor Yellow
    } else {
        Write-Host "BOM entfernt:" -ForegroundColor Yellow
    }

    foreach ($file in $changedFiles) {
        Write-Host "  $file"
    }
}

if ($failedFiles.Count -gt 0) {
    Write-Host "PHP-Dateien beginnen nicht direkt mit <?php:" -ForegroundColor Red
    foreach ($file in $failedFiles) {
        Write-Host "  $file"
    }
    exit 1
}

if ($CheckOnly -and $changedFiles.Count -gt 0) {
    exit 1
}

Write-Host "PHP-Encoding OK: UTF-8 ohne BOM, alle PHP-Dateien beginnen direkt mit <?php." -ForegroundColor Green
