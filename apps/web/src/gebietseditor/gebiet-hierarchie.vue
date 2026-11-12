<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { EditorTerritoryHierarchy } from "@avesmaps3d/shared";
import { formatNumber, t } from "../i18n/i18n";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import Zoomspanne from "../fenster/zoomspanne.vue";
import ZoomspanneKopf from "../fenster/zoomspanne-kopf.vue";
import GebietFarbfeld from "./gebiet-farbfeld.vue";
import { artName } from "./gebiete-liste";
import { abweichungVorgabe } from "./farben";
import { hierarchieVon, mitEntwurf, traegtWurzel, type HierarchieZeile, type Stufe } from "./hierarchie";
import GebietSpannenFolgen from "./gebiet-spannen-folgen.vue";
import {
    farbenAusHierarchie,
    mitgezogen,
    mitgezogeneSpannen,
    spanneVon,
    type BandAenderung,
    type FarbAenderung,
    type Zoombaender,
} from "./zoombaender";

/**
 * Der Reiter „Hierarchie“ des Gebietseditors, lesend (WI-0209 A3; EDIT-0005 §3; EDIT-0003 T23; Blatt „Herrschaftsgebiete“): der Baum ab
 * dem gewählten Gebiet, die Bänder 0 bis 8 als Spalten. Je Zeile die Farbe, und je Band, ob die Karte das Gebiet zeigt (dunkel), ob eine
 * engere Spanne es verdeckt (hell) oder ob es außerhalb liegt; dazu ∅ (Lücke) und ∩ (Überlappung) als Hinweise. Gerechnet in
 * `hierarchie.ts` mit derselben Regel wie der Nachweis N2.
 *
 * - Ein Klick auf einen Namen wählt das Gebiet; der Reiter rechnet dann ab ihm. Ein Klick auf eine Bandspalte zeigt das Band auf der
 *   Karte (`band`).
 * - **Zoombänder bearbeiten** (D2): Anfasser links und rechts an der Spanne (ziehen, oder ←/→ am Anfasser), ⇉ übernimmt die Spanne für
 *   alle Geschwister; gepunktet die Vorgabe nach Tiefe. Kopf und Spanne sind die gemeinsamen Bauteile `fenster/zoomspanne-kopf.vue` und
 *   `fenster/zoomspanne.vue` (EDIT-0003 T27 Regel 7, 2026-10-18); ⇉ bleibt hier am Zeilenende. Die erste Änderung beginnt den Modus (`zoombaender.ts`, Leiste über der Karte);
 *   im Modus rechnet der Reiter ab dessen Wurzel, mit dem Entwurf darüber (`mitEntwurf`). Lücken und Überlappungen sperren nie.
 * - **Farben** (D4, H2; Probierblatt `hg-farben.js`): Das Farbfeld jeder Zeile öffnet die Farbwahl; die Untergebiete ziehen mit derselben
 *   Verschiebung mit („Untergebiete ziehen mit“, abwählbar). „Farbhierarchie erstellen“ leitet alle Untergebiete der Wurzel nach Legacys
 *   Verfahren ab, je Ebene mit einer Abweichung von 0 bis 256 (Vorgabe zufällig aus Legacys Bereichen); noch einmal heißt neu würfeln.
 *   Alles geht in denselben Entwurf wie die Zoombänder: ↶ ↷, und „Fertig“ schreibt EINE Operation.
 * - **Untergebiete ziehen mit** (T51; Editor-Orchestrierung 2026-10-19 zum Betreiberwort „ein Haken für Farbe und Zoomspanne“): derselbe
 *   Haken wie in den Eigenschaften; an zieht ein Anfasser die Spannen aller Untergebiete der Zeile um die Bänder des oberen Endes mit
 *   (`mitgezogeneSpannen`), und unter dem Haken steht vor „Fertig“, was sich wie verschiebt. ⇉ setzt nur die Geschwister.
 */
