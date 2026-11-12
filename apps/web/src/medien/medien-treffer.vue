<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import {
    MAM_SORTS,
    type MamAssetSummary,
    type MamEinreichung,
    type MamNavigation,
    type MediaUsageSubject,
} from "@avesmaps3d/shared";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmMenueknopf from "../controls/avm-menueknopf.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import AvmSortierzeichen from "../controls/avm-sortierzeichen.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import type { MedienListe } from "./medien-daten";
import MedienEintrag from "./medien-eintrag.vue";
import MedienEintragNeu from "./medien-eintrag-neu.vue";
import { reiter } from "./medien-einreichung-modell";
import type { BindbareRolle } from "./medien-formular-modell";
import MedienZeichen from "./medien-zeichen.vue";
import {
    SORT_ZEICHEN,
    korbErklaerung,
    korbName,
    medienFilterAbschnitte,
    medienFilterWahl,
    objektName,
    sortName,
    subjektArtName,
    typMehrzahl,
    zahl,
} from "./medien-text";
import {
    filterAnzahl,
    hochladbareRollen,
    istEinreichungsKorb,
    liegtAufKarte,
    mitFilter,
    naechsterEintrag,
    ohneFilter,
    vonLesen,
    type MedienAnsicht,
    type MedienBild,
    type MedienFilterName,
    type MedienZustand,
} from "./medien-zustand";

/**
 * Spalte 2 der Medienverwaltung: die Treffer (WI-0068 §3.2). Oben EINE Zeile (Betreiber 2026-10-10: „mach nicht so viel filterzeilen …
 * versuch so viel in icons zu packen wie möglich“): links die Suche und gleich daneben der Trichter mit allen Filtern (Betreiber
 * 2026-10-11: die Suche hat in der Titelleiste „überhaupt nichts verloren, weil eh kategorie-spezifisch“). Seit Entscheid 3f7acfc8 die
 * Leiste des Hauses (`AvmListenleiste`): links die Suche, rechtsbündig die Zeichen; „verwendet von Gareth ✕“ steht lösbar in der
 * Trefferzeile darunter. Früher rechtsbündig „Verwendet von:
 * Gareth ✕“; rechts die Sortierung als Zeichen mit Ausklappmenü (Betreiber 2026-10-11: „kannst du sortieren zu einem icon machen, wo
 * darunter dann die optionen komme und dem suchfeld dann die restliche breite geben?“), Raster oder Liste und im Raster Füllen oder
 * Ganz, die Umschalter als Zeichen. Die Suche nimmt den Rest der Zeile. Darunter die
 * Treffer, seitenweise („Mehr laden“). Ist ein Korb gewählt, sagt die Unterzeile, was er bedeutet (die Schiene links ist einzeilig).
 *
 * - **Hochladen** (Schritt 7): Mit `upload_media` steht vorn „↥ Neues Wappen/Titelbild hochladen“ (`medien-eintrag-neu.vue`); das
 *   Formular öffnet das Fenster der Medienverwaltung darüber (`medien-fenster.vue`).
 * - **Bedienung** (Fuß des Fensters sagt es): Klick wählt, Doppelklick zeigt die erste Verwendung auf der Karte, die Pfeiltasten
 *   blättern durch die geladenen Treffer. Hover ist nie die einzige Aktion (§3.4).
 * - 🔴 Der Leerzustand sagt, warum (Guide §15 „Lade-, Leer- und Fehlerzustände“), und bietet „Filter lösen“ an, wo Filter stehen.
 * - Fehler stehen im Umschlag des Servers; 401 und 403 sind eine Auskunft und tragen kein „Erneut versuchen“ (`medien-client.ts`).
 */
const props = defineProps<{
    zustand: MedienZustand;
    liste: MedienListe;
    /** Der Name des Fachobjekts hinter „verwendet von“, soweit bekannt. */
    vonName: string | undefined;
    telefon: boolean;
    /** Darf die Sitzung hochladen (`upload_media`)? */
    darfHochladen?: boolean | undefined;
    /** Darf die Sitzung alle bytegleichen Duplikate in einem Lauf zusammenführen (`merge_media_all`, nur Betreiber)? */
    darfAlleZusammenfuehren?: boolean | undefined;
    /** Die Navigation: Aus ihr kommen die Zahlen der Reiter im Korb „PhotoBox-Uploads“ (WI-0272 S3). */
    navigation?: MamNavigation | undefined;
    /** Ein kurzer Satz über der Liste, etwa nach dem endgültigen Löschen; die nächste Wahl nimmt ihn weg. */
    hinweis?: string | undefined;
}>();
const emit = defineEmits<{
    setze: [zustand: MedienZustand];
    waehleAsset: [id: string];
    aufKarte: [subjekt: MediaUsageSubject];
    mehr: [];
    erneut: [];
    zurueck: [];
    hochladen: [rolle: BindbareRolle];
    alleZusammenfuehren: [];
}>();

