import {
    kartenvorschlagNummer,
    type KartenvorschlagDateityp,
    type KartenvorschlagStatus,
    type KartenvorschlagZurueckziehen,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ladeVorschlag, nichtGefunden, nimmWerkAus, uebergangFehlt, type Vorschlag } from "./db.ts";

/**
 * Die Statusseite des Einreichers und das Zurückziehen (WI-0275 Stufe B), alles ohne Konto: Der geheime Schlüssel öffnet genau seinen Vorschlag.
 * Ein falscher Schlüssel antwortet immer mit demselben 404-Satz (`nichtGefunden`).
 *
 * - **Zurückziehen** geht vor der Entscheidung (`incoming`, `technical_failed`, `pending`) und ist idempotent: ein zweiter Aufruf liefert den Stand.
 *   Das Werk einer Datei wird `rejected` (keine Vorschau, keine Veröffentlichung); die Bytes räumt die Aufbewahrung auf (offener Punkt Stufe C).
 * - Angenommen, abgelehnt: nichts mehr zu tun; der Einreicher sieht den Stand und, wenn die Redaktion einen nannte, den Grund.
 */

const ZURUECKZIEHBAR: ReadonlySet<Vorschlag["state"]> = new Set(["incoming", "technical_failed", "pending"]);

/** Der Stand eines Vorschlags für den Einreicher; nie der Schlüssel, nie eine interne Kennung. */
export function alsStatus(vorschlag: Vorschlag): KartenvorschlagStatus {
    return {
        nummer: kartenvorschlagNummer(vorschlag.nummer),
        zustand: vorschlag.state,
        weg: vorschlag.way === "link" ? "link" : "datei",
        titel: vorschlag.title,
        link: vorschlag.linkUrl,
        dateiTyp: (vorschlag.fileMime as KartenvorschlagDateityp | null) ?? null,
        eingegangenAm: vorschlag.submittedAt.toISOString(),
        entschiedenAm: vorschlag.decidedAt?.toISOString() ?? null,
        grund: vorschlag.state === "rejected" ? vorschlag.decisionReason : null,
        zurueckziehbar: ZURUECKZIEHBAR.has(vorschlag.state),
    };
}

/** Der Stand zum Schlüssel; `null`, wenn es keinen Vorschlag gibt. */
export async function statusLesen(db: Queryable, schluessel: string): Promise<KartenvorschlagStatus | null> {
    const vorschlag = await ladeVorschlag(db, schluessel);
    return vorschlag === undefined ? null : alsStatus(vorschlag);
}

/** Zieht den Vorschlag zurück und liefert den Stand danach. */
export async function zurueckziehen(db: Database, body: KartenvorschlagZurueckziehen): Promise<KartenvorschlagStatus> {
    return (await db.begin(async (tx) => {
        const vorschlag = await ladeVorschlag(tx, body.schluessel, { gesperrt: true });
        if (vorschlag === undefined) throw nichtGefunden();
        // Wiederholung (oder schon zurückgezogen): derselbe Stand, keine zweite Änderung.
        if (vorschlag.state === "withdrawn") return alsStatus(vorschlag);
        if (!ZURUECKZIEHBAR.has(vorschlag.state)) throw uebergangFehlt("nicht_zurueckziehbar", vorschlag.state);
        await nimmWerkAus(tx, vorschlag.mediaAssetId);
        await tx`
            UPDATE citymap_suggestion SET state = 'withdrawn', state_changed_at = now() WHERE id = ${vorschlag.id}::bigint
        `;
        const danach = await ladeVorschlag(tx, body.schluessel);
        if (danach === undefined) throw nichtGefunden();
        return alsStatus(danach);
    })) as KartenvorschlagStatus;
}
