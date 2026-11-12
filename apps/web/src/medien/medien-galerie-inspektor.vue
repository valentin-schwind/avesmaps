<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { MEDIA_GALLERY_CAPTION_MAX, MEDIA_GALLERY_TITLE_MAX, type MediaGalleryDetail } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import EditorZeichen from "../controls/editor-zeichen.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { authState } from "../auth/session-state";
import { t } from "../i18n/i18n";
import type { Geladen } from "./medien-daten";
import {
    galerieCover,
    galerieEintraege,
    galerieName,
    entfernenHindernis,
    galerieOrte,
    istEntwurf,
    verschobeneFolge,
} from "./medien-galerien-modell";
import { datum, galerieHerkunft, galerieStand, zahl } from "./medien-text";

/**
 * Spalte 3 für eine gewählte Galerie (WI-0068 P6, Blatt `review/wi-0068-p6/blatt.png`): die Bildfolge mit Nummer und ★ am
 * Titelbild, die Orte, an denen sie hängt, und ihre Eigenschaften — dazu die Handlungen an der Galerie.
 *
 * - **Die Handlung führt das Fenster aus**, nicht diese Spalte: Sie sagt nur, was gewollt ist (`ordnen`, `titelbild`, …). So hält
 *   eine Stelle die Kennung der Handlung, das Nachladen und den Fehler, und die Spalte bleibt ohne eigenen Schreibpfad.
 * - 🔴 **Ein Entwurf sagt es oben**, nicht im Kleingedruckten: Ohne Ortsbindung sieht ein Besucher die Bilder nicht
 *   (Betreiber 2026-10-13, Variante A).
 * - **Ein Klick auf das Bild wählt das Asset** und wechselt in den gewöhnlichen Inspector — von dort führen Rechte, Verwendungen
 *   und der Notaus weiter. Die Zeichen UNTER dem Bild wirken auf die Galerie, nie auf das Asset selbst.
 * - 🪤 **„Bild entfernen“ nimmt nur den Eintrag**, und „Ort lösen“ nur die Bindung. Beides lässt das Asset unberührt; Bytes
 *   offline nehmen ist der Notaus, und der steht am Asset.
 */
const props = defineProps<{
    galerie: Geladen<MediaGalleryDetail>;
    telefon: boolean;
    /** Ohne `upload_media` stehen die Handlungen gesperrt da: Auskunft, nie Schutz — das entscheidet der Server. */
    darfSchreiben: boolean;
    /** Eine Handlung läuft; weitere Knöpfe warten, damit keine zwei auf derselben Revision losgehen. */
    laeuft: boolean;
    fehler: string | undefined;
}>();
const emit = defineEmits<{
    waehleAsset: [id: string];
    erneut: [];
    zurueck: [];
    titel: [text: string | null];
    ordnen: [order: string[]];
    titelbild: [assetId: string | null];
    bildunterschrift: [assetId: string, text: string | null];
    entfernen: [assetId: string];
    loesen: [placeId: string];
    bilder: [];
    /** Mehrere neue Bilder auf einmal hochladen und einordnen (Stapel, WI-0068 MAM-R3). */
    stapel: [];
    binden: [];
    /** Die Galerie entfernen (WI-0068 R3): nur eine eigene ohne Ort; die Bilder bleiben. */
    galerieEntfernen: [];
}>();

const g = computed(() => props.galerie.wert);
const eintraege = computed(() => galerieEintraege(g.value));
const cover = computed(() => galerieCover(g.value));
const orte = computed(() => galerieOrte(g.value));
const entwurf = computed(() => istEntwurf(g.value));
const titel = computed(() =>
    g.value === undefined
        ? t("medien.galerie.ohneTitel")
        : galerieName({
              title: g.value.title,
              places: orte.value.map((b) => ({ id: b.subject.id, name: b.subject.name })),
          }),
);
const gesperrt = computed(() =>
    !props.darfSchreiben ? t("medien.galerien.keinRecht") : props.laeuft ? t("medien.galerien.laeuft") : undefined,
);
/** „✕ Galerie entfernen“: gesperrt mit Grund, solange es nicht geht; die Rückfrage nennt die Folge. */
const entfernenFragen = ref(false);
const entfernenGesperrt = computed(() => {
    if (gesperrt.value !== undefined) return gesperrt.value;
    const hindernis = g.value === undefined ? undefined : entfernenHindernis(g.value, authState.value.person?.id);
    return hindernis === undefined ? undefined : t(`medien.galerien.entfernenHindernis.${hindernis}`);
});
watch(
    () => g.value?.id,
    () => {
        entfernenFragen.value = false;
    },
);

