import { ref, type Ref } from "vue";
import {
    RENDER_ZOOM_OFFSET,
    WETTERMODELL_PANELE,
    WETTERMODELL_REITER,
    WETTERMODELL_URL,
    WETTERMODELL_WERTE,
    WETTER_URL,
    wettermodellImRahmen,
    wettermodellPaarFehler,
    wettermodellWert,
    wettermodellWirksam,
    type OperationReceipt,
    type WetterDatenAntwort,
    type WetterQuelle,
    type WettermodellBody,
    type WettermodellFolge,
    type WettermodellReiter,
    type WettermodellWert,
    type Wettermodellwerte,
} from "@avesmaps3d/shared";
import { ApiFailure, getJson, newOperationId, postJson, type Fetcher } from "../auth/api";
import { requestConfirmation, withConfirmation, type Need } from "../auth/bestaetigen";
import { formProblems, type Phrase } from "../auth/formular";
import type { ActionResult } from "../auth/verwaltung";
import { label } from "../auth/verwaltung-text";
import { leseZahl } from "../auth/wegfindung";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import { meldeWettermodellGespeichert } from "../map/wetter/wetter-schalter";
import { einheitText } from "../wettereditor/wetter-einheit";

/**
 * Der Reiter „Wettermodell“ der Systemsteuerung (WI-0288 Stufe 4; Probierseite `review/wetter-editor/`, Abschnitt Systemsteuerung, vom
 * Betreiber am 2026-11-07 mit „passt glaub“ abgenommen; Design Guide §8 „Seiten mit vielen Einstellungen“). Was die Oberfläche rechnet,
 * steht hier; wie es aussieht, in `verwaltung-wettermodell.vue`.
 *
 * - 🔴 **Die Werte kommen aus der Tafel** (`packages/shared/src/wetter/modell.ts`): Vorgabe, Grenzen, Einheit, Stellen, Folge, Paare. Namen
 *   und Sätze stehen in der Sprachtafel (`admin.wettermodell.*`). Hier liegt keine zweite Liste.
 * - **Gelesen wird der öffentliche Leseweg** `GET /api/wetter` (`modell`: Revision, wirksame Werte, verstellte Kennungen), derselbe, den
 *   das Wetter auf der Karte liest. Geschrieben wird wie bei der Wegfindung: ein Wert je Anfrage an `POST /api/admin/system/wettermodell`
 *   mit `baseRevision`, Passkey im Moment (Stufe S, `withConfirmation`), `null` setzt zurück.
 * - Die Grenzen prüft die Oberfläche mit DERSELBEN Regel wie der Server (`wettermodellImRahmen`, `wettermodellPaarFehler`); der Server prüft
 *   danach noch einmal und antwortet 400 `value_out_of_range`. Beides steht am Feld.
 * - **Was im Feld steht, wird gespeichert:** auf die angezeigten Stellen gerundet (Prozent auf ganze, Faktoren auf zwei Stellen), damit
 *   Feld und Tafel nie auseinanderlaufen.
 * - Nach jedem gelungenen Schreiben meldet der Reiter es dem Wetter auf der Karte (`meldeWettermodellGespeichert`): Läuft es im selben
 *   Browser, übernimmt es die Werte der Folge `sofort` ohne Neuladen.
 */

// ---------- Regen und Schnee „nah“ in Zoomstufen ----------

/**
 * Für welche Kartenhöhe die Zoomstufe gerechnet wird (Rechner 1600 × 900, die Größe der Probierseite).
 *
 * 🪤 **Regen und Schnee „nah“ stehen als Abstand der Kamera in der Tafel** (Stufe 2; die Engine rechnet `sstep(nahVoll, nahAb, cam.dist)`),
 * die Probierseite zeigte Zoom. Der Abstand zur Kartenmitte ist bei MapLibre 1,5 Kartenhöhen in Pixeln (Blickwinkel 36,87°, `tan` der
 * Hälfte 1/3), die Welt 512 · 2^Zoom Pixel breit und in der Engine 1.024 Einheiten: Abstand = 3 · Höhe / 2^Zoom. Er hängt also von der
 * Höhe der Karte ab; auf einem höheren Schirm setzt es erst bei höherer Stufe ein. Das sagt die Zeile.
 *
 * Angezeigt wird die fachliche Zoomstufe des Hauses (MapLibre-Zoom minus `RENDER_ZOOM_OFFSET`, wie unter dem Kameraring; Betreiber
 * 2026-10-10: „Die angezeigte Zahl muss die fachliche Zoomstufe sein“), mit einer Stelle. Gespeichert bleibt der Abstand.
 */
