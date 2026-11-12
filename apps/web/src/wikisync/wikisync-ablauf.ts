import {
    WIKISYNC_BEREICHE,
    wikisyncHatKategorien,
    type WikisyncAuftrag,
    type WikisyncAuftragsart,
    type WikisyncBereich,
    type WikisyncBereichStand,
    type WikisyncBereiche,
    type WikisyncStand,
    type WikisyncUebernahmeKurz,
} from "@avesmaps3d/shared";
import { formatList, t } from "../i18n/i18n";
import { anzahl, auftragVon, bereichName, dauerText, datumText, zahl, zeitpunkt } from "./wikisync-text";

/**
 * Der Ablauf von „WikiSync starten“ (WI-0253 §20, Variante A; Entwurf `review/wi-0253/wikisync-ablauf-mockup.html`, Vali 2026-10-26: „ich finde den workflow etwas kompliziert“), ohne Vue: was jede
 * Zeile der Tafel im Plan, im Lauf und danach sagt und wo der Lauf steht.
 *
 * - **Nichts wird geschätzt.** Der Ablauf einer Zeile ist aus dem abgeleitet, was die Oberfläche ohnehin liest: die laufenden Aufträge (mit den Bereichen, für die sie arbeiten), die jüngste Vorschau
 *   mit der Kategorien-Datei, die sie gelesen hat, das Protokoll der letzten Übernahme je Bereich.
 * - **Zwei Schritte je Zeile (WI-0294):** Dump (die Vorschau liest den Dump und, für Orte, Herrschaftsgebiete und Derographie, die Kategorien-Datei daneben) und Übernahme. Einen Wiki-Teil im 20-Sekunden-Takt
 *   gibt es nicht mehr. Fehlt die Kategorien-Datei, steht die Übernahme dieser Bereiche aus; die übrigen laufen normal.
 * - **Zum Lauf gehört ein Bereich,** wenn ein laufender Auftrag für ihn arbeitet, oder wenn die jüngste Vorschau ihn übernommen hat oder seine Übernahme wegen der fehlenden Kategorien-Datei aussteht.
 *   Die jüngste Vorschau ist die Klammer: Was zu einer älteren gehört, ist ein früherer Lauf und steht nur im Laufbericht.
 * - **Ein Bereich ohne angeschlossene Übernahme** ist kein Teil des Laufs: Die Vorschau rechnet ihn mit, übernommen wird er nie.
 */

/** Die Aufträge, die zu einem Lauf gehören: solange einer wartet oder läuft, läuft „WikiSync“. */
export const LAUF_AUFTRAGSARTEN: readonly WikisyncAuftragsart[] = [
    "wiki_vorschau",
    "wiki_uebernehmen",
    "wiki_zuruecknehmen",
];

/** Ab so vielen Tagen Abstand zwischen dem Stand des Dumps und dem der Kategorien-Datei steht ein Hinweis da (kein Halt, keine Sperre). */
export const KATEGORIEN_ABSTAND_TAGE = 14;

/** Was die Seite für den Ablauf braucht, aus ihren Lesewegen. */
export interface AblaufDaten {
    stand: WikisyncStand;
    bereiche: WikisyncBereiche;
}

export type SchrittStatus = "wartet" | "laeuft" | "fertig" | "fehler";
export type SchrittArt = "dump" | "uebernahme";

export interface Schritt {
    art: SchrittArt;
    status: SchrittStatus;
    /** Der Satz hinter dem Zeichen, schon in der Sprache der Seite. */
    text: string;
}

/** Wartet oder läuft ein Auftrag, der zu einem Lauf gehört? */
export function laufAktiv(daten: AblaufDaten): boolean {
    return daten.stand.auftraege.some((auftrag) => LAUF_AUFTRAGSARTEN.includes(auftrag.art));
}

/** Die Stände der Bereiche, wie sie die Seite führt. */
const standVon = (daten: AblaufDaten, bereich: WikisyncBereich): WikisyncBereichStand | undefined =>
    daten.bereiche.bereiche.find((stand) => stand.bereich === bereich);

