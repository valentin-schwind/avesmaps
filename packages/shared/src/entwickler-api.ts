import { Type, type Static } from "@sinclair/typebox";
import { UUID_PATTERN } from "./operation.ts";

/**
 * Die Entwickler-API, Fassung 1 (WI-0303 P7): eine kleine offizielle Auswahl für Werkzeuge von außen, ohne Schlüssel und für jede
 * Herkunft offen (`Access-Control-Allow-Origin: *`, nie mit Cookies). Doku: `docs/schnittstellen/entwickler-api.md`.
 *
 *     GET  /api/v1/orte              alle sichtbaren Orte: Kennung, Name, Art, Lage
 *     GET  /api/v1/orte/{id}         ein Ort: dazu Wiki-Artikel und Gebiete
 *     GET  /api/v1/suche?q=          Orte nach dem Namen
 *     GET  /api/v1/route?von=&nach=  eine Reise zwischen Orten
 *     GET  /api/v1/openapi.json      dieser Vertrag als OpenAPI 3.1
 *
 * Die alte Entwickler-API von Legacy (`POST /api/route/`, `POST /api/route.php`, `GET /api/locations/`) antwortet `410 Gone` mit
 * Hinweis auf diese Doku (Betreiber 2026-11-10: „Gleich 410“).
 *
 * 🔴 **`/api/v1` ist ein Vertrag nach außen** (Kap. 4.27, 11.15): Felder kommen nur dazu, keines ändert seine Bedeutung. Was sich
 * sonst ändern müsste, wird `/api/v2`. Die Antworten sind deshalb eigene schmale Sichten, nie die internen Antworten der Karte: Die
 * ändern sich mit der Oberfläche.
 *
 * Koordinaten in Karteneinheiten (`aventuria-v1`, `config/map-domains/aventuria.json`): `x` nach Osten, `y` nach Norden, beide 0 bis
 * 1024, eine Einheit sind 3 Meilen. Keine Länge und Breite.
 */

export const ENTWICKLER_API_BASIS = "/api/v1";
export const ENTWICKLER_ORTE_URL = `${ENTWICKLER_API_BASIS}/orte`;
export const ENTWICKLER_ORT_URL = `${ENTWICKLER_ORTE_URL}/:id`;
export const ENTWICKLER_SUCHE_URL = `${ENTWICKLER_API_BASIS}/suche`;
export const ENTWICKLER_ROUTE_URL = `${ENTWICKLER_API_BASIS}/route`;
export const ENTWICKLER_OPENAPI_URL = `${ENTWICKLER_API_BASIS}/openapi.json`;
export const ENTWICKLER_VERTRAG_FASSUNG = 1 as const;

/** Wo die Doku öffentlich steht: im Zweig `avesmaps3d` des öffentlichen Repositorys (WI-0303). */
export const ENTWICKLER_DOKU_URL =
    "https://github.com/valentin-schwind/avesmaps/blob/avesmaps3d/docs/schnittstellen/entwickler-api.md";

/** Höchstens so viele Zwischenhalte (`ueber`), wie Legacy (`api/README.md`: „At most 10 stops“). */
export const ENTWICKLER_ROUTE_UEBER_MAX = 10;
/** Trennzeichen der Zwischenhalte: Ortsnamen enthalten Kommas, aber keine Tilde (wie `/api/route/waypoints/resolve`). */
export const ENTWICKLER_ROUTE_UEBER_TRENNER = "~";
/** Höchstens so viele Treffer je Suche; mehr gibt der Index nicht her (`waypointLookupLimit`). */
export const ENTWICKLER_SUCHE_MAX = 20;
export const ENTWICKLER_SUCHE_VORGABE = 10;

/**
 * Die alten Wege der Legacy-API. 🔴 Die Namen der Zählung (`besucher/api-herkunft.ts` `legacyPfad`) hängen an den Pfaden, nicht an
 * diesen Routen: `/api/route` und `/api/route/` zählen beide als „POST /api/route/“, `/api/locations` und `/api/locations/` beide als
 * „/api/locations/“ (abgestimmt mit WI-0307 am 2026-11-10).
 */
export const ALTE_API_WEGE = [
    { methode: "POST", pfad: "/api/route/", nachfolger: ENTWICKLER_ROUTE_URL },
    { methode: "POST", pfad: "/api/route", nachfolger: ENTWICKLER_ROUTE_URL },
    { methode: "POST", pfad: "/api/route.php", nachfolger: ENTWICKLER_ROUTE_URL },
    { methode: "GET", pfad: "/api/locations/", nachfolger: ENTWICKLER_ORTE_URL },
    { methode: "GET", pfad: "/api/locations", nachfolger: ENTWICKLER_ORTE_URL },
] as const;

