import type { MamAssetSummary, OperationReceipt } from "@avesmaps3d/shared";
import { ApiFailure } from "../auth/api";
import { duplikatLage } from "./medien-duplikat-modell";
import type { MedienClient } from "./medien-client";
import { Handlung, assetDerQuittung } from "./medien-operationen";

/**
 * Mehrere Bilder auf einmal in eine Galerie hochladen (WI-0068 MAM-R3, Blatt P6 Abschnitt 2): „Eine Reihe mit einem Ergebnis je Datei.“
 * Rechte und Entstehung stehen EINMAL im Formular und werden je Bild einzeln gespeichert.
 *
 * - **Teilfehler sind der Normalfall**: Eine abgewiesene Datei hält die anderen nicht auf. Eine Datei, die hochgeladen, aber nicht
 *   eingeordnet wurde, bekommt „↺ Erneut“, das NUR das Einordnen wiederholt; kein Bild landet dadurch zweimal in der Galerie.
 * - **Bytegleiche Dateien** (Betreiber 2026-10-17: „Bytegleiche Treffer werden je Datei als „bereits vorhanden“ gemeldet und können
 *   übernommen werden, ohne erneut als neue Assets angelegt zu werden.“): Die Zeile nennt das vorhandene Bild; „übernehmen“ legt es in
 *   die Galerie, statt hochzuladen. Steht es dort schon, sagt die Zeile das.
 * - Nacheinander, in der Reihenfolge der Wahl: Jede Einordnung hebt die Revision der Galerie, die nächste trägt die neue.
 * - Was nicht versprochen wird: dass alle Dateien gemeinsam gelingen oder scheitern. Hochgeladene Bytes lassen sich nicht zurücknehmen.
 */
export type StapelStand =
    /** Die SHA-256 wird gerechnet und nachgefragt. */
    | "prueft"
    /** Neu, wird hochgeladen. */
    | "neu"
    /** Dieselben Bytes gibt es schon (`treffer`); mit `uebernehmen` kommt das vorhandene Bild in die Galerie. */
    | "vorhanden"
    | "laedt"
    | "ordnet"
    | "fertig"
    /** Der Server hat die Datei abgewiesen (Format, Größe …); `meldung` sagt warum. */
    | "abgewiesen"
    /** Hochgeladen bzw. vorhanden, aber nicht eingeordnet: „↺ Erneut“ ordnet nur ein. */
    | "offen"
    /** Das Bild steht schon in dieser Galerie. */
    | "schonDrin"
    /** Vorhanden und bewusst nicht übernommen. */
    | "uebersprungen";

export interface StapelZeile {
    readonly schluessel: string;
    readonly datei: File;
    stand: StapelStand;
    treffer: MamAssetSummary | undefined;
    uebernehmen: boolean;
    /** Das Werk, das eingeordnet wird: das hochgeladene oder der Treffer. */
    assetId: string | undefined;
    /** Platz in der Galerie nach dem Einordnen (1, 2, …). */
    nummer: number | undefined;
    meldung: string | undefined;
    readonly hochladen: Handlung;
    readonly einordnen: Handlung;
}

let zaehler = 0;
export function neueZeile(datei: File): StapelZeile {
    zaehler += 1;
    return {
        schluessel: `stapel-${String(zaehler)}`,
        datei,
        stand: "prueft",
        treffer: undefined,
        uebernehmen: true,
        assetId: undefined,
        nummer: undefined,
        meldung: undefined,
        hochladen: new Handlung(),
        einordnen: new Handlung(),
    };
}

