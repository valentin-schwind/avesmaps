import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";
import type {
    KartenvorschlagDetail,
    KartenvorschlagListe,
    KartenvorschlagZeile,
    VorgangListe,
    VorgangZeile,
} from "@avesmaps3d/shared";
import { MIT_MEDIEN } from "./medien-quelle.ts";

/**
 * Die Redaktion der Kartenvorschläge ohne Datenbank (WI-0275): Vorschläge und die Antworten des Servers für `kartenvorschlag-redaktion.spec.ts` und `.touch.spec.ts`. Seit WI-0305 stehen die Vorschläge in der Liste der
 * Meldungen; darum antwortet hier auch die Liste der Vorgänge, mit einem offenen.
 */

const HIER = dirname(fileURLToPath(import.meta.url));
export const AUFNAHMEN = process.env["E2E_AUFNAHMEN"];
const VORSCHAU = readFileSync(join(HIER, "..", "public", "icons", "header", "gebaeude.webp"));
export const REDAKTION = [...MIT_MEDIEN, "moderate_submissions", "moderate_map_suggestions"];

export const kennung = (n: number): string => `7dcf1e76-4c1a-4b0e-9a6e-${String(n).padStart(12, "0")}`;
const GARETH = { id: kennung(100), name: "Gareth" };
export const HAVENA = { id: kennung(101), name: "Havena" };
const vor = (tage: number): string => new Date(Date.now() - tage * 86_400_000).toISOString();

export function datei(patch: Partial<KartenvorschlagDetail> = {}): KartenvorschlagDetail {
    return {
        id: kennung(1),
        nummer: "K-1047",
        zustand: "pending",
        weg: "datei",
        titel: "Gareth, Gesamtplan",
        link: null,
        dateiTyp: "image/jpeg",
        ort: GARETH,
        eingegangenAm: vor(5),
        technik: "ok",
        revision: 3,
        beschreibung: "Die ganze Stadt mit allen Vierteln.",
        quelle: "Beispielbote",
        nutzung: "cc-by-4.0",
        name: "Alrik M.",
        typen: ["stadtplan"],
        urheber: null,
        art: "politisch",
        gueltigAb: null,
        gueltigBis: null,
        farbe: null,
        spoiler: false,
        beschriftet: null,
        mehrstoeckig: null,
        offiziell: null,
        kostenpflichtig: null,
        vorschauLink: null,
        notiz: "Eigene Reinzeichnung.",
        asset: kennung(50),
        entschiedenAm: null,
        grund: null,
        karte: null,
        ortArt: "Stadt",
        ortLage: { x: 500, y: 500 },
        vorschau: `/api/editor/media/${kennung(50)}/preview/intern_citymap_2048`,
        ...patch,
    };
}
export function link(patch: Partial<KartenvorschlagDetail> = {}): KartenvorschlagDetail {
    return datei({
        id: kennung(2),
        nummer: "K-1052",
        weg: "link",
        titel: "Das Neue Reich, Handelswege",
        link: "https://www.beispielshop.example/karte",
        dateiTyp: null,
        ort: null,
        eingegangenAm: vor(2),
        technik: null,
        nutzung: null,
        name: null,
        notiz: null,
        asset: null,
        ortArt: null,
        ortLage: null,
        vorschau: null,
        ...patch,
    });
}

export interface Server {
    vorschlaege: KartenvorschlagDetail[];
    /** Die Rümpfe der Schritte. */
    annehmen: Record<string, unknown>[];
    ablehnen: Record<string, unknown>[];
    /** Die nächste Antwort auf einen Schritt, einmal. */
    naechsterFehler?: { status: number; code: string };
    /** Die Anfragen der Liste (nur der Query-String). */
    listen: string[];
    /** Die Anfragen der Vorgänge (WI-0305: Die Meldungen holen beide Quellen). */
    vorgaenge: string[];
}

/** Ein offener Vorgang neben den Kartenvorschlägen in der Liste der Meldungen (WI-0305). */
export const VORGANG: VorgangZeile = {
    nummer: "COM-000007",
    art: "meldung",
    kategorie: "lage",
    zustand: "neu",
    ergebnis: null,
    prioritaet: "normal",
    eingang: "website",
    bezugName: "Wehrheim",
    bezugArt: "objekt",
    zustaendig: null,
    ohneQuelle: false,
    moeglicheDublette: null,
    eingegangenAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    aktivAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    revision: 1,
};

const json = (route: Route, status: number, body: unknown): Promise<void> =>
    route.fulfill({
        status,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify(body),
    });

