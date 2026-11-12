<#
.SYNOPSIS
    Die Bühne: Die lokale HTTPS-Adresse (Tailscale, Vite 5180) zeigt den Stand der Stage.

.DESCRIPTION
    Betreiber 2026-10-30: „bring bei stage deploys auch immer localhost au denselben stand“. Der Hauptcheckout trägt offene
    Arbeit mehrerer Sitzungen und wird nie nachgezogen. Die Bühne ist deshalb eine eigene, saubere Arbeitskopie
    (`.claude/worktrees/buehne`, detached) auf der jüngsten grün ausgerollten Stage-SHA (`refs/notes/stage`), mit eigenem
    Fastify auf 3020 und der Vite auf 5180 davor. 5173 und 5174 bleiben beim Hauptcheckout.

    Auch der Ausführer der Warteschlange (`jobs:worker`, `worker.pid`) läuft aus der Bühne: Er führt den Release-Test aus, den der
    Knopf der Bühne beauftragt. Lief er aus dem hinkenden Hauptcheckout, kannte er die Schritte des neuen Werkzeugs nicht und setzte
    die Freigabe auf „abgebrochen“ (2026-10-31, „Der Stand des Starters hatte eine unbekannte Form.“). Läuft gerade ein Auftrag oder
    ein Release-Test, bleibt er stehen; das Skript meldet es, und der nächste Lauf zieht ihn nach.

    -Action nachziehen (Standard): Arbeitskopie auf die Stage-SHA, shared bauen, Fastify 3020, Vite 5180 und den Ausführer neu starten.
    -Action status: welche SHA die Bühne zeigt und welche die Stage.

    🪤 Migrationen spielt das Skript nicht ein: Die lokale Datenbank teilen alle Sitzungen. Bringt die Stage eine neue
    Migration, die die lokale Datenbank noch nicht hat, meldet das Skript sie mit dem Befehl zum Einspielen aus der Bühne.
    🪤 `start-local-stack.ps1 start` setzt 5180 wieder auf den Hauptcheckout; danach dieses Skript erneut laufen lassen.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\GIT\avesmaps3D\scripts\dev\buehne.ps1

.NOTES
    🪤 Aus einem Agenten-Werkzeug nicht direkt und nicht per `Start-Process` starten: Fastify und Vite erben die Handles des
    Werkzeugs und laufen weiter, also kehrt der Aufruf nie zurück (mit `-Wait` ebenso). Über WMI startet das Skript ohne
    geerbte Handles; dann warten, bis im Log die Zeile „https“ oder ein Fehler steht. Den Aufruf in einen Block fassen: Ohne ihn
    blieb das Log leer und das Skript lief nicht (2026-10-31).
    Invoke-CimMethod Win32_Process Create @{ CommandLine = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& { & C:\GIT\avesmaps3D\scripts\dev\buehne.ps1 } *> C:\avesmaps3d-data\dev-stack\buehne-lauf.log"' }
#>
param(
    [ValidateSet("nachziehen", "status")]
    [string]$Action = "nachziehen",
    [int]$ServerPort = 3020,
    [int]$HttpsPort = 5180,
    [string]$TileRoot = "C:\avesmaps3d-data\tiles\aventuria"
)

# Continue: In Windows PowerShell 5.1 machte "Stop" jede Zeile auf stderr eines nativen Befehls (git) zum Abbruch; Fehler wirft das Skript selbst.
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$wt = Join-Path $repo ".claude\worktrees\buehne"
$stack = "C:\avesmaps3d-data\dev-stack"

function Write-Line([string]$Status, [string]$Name, [string]$Text) { "{0,-5} {1,-8} {2}" -f $Status, $Name, $Text }

function Get-StageSha() {
    git -C $repo fetch -q origin 2>$null
    git -C $repo fetch -q origin "refs/notes/stage:refs/notes/stage" 2>$null
    foreach ($sha in (git -C $repo log --format=%H -60 origin/master)) {
        $note = (git -C $repo notes --ref=stage show $sha 2>$null) -join "`n"
        # Auch der Rückweg zählt: Nach einem roten Rollout steht die Stage wieder auf diesem Commit, die Notiz lautet dann
        # „Rueckweg nach <sha8> rot: <release>“ (auto-stage.sh, gelesen wie in ops/production/freigabe-kandidat.sh). Ohne ihn
        # blieb die Bühne am 05.11. auf dem vorletzten grünen Stand stehen.
        if ($note -match "(?m)^(?:gruen ausgerollt|Rueckweg nach [0-9a-f]+ rot): (\S+)") { return @{ Sha = $sha; Release = $Matches[1] } }
    }
    throw "keine ausgerollte Stage-SHA in den letzten 60 Commits"
}

function Get-TailscaleName() {
    $cli = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if (-not $cli) { return "" }
    try { return ((& $cli.Source status --json | ConvertFrom-Json).Self.DNSName).TrimEnd(".") } catch { return "" }
}

function Stop-ByPidFile([string]$Name) {
    $file = Join-Path $stack "$Name.pid"
    if (-not (Test-Path $file)) { return }
    $id = (Get-Content $file -Raw).Trim()
    if ($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue)) { & taskkill.exe /PID $id /T /F *> $null }
    Remove-Item $file -Force -ErrorAction SilentlyContinue
}