/** Die Übernahme eines Bereichs aus der jüngsten Vorschau, wenn die jüngste Übernahme des Bereichs aus ihr stammt. */
function uebernahmeAusVorschau(daten: AblaufDaten, bereich: WikisyncBereich): WikisyncUebernahmeKurz | undefined {
    const vorschau = daten.stand.vorschau;
    const letzte = standVon(daten, bereich)?.letzteUebernahme ?? null;
    return vorschau !== null && letzte !== null && letzte.lauf === vorschau.id ? letzte : undefined;
}

/** Arbeitet ein wartender oder laufender Auftrag dieser Arten für den Bereich? */
function auftragFuer(
    daten: AblaufDaten,
    bereich: WikisyncBereich,
    ...arten: WikisyncAuftragsart[]
): WikisyncAuftrag | undefined {
    return daten.stand.auftraege.find(
        (auftrag) => arten.includes(auftrag.art) && auftrag.bereiche?.includes(bereich) === true,
    );
}

/**
 * Steht die Übernahme des Bereichs aus, weil die jüngste (fertige) Vorschau ihn gerechnet, aber keine Kategorien-Datei gelesen hat? Das trifft nur die Bereiche mit Kategorien
 * (Orte, Herrschaftsgebiete, Derographie); der Server reiht ihre Übernahme dann nicht ein (`folge.ausstehend`).
 */
function kategorienAusstehend(daten: AblaufDaten, bereich: WikisyncBereich): boolean {
    const vorschau = daten.stand.vorschau;
    return (
        vorschau !== null &&
        vorschau.status === "fertig" &&
        vorschau.kategorien === null &&
        vorschau.bereiche.includes(bereich) &&
        wikisyncHatKategorien(bereich)
    );
}

/** Gehört der Bereich zum Lauf, der gerade läuft oder zuletzt lief? */
export function bereichImLauf(daten: AblaufDaten, bereich: WikisyncBereich): boolean {
    if (auftragFuer(daten, bereich, ...LAUF_AUFTRAGSARTEN) !== undefined) return true;
    if (daten.stand.vorschau === null) return false;
    return uebernahmeAusVorschau(daten, bereich) !== undefined || kategorienAusstehend(daten, bereich);
}

/** Die Bereiche, die zum Lauf gehören, in der Reihenfolge des Katalogs. */
export function bereicheImLauf(daten: AblaufDaten): WikisyncBereich[] {
    return WIKISYNC_BEREICHE.filter((bereich) => bereichImLauf(daten, bereich));
}

// ── Die Schritte einer Zeile ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Der Schritt „Übernahme“ eines Bereichs im Lauf. */
function uebernahmeSchritt(daten: AblaufDaten, bereich: WikisyncBereich): Schritt {
    const u = uebernahmeAusVorschau(daten, bereich);
    if (u !== undefined) {
        if (u.art === "zuruecknahme") {
            return { art: "uebernahme", status: "fertig", text: t("admin.wikisync.tafel.schritt.zurueck") };
        }
        switch (u.status) {
            case "fertig":
                return {
                    art: "uebernahme",
                    status: "fertig",
                    text: t(
                        u.felder > 0
                            ? "admin.wikisync.tafel.schritt.uebernahme"
                            : "admin.wikisync.tafel.schritt.nichtsZuUebernehmen",
                    ),
                };
            case "laeuft":
                return {
                    art: "uebernahme",
                    status: "laeuft",
                    text: t("admin.wikisync.tafel.schritt.uebernahmeLaeuft"),
                };
            case "abgebrochen":
                // Der Legacy-Zug hielt die Karte erst nach dem Start an: Nichts ist geschrieben, der Auftrag wartet und übernimmt danach von vorn (kein Fehler).
                if (auftragFuer(daten, bereich, "wiki_uebernehmen") !== undefined) break;
                return {
                    art: "uebernahme",
                    status: "fehler",
                    text: t("admin.wikisync.tafel.schritt.uebernahmeGescheitert", { grund: u.grund ?? "—" }),
                };
            case "abgelehnt":
                return {
                    art: "uebernahme",
                    status: "fehler",
                    text: t("admin.wikisync.tafel.schritt.uebernahmeAbgelehnt", { grund: u.grund ?? "—" }),
                };
            case "fehlgeschlagen":
                return {
                    art: "uebernahme",
                    status: "fehler",
                    text: t("admin.wikisync.tafel.schritt.uebernahmeGescheitert", { grund: u.grund ?? "—" }),
                };
        }
    }
    const auftrag = auftragFuer(daten, bereich, "wiki_uebernehmen");
    if (auftrag !== undefined) {
        if (auftrag.zustand === "RUNNING") {
            return { art: "uebernahme", status: "laeuft", text: t("admin.wikisync.tafel.schritt.uebernahmeLaeuft") };
        }
        return {
            art: "uebernahme",
            status: "wartet",
            text: t(
                auftrag.wartetAuf === "legacy_zug"
                    ? "admin.wikisync.tafel.schritt.uebernahmeWartetLegacy"
                    : "admin.wikisync.tafel.schritt.uebernahmeWartet",
            ),
        };
    }
    if (kategorienAusstehend(daten, bereich)) {
        return { art: "uebernahme", status: "wartet", text: t("admin.wikisync.tafel.schritt.kategorienFehlen") };
    }
    return { art: "uebernahme", status: "wartet", text: t("admin.wikisync.tafel.schritt.uebernahmeWartet") };
}

