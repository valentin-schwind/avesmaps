<script setup lang="ts">
import { computed } from "vue";
import { PLACE_SUBTYPES, type EditorPlaceTextField } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import EditorZeichen from "../controls/editor-zeichen.vue";
import { phoneViewport } from "../controls/phone-viewport";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import { befunde, type Befund, type PruefStand } from "./befunde";
import OrtsartWahl from "./ortsart-wahl.vue";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import WikiFeld from "../fenster/wiki-feld.vue";
import { wikiLage, type WikiFeldLage } from "../fenster/wiki-feld";
import {
    aufWiki,
    aufWikiGroesse,
    aufWikiName,
    eigeneWerte,
    groesseZeile,
    nameZeile,
    setzeGroesse,
    setzeName,
    setzeText,
    wikiZeile,
    type Entwurf,
    type Merkmal,
} from "./entwurf";
import type { OrtBearbeitung } from "./ort-bearbeitung";
import type { LageSteuerung } from "./ort-verschieben";
import { verschiebeKonfliktText } from "./ortseditor-texte";
import "./ortseditor-formular.css";

/**
 * Die bearbeitbaren Eigenschaften eines Orts (WI-0128 E11; EDIT-0001 §4.3; Gesamtmockup Version 7, „Eigenschaften & Overrides“):
 *
 * - **Identität:** Name, Ortsgröße, Art, Einwohner, Herrscher, Lage, Beschreibung, jede als Zeile des Wiki-Felds (`fenster/wiki-feld.vue`,
 *   WI-0225, Design Guide §13.8): Weicht ein Feld vom Wiki-Stand ab, ist seine Beschriftung braun, der Wiki-Wert steht durchgestrichen
 *   hinter ihr, und ↺ am Zeilenende setzt das Feld im Entwurf zurück; Name, Größe und Art haben kein Gegenstück und fluchten mit; „↺ Alles auf Wiki-Werte (n)“
 *   im Kopf der Spalte Eigenschaften (`ortseditor-fenster.vue`, WI-0183) tut es für alle; ohne eigenen Wert steht hier, warum er
 *   gesperrt ist. Gespeichert wird erst mit „Speichern“ (eine Operation).
 * - **Merkmale:** sechs Haken, je mit einem Satz, was er bewirkt: Ruine, Verborgen, Seehafen, Nodix (gespeichert wie in Legacy, keine Folge von
 *   Seewegen oder Kraftlinien, Betreiber 2026-10-11), Unterirdisch und Entrückt (eigene Merkmale, D21). Liegt ein Seehafen weiter vom
 *   Wasser, als ein Schiff anlegt, sagt das ein Hinweis; er ändert nichts.
 * - **Lage:** Position und die Wegenden am Ort; „✥ Ort verschieben“ (E12) startet den Modus auf der Karte, einen eigenen Entwurf mit
 *   eigener Leiste (`ort-verschieben-leiste.vue`): geschrieben wird erst mit „Fertig“, nicht mit der Speicherleiste des Fensters
 *   (EDIT-0003 G4); „◎ Hinfliegen“ fliegt hin. Ohne `edit_map_geometry` steht statt des Knopfs, warum (T12.10); ein Konflikt beim
 *   Verschieben steht hier mit „Erneut verschieben“.
 *
 * Nur wenn Speichern geht (Schreibrecht, \`MAP_EDITING=testwelt\`); sonst zeigt der Ortseditor die Eigenschaften lesend.
 */
const props = defineProps<{
    bearbeitung: OrtBearbeitung;
    kennung: string;
    lage?: LageSteuerung | undefined;
    /** Was Prüfen braucht: die Namen der anderen Orte, die Region, liegengebliebene Wegenden (E20). */
    pruefen?: PruefStand | undefined;
}>();

