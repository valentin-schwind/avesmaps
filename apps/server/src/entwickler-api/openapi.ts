import type { TObject, TSchema } from "@sinclair/typebox";
import {
    ALTE_API_WEGE,
    ApiErrorBody,
    ENTWICKLER_DOKU_URL,
    ENTWICKLER_ORTE_URL,
    ENTWICKLER_ROUTE_URL,
    ENTWICKLER_SUCHE_URL,
    ENTWICKLER_VERTRAG_FASSUNG,
    EntwicklerOrtDetail,
    EntwicklerOrteListe,
    EntwicklerOrtParams,
    EntwicklerRoute,
    EntwicklerRouteQuery,
    EntwicklerSuche,
    EntwicklerSucheQuery,
} from "@avesmaps3d/shared";

/**
 * Der Vertrag der Entwickler-API als OpenAPI 3.1 (WI-0303 P7), gebaut aus denselben TypeBox-Schemata, mit denen der Server prüft und
 * antwortet: Er kann nicht von den Routen abweichen. Nur die offiziellen Wege stehen darin, nie die internen der Karte.
 */

type Json = Record<string, unknown>;

/** TypeBox trägt seine Merkmale als Symbole; JSON kennt sie nicht und braucht sie nicht. */
const rein = (schema: TSchema): Json => JSON.parse(JSON.stringify(schema)) as Json;

function parameter(schema: TObject, ort: "query" | "path"): Json[] {
    const pflicht = new Set(schema.required ?? []);
    return Object.entries(schema.properties).map(([name, feld]) => {
        const { description, ...rest } = rein(feld);
        return {
            name,
            in: ort,
            required: ort === "path" || pflicht.has(name),
            ...(typeof description === "string" ? { description } : {}),
            schema: rest,
        };
    });
}

const json = (schema: TSchema, description: string): Json => ({
    description,
    content: { "application/json": { schema: rein(schema) } },
});

const fehler = (description: string): Json => json(ApiErrorBody, description);

let fertig: Json | undefined;

export function entwicklerOpenApi(): Json {
    fertig ??= {
        openapi: "3.1.0",
        info: {
            title: "Avesmaps Entwickler-API",
            version: String(ENTWICKLER_VERTRAG_FASSUNG),
            description:
                "Orte, Suche und Reisen auf der Karte von Aventurien, ohne Schlüssel und für jede Herkunft offen. Koordinaten in Karteneinheiten: x nach Osten, y nach Norden, 0 bis 1024; eine Einheit sind 3 Meilen.",
            license: {
                name: "Nur der Quelltext steht unter MIT; Karten- und Spieldaten nicht",
                url: ENTWICKLER_DOKU_URL,
            },
        },
        externalDocs: { url: ENTWICKLER_DOKU_URL },
        servers: [{ url: "https://avesmaps.de" }],
        paths: {
            [ENTWICKLER_ORTE_URL]: {
                get: {
                    summary: "Alle sichtbaren Orte",
                    responses: {
                        200: json(EntwicklerOrteListe, "Die Orte, nach Namen sortiert."),
                        503: fehler("Die Datenbank ist nicht erreichbar."),
                    },
                },
            },
            [`${ENTWICKLER_ORTE_URL}/{id}`]: {
                get: {
                    summary: "Ein Ort",
                    parameters: parameter(EntwicklerOrtParams, "path"),
                    responses: {
                        200: json(EntwicklerOrtDetail, "Der Ort mit Wiki-Artikel und Gebieten."),
                        400: fehler("Die Kennung ist keine UUID."),
                        404: fehler("Diesen Ort gibt es nicht."),
                        503: fehler("Gerade nicht bedienbar; Retry-After."),
                    },
                },
            },
            [ENTWICKLER_SUCHE_URL]: {
                get: {
                    summary: "Orte nach dem Namen",
                    parameters: parameter(EntwicklerSucheQuery, "query"),
                    responses: {
                        200: json(EntwicklerSuche, "Die Treffer, die besten zuerst."),
                        400: fehler("Die Anfrage passt nicht zum Vertrag."),
                        503: fehler("Gerade nicht bedienbar; Retry-After."),
                    },
                },
            },
            [ENTWICKLER_ROUTE_URL]: {
                get: {
                    summary: "Eine Reise zwischen Orten",
                    parameters: parameter(EntwicklerRouteQuery, "query"),
                    responses: {
                        200: json(EntwicklerRoute, "Die Reise; ohne Route `gefunden: false`."),
                        400: fehler("Die Anfrage passt nicht zum Vertrag."),
                        404: fehler("Ein Ort der Route ist unbekannt (`place_not_found`)."),
                        422: fehler("Die Reise ist zu groß (`route_too_large`)."),
                        503: fehler("Die Wegfindung ist gerade nicht bedienbar; Retry-After."),
                    },
                },
            },
            ...Object.fromEntries(
                ALTE_API_WEGE.map((alt) => [
                    alt.pfad,
                    {
                        [alt.methode.toLowerCase()]: {
                            summary: "Alte Legacy-API",
                            deprecated: true,
                            responses: { 410: fehler(`Gibt es nicht mehr; Nachfolger ${alt.nachfolger}.`) },
                        },
                    },
                ]),
            ),
        },
    };
    return fertig;
}
