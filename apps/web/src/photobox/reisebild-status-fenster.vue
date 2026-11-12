<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from "vue";
import { PHOTOBOX_LIMITS, type PhotoboxStatus, type PhotoboxUsageGrant } from "@avesmaps3d/shared";
import { newOperationId } from "../auth/api";
import { ortAusAntwort } from "../community/community-besucher";
import type { BezugOrt } from "../community/meldung-modell";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox, FensterHuellenLage, FensterVorgabeEcke } from "../fenster/fenster-lage";
import type { MessageKey } from "../i18n/de";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { fetchNearestPlace } from "../route-planner/route-client";
import {
    aendereBeschreibung,
    ersetzeBild,
    fehlerArt,
    fehlerSatzFuer,
    fehlerText,
    ladeFehlerSatz,
    ladeVorschau,
    leseStatus,
    nimmOffline,
    reisebildAdresse,
    waehleNutzung,
    ziehZurueck,
    type FehlerSatz,
} from "./api";
import { bereiteBildVor, BILD_TYPEN } from "./bild";
import { REISEBILD_STATUS_FENSTER } from "./fenster-linie";
import { zeichen } from "./formular-modell";
import LinkKasten from "./link-kasten.vue";
import { useLinkKopieren } from "./link-kopieren";
import { merkliste } from "./meine-reisebilder";
import { meinCache } from "./meine-reisebilder-modell";
import type { ReisebildSteuerung } from "./reisebild-besucher";
import { BLICK_RICHTUNGEN, stelleText } from "./stelle-text";
import { erzeugeStatusAbfrage, type VorschauZustand } from "./status-abfrage";
import { erreichteSchritte, istEntfernt, knoepfeFuer, standWorte } from "./status-modell";

/**
 * Die Statusseite eines Reisebilds (WI-0272 S2b, Aufgabe 14; WI §5.2): das Ziel von `/reisebild#‹schlüssel›` und der Knopf „Stand ansehen“ nach dem Einreichen. Ein Werkzeugfenster der Hülle wie das Formular
 * (gelöst und mittig, ▥ andocken, am Telefon das Blatt unten, ohne Ablage, nur so hoch wie der Inhalt). Was sie rechnet, steht in `status-modell.ts`, die Aufrufe in `api.ts`.
 *
 * - **Stand in Worten** (Pille, Leiste „Eingereicht · In Prüfung · Veröffentlicht“, ein Satz), die **Vorschau** des eigenen Bildes (ein Blob aus `…/status/vorschau`, beim Schließen freigegeben, sonst „Vorschau wird gerechnet“),
 *   die Angaben, „Von der Redaktion angepasst“ und die Nachricht der Redaktion. Nie der Schlüssel, nie ein Name der Redaktion (der Server liefert sie gar nicht erst).
 * - 🔴 **Die Knöpfe stehen genau nach `photoboxAktionErlaubt`** (`status-modell.ts`): Beschreibung ändern, Bild ersetzen, Zurückziehen, Sofort offline nehmen, die Lizenzwahl. „Sofort offline nehmen“ und „Zurückziehen“ fragen
 *   einmal im Fenster nach (`AvmBestaetigung`); Offline ist nicht rückgängig zu machen.
 * - **Die Vorschau wird nachgefragt**, solange sie fehlt: `/status` alle 15 s, höchstens achtmal (Lesegrenze 120 je Stunde), danach „Neu laden“ von Hand. Die Schleife steht in `status-abfrage.ts` (mit falscher Uhr getestet);
 *   ein Fehler beim Lesen hat eigene Sätze (`ladeFehlerSatz`) und steht auch bei „Neu laden“ mit gezeigtem Stand im Fenster (`reisebild-status-neu-fehler`), der Stand bleibt.
 * - **Ein falscher oder abgelaufener Schlüssel** zeigt „Zu diesem Link gibt es kein Reisebild (mehr).“ (derselbe Satz für „nie gewesen“, „gelöscht“ und „geleert“; der Server antwortet ebenso).
 * - **Oben der Kasten „Persönlicher Link“** (Entwurf 9, 2026-11-01; `link-kasten.vue`, derselbe wie in der Bestätigung, nur kompakt): „Link kopieren“ und das Häkchen „Auf diesem Gerät merken“ (anfangs leer, nur mit
 *   Browserspeicher), gemerkt als Zeile mit leisem „Vergessen“. Aus der Liste „Meine Reisebilder“ geöffnet, führt „‹ Meine Reisebilder“ dorthin zurück (`von`).
 * - 🔴 Der Schlüssel bleibt im Speicher dieser Seite: Er geht im Rumpf an den Server (nie in der Adresse) und wird von der Seite nur gespeichert, wenn jemand es mit dem Häkchen verlangt (`meine-reisebilder.ts`, nur
 *   im Browserspeicher dieses Geräts; die Merkliste hat ihn, nicht diese Seite). Jede Aktion trägt eine Kennung, die ein erneutes Senden nach einem Netzfehler überlebt
 *   (ADR-0019): Ein Doppelklick oder ein neuer Versuch legt nie zwei Änderungen an.
 */
