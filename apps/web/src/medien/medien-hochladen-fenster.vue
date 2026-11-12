<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from "vue";
import type {
    MamAssetSummary,
    MediaCreationMethod,
    MediaUploadForm,
    MediaLicenseInfo,
    MediaSubjectSlots,
    MediaUsagePublication,
    MediaUsageResult,
    MediaUsageSubject,
} from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { authState } from "../auth/session-state";
import { t } from "../i18n/i18n";
import { createMedienClient, istAbbruch, type MedienClient } from "./medien-client";
import {
    duplikatKonflikte,
    duplikatLage,
    duplikatSperre,
    sha256Hex,
    type DuplikatLage,
} from "./medien-duplikat-modell";
import MedienDuplikatHinweis from "./medien-duplikat-hinweis.vue";
import {
    befundeJeFeld,
    belegFelder,
    freigabeSatzVorher,
    leererStand,
    pruefeFormular,
    zuFormular,
    type BindbareRolle,
    type HochladeRolle,
    type HochladenWeg,
} from "./medien-formular-modell";
import MedienHochladen from "./medien-hochladen.vue";
import {
    karteHochladenUndBinden,
    namensKonflikt,
    typDerRolle,
    versionsBezeichnung,
    vorbelegterTitel,
    type KartenRolle,
} from "./medien-karte-neu-modell";
import { zahl } from "./medien-text";
import MedienStapelListe from "./medien-stapel-liste.vue";
import {
    neueZeile,
    pruefeZeile,
    sendeStapel,
    zuSenden,
    type StapelSchritte,
    type StapelZeile,
} from "./medien-stapel-modell";
import { oeffneMedien } from "./medien-oeffnen";
import { bildMasse, wappenSatz, wappenUrteil, type WappenUrteil } from "./medien-wappen-pruefung";
import {
    bindeAsset,
    bindungAusPlaetzen,
    createMedienOperationen,
    dateiFuerAnfrage,
    hochladenUndBinden,
    neuerAblauf,
    operationsFehler,
    type MedienOperationen,
    type OperationsFehler,
} from "./medien-operationen";

/**
 * Das Fenster „Neues Wappen/Titelbild hochladen“ (WI-0068 P4b, WI-0126 §11j): EIN Fenster für das MAM-Fenster und den Ortseditor
 * (EDIT-0001 E19). Modal über Karte und Werkzeugfenstern, wie im Gesamtmockup.
 *
 * - **Mit `ziel`** (Ortseditor) lädt es hoch und bindet danach: zwei Operationen auf einen Klick, ein Verlaufseintrag am Ort. Die
 *   Bindung kommt aus den Plätzen (`bindungAusPlaetzen`). Scheitert das Binden, bleibt das Asset; „Erneut binden“ lädt die Plätze neu
 *   und sendet nur das Binden, nie ein zweites Hochladen.
 * - **Ohne `ziel`** (MAM-Fenster) lädt es nur hoch.
 * - Befunde erscheinen erst nach dem ersten Versuch, dann bei jeder Eingabe neu; die des Servers fallen an dieselben Felder.
 * - 🔴 Der Satz unter dem Formular kommt aus der Policy des Servers (`publication-preview`); öffentlich wird nichts durch das Formular.
 * - 🔴 **Gibt es die Datei schon** (gleiche SHA-256 des Originals, Betreiber 2026-10-17), steht statt des Hochladens „Dieses Bild gibt
 *   es bereits!“ mit dem vorhandenen Werk da, und „Vorhandenes Bild verwenden“ nimmt es: mit `ziel` über dieselbe Bindung wie nach
 *   dem Hochladen (`bindeAsset`), ohne `ziel` als Ergebnis an den Aufrufer. Ein zweites Werk, neue Rechte oder Entstehungsdaten
 *   entstehen nicht; der Server lehnt dieselben Bytes ohnehin ab (`media_already_exists`).
 * - **Mit `galerie`** (Stapel, WI-0068 MAM-R3, Blatt P6 Abschnitt 2): mehrere Dateien auf einmal in diese Galerie, eine Reihe mit einem
 *   Ergebnis je Datei (`medien-stapel-modell.ts`). Rechte und Entstehung stehen EINMAL im Formular und gelten je Bild; den Titel vergibt
 *   die Galerie beim Einordnen nach der Namensregel. Dateien, die es schon gibt, stehen als „bereits vorhanden“ da und werden übernommen
 *   statt hochgeladen.
 * - **Mit `eintrag`** (Kartensammlung, WI-0287, Rolle `map_full` oder `map_preview`): lädt die Datei als Rohkörper hoch (Karte bis 50 MB, Vorschau bis 6 MB) und bindet das neue Werk
 *   danach an diesen Eintrag, gegen die Revision, die der Aufrufer gesehen hat. Der Name ist vorbelegt (`Karte von „Titel“`); gibt es ihn in der Liste schon, steht ein Hinweis mit
 *   „⇄ Vorhandenes verwenden“ da, hochladen bleibt möglich. Scheitert das Binden, bleibt das Werk liegen, der Hinweis sagt es, und „Erneut binden“ lädt nicht noch einmal hoch.
 *   Eine Karte kommt seit Stufe 2 als weitere Version dazu: Das Feld „Version“ nimmt ihre Bezeichnung auf, und hat der Eintrag schon eine, heißt das Fenster „Weitere Version für „…“ hochladen“.
 * - **Mit der Rolle `social_post`** (Social Hub, WI-0278): nur hochladen, ohne Fachobjekt und ohne Bindung; das Bild landet in der Kategorie „Social Media Posts“. Der Name kommt vorerst aus dem
 *   Dateinamen, und der Satz unter dem Formular sagt, dass erst die bestätigten Rechte das Bild öffentlich machen. Das Ergebnis trägt die Datei, damit der Aufrufer sofort eine Vorschau hat: Die des
 *   Servers rechnet der Abgleich erst noch.
 */
