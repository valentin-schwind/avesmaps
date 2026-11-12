import {
    WIKI_DUMP_HOLEN_ART,
    WIKI_DUMP_PLAN,
    type KanonObjektart,
    type WikisyncAbruf,
    type WikisyncAuftrag,
    type WikisyncArtikelVergleich,
    type WikisyncAuftragsart,
    type WikisyncBereich,
    type WikisyncEigentuemer,
    type WikisyncStand,
    type WikisyncStatus,
    type WikisyncWertZustand,
    type WikisyncWirkung,
} from "@avesmaps3d/shared";
import { NUMBER_LOCALE, formatNumber, isMessageKey, locale, t, tPlural, type MessageKey } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";

/**
 * Die Sätze und Zustände des Reiters „WikiSync“ (WI-0253 UI-1, UI-2), ohne Vue: Was eine Zeile in ihrer Unterzeile sagt, welcher Kreis dazu gehört,
 * warum ein Knopf gesperrt ist. Die Wörter stammen aus dem abgenommenen Mockup (`review/wi-0253/wikisync-mockup.html`), die Zahlen aus den Lesewegen;
 * nichts wird geschätzt oder vorgetäuscht: Was unbekannt ist, steht als unbekannt da (Work Item §4 A).
 */

export type Kreis = "leer" | "halb" | "halb-rechts" | "voll";
export type Ton = "leise" | "gut" | "warnung" | "fehler";

export interface Lage {
    kreis: Kreis;
    unter: string;
    ton: Ton;
}

/** Die Kreise der Lage, wie in jeder Liste von leer nach voll. */
export const KREIS_LEGENDE: readonly Kreis[] = ["leer", "halb", "voll"];

export const zahl = (n: number): string => formatNumber(n, 0);

/**
 * Die Aufschrift des Knopfes unter einer Liste, die in Seiten nachlädt (Regelvorschläge, Dump-Bericht, Begriffstafel). Vali 2026-10-27: „Weitere 1.307 laden“ stand da, geladen wurden aber nur 100. Der Text nennt
 * jetzt, was der Klick wirklich lädt, und was danach noch aussteht („100 weitere laden · noch 1.307“); auf der letzten Seite steht, wie viele es noch sind („Letzte 7 laden“). Die Wortform wählt `tPlural`.
 */
export function weitereLadenText(geladen: number, gesamt: number, seite: number): string {
    const rest = Math.max(gesamt - geladen, 0);
    if (rest <= seite) return tPlural("admin.wikisync.bericht.letzte", rest, { n: zahl(rest) });
    return tPlural("admin.wikisync.bericht.mehr", seite, { n: zahl(seite), rest: zahl(rest) });
}

export function kreisName(kreis: Kreis): string {
    return t(`admin.wikisync.kreis.${kreis}`);
}

export function bereichName(bereich: WikisyncBereich): string {
    return t(`admin.wikisync.bereich.${bereich}`);
}

export function artName(art: KanonObjektart): string {
    return t(`admin.wikisync.art.${art}`);
}

export function umgebungKurz(umgebung: string | undefined): string {
    const key = `admin.wikisync.umgebung.kurz.${umgebung ?? ""}`;
    return isMessageKey(key) ? t(key) : (umgebung ?? "");
}

/** Ein Stand des Dumps („2026-10-01“ oder eine ISO-Zeit) als Datum der Sprache; ein unlesbarer Text bleibt, wie er ist. */
export function datumText(wert: string): string {
    const nurTag = /^\d{4}-\d{2}-\d{2}$/u.test(wert);
    const datum = new Date(nurTag ? `${wert}T12:00:00` : wert);
    if (Number.isNaN(datum.getTime())) return wert;
    return new Intl.DateTimeFormat(NUMBER_LOCALE[locale.value], {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    }).format(datum);
}

export function zeitpunkt(iso: string, jetzt: Date): string {
    return relativeTime(new Date(iso), jetzt, locale.value, "zeitpunkt");
}

export function prozent(anteil: number | null): number | null {
    return anteil === null ? null : Math.round(Math.min(1, Math.max(0, anteil)) * 100);
}

