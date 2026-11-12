import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { LightMyRequestResponse } from "fastify";
import { MediaStore, storageKey } from "../../../src/media/storage.ts";
import { insertAsset, insertCitymap, insertPlace, sha, type AssetSpec, type FixtureAsset } from "../media-fixture.ts";
import { TEST_ORIGIN } from "../auth-fixture.ts";
import { file, pngBytes, uploadForm } from "../media-operations-fixture.ts";
import { betroffen, type Faelle, type Person, type Welt } from "./welt.ts";

/**
 * Die Medienverwaltung (WI-0068): jeder Schreibweg einmal, mit eigenen Werken und Orten je Fall (Rezepte aus `media-operations-routes`,
 * `media-galerie-schreibpfad`, `media-suspension`, `media-merge`, `media-type-images`, `bildbezug`). Eine Person, Redakteurin mit
 * frischem Passkey, darf alles hier; ein Werk ohne Hochladeeintrag darf sie auch freigeben.
 */

const operationId = (): string => randomUUID();
const URL = "/api/editor/media";
/** Orte dieser Fälle tragen eigene Nummern, weg von den festen Kennungen der Medienwelt (`fixtureId(1..4)`); x = 300 + n bleibt im Gebiet. */
let naechsterOrt = 200;
let naechstesWerk = 0;

const redakteurin = (welt: Welt): Promise<Person> => welt.jemand("editor", { frisch: true });
const ort = async (welt: Welt): Promise<string> =>
    (await insertPlace(welt.cluster.admin, (naechsterOrt += 1))).publicId;
const werk = (welt: Welt, spec: Partial<AssetSpec> = {}): Promise<FixtureAsset> =>
    insertAsset(welt.cluster.admin, { ref: `rauchtest-${String((naechstesWerk += 1))}`, ...spec });

/** Ein Werk der Rolle `map_full` oder `map_preview`, hochgeladen über den Weg des Editors (Rauchtest der Kartensammlung, WI-0287). */
async function kartenWerk(
    welt: Welt,
    person: Person,
    rolle: "map_full" | "map_preview",
    seed: number,
): Promise<string> {
    const antwort = welt.muss(
        await welt.post(URL, person.cookie, {
            operationId: operationId(),
            file: file(await pngBytes(seed)),
            form: uploadForm({ role: rolle, title: `Rauchtest ${rolle} ${String(seed)}` }),
        }),
    );
    return (antwort.json() as { affected: { kind: string; id: string }[] }).affected.find(
        (eintrag) => eintrag.kind === "media_asset",
    )!.id;
}

/** Ein Original wie aus einem Hochladen (die Medienwelt hat dafür eine eigene, nicht ausgeführte Hilfe). */
async function original(welt: Welt, asset: FixtureAsset, sha256: string): Promise<void> {
    await welt.cluster.admin`
        INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
        VALUES (${asset.id}, 'source', 'private_source', ${storageKey("private_source", sha256, "png")}, 'image/png', 64, 48, 2048,
                ${sha256})
    `;
}

async function revision(welt: Welt, tafel: "media_asset" | "media_rights", asset: FixtureAsset): Promise<number> {
    const [row] =
        tafel === "media_asset"
            ? await welt.cluster.admin<
                  { revision: number }[]
              >`SELECT revision::int AS revision FROM media_asset WHERE id = ${asset.id}`
            : await welt.cluster.admin<{ revision: number }[]>`
                  SELECT revision::int AS revision FROM media_rights WHERE media_asset_id = ${asset.id}
              `;
    return row!.revision;
}

/** Eine Galerie über die Route, mit einem Werk darin, wenn verlangt; gibt Kennung und Revision zurück. */
async function galerie(
    welt: Welt,
    person: Person,
    mit?: FixtureAsset,
): Promise<{ galleryId: string; baseRevision: number }> {
    let stand = betroffen(
        welt.muss(
            await welt.post(`${URL}/galleries/create`, person.cookie, { operationId: operationId(), title: "Rauch" }),
        ),
        "gallery",
    );
    if (mit !== undefined) {
        stand = betroffen(
            welt.muss(
                await welt.post(`${URL}/galleries/add`, person.cookie, {
                    operationId: operationId(),
                    galleryId: stand.id,
                    baseRevision: stand.revision,
                    assetId: mit.publicId,
                }),
            ),
            "gallery",
        );
    }
    return { galleryId: stand.id, baseRevision: stand.revision };
}

