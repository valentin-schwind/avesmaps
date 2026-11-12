<script setup lang="ts">
import { computed, ref } from "vue";
import { SPRACHENKARTE_TITEL, type SpracheEditorArtikelListe, type SpracheEditorDetail } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import { formatNumber, t } from "../i18n/i18n";
import SpracheFarbwahl from "./sprache-farbwahl.vue";
import { farbeNormal, startfarbe, type SpracheFelder } from "./sprache-felder";
import SpracheWikiPillen from "./sprache-wiki-pillen.vue";

/**
 * Der Reiter „Eigenschaften“ einer Sprache (WI-0261 S5d2; Bauvorlage `fenster-sprachen.js` `felder` und `sfEigenschaften`): Kästen Identität
 * (Name, Name der Legende, Schlüssel), Farbe, Wiki (Pillen), „Aus dem Wiki“ (nur lesen), Quelle und Stand (Stilllegen). Name, Legende, Farbe
 * und Pillen sind Felder des EINEN Entwurfs der Sprache (`sprache-art.ts`): Die erste Änderung beginnt die Bearbeitung, Tippen ist ein Schritt
 * bis zum Verlassen des Felds, „Fertig“ in der Leiste über der Karte schreibt.
 *
 * Eigenschaften stehen nie in einer Box mit fester Höhe (Betreiber 2026-10-19): Die Spalte wächst, und der Rumpf des Fensters rollt.
 */
const props = defineProps<{
    detail: SpracheEditorDetail;
    felder: SpracheFelder;
    lesend: boolean;
    kennung: string;
    suche: (q: string, signal: AbortSignal) => Promise<SpracheEditorArtikelListe>;
    /** Warum die Sprache gerade nicht stillgelegt werden kann (ein offener Entwurf, es läuft schon); ohne Satz geht es. */
    stillGrund: string | undefined;
}>();
const emit = defineEmits<{
    feld: [neu: (felder: SpracheFelder) => SpracheFelder, verschmelze?: string];
    verlassen: [];
    stilllegen: [];
}>();

const setzeText = (feld: "name" | "legende", wert: string): void =>
    emit("feld", (felder) => ({ ...felder, [feld]: wert }), feld);
function setzeFarbe(farbe: string, wie: "tippen" | "einzeln"): void {
    if (wie === "einzeln") emit("verlassen");
    emit(
        "feld",
        (felder) => ({ ...felder, farbe: wie === "einzeln" ? farbeNormal(farbe) : farbe }),
        wie === "tippen" ? "farbe" : undefined,
    );
}
function setzeWiki(liste: readonly string[]): void {
    emit("verlassen");
    emit("feld", (felder) => ({ ...felder, wiki: liste }));
}

/** „Aus dem Wiki“: die Felder der Infobox des ersten Artikels, wie der WikiSync sie liest. */
const erster = computed(() => props.detail.wiki[0]);
const quelleFlaeche = computed(() =>
    props.detail.herkunft === "sprachenkarte" ? SPRACHENKARTE_TITEL : t("sprache.quelle.redaktion"),
);
const fragt = ref(false);
</script>