/** Der Plan einer gewählten Zeile, bevor etwas läuft: beide Schritte warten; liegt für einen Bereich mit Kategorien keine Kategorien-Datei im Ordner, sagt die Übernahme das. */
export function planSchritte(daten: AblaufDaten, bereich: WikisyncBereich): Schritt[] {
    const ohneDatei = wikisyncHatKategorien(bereich) && daten.stand.kategorienDatei.datei === null;
    return [
        { art: "dump", status: "wartet", text: t("admin.wikisync.tafel.schritt.dump") },
        {
            art: "uebernahme",
            status: "wartet",
            text: t(
                ohneDatei
                    ? "admin.wikisync.tafel.schritt.kategorienFehlen"
                    : "admin.wikisync.tafel.schritt.uebernahmePlan",
            ),
        },
    ];
}

/** Die Schritte einer Zeile im Lauf (oder danach). */
export function laufSchritte(daten: AblaufDaten, bereich: WikisyncBereich): Schritt[] {
    const vorschauJob = auftragFuer(daten, bereich, "wiki_vorschau");
    const dump: Schritt =
        vorschauJob === undefined
            ? { art: "dump", status: "fertig", text: t("admin.wikisync.tafel.schritt.dump") }
            : {
                  art: "dump",
                  status: vorschauJob.zustand === "RUNNING" ? "laeuft" : "wartet",
                  text: t("admin.wikisync.tafel.schritt.dump"),
              };
    return [dump, uebernahmeSchritt(daten, bereich)];
}

// ── Letzte Übernahme ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Die Spalte „Letzte Übernahme“: oben der Zeitpunkt, darunter, was sie tat. */
export function standSpalte(stand: WikisyncBereichStand | undefined, jetzt: Date): { oben: string; unten: string } {
    const u = stand?.letzteUebernahme ?? null;
    if (u === null) return { oben: "—", unten: t("admin.wikisync.tafel.stand.keine") };
    const wann = zeitpunkt(u.beendetAm ?? u.gestartetAm, jetzt);
    if (u.art === "zuruecknahme") return { oben: wann, unten: t("admin.wikisync.laufbericht.zurueckgenommen") };
    if (u.status === "fertig") {
        return {
            oben: wann,
            unten: u.zurueckgenommen
                ? t("admin.wikisync.laufbericht.zurueckgenommen")
                : t("admin.wikisync.start.uebernommen", { felder: anzahl.felder(u.felder) }),
        };
    }
    return { oben: wann, unten: t(`admin.wikisync.laufbericht.status.${u.status}`) };
}

// ── Wo steht der Lauf? ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type LaufPhase = "bereit" | "dump" | "uebernahme" | "wartet" | "fertig";

