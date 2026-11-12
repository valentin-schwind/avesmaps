import type { KarteVorschauSperre, MamKarteBild } from "@avesmaps3d/shared";
import { t, type MessageKey } from "../i18n/i18n";
import { grundName } from "./medien-text";

/**
 * „Vorschau erzeugen“ (WI-0287 Stufe 1, Punkt 5; Entwurf Fassung 5: `sperrgrund`, `erzeugenSatz`, `satzVon`, `platzPanel` Zweig Konflikt). Reine Funktionen, damit Vitest sie ohne
 * Browser prüft. Ob gesperrt ist, sagt der Server (`vorschauSperre` an der Karte, dieselbe Regel wie die Operation); hier steht nur, was der Platz und der Inspector dazu sagen.
 */

/** Der Satz, warum der Knopf gesperrt ist (sichtbar unter ihm, Guide §30.5); `undefined`: nicht gesperrt. */
export function vorschauSperrSatz(sperre: KarteVorschauSperre | null | undefined): string | undefined {
    return sperre === null || sperre === undefined ? undefined : t(`medien.karten.vorschau.sperre.${sperre}`);
}

/**
 * Der Satz unter „✚ Vorschau erzeugen“: der Sperrgrund, sonst woraus die Vorschau entsteht und was ihr folgt. Hat die erste Version eine Bezeichnung (WI-0287 Stufe 2), nennt
 * der Satz sie („Entsteht aus der Version „Spielerversion“.“, Entwurf `erzeugenSatz`).
 */
export function erzeugenSatz(sperre: KarteVorschauSperre | null | undefined, version?: string | null): string {
    return (
        vorschauSperrSatz(sperre) ??
        (version === null || version === undefined || version.trim() === ""
            ? t("medien.karten.vorschau.entsteht")
            : t("medien.karten.vorschau.entstehtVersion", { version: version.trim() }))
    );
}

/** Der Name, den der Konflikt vorschlägt: derselbe mit „(2)“ (Entwurf). */
export const andererName = (titel: string): string => `${titel} (2)`;

/**
 * Was der Platz über ein Bild sagt, bevor die Entscheidung der Policy zählt: Wird es noch gerechnet, „Wird gerechnet. Das Bild erscheint von selbst.“; hält es der Notaus seiner
 * Karte, „Offline: der Notaus der Karte gilt auch hier.“ Sonst `undefined` (dann sagt der Platz, ob es öffentlich ist).
 */
export function bildZustandSatz(bild: Pick<MamKarteBild, "technicalState" | "erzeugtAus">): string | undefined {
    if (bild.technicalState === "pending") return t("medien.karten.vorschau.rechnet");
    if (bild.erzeugtAus?.offline === true) return t("medien.karten.vorschau.offline");
    return undefined;
}

/**
 * Der Satz der Freigabe eines Bildes am Eintrag (Entwurf `satzVon`): erst der Zustand („Wird gerechnet …“, Notaus der Karte), dann ein stillgelegter Eintrag („Nicht öffentlich: der
 * Eintrag ist stillgelegt.“ statt „zurückgezogen“), sonst die Entscheidung der Policy an genau dieser Stelle. Für die Plätze und jede Version der Karte.
 */
export function bildFreigabeSatz(
    bild: Pick<MamKarteBild, "technicalState" | "erzeugtAus" | "publication">,
    eintragAktiv: boolean,
): string {
    return (
        bildZustandSatz(bild) ??
        (!eintragAktiv && !bild.publication.public && bild.publication.reason === "retired"
            ? t("medien.freigabe.stillgelegt")
            : t(bild.publication.public ? "medien.freigabe.ja" : "medien.freigabe.nein", {
                  grund: grundName(bild.publication.reason),
              }))
    );
}

/**
 * Ein Satz mit einem Sprung mitten darin („Erzeugt aus {karte}. …“): Der Text vor und nach dem Platzhalter, damit die Oberfläche dort einen Knopf setzt. Die Wortfolge
 * bestimmt die Sprache (dieselbe Technik wie „Liegt jetzt unter {liste} als {titel}.“).
 */
export function umSprung(
    schluessel: MessageKey,
    platz: string,
    werte: Record<string, string> = {},
): { davor: string; danach: string } {
    const [davor = "", danach = ""] = t(schluessel, { ...werte, [platz]: "\u0001" }).split("\u0001");
    return { davor, danach };
}
