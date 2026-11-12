import { EDITOR_LANDSCAPE_LAYERS, type EditorLandscapeLayer, type EditorWikiEintrag } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { ladeBelegteRegionArtikel } from "../wiki/abgleich/lokal.ts";
import { landmarkeSchluessel } from "../wiki/infobox/landmarke.ts";
import { BEGRIFFE_VORGABE } from "../wiki/regeln/begriffe.ts";
import { titelAusWikiAdresse } from "../wiki/vorschau/adresse.ts";

/**
 * Die Wiki-Einträge ohne Fläche im Editor (WI-0284; Vali 2026-11-06: „einfach listeneinträge mit dem wiki-eintrag (halt ohne fläche)“): die Zeilen in `wiki_region_snapshot`, an denen keine Fläche und kein
 * Gipfel hängt, als ◐-Zeilen der Derographie-Liste. Weil dieselbe Zeile der Wiki-Stand ist, findet die Wiki-Box einer vorhandenen Fläche den Artikel ohne weiteren Weg (Frühlingsstrand), und der Sync läuft danach.
 *
 * Eine Zeile bekommt ihre Ebene aus der Art des Artikels, gelesen aus den Startwerten der Begriffstafel (Insel → Topographie, Wald → Vegetation). Eine Art ohne Abbildung steht unter „Regionen“ (`derographisch`), ohne
 * Flächenart: Das ist nur der Ort in der Liste und die Vorgabe beim Anlegen, der Editor kann beides ändern.
 */

const LAENGE_KURZ = 600;

export function ebeneDerWikiArt(art: string | null): { layer: EditorLandscapeLayer; type: string | null } {
    const wort = (art ?? "").split("|")[0]!.trim().toLowerCase();
    const [ebene, typ] = (BEGRIFFE_VORGABE.get(wort)?.pillen[0] ?? "").split("|");
    return (EDITOR_LANDSCAPE_LAYERS as readonly string[]).includes(ebene ?? "")
        ? { layer: ebene as EditorLandscapeLayer, type: typ ?? null }
        : { layer: "derographisch", type: null };
}

type Zeile = Record<string, unknown>;
const text = (wert: unknown): string | undefined => (typeof wert === "string" && wert.trim() !== "" ? wert : undefined);

const titelDerZeile = (zeile: Zeile): string =>
    titelAusWikiAdresse(String(zeile["wiki_url"])) ?? text(zeile["name"]) ?? String(zeile["wiki_key"]);

export async function ladeWikiEintraege(db: Queryable): Promise<EditorWikiEintrag[]> {
    const zeilen = await db<Zeile[]>`
        SELECT public_id::text AS id, wiki_key, wiki_url, name, art, region_parent, left(description, ${LAENGE_KURZ}) AS kurz
          FROM wiki_region_snapshot
         WHERE is_active
         ORDER BY lower(coalesce(name, wiki_key)), public_id
    `;
    const belegt = await ladeBelegteRegionArtikel(db);
    const eintraege: EditorWikiEintrag[] = [];
    for (const zeile of zeilen) {
        const titel = titelDerZeile(zeile);
        if (belegt.has(landmarkeSchluessel(titel))) continue;
        const art = text(zeile["art"])?.split("|")[0]?.trim();
        const { layer, type } = ebeneDerWikiArt(art ?? null);
        const region = text(zeile["region_parent"]);
        const kurz = text(zeile["kurz"]);
        eintraege.push({
            id: String(zeile["id"]),
            titel,
            name: text(zeile["name"]) ?? titel,
            layer,
            ...(type === null ? {} : { type }),
            ...(art === undefined ? {} : { art }),
            ...(region === undefined ? {} : { region }),
            ...(kurz === undefined ? {} : { kurzbeschreibung: kurz }),
            wikiUrl: String(zeile["wiki_url"]),
        });
    }
    return eintraege;
}

/** Der Eintrag, aus dem eine neue Fläche entsteht (in ihrer Transaktion). 409, wenn es ihn nicht mehr gibt oder er inzwischen an einer Fläche hängt. */
export async function wikiEintragZumAnlegen(
    tx: Queryable,
    id: string,
    layer: EditorLandscapeLayer,
): Promise<{ key: string; url: string; name: string; type: string | null }> {
    const [zeile] = await tx<Zeile[]>`
        SELECT wiki_key, wiki_url, name, art FROM wiki_region_snapshot WHERE public_id = ${id}::uuid AND is_active
    `;
    if (zeile === undefined) throw new ApiError(409, "wiki_eintrag_weg", "Diesen Wiki-Eintrag gibt es nicht mehr.");
    const titel = titelDerZeile(zeile);
    if ((await ladeBelegteRegionArtikel(tx)).has(landmarkeSchluessel(titel)))
        throw new ApiError(409, "wiki_eintrag_belegt", "Dieser Wiki-Eintrag hängt schon an einer Fläche.");
    const vorgabe = ebeneDerWikiArt(text(zeile["art"]) ?? null);
    return {
        key: String(zeile["wiki_key"]),
        url: String(zeile["wiki_url"]),
        name: text(zeile["name"]) ?? titel,
        type: vorgabe.layer === layer ? vorgabe.type : null,
    };
}
