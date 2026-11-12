<#
.SYNOPSIS
    Starts, stops or inspects the local Avesmaps3D development stack on native Windows.

.DESCRIPTION
    One command brings up everything needed to develop and look at the map locally: the
    development PostgreSQL cluster (5433), Fastify (3000), Martin (3010), Vite (5173) and the worker of the job
    queue (no port; WI-0127 SYS-14: it runs the syncs started in the administration and the media jobs). It is
    idempotent - a service that already listens on its port and belongs to this repository is left
    alone, never started twice.

    Starting is not enough to call it working, so the script finishes by asking three questions
    that the browser would ask: does /health/ready answer, does a REAL raster tile come back as an
    image, and does a vector tile come back as protobuf - both through the Vite proxy, because that
    is the path the application actually takes.

    Nothing here is a Windows service and nothing starts with the machine. The processes outlive the
    shell that started them (otherwise the stack would die with this command), and `-Action stop`
    ends them again.

    Raster pyramids live OUTSIDE the repository under $TileRoot. They are read, never copied and
    never committed.

    A second Vite on $LanPort (5174) is bound to the Tailscale address only, so the operator reaches the SAME local
    state from the PC and the phone under one address (Betreiber 2026-10-12: „das problem ist dass 1000 ports offen sind
    und ich nicht kapier was eigentlich gerade gilt“). It is started, stopped and restarted with the stack - a hand-started
    instance ran stale for days before. 🔴 Never `--host` without an address: the operator travels, and a dev server on
    every interface would be open on foreign networks. Without a Tailscale address the instance is skipped.

    A third Vite on 127.0.0.1:$HttpsPort (5180) answers on HTTPS under the machine's Tailscale name (WI-0180 §11; Betreiber
    2026-10-16: „richte das lokale HTTPS dauerhaft ein“, then „Eigene Instanz“): `tailscale serve` puts
    https://<name>.<tailnet>.ts.net/ (port 443, tailnet only, certificate from Tailscale) in front of it. Stage and Production probe
    this address to show „Lokal“ in the environment menu, and a page on HTTPS is what a browser allows them to reach. The name is
    read from `tailscale status` at every start and never written to the repository. `-Action stop` takes the HTTPS entry down
    again, so a stopped stack does not answer with 502 and look reachable.
    💣 Not in front of $LanPort: `tailscale serve` cannot reach this machine's OWN Tailscale address (measured 2026-10-16: 502
    after 21 s), only loopback. So the HTTPS instance listens on 127.0.0.1, which is closed to every network by itself.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/start-local-stack.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/start-local-stack.ps1 -Action status

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/start-local-stack.ps1 -Action stop
#>
[CmdletBinding()]
param(
    [ValidateSet("start", "stop", "status")]
    [string]$Action = "start",
    [int]$DatabasePort = 5433,
    [int]$ServerPort = 3000,
    [int]$MartinPort = 3010,
    [int]$WebPort = 5173,
    [int]$LanPort = 5174,
    # Loopback only, behind `tailscale serve` on 443 (WI-0180 §11).
    [int]$HttpsPort = 5180,
    # Empty: the first Tailscale address of this machine (100.64.0.0/10).
    [string]$LanHost = "",
    [string]$TileRoot = "C:\avesmaps3d-data\tiles\aventuria",
    [string]$MediaRoot = "C:\avesmaps3d-data\media",
    [string]$Series = "original",
    # The cluster is shared with tests and other work, so stopping it is opt-in.
    [switch]$IncludeDatabase
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
# Logs and PID files are volatile state, so they stay out of the repository (chapter 10.150).
$stateDirectory = "C:\avesmaps3d-data\dev-stack"
$postgresHome = "C:\tools\pgsql-18"
$postgresData = "C:\tools\pgdata-18"

$failures = New-Object System.Collections.Generic.List[string]
function Add-Failure([string]$Text) { $failures.Add($Text) }
function Write-Line([string]$Status, [string]$Name, [string]$Detail) {
    Write-Host ("{0,-8} {1,-9} {2}" -f $Status, $Name, $Detail)
}

function Get-LanHost() {
    if ($LanHost -ne "") { return $LanHost }
    $address = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -match '^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.' } |
        Select-Object -First 1
    if ($address) { return [string]$address.IPAddress }
    return ""
}
$lanAddress = Get-LanHost