const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    /** Der Schlüssel aus dem Link; `null`, wenn er fehlte oder verstümmelt war: Dann gibt es nichts zu fragen. */
    schluessel: string | null;
    /** `"meine"`: Die Seite wurde aus der Liste „Meine Reisebilder“ geöffnet; „‹ Meine Reisebilder“ führt zurück. */
    von?: "meine" | undefined;
    steuerung: ReisebildSteuerung;
    lage: FensterHuellenLage;
    box?: FensterBox | undefined;
    vorgabeEcke?: FensterVorgabeEcke | undefined;
}>();
const emit = defineEmits<{
    "update:lage": [lage: Exclude<FensterHuellenLage, "modal">, box?: FensterBox];
    "update:box": [box: FensterBox];
    vorn: [];
}>();

type Stand =
    | { readonly art: "laedt" }
    | { readonly art: "fehlt" }
    | { readonly art: "fehler"; readonly key: MessageKey }
    | { readonly art: "da"; readonly status: PhotoboxStatus };

const stand = ref<Stand>(props.schluessel === null ? { art: "fehlt" } : { art: "laedt" });
const kennungId = useId();

// --- Laden: der Stand und, solange sie fehlt, die Vorschau (die Schleife steht in `status-abfrage.ts`, damit ein Test sie mit falscher Uhr durchlaufen kann) ----------------

const vorschauZustand = ref<VorschauZustand>("ohne");
const vorschauUrl = ref<string | undefined>(undefined);
/** Ein Fehler beim Neu-Laden, während schon ein Stand gezeigt wird: Der Stand bleibt stehen, der Fehler steht dazu. Ohne Stand zeigt die Seite stattdessen `stand.art === "fehler"`. */
const ladeProblem = ref<FehlerSatz | undefined>(undefined);

function gibVorschauFrei(): void {
    if (vorschauUrl.value !== undefined) URL.revokeObjectURL(vorschauUrl.value);
    vorschauUrl.value = undefined;
}

const abfrage = erzeugeStatusAbfrage(
    { schluessel: () => props.schluessel, leseStatus, ladeVorschau, fehlerArt },
    {
        stand(neu) {
            stand.value = { art: "da", status: neu };
            ladeProblem.value = undefined;
            // Die Liste „Meine Reisebilder“ übernimmt den Stand aus ihrem Zwischenspeicher: Was hier gelesen oder geändert wurde, gilt dort auch (Review S3 M2).
            if (props.schluessel !== null) meinCache.aktualisiere(props.schluessel, neu, Date.now());
        },
        vorschau(bild) {
            gibVorschauFrei();
            vorschauUrl.value = URL.createObjectURL(bild);
        },
        vorschauWeg: gibVorschauFrei,
        vorschauZustand(neu) {
            vorschauZustand.value = neu;
        },
        nichtGefunden() {
            gibVorschauFrei();
            ladeProblem.value = undefined;
            stand.value = { art: "fehlt" };
            if (props.schluessel !== null) meinCache.aktualisiereWeg(props.schluessel, Date.now());
        },
        ladefehler(_fehler, art, hatStand) {
            // Eigene Sätze für das Lesen (nicht die des Einreichens): Die Lesegrenze nennt keine Uhrzeit, und kein Platzhalter bleibt roh stehen.
            const key = ladeFehlerSatz(art);
            if (hatStand) ladeProblem.value = { key };
            else stand.value = { art: "fehler", key };
        },
    },
);
const ladeStatus = abfrage.ladeStatus;

