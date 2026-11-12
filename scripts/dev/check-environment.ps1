<#
.SYNOPSIS
    Read-only check of the local Avesmaps3D development environment on native Windows.

.DESCRIPTION
    Verifies the toolchain required by planning chapters 2.9 and 11.11 (Git, Node.js LTS, npm,
    Python, PostgreSQL, PostGIS, Martin, GDAL, PROJ) and repository invariants that affect agents.
    The script changes nothing. Exit code 0 means all required checks passed, 1 means at least one failed.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/check-environment.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$results = New-Object System.Collections.Generic.List[object]

# A shell started after an installation sees the persisted PATH, this process may not.
# Checking the persisted value avoids false failures right after install-toolchain.ps1.
$persistedPath = @(
    [Environment]::GetEnvironmentVariable("PATH", "Machine"),
    [Environment]::GetEnvironmentVariable("PATH", "User")
) -join ";"
$env:PATH = ($env:PATH.TrimEnd(";") + ";" + $persistedPath)

function Add-Result([string]$Check, [string]$Status, [string]$Detail) {
    $results.Add([pscustomobject]@{ Check = $Check; Status = $Status; Detail = $Detail });
}

# Returns the tool path and whether it is reachable via PATH. Fallback locations only detect
# installations that exist but are not usable by project scripts yet.
function Find-Tool([string]$Name, [string[]]$FallbackPaths = @()) {
    $command = Get-Command $Name -CommandType Application, ExternalScript -ErrorAction SilentlyContinue |
        Select-Object -First 1;
    if ($command) {
        return [pscustomobject]@{ Path = $command.Source; IsOnPath = $true };
    }
    foreach ($candidate in $FallbackPaths) {
        $hit = Get-ChildItem -Path $candidate -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1;
        if ($hit) {
            return [pscustomobject]@{ Path = $hit.FullName; IsOnPath = $false };
        }
    }
    return $null;
}

function Get-FirstLine([string]$Path, [string[]]$Arguments) {
    $output = & $Path @Arguments 2>$null;
    if ($null -eq $output) {
        return "";
    }
    return (@($output)[0]).ToString().Trim();
}

function Test-RequiredTool([string]$Check, [string]$Name, [string[]]$VersionArguments, [string[]]$FallbackPaths = @()) {
    $tool = Find-Tool $Name $FallbackPaths;
    if (-not $tool) {
        Add-Result $Check "FAIL" "not installed";
        return $null;
    }
    if (-not $tool.IsOnPath) {
        Add-Result $Check "FAIL" "installed but not on PATH: $($tool.Path)";
        return $null;
    }
    Add-Result $Check "OK" (Get-FirstLine $tool.Path $VersionArguments);
    return $tool;
}

$postgresBin = "C:\Program Files\PostgreSQL\*\bin";
$osgeoBin = "C:\OSGeo4W\bin";

Test-RequiredTool "git" "git" @("--version") | Out-Null;

$node = Find-Tool "node";
if (-not $node) {
    Add-Result "node" "FAIL" "not installed";
} else {
    $nodeVersion = Get-FirstLine $node.Path @("--version");
    # process.release.lts holds the LTS codename and is undefined on Current releases.
    $ltsName = Get-FirstLine $node.Path @("-p", "process.release.lts || ''");
    if ($ltsName) {
        Add-Result "node" "OK" "$nodeVersion (LTS $ltsName)";
    } else {
        Add-Result "node" "FAIL" "$nodeVersion is not an LTS release";
    }
}

Test-RequiredTool "npm" "npm" @("--version") | Out-Null;

$python = Find-Tool "python";
if (-not $python) {
    Add-Result "python" "FAIL" "not installed";
} else {
    $pythonVersion = Get-FirstLine $python.Path @("--version");
    if ($pythonVersion -match "^Python 3\.") {
        Add-Result "python" "OK" $pythonVersion;
    } else {
        Add-Result "python" "FAIL" "unexpected version: $pythonVersion";
    }
}

Test-RequiredTool "psql" "psql" @("--version") @("$postgresBin\psql.exe") | Out-Null;

$pgConfig = Find-Tool "pg_config" @("$postgresBin\pg_config.exe");
if (-not $pgConfig) {
    Add-Result "postgis" "FAIL" "PostgreSQL server tools (pg_config) not found"
    Add-Result "pgrouting" "WARN" "not checked without pg_config (optional, routing gate only)"
} else {
    $shareDirectory = Get-FirstLine $pgConfig.Path @("--sharedir");
    $extensionDirectory = Join-Path $shareDirectory "extension";
    $postgisControl = Join-Path $extensionDirectory "postgis.control";
    if (Test-Path $postgisControl) {
        $defaultVersion = (Select-String -Path $postgisControl -Pattern "default_version").Line;
        Add-Result "postgis" "OK" $defaultVersion.Trim();
    } else {
        Add-Result "postgis" "FAIL" "postgis extension not installed in $extensionDirectory";
    }
    if (Test-Path (Join-Path $extensionDirectory "pgrouting.control")) {
        Add-Result "pgrouting" "OK" "extension available";
    } else {
        Add-Result "pgrouting" "WARN" "not installed (optional, needed only for the hybrid routing gate)";
    }
}

