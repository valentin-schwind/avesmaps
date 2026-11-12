<#
.SYNOPSIS
    Installs the native Windows development toolchain for Avesmaps3D without administrator rights.

.DESCRIPTION
    Installs PostgreSQL, PostGIS, GDAL/PROJ and Martin into a user-writable root directory,
    initializes a local development cluster and puts the tools on the user PATH.
    The script is idempotent: existing installations are detected and skipped.
    Versions follow project-control/baselines/technology.yaml.

    Nothing here touches staging or production. The cluster listens on localhost only.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/install-toolchain.ps1
#>
[CmdletBinding()]
param(
    [string]$Root = "C:\tools",
    # Authoritative map sources and the derived tile pyramids live outside the repository.
    [string]$DataRoot = "C:/avesmaps3d-data",
    [string]$PostgresPackage = "postgresql-18.6-4-windows-x64-binaries.zip",
    [string]$PostgisBundle = "postgis-bundle-pg18-3.6.2x64",
    [string]$MartinVersion = "martin-v1.16.1",
    [int]$Port = 5433,
    [switch]$SkipCluster
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$downloads = Join-Path $Root "downloads"
$postgresHome = Join-Path $Root "pgsql-18"
$postgresData = Join-Path $Root "pgdata-18"
$martinHome = Join-Path $Root "martin"
$condaRoot = Join-Path $Root "micromamba"
$gisEnv = Join-Path $Root "gis"

New-Item -ItemType Directory -Force -Path $Root, $downloads | Out-Null

function Get-Download([string]$Url, [string]$FileName) {
    $target = Join-Path $downloads $FileName;
    if (Test-Path $target) {
        Write-Host "cached   $FileName";
        return $target;
    }
    Write-Host "download $FileName";
    & curl.exe -sSfL -o $target $Url;
    if ($LASTEXITCODE -ne 0) {
        throw "download failed: $Url";
    }
    return $target;
}

# --- PostgreSQL -------------------------------------------------------------
if (Test-Path (Join-Path $postgresHome "bin\psql.exe")) {
    Write-Host "skip     PostgreSQL (already installed)";
} else {
    $archive = Get-Download "https://get.enterprisedb.com/postgresql/$PostgresPackage" $PostgresPackage;
    $staging = Join-Path $downloads "pg-extract";
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue;
    Expand-Archive -Path $archive -DestinationPath $staging -Force;
    Move-Item (Join-Path $staging "pgsql") $postgresHome;
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue;
    Write-Host "install  PostgreSQL -> $postgresHome";
}

# --- PostGIS ----------------------------------------------------------------
if (Test-Path (Join-Path $postgresHome "share\extension\postgis.control")) {
    Write-Host "skip     PostGIS (already installed)";
} else {
    $bundleFile = "$PostgisBundle.zip";
    $archive = Get-Download "https://download.osgeo.org/postgis/windows/pg18/$bundleFile" $bundleFile;
    $expectedHash = ((Get-Content (Get-Download "https://download.osgeo.org/postgis/windows/pg18/$bundleFile.md5" "$bundleFile.md5")) -split "\s+")[0];
    $actualHash = (Get-FileHash $archive -Algorithm MD5).Hash;
    if ($expectedHash -and $actualHash -ne $expectedHash.ToUpper()) {
        throw "PostGIS bundle checksum mismatch: expected $expectedHash, got $actualHash";
    }
    $staging = Join-Path $downloads "postgis-extract";
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue;
    Expand-Archive -Path $archive -DestinationPath $staging -Force;
    $bundleRoot = Get-ChildItem $staging -Directory | Select-Object -First 1;
    Copy-Item (Join-Path $bundleRoot.FullName "*") $postgresHome -Recurse -Force;
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue;
    Write-Host "install  PostGIS -> $postgresHome";
}

# --- GDAL / PROJ via conda-forge (development tooling only) -----------------
if (Test-Path (Join-Path $gisEnv "Library\bin\gdalinfo.exe")) {
    Write-Host "skip     GDAL/PROJ (already installed)";
} else {
    $micromamba = Join-Path $condaRoot "micromamba.exe";
    if (-not (Test-Path $micromamba)) {
        $binary = Get-Download "https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-win-64.exe" "micromamba-win-64.exe";
        $expectedHash = ((Get-Content (Get-Download "https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-win-64.sha256" "micromamba-win-64.sha256")) -split "\s+")[0];
        $actualHash = (Get-FileHash $binary -Algorithm SHA256).Hash;
        if ($expectedHash -and $actualHash -ne $expectedHash.ToUpper()) {
            throw "micromamba checksum mismatch: expected $expectedHash, got $actualHash";
        }
        New-Item -ItemType Directory -Force -Path $condaRoot | Out-Null;
        Copy-Item $binary $micromamba -Force;
    }
    & $micromamba create --yes --quiet --root-prefix $condaRoot --prefix $gisEnv -c conda-forge gdal proj;
    if ($LASTEXITCODE -ne 0) {
        throw "micromamba could not create the GDAL/PROJ environment";
    }
    Write-Host "install  GDAL/PROJ -> $gisEnv";
}

# --- Martin -----------------------------------------------------------------
if (Test-Path (Join-Path $martinHome "martin.exe")) {
    Write-Host "skip     Martin (already installed)";
} else {
    $archive = Get-Download "https://github.com/maplibre/martin/releases/download/$MartinVersion/martin-x86_64-pc-windows-msvc.zip" "martin-$MartinVersion-windows.zip";
    New-Item -ItemType Directory -Force -Path $martinHome | Out-Null;
    Expand-Archive -Path $archive -DestinationPath $martinHome -Force;
    Write-Host "install  Martin -> $martinHome";
}

# --- User PATH --------------------------------------------------------------
$binDirectories = @(
    (Join-Path $postgresHome "bin"),
    (Join-Path $gisEnv "Library\bin"),
    $martinHome
);
$userPath = [Environment]::GetEnvironmentVariable("PATH", "User");
$currentEntries = @($userPath -split ";" | Where-Object { $_ });
$added = @($binDirectories | Where-Object { $currentEntries -notcontains $_ });
if ($added.Count -gt 0) {
    [Environment]::SetEnvironmentVariable("PATH", (($currentEntries + $added) -join ";"), "User");
    Write-Host "path     added: $($added -join ', ')";
} else {
    Write-Host "skip     PATH (already contains all tool directories)";
}
$env:PATH = "$($binDirectories -join ';');$env:PATH";

# --- Development cluster ----------------------------------------------------
if ($SkipCluster) {
    Write-Host "skip     cluster (requested)";
    return;
}

$passwordFile = Join-Path $Root "pgsql-18-superuser.txt";
if (-not (Test-Path $postgresData)) {
    if (-not (Test-Path $passwordFile)) {
        # Local development credential. Never used for staging or production (chapter 10.151).
        $bytes = New-Object byte[] 24;
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes);
        [System.Convert]::ToBase64String($bytes).Replace("/", "_").Replace("+", "-") | Set-Content -Path $passwordFile -Encoding ascii -NoNewline;
    }
    & (Join-Path $postgresHome "bin\initdb.exe") --pgdata=$postgresData --username=postgres --auth-host=scram-sha-256 --auth-local=scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale=C | Out-Null;
    if ($LASTEXITCODE -ne 0) {
        throw "initdb failed";
    }
    Write-Host "install  cluster -> $postgresData";
} else {
    Write-Host "skip     cluster (already initialized)";
}

