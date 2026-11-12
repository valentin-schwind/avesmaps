<#
.SYNOPSIS
    Builds the raster tile pyramid of a map series from its authoritative source raster.

.DESCRIPTION
    Source rasters are authoritative data and live outside the repository. Tiles are derived data
    and are always reproducible from the source (chapter 9.63), so this script is the recipe, not
    the archive.

    The source square is mapped onto the Web Mercator square by assigning the corner coordinates -
    the same derived render projection the vector tiles use (ADR-0003). Raster and vector therefore
    share one tile grid. No resampling happens in that step; only gdal2tiles downsamples.

    Nothing here touches the map coordinate space: the pixel size of a source raster is a rendering
    property, never part of aventuria-v1 (chapter 5.6).

    Which series exist, how they are delivered and where they legally come from is answered by the
    series catalog in the repository, not by this script. It is read here, never written.

    What is delivered (ADR-0008):

        tiles\<domain>\<series>\<revision>\<z>\<x>\<y>.webp    one pyramid; not one byte changes under it
        tiles\<domain>\<series>\current.json                  which revision is delivered

    The revision is the first 12 hex digits of the SHA-256 of the pyramid's manifest
    (tile-manifest.ps1). The same content gives the same revision, so rebuilding an unchanged source
    changes nothing, and a directory proves its own integrity by its name.

    The steps; the intermediates are reused as long as the source is unchanged:

        1. georeference     source -> work\<domain>\<series>\<series>-render.tif    (gdal_translate)
        2. tile losslessly  -> work\<domain>\<series>\pyramid-png\<z>\<x>\<y>.png   (gdal2tiles)
        3. encode once      -> WebP, quality 80 (encode-tile-pyramid.py)
        4. name the pyramid by its manifest hash, then replace current.json atomically
        5. keep the delivered and the previous revision, remove older ones

    🪤 Step 2 stays PNG on purpose. gdal2tiles builds every overview level from the tiles it has
    just written; writing WebP there would build each level from already lossy children, six
    times over.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/build-map-tiles.ps1 -Series original
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Series,

    [string]$MapDomain = "aventuria",
    [string]$DataRoot = "C:\avesmaps3d-data",
    [string]$GisRoot = "C:\tools\gis",
    [int]$MaxZoom = 0,          # 0 = build up to the native level
    # WebP quality. 80 is the measured choice for all three series, `old` included (WI-0006,
    # ADR-0008, operator decision 2026-09-23).
    [int]$Quality = 80,
    # Rebuild the intermediates (georeferenced raster, lossless pyramid) although the source is unchanged.
    [switch]$Force,
    # Refresh the provenance of the delivered pyramid, for instance after the catalog gained its
    # provenance. Touches no tile.
    [switch]$ManifestOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$catalogPath = Join-Path $repositoryRoot "config\map-series\$MapDomain.json"
if (-not (Test-Path $catalogPath)) {
    throw "no series catalog for map domain '$MapDomain' at $catalogPath";
}
$catalog = Get-Content $catalogPath -Raw -Encoding UTF8 | ConvertFrom-Json
$seriesEntry = $catalog.series | Where-Object { $_.id -eq $Series }
if (-not $seriesEntry) {
    throw "unknown series '$Series'; the catalog knows: $(($catalog.series.id) -join ', ')";
}
$TileSize = [int]$seriesEntry.tileSize

$sourceDirectory = Join-Path $DataRoot "map-sources\$MapDomain\$Series"
$seriesRoot = Join-Path $DataRoot "tiles\$MapDomain\$Series"
$pointerPath = Join-Path $seriesRoot "current.json"
$workDirectory = Join-Path $DataRoot "work\$MapDomain\$Series"
$losslessPyramid = Join-Path $workDirectory "pyramid-png"
$losslessStamp = Join-Path $workDirectory "pyramid-png.json"
$incoming = Join-Path $workDirectory "webp-incoming"
$manifestPath = Join-Path $sourceDirectory "manifest.json"
$revisionPattern = "^[0-9a-f]{12}$"
$utf8 = New-Object System.Text.UTF8Encoding $false