function alsZeile(v: KartenvorschlagDetail): KartenvorschlagZeile {
    const { id, nummer, zustand, weg, titel, link: adresse, dateiTyp, ort, eingegangenAm, technik } = v;
    return { id, nummer, zustand, weg, titel, link: adresse, dateiTyp, ort, eingegangenAm, technik };
}

export async function server(page: Page, vorschlaege: KartenvorschlagDetail[]): Promise<Server> {
    const stand: Server = { vorschlaege, annehmen: [], ablehnen: [], listen: [], vorgaenge: [] };
    await page.route("**/api/community/stand", (route) =>
        json(route, 200, { meldungen: true, mailweg: false, discord: false }),
    );
    // Die Vorgänge der Meldungen: ein offener in Offen, sonst keiner; die Suche trifft seinen Bezug.
    await page.route("**/api/community/vorgaenge?**", (route) => {
        const url = new URL(route.request().url());
        stand.vorgaenge.push(url.search);
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const offen = (url.searchParams.get("segment") ?? "offen") === "offen";
        const zeilen = offen && (VORGANG.bezugName ?? "").toLowerCase().includes(q) ? [VORGANG] : [];
        const antwort: VorgangListe = {
            zeilen,
            zaehler: {
                offen: 1,
                erledigt: 0,
                archiv: 0,
                papierkorb: 0,
                meine: 1,
                neu: 1,
                inArbeit: 0,
                rueckfrage: 0,
            },
        };
        return json(route, 200, antwort);
    });
    await page.route("**/api/community/kartenvorschlaege**", async (route) => {
        const url = new URL(route.request().url());
        const treffer = /^\/api\/community\/kartenvorschlaege\/([0-9a-f-]{36})(?:\/(annehmen|ablehnen))?$/u.exec(
            url.pathname,
        );
        if (treffer === null) {
            stand.listen.push(url.search);
            const segment = url.searchParams.get("segment") ?? "offen";
            const q = (url.searchParams.get("q") ?? "").toLowerCase();
            const zustaende: Record<string, readonly string[]> = {
                offen: ["pending", "incoming", "technical_failed"],
                angenommen: ["approved"],
                abgelehnt: ["rejected", "withdrawn"],
            };
            const zahl = (zustand: string): number => stand.vorschlaege.filter((v) => v.zustand === zustand).length;
            const antwort: KartenvorschlagListe = {
                eintraege: stand.vorschlaege
                    .filter((v) => zustaende[segment]?.includes(v.zustand) === true)
                    .filter((v) => v.titel.toLowerCase().includes(q))
                    .map(alsZeile),
                zaehler: {
                    incoming: zahl("incoming"),
                    technical_failed: zahl("technical_failed"),
                    pending: zahl("pending"),
                    approved: zahl("approved"),
                    rejected: zahl("rejected"),
                    withdrawn: zahl("withdrawn"),
                },
                weitere: false,
                naechste: null,
            };
            return json(route, 200, antwort);
        }
        const v = stand.vorschlaege.find((eintrag) => eintrag.id === treffer[1]);
        if (v === undefined) return json(route, 404, { error: { code: "kartenvorschlag_not_found", message: "weg" } });
        const schritt = treffer[2];
        if (schritt === undefined) return json(route, 200, v);
        const rumpf = route.request().postDataJSON() as Record<string, unknown>;
        (schritt === "annehmen" ? stand.annehmen : stand.ablehnen).push(rumpf);
        if (stand.naechsterFehler !== undefined) {
            const { status, code } = stand.naechsterFehler;
            delete stand.naechsterFehler;
            v.revision += 1;
            return json(route, status, { error: { code, message: "Text des Servers" } });
        }
        v.revision += 1;
        v.entschiedenAm = new Date().toISOString();
        if (schritt === "annehmen") {
            v.zustand = "approved";
            v.karte = kennung(60);
        } else {
            v.zustand = "rejected";
            v.grund = typeof rumpf["grund"] === "string" ? rumpf["grund"] : null;
        }
        return json(route, 200, v);
    });
    await page.route(/\/api\/editor\/media\/[0-9a-f-]{36}\/preview\//u, (route) =>
        route.fulfill({ status: 200, contentType: "image/webp", body: VORSCHAU }),
    );
    await page.route("**/api/search?**", (route) =>
        json(route, 200, {
            query: "hav",
            hits: [
                { kind: "ort", id: HAVENA.id, name: HAVENA.name, subtype: "metropole", x: 1, y: 2, zoom: 5 },
                { kind: "weg", id: "name:Havener Straße", name: "Havener Straße", x: 1, y: 2, zoom: 5 },
            ],
            truncated: false,
        }),
    );
    return stand;
}