const props = defineProps<{
    rolle: HochladeRolle;
    /** Woran gebunden wird; ohne nur hochladen. */
    ziel?: { name: string; plaetze: MediaSubjectSlots } | undefined;
    weg: HochladenWeg;
    /** Steht eine Auswahl davor, führt „‹ Zurück zur Auswahl“ dorthin. */
    zurueck?: boolean | undefined;
    operationen?: MedienOperationen | undefined;
    client?: MedienClient | undefined;
    /** Stapel: mehrere Dateien in diese Galerie (Revision und Zahl der Bilder wie gesehen, Name für den Kopf). */
    galerie?: { id: string; revision: number; anzahl: number; name: string } | undefined;
    /**
     * Karte oder Vorschau eines Eintrags der Kartensammlung (WI-0287): Hochladen und an diesen Eintrag binden (gesehene Revision, Zeichner als Urheber-Vorgabe). `versionen`
     * (Stufe 2): wie viele Karten der Eintrag schon hat; eine Karte bekommt dann das Feld „Version“, und ab einer heißt das Fenster „Weitere Version für „…“ hochladen“.
     */
    eintrag?:
        | { id: string; revision: number; titel: string; zeichner: string | null; versionen?: number | undefined }
        | undefined;
    /** Nur diese Entstehungen (WI-0281: das Ohne-KI-Typbild), mit dem Satz dazu; sonst jede. */
    entstehungen?: readonly MediaCreationMethod[] | undefined;
    entstehungSatz?: string | undefined;
}>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{
    fertig: [ergebnis: { assetId: string; gebunden: boolean; datei?: File | undefined; titel?: string | undefined }];
    zurueck: [];
    /** Ein Stapel hat etwas in die Galerie gelegt: Der Aufrufer lädt sie neu. */
    stapel: [];
}>();

const ops = props.operationen ?? createMedienOperationen();
const client = props.client ?? createMedienClient();

// --- Stapel: mehrere Dateien in eine Galerie (WI-0068 MAM-R3) ---

/** Der Platzhalter im Namensfeld des Stapels: Mit ihm sagt das Formular „Titel aus der Bindung“ (`zuFormular`). */
const STAPEL_TITEL = "⟨stapel⟩";
const stapel = computed(() => props.galerie !== undefined);
const zeilen = shallowRef<StapelZeile[]>([]);
const takt = ref(0);
const melde = (): void => {
    takt.value += 1;
};
const zeilenAnsicht = computed(() => (takt.value, [...zeilen.value]));
const zuSendenZahl = computed(() => zeilenAnsicht.value.filter(zuSenden).length);
let galerieStand = { revision: 0, anzahl: 0 };
let stapelAbbruch = new AbortController();

function stapelDateien(dateien: File[]): void {
    for (const neu of dateien) {
        const zeile = neueZeile(neu);
        zeilen.value = [...zeilen.value, zeile];
        void pruefeZeile(zeile, client, sha256Hex, stapelAbbruch.signal).then(melde);
    }
}
function stapelUebernehmen(zeile: StapelZeile, wert: boolean): void {
    zeile.uebernehmen = wert;
    melde();
}
function stapelEntfernen(zeile: StapelZeile): void {
    zeilen.value = zeilen.value.filter((eintrag) => eintrag !== zeile);
}
function stapelSchritte(form: MediaUploadForm | undefined, galleryId: string): StapelSchritte {
    return {
        hochladen: async (zeile, operationId) => {
            if (form === undefined) throw new Error("Formular unvollständig");
            return ops.hochladen(operationId, await dateiFuerAnfrage(zeile.datei), form);
        },
        einordnen: (assetId, baseRevision, operationId) =>
            ops.galerieBildHinzu({ operationId, galleryId, baseRevision, assetId }),
        fehlerText: (error) => operationsFehler(error).text,
    };
}
/** Karte oder Vorschau der Kartensammlung (WI-0287): eigener Weg (Rohkörper, Binden an den Eintrag), keine Plätze eines Ortes. */
const kartenRolle = computed<KartenRolle | undefined>(() =>
    props.rolle === "map_full" || props.rolle === "map_preview" ? props.rolle : undefined,
);
const rolleWort = computed(() =>
    t(
        props.rolle === "coat"
            ? "medien.formular.nomenWappen"
            : props.rolle === "map_full"
              ? "medien.formular.nomenKarte"
              : props.rolle === "map_preview"
                ? "medien.formular.nomenKartenvorschau"
                : "medien.formular.nomenBild",
    ),
);
/** Der Name nach der Namensregel (7b), vom Server mit den Plätzen geliefert; ohne ihn (Vorversion) der einfache Satz. */
const regelName = (): string | undefined =>
    props.rolle === "social_post" || kartenRolle.value !== undefined
        ? undefined
        : (props.ziel?.plaetze.suggestedTitles?.[props.rolle as BindbareRolle] ?? undefined);
