import { randomUUID } from "node:crypto";
import {
    WETTERMODELL_URL,
    WETTER_PRESETS_URL,
    WETTER_SYMBOLE_URL,
    wetterPresetEntfernenUrl,
    wetterPresetUrl,
    wetterPresetZeitpunktUrl,
    wetterSymbolEntfernenUrl,
    wetterSymbolUrl,
} from "@avesmaps3d/shared";
import { betroffen, type Faelle, type Person, type Welt } from "./welt.ts";

/**
 * Das Wetter (WI-0288 Stufe 2) im Rauchtest der Schreibwege: Presets und Icons als Editorin, das Wettermodell als Betreiberin mit frischem
 * Passkey. Die Fälle decken das Materialisieren (INSERT der 14 Presets und der Icons des Prototyps), das Ändern (UPDATE), den Tausch zweier
 * Presets in einer Anweisung, das Anlegen und das harte Entfernen eines Presets (DELETE), das weiche Entfernen eines Icons, die Beratungssperre und den Trigger der Modellrevision (SECURITY DEFINER) ab. Sie
 * vertragen einander: Jeder liest den Stand, den er vorfindet.
 */

const operationId = (): string => randomUUID();
const redakteurin = (welt: Welt): Promise<Person> => welt.jemand("editor");

async function zahl(welt: Welt, sql: string): Promise<number> {
    const [row] = await welt.cluster.admin.unsafe<{ n: number | null }[]>(sql);
    return row?.n ?? 0;
}

const presetRevision = (welt: Welt, id: string) =>
    zahl(welt, `SELECT revision::int AS n FROM weather_preset WHERE preset_id = '${id}'`);

/** Ein freier Tag im Jahr für ein neues Preset (der erste, den kein Preset hält). */
const freierTag = (welt: Welt): Promise<number> =>
    zahl(
        welt,
        "SELECT min(g)::int AS n FROM generate_series(1, 365) g WHERE g NOT IN (SELECT tag FROM weather_preset)",
    );

/** Ein neues Preset über die Route (Vorbereitung); gibt Kennung und Revision zurück. */
async function neuesPreset(welt: Welt, person: Person): Promise<{ id: string; revision: number }> {
    const antwort = welt.muss(
        await welt.post(WETTER_PRESETS_URL, person.cookie, { operationId: operationId(), tag: await freierTag(welt) }),
    );
    return betroffen(antwort, "wetter_preset");
}

/** Ein neues Icon über die Route (Vorbereitung); gibt Kennung und Revision zurück. */
async function neuerWind(welt: Welt, person: Person): Promise<{ id: string; revision: number }> {
    const antwort = welt.muss(
        await welt.post(WETTER_SYMBOLE_URL, person.cookie, {
            operationId: operationId(),
            art: "wind",
            name: "Rauchwind",
            x: 500,
            z: 500,
            reichweite: 80,
            staerke: 6,
            richtung: 45,
        }),
    );
    return betroffen(antwort, "wetter_symbol");
}

export const WETTER: Faelle = {
    "PATCH /api/editor/wetter/presets/:id": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const tn = await zahl(
                welt,
                "SELECT (werte->>'tn')::float8 AS n FROM weather_preset WHERE preset_id = 'p-praios'",
            );
            return welt.post(
                wetterPresetUrl("p-praios"),
                person.cookie,
                {
                    operationId: operationId(),
                    baseRevision: await presetRevision(welt, "p-praios"),
                    werte: { tn: tn === 3 ? 4 : 3 },
                },
                "PATCH",
            );
        },
    },
    "POST /api/editor/wetter/presets/:id/zeitpunkt": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            // Auf den Tag des Rondra-Presets: ein Tausch in einer Anweisung (aufschiebbare Eindeutigkeit).
            const ziel = await zahl(
                welt,
                "SELECT COALESCE((SELECT tag::int FROM weather_preset WHERE preset_id = 'p-rondra'), 45) AS n",
            );
            return welt.post(wetterPresetZeitpunktUrl("p-tsa"), person.cookie, {
                operationId: operationId(),
                baseRevision: await presetRevision(welt, "p-tsa"),
                tag: ziel === 0 ? 46 : ziel,
            });
        },
    },
    "POST /api/editor/wetter/presets": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            return welt.post(WETTER_PRESETS_URL, person.cookie, {
                operationId: operationId(),
                tag: await freierTag(welt),
            });
        },
    },
    "POST /api/editor/wetter/presets/:id/entfernen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const preset = await neuesPreset(welt, person);
            // Das DELETE läuft als App-Rolle (system-grants.psql).
            return welt.post(wetterPresetEntfernenUrl(preset.id), person.cookie, {
                operationId: operationId(),
                baseRevision: preset.revision,
            });
        },
    },
    "POST /api/editor/wetter/symbole": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            return welt.post(WETTER_SYMBOLE_URL, person.cookie, {
                operationId: operationId(),
                art: "wirbel",
                x: 400,
                z: 400,
                reichweite: 90,
                staerke: 8,
                drehsinn: 1,
            });
        },
    },
    "PATCH /api/editor/wetter/symbole/:id": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const wind = await neuerWind(welt, person);
            return welt.post(
                wetterSymbolUrl(wind.id),
                person.cookie,
                {
                    operationId: operationId(),
                    baseRevision: wind.revision,
                    aenderungen: { sichtbar: false, richtung: 90 },
                },
                "PATCH",
            );
        },
    },
    "POST /api/editor/wetter/symbole/:id/entfernen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const wind = await neuerWind(welt, person);
            return welt.post(wetterSymbolEntfernenUrl(wind.id), person.cookie, {
                operationId: operationId(),
                baseRevision: wind.revision,
            });
        },
    },
    "POST /api/admin/system/wettermodell": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("operator", { frisch: true, passkey: true });
            const revision = () => zahl(welt, "SELECT revision::int AS n FROM weather_model_state WHERE id = 1");
            const conf = await zahl(welt, "SELECT value AS n FROM weather_model_setting WHERE key = 'conf'");
            const antwort = await welt.post(WETTERMODELL_URL, person.cookie, {
                operationId: operationId(),
                baseRevision: await revision(),
                id: "conf",
                value: conf === 2 ? 3 : 2,
            });
            // Zurück auf die Vorgabe: Das Löschen der Zeile läuft ebenfalls als App-Rolle.
            if (antwort.statusCode === 200)
                welt.muss(
                    await welt.post(WETTERMODELL_URL, person.cookie, {
                        operationId: operationId(),
                        baseRevision: await revision(),
                        id: "conf",
                        value: null,
                    }),
                );
            return antwort;
        },
    },
};
