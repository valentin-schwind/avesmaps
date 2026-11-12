import type { Page } from "@playwright/test";
import type { MapHistoryEntry, MapHistoryPage, RuecknahmePruefung } from "@avesmaps3d/shared";
import { GRATENFELS } from "./ortseditor-stub.ts";

/**
 * Der gestellte Server für die Neugestaltung von „Änderungen“ (WI-0265 B10; Vorlage `review/wi-0265/aenderungen-neu.html`): eine Liste über vier Tage, wie die Vorlage sie zeigt, mit
 * Läufen des WikiSync und des Imports (zu bündeln), einer Rücknahme samt Original, einer Arbeitsserie und einer langen Beschreibung (zwei Zeilen mit „mehr“). Beide Specs
 * (`aenderungen-liste.spec.ts` am Rechner, `aenderungen-liste.touch.spec.ts` am Telefon) lesen dieselbe Seite.
 *
 * Die Zeiten hängen am heutigen Tag (`at`: Tage zurück, Stunde, Minute), die Zeitzone ist UTC (`ZEITZONE`): Dann heißen die Tagesköpfe in jedem Lauf gleich („Heute“, „Gestern“, der Wochentag von vor drei Tagen), ohne dass
 * die Uhr des Browsers festgestellt wird (🪤 eine feste `Date` im Browser ließ das Editorpanel den Reiter nicht wählen).
 */

export const ZEITZONE = "UTC";
const HEUTE = ((): number => {
    const jetzt = new Date();
    return Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate());
})();
/** Ein Zeitpunkt: `tageZurueck` Tage vor heute, `stunde`:`minute` UTC. */
export const at = (tageZurueck: number, stunde: number, minute = 0): string =>
    new Date(HEUTE - tageZurueck * 86_400_000 + (stunde * 60 + minute) * 60_000).toISOString();
export const RECHTE = [
    "use_editor_menu",
    "edit_map_objects",
    "edit_map_geometry",
    "edit_territories",
    "edit_landscapes",
    "edit_territory_form",
    "edit_landscape_form",
    "edit_mountains",
];

export const json = (body: unknown): { status: number; contentType: string; body: string } => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
});

/** Eine feste, gültige Kennung je Nummer. */
export const op = (n: number): string => `b10b1010-0000-4000-9000-${String(n).padStart(12, "0")}`;

const ICH = { kind: "person", name: "Rondrikan", id: "b10b1010-0000-4000-8000-000000000001", self: true } as const;
const THOMAS = { kind: "person", name: "Thomas", id: "b10b1010-0000-4000-8000-000000000002" } as const;
const MARA = { kind: "person", name: "Mara", id: "b10b1010-0000-4000-8000-000000000003" } as const;
const SYSTEM = { kind: "system" } as const;

const LANG =
    "Große Hafenstadt am Golf von Perricum, Sitz der Academia der Hohen Magie und eines bedeutenden Basars, in dem Waren aus dem ganzen Horasreich gehandelt werden, von Gewürzen bis zu Büchern aus fernen Ländern.";

type Teil = Pick<MapHistoryEntry, "at" | "actor"> &
    Partial<Omit<MapHistoryEntry, "operationId" | "seq" | "at" | "actor" | "objects">> & {
        readonly n: number;
        readonly name: string;
        readonly felder: Record<string, { before?: unknown; after?: unknown }>;
        readonly weitere?: readonly string[];
    };

function eintrag(teil: Teil): MapHistoryEntry {
    const { n, name, felder, weitere, ...rest } = teil;
    return {
        operationId: op(n),
        seq: 1000 - n,
        operation: "place.update",
        source: "editor",
        status: "ruecknehmbar",
        ...rest,
        objects: [name, ...(weitere ?? [])].map((gegenstand, i) => ({
            kind: "place",
            // Alle Orte tragen die Kennung des Ortes der Stubs: Das ↺ des Ortes fragt `places/<Kennung>/restore-series`.
            id: i === 0 ? GRATENFELS : `b10b1010-0000-4000-8100-${String(n * 10 + i).padStart(12, "0")}`,
            name: gegenstand,
            action: "place.updated",
            revisionBefore: 8,
            revisionAfter: 9,
            changes: i === 0 ? felder : { description: { before: "alt", after: "neu" } },
        })),
    };
}

const WIKI = { source: "wikisync", status: "nicht_ruecknehmbar", statusReason: "quelle" } as const;