/** Die Bindung aus den Plätzen; ein Bild des Social Hubs und eine Karte bindet nichts hier (die Karte bindet `karteHochladenUndBinden`). */
const bindungJetzt = (): ReturnType<typeof bindungAusPlaetzen> | undefined =>
    plaetze.value === undefined || props.rolle === "social_post" || kartenRolle.value !== undefined
        ? undefined
        : bindungAusPlaetzen(plaetze.value, props.rolle as BindbareRolle);
const vorschlag = (): string =>
    props.eintrag !== undefined && kartenRolle.value !== undefined
        ? vorbelegterTitel(kartenRolle.value, props.eintrag.titel)
        : props.ziel === undefined
          ? ""
          : (regelName() ??
            t(props.rolle === "coat" ? "medien.formular.nameWappen" : "medien.formular.nameBild", {
                ort: props.ziel.name,
            }));

/** Betreiber 2026-11-06 (WI-0282): Wer prüfen darf, gibt beim Hochladen gleich frei. Das Bild des Social Hubs bestätigt, wer den Beitrag freigibt. */
const kannFreigeben = computed(
    () => props.rolle !== "social_post" && authState.value.capabilities.includes("review_media_rights"),
);
const stand = ref(leererStand(vorschlag(), kannFreigeben.value));
const datei = shallowRef<File | undefined>(undefined);
const lizenzen = shallowRef<readonly MediaLicenseInfo[]>([]);
const vorschau = shallowRef<MediaUsagePublication | undefined>(undefined);
const plaetze = shallowRef<MediaSubjectSlots | undefined>(props.ziel?.plaetze);
const ablauf = shallowRef(neuerAblauf());
/** Die Revision des Eintrags, wie zuletzt gesehen; nach einem Konflikt beim Binden frisch gelesen. */
const eintragRevision = ref(props.eintrag?.revision ?? 0);
/** Nur eine Karte der Kartensammlung (WI-0287 Stufe 2): die Bezeichnung der neuen Version. */
const version = ref("");
const vorhandeneVersionen = computed(() => props.eintrag?.versionen ?? 0);
/** Der Satz unter dem Feld „Version“ (Entwurf `f-version`); ohne Karte kein Feld. */
const versionSatz = computed(() =>
    kartenRolle.value !== "map_full" || props.eintrag === undefined
        ? undefined
        : vorhandeneVersionen.value === 0
          ? t("medien.karten.version.leer")
          : vorhandeneVersionen.value === 1
            ? t("medien.karten.version.schonEine")
            : t("medien.karten.version.schonMehrere", { n: zahl(vorhandeneVersionen.value) }),
);
/** Was das Binden an den Eintrag mitschickt: bei einer Karte die Bezeichnung, wenn eine dasteht. */
const versionMit = (rolle: KartenRolle): { versionLabel?: string } => {
    const bezeichnung = versionsBezeichnung(version.value);
    return rolle === "map_full" && bezeichnung !== null ? { versionLabel: bezeichnung } : {};
};
const versucht = ref(false);
const sendet = ref(false);
const fehler = shallowRef<OperationsFehler | undefined>(undefined);
const serverBefunde = shallowRef<OperationsFehler["befunde"]>([]);
const rumpf = useTemplateRef<HTMLElement>("rumpf");

const hochlader = computed(() => authState.value.person?.displayName ?? t("medien.formular.hochladerUnbekannt"));
const nurNochBinden = computed(() => ablauf.value.assetId !== undefined);

/** Die Datei der Prüfung: die gewählte, im Stapel die erste (jede weitere prüft der Server einzeln). */
const ersteDatei = computed(() => (props.galerie === undefined ? datei.value : zeilenAnsicht.value[0]?.datei));
const lokaleBefunde = computed(() =>
    pruefeFormular(stand.value, props.rolle, {
        lizenzen: lizenzen.value,
        entstehungen: props.entstehungen,
        datei:
            ersteDatei.value === undefined
                ? undefined
                : { sizeBytes: ersteDatei.value.size, type: ersteDatei.value.type },
    }),
);
/**
 * Die Vorprüfung eines Wappens (Betreiber 2026-10-10): zu klein oder ohne durchsichtigen Hintergrund weist sie sofort ab, nicht
 * quadratisch sagt sie an (der Worker füllt auf). Sie gilt sofort nach der Wahl der Datei, nicht erst nach dem ersten Versuch.
 */
