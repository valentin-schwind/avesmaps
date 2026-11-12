<#
.SYNOPSIS
    Writes a reproducible manifest of a raster tile pyramid and prints its fingerprint.

.DESCRIPTION
    Derived data lives outside the repository, so a pyramid that travels to another machine needs a
    way to prove it arrived unchanged. The manifest lists every file with its SHA-256; hashing the
    manifest reduces the whole pyramid to ONE value that both sides can compare.

    The first 12 hex digits of that value are the pyramid's REVISION, and the revision is the name
    of its directory (ADR-0008). A delivered pyramid therefore checks itself: with -Series this
    script hashes the revision that current.json points to and fails if the content no longer
    matches the name.

    The format is chosen so that Windows and Linux produce byte-identical output:

        <sha256 lowercase><two spaces><path relative to the pyramid, with forward slashes>

    sorted ORDINALLY by path, LF line endings, UTF-8 without BOM. That is exactly what this prints
    on Linux, and its first 12 characters must equal the directory name:

        cd <series>/<revision> && find . -type f -printf '%P\n' | LC_ALL=C sort | xargs -d '\n' sha256sum | sed 's/ \*/  /' | sha256sum

    🪤 Three details decide whether the two sides agree, and each of them silently produces a
    different fingerprint: PowerShell sorts by culture unless told otherwise (ordinal here), Windows
    paths use backslashes (rewritten), and Set-Content would add a BOM and CRLF (bytes are written
    directly instead). And `sha256sum` under Git Bash writes `<hash> *<path>` - the `sed` above.

    Read-only: nothing is copied, moved or written inside the pyramid.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/tile-manifest.ps1 -Series original
#>
[CmdletBinding()]
param(
    [string]$TileRoot = "C:\avesmaps3d-data\tiles\aventuria",
    # The series whose DELIVERED revision is hashed: the one its current.json points to.
    [string]$Series,
    # Or any pyramid directory, for instance one that has not been given its revision yet.
    [string]$Path,
    [string]$OutputPath,
    # Return files, bytes, fingerprint and revision as an object, for the build script.
    [switch]$PassThru
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$expectedRevision = $null
if ($Path) {
    $pyramid = $Path
} elseif ($Series) {
    $pointerPath = Join-Path $TileRoot "$Series\current.json"
    if (-not (Test-Path $pointerPath)) {
        throw "no current.json for '$Series' under $TileRoot; build the pyramid with scripts/dev/build-map-tiles.ps1"
    }
    $expectedRevision = [string](Get-Content $pointerPath -Raw -Encoding UTF8 | ConvertFrom-Json).revision
    $pyramid = Join-Path $TileRoot "$Series\$expectedRevision"
} else {
    throw "pass -Series (the delivered revision) or -Path (any pyramid directory)"
}
if (-not (Test-Path $pyramid)) {
    throw "pyramid not found: $pyramid"
}
if (-not $OutputPath) {
    # Next to the series, not inside it: the delivered tree holds pyramids and their pointer, nothing else.
    $OutputPath = if ($expectedRevision) {
        Join-Path $TileRoot "$Series-$expectedRevision.manifest.txt"
    } else {
        "$((Resolve-Path $pyramid).Path.TrimEnd('\')).manifest.txt"
    }
}

$prefixLength = (Resolve-Path $pyramid).Path.TrimEnd("\").Length + 1
$files = @(Get-ChildItem -Path $pyramid -Recurse -File)

$relativePaths = New-Object string[] $files.Count
for ($i = 0; $i -lt $files.Count; $i++) {
    $relativePaths[$i] = $files[$i].FullName.Substring($prefixLength).Replace("\", "/")
}
# Ordinal, not culture-aware: a culture sort orders "10/" and "2/" differently on another machine.
[Array]::Sort($relativePaths, [StringComparer]::Ordinal)

$totalBytes = 0L
$builder = New-Object System.Text.StringBuilder
foreach ($relative in $relativePaths) {
    $full = Join-Path $pyramid ($relative.Replace("/", "\"))
    $totalBytes += (Get-Item -LiteralPath $full).Length
    $hash = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
    [void]$builder.Append($hash).Append("  ").Append($relative).Append("`n")
}

$bytes = [System.Text.Encoding]::UTF8.GetBytes($builder.ToString())
[System.IO.File]::WriteAllBytes($OutputPath, $bytes)

$manifestHash = [System.BitConverter]::ToString(
    [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
).Replace("-", "").ToLowerInvariant()
$revision = $manifestHash.Substring(0, 12)

Write-Host "pyramid       $pyramid"
Write-Host "files         $($relativePaths.Count)"
Write-Host "bytes         $totalBytes"
Write-Host "manifest      $OutputPath"
Write-Host "manifest-sha  $manifestHash"
Write-Host "revision      $revision"

if ($expectedRevision -and $revision -ne $expectedRevision) {
    throw "the delivered revision '$expectedRevision' hashes to '$revision': its content changed under its name"
}

if ($PassThru) {
    [pscustomobject]@{
        Files        = $relativePaths.Count
        Bytes        = $totalBytes
        ManifestPath = $OutputPath
        Sha256       = $manifestHash
        Revision     = $revision
    }
}