<#
    The Tailscale CLI and the machine's MagicDNS name (`<name>.<tailnet>.ts.net`, without the trailing dot), or "" when
    Tailscale is missing, logged out or has no HTTPS certificates. Read at every run, never stored.
#>
function Get-TailscaleCli() {
    $command = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $default = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
    if (Test-Path $default) { return $default }
    return ""
}
function Get-TailscaleName() {
    $cli = Get-TailscaleCli
    if ($cli -eq "") { return "" }
    try {
        $status = & $cli status --json 2>$null | ConvertFrom-Json
    } catch {
        return ""
    }
    if (-not $status -or -not $status.Self -or @($status.CertDomains).Count -eq 0) { return "" }
    $name = ([string]$status.Self.DNSName).TrimEnd(".").ToLowerInvariant()
    if ($name -notmatch '\.ts\.net$') { return "" }
    return $name
}
$tailscaleName = if ($lanAddress -ne "") { Get-TailscaleName } else { "" }

<#
    HTTPS in front of the loopback instance (WI-0180 §11). `--bg` keeps the entry across restarts of Tailscale; the stop path
    removes it. 🪤 It replaces whatever port 443 served before: on 2026-10-16 that was a leftover from 2026-10-05 pointing at
    http://127.0.0.1:5173, where Vite does not listen (it binds [::1]), so it answered 502.
#>
function Set-TailscaleHttps() {
    if ($tailscaleName -eq "") {
        Write-Line "skip" "https" "no Tailscale name with HTTPS certificates on this machine"
        return
    }
    & (Get-TailscaleCli) serve --bg --https=443 "http://127.0.0.1:$HttpsPort" *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Line "FAIL" "https" "tailscale serve did not accept https=443 -> http://127.0.0.1:$HttpsPort"
        Add-Failure "https"
        return
    }
    Write-Line "set" "https" "https://$tailscaleName/ -> http://127.0.0.1:$HttpsPort (tailnet only)"
}
function Remove-TailscaleHttps() {
    if ($tailscaleName -eq "") { return }
    & (Get-TailscaleCli) serve --https=443 off *> $null
    Write-Line "stop" "https" "https://$tailscaleName/"
}

function Get-ListenerPid([int]$Port) {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($connection) { return [int]$connection.OwningProcess }
    return 0
}

<#
    Is the service on this port ours?

    💣 NOT decided from the process table. `npm run dev:server` leaves a chain of cmd.exe and
    node.exe in which NOT ONE command line contains the repository path, so a path match declares
    our own running server a foreign process and refuses to start. Windows also does not expose a
    process working directory to ask instead.

    The honest question is not who owns the process but whether our service answers here - so the
    port is asked directly. That also keeps the stop path safe: we only ever kill something that
    identified itself as this stack.

    🔴 A command line is never read or printed anywhere in this script: Martin receives DATABASE_URL
    as a plain argument, and a process listing would put the development password on screen.
#>
function Test-ServiceOnPort([string]$Name) {
    $probe = switch ($Name) {
        "server" { @{ Url = "http://127.0.0.1:$ServerPort/health/ready"; Needle = "releaseId" } }
        "martin" { @{ Url = "http://127.0.0.1:$MartinPort/catalog"; Needle = "tiles" } }
        # 🪤 Vite binds IPv6 only: 127.0.0.1 is refused where localhost and [::1] answer.
        "web" { @{ Url = "http://localhost:$WebPort/"; Needle = "<div id=" } }
        "lan" { if ($lanAddress -ne "") { @{ Url = "http://${lanAddress}:$LanPort/"; Needle = "<div id=" } } else { $null } }
        "https" { @{ Url = "http://127.0.0.1:$HttpsPort/"; Needle = "<div id=" } }
        default { $null }
    }
    if (-not $probe) { return $false }
    try {
        $response = Invoke-WebRequest -Uri $probe.Url -UseBasicParsing -TimeoutSec 8
    } catch {
        return $false
    }
    if ($response.StatusCode -ne 200) { return $false }
    return ([string]$response.Content).Contains($probe.Needle)
}