const wappen = shallowRef<{ urteil: WappenUrteil; satz: string | undefined } | undefined>(undefined);
let wappenLauf = 0;
watch(datei, async (neu) => {
    wappen.value = undefined;
    if (neu === undefined || props.rolle !== "coat") return;
    const lauf = ++wappenLauf;
    const masse = await bildMasse(neu);
    if (lauf !== wappenLauf || masse === undefined) return;
    const urteil = wappenUrteil(masse);
    wappen.value = { urteil, satz: wappenSatz(urteil, masse) };
});
const wappenAbgewiesen = computed(() => wappen.value?.urteil.ablehnung !== undefined);
// Ein Bild für den Social Hub bekommt seinen Namen vorerst aus der Datei: Dort gibt es kein Objekt, das ihn vorschlägt.
watch(datei, (neu) => {
    if (neu === undefined || props.rolle !== "social_post" || stand.value.titel.trim() !== "") return;
    stand.value.titel = neu.name.replace(/\.[^.]+$/u, "");
});

// --- Gibt es den Namen in der Liste schon? (Kartensammlung, WI-0287) ---

/** Das Werk der Liste (Karten oder Kartenvorschauen), das schon so heißt wie das Namensfeld; Hochladen bleibt trotzdem möglich. */
const konflikt = shallowRef<MamAssetSummary | undefined>(undefined);
let konfliktUhr: ReturnType<typeof setTimeout> | undefined;
let konfliktAbbruch: AbortController | undefined;
const KONFLIKT_RUHE_MS = 250;

watch(
    () => [stand.value.titel, offen.value] as const,
    ([titel, jetzt]) => {
        const rolle = kartenRolle.value;
        if (konfliktUhr !== undefined) clearTimeout(konfliktUhr);
        konfliktAbbruch?.abort();
        if (rolle === undefined || props.eintrag === undefined || !jetzt || titel.trim() === "") {
            konflikt.value = undefined;
            return;
        }
        konfliktUhr = setTimeout(() => {
            const abbruch = new AbortController();
            konfliktAbbruch = abbruch;
            client
                .suche({ q: titel.trim(), type: typDerRolle(rolle), ohneReisebilder: true, limit: 20 }, abbruch.signal)
                .then((antwort) => {
                    if (!abbruch.signal.aborted) konflikt.value = namensKonflikt(titel, antwort.items);
                })
                .catch(() => {
                    // Ohne Antwort bleibt es ein gewöhnliches Hochladen; der Hinweis ist eine Auskunft, kein Schutz.
                    if (!abbruch.signal.aborted) konflikt.value = undefined;
                });
        }, KONFLIKT_RUHE_MS);
    },
);

// --- Gibt es die Datei schon? (Betreiber 2026-10-17) ---

const duplikat = shallowRef<DuplikatLage | undefined>(undefined);
const duplikatWahl = ref("");
const duplikatVerwendung = shallowRef<MediaUsageResult | undefined>(undefined);
let duplikatAbbruch: AbortController | undefined;
let verwendungAbbruch: AbortController | undefined;

async function pruefeDuplikat(neu: File | undefined): Promise<void> {
    duplikatAbbruch?.abort();
    duplikat.value = undefined;
    if (neu === undefined) return;
    const abbruch = new AbortController();
    duplikatAbbruch = abbruch;
    try {
        const lage = duplikatLage(await client.gleicheBytes(await sha256Hex(neu), abbruch.signal));
        if (abbruch.signal.aborted) return;
        if (lage !== undefined) duplikatWahl.value = lage.vorschlag.id;
        duplikat.value = lage;
        if (lage !== undefined) {
            await nextTick();
            rumpf.value?.querySelector('[data-testid="medien-duplikat"]')?.scrollIntoView({ block: "nearest" });
        }
    } catch {
        // Ohne Antwort bleibt es ein gewöhnliches Hochladen; der Server prüft beim Senden selbst (`media_already_exists`).
    }
}
watch(datei, (neu) => void pruefeDuplikat(neu));

watch([duplikat, duplikatWahl], async ([lage, id]) => {
    verwendungAbbruch?.abort();
    duplikatVerwendung.value = undefined;
    if (lage === undefined || id === "") return;
    const abbruch = new AbortController();
    verwendungAbbruch = abbruch;
    try {
        duplikatVerwendung.value = await client.verwendung(id, abbruch.signal);
    } catch {
        // Ohne Verwendungen bleibt der Satz „wird geladen“; die Übernahme hängt nicht daran.
    }
});

const duplikatGewaehlt = computed(() => duplikat.value?.treffer.find((treffer) => treffer.id === duplikatWahl.value));
const duplikatKonflikteJetzt = computed(() =>
    duplikat.value === undefined || duplikatGewaehlt.value === undefined
        ? []
        : duplikatKonflikte(duplikat.value, duplikatGewaehlt.value, props.rolle),
);
/** Warum „Vorhandenes Bild verwenden“ nicht geht; nur mit Platz (Ortseditor): falscher Typ oder hängt schon hier. */
const duplikatGesperrt = computed(() => {
    const id = duplikatGewaehlt.value?.id;
    if (id === undefined) return undefined;
    // Bei einer Karte gibt es keinen Platz: Die Art des Werks entscheidet, ob es an den Eintrag darf (sonst 409 `media_type_mismatch`).
    if (kartenRolle.value !== undefined) {
        return duplikatKonflikteJetzt.value.includes("typ") ? t("medien.duplikat.typKurz") : undefined;
    }
    const sperre =
        props.rolle === "social_post"
            ? undefined
            : duplikatSperre(duplikatKonflikteJetzt.value, plaetze.value, props.rolle as BindbareRolle, id);
    if (sperre === "schonHier") return t("medien.duplikat.schonHier");
    return sperre === "typ" ? t("medien.duplikat.typKurz") : undefined;
});

