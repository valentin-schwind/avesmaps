import { wikiKonfiguration } from "../wiki/config.ts";
import { erzeugeWikiClient, type WikiClient } from "../wiki/transport/client.ts";
import { WikiTransportFehler } from "../wiki/transport/fehler.ts";
import { JobFailure } from "./handlers.ts";

/**
 * Der Wiki-Client eines Auftrags, der das Wiki wirklich anruft (heute der Vergleich EINES Artikels, `wiki-artikel-job.ts`, und der Abgleich eines Objekts, `wiki-objekt-sync.ts`).
 * Bis WI-0294 stand das beim Auftrag `wiki_kategorien`; der Wiki-Teil ist entfallen, der Client bleibt. Lokal sperrt der Erzeuger jeden Abruf (`wikiAbrufErlaubt`).
 */

/** Was ein Auftrag vom Client braucht: Anfragen stellen und den Status des Transports lesen. */
export type WikiClientFuerAbfrage = Pick<WikiClient, "frage" | "status">;

/** Der Client dieses Prozesses. 🔴 Lokal wirft der Erzeuger (`wikiAbrufErlaubt`), bevor irgendetwas hinausgeht; das ist ein harter Fehler, kein Wiederholen. */
export function erzeugeClientFuerAuftrag(environment: NodeJS.ProcessEnv): WikiClientFuerAbfrage {
    const konfig = wikiKonfiguration(environment);
    try {
        return erzeugeWikiClient({
            taktVerzeichnis: konfig.taktWurzel,
            zugangsdatei: konfig.zugangsdatei,
            environment,
        });
    } catch (fehler) {
        if (fehler instanceof WikiTransportFehler) throw new JobFailure(fehler.code, fehler.message, false);
        throw fehler;
    }
}

/** Der Satz zum Fehler: die Meldung des Transports, dazu der Code der API beziehungsweise der HTTP-Status, wenn es einen gibt (beide sind kurze Wörter des Wikis, nie ein Geheimnis). */
export function fehlerText(fehler: WikiTransportFehler): string {
    const zusatz = [fehler.apiCode, fehler.status === undefined ? undefined : `HTTP ${String(fehler.status)}`].filter(
        (teil): teil is string => teil !== undefined,
    );
    return zusatz.length === 0 ? fehler.message : `${fehler.message} (${zusatz.join(", ")})`;
}