export const SEITE: MapHistoryPage = {
    entries: [
        // Heute (1.11.)
        eintrag({
            n: 1,
            at: at(0, 13, 2),
            actor: ICH,
            name: "Luring",
            summary: "Luring geändert",
            felder: { description: { before: "Südwestlich von Gareth", after: "Nordwestlich von Gareth" } },
        }),
        eintrag({
            n: 2,
            at: at(0, 10, 30),
            actor: THOMAS,
            name: "Kuslik",
            summary: "Kuslik: Einwohner, Beschreibung geändert",
            felder: {
                einwohner: { before: 8400, after: 8900 },
                description: { before: "Hafenstadt am Golf von Perricum.", after: LANG },
            },
        }),
        eintrag({
            n: 3,
            at: at(0, 2, 0),
            actor: ICH,
            ...WIKI,
            name: "Hirschfurt",
            weitere: ["Honingen"],
            summary: "WikiSync: 2 Felder aus dem Wiki übernommen (2 Objekte)",
            felder: { description: { before: "Dorf", after: "Kleinstadt" } },
        }),
        eintrag({
            n: 4,
            at: at(0, 2, 0),
            actor: SYSTEM,
            source: "import",
            status: "nicht_ruecknehmbar",
            statusReason: "quelle",
            name: "Rommilys",
            weitere: ["Punin", "Tarle"],
            summary: "Karte aus Legacy aktualisiert (Zug)",
            felder: { description: { before: "alt", after: "neu" } },
        }),
        eintrag({
            n: 5,
            at: at(0, 0, 48),
            actor: ICH,
            ...WIKI,
            name: "Gareth",
            summary: "WikiSync: 608 Felder aus dem Wiki übernommen (90 Objekte)",
            felder: { description: { before: "alt", after: "neu" } },
        }),
        // Gestern (31.10.)
        eintrag({
            n: 6,
            at: at(1, 21, 40),
            actor: ICH,
            source: "restore",
            name: "Rommilys",
            summary: "Rommilys: Änderung zurückgenommen",
            reverts: [op(7)],
            reason: "falscher Ort, Rückfrage von Thomas",
            felder: { description: { before: "Weiden, am Ufer", after: "Garetien, an der Reichsstraße" } },
        }),
        eintrag({
            n: 7,
            at: at(1, 20, 5),
            actor: MARA,
            status: "bereits_zurueckgenommen",
            revertedBy: {
                operationId: op(6),
                at: at(1, 21, 40),
                actor: ICH,
                reason: "falscher Ort, Rückfrage von Thomas",
            },
            name: "Rommilys",
            summary: "Rommilys geändert",
            felder: { description: { before: "Garetien, an der Reichsstraße", after: "Weiden, am Ufer" } },
        }),
        // Mittwoch, 28. Oktober: eine Arbeitsserie von drei Schritten, der letzte zurückgenommen (◐)
        eintrag({
            n: 10,
            at: at(3, 15, 20),
            actor: ICH,
            status: "bereits_zurueckgenommen",
            name: "Havena",
            summary: "Havena geändert",
            series: { id: op(8), position: 3, size: 3 },
            felder: { einwohner: { before: 5200, after: 5600 } },
        }),
        eintrag({
            n: 9,
            at: at(3, 15, 11),
            actor: ICH,
            name: "Havena",
            summary: "Havena geändert",
            series: { id: op(8), position: 2, size: 3 },
            felder: { description: { before: "Hafenstadt", after: "Große Hafenstadt" } },
        }),
        eintrag({
            n: 8,
            at: at(3, 15, 5),
            actor: ICH,
            name: "Havena",
            summary: "Havena geändert",
            series: { id: op(8), position: 1, size: 3 },
            felder: { name: { before: "Havenna", after: "Havena" } },
        }),
    ],
    series: [
        {
            id: op(8),
            size: 3,
            delivered: 3,
            members: [op(8), op(9), op(10)],
            membersHash: "b".repeat(64),
            scope: { kind: "place", id: GRATENFELS, name: "Havena" },
        },
    ],
};

/** Die Vorprüfung des Servers für EIN Mitglied: alles in Ordnung, ohne Folgen. */
const pruefung = (operationId: string): RuecknahmePruefung => ({
    ergebnis: "ok",
    membersHash: "f".repeat(64),
    mitglieder: [
        {
            operationId,
            seq: 1,
            at: at(0, 13, 2),
            operation: "place.update",
            source: "editor",
            actor: { kind: "person", name: "Rondrikan", self: true },
            status: "ruecknehmbar",
            offen: true,
            gegenstaende: [
                {
                    kind: "place",
                    id: GRATENFELS,
                    name: "Luring",
                    action: "place.updated",
                    revisionBefore: 8,
                    revisionAfter: 9,
                    felder: [],
                },
            ],
        },
    ],
    offen: [operationId],
    gegenstaende: [],
    konflikte: [],
    sperren: [],
    fehlendeRechte: [],
    fremdePersonen: [],
    reasonRequired: false,
    folgen: { gegenstaende: 1, gelaende: "keines" },
});

export interface ListenStubs {
    /** Die Fragen an die Liste der Änderungen. */
    readonly fragen: string[];
    /** Die Körper der Vorprüfungen der Rücknahme. */
    readonly vorschau: unknown[];
    /** Die Körper der Rücknahmen: Hier darf nie etwas stehen, solange niemand bestätigt. */
    readonly zurueck: unknown[];
}

/** Stellt den Server: die Liste, die Vorprüfung und die Rücknahme. Vor `page.goto` aufrufen. */
export async function stubs(page: Page): Promise<ListenStubs> {
    const fragen: string[] = [];
    const vorschau: unknown[] = [];
    const zurueck: unknown[] = [];
    await page.route("**/api/editor/status", (route) => route.fulfill(json({ mapEditing: "testwelt" })));
    await page.route("**/api/editor/changes*", (route) => {
        fragen.push(route.request().url());
        return route.fulfill(json(SEITE));
    });
    await page.route(`**/api/editor/places/${GRATENFELS}/restore-series/preview`, (route) => {
        const body = route.request().postDataJSON() as { members: string[] };
        vorschau.push(body);
        return route.fulfill(json(pruefung(body.members[0] ?? op(1))));
    });
    await page.route(`**/api/editor/places/${GRATENFELS}/restore-series`, (route) => {
        zurueck.push(route.request().postDataJSON());
        return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });
    return { fragen, vorschau, zurueck };
}

/** Der Kopf des dritten Tages („Mittwoch, 28. Oktober“, liegt der Tag in einem anderen Jahr, mit Jahr), wie die Liste ihn schreibt. */
export function dritterTagesKopf(): string {
    const tag = new Date(at(3, 12));
    const anderesJahr = tag.getUTCFullYear() !== new Date().getUTCFullYear();
    return new Intl.DateTimeFormat("de-DE", {
        weekday: "long",
        day: "numeric",
        month: "long",
        ...(anderesJahr ? { year: "numeric" } : {}),
        timeZone: ZEITZONE,
    }).format(tag);
}