/** Ein Verweis im Hinweis führt in die Medienverwaltung; das Hochladen schließt dabei. */
function zuObjekt(subjekt: MediaUsageSubject): void {
    offen.value = false;
    oeffneMedien({ von: { kind: subjekt.kind, id: subjekt.id, name: subjekt.name } });
}
function zuAsset(id: string): void {
    offen.value = false;
    oeffneMedien({ asset: id });
}
const befunde = computed(() => {
    const je = new Map(
        versucht.value
            ? befundeJeFeld(
                  [...lokaleBefunde.value, ...serverBefunde.value],
                  props.rolle === "social_post" || props.rolle === "coat" || props.rolle === "header"
                      ? undefined
                      : props.rolle,
              )
            : new Map<string, string>(),
    );
    if (wappenAbgewiesen.value && wappen.value?.satz !== undefined) je.set("file", wappen.value.satz);
    return je;
});
const dateiHinweis = computed(() => (wappenAbgewiesen.value ? undefined : wappen.value?.satz));
const satz = computed(() =>
    props.rolle === "social_post"
        ? { text: t("medien.formular.satz.social"), ton: "neutral" as const }
        : freigabeSatzVorher(
              stand.value.rechte.grundlage,
              vorschau.value,
              rolleWort.value,
              props.eintrag?.titel ?? props.ziel?.name,
          ),
);

// --- Laden: Lizenzkatalog beim Öffnen, Vorschau der Policy bei jeder Änderung von Grundlage oder Lizenz ---

let lizenzAbbruch: AbortController | undefined;
let vorschauAbbruch: AbortController | undefined;

function neuAnfangen(): void {
    stand.value = leererStand(vorschlag(), kannFreigeben.value);
    // Der Zeichner des Eintrags ist der Urheber der Karte, solange niemand etwas anderes eintippt (Entwurf: „Zeichner“ wird „Urheber“).
    if (props.eintrag?.zeichner) stand.value.rechte.urheber = props.eintrag.zeichner;
    eintragRevision.value = props.eintrag?.revision ?? 0;
    konflikt.value = undefined;
    datei.value = undefined;
    vorschau.value = undefined;
    plaetze.value = props.ziel?.plaetze;
    ablauf.value = neuerAblauf();
    versucht.value = false;
    fehler.value = undefined;
    serverBefunde.value = [];
    duplikat.value = undefined;
    duplikatWahl.value = "";
    if (props.galerie !== undefined) {
        stand.value = leererStand(STAPEL_TITEL, kannFreigeben.value);
        stapelAbbruch.abort();
        stapelAbbruch = new AbortController();
        zeilen.value = [];
        galerieStand = { revision: props.galerie.revision, anzahl: props.galerie.anzahl };
    }
}

watch(
    offen,
    async (jetzt) => {
        if (!jetzt) return;
        neuAnfangen();
        lizenzAbbruch?.abort();
        lizenzAbbruch = new AbortController();
        const signal = lizenzAbbruch.signal;
        try {
            lizenzen.value = (await ops.lizenzen(signal)).licenses;
        } catch (error) {
            if (!istAbbruch(error, signal)) fehler.value = operationsFehler(error);
        }
    },
    { immediate: true },
);

watch(
    () => [stand.value.rechte.grundlage, stand.value.rechte.lizenz, stand.value.freigeben, offen.value] as const,
    async ([grundlage, lizenz, freigeben, jetzt]) => {
        vorschauAbbruch?.abort();
        vorschau.value = undefined;
        if (!jetzt || grundlage === "") return;
        vorschauAbbruch = new AbortController();
        const signal = vorschauAbbruch.signal;
        try {
            vorschau.value = await ops.freigabeVorschau(
                {
                    role: props.rolle,
                    basis: grundlage,
                    ...(grundlage === "license" && lizenz !== "" ? { licenseKey: lizenz } : {}),
                    ...(freigeben && grundlage !== "unknown" ? { clearance: "cleared" as const } : {}),
                },
                signal,
            );
        } catch {
            // Ohne Antwort bleibt der Satz „wird nachgesehen“; das Hochladen hängt nicht daran.
        }
    },
);

watch(
    stand,
    () => {
        serverBefunde.value = [];
    },
    { deep: true },
);

/** Geht das Fenster zu, nachdem hochgeladen, aber nicht gebunden wurde, erfährt der Aufrufer es trotzdem: Das Asset gibt es. */
let gemeldet = false;
watch(offen, (jetzt) => {
    if (jetzt) {
        gemeldet = false;
        return;
    }
    const assetId = ablauf.value.assetId;
    if (!gemeldet && assetId !== undefined) emit("fertig", { assetId, gebunden: false });
    gemeldet = true;
});

onBeforeUnmount(() => {
    lizenzAbbruch?.abort();
    vorschauAbbruch?.abort();
    duplikatAbbruch?.abort();
    verwendungAbbruch?.abort();
    stapelAbbruch.abort();
    konfliktAbbruch?.abort();
    if (konfliktUhr !== undefined) clearTimeout(konfliktUhr);
});

