<script setup lang="ts">
/**
 * Die Tafel „Ohne Wiki-Artikel und ohne Quelle“ (Mockup; Vali 2026-10-25: „pro objektart "Anzeigen/Nicht anzeigen" bei Anzeigen (INOFFIZIELL | Avesmaps)
 * -> rechter teil der pille editierbar“). Rang 4 der Kanon-Regel: Was weder eine Wiki-Zuweisung noch eine Quelle noch eine Publikation hat, bekommt bei
 * „ja“ die Pille INOFFIZIELL mit dem Bezeichner der Art. Die Vorgabe ist überall „nein“.
 *
 * - **Jede Änderung speichert sofort** (Vali 2026-10-27: „warum muss man speichern, warum speichert der klick nicht?“): Anzeigen beim Wechsel, der Bezeichner beim
 *   Verlassen des Felds oder mit Enter (Escape stellt den gespeicherten Wert her), ↺ die Vorgabe. Passkey (`manage_canon_tables`) fragt das gemeinsame Fenster nur, wenn
 *   die Bestätigung nicht mehr frisch ist. Gespeichert wird in `wikisync-sofort.ts`; hier steht nur, wie die Zeile aussieht und was der Satz danach sagt.
 * - Rang 4 wird beim Lesen aufgelöst: Nach dem Speichern gilt die Pille sofort, ohne Neuberechnen.
 * - Die Zahl der Wege zählt Abschnitte; ein Weg trägt das Etikett seines ersten Abschnitts mit Zeile, die Zahl ist also eine Obergrenze („bis zu“).
 */
import { computed, nextTick, useId, useTemplateRef, watch } from "vue";
import type { KanonObjektart } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmSperrgrund from "../controls/avm-sperrgrund.vue";
import InfoCanonPill from "../info-panel/info-canon-pill.vue";
import { t } from "../i18n/i18n";
import VerwaltungMeldung from "../auth/verwaltung-meldung.vue";
import type { Wikisync } from "./wikisync";
import WikisyncInfo from "./wikisync-info.vue";
import { ohneSofort } from "./wikisync-tafeln-sofort";
import { artName, umgebungKurz, zahl } from "./wikisync-text";
import { ohneVorgabe, ohneWeichtAb, pille, type OhneZeile } from "./wikisync-tafeln";

const props = defineProps<{
    wikisync: Wikisync;
    umgebung: string;
    sperre: string | undefined;
}>();

const grundId = useId();
const sofort = ohneSofort(props.wikisync, () => props.umgebung);
const tafel = sofort.zeilen;

/** Der Kasten mit Satz und Ablehnung unter der Tafel. Eine Ablehnung steht nie außer Sicht (eine lange Tafel am Telefon): Sie rollt herein, wenn sie sonst verborgen bliebe. */
const stand = useTemplateRef<HTMLElement>("stand");
watch(sofort.fehler, (fehler) => {
    if (fehler !== undefined) void nextTick(() => stand.value?.scrollIntoView({ block: "nearest" }));
});

const JA_NEIN = computed(() => [
    { wert: "ja", text: t("admin.wikisync.ja") },
    { wert: "nein", text: t("admin.wikisync.nein") },
]);

function vorgabeText(art: KanonObjektart): string {
    const vorgabe = ohneVorgabe(art);
    return t("admin.wikisync.ohne.vorgabe", {
        anzeigen: t(vorgabe.anzeigen ? "admin.wikisync.ja" : "admin.wikisync.nein"),
        bezeichner: vorgabe.bezeichner === "" ? t("admin.wikisync.ohneBezeichner") : `„${vorgabe.bezeichner}“`,
    });
}

function marke(zeile: OhneZeile): { text: string; ton: "neutral"; titel?: string } | null {
    if (sofort.speichert(zeile.art)) return { text: t("admin.wikisync.marke.speichert"), ton: "neutral" };
    if (ohneWeichtAb(zeile))
        return { text: t("admin.wikisync.marke.eigen"), ton: "neutral", titel: vorgabeText(zeile.art) };
    return null;
}

const sperreZelle = computed(() => (props.sperre === undefined ? undefined : ""));
const zeilenGrundId = (art: KanonObjektart): string => `${grundId}-${art}`;

/** Enter speichert den Text; Escape stellt den gespeicherten her und gilt nur dann dem Feld (sonst schließt es wie überall das Fenster). */
function taste(event: KeyboardEvent, art: KanonObjektart): void {
    if (event.isComposing) return;
    if (event.key === "Enter") sofort.fertig(art);
    else if (event.key === "Escape" && sofort.zurueck(art)) {
        event.preventDefault();
        event.stopPropagation();
    }
}
</script>

