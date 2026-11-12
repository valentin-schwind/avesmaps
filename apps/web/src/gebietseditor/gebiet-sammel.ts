import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import {
    EDITOR_TERRITORY_OBERGEBIET_URL,
    EDITOR_TERRITORY_SAMMEL_RETIRE_URL,
    EDITOR_TERRITORY_SAMMEL_STAND_URL,
    EDITOR_TERRITORY_SAMMEL_URL,
    TERRITORY_SAMMEL_MAX,
    type EditorTerritoryRow,
    type EditorTerritorySammelStand,
    type OperationReceipt,
    type TerritoryObergebietBody,
    type TerritoryObergebietReceipt,
    type TerritoryRetireBody,
    type TerritorySammelBody,
    type TerritorySammelRetireBody,
} from "@avesmaps3d/shared";
import type { Fetcher } from "../auth/api";
import { sende, type SchreibAntwort } from "../fenster/entwurf-senden";
import { createSammelEntwurf, type SammelAenderungen, type SammelEntwurf } from "../fenster/sammel";
import type { WikiFeldLage } from "../fenster/wiki-feld";
import { formatNumber, t } from "../i18n/i18n";

/**
 * Die Mehrfachauswahl der Herrschaftsgebiete (EDIT-0003 T57; Fassung 5, Betreiber 2026-10-19: „perfekt genau das wollen wir“) auf dem
 * gemeinsamen Bauteil `fenster/sammel.ts`: Für die angehakten Gebiete liest sie den Stand (Revision, Status, Wiki-Felder;
 * `EDITOR_TERRITORY_SAMMEL_STAND_URL`) und hält EINEN Entwurf; „Fertig“ schreibt `territory.sammel` gegen die gelesenen Revisionen.
 *
 * - **Gemeinsam:** Art, Status, Obergebiet („Umhängen …“), Farbe, Zoomspanne und ↺ der Wiki-Felder. **Nur einzeln:** Name, Kurzname,
 *   Hauptstadt (`EINZELN`).
 * - Nach dem Schreiben und nach einem Konflikt liest sie den Stand neu; Liste, Befunde und Karte liest die Seite (`geschrieben`).
 */
export interface GebietSammelFelder {
    type: string;
    status: string;
    /** Das neue Obergebiet aller; `null` heißt Wurzel. */
    parent: { id: string; name: string } | null;
    color: string;
    zoom: { von: number | undefined; bis: number | undefined };
}

/** Die Felder, die in der Mehrfachauswahl gesperrt mit „Nur einzeln“ dastehen. */
export const EINZELN = ["name", "shortName", "capital"] as const;

export interface GebietSammel extends SammelEntwurf<GebietSammelFelder> {
    /** Der gelesene Stand der Gebiete; bis er da ist `undefined`. */
    readonly gelesen: Readonly<ShallowRef<EditorTerritorySammelStand | undefined>>;
    readonly lesefehler: Readonly<Ref<boolean>>;
    /** Mehr angehakt, als eine Operation trägt (`TERRITORY_SAMMEL_MAX`): der Satz dazu; dann wird nichts gelesen oder geschickt. */
    readonly grenze: string | undefined;
    neuLesen(): Promise<void>;
    /** „Entfernen …“ für alle (`territory.retire` für mehrere): sofort geschrieben, ohne Entwurf; den Satz einer Ablehnung zurück. */
    entferne(
        stage: TerritoryRetireBody["stage"],
    ): Promise<{ ok: true; quittung: OperationReceipt } | { ok: false; satz: string }>;
    /** „Unter neues Obergebiet …“ (`territory.create_parent`): sofort geschrieben, ohne Entwurf; den Satz einer Ablehnung zurück. */
    obergebiet(
        daten: Omit<TerritoryObergebietBody, "operationId" | "territories">,
    ): Promise<{ ok: true; quittung: TerritoryObergebietReceipt } | { ok: false; satz: string }>;
    destroy(): void;
}