export function dauerText(sekunden: number): string {
    const minuten = Math.floor(sekunden / 60);
    const rest = Math.round(sekunden % 60);
    if (minuten === 0) return t("admin.wikisync.dauer.sek", { s: rest });
    return rest === 0
        ? t("admin.wikisync.dauer.min", { m: minuten })
        : t("admin.wikisync.dauer.minSek", { m: minuten, s: rest });
}

export const anzahl = {
    aenderungen: (n: number): string => tPlural("admin.wikisync.n.aenderungen", n, { n: zahl(n) }),
    befunde: (n: number): string => tPlural("admin.wikisync.n.befunde", n, { n: zahl(n) }),
    objekte: (n: number): string => tPlural("admin.wikisync.n.objekte", n, { n: zahl(n) }),
    felder: (n: number): string => tPlural("admin.wikisync.n.felder", n, { n: zahl(n) }),
    seiten: (n: number): string => tPlural("admin.wikisync.n.seiten", n, { n: zahl(n) }),
    zeilen: (n: number): string => tPlural("admin.wikisync.n.zeilen", n, { n: zahl(n) }),
    vorschlaege: (n: number): string => tPlural("admin.wikisync.n.vorschlaege", n, { n: zahl(n) }),
    flaechen: (n: number): string => tPlural("admin.wikisync.n.flaechen", n, { n: zahl(n) }),
};

/** Der erste Auftrag dieser Arten, der wartet oder läuft. */
export function auftragVon(stand: WikisyncStand | null, ...arten: WikisyncAuftragsart[]): WikisyncAuftrag | undefined {
    return stand?.auftraege.find((auftrag) => arten.includes(auftrag.art));
}

/**
 * Warum ein Knopf nicht geht, weil schon ein Auftrag seiner Art wartet oder läuft: `satz` (etwa „Eine Übernahme … wartet schon oder läuft.“), oder, wartet dieser Auftrag hinter einem
 * Legacy-Zug, eben das. Ein Warten hinter dem Zug ist kein Fehler.
 */
export function laeuftSchonSatz(auftrag: WikisyncAuftrag, satz: MessageKey): string {
    return t(
        auftrag.zustand === "QUEUED" && auftrag.wartetAuf === "legacy_zug"
            ? "admin.wikisync.auftrag.wartetLegacyZug"
            : satz,
    );
}

/** Warum ein wartender Auftrag wartet, als Satz: auf die Abholung durch den Server, hinter dem Legacy-Zug, sonst in der Warteschlange. */
function wartesatz(auftrag: WikisyncAuftrag): string {
    if (auftrag.wartetAuf === "abholung") return t("admin.wikisync.auftrag.wartetAbholung");
    return t(
        auftrag.wartetAuf === "legacy_zug" ? "admin.wikisync.auftrag.wartetLegacyZug" : "admin.wikisync.auftrag.wartet",
    );
}

/**
 * „Wartet in der Warteschlange“ oder „Läuft seit heute, 09:52 · 53 %“. Wartet der Auftrag hinter einem Legacy-Zug (gewollt: neben ihm schreibt der WikiSync die Karte nicht), sagt er das,
 * statt wie ein Fehler auszusehen (Betrieb 2026-10-26).
 */
export function auftragSatz(auftrag: WikisyncAuftrag, jetzt: Date): string {
    if (auftrag.zustand === "QUEUED") return wartesatz(auftrag);
    const teile = [
        t("admin.wikisync.auftrag.laeuft", { zeit: zeitpunkt(auftrag.gestartetAm ?? auftrag.eingereihtAm, jetzt) }),
    ];
    const p = prozent(auftrag.fortschritt);
    if (p !== null) teile.push(`${String(p)} %`);
    return teile.join(" · ");
}

/**
 * Warum ein Abruf beim Wiki in dieser Umgebung nicht geht (der Vergleich eines einzelnen Artikels); `undefined`, wenn er geht oder die Auskunft noch fehlt. Lokal gibt es keinen
 * (die harte Sperre), auf Stage und Production fehlen im Zweifel das Release oder der Ordner des Takts.
 */
