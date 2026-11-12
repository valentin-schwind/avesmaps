<script setup lang="ts">
import { computed } from "vue";
import { KARTE_VERSION_MAX, KARTENVORSCHLAG_LIMITS } from "@avesmaps3d/shared";
import AvmBildansicht from "../controls/avm-bildansicht.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import AvmSperrgrund from "../controls/avm-sperrgrund.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import { linkHost } from "../kartenvorschlag/modell";
import MedienKarteZielwahl from "../medien/medien-karte-zielwahl.vue";
import { oeffneMedien } from "../medien/medien-oeffnen";
import type { AnsichtZustand } from "./kartenvorschlag-ansicht-zustand";
import KartenvorschlagOrtWahl from "./kartenvorschlag-ort-wahl.vue";
import { ZUSTAND_NAME, dateiName, eingangSatz, istOffen, kreisVon, zustandSatz } from "./kartenvorschlaege-modell";

/**
 * Die Anzeige EINES Kartenvorschlags der Redaktion (WI-0275, Entwurf Fassung 2; ausgezogen für WI-0068 OPS-000093). Der Zustand und die Schritte stehen in `kartenvorschlag-ansicht-zustand.ts`; diese Datei zeichnet nur.
 * Zwei Hüllen tragen sie, ohne Unterschied in Texten und Kennungen (`community-karte-*`): das Werkzeugfenster der Redaktion (`kartenvorschlag-redaktion-fenster.vue`) und die dritte Spalte der Medienverwaltung (`medien-vorschlag.vue`).
 *
 * - **Drei Teile**, weil die Fensterhülle sie in drei Fächer legt (`teil`): `leiste` (Zustand und Eingang, unter dem Kopf), `rumpf` (Laden, Fehler, die Blätter und die Kästen) und `fuss` (der Satz zur Wirkung, Ablehnen und Annehmen). Die Medienverwaltung
 *   stellt alle drei untereinander, den Fuß oben: Annehmen und Ablehnen sind ohne Rollen erreichbar.
 * - **Kästen:** Karte (Link oder Vorschau, groß per Klick; das Format mit dem Bild-Zeichen davor, Vali 2026-11-04; der Weg in die Medienverwaltung), Ort, Rechte, Angaben, Vom Einreicher, Verlauf.
 * - **Annehmen hat ein Blatt** (Entwurf: „mit Blatt“): Es gibt keine Rücknahme, also steht vorher da, was übernommen und öffentlich wird. Im Blatt steht der Ort, den die Karte bekommt (vorbelegt mit dem des Vorschlags, wählbar, entfernbar); ohne Ort warnt es, sperrt aber nicht.
 *   Seit WI-0287 Stufe 2 (Entwurf Fassung 5 `zeichneAnnahme`) wählt das Blatt „Neuer Eintrag“ (wie bisher) oder „Weitere Version eines Eintrags“: dieselbe Zielwahl wie beim Zusammenlegen
 *   (ohne Suchwort die Namensvettern des Orts oder Titels), bei einer Datei das Feld „Version“, und der Satz, was geschieht. Die Wahl braucht die Liste der Kartensammlung, also
 *   `view_media_private`; ohne das Recht gibt es nur den neuen Eintrag.
 * - **Ablehnen hat ein Blatt** mit einem freiwilligen Grund, den der Einreicher auf der Statusseite liest.
 * - 🔴 **Gleichzeitig arbeiten** und 🔴 **Annehmen legt eine Karte an:** siehe den Zustand.
 */
const props = defineProps<{
    zustand: AnsichtZustand;
    teil: "leiste" | "rumpf" | "fuss";
}>();

/** Der Zustand unter kurzem Namen; die Vorlage schreibt in ihn (`v-model="z.grund"`), was an der Prop selbst nicht ginge. */
const z = computed(() => props.zustand);

/** Das Element des Blatts geht an den Zustand zurück, der den Fokus und das Rollen dorthin lenkt. */
const blattWurzelSetzen = (element: unknown): void => {
    z.value.blattWurzel = element instanceof HTMLElement ? element : null;
};

const hostVon = (adresse: string): string => linkHost(adresse) ?? adresse;
const oeffneWerk = (asset: string): void => oeffneMedien({ asset });
const oeffneKarte = (karte: string, titel: string): void => oeffneMedien({ karte, kartenSuche: titel });
</script>