export const ZOOM_BEZUG_HOEHE = 900;

/** Die Werte, die als Zoomstufe angezeigt werden. */
export const ZOOM_WERTE: ReadonlySet<string> = new Set(["nahAb", "nahVoll"]);

export const zoomstufeAusAbstand = (abstand: number): number =>
    Math.log2((3 * ZOOM_BEZUG_HOEHE) / abstand) - RENDER_ZOOM_OFFSET;

export const abstandAusZoomstufe = (stufe: number): number =>
    (3 * ZOOM_BEZUG_HOEHE) / 2 ** (stufe + RENDER_ZOOM_OFFSET);

// ---------- Anzeige ----------

export type WettermodellArt = "zahl" | "zoom" | "auswahl";

export const artVon = (wert: WettermodellWert): WettermodellArt =>
    wert.auswahl !== undefined ? "auswahl" : ZOOM_WERTE.has(wert.id) ? "zoom" : "zahl";

const runde = (zahl: number, stellen: number): number => {
    const f = 10 ** stellen;
    return Math.round(zahl * f) / f;
};

/** Wie viele Stellen das Feld zeigt: eine für die Zoomstufe, sonst die der Tafel. */
export const anzeigeStellen = (wert: WettermodellWert): number => (artVon(wert) === "zoom" ? 1 : wert.stellen);

/** Die Zahl, die im Feld steht, schon gerundet: der Abstand als Zoomstufe, ein Anteil in Prozent. */
export function anzeigeZahl(wert: WettermodellWert, gespeichert: number): number {
    if (artVon(wert) === "zoom") return runde(zoomstufeAusAbstand(gespeichert), 1);
    return runde(gespeichert * (wert.faktor ?? 1), wert.stellen);
}

/** Aus der Zahl im Feld der Wert der Tafel: die Zoomstufe als Abstand (zwei Stellen, damit sie genau zurückkommt), Prozent als Anteil. */
export function ausAnzeige(wert: WettermodellWert, angezeigt: number): number {
    if (artVon(wert) === "zoom") return runde(abstandAusZoomstufe(angezeigt), 2);
    const faktor = wert.faktor ?? 1;
    return runde(angezeigt / faktor, wert.stellen + Math.round(Math.log10(faktor)));
}

/** Die Grenzen, wie sie im Feld gelten. Die Zoomstufe dreht sie um (weiter weg heißt kleinere Stufe) und rundet nach innen. */
export function anzeigeGrenzen(wert: WettermodellWert): { min: number; max: number } {
    if (artVon(wert) === "zoom")
        return {
            min: Math.ceil(zoomstufeAusAbstand(wert.max) * 10) / 10,
            max: Math.floor(zoomstufeAusAbstand(wert.min) * 10) / 10,
        };
    const faktor = wert.faktor ?? 1;
    return { min: runde(wert.min * faktor, wert.stellen), max: runde(wert.max * faktor, wert.stellen) };
}

/** Der Name einer Wahl der Wolkenauflösung: 0 heißt „Automatisch“, sonst Prozent. */
export const auswahlText = (zahl: number): string =>
    zahl === 0 ? t("admin.wettermodell.auswahl.auto") : `${formatNumber(zahl * 100, 0)} %`;

/** Die Zahl, wie sie im Feld und in den Sätzen steht (ohne Einheit). */
export function anzeigeText(wert: WettermodellWert, gespeichert: number): string {
    if (artVon(wert) === "auswahl") return auswahlText(gespeichert);
    return formatNumber(anzeigeZahl(wert, gespeichert), anzeigeStellen(wert));
}

/** Die Einheit hinter dem Feld; die Zoomstufe trägt ihr Wort im Namen. */
export const einheitVon = (wert: WettermodellWert): string =>
    artVon(wert) === "zahl" ? einheitText(wert.einheit) : "";

/** Mit Einheit: „1,35 ×“, „10 %“, „Automatisch (hält die Bildrate)“. */
export function mitEinheit(wert: WettermodellWert, gespeichert: number): string {
    const einheit = einheitVon(wert);
    return einheit === "" ? anzeigeText(wert, gespeichert) : `${anzeigeText(wert, gespeichert)} ${einheit}`;
}

export const wertName = (id: string): string => label("admin.wettermodell.wert", id);
const wertSatz = (id: string): string => label("admin.wettermodell.satz", id);