$logFile = Join-Path $Root "pgsql-18.log";
$pgIsReady = Join-Path $postgresHome "bin\pg_isready.exe";
& $pgIsReady --host=localhost --port=$Port *> $null;
if ($LASTEXITCODE -ne 0) {
    # pg_ctl keeps the console attached on Windows, so start it detached and poll instead.
    Start-Process -FilePath (Join-Path $postgresHome "bin\pg_ctl.exe") `
        -ArgumentList "--pgdata=`"$postgresData`"", "--log=`"$logFile`"", "--options=`"-p $Port -c listen_addresses=localhost`"", "start" `
        -NoNewWindow | Out-Null;
    $deadline = (Get-Date).AddSeconds(60);
    do {
        Start-Sleep -Seconds 2;
        & $pgIsReady --host=localhost --port=$Port *> $null;
        $ready = ($LASTEXITCODE -eq 0);
    } while (-not $ready -and (Get-Date) -lt $deadline);
    if (-not $ready) {
        throw "cluster did not start, see $logFile";
    }
    Write-Host "start    cluster on port $Port";
} else {
    Write-Host "running  cluster on port $Port";
}

# --- Development database ---------------------------------------------------
# Local development credentials only. Staging and production use their own secrets (chapter 10.151).
$appPasswordFile = Join-Path $Root "pgsql-18-app.txt";
if (-not (Test-Path $appPasswordFile)) {
    $bytes = New-Object byte[] 24;
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes);
    [System.Convert]::ToBase64String($bytes).Replace("/", "_").Replace("+", "-") | Set-Content -Path $appPasswordFile -Encoding ascii -NoNewline;
}
$appPassword = (Get-Content $appPasswordFile -Raw).Trim();
$env:PGPASSWORD = (Get-Content $passwordFile -Raw).Trim();
$psql = Join-Path $postgresHome "bin\psql.exe";

