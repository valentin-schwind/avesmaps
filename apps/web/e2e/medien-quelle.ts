import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Page, Route } from "@playwright/test";
import type {
    EditorPlaceList,
    MamGalleryList,
    MamNavigation,
    MamSearchQuery,
    MamSearchResult,
    MediaAssetDetail,
    MediaGalleryDetail,
    MediaSubjectSlots,
    MediaUsageResult,
} from "@avesmaps3d/shared";

/**
 * Die Medienverwaltung im Browser gegen ECHTE Medien (WI-0068 P3): die 2.484 Assets in `avesmaps3d_dev`.
 *
 * 🔴 Die Routen `/api/editor/media…` verlangen eine echte Sitzung mit `view_media_private`; einen Test-Schalter im Server gibt es
 * bewusst nicht, und ein Konto in der gemeinsamen Datenbank anzulegen wäre Ballast. Deshalb kommt - wie in jeder Spec der Anmeldung -
 * die SITZUNG aus einem Stub, und die Antworten der fünf Routen rechnet dieser Helfer mit DENSELBEN Abfragen des Servers
 * (`apps/server/src/media-editor/*`, nur lesend) gegen die Entwicklungsdatenbank. Was der Wächter `protect("view_media_private")` tut
 * (401, 403 vor der Prüfung), prüfen die Servertests (`apps/server/test/media-editor-routes.test.ts`); dass die echte Route ohne
 * Sitzung 401 sagt, prüft die Spec am laufenden Stapel. Bilder kommen unverändert vom Stapel (`/media/sha256/…`, öffentlich).
 *
 * Die Servermodule werden zur Laufzeit geladen (Node entfernt die Typen selbst, wie beim Server): Ein statischer Import zöge
 * `apps/server` in den Typecheck der Browsertests, deren Projekt nur `e2e/` kennt. Die Typen kommen aus dem Vertrag.
 *
 * `DATABASE_URL` aus der Umgebung, sonst aus der `.env` des Repositoriums; ohne sie überspringt die Spec sichtbar.
 */

const REPO = resolve(import.meta.dirname, "../../..");

/** Was dieser Helfer vom Server braucht, in den Typen des Vertrags. */
export interface MedienAbfragen {
    mediaNavigation(db: unknown): Promise<MamNavigation>;
    searchMedia(db: unknown, query: MamSearchQuery): Promise<MamSearchResult>;
    assetDetail(db: unknown, id: string): Promise<MediaAssetDetail | undefined>;
    usageOf(db: unknown, id: string): Promise<MediaUsageResult | undefined>;
    galleryDetail(db: unknown, id: string): Promise<MediaGalleryDetail | undefined>;
    /** Die Galerien als Liste der Spalte 2 (WI-0068 P6). */
    galleryList(
        db: unknown,
        options: { q?: string | undefined; limit: number; offset: number },
    ): Promise<MamGalleryList>;
    /** Die Ortsliste des Editors - die Ortsauswahl einer Galerie fragt sie (WI-0068 P6). */
    listEditorPlaces(db: unknown): Promise<EditorPlaceList>;
    /** Die Plätze eines Orts oder Gebiets (Wappen, Titelbilder) für die Auswahl (WI-0068 P4b). */
    subjectSlots(db: unknown, kind: "place" | "territory", id: string): Promise<MediaSubjectSlots | undefined>;
}

interface Verbindung {
    end(options: { timeout: number }): Promise<void>;
}

export interface MedienQuelle extends MedienAbfragen {
    db: Verbindung;
}

const laden = <T>(pfad: string): Promise<T> => import(pathToFileURL(resolve(REPO, pfad)).href) as Promise<T>;

/** Die `.env` dieses Checkouts, sonst die des Hauptcheckouts: Ein Worktree hat keine eigene (WI-0192 §2.9). */
function envDateien(): string[] {
    const dateien = [resolve(REPO, ".env")];
    try {
        const gemeinsam = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
            cwd: REPO,
            encoding: "utf8",
        }).trim();
        dateien.push(resolve(dirname(gemeinsam), ".env"));
    } catch {
        // Ohne git bleibt es bei der eigenen.
    }
    return dateien;
}