onMounted(() => {
    if (props.schluessel !== null) void ladeStatus(true);
});
watch(
    () => props.schluessel,
    () => {
        abfrage.zuruecksetzen();
        gibVorschauFrei();
        vorschauZustand.value = "ohne";
        ladeProblem.value = undefined;
        stand.value = props.schluessel === null ? { art: "fehlt" } : { art: "laedt" };
        void ladeStatus(true);
    },
);
onBeforeUnmount(() => {
    abfrage.stoppe();
    gibVorschauFrei();
});

const status = computed(() => (stand.value.art === "da" ? stand.value.status : undefined));

// --- Der Kasten „Persönlicher Link“: kopieren und auf diesem Gerät merken ---------------------------------------------------------

const linkAdresse = computed(() =>
    props.schluessel === null ? "" : reisebildAdresse(globalThis.location.origin, props.schluessel),
);
const linkKopie = useLinkKopieren({
    link: () => linkAdresse.value,
    misserfolg: () => linkKasten.value?.markiereLink(),
});
const linkKasten = useTemplateRef<InstanceType<typeof LinkKasten>>("linkKasten");
/** Lässt der Browser das Merken zu? Sonst gibt es weder Häkchen noch Zeile. */
const merkenMoeglich = merkliste.verfuegbar();
const gemerkt = computed(() => props.schluessel !== null && merkliste.hat(props.schluessel));
/** Warum das Merken eben nicht ging (voll oder gesperrt, Review S3 M4); der Linkkasten sagt es leise. */
const merkenProblem = ref<"voll" | "gesperrt" | undefined>(undefined);
/** Das Häkchen oder „Vergessen“: Der Speicher kann das Merken ablehnen, dann bleibt alles, wie es war (das Kästchen springt zurück, und der Kasten nennt den Grund). */
function merken(an: boolean): void {
    if (props.schluessel === null) return;
    merkenProblem.value = undefined;
    if (an) {
        const ausgang = merkliste.versuche(props.schluessel);
        if (ausgang !== "gemerkt") merkenProblem.value = ausgang;
    } else {
        merkliste.vergiss(props.schluessel);
        // Die Liste „Meine Reisebilder“ soll das Vergessene nicht aus dem Zwischenspeicher zeigen.
        meinCache.vergiss(props.schluessel);
    }
}
/** Der Satz unter der Pille: Der Balken wird gelb, wo etwas offen ist oder zu Ende ging (die Pille trägt die Farbe des Standes), sonst ruhig. */
const satzTon = computed((): "neutral" | "warnung" =>
    status.value === undefined || ["neutral", "erfolg"].includes(standWorte(status.value).ton) ? "neutral" : "warnung",
);
/** Pille und Satz: die des Zustands, nach dem endgültigen Löschen „Entfernt“ (WI-0272). */
const worte = computed(() => (status.value === undefined ? undefined : standWorte(status.value)));
/** Der Betreiber hat das Bild endgültig gelöscht (WI-0272): keine Vorschau, kein Verlauf der Schritte, keine Aktion. */
const entfernt = computed(() => status.value !== undefined && istEntfernt(status.value));
const knoepfe = computed(() => (status.value === undefined ? undefined : knoepfeFuer(status.value)));
const schritte = computed(() =>
    status.value === undefined || entfernt.value ? undefined : erreichteSchritte(status.value.zustand),
);
const zeit = (iso: string): string => relativeTime(new Date(iso), new Date(), locale.value, "zeitpunkt");

// --- Die Stelle in Worten (der nächste Ort kommt vom Server) --------------------------------------------------------------

const naechsterOrt = ref<BezugOrt | undefined>(undefined);
watch(
    () => status.value?.lage,
    (lage) => {
        naechsterOrt.value = undefined;
        if (lage === undefined) return;
        void fetchNearestPlace(lage)
            .then((antwort) => {
                if (status.value?.lage === lage) naechsterOrt.value = ortAusAntwort(antwort);
            })
            .catch(() => undefined);
    },
    { immediate: true },
);
const stelleWorte = computed(() =>
    status.value === undefined ? "" : stelleText(status.value.lage, naechsterOrt.value),
);
const blickText = computed(() =>
    status.value?.blickrichtung === undefined
        ? undefined
        : t("photobox.blick.hinweisNach", {
              richtung: t(`photobox.blickNach.${BLICK_RICHTUNGEN[status.value.blickrichtung]}` as MessageKey),
          }),
);

// --- Aktionen: Kennung je Versuch, Fehler im Fenster ---------------------------------------------------------------------

