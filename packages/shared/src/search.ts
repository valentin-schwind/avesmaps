import { Type, type Static } from "@sinclair/typebox";
import { MapBounds } from "./map-bounds.ts";
import { UUID_PATTERN } from "./operation.ts";
import { SearchSpracheSektion } from "./sprachen-suche.ts";
import { renderZoomForBand } from "./zoom-bands.ts";
import { SearchAnfrage, SearchGebietSektion, SearchVorkommenSektion } from "./vorkommen-suche.ts";

/**
 * Der Vertrag der Suche (WI-0013, Search Core).
 *
 * 🔴 SIE LIEST NUR. Kein Endpunkt dieser Datei schreibt etwas, und keiner darf es je tun — eine
 * Suche, die etwas ändert, ist keine Suche mehr. Der Map Mutation Guard gilt hier trivial, aber er
 * gilt.
 *
 * ⭐ Ein Treffer ist ein SPRUNGZIEL, kein Text. Er trägt immer eine Position und eine stabile
 * Kennung — sonst wäre er nur eine Zeile, die man anschauen kann. Genau daran ist Legacys Suche
 * gemessen worden: was man findet, will man ansehen.
 *
 * 🪤 Dies ist der KERN, nicht die Spotlight-Suche. Was hier fehlt, fehlt mit Absicht und steht im
 * Work Item: Legacys sieben Quellen, seine Sektionsdeckel, sein Bewertungsmodell, Innerorts-Objekte,
 * Objekte ohne Kartenposition, Spielliteratur. Der volle Umfang gehört in Product Completion.
 */

/**
 * Woher ein Treffer stammt.
 *
 * 🪤 Die Art ist NICHT der Subtyp. „Ort" umfasst Metropole bis Gebäude; wer hier den Subtyp
 * einsetzt, baut die Klassentafel ein zweites Mal — und muss sie beim nächsten Subtyp wieder
 * anfassen.
 */
export const SearchHitKind = Type.Union(
    [Type.Literal("ort"), Type.Literal("landschaft"), Type.Literal("weg"), Type.Literal("klima")],
    { $id: "SearchHitKind" },
);
export type SearchHitKind = Static<typeof SearchHitKind>;

// `MapBounds` steht in `map-bounds.ts`: `subject.ts` braucht es, und `search.ts` kennt über `vorkommen-suche.ts` das Subject-Schema (ein Importkreis, wenn beides hier läge).
export { MapBounds };

/**
 * Wie nah die Karte höchstens heranfährt, wenn sie einen Treffer ganz einpasst (WI-0044, Legacy
 * `spotlight-search-focus.js`: Wege `maxZoom 5`, Landschaften 4 - bei uns eine Stufe mehr, WI-0015).
 * Ein kurzer Weg füllt sonst das Bild und zeigt keine Umgebung mehr.
 */
export const SEARCH_FIT_MAX_ZOOM: Readonly<Record<"weg" | "landschaft", number>> = {
    weg: renderZoomForBand(5),
    landschaft: renderZoomForBand(4),
};

export const SearchHit = Type.Object(
    {
        kind: SearchHitKind,
        /**
         * Die stabile Kennung des getroffenen Objekts.
         *
         * 💣 Bei einem WEG ist das heute der Kettenschlüssel `name:<Name>` und NICHT die
         * `public_id` eines Abschnitts — eine Kette ist kein Abschnitt. Sobald der Wiki-Schlüssel
         * da ist, tritt er an diese Stelle (MCS-014): er bildet die Gruppe über alle Wegarten, und
         * er ist es auch, der später den Klick trägt. Wer hier eine Abschnitts-ID einsetzt, lässt
         * den Sprung auf einem beliebigen Siebzigstel der Straße landen.
         */
        id: Type.String(),
        name: Type.String(),
        /** Die Unterart, soweit das Objekt eine trägt — zur Anzeige, nicht zur Logik. */
        subtype: Type.Optional(Type.String()),
        /** Kartenkoordinate in `aventuria-v1`, nicht in Renderkoordinaten (ADR-0003). */
        x: Type.Number(),
        y: Type.Number(),
        /**
         * Die Zoomstufe, auf der das Ziel sinnvoll zu sehen ist — in UNSERER Zählung.
         *
         * 🪤 Ein Treffer ohne Zoom wäre die halbe Antwort: man landet über Gareth, sieht aber den
         * ganzen Kontinent oder eine einzelne Gasse.
         */
        zoom: Type.Number(),
        /**
         * Die Fläche hinter einem Landschaftstreffer: `region.public_id` der aktiven Region, an die das
         * Label gebunden ist (WI-0043). Daran leuchtet die Auswahl auf der Karte.
         *
         * 🔴 `id` bleibt die Kennung des LABELS; eine Region kann mehrere tragen. Ein freies Label hat
         * keine Region und bekommt keine erfundene: Es bleibt ein Sprungziel ohne Fläche.
         *
         * Eine Landschaft OHNE eigenes Label ist selbst der Treffer (WI-0047): Dann sind `id` und `region`
         * dieselbe Region, und `x`/`y` ist ein Punkt auf ihrer größten Fläche.
         */
        region: Type.Optional(Type.String()),
        /**
         * Alle Regionen eines Treffers, wenn es mehrere gleichen Namens, gleicher Art und gleicher Ebene sind
         * (WI-0047, Betreiber 2026-09-26 zu G1: „wir wollen A“, wie Legacy): „Archipel der Perlen“ sind fünf
         * Regionen und EIN Treffer. Alle leuchten, `bounds` umfasst alle. `region` ist die erste davon.
         */
        regions: Type.Optional(Type.Array(Type.String(), { minItems: 2 })),
        /**
         * Der ganze Weg oder die ganze Landschaft, in `aventuria-v1` (WI-0044). Beim Weg alle aktiven
         * Abschnitte der Kette, auch die ohne Namen; bei der Landschaft alle Flächen ihrer Region. Fehlt
         * er, fliegt die Karte auf `x`/`y` und `zoom`.
         */
        bounds: Type.Optional(MapBounds),
    },
    { $id: "SearchHit", additionalProperties: false },
);
export type SearchHit = Static<typeof SearchHit>;