export interface LaufLage {
    phase: LaufPhase;
    /** Der Satz zur Lage; `null`: Es gibt nichts zu sagen (bereit). */
    satz: string | null;
    /** Ein leiser Zusatz zum Satz. */
    leise: string | null;
    ton: "leise" | "warnung" | "fehler" | "gut";
}

/** Die Übernahmen, die zur jüngsten Vorschau gehören und etwas geschrieben haben (und nicht zurückgenommen sind). */
function uebernahmenDesLaufs(daten: AblaufDaten): WikisyncUebernahmeKurz[] {
    return daten.bereiche.bereiche.flatMap((stand) => {
        const u = uebernahmeAusVorschau(daten, stand.bereich);
        return u !== undefined && u.art === "uebernahme" && u.status === "fertig" ? [u] : [];
    });
}

export function laufLage(daten: AblaufDaten, jetzt: Date): LaufLage {
    const vorschauJob = auftragVon(daten.stand, "wiki_vorschau");
    if (vorschauJob !== undefined) {
        return vorschauJob.zustand === "RUNNING"
            ? { phase: "dump", satz: t("admin.wikisync.tafel.fuss.dumpWirdGelesen"), leise: leiseLauf(), ton: "leise" }
            : { phase: "wartet", satz: t("admin.wikisync.auftrag.wartet"), leise: null, ton: "leise" };
    }
    const uebernahmen = daten.stand.auftraege.filter((auftrag) => auftrag.art === "wiki_uebernehmen");
    if (uebernahmen.length > 0) {
        if (uebernahmen.some((auftrag) => auftrag.zustand === "RUNNING")) {
            return {
                phase: "uebernahme",
                satz: t("admin.wikisync.tafel.fuss.uebernahmeLaeuft"),
                leise: leiseLauf(),
                ton: "leise",
            };
        }
        return {
            phase: "wartet",
            satz: t(
                uebernahmen.some((auftrag) => auftrag.wartetAuf === "legacy_zug")
                    ? "admin.wikisync.auftrag.wartetLegacyZug"
                    : "admin.wikisync.auftrag.wartet",
            ),
            leise: leiseLauf(),
            ton: "warnung",
        };
    }
    if (auftragVon(daten.stand, "wiki_zuruecknehmen") !== undefined) {
        return { phase: "uebernahme", satz: t("admin.wikisync.start.ruecknahmeLaeuft"), leise: null, ton: "leise" };
    }
    const vorschau = daten.stand.vorschau;
    if (vorschau !== null && vorschau.status === "fehlgeschlagen") {
        return {
            phase: "bereit",
            satz: [
                t("admin.wikisync.vorschau.gescheitert", {
                    zeit: zeitpunkt(vorschau.beendetAm ?? vorschau.gestartetAm, jetzt),
                }),
                ...(vorschau.fehler === null ? [] : [vorschau.fehler]),
            ].join(" · "),
            leise: null,
            ton: "fehler",
        };
    }
    const geschrieben = uebernahmenDesLaufs(daten);
    if (geschrieben.length > 0 || bereicheImLauf(daten).length > 0) {
        const felder = geschrieben.reduce((summe, u) => summe + u.felder, 0);
        const ende = geschrieben.map((u) => u.beendetAm ?? u.gestartetAm).sort((a, b) => b.localeCompare(a))[0];
        if (ende !== undefined) {
            return {
                phase: "fertig",
                satz: t("admin.wikisync.tafel.fuss.fertig", {
                    zeit: zeitpunkt(ende, jetzt),
                    felder: anzahl.felder(felder),
                }),
                leise: null,
                ton: "gut",
            };
        }
    }
    return { phase: "bereit", satz: null, leise: null, ton: "leise" };
}

const leiseLauf = (): string => t("admin.wikisync.tafel.fuss.laeuftLeise");

// ── Die Quellen: Dump und Kategorien-Datei ────────────────────────────────────────────────────────────────────────────────────────

/** Die Stände der beiden Dateien, aus denen der nächste Lauf liest. */
export interface Quellen {
    /** Der Stand des Dumps (ein Datum oder eine ISO-Zeit); `null`: unbekannt. */
    dumpStand: string | null;
    /** Liegt eine Kategorien-Datei im Dump-Ordner? */
    kategorienDa: boolean;
    /** Der Stand der Kategorien-Datei; `null`: unbekannt (oder keine Datei). */
    kategorienStand: string | null;
}

