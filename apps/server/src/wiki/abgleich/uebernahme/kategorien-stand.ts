import { wikisyncHatKategorien, type WikisyncBereich } from "@avesmaps3d/shared";
import type { Queryable } from "../../../database.ts";
import { ladeVorschauLauf } from "./protokoll.ts";

/**
 * Hat die Vorschau die Kategorien-Datei gelesen (WI-0294; vorher der Wiki-Teil, WI-0253 D-1, C-2; Vali 2026-10-25: „Dump aktualisiert, Sync steht aus. Solange kein Update der Daten“)? Ein Bereich mit
 * Kategorien wird erst übernommen, wenn seine Vorschau Ortsgröße, Bauwerkart und Kontinent aus der Datei `dump_categorylinks.sql.gz` gerechnet hat: Was erst eine Vorlage im Wiki setzt, steht nicht im Dump,
 * sondern in der Tabelle der Kategorien (`wiki/kategorien/aus-datei.ts`). Ohne Datei bleiben die Felder ungeprüft, und bei einem Abbruch steht nichts halb geschrieben.
 *
 * - **Kraftlinien, Wege und Gipfel haben keine Kategorien** (`WIKISYNC_MIT_KATEGORIEN`): Sie gelten sofort als fertig.
 * - **Fertig** heißt: Die Vorschau, aus der übernommen würde (die genannte oder die jüngste fertige des Bereichs), trägt den Pin einer Kategorien-Datei (`wikisync_lauf.kategorien_sha256`). Das gilt
 *   für diese Vorschau allein: Rechnet jemand sie neu (ein neuer Dump) und die Datei fehlt dann, steht der Sync wieder aus. Das ist die EINE Stelle, die die Übernahme fragt (`pruefen.ts`).
 * - Gibt es gar keine Vorschau, ist die Frage noch nicht zu beantworten: Die Übernahme sagt dann `kein_lauf`.
 */
export type KategorienStand = { fertig: true } | { fertig: false; text: string };

export const KATEGORIEN_FEHLEN =
    "Dump gelesen, Kategorien-Datei fehlt: Die Daten bleiben unverändert. Sobald die Datei im Dump-Ordner liegt, bitte die Vorschau neu berechnen.";

export async function kategorienFertig(
    db: Queryable,
    bereich: WikisyncBereich,
    laufId?: number,
): Promise<KategorienStand> {
    if (!wikisyncHatKategorien(bereich)) return { fertig: true };
    const vorschau = await ladeVorschauLauf(db, bereich, laufId);
    if (vorschau === undefined) return { fertig: true };
    return vorschau.kategorien === null ? { fertig: false, text: KATEGORIEN_FEHLEN } : { fertig: true };
}