const props = defineProps<{
    hierarchie: EditorTerritoryHierarchy | undefined;
    fehler: string | undefined;
    /** Das gewählte Gebiet, die Wurzel des Reiters. */
    wurzel: string;
    jahr: number;
    kennung: string;
    /** Der Modus „Zoombänder bearbeiten“ (D2); ohne ihn lesend. */
    baender?: Zoombaender | undefined;
    /** Warum gerade nicht geändert werden kann; leer ohne Satz, fehlend: es geht. */
    grund?: string | undefined;
}>();
const emit = defineEmits<{
    waehle: [id: string];
    band: [band: number];
    /** „Untergebiete ziehen mit“: Umgestellt wird beim Besitzer der Bänder, nicht am Prop. */
    mitziehen: [an: boolean];
}>();

const lauf = computed(() => props.baender?.laufend.value);
/** Im Modus rechnet der Reiter ab dessen Wurzel, mit dessen Daten vom Start und dem Entwurf darüber. */
const quelle = computed(() => lauf.value?.daten ?? props.hierarchie);
const wurzel = computed(() => lauf.value?.wurzel ?? props.wurzel);
const stand = computed(() => {
    const daten = quelle.value;
    if (daten === undefined || !traegtWurzel(daten, wurzel.value)) return undefined;
    return hierarchieVon(mitEntwurf(daten, props.baender?.stand.value ?? new Map()), wurzel.value);
});
const spalten = computed(() => Array.from({ length: stand.value?.zeilen[0]?.stufen.length ?? 9 }, (_, b) => b));

// Aufgeklappt ist das gewählte Gebiet; „Alle aufklappen“ zeigt den ganzen Baum.
const auf = ref(new Set<string>());
const alle = ref(false);
watch(
    wurzel,
    (jetzt) => {
        auf.value = new Set([jetzt]);
        alle.value = false;
    },
    { immediate: true },
);
function klappe(id: string): void {
    const neu = new Set(auf.value);
    if (neu.has(id)) neu.delete(id);
    else neu.add(id);
    auf.value = neu;
    alle.value = false;
}
const offen = (id: string): boolean => alle.value || auf.value.has(id);
function alleSchalten(): void {
    alle.value = !alle.value;
    if (!alle.value) auf.value = new Set([wurzel.value]);
}
/** Die Zeilen, deren Vorfahren im Reiter alle aufgeklappt sind (die Zeilen stehen in der Folge des Baums). */
const sichtbar = computed(() => {
    const aus: HierarchieZeile[] = [];
    let zuAb: number | undefined;
    for (const zeile of stand.value?.zeilen ?? []) {
        if (zuAb !== undefined && zeile.tiefe > zuAb) continue;
        zuAb = undefined;
        aus.push(zeile);
        if (zeile.kinder.length > 0 && !offen(zeile.id)) zuAb = zeile.tiefe;
    }
    return aus;
});

// Kopf: wovon der Reiter ausgeht, und die Wege nach oben.
const nachId = computed(() => new Map((quelle.value?.territories ?? []).map((g) => [g.id, g])));
const wurzelGebiet = computed(() => nachId.value.get(wurzel.value));
const obergebiet = computed(() => {
    const p = wurzelGebiet.value?.parent;
    return p === undefined ? undefined : nachId.value.get(p);
});
const reich = computed(() => {
    let oben = obergebiet.value;
    const gesehen = new Set<string>();
    while (oben?.parent !== undefined && !gesehen.has(oben.id)) {
        gesehen.add(oben.id);
        const weiter = nachId.value.get(oben.parent);
        if (weiter === undefined) break;
        oben = weiter;
    }
    return oben;
});
const kopf = computed(() => {
    const n = formatNumber(stand.value?.zeilen.length ?? 0, 0);
    return obergebiet.value === undefined
        ? t("gebietseditor.hierarchie.reich", { n })
        : t("gebietseditor.hierarchie.ab", { name: wurzelGebiet.value?.name ?? "", n });
});