$env:PATH = "$GisRoot\Library\bin;$GisRoot\Scripts;$env:PATH"
# Without these, every run warns about missing tile-matrix and projection definitions.
$env:GDAL_DATA = Join-Path $GisRoot "Library\share\gdal"
$env:PROJ_LIB = Join-Path $GisRoot "Library\share\proj"
$python = Join-Path $GisRoot "python.exe"
$gdalTranslate = Join-Path $GisRoot "Library\bin\gdal_translate.exe"
$gdalInfo = Join-Path $GisRoot "Library\bin\gdalinfo.exe"

$sources = @(Get-ChildItem $sourceDirectory -File | Where-Object { $_.Extension -match "^\.(png|tif|tiff|webp|jpg|jpeg)$" })
if ($sources.Count -ne 1) {
    throw "expected exactly one source raster in $sourceDirectory, found $($sources.Count)";
}
$source = $sources[0]

# Provenance of the source (chapter 5.5), copied from the catalog so the pyramid on disk carries
# the same legal statement as the repository. An empty value is a visible gap, not a default.
$catalogFields = [ordered]@{
    variant             = $seriesEntry.variant
    author              = $seriesEntry.author
    origin              = $seriesEntry.origin
    derivation          = $seriesEntry.derivation
    sourceCreated       = $seriesEntry.sourceCreated
    license             = $catalog.license.name
    licenseUri          = $catalog.license.uri
    permission          = $seriesEntry.permission.statement
    permissionGrantedBy = $seriesEntry.permission.grantedBy
    permissionForm      = $seriesEntry.permission.form
    derivationStatus    = $seriesEntry.derivationStatus
    attribution         = $seriesEntry.attribution
}