const sendet = ref(false);
const problem = ref<FehlerSatz | undefined>(undefined);
/** Die Kennung des laufenden Versuchs, samt Nutzlast: Ein erneutes Senden DESSELBEN trägt dieselbe (ADR-0019), etwas anderes eine neue. */
let versuch: { name: string; nutzlast: string; id: string } | undefined;
const kennungFuer = (name: string, nutzlast: string): string => {
    if (versuch?.name === name && versuch.nutzlast === nutzlast) return versuch.id;
    versuch = { name, nutzlast, id: newOperationId() };
    return versuch.id;
};

async function fuehreAus(
    name: string,
    nutzlast: string,
    aufruf: (operationId: string) => Promise<PhotoboxStatus>,
): Promise<boolean> {
    if (props.schluessel === null || sendet.value) return false;
    sendet.value = true;
    problem.value = undefined;
    try {
        const neu = await aufruf(kennungFuer(name, nutzlast));
        versuch = undefined;
        abfrage.uebernimm(neu);
        return true;
    } catch (fehler) {
        const art = fehlerArt(fehler);
        if (art === "nicht_gefunden") {
            // Dieselbe Folge wie beim Lesen: die Vorschau frei, der Satz „kein Reisebild (mehr)“.
            abfrage.zuruecksetzen();
            gibVorschauFrei();
            stand.value = { art: "fehlt" };
            if (props.schluessel !== null) meinCache.aktualisiereWeg(props.schluessel, Date.now());
            return false;
        }
        const jetzt = new Date();
        problem.value = fehlerSatzFuer(fehler, (bis) => relativeTime(bis, jetzt, locale.value, "zeitpunkt"), jetzt);
        // WI-0291: Ging der Schritt nicht, weil der Zustand sich geändert hat (409), war der Stand der Seite alt: Neu laden zeigt die Knöpfe, die jetzt gelten.
        if (art === "uebergang") void ladeStatus(true);
        return false;
    } finally {
        sendet.value = false;
    }
}

const gesperrtSendet = computed(() => (sendet.value ? t("photobox.sendet") : undefined));

// Beschreibung ändern
const text = ref<string | undefined>(undefined);
const textGrenze = PHOTOBOX_LIMITS.descriptionMax;
const textKnopfGrund = computed(() => {
    if (sendet.value) return t("photobox.sendet");
    const laenge = zeichen(text.value?.trim() ?? "");
    if (laenge === 0) return t("photobox.sperre.text");
    return laenge > textGrenze ? t("photobox.sperre.textLang") : undefined;
});
function beginneText(): void {
    text.value = status.value?.beschreibung ?? "";
    frage.value = undefined;
}
async function speichereText(): Promise<void> {
    const schluessel = props.schluessel;
    const neu = text.value?.trim() ?? "";
    if (schluessel === null || textKnopfGrund.value !== undefined) return;
    if (
        await fuehreAus("beschreibung", neu, (operationId) =>
            aendereBeschreibung({ schluessel, operationId, beschreibung: neu }),
        )
    ) {
        text.value = undefined;
    }
}
/** Esc in einer begonnenen Änderung schließt das Fenster nicht (✕ bleibt der ausdrückliche Weg); ohne Text geht Esc an die Hülle. */
function escImText(event: KeyboardEvent): void {
    if (text.value !== undefined) {
        event.stopPropagation();
        text.value = undefined;
    }
}

// Bild ersetzen
const dateiFeld = useTemplateRef<HTMLInputElement>("dateiFeld");
const bildFehler = ref<MessageKey | undefined>(undefined);
const bildLaedt = ref(false);
async function neuesBild(event: Event): Promise<void> {
    const feld = event.target as HTMLInputElement;
    const datei = feld.files?.[0];
    feld.value = "";
    const schluessel = props.schluessel;
    if (datei === undefined || schluessel === null || bildLaedt.value || sendet.value) return;
    bildLaedt.value = true;
    bildFehler.value = undefined;
    problem.value = undefined;
    try {
        const ergebnis = await bereiteBildVor(datei);
        if (!ergebnis.ok) {
            bildFehler.value =
                ergebnis.grund === "zu_gross" ? "photobox.bild.fehler.zuGross" : "photobox.bild.fehler.keinBild";
            return;
        }
        const bild = ergebnis.bild.datei;
        await fuehreAus("bild", bild.dataBase64.slice(-64) + String(bild.dataBase64.length), (operationId) =>
            ersetzeBild({ schluessel, operationId, bild }),
        );
    } finally {
        bildLaedt.value = false;
    }
}

