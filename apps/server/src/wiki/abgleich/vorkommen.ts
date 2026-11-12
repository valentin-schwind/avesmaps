import { createHash } from "node:crypto";
import {
    WIKISYNC_ORTSROLLEN,
    type WikisyncEigentuemer,
    type WikisyncOrtsrolle,
    type WikisyncStatus,
    type WikisyncWirkung,
} from "@avesmaps3d/shared";
import { kuerze } from "../infobox/text.ts";
import { VORKOMMEN_BEZIEHUNGEN, type VorkommenBeziehung, type VorkommenOrt } from "../infobox/vorkommen.ts";
import { publikationsSchluessel } from "../schluessel.ts";
import type { BestehendeRegel } from "../regeln/vorschlag.ts";
import { aufgeloesterTitel, normTitel, type FeldRolle, type ZielWissen } from "./ortsrolle.ts";

/**
 * Die Ortszeilen eines Vorkommens im WikiSync (WI-0253, Scheibe Vorkommen, §23): die Wikilinks der Ortsfelder des Artikels gegen die Ortszeilen des Eintrags (`lore_place`). REIN: keine
 * Datenbank. Dieselben Funktionen rechnen die Vorschau (`plan.ts`) und, unter der Sperre, die Übernahme (`uebernahme/vorkommen.ts`).
 *
 * Vorbild ist Legacys Abgleich (Mirror a7f2dac86, `api/_internal/wiki/lore-sync.php`, `avesmapsLoreChildPlan`): Identität einer Zeile ist Schlüssel und Beziehung; angelegt und entfernt werden
 * NUR Zeilen des Wikis, eine manuelle Zeile sieht der Abgleich nicht, ein Tombstone (`suppressed`) lebt nie wieder auf.
 *
 * Was dieser Abgleich anders macht, mit Grund:
 * - **Jede Zeile hat eine Rolle** (`WIKISYNC_ORTSROLLEN`, Vali 2026-10-27): Der Link bleibt gespeichert, aber nur `ort` trifft. Eine Zeile ohne Rolle (Bestand) gilt als `ort`, bis ein Abgleich
 *   sie bestimmt: Sie bekommt nur eine Zeile im Bericht, wenn das Wiki etwas anderes sagt.
 * - **Das Ziel löst Weiterleitungen auf** (Legacy: nie): Der Schlüssel folgt dem Artikel, auf den ein umbenannter Link führt. Eine Zeile, die Legacy unter dem Schlüssel des alten Titels führt,
 *   wird ersetzt (die alte still gelegt, die neue angelegt); der Bericht zählt, wie oft das geschieht.
 * - **Anlegen und Stilllegen** (Vali 2026-10-27 für die Quellen, hier sinngemäß übertragen): Eine neue Nennung wird angelegt, eine nicht mehr genannte still gelegt – das Letzte nur bei belegter
 *   Wiki-Herkunft (`legacy_origin = 'wiki'`). Manuelle Zeilen, Zeilen mit einem Ziel der Redaktion (`target_origin = 'editor'`) und Tombstones bleiben; nichts lebt wieder auf außer dem, was der
 *   WikiSync selbst still legte. Ein Eintrag der Redaktion (`source_system = 'editor'`) gehört samt Liste der Redaktion: Jede Abweichung ist eine eigene Entscheidung.
 * - **Eine Zeile OHNE belegte Herkunft** (`unknown`) ist unbelegt: weicht sie ab, ein Befund (wie bei Feldern und Ortslisten).
 */

export type LoreHerkunft = "wiki" | "manual" | "unbekannt";

