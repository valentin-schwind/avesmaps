/**
 * Der Zwischenspeicher der Auswertung (WI-0257): im Prozess, begrenzt nach Zahl und Größe, nichts davon in der Datenbank. Ein Eintrag gilt für den Schlüssel UND den Stand, mit dem er gerechnet wurde
 * (Fingerabdrücke der aktiven Regeln plus Kartenstand, `ermittleKartenstand`); ein anderer Stand ist ein Fehlgriff, der Eintrag wird verworfen und neu gerechnet.
 *
 * Die ältesten fliegen zuerst (ein Lesen schiebt nach vorn). Eine einzelne Antwort, die allein die Größe sprengt, wird gar nicht erst gehalten.
 */
export class Zwischenspeicher<T> {
    private readonly eintraege = new Map<string, { stand: string; wert: T; bytes: number }>();
    private bytes = 0;
    private readonly hoechstensEintraege: number;
    private readonly hoechstensBytes: number;

    /** Kein Parameter-Property: die Server laufen strip-only (nur Typen werden entfernt). */
    constructor(hoechstensEintraege: number, hoechstensBytes: number) {
        this.hoechstensEintraege = hoechstensEintraege;
        this.hoechstensBytes = hoechstensBytes;
    }

    get(schluessel: string, stand: string): T | undefined {
        const da = this.eintraege.get(schluessel);
        if (da === undefined) return undefined;
        if (da.stand !== stand) {
            this.entferne(schluessel);
            return undefined;
        }
        this.eintraege.delete(schluessel);
        this.eintraege.set(schluessel, da);
        return da.wert;
    }

    set(schluessel: string, stand: string, wert: T, bytes: number): void {
        this.entferne(schluessel);
        if (bytes > this.hoechstensBytes) return;
        this.eintraege.set(schluessel, { stand, wert, bytes });
        this.bytes += bytes;
        while (this.eintraege.size > this.hoechstensEintraege || this.bytes > this.hoechstensBytes) {
            const aeltester = this.eintraege.keys().next().value;
            if (aeltester === undefined) break;
            this.entferne(aeltester);
        }
    }

    leere(): void {
        this.eintraege.clear();
        this.bytes = 0;
    }

    get groesse(): { eintraege: number; bytes: number } {
        return { eintraege: this.eintraege.size, bytes: this.bytes };
    }

    private entferne(schluessel: string): void {
        const da = this.eintraege.get(schluessel);
        if (da === undefined) return;
        this.bytes -= da.bytes;
        this.eintraege.delete(schluessel);
    }
}