export const FOLGE_SATZ: Readonly<Record<WettermodellFolge, () => string>> = {
    sofort: () => t("admin.wettermodell.folge.sofort"),
    neustart: () => t("admin.wettermodell.folge.neustart"),
};

// ---------- Stand ----------

/** Was der Leseweg über das Wettermodell sagt, in der Form des Reiters. */
export interface WettermodellStand {
    /** Die Revision der Tafel, Grundlage für `baseRevision`; `null` ohne Tafel (dann geht Verstellen nicht). */
    readonly revision: number | null;
    /** Nur, was verstellt ist (gespeichert); alles andere steht auf seiner Vorgabe. */
    readonly abweichungen: Readonly<Record<string, number>>;
    readonly quelle: WetterQuelle;
}

/** Aus `GET /api/wetter` das Wettermodell; Unbekanntes und Unpassendes fällt weg (`wettermodellWirksam` als Maßstab). */
export function standAus(body: WetterDatenAntwort): WettermodellStand {
    const werte = body.modell.werte;
    const wirksam = wettermodellWirksam(werte);
    const abweichungen = Object.fromEntries(
        body.modell.verstellt
            .filter((id) => wettermodellWert(id) !== undefined && werte[id] === wirksam[id])
            .map((id) => [id, wirksam[id]!]),
    );
    return { revision: body.modell.revision, abweichungen, quelle: body.quelle.modell };
}

export const wirksameWerte = (stand: WettermodellStand | null): Wettermodellwerte =>
    wettermodellWirksam(stand?.abweichungen ?? {});

// ---------- Sicht ----------

export interface WettermodellZeile {
    readonly wert: WettermodellWert;
    readonly art: WettermodellArt;
    readonly name: string;
    readonly satz: string;
    /** Der gespeicherte Wert (die Abweichung, sonst die Vorgabe). */
    readonly eingestellt: number;
    /** Weicht er ab? Danach ist ↺ wach und der Name in der Akzentfarbe. */
    readonly abweichend: boolean;
    /** Was im Feld steht, wenn niemand tippt. */
    readonly text: string;
    readonly einheit: string;
    /** Die Vorgabe mit Einheit: das Ziel von ↺. */
    readonly vorgabeText: string;
    readonly folge: WettermodellFolge;
    readonly folgeSatz: string;
    /** „Vorgabe 1,35 ×“, nur wenn der Wert abweicht. */
    readonly vorgabeSatz: string | null;
    /** „Spanne 0,00 bis 8,00“; die Wahl hat keine. */
    readonly spanne: string | null;
    /** Der gespeicherte Abstand der Kamera, nur an den Zeilen in Zoomstufen. */
    readonly abstand: string | null;
    /** Die Wahl der Wolkenauflösung. */
    readonly optionen: readonly { wert: string; text: string }[];
}

export interface WettermodellPanelSicht {
    readonly id: string;
    readonly reiter: WettermodellReiter;
    readonly titel: string;
    readonly wirkung: string;
    readonly zeilen: readonly WettermodellZeile[];
}

export function zeileVon(wert: WettermodellWert, stand: WettermodellStand | null): WettermodellZeile {
    const art = artVon(wert);
    const gespeichert = stand?.abweichungen[wert.id];
    const eingestellt = gespeichert ?? wert.vorgabe;
    const abweichend = gespeichert !== undefined;
    const grenzen = anzeigeGrenzen(wert);
    const stellen = anzeigeStellen(wert);
    const einheit = einheitVon(wert);
    return {
        wert,
        art,
        name: wertName(wert.id),
        satz: wertSatz(wert.id),
        eingestellt,
        abweichend,
        text: anzeigeText(wert, eingestellt),
        einheit,
        vorgabeText: mitEinheit(wert, wert.vorgabe),
        folge: wert.folge,
        folgeSatz: FOLGE_SATZ[wert.folge](),
        vorgabeSatz: abweichend ? t("admin.wettermodell.vorgabe", { wert: mitEinheit(wert, wert.vorgabe) }) : null,
        spanne:
            art === "auswahl"
                ? null
                : t("admin.wettermodell.spanne", {
                      min: formatNumber(grenzen.min, stellen),
                      max: formatNumber(grenzen.max, stellen),
                  }),
        abstand:
            art === "zoom"
                ? t("admin.wettermodell.zoom.abstand", {
                      abstand: formatNumber(eingestellt, eingestellt % 1 === 0 ? 0 : 2),
                      hoehe: String(ZOOM_BEZUG_HOEHE),
                  })
                : null,
        optionen: (wert.auswahl ?? []).map((zahl) => ({ wert: String(zahl), text: auswahlText(zahl) })),
    };
}

