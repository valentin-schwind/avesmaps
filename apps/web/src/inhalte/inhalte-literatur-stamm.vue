<script setup lang="ts">
import { computed } from "vue";
import { INHALTE_WERK_EDITIONEN, INHALTE_WERK_TYPEN } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import EntwurfKonflikt from "../fenster/entwurf-konflikt.vue";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { t, type MessageKey } from "../i18n/i18n";
import { oeffneMedien } from "../medien/medien-oeffnen";
import { standAusWerk } from "./inhalte-literatur-modell";
import type { LiteraturSteuerung } from "./inhalte-literatur-steuerung";
import { typName } from "./inhalte-literatur-texte";

/**
 * Spalte 2 des Reiters „Literatur“ (WI-0254, Runde 2; Mockup): die Stammdaten des gewählten Werks.
 *
 * - **Cover:** Es gehört der Medienverwaltung (Rechte, Quarantäne, Freigaberegel). Hier steht, ob eines da ist und ob es öffentlich sein darf,
 *   und der Weg dorthin; kein Wiki-Bildabruf, kein Upload.
 * - **Identität:** Titel, Produkttyp, Regelsystem, Serie. **Datierung und Einordnung:** Jahr (BF), Genre, offiziell, redaktionelle Notiz.
 *   **Wiki-Verknüpfung:** der Wiki-Schlüssel, nur lesbar; ein gleichlautender Schlüssel ist kein Merge.
 * - **Herkunft je Feld:** Ein Feld, das die Redaktion geändert hat, trägt „manuell“, eines aus dem Wiki „Wiki“; was nichts sagt, ist nicht
 *   bekannt (nie „Wiki“ geraten). Wiki-Vergleichswerte (↺ „auf Wiki-Wert“) speichert Avesmaps3D noch nicht.
 * - Ein Konflikt (409) steht als Kasten oben, im Wortlaut der Karteneditoren (`EntwurfKonflikt`); der Entwurf bleibt sichtbar.
 * - Ohne Schreibrecht (Reviewer) und für ein unterdrücktes Werk sind alle Felder gesperrt; der Grund steht EINMAL oben.
 */
const props = defineProps<{
    steuerung: LiteraturSteuerung;
    darfSchreiben: boolean;
    telefon: boolean;
}>();
const emit = defineEmits<{ zurueck: []; weiter: [] }>();

const s = props.steuerung;
const werk = computed(() => s.werk.value);
const stand = computed(() => s.stand.value);
const felder = computed(() => stand.value?.felder);
const start = computed(() => (werk.value === undefined ? undefined : standAusWerk(werk.value)));

const sperrSatz = computed<string | undefined>(() => {
    if (!props.darfSchreiben) return t("inhalte.nurLesen");
    if (felder.value?.aktiv === false) return t("inhalte.literatur.stamm.stillgelegt");
    return undefined;
});
const sperre = computed<string | undefined>(() => (sperrSatz.value === undefined ? undefined : ""));

const artOptionen = computed(() => {
    const aktuell = felder.value?.productType ?? "";
    const werte: readonly string[] = INHALTE_WERK_TYPEN;
    return [...(aktuell === "" || werte.includes(aktuell) ? [] : [aktuell]), ...werte].map((wert) => ({
        wert,
        text: typName(wert),
    }));
});
const editionOptionen = computed(() => {
    const aktuell = felder.value?.edition ?? "";
    const werte: readonly string[] = INHALTE_WERK_EDITIONEN;
    return [
        { wert: "", text: t("inhalte.literatur.edition.unbekannt") },
        ...(aktuell === "" || werte.includes(aktuell) ? [] : [{ wert: aktuell, text: aktuell }]),
        ...werte.map((wert) => ({ wert, text: wert })),
    ];
});
const jaNein = computed<readonly { wert: string; text: string }[]>(() => [
    { wert: "ja", text: t("inhalte.ja") },
    { wert: "nein", text: t("inhalte.nein") },
]);

