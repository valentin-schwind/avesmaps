/**
 * Das Muster einer Freitextsuche für `ILIKE … ESCAPE '\'` (Betreiber 2026-10-11, Entscheidungsprotokoll 3f7acfc8: eine Suche nach
 * Freitext links in jeder Leiste): Teil eines Werts, ohne Groß und Klein. `%`, `_` und `\` sind Zeichen, kein Muster.
 */
export function likeMuster(text: string): string {
    return `%${text.replace(/[\\%_]/gu, (zeichen) => `\\${zeichen}`)}%`;
}