/**
 * Die Stände von Dump und Kategorien-Datei, wie der nächste Lauf sie liest: der Dump aus dem Ordner (fehlt sein Stand, der der jüngsten Vorschau), die Kategorien-Datei aus dem Ordner. Hat die jüngste Vorschau genau
 * diese Datei schon gelesen, gilt ihr Stand aus der Endzeile der Datei (genauer als das Datum im Namen).
 */
export function quellenStand(daten: AblaufDaten): Quellen {
    const datei = daten.stand.kategorienDatei;
    const gelesen = daten.stand.vorschau?.kategorien ?? null;
    return {
        dumpStand: daten.stand.dump.stand ?? daten.stand.vorschau?.dumpStand ?? null,
        kategorienDa: datei.datei !== null,
        kategorienStand: gelesen !== null && gelesen.datei === datei.datei ? gelesen.stand : datei.stand,
    };
}

/** Der Tag eines Standes als fortlaufende Zahl (UTC); `null`, wenn der Text kein Datum ist. */
function tagVon(stand: string | null): number | null {
    if (stand === null) return null;
    const datum = new Date(/^\d{4}-\d{2}-\d{2}$/u.test(stand) ? `${stand}T00:00:00Z` : stand);
    return Number.isNaN(datum.getTime()) ? null : Math.floor(datum.getTime() / 86_400_000);
}

/** Wie viele Tage (der Betrag) Dump und Kategorien-Datei auseinanderliegen; `null`, solange einer der Stände fehlt oder kein Datum ist. */
export function kategorienAbstandTage(dumpStand: string | null, kategorienStand: string | null): number | null {
    const dump = tagVon(dumpStand);
    const kategorien = tagVon(kategorienStand);
    return dump === null || kategorien === null ? null : Math.abs(dump - kategorien);
}

// ── Plan und Frage vor dem Start ──────────────────────────────────────────────────────────────────────────────────────────────

export interface StartPlan {
    /** Die gewählten Bereiche, die dem WikiSync gehören, in der Reihenfolge des Katalogs. */
    bereiche: WikisyncBereich[];
    /** Davon die mit Kategorien aus der Datei (Orte, Herrschaftsgebiete, Derographie). */
    mitKategorien: WikisyncBereich[];
    /** Die Bereiche mit Kategorien, die warten, weil keine Kategorien-Datei im Ordner liegt (ihre Übernahme steht aus); leer, solange eine Datei liegt. */
    wartend: WikisyncBereich[];
}

export function startPlan(daten: AblaufDaten, gewaehlt: ReadonlySet<WikisyncBereich>): StartPlan {
    const bereiche = WIKISYNC_BEREICHE.filter((bereich) => gewaehlt.has(bereich));
    const mitKategorien = bereiche.filter((bereich) => wikisyncHatKategorien(bereich));
    return { bereiche, mitKategorien, wartend: daten.stand.kategorienDatei.datei === null ? mitKategorien : [] };
}

const namen = (bereiche: readonly WikisyncBereich[]): string => formatList(bereiche.map(bereichName));

/** Die Plan-Zeile im Fuß: Dump, Kategorien, Übernahme („Dump vom … lesen · Kategorien vom … lesen · dann übernehmen“). */
export function planSatz(plan: StartPlan, quellen: Quellen): string {
    const teile = [
        quellen.dumpStand === null
            ? t("admin.wikisync.tafel.fuss.dumpLesenOhneStand")
            : t("admin.wikisync.tafel.fuss.dumpLesen", { datum: datumText(quellen.dumpStand) }),
    ];
    if (plan.mitKategorien.length > 0 && plan.wartend.length === 0) {
        teile.push(
            quellen.kategorienStand === null
                ? t("admin.wikisync.tafel.fuss.kategorienLesenOhneStand")
                : t("admin.wikisync.tafel.fuss.kategorienLesen", { datum: datumText(quellen.kategorienStand) }),
        );
    }
    teile.push(t("admin.wikisync.tafel.fuss.dannUebernehmen"));
    return teile.join(" · ");
}

