<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { HeaderGraphic, MediaSubjectSlots, OperationReceipt } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import { formatNumber, t } from "../i18n/i18n";
import MedienAuswahlFenster from "../medien/medien-auswahl-fenster.vue";
import { istAbbruch } from "../medien/medien-client";
import { oeffneMedien } from "../medien/medien-oeffnen";
import MedienWappenKasten from "../medien/medien-wappen-kasten.vue";
import {
    Handlung,
    createMedienOperationen,
    operationsFehler,
    type MedienOperationen,
    type OperationsFehler,
} from "../medien/medien-operationen";
import { bildName, freigabe, herkunft } from "../medien/medien-platz-text";
import GalerieWahlFenster from "./galerie-wahl-fenster.vue";
import OrtseditorReisebilder from "./ortseditor-reisebilder.vue";

/**
 * Der Reiter „Bilder“ (WI-0128 E19; EDIT-0001 §8.1 E19; WI-0126 §11j; Gesamtmockup Version 7): Wappen hinzufügen, ersetzen und entfernen
 * („bewusst ohne“), das Titelbild hinzufügen und lösen. Das Wappen ist DER Wappen-Kasten der Medienverwaltung (`medien-wappen-kasten.vue`),
 * derselbe wie an den Herrschaftsgebieten.
 *
 * 🔴 **EIN Titelbild ODER EINE Galerie** (WI-0219; Betreiber 2026-10-17: „er kann nicht mehr wie ein bild haben, EIN titelbild oder
 * EINE Galerie“). „Titelbild hinzufügen …“ setzt ein Bild (`header.set`), „Galerie hinzufügen …“ bindet eine Galerie der Medienverwaltung
 * (`gallery.bind`). Jede Wahl ersetzt, was bisher am Ort hängt; das Alte wird nur gelöst und bleibt in der Medienverwaltung unter
 * „Bilder“ bzw. „Galerien“. Eine Galerie ist ein geteiltes Objekt, das an mehreren Orten hängen darf: Hier stehen ihre Bilder nur als
 * Vorschau, bearbeitet wird sie in der Medienverwaltung. Bis WI-0195 hängten zwei Knöpfe Bilder an die Galerie des Orts; das ist weg.
 *
 * - Jede Handlung ist EINE Operation der Medienverwaltung (`medien-operationen.ts`), keine eigene Ort-Route; sie wirkt sofort, ohne die
 *   Speicherleiste des Formulars. Danach liest der Reiter die Plätze neu und meldet `geaendert` (Liste und Infopanel folgen).
 * - Wählen und „↥ Neues … hochladen“ sind das Fenster der Medienverwaltung (`medien-auswahl-fenster.vue`), es lädt seine Plätze selbst.
 * - Öffentlich entscheidet allein die Medienverwaltung; bis dahin steht „wartet auf Rechteprüfung“ am Bild.
 * - Der gesehene Stand geht mit (Revision der Bindung bzw. der Galerie): Ein Konflikt sagt, wer schneller war, und die Plätze laden neu.
 *
 * **Was das Infopanel zeigt** (Valis Kopfregel 2026-11-02): nur Typbild: Typbild. Typbild und Reisebilder: nur Reisebilder. Eigenes Titelbild: das Titelbild. Eigenes Titelbild und Reisebilder: das Titelbild zuerst,
 * dann die Reisebilder. „Titelbild entfernen“ heißt „kein eigenes Titelbild, also Typbild“, nichts sonst. Ohne eigenes Bild führt der Verweis zum Typbild dieser Ortsgröße, damit niemand es suchen muss.
 */
const props = defineProps<{
    publicId: string;
    name: string;
    kennung: string;
    /** Bindungen ändern (`upload_media`); ohne steht alles lesend da. */
    darfAendern: boolean;
    /** Das Typbild dieser Ortsgröße: Dorthin führt „Medienverwaltung › Typbild“, solange der Ort kein eigenes Bild hat. */
    typbild?: HeaderGraphic | undefined;
    operationen?: MedienOperationen | undefined;
}>();
const emit = defineEmits<{
    /** „Medienverwaltung › Wappen“ bzw. „› Titelbilder“. */
    medien: [rolle: "coat" | "header"];
    /** Eine Bindung hat sich geändert: Ortsliste und Infopanel lesen neu. */
    geaendert: [];
}>();

