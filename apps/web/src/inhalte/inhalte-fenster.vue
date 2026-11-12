<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { phoneViewport } from "../controls/phone-viewport";
import { entwurfsTaste } from "../fenster/entwurf-kern";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox, FensterHuellenLage } from "../fenster/fenster-lage";
import FensterReiter from "../fenster/fenster-reiter.vue";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import { createInhalteClient, type InhalteClient } from "./inhalte-client";
import type { Katalog } from "./inhalte-katalog-steuerung";
import InhalteKorpora from "./inhalte-korpora.vue";
import { createKorporaSteuerung } from "./inhalte-korpora-steuerung";
import { teileInhalteListen } from "./inhalte-listen";
import InhalteLiteratur from "./inhalte-literatur.vue";
import { createLiteraturSteuerung } from "./inhalte-literatur-steuerung";
import { INHALTE_REITER, inhalteQuelleWunsch, inhalteReiterWunsch, type InhalteReiter } from "./inhalte-oeffnen";
import InhalteQuellen from "./inhalte-quellen.vue";
import { createQuellenSteuerung } from "./inhalte-quellen-steuerung";
import { createRegelTextSteuerung } from "./inhalte-regeln-text-steuerung";
import InhalteVorkommen from "./inhalte-vorkommen.vue";
import { createVorkommenSteuerung } from "./inhalte-vorkommen-steuerung";

/**
 * Das Fenster „Inhalte bearbeiten“ (WI-0254; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`, vom Betreiber begutachtet): EIN
 * Werkzeugfenster für die Inhalte, die keine Kartenobjekte sind, mit den vier Fachreitern Quellen · Literatur · Vorkommen · Korpora.
 * Jeder Reiter hat dieselben drei Spalten (Katalog · Stammdaten · Beziehungen); die Hülle, die Leiste der Liste, Speichern und Verwerfen
 * bleiben gleich, der Reiter tauscht Felder und Beziehungseditor aus.
 *
 * - **Gebaut sind alle vier Reiter** (Lesen und Schreiben, Entwurf, Konflikt, Protokoll). Der Entwurf lebt in diesem Fenster, nicht im Reiter: Wer den Reiter wechselt, behält ihn, und
 *   „Speichern“ wirkt immer nur auf den Reiter, der vorn steht, und dort nur auf das Dokument, dessen Entwurf es ist.
 * - **Fuß:** links der Zustand (keine Änderungen · n ungespeichert · speichert · gespeichert), rechts ↶ ↷, Verwerfen, Speichern. Strg+Z und
 *   Strg+Y wirken im Fenster, nie in einem Textfeld.
 * - **Ein Werkzeugfenster wie jedes andere** (WI-0128 E6): Lage und Box hält die Fensterverwaltung in `app.vue`; ✕ und Escape legen ein
 *   Fenster mit Änderungen ab, statt sie zu verwerfen (`ungespeichert`).
 * - Ohne das Recht `manage_sources` (Reviewer) ist alles lesbar, nichts änderbar.
 */
const props = defineProps<{
    lage?: FensterHuellenLage | undefined;
    box?: FensterBox | undefined;
    ablageZiel?: (() => DOMRect | undefined) | undefined;
    /** Darf der Mensch schreiben? Der Server prüft es an jeder Route; hier steuert es nur die Ansicht. */
    darfSchreiben: boolean;
    client?: InhalteClient | undefined;
}>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{
    "update:lage": [lage: Exclude<FensterHuellenLage, "modal">, box?: FensterBox];
    "update:box": [box: FensterBox];
    vorn: [];
    /** Der Entwurf trägt Änderungen: ✕ legt das Fenster dann ab, statt es zu schließen. */
    ungespeichert: [wert: boolean];
}>();

const client = props.client ?? createInhalteClient();
const quellen = createQuellenSteuerung({ client });
const literatur = createLiteraturSteuerung({ client });
const vorkommen = createVorkommenSteuerung({ client });
// „Regeln als Text“ im Reiter Vorkommen: Der Text lebt im Fenster, nicht in der Ansicht, und überdauert den Wechsel des Reiters; nach dem Übernehmen lädt die Steuerung der Vorkommen neu.
const regelText = createRegelTextSteuerung({ client, vorkommen });
const korpora = createKorporaSteuerung({ client });
// Die Kacheln „Nachschlagen“ im Editorpanel zählen aus diesen Listen (`zahlen`; WI-0212, `inhalte-listen.ts`).
teileInhalteListen({
    quellen: quellen.liste,
    literatur: literatur.liste,
    vorkommen: vorkommen.liste,
    korpora: korpora.liste,
});