/**
 * Die Adresse der Entwicklungsdatenbank. 🪤 Ohne sie überspringt jede Spec mit echten Medien ALLE Fälle; `e2e/umgebung.ts` sagt das zu
 * Beginn des Laufs, damit „0 rot“ nicht heimlich „nichts gelaufen“ heißt (WI-0189, WI-0192 §2.9).
 */
export function datenbankAdresse(): string | undefined {
    if (process.env["DATABASE_URL"] === undefined) {
        const datei = envDateien().find((pfad) => existsSync(pfad));
        if (datei !== undefined) process.loadEnvFile(datei);
    }
    return process.env["DATABASE_URL"];
}

let quelle: MedienQuelle | undefined;

/** Die Abfragen des Servers samt einer Verbindung zur Entwicklungsdatenbank; `undefined` ohne `DATABASE_URL`. */
export async function medienQuelle(): Promise<MedienQuelle | undefined> {
    if (quelle !== undefined) return quelle;
    const adresse = datenbankAdresse();
    if (adresse === undefined) return undefined;
    const { createDatabase } = await laden<{ createDatabase(url: string, options: { max: number }): Verbindung }>(
        "apps/server/src/database.ts",
    );
    const [search, detail, usage, gallery, slots, orte] = await Promise.all([
        laden<Pick<MedienAbfragen, "mediaNavigation" | "searchMedia">>("apps/server/src/media-editor/search.ts"),
        laden<Pick<MedienAbfragen, "assetDetail">>("apps/server/src/media-editor/detail.ts"),
        laden<Pick<MedienAbfragen, "usageOf">>("apps/server/src/media-editor/usage.ts"),
        laden<Pick<MedienAbfragen, "galleryDetail" | "galleryList">>("apps/server/src/media-editor/gallery.ts"),
        laden<Pick<MedienAbfragen, "subjectSlots">>("apps/server/src/media-editor/slots.ts"),
        laden<Pick<MedienAbfragen, "listEditorPlaces">>("apps/server/src/editor/places.ts"),
    ]);
    quelle = {
        db: createDatabase(adresse, { max: 2 }),
        mediaNavigation: search.mediaNavigation,
        searchMedia: search.searchMedia,
        assetDetail: detail.assetDetail,
        usageOf: usage.usageOf,
        galleryDetail: gallery.galleryDetail,
        galleryList: gallery.galleryList,
        subjectSlots: slots.subjectSlots,
        listEditorPlaces: orte.listEditorPlaces,
    };
    return quelle;
}

/** Die Antworten, die die Routen gerade aus der Datenbank holen. */
const laufend = new Set<Promise<void>>();