export interface GebietSammelOptionen {
    /** Geschrieben: Kachelrevision und Folgearbeit an die Seite; sie liest Liste und Befunde neu. */
    geschrieben(quittung: OperationReceipt): void;
    /** „Entfernen …“ ging durch: die Seite liest neu, und ganz gelöschte gehen aus der Auswahl. */
    entfernt?(quittung: OperationReceipt, stage: TerritoryRetireBody["stage"]): void;
    /** „Unter neues Obergebiet …“ ging durch: die Seite liest neu und zeigt das neue Gebiet. */
    obergebiet?(quittung: TerritoryObergebietReceipt): void;
    readonly neueKennung?: () => string;
}

/** Was „Fertig“ schickt: die geänderten Felder für alle `ids`, je gegen die gelesene Revision. */
export function sammelKoerper(
    ids: readonly string[],
    aenderungen: SammelAenderungen<GebietSammelFelder>,
    operationId: string,
    stand: EditorTerritorySammelStand,
): TerritorySammelBody | undefined {
    const revision = new Map(stand.territories.map((gebiet) => [gebiet.id, gebiet.revision]));
    if (ids.some((id) => !revision.has(id))) return undefined;
    const f = aenderungen.felder;
    const changes = {
        ...(f.type === undefined ? {} : { type: f.type }),
        ...(f.status === undefined ? {} : { status: f.status }),
        ...(f.parent === undefined ? {} : { parent: f.parent === null ? "" : f.parent.id }),
    };
    return {
        operationId,
        territories: ids.map((id) => ({ id, baseRevision: revision.get(id)! })),
        ...(Object.keys(changes).length > 0 ? { changes } : {}),
        ...(aenderungen.wiki.length > 0 ? { wiki: aenderungen.wiki as NonNullable<TerritorySammelBody["wiki"]> } : {}),
        ...(f.color === undefined ? {} : { color: f.color.toLowerCase() }),
        ...(f.zoom === undefined
            ? {}
            : {
                  zoom: {
                      ...(f.zoom.von === undefined ? {} : { minZoom: f.zoom.von }),
                      ...(f.zoom.bis === undefined ? {} : { maxZoom: f.zoom.bis }),
                  },
              }),
    };
}