const stufenText = (zeile: HierarchieZeile, stufe: Stufe, band: number): string =>
    stufe === "gezeigt"
        ? t("gebietseditor.hierarchie.gezeigt", { band, name: zeile.name })
        : stufe === "verdeckt"
          ? t("gebietseditor.hierarchie.verdeckt", { band })
          : t("gebietseditor.hierarchie.aus", { band });
const lueckeText = (zeile: HierarchieZeile): string =>
    t("gebietseditor.hierarchie.luecke", { baender: zeile.luecken.join(", ") });
const ueberText = (zeile: HierarchieZeile): string =>
    t("gebietseditor.hierarchie.ueber", {
        liste: zeile.ueber
            .map((u) =>
                t(u.richtung === "oben" ? "gebietseditor.hierarchie.oben" : "gebietseditor.hierarchie.unten", {
                    name: u.name,
                    von: u.von,
                    bis: u.bis,
                }),
            )
            .join(", "),
    });
const zeilenTitel = (zeile: HierarchieZeile): string =>
    [
        zeile.name,
        artName(zeile.art),
        t("gebietseditor.unter.spanne", { von: zeile.min ?? 0, bis: zeile.max ?? 8 }),
        t("gebietseditor.baender.vorgabe", { von: zeile.vorgabe.min, bis: zeile.vorgabe.max }),
        ...(zeile.imJahr ? [] : [t("gebietseditor.jahr.giltNicht", { jahr: props.jahr })]),
    ].join(" · ");

// --- Zoombänder bearbeiten (D2): die Spanne je Zeile (`fenster/zoomspanne.vue`), ⇉ ---
/** Darf diese Zeile ihre Spanne ändern? Nur mit Modus, ohne Grund dagegen, nicht beim Speichern, nur Gebiete mit Revision. */
const darf = (zeile: HierarchieZeile): boolean =>
    props.baender !== undefined &&
    props.grund === undefined &&
    lauf.value?.phase !== "speichert" &&
    zeile.revision !== undefined;
function aendere(liste: BandAenderung[]): void {
    const daten = quelle.value;
    if (daten === undefined || props.baender === undefined || liste.length === 0) return;
    void props.baender.aendere(daten, wurzel.value, liste);
}
/** Ein Anfasser: die Spanne dieser Zeile, mit dem Haken die Untergebiete mit (T51). */
const zuletzt = ref<string | undefined>(undefined);
function spanneAendern(zeile: HierarchieZeile, spanne: { von: number | undefined; bis: number | undefined }): void {
    const daten = quelle.value;
    if (daten === undefined || props.baender === undefined) return;
    zuletzt.value = zeile.id;
    aendere(
        mitgezogeneSpannen(
            daten,
            props.baender.stand.value,
            zeile.id,
            { min: spanne.von, max: spanne.bis },
            props.baender.mitziehen.value,
        ),
    );
}
/** Was die zuletzt gezogene Spanne an ihren Untergebieten tut, vor „Fertig“. */
const folgen = computed(() =>
    zuletzt.value === undefined || props.baender === undefined ? [] : props.baender.spannenFolgen(zuletzt.value),
);
const zuletztSpanne = computed(() =>
    zuletzt.value === undefined || quelle.value === undefined || props.baender === undefined
        ? { min: undefined, max: undefined }
        : spanneVon(quelle.value, props.baender.stand.value, zuletzt.value),
);
/** ⇉: die Spanne dieser Zeile für alle Geschwister im Reiter. */
const geschwister = (zeile: HierarchieZeile): void =>
    aendere(zeile.geschwister.map((id) => ({ id, min: zeile.min, max: zeile.max })));
const spanneText = (zeile: HierarchieZeile): string => `${String(zeile.min ?? "–")}–${String(zeile.max ?? "–")}`;