/** Was der Fuß von einer Steuerung braucht: der Zustand des Entwurfs und die Griffe darauf (beide Reiter bringen es mit). */
type FussSteuerung = Pick<
    Katalog<unknown, unknown, unknown, string, unknown>,
    "geaendert" | "anzahl" | "zustand" | "kannZurueck" | "kannWieder" | "zurueck" | "wieder" | "verwerfen" | "speichern"
>;
const telefon = computed(() => phoneViewport.value);

const reiter = ref<InhalteReiter>("quellen");
watch(
    inhalteReiterWunsch,
    (wunsch) => {
        if (wunsch === undefined) return;
        reiter.value = wunsch;
        inhalteReiterWunsch.value = undefined;
    },
    { immediate: true },
);

/** „Quelle öffnen“ in den Quellen eines Orts oder Gebiets (WI-0254 §12): in den Reiter Quellen und die Quelle wählen (mit der Frage, wenn dort Änderungen stehen). */
watch(
    inhalteQuelleWunsch,
    (sourceId) => {
        if (sourceId === undefined) return;
        reiter.value = "quellen";
        quellen.waehle(sourceId);
        inhalteQuelleWunsch.value = undefined;
    },
    { immediate: true },
);

const REITER_NAMEN: Readonly<Record<InhalteReiter, MessageKey>> = {
    quellen: "inhalte.reiter.quellen",
    literatur: "inhalte.reiter.literatur",
    vorkommen: "inhalte.reiter.vorkommen",
    korpora: "inhalte.reiter.korpora",
};
/** Die Zahl der aktiven Einträge hinter dem Namen eines gebauten Reiters (Mockup: „Quellen (9)“). */
const reiterZahl = (id: InhalteReiter): number | undefined =>
    id === "quellen"
        ? quellen.liste.value?.zahlen.aktiv
        : id === "literatur"
          ? literatur.liste.value?.zahlen.aktiv
          : id === "vorkommen"
            ? vorkommen.liste.value?.zahlen.aktiv
            : korpora.liste.value?.zahlen.aktiv;
const reiterListe = computed(() =>
    INHALTE_REITER.map((id) => {
        const zahl = reiterZahl(id);
        return {
            id,
            name: zahl === undefined ? t(REITER_NAMEN[id]) : `${t(REITER_NAMEN[id])} (${formatNumber(zahl, 0)})`,
        };
    }),
);

// Die ersten Listen kommen mit dem Fenster (die Reiter zeigen ihre Zahl); der erste Eintrag ist gewählt, damit die drei Spalten nie leer
// dastehen (Mockup).
onMounted(() => {
    quellen.ladeListeNeu();
    literatur.ladeListeNeu();
    vorkommen.ladeListeNeu();
    korpora.ladeListeNeu();
    document.addEventListener("keydown", taste);
});
onBeforeUnmount(() => document.removeEventListener("keydown", taste));
const stopErsteQuelle = watch(
    quellen.liste,
    (liste) => {
        if (liste === undefined) return;
        stopErsteQuelle();
        const erste = liste.items[0];
        if (erste !== undefined && quellen.gewaehlt.value === undefined) quellen.waehle(erste.id);
    },
    { flush: "post" },
);
const stopErstesWerk = watch(
    literatur.liste,
    (liste) => {
        if (liste === undefined) return;
        stopErstesWerk();
        const erstes = liste.items[0];
        if (erstes !== undefined && literatur.gewaehlt.value === undefined) literatur.waehle(erstes.id);
    },
    { flush: "post" },
);

const stopErstesVorkommen = watch(
    vorkommen.liste,
    (liste) => {
        if (liste === undefined) return;
        stopErstesVorkommen();
        const erstes = liste.items[0];
        if (erstes !== undefined && vorkommen.gewaehlt.value === undefined) vorkommen.waehle(erstes.id);
    },
    { flush: "post" },
);

const stopErsterKorpus = watch(
    korpora.liste,
    (liste) => {
        if (liste === undefined) return;
        stopErsterKorpus();
        const erster = liste.items[0];
        if (erster !== undefined && korpora.gewaehlt.value === undefined) korpora.waehle(erster.id);
    },
    { flush: "post" },
);

// Auch ein Text in „Regeln als Text“ ist Arbeit, die nirgends liegt, bis „Übernehmen“ sie anlegt: ✕ legt das Fenster dann ab, statt den Text zu verwerfen.
watch(
    () =>
        quellen.geaendert.value ||
        literatur.geaendert.value ||
        vorkommen.geaendert.value ||
        korpora.geaendert.value ||
        regelText.text.value.trim() !== "",
    (wert) => emit("ungespeichert", wert),
    { immediate: true },
);

