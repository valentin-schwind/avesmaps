import { createHash, randomBytes } from "node:crypto";
import { ABZUG_LINK_SEKUNDEN, type AbzugQuelle } from "@avesmaps3d/shared";

/**
 * Kurzlebige Links zum Herunterladen eines Abzugs (WI-0251). Ein Link ist ein Zufallswert (32 Byte), der im Speicher dieser Instanz an Person,
 * Umgebung und Kennung hängt, zwei Minuten gilt und genau einmal einzulösen ist. Gespeichert wird nur sein SHA-256, nie der Wert.
 *
 * Er ersetzt nicht die Anmeldung: Die Auslieferung verlangt zusätzlich die Sitzung der Person und `create_backup`. Der Link macht aus der
 * Handlung „Herunterladen“ (mit frischem Passkey) einen Browseraufruf, den ein Link in der Seite auslösen kann, ohne dass die Sitzung ihren
 * Passkey-Nachweis an einen Download-Link hängen muss. Eine Instanz, die zwischen Link und Aufruf neu startet, kennt den Link nicht mehr; dann
 * wird einfach ein neuer ausgestellt.
 */
export interface Linkspeicher {
    ausstellen(person: string, quelle: AbzugQuelle, kennung: string): { token: string; gueltigBis: Date };
    /** Löst einen Link ein: `null`, wenn er unbekannt, abgelaufen, schon benutzt ist oder einer anderen Person gehört. */
    einloesen(token: string, person: string): { quelle: AbzugQuelle; kennung: string } | null;
}

interface Eintrag {
    person: string;
    quelle: AbzugQuelle;
    kennung: string;
    bis: number;
}

const HOECHSTENS = 64;

export function erzeugeLinkspeicher(jetzt: () => number = Date.now): Linkspeicher {
    const eintraege = new Map<string, Eintrag>();
    const hash = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
    const aufraeumen = (): void => {
        const nun = jetzt();
        for (const [schluessel, eintrag] of eintraege) if (eintrag.bis <= nun) eintraege.delete(schluessel);
        // Wer ständig neue Links verlangt, verdrängt die ältesten, statt den Speicher wachsen zu lassen.
        while (eintraege.size >= HOECHSTENS) {
            const aeltester = eintraege.keys().next().value;
            if (aeltester === undefined) break;
            eintraege.delete(aeltester);
        }
    };
    return {
        ausstellen(person, quelle, kennung) {
            aufraeumen();
            const token = randomBytes(32).toString("base64url");
            const bis = jetzt() + ABZUG_LINK_SEKUNDEN * 1000;
            eintraege.set(hash(token), { person, quelle, kennung, bis });
            return { token, gueltigBis: new Date(bis) };
        },
        einloesen(token, person) {
            const schluessel = hash(token);
            const eintrag = eintraege.get(schluessel);
            if (eintrag === undefined) return null;
            eintraege.delete(schluessel); // einmal
            if (eintrag.bis <= jetzt() || eintrag.person !== person) return null;
            return { quelle: eintrag.quelle, kennung: eintrag.kennung };
        },
    };
}