const ops = props.operationen ?? createMedienOperationen();
const plaetze = shallowRef<MediaSubjectSlots | undefined>();
const ladeFehler = ref<string | undefined>();
const fehler = ref<OperationsFehler | undefined>();
const sendet = ref(false);
const fragenTitelbild = ref(false);
/** Erst nach dem ersten Öffnen steht die Auswahl des Titelbilds im Baum; danach bleibt sie, `offen` schaltet sie. */
const auswahlDa = ref(false);
const auswahlOffen = ref(false);
const galerieWahlOffen = ref(false);
/** Je Handlung eine Kennung: Ein unklarer Ausgang wiederholt dieselbe Handlung mit derselben Kennung, eine andere bekommt eine neue. */
const handlungen = new Map<string, Handlung>();

let lauf: AbortController | undefined;
async function lade(): Promise<void> {
    lauf?.abort();
    const eigener = new AbortController();
    lauf = eigener;
    try {
        const stand = await ops.plaetze("place", props.publicId, eigener.signal);
        if (!eigener.signal.aborted) {
            plaetze.value = stand;
            ladeFehler.value = undefined;
        }
    } catch (error) {
        if (!istAbbruch(error) && !eigener.signal.aborted) ladeFehler.value = operationsFehler(error).text;
    }
}

watch(
    () => props.publicId,
    () => {
        plaetze.value = undefined;
        fehler.value = undefined;
        fragenTitelbild.value = false;
        auswahlOffen.value = false;
        galerieWahlOffen.value = false;
        void lade();
    },
    { immediate: true },
);
onBeforeUnmount(() => lauf?.abort());

/** Der Platz des Titelbilds (nur an Orten): EIN Bild (`image`) ODER EINE Galerie (`gallery`, ihre Bilder in `items`). */
const kopf = computed(() => plaetze.value?.header ?? undefined);
const bild = computed(() => kopf.value?.image ?? undefined);
const galerie = computed(() => kopf.value?.gallery ?? undefined);
const galerieBilder = computed(() => kopf.value?.items ?? []);
const besetzt = computed(() => bild.value !== undefined || galerie.value !== undefined);
const galerieName = computed(() => galerie.value?.title ?? t("ortseditor.bilder.galerieOhneTitel"));
const galerieZahl = computed(() =>
    t(galerieBilder.value.length === 1 ? "ortseditor.bilder.einBild" : "ortseditor.bilder.bilderZahl", {
        n: formatNumber(galerieBilder.value.length, 0),
    }),
);
const gesperrt = computed(() => (sendet.value ? t("medien.bearbeiten.sendet") : undefined));
/** Wie viele Reisebilder der Ort hat (das Panel meldet es): Der Satz im leeren Kasten sagt, was das Infopanel dann zeigt. */
const reisebildZahl = ref(0);
/** Ohne eigenes Bild zeigt der Kopf das Typbild: Der Verweis führt genau dorthin. */
const zumTypbild = computed(() => !besetzt.value && props.typbild !== undefined);
function zuDenTitelbildern(): void {
    if (zumTypbild.value && props.typbild !== undefined) oeffneMedien({ typbild: props.typbild });
    else emit("medien", "header");
}

async function fuehreAus(schluessel: string, lauf: (operationId: string) => Promise<OperationReceipt>): Promise<void> {
    sendet.value = true;
    fehler.value = undefined;
    const handlung = handlungen.get(schluessel) ?? new Handlung();
    handlungen.set(schluessel, handlung);
    try {
        await handlung.fuehreAus(lauf);
        handlungen.delete(schluessel);
        fragenTitelbild.value = false;
        emit("geaendert");
    } catch (error) {
        fehler.value = operationsFehler(error);
    } finally {
        sendet.value = false;
        await lade();
    }
}

function waehleTitelbild(): void {
    fehler.value = undefined;
    auswahlDa.value = true;
    auswahlOffen.value = true;
}

function gebunden(): void {
    void lade();
    emit("geaendert");
}

/** „Titelbild entfernen“: löst, was hängt (mit seinem gesehenen Stand). Der Kopf zeigt danach das Typbild oder die Reisebilder des Ortes. */
function keinTitelbild(): void {
    const gesehen =
        bild.value !== undefined
            ? { baseRevision: bild.value.revision }
            : galerie.value !== undefined
              ? { galleryRevision: galerie.value.revision }
              : undefined;
    if (gesehen === undefined) return;
    void fuehreAus(`titelbild-weg:${JSON.stringify(gesehen)}`, (operationId) =>
        ops.keinTitelbild({ operationId, placeId: props.publicId, ...gesehen }),
    );
}
</script>