// --- Pfad und Erläuterung ---
const infoOffen = ref(false);
const pfadTitel = computed(() => {
    if (reiter.value === "quellen") return quellen.stand.value?.felder.title ?? quellen.quelle.value?.title ?? "";
    if (reiter.value === "literatur") return literatur.stand.value?.felder.title ?? literatur.werk.value?.title ?? "";
    if (reiter.value === "vorkommen") {
        if (regelText.offen.value) return t("inhalte.vorkommen.text.titel");
        return vorkommen.stand.value?.felder.name ?? vorkommen.eintrag.value?.name ?? "";
    }
    const label = korpora.stand.value?.felder.label.trim() ?? "";
    return label === "" ? (korpora.korpus.value?.key ?? "") : label;
});

// --- Fuß ---
/** Die Steuerung des Reiters, der vorn steht. */
const aktiv = computed<FussSteuerung | undefined>(() =>
    reiter.value === "quellen"
        ? quellen
        : reiter.value === "literatur"
          ? literatur
          : reiter.value === "vorkommen"
            ? vorkommen
            : korpora,
);
/** Ein anderer gebauter Reiter, der Änderungen trägt, während dieser keine hat: Der Fuß nennt ihn. */
const andererMitAenderungen = computed<InhalteReiter | undefined>(() => {
    if (reiter.value !== "quellen" && quellen.geaendert.value) return "quellen";
    if (reiter.value !== "literatur" && literatur.geaendert.value) return "literatur";
    if (reiter.value !== "vorkommen" && vorkommen.geaendert.value) return "vorkommen";
    if (reiter.value !== "korpora" && korpora.geaendert.value) return "korpora";
    return undefined;
});
/** Der Satz, wenn ein Eintrag ohne Titel gespeichert werden soll: Jeder Reiter nennt seinen Gegenstand. */
const TITEL_LEER: Readonly<Record<InhalteReiter, MessageKey>> = {
    quellen: "inhalte.fehler.titelLeer",
    literatur: "inhalte.literatur.fehler.titelLeer",
    vorkommen: "inhalte.vorkommen.fehler.nameLeer",
    korpora: "inhalte.fehler.titelLeer",
};
const fussText = computed(() => {
    if (!props.darfSchreiben) return t("inhalte.nurLesen");
    const a = aktiv.value;
    if (a !== undefined) {
        const z = a.zustand.value;
        if (z.art === "speichert") return t("entwurf.speichert");
        if (z.art === "konflikt") return t("entwurf.konflikt.titel");
        if (z.art === "abgelehnt") {
            if (z.code !== "titel_leer") return z.satz;
            return t(TITEL_LEER[reiter.value]);
        }
        if (a.geaendert.value) return t("entwurf.ungespeichert", { n: formatNumber(a.anzahl.value, 0) });
        if (z.art === "gespeichert")
            return z.revision === undefined
                ? t("entwurf.gespeichertKurz")
                : t("entwurf.gespeichert", { revision: String(z.revision) });
    }
    const anderer = andererMitAenderungen.value;
    return anderer === undefined
        ? t("inhalte.fuss.keine")
        : t("inhalte.fuss.inReiter", { reiter: t(REITER_NAMEN[anderer]) });
});
/**
 * Was gesperrt ist, bleibt still gesperrt (leerer Satz): Der Fuß nennt den Grund EINMAL links (Zustand, „nur lesen“, Konflikt), statt ihn
 * neben jedem Knopf zu wiederholen. Der Zettel am Knopf (`title`) sagt, was er täte.
 */
const speichernFrei = computed(() => {
    const a = aktiv.value;
    return (
        props.darfSchreiben &&
        a !== undefined &&
        a.geaendert.value &&
        a.zustand.value.art !== "speichert" &&
        a.zustand.value.art !== "konflikt"
    );
});
const verwerfenFrei = computed(() => props.darfSchreiben && aktiv.value?.geaendert.value === true);
const zurueckFrei = computed(() => props.darfSchreiben && aktiv.value?.kannZurueck.value === true);
const wiederFrei = computed(() => props.darfSchreiben && aktiv.value?.kannWieder.value === true);

function taste(event: KeyboardEvent): void {
    if (aktiv.value === undefined || !offen.value) return;
    const ziel = event.target as HTMLElement | null;
    if (ziel?.closest?.('[data-testid="inhalte-fenster"]') === null || ziel === null) return;
    const art = entwurfsTaste(event);
    if (art === undefined) return;
    event.preventDefault();
    if (art === "zurueck") aktiv.value.zurueck();
    else aktiv.value.wieder();
}