export function abrufSperre(abruf: WikisyncAbruf | undefined): string | undefined {
    if (abruf === undefined || abruf.erlaubt) return undefined;
    return abruf.grund === null || abruf.grund === "umgebung"
        ? t("admin.wikisync.sperre.lokal")
        : t(`admin.wikisync.verbindung.grund.${abruf.grund}`);
}

/** Die Unterzeile und der Kreis der Zeile „Einzelner Artikel“: der jüngste Vergleich oder der eingereihte Auftrag. */
export function artikelLage(stand: WikisyncStand, letzter: WikisyncArtikelVergleich | undefined, jetzt: Date): Lage {
    const auftrag = auftragVon(stand, "wiki_artikel");
    if (auftrag !== undefined) return { kreis: "halb", unter: auftragSatz(auftrag, jetzt), ton: "leise" };
    if (letzter === undefined) return { kreis: "leer", unter: t("admin.wikisync.artikel.nie"), ton: "leise" };
    const wann = zeitpunkt(letzter.beendetAm ?? letzter.gestartetAm, jetzt);
    if (letzter.status === "fehlgeschlagen") {
        return {
            kreis: "leer",
            unter: t("admin.wikisync.artikel.gescheitert", {
                titel: letzter.titel,
                zeit: wann,
                grund: letzter.fehler ?? letzter.fehlerCode ?? "—",
            }),
            ton: "fehler",
        };
    }
    if (letzter.status === "laeuft")
        return {
            kreis: "halb",
            unter: t("admin.wikisync.artikel.eingereiht", { titel: letzter.titel }),
            ton: "leise",
        };
    return {
        kreis: "voll",
        unter: t("admin.wikisync.artikel.fertig", {
            titel: letzter.titel,
            zeit: wann,
            zeilen: anzahl.zeilen(letzter.zeilen.length),
        }),
        ton: "gut",
    };
}

// ── Quellstand ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function dumpLage(stand: WikisyncStand, jetzt: Date, lokal: boolean): Lage {
    const holen = auftragVon(stand, WIKI_DUMP_HOLEN_ART);
    if (holen !== undefined)
        return {
            kreis: "halb",
            unter: t("admin.wikisync.dump.holen.aktiv", { stand: holenSatz(holen, jetzt) }),
            ton: "leise",
        };
    const einlesen = auftragVon(stand, "wiki_dump_einlesen");
    if (einlesen !== undefined) return { kreis: "halb", unter: auftragSatz(einlesen, jetzt), ton: "leise" };
    const dump = stand.dump;
    if (!dump.ordner) return { kreis: "leer", unter: t("admin.wikisync.dump.keinOrdner"), ton: "warnung" };
    if (dump.datei === null) return { kreis: "leer", unter: t("admin.wikisync.dump.keiner"), ton: "warnung" };
    const teile: string[] = [];
    if (dump.geholtAm !== null) {
        teile.push(
            t(lokal ? "admin.wikisync.dump.bereitgestellt" : "admin.wikisync.dump.geholt", {
                zeit: zeitpunkt(dump.geholtAm, jetzt),
            }),
        );
    }
    teile.push(
        dump.stand === null
            ? t("admin.wikisync.dump.standUnbekannt")
            : t("admin.wikisync.dump.stand", { datum: datumText(dump.stand) }),
    );
    if (dump.seiten !== null) teile.push(anzahl.seiten(dump.seiten));
    const geprueft = dump.sha256 !== null && dump.vollstaendig !== false;
    teile.push(t(geprueft ? "admin.wikisync.dump.geprueft" : "admin.wikisync.dump.ungeprueft"));
    return { kreis: geprueft ? "voll" : "halb", unter: teile.join(" · "), ton: geprueft ? "gut" : "leise" };
}

// ── Dump holen (WI-0253 §22) ───────────────────────────────────────────────────────────

/** Der Name der Stufe, die Claudios Korridor am Auftrag meldet (`WIKI_DUMP_HOLEN_PHASEN`); eine unbekannte Stufe nennt sich selbst nicht. */
function holenPhase(phase: string | null): string | null {
    const key = `admin.wikisync.dump.holen.phase.${phase ?? ""}`;
    return isMessageKey(key) ? t(key) : null;
}

