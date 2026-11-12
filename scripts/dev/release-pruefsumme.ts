// Die Prüfsumme einer Datei oder eines Ordners, wie der Release-Test sie für Umgebung und Belege braucht (WI-0248, vorher im Runner).
import { closeSync, lstatSync, openSync, readdirSync, readSync, type Stats } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

/**
 * SHA-256 über Namen, Größen und Inhalt aller Dateien unter `ordner` (oder über eine einzelne Datei). Ein Verweis (Symlink, Junction) ist
 * unzulässig und wirft: Er könnte aus dem Testpaket oder den Werkzeugen hinausführen. Gelesen wird in Blöcken, nie eine Datei ganz im Speicher.
 * `auslassen` nimmt Pfade (relativ, mit `/` beginnend) heraus, die das Werkzeug beim Laufen selbst schreibt.
 */
export function fingerprint(ordner: string, auslassen?: (rel: string) => boolean): string {
    const hash = createHash("sha256");
    const lies = (p: string, rel: string): void => {
        if (rel !== "" && auslassen?.(rel) === true) return;
        const s = lstatSync(p);
        if (s.isSymbolicLink()) throw new Error("Fixture-/Werkzeugverweis unzulässig");
        if (s.isDirectory()) for (const d of readdirSync(p).sort()) lies(join(p, d), `${rel}/${d}`);
        else if (s.isFile()) {
            hash.update(JSON.stringify([rel, s.size]));
            const fd = openSync(p, "r");
            try {
                const buffer = Buffer.alloc(1024 * 1024);
                let anzahl: number;
                while ((anzahl = readSync(fd, buffer, 0, buffer.length, null)) > 0)
                    hash.update(buffer.subarray(0, anzahl));
            } finally {
                closeSync(fd);
            }
        }
    };
    lies(ordner, "");
    return hash.digest("hex");
}

/**
 * Was Playwright im Browserordner (`ms-playwright`) beim Laufen selbst schreibt und darum nicht zur Umgebung zählt: Protokolle (`*.log`,
 * Chromium Headless Shell schreibt bei jedem Start `chrome-headless-shell-win64/debug.log`) und die Projektverweise unter `.links`.
 * Release-Test d1feba8 (2026-10-24): alle Teile grün, rot nur „Testumgebung während des Laufs verändert“, weil der Lauf diese Datei selbst
 * verlängerte. Die Browser selbst (Programme, Bibliotheken, Ressourcen) zählen weiter.
 */
export function browserFluechtig(rel: string): boolean {
    return rel.endsWith(".log") || rel === "/.links" || rel.startsWith("/.links/");
}

/**
 * Ist der Browserordner seit `startMs` unverändert, abgesehen von dem, was `browserFluechtig` auslässt? Jede andere Datei und jeder Ordner
 * darf weder Änderungs- noch Inhaltszeit nach dem Start tragen (neu angelegt, ersetzt oder umbenannt hieße: neuer Zeitstempel). Vorsichtig:
 * Was nicht lesbar ist, gilt als verändert. Für die Fortsetzung eines Laufs, dessen Fingerabdruck die Protokolle noch mitzählte.
 */
export function browserUnveraendertSeit(ordner: string, startMs: number): boolean {
    const pruefe = (p: string, rel: string): boolean => {
        if (rel !== "" && browserFluechtig(rel)) return true;
        let s: Stats;
        try {
            s = lstatSync(p);
        } catch {
            return false;
        }
        if (s.isSymbolicLink() || s.mtimeMs > startMs || s.ctimeMs > startMs) return false;
        if (!s.isDirectory()) return true;
        try {
            return readdirSync(p).every((d) => pruefe(join(p, d), `${rel}/${d}`));
        } catch {
            return false;
        }
    };
    return pruefe(ordner, "");
}

/** Welche Bestandteile eines Fingerabdrucks der Umgebung sich zwischen zwei Messungen unterscheiden, sortiert. */
export function geaenderteKomponenten(vorher: Record<string, string>, jetzt: Record<string, string>): string[] {
    return [...new Set([...Object.keys(vorher), ...Object.keys(jetzt)])].filter((k) => vorher[k] !== jetzt[k]).sort();
}
