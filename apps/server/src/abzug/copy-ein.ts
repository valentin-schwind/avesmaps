import { once } from "node:events";
import type { Readable } from "node:stream";
import type { TransactionSql } from "postgres";

/**
 * `COPY … FROM STDIN` über postgres.js, dessen Fehler nicht verloren gehen (WI-0251).
 *
 * 🪤 postgres.js beendet den Schreibstrom eines COPY erst, wenn der Server den Befehl bestätigt (`CommandComplete`). Scheitert das COPY (kaputte
 * Daten, ein verletzter Fremdschlüssel), antwortet der Server mit einem Fehler und `ReadyForQuery`:
 *
 * - Schreibt der Strom da noch, zerstört postgres.js ihn mit dem Fehler des Servers; der kommt so beim Aufrufer an.
 * - Ist schon alles geschrieben, ist der Strom längst abgemeldet; `finish` kommt nie, und der Lauf hinge (gemessen 2026-10-24). Darum reiht sich
 *   hinter den Strom eine Sonde (`SELECT 1`) in dieselbe Verbindung: Gelingt das COPY, läuft sie danach normal; scheitert es, antwortet sie mit
 *   „Transaktion abgebrochen“, und der Aufrufer weiß, dass es nicht ging. Den Grund nennt dann nur das Protokoll des Servers.
 *
 * 🪤 Solange der Strom noch Daten an den Server reicht, weist postgres.js jede Abfrage selbst ab (`COPY_IN_PROGRESS`), und `sql.begin` merkt sich
 * jede abgelehnte Abfrage der Transaktion, auch eine abgefangene: Sie scheitert erst am Ende, nach dem letzten Befehl (Fehlerbericht 2026-10-25,
 * zuerst „COPY abgelehnt“ an `public.adventure`, dann `COPY_IN_PROGRESS` nach allen Tafeln). Darum geht die Sonde erst, wenn postgres.js den
 * Strom abschließt (`_final`: `CopyDone` gesendet, Strom abgemeldet); ab dann reiht sie sich hinter das COPY ein.
 */
export async function ladeStrom(tx: TransactionSql, copy: string, quelle: Readable): Promise<void> {
    const ziel = await tx.unsafe(copy).writable();
    // Wann postgres.js den Strom abschließt (`CopyDone` gesendet, Strom abgemeldet): erst danach nimmt die Verbindung die Sonde an.
    let abgeschlossen = (): void => undefined;
    const abschluss = new Promise<void>((fertig) => {
        abgeschlossen = fertig;
    });
    const schliesse = ziel._final?.bind(ziel);
    if (schliesse !== undefined) {
        ziel._final = (callback) => {
            schliesse(callback);
            abgeschlossen();
        };
    }
    let fehler: Error | undefined;
    ziel.once("error", (error: Error) => {
        fehler = error;
    });
    const fertig = once(ziel, "finish");
    // Scheitert der Strom, bevor jemand auf `fertig` wartet, bliebe die Ablehnung unbehandelt und beendete den Prozess.
    fertig.catch(() => undefined);
    const zielFehler = new Promise<never>((_ergebnis, abgelehnt) => ziel.once("error", abgelehnt));
    quelle.once("error", (error) => ziel.destroy(error));
    quelle.pipe(ziel);
    try {
        await Promise.race([once(quelle, "end"), zielFehler]);
    } catch (error) {
        quelle.destroy();
        throw error;
    }
    // Ohne `_final` (eine andere postgres.js-Fassung) bliebe nur das Warten auf `finish`.
    await (schliesse === undefined ? fertig : Promise.race([abschluss, fertig]));
    if (fehler !== undefined) throw fehler;
    const sonde = tx.unsafe("SELECT 1 AS ok").then(
        () => null,
        (error: Error) => error,
    );
    const erster = await Promise.race([fertig.then(() => "finish" as const), sonde]);
    if (fehler !== undefined) throw fehler;
    if (erster !== "finish" && erster !== null) {
        throw new Error(
            "COPY abgelehnt: die Daten waren ungültig oder verletzen einen Fremdschlüssel (Einzelheiten im Protokoll der Datenbank)",
        );
    }
    await fertig;
    const danach = await sonde;
    if (danach !== null) throw danach;
}
