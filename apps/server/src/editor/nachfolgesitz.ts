/**
 * Der Nachfolgesitz einer stillgelegten Stätte (WI-0128 B4) - EIN Ausdruck für Leser und Schreiber.
 *
 * Ändert die Wiki die Ortsangabe eines Sitzes, legt der Zug einen NEUEN Sitz an und legt den alten still: Die Kennung
 * `Organisation U+001F Ortsangabe` ist eine andere, also ist es ein anderes Objekt (Migration 0099). Die Beziehung, die ein
 * Mensch an den alten Sitz gehängt hat, bliebe sonst an einer toten Zeile hängen.
 *
 * 🔴 **Erkannt wird der Nachfolger an der Kennung, nie an einem Namen.** Zwei Sitze derselben Organisation heißen in aller
 * Regel gleich; der Name trägt die Unterscheidung nicht (WI-0134 §3 Regel 2).
 *
 * 🔴 **Genau einer, sonst keiner.** Geraten wird nie: Ein falsch umgehängter Sitz sieht hinterher aus wie die Entscheidung
 * eines Menschen und wird von keinem Zug mehr korrigiert. Gibt es mehrere Anwärter, bleibt dem Menschen „Lösen“ und das
 * Binden des richtigen Sitzes von Hand.
 *
 * 🪤 **Gemessen am 2026-10-13:** 1.856 aktive Sitze verteilen sich auf 1.038 Organisationen, davon tragen **233 mehr als
 * einen** Sitz. Ohne weitere Bedingung bliebe das Umhängen dort immer stumm. Darum fällt ein Anwärter weg, der bereits an
 * einem ANDEREN Ort hängt: Der hat seinen Platz schon, er ist nicht der Nachfolger dieser Zeile. Übrig bleiben die Sitze
 * ohne Ort und der, der schon hier liegt.
 *
 * 🪤 Heute gibt es **0** stillgelegte Stätten mit hängender Beziehung (gemessen). Das hier ist Vorsorge, kein Rückstand: Der
 * erste Zug, der eine Ortsangabe ändert, erzeugt den Fall, und dann darf die Zeile nicht still verschwinden.
 *
 * @param alt Alias der stillgelegten Zeile (`site`) im umgebenden Ausdruck.
 * @param ort SQL-Ausdruck für die `place.id`, an der ihre Beziehung hängt.
 */
export const nachfolgerSql = (alt: string, ort: string): string => `
    SELECT count(*) AS treffer,
           (array_agg(k.id ORDER BY k.id))[1] AS id,
           (array_agg(k.name ORDER BY k.id))[1] AS name,
           (array_agg(k.raw_location ORDER BY k.id))[1] AS raw_location
      FROM site k
      LEFT JOIN site_settlement kss ON kss.site_id = k.id AND kss.is_active AND kss.place_id IS NOT NULL
     WHERE NOT ${alt}.is_active AND ${alt}.source_kind = 'sitz'
       AND k.is_active AND k.source_kind = 'sitz' AND k.id <> ${alt}.id
       AND split_part(k.source_key, chr(31), 1) = split_part(${alt}.source_key, chr(31), 1)
       AND (kss.place_id IS NULL OR kss.place_id = ${ort})
`;