/** Der Stand eines wartenden oder laufenden Holens: „Wartet auf die Abholung durch den Server“ oder „Läuft seit heute, 12:30 · Abruf beim Wiki · 10 %“, dazu, wer es ausgelöst hat. */
export function holenSatz(auftrag: WikisyncAuftrag, jetzt: Date): string {
    const teile: string[] = [];
    if (auftrag.zustand === "QUEUED") {
        teile.push(wartesatz(auftrag));
    } else {
        teile.push(
            t("admin.wikisync.auftrag.laeuft", { zeit: zeitpunkt(auftrag.gestartetAm ?? auftrag.eingereihtAm, jetzt) }),
        );
        const phase = holenPhase(auftrag.phase);
        if (phase !== null) teile.push(phase);
        const p = prozent(auftrag.fortschritt);
        if (p !== null) teile.push(`${String(p)} %`);
    }
    if (auftrag.ausgeloestVon !== null) teile.push(t("admin.sync.by", { name: auftrag.ausgeloestVon }));
    return teile.join(" · ");
}

/** Warum „Dump holen“ nicht geht; `undefined`, wenn es geht. Der Server nennt den Grund (lokal, kein Release, kein Ordner); ein Holen, das schon wartet oder läuft, sperrt den zweiten Klick. */
export function dumpHolenSperre(
    stand: WikisyncStand,
    optionen: { darf: boolean; lokal: boolean; rechtSatz: string },
): string | undefined {
    if (!optionen.darf) return optionen.rechtSatz;
    if (optionen.lokal) return t("admin.wikisync.sperre.lokal");
    const holen = stand.dumpHolen;
    if (!holen.erlaubt) {
        if (holen.grund === "release") return t("admin.wikisync.dump.sperre.release");
        if (holen.grund === "ordner") return t("admin.wikisync.dump.sperre.ordner");
        return t("admin.wikisync.sperre.lokal");
    }
    const auftrag = auftragVon(stand, WIKI_DUMP_HOLEN_ART);
    if (auftrag !== undefined) return laeuftSchonSatz(auftrag, "admin.wikisync.fehler.dump_holen_laeuft");
    return undefined;
}

/** Das Ende des jüngsten Holens als Zeile unter dem Dump: wann, mit welchem Satz des Betriebs, wer es ausgelöst hat. `null`, wenn es noch keins gab. */
export function holenLetzteZeile(stand: WikisyncStand, jetzt: Date): { text: string; ton: Ton } | null {
    const letzter = stand.dumpHolen.letzter;
    if (letzter === null) return null;
    const zeit = zeitpunkt(letzter.beendetAm, jetzt);
    const teile: string[] = [];
    if (letzter.status === "fertig") {
        teile.push(t("admin.wikisync.dump.holen.fertig", { zeit }));
        if (letzter.meldung !== null) teile.push(letzter.meldung);
    } else {
        teile.push(
            t(
                letzter.status === "fehlgeschlagen"
                    ? "admin.wikisync.dump.holen.fehler"
                    : "admin.wikisync.dump.holen.abgebrochen",
                { zeit },
            ),
        );
        teile.push(letzter.meldung ?? t("admin.wikisync.dump.holen.ohneGrund"));
    }
    if (letzter.ausgeloestVon !== null) teile.push(t("admin.sync.by", { name: letzter.ausgeloestVon }));
    return {
        text: teile.join(" · "),
        ton: letzter.status === "fertig" ? "leise" : letzter.status === "fehlgeschlagen" ? "fehler" : "warnung",
    };
}

/**
 * Der nächste planmäßige Abruf des Dumps: am 2. jedes Monats um 05:00 Uhr Berliner Zeit (`WIKI_DUMP_PLAN`, der Timer des Betriebs). Gerechnet wird in der Zeitzone des Timers, nicht des Browsers: Am 2. um
 * 04:59 ist es noch heute, eine Minute später der 2. des nächsten Monats. Das Datum steht in der Sprache der Seite.
 */
