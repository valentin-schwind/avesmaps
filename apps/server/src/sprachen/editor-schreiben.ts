import { randomUUID } from "node:crypto";
import type {
    OperationReceipt,
    SpracheAendernBody,
    SpracheAngelegt,
    SpracheAnlegenBody,
    SpracheStandBody,
    SpracheWikiBody,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database } from "../database.ts";
import { mapOperation, type MapActor, type MapChange } from "../editor/map-operation.ts";
import {
    SPRACHE_ART,
    SPRACHEN_DOMAENE,
    nurText,
    spracheStand,
    spracheZumSchreiben,
    ungueltig,
    verlangeSprachSperre,
} from "./editor-naht.ts";
import { belebeWiki, loeseAlleWiki, setzeWiki, zaehleSprachRevision } from "./editor-wiki.ts";

/**
 * Die Schreibwege an der Sprache selbst (WI-0261 S5d; Vertrag und Regeln im Kopf von `packages/shared/src/sprachen-editor.ts`): `sprache.create`,
 * `sprache.update`, `sprache.wiki`, `sprache.retire`, `sprache.restore`. Je EINE Operation an der Karte (`mapOperation`: `map_operation` und Fachprotokoll
 * mit Ziel `sprache_public_id`, Migration 0258, in derselben Transaktion; 503 während des Zugs).
 *
 * - **Anlegen** braucht keine Sperre: Der Schlüssel entsteht aus dem Namen (`schluesselAus`), eindeutig gemacht über alle Sprachen, auch stillgelegte (die Tafel
 *   hält ihn eindeutig); zwei Anlagen zugleich warten aufeinander (Advisory-Lock). Herkunft `redaktion`, die Stelle in der Legende hinter allen.
 * - **Ändern, Wiki-Artikel, Stilllegen, Zurückholen** gegen `baseRevision` und nur mit der eigenen Sperre der Sprache (`editor-naht.ts`).
 * - **Folgen:** Name, Legende, Farbe, Reihenfolge und Wiki-Artikel gehen in keinen Treffer ein (`ableitung: false`); die Schreibnaht meldet trotzdem
 *   `map.changed`, damit die Karten Farbe und Namen der Kacheln neu holen. Stilllegen und Zurückholen ändern den Bestand: Die Schreibnaht reiht den Auftrag
 *   `sprache_treffer` für die Sprache ein (`sprachen/treffer-auftrag.ts`), der ihre Treffer löscht oder neu bestimmt und die Mischgebiete nachzieht.
 */

/**
 * Der Schlüssel aus dem Namen (T-2: Kleinbuchstaben, Ziffern, Bindestrich, ein Buchstabe vorn): Umlaute ausgeschrieben, Akzente weg, alles andere wird `-`,
 * höchstens 48 Zeichen. Leer wird `sprache`.
 */
export function schluesselAus(name: string): string {
    const roh = name
        .toLowerCase()
        .replaceAll("ä", "ae")
        .replaceAll("ö", "oe")
        .replaceAll("ü", "ue")
        .replaceAll("ß", "ss")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48)
        .replace(/-+$/g, "");
    if (roh === "") return "sprache";
    return /^[a-z]/.test(roh) ? roh : `s-${roh}`;
}

/** Der erste freie Schlüssel: `basis`, sonst `basis-2`, `basis-3` … über alle Sprachen (auch stillgelegte). */
async function freierSchluessel(tx: Sql, basis: string): Promise<string> {
    const vergeben = new Set(
        (
            await tx<{ schluessel: string }[]>`
                SELECT schluessel FROM sprache WHERE schluessel = ${basis} OR schluessel LIKE ${`${basis}-%`}
            `
        ).map((zeile) => zeile.schluessel),
    );
    if (!vergeben.has(basis)) return basis;
    for (let n = 2; ; n += 1) {
        const kandidat = `${basis}-${String(n)}`;
        if (!vergeben.has(kandidat)) return kandidat;
    }
}

export const farbeVon = (wert: string): string => {
    const farbe = wert.trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(farbe)) throw ungueltig("Die Farbe ist #rrggbb.", { field: "farbe" });
    return farbe;
};

