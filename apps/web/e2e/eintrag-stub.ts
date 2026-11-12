import type { Page, Route } from "@playwright/test";
import type {
    SearchEintrag,
    SearchEintragGegend,
    SearchEintragOrt,
    SearchLeuchten,
    SearchLeuchtAnfrage,
    SourceEntry,
} from "@avesmaps3d/shared";

/**
 * Die Antwort von `GET /api/search/eintrag` im neuen Format (WI-0260), für die Browsertests der Infobox eines Vorkommens.
 *
 * Zwei Wege, je nachdem, was ein Fall prüft:
 *
 * - **`stelleEintrag`** stellt die GANZE Antwort. Das Format ist damit unabhängig vom Server, der gerade läuft: Kopf, Kurzbeschreibung, Liste, Kürzung, Felder und Quellen sind deterministisch. Die Route des
 *   Leuchtens stellt `stelleLeuchten` dazu, wenn ein Fall nur wissen will, WAS die Oberfläche fragt.
 * - **`ergaenzeEintrag`** fragt den echten Server und hängt nur an, was ihm noch fehlt (`wo` aus den alten `ziele`, Kurzbeschreibung, Publikationen). So prüfen die Fälle, die die echten Gegenden der
 *   Entwicklungsdatenbank leuchten lassen, weiter gegen die Karte; sobald der Server das neue Format führt, reicht der Helfer es unverändert durch.
 */

const EINTRAG = /\/api\/search\/eintrag\?/u;
const LEUCHTEN = /\/api\/search\/leuchten\?/u;

/** Die Wikizeile samt Lizenz, wie der Server sie nach dem gemeinsamen Katalog liefert. */
export const WIKI_ZEILE = {
    url: "https://de.wiki-aventurica.de/wiki/Sikrami",
    title: "Sikrami",
    corpus: { key: "wiki-aventurica.de", label: "Wiki Aventurica" },
    license: { name: "CC BY-SA 3.0", uri: "https://creativecommons.org/licenses/by-sa/3.0/" },
} as const;

/** Zwei Publikationen („Beschrieben“) und eine Erwähnung. */
export const PUBLIKATIONEN: SourceEntry[] = [
    {
        title: "Aventurisches Bestiarium",
        type: "regionalspielhilfe",
        official: true,
        referenceKind: "ausfuehrlich",
        pages: "32, 33",
    },
    {
        title: "Zoo-Botanica Aventurica",
        type: "regionalspielhilfe",
        official: true,
        referenceKind: "ergaenzend",
        pages: "82",
    },
    {
        title: "Aventurischer Bote 140",
        type: "aventurischer_bote",
        official: true,
        referenceKind: "erwaehnung",
        pages: "12",
    },
];