export function naechsterDumpAbruf(jetzt: Date): { datum: string; zeit: string } {
    const { tag, stunde, minute, zeitzone } = WIKI_DUMP_PLAN;
    const teile = new Intl.DateTimeFormat("en-GB", {
        timeZone: zeitzone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        hourCycle: "h23",
    }).formatToParts(jetzt);
    const wert = (typ: string): number => Number(teile.find((teil) => teil.type === typ)?.value);
    const vorbei =
        wert("day") > tag || (wert("day") === tag && wert("hour") * 60 + wert("minute") >= stunde * 60 + minute);
    const ziel = new Date(Date.UTC(wert("year"), wert("month") - 1 + (vorbei ? 1 : 0), tag));
    const zweistellig = (n: number): string => String(n).padStart(2, "0");
    return {
        datum: datumText(`${String(ziel.getUTCFullYear())}-${zweistellig(ziel.getUTCMonth() + 1)}-${zweistellig(tag)}`),
        zeit: new Intl.DateTimeFormat(NUMBER_LOCALE[locale.value], {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "UTC",
        }).format(new Date(Date.UTC(2000, 0, 1, stunde, minute))),
    };
}

/** Die Zeile „Nächster planmäßiger Abruf“; `null`, wo es keinen gibt (lokal, oder die Umgebung darf den Dump nicht holen). */
export function dumpPlanZeile(stand: WikisyncStand, jetzt: Date, lokal: boolean): string | null {
    if (lokal || !stand.dumpHolen.erlaubt) return null;
    return t("admin.wikisync.dump.plan", naechsterDumpAbruf(jetzt));
}

/** Wann ein neuerer Dump zu erwarten ist: Wiki Aventurica erstellt ihn zum Monatsanfang. */
export function dumpErwartung(stand: string | null, jetzt: Date): { text: string; warnung: boolean } {
    const dieserMonat = new Date(jetzt.getFullYear(), jetzt.getMonth(), 1);
    const tag = (datum: Date): string =>
        datumText(`${String(datum.getFullYear())}-${String(datum.getMonth() + 1).padStart(2, "0")}-01`);
    const datum = stand === null ? null : new Date(/^\d{4}-\d{2}-\d{2}$/u.test(stand) ? `${stand}T12:00:00` : stand);
    if (datum === null || Number.isNaN(datum.getTime()))
        return { text: t("admin.wikisync.dump.aktuell", { datum: tag(dieserMonat) }), warnung: false };
    if (datum >= dieserMonat) {
        return {
            text: t("admin.wikisync.dump.naechster", {
                datum: tag(new Date(jetzt.getFullYear(), jetzt.getMonth() + 1, 1)),
            }),
            warnung: false,
        };
    }
    return { text: t("admin.wikisync.dump.neuerBereit", { datum: tag(dieserMonat) }), warnung: true };
}

// ── Bericht ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const STATUS_TON: Readonly<Record<WikisyncStatus, "neutral" | "erfolg" | "warnung" | "gefahr">> = {
    neu: "erfolg",
    geaendert: "neutral",
    zu_entfernen: "warnung",
    unterdrueckt: "neutral",
    mehrdeutig: "warnung",
    fehlerhaft: "gefahr",
};

export const statusName = (status: WikisyncStatus): string => t(`admin.wikisync.status.${status}`);
export const eigentuemerName = (eigentuemer: WikisyncEigentuemer): string =>
    t(`admin.wikisync.eigentuemer.${eigentuemer}`);
export const wirkungName = (wirkung: WikisyncWirkung): string => t(`admin.wikisync.wirkung.${wirkung}`);

export function befundName(befund: string): string {
    const key = `admin.wikisync.befund.${befund}`;
    return isMessageKey(key) ? t(key as MessageKey) : befund;
}