const titel = computed({
    get: () => felder.value?.title ?? "",
    set: (wert: string) => s.setzeFeldWert("title", wert),
});
const art = computed({
    get: () => felder.value?.productType ?? "",
    set: (wert: string) => s.setzeFeldWert("productType", wert),
});
const edition = computed({
    get: () => felder.value?.edition ?? "",
    set: (wert: string) => s.setzeFeldWert("edition", wert),
});
const serie = computed({
    get: () => felder.value?.series ?? "",
    set: (wert: string) => s.setzeFeldWert("series", wert),
});
const jahr = computed({
    get: () => felder.value?.bfYear ?? "",
    set: (wert: string) => s.setzeFeldWert("bfYear", wert),
});
const genre = computed({
    get: () => felder.value?.genre ?? "",
    set: (wert: string) => s.setzeFeldWert("genre", wert),
});
const offiziell = computed({
    get: () => (felder.value?.isOfficial === true ? "ja" : "nein"),
    set: (wert: string) => s.setzeFeldWert("isOfficial", wert === "ja"),
});
const notiz = computed({
    get: () => felder.value?.editorNote ?? "",
    set: (wert: string) => s.setzeFeldWert("editorNote", wert),
});

/** Woher ein Feld stammt: geändert im Entwurf (oder von der Redaktion gesetzt) heißt „manuell“, sonst gilt der Vermerk des Werks. */
type FeldName = "title" | "productType" | "edition" | "series" | "bfYear" | "genre" | "isOfficial";
function ursprungVon(feld: FeldName): "wiki" | "manual" | undefined {
    const jetzt = felder.value;
    const vorher = start.value?.felder;
    if (jetzt !== undefined && vorher !== undefined && jetzt[feld] !== vorher[feld]) return "manual";
    return werk.value?.feldUrsprung[feld];
}
const geaendert = (feld: FeldName): boolean => {
    const jetzt = felder.value;
    const vorher = start.value?.felder;
    return jetzt !== undefined && vorher !== undefined && jetzt[feld] !== vorher[feld];
};

/** Das kleine Wort hinter der Beschriftung: „Wiki“ oder „manuell“; nichts, wo die Herkunft nicht bekannt ist. */
function herkunftText(feld: FeldName): string | undefined {
    const ursprung = ursprungVon(feld);
    if (ursprung === undefined) return undefined;
    return t(ursprung === "wiki" ? "inhalte.literatur.feld.herkunft.wiki" : "inhalte.literatur.feld.herkunft.manuell");
}

const stillgelegt = computed(() => felder.value?.aktiv === false);
const ursprungName = computed(() => {
    const w = werk.value;
    if (w === undefined) return "";
    return t(`inhalte.ursprung.${w.ursprung}` as MessageKey);
});
const unterzeile = computed(() =>
    werk.value === undefined
        ? undefined
        : t("inhalte.literatur.stamm.unterzeile", {
              typ: typName(felder.value?.productType ?? werk.value.productType),
          }),
);

const coverZustand = computed(() => {
    const cover = werk.value?.cover;
    if (cover === undefined) return "";
    return t(
        cover.ansicht !== undefined
            ? "inhalte.literatur.cover.da"
            : cover.gebunden
              ? "inhalte.literatur.cover.gebunden"
              : "inhalte.literatur.cover.keins",
    );
});
function oeffneCover(): void {
    const w = werk.value;
    if (w === undefined) return;
    oeffneMedien({ von: { kind: "adventure", id: w.id, name: w.title }, rolle: "literature_cover" });
}

const FELD_NAMEN: Readonly<Record<string, MessageKey>> = {
    title: "inhalte.feld.titel",
    productType: "inhalte.literatur.feld.art",
    edition: "inhalte.literatur.feld.regelsystem",
    series: "inhalte.literatur.feld.serie",
    bfYear: "inhalte.literatur.feld.jahr",
    genre: "inhalte.literatur.feld.genre",
    isOfficial: "inhalte.feld.offiziell",
    editorNote: "inhalte.literatur.feld.notiz",
    aktiv: "inhalte.feld.aktiv",
    orte: "inhalte.literatur.feld.orte",
};
const feldName = (schluessel: string): string => {
    const bekannt = FELD_NAMEN[schluessel];
    return bekannt === undefined ? schluessel : t(bekannt);
};

const speicherSatz = computed(() => {
    const z = s.zustand.value;
    if (z.art !== "abgelehnt") return undefined;
    return z.code === "titel_leer" ? t("inhalte.literatur.fehler.titelLeer") : z.satz;
});
</script>