function Stop-Port([int]$Port) {
    $owners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($id in $owners) { if ($id -gt 0) { & taskkill.exe /PID $id /T /F *> $null } }
}

function Wait-Url([string]$Url, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        # Jede HTTP-Antwort unter 500 heißt: der Dienst lebt. Windows PowerShell 5.1 wirft bei 4xx eine Ausnahme mit Antwort.
        try { $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -lt 500) { return $true } } catch { $resp = $_.Exception.Response; if ($resp -and [int]$resp.StatusCode -lt 500) { return $true } }
        Start-Sleep -Seconds 1
    }
    return $false
}

$stage = Get-StageSha
$current = if (Test-Path (Join-Path $wt ".git")) { (git -C $wt rev-parse HEAD 2>$null) } else { "" }

if ($Action -eq "status") {
    Write-Line "stage" "sha" "$($stage.Sha.Substring(0, 9)) $($stage.Release)"
    Write-Line "buehne" "sha" $(if ($current) { $current.Substring(0, 9) } else { "keine Arbeitskopie" })
    exit 0
}

# 1. Arbeitskopie auf die Stage-SHA (nie eigene Änderungen darin; ein Ordner ohne .git ist ein Rest und wird beiseitegelegt)
if ((Test-Path $wt) -and -not (Test-Path (Join-Path $wt ".git"))) {
    $alt = "$wt-alt-$(Get-Date -Format yyyyMMddHHmmss)"
    Rename-Item $wt $alt
    Write-Line "move" "buehne" "Rest ohne .git nach $alt"
}
git -C $repo worktree prune
if (-not (Test-Path $wt)) {
    git -C $repo worktree add --detach $wt $stage.Sha *> $null
    Write-Line "new" "buehne" $wt
} else {
    git -C $wt checkout -q --detach $stage.Sha
}
Write-Line "ok" "buehne" "$($stage.Sha.Substring(0, 9)) $($stage.Release)"

# 2. shared aus der Arbeitskopie (Junction, dann bauen)
$junction = Join-Path $wt "node_modules\@avesmaps3d\shared"
if (-not (Test-Path $junction)) {
    New-Item -ItemType Directory -Force (Split-Path $junction) | Out-Null
    New-Item -ItemType Junction -Path $junction -Target (Join-Path $wt "packages\shared") | Out-Null
}
Push-Location (Join-Path $wt "packages\shared")
& (Join-Path $repo "node_modules\.bin\tsc.cmd") --build
$built = $LASTEXITCODE
Pop-Location
if ($built -ne 0) { throw "shared bauen fehlgeschlagen" }
Write-Line "ok" "shared" "gebaut"

# 3. Migrationen nur melden: die jüngste der Arbeitskopie gegen die jüngste, die die lokale Datenbank eingespielt hat
$migStage = [IO.Path]::GetFileNameWithoutExtension((Get-ChildItem (Join-Path $wt "apps\server\migrations") -Filter *.sql | Sort-Object Name | Select-Object -Last 1).Name)
Push-Location (Join-Path $repo "apps\server")
$migDb = & node.exe "--env-file-if-exists=$repo\.env" --input-type=module -e "const s=(await import('postgres')).default(process.env.DATABASE_URL,{max:1});const r=await s.unsafe('select max(version) as v from schema_migration');console.log(r[0].v??'');await s.end()" 2>$null | Select-Object -Last 1
Pop-Location
if (-not $migDb) { Write-Line "HINW" "db" "lokale Datenbank nicht lesbar, Migrationen ungeprüft" }
elseif ($migStage -gt $migDb) { Write-Line "HINW" "db" "Stage bringt $migStage, die lokale Datenbank hat bis ${migDb}: in $wt\apps\server 'node --env-file-if-exists=$repo\.env src/db/cli.ts'" }
else { Write-Line "ok" "db" "lokale Datenbank bis $migDb" }