<template>
    <div class="wsync-ohne" data-testid="wsync-ohne">
        <p class="wsync-ohne__satz">{{ t("admin.wikisync.ohne.intro", { umgebung: umgebungKurz(umgebung) }) }}</p>
        <p class="wsync-ohne__satz">
            <strong>{{ t("admin.wikisync.ohne.kopf.anzeigen") }}:</strong> {{ t("admin.wikisync.ohne.anzeigenSatz") }}
        </p>
        <p class="wsync-ohne__satz">
            <strong>{{ t("admin.wikisync.ns.kopf.objekte") }}:</strong> {{ t("admin.wikisync.ohne.objekteSatz") }}
        </p>
        <!-- Ohne „Speichern“ gibt es keinen Augenblick vor dem Speichern, an dem diese Warnung stehen könnte: Auf Production steht sie dauernd da. -->
        <AvmHinweis v-if="umgebung === 'production'" ton="warnung" testid="wsync-ohne-production">{{
            t("admin.wikisync.wirkung.production")
        }}</AvmHinweis>
        <AvmSperrgrund v-if="sperre !== undefined" :id="grundId" :text="sperre" />

        <div class="wsync-ohne__tafel" role="table" :aria-label="t('admin.wikisync.ohne.titel')">
            <div class="wsync-ohne__raster wsync-ohne__kopf" role="row">
                <span role="columnheader">{{ t("admin.wikisync.ohne.kopf.art") }}</span>
                <span role="columnheader">{{ t("admin.wikisync.ohne.kopf.anzeigen") }}</span>
                <span role="columnheader">{{ t("admin.wikisync.ohne.kopf.bezeichner") }}</span>
                <span role="columnheader">{{ t("admin.wikisync.ns.kopf.vorschau") }}</span>
                <span role="columnheader" class="wsync-ohne__zahl">{{ t("admin.wikisync.ns.kopf.objekte") }}</span>
                <span role="columnheader"></span>
            </div>
            <div
                v-for="zeile in tafel"
                :key="zeile.art"
                class="wsync-ohne__raster wsync-ohne__zeile"
                :class="{ 'is-speichert': sofort.speichert(zeile.art) }"
                role="row"
                :data-art="zeile.art"
            >
                <span role="cell" class="wsync-ohne__art z-art">{{ artName(zeile.art) }}</span>
                <span role="cell" class="wsync-ohne__wahl z-wahl" :data-l="t('admin.wikisync.ohne.kopf.anzeigen')">
                    <AvmAuswahl
                        :model-value="zeile.anzeigen ? 'ja' : 'nein'"
                        :optionen="JA_NEIN"
                        groesse="zeile"
                        :gesperrt="sperreZelle"
                        :title="sperre"
                        :aria-label="t('admin.wikisync.ohne.anzeigenVon', { art: artName(zeile.art) })"
                        :aria-describedby="sperre === undefined ? undefined : grundId"
                        :testid="`wsync-ohne-${zeile.art}-anzeigen`"
                        @update:model-value="(wert: string) => sofort.aendere(zeile.art, { anzeigen: wert === 'ja' })"
                    />
                    <AvmPille v-if="marke(zeile) !== null" :ton="marke(zeile)!.ton" :title="marke(zeile)!.titel">{{
                        marke(zeile)!.text
                    }}</AvmPille>
                </span>
                <span role="cell" class="z-bez" :data-l="t('admin.wikisync.ohne.kopf.bezeichner')">
                    <AvmEingabe
                        :model-value="sofort.text(zeile.art, zeile)"
                        :gesperrt="sperre"
                        :grund-bei="sperre === undefined ? undefined : grundId"
                        :ungueltig="sofort.textGrund(zeile.art) !== undefined"
                        :placeholder="t('admin.wikisync.ohneBezeichner')"
                        :aria-label="t('admin.wikisync.ohne.bezeichnerVon', { art: artName(zeile.art) })"
                        :aria-describedby="
                            sofort.textGrund(zeile.art) === undefined ? undefined : zeilenGrundId(zeile.art)
                        "
                        maxlength="80"
                        autocomplete="off"
                        :testid="`wsync-ohne-${zeile.art}-bezeichner`"
                        @update:model-value="(wert: string) => sofort.tippe(zeile.art, wert)"
                        @blur="sofort.fertig(zeile.art)"
                        @keydown="(event: KeyboardEvent) => taste(event, zeile.art)"
                    />
                </span>
                <span role="cell" class="wsync-ohne__pille z-et" :data-l="t('admin.wikisync.ns.kopf.vorschau')">
                    <InfoCanonPill v-if="zeile.anzeigen" :pill="pille('inoffiziell', sofort.text(zeile.art, zeile))" />
                    <span v-else class="wsync-ohne__leise">{{ t("admin.wikisync.ohne.keinePille") }}</span>
                </span>
                <span role="cell" class="wsync-ohne__zahl z-ob" :data-l="t('admin.wikisync.ns.kopf.objekte')"
                    >{{ zeile.objekte === null ? "—" : zahl(zeile.objekte)
                    }}<WikisyncInfo v-if="zeile.art === 'path'" :text="t('admin.wikisync.ohne.wegeInfo')"
                /></span>
                <span role="cell" class="wsync-ohne__aktion z-akt">
                    <AvmKnopf
                        v-if="sperre === undefined && ohneWeichtAb(zeile)"
                        groesse="zeile"
                        :aria-label="
                            t('admin.wikisync.ohne.aufVorgabe', {
                                art: artName(zeile.art),
                                vorgabe: vorgabeText(zeile.art),
                            })
                        "
                        :title="
                            t('admin.wikisync.ohne.aufVorgabe', {
                                art: artName(zeile.art),
                                vorgabe: vorgabeText(zeile.art),
                            })
                        "
                        :testid="`wsync-ohne-${zeile.art}-vorgabe`"
                        @click="
                            sofort.ersetze(zeile.art, {
                                ...zeile,
                                anzeigen: ohneVorgabe(zeile.art).anzeigen,
                                bezeichner: ohneVorgabe(zeile.art).bezeichner,
                            })
                        "
                        ><span aria-hidden="true">↺</span></AvmKnopf
                    >
                </span>
                <span
                    v-if="sofort.textGrund(zeile.art) !== undefined"
                    :id="zeilenGrundId(zeile.art)"
                    role="cell"
                    class="wsync-ohne__grund"
                    :data-testid="`wsync-ohne-${zeile.art}-grund`"
                    >{{ sofort.textGrund(zeile.art) }}</span
                >
            </div>
        </div>
        <!-- Unter der Tafel, nicht darüber: Eine Meldung über den Zeilen schöbe sie nach dem ersten Klick unter dem Zeiger weg. -->
        <div ref="stand" class="wsync-ohne__stand">
            <AvmHinweis v-if="sofort.meldung.value !== null" rolle="status" testid="wsync-ohne-meldung">{{
                sofort.meldung.value
            }}</AvmHinweis>
            <VerwaltungMeldung :ergebnis="sofort.fehler.value" testid="wsync-ohne-fehler" />
        </div>
        <p class="wsync-ohne__satz">{{ t("admin.wikisync.ohne.handquellen") }}</p>
    </div>