// --- Farben (D4, H2): das Farbfeld je Zeile, Mitziehen, „Farbhierarchie erstellen“ ---
const abweichung = ref(abweichungVorgabe());
/** Die Ebene der Wurzel im Baum (das Reich ist 1) und die tiefste darunter; nur Ebenen mit Kindern streuen. */
const basis = computed(() => (quelle.value?.territories.filter((g) => g.above === true).length ?? 0) + 1);
const tiefste = computed(() => basis.value + Math.max(0, ...(stand.value?.zeilen.map((z) => z.tiefe) ?? [0])));
const ebeneFrei = (ebene: number): boolean => ebene >= basis.value && ebene < tiefste.value;
const farbenGesperrt = computed(() =>
    props.baender === undefined || props.grund !== undefined
        ? (props.grund ?? "")
        : lauf.value?.phase === "speichert"
          ? t("landschaftseditor.ecken.speichert")
          : undefined,
);
function faerbe(liste: FarbAenderung[]): void {
    const daten = quelle.value;
    if (daten === undefined || props.baender === undefined || liste.length === 0) return;
    void props.baender.faerbe(daten, wurzel.value, liste);
}
function farbeWaehlen(zeile: HierarchieZeile, farbe: string): void {
    const daten = quelle.value;
    if (daten === undefined || props.baender === undefined || !darf(zeile)) return;
    faerbe(mitgezogen(daten, props.baender.stand.value, zeile.id, farbe, props.baender.mitziehen.value));
}
function setzeAbweichung(index: number, text: string): void {
    const zahl = Math.max(0, Math.min(256, Math.round(Number(text.replace(",", ".")) || 0)));
    abweichung.value = abweichung.value.map((a, i) => (i === index ? zahl : a));
}
function farbhierarchieErstellen(): void {
    const daten = quelle.value;
    if (daten === undefined || props.baender === undefined || farbenGesperrt.value !== undefined) return;
    // Jeder Druck würfelt neu (Legacys `colorShuffleSeed`).
    const seed = Math.floor(Math.random() * 1_000_000_000) + 1;
    faerbe(farbenAusHierarchie(daten, props.baender.stand.value, wurzel.value, abweichung.value, seed));
}
const griffName = (zeile: HierarchieZeile, seite: "von" | "bis"): string =>
    t(seite === "von" ? "gebietseditor.baender.von" : "gebietseditor.baender.bis", { name: zeile.name });
</script>

