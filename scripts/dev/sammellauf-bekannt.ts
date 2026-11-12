// Bekannte Rote im Sammellauf (`scripts/dev/sammellauf.ts`, WI-0228).
//
// 🔴 Betreiber 2026-10-19 über die Hauptorchestrierung, wörtlich: „Kameratest -> unwichtig, fixen wir später / A“. A heißt: Ein bekannter
// roter Fall läuft mit, wird aber nicht nachgefahren oder eingegrenzt, steht in der Notiz als „bekannt rot“ und macht ihre erste Zeile nicht
// „rot“. Die Production-Freigabe bleibt damit möglich, der Fall bleibt sichtbar.
//
// 🔴 **Einziger Freigeber dieser Liste ist die Hauptorchestrierung.** Ein neuer Eintrag nur mit ihrem Wort (im Commit zitiert); jeder Eintrag
// verfällt nach `BEKANNT_TAGE` Tagen ab `seit` und zählt danach wieder als rot.

export interface BekanntRot {
    /** Die Datei, repo-relativ (`apps/web/e2e/…`, `apps/server/test/…`). */
    readonly datei: string;
    /** Ein Teil des Titels des roten Falls; fehlt er, gilt die ganze Datei. */
    readonly fall?: string;
    readonly grund: string;
    /** Die Sitzung, die den Fall führt. */
    readonly sitzung: string;
    /** Tag der Freigabe, `JJJJ-MM-TT`. */
    readonly seit: string;
}

export const BEKANNT_TAGE = 7;

export const BEKANNT_ROT: readonly BekanntRot[] = [
    {
        datei: "apps/web/e2e/playmode.spec.ts",
        fall: "Kamera folgt im Gebirge ruhig",
        grund: "seitliches Gleiten 54 statt 45 px/s seit Flughöhe 8 und halber Reisegeschwindigkeit (71b6592ea); Messung ruht auf Ansage des Betreibers",
        sitzung: "Kamera und Wiki-Feld (WI-0218)",
        seit: "2026-10-19",
    },
];

/** Gilt der Eintrag noch (nicht älter als `BEKANNT_TAGE` Tage)? */
export function giltNoch(eintrag: BekanntRot, jetzt: Date): boolean {
    const ab = Date.parse(`${eintrag.seit}T00:00:00Z`);
    return Number.isFinite(ab) && jetzt.getTime() < ab + (BEKANNT_TAGE + 1) * 86_400_000;
}

/** Der gültige Eintrag, der diesen roten Fall deckt, oder `undefined`. */
export function bekanntFuer(
    datei: string,
    titel: string | undefined,
    jetzt: Date,
    liste: readonly BekanntRot[] = BEKANNT_ROT,
): BekanntRot | undefined {
    return liste.find(
        (e) =>
            e.datei === datei &&
            giltNoch(e, jetzt) &&
            (e.fall === undefined || (titel !== undefined && titel.includes(e.fall))),
    );
}