/** Eine Ortszeile eines Eintrags, so weit der Abgleich sie braucht. */
export interface LoreZeile {
    /** `lore_place.id`. */
    id: string;
    /** `lore_place.place_wiki_key`; `null`: ein ungeklärter Name der Redaktion (kein Schlüssel, nie ein Treffer). */
    schluessel: string | null;
    titel: string | null;
    beziehung: string;
    stelle: number;
    zustand: "active" | "retired" | "suppressed";
    /** Wer die Zeile still legte (`retired_origin`): `wikisync` lebt wieder auf, `editor`, `import`, `legacy` nie. */
    stillVon: string | null;
    herkunft: LoreHerkunft;
    /** `lore_place.role`; `null`: Bestand ohne Rolle, gilt als `ort`. */
    rolle: WikisyncOrtsrolle | null;
}

export interface LoreBestand {
    /** Die Art des Eintrags (`lore_entry.kind`). */
    art: string;
    zeilen: readonly LoreZeile[];
    /** Der Eintrag gehört der Redaktion (`lore_entry.source_system = 'editor'`): die ganze Liste mit. */
    redaktion: boolean;
    /** `lore_entry.wiki_key` (Legacys Schlüssel): Teil des Fingerabdrucks seiner Regeln. Fehlt er, leitet der Abgleich keine Regeln ab. */
    wikiKey?: string;
    /** Die aktiven Regeln des Eintrags (`lore_rule`, mit Bedingungen), für die Regelvorschläge. */
    regeln?: readonly BestehendeRegel[];
}

/** Was das Wiki für eine Ortszeile nennt. */
export interface LoreWunsch {
    beziehung: VorkommenBeziehung;
    /** Der Schlüssel des Ziels, Weiterleitungen aufgelöst. */
    schluessel: string;
    /** Der Schlüssel, unter dem Legacy die Zeile führt (der Link, wie er im Artikel steht). */
    urschluessel: string;
    titel: string;
    stelle: number;
    rolle: WikisyncOrtsrolle;
    /** Warum diese Rolle (kurz); `null` bei `ort`. */
    grund: string | null;
}

/** Eine Ortszeile, wie die Zeile des Berichts sie nennt. */
export interface LoreOrtWert {
    titel: string;
    rolle: WikisyncOrtsrolle;
    schluessel: string;
}

export interface LoreOrtEntscheidung {
    feld: string;
    beziehung: VorkommenBeziehung;
    alt: LoreOrtWert | null;
    neu: LoreOrtWert | null;
    eigentuemer: WikisyncEigentuemer;
    wirkung: WikisyncWirkung;
    status: WikisyncStatus;
    grund: string | null;
}

export interface LoreOrtZahlen {
    gleich: number;
    angelegt: number;
    stillgelegt: number;
    /** Ortsziele, die über eine Weiterleitung des Wikis aufgelöst sind (Legacy: nicht gefunden). */
    weiterleitungen: number;
    /** Zeilen mit der Rolle `teil`: eine Rückfrage an die Redaktion. */
    rueckfragen: number;
}

export const GRUND_NEU = "Das Wiki nennt diesen Ort neu; die Zeile wird angelegt";
export const GRUND_WIEDER =
    "Das Wiki nennt diesen Ort wieder; die Zeile hat der WikiSync still gelegt, sie lebt wieder auf";
export const GRUND_NEU_VORSCHAU =
    "Das Wiki nennt diesen Ort neu; angelegt wird nichts, solange der Legacy-Zug den Bereich liefert";
export const GRUND_ROLLE = "Die Rolle der Zeile ist eine andere";
export const GRUND_ERSETZT =
    "Das Ziel führt im Wiki über eine Weiterleitung; die Zeile wird auf den Artikel dahinter gesetzt";
export const GRUND_ERSETZT_UNBELEGT =
    "Das Ziel führt im Wiki über eine Weiterleitung; die Zeile ohne belegte Herkunft bleibt";
export const GRUND_NICHT_MEHR = "Das Wiki nennt diesen Ort nicht mehr; die Zeile wird still gelegt";
export const GRUND_NICHT_MEHR_UNBELEGT =
    "Das Wiki nennt diesen Ort nicht mehr; ohne belegte Herkunft (Wiki) bleibt die Zeile";
