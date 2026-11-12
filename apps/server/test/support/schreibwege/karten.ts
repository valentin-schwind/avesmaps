import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LightMyRequestResponse } from "fastify";
import { KARTEN_EXPORT_URL, type KartenZugangNeu } from "@avesmaps3d/shared";
import type { Faelle, Person, Welt } from "./welt.ts";

/**
 * Karten herunterladen (WI-0280): jeder Schreibweg einmal als App-Rolle. Eine Betreiberin mit Passkey; eine kleine Datei als Quelle von `modern`, damit das Anlegen bis in die
 * Datenbank kommt (eine Karte ohne Datei weist es vorher ab). Die Ablage liest die Umgebung bei jedem Aufruf, wie beim Hochladen der Kartenserien.
 */

const operationId = (): string => randomUUID();

async function mitQuelle(
    welt: Welt,
    arbeit: (person: Person) => Promise<LightMyRequestResponse>,
): Promise<LightMyRequestResponse> {
    const vorher = process.env["MAP_SOURCES_ROOT"];
    const wurzel = join(welt.ordner, "karten-quellen");
    await mkdir(join(wurzel, "modern"), { recursive: true });
    await writeFile(join(wurzel, "modern", "abcdef012345.png"), "PNG-Ersatz");
    process.env["MAP_SOURCES_ROOT"] = wurzel;
    try {
        return await arbeit(await welt.jemand("operator", { frisch: true, passkey: true }));
    } finally {
        if (vorher === undefined) delete process.env["MAP_SOURCES_ROOT"];
        else process.env["MAP_SOURCES_ROOT"] = vorher;
    }
}

async function zugang(welt: Welt, person: Person): Promise<KartenZugangNeu> {
    const antwort = welt.muss(
        await welt.post(`${KARTEN_EXPORT_URL}/zugaenge`, person.cookie, {
            operationId: operationId(),
            art: "link",
            fuerWen: "Rauchtest",
            tage: 7,
            karten: ["modern"],
        }),
    );
    return antwort.json<KartenZugangNeu>();
}

export const KARTEN: Faelle = {
    "POST /api/karten-export/zugaenge": {
        erwartet: 200,
        rufe: (welt) =>
            mitQuelle(welt, (person) =>
                welt.post(`${KARTEN_EXPORT_URL}/zugaenge`, person.cookie, {
                    operationId: operationId(),
                    art: "schluessel",
                    fuerWen: "Rauchtest",
                    tage: 30,
                    karten: ["modern"],
                }),
            ),
    },
    "POST /api/karten-export/zugaenge/:id/neu": {
        erwartet: 200,
        rufe: (welt) =>
            mitQuelle(welt, async (person) => {
                const { id } = await zugang(welt, person);
                return welt.post(`${KARTEN_EXPORT_URL}/zugaenge/${id}/neu`, person.cookie, {
                    operationId: operationId(),
                });
            }),
    },
    "POST /api/karten-export/zugaenge/:id/weg": {
        erwartet: 200,
        rufe: (welt) =>
            mitQuelle(welt, async (person) => {
                const { id } = await zugang(welt, person);
                return welt.post(`${KARTEN_EXPORT_URL}/zugaenge/${id}/weg`, person.cookie, {
                    operationId: operationId(),
                });
            }),
    },
    "POST /api/karten-export/svg": {
        erwartet: 200,
        rufe: (welt) =>
            mitQuelle(welt, (person) =>
                welt.post(`${KARTEN_EXPORT_URL}/svg`, person.cookie, { operationId: operationId() }),
            ),
    },
};