Test-RequiredTool "martin" "martin" @("--version") @("$env:USERPROFILE\.cargo\bin\martin.exe") | Out-Null;
Test-RequiredTool "gdal" "gdalinfo" @("--version") @("$osgeoBin\gdalinfo.exe") | Out-Null;

$proj = Find-Tool "proj" @("$osgeoBin\proj.exe");
if (-not $proj) {
    Add-Result "proj" "FAIL" "not installed";
} elseif (-not $proj.IsOnPath) {
    Add-Result "proj" "FAIL" "installed but not on PATH: $($proj.Path)";
} else {
    # proj prints its release banner to stderr when called without arguments.
    $projBanner = @(cmd /c "proj 2>&1")[0];
    Add-Result "proj" "OK" "$projBanner".Trim();
}

$pgIsReady = Find-Tool "pg_isready" @("$postgresBin\pg_isready.exe");
if (-not $pgIsReady) {
    Add-Result "pg-cluster" "FAIL" "pg_isready not found";
} else {
    $clusterPort = if ($env:PGPORT) { $env:PGPORT } else { "5433" };
    & $pgIsReady.Path --host=127.0.0.1 --port=$clusterPort *> $null;
    if ($LASTEXITCODE -eq 0) {
        Add-Result "pg-cluster" "OK" "accepting connections on 127.0.0.1:$clusterPort";
    } else {
        Add-Result "pg-cluster" "FAIL" "no cluster on 127.0.0.1:$clusterPort (start: scripts/dev/install-toolchain.ps1)";
    }
}

if (Get-Command "wsl.exe" -ErrorAction SilentlyContinue) {
    Add-Result "wsl" "INFO" "present; optional fallback only, not required";
}

if (Test-Path (Join-Path $repositoryRoot ".env")) {
    Add-Result "env-file" "OK" ".env present (git-ignored, local development only)";
} else {
    Add-Result "env-file" "WARN" "no .env (run scripts/dev/install-toolchain.ps1)";
}

# Shared skills are mirrored for Codex (.agents/skills) and Claude Code (.claude/skills).
function Get-SkillSnapshot([string]$Directory) {
    $snapshot = @{};
    if (-not (Test-Path $Directory)) {
        return $snapshot;
    }
    Get-ChildItem -Path $Directory -Recurse -File | ForEach-Object {
        $relativePath = $_.FullName.Substring($Directory.Length).TrimStart("\");
        $snapshot[$relativePath] = ([System.IO.File]::ReadAllText($_.FullName)) -replace "`r`n", "`n";
    };
    return $snapshot;
}

$agentSkills = Get-SkillSnapshot (Join-Path $repositoryRoot ".agents\skills");
$claudeSkills = Get-SkillSnapshot (Join-Path $repositoryRoot ".claude\skills");
$skillDrift = @($agentSkills.Keys + $claudeSkills.Keys | Sort-Object -Unique | Where-Object {
    -not ($agentSkills.ContainsKey($_) -and $claudeSkills.ContainsKey($_) -and $agentSkills[$_] -ceq $claudeSkills[$_])
});
if ($skillDrift.Count -eq 0) {
    Add-Result "skill-mirror" "OK" "$($agentSkills.Count) files identical in .agents/skills and .claude/skills";
} else {
    Add-Result "skill-mirror" "FAIL" ("differs: " + ($skillDrift -join ", "));
}

# Commit-Wächter (WI-0185): der pre-commit-Hook unter scripts/git-hooks muss eingerichtet sein.
$hooksPath = (& git -C $repositoryRoot config --get core.hooksPath) 2>$null;
if ($hooksPath -and ($hooksPath -replace '\\', '/') -match 'scripts/git-hooks$') {
    Add-Result "commit-waechter" "OK" "core.hooksPath = $hooksPath";
} else {
    Add-Result "commit-waechter" "WARN" "not set up (git config core.hooksPath C:/GIT/avesmaps3D/scripts/git-hooks)";
}

$results | Format-Table -AutoSize | Out-String -Width 200 | Write-Host;

$failures = @($results | Where-Object { $_.Status -eq "FAIL" });
if ($failures.Count -gt 0) {
    Write-Host "NOT READY: $($failures.Count) required check(s) failed.";
    exit 1;
}
Write-Host "READY: all required checks passed.";
exit 0;