/**
 * Die Hinweise unter der Plan-Zeile (kein Halt, der Knopf bleibt frei): Fehlt die Kategorien-Datei, warten die gewählten Bereiche mit Kategorien; liegen Dump und Kategorien-Datei mehr als
 * `KATEGORIEN_ABSTAND_TAGE` Tage auseinander, steht das da.
 */
export function planHinweise(plan: StartPlan, quellen: Quellen): string[] {
    if (plan.wartend.length > 0)
        return [t("admin.wikisync.tafel.fuss.kategorienFehlen", { bereiche: namen(plan.wartend) })];
    if (plan.mitKategorien.length === 0) return [];
    const tage = kategorienAbstandTage(quellen.dumpStand, quellen.kategorienStand);
    return tage !== null && tage > KATEGORIEN_ABSTAND_TAGE
        ? [t("admin.wikisync.tafel.fuss.abstand", { n: zahl(tage) })]
        : [];
}

/** Der Satz der Rückfrage vor dem Start; er sagt, was geschieht, bevor die Vorschau gesehen ist. */
export function frageSatz(plan: StartPlan, quellen: Quellen, umgebung: string): string {
    const saetze = [
        quellen.dumpStand === null
            ? t("admin.wikisync.tafel.frage.dumpOhneStand")
            : t("admin.wikisync.tafel.frage.dump", { datum: datumText(quellen.dumpStand) }),
    ];
    if (plan.wartend.length > 0) {
        saetze.push(t("admin.wikisync.tafel.frage.kategorienFehlen", { bereiche: namen(plan.wartend) }));
    } else if (plan.mitKategorien.length > 0) {
        saetze.push(t("admin.wikisync.tafel.frage.kategorien", { bereiche: namen(plan.mitKategorien) }));
    }
    const uebernahme = plan.bereiche.filter((bereich) => !plan.wartend.includes(bereich));
    if (uebernahme.length > 0) {
        saetze.push(t("admin.wikisync.tafel.frage.uebernahme", { bereiche: namen(uebernahme), umgebung }));
    }
    return saetze.join(" ");
}

// ── Der Laufbericht ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LaufBilanz {
    /** Die Felder, die die Übernahmen des Laufs geschrieben haben (ohne die zurückgenommenen). */
    felder: number;
    /** Die Felder, die schon dem Wiki glichen; `null`, solange eine der Übernahmen die Zahl nicht führt. */
    gleich: number | null;
    befunde: number;
    /** Der Stand des Dumps, aus dem gelesen wurde. */
    dumpStand: string | null;
    /** Der Stand der Kategorien-Datei, die die Vorschau gelesen hat (aus ihrer Endzeile); `null`: keine gelesen. */
    kategorienStand: string | null;
    /** Wie lange der Lauf dauerte, in Sekunden: von der Vorschau bis zur letzten Übernahme; `null`, wenn er noch läuft oder nichts übernahm. */
    dauerSekunden: number | null;
}

/** Die Bilanz des jüngsten Laufs (der jüngsten Vorschau); `null`, solange keine Übernahme aus ihr vorliegt. */
export function laufBilanz(daten: AblaufDaten): LaufBilanz | null {
    const vorschau = daten.stand.vorschau;
    if (vorschau === null) return null;
    const uebernahmen = daten.bereiche.bereiche.flatMap((stand) => {
        const u = uebernahmeAusVorschau(daten, stand.bereich);
        return u !== undefined && u.art === "uebernahme" && u.status === "fertig" ? [u] : [];
    });
    if (uebernahmen.length === 0) return null;
    const gleich = uebernahmen.every((u) => u.gleich !== undefined)
        ? uebernahmen.reduce((summe, u) => summe + (u.gleich ?? 0), 0)
        : null;
    const ende = uebernahmen.map((u) => Date.parse(u.beendetAm ?? u.gestartetAm)).sort((a, b) => b - a)[0];
    const anfang = Date.parse(vorschau.gestartetAm);
    return {
        felder: uebernahmen.filter((u) => !u.zurueckgenommen).reduce((summe, u) => summe + u.felder, 0),
        gleich,
        befunde: uebernahmen.reduce((summe, u) => summe + u.befunde, 0),
        dumpStand: vorschau.dumpStand,
        kategorienStand: vorschau.kategorien?.stand ?? null,
        dauerSekunden:
            ende === undefined || Number.isNaN(ende) || Number.isNaN(anfang) || laufAktiv(daten)
                ? null
                : Math.max(0, Math.round((ende - anfang) / 1000)),
    };
}