export function createGebietSammel(
    ids: readonly string[],
    fetcher: Fetcher,
    optionen: GebietSammelOptionen,
): GebietSammel {
    const gelesen = shallowRef<EditorTerritorySammelStand | undefined>(undefined);
    const lesefehler = ref(false);
    let lauf: AbortController | undefined;
    // Über der Grenze nie still scheitern (Betreiber 2026-10-20: „Die gewählten Gebiete konnten nicht gelesen werden.“ bei 636).
    const grenze =
        ids.length > TERRITORY_SAMMEL_MAX
            ? t("gebietseditor.sammel.zuViele", {
                  max: formatNumber(TERRITORY_SAMMEL_MAX, 0),
                  n: formatNumber(ids.length, 0),
              })
            : undefined;

    async function neuLesen(): Promise<void> {
        if (grenze !== undefined) return;
        lauf?.abort();
        const steuer = new AbortController();
        lauf = steuer;
        lesefehler.value = false;
        try {
            const antwort = await fetcher(EDITOR_TERRITORY_SAMMEL_STAND_URL, {
                method: "POST",
                headers: { accept: "application/json", "content-type": "application/json" },
                credentials: "same-origin",
                cache: "no-store",
                body: JSON.stringify({ ids }),
                signal: steuer.signal,
            });
            if (!antwort.ok) throw new Error(String(antwort.status));
            const stand = (await antwort.json()) as EditorTerritorySammelStand;
            if (lauf === steuer) gelesen.value = stand;
        } catch {
            if (lauf === steuer && !steuer.signal.aborted) lesefehler.value = true;
        }
    }

    async function schreibe(
        schreibIds: readonly string[],
        aenderungen: SammelAenderungen<GebietSammelFelder>,
        operationId: string,
    ): Promise<SchreibAntwort<OperationReceipt>> {
        if (grenze !== undefined) return { ok: false, status: 0, fehler: { code: "sammel_grenze", message: grenze } };
        const stand = gelesen.value;
        const koerper = stand === undefined ? undefined : sammelKoerper(schreibIds, aenderungen, operationId, stand);
        if (koerper === undefined)
            return { ok: false, status: 0, fehler: { code: "sammel_laedt", message: t("gebietseditor.sammel.laedt") } };
        const antwort = await sende(EDITOR_TERRITORY_SAMMEL_URL, koerper, "POST", (eingabe, init) =>
            fetcher(String(eingabe), init),
        );
        // Ein Konflikt: Der Entwurf bleibt, der Stand liest neu; ein zweites „Fertig“ schreibt gegen die neuen Revisionen.
        if (!antwort.ok && antwort.fehler.code === "edit_conflict") void neuLesen();
        return antwort;
    }

    const entwurf = createSammelEntwurf<GebietSammelFelder>({ schreibe }, ids, {
        ...(optionen.neueKennung === undefined ? {} : { neueKennung: optionen.neueKennung }),
        geschrieben(quittung) {
            void neuLesen();
            optionen.geschrieben(quittung);
        },
    });
    async function entferne(
        stage: TerritoryRetireBody["stage"],
    ): Promise<{ ok: true; quittung: OperationReceipt } | { ok: false; satz: string }> {
        if (grenze !== undefined) return { ok: false, satz: grenze };
        const revision = new Map(gelesen.value?.territories.map((g) => [g.id, g.revision]) ?? []);
        if (ids.some((id) => !revision.has(id))) return { ok: false, satz: t("gebietseditor.sammel.laedt") };
        const antwort = await sende(
            EDITOR_TERRITORY_SAMMEL_RETIRE_URL,
            {
                operationId: optionen.neueKennung?.() ?? crypto.randomUUID(),
                territories: ids.map((id) => ({ id, baseRevision: revision.get(id)! })),
                stage,
            } satisfies TerritorySammelRetireBody,
            "POST",
            (eingabe, init) => fetcher(String(eingabe), init),
        );
        if (!antwort.ok) {
            if (antwort.fehler.code === "edit_conflict") void neuLesen();
            return { ok: false, satz: antwort.fehler.message };
        }
        void neuLesen();
        optionen.entfernt?.(antwort.quittung, stage);
        return { ok: true, quittung: antwort.quittung };
    }

    async function obergebiet(
        daten: Omit<TerritoryObergebietBody, "operationId" | "territories">,
    ): Promise<{ ok: true; quittung: TerritoryObergebietReceipt } | { ok: false; satz: string }> {
        if (grenze !== undefined) return { ok: false, satz: grenze };
        const revision = new Map(gelesen.value?.territories.map((g) => [g.id, g.revision]) ?? []);
        if (ids.some((id) => !revision.has(id))) return { ok: false, satz: t("gebietseditor.sammel.laedt") };
        const antwort = await sende<TerritoryObergebietReceipt>(
            EDITOR_TERRITORY_OBERGEBIET_URL,
            {
                operationId: optionen.neueKennung?.() ?? crypto.randomUUID(),
                territories: ids.map((id) => ({ id, baseRevision: revision.get(id)! })),
                ...daten,
            } satisfies TerritoryObergebietBody,
            "POST",
            (eingabe, init) => fetcher(String(eingabe), init),
        );
        if (!antwort.ok) {
            if (antwort.fehler.code === "edit_conflict") void neuLesen();
            return { ok: false, satz: antwort.fehler.message };
        }
        optionen.obergebiet?.(antwort.quittung);
        return { ok: true, quittung: antwort.quittung };
    }

    return Object.assign(entwurf, {
        gelesen,
        lesefehler,
        grenze,
        neuLesen,
        entferne,
        obergebiet,
        destroy(): void {
            lauf?.abort();
        },
    });
}

