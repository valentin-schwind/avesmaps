<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
    MEDIA_TYPE_IMAGE_OBJECTS,
    type HeaderGraphic,
    type HeaderGraphicObjects,
    type MamTypeImageList,
} from "@avesmaps3d/shared";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmMenueknopf from "../controls/avm-menueknopf.vue";
import AvmSortierzeichen from "../controls/avm-sortierzeichen.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { t } from "../i18n/i18n";
import type { Geladen } from "./medien-daten";
import type { OperationsFehler } from "./medien-operationen";
import { typbildObjekteName, typbildSortName, zahl } from "./medien-text";
import MedienTypbildZeile from "./medien-typbild-zeile.vue";
import {
    TYPBILD_PAAR_FILTER,
    TYPBILD_SORTS,
    TYPBILD_SORT_ZEICHEN,
    TYPBILD_START,
    typbildFilterAnzahl,
    typbildStand,
    typbildZeilen,
    type TypbildAnsicht,
    type TypbildPaarFilter,
    type TypbildSort,
} from "./medien-typbilder-modell";

/**
 * Spalte 2 für das Medienobjekt „Typbilder“ (WI-0068, Betreiber 2026-10-11: „kannst du im MAM die neue kategorie „Typbilder“ machen, wo
 * man sich typbilde anlegen und für jede kategorie eins auswählen kann, markiere diese immer dann mit einem stern“; Blatt abgenommen
 * 2026-10-12).
 *
 * - **Die 37 Kategorien** aus `HEADER_GRAPHICS`, nicht die Assets: Je Kategorie gilt genau ein Asset (der ★) oder noch keines. Die
 *   Liste ist eine feste Liste, keine Seite — es gibt kein „Mehr laden“.
 * - **Leiste des Hauses** (`AvmListenleiste`, Guide §13.45): links die Suche über Beschriftung, Schlüssel und die Titel der ★-Assets,
 *   rechtsbündig Trichter (Objektart, Typbildpaar) und Sortierung (Name, Zahl der Objekte) als Zeichen.
 * - **Typbildpaare** (WI-0281, Betreiber 2026-11-05): Jede Zeile sagt, welche Varianten es gibt (Paar, nur KI, nur ohne KI, keines); der Trichter
 *   „Typbildpaar“ sucht vor allem die unvollständigen, die Unterzeile zählt sie. Das Mockup zeigte dafür Knöpfe über der Liste; hier ist es der Trichter
 *   des Hauses, wie in jeder Liste der Medienverwaltung.
 * - **„Eingebaute Typbilder übernehmen“** steht als EIN Knopf über der Liste, nur mit `publish_media` und nur, solange es etwas zu
 *   übernehmen gibt; der Satz nennt die Zahl. Er ist idempotent und legt nur an, wo eine Kategorie noch keinen ★ hat.
 * - 🔴 Ansicht (Suche, Trichter, Sortierung) ist Zustand DIESER Spalte, nicht der Adresse: Die Adresse trägt die gewählte Kategorie
 *   (`medien-kategorie`), damit ein tiefer Link genau sie öffnet; wie die Liste gerade gefiltert ist, gehört nicht in einen Link.
 */
const props = defineProps<{
    liste: Geladen<MamTypeImageList>;
    kategorie: HeaderGraphic | undefined;
    telefon: boolean;
    /** „Eingebaute Typbilder übernehmen“ braucht `publish_media` (er macht nach der Policy bis zu 37 Bilder öffentlich). */
    darfUebernehmen: boolean;
    /** Läuft das Übernehmen gerade? Dann ist der Knopf gesperrt und sagt es (Guide §30.5 „Gesperrt“). */
    uebernimmt: boolean;
    /** Der Fehler der letzten Handlung (★ setzen, übernehmen); er steht über der Liste, nicht im Bild einer Zeile. */
    opFehler?: OperationsFehler | undefined;
}>();
const emit = defineEmits<{
    waehle: [kategorie: HeaderGraphic];
    uebernehmen: [];
    erneut: [];
    zurueck: [];
}>();

const ansicht = ref<TypbildAnsicht>({ ...TYPBILD_START, filter: {} });

const zeilen = computed(() => typbildZeilen(props.liste.wert, ansicht.value));
const stand = computed(() => typbildStand(zeilen.value, props.liste.wert));