export const GRUND_NICHT_MEHR_VORSCHAU =
    "Das Wiki nennt diesen Ort nicht mehr; still gelegt wird nichts, solange der Legacy-Zug den Bereich liefert";
export const GRUND_TOMBSTONE = "Die Redaktion hat diese Ortszeile entfernt; sie lebt nicht wieder auf";
export const GRUND_GELOEST = "Die Redaktion hat diese Ortszeile gelöst; sie lebt nicht wieder auf";
export const GRUND_IMPORT_GELOEST = "Der Legacy-Zug hat diese Ortszeile entfernt; sie lebt nicht wieder auf";
export const GRUND_REDAKTION = "Der Eintrag gehört der Redaktion; seine Ortszeilen sind eigen";
export const GRUND_UNBELEGT = "Ohne belegte Herkunft (Wiki) bleibt die Zeile";
export const RUECKFRAGE = "Rückfrage";

const istRolle = (wert: string | null): wert is WikisyncOrtsrolle =>
    wert !== null && (WIKISYNC_ORTSROLLEN as readonly string[]).includes(wert);

/** Die Rolle einer gespeicherten Zeile; keine gespeicherte Rolle gilt als `ort`. */
export const rolleDerZeile = (zeile: LoreZeile): WikisyncOrtsrolle => zeile.rolle ?? "ort";

/** Der Wert, den die Datenbank für eine Rolle speichert (nur gültige Wörter). */
export const gueltigeRolle = (wert: string | null): WikisyncOrtsrolle | null => (istRolle(wert) ? wert : null);

/** Das Feld einer Ortszeile im Bericht: `ortszeile_<Beziehung>_<16 Zeichen des Schlüssels>` (klein, höchstens 64 Zeichen, die Tafel des Laufs verlangt es). */
export const ortszeilenFeld = (beziehung: string, schluessel: string): string =>
    `ortszeile_${beziehung}_${createHash("sha256").update(schluessel, "utf8").digest("hex").slice(0, 16)}`;

const ORTSZEILE = new RegExp(`^ortszeile_(${VORKOMMEN_BEZIEHUNGEN.join("|")})_[0-9a-f]{16}$`, "u");

/** Die Beziehung hinter dem Feld einer Ortszeile; `null` bei jedem anderen Feld. */
export function beziehungAusFeld(feld: string | null): VorkommenBeziehung | null {
    const treffer = feld === null ? null : ORTSZEILE.exec(feld);
    return treffer === null ? null : (treffer[1] as VorkommenBeziehung);
}

export const istOrtszeilenFeld = (feld: string | null): boolean => beziehungAusFeld(feld) !== null;

/** Der Wert einer Ortszeile im Bericht: `Titel · Rolle · Schlüssel`; `leseLoreOrtWert` zerlegt ihn wieder (Titel dürfen " · " enthalten, Rolle und Schlüssel nie). */
export const loreOrtWert = (wert: LoreOrtWert): string => `${wert.titel} · ${wert.rolle} · ${wert.schluessel}`;

export function leseLoreOrtWert(text: string | null): LoreOrtWert | null {
    if (text === null) return null;
    const zweite = text.lastIndexOf(" · ");
    const erste = zweite < 0 ? -1 : text.lastIndexOf(" · ", zweite - 1);
    if (erste < 0) return null;
    const rolle = text.slice(erste + 3, zweite);
    const schluessel = text.slice(zweite + 3);
    if (!istRolle(rolle) || schluessel === "") return null;
    return { titel: text.slice(0, erste), rolle, schluessel };
}

/**
 * Die Wünsche des Artikels: je Ort das Ziel (Weiterleitung aufgelöst), seine Rolle und die Stelle. Zwei Links, die auf dasselbe Ziel führen, sind EIN Wunsch (die erste Stelle; `ort` gewinnt gegen
 * jede andere Rolle).
 */