export function feldName(feld: string | null): string {
    if (feld === null) return t("admin.wikisync.feld.zuordnung");
    // Eine Stelle der Ortsliste eines Werks (WI-0253, Scheibe Ortslisten): `ort_<Stelle>`, von 0 an gezählt; gezeigt wird sie von 1 an.
    const stelle = /^ort_(\d+)$/u.exec(feld);
    if (stelle !== null) return t("admin.wikisync.feld.ortStelle", { n: formatNumber(Number(stelle[1]) + 1, 0) });
    // Die Verwendung einer Quelle an einem Träger (WI-0253, Scheibe Quellen): `verwendung_<Art des Trägers>_<Kennung>`; der Träger steht als Artikel in der Zeile.
    if (/^verwendung_(?:place|territory|area|peak|path)_[0-9a-f]{32}$/u.test(feld))
        return t("admin.wikisync.feld.verwendung");
    // Die Zeile, die eine fehlende Katalogquelle anlegt (WI-0253 §21).
    if (feld === "katalog_neu") return t("admin.wikisync.feld.katalogNeu");
    // Eine Ortszeile eines Vorkommens (WI-0253 §23): `ortszeile_<Beziehung>_<Kennung>`; die Beziehung steht im Namen, der Ort im Wert.
    const ortszeile = ORTSZEILE.exec(feld);
    if (ortszeile !== null)
        return t("admin.wikisync.feld.ortszeile", {
            beziehung: t(`admin.wikisync.beziehung.${ortszeile[1] as Beziehung}`),
        });
    const key = `admin.wikisync.feld.${feld}`;
    return isMessageKey(key) ? t(key as MessageKey) : feld;
}

const ORTSZEILE = /^ortszeile_(verbreitung|vorkommen|herkunft|regionen)_[0-9a-f]{16}$/u;
type Beziehung = "verbreitung" | "vorkommen" | "herkunft" | "regionen";

/** Der Name einer Rolle der Ortszeile eines Vorkommens (`WIKISYNC_ORTSROLLEN`); ein unbekanntes Wort bleibt, wie es ist. */
export function rolleName(rolle: string): string {
    const key = `admin.wikisync.rolle.${rolle}`;
    return isMessageKey(key) ? t(key as MessageKey) : rolle;
}

/**
 * Der Wert einer Ortszeile im Bericht: `Titel · Rolle · Schlüssel` (`wiki/abgleich/vorkommen.ts`). Gezeigt wird der Titel und die Rolle in der Sprache der Seite; der Schlüssel ist eine Kennung des
 * Servers und bleibt weg. Ein Wert in anderer Form bleibt, wie er ist.
 */
export function ortszeilenWertText(wert: string): string {
    const zweite = wert.lastIndexOf(" · ");
    const erste = zweite < 0 ? -1 : wert.lastIndexOf(" · ", zweite - 1);
    if (erste < 0) return wert;
    return `${wert.slice(0, erste)} · ${rolleName(wert.slice(erste + 3, zweite))}`;
}

export function objektArtName(art: string): string {
    const key = `admin.wikisync.objektart.${art}`;
    return isMessageKey(key) ? t(key as MessageKey) : art;
}

/** Ein Wert der Zeile: Text, bewusst leer, oder kein Wert (hier „(leer)“, im Wiki „unbekannt“). */
export function wertText(
    wert: string | null,
    zustand: WikisyncWertZustand,
    seite: "alt" | "neu",
    feld: string | null = null,
): { text: string; marke: boolean } {
    if (zustand === "text" && wert !== null) {
        return { text: feld !== null && ORTSZEILE.test(feld) ? ortszeilenWertText(wert) : wert, marke: false };
    }
    if (zustand === "leer") return { text: t("admin.wikisync.wert.bewusstLeer"), marke: true };
    return { text: t(seite === "alt" ? "admin.wikisync.wert.leer" : "admin.wikisync.wert.unbekannt"), marke: true };
}

/** Der Kreis einer Zeile des Berichts: übernommen wird nur, was dem WikiSync gehört; sonst bleibt es Vorschau; eigen und Befund nie. */
export function zeilenKreis(wirkung: WikisyncWirkung, gehoertWikisync: boolean): Kreis {
    if (wirkung !== "uebernommen") return "leer";
    return gehoertWikisync ? "voll" : "halb-rechts";
}

export const BERICHT_LEGENDE: readonly Kreis[] = ["voll", "halb-rechts", "leer"];

export function berichtKreisName(kreis: Kreis): string {
    return t(`admin.wikisync.bericht.kreis.${kreis}`);
}