export const nameVon = (wert: string, feld = "name"): string => {
    const name = wert.trim();
    if (name === "") throw ungueltig("Eine Sprache braucht einen Namen.", { field: feld });
    return name;
};

/**
 * Legt eine Sprache der Redaktion an, in der Transaktion einer Operation: Schlüssel aus dem Namen und eindeutig gemacht (zwei Anlagen zugleich warten
 * aufeinander), Herkunft `redaktion`, die Stelle in der Legende hinter allen. Gibt die Zeile und die Felder des Protokolls zurück (`sprache.created`). Für
 * `sprache.create` und für „Kopieren …“ in eine neue Sprache (WI-0261 Stufe 3, `editor-flaechen-werkzeuge.ts`): beide legen dieselbe Sprache an.
 */
export async function legeSpracheAnIn(
    tx: Sql,
    neu: { publicId: string; name: string; farbe: string; legende: string | null },
): Promise<{ id: string; schluessel: string; revision: number; aenderungen: Record<string, MapChange> }> {
    await tx`SELECT pg_advisory_xact_lock(hashtext('sprache.create'))`;
    const schluessel = await freierSchluessel(tx, schluesselAus(neu.name));
    const [zeile] = await tx<{ id: string; revision: number; reihenfolge: number }[]>`
        INSERT INTO sprache (public_id, schluessel, name, legende, farbe, reihenfolge, herkunft)
        VALUES (${neu.publicId}::uuid, ${schluessel}, ${neu.name}, ${neu.legende}, ${neu.farbe},
                (SELECT COALESCE(max(reihenfolge) + 1, 0) FROM sprache), 'redaktion')
        RETURNING id::text, revision::int AS revision, reihenfolge
    `;
    const aenderungen: Record<string, MapChange> = {
        schluessel: { after: schluessel },
        name: { after: neu.name },
        farbe: { after: neu.farbe },
        reihenfolge: { after: zeile!.reihenfolge },
        herkunft: { after: "redaktion" },
        active: { after: true },
    };
    if (neu.legende !== null) aenderungen["legende"] = { after: neu.legende };
    return { id: zeile!.id, schluessel, revision: zeile!.revision, aenderungen };
}

/** `sprache.create`: eine neue Sprache der Redaktion, auf Wunsch gleich mit Wiki-Artikeln. */
export async function legeSpracheAn(
    database: Database,
    actor: MapActor,
    body: SpracheAnlegenBody,
): Promise<SpracheAngelegt> {
    const name = nameVon(body.name);
    const farbe = farbeVon(body.farbe);
    const legende = nurText(body.legende);
    const publicId = randomUUID();
    let schluessel = "";
    const quittung = await mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "sprache.create", mapDomainId: SPRACHEN_DOMAENE, body },
        async (tx) => {
            const neu = await legeSpracheAnIn(tx, { publicId, name, farbe, legende });
            schluessel = neu.schluessel;
            const { aenderungen } = neu;
            const wiki =
                (body.wiki ?? []).length === 0
                    ? undefined
                    : await setzeWiki(tx, actor, { id: neu.id, public_id: publicId }, body.wiki ?? []);
            if (wiki !== undefined) aenderungen["wiki"] = { before: [], after: wiki.nachher };
            return {
                receipt: {
                    affected: [{ kind: SPRACHE_ART, id: publicId, revision: neu.revision }, ...(wiki?.affected ?? [])],
                    derivedWork: [],
                    warnings: [],
                },
                summary: `Sprache „${name}“ angelegt`,
                entries: [
                    {
                        action: "sprache.created",
                        spracheId: publicId,
                        revisionBefore: null,
                        revisionAfter: neu.revision,
                        changes: aenderungen,
                    },
                    ...(wiki?.abgaben ?? []),
                ],
                ableitung: false,
            };
        },
    );
    // Eine wiederholte Kennung bekommt die erste Quittung (`runOperation`): Die Sprache ist die aus der Quittung.
    const angelegt = quittung.affected.find((eines) => eines.kind === SPRACHE_ART)?.id ?? publicId;
    if (angelegt !== publicId || schluessel === "") {
        const [vorhanden] = await database<{ schluessel: string }[]>`
            SELECT schluessel FROM sprache WHERE public_id = ${angelegt}::uuid
        `;
        schluessel = vorhanden?.schluessel ?? schluessel;
    }
    return { ...quittung, publicId: angelegt, schluessel };
}