<template>
    <section class="hier" :data-testid="`${kennung}-hierarchie-kasten`">
        <h4 class="hier__titel">{{ t("gebietseditor.hierarchie.titel") }}</h4>
        <p v-if="fehler" class="hier__leer">{{ fehler }}</p>
        <p v-else-if="!stand" class="hier__leer">{{ t("gebietseditor.hierarchie.laedt") }}</p>
        <template v-else>
            <div class="hier__nav">
                <span :data-testid="`${kennung}-hierarchie-kopf`">{{ kopf }}</span>
                <button
                    v-if="obergebiet && !lauf"
                    type="button"
                    class="hier__verweis"
                    :title="obergebiet.name"
                    @click="emit('waehle', obergebiet.id)"
                >
                    {{ t("gebietseditor.hierarchie.obergebiet") }}
                </button>
                <button
                    v-if="!lauf && reich && reich.id !== obergebiet?.id"
                    type="button"
                    class="hier__verweis"
                    :title="reich.name"
                    @click="emit('waehle', reich.id)"
                >
                    {{ t("gebietseditor.hierarchie.zumReich") }}
                </button>
                <button
                    v-if="stand.zeilen.length > 1"
                    type="button"
                    class="hier__verweis"
                    :data-testid="`${kennung}-hierarchie-alle`"
                    @click="alleSchalten"
                >
                    {{ alle ? t("gebietseditor.hierarchie.alleZu") : t("gebietseditor.hierarchie.alleAuf") }}
                </button>
            </div>
            <p v-if="!stand.abgeleitet" class="hier__leer">{{ t("gebietseditor.hierarchie.nichtAbgeleitet") }}</p>
            <p v-if="baender && grund" class="hier__leer" :data-testid="`${kennung}-hierarchie-grund`">{{ grund }}</p>
            <div
                v-if="baender && grund === undefined && stand.zeilen.length > 1"
                class="hier__farben"
                :data-testid="`${kennung}-hierarchie-farben`"
            >
                <AvmKaestchen
                    art="checkbox"
                    :checked="baender.mitziehen.value"
                    :hinweis="t('gebietseditor.darstellung.mitziehenHinweis')"
                    :testid="`${kennung}-hierarchie-mitziehen`"
                    @change="(an: boolean) => emit('mitziehen', an)"
                >
                    {{ t("gebietseditor.farben.mitziehen") }}
                </AvmKaestchen>
                <span class="hier__abw-titel">{{ t("gebietseditor.farben.abweichung") }}</span>
                <span class="hier__abw-reihe">
                    <label v-for="(wert, i) in abweichung" :key="i" class="hier__abw">
                        <span class="hier__abw-ebene">{{ i + 1 }}</span>
                        <AvmEingabe
                            class="hier__abw-feld"
                            :model-value="String(wert)"
                            inputmode="numeric"
                            :gesperrt="ebeneFrei(i + 1) ? farbenGesperrt : ''"
                            :aria-label="t('gebietseditor.farben.abweichungEbene', { ebene: i + 1 })"
                            :testid="`${kennung}-hierarchie-abweichung-${i + 1}`"
                            @change="(e: Event) => setzeAbweichung(i, (e.target as HTMLInputElement).value)"
                        />
                    </label>
                </span>
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="farbenGesperrt"
                    :title="t('gebietseditor.farben.erstellenHinweis', { name: wurzelGebiet?.name ?? '' })"
                    :testid="`${kennung}-hierarchie-farbhierarchie`"
                    @click="farbhierarchieErstellen"
                >
                    {{ t("gebietseditor.farben.erstellen") }}
                </AvmKnopf>
            </div>
            <GebietSpannenFolgen
                v-if="baender && grund === undefined"
                :folgen="folgen"
                :spanne="zuletztSpanne"
                :testid="`${kennung}-hierarchie-spanne-folgen`"
            />
            <div class="hier__kopf">
                <span class="hier__band">{{ t("gebietseditor.hierarchie.band") }}</span>
                <ZoomspanneKopf
                    :oben="spalten.length - 1"
                    :leise="(b: number) => b > stand!.kartenBand"
                    :titel="
                        (b: number) =>
                            b > stand!.kartenBand
                                ? t('gebietseditor.hierarchie.zeigtBand', { band: stand!.kartenBand })
                                : t('gebietseditor.hierarchie.bandZeigen', { band: b })
                    "
                    :beschriftung="t('gebietseditor.hierarchie.baender', { bis: spalten.length - 1 })"
                    @band="(b: number) => emit('band', b)"
                />
            </div>
            <ul class="hier__zeilen" role="tree" :aria-label="kopf" :data-testid="`${kennung}-hierarchie-zeilen`">
                <li
                    v-for="zeile in sichtbar"
                    :key="zeile.id"
                    class="hier__zeile"
                    :class="{
                        'hier__zeile--gewaehlt': zeile.id === wurzel,
                        'hier__zeile--aus': !zeile.imJahr,
                        'hier__zeile--geaendert': baender?.stand.value.has(zeile.id),
                    }"
                    role="treeitem"
                    :aria-level="zeile.tiefe + 1"
                    :aria-expanded="zeile.kinder.length > 0 ? offen(zeile.id) : undefined"
                    :style="{ '--tiefe': zeile.tiefe }"
                    :data-hier="zeile.id"
                    data-testid="hierarchie-zeile"
                >
                    <button
                        v-if="zeile.kinder.length > 0"
                        type="button"
                        class="hier__klapp"
                        tabindex="-1"
                        :aria-expanded="offen(zeile.id)"
                        :aria-label="
                            t(
                                offen(zeile.id)
                                    ? 'gebietseditor.hierarchie.zuklappen'
                                    : 'gebietseditor.hierarchie.aufklappen',
                                {
                                    name: zeile.name,
                                },
                            )
                        "
                        @click="klappe(zeile.id)"
                    >
                        <span :class="{ 'hier__pfeil--auf': offen(zeile.id) }" class="hier__pfeil" aria-hidden="true"
                            >›</span
                        >
                    </button>
                    <span v-else class="hier__klapp"></span>
                    <span class="hier__name">
                        <GebietFarbfeld
                            :farbe="zeile.farbe"
                            klein
                            :wahl="darf(zeile) ? t('gebietseditor.farben.aendern', { name: zeile.name }) : undefined"
                            testid="hierarchie-farbe"
                            @farbe="(farbe: string) => farbeWaehlen(zeile, farbe)"
                        />
                        <button
                            type="button"
                            class="hier__wahl"
                            :title="zeilenTitel(zeile)"
                            @click="emit('waehle', zeile.id)"
                        >
                            <span class="hier__text einzeilig">{{ zeile.name }}</span>
                        </button>
                    </span>
                    <span class="hier__befund">
                        <span v-if="zeile.luecken.length > 0" class="hier__luecke" :title="lueckeText(zeile)">∅</span>
                        <span v-if="zeile.ueber.length > 0" class="hier__ueber" :title="ueberText(zeile)">∩</span>
                    </span>
                    <button
                        v-if="darf(zeile) && zeile.geschwister.length > 0"
                        type="button"
                        class="hier__geschw"
                        :title="t('gebietseditor.baender.geschwister', { spanne: spanneText(zeile) })"
                        :aria-label="t('gebietseditor.baender.geschwisterFuer', { name: zeile.name })"
                        data-testid="hierarchie-geschwister"
                        @click="geschwister(zeile)"
                    >
                        ⇉
                    </button>
                    <span v-else></span>
                    <Zoomspanne
                        :von="zeile.min"
                        :bis="zeile.max"
                        :oben="spalten.length - 1"
                        :vorgabe="{ von: zeile.vorgabe.min, bis: zeile.vorgabe.max }"
                        :stufen="zeile.stufen"
                        :zell-titel="(b: number) => stufenText(zeile, zeile.stufen[b]!, b)"
                        :gesperrt="darf(zeile) ? undefined : ''"
                        :name="zeile.name"
                        :griff-name="(seite: 'von' | 'bis') => griffName(zeile, seite)"
                        testid="hierarchie"
                        @aendere="
                            (spanne: { von: number | undefined; bis: number | undefined }) =>
                                spanneAendern(zeile, spanne)
                        "
                    />
                </li>
            </ul>
            <p class="hier__legende">
                <span class="hier__zelle hier__zelle--muster" data-stufe="gezeigt"></span>
                {{ t("gebietseditor.hierarchie.legende.gezeigt") }}
                <span class="hier__zelle hier__zelle--muster" data-stufe="verdeckt"></span>
                {{ t("gebietseditor.hierarchie.legende.verdeckt") }}
                <span class="hier__zelle hier__zelle--muster hier__zelle--vorgabe" data-stufe="aus"></span>
                {{ t("gebietseditor.hierarchie.legende.vorgabe") }} ·
                {{ t("gebietseditor.hierarchie.legende.rest") }}
                <template v-if="baender && grund === undefined">
                    · {{ t("gebietseditor.baender.legende") }} · {{ t("gebietseditor.farben.legende") }}</template
                >
            </p>
        </template>
    </section>
