import { AVENTURIA, photoboxGrantAllowed, type PhotoboxEinreichung } from "@avesmaps3d/shared";
import type { AuthEnvironment } from "../auth/config.ts";
import { schluesselHash } from "../community/db.ts";
import type { GlockeLog } from "../community/glocke.ts";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { mediaOperation } from "../media-editor/operation-store.ts";
import { enqueueSettle } from "../media-editor/settle.ts";
import { sha256Of, type MediaStore } from "../media/storage.ts";
import { PHOTOBOX_AUSLOESER, bereinigt, legeBildAn, photoboxAkteur, pruefeBild, ungueltig } from "./db.ts";
import { OHNE_PROTOKOLL, meldeNeuesReisebild } from "./glocke.ts";

/** Was nur die Beispielbilder ändern (siehe `einreichen`); ohne Optionen verhält sich das Einreichen wie immer. */
export interface EinreichenOptionen {
    /** `false`: keine Glocke für die Redaktion. */
    glocke?: boolean;
    /** Statt der Fassung der Bedingungen in `media_submission.terms_version`. */
    kennzeichen?: string;
}

/**
 * Ein Reisebild einreichen, ohne Konto (WI-0272 S2, §12/§13): Bild prüfen, privat ablegen, Asset samt Rechten, Entstehung, Eingang und Einreichung anlegen,
 * die interne Vorschau einreihen. Eine Operation (`photobox.submit`) im Protokoll der Medien mit dem anonymen Handelnden `photobox`.
 *
 * - **Prüfung vor jedem Byte auf der Platte:** ein SVG ist 415 (`pruefeBild`), die übrigen Ablehnungen wie beim Hochladen der Medienverwaltung; eine
 *   Avesmaps-Aufnahme unter CC BY ist 422, die Stelle liegt in der Kartendomäne (sonst 422; die Datenbank hält beides ein zweites Mal), der Ort
 *   (`placeId`) ist einer der Karte.
 * - **Texte getrimmt:** Beschreibung und Name werden so gespeichert, wie die Datenbank sie zählt; leer danach ist 422.
 * - **Idempotent (M10):** dieselbe Kennung mit demselben Inhalt liefert dieselbe Quittung, keine zweite Zeile. Der Schlüssel der Statusseite
 *   geht nur als Hash in den Hash der Anfrage; derselbe Schlüssel mit anderer Kennung ist 409 `photobox_key_used`.
 * - 🔴 **Nie öffentlich:** Das Asset ist `pending` und ohne Verwendung; die Rolle `photobox` macht erst die Freigabe der Redaktion zur Verwendung.
 *   Der Abgleich (`media_settle`) rechnet nur die interne Vorschau und läuft ohne Person als Auslöser.
 * - 🔔 **Die Glocke** (Aufgabe 19): Die Redaktion bekommt in derselben Transaktion `photobox_eingang` (gebündelt, ohne Text), bestenfalls: Scheitert die Glocke, gilt die Einreichung. `log` ist das
 *   Protokoll der Anfrage, in das eine gescheiterte Glocke schreibt.
 * - **Optionen** (nur für die Beispielbilder, `photobox/beispiele.ts`, WI-0272 S4): `glocke: false` läutet nicht (Beispielbilder sind keine Arbeit für die Redaktion), `kennzeichen`
 *   steht statt der Fassung der Bedingungen in `terms_version`, schon beim Anlegen und in derselben Transaktion; daran erkennt das Kommando seine Zeilen wieder.
 */