/**
 * Gewählte Gebiete, die nicht gewählte Untergebiete haben, mit deren Zahl, die meisten zuerst: Diese Untergebiete rücken beim Entfernen
 * eine Ebene hoch (`territory.retire`, Stufe `up`). Der Dialog „Entfernen …“ nennt sie als Hinweis (Fund 2026-10-25: Eine Wahl über
 * „Alle n“ hatte Thorwal mit seinen elf Untergebieten mitgenommen, ohne dass der Dialog es sagte). Gezählt werden die unmittelbaren
 * Untergebiete; ein gewähltes Untergebiet zählt nicht, seine eigenen nicht gewählten Untergebiete zählen bei ihm, und ein schon
 * gelöschtes rückt nicht (der Server nimmt nur aktive).
 */
export function untergebieteHoch(
    gewaehlte: readonly EditorTerritoryRow[],
    zeilen: readonly EditorTerritoryRow[],
): { id: string; name: string; n: number }[] {
    const ids = new Set(gewaehlte.map((g) => g.id));
    const zahl = new Map<string, number>();
    for (const z of zeilen) {
        if (z.parent !== undefined && z.deleted !== true && ids.has(z.parent) && !ids.has(z.id)) {
            zahl.set(z.parent, (zahl.get(z.parent) ?? 0) + 1);
        }
    }
    return gewaehlte
        .filter((g) => zahl.has(g.id))
        .map((g) => ({ id: g.id, name: g.name, n: zahl.get(g.id)! }))
        .sort((a, b) => b.n - a.n);
}

/** Ein Detailfeld eines gewählten Gebiets, wie der Stand es liest (`details`; fehlt: kein Wert, Wiki unbekannt). */
type DetailWert = { value: string | null; origin?: "override" | "wiki"; wiki?: string | null } | undefined;

/**
 * Der Wert eines Wiki-Felds über alle gewählten: gleich (mit Wert, leer heißt keiner) oder gemischt. `aufWiki`: ↺ für alle steht im
 * Entwurf; dann zählt an den Gebieten mit eigenem Wert der Wiki-Wert.
 */
export function sammelWikiWert(
    werte: readonly DetailWert[],
    aufWiki: boolean,
): { gleich: true; wert: string } | { gleich: false } {
    const wirksam = werte.map((w) => (aufWiki && w?.origin === "override" ? (w.wiki ?? "") : (w?.value ?? "")).trim());
    if (wirksam.length === 0) return { gleich: false };
    return wirksam.every((w) => w === wirksam[0]) ? { gleich: true, wert: wirksam[0]! } : { gleich: false };
}

/**
 * Die Lage der Zeile im Wiki-Feld (`fenster/wiki-feld.vue`) für alle gewählten: ↺ ist wach, solange eines einen eigenen Wert trägt
 * (`territory.sammel` nimmt ihn nur dort zurück). Den Wiki-Wert durchgestrichen zeigt sie nur, wenn er an allen derselbe ist.
 */
export function sammelWikiLage(werte: readonly DetailWert[], aufWiki: boolean): WikiFeldLage {
    if (aufWiki) return { zustand: "folgt", abweichend: false, zurueck: false, mitZurueck: true };
    const eigene = werte.filter((w) => w?.origin === "override");
    if (eigene.length === 0) return { zustand: "gleich", abweichend: false, zurueck: false, mitZurueck: true };
    const wiki = werte.map((w) => w?.wiki);
    const einWiki = wiki.every((w) => w === wiki[0]) && wiki[0] !== undefined;
    const abweichend = einWiki && eigene.some((w) => (w!.value ?? "").trim() !== (w!.wiki ?? "").trim());
    return abweichend
        ? { zustand: "weicht", abweichend: true, wikiText: wiki[0] ?? null, zurueck: true, mitZurueck: true }
        : { zustand: "weicht", abweichend: false, zurueck: true, mitZurueck: true };
}