/** „Korpus bearbeiten“ an einer Quelle: in den Reiter Korpora und den Korpus wählen (mit der Frage, wenn dort Änderungen stehen). */
function oeffneKorpus(korpusId: string): void {
    reiter.value = "korpora";
    korpora.waehle(korpusId);
}

/** „Öffnen“ an einer Quelle des Eintrags: in den Reiter Quellen und die Quelle wählen (mit der Frage, wenn dort Änderungen stehen). */
function oeffneQuelle(sourceId: string): void {
    reiter.value = "quellen";
    quellen.waehle(sourceId);
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="medien"
        rumpf="spalten"
        :titel="t('inhalte.titel')"
        :lage="props.lage"
        :box="props.box"
        :ablage-ziel="props.ablageZiel"
        testid="inhalte-fenster"
        @update:lage="(neu, box) => emit('update:lage', neu, box)"
        @update:box="(box) => emit('update:box', box)"
        @vorn="emit('vorn')"
    >
        <template #reiter>
            <FensterReiter
                v-model="reiter"
                :reiter="reiterListe"
                :beschriftung="t('inhalte.reiter.beschriftung')"
                kennung="inhalte"
            />
        </template>

        <template #leiste>
            <div class="pfad" data-testid="inhalte-pfad">
                <span class="pfad__text einzeilig" data-testid="inhalte-pfad-text">
                    {{ t("inhalte.pfad.katalog") }} › {{ t(REITER_NAMEN[reiter]) }}
                    <template v-if="pfadTitel !== ''"> › {{ pfadTitel }}</template>
                </span>
                <AvmKnopf
                    groesse="zeile"
                    :aria-expanded="infoOffen"
                    testid="inhalte-info"
                    @click="infoOffen = !infoOffen"
                >
                    {{ t("inhalte.pfad.info") }} ⓘ
                </AvmKnopf>
            </div>
            <AvmHinweis v-if="infoOffen" class="pfad__info" testid="inhalte-info-text">
                {{ t("inhalte.info.text") }}
            </AvmHinweis>
        </template>

        <InhalteQuellen
            v-if="reiter === 'quellen'"
            :steuerung="quellen"
            :darf-schreiben="props.darfSchreiben"
            :telefon="telefon"
            @oeffne-korpus="oeffneKorpus"
        />
        <InhalteLiteratur
            v-else-if="reiter === 'literatur'"
            :steuerung="literatur"
            :darf-schreiben="props.darfSchreiben"
            :telefon="telefon"
        />
        <InhalteVorkommen
            v-else-if="reiter === 'vorkommen'"
            :steuerung="vorkommen"
            :regel-text="regelText"
            :darf-schreiben="props.darfSchreiben"
            :telefon="telefon"
            @oeffne-quelle="oeffneQuelle"
        />
        <InhalteKorpora
            v-else
            :steuerung="korpora"
            :darf-schreiben="props.darfSchreiben"
            :telefon="telefon"
            @oeffne-quelle="oeffneQuelle"
        />

        <template #fuss-hinweis>
            <span data-testid="inhalte-fuss">{{ fussText }}</span>
        </template>
        <template #fuss-haupt>
            <span class="fuss__knoepfe">
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="zurueckFrei ? undefined : ''"
                    :title="t('inhalte.rueckgaengig')"
                    :aria-label="t('inhalte.rueckgaengig')"
                    testid="inhalte-rueckgaengig"
                    @click="aktiv?.zurueck()"
                    >↶</AvmKnopf
                >
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="wiederFrei ? undefined : ''"
                    :title="t('inhalte.wiederholen')"
                    :aria-label="t('inhalte.wiederholen')"
                    testid="inhalte-wiederholen"
                    @click="aktiv?.wieder()"
                    >↷</AvmKnopf
                >
                <AvmKnopf
                    :gesperrt="verwerfenFrei ? undefined : ''"
                    testid="inhalte-verwerfen"
                    @click="aktiv?.verwerfen()"
                    >{{ t("modusleiste.verwerfen") }}</AvmKnopf
                >
                <AvmKnopf
                    art="gefuellt"
                    :gesperrt="speichernFrei ? undefined : ''"
                    testid="inhalte-speichern"
                    @click="void aktiv?.speichern()"
                    >{{ t("entwurf.speichern") }}</AvmKnopf
                >
            </span>
        </template>
    </AvmFenster>
</template>

<style scoped>
.pfad {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.pfad__text {
    min-width: 0;
}

.pfad__info {
    margin-top: var(--space-6);
}

.fuss__knoepfe {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-6);
}
</style>
