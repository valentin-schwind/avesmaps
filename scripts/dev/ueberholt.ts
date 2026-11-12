// Ist der Prüflauf überholt, wenn er an der Prüfbank drankommt? (Hauptorchestrierung 2026-10-18, Vorschlag A der Arbeitshygiene)
//
// Anlass: Die Prüfbank stand bei 19 Tickets, acht davon prüften einen Commit, der nicht mehr der HEAD seiner Arbeitskopie war. Ein solcher
// Lauf kostet bis zu 20 Minuten und urteilt über einen Stand, den niemand mehr pushen will; beenden konnten ihn manche Sitzungen nicht
// (TaskStop beendet nur die Shell, `taskkill` verweigert der Auto-Mode). Darum fragt `vor-dem-push` beim Drankommen selbst nach und endet
// mit „überholt“: eine klare Zeile, Exit-Code `EXIT_UEBERHOLT`, kein Rot. Nur, wenn der Commit nicht ausdrücklich genannt wurde: Wer
// `vor-dem-push -- <commit>` aufruft, will genau diesen Stand (etwa für einen Teil-Push).

/** Exit-Code eines überholten Laufs: weder grün (0) noch rot (1), nichts wurde geprüft. */
export const EXIT_UEBERHOLT = 3;

export interface UeberholtFrage {
    /** Der Commit, den der Lauf prüft (beim Start aufgelöst). */
    readonly sha: string;
    /** Hat der Aufrufer den Commit ausdrücklich genannt (`vor-dem-push -- <commit>`)? Dann ist der Lauf nie überholt. */
    readonly genannt: boolean;
    /** Der HEAD der Arbeitskopie jetzt, mit Titel; `undefined`, wenn er sich nicht lesen lässt (dann gilt der Lauf nicht als überholt). */
    readonly headJetzt: () => { readonly sha: string; readonly betreff: string } | undefined;
}

/** Die Zeile für einen überholten Lauf, oder `undefined`, wenn er prüfen soll. */
export function ueberholtZeile(frage: UeberholtFrage): string | undefined {
    if (frage.genannt) return undefined;
    const head = frage.headJetzt();
    if (head === undefined || head.sha === frage.sha) return undefined;
    return `  ÜBERHOLT  Dieser Lauf prüft ${frage.sha.slice(0, 8)}, der HEAD deiner Arbeitskopie ist jetzt ${head.sha.slice(0, 8)} („${head.betreff.slice(0, 80)}“). Nichts geprüft, die Prüfbank ist wieder frei; für den neuesten Commit neu anstellen.`;
}