// Nachfragen: zurückziehen, offline, auf CC BY umstellen
type Frage = "zurueckziehen" | "offline" | "cc-by";
const frage = ref<Frage | undefined>(undefined);
function frageNach(art: Frage): void {
    text.value = undefined;
    frage.value = art;
}
async function bestaetige(): Promise<void> {
    const schluessel = props.schluessel;
    const art = frage.value;
    if (schluessel === null || art === undefined) return;
    const gelungen =
        art === "zurueckziehen"
            ? await fuehreAus(art, "", (operationId) => ziehZurueck({ schluessel, operationId }))
            : art === "offline"
              ? await fuehreAus(art, "", (operationId) => nimmOffline({ schluessel, operationId }))
              : await waehleDieNutzung("cc-by-4.0");
    if (gelungen) frage.value = undefined;
}
async function waehleDieNutzung(nutzung: PhotoboxUsageGrant): Promise<boolean> {
    const schluessel = props.schluessel;
    if (schluessel === null) return false;
    return fuehreAus("nutzung", nutzung, (operationId) => waehleNutzung({ schluessel, operationId, nutzung }));
}
/** Auf CC BY: vor der Freigabe gleich (es lässt sich zurückstellen), nach der Freigabe erst nach der Frage (es lässt sich nicht zurücknehmen). */
function ccBy(): void {
    if (status.value?.zustand === "approved") frageNach("cc-by");
    else void waehleDieNutzung("cc-by-4.0");
}