<template>
    <template v-if="teil === 'leiste'">
        <div v-if="z.detail !== undefined" class="leiste" data-testid="community-karte-leiste">
            <span class="leiste__zustand" data-testid="community-karte-zustand">
                <AvmKreis :fuellung="kreisVon(z.detail.zustand)" :name="t(ZUSTAND_NAME[z.detail.zustand])" />
                {{ zustandSatz(z.detail) }}
            </span>
            <span class="leise" data-testid="community-karte-eingang">{{ eingangSatz(z.detail) }}</span>
        </div>
    </template>

    <template v-else-if="teil === 'rumpf'">
        <p v-if="z.stand.art === 'laedt'" class="leise" role="status" data-testid="community-karte-laedt">
            {{ t("community.redaktion.laedt") }}
        </p>
        <template v-else-if="z.stand.art === 'fehler'">
            <AvmHinweis ton="gefahr" rolle="alert" testid="community-karte-fehler">{{ t(z.stand.key) }}</AvmHinweis>
            <AvmKnopf testid="community-karte-erneut" @click="z.lade(false)">{{
                t("community.redaktion.neuLaden")
            }}</AvmKnopf>
        </template>

        <template v-else-if="z.detail !== undefined && z.fakten !== undefined && z.folgen !== undefined">
            <AvmHinweis
                v-if="z.meldung !== undefined"
                :ton="z.meldung.ton"
                rolle="alert"
                testid="community-karte-meldung"
                >{{ t(z.meldung.key) }}</AvmHinweis
            >

            <!-- Das Blatt „Annehmen“: IM Fenster, am Anfang des Rumpfs; es sagt, was geschieht, bevor es geschieht. -->
            <section
                v-if="z.blatt === 'annehmen'"
                :ref="blattWurzelSetzen"
                class="blatt"
                :aria-label="t('kartenvorschlag.redaktion.blatt.annehmen')"
                data-testid="community-karte-blatt-annehmen"
                @keydown="z.escBlatt"
            >
                <h3 class="blatt__titel avm-versalmitte">{{ t("kartenvorschlag.redaktion.blatt.annehmen") }}</h3>
                <AvmSegmente
                    v-if="z.medienErlaubt"
                    v-model="z.annahmeWegModell"
                    :options="z.annahmeWahl"
                    :label="t('kartenvorschlag.redaktion.blatt.weg')"
                    gestapelt="auto"
                    testid="community-karte-annahme-weg"
                />
                <template v-if="z.annahmeWeg === 'neu'">
                    <p class="blatt__text" data-testid="community-karte-blatt-satz">
                        {{
                            z.ortWahl === null
                                ? t("kartenvorschlag.redaktion.blatt.entstehtOhne", { titel: z.detail.titel })
                                : t("kartenvorschlag.redaktion.blatt.entstehtMit", {
                                      titel: z.detail.titel,
                                      ort: z.ortWahl.name,
                                  })
                        }}
                    </p>
                    <div class="blatt__feld">
                        <span class="blatt__label">{{ t("kartenvorschlag.redaktion.blatt.ort") }}</span>
                        <KartenvorschlagOrtWahl v-model="z.ortWahl" :gesperrt="z.sendet" />
                    </div>
                    <AvmHinweis v-if="z.ortWahl === null" ton="warnung" testid="community-karte-ohne-ort">{{
                        t("kartenvorschlag.redaktion.blatt.ohneOrt")
                    }}</AvmHinweis>
                    <dl class="blatt__folgen" data-testid="community-karte-folgen">
                        <dt>{{ t("kartenvorschlag.redaktion.folge.uebernommen") }}</dt>
                        <dd>{{ z.folgen.uebernommen }}.</dd>
                        <template v-if="z.folgen.nicht !== undefined">
                            <dt>{{ t("kartenvorschlag.redaktion.folge.nicht") }}</dt>
                            <dd>{{ z.folgen.nicht }}.</dd>
                        </template>
                        <dt>{{ t("kartenvorschlag.redaktion.folge.oeffentlich") }}</dt>
                        <dd>{{ z.folgen.oeffentlich }}</dd>
                        <template v-if="z.folgen.original !== undefined">
                            <dt>{{ t("kartenvorschlag.redaktion.folge.originalName") }}</dt>
                            <dd>{{ z.folgen.original }}</dd>
                        </template>
                    </dl>
                </template>
                <template v-else>
                    <MedienKarteZielwahl
                        v-model="z.annahmeZiel"
                        :client="z.medienClient"
                        :wort="z.annahmeWort"
                        :gesperrt="z.sendet"
                        testid="community-karte-ziel"
                    />
                    <template v-if="z.annahmeZiel">
                        <label v-if="z.detail.weg === 'datei'" class="blatt__feld" :for="z.versionId">
                            <span class="blatt__label">{{ t("medien.karten.version.feld") }}</span>
                            <AvmEingabe
                                :id="z.versionId"
                                v-model="z.annahmeVersion"
                                :placeholder="t('medien.karten.version.platzhalter')"
                                :maxlength="KARTE_VERSION_MAX"
                                :gesperrt="z.sendet ? '' : undefined"
                                testid="community-karte-version"
                            />
                        </label>
                        <p class="blatt__text" data-testid="community-karte-blatt-version-satz">
                            {{
                                t(
                                    z.detail.weg === "datei"
                                        ? "kartenvorschlag.redaktion.blatt.versionDatei"
                                        : "kartenvorschlag.redaktion.blatt.versionLink",
                                    { titel: z.annahmeZiel.title },
                                )
                            }}
                        </p>
                    </template>
                    <AvmHinweis v-if="z.zielFehlt" ton="warnung" rolle="alert" testid="community-karte-ziel-fehlt">{{
                        t("kartenvorschlag.redaktion.blatt.zielFehlt")
                    }}</AvmHinweis>
                </template>
                <p class="leise">{{ t("kartenvorschlag.redaktion.blatt.keineRuecknahme") }}</p>
                <AvmHinweis
                    v-if="z.blattFehler !== undefined"
                    ton="gefahr"
                    rolle="alert"
                    testid="community-karte-blatt-fehler"
                    >{{ z.blattFehler }}</AvmHinweis
                >
                <div class="blatt__knoepfe">
                    <AvmKnopf
                        :gesperrt="z.sendet ? '' : undefined"
                        testid="community-karte-blatt-abbrechen"
                        @click="z.schliesseBlatt"
                        >{{ t("kartenvorschlag.redaktion.blatt.abbrechen") }}</AvmKnopf
                    >
                    <AvmKnopf
                        art="gefuellt"
                        :gesperrt="z.sendet ? '' : undefined"
                        testid="community-karte-annehmen-senden"
                        @click="z.nimmAn"
                        >{{
                            t(
                                z.sendet
                                    ? "kartenvorschlag.redaktion.senden.annehmend"
                                    : "kartenvorschlag.redaktion.senden.annehmen",
                            )
                        }}</AvmKnopf
                    >
                </div>
            </section>

            <!-- Das Blatt „Ablehnen“: Der Grund ist freiwillig und für den Einreicher lesbar. -->
            <section
                v-else-if="z.blatt === 'ablehnen'"
                :ref="blattWurzelSetzen"
                class="blatt"
                :aria-label="t('kartenvorschlag.redaktion.blatt.ablehnen')"
                data-testid="community-karte-blatt-ablehnen"
                @keydown="z.escBlatt"
            >
                <h3 class="blatt__titel avm-versalmitte">{{ t("kartenvorschlag.redaktion.blatt.ablehnen") }}</h3>
                <label class="blatt__feld">
                    <span class="blatt__label">{{ t("kartenvorschlag.redaktion.blatt.grund") }}</span>
                    <AvmTextbereich
                        v-model="z.grund"
                        :zeilen="3"
                        :maxlength="KARTENVORSCHLAG_LIMITS.grundMax"
                        :placeholder="t('kartenvorschlag.redaktion.blatt.grundPlatzhalter')"
                        :gesperrt="z.sendet ? '' : undefined"
                        testid="community-karte-grund"
                    />
                    <span class="blatt__zahl" data-testid="community-karte-grund-zahl"
                        >{{ z.grund.length }} / {{ KARTENVORSCHLAG_LIMITS.grundMax }}</span
                    >
                </label>
                <p class="leise">
                    {{
                        t(
                            z.detail.weg === "datei"
                                ? "kartenvorschlag.redaktion.blatt.ablehnenDatei"
                                : "kartenvorschlag.redaktion.blatt.ablehnenLink",
                        )
                    }}
                </p>
                <AvmHinweis
                    v-if="z.blattFehler !== undefined"
                    ton="gefahr"
                    rolle="alert"
                    testid="community-karte-blatt-fehler"
                    >{{ z.blattFehler }}</AvmHinweis
                >
                <div class="blatt__knoepfe">
                    <AvmKnopf
                        :gesperrt="z.sendet ? '' : undefined"
                        testid="community-karte-blatt-abbrechen"
                        @click="z.schliesseBlatt"
                        >{{ t("kartenvorschlag.redaktion.blatt.abbrechen") }}</AvmKnopf
                    >
                    <AvmKnopf
                        art="gefuellt"
                        :gesperrt="z.sendet ? '' : undefined"
                        testid="community-karte-ablehnen-senden"
                        @click="z.lehneDenAb"
                        >{{
                            t(
                                z.sendet
                                    ? "kartenvorschlag.redaktion.senden.ablehnend"
                                    : "kartenvorschlag.redaktion.senden.ablehnen",
                            )
                        }}</AvmKnopf
                    >
                </div>
            </section>

            <section class="kasten" data-testid="community-karte-karte">
                <h3 class="kasten__kopf avm-versalmitte">{{ t("kartenvorschlag.redaktion.kasten.karte") }}</h3>
                <template v-if="z.detail.weg === 'link' && z.detail.link !== null">
                    <a
                        class="ziel"
                        :href="z.detail.link"
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="community-karte-link"
                        >{{ t("kartenvorschlag.link.gut", { host: hostVon(z.detail.link) }) }}</a
                    >
                    <p class="adresse">{{ z.detail.link }}</p>
                    <p v-if="z.detail.vorschauLink !== null" class="leise">
                        {{ t("kartenvorschlag.redaktion.vorschauLink.text") }}
                        <a :href="z.detail.vorschauLink" target="_blank" rel="noopener noreferrer">{{
                            hostVon(z.detail.vorschauLink)
                        }}</a
                        >. {{ t("kartenvorschlag.redaktion.vorschauLink.satz") }}
                    </p>
                </template>
                <template v-else>
                    <button
                        v-if="z.detail.vorschau !== null && !z.bildFehlt"
                        type="button"
                        class="vorschau"
                        :title="t('kartenvorschlag.redaktion.vorschau.gross')"
                        :aria-label="t('kartenvorschlag.redaktion.vorschau.grossVon', { titel: z.detail.titel })"
                        data-testid="community-karte-vorschau"
                        @click="z.ansicht = 0"
                    >
                        <img
                            :src="z.detail.vorschau"
                            :alt="t('kartenvorschlag.redaktion.vorschau.alt', { titel: z.detail.titel })"
                            decoding="async"
                            draggable="false"
                            @error="z.bildFehlt = true"
                        />
                        <span v-if="z.istPdf" class="vorschau__marke">{{
                            t("kartenvorschlag.redaktion.vorschau.seite")
                        }}</span>
                    </button>
                    <div v-else class="platzhalter" role="status" data-testid="community-karte-platzhalter">
                        {{ z.platzhalter }}
                    </div>
                    <div class="vorschau__unter">
                        <span class="leise" data-testid="community-karte-format"
                            ><span aria-hidden="true">🖼️ </span>{{ dateiName(z.detail.dateiTyp)
                            }}<template v-if="z.istPdf && z.detail.vorschau !== null && !z.bildFehlt"
                                >, {{ t("kartenvorschlag.redaktion.vorschau.zeigtSeite") }}</template
                            ></span
                        >
                        <button
                            v-if="z.detail.asset !== null && z.medienErlaubt"
                            type="button"
                            class="verweis"
                            data-testid="community-karte-medien"
                            @click="oeffneWerk(z.detail.asset)"
                        >
                            <span aria-hidden="true">→ </span>{{ t("kartenvorschlag.redaktion.medien") }}
                        </button>
                    </div>
                </template>
                <p v-if="z.detail.beschreibung !== null" class="inhalt" data-testid="community-karte-beschreibung">
                    {{ z.detail.beschreibung }}
                </p>
            </section>

            <section class="kasten" data-testid="community-karte-ort">
                <h3 class="kasten__kopf avm-versalmitte">{{ t("kartenvorschlag.redaktion.kasten.ort") }}</h3>
                <div v-if="z.detail.ort !== null" class="ort">
                    <AvmKreis fuellung="voll" :name="t('community.redaktion.bezug.objekt')" />
                    <span class="ort__name">{{ z.detail.ort.name }}</span>
                    <span class="ort__griffe">
                        <AvmKnopf
                            groesse="zeile"
                            :title="t('community.redaktion.bezug.zeigen')"
                            :aria-label="t('community.redaktion.bezug.zeigen')"
                            testid="community-karte-zeigen"
                            @click="z.zeige"
                            >⊕</AvmKnopf
                        >
                    </span>
                </div>
                <p v-else class="leise">{{ t("kartenvorschlag.redaktion.ort.keiner") }}</p>
            </section>

            <section class="kasten" data-testid="community-karte-rechte">
                <h3 class="kasten__kopf avm-versalmitte">{{ t("kartenvorschlag.redaktion.kasten.rechte") }}</h3>
                <p v-if="z.detail.weg === 'link' || z.detail.nutzung === null" class="leise">
                    {{ t("kartenvorschlag.redaktion.rechte.link") }}
                </p>
                <template v-else>
                    <AvmPille class="rechte__pille">{{
                        t(`photobox.nutzung.${z.detail.nutzung}` as MessageKey)
                    }}</AvmPille>
                    <p class="blatt__text">
                        {{ t(`kartenvorschlag.nutzung.erklaerung.${z.detail.nutzung}` as MessageKey) }}
                    </p>
                    <p class="leise">{{ t("kartenvorschlag.redaktion.rechte.erklaert") }}</p>
                </template>
            </section>

            <section class="kasten" data-testid="community-karte-angaben">
                <h3 class="kasten__kopf avm-versalmitte">{{ t("kartenvorschlag.redaktion.kasten.angaben") }}</h3>
                <dl v-if="z.fakten.zeilen.length > 0" class="fakten">
                    <template v-for="fakt in z.fakten.zeilen" :key="fakt.name">
                        <dt>{{ fakt.name }}</dt>
                        <dd :class="{ 'is-achtung': fakt.achtung === true }">{{ fakt.wert }}</dd>
                    </template>
                </dl>
                <p v-if="z.fakten.fehlt.length > 0" class="leise">
                    {{ t("kartenvorschlag.redaktion.fakt.unbekannt", { namen: z.fakten.fehlt.join(", ") }) }}
                </p>
            </section>

            <section class="kasten" data-testid="community-karte-einreicher">
                <h3 class="kasten__kopf avm-versalmitte">{{ t("kartenvorschlag.redaktion.kasten.einreicher") }}</h3>
                <dl class="fakten">
                    <dt>{{ t("kartenvorschlag.redaktion.einreicher.name") }}</dt>
                    <dd>
                        <template v-if="z.detail.name !== null">{{ z.detail.name }}</template>
                        <span v-else class="ohne">{{ t("kartenvorschlag.redaktion.einreicher.keinName") }}</span>
                    </dd>
                    <dt>{{ t("kartenvorschlag.redaktion.einreicher.notiz") }}</dt>
                    <dd>
                        <template v-if="z.detail.notiz !== null">{{
                            t("infoPanel.reviews.quote", { text: z.detail.notiz })
                        }}</template>
                        <span v-else class="ohne">{{ t("kartenvorschlag.redaktion.einreicher.keineNotiz") }}</span>
                    </dd>
                </dl>
                <p class="leise">{{ t("kartenvorschlag.redaktion.einreicher.satz") }}</p>
            </section>

            <section class="kasten" data-testid="community-karte-verlauf">
                <h3 class="kasten__kopf avm-versalmitte">{{ t("kartenvorschlag.redaktion.kasten.verlauf") }}</h3>
                <ol class="verlauf">
                    <li v-for="eintrag in z.verlauf" :key="eintrag.key">
                        <template v-if="eintrag.zeit !== undefined"
                            ><span class="leise">{{ eintrag.zeit }}</span> · </template
                        >{{ eintrag.text }}
                    </li>
                </ol>
            </section>

            <AvmBildansicht v-model="z.ansicht" :bilder="z.bilder" testid="community-karte-bildansicht" />
        </template>
    </template>

    <template v-else-if="teil === 'fuss'">
        <div
            v-if="z.detail !== undefined && z.fuss !== undefined && z.blatt === undefined"
            class="fuss"
            data-testid="community-karte-fuss"
        >
            <p class="fuss__satz" data-testid="community-karte-fusssatz">{{ z.fuss.satz }}</p>
            <div v-if="istOffen(z.detail.zustand)" class="fuss__knoepfe">
                <AvmKnopf
                    :gesperrt="z.sendet ? '' : undefined"
                    testid="community-karte-ablehnen"
                    @click="z.oeffneBlatt('ablehnen')"
                    >{{ t("kartenvorschlag.redaktion.griff.ablehnen") }}</AvmKnopf
                >
                <AvmKnopf
                    art="gefuellt"
                    :gesperrt="z.sendet ? '' : z.fuss.sperre"
                    :grund-bei="z.sperrId"
                    testid="community-karte-annehmen"
                    @click="z.oeffneBlatt('annehmen')"
                    >{{ t("kartenvorschlag.redaktion.griff.annehmen") }}</AvmKnopf
                >
            </div>
            <div v-else-if="z.detail.karte !== null && z.medienErlaubt" class="fuss__knoepfe fuss__knoepfe--rechts">
                <AvmKnopf
                    art="gefuellt"
                    testid="community-karte-kartensammlung"
                    @click="oeffneKarte(z.detail.karte, z.detail.titel)"
                    >{{ t("kartenvorschlag.redaktion.griff.karte") }}</AvmKnopf
                >
            </div>
            <AvmSperrgrund v-if="z.fuss.sperre !== undefined" :id="z.sperrId" :text="z.fuss.sperre" />
        </div>
    </template>
