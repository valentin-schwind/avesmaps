<script setup lang="ts">
import { istKategorie, KATEGORIE_FORMEN, svgDrehung } from "./kategorie-zeichen";

/**
 * Die Zeichen der Handlungen, die nur Editoren haben (Betreiber 2026-10-11: „alle optionen in den menüs immer ein icon … (einfarbig wenn
 * nur für die editoren)“; abgenommen am Blatt `review/wi-0128/menue-zeichen-blatt.png`): EIN gezeichneter Satz, 16 × 16, Strich 1,5,
 * runde Enden, in der Schriftfarbe (`currentColor`), wie Lupe, Trichter und Sortierzeichen (Guide §6 „eine Bedienhandlung wird
 * gezeichnet“; §13.42 Nr. 4: ein Satz, keine Mischung aus Unicode-Zeichen und Formen). Kontextmenü, Menü am Objekt und Infopanel-Gruppe
 * tragen sie; gesperrt verblassen sie mit ihrer Zeile. Die Einträge für alle behalten Legacys gemalte Bilder. Die Zeilen des Reiters
 * „Vorkommen“ tragen das Zeichen ihrer Kategorie: Blatt (Flora, das der Ebene „Vegetation“), gefüllte Pfote (Fauna), Korb (Waren), Person (Spezies).
 */
export type EditorZeichenName =
    | "bearbeiten"
    | "ansehen"
    | "verschieben"
    | "verbergen"
    | "zurueckholen"
    | "verlagern"
    | "abnehmen"
    | "loeschen"
    | "hinzufuegen"
    | "neuer-ort"
    | "neue-kreuzung"
    | "neuer-weg"
    | "neues-label"
    | "neue-kraftlinie"
    | "neuer-kraftlinienpunkt"
    | "neue-flaeche"
    | "neuer-gipfel"
    | "zerschneiden"
    | "malen"
    | "radieren"
    | "gebietsform"
    | "kurve-bearbeiten"
    | "vereinfachen"
    | "vereinigen"
    | "ausschneiden"
    | "neu-ausschneiden"
    | "herausloesen"
    | "klick-sperre"
    | "kopieren"
    | "nach-vorn"
    | "nach-hinten"
    | "titelbild"
    | "titelbild-gesetzt"
    | "entfernen"
    | "medien"
    | "konten"
    | "system"
    | "passkey"
    | "abmelden"
    // Die Karteninhalte im Editorpanel (WI-0212, EDIT-0003 T37); Wege und Kraftlinien tragen „neuer-weg“ und „neue-kraftlinie“.
    | "ort"
    | "herrschaft"
    | "landschaft"
    | "literatur"
    | "karten"
    | "vorkommen"
    // Die Kategorien der Vorkommen (WI-0254, WI-0260): Blatt, gefüllte Pfote, Korb, Person.
    | "flora"
    | "fauna"
    | "ware"
    | "spezies"
    | "quellen"
    | "korpora"
    // Der Schalter „Höhenlinien“ der Ebenenleiste (WI-0236).
    | "hoehenlinien"
    | "hoehenlinien-aus"
    // Die Ebenen der Derographie in der Ebenenleiste (WI-0225; Betreiber 2026-10-21: „durch icons ergänzt und vollständig ersetzt“).
    | "ebene-alle"
    | "ebene-regionen"
    | "ebene-vegetation"
    | "ebene-topographie"
    | "ebene-klima"
    // Die Ebene „Sprachen“ (WI-0261 S5a): eine Sprechblase mit zwei Zeilen, wie in der Bauvorlage.
    | "ebene-sprachen"
    // Das Wetter (WI-0288 Stufe 3): die Kachel, ein Preset (Zeitpunkt) und die vier Arten der Icons.
    | "wetter"
    | "zeitpunkt"
    | "wetter-wind"
    | "wetter-wirbel"
    | "wetter-stroemung"
    | "wetter-mahlstrom"
    // Das Meldeformular der Besucher (WI-0279): die Kacheln „Was stimmt nicht?“ und „Was fehlt?“, die Bestätigung.
    | "fadenkreuz"
    | "namensschild"
    | "info"
    | "fehlt"
    | "kreis-punkte"
    | "haken-kreis"
    | "fluss"
    | "insel"
    | "punkte";

