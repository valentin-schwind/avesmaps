import { ref, type Ref } from "vue";
import {
    KARTENEINSTELLUNGEN_URL,
    KARTENEINSTELLUNG_PANELE,
    karteneinstellung,
    karteneinstellungGleich,
    karteneinstellungImRahmen,
    REISEBEGINN_NAMENLOSE_TAGE,
    REISEBEGINN_TAGE,
    type AdminKarteneinstellungen,
    type Karteneinstellung,
    type KartenPunkt,
    type KartenWert,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { ApiFailure, getJson, newOperationId, postJson, type Fetcher } from "./api";
import {
    createReadConfirmation,
    neededConfirmation,
    requestConfirmation,
    withConfirmation,
    type Need,
    type ReadConfirmation,
} from "./bestaetigen";
import { formProblems, type Phrase } from "./formular";
import type { ActionResult } from "./verwaltung";
import { label } from "./verwaltung-text";
import { leseZahl } from "./wegfindung";
import { monatText, optionText, wertText, zahl } from "./karteneinstellungen-texte";

export { wertText, zahl };

/**
 * Der Eintrag „Karteneinstellungen“ der Systemsteuerung (WI-0166, Design Guide §8 „Seiten mit vielen Einstellungen“): die
 * Voreinstellungen, mit denen Avesmaps jeden Besuch beginnt. Was die Oberfläche rechnet, steht hier; wie es aussieht, in
 * `verwaltung-karteneinstellungen.vue`.
 *
 * 🔴 **Die Einstellungen kommen aus der Tafel** (`packages/shared/src/system/karteneinstellungen.ts`): Kennung, Art, Vorgabe,
 * Grenzen, Panel. Namen und Sätze aus der Sprachtafel (`admin.karteneinstellungen.wert.<id>.*`). Der Server schickt nur, was
 * verstellt ist.
 *
 * - Verstellen ohne Dialog, wie in der Wegfindung: Wert ins Feld, Feld verlassen oder Eingabetaste — der Browser fragt den
 *   Passkey (Stufe S). Das Rücksetzzeichen ↺ schickt `null`.
 * - Ein Punkt hat zwei Felder (x, y) und ist EINE Einstellung: Er wird übernommen, sobald eines der beiden Felder verlassen wird
 *   und beide eine Zahl tragen. Ebenso der Reisebeginn (Monat, Tag).
 * - Eine Auswahl und ein Kästchen gehen sofort hinaus, ohne Tippen: Wahl treffen, Passkey, fertig.
 * - **Ein Auslöser oben:** „Aktuelle Ansicht übernehmen“ nimmt Mitte und Zoom der Karte, die hinter dem Fenster steht. Gelesen
 *   aus der Adresse (`#x=…&y=…&z=…`), die die Karte nach jeder Bewegung schreibt — kein Griff in die Karte selbst.
 */

/**
 * Die Kennung eines Felds: eine Einstellung mit einem Feld unter ihrer eigenen Kennung, ein Punkt je Achse (`.x`, `.y`), der
 * Reisebeginn je Teil (`.monat`, `.tag`).
 */
export const feldId = (id: string, teil?: "x" | "y" | "monat" | "tag"): string =>
    teil === undefined ? id : `${id}.${teil}`;

/** Der Name einer Einstellung; fehlt er in der Sprachtafel, steht die Kennung da (der Test hält die Tafeln vollständig). */
export const nameVon = (id: string): string => label(`admin.karteneinstellungen.wert.${id}`, "name");

export interface KarteneinstellungZeile {
    einstellung: Karteneinstellung;
    name: string;
    satz: string;
    folgeSatz: string;
    /** Der geltende Wert: die Abweichung, wo es eine gibt, sonst die Vorgabe. */
    eingestellt: KartenWert;
    abweichend: boolean;
    /** Was in den Feldern steht, wenn niemand tippt: ein Text je Feldkennung. */
    texte: Record<string, string>;
    /** Die Wahlen einer Auswahl oder die Monate des Reisebeginns, mit dem Namen aus dem Planer. */
    optionen: { wert: string; text: string }[];
    vorgabeText: string;
    /** „statt …“ — die Vorgabe, wenn der Wert von ihr abweicht. */
    statt: string | null;
    /** Wer wann verstellt hat; `null` ohne Abweichung. */
    stand: string | null;
}

export interface KarteneinstellungPanelSicht {
    id: string;
    titel: string;
    wirkung: string;
    zeilen: KarteneinstellungZeile[];
}

function felderText(einstellung: Karteneinstellung, wert: KartenWert): Record<string, string> {
    switch (einstellung.art) {
        case "zahl":
            return { [feldId(einstellung.id)]: typeof wert === "number" ? zahl(wert, einstellung.stellen) : "" };
        case "punkt":
            return typeof wert === "object" && "x" in wert
                ? {
                      [feldId(einstellung.id, "x")]: zahl(wert.x, einstellung.stellen),
                      [feldId(einstellung.id, "y")]: zahl(wert.y, einstellung.stellen),
                  }
                : {};
        case "auswahl":
        case "farbe":
        case "text":
            return { [feldId(einstellung.id)]: String(wert) };
        case "schalter":
            return { [feldId(einstellung.id)]: String(wert === true) };
        case "reisebeginn":
            return typeof wert === "object" && "monat" in wert
                ? { [feldId(einstellung.id, "monat")]: wert.monat, [feldId(einstellung.id, "tag")]: String(wert.tag) }
                : { [feldId(einstellung.id, "monat")]: "unbestimmt", [feldId(einstellung.id, "tag")]: "1" };
        case "kurve":
            // Eine Kurve hat kein Feld zum Tippen: Der Editor schickt seine Punkte als JSON unter der Kennung (`waehle`).
            return { [feldId(einstellung.id)]: JSON.stringify(wert) };
    }
}

/** Die Wahlen, die ein Feld anbietet: die Optionen einer Auswahl oder „unbestimmt“ und die zwölf Monate. */
function optionenVon(einstellung: Karteneinstellung): { wert: string; text: string }[] {
    if (einstellung.art === "auswahl")
        return einstellung.optionen.map((wert) => ({ wert, text: optionText(einstellung, wert) }));
    if (einstellung.art === "reisebeginn")
        return ["unbestimmt", ...einstellung.monate].map((wert) => ({ wert, text: monatText(wert) }));
    return [];
}

/** Die Panele mit ihren Zeilen: die Tafel, angereichert um das, was der Server über Abweichungen weiß. */
export function panele(stand: AdminKarteneinstellungen | null, jetzt: Date): KarteneinstellungPanelSicht[] {
    const gesetzt = new Map((stand?.rows ?? []).map((row) => [row.id, row]));
    return KARTENEINSTELLUNG_PANELE.map((panel) => ({
        id: panel.id,
        titel: label(`admin.karteneinstellungen.panel.${panel.id}`, "titel"),
        wirkung: label(`admin.karteneinstellungen.panel.${panel.id}`, "wirkung"),
        zeilen: panel.werte.map((einstellung) => {
            const row = gesetzt.get(einstellung.id);
            const eingestellt = row?.value ?? einstellung.vorgabe;
            return {
                einstellung,
                name: nameVon(einstellung.id),
                satz: label(`admin.karteneinstellungen.wert.${einstellung.id}`, "satz"),
                folgeSatz: label("admin.karteneinstellungen.folge", einstellung.folge),
                eingestellt,
                abweichend: row !== undefined,
                texte: felderText(einstellung, eingestellt),
                optionen: optionenVon(einstellung),
                vorgabeText: wertText(einstellung, einstellung.vorgabe),
                statt:
                    row === undefined
                        ? null
                        : t("admin.karteneinstellungen.instead", { wert: wertText(einstellung, einstellung.vorgabe) }),
                stand:
                    row === undefined || row.changedAt === null
                        ? null
                        : [
                              t("admin.karteneinstellungen.changedAt", {
                                  time: relativeTime(new Date(row.changedAt), jetzt, locale.value, "zeitpunkt"),
                              }),
                              row.changedBy,
                          ]
                              .filter((teil) => teil !== null)
                              .join(" · "),
            };
        }),
    }));
}

/** Was in der Schiene rechts steht: wie viele Einstellungen verstellt sind („1 verstellt“); keine: nichts. */
export function schienenWert(stand: AdminKarteneinstellungen | null): string | undefined {
    if (stand === null) return undefined;
    const n = stand.rows.length;
    return n === 0 ? undefined : t("admin.karteneinstellungen.rail", { n });
}

/** Die Grenzen einer Einstellung als Satz, für die Fehlermeldung am Feld; an den Namenlosen Tagen gelten 1 bis 5. */
function grenzenSatz(einstellung: Karteneinstellung, wert?: KartenWert): Phrase {
    switch (einstellung.art) {
        case "zahl": {
            const grenzen = { min: zahl(einstellung.min, 2), max: zahl(einstellung.max, 2) };
            return einstellung.schritt === undefined
                ? { key: "admin.karteneinstellungen.invalid.range", params: grenzen }
                : {
                      key: "admin.karteneinstellungen.invalid.rangeStep",
                      params: { ...grenzen, schritt: zahl(einstellung.schritt, 2) },
                  };
        }
        case "punkt": {
            const { minX, minY, maxX, maxY } = einstellung.grenzen;
            return {
                key: "admin.karteneinstellungen.invalid.pointRange",
                params: { minX: zahl(minX, 2), maxX: zahl(maxX, 2), minY: zahl(minY, 2), maxY: zahl(maxY, 2) },
            };
        }
        case "reisebeginn": {
            const tage =
                typeof wert === "object" && "monat" in wert && wert.monat === "namenlos"
                    ? REISEBEGINN_NAMENLOSE_TAGE
                    : REISEBEGINN_TAGE;
            return {
                key: "admin.karteneinstellungen.invalid.day",
                params: { min: String(tage.min), max: String(tage.max) },
            };
        }
        case "auswahl":
        case "schalter":
            return { key: "admin.karteneinstellungen.invalid.choice" };
        case "farbe":
            return { key: "admin.karteneinstellungen.invalid.colour" };
        case "text":
            return { key: "admin.karteneinstellungen.invalid.text", params: { max: String(einstellung.maxLaenge) } };
        case "kurve":
            return {
                key: "admin.karteneinstellungen.invalid.curve",
                params: {
                    min: String(einstellung.punkte.min),
                    max: String(einstellung.punkte.max),
                    zoomMin: zahl(einstellung.zoom.min - 1, 1),
                    zoomMax: zahl(einstellung.zoom.max - 1, 1),
                    neigungMin: zahl(einstellung.neigung.min, 0),
                    neigungMax: zahl(einstellung.neigung.max, 0),
                },
            };
    }
}

/**
 * Liest die Felder einer Einstellung zu ihrem Wert; `Phrase`, wenn das nicht geht. `texte` sind die getippten Felder, die
 * übrigen nimmt sie aus `stehend` (dem geltenden Wert): Ein Punkt, an dem nur x getippt wurde, behält sein y; ein
 * Reisebeginn, an dem nur der Monat gewählt wurde, behält seinen Tag (sonst der 1.).
 */
export function leseEingabe(
    einstellung: Karteneinstellung,
    texte: Readonly<Record<string, string | undefined>>,
    stehend: KartenWert,
): KartenWert | Phrase {
    const stehendeTexte = felderText(einstellung, stehend);
    const text = (teil?: "x" | "y" | "monat" | "tag"): string => {
        const id = feldId(einstellung.id, teil);
        return texte[id] ?? stehendeTexte[id] ?? "";
    };
    let wert: KartenWert;
    switch (einstellung.art) {
        case "zahl": {
            const z = leseZahl(text());
            if (z === null) return { key: "admin.karteneinstellungen.invalid.number" };
            wert = z;
            break;
        }
        case "punkt": {
            const x = leseZahl(text("x"));
            const y = leseZahl(text("y"));
            if (x === null || y === null) return { key: "admin.karteneinstellungen.invalid.number" };
            wert = { x, y };
            break;
        }
        case "auswahl":
            wert = text();
            break;
        case "farbe":
            wert = text().trim().toLowerCase();
            break;
        case "text":
            wert = text().replace(/\s+/g, " ").trim();
            break;
        case "schalter":
            wert = text() === "true";
            break;
        case "reisebeginn": {
            const monat = text("monat");
            if (monat === "unbestimmt") {
                wert = "unbestimmt";
                break;
            }
            const tag = leseZahl(text("tag"));
            if (tag === null) return { key: "admin.karteneinstellungen.invalid.number" };
            wert = { monat, tag };
            break;
        }
        case "kurve": {
            try {
                wert = JSON.parse(text()) as KartenWert;
            } catch {
                return grenzenSatz(einstellung);
            }
            break;
        }
    }
    return karteneinstellungImRahmen(einstellung, wert) ? wert : grenzenSatz(einstellung, wert);
}

const istPhrase = (wert: KartenWert | Phrase): wert is Phrase => typeof wert === "object" && "key" in wert;

/**
 * Die Ansicht der Karte hinter dem Fenster, aus der Adresse gelesen (`#x=…&y=…&z=…`, `map/view-state.ts`). `null`, wenn die
 * Adresse keine vollständige Ansicht trägt oder sie nicht in die Grenzen der Einstellungen passt. Gerundet auf zwei Stellen,
 * die Genauigkeit des Felds.
 */
export function kartenansichtAusAdresse(hash: string): { startPosition: KartenPunkt; startZoom: number } | null {
    const parameter = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const runde = (text: string | null): number => Math.round(Number.parseFloat(text ?? "") * 100) / 100;
    const startPosition = { x: runde(parameter.get("x")), y: runde(parameter.get("y")) };
    const startZoom = runde(parameter.get("z"));
    const position = karteneinstellung("startPosition");
    const zoom = karteneinstellung("startZoom");
    if (position === undefined || zoom === undefined) return null;
    if (!karteneinstellungImRahmen(position, startPosition) || !karteneinstellungImRahmen(zoom, startZoom)) return null;
    return { startPosition, startZoom };
}

// --- Zustand des Eintrags ----------------------------------------------------------------------------------------------------------

export interface KarteneinstellungenDeps {
    fetcher?: Fetcher;
    ask?: (need: Need) => Promise<boolean>;
    reads?: ReadConfirmation;
}

export interface Karteneinstellungen {
    stand: Ref<AdminKarteneinstellungen | null>;
    loading: Ref<boolean>;
    loadProblems: Ref<Phrase[]>;
    unconfirmed: Ref<Need | null>;
    confirmAgain(): void;
    /** Die Kennung, die gerade geschrieben wird (`ansicht` beim Übernehmen der Kartenansicht). */
    busy: Ref<string | null>;
    /** Die Antwort des letzten Schreibwegs, an ihrer Kennung. */
    ergebnis: Ref<{ id: string; result: ActionResult } | null>;
    /** Was in den Feldern steht, solange jemand tippt, je Feldkennung. */
    felder: Ref<Record<string, string>>;
    /** Das Problem je Einstellung, solange es nicht übernommen ist. */
    probleme: Ref<Record<string, Phrase>>;
    load(): Promise<void>;
    tippe(feld: string, text: string): void;
    /** Die getippten Felder einer Einstellung übernehmen; unverändert oder fehlerhaft: nichts. */
    uebernimm(id: string): Promise<void>;
    zuruecksetzen(id: string): Promise<void>;
    /** Eine Wahl (Auswahl, Kästchen, Monat) setzen und sofort übernehmen: Hier tippt niemand. */
    waehle(feld: string, wert: string): Promise<void>;
    /** Mitte und Zoom der Karte als Startansicht übernehmen; nur, was sich unterscheidet, wird geschrieben. */
    uebernimmAnsicht(ansicht: { startPosition: KartenPunkt; startZoom: number }): Promise<void>;
}

export function createKarteneinstellungen(deps: KarteneinstellungenDeps = {}): Karteneinstellungen {
    const stand = ref<AdminKarteneinstellungen | null>(null);
    const loading = ref(false);
    const loadProblems = ref<Phrase[]>([]);
    const unconfirmed = ref<Need | null>(null);
    const busy = ref<string | null>(null);
    const ergebnis = ref<{ id: string; result: ActionResult } | null>(null);
    const felder = ref<Record<string, string>>({});
    const probleme = ref<Record<string, Phrase>>({});
    const ask = deps.ask ?? requestConfirmation;
    const reads = deps.reads ?? createReadConfirmation(ask);
    reads.onOffer(() => (unconfirmed.value === null ? undefined : load()));
    let ticket = 0;

    async function load(): Promise<void> {
        const mine = ++ticket;
        loading.value = true;
        try {
            const body = await withConfirmation(
                () => getJson<AdminKarteneinstellungen>(KARTENEINSTELLUNGEN_URL, deps.fetcher),
                reads.ask,
            );
            if (mine !== ticket) return;
            stand.value = body;
            loadProblems.value = [];
            unconfirmed.value = null;
        } catch (error) {
            if (mine === ticket) {
                loadProblems.value = formProblems(error);
                unconfirmed.value = neededConfirmation(error);
            }
        } finally {
            if (mine === ticket) loading.value = false;
        }
    }

    /** Der geltende Wert einer Einstellung: die Abweichung, wo es eine gibt, sonst die Vorgabe. */
    const geltend = (einstellung: Karteneinstellung): KartenWert =>
        stand.value?.rows.find((row) => row.id === einstellung.id)?.value ?? einstellung.vorgabe;

    const feldIds = (einstellung: Karteneinstellung): string[] =>
        Object.keys(felderText(einstellung, einstellung.vorgabe));

    function tippe(feld: string, text: string): void {
        felder.value = { ...felder.value, [feld]: text };
        const id = feld.split(".")[0] ?? feld;
        const offen = { ...probleme.value };
        delete offen[id];
        probleme.value = offen;
    }

    /** Die Felder wieder an den Stand des Servers binden (nach einem Schreibweg oder einem Abbruch). */
    function loese(einstellung: Karteneinstellung): void {
        const offeneFelder = { ...felder.value };
        for (const feld of feldIds(einstellung)) delete offeneFelder[feld];
        felder.value = offeneFelder;
        const offeneProbleme = { ...probleme.value };
        delete offeneProbleme[einstellung.id];
        probleme.value = offeneProbleme;
    }

    /** Schreibt einen Wert; `false`, wenn es nicht geklappt hat (die Meldung steht dann an der Einstellung). */
    async function schreibe(einstellung: Karteneinstellung, value: KartenWert | null): Promise<boolean> {
        const s = stand.value;
        if (s === null || s.revision === null) return false;
        ergebnis.value = null;
        try {
            const body = { operationId: newOperationId(), baseRevision: s.revision, id: einstellung.id, value };
            await withConfirmation(() => postJson<OperationReceipt>(KARTENEINSTELLUNGEN_URL, body, deps.fetcher), ask);
            loese(einstellung);
            await load();
            return true;
        } catch (error) {
            const failure = error instanceof ApiFailure ? error : undefined;
            let result: ActionResult;
            if (failure?.code === "reauth_required" || failure?.code === "assurance_required") {
                reads.decline();
                result = { ok: false, problems: [{ key: "admin.system.error.notConfirmed" }] };
            } else if (failure?.code === "edit_conflict") {
                const by =
                    (failure.details?.["changedBy"] as { displayName?: string } | undefined)?.displayName ?? null;
                const at = typeof failure.details?.["changedAt"] === "string" ? failure.details["changedAt"] : null;
                result = { ok: false, problems: formProblems(error), conflict: { by, at } };
            } else {
                result = { ok: false, problems: formProblems(error) };
            }
            ergebnis.value = { id: einstellung.id, result };
            await load();
            return false;
        }
    }

    /** Schreibt, wenn sich etwas ändert; zurück auf die Vorgabe heißt die Abweichung löschen, nicht die Vorgabe speichern. */
    async function setze(einstellung: Karteneinstellung, wert: KartenWert): Promise<boolean> {
        if (karteneinstellungGleich(wert, geltend(einstellung))) {
            loese(einstellung);
            return true;
        }
        return schreibe(einstellung, karteneinstellungGleich(wert, einstellung.vorgabe) ? null : wert);
    }

    async function uebernimm(id: string): Promise<void> {
        const einstellung = karteneinstellung(id);
        if (einstellung === undefined || busy.value !== null) return;
        const getippt = Object.fromEntries(feldIds(einstellung).map((feld) => [feld, felder.value[feld]]));
        if (Object.values(getippt).every((text) => text === undefined)) return;
        if (Object.values(getippt).some((text) => text !== undefined && text.trim() === "")) {
            loese(einstellung);
            return;
        }
        const wert = leseEingabe(einstellung, getippt, geltend(einstellung));
        if (istPhrase(wert)) {
            probleme.value = { ...probleme.value, [id]: wert };
            return;
        }
        busy.value = id;
        await setze(einstellung, wert);
        busy.value = null;
    }

    async function zuruecksetzen(id: string): Promise<void> {
        const einstellung = karteneinstellung(id);
        if (einstellung === undefined || busy.value !== null) return;
        if (stand.value?.rows.every((row) => row.id !== id) ?? true) {
            loese(einstellung);
            return;
        }
        busy.value = id;
        await schreibe(einstellung, null);
        busy.value = null;
    }

    async function uebernimmAnsicht(ansicht: { startPosition: KartenPunkt; startZoom: number }): Promise<void> {
        const position = karteneinstellung("startPosition");
        const zoom = karteneinstellung("startZoom");
        if (position === undefined || zoom === undefined || busy.value !== null) return;
        busy.value = "ansicht";
        // Nacheinander: Jeder Schreibweg braucht die Revision, die der vorige hinterlassen hat. Scheitert der erste, bleibt
        // der zweite liegen, damit keine halbe Ansicht entsteht, ohne dass es jemand sieht.
        if (await setze(position, ansicht.startPosition)) await setze(zoom, ansicht.startZoom);
        busy.value = null;
    }

    return {
        stand,
        loading,
        loadProblems,
        unconfirmed,
        confirmAgain: () => reads.offer(),
        busy,
        ergebnis,
        felder,
        probleme,
        load,
        tippe,
        uebernimm,
        zuruecksetzen,
        waehle: async (feld, wert) => {
            tippe(feld, wert);
            await uebernimm(feld.split(".")[0] ?? feld);
        },
        uebernimmAnsicht,
    };
}
