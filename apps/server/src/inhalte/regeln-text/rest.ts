import type { EintragInnen, Gelesen } from "./typen.ts";

/**
 * Was nach dem Übernehmen im Text stehen bleibt (WI-0254 §13; Port von `txErledigt` und des Zusammenziehens in `txUebernehmen` im Entwurf): Übernommene und vorhandene Regeln, fertige Köpfe und Quellen ohne offene
 * Einträge entfallen; was eine Rückfrage, ein Fehler oder ein offener Eintrag ist, bleibt, damit die Redaktion es klären kann. Rein, ohne Datenbank.
 *
 * - Eine Zeile `| Beziehung = …` kann mehrere Regeln tragen (`;`): Bleibt davon eine offen, wird die Zeile mit nur den offenen Regeln neu geschrieben (`ersatz`); die Fortsetzungszeilen entfallen dann.
 * - Der Kopf eines Eintrags bleibt, solange eine seiner Regeln offen ist oder seine `Quelle:`-Zeile nicht aufgelöst ist. Eine `Quelle:`-Zeile bleibt, solange ein Eintrag mit ihr bleibt oder sie selbst offen ist;
 *   `Quelle: –` bleibt nur, wo die Quelle davor bleibt.
 * - Kommentare bleiben. Die Zeilenenden des Ergebnisses sind `\n`; Leerzeilen sind zusammengezogen, am Anfang und Ende steht keine.
 */

export function erledigt(g: Gelesen): { weg: Set<number>; ersatz: Map<number, string> } {
    const weg = new Set<number>();
    const ersatz = new Map<number, string>(); // erste Zeile eines Blocks → sein neuer Text
    const bleibt = new Set<EintragInnen>(); // Köpfe, die bleiben
    for (const k of g.eintraege) {
        const q = k.quelle;
        const fertig = k.status === "ok";
        const istErledigt = (status: string): boolean => fertig && (status === "neu" || status === "schon");
        let offene = 0;
        for (const bl of k.bloecke) {
            const offen = bl.regeln.filter((r) => !istErledigt(r.status));
            offene += offen.length;
            if (offen.length === bl.regeln.length) continue; // nichts davon erledigt: der Block bleibt, wie er ist
            for (let z = bl.zeile; z <= bl.zeileBis; z++) weg.add(z);
            if (offen.length > 0) {
                weg.delete(bl.zeile);
                ersatz.set(bl.zeile, bl.praefix + offen.map((r) => r.text).join("; "));
            }
        }
        if (fertig && offene === 0 && (q === null || q.status === "ok")) weg.add(k.zeile);
        else bleibt.add(k);
    }
    // Quelle-Zeilen: bleiben, solange ein Eintrag mit ihr bleibt oder sie selbst offen ist
    const gebraucht = new Set([...bleibt].map((k) => k.quelle));
    let wirkt = false;
    for (const q of g.quellen) {
        if (q.beendet) {
            if (!wirkt) weg.add(q.zeile);
            wirkt = false;
            continue;
        }
        const braucht = q.status !== "ok" || gebraucht.has(q);
        if (!braucht) weg.add(q.zeile);
        wirkt = braucht;
    }
    return { weg, ersatz };
}

/** Der Text nach dem Übernehmen: die erledigten Zeilen weg, Leerzeilen zusammengezogen. */
export function restText(text: string, g: Gelesen): string {
    const { weg, ersatz } = erledigt(g);
    const zeilen = String(text)
        .split(/\r?\n/u)
        .flatMap((z, i) => (weg.has(i) ? [] : ersatz.has(i) ? [ersatz.get(i)!] : [z]));
    // Leerzeilen zusammenziehen, nichts am Anfang und Ende
    const neu: string[] = [];
    for (const z of zeilen) {
        if (z.trim() === "" && (neu.length === 0 || neu[neu.length - 1]!.trim() === "")) continue;
        neu.push(z);
    }
    while (neu.length > 0 && neu[neu.length - 1]!.trim() === "") neu.pop();
    return neu.join("\n");
}
