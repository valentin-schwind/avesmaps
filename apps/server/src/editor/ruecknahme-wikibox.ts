import {
    type MapHistoryEntry,
    type MapHistoryObjectKind,
    type RuecknahmeBody,
    type RuecknahmePruefung,
    type RuecknahmeReceipt,
    type RuecknahmeVorschauBody,
    type WikiBoxArt,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import {
    weitereEintraege,
    type WeitereZeile,
    zuordnungsEintraege,
    zuordnungsZusatz,
    type AbschnittsStand,
    type Anschluss,
    type BoxObjekt,
    type Zuordnungsherkunft,
} from "../wiki/objekt/anschluss.ts";
import { ANSCHLUESSE } from "../wiki/objekt/box.ts";
import { eintraegeNachKennung } from "./history.ts";
import type { MapActor, MapAuditEntry } from "./map-operation.ts";
import { fuehreRuecknahmeAus, pruefeFamilie, type RuecknahmeFamilie } from "./ruecknahme-ablauf.ts";
import { RUECKNAHME_WIKIBOX_OPERATION, WIKIBOX_OPERATIONEN } from "./ruecknahme-arten.ts";
import { mitGrund, nichtRuecknehmbar, zusammenfassung } from "./ruecknahme-inhalte.ts";
import type { RuecknahmeAdapter, RuecknahmeLeser, VorKonflikt } from "./ruecknahme.ts";

/**
 * Die Wiki-Box zurücknehmen (WI-0265 B8d; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` C.2, C.3, F.1, Gate 2 und 3): der Adapter für `wikibox.zuweisen` und `wikibox.entfernen`
 * (`routes/editor-wiki-box.ts`) für die Vorprüfung (`ruecknahme.ts`), die Vorschau und die Rücknahme in EINER Operation `wikibox.restore_series` (Quelle `restore`, `reverts` = die Operation).
 *
 * 🔴 **Eine eigene Familie, nie Teil einer Serie.** Das Protokoll nennt als Gegenstand den Träger selbst (`place:`, `territory:`, `landscape:`, `peak:`; beim Weg und bei der Kraftlinie je Abschnitt einen). Nach dem
 * Scope-Schlüssel teilte die Wiki-Box damit die Serie ihres Trägers wie die Quellen (`traeger.sources`, B6g3). Das ginge nur, wenn jeder der sechs Adapter (Ort, Gebiet, Derographie, Gipfel, Weg, Kraftlinie) die Anschlüsse
 * der Box kennte; die Box läuft aber über die Anschlüsse der Wiki-Arten (`wiki/objekt/`), nicht über die Schreibwege der Familie. Darum steht ein Schritt der Wiki-Box als Einzeleintrag da (`EINZEL_OPERATIONEN`), trennt
 * die Serie des Trägers und wird von hinten einzeln zurückgenommen: Eine spätere Änderung am Träger (auch der Sync, den die Oberfläche nach dem Zuweisen anstößt) ist nach der strengen Regel ein Konflikt, bis sie
 * selbst zurückgenommen ist. Die Familie sind die sechs Arten der Box, eine Route je Art: `POST /api/editor/wiki-box/:art/:id/restore-series[/preview]`.
 *
 * 🔴 **Was zurückgeht:** die Zuordnung von vorher, wie das Protokoll sie führt: `wiki` (der Schlüssel des Artikels vorher und nachher) und, seit B8d, `zuordnung` (Zustand, Herkunft und System der Tafel, wo die Art sie
 * führt: Ort, Weg, Kraftlinie, Gipfel). Die Rücknahme nutzt die Schreibwege der Box selbst (`weise`, `entferne`: Tafel X2, Revision), setzt danach Zustand, Herkunft und System der Zuordnung zurück (eine Zuordnung des
 * Imports gehört danach wieder dem Import) und zählt die Revision des Trägers einmal. War vorher kein Artikel zugewiesen, wird entfernt („kein Artikel“); die Zeile der Tafel wird nie gelöscht.
 *
 * 🔴 **Grenzen (ehrlich):**
 * - Ein Eintrag aus der Zeit vor B8d trägt `zuordnung` nicht: Die Zuordnung geht dann mit der Herkunft der Redaktion zurück (`editor`, `avesmaps3d`), der Artikel selbst stimmt.
 * - Das Entfernen wandelte Felder, die dem Wiki folgten, in eigene (Vermerk `manual`, bei Ort, Kraftlinie und Gipfel auch Werte): Das Protokoll kennt nicht, welche. Die Rücknahme belässt sie als eigene (Werte gehen nie
 *   verloren); der Sync holt den Wiki-Wert erst, wenn die Redaktion das Feld wieder dem Wiki überlässt.
 * - War der Artikel vorher nur eine Adresse ohne Wiki-Stand (`address_only`) oder gibt es seinen Stand nicht mehr, lässt er sich nicht zuweisen: Konflikt `wert` (Schlüssel `wikibox_artikel`), nichts wird geschrieben.
 * - Hing der Artikel vorher nur an einem Teil der Abschnitte einer Straße (etwa vor „An alle Abschnitte“ im Wegeditor), gibt die Rücknahme jedem Abschnitt seinen Stand von vorher zurück (OPS-000112): Das Protokoll
 *   führt ihn je Abschnitt (`wikiOrigin`, `AbschnittsStand`: Hauptzuordnung samt Herkunft, die weiteren Zeilen desselben Artikels, die das Zuweisen still legte). Ein Eintrag ohne diesen Stand (vor OPS-000112)
 *   und die Kraftlinie, die ihn nicht führt, gäben den Artikel allen Abschnitten: Konflikt `wert` (Schlüssel `wikibox_teilweise`), nichts wird geschrieben.
 *
 * **Weitere Artikel eines Wegs** (WI-0300, `wikibox.weitere_zuweisen`, `.weitere_entfernen`; Aktionen `path.wiki_weitere_zugewiesen`, `.wiki_weitere_entfernt`, Felder `wikiWeitere` und `wikiWeitereOrigin`): Die Rücknahme
 * arbeitet auf genau den Zeilen, die der Schritt schrieb (`wikiWeitereOrigin`: je Abschnitt Kennung und Herkunft von vorher), denn ein weiterer Artikel hängt meist nur an einem Teil der Abschnitte. Die angelegten
 * Zeilen gehen wieder, die still gelegten kommen mit ihrer Herkunft zurück. Bedingung: Jede Zeile steht heute so, wie der Schritt sie hinterließ (angelegte aktiv; still gelegte still und ihr Abschnitt trägt den
 * Artikel nicht wieder, auch nicht als Hauptartikel), und der Wiki-Stand des Artikels besteht.
 *
 * **Bedingung:** Der Artikel am Träger ist heute der, den der Schritt hinterließ, und der Träger hat dieselben Kennungen (derselben Straße oder Linie, wie damals); dazu der Kern: Revision gleich der nach dem Schritt,
 * keine spätere Operation am Träger. Recht der Vorwärtsoperation: `edit_map_objects`. Folgen wie vorwärts: kein Auftrag, keine Ableitung; die Revision des Trägers zählt (ein offenes Fenster bekommt beim Speichern 409
 * und liest die Box neu), der Artikel und seine Zuordnung stehen sofort im Infopanel und in der Suche (Tafel X2, Wiki-Zuordnung).
 */

/** Die Aktionen, die die Box schreibt: `<Protokollart>.wiki_zugewiesen` und `.wiki_entfernt`, am Weg dazu `path.wiki_weitere_zugewiesen` und `.wiki_weitere_entfernt` (WI-0300). */
const AKTION =
    /^(?:(?:place|path|territory|region|powerline|peak)\.wiki_(?:zugewiesen|entfernt)|path\.wiki_weitere_(?:zugewiesen|entfernt))$/u;

/** Eine Aktion an einem weiteren Artikel (WI-0300). */
const WEITERE_AKTION = /\.wiki_weitere_(zugewiesen|entfernt)$/u;

/** Welche Art der Box zu welcher Protokollart gehört. */
const ART_VON_PROTOKOLL: Readonly<Record<string, WikiBoxArt>> = {
    place: "ort",
    path: "weg",
    territory: "gebiet",
    region: "region",
    powerline: "kraftlinie",
    peak: "gipfel",
};

/** Die Tafel der Wiki-Stände je Art: Was zugewiesen werden soll, muss dort aktiv stehen (`weise` liest dieselbe Tafel). */
const STAENDE: Readonly<Record<WikiBoxArt, string>> = {
    ort: "wiki_settlement_snapshot",
    weg: "wiki_path_snapshot",
    gebiet: "wiki_territory_snapshot",
    region: "wiki_region_snapshot",
    kraftlinie: "wiki_powerline_snapshot",
    gipfel: "wiki_region_snapshot",
};

/** Die Felder, die ein Eintrag der Box führt; `restoreReason` ist der Grund einer früheren Rücknahme. */
const FELDER: ReadonlySet<string> = new Set([
    "wiki",
    "wikiOrigin",
    "wikiWeitere",
    "wikiWeitereOrigin",
    "zuordnung",
    "restoreReason",
]);

export const istWikiBoxArt = (operation: string, aktionen: readonly string[]): boolean =>
    WIKIBOX_OPERATIONEN.has(operation) && aktionen.length > 0 && aktionen.every((aktion) => AKTION.test(aktion));

/** Der Schritt der Box, wie das Protokoll ihn führt. */
interface Schritt {
    art: WikiBoxArt;
    /** Die Kennungen der Gegenstände (Weg und Kraftlinie: die Abschnitte), sortiert. */
    ids: string[];
    kind: MapHistoryObjectKind;
    /** Der Schlüssel des Artikels vor und nach dem Schritt (`null`: keiner). */
    vorher: string | null;
    nachher: string | null;
    /** Zustand, Herkunft und System der Zuordnung vor dem Schritt; `undefined`, wo das Protokoll sie nicht führt (vor B8d), `null`: es gab keine Zuordnung. */
    herkunft: Zuordnungsherkunft | null | undefined;
    /** Der Stand je Abschnitt vor dem Schritt (OPS-000112); `undefined`, wo das Protokoll ihn nicht führt (vor OPS-000112, Arten ohne Abschnitte). */
    abschnitte?: ReadonlyMap<string, AbschnittsStand>;
    /** Nur ein Schritt an einem weiteren Artikel (WI-0300): sein Schlüssel und was der Schritt tat. `vorher` und `nachher` sind dann ohne Bedeutung. */
    weiterer?: {
        key: string;
        richtung: "zugewiesen" | "entfernt";
        /** Je Abschnitt die Zeile, die der Schritt anlegte (`zugewiesen`) oder still legte (`entfernt`), mit ihrer Herkunft von vorher. */
        zeilen: ReadonlyMap<string, WeitereZeile>;
    };
}

const schluessel = (wert: unknown): string | null | undefined =>
    wert === undefined || wert === null ? null : typeof wert === "string" ? wert : undefined;

const alsHerkunft = (wert: unknown): Zuordnungsherkunft | null | undefined => {
    if (wert === null) return null;
    if (typeof wert !== "object" || Array.isArray(wert)) return undefined;
    const { zustand, herkunft, system, anteil } = wert as Record<string, unknown>;
    if (typeof zustand !== "string" || typeof herkunft !== "string" || typeof system !== "string") return undefined;
    const teil = anteil as { mit?: unknown; von?: unknown } | undefined;
    return {
        zustand,
        herkunft,
        system,
        ...(typeof teil?.mit === "number" && typeof teil.von === "number"
            ? { anteil: { mit: teil.mit, von: teil.von } }
            : {}),
    };
};

/** Eine Zeile eines weiteren Artikels aus dem Protokoll (`wikiWeitereOrigin`): `null`, wo der Schritt an dem Abschnitt nichts schrieb; `undefined`, wo die Form nicht stimmt. */
const alsWeitereZeile = (wert: unknown): WeitereZeile | null | undefined => {
    if (wert === null || wert === undefined) return null;
    if (typeof wert !== "object" || Array.isArray(wert)) return undefined;
    const { id, herkunft } = wert as Record<string, unknown>;
    return typeof id === "string" && /^\d+$/u.test(id) && typeof herkunft === "string" ? { id, herkunft } : undefined;
};

/** Der Stand eines Abschnitts aus dem Protokoll (`wikiOrigin`); `undefined`, wo die Form nicht stimmt. */
const alsAbschnittsStand = (wert: unknown): AbschnittsStand | undefined => {
    if (typeof wert !== "object" || wert === null || Array.isArray(wert)) return undefined;
    const { haupt, weitere } = wert as Record<string, unknown>;
    if (!Array.isArray(weitere)) return undefined;
    const zeilen: WeitereZeile[] = [];
    for (const roh of weitere) {
        const zeile = alsWeitereZeile(roh);
        if (zeile === undefined || zeile === null) return undefined;
        zeilen.push(zeile);
    }
    if (haupt === null) return { haupt: null, weitere: zeilen };
    if (typeof haupt !== "object" || haupt === undefined || Array.isArray(haupt)) return undefined;
    const { key, zustand, herkunft, system } = haupt as Record<string, unknown>;
    if (
        (key !== null && typeof key !== "string") ||
        typeof zustand !== "string" ||
        typeof herkunft !== "string" ||
        typeof system !== "string"
    )
        return undefined;
    return { haupt: { key, zustand, herkunft, system }, weitere: zeilen };
};

/** Der Stand je Abschnitt vor dem Schritt: `undefined`, wo kein Gegenstand ihn führt; wirft `not_revertable`, wo ihn nur ein Teil führt oder die Form nicht stimmt. */
function abschnitteAus(eintrag: MapHistoryEntry): ReadonlyMap<string, AbschnittsStand> | undefined {
    const mit = eintrag.objects.filter((gegenstand) => gegenstand.changes["wikiOrigin"] !== undefined);
    if (mit.length === 0) return undefined;
    if (mit.length !== eintrag.objects.length) throw nichtRuecknehmbar("der Wiki-Box", "wikiOrigin");
    const stand = new Map<string, AbschnittsStand>();
    for (const gegenstand of mit) {
        const wechsel = gegenstand.changes["wikiOrigin"]!;
        const vorher = wechsel.omitted === true ? undefined : alsAbschnittsStand(wechsel.before);
        if (vorher === undefined) throw nichtRuecknehmbar("der Wiki-Box", "wikiOrigin");
        stand.set(gegenstand.id, vorher);
    }
    return stand;
}

/** Der Schritt aus dem Eintrag der Operation (volle Nutzlast); wirft `not_revertable`, wo das Protokoll ihn nicht ganz führt. */
export function schrittAus(eintrag: MapHistoryEntry): Schritt {
    const erster = eintrag.objects[0];
    const art = erster === undefined ? undefined : ART_VON_PROTOKOLL[erster.action.split(".")[0]!];
    if (erster === undefined || art === undefined) throw nichtRuecknehmbar("der Wiki-Box");
    const zuordnung = erster.changes["zuordnung"];
    const herkunft = zuordnung === undefined ? undefined : alsHerkunft(zuordnung.before);
    const ids = eintrag.objects.map((gegenstand) => gegenstand.id).sort();
    const weitereAktion = WEITERE_AKTION.exec(erster.action);
    if (weitereAktion !== null) {
        const weitere = erster.changes["wikiWeitere"];
        if (weitere === undefined || weitere.omitted === true) throw nichtRuecknehmbar("der Wiki-Box", "wikiWeitere");
        const vorherKey = schluessel(weitere.before);
        const nachherKey = schluessel(weitere.after);
        const key = nachherKey ?? vorherKey;
        if (vorherKey === undefined || nachherKey === undefined || key === null || key === undefined)
            throw nichtRuecknehmbar("der Wiki-Box", "wikiWeitere");
        const richtung = weitereAktion[1] === "zugewiesen" ? "zugewiesen" : "entfernt";
        // Die Zeilen je Abschnitt: beim Hinzufügen die angelegte (nachher), beim Lösen die still gelegte (vorher).
        const zeilen = new Map<string, WeitereZeile>();
        for (const gegenstand of eintrag.objects) {
            const wechsel = gegenstand.changes["wikiWeitereOrigin"];
            if (wechsel === undefined || wechsel.omitted === true)
                throw nichtRuecknehmbar("der Wiki-Box", "wikiWeitereOrigin");
            const zeile = alsWeitereZeile(richtung === "zugewiesen" ? wechsel.after : wechsel.before);
            if (zeile === undefined) throw nichtRuecknehmbar("der Wiki-Box", "wikiWeitereOrigin");
            if (zeile !== null) zeilen.set(gegenstand.id, zeile);
        }
        if (zeilen.size === 0) throw nichtRuecknehmbar("der Wiki-Box", "wikiWeitereOrigin");
        return {
            art,
            ids,
            kind: erster.kind,
            vorher: null,
            nachher: null,
            herkunft,
            weiterer: { key, richtung, zeilen },
        };
    }
    const wiki = erster.changes["wiki"];
    if (wiki === undefined || wiki.omitted === true) throw nichtRuecknehmbar("der Wiki-Box", "wiki");
    const vorher = schluessel(wiki.before);
    const nachher = schluessel(wiki.after);
    if (vorher === undefined || nachher === undefined) throw nichtRuecknehmbar("der Wiki-Box", "wiki");
    const abschnitte = abschnitteAus(eintrag);
    return {
        art,
        ids,
        kind: erster.kind,
        vorher,
        nachher,
        herkunft,
        ...(abschnitte === undefined ? {} : { abschnitte }),
    };
}

async function ladeEintraege(
    database: Queryable,
    leser: RuecknahmeLeser,
    mitglieder: readonly string[],
): Promise<MapHistoryEntry[]> {
    return (
        await eintraegeNachKennung(database, [...mitglieder], { personId: leser.personId, nutzlast: "voll" })
    ).entries.filter((eintrag) =>
        istWikiBoxArt(
            eintrag.operation,
            eintrag.objects.map((gegenstand) => gegenstand.action),
        ),
    );
}

function anschlussFuer(art: WikiBoxArt): Anschluss {
    const anschluss = ANSCHLUESSE[art];
    if (anschluss === undefined) throw new ApiError(404, "not_found", "Für diese Art gibt es die Wiki-Box noch nicht.");
    return anschluss;
}

async function ladeObjekt(db: Queryable, anschluss: Anschluss, id: string): Promise<BoxObjekt> {
    const objekt = await anschluss.lies(db, id);
    if (objekt === undefined) throw new ApiError(404, "not_found", "Dieses Objekt gibt es nicht.");
    return objekt;
}

/** Steht der Artikel im Wiki-Stand (aktiv)? Nur dann lässt er sich zuweisen. */
async function standDa(database: Queryable, art: WikiBoxArt, key: string): Promise<boolean> {
    const [zeile] = await database.unsafe<{ da: boolean }[]>(
        `SELECT EXISTS (SELECT 1 FROM ${STAENDE[art]} WHERE wiki_key = $1 AND is_active) AS da`,
        [key],
    );
    return zeile?.da === true;
}

/** Der Adapter der Wiki-Box für `vorpruefen` (siehe Kopf der Datei). */
export const WIKIBOX_ADAPTER: RuecknahmeAdapter = {
    familie: "wikibox",
    // Das Recht der Vorwärtsoperation: `wikibox.zuweisen` und `wikibox.entfernen` verlangen `edit_map_objects` (`POST …/wiki-box/:art/:id/zuweisen`, `…/entfernen`).
    recht: () => "edit_map_objects",
    pruefeArt: (operation, aktionen) =>
        istWikiBoxArt(operation, aktionen) ? { ok: true } : { ok: false, reason: "art" },
    pruefeListe(offen) {
        // Ein Mitglied, das mehr schreibt, als die Rücknahme versteht, nimmt sie nicht mit; ganz oder gar nicht.
        const verworfen = new Map<string, "art">();
        for (const mitglied of offen)
            if (mitglied.gegenstaende.some((gegenstand) => gegenstand.felder.some((feld) => !FELDER.has(feld))))
                verworfen.set(mitglied.operationId, "art");
        return verworfen;
    },
    async pruefeWerte(database, kontext): Promise<readonly VorKonflikt[]> {
        const konflikte: VorKonflikt[] = [];
        for (const eintrag of await ladeEintraege(
            database,
            kontext.leser,
            kontext.offen.map((mitglied) => mitglied.operationId),
        )) {
            const schritt = schrittAus(eintrag);
            const anschluss = anschlussFuer(schritt.art);
            const ersteId = schritt.ids[0]!;
            const name = eintrag.objects[0]?.name === undefined ? {} : { name: eintrag.objects[0].name };
            const wert = (
                felder: string[],
                satz: string,
                was: "felder" | "wikibox_artikel" | "wikibox_teilweise",
            ): VorKonflikt => ({
                art: "wert",
                kind: schritt.kind,
                id: ersteId,
                ...name,
                felder,
                abweichung: { was },
                detail: satz,
            });
            const objekt = await anschluss.lies(database, ersteId);
            if (objekt === undefined) {
                konflikte.push({ art: "geloescht", kind: schritt.kind, id: ersteId, ...name });
                continue;
            }
            // Der Träger besteht aus denselben Gegenständen wie damals (dieselbe Straße oder Linie).
            if ([...objekt.ids].sort().join() !== schritt.ids.join()) {
                konflikte.push(wert(["wiki"], "Der Träger besteht nicht mehr aus denselben Abschnitten.", "felder"));
                continue;
            }
            // Ein weiterer Artikel (WI-0300): Die Zeilen, die der Schritt schrieb, stehen heute so, wie er sie hinterließ.
            if (schritt.weiterer !== undefined) {
                const weitere = anschluss.weitere;
                if (weitere === undefined) throw nichtRuecknehmbar("der Wiki-Box");
                const { key, richtung } = schritt.weiterer;
                const zeilen = [...schritt.weiterer.zeilen.values()];
                const heute = await weitere.pruefe(database, zeilen);
                if (richtung === "zugewiesen" && heute.aktiv !== zeilen.length) {
                    konflikte.push(
                        wert(["wikiWeitere"], "Der weitere Artikel hängt heute nicht mehr so am Weg.", "felder"),
                    );
                    continue;
                }
                if (richtung === "entfernt" && (heute.aktiv > 0 || heute.zwilling > 0)) {
                    konflikte.push(wert(["wikiWeitere"], "Der Artikel hängt heute schon wieder am Weg.", "felder"));
                    continue;
                }
                if (richtung === "entfernt" && !(await standDa(database, schritt.art, key)))
                    konflikte.push(
                        wert(["wikiWeitere"], "Den Wiki-Stand des Artikels gibt es nicht mehr.", "wikibox_artikel"),
                    );
                continue;
            }
            const heute = objekt.artikel?.key ?? null;
            if (heute !== schritt.nachher) {
                konflikte.push(
                    wert(
                        ["wiki"],
                        "Der Artikel am Objekt ist heute ein anderer als nach dem letzten Schritt.",
                        "felder",
                    ),
                );
                continue;
            }
            // Der Stand je Abschnitt (OPS-000112): Jeder Artikel, der zurückkäme, braucht seinen Wiki-Stand.
            if (schritt.abschnitte !== undefined && anschluss.abschnitte !== undefined) {
                const keys = [...schritt.abschnitte.values()].flatMap((stand) =>
                    stand.haupt === null ? [] : [stand.haupt.key],
                );
                let fehlt = keys.includes(null);
                for (const key of new Set(keys))
                    if (!fehlt && key !== null && !(await standDa(database, schritt.art, key))) fehlt = true;
                if (fehlt)
                    konflikte.push(
                        wert(["wiki"], "Den Wiki-Stand des Artikels von vorher gibt es nicht mehr.", "wikibox_artikel"),
                    );
                continue;
            }
            // Hing der Artikel von vorher nur an einem Teil der Abschnitte, gäbe die Rücknahme ihn allen: das ist nicht der Stand von vorher.
            if (schritt.vorher !== null && schritt.herkunft?.anteil !== undefined) {
                konflikte.push(
                    wert(
                        ["wiki"],
                        "Der Artikel von vorher hing nur an einem Teil der Abschnitte.",
                        "wikibox_teilweise",
                    ),
                );
                continue;
            }
            // Was vorher zugewiesen war, muss sich zuweisen lassen: Es braucht seinen Wiki-Stand.
            if (schritt.vorher !== null && !(await standDa(database, schritt.art, schritt.vorher)))
                konflikte.push(
                    wert(["wiki"], "Den Wiki-Stand des Artikels von vorher gibt es nicht mehr.", "wikibox_artikel"),
                );
        }
        return konflikte;
    },
};

/** Die Familie der Route: der Träger als Anker, bei Weg und Kraftlinie alle Abschnitte. */
function familieVon(anschluss: Anschluss, objekt: BoxObjekt, id: string): RuecknahmeFamilie {
    const kind = anschluss.schreiber.affectedArt;
    return {
        operation: RUECKNAHME_WIKIBOX_OPERATION,
        scope: `${kind}:${id}`,
        scopes: objekt.ids.map((kennung) => `${kind}:${kennung}`),
        adapter: WIKIBOX_ADAPTER,
        mapDomainId: objekt.mapDomainId,
    };
}

/** `POST …/wiki-box/:art/:id/restore-series/preview`: lesend, nichts wird geschrieben und kein Auftrag eingestellt. */
export async function vorschauWikiBox(
    database: Database,
    art: WikiBoxArt,
    id: string,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
): Promise<RuecknahmePruefung> {
    const anschluss = anschlussFuer(art);
    const objekt = await ladeObjekt(database, anschluss, id);
    const vor = await pruefeFamilie(
        database,
        { mapDomainId: objekt.mapDomainId, mitglieder: body.members, membersHash: body.membersHash },
        leser,
        familieVon(anschluss, objekt, id),
    );
    return { ...vor, folgen: { gegenstaende: objekt.ids.length, gelaende: "keines" } } as RuecknahmePruefung;
}

/**
 * `POST …/wiki-box/:art/:id/restore-series`: nimmt den Schritt in EINER Operation zurück (Ablauf: `fuehreRuecknahmeAus`). Hier steht, was die Box ausmacht: die Sperre der Zeilen des Trägers und die Inverse über
 * `weise` und `entferne` seines Anschlusses.
 */
export async function ruecknehmenWikiBox(
    database: Database,
    actor: MapActor,
    leser: RuecknahmeLeser,
    art: WikiBoxArt,
    id: string,
    body: RuecknahmeBody,
): Promise<RuecknahmeReceipt> {
    const anschluss = anschlussFuer(art);
    const objekt = await ladeObjekt(database, anschluss, id);
    return fuehreRuecknahmeAus({
        database,
        actor,
        leser,
        familie: familieVon(anschluss, objekt, id),
        body,
        haken: {
            // Wie die Vorwärtswege der Box: keine Sperre im Editor, nur die Zeilen des Trägers.
            pruefeFremdeSperre: async () => undefined,
            sperreZeilen: async (tx) => {
                await anschluss.sperre(tx, objekt);
            },
            async schreibe({ tx, offen, grund }) {
                const eintraege = await ladeEintraege(tx, leser, offen);
                if (eintraege.length !== 1) throw nichtRuecknehmbar("der Wiki-Box");
                const schritt = schrittAus(eintraege[0]!);
                const vorher = await anschluss.sperre(tx, objekt);
                // Unter der Sperre noch einmal lesen: Was heute am Träger hängt, entscheidet den Weg.
                const aktuell = await ladeObjekt(tx, anschluss, id);
                // Ein weiterer Artikel (WI-0300): genau die Zeilen des Schritts. Die angelegten gehen wieder, die still gelegten kommen mit ihrer Herkunft von vorher zurück.
                if (schritt.weiterer !== undefined) {
                    const weitere = anschluss.weitere;
                    if (weitere === undefined) throw nichtRuecknehmbar("der Wiki-Box");
                    const { key, richtung, zeilen } = schritt.weiterer;
                    const liste = [...zeilen.values()];
                    const geschrieben =
                        richtung === "zugewiesen"
                            ? await weitere.legeStill(tx, liste)
                            : await weitere.belebe(tx, liste);
                    if (geschrieben !== liste.length)
                        throw new ApiError(
                            409,
                            "edit_conflict",
                            "Eine Zuordnung am Weg hat sich inzwischen geändert.",
                            {
                                currentRevision: 0,
                            },
                        );
                    const nachher = await anschluss.beruehre(tx, aktuell);
                    return {
                        receipt: {
                            affected: aktuell.ids.map((kennung) => ({
                                kind: anschluss.schreiber.affectedArt,
                                id: kennung,
                                revision: nachher.get(kennung) ?? 0,
                            })),
                            derivedWork: [],
                            warnings: [],
                        },
                        entries: weitereEintraege(
                            anschluss,
                            richtung === "zugewiesen" ? "wiki_weitere_entfernt" : "wiki_weitere_zugewiesen",
                            aktuell,
                            vorher,
                            nachher,
                            key,
                            zeilen,
                        ).map((eintrag) => mitGrund(eintrag, grund)),
                        summary: zusammenfassung("Wiki-Box", aktuell.name, 1),
                        ableitung: false as const,
                    };
                }
                const heute = aktuell.artikel?.key ?? null;
                const herkunftHeute = (await anschluss.herkunft?.(tx, aktuell)) ?? null;
                // Je Abschnitt (OPS-000112): Jeder bekommt seinen Stand von vorher. Das Protokoll dieser Rücknahme führt ihn ebenso, damit auch sie zurückgeht.
                const ziel = schritt.abschnitte;
                const jeAbschnitt = ziel === undefined ? undefined : anschluss.abschnitte;
                const standHeute = await jeAbschnitt?.lies(
                    tx,
                    aktuell,
                    (kennung) => ziel?.get(kennung)?.haupt?.key ?? null,
                );
                if (jeAbschnitt !== undefined && ziel !== undefined) await jeAbschnitt.stelleHer(tx, aktuell, ziel);
                else if (schritt.vorher === null) {
                    if (aktuell.artikel !== null) await anschluss.entferne(tx, aktuell);
                } else await anschluss.weise(tx, aktuell, schritt.vorher);
                // Die Herkunft von vorher; ohne sie im Protokoll (vor B8d) bleibt die der Redaktion, die `weise` und `entferne` schreiben. Je Abschnitt setzt sie `stelleHer`.
                if (jeAbschnitt === undefined && schritt.herkunft !== undefined && schritt.herkunft !== null)
                    await anschluss.setzeHerkunft?.(tx, aktuell, schritt.herkunft);
                const herkunftNach = (await anschluss.herkunft?.(tx, aktuell)) ?? null;
                const standNach = await jeAbschnitt?.lies(tx, aktuell, () => null);
                const nachher = await anschluss.beruehre(tx, aktuell);
                const entries: MapAuditEntry[] = zuordnungsEintraege(
                    anschluss,
                    schritt.vorher === null ? "wiki_entfernt" : "wiki_zugewiesen",
                    aktuell,
                    vorher,
                    nachher,
                    { vorher: heute, nachher: schritt.vorher },
                    zuordnungsZusatz(anschluss, herkunftHeute, herkunftNach),
                    standHeute === undefined || standNach === undefined
                        ? undefined
                        : { vorher: standHeute, nachher: standNach },
                ).map((eintrag) => mitGrund(eintrag, grund));
                return {
                    receipt: {
                        affected: aktuell.ids.map((kennung) => ({
                            kind: anschluss.schreiber.affectedArt,
                            id: kennung,
                            revision: nachher.get(kennung) ?? 0,
                        })),
                        derivedWork: [],
                        warnings: [],
                    },
                    entries,
                    summary: zusammenfassung("Wiki-Box", aktuell.name, 1),
                    ableitung: false as const,
                };
            },
        },
    });
}