/** Die zwölf Panele mit ihren Zeilen, in der Reihenfolge der Tafel. */
export function panele(stand: WettermodellStand | null): WettermodellPanelSicht[] {
    return WETTERMODELL_PANELE.map((panel) => ({
        id: panel.id,
        reiter: panel.reiter,
        titel: label("admin.wettermodell.panel", panel.id),
        wirkung: label("admin.wettermodell.wirkung", panel.id),
        zeilen: panel.werte.map((wert) => zeileVon(wert, stand)),
    }));
}

/** Die vier Reiter; ihr Name zählt die Abweichungen darin („Wind und Wolken (2)“), wie in der Probierseite. */
export function reiterListe(stand: WettermodellStand | null): { id: WettermodellReiter; name: string }[] {
    return WETTERMODELL_REITER.map((id) => {
        const name = label("admin.wettermodell.reiter", id);
        const n = WETTERMODELL_PANELE.filter((panel) => panel.reiter === id)
            .flatMap((panel) => panel.werte)
            .filter((wert) => stand?.abweichungen[wert.id] !== undefined).length;
        return { id, name: n === 0 ? name : t("admin.wettermodell.reiter.zahl", { name, n }) };
    });
}

export const abweichendeZahl = (stand: WettermodellStand | null): number =>
    Object.keys(stand?.abweichungen ?? {}).length;

/** Was in der Schiene rechts steht: „2 abweichend“; keiner: nichts (wie bei der Wegfindung). */
export function schienenWert(stand: WettermodellStand | null): string | undefined {
    const n = abweichendeZahl(stand);
    return stand === null || n === 0 ? undefined : t("admin.wegfindung.rail", { n });
}

/** Der Satz links in der Leiste: wie viele Werte abweichen. */
export function leistenSatz(stand: WettermodellStand | null): string {
    const n = abweichendeZahl(stand);
    return n === 0 ? t("admin.wettermodell.leiste.vorgabe") : tPlural("admin.wettermodell.leiste.abweichend", n, { n });
}

// ---------- Prüfen ----------

const andererWert = (id: string, werte: Wettermodellwerte): string => {
    const wert = wettermodellWert(id)!;
    return mitEinheit(wert, werte[id] ?? wert.vorgabe);
};

/**
 * Ein verletztes Paar am Feld von `id`: „Muss kleiner bleiben als …“. In Zoomstufen dreht sich die Richtung um, denn ein kleinerer
 * Abstand ist eine höhere Stufe.
 */
function paarSatz(id: string, paar: { kleiner: string; groesser: string }, werte: Wettermodellwerte): Phrase {
    const anderer = id === paar.kleiner ? paar.groesser : paar.kleiner;
    const kleiner = (id === paar.kleiner) !== ZOOM_WERTE.has(id);
    return {
        key: kleiner ? "admin.wettermodell.invalid.kleiner" : "admin.wettermodell.invalid.groesser",
        params: { name: wertName(anderer), wert: andererWert(anderer, werte) },
    };
}

export type Pruefung = { ok: true; wert: number; angezeigt: number } | { ok: false; problem: Phrase };

/** Nimmt das Feld die getippte Zahl an? Gelesen in der Sprache der Seite, geprüft in Grenzen und Paaren wie auf dem Server. */
export function pruefe(wert: WettermodellWert, text: string, stand: WettermodellStand | null): Pruefung {
    const getippt = leseZahl(text);
    if (getippt === null) return { ok: false, problem: { key: "admin.wegfindung.invalid.number" } };
    const grenzen = anzeigeGrenzen(wert);
    const stellen = anzeigeStellen(wert);
    const angezeigt = runde(getippt, stellen);
    const neu = ausAnzeige(wert, angezeigt);
    if (angezeigt < grenzen.min || angezeigt > grenzen.max || !wettermodellImRahmen(wert, neu))
        return {
            ok: false,
            problem: {
                key: "admin.wegfindung.invalid.range",
                params: { min: formatNumber(grenzen.min, stellen), max: formatNumber(grenzen.max, stellen) },
            },
        };
    const danach = wettermodellWirksam({ ...(stand?.abweichungen ?? {}), [wert.id]: neu });
    const paar = wettermodellPaarFehler(danach);
    if (paar !== undefined && (paar.kleiner === wert.id || paar.groesser === wert.id))
        return { ok: false, problem: paarSatz(wert.id, paar, danach) };
    return { ok: true, wert: neu, angezeigt };
}