// --- Senden ---

async function zumErstenBefund(): Promise<void> {
    await nextTick();
    rumpf.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}

async function senden(): Promise<void> {
    if (sendet.value) return;
    versucht.value = true;
    fehler.value = undefined;
    if (!nurNochBinden.value && (lokaleBefunde.value.length > 0 || wappenAbgewiesen.value)) {
        await zumErstenBefund();
        return;
    }
    const bild = datei.value;
    sendet.value = true;
    try {
        const belegDatei =
            belegFelder(stand.value.beleg.art).datei && stand.value.beleg.datei !== undefined
                ? await dateiFuerAnfrage(stand.value.beleg.datei)
                : undefined;
        const form = zuFormular(stand.value, props.rolle, belegDatei, regelName());
        if (form === undefined || (bild === undefined && !nurNochBinden.value)) return;
        const eintrag = props.eintrag;
        if (kartenRolle.value !== undefined && eintrag !== undefined) {
            // Karte oder Vorschau: die Datei als Rohkörper, dann an den Eintrag binden (WI-0287).
            const rolle = kartenRolle.value;
            const hochgeladen = await karteHochladenUndBinden(
                ablauf.value,
                (operationId) => ops.karteDatei(operationId, bild as File, form),
                (assetId, operationId) =>
                    ops.karteBildZuweisen(eintrag.id, {
                        operationId,
                        baseRevision: eintragRevision.value,
                        role: rolle,
                        assetId,
                        ...versionMit(rolle),
                    }),
            );
            gemeldet = true;
            emit("fertig", {
                assetId: hochgeladen.assetId,
                gebunden: true,
                datei: bild,
                titel: stand.value.titel.trim(),
            });
            offen.value = false;
            return;
        }
        const bindung = bindungJetzt();
        const ergebnis = await hochladenUndBinden(
            ops,
            ablauf.value,
            () => dateiFuerAnfrage(bild as File),
            form,
            bindung,
        );
        gemeldet = true;
        emit("fertig", { assetId: ergebnis.assetId, gebunden: ergebnis.gebunden !== undefined, datei: bild });
        offen.value = false;
    } catch (error) {
        const meldung = operationsFehler(error);
        // Dieselben Bytes gab es schon (etwa, weil die Frage nach der Dateiwahl nicht ankam): dann der Hinweis, kein Fehler.
        if (meldung.code === "media_already_exists") {
            await pruefeDuplikat(bild);
            if (duplikat.value !== undefined) return;
        }
        fehler.value = meldung;
        serverBefunde.value = meldung.befunde;
        if (meldung.befunde.length > 0) await zumErstenBefund();
        // Beim Binden war der Eintrag anders als gesehen: neu lesen, damit „Erneut binden“ den neuen Stand trägt.
        if (meldung.code === "edit_conflict" && nurNochBinden.value && props.eintrag !== undefined) {
            await liesEintragNeu(props.eintrag.id);
        }
        // Beim Binden war der Platz anders als gesehen: Plätze neu lesen, damit „Erneut binden“ den neuen Stand trägt.
        if (meldung.code === "edit_conflict" && nurNochBinden.value && props.ziel !== undefined) {
            const subjekt = props.ziel.plaetze.subject;
            try {
                plaetze.value = await ops.plaetze(subjekt.kind, subjekt.id, new AbortController().signal);
            } catch {
                // Bleibt der alte Stand, scheitert der nächste Versuch wieder mit Konflikt und sagt es.
            }
        }
    } finally {
        sendet.value = false;
    }
}

/** Die Revision des Eintrags frisch lesen (nach einem Konflikt beim Binden); bleibt der alte Stand, scheitert der nächste Versuch wieder mit Konflikt und sagt es. */
async function liesEintragNeu(id: string): Promise<void> {
    try {
        eintragRevision.value = (await client.karte(id, new AbortController().signal)).revision;
    } catch {
        // siehe oben
    }
}

/** Ein vorhandenes Werk der Liste an den Eintrag binden (Kartensammlung): „Vorhandenes verwenden“ beim Namenskonflikt und bei gleichen Bytes. */
async function bindeVorhandenes(assetId: string, titel: string | null): Promise<void> {
    const eintrag = props.eintrag;
    const rolle = kartenRolle.value;
    if (sendet.value || eintrag === undefined || rolle === undefined) return;
    sendet.value = true;
    fehler.value = undefined;
    try {
        await ablauf.value.binden.fuehreAus((operationId) =>
            ops.karteBildZuweisen(eintrag.id, {
                operationId,
                baseRevision: eintragRevision.value,
                role: rolle,
                assetId,
                ...versionMit(rolle),
            }),
        );
        gemeldet = true;
        emit("fertig", { assetId, gebunden: true, titel: titel ?? undefined });
        offen.value = false;
    } catch (error) {
        const meldung = operationsFehler(error);
        fehler.value = meldung;
        if (meldung.code === "edit_conflict") await liesEintragNeu(eintrag.id);
    } finally {
        sendet.value = false;
    }
}