/** Der Titel im Feld; er folgt der geladenen Galerie, solange niemand darin tippt. */
const titelFeld = ref("");
const titelOffen = ref(false);
watch(
    () => [g.value?.id, g.value?.revision] as const,
    () => {
        if (!titelOffen.value) titelFeld.value = g.value?.title ?? "";
    },
    { immediate: true },
);
const titelGeaendert = computed(() => titelFeld.value.trim() !== (g.value?.title ?? ""));

/** Welche Bildunterschrift gerade offen ist (Asset-Kennung), und ihr Text. */
const unterschriftVon = ref<string | undefined>(undefined);
const unterschrift = ref("");
watch(
    () => g.value?.revision,
    () => {
        unterschriftVon.value = undefined;
    },
);

function oeffneUnterschrift(assetId: string, vorhanden: string | null): void {
    unterschriftVon.value = unterschriftVon.value === assetId ? undefined : assetId;
    unterschrift.value = vorhanden ?? "";
}

function verschiebe(assetId: string, richtung: -1 | 1): void {
    const folge = verschobeneFolge(g.value, assetId, richtung);
    if (folge !== undefined) emit("ordnen", folge);
}

const kannVerschieben = (assetId: string, richtung: -1 | 1): boolean =>
    verschobeneFolge(g.value, assetId, richtung) !== undefined;

/**
 * Was ein Klick auf den Stern tut.
 *
 * 🪤 Der Stern zeigt das WIRKSAME Titelbild (`cover`), nicht die Setzung: Ohne Setzung gilt der erste Eintrag, und ein
 * leerer Stern an dem Bild, das die Galerie als Titelbild zeigt, wäre eine Falschaussage. Zurücknehmen kann man nur eine
 * SETZUNG; am Vorgabebild nagelt ein Klick sie fest, damit sie eine Umsortierung überlebt.
 */
const titelbildTitel = (assetId: string): string =>
    assetId === g.value?.coverAssetId ? t("medien.galerien.titelbildZurueck") : t("medien.galerien.titelbildSetzen");
</script>