/**
 * Die Fehlercodes des Vertrags; jede Antwort im Umschlag `{ error: { code, message, details? } }` (ADR-0018). Wer einen neuen braucht,
 * ergänzt ihn hier, in der Doku und im Vertragstest.
 */
export const ENTWICKLER_API_FEHLER = {
    /** 400: Die Anfrage passt nicht zum Vertrag; `details.issues` nennt die Stellen, nie den Wert. */
    validation_failed: 400,
    /** 404: Diesen Ort gibt es nicht. */
    not_found: 404,
    /** 404: Ein Ort der Route ist unbekannt; `details.feld` ist `von`, `nach` oder `ueber`, bei `ueber` mit `details.index`. */
    place_not_found: 404,
    /** 410: die alte Legacy-API; `details.doku` und `details.nachfolger` sagen, wo es weitergeht. */
    api_gone: 410,
    /** 422: Die Reise ist größer, als eine Antwort sein darf. */
    route_too_large: 422,
    /** 503: Gerade sind zu viele Anfragen in Arbeit; `Retry-After` sagt, wann es weitergeht. */
    server_busy: 503,
    /** 503: Die Wegfindung ist gerade nicht bedienbar (ausgelastet oder zu langsam); `Retry-After`. */
    routing_unavailable: 503,
    /** 503: Die Datenbank ist nicht erreichbar; `Retry-After`. */
    database_unavailable: 503,
} as const;
export type EntwicklerApiFehler = keyof typeof ENTWICKLER_API_FEHLER;

const strict = { additionalProperties: false } as const;
const Kennung = Type.String({ pattern: UUID_PATTERN, description: "Die Kennung des Ortes (UUID), dauerhaft." });
const X = Type.Number({ description: "Karteneinheiten nach Osten, 0 bis 1024." });
const Y = Type.Number({ description: "Karteneinheiten nach Norden, 0 bis 1024." });
const Art = Type.String({
    description: "Die Ortsklasse, etwa `dorf`, `stadt` oder `metropole`. Neue Werte können dazukommen.",
});
const Vertrag = Type.Literal(ENTWICKLER_VERTRAG_FASSUNG, { description: "Die Fassung dieses Vertrags." });

export const EntwicklerOrt = Type.Object({ id: Kennung, name: Type.String(), art: Art, x: X, y: Y }, strict);
export type EntwicklerOrt = Static<typeof EntwicklerOrt>;

/** `GET /api/v1/orte`: alle sichtbaren Orte, nach Namen sortiert. Verborgene Orte stehen nie darin. */
export const EntwicklerOrteListe = Type.Object(
    { vertrag: Vertrag, anzahl: Type.Integer({ minimum: 0 }), orte: Type.Array(EntwicklerOrt) },
    strict,
);
export type EntwicklerOrteListe = Static<typeof EntwicklerOrteListe>;

export const EntwicklerOrtParams = Type.Object({ id: Kennung }, strict);
export type EntwicklerOrtParams = Static<typeof EntwicklerOrtParams>;

export const EntwicklerGebiet = Type.Object(
    {
        id: Type.String(),
        name: Type.String(),
        art: Type.Optional(Type.String({ description: "Die Art des Gebiets, etwa `kaiserreich` oder `grafschaft`." })),
    },
    strict,
);
export type EntwicklerGebiet = Static<typeof EntwicklerGebiet>;

/** `GET /api/v1/orte/{id}`. */
export const EntwicklerOrtDetail = Type.Object(
    {
        vertrag: Vertrag,
        id: Kennung,
        name: Type.String(),
        art: Art,
        x: X,
        y: Y,
        /** Der Artikel in Wiki Aventurica, wo es einen gibt. */
        wiki: Type.Optional(Type.Object({ url: Type.String(), titel: Type.Optional(Type.String()) }, strict)),
        /**
         * Die Gebiete, in denen der Ort liegt: je Kette vom größten zum kleinsten (Reich, Provinz, Grafschaft). Mehr als eine Kette,
         * wo Ansprüche nebeneinanderstehen. Fehlt, wo es keine gibt oder sie gerade nicht zu lesen waren.
         */
        gebiete: Type.Optional(Type.Array(Type.Array(EntwicklerGebiet))),
    },
    strict,
);
export type EntwicklerOrtDetail = Static<typeof EntwicklerOrtDetail>;

export const EntwicklerSucheQuery = Type.Object(
    {
        q: Type.String({
            maxLength: 100,
            description: "Der Name oder sein Anfang; unter zwei Zeichen ist die Antwort leer.",
        }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: ENTWICKLER_SUCHE_MAX })),
    },
    strict,
);
export type EntwicklerSucheQuery = Static<typeof EntwicklerSucheQuery>;