const detail = computed(() => props.bearbeitung.detail.value);
const entwurf = computed(() => props.bearbeitung.entwurf.value);
/** Prüfen (E20): Befunde, nie eine Sperre; Speichern geht immer. */
const befundListe = computed(() =>
    detail.value && entwurf.value ? befunde(detail.value, entwurf.value, props.pruefen ?? { namen: new Set() }) : [],
);
function befundText(befund: Befund): string {
    switch (befund.art) {
        case "unverbunden":
            return t("ortseditor.befund.unverbunden");
        case "offeneWegenden":
            return t("ortseditor.befund.offeneWegenden", { n: formatNumber(befund.anzahl, 0) });
        case "gebiet":
            return t("ortseditor.befund.gebiet", { gebiete: befund.gebiete.join(", ") });
        case "name":
            return t("ortseditor.befund.name");
        case "wasser":
            return t("ortseditor.merkmal.seehafenFern");
        case "wiki":
            return t("ortseditor.befund.wiki");
    }
}

const aendere = (neu: (entwurf: Entwurf) => Entwurf): void => props.bearbeitung.aendere(neu);

const TEXTE: readonly { feld: EditorPlaceTextField; name: MessageKey; mehrzeilig?: true }[] = [
    { feld: "einwohner", name: "infoPanel.field.einwohner" },
    { feld: "oberhaupt", name: "ortseditor.feld.herrscher" },
    { feld: "lage", name: "infoPanel.field.lage" },
    { feld: "description", name: "infoPanel.field.description", mehrzeilig: true },
];

const MERKMAL_TEXTE: readonly { id: Merkmal; name: MessageKey; satz: MessageKey }[] = [
    { id: "ruined", name: "ortseditor.feld.ruine", satz: "ortseditor.merkmal.ruineSatz" },
    { id: "hidden", name: "ortseditor.feld.verborgen", satz: "ortseditor.merkmal.verborgenSatz" },
    { id: "seaport", name: "ortseditor.feld.seehafen", satz: "ortseditor.merkmal.seehafenSatz" },
    { id: "nodix", name: "ortseditor.feld.nodix", satz: "ortseditor.merkmal.nodixSatz" },
    { id: "underground", name: "ortseditor.feld.unterirdisch", satz: "ortseditor.merkmal.unterirdischSatz" },
    { id: "withdrawn", name: "ortseditor.feld.entrueckt", satz: "ortseditor.merkmal.entruecktSatz" },
    { id: "approximate", name: "ortseditor.feld.ungefaehr", satz: "ortseditor.merkmal.ungefaehrSatz" },
];

const groessen = PLACE_SUBTYPES.map((wert) => ({ wert, text: t(`place.${wert}` as MessageKey) }));
/** Die Beschriftung einer Ortsgröße aus derselben Liste wie das Auswahlfeld (Legacy: sonst stand „dorf“ neben „Metropole“). */
const groesseText = (wert: string): string => groessen.find((g) => g.wert === wert)?.text ?? wert;

const eigene = computed(() => (detail.value && entwurf.value ? eigeneWerte(detail.value, entwurf.value) : 0));
/** Die Zeile eines Felds mit Wiki-Wert; die Art hat im Wiki kein Gegenstück (`OHNE_WIKI`). */
const zeile = (feld: EditorPlaceTextField): WikiFeldLage => wikiZeile(detail.value!, entwurf.value!, feld);
const OHNE_WIKI = wikiLage({ eigen: null, wiki: null, mitWiki: false });
const geaendert = (feld: string): boolean => (props.bearbeitung.geaenderteFelder.value as string[]).includes(feld);

const position = computed(() => {
    const lage = detail.value?.position;
    if (detail.value === undefined) return undefined;
    // Ein Ort ohne Lage (E16) steht unter „Nicht auf der Karte“.
    return lage ? `${formatNumber(lage.x, 2)} · ${formatNumber(lage.y, 2)}` : t("editorListe.karte.nicht");
});
const ohneLage = computed(() => detail.value !== undefined && detail.value.position === undefined);
const verschiebeMeldung = computed(() => {
    const meldung = props.lage?.meldung;
    if (meldung === undefined || meldung.publicId !== detail.value?.publicId) return undefined;
    if (meldung.art === "konflikt")
        return { titel: t("ortseditor.konflikt.titel"), satz: verschiebeKonfliktText(meldung, detail.value.name) };
    if (meldung.art === "abgelehnt") return { titel: undefined, satz: meldung.satz };
    return undefined;
});
const wegenden = computed(() => {
    const enden = detail.value?.pathEnds ?? [];
    if (enden.length === 0) return t("ortseditor.wegenden.keine");
    return t("ortseditor.wegenden.liste", {
        n: formatNumber(enden.length, 0),
        namen: [...new Set(enden.map((ende) => ende.name))].join(", "),
    });
});
</script>