<template>
    <FensterSpalte
        breite="inspektor"
        :telefon="telefon"
        :titel="titel"
        :unterzeile="g ? t('medien.galerien.bilder', { n: zahl(eintraege.aktiv.length) }) : undefined"
        testid="medien-spalte-galerie"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="medien-zurueck-galerien" @click="emit('zurueck')">{{
                t("medien.zurueck.treffer", { n: "" })
            }}</AvmKnopf>
        </template>

        <AvmHinweis v-if="galerie.fehler" :ton="galerie.fehler.ton" rolle="alert" testid="medien-galerie-fehler">{{
            galerie.fehler.text
        }}</AvmHinweis>
        <AvmKnopf
            v-if="galerie.fehler?.erneut"
            groesse="zeile"
            testid="medien-galerie-erneut"
            @click="emit('erneut')"
            >{{ t("medien.erneut") }}</AvmKnopf
        >
        <p v-if="galerie.laedt && !g" class="galerie__satz">{{ t("medien.treffer.laedt") }}</p>
        <p v-else-if="!g && !galerie.fehler" class="galerie__satz" data-testid="medien-galerie-keine">
            {{ t("medien.galerien.keineGewaehlt") }}
        </p>

        <template v-if="g">
            <AvmHinweis v-if="fehler" ton="gefahr" rolle="alert" testid="medien-galerie-handlung-fehler">{{
                fehler
            }}</AvmHinweis>
            <AvmHinweis v-if="entwurf" ton="warnung" testid="medien-galerie-entwurf">
                {{ t("medien.galerien.entwurfSatz") }}
            </AvmHinweis>

            <FensterKarte :titel="t('medien.galerien.folge')">
                <!--
                    🔴 Eine ZEILE je Bild, kein Raster: Die Handlungen stehen an dem Bild, auf das sie wirken, und in vier
                    Rasterspalten passen fünf Zeichen nicht nebeneinander (Blatt `review/wi-0068-p6/`, erster Versuch). Die Form
                    ist die der Listen des Hauses — Bild, Nummer, Name, Zeichen rechts.
                    🪤 Am Rand steht KEIN gesperrter Pfeil, sondern eine leere Stelle: Ein gesperrter Knopf des Hauses trägt
                    seinen Grund als Satz neben sich (`avm-sperrgrund.vue`), und zehn solcher Sätze zerrissen die Liste.
                -->
                <ul v-if="eintraege.aktiv.length > 0" class="galerie__folge" data-testid="medien-galerie-folge">
                    <li v-for="(eintrag, i) in eintraege.aktiv" :key="eintrag.asset.id" class="galerie__zeile">
                        <button
                            type="button"
                            class="galerie__kachel"
                            :class="{ 'is-cover': eintrag.asset.id === cover }"
                            :data-asset="eintrag.asset.id"
                            :aria-label="eintrag.asset.title ?? t('medien.galerien.ohneTitelBild')"
                            data-testid="medien-galerie-bild"
                            @click="emit('waehleAsset', eintrag.asset.id)"
                        >
                            <img v-if="eintrag.asset.preview" :src="eintrag.asset.preview.url" alt="" loading="lazy" />
                            <span class="galerie__nr">{{ i + 1 }}</span>
                        </button>
                        <span class="galerie__text">
                            <span class="galerie__name einzeilig">{{
                                eintrag.asset.title ?? t("medien.galerien.ohneTitelBild")
                            }}</span>
                            <span class="galerie__unter einzeilig">{{
                                eintrag.caption ?? t("medien.galerien.ohneUnterschrift")
                            }}</span>
                        </span>
                        <span class="galerie__zeichen" :data-asset="eintrag.asset.id">
                            <button
                                v-if="kannVerschieben(eintrag.asset.id, -1)"
                                type="button"
                                class="galerie__zeichen-knopf"
                                :disabled="gesperrt !== undefined"
                                :title="t('medien.galerien.nachVorn')"
                                :aria-label="t('medien.galerien.nachVorn')"
                                data-testid="medien-galerie-vor"
                                @click="verschiebe(eintrag.asset.id, -1)"
                            >
                                <EditorZeichen name="nach-vorn" />
                            </button>
                            <span v-else class="galerie__zeichen-leer" aria-hidden="true"></span>
                            <button
                                v-if="kannVerschieben(eintrag.asset.id, 1)"
                                type="button"
                                class="galerie__zeichen-knopf"
                                :disabled="gesperrt !== undefined"
                                :title="t('medien.galerien.nachHinten')"
                                :aria-label="t('medien.galerien.nachHinten')"
                                data-testid="medien-galerie-zurueck"
                                @click="verschiebe(eintrag.asset.id, 1)"
                            >
                                <EditorZeichen name="nach-hinten" />
                            </button>
                            <span v-else class="galerie__zeichen-leer" aria-hidden="true"></span>
                            <button
                                type="button"
                                class="galerie__zeichen-knopf"
                                :class="{ 'is-an': eintrag.asset.id === cover }"
                                :disabled="gesperrt !== undefined"
                                :title="titelbildTitel(eintrag.asset.id)"
                                :aria-label="titelbildTitel(eintrag.asset.id)"
                                :aria-pressed="eintrag.asset.id === cover"
                                data-testid="medien-galerie-cover"
                                @click="
                                    emit('titelbild', eintrag.asset.id === g.coverAssetId ? null : eintrag.asset.id)
                                "
                            >
                                <EditorZeichen :name="eintrag.asset.id === cover ? 'titelbild-gesetzt' : 'titelbild'" />
                            </button>
                            <button
                                type="button"
                                class="galerie__zeichen-knopf"
                                :disabled="gesperrt !== undefined"
                                :title="t('medien.galerien.unterschriftSetzen')"
                                :aria-label="t('medien.galerien.unterschriftSetzen')"
                                :aria-expanded="unterschriftVon === eintrag.asset.id"
                                data-testid="medien-galerie-unterschrift"
                                @click="oeffneUnterschrift(eintrag.asset.id, eintrag.caption)"
                            >
                                <EditorZeichen name="bearbeiten" />
                            </button>
                            <button
                                type="button"
                                class="galerie__zeichen-knopf"
                                :disabled="gesperrt !== undefined"
                                :title="t('medien.galerien.bildEntfernen')"
                                :aria-label="t('medien.galerien.bildEntfernen')"
                                data-testid="medien-galerie-entfernen"
                                @click="emit('entfernen', eintrag.asset.id)"
                            >
                                <EditorZeichen name="entfernen" />
                            </button>
                        </span>
                    </li>
                </ul>
                <p v-else class="galerie__satz">{{ t("medien.galerien.leerFolge") }}</p>
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="gesperrt"
                    testid="medien-galerie-hochladen"
                    @click="emit('bilder')"
                >
                    {{ t("medien.galerien.hochladen") }}
                </AvmKnopf>
                <AvmKnopf groesse="zeile" :gesperrt="gesperrt" testid="medien-galerie-stapel" @click="emit('stapel')">
                    {{ t("medien.stapel.oeffnen") }}
                </AvmKnopf>

                <!-- Die Bildunterschrift klappt UNTER dem Raster auf: eine Zeile in ganzer Breite, statt vier enger Felder. -->
                <div v-if="unterschriftVon !== undefined" class="galerie__unterschrift">
                    <AvmEingabe
                        v-model="unterschrift"
                        :maxlength="MEDIA_GALLERY_CAPTION_MAX"
                        :placeholder="t('medien.galerien.unterschriftPlatzhalter')"
                        :aria-label="t('medien.galerien.unterschriftSetzen')"
                        testid="medien-galerie-unterschrift-feld"
                    />
                    <AvmKnopf
                        groesse="zeile"
                        art="gefuellt"
                        :gesperrt="gesperrt"
                        testid="medien-galerie-unterschrift-speichern"
                        @click="
                            emit(
                                'bildunterschrift',
                                unterschriftVon,
                                unterschrift.trim() === '' ? null : unterschrift.trim(),
                            )
                        "
                        >{{ t("medien.galerien.unterschriftSpeichern") }}</AvmKnopf
                    >
                    <AvmKnopf
                        groesse="zeile"
                        testid="medien-galerie-unterschrift-abbrechen"
                        @click="unterschriftVon = undefined"
                        >{{ t("medien.bearbeiten.abbrechen") }}</AvmKnopf
                    >
                </div>
            </FensterKarte>

            <FensterKarte :titel="t('medien.galerien.orte', { n: zahl(orte.length) })">
                <ul v-if="orte.length > 0" class="galerie__orte" data-testid="medien-galerie-orte">
                    <li v-for="bindung in orte" :key="bindung.subject.id">
                        <span class="galerie__ort">{{ bindung.subject.name }}</span>
                        <span class="galerie__ort-zusatz">{{ galerieHerkunft(bindung.origin) }}</span>
                        <AvmKnopf
                            groesse="zeile"
                            :aria-label="t('medien.galerien.loesenVon', { ort: bindung.subject.name })"
                            :gesperrt="gesperrt"
                            :data-ort="bindung.subject.id"
                            testid="medien-galerie-loesen"
                            @click="emit('loesen', bindung.subject.id)"
                            >✕</AvmKnopf
                        >
                    </li>
                </ul>
                <p v-else class="galerie__satz">{{ t("medien.galerien.keineOrte") }}</p>
                <AvmKnopf groesse="zeile" :gesperrt="gesperrt" testid="medien-galerie-binden" @click="emit('binden')">
                    {{ t("medien.galerien.binden") }}
                </AvmKnopf>
            </FensterKarte>

            <FensterKarte :titel="t('medien.galerien.eigenschaften')">
                <div class="galerie__feld">
                    <span>{{ t("medien.galerien.feld.titel") }}</span>
                    <b v-if="!titelOffen">{{ g.title ?? t("medien.galerien.ohneEigenenTitel") }}</b>
                    <AvmKnopf
                        v-if="!titelOffen"
                        groesse="zeile"
                        :aria-label="t('medien.galerien.titelAendern')"
                        :gesperrt="gesperrt"
                        testid="medien-galerie-titel-oeffnen"
                        @click="titelOffen = true"
                        >✎</AvmKnopf
                    >
                </div>
                <div v-if="titelOffen" class="galerie__unterschrift">
                    <AvmEingabe
                        v-model="titelFeld"
                        :maxlength="MEDIA_GALLERY_TITLE_MAX"
                        :placeholder="t('medien.galerien.titelPlatzhalter')"
                        :aria-label="t('medien.galerien.feld.titel')"
                        testid="medien-galerie-titel-feld"
                    />
                    <AvmKnopf
                        groesse="zeile"
                        art="gefuellt"
                        :gesperrt="gesperrt ?? (titelGeaendert ? undefined : t('medien.galerien.unveraendert'))"
                        testid="medien-galerie-titel-speichern"
                        @click="
                            emit('titel', titelFeld.trim() === '' ? null : titelFeld.trim());
                            titelOffen = false;
                        "
                        >{{ t("medien.galerien.unterschriftSpeichern") }}</AvmKnopf
                    >
                    <AvmKnopf
                        groesse="zeile"
                        testid="medien-galerie-titel-abbrechen"
                        @click="
                            titelOffen = false;
                            titelFeld = g.title ?? '';
                        "
                        >{{ t("medien.bearbeiten.abbrechen") }}</AvmKnopf
                    >
                </div>
                <div class="galerie__feld">
                    <span>{{ t("medien.galerien.feld.herkunft") }}</span
                    ><b>{{ galerieHerkunft(g.origin) }}</b>
                </div>
                <div class="galerie__feld">
                    <span>{{ t("medien.galerien.feld.stand") }}</span
                    ><b>{{ galerieStand(g.publicationState) }}</b>
                </div>
                <div class="galerie__feld">
                    <span>{{ t("medien.galerien.feld.geaendert") }}</span
                    ><b>{{ datum(g.updatedAt) }}</b>
                </div>
                <p v-if="eintraege.zurueckgezogen.length > 0" class="galerie__satz">
                    {{ t("medien.galerien.zurueckgezogen", { n: zahl(eintraege.zurueckgezogen.length) }) }}
                </p>
            </FensterKarte>

            <div class="galerie__entfernen">
                <AvmKnopf
                    v-if="!entfernenFragen"
                    groesse="zeile"
                    art="gefahr"
                    :gesperrt="entfernenGesperrt"
                    testid="medien-galerie-entfernen-ganz"
                    @click="entfernenFragen = true"
                >
                    <template #zeichen>✕</template>
                    {{ t("medien.galerien.entfernenGanz") }}
                </AvmKnopf>
                <AvmBestaetigung
                    v-else
                    :frage="t('medien.galerien.entfernenFrage', { name: titel })"
                    :folge="t('medien.galerien.entfernenFolge')"
                    :bestaetigen="t('medien.galerien.entfernenKnopf')"
                    :gesperrt="gesperrt"
                    testid="medien-galerie-entfernen-frage"
                    @bestaetigen="emit('galerieEntfernen')"
                    @abbrechen="entfernenFragen = false"
                />
            </div>
        </template>
    </FensterSpalte>
