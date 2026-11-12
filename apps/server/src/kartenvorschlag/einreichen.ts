import { AVENTURIA, kartenvorschlagNummer, type KartenvorschlagEinreichung } from "@avesmaps3d/shared";
import { schluesselHash } from "../community/db.ts";
import type { Sql } from "../auth/session-store.ts";
import type { Database } from "../database.ts";
import { enqueueSettle } from "../media-editor/settle.ts";
import type { MediaStore } from "../media/storage.ts";
import {
    KARTENVORSCHLAG_AUSLOESER,
    bereinigt,
    freiwillig,
    ladeVorschlag,
    legeWerkAn,
    nichtGefunden,
    pruefeKartendatei,
    schluesselBelegt,
    uebergangFehlt,
    ungueltig,
} from "./db.ts";

/**
 * Einen Kartenvorschlag einreichen, ohne Konto (WI-0275 Stufe B), in zwei Schritten:
 *
 * 1. `einreichen`: die Angaben. Ein Link ist damit fertig (`pending`, wartet auf die Redaktion); bei einer Datei steht der Vorschlag auf `incoming`
 *    und wartet auf die Bytes.
 * 2. `dateiAnnehmen`: die Bytes (roher Rumpf bis 50 MiB). Sie werden geprüft (Art aus den Bytes, Pixelgrenzen, Metadaten ab), als privates Werk der
 *    Rolle `map_full` abgelegt und durch die Kette der Kartenquellen geschickt (`media_settle` im Worker, PDF seit Stufe A). Ist die technische
 *    Prüfung durch, wird der Vorschlag `pending` (oder `technical_failed`), sobald ihn jemand liest.
 *
 * - **Prüfung vor jedem Byte auf der Platte.** Der Ort (`placeId`) ist einer der Karte; Link ODER Datei, nie beides; eine Datei bringt Lizenzwahl und
 *   Bedingungen mit; ein Link braucht beides nicht.
 * - **Texte getrimmt:** wie die Datenbank sie zählt; leer danach ist 422.
 * - **Idempotent (M10):** dieselbe Kennung liefert dieselbe Quittung, keine zweite Zeile. Derselbe Schlüssel mit anderer Kennung ist 409
 *   `kartenvorschlag_key_used`; dieselbe Kennung mit anderem Schlüssel ebenso.
 * - 🔴 **Nie öffentlich:** Der Vorschlag ist keine Karte; das Werk einer Datei ist `pending` und ohne Verwendung. Erst die Annahme der Redaktion legt
 *   die Zeile in `citymap` an.
 * - **Die Glocke** (`melde`, `kartenvorschlag/glocke.ts`) schlägt einmal an: beim Link, wenn die Zeile neu ist; bei einer Datei, wenn die Bytes da sind. Vorher gibt es für die Redaktion noch nichts zu prüfen.
 */