defineProps<{ name: EditorZeichenName }>();
</script>

<template>
    <svg
        class="editor-zeichen"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
    >
        <!-- Stift -->
        <path v-if="name === 'bearbeiten'" d="M10.5 2.5l3 3-8 8H2.5v-3zM9 4l3 3" />
        <!-- Auge -->
        <template v-else-if="name === 'ansehen' || name === 'zurueckholen'">
            <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
            <circle cx="8" cy="8" r="2" />
        </template>
        <!-- Auge, durchgestrichen -->
        <template v-else-if="name === 'verbergen'">
            <path
                d="M3.2 5.2C2 6.5 1.5 8 1.5 8s2.4 4.5 6.5 4.5c1.2 0 2.3-.4 3.2-.9M6.3 3.7c.5-.1 1.1-.2 1.7-.2 4.1 0 6.5 4.5 6.5 4.5s-.6 1.2-1.7 2.4"
            />
            <path d="M2 2l12 12" />
        </template>
        <!-- vier Pfeile -->
        <template v-else-if="name === 'verschieben'">
            <path d="M8 1.5v13M1.5 8h13" />
            <path d="M6 3.5l2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2" />
        </template>
        <!-- zwei Pfeile gegeneinander -->
        <path v-else-if="name === 'verlagern'" d="M2 5.5h11M10.5 3l2.5 2.5-2.5 2.5M14 10.5H3M5.5 8L3 10.5 5.5 13" />
        <!-- Nadel mit Minus -->
        <template v-else-if="name === 'abnehmen'">
            <path d="M8 14.5S3 9.6 3 6.3a5 5 0 0 1 10 0c0 3.3-5 8.2-5 8.2z" />
            <path d="M5.8 6.3h4.4" />
        </template>
        <!-- Nadel mit Plus -->
        <template v-else-if="name === 'neuer-ort'">
            <path d="M8 14.5S3 9.6 3 6.3a5 5 0 0 1 10 0c0 3.3-5 8.2-5 8.2z" />
            <path d="M5.8 6.3h4.4M8 4.1v4.4" />
        </template>
        <!-- Eimer -->
        <template v-else-if="name === 'loeschen'">
            <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" />
            <path d="M6.7 6.5v4.5M9.3 6.5v4.5" />
        </template>
        <!-- Plus -->
        <path v-else-if="name === 'hinzufuegen'" d="M8 2.5v11M2.5 8h11" />
        <!-- Pfeil hoch und Pfeil runter: ein Bild in der Folge einer Galerie bewegen (WI-0068 P6) -->
        <path v-else-if="name === 'nach-vorn'" d="M8 13.5V3M3.5 7.5L8 3l4.5 4.5" />
        <path v-else-if="name === 'nach-hinten'" d="M8 2.5V13M3.5 8.5L8 13l4.5-4.5" />
        <!-- Stern: das Titelbild einer Galerie. Gesetzt ist er gefuellt, sonst ein Umriss - ein Zeichen, zwei Zustaende. -->
        <path
            v-else-if="name === 'titelbild' || name === 'titelbild-gesetzt'"
            d="M8 2l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.5 4.3 13.5l.8-4.2L2 6.4l4.2-.5z"
            :fill="name === 'titelbild-gesetzt' ? 'currentColor' : 'none'"
        />
        <!-- Kreuz: aus einer Sammlung nehmen (das Objekt selbst bleibt; Loeschen ist der Papierkorb) -->
        <path v-else-if="name === 'entfernen'" d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
        <!-- Kreuzung: Knoten mit vier Ästen -->
        <template v-else-if="name === 'neue-kreuzung'">
            <circle cx="8" cy="8" r="2" />
            <path d="M8 1.5V6M8 10v4.5M1.5 8H6M10 8h4.5" />
        </template>
        <!-- Weg: geschwungene Linie mit Enden -->
        <template v-else-if="name === 'neuer-weg'">
            <path d="M3 13c2-5 7-1 10-10" />
            <circle cx="3" cy="13" r="1.25" />
            <circle cx="13" cy="3" r="1.25" />
        </template>
        <!-- Beschriftung -->
        <path v-else-if="name === 'neues-label'" d="M3 13.5L7 2.5h2l4 11M4.6 9.5h6.8" />
        <!--
            Strang zwischen zwei Nodices: zwei verdrillte Fäden von Punkt zu Punkt, wie eine Kraftlinie auf der Karte (EDIT-0003 F21, K1;
            Betreiber 2026-10-18: „Wege und Kraftlinien alle wie empfohlen“). Neue Kraftlinie, ihre Leiste, die Kachel und vorerst „Nodix
            anfügen“; ersetzt den Blitz.
        -->
        <template v-else-if="name === 'neue-kraftlinie'">
            <g transform="rotate(-45 8 8)">
                <path d="M1.2 8C2.7 5.6 4.2 5.6 5.73 8S8.77 10.4 10.27 8S13.3 5.6 14.8 8" />
                <path d="M1.2 8C2.7 10.4 4.2 10.4 5.73 8S8.77 5.6 10.27 8S13.3 10.4 14.8 8" />
            </g>
            <circle cx="3.19" cy="12.81" r="1.5" fill="currentColor" />
            <circle cx="12.81" cy="3.19" r="1.5" fill="currentColor" />
        </template>
        <!-- Nodix mit Plus: der Punkt der Karte mit dem Plus des Anlegens (F21, P1; ✦ bleibt allein „Neue Version“) -->
        <template v-else-if="name === 'neuer-kraftlinienpunkt'">
            <circle cx="6.5" cy="6.5" r="4.25" />
            <circle cx="6.5" cy="6.5" r="1.4" fill="currentColor" />
            <path d="M12 9.5v5M9.5 12h5" />
        </template>
        <!-- Die Handgriffe der Fläche (WI-0178 A4, Legacys Flächenmenü): im selben Satz, 16 × 16, Strich 1,5. -->
        <!-- Vieleck mit Plus -->
        <template v-else-if="name === 'neue-flaeche'">
            <path d="M8.5 2.5L2.5 5v6l5 2.5" />
            <path d="M8.5 2.5l5 2.5v2.5" />
            <path d="M12 9.5v5M9.5 12h5" />
        </template>
        <!-- Gipfel mit Plus (WI-0178 P7 „▲ Gipfel setzen …“): das Dreieck der Karte, offen zum Plus, wie die Fläche mit Plus -->
        <template v-else-if="name === 'neuer-gipfel'">
            <path d="M9 7.5L6 2.5L1.5 12.5h6" />
            <path d="M12 9.5v5M9.5 12h5" />
        </template>
        <!-- Schere -->
        <template v-else-if="name === 'zerschneiden'">
            <circle cx="4.5" cy="11.5" r="2" />
            <circle cx="11.5" cy="11.5" r="2" />
            <path d="M6 10l6.5-8.5M10 10L3.5 1.5" />
        </template>
        <!-- Pinsel -->
        <template v-else-if="name === 'malen'">
            <path d="M14 2L8.5 7.5" />
            <path d="M8.5 7.5c-1.5-.8-3.5 0-3.8 1.8-.2 1.5-1 2.4-2.2 2.9 2.2 1.2 5.5.8 6.3-1.4.4-1.2.3-2.4-.3-3.3z" />
        </template>
        <!-- Radiergummi, schräg, über dem Strich, den er nimmt (EDIT-0003 T34 (4): Malen und Radieren getrennt) -->
        <template v-else-if="name === 'radieren'">
            <path d="M9.5 2.5l4 4L7 13H4.5l-2-2z" />
            <path d="M6 6l4 4M8.5 13.5h5" />
        </template>
        <!-- Umriss mit Anfassern an den Ecken: die Gebietsform bearbeiten (F18, der Modus „Ecken bearbeiten“) -->
        <template v-else-if="name === 'gebietsform'">
            <path d="M3 4l8-1.5 2.5 7-6 4L3 10.5z" />
            <circle cx="3" cy="4" r="1.4" fill="currentColor" />
            <circle cx="13.5" cy="9.5" r="1.4" fill="currentColor" />
            <circle cx="7.5" cy="13.5" r="1.4" fill="currentColor" />
        </template>
        <!--
            Linie mit Stützpunkten: das offene Gegenstück zu „Gebietsform“, eine Kurve mit ihren Griffen (F21, W1). „Wegkurve bearbeiten“
            und „Kurve bearbeiten“ der Kraftlinie, in Menüs und Modusleisten.
        -->
        <template v-else-if="name === 'kurve-bearbeiten'">
            <path d="M1.5 11.5C3.5 4.5 6.5 4.5 8 8s4.5 3.5 6.5-3.5" />
            <circle cx="4.94" cy="5.81" r="1.4" fill="currentColor" />
            <circle cx="8" cy="8" r="1.4" fill="currentColor" />
            <circle cx="11.06" cy="10.19" r="1.4" fill="currentColor" />
        </template>
        <!-- Zacken über einer Geraden -->
        <template v-else-if="name === 'vereinfachen'">
            <path d="M1.5 6.5l2.2-3 2.2 3 2.2-3 2.2 3 2.2-3 2 3" />
            <path d="M1.5 12h13" />
        </template>
        <!-- Zwei Flächen als eine -->
        <path v-else-if="name === 'vereinigen'" d="M2 2h7v4h5v8H7v-4H2z" />
        <!-- Fläche, aus der eine andere herausgeschnitten ist -->
        <template v-else-if="name === 'ausschneiden'">
            <path d="M2 2h9v4H6v5H2z" />
            <path d="M8.5 8.5H14V14H8.5z" stroke-dasharray="1.5 2" />
        </template>
        <!-- Gestrichelte Fläche mit Plus -->
        <template v-else-if="name === 'neu-ausschneiden'">
            <path d="M2 2h12v12H2z" stroke-dasharray="1.5 2" />
            <path d="M8 5v6M5 8h6" />
        </template>
        <!-- Fläche, aus der ein Teil herauszeigt -->
        <template v-else-if="name === 'herausloesen'">
            <path d="M9 2.5H2.5v11h11V7" />
            <path d="M8 8l6-6M10.5 2H14v3.5" />
        </template>
        <!-- Kreis, durchgestrichen: für Klicks gesperrt (EDIT-0003 F10: ⊘) -->
        <template v-else-if="name === 'klick-sperre'">
            <circle cx="8" cy="8" r="5.75" />
            <path d="M3.9 12.1l8.2-8.2" />
        </template>
        <!-- Zwei Blätter -->
        <template v-else-if="name === 'kopieren'">
            <rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1" />
            <path d="M3.5 10.5H2V2h8.5v1.5" />
        </template>
        <!-- Bild -->
        <template v-else-if="name === 'medien'">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <circle cx="5.5" cy="6.5" r="1.25" />
            <path d="M14.5 10.5l-3.5-3.5-6.5 6.5" />
        </template>
        <!-- zwei Köpfe -->
        <template v-else-if="name === 'konten'">
            <circle cx="6" cy="5" r="2.25" />
            <path d="M1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
            <path d="M10.5 3a2.25 2.25 0 0 1 0 4.2M12 9.7c1.5.5 2.5 1.8 2.5 3.8" />
        </template>
        <!-- Schieberegler -->
        <template v-else-if="name === 'system'">
            <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
            <circle cx="5.5" cy="4" r="1.4" fill="var(--color-panel, #fff)" />
            <circle cx="10.5" cy="8" r="1.4" fill="var(--color-panel, #fff)" />
            <circle cx="7" cy="12" r="1.4" fill="var(--color-panel, #fff)" />
        </template>
        <!-- Schlüssel -->
        <template v-else-if="name === 'passkey'">
            <circle cx="5" cy="10.5" r="3" />
            <path d="M7.2 8.3L13.5 2M11 4.5l1.5 1.5M12.5 3l1.5 1.5" />
        </template>
        <!-- Die Karteninhalte im Editorpanel (WI-0212): Nadel mit Punkt, Fahne, Landschaft mit Bergen, Buch, gefaltete Karte, drei Fundstellen -->
        <template v-else-if="name === 'ort'">
            <path d="M8 14.5S3 9.6 3 6.3a5 5 0 0 1 10 0c0 3.3-5 8.2-5 8.2z" />
            <circle cx="8" cy="6.3" r="1.6" />
        </template>
        <template v-else-if="name === 'herrschaft'">
            <path d="M3.5 14.5V2" />
            <path d="M3.5 2.5h9l-2 3 2 3h-9" />
        </template>
        <template v-else-if="name === 'landschaft'">
            <path d="M3 4.5L8 2l5 2.5 1 5-4 4.5-6-1.5L2 9z" />
            <path d="M5.5 9.5l1.5-2 1.5 2M8.5 9.5l1.5-2 1.5 2" />
        </template>
        <template v-else-if="name === 'literatur'">
            <path d="M2 3.5c2-.8 4-.8 6 .6 2-1.4 4-1.4 6-.6v9.5c-2-.8-4-.8-6 .6-2-1.4-4-1.4-6-.6z" />
            <path d="M8 4.1v9.5" />
        </template>
        <template v-else-if="name === 'karten'">
            <path d="M2 4l4-1.5 4 1.5 4-1.5v9.5L10 13.5 6 12l-4 1.5z" />
            <path d="M6 2.5V12M10 4v9.5" />
        </template>
        <template v-else-if="name === 'vorkommen'">
            <circle cx="4.5" cy="5" r="1.6" />
            <circle cx="11.5" cy="4" r="1.6" />
            <circle cx="7.5" cy="11.5" r="1.6" />
            <path d="M6 5.4l4-1M5.4 6.4l1.4 3.6M10.8 5.4L8.4 10" />
        </template>
        <!--
            Die Kategorien der Vorkommen (WI-0254, WI-0260): Blatt, gefüllte Pfote, Korb, Person. Die Formen stehen in `kategorie-zeichen.ts`, weil auch die Karte
            sie zeichnet: vor dem Namen eines gewählten Vorkommens (WI-0257 S5).
        -->
        <template v-else-if="istKategorie(name)">
            <path
                v-for="(form, stelle) in KATEGORIE_FORMEN[name]"
                :key="stelle"
                :d="form.d"
                :fill="form.gefuellt ? 'currentColor' : undefined"
                :stroke="form.gefuellt ? 'none' : undefined"
                :transform="svgDrehung(form)"
            />
        </template>
        <!-- Quellen (WI-0254): ein Zitat, zwei Anführungszeichen über einer Zeile; Korpora: zwei gestapelte Blätter mit einer Netzlinie. -->
        <template v-else-if="name === 'quellen'">
            <path d="M3.5 3h9a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
            <path
                d="M5.2 6.8c0-1 .6-1.6 1.4-1.6M8.6 6.8c0-1 .6-1.6 1.4-1.6M5.2 6.8h1.4v1.4H5.2zM8.6 6.8H10v1.4H8.6zM5.2 10.8h5.6"
            />
        </template>
        <template v-else-if="name === 'korpora'">
            <path d="M2.5 5.5l5.5-2.5 5.5 2.5L8 8z" />
            <path d="M2.5 8.5L8 11l5.5-2.5M2.5 11.5L8 14l5.5-2.5" />
        </template>
        <template v-else-if="name === 'hoehenlinien' || name === 'hoehenlinien-aus'">
            <path d="M2.5 9.5c0-3.6 2.6-6.5 6-6.5 2.9 0 5 2.1 5 5 0 3.4-2.6 5.5-5.6 5.5S2.5 12.4 2.5 9.5z" />
            <path d="M5.8 8.9c0-1.6 1.2-2.9 2.7-2.9 1.3 0 2.2.9 2.2 2.2 0 1.5-1.1 2.4-2.5 2.4S5.8 10.2 5.8 8.9z" />
            <path v-if="name === 'hoehenlinien-aus'" d="M2 14L14 2" />
        </template>
        <!-- Die Ebenen der Derographie (WI-0225): gestapelte Ebenen, Umriss mit Namensstrich, Blatt, Kammlinie, Kreis mit Breitenbändern, Sprechblase (WI-0261). -->
        <template v-else-if="name === 'ebene-alle'">
            <path d="M8 2.5l5.5 3-5.5 3-5.5-3z" />
            <path d="M2.5 8.5l5.5 3 5.5-3M2.5 11.5l5.5 3 5.5-3" />
        </template>
        <template v-else-if="name === 'ebene-regionen'">
            <path d="M3 4.5L8 2.5l5 2 .5 5L9 13.5l-6-1.5-.5-5z" />
            <path d="M5.5 8h5" />
        </template>
        <template v-else-if="name === 'ebene-vegetation'">
            <path d="M3 13C3 7 7 3 13 3c0 6-4 10-10 10z" />
            <path d="M3 13l7-7" />
        </template>
        <path v-else-if="name === 'ebene-topographie'" d="M1.5 12.5l4.5-7.5 3 5 1.8-2.8 3.7 5.3" />
        <template v-else-if="name === 'ebene-klima'">
            <circle cx="8" cy="8" r="5.5" />
            <path d="M3 6h10M3 10h10" />
        </template>
        <template v-else-if="name === 'ebene-sprachen'">
            <path d="M2.5 3h11a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1H8.6L5.2 14v-2.8H2.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
            <path d="M4.8 6.1h6.4M4.8 8.4h4" />
        </template>
        <!-- Wolke mit Windstrich: die Kachel „Wetter“ (WI-0288 Stufe 3, Probierseite) -->
        <template v-else-if="name === 'wetter'">
            <path d="M4.6 10.5h7.1a2.5 2.5 0 0 0 .1-5 3.6 3.6 0 0 0-6.9.9 2.1 2.1 0 0 0-.3 4.1z" />
            <path d="M2 13.5h7.5M11.5 13.5H14" />
        </template>
        <!-- Uhr: ein Preset des Wetters ist ein Zeitpunkt (das Zeichen der Sortierung „Kalender“, allein) -->
        <template v-else-if="name === 'zeitpunkt'">
            <circle cx="8" cy="8" r="5.75" />
            <path d="M8 4.75V8l2 1.5" />
        </template>
        <!-- Die Zeichen der Wetter-Icons auf der Karte (`map/wetter/wetter-symbole.ts`), auf 16 px verkleinert -->
        <g v-else-if="name === 'wetter-wind'" transform="translate(8 8) scale(.6667)" stroke-width="1.8">
            <path d="M-9 -4 H3 a3 3 0 1 0 -3 -3 M-9 1 H7 a3 3 0 1 1 -3 3 M-9 6 H-1 a2.5 2.5 0 1 1 -2.5 2.5" />
        </g>
        <g v-else-if="name === 'wetter-wirbel'" transform="translate(8 8) scale(.6667)" stroke-width="1.8">
            <path d="M0 0 a2 2 0 0 1 2 2 a4 4 0 0 1 -4 4 a6 6 0 0 1 -6 -6 a8 8 0 0 1 8 -8 a9 9 0 0 1 9 9" />
        </g>
        <g v-else-if="name === 'wetter-stroemung'" transform="translate(8 8) scale(.6667)" stroke-width="1.8">
            <path d="M-9 -5 q2.5 -3 5 0 t5 0 t5 0 M-9 0 q2.5 -3 5 0 t5 0 t5 0 M-9 5 q2.5 -3 5 0 t5 0 t5 0" />
        </g>
        <g v-else-if="name === 'wetter-mahlstrom'" transform="translate(8 8) scale(.6667)" stroke-width="1.8">
            <path
                d="M0 0 a1 1 0 0 1 1 1 a2 2 0 0 1 -2 2 a3 3 0 0 1 -3 -3 a4 4 0 0 1 4 -4 a5 5 0 0 1 5 5 a6 6 0 0 1 -6 6 a7 7 0 0 1 -7 -7 a8 8 0 0 1 8 -8"
            />
        </g>
        <!-- Fadenkreuz: „Lage falsch“ -->
        <template v-else-if="name === 'fadenkreuz'">
            <circle cx="8" cy="8" r="4.8" />
            <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
        </template>
        <!-- Namensschild: „Name oder Schreibweise falsch“ -->
        <template v-else-if="name === 'namensschild'">
            <path d="M2.5 4h6.2L13.5 8l-4.8 4H2.5z" />
            <circle cx="5.2" cy="8" r=".9" />
        </template>
        <!-- Kreis mit i: „Angabe falsch“ -->
        <template v-else-if="name === 'info'">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 7.3v3.9M8 4.9v.1" />
        </template>
        <!-- Gestrichelter Kreis mit Plus: „Etwas fehlt“ -->
        <template v-else-if="name === 'fehlt'">
            <circle cx="8" cy="8" r="6" stroke-dasharray="2.2 2" />
            <path d="M8 5.4v5.2M5.4 8h5.2" />
        </template>
        <!-- Kreis mit drei Punkten: „Sonstiges“ -->
        <template v-else-if="name === 'kreis-punkte'">
            <circle cx="8" cy="8" r="6" />
            <circle cx="5.3" cy="8" r=".8" fill="currentColor" stroke="none" />
            <circle cx="8" cy="8" r=".8" fill="currentColor" stroke="none" />
            <circle cx="10.7" cy="8" r=".8" fill="currentColor" stroke="none" />
        </template>
        <!-- Haken im Kreis: eingegangen -->
        <template v-else-if="name === 'haken-kreis'">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M5 8.2l2 2 4-4.4" />
        </template>
        <!-- Zwei gewundene Linien: ein Fluss -->
        <template v-else-if="name === 'fluss'">
            <path d="M5 1.5c-2 3 3 4 1 7s-3 4-1 6" />
            <path d="M10.5 1.5c-2 3 3 4 1 7s-3 4-1 6" />
        </template>
        <!-- Insel: ein Hügel über dem Wasser -->
        <template v-else-if="name === 'insel'">
            <path d="M4 10c0-3 1.8-5 4-5s4 2 4 5" />
            <path d="M1.5 13q1.6-1.5 3.2 0t3.2 0 3.2 0 3.2 0" />
        </template>
        <!-- Drei Punkte: „Anderes“ -->
        <template v-else-if="name === 'punkte'">
            <circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none" />
            <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
            <circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none" />
        </template>
        <!-- Tür mit Pfeil -->
        <template v-else>
            <path d="M9.5 2.5h-6v11h6" />
            <path d="M7 8h7.5M12 5.5L14.5 8 12 10.5" />
        </template>
    </svg>
</template>

<style scoped>
.editor-zeichen {
    display: block;
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
}
</style>