</template>

<style scoped>
.galerie__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.galerie__folge {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.galerie__zeile {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
}

.galerie__kachel {
    position: relative;
    flex: none;
    display: block;
    width: 62px;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
    cursor: pointer;
    overflow: hidden;
    transition:
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.galerie__kachel:hover {
    border-color: var(--color-border-strong);
}

.galerie__kachel:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.galerie__kachel.is-cover {
    border: 2px solid var(--color-accent);
}

.galerie__kachel img {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 10;
    object-fit: cover;
}

.galerie__nr {
    position: absolute;
    top: 2px;
    left: 2px;
    min-width: 15px;
    padding: 0 3px;
    border-radius: var(--radius-sm);
    background: var(--color-media-nav);
    color: var(--color-media-text);
    font-size: var(--font-size-caption);
    text-align: center;
}

.galerie__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
}

.galerie__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.galerie__unter {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Die Zeichen am Ende der Zeile: Bedienhöhe, Fläche nur unter Zeiger und Fokus (Guide §30.5). */
.galerie__zeichen {
    display: flex;
    flex: none;
    align-items: center;
    gap: 1px;
}

.galerie__zeichen-knopf,
.galerie__zeichen-leer {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
}

.galerie__zeichen-knopf {
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease;
}

.galerie__zeichen-knopf:hover:not(:disabled) {
    border-color: var(--color-border);
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.galerie__zeichen-knopf:active:not(:disabled) {
    background: var(--color-active-wash);
}

.galerie__zeichen-knopf:focus-visible {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: var(--focus-ring);
}

.galerie__zeichen-knopf:disabled {
    cursor: default;
}

.galerie__zeichen-knopf.is-an {
    color: var(--color-accent);
}

.galerie__unterschrift {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-6);
}

.galerie__unterschrift :deep(.avm-eingabe) {
    flex: 1 1 auto;
    min-width: 0;
}

.galerie__orte {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0 0 var(--space-6);
    padding: 0;
    list-style: none;
}

.galerie__orte li {
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
}

.galerie__ort {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.galerie__ort-zusatz {
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.galerie__feld {
    display: flex;
    align-items: baseline;
    gap: var(--space-8);
    font-size: var(--font-size-small);
}

.galerie__feld span {
    color: var(--color-text-muted);
}

.galerie__feld b {
    margin-left: auto;
    color: var(--color-text-strong);
    text-align: right;
}

@media (prefers-reduced-motion: reduce) {
    .galerie__kachel {
        transition: none;
    }
}

.galerie__entfernen {
    display: flex;
    justify-content: flex-end;
}
</style>
