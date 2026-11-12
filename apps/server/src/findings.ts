/**
 * Befunde: eine Prüfung hat angeschlagen, der Lauf geht weiter.
 *
 * 🔴 Betreiberentscheidung 2026-10-03: „ich will nur prüfungen die ich definiert hab, du baust einfach
 * random regeln ein die den betrieb aufhalten“. Nur eine Prüfung, die der Betreiber als Bedingung
 * definiert hat, darf Import oder Ableitung anhalten (AGENTS.md, „Blockierende Prüfungen im Betrieb“,
 * Inventur: `project-control/discovery/blockierende-pruefungen-2026-10-03.md`). Jede andere Prüfung
 * rechnet weiter wie bisher - Grenzwert und Berechnung bleiben -, nennt aber ihr Ergebnis als Befund:
 * mit Zahlen und mit den betroffenen Objekten (Tabelle, öffentliche ID, Name), im Bericht und im Log.
 */

/** Ein betroffenes Objekt: so, dass ein Mensch es in der Karte oder in der Tabelle wiederfindet. */
export interface FindingObject {
    table: string;
    publicId: string;
    name: string | null;
}

export interface Finding {
    /** Stabile Kurzkennung der Prüfung, etwa `stilllegequote`. */
    code: string;
    /** Ein Satz Klartext mit den Zahlen. */
    message: string;
    /** Die Zahlen hinter dem Befund. */
    numbers: Record<string, number | string>;
    /** Wie viele Objekte betroffen sind; `objects` ist ab `MAX_FINDING_OBJECTS` gekürzt. */
    objectCount: number;
    /** Die betroffenen Objekte, höchstens `MAX_FINDING_OBJECTS`. */
    objects: FindingObject[];
    /** Weitere Zeilen Klartext, etwa die ersten Abweichler einer Prüfung („Name (ID): Wert statt Wert“). */
    notes: string[];
}

/**
 * So viele Objekte nennt ein Befund höchstens namentlich. Bei einer Quelle, die halb abgeschnitten ist, sind es
 * tausende; der Bericht bleibt lesbar, die Zahl (`objectCount`) bleibt vollständig.
 */
export const MAX_FINDING_OBJECTS = 200;

export function createFinding(
    code: string,
    message: string,
    numbers: Record<string, number | string>,
    objects: readonly FindingObject[] = [],
    objectCount: number = objects.length,
    notes: readonly string[] = [],
): Finding {
    return { code, message, numbers, objectCount, objects: objects.slice(0, MAX_FINDING_OBJECTS), notes: [...notes] };
}

/** Prozent mit einer Nachkommastelle und Komma, wie die Meldungen es nennen: 0,054 wird „5,4 %“. */
export function formatShare(share: number): string {
    return `${(share * 100).toFixed(1).replace(".", ",")} %`;
}

/**
 * Die Zeilen eines Befunds für Log und Bericht: eine Kopfzeile, darunter je Objekt `Tabelle ID Name`.
 * Der Log zeigt höchstens `maxObjects` Objekte; der Bericht (Datei) bekommt alle, die der Befund trägt.
 */
export function formatFinding(finding: Finding, maxObjects: number = MAX_FINDING_OBJECTS): string[] {
    const lines = [`BEFUND ${finding.code}: ${finding.message}`];
    for (const object of finding.objects.slice(0, maxObjects)) {
        lines.push(`  ${object.table} ${object.publicId} ${object.name ?? "(ohne Namen)"}`);
    }
    const unnamed = finding.objectCount - Math.min(finding.objects.length, maxObjects);
    if (unnamed > 0) {
        lines.push(`  … und ${String(unnamed)} weitere`);
    }
    for (const note of finding.notes) {
        lines.push(`  ${note}`);
    }
    return lines;
}

/** Alle Befunde als Zeilen; leer, wenn es keine gibt. */
export function formatFindings(findings: readonly Finding[], maxObjects: number = MAX_FINDING_OBJECTS): string[] {
    return findings.flatMap((finding) => formatFinding(finding, maxObjects));
}