// Karte und neues Bild
function zeigeAufKarte(): void {
    if (status.value !== undefined) props.steuerung.zeigeAufKarte(status.value.lage);
}
function neuesBildVonHier(): void {
    const s = status.value;
    if (s === undefined) return;
    props.steuerung.oeffne(s.lage, undefined, {
        neu: true,
        vorbelegung: { entstehung: s.entstehung, ...(s.name === undefined ? {} : { name: s.name }) },
    });
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="entscheiden"
        :lage="props.lage"
        :box="props.box"
        :vorgabe-ecke="props.vorgabeEcke"
        hoehe="inhalt"
        ohne-ablage
        telefon-blatt
        :titel="t('photobox.status.titel')"
        :testid="REISEBILD_STATUS_FENSTER"
        @update:lage="(neu, box) => emit('update:lage', neu, box)"
        @update:box="(neu) => emit('update:box', neu)"
        @vorn="emit('vorn')"
    >
        <!-- Aus „Meine Reisebilder“ geöffnet: ein leiser Weg zurück in die Liste. -->
        <button
            v-if="props.von === 'meine'"
            type="button"
            class="status__zurueck"
            data-testid="reisebild-status-zurueck"
            @click="props.steuerung.oeffneMeine()"
        >
            <span aria-hidden="true">‹</span> {{ t("photobox.meine.zurueck") }}
        </button>
        <p v-if="stand.art === 'laedt'" class="status__leise" role="status" data-testid="reisebild-status-laedt">
            {{ t("photobox.status.laedt") }}
        </p>
        <AvmHinweis v-else-if="stand.art === 'fehlt'" ton="neutral" rolle="status" testid="reisebild-status-fehlt">
            {{ t("photobox.status.fehlt") }}
        </AvmHinweis>
        <template v-else-if="stand.art === 'fehler'">
            <AvmHinweis ton="gefahr" rolle="alert" testid="reisebild-status-fehler">{{ t(stand.key) }}</AvmHinweis>
            <AvmKnopf groesse="zeile" testid="reisebild-status-neu-laden" @click="ladeStatus(true)">{{
                t("photobox.status.neuLaden")
            }}</AvmKnopf>
        </template>

        <template v-else-if="status !== undefined && knoepfe !== undefined">
            <!-- Der persönliche Link, kompakt: kopieren und auf diesem Gerät merken -->
            <LinkKasten
                ref="linkKasten"
                kompakt
                testid="reisebild-status"
                :link="linkAdresse"
                :kopiert="linkKopie.anzeige.value"
                :merken-moeglich="merkenMoeglich"
                :gemerkt="gemerkt"
                :merken-problem="merkenProblem"
                @kopieren="linkKopie.kopiere()"
                @merken="merken"
            />
            <!-- Der Stand in Worten -->
            <div class="status__kopf" data-testid="reisebild-status-kopf">
                <AvmPille :ton="worte?.ton" testid="reisebild-status-zustand">{{
                    worte === undefined ? "" : t(worte.pille)
                }}</AvmPille>
                <span class="status__leise"
                    >{{ t("photobox.status.schritt.eingereicht") }} · {{ zeit(status.eingereichtAm) }}</span
                >
                <AvmKnopf groesse="zeile" testid="reisebild-status-neu-laden" @click="ladeStatus(true)">{{
                    t("photobox.status.neuLaden")
                }}</AvmKnopf>
            </div>
            <AvmHinweis
                v-if="ladeProblem !== undefined"
                ton="gefahr"
                rolle="alert"
                testid="reisebild-status-neu-fehler"
            >
                {{ fehlerText(ladeProblem) }}
            </AvmHinweis>
            <ol
                v-if="schritte !== undefined"
                class="status__verlauf"
                :aria-label="t('photobox.status.verlauf')"
                data-testid="reisebild-status-verlauf"
            >
                <li :class="{ 'is-erreicht': schritte >= 1 }">{{ t("photobox.status.schritt.eingereicht") }}</li>
                <li :class="{ 'is-erreicht': schritte >= 2 }">{{ t("photobox.status.schritt.pruefung") }}</li>
                <li :class="{ 'is-erreicht': schritte >= 3 }">{{ t("photobox.status.schritt.veroeffentlicht") }}</li>
            </ol>
            <AvmHinweis :ton="satzTon" rolle="status" testid="reisebild-status-satz">
                {{ worte === undefined ? "" : t(worte.satz) }}
            </AvmHinweis>
            <AvmHinweis v-if="status.nachricht !== undefined" ton="warnung" testid="reisebild-status-nachricht">
                <span class="status__titel">{{ t("photobox.status.nachricht") }}</span>
                <span class="status__nachricht">{{ status.nachricht }}</span>
            </AvmHinweis>

            <!-- Das eigene Bild und seine Angaben -->
            <div class="status__eigenes">
                <img
                    v-if="vorschauUrl !== undefined"
                    class="status__vorschau"
                    :src="vorschauUrl"
                    :alt="t('photobox.status.vorschau.alt')"
                    data-testid="reisebild-status-vorschau"
                />
                <div
                    v-else-if="!entfernt"
                    class="status__vorschau status__vorschau--leer"
                    data-testid="reisebild-status-vorschau-leer"
                >
                    <span class="status__leise">{{
                        t(
                            vorschauZustand === "gesperrt"
                                ? "photobox.status.vorschau.gesperrt"
                                : "photobox.status.vorschau.rechnet",
                        )
                    }}</span>
                    <AvmKnopf
                        v-if="vorschauZustand === 'aufgegeben' || vorschauZustand === 'gesperrt'"
                        groesse="zeile"
                        testid="reisebild-status-vorschau-neu"
                        @click="ladeStatus(true)"
                        >{{ t("photobox.status.neuLaden") }}</AvmKnopf
                    >
                </div>
                <div class="status__angaben" data-testid="reisebild-status-angaben">
                    <p class="status__beschreibung" data-testid="reisebild-status-beschreibungstext">
                        {{ status.beschreibung }}
                    </p>
                    <p class="status__leise">
                        {{ t("photobox.status.stelle") }}: {{ stelleWorte }} ·
                        {{ t(`photobox.entstehung.${status.entstehung}` as MessageKey) }}
                        ·
                        {{
                            status.name === undefined
                                ? t("photobox.status.ohneName")
                                : t("photobox.status.nennung", { name: status.name })
                        }}
                        <template v-if="blickText !== undefined"> · {{ blickText }}</template>
                        · {{ t(`photobox.nutzung.${status.nutzung}` as MessageKey) }}
                    </p>
                    <p
                        v-if="status.wartendeBeschreibung !== undefined"
                        class="status__leise"
                        data-testid="reisebild-status-wartend"
                    >
                        {{ t("photobox.status.wartend") }}: {{ status.wartendeBeschreibung }}
                    </p>
                    <AvmPille v-if="status.angepasst" testid="reisebild-status-angepasst">{{
                        t("photobox.status.angepasst")
                    }}</AvmPille>
                </div>
            </div>

            <!-- Beschreibung ändern -->
            <div
                v-if="text !== undefined"
                class="status__aendern"
                data-testid="reisebild-status-aendern"
                @keydown.esc="escImText"
            >
                <label class="status__label" :for="`${kennungId}-text`">{{ t("photobox.text.label") }}</label>
                <AvmTextbereich
                    :id="`${kennungId}-text`"
                    v-model="text"
                    :zeilen="3"
                    :maxlength="textGrenze"
                    testid="reisebild-status-text"
                />
                <p v-if="status.zustand === 'approved'" class="status__leise">
                    {{ t("photobox.status.beschreibung.hinweis") }}
                </p>
                <div class="status__reihe">
                    <AvmKnopf
                        art="gefuellt"
                        :gesperrt="textKnopfGrund"
                        testid="reisebild-status-speichern"
                        @click="speichereText"
                        >{{ t("photobox.status.beschreibung.speichern") }}</AvmKnopf
                    >
                    <AvmKnopf testid="reisebild-status-text-ab" @click="text = undefined">{{
                        t("photobox.waehlen.abbrechen")
                    }}</AvmKnopf>
                </div>
            </div>

            <!-- Die Nachfrage vor Zurückziehen, Offline und CC BY nach der Freigabe -->
            <AvmBestaetigung
                v-if="frage === 'zurueckziehen'"
                :frage="t('photobox.status.zurueckziehen.frage')"
                :folge="t('photobox.status.zurueckziehen.folge')"
                :bestaetigen="t('photobox.status.zurueckziehen')"
                :gesperrt="gesperrtSendet"
                testid="reisebild-status-zurueckziehen-frage"
                @bestaetigen="bestaetige"
                @abbrechen="frage = undefined"
            />
            <AvmBestaetigung
                v-else-if="frage === 'offline'"
                :frage="t('photobox.status.offline.frage')"
                :folge="t('photobox.status.offline.folge')"
                :bestaetigen="t('photobox.status.offline.bestaetigen')"
                :gesperrt="gesperrtSendet"
                testid="reisebild-status-offline-frage"
                @bestaetigen="bestaetige"
                @abbrechen="frage = undefined"
            />
            <AvmBestaetigung
                v-else-if="frage === 'cc-by'"
                :frage="t('photobox.status.nutzung.ccBy.frage')"
                :folge="t('photobox.status.nutzung.ccBy.folge')"
                :bestaetigen="t('photobox.status.nutzung.ccBy.bestaetigen')"
                :gesperrt="gesperrtSendet"
                testid="reisebild-status-ccby-frage"
                @bestaetigen="bestaetige"
                @abbrechen="frage = undefined"
            />

            <AvmHinweis v-if="problem !== undefined" ton="gefahr" rolle="alert" testid="reisebild-status-problem">
                {{ fehlerText(problem) }}
            </AvmHinweis>
            <AvmHinweis
                v-if="bildFehler !== undefined"
                ton="gefahr"
                rolle="alert"
                testid="reisebild-status-bild-fehler"
            >
                {{ t(bildFehler) }}
            </AvmHinweis>

            <!-- Die Knöpfe: genau nach `photoboxAktionErlaubt` (status-modell.ts) -->
            <div
                v-if="frage === undefined && text === undefined"
                class="status__reihe"
                data-testid="reisebild-status-knoepfe"
            >
                <AvmKnopf testid="reisebild-status-zeigen" @click="zeigeAufKarte">{{
                    t("photobox.status.zeigen")
                }}</AvmKnopf>
                <AvmKnopf
                    v-if="knoepfe.beschreibung"
                    :gesperrt="gesperrtSendet"
                    testid="reisebild-status-beschreibung"
                    @click="beginneText"
                    >{{ t("photobox.status.beschreibung.aendern") }}</AvmKnopf
                >
                <AvmKnopf
                    v-if="knoepfe.bild"
                    :gesperrt="bildLaedt ? t('photobox.bild.liest') : gesperrtSendet"
                    testid="reisebild-status-bild"
                    @click="dateiFeld?.click()"
                    >{{ t("photobox.status.bild.ersetzen") }}</AvmKnopf
                >
                <AvmKnopf
                    v-if="knoepfe.nutzungCcBy"
                    :gesperrt="gesperrtSendet"
                    testid="reisebild-status-nutzung-ccby"
                    @click="ccBy"
                    >{{ t("photobox.status.nutzung.ccBy") }}</AvmKnopf
                >
                <AvmKnopf
                    v-if="knoepfe.nutzungNurAvesmaps"
                    :gesperrt="gesperrtSendet"
                    testid="reisebild-status-nutzung-avesmaps"
                    @click="waehleDieNutzung('avesmaps_only')"
                    >{{ t("photobox.status.nutzung.nurAvesmaps") }}</AvmKnopf
                >
                <AvmKnopf
                    v-if="knoepfe.zurueckziehen"
                    art="gefahr"
                    testid="reisebild-status-zurueckziehen"
                    @click="frageNach('zurueckziehen')"
                    >{{ t("photobox.status.zurueckziehen") }}</AvmKnopf
                >
                <AvmKnopf
                    v-if="knoepfe.offline"
                    art="gefahr"
                    testid="reisebild-status-offline"
                    @click="frageNach('offline')"
                    >{{ t("photobox.status.offline") }}</AvmKnopf
                >
                <AvmKnopf v-if="knoepfe.neuesBild" testid="reisebild-status-neues-bild" @click="neuesBildVonHier">{{
                    t("photobox.status.neuesBild")
                }}</AvmKnopf>
            </div>
            <p v-if="knoepfe.bild && frage === undefined && text === undefined" class="status__leise">
                {{ t("photobox.status.bild.hinweis") }}
            </p>
            <input
                ref="dateiFeld"
                class="status__datei"
                type="file"
                :accept="BILD_TYPEN.join(',')"
                tabindex="-1"
                aria-hidden="true"
                data-testid="reisebild-status-datei"
                @change="neuesBild"
            />
        </template>
    </AvmFenster>
</template>

<style scoped>
/* „‹ Meine Reisebilder“: ein leiser Textknopf, ohne Fläche, bis man ihn berührt. */
.status__zurueck {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: var(--space-2);
    min-height: var(--icon-lg);
    margin: calc(-1 * var(--space-2)) 0 calc(-1 * var(--space-2)) calc(-1 * var(--space-6));
    padding: 0 var(--space-6);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    white-space: nowrap;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease;
}

.status__zurueck:hover {
    border-color: var(--color-button-soft-border);
    background: var(--color-button-soft-hover);
    color: var(--color-text-strong);
}

.status__zurueck:active {
    background: var(--color-button-soft-active);
}

.status__zurueck:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Am Finger (Review S3 M5c): Fingerhöhe, ohne dass die Zeile wächst; der negative Rand nimmt den Überstand oben und unten. */
@media (pointer: coarse) {
    .status__zurueck {
        /* Das Fingerziel (44 px, wie die Kamerasteuerung) in Kanonschritten. */
        --status-finger: calc(var(--icon-xxl) - var(--space-2));

        min-height: var(--status-finger);
        margin-block: calc(-1 * var(--space-2) + (var(--icon-lg) - var(--status-finger)) / 2);
    }
}

@media (prefers-reduced-motion: reduce) {
    .status__zurueck {
        transition: none;
    }
}

.status__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6);
}

