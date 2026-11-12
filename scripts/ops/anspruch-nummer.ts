import { execFileSync } from "node:child_process";

/**
 * Ist eine Work-Item-Nummer auf `origin/master` schon vergeben? (WI-0169, Prüfung des Regelwerks 2026-10-15,
 * Empfehlung 6: „Nummern und Übergabeköpfe prüft ein Werkzeug, nicht die Sorgfalt der Sitzung.“)
 *
 * Maßstab ist `origin/master`, nicht der lokale Stand (AGENTS.md, „Geteilter Checkout und Git“): Der lokale Zweig hinkt
 * fast immer hinterher, und der Betreiber legt Work Items auch direkt per Push an.
 */

/** Die Work-Item-Nummer eines Anspruchs: `WI-0068-P4b` → `WI-0068`. Kein Work Item (`QR-2026-10-12`) → undefined. */
export function workItemNummer(anspruch: string): string | undefined {
    return /^WI-\d{4}(?!\d)/i.exec(anspruch)?.[0].toUpperCase();
}

/** Die Dateinamen, die diese Nummer schon tragen (`WI-0098` trifft `WI-0098-klappbox-hoehe.md`, nie `WI-00981-…`). */
export function belegteDateien(nummer: string, dateien: readonly string[]): string[] {
    return dateien.filter((name) => name.toUpperCase().startsWith(nummer) && !/\d/.test(name.charAt(nummer.length)));
}

/** Die höchste vergebene Nummer, als Anhaltspunkt für die nächste freie; die drei Quellen ersetzt sie nicht. */
export function hoechsteNummer(dateien: readonly string[]): string | undefined {
    return dateien
        .map(workItemNummer)
        .filter((nummer): nummer is string => nummer !== undefined)
        .sort()
        .at(-1);
}

export interface OriginStand {
    /** Dateinamen unter `project-control/work-items/` auf `origin/master`; undefined, wenn nicht lesbar. */
    dateien: string[] | undefined;
    warnung?: string;
}

/**
 * Holt `origin/master` und listet seine Work-Item-Dateien.
 *
 * 🪤 Ist origin nicht erreichbar, gilt der letzte bekannte Stand und es gibt eine Warnung, keinen Abbruch: Die
 * Anspruchsliste ist eine Ansage, keine Sperre (AGENTS.md, „Die Anspruchsliste“), und ohne Netz muss sie weiter gehen.
 * Git läuft mit festen Argumenten ohne Shell; der Baum wird als `origin/master:<pfad>` gelesen, damit es nicht darauf
 * ankommt, in welchem Unterverzeichnis der Aufruf steht.
 */
export function workItemsAufOrigin(cwd: string): OriginStand {
    let warnung: string | undefined;
    try {
        execFileSync("git", ["fetch", "--quiet", "origin", "master"], { cwd, stdio: "ignore", timeout: 30_000 });
    } catch {
        warnung = "origin nicht erreichbar; geprüft gegen den letzten bekannten Stand von origin/master";
    }
    try {
        const ausgabe = execFileSync("git", ["ls-tree", "--name-only", "origin/master:project-control/work-items"], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
        const dateien = ausgabe.split(/\r?\n/).filter((zeile) => zeile !== "");
        return warnung === undefined ? { dateien } : { dateien, warnung };
    } catch {
        return { dateien: undefined, warnung: "origin/master nicht lesbar; die Nummer ist nicht gegen origin geprüft" };
    }
}