# 4. Fastify der Bühne auf $ServerPort
$tailscaleName = Get-TailscaleName
Stop-ByPidFile "buehne-server"
Stop-Port $ServerPort
$env:PORT = "$ServerPort"
if (-not $env:TILE_ROOT) { $env:TILE_ROOT = $TileRoot }
if ($tailscaleName -ne "") {
    $env:AUTH_LOCAL_HTTPS_HOST = $tailscaleName
    $env:DISCORD_REDIRECT_URI = "https://$tailscaleName/api/auth/discord/callback"
}
$server = Start-Process -FilePath "node.exe" -WindowStyle Hidden -PassThru `
    -WorkingDirectory (Join-Path $wt "apps\server") `
    -ArgumentList @("--import", "../../scripts/dev/shared-aus-quellen.mjs", "--env-file-if-exists=$repo\.env", "src/server.ts") `
    -RedirectStandardOutput (Join-Path $stack "buehne-server.log") -RedirectStandardError (Join-Path $stack "buehne-server.err.log")
Set-Content (Join-Path $stack "buehne-server.pid") $server.Id
if (-not (Wait-Url "http://127.0.0.1:$ServerPort/health/ready" 90)) { throw "Fastify der Bühne antwortet nicht auf $ServerPort (Log: $stack\buehne-server.err.log)" }
Write-Line "ok" "server" "http://127.0.0.1:$ServerPort (PID $($server.Id))"

# 5. Der Ausführer der Warteschlange aus der Arbeitskopie (dieselbe `worker.pid` wie `start-local-stack.ps1`, also nie zwei). Nie unter einem
#    laufenden Auftrag oder Release-Test: Sein Ablösen hielte den Auftrag an.
$standDatei = Join-Path $stack "warteschlange-stand.json"
$standText = if (Test-Path $standDatei) { Get-Content $standDatei -Raw -ErrorAction SilentlyContinue } else { "" }
$releaseAktiv = Test-Path "C:\avesmaps3d-data\release-werkzeug\.release-runs\aktiv"
if ($releaseAktiv -or ($standText -match '"state":"RUNNING"')) {
    Write-Line "HINW" "worker" "nicht nachgezogen: ein Auftrag oder Release-Test läuft; nach seinem Ende dieses Skript erneut"
} else {
    Stop-ByPidFile "worker"
    $worker = Start-Process -FilePath "node.exe" -WindowStyle Hidden -PassThru `
        -WorkingDirectory (Join-Path $wt "apps\server") `
        -ArgumentList @("--import", "../../scripts/dev/shared-aus-quellen.mjs", "--env-file-if-exists=$repo\.env", "src/jobs/worker-cli.ts") `
        -RedirectStandardOutput (Join-Path $stack "worker.log") -RedirectStandardError (Join-Path $stack "worker.err.log")
    Set-Content (Join-Path $stack "worker.pid") $worker.Id -Encoding ascii
    Start-Sleep -Seconds 4
    if (Get-Process -Id $worker.Id -ErrorAction SilentlyContinue) { Write-Line "ok" "worker" "Warteschlange aus der Bühne (PID $($worker.Id))" }
    else { throw "Ausführer der Warteschlange endete gleich nach dem Start (Log: $stack\worker.err.log)" }
}

# 6. Vite 5180 aus der Arbeitskopie, Proxy auf $ServerPort
Stop-ByPidFile "https"
Stop-Port $HttpsPort
if ($tailscaleName -ne "") { $env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = $tailscaleName }
$vite = Start-Process -FilePath "node.exe" -WindowStyle Hidden -PassThru `
    -WorkingDirectory (Join-Path $wt "apps\web") `
    -ArgumentList @((Join-Path $repo "node_modules\vite\bin\vite.js"), "--port", "$HttpsPort", "--strictPort", "--host", "127.0.0.1") `
    -RedirectStandardOutput (Join-Path $stack "buehne-web.log") -RedirectStandardError (Join-Path $stack "buehne-web.err.log")
Set-Content (Join-Path $stack "https.pid") $vite.Id
if (-not (Wait-Url "http://127.0.0.1:$HttpsPort/" 60)) { throw "Vite der Bühne antwortet nicht auf $HttpsPort (Log: $stack\buehne-web.err.log)" }
Write-Line "ok" "https" $(if ($tailscaleName -ne "") { "https://$tailscaleName/ -> Stand $($stage.Sha.Substring(0, 9))" } else { "http://127.0.0.1:$HttpsPort/" })