const neu = computed<BindbareRolle[]>(() =>
    props.darfHochladen === true ? hochladbareRollen(props.zustand.auswahl) : [],
);

// Ein Medienobjekt zeigt diese Spalte nie (`medien-fenster.vue` setzt dann die eigene davor); der Fall steht nur, damit der Typ hält.
const titel = computed(() => {
    const auswahl = props.zustand.auswahl;
    if ("korb" in auswahl) return korbName(auswahl.korb);
    if ("objekt" in auswahl) return objektName(auswahl.objekt);
    return auswahl.typ === null ? t("medien.arten.alle") : typMehrzahl(auswahl.typ);
});
const von = computed(() => vonLesen(props.zustand.von));
const vonText = computed(() =>
    von.value === undefined ? undefined : (props.vonName ?? subjektArtName(von.value.kind)),
);
/** Die Trefferzeile um das ✕ von „verwendet von …“ herum: davor Zahl und Name, danach die Erklärung eines Korbs. */
const unterzeileVorher = computed(() =>
    vonText.value === undefined ? "" : t("medien.treffer.von", { anzahl: trefferZahl.value, name: vonText.value }),
);
const unterzeileNachher = computed(() =>
    "korb" in props.zustand.auswahl ? ` · ${korbErklaerung(props.zustand.auswahl.korb)}` : "",
);
const trefferZahl = computed(() =>
    t(props.liste.total === 1 ? "medien.treffer.eins" : "medien.treffer.viele", { n: zahl(props.liste.total) }),
);

const unterzeile = computed(() => {
    if (props.liste.laedt && props.liste.items.length === 0) return t("medien.treffer.laedt");
    const anzahl = t(props.liste.total === 1 ? "medien.treffer.eins" : "medien.treffer.viele", {
        n: zahl(props.liste.total),
    });
    const zeile = vonText.value === undefined ? anzahl : t("medien.treffer.von", { anzahl, name: vonText.value });
    return "korb" in props.zustand.auswahl ? `${zeile} · ${korbErklaerung(props.zustand.auswahl.korb)}` : zeile;
});

function setzeSuche(q: string): void {
    emit("setze", { ...props.zustand, q });
}

// --- Die Reiter des Korbs „PhotoBox-Uploads“ (WI-0272 S3): Offen, Rückfrage, Erledigt ---
const mitReitern = computed(() => istEinreichungsKorb(props.zustand.auswahl));
const reiterOptionen = computed(() =>
    reiter(props.navigation).map((eintrag) => ({
        value: eintrag.id,
        label:
            eintrag.anzahl === undefined
                ? eintrag.text
                : t("medien.einreichung.reiterZahl", { name: eintrag.text, n: zahl(eintrag.anzahl) }),
    })),
);
function setzeReiter(teil: string): void {
    emit("setze", { ...props.zustand, einreichung: teil as MamEinreichung });
}

// --- Filter ---

function setzeFilter(name: MedienFilterName, wert: string): void {
    emit("setze", mitFilter(props.zustand, name, (wert === "" ? undefined : wert) as never));
}

const sortierung = computed(() => MAM_SORTS.map((sort) => ({ wert: sort, text: sortName(sort) })));
/** Die Filter hinter dem Trichter des Hauses (`controls/avm-filterknopf.vue`, Guide §13.45). */
const filterAbschnitte = medienFilterAbschnitte();
const sortBezeichnung = computed(() => t("medien.sort.knopf", { name: sortName(props.zustand.sort) }));
const ansichten = computed(() => [
    { value: "raster", label: t("medien.ansicht.raster") },
    { value: "liste", label: t("medien.ansicht.liste") },
]);

function setzeSort(sort: string): void {
    emit("setze", { ...props.zustand, sort: sort as MedienZustand["sort"], order: undefined });
}

const bilder = computed(() => [
    { value: "fuellen", label: t("medien.bild.fuellen") },
    { value: "ganz", label: t("medien.bild.ganz") },
]);
function setzeBild(bild: string): void {
    emit("setze", { ...props.zustand, bild: bild as MedienBild });
}

function setzeAnsicht(ansicht: string): void {
    emit("setze", { ...props.zustand, ansicht: ansicht as MedienAnsicht });
}

const eingeschraenkt = computed(() => filterAnzahl(props.zustand) > 0 || props.zustand.q.trim() !== "");

// --- Liste ---

const behaelter = useTemplateRef<HTMLElement>("behaelter");

function waehle(eintrag: MamAssetSummary): void {
    emit("waehleAsset", eintrag.id);
}

