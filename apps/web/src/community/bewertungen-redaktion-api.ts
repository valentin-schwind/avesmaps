import {
    BEWERTUNGEN_URL,
    type BewertungDetail,
    type BewertungGrund,
    type BewertungListe,
    type BewertungQuittung,
} from "@avesmaps3d/shared";
import { getJson, newOperationId, postJson, type Fetcher } from "../auth/api";
import { withConfirmation } from "../auth/bestaetigen";
import { fehlerArt } from "./api";
import type { anfrageVon } from "./bewertungen-modell";

/**
 * Die Redaktion der Bewertungen an der Leitung (WI-0269 C10; Server: `apps/server/src/routes/bewertungen.ts`, Vertrag `packages/shared/src/bewertungen.ts`). Lesen: die Liste und eine Bewertung. Schritte: je ein Aufruf mit der
 * Revision, die die Person gesehen hat (`baseRevision`); der Server lehnt einen veralteten Stand mit `community_conflict` ab, nie ein stilles Überschreiben. Die Fehler übersetzt `redaktionFehler` (`redaktion-api.ts`).
 *
 * - 🔴 **Eine Kennung je Handlung** (ADR-0019): `kennung` gibt für denselben Schritt an derselben Bewertung dieselbe `operationId` zurück, bis er gelungen ist oder der Server ihn abgelehnt hat; ein erneutes Senden nach einem
 *   Netzfehler legt nie zwei Einträge an.
 * - „Inhalt löschen“ verlangt einen frischen Passkey (Stufe S); der Server sagt es, und die Oberfläche fragt nach und wiederholt einmal (`withConfirmation`).
 */

export type BewertungsAnfrage = ReturnType<typeof anfrageVon>;

export function ladeBewertungen(frage: BewertungsAnfrage, fetcher?: Fetcher): Promise<BewertungListe> {
    const parameter = new URLSearchParams({ segment: frage.segment, sortierung: frage.sortierung });
    if (frage.q !== undefined) parameter.set("q", frage.q);
    if (frage.sterne !== undefined) parameter.set("sterne", String(frage.sterne));
    if (frage.herkunft !== undefined) parameter.set("herkunft", frage.herkunft);
    if (frage.gemeldet === true) parameter.set("gemeldet", "true");
    if (frage.zurueckgehalten === true) parameter.set("zurueckgehalten", "true");
    return getJson<BewertungListe>(`${BEWERTUNGEN_URL}?${parameter.toString()}`, fetcher);
}

export const ladeBewertung = (id: string, fetcher?: Fetcher): Promise<BewertungDetail> =>
    getJson<BewertungDetail>(`${BEWERTUNGEN_URL}/${encodeURIComponent(id)}`, fetcher);

export type BewertungsSchritt = "sichten" | "freigeben" | "verbergen" | "einblenden" | "inhalt-loeschen";

const adresse = (id: string, schritt: BewertungsSchritt): string =>
    `${BEWERTUNGEN_URL}/${encodeURIComponent(id)}/${schritt}`;

/** Die Kennungen der Handlungen, die noch keinen Abschluss haben: derselbe Schritt an derselben Bewertung schickt dieselbe. */
const offeneKennungen = new Map<string, string>();

export function kennung(id: string, schritt: BewertungsSchritt): string {
    const schluessel = `${id}/${schritt}`;
    let kennungId = offeneKennungen.get(schluessel);
    if (kennungId === undefined) {
        kennungId = newOperationId();
        offeneKennungen.set(schluessel, kennungId);
    }
    return kennungId;
}

export const kennungFrei = (id: string, schritt: BewertungsSchritt): void => {
    offeneKennungen.delete(`${id}/${schritt}`);
};

/** Führt einen Schritt aus. Ein Netzfehler lässt die Kennung stehen (das erneute Senden ist gefahrlos), jede andere Antwort gibt sie frei. */
export async function fuehreAus(
    id: string,
    schritt: BewertungsSchritt,
    body: Record<string, unknown>,
    optionen: { fetcher?: Fetcher; bestaetigen?: boolean } = {},
): Promise<BewertungQuittung> {
    const sende = (): Promise<BewertungQuittung> =>
        postJson<BewertungQuittung>(
            adresse(id, schritt),
            { operationId: kennung(id, schritt), ...body },
            optionen.fetcher,
        );
    try {
        const antwort = optionen.bestaetigen === true ? await withConfirmation(sende) : await sende();
        kennungFrei(id, schritt);
        return antwort;
    } catch (fehler) {
        if (fehlerArt(fehler) !== "netz") kennungFrei(id, schritt);
        throw fehler;
    }
}

export const sichteBewertung = (id: string, baseRevision: number): Promise<BewertungQuittung> =>
    fuehreAus(id, "sichten", { baseRevision });
export const gibBewertungFrei = (id: string, baseRevision: number): Promise<BewertungQuittung> =>
    fuehreAus(id, "freigeben", { baseRevision });
export const blendeBewertungEin = (id: string, baseRevision: number): Promise<BewertungQuittung> =>
    fuehreAus(id, "einblenden", { baseRevision });
export const verbirgBewertung = (
    id: string,
    baseRevision: number,
    grund: BewertungGrund,
    vorgaengeAbschliessen: boolean,
): Promise<BewertungQuittung> => fuehreAus(id, "verbergen", { baseRevision, grund, vorgaengeAbschliessen });
/** Name, Text und Datum weg (Datenschutz): braucht `moderate_community` und einen frischen Passkey. */
export const loescheBewertungsInhalt = (id: string, baseRevision: number): Promise<BewertungQuittung> =>
    fuehreAus(id, "inhalt-loeschen", { baseRevision }, { bestaetigen: true });