.status__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Die Leiste „Eingereicht · In Prüfung · Veröffentlicht“: drei Abschnitte, die erreichten tragen die Farbe der Anwesenheit (Probierseite 7.1). */
.status__verlauf {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--font-size-small);
}

.status__verlauf li {
    padding: var(--space-6) var(--space-4);
    border-top: var(--space-4) solid var(--color-divider);
    color: var(--color-text-muted);
    text-align: center;
}

.status__verlauf li.is-erreicht {
    border-top-color: var(--color-map-presence);
    color: var(--color-text-strong);
}

.status__titel {
    display: block;
    color: var(--color-text-strong);
}

.status__nachricht {
    display: block;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}

/* Das eigene Bild links, die Angaben rechts; am schmalen Blatt untereinander. Das Bild bleibt, wie es ist: nie abgedunkelt (Guide §30.2). */
.status__eigenes {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-10);
    align-items: flex-start;
}

.status__vorschau {
    flex: 0 0 calc(5 * var(--space-24));
    width: calc(5 * var(--space-24));
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
    object-fit: cover;
}

.status__vorschau--leer {
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--space-4);
    padding: var(--space-4);
    box-sizing: border-box;
    border: 1px dashed var(--color-border-strong);
    text-align: center;
}

.status__angaben {
    flex: 1 1 calc(6 * var(--space-24));
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
    min-width: 0;
}

.status__beschreibung {
    margin: 0;
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}

.status__aendern {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.status__label {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.status__reihe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
}

.status__datei {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
}
</style>