</template>

<style scoped>
.wsync-ohne {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
    container: wsync-ohne / inline-size;
}

.wsync-ohne__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wsync-ohne__satz strong,
.wsync-ohne__zusammen strong {
    color: var(--color-text-strong);
    font-weight: var(--font-weight-regular);
}

/* Leer nimmt der Kasten keinen Platz ein (die Lücke der Spalte käme sonst dazu). */
.wsync-ohne__stand {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.wsync-ohne__stand:empty {
    display: none;
}

.wsync-ohne__tafel {
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.wsync-ohne__raster {
    box-sizing: border-box;
    display: grid;
    grid-template-columns:
        minmax(0, 0.9fr) minmax(170px, 1.2fr) minmax(112px, 1fr) minmax(150px, 1.3fr) minmax(0, 76px)
        minmax(0, 40px);
    column-gap: var(--space-6);
    align-items: center;
    padding: var(--space-4) var(--space-8);
}

.wsync-ohne__kopf {
    border-bottom: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.wsync-ohne__zeile {
    border-bottom: 1px solid var(--color-divider);
    font-size: var(--font-size-small);
}

.wsync-ohne__zeile:last-child {
    border-bottom: 0;
}

.wsync-ohne__zeile.is-speichert {
    background: var(--color-panel-soft);
}

.wsync-ohne__zeile > * {
    min-width: 0;
    overflow-wrap: anywhere;
}

.wsync-ohne__art {
    color: var(--color-text-strong);
}

.wsync-ohne__wahl {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
}

.wsync-ohne__pille {
    display: flex;
    align-items: center;
    min-width: 0;
    min-height: var(--avm-control-h);
}

.wsync-ohne__leise {
    color: var(--color-text-muted);
}

.wsync-ohne__zahl {
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.wsync-ohne__aktion {
    display: flex;
    justify-content: flex-end;
}

/* Warum der getippte Bezeichner nicht gespeichert wird: eine Zeile unter der Zeile, über deren ganze Breite (in der Zelle ist kein Platz). */
.wsync-ohne__grund {
    grid-column: 1 / -1;
    color: var(--color-danger-soft-text);
}

@container wsync-ohne (max-width: 720px) {
    .wsync-ohne__kopf {
        display: none;
    }

    .wsync-ohne__raster.wsync-ohne__zeile {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
            "art akt"
            "wahl wahl"
            "bez bez"
            "et et"
            "ob ob";
        row-gap: var(--space-4);
        padding: var(--space-6) var(--space-8);
    }

    .wsync-ohne__zeile > .z-art {
        grid-area: art;
    }

    .wsync-ohne__zeile > .z-wahl {
        grid-area: wahl;
    }

    .wsync-ohne__zeile > .z-bez {
        grid-area: bez;
        display: flex;
        align-items: center;
        gap: var(--space-4);
    }

    .wsync-ohne__zeile > .z-et {
        grid-area: et;
        gap: var(--space-4);
    }

    .wsync-ohne__zeile > .z-ob {
        grid-area: ob;
        text-align: left;
    }

    .wsync-ohne__zeile > .z-akt {
        grid-area: akt;
    }

    .wsync-ohne__zeile > [data-l]::before {
        content: attr(data-l) ": " / "";
        color: var(--color-text-muted);
        flex: none;
    }
}
</style>