<template>
    <div v-if="detail && entwurf" class="felder" :data-testid="`${kennung}-felder`">
        <section
            v-if="befundListe.length > 0"
            class="ortsform__kasten felder__pruefen"
            :data-testid="`${kennung}-pruefen`"
        >
            <h4 class="ortsform__titel">{{ t("ortseditor.abschnitt.pruefen") }}</h4>
            <ul class="felder__befunde">
                <li v-for="befund in befundListe" :key="befund.art" :data-testid="`${kennung}-befund-${befund.art}`">
                    <span>⚠ {{ befundText(befund) }}</span>
                    <AvmKnopf
                        v-if="befund.art === 'name' && befund.vorschlag"
                        groesse="zeile"
                        :testid="`${kennung}-befund-vorschlag`"
                        @click="aendere((e) => ({ ...e, name: befund.vorschlag! }))"
                    >
                        {{ t("ortseditor.befund.vorschlag", { name: befund.vorschlag }) }}
                    </AvmKnopf>
                    <AvmKnopf
                        v-if="befund.art === 'offeneWegenden' && befund.bei && lage?.zeige"
                        groesse="zeile"
                        :testid="`${kennung}-befund-zum-naechsten`"
                        @click="lage.zeige(befund.bei)"
                    >
                        {{ t("ortseditor.befund.zumNaechsten") }}
                    </AvmKnopf>
                </li>
            </ul>
            <p class="felder__leise">{{ t("ortseditor.befund.sperrtNicht") }}</p>
        </section>
        <section class="ortsform__kasten">
            <div class="felder__kopf">
                <h4 class="ortsform__titel">{{ t("ortseditor.abschnitt.identitaet") }}</h4>
                <!-- „↺ Alles auf Wiki-Werte (n)“ steht im Kopf der Eigenschaften (WI-0183); hier steht, warum er gesperrt ist. -->
                <span v-if="!detail.wiki" class="felder__leise">{{ t("editorListe.unter.keinArtikel") }}</span>
                <span v-else-if="eigene === 0" class="felder__leise" :data-testid="`${kennung}-wiki-gleich`">{{
                    t("wikiFeld.keineEigenen")
                }}</span>
            </div>
            <WikiFeld
                :name="t('ortseditor.feld.name')"
                :fuer="`${kennung}-feld-name-id`"
                :lage="nameZeile(detail, entwurf)"
                :geaendert="geaendert('name')"
                :testid="`${kennung}-zeile-name`"
                @zurueck="aendere((e) => aufWikiName(detail!, e))"
            >
                <AvmEingabe
                    :id="`${kennung}-feld-name-id`"
                    :model-value="entwurf.name"
                    :testid="`${kennung}-feld-name`"
                    @update:model-value="(wert: string) => aendere((e) => setzeName(e, wert))"
                />
            </WikiFeld>
            <WikiFeld
                :name="t('ortseditor.feld.groesse')"
                :lage="groesseZeile(detail, entwurf, groesseText)"
                :geaendert="geaendert('subtype')"
                :testid="`${kennung}-zeile-subtype`"
                @zurueck="aendere((e) => aufWikiGroesse(detail!, e))"
            >
                <AvmAuswahl
                    :model-value="entwurf.subtype"
                    :optionen="groessen"
                    :testid="`${kennung}-feld-subtype`"
                    @update:model-value="(wert: string) => aendere((e) => setzeGroesse(e, wert))"
                />
            </WikiFeld>
            <WikiFeld
                :name="t('ortseditor.feld.art')"
                :fuer="`${kennung}-feld-kind-id`"
                :lage="OHNE_WIKI"
                :geaendert="geaendert('kind')"
            >
                <OrtsartWahl
                    :id="`${kennung}-feld-kind-id`"
                    :model-value="entwurf.kind"
                    :wiki="detail?.kindWiki"
                    :testid="`${kennung}-feld-kind`"
                    @update:model-value="(wert: string) => aendere((e) => ({ ...e, kind: wert }))"
                />
            </WikiFeld>
            <WikiFeld
                v-for="text in TEXTE"
                :key="text.feld"
                :name="t(text.name)"
                :fuer="`${kennung}-text-${text.feld}`"
                :lage="zeile(text.feld)"
                :geaendert="geaendert(text.feld)"
                :oben="text.mehrzeilig === true"
                :testid="`${kennung}-zeile-${text.feld}`"
                @zurueck="aendere((e) => aufWiki(detail!, e, text.feld))"
            >
                <AvmTextbereich
                    v-if="text.mehrzeilig"
                    :id="`${kennung}-text-${text.feld}`"
                    :model-value="entwurf.texte[text.feld].wert"
                    :zeilen="4"
                    :testid="`${kennung}-feld-${text.feld}`"
                    @update:model-value="(wert: string) => aendere((e) => setzeText(e, text.feld, wert))"
                />
                <AvmEingabe
                    v-else
                    :id="`${kennung}-text-${text.feld}`"
                    :model-value="entwurf.texte[text.feld].wert"
                    :testid="`${kennung}-feld-${text.feld}`"
                    @update:model-value="(wert: string) => aendere((e) => setzeText(e, text.feld, wert))"
                />
            </WikiFeld>
        </section>
        <section class="ortsform__kasten">
            <h4 class="ortsform__titel">{{ t("ortseditor.abschnitt.merkmale") }}</h4>
            <AvmKaestchen
                v-for="merkmal in MERKMAL_TEXTE"
                :key="merkmal.id"
                art="checkbox"
                :checked="entwurf[merkmal.id]"
                mehrzeilig
                :testid="`${kennung}-feld-${merkmal.id}`"
                @change="(an: boolean) => aendere((e) => ({ ...e, [merkmal.id]: an }))"
            >
                <span
                    ><span :class="{ 'is-geaendert': geaendert(merkmal.id) }">{{ t(merkmal.name) }}</span
                    ><small class="felder__klein">{{ t(merkmal.satz) }}</small></span
                >
            </AvmKaestchen>
        </section>
        <section class="ortsform__kasten">
            <h4 class="ortsform__titel">{{ t("ortseditor.abschnitt.lage") }}</h4>
            <FensterFeldzeilen>
                <dt>{{ t("ortseditor.feld.position") }}</dt>
                <dd class="felder__zahl">{{ position }}</dd>
                <dt>{{ t("ortseditor.feld.wegenden") }}</dt>
                <dd>{{ wegenden }}</dd>
            </FensterFeldzeilen>
            <div v-if="lage && ohneLage" class="felder__knoepfe">
                <AvmKnopf
                    v-if="lage.setzbar"
                    groesse="zeile"
                    :gesperrt="lage.setztGerade ? t('ortseditor.setzen.laeuft') : undefined"
                    :testid="`${kennung}-setzen`"
                    @click="lage.setze()"
                >
                    {{ t("ortseditor.setzen") }}
                </AvmKnopf>
            </div>
            <p v-if="lage && ohneLage && lage.setzbar" class="felder__leise">{{ t("ortseditor.setzen.ziehen") }}</p>
            <p v-if="lage?.setzSatz" class="felder__meldung" role="alert" :data-testid="`${kennung}-setzen-meldung`">
                {{ lage.setzSatz }}
            </p>
            <div v-if="lage && !ohneLage" class="felder__knoepfe">
                <AvmKnopf
                    v-if="!lage.ohneRecht"
                    groesse="zeile"
                    :gesperrt="lage.laeuft ? t('ortseditor.verschieben.laeuft') : undefined"
                    :testid="`${kennung}-verschieben`"
                    @click="lage.verschiebe()"
                >
                    {{ t("ortseditor.verschieben") }}
                </AvmKnopf>
                <AvmKnopf groesse="zeile" :testid="`${kennung}-hinfliegen`" @click="lage.fliege()">
                    {{ t("ortseditor.hinfliegen") }}
                </AvmKnopf>
            </div>
            <!-- Solange „Ort verschieben“ läuft: wie der Modus geht (vorher die Leiste des eingeklappten Fensters). -->
            <p v-if="lage?.laeuft" class="felder__leise felder__modus" :data-testid="`${kennung}-verschieben-hinweis`">
                <template v-if="lage.hinweis">{{ lage.hinweis }}</template>
                <template v-else-if="phoneViewport">
                    {{ t("ortseditor.verschieben.leiste") }} {{ t("ortseditor.verschieben.finger") }}
                </template>
                <template v-else>
                    {{ t("ortseditor.verschieben.leiste") }}
                    <kbd>{{ t("ortseditor.verschieben.strgTaste") }}</kbd>
                    {{ t("ortseditor.verschieben.strg") }}
                    <kbd>{{ t("ortseditor.verschieben.escTaste") }}</kbd>
                    {{ t("ortseditor.verschieben.esc") }}
                </template>
            </p>
            <!-- „Ort entfernen“ (E22): EIN Knopf, das Blatt fragt alles Weitere (`ort-entfernen-fenster.vue`). -->
            <div v-if="lage?.entfernen" class="felder__knoepfe">
                <AvmKnopf
                    groesse="zeile"
                    art="gefahr"
                    :gesperrt="lage.laeuft ? t('ortseditor.verschieben.laeuft') : undefined"
                    :testid="`${kennung}-entfernen`"
                    @click="lage.entfernen()"
                >
                    <template #zeichen><EditorZeichen name="abnehmen" /></template>
                    {{ t("ortseditor.entfernen") }}
                </AvmKnopf>
            </div>
            <p v-if="lage?.ohneRecht" class="felder__leise" :data-testid="`${kennung}-verschieben-recht`">
                {{ t("ortseditor.verschieben.recht") }}
            </p>
            <div
                v-if="verschiebeMeldung"
                class="felder__meldung"
                role="alert"
                :data-testid="`${kennung}-verschieben-meldung`"
            >
                <strong v-if="verschiebeMeldung.titel" class="felder__meldung-titel">{{
                    verschiebeMeldung.titel
                }}</strong>
                <span>{{ verschiebeMeldung.satz }}</span>
                <AvmKnopf
                    v-if="lage && !lage.ohneRecht"
                    groesse="zeile"
                    :testid="`${kennung}-verschieben-erneut`"
                    @click="lage.verschiebe()"
                >
                    {{ t("ortseditor.verschieben.erneut") }}
                </AvmKnopf>
            </div>
            <p v-if="!ohneLage" class="felder__leise">{{ t("ortseditor.lage.hinweis") }}</p>
        </section>
    </div>
</template>

<style scoped>
.felder {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.felder__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4) var(--space-8);
}

/* Im Entwurf geändert, noch nicht gespeichert. */
.ortsform__name.is-geaendert::after {
    content: " •" / "";
    color: var(--color-warning-soft-text);
}

.felder__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.felder__klein {
    display: block;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.felder__befunde {
    display: grid;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.felder__befunde li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.felder__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-8);
}

/* Ein Konflikt oder eine Ablehnung beim Verschieben: wie der Kasten „Jemand war schneller“ (`ortseditor-konflikt.vue`). */
.felder__meldung {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-warning-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-warning-soft);
    color: var(--color-text-strong);
}

.felder__meldung-titel {
    color: var(--color-warning-soft-text);
    font-weight: normal;
}

.felder__zahl {
    font-variant-numeric: tabular-nums;
}

/* Die Tasten im Hinweis des laufenden Verschiebens (vorher in der Leiste des eingeklappten Fensters). */
.felder__modus kbd {
    padding: 0 var(--space-2);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
    font: inherit;
    font-size: var(--font-size-caption);
}
</style>