function Wait-ForPort([int]$Port, [int]$TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $processId = Get-ListenerPid $Port
        if ($processId -ne 0) { return $processId }
        Start-Sleep -Milliseconds 700
    } while ((Get-Date) -lt $deadline)
    return 0
}

function Start-StackService([string]$Name, [int]$Port, [string]$NpmScript, [string[]]$NpmArguments = @()) {
    $existing = Get-ListenerPid $Port
    if ($existing -ne 0) {
        if (Test-ServiceOnPort $Name) {
            Write-Line "running" $Name "port $Port (PID $existing)"
            return
        }
        Write-Line "FAIL" $Name "port $Port is held by something that is not our $Name (PID $existing)"
        Add-Failure "$Name port $Port"
        return
    }

    $standardOut = Join-Path $stateDirectory "$Name.log"
    $standardError = Join-Path $stateDirectory "$Name.err.log"
    # Detached on purpose: every tool call is its own short-lived shell, so a child bound to this
    # console would die the moment the command returns - and the stack with it.
    $arguments = if ($NpmArguments.Count -gt 0) { $NpmArguments } else { @("run", $NpmScript) }
    $process = Start-Process -FilePath "npm.cmd" -ArgumentList $arguments `
        -WorkingDirectory $repositoryRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $standardOut -RedirectStandardError $standardError
    Set-Content -Path (Join-Path $stateDirectory "$Name.pid") -Value $process.Id -Encoding ascii

    $listener = Wait-ForPort $Port 90
    if ($listener -eq 0) {
        Write-Line "FAIL" $Name "did not listen on $Port within 90s, see $standardError"
        Add-Failure "$Name did not start"
        return
    }
    Write-Line "start" $Name "port $Port (PID $listener)"
}

function Stop-StackService([string]$Name, [int]$Port) {
    $stopped = $false
    $pidFile = Join-Path $stateDirectory "$Name.pid"
    if (Test-Path $pidFile) {
        $recorded = 0
        if ([int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$recorded) -and $recorded -ne 0) {
            if (Get-Process -Id $recorded -ErrorAction SilentlyContinue) {
                # /T because npm sits between us and the real process: killing the wrapper alone
                # would leave node or martin listening.
                & taskkill.exe /PID $recorded /T /F *> $null
                $stopped = $true
            }
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }

    $listener = Get-ListenerPid $Port
    if ($listener -ne 0 -and (Test-ServiceOnPort $Name)) {
        & taskkill.exe /PID $listener /T /F *> $null
        $stopped = $true
    } elseif ($listener -ne 0) {
        Write-Line "skip" $Name "port $Port answers as something else - left untouched"
        return
    }

    if ($stopped) { Write-Line "stop" $Name "port $Port" } else { Write-Line "idle" $Name "port $Port was not running" }
}

<#
    The worker of the job queue (JOBS-0001, `npm run jobs:worker`) has no port. It is ours when the PID in worker.pid
    still lives; a second worker next to it would claim the same jobs, so nothing else is started then. Without it every
    job waits forever: the syncs of the administration (WI-0127 SYS-14) and the media jobs (WI-0068 P4a).
#>
function Get-WorkerPid() {
    $pidFile = Join-Path $stateDirectory "worker.pid"
    if (-not (Test-Path $pidFile)) { return 0 }
    $recorded = 0
    if ([int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$recorded) -and $recorded -ne 0) {
        if (Get-Process -Id $recorded -ErrorAction SilentlyContinue) { return $recorded }
    }
    return 0
}

function Start-StackWorker() {
    $existing = Get-WorkerPid
    if ($existing -ne 0) {
        Write-Line "running" "worker" "job queue (PID $existing)"
        return
    }
    $process = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "jobs:worker:dev") `
        -WorkingDirectory $repositoryRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $stateDirectory "worker.log") `
        -RedirectStandardError (Join-Path $stateDirectory "worker.err.log")
    Set-Content -Path (Join-Path $stateDirectory "worker.pid") -Value $process.Id -Encoding ascii
    Start-Sleep -Seconds 3
    if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
        Write-Line "start" "worker" "job queue (PID $($process.Id))"
    } else {
        Write-Line "FAIL" "worker" "ended right after the start, see $(Join-Path $stateDirectory "worker.err.log")"
        Add-Failure "worker did not start"
    }
}

function Stop-StackWorker() {
    $existing = Get-WorkerPid
    Remove-Item (Join-Path $stateDirectory "worker.pid") -Force -ErrorAction SilentlyContinue
    if ($existing -eq 0) {
        Write-Line "idle" "worker" "job queue was not running"
        return
    }
    # /T because npm sits between us and node; a running job process ends with its supervisor (JOBS-0001).
    & taskkill.exe /PID $existing /T /F *> $null
    Write-Line "stop" "worker" "job queue"
}

function Test-Database([switch]$StartIfDown) {
    $pgIsReady = Join-Path $postgresHome "bin\pg_isready.exe"
    if (-not (Test-Path $pgIsReady)) {
        Write-Line "FAIL" "database" "pg_isready not found - run scripts/dev/install-toolchain.ps1"
        Add-Failure "database toolchain"
        return
    }
    & $pgIsReady --host=localhost --port=$DatabasePort *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Line "running" "database" "port $DatabasePort"
        return
    }
    if (-not $StartIfDown) {
        Write-Line "down" "database" "port $DatabasePort"
        return
    }

    $logFile = "C:\tools\pgsql-18.log"
    Start-Process -FilePath (Join-Path $postgresHome "bin\pg_ctl.exe") `
        -ArgumentList "--pgdata=`"$postgresData`"", "--log=`"$logFile`"", "--options=`"-p $DatabasePort -c listen_addresses=localhost`"", "start" `
        -WindowStyle Hidden | Out-Null
    $deadline = (Get-Date).AddSeconds(60)
    do {
        Start-Sleep -Seconds 2
        & $pgIsReady --host=localhost --port=$DatabasePort *> $null
        $ready = ($LASTEXITCODE -eq 0)
    } while (-not $ready -and (Get-Date) -lt $deadline)
    if ($ready) {
        Write-Line "start" "database" "port $DatabasePort"
    } else {
        Write-Line "FAIL" "database" "cluster did not start, see $logFile"
        Add-Failure "database"
    }
}

<#
    Finds a raster tile that really exists on disk, so the probe cannot pass against a 204. It is
    taken from the revision current.json points to (ADR-0008) - the one the map will ask for.
#>
function Get-RasterProbePath() {
    $pointerPath = Join-Path $TileRoot "$Series\current.json"
    if (-not (Test-Path $pointerPath)) { return $null }
    $revision = [string](Get-Content $pointerPath -Raw -Encoding UTF8 | ConvertFrom-Json).revision
    $revisionRoot = Join-Path $TileRoot "$Series\$revision"
    if (-not (Test-Path $revisionRoot)) { return $null }
    $tile = Get-ChildItem -Path $revisionRoot -Filter "*.webp" -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Length -gt 0 } |
        Select-Object -First 1
    if (-not $tile) { return $null }
    $relative = $tile.FullName.Substring($revisionRoot.Length).TrimStart("\").Replace("\", "/")
    return "/tiles/raster/$Series/$revision/$relative"
}

function Invoke-Probe([string]$Name, [string]$Url, [string]$ExpectedType) {
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 20
    } catch {
        $code = 0
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        if ($code -eq 503 -and $Name -eq "raster") {
            # A 503 here is never a missing tile - it is Fastify saying TILE_ROOT is unset.
            Write-Line "FAIL" $Name "$Url -> 503, TILE_ROOT is not configured for the running server"
        } else {
            Write-Line "FAIL" $Name "$Url - $($_.Exception.Message)"
        }
        Add-Failure $Name
        return
    }
    $type = [string]$response.Headers["Content-Type"]
    $bytes = $response.RawContentLength
    if ($response.StatusCode -ne 200) {
        Write-Line "FAIL" $Name "$Url -> $($response.StatusCode)"
        Add-Failure $Name
        return
    }
    # 🪤 Status alone proves nothing: an empty tile answers 204, and a missing asset can come back
    # as the SPA fallback with 200 and text/html. Type and size decide.
    if ($ExpectedType -and -not $type.StartsWith($ExpectedType)) {
        Write-Line "FAIL" $Name "$Url -> 200 but $type, expected $ExpectedType"
        Add-Failure $Name
        return
    }
    if ($bytes -le 0) {
        Write-Line "FAIL" $Name "$Url -> 200 $type but empty"
        Add-Failure $Name
        return
    }
    Write-Line "ok" $Name "$Url -> 200 $type, $bytes bytes"
}

function Invoke-Probes() {
    Invoke-Probe "health" "http://localhost:$WebPort/health/ready" "application/json"
    # The HTTPS address of the Tailscale instance answers with the page itself, not with a 502 or Vite's host block (WI-0180).
    if ($tailscaleName -ne "") { Invoke-Probe "https" "https://$tailscaleName/health/ready" "application/json" }

    $rasterPath = Get-RasterProbePath
    if (-not $rasterPath) {
        Write-Line "FAIL" "raster" "no current.json or no tile of its revision under $TileRoot\$Series - build the pyramid with scripts/dev/build-map-tiles.ps1 -Series $Series"
        Add-Failure "raster"
    } else {
        Invoke-Probe "raster pointer" "http://localhost:$WebPort/tiles/raster/$Series/current.json" "application/json"
        Invoke-Probe "raster" "http://localhost:$WebPort$rasterPath" "image/webp"
    }

    # Any one of these proves the vector path; naming them all keeps the probe alive when a single
    # relation is renamed.
    $candidates = @(
        "/tiles/vector/climate_band_render/2/2/1",
        "/tiles/vector/region_area_render/4/8/8",
        "/tiles/vector/place_render/5/17/16"
    )
    foreach ($candidate in $candidates) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:$WebPort$candidate" -UseBasicParsing -TimeoutSec 20
            if ($response.StatusCode -eq 200 -and $response.RawContentLength -gt 0) {
                Write-Line "ok" "vector" "$candidate -> 200 $([string]$response.Headers["Content-Type"]), $($response.RawContentLength) bytes"
                return
            }
        } catch {
            continue
        }
    }
    Write-Line "FAIL" "vector" "no vector tile answered through the Vite proxy - is Martin running against the dev database?"
    Add-Failure "vector"
}

# --- Run --------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null

if ($Action -eq "stop") {
    Stop-StackWorker
    Remove-TailscaleHttps
    Stop-StackService "https" $HttpsPort
    Stop-StackService "lan" $LanPort
    Stop-StackService "web" $WebPort
    Stop-StackService "martin" $MartinPort
    Stop-StackService "server" $ServerPort
    if ($IncludeDatabase) {
        & (Join-Path $postgresHome "bin\pg_ctl.exe") --pgdata="$postgresData" --mode=fast stop *> $null
        Write-Line "stop" "database" "port $DatabasePort"
    } else {
        Write-Line "keep" "database" "still running on $DatabasePort (use -IncludeDatabase to stop it)"
    }
    exit 0
}

if ($Action -eq "status") {
    Test-Database
    $services = @(@("server", $ServerPort), @("martin", $MartinPort), @("web", $WebPort))
    if ($lanAddress -ne "") { $services += , @("lan", $LanPort) }
    if ($tailscaleName -ne "") { $services += , @("https", $HttpsPort) }
    foreach ($service in $services) {
        $listener = Get-ListenerPid $service[1]
        if ($listener -eq 0) {
            Write-Line "down" $service[0] "port $($service[1])"
        } elseif (Test-ServiceOnPort $service[0]) {
            Write-Line "running" $service[0] "port $($service[1]) (PID $listener)"
        } else {
            Write-Line "foreign" $service[0] "port $($service[1]) held by PID $listener"
        }
    }
    $worker = Get-WorkerPid
    if ($worker -eq 0) { Write-Line "down" "worker" "job queue" } else { Write-Line "running" "worker" "job queue (PID $worker)" }
    Invoke-Probes
    if ($failures.Count -gt 0) { exit 1 }
    Write-Host ""
    Write-Host "http://localhost:$WebPort/"
    if ($lanAddress -ne "") { Write-Host "http://${lanAddress}:$LanPort/  (Tailscale fuers Telefon, ohne Anmeldung; am PC localhost)" }
    if ($tailscaleName -ne "") { Write-Host "https://$tailscaleName/  (HTTPS im Tailnet; Lokal im Umgebungsmenue von Stage und Production)" }
    exit 0
}

if (-not (Test-Path $TileRoot)) {
    Write-Line "warn" "tiles" "$TileRoot does not exist - raster tiles will answer 204"
}

<#
    💣 Without TILE_ROOT Fastify answers every raster tile with 503 `tiles_not_configured`, and the
    map shows a beige ground with no error in the console. It is not in the committed configuration
    because derived data lives outside the repository, so a stack started from a fresh shell had it
    only if the person happened to export it. The value is passed to the child process here; a
    TILE_ROOT already set in the environment or in .env wins, because Node prefers the existing
    environment over --env-file.
#>
if (-not $env:TILE_ROOT) {
    $env:TILE_ROOT = $TileRoot
    Write-Line "set" "tiles" "TILE_ROOT=$TileRoot (read only, never copied into the repository)"
}

<#
    💣 The same for MEDIA_ROOT (WI-0063 MEDIA-M12): without it Fastify answers every /media/ request
    with 503 and the panel shows no coat and no settlement picture. The published media live outside
    the repository as well. An existing MEDIA_ROOT - environment or .env - wins, like TILE_ROOT.
#>
if (-not $env:MEDIA_ROOT) {
    $env:MEDIA_ROOT = $MediaRoot
    Write-Line "set" "media" "MEDIA_ROOT=$MediaRoot (read only, only published/ is ever served)"
}
<#
    The shared queue (WI-0163): the conductor (`npm run jobs:worker`) writes the state of the queue to QUEUE_STAND_FILE in
    every tick, and Fastify reads it to show place and reason of every waiting job. Both get it the same way as TILE_ROOT:
    a variable of this shell, inherited by every process started below. Without it the conductor writes nothing and the
    page shows only its own table, as before WI-0163. Volatile state, so it lives next to the logs, not in the repository.
#>
if (-not $env:QUEUE_STAND_FILE) {
    $env:QUEUE_STAND_FILE = Join-Path $stateDirectory "warteschlange-stand.json"
    Write-Line "set" "queue" "QUEUE_STAND_FILE=$($env:QUEUE_STAND_FILE) (written by the conductor, read by Fastify)"
}
<#
    💣 Login on the Tailscale address (Betreiber 2026-10-12: „ich flieg ständig aus der anmeldung, nach jeder aktualisierung“).
    Without AUTH_INSECURE_COOKIE the server sets `__Host-…; Secure`, and a browser drops a Secure cookie from
    http://<Tailscale-IP> at once - every reload was logged out. Development only (the server refuses it elsewhere).
    Passkeys still need https or localhost: on the Tailscale address only the password works.

    And no editor view without login (same message: „da kommen sachen für editoren obwohl ich nicht eingeloggt bin“):
    locally like Stage, AUTH_ANONYMOUS_VIEW=visitor. The old default `editor` (WI-0120 A9) predates the login.
#>
if (-not $env:AUTH_INSECURE_COOKIE) {
    $env:AUTH_INSECURE_COOKIE = "1"
    Write-Line "set" "auth" "AUTH_INSECURE_COOKIE=1 (login also on http://<Tailscale-IP>)"
}
if (-not $env:AUTH_ANONYMOUS_VIEW) {
    $env:AUTH_ANONYMOUS_VIEW = "visitor"
    Write-Line "set" "auth" "AUTH_ANONYMOUS_VIEW=visitor (without login like Stage)"
}
<#
    Discord returns to the HTTPS address in the tailnet, not to http://localhost:5173 (Betreiber 2026-10-17: „discord springt
    immer auf 5173 zurück“; he registered https://<name>/api/auth/discord/callback in the Discord developer portal). The server
    sends this redirect with every login, so a Discord login has to START on https://<name>/ as well: the state cookie of the
    detour lives on the host that started it. An existing DISCORD_REDIRECT_URI in this shell wins; one in .env does not, because
    Node prefers the environment over --env-file.
#>
<#
    Passkeys on the HTTPS address in the tailnet (WI-0180 §13; Betreiber 2026-10-17: „schalte Passkeys lokal auf der ts.net-Adresse
    frei“): the server accepts this host as relying party next to localhost. Development only; the server refuses it elsewhere.
#>
if ($tailscaleName -ne "" -and -not $env:AUTH_LOCAL_HTTPS_HOST) {
    $env:AUTH_LOCAL_HTTPS_HOST = $tailscaleName
    Write-Line "set" "auth" "AUTH_LOCAL_HTTPS_HOST=$tailscaleName (passkeys on https://$tailscaleName/)"
}
if ($tailscaleName -ne "" -and -not $env:DISCORD_REDIRECT_URI) {
    $env:DISCORD_REDIRECT_URI = "https://$tailscaleName/api/auth/discord/callback"
    Write-Line "set" "auth" "DISCORD_REDIRECT_URI=https://$tailscaleName/api/auth/discord/callback"
}
if (-not (Test-Path (Join-Path $env:MEDIA_ROOT "published"))) {
    Write-Line "warn" "media" "$($env:MEDIA_ROOT)\published does not exist - every image will answer 404"
}

Test-Database -StartIfDown
if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "stack not started: the database is a prerequisite for everything else"
    exit 1
}

Start-StackService "server" $ServerPort "dev:server"
Start-StackService "martin" $MartinPort "tiles:dev"
Start-StackService "web" $WebPort "dev:web"
if ($lanAddress -ne "") {
    Start-StackService "lan" $LanPort "" @("run", "dev", "--workspace", "@avesmaps3d/web", "--", "--port", "$LanPort", "--strictPort", "--host", $lanAddress)
} else {
    Write-Line "skip" "lan" "no Tailscale address on this machine"
}
if ($tailscaleName -ne "") {
    # Vite answers only hosts it knows; the Tailscale name comes in through HTTPS (WI-0180 §11). Set for this child only.
    $env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = $tailscaleName
    Start-StackService "https" $HttpsPort "" @("run", "dev", "--workspace", "@avesmaps3d/web", "--", "--port", "$HttpsPort", "--strictPort", "--host", "127.0.0.1")
    Remove-Item Env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS -ErrorAction SilentlyContinue
}
Set-TailscaleHttps
Start-StackWorker

# Vite answers on its port before the proxy targets are ready; one short settle avoids a false red.
Start-Sleep -Seconds 2
Invoke-Probes

Write-Host ""
if ($failures.Count -gt 0) {
    Write-Host "not ready: $($failures -join ', ')"
    Write-Host "logs: $stateDirectory"
    exit 1
}
Write-Host "http://localhost:$WebPort/"
if ($lanAddress -ne "") { Write-Host "http://${lanAddress}:$LanPort/  (Tailscale fuers Telefon, ohne Anmeldung; am PC localhost)" }
if ($tailscaleName -ne "") { Write-Host "https://$tailscaleName/  (HTTPS im Tailnet; Lokal im Umgebungsmenue von Stage und Production)" }
exit 0
