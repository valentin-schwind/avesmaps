# Startet den Release-Runner fuer genau eine SHA unabhaengig von dieser Shell und endet sofort (WI-0228 D, WI-0248 R2).
# Aufruf: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/release-start.ps1 -Commit <SHA40> [-Fixtures <Testpaket>] [-Uebernehmen <fruehererLauf>]
# Ohne -Fixtures gilt das Testpaket, das release-fixtures.ts gebaut hat: <Datenwurzel>\release-fixtures\<SHA40>.
# Der Abholer (release-abholer.ts) startet den Runner so; von Hand nur nach ausdruecklicher Entscheidung (neuer Versuch nach Rot).
# -Uebernehmen <Ordnername unter .release-runs> ist die Wiederholung (WI-0248): Der Runner uebernimmt die gruenen Teile dieses frueheren Laufs derselben SHA,
# wenn die Umgebung gleich ist (release-abholer.ts --wiederholen <SHA40> setzt es).
# -Freigabe RT-<uuid> ist die Kennung der Freigabe, mit der ein Betreiber den Test gestartet hat (WI-0248): Sie steht im Nachweis, und nur dann geht
# ein gruener Lauf automatisch nach Production (release-freigabe.ts). Ohne: von Hand gestartet, keine Auslieferung.
# Der Volltest der Systemsteuerung (WI-0264): -Profil tor|voll setzt AVESMAPS_RELEASE_PROFIL fuer den Runner, -NurBericht laesst ihn keine Notiz nach origin
# schreiben (nie zusammen mit -Freigabe), -Vorlauf <Ordnername> nennt Teil 1 (tor) fuer Teil 2 (voll).
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{40}$')][string]$Commit,
    [string]$Fixtures = '',
    [ValidatePattern('^([0-9a-f]{40}(-[0-9]{8}T[0-9]{6}Z(-[0-9]+)?)?)?$')][string]$Uebernehmen = '',
    [ValidatePattern('^(RT-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$')][string]$Freigabe = '',
    [ValidateSet('', 'tor', 'voll')][string]$Profil = '',
    [switch]$NurBericht,
    [ValidatePattern('^([0-9a-f]{40}(-[0-9]{8}T[0-9]{6}Z(-[0-9]+)?)?)?$')][string]$Vorlauf = ''
)
$ErrorActionPreference = 'Stop'
if ($NurBericht -and $Freigabe -ne '') { throw '-NurBericht und -Freigabe schliessen sich aus: ein Volltest gibt nichts frei.' }
if ($Vorlauf -ne '' -and -not $NurBericht) { throw '-Vorlauf gibt es nur mit -NurBericht (Teil 2 des Volltests).' }
$repo = (git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Kein Repository' }
if ($Fixtures -eq '') {
    $daten = if ($env:AVESMAPS_DATEN) { $env:AVESMAPS_DATEN } else { 'C:\avesmaps3d-data' }
    $Fixtures = Join-Path (Join-Path $daten 'release-fixtures') $Commit
}
# Ein aktiver oder abgestuerzter Lauf haelt die globale Sperre; der Runner wuerde sonst nach dem Anlegen seines Ordners abbrechen.
if (Test-Path -LiteralPath (Join-Path $repo '.release-runs\aktiv')) {
    throw 'Ein Release-Lauf ist aktiv oder abgestuerzt (.release-runs\aktiv). Erst pruefen, dass kein Prozess lebt; kein automatisches Entsperren.'
}
$node = (Get-Command node.exe).Source
$worker = Join-Path $PSScriptRoot 'release-runner.ts'
# Start-Process auf Windows ist von dieser Shell unabhaengig (belegt: ueberlebt das Ende der aufrufenden Shell und ihres Elternprozesses). Kein Pipe-Erbe, kein Fenster.
$arguments = @(('"' + $worker + '"'), '--commit', $Commit, '--fixtures', ('"' + (Resolve-Path -LiteralPath $Fixtures).Path + '"'))
if ($Uebernehmen -ne '') { $arguments += @('--uebernehmen', $Uebernehmen) }
if ($Freigabe -ne '') { $arguments += @('--freigabe', $Freigabe) }
if ($NurBericht) { $arguments += @('--nur-bericht') }
if ($Vorlauf -ne '') { $arguments += @('--vorlauf', $Vorlauf) }
# Das Kind erbt die Umgebung dieser Shell: Das Profil gilt nur fuer diesen Runner.
if ($Profil -ne '') { $env:AVESMAPS_RELEASE_PROFIL = $Profil }
$p = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $repo -WindowStyle Hidden -PassThru
Write-Output "Release-Auftrag gestartet: PID $($p.Id), SHA $Commit"
Write-Output "Status und Ergebnis: $repo\.release-runs\$Commit\status.json"