/** Ein Titelbild am Ort (WI-0219: ein Einzelbild über `header.set`): gibt die Revision seiner Bindung zurück. */
async function kopfgrafik(welt: Welt, person: Person, placeId: string, asset: FixtureAsset): Promise<number> {
    return betroffen(
        welt.muss(
            await welt.post(`${URL}/bindings/header/set`, person.cookie, {
                operationId: operationId(),
                placeId,
                assetId: asset.publicId,
                baseState: "undecided",
            }),
        ),
        "header",
    ).revision;
}

async function zusammengefuehrt(
    welt: Welt,
    person: Person,
): Promise<{ antwort: LightMyRequestResponse; weg: FixtureAsset }> {
    const bytes = sha(`rauchtest/zwilling/${randomUUID()}`);
    const bleibt = await werk(welt);
    const weg = await werk(welt);
    await original(welt, bleibt, bytes);
    await original(welt, weg, bytes);
    const antwort = await welt.post(`${URL}/merge`, person.cookie, {
        operationId: operationId(),
        keep: { assetId: bleibt.publicId, baseRevision: await revision(welt, "media_asset", bleibt) },
        merge: [{ assetId: weg.publicId, baseRevision: await revision(welt, "media_asset", weg) }],
        reason: "Rauchtest",
    });
    return { antwort, weg };
}

async function ausgeblendet(
    welt: Welt,
    person: Person,
): Promise<{ antwort: LightMyRequestResponse; asset: FixtureAsset }> {
    const asset = await werk(welt);
    await original(welt, asset, sha(`rauchtest/ausblenden/${randomUUID()}`));
    const antwort = await welt.post(`${URL}/${asset.publicId}/suspend`, person.cookie, {
        operationId: operationId(),
        reason: "Rauchtest",
    });
    return { antwort, asset };
}

/**
 * Ein Reisebild in der Prüfung (WI-0272 S3): Einreichung (`pending`, oder `approved` samt Verwendung), Medium, Quelldatei im Speicher der Instanz
 * (`<Ordner>/medien`, wie `mediaRoot` des Rauchtests) und Eingang. Die Redaktion liest die Quelle bei der Freigabe, sie muss also wirklich da sein.
 */
async function reisebild(
    welt: Welt,
    zustand: "pending" | "approved",
): Promise<{ publicId: string; baseRevision: number }> {
    naechstesWerk += 1;
    const speicher = new MediaStore(join(welt.ordner, "medien"));
    const gespeichert = await speicher.store("private_source", await pngBytes(300 + naechstesWerk), "png");
    const asset = await werk(welt, {
        technicalState: "ok",
        moderationState: zustand === "approved" ? "approved" : "pending",
        rights: { basis: "permission", clearance: "unreviewed" },
        published: [],
    });
    await welt.cluster.admin`
        INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
        VALUES (${asset.id}, 'source', 'private_source', ${gespeichert.key}, 'image/png', 160, 120, ${gespeichert.byteSize}, ${gespeichert.sha256})`;
    const [einreichung] = await welt.cluster.admin<{ id: string; public_id: string; revision: number }[]>`
        INSERT INTO media_submission (status_key_hash, map_domain_id, geom, creation_kind, usage_grant, description, terms_version, state,
                                      approved_media_asset_id)
        VALUES (${createHash("sha256").update(randomUUID()).digest()}, 'aventuria', 'SRID=0;POINT(300 300)', 'photo', 'avesmaps_only',
                'Rauchtest', 'rauchtest', ${zustand}, ${zustand === "approved" ? asset.id : null})
        RETURNING id::text AS id, public_id::text AS public_id, revision::int AS revision`;
    await welt.cluster.admin`
        INSERT INTO media_ingest (media_asset_id, ingest_kind, submission_id) VALUES (${asset.id}, 'community_upload', ${einreichung!.id})`;
    if (zustand === "approved") {
        await welt.cluster.admin`
            INSERT INTO photobox_media (media_submission_id, media_asset_id) VALUES (${einreichung!.id}, ${asset.id})`;
    }
    return { publicId: einreichung!.public_id, baseRevision: einreichung!.revision };
}