/** Doppelklick: die erste Verwendung mit Kartenlage anfliegen (WI-0068 §8). */
function doppelt(eintrag: MamAssetSummary): void {
    const subjekt = eintrag.primaryUsage?.subject;
    if (subjekt !== null && subjekt !== undefined && liegtAufKarte(subjekt.kind)) emit("aufKarte", subjekt);
}

/** ← ↑ ein Treffer zurück, → ↓ einer weiter; der neue bekommt den Fokus und wird gewählt. */
function taste(event: KeyboardEvent): void {
    const schritt =
        event.key === "ArrowRight" || event.key === "ArrowDown"
            ? 1
            : event.key === "ArrowLeft" || event.key === "ArrowUp"
              ? -1
              : 0;
    if (schritt === 0) return;
    const ids = props.liste.items.map((eintrag) => eintrag.id);
    const naechster = naechsterEintrag(ids, props.zustand.asset, schritt);
    if (naechster === undefined) return;
    event.preventDefault();
    emit("waehleAsset", naechster);
    requestAnimationFrame(() =>
        behaelter.value?.querySelector<HTMLElement>(`[data-asset="${naechster}"]`)?.focus({ preventScroll: false }),
    );
}
</script>

<template>
    <FensterSpalte
        breite="fuellen"
        :telefon="telefon"
        :titel="titel"
        :unterzeile="unterzeile"
        testid="medien-spalte-treffer"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="medien-zurueck-arten" @click="emit('zurueck')">{{
                t("medien.zurueck.arten")
            }}</AvmKnopf>
        </template>
        <!-- „· verwendet von Gareth ✕“: lösbar in der Trefferzeile, nicht in der Leiste (Guide §13.45, Koordination 2026-10-11). -->
        <template v-if="vonText !== undefined" #unter>
            {{ unterzeileVorher
            }}<button
                type="button"
                class="medien-treffer__loesen"
                :aria-label="t('medien.filter.vonLoesen')"
                :title="t('medien.filter.vonLoesen')"
                data-testid="medien-filter-von"
                @click="emit('setze', { ...zustand, von: undefined })"
            >
                ✕</button
            >{{ unterzeileNachher }}
        </template>
        <template #leiste>
            <!-- Die Leiste des Hauses (Guide §13.45): links die Suche, rechtsbündig Trichter, Sortierung, Umschalter. -->
            <AvmListenleiste
                :model-value="zustand.q"
                :platzhalter="t('medien.suche.platzhalter')"
                :beschriftung="t('medien.suche.label')"
                class="medien-treffer__leiste"
                testid="medien"
                @update:model-value="setzeSuche"
            >
                <AvmFilterknopf
                    :abschnitte="filterAbschnitte"
                    :wahl="medienFilterWahl(zustand.filter)"
                    testid="medien-filter"
                    @setze="(name, werte) => setzeFilter(name as MedienFilterName, werte[0] ?? '')"
                    @loesen="emit('setze', { ...zustand, filter: {} })"
                />
                <AvmMenueknopf
                    :model-value="zustand.sort"
                    :optionen="sortierung"
                    :bezeichnung="sortBezeichnung"
                    :menue-bezeichnung="t('medien.sort.label')"
                    im-fenster
                    testid="medien-sortierung"
                    @update:model-value="setzeSort"
                >
                    <template #zeichen="{ wert }"
                        ><AvmSortierzeichen :art="SORT_ZEICHEN[wert as MedienZustand['sort']]"
                    /></template>
                </AvmMenueknopf>
                <AvmSegmente
                    :model-value="zustand.ansicht"
                    :options="ansichten"
                    :label="t('medien.ansicht.label')"
                    testid="medien-ansicht"
                    @update:model-value="setzeAnsicht"
                >
                    <template #zeichen="{ option }"
                        ><MedienZeichen :name="option.value === 'liste' ? 'liste' : 'raster'"
                    /></template>
                </AvmSegmente>
                <AvmSegmente
                    v-if="zustand.ansicht === 'raster'"
                    :model-value="zustand.bild"
                    :options="bilder"
                    :label="t('medien.bild.label')"
                    testid="medien-bild"
                    @update:model-value="setzeBild"
                >
                    <template #zeichen="{ option }"
                        ><MedienZeichen :name="option.value === 'ganz' ? 'ganz' : 'fuellen'"
                    /></template>
                </AvmSegmente>
            </AvmListenleiste>
        </template>

        <!-- Im Korb „PhotoBox-Uploads“: die Unterteilung als Reiter über der Liste (WI-0272 S3). -->
        <AvmSegmente
            v-if="mitReitern"
            :model-value="zustand.einreichung"
            :options="reiterOptionen"
            :label="t('medien.einreichung.reiterLabel')"
            testid="medien-einreichung-reiter"
            @update:model-value="setzeReiter"
        />
        <!-- Im Korb „Gleiche Datei“: der Sammellauf über alle bytegleichen Gruppen (WI-0068, Betreiber 2026-10-17), nur Betreiber. -->
        <AvmKnopf
            v-if="darfAlleZusammenfuehren && 'korb' in zustand.auswahl && zustand.auswahl.korb === 'shared_file'"
            groesse="zeile"
            class="medien-treffer__sammellauf"
            testid="medien-merge-alle-oeffnen"
            @click="emit('alleZusammenfuehren')"
        >
            <template #zeichen>⊕</template>
            {{ t("medien.mergeAlle.oeffnen") }}
        </AvmKnopf>
        <AvmHinweis v-if="liste.fehler" :ton="liste.fehler.ton" rolle="alert" testid="medien-treffer-fehler">{{
            liste.fehler.text
        }}</AvmHinweis>
        <AvmHinweis v-if="hinweis" rolle="status" testid="medien-treffer-hinweis">{{ hinweis }}</AvmHinweis>
        <AvmKnopf v-if="liste.fehler?.erneut" groesse="zeile" testid="medien-treffer-erneut" @click="emit('erneut')">{{
            t("medien.erneut")
        }}</AvmKnopf>
        <div
            v-if="!liste.fehler && !liste.laedt && liste.items.length === 0"
            class="medien-treffer__leer"
            data-testid="medien-treffer-leer"
        >
            <p>
                {{
                    eingeschraenkt
                        ? t("medien.treffer.leerGefiltert")
                        : mitReitern
                          ? t(`medien.einreichung.leer.${zustand.einreichung}` as MessageKey)
                          : t("medien.treffer.leer")
                }}
            </p>
            <AvmKnopf
                v-if="eingeschraenkt"
                groesse="zeile"
                testid="medien-treffer-filter-loesen"
                @click="emit('setze', ohneFilter(zustand))"
                >{{ t("medien.filter.loesen") }}</AvmKnopf
            >
        </div>
        <ul
            v-if="liste.items.length > 0 || (neu.length > 0 && !liste.laedt && !liste.fehler)"
            ref="behaelter"
            class="medien-treffer__liste"
            :class="`medien-treffer__liste--${zustand.ansicht}`"
            :aria-label="titel"
            data-testid="medien-treffer"
            @keydown="taste"
        >
            <li v-for="rolle in neu" :key="`neu-${rolle}`">
                <MedienEintragNeu :rolle="rolle" :ansicht="zustand.ansicht" @hochladen="emit('hochladen', rolle)" />
            </li>
            <li v-for="eintrag in liste.items" :key="eintrag.id">
                <MedienEintrag
                    :eintrag="eintrag"
                    :ansicht="zustand.ansicht"
                    :bild="zustand.bild"
                    :gewaehlt="eintrag.id === zustand.asset"
                    @waehle="waehle(eintrag)"
                    @doppelt="doppelt(eintrag)"
                />
            </li>
        </ul>
        <p v-if="liste.laedt" class="medien-treffer__satz" data-testid="medien-treffer-laedt">
            {{ t("medien.treffer.laedt") }}
        </p>
        <AvmKnopf
            v-else-if="liste.items.length > 0 && liste.items.length < liste.total"
            groesse="zeile"
            class="medien-treffer__mehr"
            testid="medien-mehr"
            @click="emit('mehr')"
        >
            {{ t("medien.treffer.mehr", { n: zahl(liste.items.length), von: zahl(liste.total) }) }}
        </AvmKnopf>
    </FensterSpalte>
</template>

<style scoped>
/* Die Leiste füllt die Zeile der Spalte; Suche links, die Zeichen rechtsbündig (`AvmListenleiste`, Guide §13.45). */
.medien-treffer__leiste {
    flex: 1 1 auto;
}

/* Das ✕ hinter „verwendet von Gareth“: klein in der Trefferzeile, die Fläche färbt sich unter Zeiger und Druck (§30.5). */
.medien-treffer__loesen {
    margin: 0 0 0 var(--space-2);
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    line-height: inherit;
    transition:
        background-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.medien-treffer__loesen:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.medien-treffer__loesen:active {
    background: var(--color-active-wash);
}

.medien-treffer__loesen:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.medien-treffer__liste {
    margin: 0;
    padding: 0;
    list-style: none;
}

.medien-treffer__liste--raster {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--avm-fenster-kachel), 1fr));
    gap: var(--space-4);
}

.medien-treffer__liste--liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.medien-treffer__leer {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-6);
    color: var(--color-text-muted);
}

.medien-treffer__leer p,
.medien-treffer__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.medien-treffer__mehr {
    margin-top: var(--space-8);
}

@media (prefers-reduced-motion: reduce) {
    .medien-treffer__loesen {
        transition: none;
    }
}
</style>