const titel = computed(() => t("medien.objekt.typbilder"));

// Wer über ⚙ oder „Medienverwaltung › Typbild“ kommt, soll nicht suchen (Vali 2026-11-02: „das wär praktisch dass man nciht suchen uss“): Die gewählte Zeile steht im Bild, auch weit unten in der Liste.
const listenWurzel = ref<HTMLElement>();
watch(
    [() => props.kategorie, () => zeilen.value.length],
    () =>
        void nextTick(() =>
            listenWurzel.value?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" }),
        ),
    { immediate: true },
);
const unterzeile = computed(() => {
    if (props.liste.laedt && props.liste.wert === undefined) return t("medien.treffer.laedt");
    return t("medien.typbild.unterzeile", {
        n: zahl(stand.value.gezeigt),
        ohne: zahl(stand.value.ohneStern),
        offen: zahl(stand.value.unvollstaendig),
    });
});

/** Der Trichter: Objektart und Typbildpaar, je eine Wahl (wie jeder Filter der Medienverwaltung). */
const abschnitte = computed<FilterAbschnitt[]>(() => [
    {
        id: "objekte",
        titel: t("medien.typbild.filter.objekte"),
        art: "eins",
        werte: MEDIA_TYPE_IMAGE_OBJECTS.map((wert) => ({ wert, text: typbildObjekteName(wert) })),
    },
    {
        id: "paar",
        titel: t("medien.typbild.filter.paar"),
        art: "eins",
        werte: TYPBILD_PAAR_FILTER.map((wert) => ({ wert, text: t(`medien.typbild.filter.paar.${wert}`) })),
    },
]);
const wahl = computed<FilterWahl>(() => ({
    objekte: ansicht.value.filter.objekte === undefined ? [] : [ansicht.value.filter.objekte],
    paar: ansicht.value.filter.paar === undefined ? [] : [ansicht.value.filter.paar],
}));

function setzeFilter(abschnitt: string, werte: readonly string[]): void {
    const wert = werte[0] ?? "";
    const filter = { ...ansicht.value.filter };
    if (abschnitt === "objekte") {
        if (wert === "") delete filter.objekte;
        else filter.objekte = wert as HeaderGraphicObjects;
    } else if (abschnitt === "paar") {
        const paar = TYPBILD_PAAR_FILTER.find((eintrag) => eintrag === wert);
        if (paar === undefined) delete filter.paar;
        else filter.paar = paar satisfies TypbildPaarFilter;
    }
    ansicht.value = { ...ansicht.value, filter };
}

const sortierung = computed(() => TYPBILD_SORTS.map((sort) => ({ wert: sort, text: typbildSortName(sort) })));
/** Dieselbe Sortierung erneut gewählt dreht die Richtung (wie in der Trefferliste). */
function setzeSort(wert: string): void {
    const sort = TYPBILD_SORTS.find((eintrag) => eintrag === wert) ?? TYPBILD_START.sort;
    if (sort !== ansicht.value.sort) {
        ansicht.value = { ...ansicht.value, sort, order: undefined };
        return;
    }
    const jetzt = ansicht.value.order ?? (sort === "name" ? "asc" : "desc");
    ansicht.value = { ...ansicht.value, order: jetzt === "asc" ? "desc" : "asc" };
}
const sortBezeichnung = computed(() => t("medien.sort.knopf", { name: typbildSortName(ansicht.value.sort) }));

const eingeschraenkt = computed(
    () => ansicht.value.suche.trim() !== "" || typbildFilterAnzahl(ansicht.value.filter) > 0,
);
function loese(): void {
    ansicht.value = { ...ansicht.value, suche: "", filter: {} };
}
</script>

