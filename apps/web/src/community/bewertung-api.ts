import {
    BEWERTUNGEN_URL,
    type BewertungAntwort,
    type BewertungBody,
    type BewertungMeldenBody,
    type GefaelltAntwort,
    type MeldungAntwort,
} from "@avesmaps3d/shared";
import { postJson, type Fetcher } from "../auth/api";

/**
 * Die öffentliche Seite der Bewertungen an der Leitung (WI-0269 C10; Server: `apps/server/src/routes/bewertungen.ts`, Vertrag `packages/shared/src/bewertungen.ts`). Drei Aufrufe, alle
 * an dieselbe Herkunft und im Umschlag der Fehler (ADR-0018); die Fehlerarten und Sätze sind die der Meldungen (`api.ts`, `fehlerArt`).
 *
 * - 🔴 **Eine Kennung je Formular** (ADR-0019): `operationId` wird beim Öffnen gezogen und bleibt, bis das Formular zugeht; wer erneut sendet, legt nie eine zweite Bewertung an.
 * - **Gefällt mir** schickt nur `1` oder `-1`. Wer es war, kennt der Server nicht; „einmal je Browser“ hält `bewertungen-gemocht.ts`.
 */

export const sendeBewertung = (body: BewertungBody, fetcher?: Fetcher): Promise<BewertungAntwort> =>
    postJson<BewertungAntwort>(BEWERTUNGEN_URL, body, fetcher);

export const sendeGefaellt = (id: string, delta: 1 | -1, fetcher?: Fetcher): Promise<GefaelltAntwort> =>
    postJson<GefaelltAntwort>(`${BEWERTUNGEN_URL}/${encodeURIComponent(id)}/gefaellt`, { delta }, fetcher);

export const sendeBewertungsMeldung = (
    id: string,
    body: BewertungMeldenBody,
    fetcher?: Fetcher,
): Promise<MeldungAntwort> =>
    postJson<MeldungAntwort>(`${BEWERTUNGEN_URL}/${encodeURIComponent(id)}/melden`, body, fetcher);
