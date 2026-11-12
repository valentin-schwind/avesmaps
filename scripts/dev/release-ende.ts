// Das harte Ende des Runners (WI-0248): Abbruch (Datei ABBRUCH) und Gesamtzeit.
//
// 🔴 Anlass (2026-10-24, Abbruch von Lauf 1d1e366a5 über die Karte): Das harte Ende beendete am Schluss den EIGENEN Prozessbaum (`taskkill /PID <eigene> /T /F`).
// Der Runner starb damit mitten im Aufräumen; sein `finally` mit dem Freigeben der Sperre `.release-runs\aktiv` lief nie. Die Sperre blieb stehen, der
// nächste Start wurde abgewiesen („Sperre ohne lebenden Prozess“), und in der Oberfläche sah es nicht danach aus.
//
// Jetzt: Der Endzustand steht zuerst in der Datei (`status.json` mit `ende`, `fehler.txt`), dann enden die Dienste (Martin, Cluster, Wachhalten), dann
// NUR DIE KINDER des Runners samt ihren Nachkommen (Vitest, Playwright, npm …), danach die Notiz, dann wird die Sperre freigegeben, und erst dann endet
// der Runner selbst. Lässt sich nicht bestätigen, dass alle Kinder weg sind (Prozessliste nicht lesbar, ein Kind bleibt), bleibt der alte Notbehelf: der
// eigene Prozessbaum geht mit, die Sperre bleibt zur Diagnose stehen (der Abholer gibt sie später frei, weil der Lauf dann einen Endzustand hat und
// kein Runner lebt, `release-abholer.ts`, `pruefeSperre`).
import { spawnSync } from "node:child_process";
import { rmdirSync } from "node:fs";

/**
 * Gibt die Sperre frei. Der Runner legt sie als leeren Ordner mit `mkdir` an; er nimmt sie mit `rmdir` weg, nie rekursiv (was darin liegt, gehört
 * ihm nicht). `true`: weg (auch: war schon weg). `false`: ließ sich nicht entfernen. Wirft nie.
 */
export function gibSperreFrei(sperre: string): boolean {
    try {
        rmdirSync(sperre);
        return true;
    } catch (e) {
        return (e as NodeJS.ErrnoException).code === "ENOENT";
    }
}

/** Das Werkzeug, mit dem die Kinder eines Prozesses gefunden und beendet werden; Tests ersetzen es. */
export interface KinderWerkzeug {
    /** Die Nummern der DIREKTEN Kinder von `pid` (ohne das Hilfsprogramm, das fragt); `undefined`, wenn sich die Liste nicht lesen ließ. */
    liste(pid: number): number[] | undefined;
    /** Beendet ein Kind samt allen Nachkommen. */
    beende(pid: number): void;
}

/** Windows: Die Kinder liefert die Prozessliste (WMI), beendet wird mit `taskkill /T /F` (Prozessbaum des Kindes, nicht der eigene). */
export const windowsKinder: KinderWerkzeug = {
    liste(pid) {
        const lauf = spawnSync(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${String(pid)}' | ForEach-Object { $_.ProcessId }`,
            ],
            { encoding: "utf8", timeout: 30_000, windowsHide: true },
        );
        if (lauf.status !== 0) return undefined;
        return lauf.stdout
            .split(/\r?\n/)
            .map((zeile) => Number(zeile.trim()))
            .filter((nummer) => Number.isInteger(nummer) && nummer > 0 && nummer !== lauf.pid);
    },
    beende(pid) {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 15_000 });
    },
};

export interface KinderErgebnis {
    /** Die Kinder, die gefunden und beendet wurden. */
    readonly beendet: readonly number[];
    /** Alle Kinder sind nachweislich weg (zweite Liste leer). `false`: Liste nicht lesbar oder ein Kind lebt noch. */
    readonly alleWeg: boolean;
}

/**
 * Beendet alle Kinder von `pid` (mit ihren Nachkommen), nie `pid` selbst, und prüft danach mit einer zweiten Liste, dass keines mehr da ist. Wirft nie.
 */
export function beendeKinder(pid: number, werkzeug: KinderWerkzeug = windowsKinder): KinderErgebnis {
    try {
        const kinder = werkzeug.liste(pid);
        if (kinder === undefined) return { beendet: [], alleWeg: false };
        for (const kind of kinder) werkzeug.beende(kind);
        const uebrig = werkzeug.liste(pid);
        return { beendet: kinder, alleWeg: uebrig !== undefined && uebrig.length === 0 };
    } catch {
        return { beendet: [], alleWeg: false };
    }
}

/** Was das harte Ende des Runners braucht; der Runner gibt seine Stücke, Tests Ersatz. */
export interface HartesEnde {
    /** Der Endzustand in die Dateien: `status.json` mit `ende`, `fehler.txt`. Zuerst, damit der Lauf auch bei allem Weiteren als beendet dasteht. */
    schreibeEnde(): void;
    /** Dienste, die der Runner selbst beendet (Martin, Wegwerf-Cluster, Wachhalten). */
    dienste: readonly (() => void)[];
    /** Die Kinder beenden; `true`, wenn nachweislich keines mehr lebt. */
    kinder(): boolean;
    /** Die Notiz „rot“ veröffentlichen (best effort, darf dauern). */
    notiz(): void;
    /** Die Sperre `aktiv` freigeben. */
    sperreFrei(): void;
    /** Notbehelf, wenn Kinder nicht bestätigt weg sind: den eigenen Prozessbaum beenden. */
    selbstBeenden(): void;
    /** Den Prozess verlassen (`process.exit`). */
    verlasse(code: number): void;
}

/** Die Schritte des harten Endes in ihrer Reihenfolge; jeder darf scheitern, ohne die folgenden zu verhindern. Gibt zurück, ob die Sperre freigegeben wurde. */
export function beendeHart(ende: HartesEnde): boolean {
    const versuche = (arbeit: () => void): void => {
        try {
            arbeit();
        } catch {
            /* best effort: das Ende ist beschlossen */
        }
    };
    versuche(() => ende.schreibeEnde());
    for (const dienst of ende.dienste) versuche(dienst);
    let kinderWeg = false;
    versuche(() => {
        kinderWeg = ende.kinder();
    });
    if (!kinderWeg) {
        // Sicherheit vor Ordnung: Lebt womöglich noch ein Kind, bleibt die Sperre stehen und der eigene Baum geht mit.
        versuche(() => ende.notiz());
        versuche(() => ende.selbstBeenden());
        ende.verlasse(1);
        return false;
    }
    versuche(() => ende.notiz());
    versuche(() => ende.sperreFrei());
    ende.verlasse(1);
    return true;
}