<template>
    <FensterSpalte
        breite="fuellen"
        :telefon="telefon"
        :titel="
            werk
                ? felder?.title === ''
                    ? t('inhalte.ohneTitel')
                    : (felder?.title ?? werk.title)
                : t('inhalte.stamm.titel')
        "
        :unterzeile="unterzeile"
        testid="inhalte-spalte-stamm"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="inhalte-zurueck-liste" @click="emit('zurueck')">{{
                t("inhalte.literatur.zurueck.liste")
            }}</AvmKnopf>
        </template>
        <template v-if="werk && darfSchreiben" #kopf>
            <AvmKnopf
                groesse="zeile"
                :title="
                    stillgelegt ? t('inhalte.literatur.stamm.zurueckholen') : t('inhalte.literatur.stamm.unterdruecken')
                "
                :aria-label="
                    stillgelegt ? t('inhalte.literatur.stamm.zurueckholen') : t('inhalte.literatur.stamm.unterdruecken')
                "
                testid="inhalte-werk-unterdruecken"
                @click="s.setzeFeldWert('aktiv', stillgelegt)"
            >
                {{ stillgelegt ? "↺" : "✕" }}
            </AvmKnopf>
        </template>

        <p v-if="s.werkLaedt.value && !werk" class="stamm__leise">{{ t("inhalte.laedt") }}</p>
        <AvmHinweis v-else-if="s.werkFehler.value" ton="warnung" rolle="alert" testid="inhalte-werk-fehler">
            {{ s.werkFehler.value.status === 404 ? t("inhalte.literatur.fehlt") : t("inhalte.literatur.fehler") }}
        </AvmHinweis>
        <p v-else-if="!werk" class="stamm__leise" data-testid="inhalte-stamm-leer">
            {{ t("inhalte.literatur.stamm.leer") }}
        </p>

        <template v-else-if="felder">
            <EntwurfKonflikt
                v-if="s.zustand.value.art === 'konflikt'"
                :bearbeitung="{
                    eigeneAnwenden: (trotzdem?: boolean) => s.eigeneAnwenden(trotzdem),
                    fremdenUebernehmen: () => s.fremdenUebernehmen(),
                }"
                :konflikt="s.zustand.value"
                :feld-name="feldName"
                kennung="inhalte"
            />
            <AvmHinweis v-if="sperrSatz" ton="warnung" testid="inhalte-stamm-sperre">{{ sperrSatz }}</AvmHinweis>
            <AvmHinweis v-if="speicherSatz" ton="gefahr" rolle="alert" testid="inhalte-speichern-fehler">{{
                speicherSatz
            }}</AvmHinweis>

            <div class="stamm__chips" data-testid="inhalte-werk-chips">
                <AvmPille :ton="werk.ursprung === 'manual' ? 'warnung' : 'neutral'">{{ ursprungName }}</AvmPille>
                <AvmPille v-if="werk.wikiKey !== undefined">{{
                    t("inhalte.stamm.wikiKey", { key: werk.wikiKey })
                }}</AvmPille>
                <AvmPille v-else>{{ t("inhalte.stamm.ohneWikiKey") }}</AvmPille>
                <AvmPille v-if="stillgelegt" ton="gefahr">{{ t("inhalte.literatur.stamm.unterdrueckt") }}</AvmPille>
            </div>

            <section class="stamm__abschnitt">
                <h4 class="stamm__kopf avm-versalmitte">{{ t("inhalte.literatur.abschnitt.cover") }}</h4>
                <div class="cover" data-testid="inhalte-werk-cover">
                    <div class="cover__bild">
                        <img
                            v-if="werk.cover.ansicht"
                            class="cover__img"
                            :src="werk.cover.ansicht.url"
                            :alt="t('inhalte.literatur.cover.alt', { titel: werk.title })"
                            loading="lazy"
                        />
                        <span v-else class="cover__platzhalter">
                            <span class="cover__titel">{{ felder.title }}</span>
                            <span class="cover__klein">{{ t("inhalte.literatur.cover.platzhalter") }}</span>
                        </span>
                    </div>
                    <div class="cover__text">
                        <span>{{ t("inhalte.literatur.cover.zustand", { zustand: coverZustand }) }}</span>
                        <span>{{ t("inhalte.literatur.cover.herkunft") }}</span>
                        <span>{{ t("inhalte.literatur.cover.keinWiki") }}</span>
                        <AvmKnopf
                            v-if="darfSchreiben"
                            groesse="zeile"
                            testid="inhalte-werk-cover-medien"
                            @click="oeffneCover()"
                        >
                            {{ t("inhalte.literatur.cover.medien") }}
                        </AvmKnopf>
                    </div>
                </div>
            </section>

            <section class="stamm__abschnitt">
                <h4 class="stamm__kopf avm-versalmitte">{{ t("inhalte.abschnitt.identitaet") }}</h4>
                <FensterFeldzeile fuer="inhalte-feld-titel">
                    <template #beschriftung>
                        <span>{{ t("inhalte.feld.titel") }} *</span>
                        <span
                            v-if="herkunftText('title')"
                            class="stamm__herkunft"
                            :class="{ 'is-neu': geaendert('title') }"
                            >{{ herkunftText("title") }}</span
                        >
                    </template>
                    <AvmEingabe
                        id="inhalte-feld-titel"
                        v-model="titel"
                        required
                        :gesperrt="sperre"
                        :ungueltig="titel.trim() === ''"
                        testid="inhalte-feld-titel"
                        @change="s.feldSchluss()"
                    />
                </FensterFeldzeile>
                <FensterFeldzeile fuer="inhalte-feld-art">
                    <template #beschriftung>
                        <span>{{ t("inhalte.literatur.feld.art") }}</span>
                        <span
                            v-if="herkunftText('productType')"
                            class="stamm__herkunft"
                            :class="{ 'is-neu': geaendert('productType') }"
                            >{{ herkunftText("productType") }}</span
                        >
                    </template>
                    <AvmAuswahl
                        id="inhalte-feld-art"
                        v-model="art"
                        :optionen="artOptionen"
                        :gesperrt="sperre"
                        testid="inhalte-feld-art"
                    />
                </FensterFeldzeile>
                <FensterFeldzeile fuer="inhalte-feld-regelsystem">
                    <template #beschriftung>
                        <span>{{ t("inhalte.literatur.feld.regelsystem") }}</span>
                        <span
                            v-if="herkunftText('edition')"
                            class="stamm__herkunft"
                            :class="{ 'is-neu': geaendert('edition') }"
                            >{{ herkunftText("edition") }}</span
                        >
                    </template>
                    <AvmAuswahl
                        id="inhalte-feld-regelsystem"
                        v-model="edition"
                        :optionen="editionOptionen"
                        :gesperrt="sperre"
                        testid="inhalte-feld-regelsystem"
                    />
                </FensterFeldzeile>
                <FensterFeldzeile fuer="inhalte-feld-serie">
                    <template #beschriftung>
                        <span>{{ t("inhalte.literatur.feld.serie") }}</span>
                        <span
                            v-if="herkunftText('series')"
                            class="stamm__herkunft"
                            :class="{ 'is-neu': geaendert('series') }"
                            >{{ herkunftText("series") }}</span
                        >
                    </template>
                    <AvmEingabe
                        id="inhalte-feld-serie"
                        v-model="serie"
                        :gesperrt="sperre"
                        testid="inhalte-feld-serie"
                        @change="s.feldSchluss()"
                    />
                </FensterFeldzeile>
            </section>

            <AvmKnopf v-if="telefon" groesse="zeile" testid="inhalte-weiter-orte" @click="emit('weiter')">
                {{ t("inhalte.literatur.weiter.orte") }} ›
            </AvmKnopf>

            <section class="stamm__abschnitt">
                <h4 class="stamm__kopf avm-versalmitte">{{ t("inhalte.literatur.abschnitt.einordnung") }}</h4>
                <FensterFeldzeile fuer="inhalte-feld-jahr">
                    <template #beschriftung>
                        <span>{{ t("inhalte.literatur.feld.jahr") }}</span>
                        <span
                            v-if="herkunftText('bfYear')"
                            class="stamm__herkunft"
                            :class="{ 'is-neu': geaendert('bfYear') }"
                            >{{ herkunftText("bfYear") }}</span
                        >
                    </template>
                    <AvmEingabe
                        id="inhalte-feld-jahr"
                        v-model="jahr"
                        inputmode="numeric"
                        maxlength="4"
                        :placeholder="t('inhalte.literatur.feld.jahr.platzhalter')"
                        :gesperrt="sperre"
                        testid="inhalte-feld-jahr"
                        @change="s.feldSchluss()"
                    />
                </FensterFeldzeile>
                <p v-if="werk.bfLabel !== null && !geaendert('bfYear')" class="stamm__notiz">
                    {{ t("inhalte.literatur.jahr.angabe", { label: werk.bfLabel }) }}
                </p>
                <FensterFeldzeile fuer="inhalte-feld-genre">
                    <template #beschriftung>
                        <span>{{ t("inhalte.literatur.feld.genre") }}</span>
                        <span
                            v-if="herkunftText('genre')"
                            class="stamm__herkunft"
                            :class="{ 'is-neu': geaendert('genre') }"
                            >{{ herkunftText("genre") }}</span
                        >
                    </template>
                    <AvmEingabe
                        id="inhalte-feld-genre"
                        v-model="genre"
                        :gesperrt="sperre"
                        testid="inhalte-feld-genre"
                        @change="s.feldSchluss()"
                    />
                </FensterFeldzeile>
                <FensterFeldzeile fuer="inhalte-feld-offiziell">
                    <template #beschriftung>
                        <span>{{ t("inhalte.feld.offiziell") }}</span>
                        <span
                            v-if="herkunftText('isOfficial')"
                            class="stamm__herkunft"
                            :class="{ 'is-neu': geaendert('isOfficial') }"
                            >{{ herkunftText("isOfficial") }}</span
                        >
                    </template>
                    <AvmAuswahl
                        id="inhalte-feld-offiziell"
                        v-model="offiziell"
                        :optionen="jaNein"
                        :gesperrt="sperre"
                        testid="inhalte-feld-offiziell"
                    />
                </FensterFeldzeile>
                <FensterFeldzeile :name="t('inhalte.literatur.feld.notiz')" fuer="inhalte-feld-notiz" oben>
                    <AvmTextbereich
                        id="inhalte-feld-notiz"
                        v-model="notiz"
                        :zeilen="3"
                        :gesperrt="sperre"
                        testid="inhalte-feld-notiz"
                        @change="s.feldSchluss()"
                    />
                </FensterFeldzeile>
            </section>

            <section class="stamm__abschnitt">
                <h4 class="stamm__kopf avm-versalmitte">{{ t("inhalte.literatur.abschnitt.wiki") }}</h4>
                <FensterFeldzeile :name="t('inhalte.feld.wikiKey')">
                    <span class="stamm__lesen" data-testid="inhalte-feld-wikikey">{{ werk.wikiKey ?? "—" }}</span>
                </FensterFeldzeile>
                <AvmHinweis>{{ t("inhalte.literatur.stamm.getrennt") }}</AvmHinweis>
            </section>
        </template>
    </FensterSpalte>
</template>

<style scoped>
.stamm__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.stamm__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.stamm__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.stamm__kopf {
    margin: var(--space-6) 0 0;
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--color-divider);
    color: var(--color-accent-brown);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.stamm__lesen {
    display: block;
    min-width: 0;
    color: var(--color-text-muted);
}

.stamm__notiz {
    margin: 0 0 0 calc(var(--avm-field-label-w) + var(--space-8));
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Die Herkunft eines Felds, klein hinter der Beschriftung (Mockup „Wiki“ / „manuell“). */
.stamm__herkunft {
    flex: none;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.stamm__herkunft.is-neu {
    color: var(--color-accent-brown);
}

.cover {
    display: flex;
    gap: var(--space-12);
    align-items: flex-start;
}

.cover__bild {
    flex: none;
    box-sizing: border-box;
    width: 96px;
    aspect-ratio: 3 / 4;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.cover__img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.cover__platzhalter {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding: var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    text-align: center;
}

.cover__titel {
    color: var(--color-text);
    overflow-wrap: anywhere;
}

.cover__klein {
    font-size: var(--font-size-caption);
}

.cover__text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