export function baueWuensche(
    orte: readonly VorkommenOrt[],
    rollen: ReadonlyMap<VorkommenBeziehung, ReadonlyMap<string, FeldRolle>>,
    wissen: ZielWissen,
): { wuensche: LoreWunsch[]; weiterleitungen: number } {
    const wuensche = new Map<string, LoreWunsch>();
    let weiterleitungen = 0;
    for (const ort of orte) {
        const link = normTitel(ort.titel);
        const ziel = aufgeloesterTitel(link, wissen);
        const aufgeloest = publikationsSchluessel(ziel);
        const schluessel = aufgeloest === "" ? ort.schluessel : aufgeloest;
        const rolle = rollen.get(ort.beziehung)?.get(link.toLowerCase());
        const wunsch: LoreWunsch = {
            beziehung: ort.beziehung,
            schluessel,
            urschluessel: ort.schluessel,
            titel: ort.titel,
            stelle: ort.stelle,
            rolle: rolle?.rolle ?? "ort",
            grund: rolle?.grund ?? null,
        };
        const bisher = wuensche.get(`${ort.beziehung}|${schluessel}`);
        if (bisher === undefined) {
            wuensche.set(`${ort.beziehung}|${schluessel}`, wunsch);
            if (schluessel !== ort.schluessel) weiterleitungen += 1;
        } else if (bisher.rolle !== "ort" && wunsch.rolle === "ort") {
            wuensche.set(`${ort.beziehung}|${schluessel}`, { ...bisher, rolle: "ort", grund: null });
        }
    }
    return { wuensche: [...wuensche.values()], weiterleitungen };
}

/** Wie viele Wünsche je Rolle das Wiki nennt. */
export function zaehleRollen(wuensche: readonly LoreWunsch[]): Record<string, number> {
    const aus: Record<string, number> = {};
    for (const wunsch of wuensche) aus[wunsch.rolle] = (aus[wunsch.rolle] ?? 0) + 1;
    return aus;
}

const wunschWert = (wunsch: LoreWunsch): LoreOrtWert => ({
    titel: kuerze(wunsch.titel, 300),
    rolle: wunsch.rolle,
    schluessel: wunsch.schluessel,
});
const zeilenWert = (zeile: LoreZeile): LoreOrtWert => ({
    titel: zeile.titel ?? zeile.schluessel ?? "",
    rolle: rolleDerZeile(zeile),
    schluessel: zeile.schluessel ?? "",
});

const wirkungVon = (eigentuemer: WikisyncEigentuemer): WikisyncWirkung =>
    eigentuemer === "wiki" ? "uebernommen" : eigentuemer === "manual" ? "eigen" : "befund";

/** Wem die Zeile gehört: der Redaktion samt ihrer Liste, sonst nach ihrer Herkunft. */
function eigentuemerVon(zeile: LoreZeile, bestand: LoreBestand, bereichBeiLegacy: boolean): WikisyncEigentuemer {
    if (bestand.redaktion || zeile.herkunft === "manual") return "manual";
    if (zeile.herkunft === "unbekannt") return "unbekannt";
    return bereichBeiLegacy ? "legacy" : "wiki";
}

/**
 * Die Ortszeilen eines Eintrags gegen die Wünsche des Artikels: je Ort, an dem etwas zu sagen ist, eine Entscheidung (in der Reihenfolge des Artikels, die nicht mehr genannten danach). Ein Ort,
 * der schon stimmt, ergibt nichts. `relationen` sind die Beziehungen, die die Art des Eintrags aus dem Wiki liest: Zeilen anderer Beziehungen sieht der Abgleich nicht.
 */