/** `GET /api/v1/suche`: Orte, deren Name zur Anfrage passt, die besten zuerst. */
export const EntwicklerSuche = Type.Object(
    {
        vertrag: Vertrag,
        anfrage: Type.String(),
        treffer: Type.Array(EntwicklerOrt),
        /** Es gibt mehr Treffer als geliefert. */
        gekuerzt: Type.Boolean(),
    },
    strict,
);
export type EntwicklerSuche = Static<typeof EntwicklerSuche>;

const OrtAngabe = Type.String({
    minLength: 1,
    maxLength: 200,
    description:
        "Die Kennung eines Ortes oder sein genauer Name (Groß- und Kleinschreibung und Akzente egal, wenn er eindeutig ist).",
});

export const ENTWICKLER_ROUTE_WEGE = ["land", "fluss", "see"] as const;
export type EntwicklerRouteWeg = (typeof ENTWICKLER_ROUTE_WEGE)[number];
export const ENTWICKLER_ROUTE_OPTIMIERUNG = ["schnellste", "kuerzeste"] as const;

export const EntwicklerRouteQuery = Type.Object(
    {
        von: OrtAngabe,
        nach: OrtAngabe,
        ueber: Type.Optional(
            Type.String({
                minLength: 1,
                maxLength: 2000,
                description: `Zwischenhalte in Reihenfolge, getrennt mit \`${ENTWICKLER_ROUTE_UEBER_TRENNER}\`, höchstens ${String(ENTWICKLER_ROUTE_UEBER_MAX)}.`,
            }),
        ),
        optimierung: Type.Optional(
            Type.Union(
                ENTWICKLER_ROUTE_OPTIMIERUNG.map((wert) => Type.Literal(wert)),
                { description: "Vorgabe `schnellste`." },
            ),
        ),
        wege: Type.Optional(
            Type.String({
                pattern: "^(land|fluss|see)(,(land|fluss|see)){0,2}$",
                description: "Welche Wege erlaubt sind, kommagetrennt aus `land`, `fluss`, `see`. Vorgabe: alle drei.",
            }),
        ),
    },
    strict,
);
export type EntwicklerRouteQuery = Static<typeof EntwicklerRouteQuery>;

export const EntwicklerEtappe = Type.Object(
    {
        /** Die Wegart, etwa `Reichsstrasse`, `Strasse`, `Weg`, `Pfad`, `Seeweg` oder `Querfeldein`. Neue Werte können dazukommen. */
        art: Type.String(),
        /** Das Reisemittel, mit dem gerechnet wurde. */
        mittel: Type.String(),
        /** Die Namen der Wege in Reihenfolge, ohne Wiederholung; leer, wo die Wege keinen Namen haben. */
        wege: Type.Array(Type.String()),
        von: Type.Object({ x: X, y: Y }, strict),
        nach: Type.Object({ x: X, y: Y }, strict),
        meilen: Type.Number(),
        reisestunden: Type.Number(),
        raststunden: Type.Number(),
    },
    strict,
);
export type EntwicklerEtappe = Static<typeof EntwicklerEtappe>;

export const ENTWICKLER_ROUTE_HINWEISE = ["querfeldein", "keine_freie_see"] as const;

/** `GET /api/v1/route`. Keine Route ist eine Antwort (`gefunden: false`), kein Fehler. */
export const EntwicklerRoute = Type.Object(
    {
        vertrag: Vertrag,
        gefunden: Type.Boolean(),
        /** Ohne Route: Die Orte hängen nicht zusammen (`kein_zusammenhang`), oder nur über Wege, die gerade gesperrt sind (`gesperrt`). */
        grund: Type.Optional(Type.Union([Type.Literal("kein_zusammenhang"), Type.Literal("gesperrt")])),
        /** Die Orte der Reise in Reihenfolge: `von`, die Zwischenhalte, `nach`. */
        orte: Type.Array(Type.Object({ id: Kennung, name: Type.String() }, strict)),
        meilen: Type.Number(),
        /** Die reine Reisezeit. */
        reisestunden: Type.Number(),
        /** Die Rast dazwischen. */
        raststunden: Type.Number(),
        /** Reisezeit und Rast zusammen. */
        gesamtstunden: Type.Number(),
        reisetage: Type.Number(),
        /** Die Reisestunden je Tag an Land, mit denen gerechnet wurde. */
        stundenProTag: Type.Number(),
        etappen: Type.Array(EntwicklerEtappe),
        /** Der Verlauf der ganzen Reise als Linie `[x, y]` in Karteneinheiten. */
        linie: Type.Array(Type.Tuple([Type.Number(), Type.Number()])),
        /**
         * `querfeldein`: Ein Stück führt ohne Weg über Land. `keine_freie_see`: Die See war erlaubt, aber für das Schiff gibt es hier
         * keine Seefahrt. Neue Werte können dazukommen.
         */
        hinweise: Type.Array(Type.String()),
    },
    strict,
);
export type EntwicklerRoute = Static<typeof EntwicklerRoute>;
