// Wachhalten des Entwicklungsrechners während eines Release-Laufs (WI-0248 R1, Betreiber: der Lauf dauert Stunden, der Rechner darf dabei
// nicht schlafen gehen).
//
// 🔴 Ohne Adminrechte und ohne Systemeinstellung: ein verstecktes PowerShell, das `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)`
// hält und endet, sobald der Runner-Prozess weg ist. Die Anforderung gilt nur, solange dieser Thread lebt: Stirbt der Runner hart, stirbt
// auch sie (das Skript wartet auf den Runner und endet mit ihm). Bildschirm und Sperre bleiben unberührt. Andere Plattformen: nichts.
import { spawn } from "node:child_process";
import { beendeProzessbaum, type Dienst } from "./release-dienste.ts";

/** ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x00000001). */
export const ES_WACH = 0x80000001;

/** Das PowerShell-Skript, das den Rechner wachhält, bis der Prozess `pid` endet. */
export function wachhaltenSkript(pid: number): string {
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("Ungültige Prozesskennung");
    return [
        "$ErrorActionPreference = 'Stop'",
        "Add-Type -Namespace Avesmaps -Name Wach -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags);'",
        `[void][Avesmaps.Wach]::SetThreadExecutionState([uint32]${String(ES_WACH)})`,
        `try { Wait-Process -Id ${String(pid)} } catch { }`,
    ].join("\n");
}

/** Die Argumente für `powershell.exe`: das Skript als `-EncodedCommand` (UTF-16LE, Base64), damit keine Anführungszeichen stören. */
export function wachhaltenArgumente(pid: number): string[] {
    return [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-EncodedCommand",
        Buffer.from(wachhaltenSkript(pid), "utf16le").toString("base64"),
    ];
}

/**
 * Hält den Rechner wach, bis `beende()` gerufen wird oder der Prozess `pid` (Vorgabe: dieser) endet. Auf anderen Plattformen als Windows
 * ohne Wirkung (`undefined`). Ein nicht startbares PowerShell wirft nicht: Wachhalten ist eine Hilfe, kein Teil des Urteils.
 */
export function starteWachhalten(pid: number = process.pid, plattform: string = process.platform): Dienst | undefined {
    if (plattform !== "win32") return undefined;
    const kind = spawn("powershell.exe", wachhaltenArgumente(pid), { stdio: "ignore", windowsHide: true });
    kind.once("error", () => undefined);
    kind.unref();
    let beendet = false;
    return {
        pid: kind.pid,
        beende: () => {
            if (beendet) return;
            beendet = true;
            beendeProzessbaum(kind.pid);
        },
    };
}