/**
 * Eine Landmarke als Suchtreffer (WI-0271 L6): ein Punkt aus `terrain_peak`, dessen Name auf der Karte steht (`show_name`), jeder Art des Katalogs
 * (Berggipfel, Höhle, Quelle …). `id` ist `terrain_peak.public_id`, `art` der Schlüssel der Art (`subtype`), `x`/`y` der Punkt.
 *
 * 🪤 Eine eigene Sektion neben `hits`, nicht als fünfte Art in `SearchHitKind`: Die Photobox leitet ihre Bezugsarten aus `SearchHitKind` ab
 * (`PHOTOBOX_REFERENCE_KINDS`, CHECK in Migration 0274), und der gemeinsame Deckel der Trefferliste bleibt den Orten (wie bei den Gebieten).
 */
export const SearchLandmarkeHit = Type.Object(
    {
        id: Type.String({ pattern: UUID_PATTERN }),
        name: Type.String(),
        art: Type.String(),
        x: Type.Number(),
        y: Type.Number(),
    },
    { additionalProperties: false },
);
export type SearchLandmarkeHit = Static<typeof SearchLandmarkeHit>;

/** Höchstens fünf Treffer (`SEARCH_VORKOMMEN_SICHTBAR`); `total` ist die Zahl aller („… und N weitere“). */
export const SearchLandmarkeSektion = Type.Object(
    { hits: Type.Array(SearchLandmarkeHit), total: Type.Integer({ minimum: 0 }) },
    { additionalProperties: false },
);
export type SearchLandmarkeSektion = Static<typeof SearchLandmarkeSektion>;

export const SearchResponse = Type.Object(
    {
        /** Die Anfrage, wie sie verstanden wurde — abgeschnitten und normalisiert. */
        query: Type.String(),
        hits: Type.Array(SearchHit),
        /**
         * Gab es mehr, als geliefert wurde?
         *
         * ⭐ Eine Zahl wäre teurer als die Antwort selbst und niemandem nützlich. Was man wissen
         * will, ist „schreib genauer" — und dafür genügt ein Ja.
         */
        truncated: Type.Boolean(),
        /**
         * Die Sektion „Vorkommen“ (WI-0257 S3a): Einträge, deren Name, weiterer Name oder Gruppe zur Anfrage passt, höchstens fünf, mit der Gesamtzahl. Fehlt,
         * wo es keinen Treffer gibt – so bleibt die Antwort für Oberflächen, die sie nicht kennen, unverändert.
         */
        vorkommen: Type.Optional(SearchVorkommenSektion),
        /** Herrschaftsgebiete mit Form, die zur Anfrage passen (eigene Sektion, nicht im gemeinsamen Deckel von `hits`); fehlt ohne Treffer. */
        gebiete: Type.Optional(SearchGebietSektion),
        /** Sprachen der Karte, deren Name, Legende, Wiki-Artikel oder Dialekt zur Anfrage passt (WI-0261 S5c, eigene Sektion wie die Gebiete); fehlt ohne Treffer. */
        sprachen: Type.Optional(SearchSpracheSektion),
        /** Landmarken, deren Name zur Anfrage passt (WI-0271 L6, eigene Sektion wie die Gebiete); fehlt ohne Treffer. */
        landmarken: Type.Optional(SearchLandmarkeSektion),
        /** Was die Suche an einer kurzen Anfrage „Begriff Präposition Ziel“ verstanden hat, samt Vorschlägen; fehlt, wo der Anfang kein Begriff ist. */
        anfrage: Type.Optional(SearchAnfrage),
    },
    { $id: "SearchResponse", additionalProperties: false },
);
export type SearchResponse = Static<typeof SearchResponse>;

/**
 * Wie viele Treffer der Kern höchstens liefert.
 *
 * 🪤 EIN Deckel über alles, nicht einer je Sektion. Legacy deckelt je Gruppe auf fünf und schreibt
 * „… und N weitere" darunter — das gehört zur vollen Spotlight-Parität und braucht sein
 * Bewertungsmodell dazu. Ein Deckel, der so tut, als wäre er Legacys, wäre die schlechtere Hälfte
 * von beidem.
 */
export const SEARCH_LIMIT = 20;

/** Kürzer suchen lohnt nicht: zwei Buchstaben treffen bei 7.591 Namen fast alles. */
export const SEARCH_MIN_LENGTH = 2;