<template>
    <FensterSpalte
        breite="fuellen"
        :telefon="telefon"
        :titel="titel"
        :unterzeile="unterzeile"
        testid="medien-spalte-typbilder"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="medien-zurueck-arten" @click="emit('zurueck')">{{
                t("medien.zurueck.arten")
            }}</AvmKnopf>
        </template>
        <template #leiste>
            <AvmListenleiste
                :model-value="ansicht.suche"
                :platzhalter="t('medien.typbild.suche.platzhalter')"
                :beschriftung="t('medien.typbild.suche.label')"
                class="typbilder__leiste"
                testid="medien-typbilder"
                @update:model-value="(wert: string) => (ansicht = { ...ansicht, suche: wert })"
            >
                <AvmFilterknopf
                    :abschnitte="abschnitte"
                    :wahl="wahl"
                    testid="medien-typbilder-filter"
                    @setze="setzeFilter"
                    @loesen="ansicht = { ...ansicht, filter: {} }"
                />
                <AvmMenueknopf
                    :model-value="ansicht.sort"
                    :optionen="sortierung"
                    :bezeichnung="sortBezeichnung"
                    :menue-bezeichnung="t('medien.typbild.sort.label')"
                    im-fenster
                    testid="medien-typbilder-sortierung"
                    @update:model-value="setzeSort"
                >
                    <template #zeichen="{ wert }"
                        ><AvmSortierzeichen :art="TYPBILD_SORT_ZEICHEN[wert as TypbildSort]"
                    /></template>
                </AvmMenueknopf>
            </AvmListenleiste>
        </template>

        <AvmHinweis v-if="opFehler" :ton="opFehler.ton" rolle="alert" testid="medien-typbilder-op-fehler">{{
            opFehler.text
        }}</AvmHinweis>
        <AvmHinweis v-if="liste.fehler" :ton="liste.fehler.ton" rolle="alert" testid="medien-typbilder-fehler">{{
            liste.fehler.text
        }}</AvmHinweis>
        <AvmKnopf
            v-if="liste.fehler?.erneut"
            groesse="zeile"
            testid="medien-typbilder-erneut"
            @click="emit('erneut')"
            >{{ t("medien.erneut") }}</AvmKnopf
        >

        <!--
            Ein Klick für alle Kategorien ohne ★ (Betreiber 2026-10-12: die 37 Grafiken sind sein eigenes KI-Werk). Er steht VOR der
            Liste, weil er die ganze Liste betrifft, und verschwindet, sobald es nichts mehr zu übernehmen gibt.
        -->
        <AvmKnopf
            v-if="darfUebernehmen && stand.uebernehmbar > 0"
            groesse="zeile"
            class="typbilder__uebernehmen"
            :gesperrt="uebernimmt ? t('medien.typbild.uebernehmen.laeuft') : undefined"
            testid="medien-typbilder-uebernehmen"
            @click="emit('uebernehmen')"
        >
            {{
                uebernimmt
                    ? t("medien.typbild.uebernehmen.laeuft")
                    : t("medien.typbild.uebernehmen", { n: zahl(stand.uebernehmbar) })
            }}
        </AvmKnopf>

        <div
            v-if="!liste.fehler && !liste.laedt && zeilen.length === 0"
            class="typbilder__leer"
            data-testid="medien-typbilder-leer"
        >
            <p>{{ eingeschraenkt ? t("medien.typbild.leerGefiltert") : t("medien.typbild.leer") }}</p>
            <AvmKnopf v-if="eingeschraenkt" groesse="zeile" testid="medien-typbilder-filter-loesen" @click="loese">{{
                t("medien.filter.loesen")
            }}</AvmKnopf>
        </div>

        <ul
            v-if="zeilen.length > 0"
            ref="listenWurzel"
            class="typbilder__liste"
            :aria-label="titel"
            data-testid="medien-typbilder"
        >
            <li v-for="eintrag in zeilen" :key="eintrag.category">
                <MedienTypbildZeile
                    :eintrag="eintrag"
                    :gewaehlt="eintrag.category === kategorie"
                    @waehle="emit('waehle', eintrag.category)"
                />
            </li>
        </ul>
        <p v-if="liste.laedt" class="typbilder__satz" data-testid="medien-typbilder-laedt">
            {{ t("medien.treffer.laedt") }}
        </p>
    </FensterSpalte>
</template>

<style scoped>
/* Die Leiste füllt die Zeile der Spalte; Suche links, die Zeichen rechtsbündig (`AvmListenleiste`, Guide §13.45). */
.typbilder__leiste {
    flex: 1 1 auto;
    min-width: 0;
}

.typbilder__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.typbilder__uebernehmen {
    align-self: flex-start;
}

.typbilder__leer {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-6);
}

.typbilder__leer p,
.typbilder__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