/**
 * „Vorhandenes Bild verwenden“: mit Platz dieselbe Bindung wie nach dem Hochladen (am Titelbild ersetzt sie, was hängt, Bild oder
 * Galerie, WI-0219; am Wappen wie „Wappen ersetzen“), ohne Platz nur das Ergebnis an den Aufrufer (Inspector, Auswahl).
 */
async function verwenden(): Promise<void> {
    const assetId = duplikatGewaehlt.value?.id;
    if (sendet.value || assetId === undefined || duplikatGesperrt.value !== undefined) return;
    if (kartenRolle.value !== undefined) {
        await bindeVorhandenes(assetId, duplikatGewaehlt.value?.title ?? null);
        return;
    }
    sendet.value = true;
    fehler.value = undefined;
    try {
        const bindung = bindungJetzt();
        if (bindung !== undefined) {
            await ablauf.value.binden.fuehreAus((operationId) => bindeAsset(ops, bindung, assetId, operationId));
        }
        gemeldet = true;
        emit("fertig", { assetId, gebunden: bindung !== undefined });
        offen.value = false;
    } catch (error) {
        const meldung = operationsFehler(error);
        fehler.value = meldung;
        if (meldung.code === "edit_conflict" && props.ziel !== undefined) {
            const subjekt = props.ziel.plaetze.subject;
            try {
                plaetze.value = await ops.plaetze(subjekt.kind, subjekt.id, new AbortController().signal);
            } catch {
                // Bleibt der alte Stand, scheitert der nächste Versuch wieder mit Konflikt und sagt es.
            }
        }
    } finally {
        sendet.value = false;
    }
}

/** Den Stapel senden: je Datei hochladen (oder das vorhandene übernehmen) und einordnen, nacheinander. */
async function stapelSenden(): Promise<void> {
    const galerie = props.galerie;
    if (sendet.value || galerie === undefined) return;
    versucht.value = true;
    fehler.value = undefined;
    if (lokaleBefunde.value.length > 0) {
        await zumErstenBefund();
        return;
    }
    sendet.value = true;
    try {
        const belegDatei =
            belegFelder(stand.value.beleg.art).datei && stand.value.beleg.datei !== undefined
                ? await dateiFuerAnfrage(stand.value.beleg.datei)
                : undefined;
        const form = zuFormular(stand.value, props.rolle, belegDatei, STAPEL_TITEL);
        await sendeStapel(zeilen.value, galerieStand, stapelSchritte(form, galerie.id), melde);
        emit("stapel");
    } catch (error) {
        fehler.value = operationsFehler(error);
    } finally {
        sendet.value = false;
    }
}

/** „↺ Erneut“: nur einordnen, gegen die Revision, die die Galerie JETZT hat. */
async function stapelErneut(zeile: StapelZeile): Promise<void> {
    const galerie = props.galerie;
    if (sendet.value || galerie === undefined) return;
    sendet.value = true;
    try {
        const frisch = await client.galerie(galerie.id, new AbortController().signal);
        galerieStand = { revision: frisch.revision, anzahl: frisch.items.filter((eintrag) => !eintrag.retired).length };
        await sendeStapel([zeile], galerieStand, stapelSchritte(undefined, galerie.id), melde);
        emit("stapel");
    } catch (error) {
        fehler.value = operationsFehler(error);
    } finally {
        sendet.value = false;
    }
}