export const MEDIEN: Faelle = {
    "POST /api/editor/media": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            return welt.post(URL, person.cookie, {
                operationId: operationId(),
                file: file(await pngBytes(7)),
                form: uploadForm(),
            });
        },
    },
    "POST /api/editor/media/:id/metadata": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const asset = await werk(welt);
            return welt.post(`${URL}/${asset.publicId}/metadata`, person.cookie, {
                operationId: operationId(),
                baseRevision: await revision(welt, "media_asset", asset),
                title: "Rauchtest",
            });
        },
    },
    "POST /api/editor/media/:id/creation": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const asset = await werk(welt);
            return welt.post(`${URL}/${asset.publicId}/creation`, person.cookie, {
                operationId: operationId(),
                creation: { tool: "Stift" },
            });
        },
    },
    "POST /api/editor/media/:id/rights": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const asset = await werk(welt);
            return welt.post(`${URL}/${asset.publicId}/rights`, person.cookie, {
                operationId: operationId(),
                baseRevision: await revision(welt, "media_rights", asset),
                rights: { basis: "own_work", creator: "Urheberin Alrike" },
            });
        },
    },
    "POST /api/editor/media/:id/rights/review": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const asset = await werk(welt);
            return welt.post(`${URL}/${asset.publicId}/rights/review`, person.cookie, {
                operationId: operationId(),
                baseRevision: await revision(welt, "media_rights", asset),
                decision: "cleared",
            });
        },
    },
    "POST /api/editor/media/:id/evidence": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const asset = await werk(welt);
            return welt.post(`${URL}/${asset.publicId}/evidence`, person.cookie, {
                operationId: operationId(),
                evidence: { kind: "operator_note", text: "Rauchtest" },
            });
        },
    },
    "POST /api/editor/media/:id/suspend": {
        erwartet: 200,
        async rufe(welt) {
            return (await ausgeblendet(welt, await redakteurin(welt))).antwort;
        },
    },
    "POST /api/editor/media/:id/suspend/lift": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const { antwort, asset } = await ausgeblendet(welt, person);
            return welt.post(`${URL}/${asset.publicId}/suspend/lift`, person.cookie, {
                operationId: operationId(),
                baseRevision: betroffen(welt.muss(antwort)).revision,
                reason: "Rauchtest",
            });
        },
    },
    "POST /api/editor/media/:id/delete": {
        erwartet: 200,
        async rufe(welt) {
            // Endgültig löschen darf nur, wer delete_media trägt (Betreiber), und nur einen eigenen Upload ohne Verwendung.
            const person = await welt.jemand("operator", { frisch: true });
            const hochgeladen = welt.muss(
                await welt.post(URL, person.cookie, {
                    operationId: operationId(),
                    file: file(await pngBytes(9)),
                    form: uploadForm(),
                }),
            );
            const werkId = betroffen(hochgeladen, "media_asset");
            return welt.post(`${URL}/${werkId.id}/delete`, person.cookie, {
                operationId: operationId(),
                baseRevision: werkId.revision,
            });
        },
    },
    "POST /api/editor/media/bindings/coat": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            return welt.post(`${URL}/bindings/coat`, person.cookie, {
                operationId: operationId(),
                subject: { kind: "place", id: await ort(welt) },
                assetId: (await werk(welt)).publicId,
                baseState: "undecided",
            });
        },
    },
    "POST /api/editor/media/bindings/coat/none": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const subject = { kind: "place", id: await ort(welt) };
            const bindung = welt.muss(
                await welt.post(`${URL}/bindings/coat`, person.cookie, {
                    operationId: operationId(),
                    subject,
                    assetId: (await werk(welt)).publicId,
                    baseState: "undecided",
                }),
            );
            return welt.post(`${URL}/bindings/coat/none`, person.cookie, {
                operationId: operationId(),
                subject,
                baseRevision: betroffen(bindung).revision,
            });
        },
    },
    "POST /api/editor/media/bindings/header/set": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const asset = await werk(welt, { published: [{ variant: "header_16_9" }] });
            return welt.post(`${URL}/bindings/header/set`, person.cookie, {
                operationId: operationId(),
                placeId: await ort(welt),
                assetId: asset.publicId,
                baseState: "undecided",
            });
        },
    },
    "POST /api/editor/media/bindings/header/none": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const placeId = await ort(welt);
            const asset = await werk(welt, { published: [{ variant: "header_16_9" }] });
            const baseRevision = await kopfgrafik(welt, person, placeId, asset);
            return welt.post(`${URL}/bindings/header/none`, person.cookie, {
                operationId: operationId(),
                placeId,
                baseRevision,
            });
        },
    },
    "POST /api/editor/media/bindings/header/relation": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const placeId = await ort(welt);
            const asset = await werk(welt, { published: [{ variant: "header_16_9" }] });
            const baseRevision = await kopfgrafik(welt, person, placeId, asset);
            return welt.post(`${URL}/bindings/header/relation`, person.cookie, {
                operationId: operationId(),
                placeId,
                assetId: asset.publicId,
                value: "place_view",
                baseRevision,
            });
        },
    },
    "POST /api/editor/media/galleries/create": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            return welt.post(`${URL}/galleries/create`, person.cookie, { operationId: operationId(), title: "Rauch" });
        },
    },
    "POST /api/editor/media/galleries/title": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const stand = await galerie(welt, person);
            return welt.post(`${URL}/galleries/title`, person.cookie, {
                operationId: operationId(),
                ...stand,
                title: "Rauch II",
            });
        },
    },
    "POST /api/editor/media/galleries/add": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const stand = await galerie(welt, person);
            return welt.post(`${URL}/galleries/add`, person.cookie, {
                operationId: operationId(),
                ...stand,
                assetId: (await werk(welt)).publicId,
            });
        },
    },
    "POST /api/editor/media/galleries/caption": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const asset = await werk(welt);
            const stand = await galerie(welt, person, asset);
            return welt.post(`${URL}/galleries/caption`, person.cookie, {
                operationId: operationId(),
                ...stand,
                assetId: asset.publicId,
                caption: "Rauch über Gareth",
            });
        },
    },
    "POST /api/editor/media/galleries/order": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const asset = await werk(welt);
            const stand = await galerie(welt, person, asset);
            return welt.post(`${URL}/galleries/order`, person.cookie, {
                operationId: operationId(),
                ...stand,
                order: [asset.publicId],
            });
        },
    },
    "POST /api/editor/media/galleries/cover": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const asset = await werk(welt);
            const stand = await galerie(welt, person, asset);
            return welt.post(`${URL}/galleries/cover`, person.cookie, {
                operationId: operationId(),
                ...stand,
                assetId: asset.publicId,
            });
        },
    },
    "POST /api/editor/media/galleries/remove": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const asset = await werk(welt);
            const stand = await galerie(welt, person, asset);
            return welt.post(`${URL}/galleries/remove`, person.cookie, {
                operationId: operationId(),
                ...stand,
                assetId: asset.publicId,
            });
        },
    },
    "POST /api/editor/media/galleries/bind": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const stand = await galerie(welt, person, await werk(welt));
            return welt.post(`${URL}/galleries/bind`, person.cookie, {
                operationId: operationId(),
                ...stand,
                placeId: await ort(welt),
            });
        },
    },
    "POST /api/editor/media/galleries/delete": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            // Eine eigene Galerie ohne Ort, mit einem Bild (R3 „Entfernen“): Einträge, Galerie und Verlauf fallen als App-Rolle.
            const { galleryId, baseRevision } = await galerie(welt, person, await werk(welt));
            return welt.post(`${URL}/galleries/delete`, person.cookie, {
                operationId: operationId(),
                galleryId,
                baseRevision,
            });
        },
    },
    "POST /api/editor/media/galleries/unbind": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const stand = await galerie(welt, person, await werk(welt));
            const placeId = await ort(welt);
            const gebunden = welt.muss(
                await welt.post(`${URL}/galleries/bind`, person.cookie, {
                    operationId: operationId(),
                    ...stand,
                    placeId,
                }),
            );
            return welt.post(`${URL}/galleries/unbind`, person.cookie, {
                operationId: operationId(),
                galleryId: stand.galleryId,
                baseRevision: betroffen(gebunden, "gallery").revision,
                placeId,
            });
        },
    },
    "POST /api/editor/media/merge": {
        erwartet: 200,
        async rufe(welt) {
            return (await zusammengefuehrt(welt, await redakteurin(welt))).antwort;
        },
    },
    "POST /api/editor/media/merge/all": {
        erwartet: 200,
        async rufe(welt) {
            // Der Sammellauf der Duplikate (WI-0068): nur Betreiber mit frischem Passkey; der Körper ist die heutige Vorschau.
            const person = await welt.jemand("operator", { frisch: true });
            const bytes = sha(`rauchtest/sammellauf/${randomUUID()}`);
            const bleibt = await werk(welt);
            const weg = await werk(welt);
            await original(welt, bleibt, bytes);
            await original(welt, weg, bytes);
            const vorschau = welt
                .muss(await welt.app.inject({ url: `${URL}/merge/preview`, headers: { cookie: person.cookie } }))
                .json<{
                    groups: { fileGroup: string; keepAssetId: string; rightsDiffer: boolean }[];
                    totals: { groups: number; members: number; moves: number; retires: number };
                }>();
            return welt.post(`${URL}/merge/all`, person.cookie, {
                operationId: operationId(),
                groups: vorschau.groups
                    .filter((gruppe) => !gruppe.rightsDiffer)
                    .map(({ fileGroup, keepAssetId }) => ({ fileGroup, keepAssetId })),
                expected: {
                    groups: vorschau.totals.groups,
                    members: vorschau.totals.members,
                    moves: vorschau.totals.moves,
                    retires: vorschau.totals.retires,
                },
            });
        },
    },
    "POST /api/editor/media/:id/merge/lift": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const { antwort, weg } = await zusammengefuehrt(welt, person);
            welt.muss(antwort);
            return welt.post(`${URL}/${weg.publicId}/merge/lift`, person.cookie, { operationId: operationId() });
        },
    },
    "POST /api/editor/media/citymaps/:id/update": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            // Eine eigene Karte (WI-0068 R5): Eigenschaften und Typen in einem Zug, damit beide Schreibwege mitgeschnitten werden.
            const karte = await insertCitymap(welt.cluster.admin, 251);
            return welt.post(`${URL}/citymaps/${karte.publicId}/update`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                fields: { author: "Rauchtest" },
                types: ["stadtplan"],
            });
        },
    },
    "POST /api/editor/media/citymaps": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            return welt.post(`${URL}/citymaps`, person.cookie, {
                operationId: operationId(),
                fields: { title: "Rauchtest Eintrag" },
                types: ["stadtplan"],
                places: [await ort(welt)],
            });
        },
    },
    "POST /api/editor/media/citymaps/:id/image": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const karte = await insertCitymap(welt.cluster.admin, 254);
            const asset = await kartenWerk(welt, person, "map_full", 8801);
            return welt.post(`${URL}/citymaps/${karte.publicId}/image`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                role: "map_full",
                assetId: asset,
            });
        },
    },
    "POST /api/editor/media/citymaps/:id/image/remove": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const karte = await insertCitymap(welt.cluster.admin, 255);
            const asset = await kartenWerk(welt, person, "map_preview", 8802);
            welt.muss(
                await welt.post(`${URL}/citymaps/${karte.publicId}/image`, person.cookie, {
                    operationId: operationId(),
                    baseRevision: 1,
                    role: "map_preview",
                    assetId: asset,
                }),
            );
            return welt.post(`${URL}/citymaps/${karte.publicId}/image/remove`, person.cookie, {
                operationId: operationId(),
                baseRevision: 2,
                role: "map_preview",
            });
        },
    },
    "POST /api/editor/media/citymaps/:id/version": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            // Eine Version der Karte (WI-0287 Stufe 2): angehängt (Revision 1 → 2), dann ihre Bezeichnung gesetzt.
            const karte = await insertCitymap(welt.cluster.admin, 259);
            const asset = await kartenWerk(welt, person, "map_full", 8805);
            welt.muss(
                await welt.post(`${URL}/citymaps/${karte.publicId}/image`, person.cookie, {
                    operationId: operationId(),
                    baseRevision: 1,
                    role: "map_full",
                    assetId: asset,
                }),
            );
            return welt.post(`${URL}/citymaps/${karte.publicId}/version`, person.cookie, {
                operationId: operationId(),
                baseRevision: 2,
                assetId: asset,
                op: "label",
                label: "Rauchtest Spielerversion",
            });
        },
    },
    "POST /api/editor/media/citymaps/:id/links": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const karte = await insertCitymap(welt.cluster.admin, 256);
            return welt.post(`${URL}/citymaps/${karte.publicId}/links`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                links: [{ url: "https://example.org/rauchtest-karte", label: "Karte", isPaid: null }],
            });
        },
    },
    "POST /api/editor/media/citymaps/:id/places": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const karte = await insertCitymap(welt.cluster.admin, 262);
            // Orte und Regionen (WI-0287 Stufe 3): ein Ort wird angehängt.
            const ziel = await ort(welt);
            return welt.post(`${URL}/citymaps/${karte.publicId}/places`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                action: "add",
                target: { kind: "place", id: ziel },
            });
        },
    },
    "POST /api/editor/media/citymaps/:id/sources": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const karte = await insertCitymap(welt.cluster.admin, 257);
            // Eine Quelle des Katalogs als Publikation (WI-0287 Punkt 4): anhängen mit Fundstelle.
            const [quelle] = await welt.cluster.admin<{ public_id: string }[]>`
                INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official)
                VALUES ('wikipub:rauchtest-band', 'final', NULL, 'Rauchtest Band', 'regionalspielhilfe', TRUE)
                RETURNING public_id::text AS public_id
            `;
            return welt.post(`${URL}/citymaps/${karte.publicId}/sources`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                op: "add",
                sourceId: quelle!.public_id,
                pages: "42",
            });
        },
    },
    "POST /api/editor/media/citymaps/:id/preview": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            // „Vorschau erzeugen“ (WI-0287 Punkt 5): eine Karte mit Datei hängt am Eintrag (Revision 1 → 2), daraus entsteht die Vorschau samt Auftrag.
            const karte = await insertCitymap(welt.cluster.admin, 258);
            const asset = await kartenWerk(welt, person, "map_full", 8804);
            welt.muss(
                await welt.post(`${URL}/citymaps/${karte.publicId}/image`, person.cookie, {
                    operationId: operationId(),
                    baseRevision: 1,
                    role: "map_full",
                    assetId: asset,
                }),
            );
            return welt.post(`${URL}/citymaps/${karte.publicId}/preview`, person.cookie, {
                operationId: operationId(),
                baseRevision: 2,
                sourceAssetId: asset,
                title: "Rauchtest Vorschau",
            });
        },
    },
    "PUT /api/editor/media/citymaps/datei": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const kopf = Buffer.from(
                JSON.stringify({
                    operationId: operationId(),
                    name: "rauchtest.png",
                    form: uploadForm({ role: "map_full", title: "Rauchtest Kartendatei" }),
                }),
                "utf8",
            );
            const laenge = Buffer.alloc(4);
            laenge.writeUInt32BE(kopf.byteLength);
            return welt.app.inject({
                method: "PUT",
                url: `${URL}/citymaps/datei`,
                headers: {
                    host: "avesmaps.test",
                    origin: TEST_ORIGIN,
                    "user-agent": "Rauchtest",
                    cookie: person.cookie,
                    "content-type": "application/octet-stream",
                },
                payload: Buffer.concat([laenge, kopf, await pngBytes(8803)]),
            });
        },
    },
    "POST /api/editor/media/citymaps/:id/retire": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const karte = await insertCitymap(welt.cluster.admin, 252);
            return welt.post(`${URL}/citymaps/${karte.publicId}/retire`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
            });
        },
    },
    "POST /api/editor/media/citymaps/:id/restore": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            // Eine entfernte Karte: erst stilllegen (Revision 1 → 2), dann zurückholen.
            const karte = await insertCitymap(welt.cluster.admin, 253);
            welt.muss(
                await welt.post(`${URL}/citymaps/${karte.publicId}/retire`, person.cookie, {
                    operationId: operationId(),
                    baseRevision: 1,
                }),
            );
            return welt.post(`${URL}/citymaps/${karte.publicId}/restore`, person.cookie, {
                operationId: operationId(),
                baseRevision: 2,
            });
        },
    },
    "POST /api/editor/media/citymaps/:id/merge": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            // Zwei Einträge zusammenlegen (WI-0287 Stufe 2): Die Quelle trägt Karte und Vorschau (Revision 1 → 3), einen Link, eine Publikation und einen Ort; alles geht in
            // EINER Operation ans Ziel, die Quelle wird stillgelegt. So läuft jeder Schreibweg der Operation einmal als App-Rolle.
            const quelle = await insertCitymap(welt.cluster.admin, 260);
            const ziel = await insertCitymap(welt.cluster.admin, 261);
            for (const [rolle, seed, baseRevision] of [
                ["map_full", 8806, 1],
                ["map_preview", 8807, 2],
            ] as const) {
                const asset = await kartenWerk(welt, person, rolle, seed);
                welt.muss(
                    await welt.post(`${URL}/citymaps/${quelle.publicId}/image`, person.cookie, {
                        operationId: operationId(),
                        baseRevision,
                        role: rolle,
                        assetId: asset,
                    }),
                );
            }
            const platz = await ort(welt);
            const [publikation] = await welt.cluster.admin<{ id: string }[]>`
                INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official)
                VALUES ('wikipub:rauchtest-zusammen', 'final', NULL, 'Rauchtest Zusammen', 'regionalspielhilfe', TRUE)
                RETURNING id::text AS id
            `;
            await welt.cluster.admin`
                INSERT INTO citymap_link (citymap_id, link_role, url, label, position, legacy_origin)
                VALUES (${quelle.id}::bigint, 'primary', 'https://example.org/rauchtest-zusammen', 'Karte', 0, 'manual')
            `;
            await welt.cluster.admin`
                INSERT INTO citymap_source (citymap_id, source_id, position) VALUES (${quelle.id}::bigint, ${publikation!.id}::bigint, 0)
            `;
            await welt.cluster.admin`
                INSERT INTO citymap_place (citymap_id, sort_order, export_ordinal, name_key, raw_name, target_state, resolved_by, place_id,
                                           target_origin, legacy_origin)
                VALUES (${quelle.id}::bigint, 0, 0, 'rauchtest', 'Rauchtest', 'resolved', 'public_id',
                        (SELECT id FROM place WHERE public_id = ${platz}::uuid), 'editor', 'manual')
            `;
            return welt.post(`${URL}/citymaps/${quelle.publicId}/merge`, person.cookie, {
                operationId: operationId(),
                baseRevision: 3,
                targetId: ziel.publicId,
                targetBaseRevision: 1,
                versionLabel: "Rauchtest Spielerversion",
            });
        },
    },
    "POST /api/editor/media/photobox/:id/approve": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const bild = await reisebild(welt, "pending");
            return welt.post(`${URL}/photobox/${bild.publicId}/approve`, person.cookie, {
                operationId: operationId(),
                baseRevision: bild.baseRevision,
            });
        },
    },
    "POST /api/editor/media/photobox/:id/ask": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const bild = await reisebild(welt, "pending");
            return welt.post(`${URL}/photobox/${bild.publicId}/ask`, person.cookie, {
                operationId: operationId(),
                baseRevision: bild.baseRevision,
                nachricht: "Rauchtest: welcher Hafen?",
            });
        },
    },
    "POST /api/editor/media/photobox/:id/reject": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const bild = await reisebild(welt, "pending");
            return welt.post(`${URL}/photobox/${bild.publicId}/reject`, person.cookie, {
                operationId: operationId(),
                baseRevision: bild.baseRevision,
                grund: "Rauchtest",
            });
        },
    },
    "POST /api/editor/media/photobox/:id/correct": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const bild = await reisebild(welt, "pending");
            return welt.post(`${URL}/photobox/${bild.publicId}/correct`, person.cookie, {
                operationId: operationId(),
                baseRevision: bild.baseRevision,
                lage: { x: 310, y: 310 },
                beschreibung: "Rauchtest II",
            });
        },
    },
    "POST /api/editor/media/photobox/:id/offline": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const bild = await reisebild(welt, "approved");
            return welt.post(`${URL}/photobox/${bild.publicId}/offline`, person.cookie, {
                operationId: operationId(),
                baseRevision: bild.baseRevision,
            });
        },
    },
    "POST /api/editor/media/photobox/:id/reopen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const bild = await reisebild(welt, "approved");
            return welt.post(`${URL}/photobox/${bild.publicId}/reopen`, person.cookie, {
                operationId: operationId(),
                baseRevision: bild.baseRevision,
            });
        },
    },
    "POST /api/editor/media/type-images/set": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            // Die Production-Kopie kann für „wald“ schon ein Typbild führen (seit 2026-10-31): dann mit dessen Revision, sonst ohne. Gesetzt wird ohne
            // Angabe die KI-Variante (WI-0281); das Werk hat die Entstehung „unbekannt“, die sie nimmt.
            const [aktiv] = await welt.cluster.admin<{ revision: number }[]>`
                SELECT revision::int AS revision FROM media_type_image
                 WHERE category = 'wald' AND variant = 'ki' AND retired_at IS NULL
            `;
            return welt.post(`${URL}/type-images/set`, person.cookie, {
                operationId: operationId(),
                category: "wald",
                assetId: (await werk(welt)).publicId,
                ...(aktiv === undefined ? {} : { baseRevision: aktiv.revision }),
            });
        },
    },
    "POST /api/editor/media/type-images/release": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            // Erst einen ★ der KI-Variante für „see“ setzen (das Werk ist unbekannter Herkunft, die KI-Variante nimmt es), dann ihn lösen (WI-0281).
            const [vorher] = await welt.cluster.admin<{ revision: number }[]>`
                SELECT revision::int AS revision FROM media_type_image
                 WHERE category = 'see' AND variant = 'ki' AND retired_at IS NULL
            `;
            const gesetzt = await welt.post(`${URL}/type-images/set`, person.cookie, {
                operationId: operationId(),
                category: "see",
                assetId: (await werk(welt)).publicId,
                ...(vorher === undefined ? {} : { baseRevision: vorher.revision }),
            });
            if (gesetzt.statusCode !== 200) return gesetzt;
            const [aktiv] = await welt.cluster.admin<{ revision: number }[]>`
                SELECT revision::int AS revision FROM media_type_image
                 WHERE category = 'see' AND variant = 'ki' AND retired_at IS NULL
            `;
            return welt.post(`${URL}/type-images/release`, person.cookie, {
                operationId: operationId(),
                category: "see",
                variant: "ki",
                baseRevision: aktiv!.revision,
            });
        },
    },
    "POST /api/editor/media/type-images/adopt": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            // Die eingebauten Grafiken: nur das Dorf, wie in `media-type-images.test.ts`.
            const quelle = join(welt.ordner, "typbilder");
            await mkdir(quelle, { recursive: true });
            await writeFile(
                join(quelle, "dorf.webp"),
                await sharp({ create: { width: 160, height: 90, channels: 3, background: { r: 200, g: 120, b: 80 } } })
                    .webp()
                    .toBuffer(),
            );
            const vorher = process.env["TYPE_IMAGE_SOURCE_DIR"];
            process.env["TYPE_IMAGE_SOURCE_DIR"] = quelle;
            try {
                return await welt.post(`${URL}/type-images/adopt`, person.cookie, { operationId: operationId() });
            } finally {
                if (vorher === undefined) delete process.env["TYPE_IMAGE_SOURCE_DIR"];
                else process.env["TYPE_IMAGE_SOURCE_DIR"] = vorher;
            }
        },
    },
};