<template>
    <div class="bilder" :data-testid="`${kennung}-bilder`">
        <AvmHinweis v-if="ladeFehler" ton="gefahr" rolle="alert" :testid="`${kennung}-bilder-ladefehler`">{{
            ladeFehler
        }}</AvmHinweis>
        <AvmHinweis v-if="fehler" :ton="fehler.ton" rolle="alert" :testid="`${kennung}-bilder-fehler`">{{
            fehler.text
        }}</AvmHinweis>
        <!-- Die Kästen samt Verweis in die Medienverwaltung stehen immer da; ihr Inhalt wartet auf die Plätze. -->
        <MedienWappenKasten
            :subjekt="{ kind: 'place', id: publicId, name }"
            :kennung="kennung"
            :darf-aendern="darfAendern"
            verweis
            weg="ortseditor"
            :operationen="ops"
            @medien="emit('medien', 'coat')"
            @geaendert="emit('geaendert')"
        />

        <section v-if="!plaetze || kopf" class="bilder__kasten" :data-testid="`${kennung}-bilder-titelbilder`">
            <div class="bilder__kopf">
                <h4 class="bilder__titel">{{ t("ortseditor.bilder.titelbilder") }}</h4>
                <button
                    type="button"
                    class="bilder__verweis"
                    :data-testid="`${kennung}-medien-titelbilder`"
                    @click="zuDenTitelbildern"
                >
                    {{ t(zumTypbild ? "ortseditor.bilder.zuTypbild" : "ortseditor.bilder.zuTitelbildern") }}
                </button>
            </div>
            <!-- EIN Bild … -->
            <div v-if="bild" class="bilder__wappen" :data-testid="`${kennung}-bilder-titelbild`">
                <img v-if="bild.asset.preview" class="bilder__titelbild" :src="bild.asset.preview.url" alt="" />
                <span v-else class="bilder__titelbild bilder__daumen--leer" aria-hidden="true"></span>
                <span class="bilder__gebunden">
                    <span class="bilder__name" :data-testid="`${kennung}-bilder-titelbild-name`">{{
                        bildName(bild.asset)
                    }}</span>
                    <span class="bilder__leise">{{ herkunft(bild.asset) }}</span>
                </span>
                <AvmPille
                    :ton="freigabe(bild.asset).ton"
                    :title="freigabe(bild.asset).grund"
                    :testid="`${kennung}-bilder-titelbild-freigabe`"
                    >{{ freigabe(bild.asset).text }}</AvmPille
                >
            </div>
            <!-- … ODER EINE Galerie: ihre Bilder nur als Vorschau, bearbeitet wird sie in der Medienverwaltung. -->
            <div v-else-if="galerie" class="bilder__galeriekasten" :data-testid="`${kennung}-bilder-galerie`">
                <span class="bilder__gebunden">
                    <span class="bilder__name" :data-testid="`${kennung}-bilder-galerie-name`">{{ galerieName }}</span>
                    <span class="bilder__leise">{{ galerieZahl }}</span>
                </span>
                <ol v-if="galerieBilder.length > 0" class="bilder__galerie">
                    <li
                        v-for="eintrag in galerieBilder"
                        :key="eintrag.asset.id"
                        class="bilder__bild"
                        :data-testid="`${kennung}-bilder-bild`"
                    >
                        <img
                            v-if="eintrag.asset.preview"
                            class="bilder__daumen"
                            :src="eintrag.asset.preview.url"
                            alt=""
                            loading="lazy"
                        />
                        <span v-else class="bilder__daumen bilder__daumen--leer" aria-hidden="true"></span>
                        <span class="bilder__unterschrift">{{ bildName(eintrag.asset) }}</span>
                    </li>
                </ol>
            </div>
            <p v-else-if="kopf" class="bilder__leise" :data-testid="`${kennung}-bilder-keine`">
                {{
                    t(
                        reisebildZahl > 0
                            ? "ortseditor.bilder.keineTitelbilderReisebilder"
                            : "ortseditor.bilder.keineTitelbilder",
                    )
                }}
            </p>
            <!--
                Die Knöpfe nach dem, was hängt (Editor-Orchestrierung 2026-10-17): leer zwei Mal „hinzufügen“; hängt ein Bild, steht
                „ersetzen“ für das Bild vorn und die Galerie als Alternative; hängt eine Galerie umgekehrt. Bearbeitet wird eine Galerie in
                der Medienverwaltung, als Knopf im selben Band.
            -->
            <div v-if="(darfAendern && kopf) || galerie" class="bilder__knoepfe">
                <template v-if="darfAendern && kopf">
                    <AvmKnopf
                        v-if="galerie"
                        groesse="zeile"
                        :gesperrt="gesperrt"
                        :testid="`${kennung}-bilder-galerie-waehlen`"
                        @click="galerieWahlOffen = true"
                    >
                        {{ t("ortseditor.bilder.galerieErsetzen") }}
                    </AvmKnopf>
                    <AvmKnopf
                        groesse="zeile"
                        :gesperrt="gesperrt"
                        :testid="`${kennung}-bilder-titelbild-waehlen`"
                        @click="waehleTitelbild"
                    >
                        {{
                            t(
                                bild
                                    ? "ortseditor.bilder.titelbildErsetzen"
                                    : galerie
                                      ? "ortseditor.bilder.titelbildStattGalerie"
                                      : "ortseditor.bilder.titelbildHinzu",
                            )
                        }}
                    </AvmKnopf>
                    <AvmKnopf
                        v-if="!galerie"
                        groesse="zeile"
                        :gesperrt="gesperrt"
                        :testid="`${kennung}-bilder-galerie-waehlen`"
                        @click="galerieWahlOffen = true"
                    >
                        {{ t(bild ? "ortseditor.bilder.galerieStattTitelbild" : "ortseditor.bilder.galerieHinzu") }}
                    </AvmKnopf>
                </template>
                <AvmKnopf
                    v-if="galerie"
                    groesse="zeile"
                    :testid="`${kennung}-bilder-galerie-bearbeiten`"
                    @click="emit('medien', 'header')"
                >
                    {{ t("ortseditor.bilder.inMedienverwaltung") }}
                </AvmKnopf>
                <AvmKnopf
                    v-if="darfAendern && kopf && besetzt && !fragenTitelbild"
                    groesse="zeile"
                    art="gefahr"
                    :gesperrt="gesperrt"
                    :testid="`${kennung}-bilder-titelbild-entfernen`"
                    @click="fragenTitelbild = true"
                >
                    {{ t(galerie ? "ortseditor.bilder.galerieEntfernen" : "ortseditor.bilder.titelbildEntfernen") }}
                </AvmKnopf>
            </div>
            <AvmBestaetigung
                v-if="fragenTitelbild && besetzt"
                :frage="
                    t(galerie ? 'ortseditor.bilder.galerieFrage' : 'ortseditor.bilder.titelbildFrage', { ort: name })
                "
                :folge="t('ortseditor.bilder.titelbildFolge')"
                :bestaetigen="t(galerie ? 'ortseditor.bilder.galerieKnopf' : 'ortseditor.bilder.titelbildKnopf')"
                :gesperrt="gesperrt"
                :testid="`${kennung}-bilder-titelbild-frage`"
                @bestaetigen="keinTitelbild"
                @abbrechen="fragenTitelbild = false"
            />
        </section>

        <OrtseditorReisebilder :public-id="publicId" :kennung="kennung" @zahl="reisebildZahl = $event" />

        <MedienAuswahlFenster
            v-if="auswahlDa"
            v-model:offen="auswahlOffen"
            :subjekt="{ kind: 'place', id: publicId, name }"
            rolle="header"
            :darf-hochladen="darfAendern"
            weg="ortseditor"
            :operationen="ops"
            @gebunden="gebunden"
        />
        <GalerieWahlFenster
            v-if="galerieWahlOffen"
            v-model:offen="galerieWahlOffen"
            :ort="{ id: publicId, name }"
            :bisher="galerie ? { id: galerie.id, revision: galerie.revision } : undefined"
            :operationen="ops"
            @fertig="gebunden"
        />
    </div>