/** Die Zahlen eines Bereichs im Laufbericht: übernommen, unverändert (wenn bekannt), Befunde, und woher die Kategorien stammen. */
export function berichtZeile(daten: AblaufDaten, stand: WikisyncBereichStand, jetzt: Date): string | null {
    const u = stand.letzteUebernahme;
    if (u === null) return null;
    if (u.art === "zuruecknahme") {
        return t("admin.wikisync.laufbericht.zurueckgenommenAm", {
            zeit: zeitpunkt(u.beendetAm ?? u.gestartetAm, jetzt),
        });
    }
    const teile: string[] = [];
    if (u.status === "fertig") {
        teile.push(t("admin.wikisync.laufbericht.uebernommen", { felder: anzahl.felder(u.felder) }));
        if (u.gleich !== undefined) teile.push(t("admin.wikisync.laufbericht.unveraendert", { n: zahl(u.gleich) }));
        // Die Quellen legen an und legen still (WI-0253 §21): Die Zahlen stehen dabei.
        if ((u.angelegt ?? 0) > 0) teile.push(t("admin.wikisync.laufbericht.angelegt", { n: zahl(u.angelegt ?? 0) }));
        if ((u.stillgelegt ?? 0) > 0)
            teile.push(t("admin.wikisync.laufbericht.stillgelegt", { n: zahl(u.stillgelegt ?? 0) }));
        if ((u.quellenAngelegt ?? 0) > 0)
            teile.push(t("admin.wikisync.laufbericht.quellenAngelegt", { n: zahl(u.quellenAngelegt ?? 0) }));
        teile.push(anzahl.befunde(u.befunde));
        if (u.zurueckgenommen) teile.push(t("admin.wikisync.laufbericht.zurueckgenommen"));
        // Woher die Kategorien stammen, steht nur dort, wo die Übernahme aus der jüngsten Vorschau stammt (nur dann kennt die Seite die Datei, die sie las).
        if (uebernahmeAusVorschau(daten, stand.bereich) !== undefined) {
            const kategorien = daten.stand.vorschau?.kategorien ?? null;
            if (wikisyncHatKategorien(stand.bereich)) {
                if (kategorien !== null) {
                    teile.push(t("admin.wikisync.laufbericht.kategorienVom", { datum: datumText(kategorien.stand) }));
                }
            } else {
                teile.push(t("admin.wikisync.laufbericht.nurDump"));
            }
        }
        return teile.join(" · ");
    }
    teile.push(t(`admin.wikisync.laufbericht.status.${u.status}`));
    if (u.grund !== null) teile.push(u.grund);
    return teile.join(" · ");
}

/** Die Herkunft der Summe im Laufbericht: Dump (mit Stand), Kategorien (mit Stand, wenn die Vorschau eine Datei gelesen hat) und Dauer. */
export function herkunftSatz(bilanz: LaufBilanz): string {
    return [
        bilanz.dumpStand === null
            ? t("admin.wikisync.tafel.schritt.dump")
            : t("admin.wikisync.laufbericht.dumpVom", { datum: datumText(bilanz.dumpStand) }),
        ...(bilanz.kategorienStand === null
            ? []
            : [t("admin.wikisync.laufbericht.kategorienVom", { datum: datumText(bilanz.kategorienStand) })]),
        ...(bilanz.dauerSekunden === null
            ? []
            : [t("admin.wikisync.laufbericht.dauer", { dauer: dauerText(bilanz.dauerSekunden) })]),
    ].join(" · ");
}