if ($ManifestOnly) {
    # The tiles are untouched, so their facts stay as the build recorded them; only what comes
    # from the catalog is refreshed.
    if (-not (Test-Path $manifestPath)) {
        throw "$manifestPath does not exist; build the pyramid before refreshing its provenance";
    }
    $existing = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $manifest = [ordered]@{}
    foreach ($property in $existing.PSObject.Properties) {
        $manifest[$property.Name] = $property.Value
    }
    foreach ($key in $catalogFields.Keys) {
        $manifest[$key] = $catalogFields[$key]
    }
    Write-Host "provenance only, tiles untouched"
} else {
    # Size and band layout of the source, read from the file instead of assumed.
    $info = & $gdalInfo -norat -nomd $source.FullName
    $sizeLine = ($info | Select-String "^Size is").ToString()
    if ($sizeLine -notmatch "Size is (\d+), (\d+)") {
        throw "could not read the raster size from gdalinfo";
    }
    $width = [int]$Matches[1]
    $height = [int]$Matches[2]
    if ($width -ne $height) {
        Write-Warning "source is not square ($width x $height); the domain square is mapped to the longer side";
    }

    # Native zoom: the level at which one source pixel is one tile pixel. Above it the renderer
    # upscales, exactly like the legacy map did above its own native level.
    $extent = [Math]::Max($width, $height)
    $nativeZoom = [int][Math]::Floor([Math]::Log($extent / $TileSize, 2))
    # A source that does not match the catalog is a swapped or rescaled file, not a build option.
    if ($nativeZoom -ne [int]$seriesEntry.maxNativeZoom) {
        throw "source resolution $extent gives native zoom $nativeZoom, the catalog expects $($seriesEntry.maxNativeZoom)";
    }
    $buildZoom = if ($MaxZoom -gt 0) { [Math]::Min($MaxZoom, $nativeZoom) } else { $nativeZoom }

    Write-Host "series      $Series"
    Write-Host "source      $($source.Name) ($width x $height)"
    Write-Host "tile size   $TileSize"
    Write-Host "zoom        0 to $buildZoom (native $nativeZoom)"
    Write-Host "target      $seriesRoot"

    $sourceSha256 = (Get-FileHash $source.FullName -Algorithm SHA256).Hash
    # 🪤 The lossless pyramid is reused only for exactly this source and this range. A swapped
    # source file must never hide behind an intermediate built from its predecessor.
    $stamp = [ordered]@{ sourceSha256 = $sourceSha256; tileSize = $TileSize; zoom = "0-$buildZoom" } | ConvertTo-Json -Compress
    $reuse = (-not $Force) -and (Test-Path $losslessPyramid) -and (Test-Path $losslessStamp) -and
        ((Get-Content $losslessStamp -Raw -Encoding UTF8).Trim() -eq $stamp)

    if ($reuse) {
        Write-Host "reuse       $losslessPyramid"
    } else {
        New-Item -ItemType Directory -Force -Path $workDirectory | Out-Null
        foreach ($stale in @($losslessStamp, $losslessPyramid)) {
            if (Test-Path $stale) {
                Remove-Item -Recurse -Force $stale
            }
        }
        $georeferenced = Join-Path $workDirectory "$Series-render.tif"

        # Half the Web Mercator world in metres; the derived render projection maps the domain square
        # onto exactly that extent (packages/shared/src/render-projection.ts).
        $half = 20037508.342789244

        Write-Host "georeference ..."
        & $gdalTranslate -q -of GTiff `
            -a_srs EPSG:3857 `
            -a_ullr (-$half) $half $half (-$half) `
            -co TILED=YES -co COMPRESS=DEFLATE -co BIGTIFF=YES -co NUM_THREADS=ALL_CPUS `
            $source.FullName $georeferenced
        if ($LASTEXITCODE -ne 0) {
            throw "gdal_translate failed";
        }

        Write-Host "tiles ..."
        & $python (Join-Path $GisRoot "Scripts\gdal2tiles.py") `
            --xyz --profile=mercator --resampling=average `
            --tilesize=$TileSize --zoom="0-$buildZoom" `
            --processes=4 --webviewer=none `
            $georeferenced $losslessPyramid
        if ($LASTEXITCODE -ne 0) {
            throw "gdal2tiles failed";
        }
        [System.IO.File]::WriteAllText($losslessStamp, $stamp, $utf8)
    }

    if (Test-Path $incoming) {
        # Left over from an interrupted run. It was never named, so nothing can point at it.
        Remove-Item -Recurse -Force $incoming
    }
    Write-Host "encode      WebP q$Quality ..."
    & $python (Join-Path $PSScriptRoot "encode-tile-pyramid.py") --source $losslessPyramid --target $incoming --quality $Quality
    if ($LASTEXITCODE -ne 0) {
        throw "encoding failed";
    }

    $fingerprint = & (Join-Path $PSScriptRoot "tile-manifest.ps1") -Path $incoming `
        -OutputPath (Join-Path $workDirectory "webp-incoming.manifest.txt") -PassThru
    $revision = $fingerprint.Revision
    $revisionDirectory = Join-Path $seriesRoot $revision
    Move-Item -Force (Join-Path $workDirectory "webp-incoming.manifest.txt") (Join-Path $workDirectory "$revision.manifest.txt")

    New-Item -ItemType Directory -Force -Path $seriesRoot | Out-Null
    if (Test-Path $revisionDirectory) {
        # Same manifest hash, same bytes: this revision is already there exactly as built.
        Remove-Item -Recurse -Force $incoming
        Write-Host "unchanged   revision $revision is already built"
    } else {
        # Same volume, so this is a rename: the delivered tree only ever gains complete pyramids.
        Move-Item $incoming $revisionDirectory
    }

    # The pointer is replaced, never edited: a reader sees the old file or the new one, never half.
    $previous = $null
    if (Test-Path $pointerPath) {
        $previous = [string](Get-Content $pointerPath -Raw -Encoding UTF8 | ConvertFrom-Json).revision
    }
    $pointer = [ordered]@{
        schemaVersion = 1
        series        = $Series
        revision      = $revision
        # The full fingerprint, so the delivered revision can be checked against the build in one call.
        manifest      = $fingerprint.Sha256
        format        = "webp"
        tileSize      = $TileSize
        maxNativeZoom = $buildZoom
    }
    $pointerTemporary = "$pointerPath.tmp"
    [System.IO.File]::WriteAllText($pointerTemporary, ($pointer | ConvertTo-Json -Compress) + "`n", $utf8)
    if (Test-Path $pointerPath) {
        # 💣 Not `$null`: PowerShell hands it to a .NET string parameter as "", and Replace then
        # fails on an empty backup path - after the new pointer was written, before it was switched.
        [System.IO.File]::Replace($pointerTemporary, $pointerPath, [NullString]::Value)
    } else {
        [System.IO.File]::Move($pointerTemporary, $pointerPath)
    }
    Write-Host "pointer     $pointerPath -> $revision$(if ($previous -and $previous -ne $revision) { " (was $previous)" })"

    # 🪤 Keep the delivered revision AND the previous one: an open tab still holds the old pointer,
    # and removing its directory would blank that map tile by tile (ADR-0008, the U33a trap). Only a
    # switch moves the window; an unchanged rebuild must not push the previous revision out.
    if ($previous -and $previous -ne $revision) {
        $older = @(Get-ChildItem $seriesRoot -Directory |
            Where-Object { $_.Name -match $revisionPattern -and $_.Name -ne $revision -and $_.Name -ne $previous })
        foreach ($directory in $older) {
            Write-Host "remove      revision $($directory.Name), older than the previous one"
            Remove-Item -Recurse -Force $directory.FullName
        }
    }

    $manifest = [ordered]@{
        schemaVersion  = 2
        mapDomain      = $MapDomain
        series         = $Series
        sourceFile     = $source.Name
        sourceBytes    = $source.Length
        sourceSha256   = $sourceSha256
        sourcePixels   = "$width x $height"
        coverage       = "full domain 0..1024"
    }
    foreach ($key in $catalogFields.Keys) {
        $manifest[$key] = $catalogFields[$key]
    }
    $manifest["status"] = if ($buildZoom -lt $nativeZoom) { "PARTIAL" } else { "IMPORTED" }
    $manifest["renderPath"] = "derived render projection (ADR-0003)"
    $manifest["tileScheme"] = "xyz, EPSG:3857, tileSize $TileSize, zoom 0-$buildZoom"
    $manifest["tileFormat"] = "WebP lossy, quality $Quality (ADR-0008)"
    $manifest["revision"] = $revision
    $manifest["tileDirectory"] = $revisionDirectory
    $manifest["tileCount"] = $fingerprint.Files
    $manifest["tileBytes"] = $fingerprint.Bytes
    $manifest["builtAt"] = (Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz")
}

[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 4), $utf8)

Write-Host ""
Write-Host "done: revision $($manifest.revision), $($manifest.tileCount) tiles, $([Math]::Round($manifest.tileBytes / 1MB, 1)) MB"
Write-Host "provenance: $manifestPath"
# The same check the application uses, so the build says out loud what may not be published yet.
# An established gap is reported as such: it is not waiting to be filled in.
$missing = @(@("author", "origin", "derivation", "permission", "attribution") |
    Where-Object { [string]::IsNullOrWhiteSpace($manifest[$_]) })
if ($manifest.derivationStatus -eq "UNDOCUMENTED") {
    $missing = @($missing | Where-Object { $_ -ne "derivation" })
    Write-Warning "series '$Series': how it was produced is documented as not establishable; publishing it is decided separately (chapter 5.5)";
}
if ($missing.Count -gt 0) {
    Write-Warning "series '$Series' may not be published: $($missing -join ', ') missing in $catalogPath (chapter 5.5)";
}