export async function schliesseMedienQuelle(): Promise<void> {
    // 🪤 Nach dem letzten Fall einer Datei hat die Seite oft noch Anfragen offen (Liste, Detail, Verwendung). Schlösse die Verbindung
    // vorher, scheiterten ihre Abfragen mit CONNECTION_ENDED, und Playwright färbte den Fall rot, obwohl er fertig war (WI-0192 §2.9,
    // „Neu hochladen“: 41 ms zwischen Testende und Schließen, vier Anfragen offen).
    await Promise.allSettled([...laufend]);
    await quelle?.db.end({ timeout: 5 });
    quelle = undefined;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Die Anfrage aus dem Query-String.
 *
 * 🪤 Ein Query-Parameter ist IMMER Text; der echte Server wandelt ihn nach dem Schema (Fastify/TypeBox). Dieser Helfer
 * muss dasselbe tun, sonst sieht ein Abnahmeblatt ein Verhalten, das es so nicht gibt: `groupFiles=true` käme als Zeichenkette
 * an, `=== true` wäre falsch, und die Liste zeigte jede Dublette einzeln - ohne Fehler und ohne Spur (gefunden am Blatt,
 * 2026-10-13).
 */
function anfrageAus(url: URL): MamSearchQuery {
    const anfrage: Record<string, string | number | boolean> = {};
    for (const [name, wert] of url.searchParams) {
        anfrage[name] =
            name === "limit" || name === "offset" ? Number(wert) : name === "groupFiles" ? wert === "true" : wert;
    }
    return anfrage as MamSearchQuery;
}

const json = (route: Route, status: number, body: unknown): Promise<void> =>
    route.fulfill({
        status,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify(body),
    });

const fehlt = (route: Route, was: string): Promise<void> =>
    json(route, 404, { error: { code: "not_found", message: `${was} gibt es nicht.` } });

/** Beantwortet die Leserouten des MAM aus der Entwicklungsdatenbank, mit den Abfragen des Servers (dazu die Plätze, WI-0068 P4b). */
export async function bedieneMedienrouten(page: Page, q: MedienQuelle): Promise<void> {
    await page.route("**/api/editor/**", (route) => {
        // Gemerkt, damit `schliesseMedienQuelle` auf sie wartet. Ist die Seite inzwischen zu, geht die Antwort ins Leere; das ist kein
        // Fehler des Falls.
        const antwort = beantworte(route, q).catch((fehler: unknown) => {
            if (!page.isClosed()) throw fehler;
        });
        laufend.add(antwort);
        return antwort.finally(() => laufend.delete(antwort));
    });
}

/** Die Antwort auf eine Leseroute des MAM aus der Entwicklungsdatenbank. */
async function beantworte(route: Route, q: MedienQuelle): Promise<void> {
    const url = new URL(route.request().url());
    const pfad = url.pathname;
    let treffer: RegExpExecArray | null;
    if (pfad === "/api/editor/media/navigation") return json(route, 200, await q.mediaNavigation(q.db));
    if (pfad === "/api/editor/media") return json(route, 200, await q.searchMedia(q.db, anfrageAus(url)));
    if ((treffer = new RegExp(`^/api/editor/media/(${UUID})/usage$`).exec(pfad)) !== null) {
        const usage = await q.usageOf(q.db, treffer[1]!);
        return usage === undefined ? fehlt(route, "Dieses Medium") : json(route, 200, usage);
    }
    if ((treffer = new RegExp(`^/api/editor/media/(${UUID})$`).exec(pfad)) !== null) {
        const detail = await q.assetDetail(q.db, treffer[1]!);
        return detail === undefined ? fehlt(route, "Dieses Medium") : json(route, 200, detail);
    }
    if ((treffer = new RegExp(`^/api/editor/media/subjects/(place|territory)/(${UUID})$`).exec(pfad)) !== null) {
        const plaetze = await q.subjectSlots(q.db, treffer[1] as "place" | "territory", treffer[2]!);
        return plaetze === undefined ? fehlt(route, "Dieses Objekt") : json(route, 200, plaetze);
    }
    if (pfad === "/api/editor/places") return json(route, 200, await q.listEditorPlaces(q.db));
    if (pfad === "/api/editor/galleries") {
        return json(
            route,
            200,
            await q.galleryList(q.db, {
                q: url.searchParams.get("q") ?? undefined,
                limit: Number(url.searchParams.get("limit") ?? 50),
                offset: Number(url.searchParams.get("offset") ?? 0),
            }),
        );
    }
    if ((treffer = new RegExp(`^/api/editor/galleries/(${UUID})$`).exec(pfad)) !== null) {
        const galerie = await q.galleryDetail(q.db, treffer[1]!);
        return galerie === undefined ? fehlt(route, "Diese Galerie") : json(route, 200, galerie);
    }
    return fehlt(route, "Diese Adresse");
}

/** Eine Person mit der Rolle Reviewer (erfunden), wie sie `GET /api/auth/session` nennt. */
export const REVIEWER = {
    id: "2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3d4e",
    displayName: "Hesindiane",
    role: "reviewer",
    methods: ["discord"],
    assurance: "strong",
    sessionMethod: "discord",
    confirmedAt: "2026-10-10T08:00:00.000Z",
    passkeyConfirmedAt: null,
    expiresAt: "2026-11-09T08:00:00.000Z",
    passkeyCount: 0,
};

/** Was ein Reviewer aus seiner Vorlage hat, soweit es die Karte betrifft (AUTH-0001 §7.2), mit dem Recht der Medienverwaltung. */
export const MIT_MEDIEN = ["use_editor_menu", "view_editor_series", "pin_selection", "view_media_private"];
export const OHNE_MEDIEN = ["use_editor_menu", "view_editor_series", "pin_selection"];

export async function stubSitzung(page: Page, capabilities: readonly string[]): Promise<void> {
    await page.route("**/api/auth/session", (route) =>
        json(route, 200, { environment: "development", authEnabled: true, person: REVIEWER, capabilities }),
    );
}

/** Gareth (Ort): 84 Medien verwenden ihn, darunter sein Wappen (Mockup WI-0068). */
export const GARETH = "80558060-4299-54aa-b520-814b10819885";