<template>
    <div class="eigenschaften" :data-testid="`${kennung}-eigenschaften-inhalt`">
        <section class="eigenschaften__kasten" @focusout="lesend ? undefined : emit('verlassen')">
            <h4 class="eigenschaften__titel">{{ t("spracheditor.kasten.identitaet") }}</h4>
            <FensterFeldzeile :name="t('spracheditor.feld.name')" :fuer="`${kennung}-name`">
                <AvmEingabe
                    :id="`${kennung}-name`"
                    :model-value="felder.name"
                    :ungueltig="felder.name.trim() === ''"
                    :gesperrt="lesend ? '' : undefined"
                    :placeholder="t('spracheditor.feld.namePlatzhalter')"
                    :testid="`${kennung}-feld-name`"
                    @update:model-value="(wert: string) => setzeText('name', wert)"
                />
            </FensterFeldzeile>
            <FensterFeldzeile :name="t('spracheditor.feld.legende')" :fuer="`${kennung}-legende`">
                <AvmEingabe
                    :id="`${kennung}-legende`"
                    :model-value="felder.legende"
                    :gesperrt="lesend ? '' : undefined"
                    :placeholder="felder.name.trim() === '' ? t('spracheditor.feld.legendePlatzhalter') : felder.name"
                    :testid="`${kennung}-feld-legende`"
                    @update:model-value="(wert: string) => setzeText('legende', wert)"
                />
            </FensterFeldzeile>
            <FensterFeldzeile :name="t('spracheditor.feld.schluessel')" :titel="t('spracheditor.feld.schluesselTitel')">
                <span class="eigenschaften__wert" :data-testid="`${kennung}-schluessel`">{{ detail.schluessel }}</span>
            </FensterFeldzeile>
        </section>

        <section class="eigenschaften__kasten" @focusout="lesend ? undefined : emit('verlassen')">
            <h4 class="eigenschaften__titel">{{ t("spracheditor.kasten.farbe") }}</h4>
            <SpracheFarbwahl
                :farbe="felder.farbe"
                :gespeichert="detail.farbe"
                :start="startfarbe(detail.schluessel)"
                :lesend="lesend"
                :kennung="kennung"
                @setze="setzeFarbe"
            />
        </section>

        <section class="eigenschaften__kasten">
            <h4 class="eigenschaften__titel">{{ t("spracheditor.kasten.wiki") }}</h4>
            <SpracheWikiPillen
                :pillen="felder.wiki"
                :bekannt="detail.wiki"
                :sprache="detail.id"
                :lesend="lesend"
                :suche="suche"
                :kennung="kennung"
                @setze="setzeWiki"
            />
        </section>

        <section v-if="erster" class="eigenschaften__kasten">
            <h4 class="eigenschaften__titel">{{ t("spracheditor.kasten.ausWiki") }}</h4>
            <dl class="eigenschaften__werte">
                <div>
                    <dt>{{ t("infoPanel.field.sprachfamilie") }}</dt>
                    <dd>{{ erster.sprachfamilie ?? t("spracheditor.keineAngabe") }}</dd>
                </div>
                <div>
                    <dt>{{ t("infoPanel.field.vorstufen") }}</dt>
                    <dd>{{ erster.vorstufen ?? t("spracheditor.keineAngabe") }}</dd>
                </div>
                <div>
                    <dt>{{ t("infoPanel.field.schrift") }}</dt>
                    <dd>{{ erster.schrift ?? t("spracheditor.keineAngabe") }}</dd>
                </div>
            </dl>
            <p class="eigenschaften__hinweis">{{ t("spracheditor.ausWiki.hinweis", { titel: erster.titel }) }}</p>
        </section>

        <section class="eigenschaften__kasten">
            <h4 class="eigenschaften__titel">{{ t("spracheditor.kasten.quelle") }}</h4>
            <dl class="eigenschaften__werte">
                <div>
                    <dt>{{ t("spracheditor.quelle.karte") }}</dt>
                    <dd>{{ quelleFlaeche }}</dd>
                </div>
                <div>
                    <dt>{{ t("spracheditor.quelle.text") }}</dt>
                    <dd>
                        {{
                            detail.wiki.length > 0
                                ? t("spracheditor.quelle.wiki", { n: formatNumber(detail.wiki.length, 0) })
                                : t("spracheditor.quelle.ohneWiki")
                        }}
                    </dd>
                </div>
            </dl>
        </section>

        <section v-if="!lesend && detail.aktiv" class="eigenschaften__kasten" :data-testid="`${kennung}-stilllegen`">
            <h4 class="eigenschaften__titel">{{ t("spracheditor.kasten.stand") }}</h4>
            <AvmBestaetigung
                v-if="fragt"
                :frage="t('spracheditor.stilllegen.frage', { name: detail.name })"
                :folge="t('spracheditor.stilllegen.folge')"
                :bestaetigen="t('spracheditor.stilllegen.knopf')"
                :gesperrt="stillGrund"
                :testid="`${kennung}-stilllegen-frage`"
                @bestaetigen="
                    fragt = false;
                    emit('stilllegen');
                "
                @abbrechen="fragt = false"
            />
            <AvmKnopf
                v-else
                art="gefahr"
                groesse="zeile"
                :gesperrt="stillGrund"
                :testid="`${kennung}-stilllegen-knopf`"
                @click="fragt = true"
            >
                {{ t("spracheditor.stilllegen.oeffnen") }}
            </AvmKnopf>
        </section>
    </div>
</template>

<style scoped>
.eigenschaften {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

/* Die Kästen wie die Abschnitte der übrigen Editoren (`kraftlinieneditor-fenster.vue`, `.kraftlinieneditor__abschnitt`). */
.eigenschaften__kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.eigenschaften__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.eigenschaften__wert {
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
}

.eigenschaften__werte {
    display: grid;
    gap: var(--space-2);
    margin: 0;
}

.eigenschaften__werte > div {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    gap: var(--space-6);
}

.eigenschaften__werte dt {
    color: var(--color-text-muted);
}

.eigenschaften__werte dd {
    margin: 0;
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.eigenschaften__hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