/** Ein gescheiterter Schreibweg als Satz am Feld: Grenzen und Paare wie die Oberfläche, sonst die Sätze des Hauses. */
export function fehlerSatz(fehler: unknown, id: string, stand: WettermodellStand | null): Phrase {
    const failure = fehler instanceof ApiFailure ? fehler : undefined;
    if (failure?.code === "reauth_required" || failure?.code === "assurance_required")
        return { key: "admin.system.error.notConfirmed" };
    const wert = wettermodellWert(id);
    if (failure?.code === "value_out_of_range" && wert !== undefined) {
        const details = failure.details ?? {};
        const kleiner = details["kleiner"];
        const groesser = details["groesser"];
        if (typeof kleiner === "string" && typeof groesser === "string")
            return paarSatz(id, { kleiner, groesser }, wirksameWerte(stand));
        if (Array.isArray(details["auswahl"])) return { key: "admin.wettermodell.invalid.auswahl" };
        const grenzen = anzeigeGrenzen(wert);
        const stellen = anzeigeStellen(wert);
        return {
            key: "admin.wegfindung.invalid.range",
            params: { min: formatNumber(grenzen.min, stellen), max: formatNumber(grenzen.max, stellen) },
        };
    }
    return formProblems(fehler)[0] ?? { key: "auth.form.failed" };
}

// ---------- Zustand des Reiters ----------

export interface WettermodellDeps {
    fetcher?: Fetcher;
    ask?: (need: Need) => Promise<boolean>;
    /** Meldet dem Wetter auf der Karte, dass gespeichert ist (Vorgabe `meldeWettermodellGespeichert`). */
    gespeichert?: () => void;
}

export interface Wettermodell {
    stand: Ref<WettermodellStand | null>;
    loading: Ref<boolean>;
    loadProblems: Ref<Phrase[]>;
    /** Die Kennung, die gerade geschrieben wird; `*` beim Zurücksetzen aller Werte. */
    busy: Ref<string | null>;
    /** Was in den Feldern steht, solange jemand tippt (oder der Server die Zahl abgewiesen hat). */
    felder: Ref<Record<string, string>>;
    /** Der Satz je Feld, solange die Zahl nicht gespeichert ist. */
    probleme: Ref<Record<string, Phrase>>;
    /** Die Antwort des Knopfes „Alle zurücksetzen“; sie gehört zur Leiste, nicht zu einer Zeile. */
    alle: Ref<ActionResult | null>;
    load(): Promise<void>;
    tippe(id: string, text: string): void;
    /** Die getippte Zahl übernehmen (Feld verlassen oder Eingabetaste); unverändert: nichts, fehlerhaft: der Satz am Feld. */
    uebernimm(id: string): Promise<void>;
    /** Eine Wahl (die Wolkenauflösung) gilt mit dem Wählen. */
    waehle(id: string, zahl: number): Promise<void>;
    zuruecksetzen(id: string): Promise<void>;
    /** Jede Abweichung zurück auf die Vorgabe, eine Anfrage je Wert (ein Eintrag im Protokoll je Wert, ein Passkey für alle). */
    alleZuruecksetzen(): Promise<void>;
}

