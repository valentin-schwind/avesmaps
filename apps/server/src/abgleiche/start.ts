import {
    ABGLEICH_JOBARTEN,
    ABGLEICH_KATEGORIE,
    AVENTURIA,
    abgleichNimmtAuftraege,
    type AbgleichAusfuehrung,
    type AbgleichQuelle,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { bereicheAusgelassenBeiKategorie } from "../wiki/abgleich/schalter-lesen.ts";

/**
 * Einen Abgleich einreihen (WI-0127 SYS-14): die EINE Stelle für die Route der Systemsteuerung und die Kommandozeile
 * (`abgleich-starten`). Beide rufen sie in der Transaktion, in der sie auch ihr Protokollereignis schreiben (SYS-0001 §9d.2,
 * Protokollpflicht: genau ein Ereignis je Start, auch über die Kommandozeile).
 *
 * - Diese Umgebung führt keine Aufträge dieser Quelle aus (`ABGLEICHE`, Quelle `aus`): 503 `sync_unavailable`, nichts eingereiht.
 *   `worker` und `korridor` reihen ein; bei `korridor` übernimmt Claudios Abholer (`job_sync_claim`, Migration 0098).
 * - Wartet schon ein Auftrag DIESER Zeile: 409 `sync_running` mit seiner Kennung, nichts eingereiht. Ein laufender sperrt nicht;
 *   hinter ihm wartet höchstens einer.
 * - Sonst über `job_enqueue` (SECURITY DEFINER, Migration 0094); `actorRef` ist die pseudonyme `person.id` oder `cli:<Systembenutzer>`.
 *
 * 🔴 **Einreihen hinter einem laufenden Zug** (Betreiber 2026-10-17: „wenn ein legacy zug läuft kann kein weiterer legacy zu in die
 * warteschlange hinzugefügt werden, dafür ist die doch da? dass man wartet?“; Handover
 * `2026-10-17-legacy-zug-einreihen-hinter-laufendem-an-claudia.md`). Bis dahin sperrte ein wartender oder laufender Zug jeden anderen
 * (WI-0141, aus der Zeit vor der gemeinsamen Warteschlange). Heute fährt der Betrieb sie ohnehin nacheinander: Alle Abgleiche reihen
 * mit demselben Bereich ein (`mapDomain`, der Planer lässt im selben Bereich keinen zweiten neben einem laufenden zu), der Dirigent
 * startet je Art höchstens einen (`maxConcurrent`), Claudios Abholer hält eigene Sperren, die Domänensperre (T17) steht dahinter.
 * Also reiht jede Zeile ein, auch hinter ihrem eigenen laufenden Auftrag; je Zeile wartet aber höchstens einer, der zweite Druck
 * bleibt 409 (dieselbe Zeile: dieselbe Art und dieselbe Kategorie). So entstehen keine Doppelten.
 *
 * 🔴 **Der Production-Zug schließt alles aus** (WI-0144): Er ersetzt die Kartendaten, die Kacheln UND die Medien der Umgebung in
 * einem Lauf. Also sperrt er jeden anderen Abgleich, und jeder andere sperrt ihn. Heute steht er allein in seiner Umgebung
 * (`production:korridor` verbirgt die übrigen Zeilen), aber die Regel hält auch dann, wenn jemand das später lockert.
 */

/** Welche Jobarten einen Start ganz ausschließen, wartend oder laufend: der Production-Zug alle, jeder andere ihn. */
function exklusiv(quelle: AbgleichQuelle): string[] {
    if (quelle === "production") return [...new Set(Object.values(ABGLEICH_JOBARTEN))];
    return [ABGLEICH_JOBARTEN.production];
}

/** Das Ereignis eines Starts im Protokoll; es gehört zu den System-Ereignissen (`system.*`, SYS-0001 §9d.2). */
export const SYNC_EVENT = "system.sync_requested" as const;

export function assertExecutes(mode: AbgleichAusfuehrung | undefined): void {
    // 🔴 Nur `worker` und `korridor` nehmen an. `aus`, `noch_nicht` und `verborgen` (WI-0144) antworten alle 503: Eine Zeile,
    //    die hier gar nicht steht, darf über die Route erst recht nichts einreihen.
    if (!abgleichNimmtAuftraege(mode ?? "aus")) {
        throw new ApiError(503, "sync_unavailable", "Auf dieser Umgebung startet die Verwaltung keinen Abgleich.");
    }
}

export async function enqueueAbgleich(
    tx: Queryable,
    input: { quelle: AbgleichQuelle; actorRef: string },
): Promise<{ kind: string; jobId: string }> {
    const kind = ABGLEICH_JOBARTEN[input.quelle];
    const kategorie = ABGLEICH_KATEGORIE[input.quelle];
    // 🔴 WI-0253 D-1: Ein Bereich, der dem WikiSync gehört (seit dem Cutoff 2026-11-02 jeder mit angeschlossener Übernahme, in jeder Umgebung), wird vom Legacy-Zug nicht mehr gefahren (Vali 2026-10-25). Der Zug seiner Kategorie reiht nicht
    // mehr ein: Er überschriebe die wiki-eigenen Felder, die ihm nicht mehr gehören. Der ganze Zug (ohne Kategorie) lässt den Bereich selbst aus (I8, I17).
    if (kategorie !== null) {
        const abgegeben = await bereicheAusgelassenBeiKategorie(tx, kategorie);
        if (abgegeben.length > 0) {
            throw new ApiError(
                409,
                "bereich_gehoert_wikisync",
                "Diese Kategorie gehört in dieser Umgebung ganz oder teilweise dem WikiSync; hier wird nichts importiert.",
                { kategorie, bereiche: abgegeben },
            );
        }
    }
    const [running] = await tx<{ public_id: string }[]>`
        SELECT public_id::text AS public_id FROM job
         WHERE state IN ('QUEUED', 'RUNNING')
           AND (kind = ANY (${exklusiv(input.quelle)}::text[])
                OR (state = 'QUEUED' AND kind = ${kind} AND (input_ref->>'kategorie') IS NOT DISTINCT FROM ${kategorie}::text))
         LIMIT 1
    `;
    if (running !== undefined) {
        throw new ApiError(409, "sync_running", "Dieser Abgleich wartet oder läuft schon.", { job: running.public_id });
    }
    const eingabe = kategorie === null ? { quelle: input.quelle } : { quelle: input.quelle, kategorie };
    const [job] = await tx<{ public_id: string }[]>`
        SELECT public_id::text AS public_id
          FROM job_enqueue(${kind}, 1::smallint, ${AVENTURIA.mapDomain}, ${input.actorRef}, ${tx.json(eingabe)})
    `;
    return { kind, jobId: job!.public_id };
}