$roleExists = "$(& $psql --host=localhost --port=$Port --username=postgres --dbname=postgres --tuples-only --no-align --command="SELECT 1 FROM pg_roles WHERE rolname = 'avesmaps3d'")".Trim();
if ($roleExists -ne "1") {
    & $psql --host=localhost --port=$Port --username=postgres --dbname=postgres --command="CREATE ROLE avesmaps3d LOGIN PASSWORD '$appPassword'" | Out-Null;
    Write-Host "install  role avesmaps3d";
} else {
    & $psql --host=localhost --port=$Port --username=postgres --dbname=postgres --command="ALTER ROLE avesmaps3d LOGIN PASSWORD '$appPassword'" | Out-Null;
    Write-Host "skip     role avesmaps3d (password refreshed)";
}

foreach ($database in @("avesmaps3d_dev", "avesmaps3d_test")) {
    $databaseExists = "$(& $psql --host=localhost --port=$Port --username=postgres --dbname=postgres --tuples-only --no-align --command="SELECT 1 FROM pg_database WHERE datname = '$database'")".Trim();
    if ($databaseExists -ne "1") {
        & $psql --host=localhost --port=$Port --username=postgres --dbname=postgres --command="CREATE DATABASE $database OWNER avesmaps3d" | Out-Null;
        Write-Host "install  database $database";
    } else {
        Write-Host "skip     database $database (exists)";
    }
    & $psql --host=localhost --port=$Port --username=postgres --dbname=$database --command="CREATE EXTENSION IF NOT EXISTS postgis" | Out-Null;
}
Remove-Item Env:PGPASSWORD;

$envFile = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path ".env";
if (-not (Test-Path $envFile)) {
    @(
        "# Local development only. Not committed (see .gitignore), never valid for staging or production.",
        "DATABASE_URL=postgres://avesmaps3d:$appPassword@localhost:$Port/avesmaps3d_dev",
        "TEST_DATABASE_URL=postgres://avesmaps3d:$appPassword@localhost:$Port/avesmaps3d_test",
        "PORT=3000",
        "TILE_ROOT=$DataRoot/tiles/aventuria"
    ) | Set-Content -Path $envFile -Encoding ascii;
    Write-Host "install  .env (local development connection strings)";
} else {
    Write-Host "skip     .env (exists, not overwritten)";
}

Write-Host "";
Write-Host "Done. Credential files: $passwordFile, $appPasswordFile";
Write-Host "Open a new shell so the updated PATH applies, then run scripts/dev/check-environment.ps1.";