export async function einreichen(
    db: Database,
    body: KartenvorschlagEinreichung,
    melde?: (tx: Sql, id: string) => Promise<void>,
): Promise<{ nummer: string; dateiNoetig: boolean }> {
    const datei = body.weg === "datei";
    // WI-0291: jeder Grund trägt `details.reason` (und die Angabe dazu), damit das Fenster sagt, was zu tun ist.
    const satzDatei = "Zu einer eigenen Datei gehören Angabe der Datei, Nutzung und Bedingungen, aber kein Link.";
    const satzLink = "Zu einem Link gehört die Adresse, aber keine Datei.";
    if (datei) {
        if (body.link !== undefined) throw ungueltig(satzDatei, "datei_und_link");
        const fehlt = body.datei === undefined ? "datei" : body.nutzung === undefined ? "nutzung" : "bedingungen";
        if (body.datei === undefined || body.nutzung === undefined || body.bedingungen === undefined) {
            throw ungueltig(satzDatei, "datei_angaben_fehlen", { fehlt });
        }
    } else {
        if (body.link === undefined) throw ungueltig(satzLink, "link_fehlt");
        if (body.datei !== undefined || body.nutzung !== undefined || body.bedingungen !== undefined) {
            throw ungueltig(satzLink, "link_mit_datei");
        }
    }
    if (body.gueltigAb !== undefined && body.gueltigBis !== undefined && body.gueltigAb > body.gueltigBis) {
        throw ungueltig("Der Zeitraum endet vor seinem Beginn.", "zeitraum_verkehrt", {
            gueltigAb: body.gueltigAb,
            gueltigBis: body.gueltigBis,
        });
    }
    const titel = bereinigt(body.titel, "Der Titel", "titel");
    const beschreibung = freiwillig(body.beschreibung, "Die Beschreibung", "beschreibung");
    const quelle = freiwillig(body.quelle, "Die Quelle", "quelle");
    const urheber = freiwillig(body.urheber, "Der Zeichner", "urheber");
    const notiz = freiwillig(body.notiz, "Die Notiz", "notiz");
    const name = freiwillig(body.name, "Der Name", "name");
    const typen = [...new Set(body.typen ?? [])].sort();

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
    const zustand = datei ? "incoming" : "pending";
    let angelegt: { number: string; public_id: string } | undefined;
    try {
        [angelegt] = await db<{ number: string; public_id: string }[]>`
            INSERT INTO citymap_suggestion (
                operation_id, state, status_key_hash, way, title, description, source_text, link_url, file_mime, usage_grant, terms_version,
                place_id, attribution_name, type_keys, author, art, valid_from_bf, valid_to_bf, color_mode, is_spoiler, is_labeled,
                is_multilevel, is_official, is_paid, preview_url, note
            )
            VALUES (
                ${body.operationId}::uuid, ${zustand}, ${hash}, ${datei ? "file" : "link"}, ${titel}, ${beschreibung}, ${quelle},
                ${body.link ?? null}, ${body.datei?.typ ?? null}, ${body.nutzung ?? null}, ${body.bedingungen ?? null},
                ${placeId}::bigint, ${name}, ${typen}::text[], ${urheber}, ${body.art ?? null}, ${body.gueltigAb ?? null},
                ${body.gueltigBis ?? null}, ${body.farbe ?? null}, ${body.spoiler ?? null}, ${body.beschriftet ?? null},
                ${body.mehrstoeckig ?? null}, ${body.offiziell ?? null}, ${body.kostenpflichtig ?? null}, ${body.vorschauLink ?? null}, ${notiz}
            )
            ON CONFLICT (operation_id) DO NOTHING
            RETURNING number::text AS number, public_id::text AS public_id
        `;
    } catch (error) {
        const code = (error as { code?: string }).code;
        // Der Schlüssel gehört schon einem anderen Vorschlag (die Kennung ist neu) oder die Zusagen der Datenbank.
        if (code === "23505") throw schluesselBelegt();
        if (code === "23514") throw ungueltig("Die Angaben passen nicht zusammen.", "angaben_passen_nicht");
        throw error;
    }
    if (angelegt === undefined) {
        // Dieselbe Kennung ein zweites Mal: dieselbe Quittung, wenn derselbe Schlüssel dabei ist; sonst gehört die Kennung einem anderen.
        const [vorhanden] = await db<{ number: string; state: string; way: string }[]>`
            SELECT number::text AS number, state, way FROM citymap_suggestion
             WHERE operation_id = ${body.operationId}::uuid AND status_key_hash = ${hash}
        `;
        if (vorhanden === undefined) throw schluesselBelegt();
        return {
            nummer: kartenvorschlagNummer(vorhanden.number),
            dateiNoetig: vorhanden.way === "file" && vorhanden.state === "incoming",
        };
    }
    const neu = angelegt.public_id;
    if (!datei && melde !== undefined) await db.begin((tx) => melde(tx, neu));
    return { nummer: kartenvorschlagNummer(angelegt.number), dateiNoetig: datei };
}

/**
 * Die Bytes eines Vorschlags mit Datei entgegennehmen (`PUT …/datei`). Der Vorschlag muss auf `incoming` stehen und noch kein Werk haben; ein zweiter
 * Aufruf nach Erfolg ist wirkungslos (200 mit dem Zustand, kein zweites Werk). Gesperrt wird die Zeile bis zum Ende der Transaktion.
 */
export async function dateiAnnehmen(
    db: Database,
    store: MediaStore,
    schluessel: string,
    bytes: Buffer,
    melde?: (tx: Sql, id: string) => Promise<void>,
): Promise<{ zustand: string }> {
    // Erst die schnelle Frage ohne Sperre: gibt es den Vorschlag, und braucht er eine Datei? Die Bytes werden geprüft, bevor eine Zeile gesperrt wird.
    const vorab = await ladeVorschlag(db, schluessel);
    if (vorab === undefined) throw nichtGefunden();
    if (vorab.way !== "file") throw uebergangFehlt("kein_dateiweg", vorab.state);
    if (vorab.mediaAssetId !== null) return { zustand: vorab.state };
    if (vorab.state !== "incoming") throw uebergangFehlt("datei_nicht_mehr_gefragt", vorab.state);
    const geprueft = pruefeKartendatei(bytes, vorab.fileMime ?? "");

    return db.begin(async (tx) => {
        const vorschlag = await ladeVorschlag(tx, schluessel, { gesperrt: true });
        if (vorschlag === undefined) throw nichtGefunden();
        if (vorschlag.mediaAssetId !== null) return { zustand: vorschlag.state };
        if (vorschlag.state !== "incoming") throw uebergangFehlt("datei_nicht_mehr_gefragt", vorschlag.state);
        const [fakten] = await tx<
            { usage_grant: "avesmaps_only" | "cc-by-4.0"; title: string; author: string | null }[]
        >`
            SELECT usage_grant, title, author FROM citymap_suggestion WHERE id = ${vorschlag.id}::bigint
        `;
        const werk = await legeWerkAn(tx, store, geprueft, {
            titel: fakten!.title,
            nutzung: fakten!.usage_grant,
            urheber: fakten!.author,
        });
        await tx`UPDATE citymap_suggestion SET media_asset_id = ${werk.id}::bigint WHERE id = ${vorschlag.id}::bigint`;
        await enqueueSettle(tx, {
            assetPublicId: werk.publicId,
            role: "map_full",
            actorPersonId: KARTENVORSCHLAG_AUSLOESER,
        });
        await melde?.(tx, vorschlag.publicId);
        return { zustand: "incoming" };
    }) as Promise<{ zustand: string }>;
}