const hauptText = computed(() => {
    if (nurNochBinden.value) return t("medien.formular.erneutBinden");
    if (props.ziel === undefined) return t("medien.formular.hochladen");
    return t(props.rolle === "coat" ? "medien.formular.hochladenWappen" : "medien.formular.hochladenBild");
});
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="lesen"
        :titel="
            galerie
                ? t('medien.stapel.titel', { name: galerie.name })
                : eintrag && kartenRolle
                  ? t(
                        kartenRolle === 'map_preview'
                            ? 'medien.karten.platz.titelVorschau'
                            : vorhandeneVersionen > 0
                              ? 'medien.karten.version.titelHochladen'
                              : 'medien.karten.platz.titelKarte',
                        {
                            titel: eintrag.titel,
                        },
                    )
                  : t(
                        rolle === 'coat'
                            ? 'medien.formular.titelWappen'
                            : rolle === 'social_post'
                              ? 'medien.formular.titelSocial'
                              : 'medien.formular.titelBild',
                    )
        "
        :zusatz="galerie ? t('medien.stapel.zusatz', { n: zahl(galerie.anzahl) }) : ziel?.name"
        testid="medien-hochladen-fenster"
    >
        <div ref="rumpf" class="hochladen-fenster">
            <MedienDuplikatHinweis
                v-if="duplikat"
                v-model:gewaehlt="duplikatWahl"
                :lage="duplikat"
                :rolle="rolle"
                :konflikte="duplikatKonflikteJetzt"
                :verwendung="duplikatVerwendung"
                @von="zuObjekt"
                @asset="zuAsset"
            />
            <MedienHochladen
                v-model:stand="stand"
                v-model:datei="datei"
                v-model:version="version"
                :version-satz="versionSatz"
                :rolle="rolle"
                :hochlader="hochlader"
                :weg="weg"
                :lizenzen="lizenzen"
                :befunde="befunde"
                :datei-hinweis="dateiHinweis"
                :satz="satz"
                :gesperrt="sendet || nurNochBinden"
                :kann-freigeben="kannFreigeben"
                :ohne-titel="stapel"
                :entstehungen="entstehungen"
                :entstehung-satz="entstehungSatz"
            >
                <template v-if="eintrag" #nach-titel>
                    <p class="hochladen-fenster__klein" data-testid="medien-karte-landet">
                        {{
                            t("medien.karten.platz.landet", {
                                liste: t(
                                    rolle === "map_full" ? "medien.typMehrzahl.map" : "medien.typMehrzahl.map_preview",
                                ),
                            })
                        }}
                    </p>
                    <div v-if="konflikt" class="hochladen-fenster__konflikt" data-testid="medien-karte-konflikt">
                        <AvmHinweis ton="warnung" rolle="status">
                            <span class="hochladen-fenster__konflikt-zeile">
                                <span class="hochladen-fenster__daumen">
                                    <img
                                        v-if="konflikt.preview ?? konflikt.privatePreview"
                                        :src="(konflikt.preview ?? konflikt.privatePreview)!.url"
                                        alt=""
                                    />
                                </span>
                                <span>{{
                                    t("medien.karten.platz.konflikt", {
                                        liste: t(
                                            rolle === "map_full"
                                                ? "medien.typMehrzahl.map"
                                                : "medien.typMehrzahl.map_preview",
                                        ),
                                    })
                                }}</span>
                            </span>
                        </AvmHinweis>
                        <AvmKnopf
                            groesse="zeile"
                            :gesperrt="sendet ? t('medien.formular.laeuft') : undefined"
                            testid="medien-karte-konflikt-verwenden"
                            @click="bindeVorhandenes(konflikt.id, konflikt.title)"
                        >
                            <template #zeichen>⇄</template>
                            {{ t("medien.karten.platz.vorhandenesVerwenden") }}
                        </AvmKnopf>
                    </div>
                </template>
                <template v-if="galerie" #dateien>
                    <MedienStapelListe
                        :zeilen="zeilenAnsicht"
                        :gesperrt="sendet"
                        annehmen="image/png,image/webp,image/jpeg,image/gif"
                        @dateien="stapelDateien"
                        @erneut="stapelErneut"
                        @uebernehmen="stapelUebernehmen"
                        @entfernen="stapelEntfernen"
                    />
                </template>
            </MedienHochladen>
            <AvmHinweis v-if="nurNochBinden" ton="warnung" rolle="status" testid="medien-hochladen-nur-binden">{{
                eintrag
                    ? t("medien.karten.platz.hochgeladenNichtGebunden", {
                          liste: t(rolle === "map_full" ? "medien.typMehrzahl.map" : "medien.typMehrzahl.map_preview"),
                      })
                    : t("medien.formular.hochgeladenNichtGebunden")
            }}</AvmHinweis>
            <AvmHinweis v-if="fehler" :ton="fehler.ton" rolle="alert" testid="medien-hochladen-fehler">{{
                fehler.text
            }}</AvmHinweis>
        </div>
        <template #fuss-haupt>
            <AvmKnopf v-if="zurueck && !nurNochBinden" testid="medien-hochladen-zurueck" @click="emit('zurueck')">{{
                t("medien.formular.zurueckAuswahl")
            }}</AvmKnopf>
            <AvmKnopf testid="medien-hochladen-abbrechen" @click="offen = false">{{
                t("medien.formular.abbrechen")
            }}</AvmKnopf>
            <AvmKnopf
                v-if="galerie"
                art="gefuellt"
                :gesperrt="
                    sendet ? t('medien.formular.laeuft') : zuSendenZahl === 0 ? t('medien.stapel.nichts') : undefined
                "
                testid="medien-stapel-senden"
                @click="stapelSenden"
                >{{ t("medien.stapel.senden", { n: zahl(zuSendenZahl) }) }}</AvmKnopf
            >
            <AvmKnopf
                v-else-if="duplikat && !nurNochBinden"
                art="gefuellt"
                :gesperrt="sendet ? t('medien.formular.laeuft') : duplikatGesperrt"
                testid="medien-duplikat-verwenden"
                @click="verwenden"
                >{{ t("medien.duplikat.verwenden") }}</AvmKnopf
            >
            <AvmKnopf
                v-else
                art="gefuellt"
                :gesperrt="sendet ? t('medien.formular.laeuft') : undefined"
                testid="medien-hochladen-senden"
                @click="senden"
                >{{ hauptText }}</AvmKnopf
            >
        </template>
    </AvmFenster>
</template>

<style scoped>
.hochladen-fenster {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
}

/* Der Hinweis auf einen gleichnamigen Eintrag der Liste (Kartensammlung): Hinweis, darunter „⇄ Vorhandenes verwenden“. */
.hochladen-fenster__konflikt {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
}

.hochladen-fenster__klein {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.hochladen-fenster__konflikt-zeile {
    display: inline-flex;
    align-items: center;
    gap: var(--space-6);
}

.hochladen-fenster__daumen {
    flex: none;
    width: var(--icon-xxl);
    height: var(--avm-fenster-daumen);
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
}

.hochladen-fenster__daumen img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
</style>