export function createWettermodell(deps: WettermodellDeps = {}): Wettermodell {
    const stand = ref<WettermodellStand | null>(null);
    const loading = ref(false);
    const loadProblems = ref<Phrase[]>([]);
    const busy = ref<string | null>(null);
    const felder = ref<Record<string, string>>({});
    const probleme = ref<Record<string, Phrase>>({});
    const alle = ref<ActionResult | null>(null);
    const ask = deps.ask ?? requestConfirmation;
    const gespeichert = deps.gespeichert ?? meldeWettermodellGespeichert;
    let ticket = 0;

    async function load(): Promise<void> {
        const mine = ++ticket;
        loading.value = true;
        try {
            const body = await getJson<WetterDatenAntwort>(WETTER_URL, deps.fetcher);
            if (mine !== ticket) return;
            stand.value = standAus(body);
            loadProblems.value = [];
        } catch (error) {
            if (mine === ticket) loadProblems.value = formProblems(error);
        } finally {
            if (mine === ticket) loading.value = false;
        }
    }

    function tippe(id: string, text: string): void {
        felder.value = { ...felder.value, [id]: text };
        const offen = { ...probleme.value };
        delete offen[id];
        probleme.value = offen;
    }

    /** Das Feld wieder an den Stand des Servers binden. */
    function loese(id: string): void {
        const offeneFelder = { ...felder.value };
        delete offeneFelder[id];
        felder.value = offeneFelder;
        const offeneProbleme = { ...probleme.value };
        delete offeneProbleme[id];
        probleme.value = offeneProbleme;
    }

    const neueRevision = (quittung: OperationReceipt, vorher: number): number =>
        quittung.affected.find((eintrag) => eintrag.kind === "wettermodell")?.revision ?? vorher + 1;

    async function sende(id: string, value: number | null, baseRevision: number): Promise<OperationReceipt> {
        const body: WettermodellBody = { operationId: newOperationId(), baseRevision, id, value };
        return withConfirmation(() => postJson<OperationReceipt>(WETTERMODELL_URL, body, deps.fetcher), ask);
    }

    async function schreibe(id: string, value: number | null): Promise<void> {
        const s = stand.value;
        if (s === null || s.revision === null || busy.value !== null) return;
        busy.value = id;
        alle.value = null;
        try {
            await sende(id, value, s.revision);
            loese(id);
            gespeichert();
        } catch (error) {
            // `no_change`: Es steht schon so (ein anderer Tab war schneller); das Feld bindet sich wieder an den Stand.
            if (error instanceof ApiFailure && error.code === "no_change") loese(id);
            else probleme.value = { ...probleme.value, [id]: fehlerSatz(error, id, s) };
        }
        busy.value = null;
        await load();
    }

    async function uebernimm(id: string): Promise<void> {
        const text = felder.value[id];
        const wert = wettermodellWert(id);
        if (text === undefined || wert === undefined) return;
        if (text.trim() === "") {
            loese(id);
            return;
        }
        const pruefung = pruefe(wert, text, stand.value);
        if (!pruefung.ok) {
            probleme.value = { ...probleme.value, [id]: pruefung.problem };
            return;
        }
        const eingestellt = stand.value?.abweichungen[id];
        // Was im Feld schon so steht, ist keine Änderung; der Server antwortete 409 `no_change`.
        if (pruefung.angezeigt === anzeigeZahl(wert, eingestellt ?? wert.vorgabe)) {
            loese(id);
            return;
        }
        // Zurück auf die Vorgabe getippt heißt: die Abweichung löschen, nicht die Vorgabe speichern.
        if (pruefung.angezeigt === anzeigeZahl(wert, wert.vorgabe)) {
            await schreibe(id, null);
            return;
        }
        await schreibe(id, pruefung.wert);
    }

    async function waehle(id: string, zahl: number): Promise<void> {
        const wert = wettermodellWert(id);
        if (wert === undefined || !wettermodellImRahmen(wert, zahl)) return;
        if (zahl === (stand.value?.abweichungen[id] ?? wert.vorgabe)) return;
        await schreibe(id, zahl === wert.vorgabe ? null : zahl);
    }

    async function zuruecksetzen(id: string): Promise<void> {
        if (stand.value?.abweichungen[id] === undefined) {
            loese(id);
            return;
        }
        await schreibe(id, null);
    }

    async function alleZuruecksetzen(): Promise<void> {
        const s = stand.value;
        if (s === null || s.revision === null || busy.value !== null) return;
        const ids = WETTERMODELL_WERTE.map((wert) => wert.id).filter((id) => s.abweichungen[id] !== undefined);
        if (ids.length === 0) return;
        busy.value = "*";
        alle.value = null;
        let revision = s.revision;
        let geschafft = 0;
        let fehler: { error: unknown; id: string } | undefined;
        for (const id of ids) {
            try {
                revision = neueRevision(await sende(id, null, revision), revision);
                geschafft += 1;
            } catch (error) {
                if (error instanceof ApiFailure && error.code === "no_change") continue;
                // Was danach käme, bleibt stehen: Die Leiste sagt, warum, und zählt nach dem Neuladen, was noch abweicht.
                fehler = { error, id };
                break;
            }
        }
        felder.value = {};
        probleme.value = {};
        if (geschafft > 0) gespeichert();
        alle.value =
            fehler === undefined
                ? { ok: true, problems: [] }
                : { ok: false, problems: [fehlerSatz(fehler.error, fehler.id, s)] };
        busy.value = null;
        await load();
    }

    return {
        stand,
        loading,
        loadProblems,
        busy,
        felder,
        probleme,
        alle,
        load,
        tippe,
        uebernimm,
        waehle,
        zuruecksetzen,
        alleZuruecksetzen,
    };
}