/** Nach der Wahl: gibt es die Datei schon? Ohne Antwort bleibt sie neu; der Server prüft beim Hochladen selbst. */
export async function pruefeZeile(
    zeile: StapelZeile,
    client: Pick<MedienClient, "gleicheBytes">,
    sha256: (datei: Blob) => Promise<string>,
    signal: AbortSignal,
): Promise<void> {
    try {
        const lage = duplikatLage(await client.gleicheBytes(await sha256(zeile.datei), signal));
        if (lage !== undefined) {
            zeile.treffer = lage.vorschlag;
            zeile.assetId = lage.vorschlag.id;
            zeile.stand = "vorhanden";
            return;
        }
    } catch {
        // Ohne Antwort ein gewöhnliches Hochladen.
    }
    zeile.stand = "neu";
}

export interface StapelSchritte {
    /** Lädt die Datei hoch und gibt die Quittung zurück (Formular „für alle Dateien“). */
    hochladen(zeile: StapelZeile, operationId: string): Promise<OperationReceipt>;
    /** Legt das Werk in die Galerie, gegen die gesehene Revision. */
    einordnen(assetId: string, galerieRevision: number, operationId: string): Promise<OperationReceipt>;
    /** Der Text zu einem Fehler (`operationsFehler(error).text`). */
    fehlerText(error: unknown): string;
}

/** Was eine Zeile nach dem Senden noch zu tun hat. */
export function zuSenden(zeile: StapelZeile): boolean {
    if (zeile.stand === "neu" || zeile.stand === "offen") return true;
    return zeile.stand === "vorhanden" && zeile.uebernehmen;
}

const galerieRevision = (quittung: OperationReceipt): number | undefined =>
    quittung.affected.find((eintrag) => eintrag.kind === "gallery")?.revision;

/**
 * Sendet alle offenen Zeilen nacheinander. `galerie` trägt Revision und Zahl der Bilder und wird mitgeführt; `melde` sagt der
 * Oberfläche nach jedem Schritt Bescheid.
 */
export async function sendeStapel(
    zeilen: readonly StapelZeile[],
    galerie: { revision: number; anzahl: number },
    schritte: StapelSchritte,
    melde: () => void,
): Promise<void> {
    for (const zeile of zeilen) {
        if (zeile.stand === "vorhanden" && !zeile.uebernehmen) {
            zeile.stand = "uebersprungen";
            melde();
            continue;
        }
        if (!zuSenden(zeile)) continue;
        zeile.meldung = undefined;
        if (zeile.assetId === undefined) {
            zeile.stand = "laedt";
            melde();
            try {
                const quittung = await zeile.hochladen.fuehreAus((operationId) =>
                    schritte.hochladen(zeile, operationId),
                );
                zeile.assetId = assetDerQuittung(quittung);
            } catch (error) {
                // Ein Wettlauf: Dieselben Bytes kamen inzwischen an. Dann wird das vorhandene Werk eingeordnet, nicht abgebrochen.
                const vorhanden =
                    error instanceof ApiFailure && error.code === "media_already_exists"
                        ? error.details?.["assetId"]
                        : undefined;
                if (typeof vorhanden === "string") {
                    zeile.assetId = vorhanden;
                } else {
                    zeile.stand = "abgewiesen";
                    zeile.meldung = schritte.fehlerText(error);
                    melde();
                    continue;
                }
            }
        }
        if (zeile.assetId === undefined) {
            zeile.stand = "abgewiesen";
            melde();
            continue;
        }
        zeile.stand = "ordnet";
        melde();
        const assetId = zeile.assetId;
        try {
            const quittung = await zeile.einordnen.fuehreAus((operationId) =>
                schritte.einordnen(assetId, galerie.revision, operationId),
            );
            galerie.revision = galerieRevision(quittung) ?? galerie.revision + 1;
            galerie.anzahl += 1;
            zeile.nummer = galerie.anzahl;
            zeile.stand = "fertig";
        } catch (error) {
            if (error instanceof ApiFailure && error.code === "media_duplicate_file") {
                zeile.stand = "schonDrin";
            } else {
                zeile.stand = "offen";
                zeile.meldung = schritte.fehlerText(error);
            }
        }
        melde();
    }
}
