import {
    wikiBoxEntfernenUrl,
    wikiBoxSucheUrl,
    wikiBoxSyncUrl,
    wikiBoxUrl,
    wikiBoxZuweisenUrl,
    type ApiErrorBody,
    type OperationReceipt,
    type WikiBoxStand,
    type WikiTrefferListe,
} from "@avesmaps3d/shared";
import type { SchreibErgebnis, WikiBoxDaten } from "./wiki-box";

/**
 * Was die Wiki-Box beim Server liest und schreibt (WI-0253; Vertrag `packages/shared/src/wiki-box.ts`): der Stand, die Artikelsuche und die drei Schreibwege. Jede Frage trägt ein `AbortSignal` (ein jüngeres
 * Objekt bricht die ältere Frage ab); jeder Schreibweg eine neue Kennung der Operation, die Antwort ist die Quittung oder der Fehler im Umschlag (ADR-0018).
 */

type Abruf = typeof fetch;

export function createWikiBoxDaten(abruf: Abruf = (eingabe, init) => fetch(eingabe, init)): WikiBoxDaten {
    async function schreibe(url: string, body: Record<string, unknown> = {}): Promise<SchreibErgebnis> {
        let antwort: Response;
        try {
            antwort = await abruf(url, {
                method: "POST",
                headers: { accept: "application/json", "content-type": "application/json" },
                body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }),
            });
        } catch {
            return {
                ok: false,
                status: 0,
                fehler: { code: "network_error", message: "Keine Verbindung zum Server." },
            };
        }
        if (antwort.ok) return { ok: true, quittung: (await antwort.json()) as OperationReceipt };
        const umschlag = (await antwort.json().catch(() => undefined)) as ApiErrorBody | undefined;
        return {
            ok: false,
            status: antwort.status,
            fehler: umschlag?.error ?? {
                code: "unknown_error",
                message: `Der Server antwortete ${String(antwort.status)}.`,
            },
        };
    }

    return {
        async stand(art, id, signal) {
            const antwort = await abruf(wikiBoxUrl(art, id), {
                signal,
                cache: "no-store",
                headers: { accept: "application/json" },
            });
            if (antwort.status === 404) return null;
            if (!antwort.ok) throw new Error(`${wikiBoxUrl(art, id)} antwortete ${String(antwort.status)}`);
            return (await antwort.json()) as WikiBoxStand;
        },
        async suche(art, id, q, signal) {
            const adresse = `${wikiBoxSucheUrl(art, id)}${q.trim() === "" ? "" : `?q=${encodeURIComponent(q.trim())}`}`;
            const antwort = await abruf(adresse, {
                signal,
                cache: "no-store",
                headers: { accept: "application/json" },
            });
            if (!antwort.ok) throw new Error(`${adresse} antwortete ${String(antwort.status)}`);
            return ((await antwort.json()) as WikiTrefferListe).articles;
        },
        weise: (art, id, key) => schreibe(wikiBoxZuweisenUrl(art, id), { key }),
        entferne: (art, id) => schreibe(wikiBoxEntfernenUrl(art, id)),
        sync: (art, id) => schreibe(wikiBoxSyncUrl(art, id)),
    };
}