export async function einreichen(
    db: Database,
    store: MediaStore,
    umgebung: AuthEnvironment,
    body: PhotoboxEinreichung,
    log: GlockeLog = OHNE_PROTOKOLL,
    optionen: EinreichenOptionen = {},
): Promise<{ publicId: string }> {
    const bild = pruefeBild(body.bild);
    if (!photoboxGrantAllowed(body.entstehung, body.nutzung)) {
        throw ungueltig("Eine Aufnahme aus Avesmaps gibt es nur für Avesmaps, nicht unter CC BY.", "cc_by_avesmaps");
    }
    const beschreibung = bereinigt(body.beschreibung, "Die Bildbeschreibung", "beschreibung");
    const name = body.name === undefined ? null : bereinigt(body.name, "Der Name", "name");

    const { x, y } = body.lage;
    const [innen] = await db<{ innen: boolean | null }[]>`
        SELECT map_domain_contains(${AVENTURIA.mapDomain}, ST_SetSRID(ST_MakePoint(${x}::float8, ${y}::float8), 0)) AS innen
    `;
    if (innen?.innen !== true) throw ungueltig("Diese Stelle liegt nicht auf der Karte.", "stelle_ausserhalb");
    let placeId: string | null = null;
    if (body.placeId !== undefined) {
        const [ort] = await db<{ id: string }[]>`
            SELECT id::text AS id FROM place
             WHERE public_id = ${body.placeId}::uuid AND map_domain_id = ${AVENTURIA.mapDomain} AND is_active
        `;
        if (ort === undefined) throw ungueltig("Diesen Ort gibt es nicht.", "ort_unbekannt");
        placeId = ort.id;
    }

    const hash = schluesselHash(body.schluessel);
    // Der Inhalt, über den eine Wiederholung erkannt wird: die Felder, der Hash des Bildes und der Hash des Schlüssels, nie die Bytes oder der Schlüssel.
    const inhalt = {
        schluessel: hash.toString("hex"),
        bild: sha256Of(bild.bytes),
        lage: body.lage,
        placeId: body.placeId,
        bezug: body.bezug,
        blickrichtung: body.blickrichtung,
        entstehung: body.entstehung,
        nutzung: body.nutzung,
        beschreibung,
        name: name ?? undefined,
        bedingungen: body.bedingungen,
    };

    const quittung = await mediaOperation(
        db,
        photoboxAkteur(umgebung),
        { operationId: body.operationId, operation: "photobox.submit", body: inhalt },
        async (tx) => {
            const [vorhanden] = await tx`SELECT 1 FROM media_submission WHERE status_key_hash = ${hash}`;
            if (vorhanden !== undefined) throw schluesselBelegt();
            let einreichung: { id: string; public_id: string; revision: number } | undefined;
            try {
                [einreichung] = await tx<{ id: string; public_id: string; revision: number }[]>`
                    INSERT INTO media_submission (status_key_hash, map_domain_id, geom, place_id, reference_kind, reference_key, view_direction,
                                                  creation_kind, usage_grant, description, attribution_name, terms_version)
                    VALUES (${hash}, ${AVENTURIA.mapDomain}, ST_SetSRID(ST_MakePoint(${x}::float8, ${y}::float8), 0), ${placeId}::bigint,
                            ${body.bezug?.art ?? null}, ${body.bezug?.id ?? null}, ${body.blickrichtung ?? null}::smallint,
                            ${body.entstehung}, ${body.nutzung}, ${beschreibung}, ${name}, ${optionen.kennzeichen ?? body.bedingungen})
                    RETURNING id::text AS id, public_id::text AS public_id, revision::int AS revision
                `;
            } catch (error) {
                // Ein gleichzeitiger zweiter Versuch mit demselben Schlüssel (die Sperre je Kennung trennt nur gleiche Kennungen) oder die Zusagen der Datenbank.
                const code = (error as { code?: string }).code;
                if (code === "23505") throw schluesselBelegt();
                if (code === "23514") throw ungueltig("Die Angaben passen nicht zusammen.", "angaben_passen_nicht");
                throw error;
            }
            const asset = await legeBildAn(tx, store, bild, {
                submissionId: einreichung!.id,
                submissionPublicId: einreichung!.public_id,
                entstehung: body.entstehung,
                nutzung: body.nutzung,
                name,
            });
            const abgleich = await enqueueSettle(tx, {
                assetPublicId: asset.publicId,
                role: "photobox",
                actorPersonId: PHOTOBOX_AUSLOESER,
            });
            if (optionen.glocke !== false) await meldeNeuesReisebild(tx, log, umgebung, body.operationId);
            return {
                receipt: {
                    affected: [
                        { kind: "media_submission", id: einreichung!.public_id, revision: einreichung!.revision },
                    ],
                    derivedWork: [abgleich],
                    warnings: [],
                },
                entries: [
                    {
                        action: "photobox.submitted",
                        assetId: asset.publicId,
                        targetRevision: einreichung!.revision,
                        details: {
                            creation: body.entstehung,
                            grant: body.nutzung,
                            format: asset.format,
                            byteSize: asset.byteSize,
                            sha256: asset.sha256,
                        },
                    },
                ],
            };
        },
    );
    const betroffen = quittung.affected.find((eintrag) => eintrag.kind === "media_submission");
    if (betroffen === undefined) throw new Error("Quittung der Einreichung ohne Einreichung");
    return { publicId: betroffen.id };
}

/** Der Link gehört schon einer Einreichung (Doppelklick mit neuer Kennung, ein Formular, das nicht neu geöffnet wurde): 409. */
export const schluesselBelegt = (): ApiError =>
    new ApiError(
        409,
        "photobox_key_used",
        "Dieser Link gehört schon zu einem Reisebild. Bitte das Formular neu öffnen.",
        { reason: "schluessel_belegt" },
    );