const uuid = (n: number): string => `b0b0b0b0-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Die Kennung der n-ten Landschaft oder des n-ten Gebiets der Probe (die Leuchten-Route der Probe kennt sie nicht, sie schreibt nur auf). */
export const kennung = uuid;

/** Eine Landschaft als Gegend des Eintrags `eintrag`; `ziel` ist die Anfrage, die nur sie leuchten lässt. */
export function gegend(
    eintrag: string,
    n: number,
    name: string,
    extra: Partial<SearchEintragGegend> = {},
): SearchEintragGegend {
    return {
        key: `landschaft:${name.toLowerCase()}`,
        name,
        kind: "landschaft",
        typ: "region",
        relation: "verbreitung",
        ziel: { eintrag, landschaften: [uuid(n)] },
        ...extra,
    };
}

/** Ein Herrschaftsgebiet als Gegend. */
export function gebiet(
    eintrag: string,
    n: number,
    name: string,
    extra: Partial<SearchEintragGegend> = {},
): SearchEintragGegend {
    return {
        key: `gebiet:${name.toLowerCase()}`,
        name,
        kind: "gebiet",
        typ: "Grafschaft",
        relation: "verbreitung",
        ziel: { eintrag, gebiet: uuid(n) },
        ...extra,
    };
}

/** Ein genannter Ort; `id` ist ein echter Ort der Entwicklungsdatenbank, damit sein Panel aufgeht (Drunidet). */
export const DRUNIDET = "9a04121d-6f4d-533e-9207-05738e16bdf0";
export function ort(name: string, extra: Partial<SearchEintragOrt> = {}): SearchEintragOrt {
    return { ref: { kind: "place", id: DRUNIDET }, name, klasse: "dorf", relation: "verbreitung", ...extra };
}

/**
 * Ein Eintrag im neuen Format: die Ware „Sikrami“ mit Herkunft, Verbreitung und einem Ort, Kurzbeschreibung samt Lizenz, Publikationen. `extra` ersetzt Felder; eine Ware, die nichts leuchten lässt, trägt `wo`
 * ohne Zeilen.
 */
export function probeEintrag(id: string, extra: Partial<SearchEintrag> = {}): SearchEintrag {
    return {
        id,
        name: "Sikrami",
        kind: "ware",
        gruppe: "profan",
        weitereNamen: ["Sikramwurst"],
        wiki: WIKI_ZEILE,
        kartenbezug: true,
        gegenden: 3,
        orte: 2,
        nurKontinent: false,
        leuchten: { eintrag: id },
        ziele: [],
        kurzbeschreibung: "Die Sikrami ist eine haltbare Hartwurst, die als Proviant für lange Reisen geschätzt wird.",
        typ: "Hartwurst",
        kontinent: "Aventurien",
        wo: {
            gegenden: [
                gegend(id, 1, "Liebliches Feld", { relation: "herkunft" }),
                gebiet(id, 2, "Grafschaft Sikram"),
                gegend(id, 3, "Windhag"),
            ],
            orte: [ort("Radoleth", { klasse: "stadt", relation: "herkunft" }), ort("Drunidet")],
            auchGenannt: ["Güldenland"],
        },
        publikationen: PUBLIKATIONEN,
        ...extra,
    };
}

/** Die Kennung steht in der Adresse (`?id=`). */
const idVon = (route: Route): string => new URL(route.request().url()).searchParams.get("id") ?? uuid(0);

/** Stellt die ganze Antwort; `antwort` bekommt die Kennung der Frage und liefert den Eintrag (`null`: es gibt ihn nicht, 404). */
export async function stelleEintrag(page: Page, antwort: (id: string) => SearchEintrag | null): Promise<void> {
    await page.route(EINTRAG, async (route) => {
        const eintrag = antwort(idVon(route));
        if (eintrag === null) await route.fulfill({ status: 404, json: { error: "not_found" } });
        else await route.fulfill({ json: eintrag });
    });
}

/**
 * Fragt den echten Server und füllt nur, was die Entwicklungsdatenbank noch nicht trägt: die Kurzbeschreibung, die der WikiSync erst nach einem Lauf erfasst (`null`). Alles andere - die Gegenden mit ihren echten
 * Anfragen, die Orte, die Publikationen - kommt vom Server, damit die Fälle weiter an der Karte prüfen, was wirklich leuchtet. `extra` ersetzt Felder.
 *
 * 🪤 Endet der Fall, während der Server noch antwortet, wirft `route.fetch` („Test ended“); das ist kein Fehler des Falls.
 */
export async function ergaenzeEintrag(page: Page, extra: Partial<SearchEintrag> = {}): Promise<void> {
    await page.route(EINTRAG, async (route) => {
        try {
            const antwort = await route.fetch();
            if (!antwort.ok()) {
                await route.fulfill({ response: antwort });
                return;
            }
            const echt = (await antwort.json()) as Record<string, unknown>;
            const kurz = echt["kurzbeschreibung"] ?? "Ein Satz aus dem Wiki, nur für den Browsertest.";
            await route.fulfill({ response: antwort, json: { ...echt, kurzbeschreibung: kurz, ...extra } });
        } catch {
            // Die Seite ist schon zu.
        }
    });
}

/** Was die Oberfläche beim Leuchten gefragt hat, in der Folge der Fragen. */
export interface LeuchtenFragen {
    readonly anfragen: SearchLeuchtAnfrage[];
    readonly urls: string[];
}

/** Die Antwort der Leuchten-Route ohne etwas, das leuchtet: Der Fall will nur wissen, WAS gefragt wurde. */
function leereLeuchten(id: string | null): SearchLeuchten {
    return {
        titel: "Probe",
        begriff: { name: "Probe", ...(id === null ? {} : { eintrag: id }) },
        pausiert: false,
        ganz: [],
        angeschnitten: [],
        gebiete: { ganz: [], angeschnitten: [] },
        orte: [],
        gegenden: 0,
        rahmen: null,
        nurKontinent: false,
    };
}

/** Stellt die Leuchten-Route und schreibt auf, was gefragt wird. */
export async function stelleLeuchten(page: Page): Promise<LeuchtenFragen> {
    const fragen: LeuchtenFragen = { anfragen: [], urls: [] };
    await page.route(LEUCHTEN, async (route) => {
        const url = new URL(route.request().url());
        fragen.urls.push(`${url.pathname}${url.search}`);
        const eintrag = url.searchParams.get("eintrag");
        fragen.anfragen.push({
            ...(eintrag === null ? {} : { eintrag }),
            ...(url.searchParams.get("landschaften") === null
                ? {}
                : { landschaften: url.searchParams.get("landschaften")!.split(",") }),
            ...(url.searchParams.get("gebiet") === null ? {} : { gebiet: url.searchParams.get("gebiet")! }),
        });
        await route.fulfill({ json: leereLeuchten(eintrag) });
    });
    return fragen;
}
