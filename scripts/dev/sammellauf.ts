// WI-0228: the periodic, session-bound runner has been retired. It must never write release notes again.
process.stderr.write(
    "Der periodische Sammellauf ist stillgelegt. Für einen ausdrücklich benannten Production-Kandidaten: powershell -NoProfile -File scripts/dev/release-start.ps1 -Commit <SHA40> -Fixtures <Testpaket>\n",
);
process.exitCode = 2;