/** `sprache.update`: Name, Legende, Farbe, Reihenfolge; nur was sich ändert, zählt die Revision einmal hoch. */
export async function aendereSprache(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: SpracheAendernBody,
): Promise<OperationReceipt> {
    if (
        body.name === undefined &&
        body.legende === undefined &&
        body.farbe === undefined &&
        body.reihenfolge === undefined
    )
        throw ungueltig("Es ist nichts zu ändern.", { field: "fields" });
    const name = body.name === undefined ? undefined : nameVon(body.name);
    const farbe = body.farbe === undefined ? undefined : farbeVon(body.farbe);
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "sprache.update",
            mapDomainId: SPRACHEN_DOMAENE,
            body: { spracheId: publicId, ...body },
        },
        async (tx) => {
            const sprache = await spracheZumSchreiben(tx, publicId, body.baseRevision);
            await verlangeSprachSperre(tx, actor, publicId);
            const neu = {
                name: name ?? sprache.name,
                legende: body.legende === undefined ? sprache.legende : nurText(body.legende),
                farbe: farbe ?? sprache.farbe,
                reihenfolge: body.reihenfolge ?? sprache.reihenfolge,
            };
            const aenderungen: Record<string, MapChange> = {};
            for (const feld of ["name", "legende", "farbe", "reihenfolge"] as const)
                if (neu[feld] !== sprache[feld]) aenderungen[feld] = { before: sprache[feld], after: neu[feld] };
            if (Object.keys(aenderungen).length === 0) {
                // Nichts hat sich geändert: keine Revision, kein Protokoll, keine Folgen.
                return {
                    receipt: {
                        affected: [{ kind: SPRACHE_ART, id: publicId, revision: sprache.revision }],
                        derivedWork: [],
                        warnings: [],
                    },
                    entries: [],
                    ableitung: false,
                };
            }
            const [geschrieben] = await tx<{ revision: number }[]>`
                UPDATE sprache SET name = ${neu.name}, legende = ${neu.legende}, farbe = ${neu.farbe}, reihenfolge = ${neu.reihenfolge}
                 WHERE id = ${sprache.id}::bigint
                RETURNING revision::int AS revision
            `;
            return {
                receipt: {
                    affected: [{ kind: SPRACHE_ART, id: publicId, revision: geschrieben!.revision }],
                    derivedWork: [],
                    warnings: [],
                },
                summary: `Sprache „${neu.name}“ geändert`,
                entries: [
                    {
                        action: "sprache.updated",
                        spracheId: publicId,
                        revisionBefore: sprache.revision,
                        revisionAfter: geschrieben!.revision,
                        changes: aenderungen,
                    },
                ],
                ableitung: false,
            };
        },
    );
}