</template>

<style scoped>
.hier__farben {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8) var(--space-12);
}

.hier__abw-titel {
    color: var(--color-text-muted);
}

.hier__abw-reihe {
    display: inline-flex;
    gap: var(--space-4);
}

.hier__abw {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-muted);
}

.hier__abw-feld {
    width: 48px;
}

.hier {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.hier__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.hier__leer,
.hier__legende {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.hier__nav {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-8);
    align-items: baseline;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Name links, die Bänder rechts in einer festen Breite: neun Spalten untereinander in jeder Zeile. */
.hier__kopf,
.hier__zeile {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) 28px 16px minmax(126px, 0.45fr);
    gap: 0 var(--space-2);
    align-items: center;
}

.hier__kopf {
    position: sticky;
    top: 0;
    z-index: 1;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-panel);
}

.hier__band {
    grid-column: 1 / 5;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.hier__zeilen {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
}

.hier__zeile {
    padding: 2px 0;
    border-bottom: 1px solid var(--color-border);
}

/* Nur der Hintergrund, kein Balken (Betreiber 2026-10-16). */
.hier__zeile--gewaehlt {
    background: var(--color-active-wash);
}

.hier__zeile--aus .hier__wahl {
    color: var(--color-text-muted);
}

/* Im Entwurf geändert: der Name kräftiger, kein Randbalken (Hausregel). */
.hier__zeile--geaendert .hier__wahl {
    color: var(--color-text-strong);
    font-weight: 600;
}

.hier__klapp {
    display: grid;
    place-items: center;
    width: 16px;
    height: 20px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
}

.hier__klapp:hover {
    color: var(--color-text-strong);
}

.hier__pfeil {
    display: inline-block;
    transition: transform 120ms ease;
}

.hier__pfeil--auf {
    transform: rotate(90deg);
}

.hier__name {
    display: flex;
    gap: var(--space-4);
    align-items: center;
    min-width: 0;
    padding-left: calc(var(--tiefe, 0) * 8px);
}

.hier__wahl {
    display: flex;
    min-width: 0;
    padding: 2px 0;
    border: 0;
    background: none;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    text-align: left;
}

.hier__text {
    display: block;
    min-width: 0;
}

.hier__wahl:hover {
    color: var(--color-text-strong);
    text-decoration: underline;
}

.hier__wahl:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.hier__befund {
    display: flex;
    gap: 2px;
    justify-content: center;
    cursor: help;
}

.hier__luecke {
    color: var(--color-danger);
}

.hier__ueber {
    color: var(--color-warning);
}

.hier__zelle {
    height: 12px;
    border-radius: 2px;
}

/* Wie das Blatt: gezeigt dunkel, verdeckt schraffiert hell, außerhalb leer. */
.hier__zelle[data-stufe="gezeigt"] {
    background: color-mix(in srgb, var(--color-accent-strong) 55%, transparent);
}

.hier__zelle[data-stufe="verdeckt"] {
    background: repeating-linear-gradient(
        135deg,
        color-mix(in srgb, var(--color-text-muted) 35%, transparent) 0 2px,
        transparent 2px 5px
    );
}

.hier__zelle[data-stufe="aus"] {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-text-muted) 18%, transparent);
}

/* Die Vorgabe nach Tiefe: gepunktet umrandet (D2, T23 Frage 7). */
.hier__zelle--vorgabe {
    outline: 1px dotted color-mix(in srgb, var(--color-text-muted) 70%, transparent);
    outline-offset: -1px;
}

.hier__zelle--muster {
    display: inline-block;
    width: 12px;
    height: 10px;
    vertical-align: -1px;
}

.hier__geschw {
    display: grid;
    place-items: center;
    width: 16px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
}

.hier__geschw:hover {
    color: var(--color-link-hover);
}

.hier__geschw:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.hier__verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
}

.hier__verweis:hover {
    color: var(--color-link-hover);
}

.hier__verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