export function planeOrtszeilen(
    wuensche: readonly LoreWunsch[],
    bestand: LoreBestand,
    relationen: readonly string[],
    bereichBeiLegacy: boolean,
): { entscheidungen: LoreOrtEntscheidung[]; zahlen: Pick<LoreOrtZahlen, "gleich" | "angelegt" | "stillgelegt"> } {
    const aus: LoreOrtEntscheidung[] = [];
    const zahlen = { gleich: 0, angelegt: 0, stillgelegt: 0 };
    const zeilen = bestand.zeilen.filter((zeile) => relationen.includes(zeile.beziehung));
    const verbraucht = new Set<string>();
    const nach = (beziehung: string, schluessel: string): LoreZeile | undefined =>
        zeilen.find((zeile) => zeile.beziehung === beziehung && zeile.schluessel === schluessel);

    const sage = (
        wunsch: LoreWunsch | null,
        alt: LoreOrtWert | null,
        neu: LoreOrtWert | null,
        eigentuemer: WikisyncEigentuemer,
        status: WikisyncStatus,
        grund: string | null,
        wirkung: WikisyncWirkung = wirkungVon(eigentuemer),
        beziehung?: string,
    ): void => {
        const schluessel = (neu ?? alt)?.schluessel ?? "";
        const art = (wunsch?.beziehung ?? beziehung) as VorkommenBeziehung;
        aus.push({
            feld: ortszeilenFeld(art, schluessel),
            beziehung: art,
            alt,
            neu,
            eigentuemer,
            wirkung,
            status,
            grund,
        });
    };
    // Die Rückfrage steht im Grund jeder Zeile mit der Rolle `teil`.
    const mitRolle = (wunsch: LoreWunsch, grund: string | null): string | null => {
        const rolle =
            wunsch.rolle === "ort"
                ? null
                : `${wunsch.rolle === "teil" ? `${RUECKFRAGE}: ` : ""}${wunsch.grund ?? wunsch.rolle}`;
        return [grund, rolle].filter((teil) => teil !== null).join(" · ") || null;
    };

    for (const wunsch of wuensche) {
        const neu = wunschWert(wunsch);
        const da = nach(wunsch.beziehung, wunsch.schluessel);
        if (da !== undefined) {
            verbraucht.add(da.id);
            if (da.zustand === "suppressed") {
                sage(wunsch, null, neu, "unterdrueckt", "unterdrueckt", GRUND_TOMBSTONE, "befund");
                continue;
            }
            if (da.zustand === "retired") {
                if (da.stillVon === "wikisync" && !bestand.redaktion) {
                    if (bereichBeiLegacy) {
                        sage(wunsch, null, neu, "legacy", "neu", GRUND_NEU_VORSCHAU, "befund");
                    } else {
                        zahlen.angelegt += 1;
                        sage(wunsch, null, neu, "wiki", "neu", mitRolle(wunsch, GRUND_WIEDER));
                    }
                } else if (bestand.redaktion) {
                    sage(wunsch, null, neu, "manual", "neu", GRUND_REDAKTION);
                } else if (da.stillVon === "editor") {
                    sage(wunsch, null, neu, "unterdrueckt", "unterdrueckt", GRUND_GELOEST, "befund");
                } else {
                    sage(wunsch, null, neu, "unbekannt", "neu", GRUND_IMPORT_GELOEST, "befund");
                }
                continue;
            }
            // Eine aktive Zeile: gleich, wenn auch die Rolle stimmt.
            if (rolleDerZeile(da) === wunsch.rolle) {
                zahlen.gleich += 1;
                continue;
            }
            const eigentuemer = eigentuemerVon(da, bestand, bereichBeiLegacy);
            // Eine manuelle Zeile in einem Eintrag, der nicht der Redaktion gehört, sieht der Abgleich nicht (Legacy: „manual rows are invisible“).
            if (eigentuemer === "manual" && !bestand.redaktion) continue;
            sage(
                wunsch,
                zeilenWert(da),
                neu,
                eigentuemer,
                "geaendert",
                mitRolle(
                    wunsch,
                    bestand.redaktion ? GRUND_REDAKTION : eigentuemer === "unbekannt" ? GRUND_UNBELEGT : GRUND_ROLLE,
                ),
            );
            continue;
        }
        // Keine Zeile unter dem Schlüssel von heute: vielleicht führt Legacy sie unter dem Schlüssel des Links, der über eine Weiterleitung auf diesen Artikel zeigt.
        const alte =
            wunsch.urschluessel === wunsch.schluessel ? undefined : nach(wunsch.beziehung, wunsch.urschluessel);
        if (alte !== undefined) {
            verbraucht.add(alte.id);
            if (alte.zustand === "active") {
                const eigentuemer = eigentuemerVon(alte, bestand, bereichBeiLegacy);
                if (eigentuemer === "manual" && !bestand.redaktion) continue;
                if (eigentuemer === "wiki") {
                    zahlen.angelegt += 1;
                    zahlen.stillgelegt += 1;
                    sage(wunsch, zeilenWert(alte), neu, "wiki", "geaendert", mitRolle(wunsch, GRUND_ERSETZT));
                } else {
                    sage(
                        wunsch,
                        zeilenWert(alte),
                        neu,
                        eigentuemer,
                        "geaendert",
                        bestand.redaktion ? GRUND_REDAKTION : GRUND_ERSETZT_UNBELEGT,
                        eigentuemer === "manual" ? "eigen" : "befund",
                    );
                }
                continue;
            }
            if (alte.zustand === "suppressed") {
                sage(wunsch, null, neu, "unterdrueckt", "unterdrueckt", GRUND_TOMBSTONE, "befund");
                continue;
            }
            // Eine still gelegte Zeile unter dem alten Schlüssel ändert nichts: Der Ort gilt als neu.
        }
        if (bestand.redaktion) {
            sage(wunsch, null, neu, "manual", "neu", GRUND_REDAKTION);
            continue;
        }
        if (bereichBeiLegacy) {
            sage(wunsch, null, neu, "legacy", "neu", GRUND_NEU_VORSCHAU, "befund");
            continue;
        }
        zahlen.angelegt += 1;
        sage(wunsch, null, neu, "wiki", "neu", mitRolle(wunsch, GRUND_NEU));
    }

    // Was das Wiki nicht mehr nennt: nur eine aktive Zeile, die keinem Wunsch (auch nicht über einen alten Schlüssel) zugeordnet ist.
    for (const rest of zeilen) {
        if (rest.zustand !== "active" || verbraucht.has(rest.id)) continue;
        const eigentuemer = eigentuemerVon(rest, bestand, bereichBeiLegacy);
        // Eine Zeile der Redaktion in einem fremden Eintrag sieht der Abgleich nicht, und ein ungeklärter Name hat keinen Schlüssel.
        if ((eigentuemer === "manual" && !bestand.redaktion) || rest.schluessel === null) continue;
        const stilllegen = eigentuemer === "wiki";
        if (stilllegen) zahlen.stillgelegt += 1;
        sage(
            null,
            zeilenWert(rest),
            null,
            eigentuemer,
            "zu_entfernen",
            bestand.redaktion
                ? GRUND_REDAKTION
                : stilllegen
                  ? GRUND_NICHT_MEHR
                  : eigentuemer === "legacy"
                    ? GRUND_NICHT_MEHR_VORSCHAU
                    : GRUND_NICHT_MEHR_UNBELEGT,
            wirkungVon(eigentuemer),
            rest.beziehung,
        );
    }
    return { entscheidungen: aus, zahlen };
}

/** Die Beziehungen, die die Art eines Eintrags aus dem Wiki liest (Legacy `AVESMAPS_LORE_PLACE_FIELDS`). */
export function relationenDerArt(art: string): readonly VorkommenBeziehung[] {
    switch (art) {
        case "spezies":
            return ["regionen"];
        case "ware":
            return ["herkunft", "verbreitung"];
        case "fauna":
        case "flora":
            return ["verbreitung"];
        default:
            return [];
    }
}