</template>

<style scoped>
.leiste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.leiste__zustand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    color: var(--color-text-strong);
}

.leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.ohne {
    color: var(--color-text-muted);
}

/* Ein Kasten des Rumpfs (wie im Fenster einer Bewertung). */
.kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.kasten p {
    margin: 0;
}

.kasten__kopf {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.inhalt {
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.ziel {
    color: var(--color-link);
    font-size: var(--font-size-reading);
    overflow-wrap: anywhere;
}

.adresse {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

/* Die Vorschau: eingepasst, nie beschnitten; ein Klick zeigt sie groß. */
.vorschau {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
    cursor: zoom-in;
    transition:
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.vorschau:hover {
    border-color: var(--color-accent);
}

.vorschau:active {
    border-color: var(--color-accent-strong);
}

.vorschau:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.vorschau img {
    display: block;
    width: 100%;
    height: var(--avm-fenster-vorschau-hoehe);
    object-fit: contain;
}

.vorschau__marke {
    position: absolute;
    right: var(--space-4);
    bottom: var(--space-4);
    padding: var(--space-2) var(--space-6);
    border-radius: var(--radius-sm);
    background: var(--color-media-nav);
    color: var(--color-media-text);
    font-size: var(--font-size-caption);
}

.vorschau__unter {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-8);
}

/* Ein Verweis, der in der Seite bleibt (wie „Prüfen“ am Stapel der Reisebilder). */
.verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
        color 120ms ease,
        background-color 120ms ease;
}

.verweis:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.verweis:active {
    border-radius: var(--radius-sm);
    background: var(--color-active-wash);
}

.verweis:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}

.platzhalter {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    min-height: var(--avm-fenster-platzhalter-hoehe);
    padding: var(--space-8);
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    text-align: center;
}

.ort {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
}

.ort__name {
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.ort__griffe {
    display: inline-flex;
    gap: var(--space-4);
    margin-left: auto;
}

.rechte__pille {
    align-self: flex-start;
}

.fakten {
    display: grid;
    grid-template-columns: minmax(var(--avm-fenster-fakten-label), max-content) minmax(0, 1fr);
    gap: var(--space-2) var(--space-8);
    margin: 0;
}

.fakten dt {
    color: var(--color-text-muted);
}

.fakten dd {
    margin: 0;
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.fakten .is-achtung {
    color: var(--color-warning-soft-text);
}

.verlauf {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

/* Das kleine Blatt: dieselbe Fassung wie im Fenster einer Bewertung. */
.blatt {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.blatt__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.blatt__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.blatt__label {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.blatt__zahl {
    align-self: flex-end;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

.blatt__text {
    margin: 0;
    color: var(--color-text);
    overflow-wrap: anywhere;
}

.blatt__folgen {
    display: grid;
    grid-template-columns: minmax(var(--avm-fenster-fakten-label), max-content) minmax(0, 1fr);
    gap: var(--space-4) var(--space-8);
    margin: 0;
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.blatt__folgen dt {
    color: var(--color-text-muted);
}

.blatt__folgen dd {
    margin: 0;
    color: var(--color-text);
}

.blatt__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-6);
}

/* Der Fuß: ein Block (die Hülle kennt nur Hinweis und Knöpfe), also bricht er um. */
.fuss {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    box-sizing: border-box;
    padding: var(--space-2);
    color: var(--color-text);
    font-size: var(--font-size-body);
    white-space: normal;
}

.fuss__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.fuss__knoepfe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
}

.fuss__knoepfe--rechts {
    justify-content: flex-end;
}

@media (prefers-reduced-motion: reduce) {
    .vorschau,
    .verweis {
        transition: none;
    }
}
</style>