</template>

<style scoped>
.bilder {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.bilder__kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.bilder__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4) var(--space-8);
}

.bilder__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.bilder__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.bilder__verweis {
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    text-decoration: underline;
}

.bilder__verweis:hover {
    color: var(--color-link-hover);
}

.bilder__verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.bilder__wappen {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

/* Das Titelbild als Einzelbild: breiter als ein Wappen, im Seitenverhältnis des Kopfs im Infopanel. */
.bilder__titelbild {
    flex: none;
    width: calc(var(--avm-fenster-daumen) * 2);
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-sm);
    object-fit: cover;
}

.bilder__gebunden {
    display: flex;
    flex: 1 1 12em;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.bilder__name {
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.bilder__galeriekasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

/* In der Spalte des Galeriekastens wüchse die Namenszeile sonst um ihre Grundbreite (12em) in die Höhe. */
.bilder__galeriekasten > .bilder__gebunden {
    flex: none;
}

.bilder__knoepfe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.bilder__galerie {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8.5em, 1fr));
    gap: var(--space-8);
    margin: 0;
    padding: 0;
    list-style: none;
}

.bilder__bild {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-4);
}

.bilder__daumen {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    max-width: 100%;
    border-radius: var(--radius-sm);
    object-fit: cover;
}

.bilder__daumen--leer {
    border: 1px dashed var(--color-border);
}

.bilder__unterschrift {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}
</style>