/** `sprache.wiki`: die Pillen ganz setzen (zuordnen, lösen, umsortieren, anderen Sprachen wegnehmen). */
export async function setzeSpracheWiki(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: SpracheWikiBody,
): Promise<OperationReceipt> {
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "sprache.wiki",
            mapDomainId: SPRACHEN_DOMAENE,
            body: { spracheId: publicId, ...body },
        },
        async (tx) => {
            const sprache = await spracheZumSchreiben(tx, publicId, body.baseRevision);
            await verlangeSprachSperre(tx, actor, publicId);
            const wiki = await setzeWiki(tx, actor, sprache, body.artikel);
            if (wiki === undefined) {
                return {
                    receipt: {
                        affected: [{ kind: SPRACHE_ART, id: publicId, revision: sprache.revision }],
                        derivedWork: [],
                        warnings: [],
                    },
                    entries: [],
                    ableitung: false,
                };
            }
            // Die Zuordnung ist ein Feld des Entwurfs: Sie zählt die Revision der Sprache, damit ein veralteter Entwurf 409 bekommt.
            const revision = await zaehleSprachRevision(tx, sprache.id);
            const herkunft = wiki.uebernommen.map(({ titel, von }) => `„${titel}“ von „${von}“`);
            return {
                receipt: {
                    affected: [{ kind: SPRACHE_ART, id: publicId, revision }, ...wiki.affected],
                    derivedWork: [],
                    warnings: [],
                },
                summary:
                    `Sprache „${sprache.name}“: Wiki-Artikel geändert` +
                    (herkunft.length === 0 ? "" : `; übernommen ${herkunft.join(", ")}`),
                entries: [
                    {
                        action: "sprache.wiki_changed",
                        spracheId: publicId,
                        revisionBefore: sprache.revision,
                        revisionAfter: revision,
                        changes: { wiki: { before: wiki.vorher, after: wiki.nachher } },
                    },
                    ...wiki.abgaben,
                ],
                ableitung: false,
            };
        },
    );
}

/**
 * `sprache.retire` und `sprache.restore`. Stilllegen: Die Sprache verschwindet aus Karte, Suche und Infoboxen (alle Leser filtern `is_active`); ihre Teilflächen
 * bleiben, wie sie sind, und erscheinen mit ihr wieder; ihre Wiki-Zuordnungen werden still gelegt, damit die Artikel frei sind. Zurückholen belebt die
 * Zuordnungen, die mit dem Stilllegen fielen, sofern ihr Artikel noch frei ist (`belebeWiki`).
 */
export async function setzeSpracheStand(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: SpracheStandBody,
    wechsel: "sprache.retire" | "sprache.restore",
): Promise<OperationReceipt> {
    const stilllegen = wechsel === "sprache.retire";
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: wechsel,
            mapDomainId: SPRACHEN_DOMAENE,
            body: { spracheId: publicId, ...body },
        },
        async (tx) => {
            const sprache = await spracheZumSchreiben(
                tx,
                publicId,
                body.baseRevision,
                stilllegen ? "aktiv" : "stillgelegt",
            );
            await verlangeSprachSperre(tx, actor, publicId);
            let wiki: { vorher: unknown[]; nachher: unknown[] };
            let revision: number;
            if (stilllegen) {
                const vorher = await loeseAlleWiki(tx, sprache.id);
                wiki = { vorher, nachher: [] };
                const [geschrieben] = await tx<{ revision: number }[]>`
                    UPDATE sprache SET ${spracheStand(tx, false)}
                     WHERE id = ${sprache.id}::bigint
                    RETURNING revision::int AS revision
                `;
                revision = geschrieben!.revision;
            } else {
                // Erst die Zuordnungen: Sie finden sich über den Zeitpunkt des Stilllegens, den das Zurückholen leert.
                wiki = await belebeWiki(tx, sprache.id);
                const [geschrieben] = await tx<{ revision: number }[]>`
                    UPDATE sprache SET ${spracheStand(tx, true)}
                     WHERE id = ${sprache.id}::bigint
                    RETURNING revision::int AS revision
                `;
                revision = geschrieben!.revision;
            }
            const aenderungen: Record<string, MapChange> = { active: { before: stilllegen, after: !stilllegen } };
            if (wiki.vorher.length > 0 || wiki.nachher.length > 0)
                aenderungen["wiki"] = { before: wiki.vorher, after: wiki.nachher };
            return {
                receipt: {
                    affected: [{ kind: SPRACHE_ART, id: publicId, revision }],
                    derivedWork: [],
                    warnings: [],
                },
                summary: stilllegen
                    ? `Sprache „${sprache.name}“ stillgelegt`
                    : `Sprache „${sprache.name}“ zurückgeholt`,
                entries: [
                    {
                        action: stilllegen ? "sprache.retired" : "sprache.restored",
                        spracheId: publicId,
                        revisionBefore: sprache.revision,
                        revisionAfter: revision,
                        changes: aenderungen,
                    },
                ],
            };
        },
    );
}
