# Wiki-Linkziele und Wiki-Zuordnung (X1 / X2) -- Exporte fuer Avesmaps3D

Zwei lesende Endpunkte, gebaut am 05.10.2026 im Auftrag von Avesmaps3D. Ziel: jedes Kartenobjekt, das in einem
Wiki-Feld **genannt** wird, ueber seinen **Wiki-Key** verlinken -- nie ueber den Namen (Owner-Entscheid 08.09.2026
„Zuweisung im Wiki gewinnt", `docs/abenteuer-feature-design.md` §5).

| Export | Endpunkt | Inhalt |
|---|---|---|
| X1 | `GET /api/app/wiki-linkziele-export.php` | je Objekt und Wiki-Feld die Links `{anzeige, ziel, ziel_key, ns}` |
| X2 | `GET /api/app/wiki-zuordnung-export.php` | je zugewiesenem Objekt der kanonische `wiki_key` (`wiki_key -> public_id`) |

Vertrag, Felder und Fallen: `api/README.md` (Abschnitt „wiki link targets"), Bibliothek
`api/_internal/app/wiki-linkziele-export.php`, Zerlegung `api/_internal/wiki/link-ziele.php`, Test
`api/_internal/app/__tests__/wiki-linkziele-export-test.php`.

## Beispielantworten (Stand: Datenbank-Dump vom 08.09.2026, Dump-Lauf 155 -- NICHT der Livebestand)

Gekuerzt (drei Links je Feld, vier Felder je Objekt). Die Zaehler im Kopf sind die des vollen Dumps.

### X1 -- Kopf

```json
{
  "objekte_je_art": {
    "siedlung": {
      "mit_zuweisung": 2043,
      "mit_wikitext": 2002,
      "ohne_wikitext": 41
    },
    "weg": {
      "mit_zuweisung": 1964,
      "mit_wikitext": 1964,
      "ohne_wikitext": 0
    },
    "region": {
      "mit_zuweisung": 655,
      "mit_wikitext": 652,
      "ohne_wikitext": 3
    },
    "kraftlinie": {
      "mit_zuweisung": 82,
      "mit_wikitext": 82,
      "ohne_wikitext": 0
    },
    "landschaft": {
      "mit_zuweisung": 516,
      "mit_wikitext": 513,
      "ohne_wikitext": 3
    }
  },
  "artikel": {
    "mit_wikitext": 3057,
    "felder_befuellt": 18677,
    "felder_mit_link": 16480,
    "links_gesamt": 25737,
    "links_pipe": 2622,
    "ziele_verschieden": 4317,
    "ziele_mit_kartenobjekt": 2976,
    "ziele_ohne_kartenobjekt": 1341
  },
  "haeufigste_ziele_ohne_kartenobjekt": [
    {
      "ziel_key": "wiki:nordaventurien",
      "ziel": "Nordaventurien",
      "links": 112
    },
    {
      "ziel_key": "wiki:kosch-region",
      "ziel": "Kosch (Region)",
      "links": 82
    },
    {
      "ziel_key": "wiki:mittelaventurien",
      "ziel": "Mittelaventurien",
      "links": 46
    }
  ],
  "vorlagen_in_feldern": {
    "Pol": 873,
    "Reichsstadt": 25,
    "Reg": 18,
    "pol": 8
  },
  "seiten_schluesselkollision": 0
}
```

### X1 -- Gareth (Siedlung)

```json
{
  "public_id": "80558060-4299-54aa-b520-814b10819885",
  "art": "siedlung",
  "wiki_key": "wiki:gareth",
  "ns": 0,
  "ns_name": "",
  "seite_art": "settlement",
  "seite_titel": "Gareth",
  "felder": {
    "staat": [
      {
        "anzeige": "Reichsstadt",
        "ziel": "Reichsstadt",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:reichsstadt"
      },
      {
        "anzeige": "Alt-Gareth",
        "ziel": "Alt-Gareth",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:alt-gareth"
      }
    ],
    "oberhaupt": [
      {
        "anzeige": "Kaiser",
        "ziel": "Kaiser",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:kaiser"
      },
      {
        "anzeige": "Rohaja von Gareth",
        "ziel": "Rohaja von Gareth",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:rohaja-von-gareth"
      },
      {
        "anzeige": "Thorn Eisinger",
        "ziel": "Thorn Eisinger",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:thorn-eisinger"
      }
    ],
    "verkehrswege": [
      {
        "anzeige": "Reichsstraßen 2",
        "ziel": "Reichsstraße 2",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:reichsstrasse-2"
      },
      {
        "anzeige": "3",
        "ziel": "Reichsstraße 3",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:reichsstrasse-3"
      },
      {
        "anzeige": "Gardel",
        "ziel": "Gardel",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:gardel"
      }
    ],
    "nachbar_n": [
      {
        "anzeige": "Natzungen",
        "ziel": "Natzungen",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:natzungen"
      }
    ]
  }
}
```

`verkehrswege` zeigt den Fall aus dem Auftrag: „Reichsstraßen 2" -> `Reichsstraße 2`, „3" -> `Reichsstraße 3`,
„Gardel" -> `Gardel`, jeweils mit eigenem `ziel_key`.

### X1 -- Reichsstraße 2 (Weg; 56 Abschnitte teilen diese Seite, jeder traegt denselben Eintrag)

```json
{
  "public_id": "c3b931c5-4a21-51e8-8bf7-076676cfecc5",
  "art": "weg",
  "wiki_key": "wiki:reichsstrasse-2",
  "ns": 0,
  "ns_name": "",
  "seite_art": "path",
  "seite_titel": "Reichsstraße 2",
  "felder": {
    "lage": [
      {
        "anzeige": "Weiden",
        "ziel": "Weiden",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:weiden"
      },
      {
        "anzeige": "Darpatien",
        "ziel": "Darpatien",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:darpatien"
      },
      {
        "anzeige": "Garetien",
        "ziel": "Herz des Kontinents",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:herz-des-kontinents"
      }
    ],
    "verlauf": [
      {
        "anzeige": "Seeweg",
        "ziel": "Seeweg",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:seeweg"
      },
      {
        "anzeige": "Trallop",
        "ziel": "Trallop",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:trallop"
      },
      {
        "anzeige": "Alte Straße",
        "ziel": "Alte Straße",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:alte-strasse"
      }
    ]
  }
}
```

### X1 -- Schwarzkuppen (Landschaft)

```json
{
  "public_id": "0b849c2b-9ac0-4eeb-86c0-62c1ce2c1543",
  "art": "region",
  "wiki_key": "wiki:schwarzkuppen",
  "ns": 0,
  "ns_name": "",
  "seite_art": "region",
  "seite_titel": "Schwarzkuppen",
  "felder": {
    "region": [
      {
        "anzeige": "Finsterkamm",
        "ziel": "Finsterkamm",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:finsterkamm"
      }
    ],
    "staat": [
      {
        "anzeige": "Grafschaft Heldentrutz",
        "ziel": "Grafschaft Heldentrutz",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:grafschaft-heldentrutz"
      }
    ],
    "nachbar_n": [
      {
        "anzeige": "Gashoker Steppe",
        "ziel": "Gashoker Steppe",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:gashoker-steppe"
      }
    ],
    "nachbar_no": [
      {
        "anzeige": "Nebelmoor",
        "ziel": "Nebelmoor",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:nebelmoor"
      },
      {
        "anzeige": "Neunaugensee",
        "ziel": "Neunaugensee",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:neunaugensee"
      }
    ]
  }
}
```

### X1 -- Elementares Hexagramm (Kraftlinie; „Ambossberge" ist eine Weiterleitung)

```json
{
  "public_id": "80e0aaa3-2c08-46ba-8775-dacfb06cdb12",
  "art": "kraftlinie",
  "wiki_key": "wiki:elementares-hexagramm",
  "ns": 0,
  "ns_name": "",
  "seite_art": "powerline",
  "seite_titel": "Elementares Hexagramm",
  "felder": {
    "regionen": [
      {
        "anzeige": "Finsterkamm",
        "ziel": "Finsterkamm",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:finsterkamm"
      },
      {
        "anzeige": "Koschberge",
        "ziel": "Koschberge",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:koschberge"
      },
      {
        "anzeige": "Ambossberge",
        "ziel": "Ambossberge",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:ambossgebirge",
        "weiterleitung_auf": {
          "wiki_key": "wiki:ambossgebirge",
          "titel": "Ambossgebirge",
          "ns": 0,
          "ns_name": ""
        }
      }
    ],
    "verlauf": [
      {
        "anzeige": "Unsichtbarer Turm",
        "ziel": "Unsichtbarer Turm",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:unsichtbarer-turm"
      },
      {
        "anzeige": "Luft",
        "ziel": "Luft",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:luft"
      },
      {
        "anzeige": "Tarf El'Hazaqur Mor",
        "ziel": "Tarf El'Hazaqur Mor",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:tarf-el-hazaqur-mor"
      }
    ]
  }
}
```

### X1 -- eine `Inoffiziell:`-Seite und ihre `Inoffiziell:`-Ziele

```json
{
  "public_id": "ca4054dc-ec9c-5500-bae7-7c5e956d33a2",
  "art": "siedlung",
  "wiki_key": "wiki:inoffiziell-kleewiesen",
  "ns": 222,
  "ns_name": "Inoffiziell",
  "seite_art": "settlement",
  "seite_titel": "Inoffiziell:Kleewiesen",
  "felder": {
    "region": [
      {
        "anzeige": "Weiden",
        "ziel": "Weiden",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:weiden"
      }
    ],
    "staat": [
      {
        "anzeige": "Herzogtum Weiden",
        "ziel": "Herzogtum Weiden",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:herzogtum-weiden"
      },
      {
        "anzeige": "Grafschaft Sichelwacht",
        "ziel": "Grafschaft Sichelwacht",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:grafschaft-sichelwacht"
      },
      {
        "anzeige": "Baronie Altentrallop",
        "ziel": "Baronie Altentrallop",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:baronie-altentrallop"
      }
    ],
    "nachbar_o": [
      {
        "anzeige": "Rossbergen",
        "ziel": "Inoffiziell:Rossbergen",
        "ns": 222,
        "ns_name": "Inoffiziell",
        "ziel_key": "wiki:inoffiziell-rossbergen"
      }
    ],
    "nachbar_s": [
      {
        "anzeige": "Hähnlein",
        "ziel": "Inoffiziell:Hähnlein",
        "ns": 222,
        "ns_name": "Inoffiziell",
        "ziel_key": "wiki:inoffiziell-h-hnlein"
      }
    ]
  }
}
```

### X2 -- Kopf

```json
{
  "objekte_mit_zuweisung": 6209,
  "objekte_ohne_schluessel": 0,
  "verschiedene_schluessel": 4014,
  "je_art": {
    "siedlung": {
      "zugewiesen": 2043,
      "ohne_zuweisung": 912
    },
    "weg": {
      "zugewiesen": 1964,
      "ohne_zuweisung": 4101
    },
    "region": {
      "zugewiesen": 655,
      "ohne_zuweisung": 361
    },
    "kraftlinie": {
      "zugewiesen": 82,
      "ohne_zuweisung": 83
    },
    "landschaft": {
      "zugewiesen": 516,
      "ohne_zuweisung": 1273
    },
    "gebiet": {
      "zugewiesen": 949,
      "ohne_zuweisung": 726
    }
  }
}
```

### X2 -- Beispiele

```json
[
  {
    "public_id": "80558060-4299-54aa-b520-814b10819885",
    "art": "siedlung",
    "feature_type": "location",
    "feature_subtype": "metropole",
    "wiki_url": "https://de.wiki-aventurica.de/wiki/Gareth",
    "wiki_key": "wiki:gareth",
    "wiki_titel": "Gareth",
    "ns": 0,
    "ns_name": ""
  },
  {
    "public_id": "c3b931c5-4a21-51e8-8bf7-076676cfecc5",
    "art": "weg",
    "feature_type": "path",
    "feature_subtype": "Reichsstrasse",
    "wiki_url": "https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_2",
    "wiki_key": "wiki:reichsstrasse-2",
    "wiki_titel": "Reichsstraße 2",
    "ns": 0,
    "ns_name": ""
  },
  {
    "public_id": "ca4054dc-ec9c-5500-bae7-7c5e956d33a2",
    "art": "siedlung",
    "feature_type": "location",
    "feature_subtype": "dorf",
    "wiki_url": "https://de.wiki-aventurica.de/wiki/Inoffiziell%3AKleewiesen",
    "wiki_key": "wiki:inoffiziell-kleewiesen",
    "wiki_titel": "Inoffiziell:Kleewiesen",
    "ns": 222,
    "ns_name": "Inoffiziell"
  },
  {
    "public_id": "5268482e-c2f5-4b67-8f3b-669905e18917",
    "art": "gebiet",
    "gebietsart": "Tá'akîb",
    "wiki_url": "https://de.wiki-aventurica.de/wiki/Inoffiziell%3AT%C3%A1y%C3%A2rret",
    "wiki_key": "wiki:inoffiziell-t-y-rret",
    "wiki_titel": "Inoffiziell:Táyârret",
    "ns": 222,
    "ns_name": "Inoffiziell"
  }
]
```

## Namensraum

`ns` ist die Zahl (0 Hauptraum, 222 `Inoffiziell:`, 218 `DSK:`, 220 `Elf:`, 444 `Ilaris:`), `ns_name` das Praefixwort
(leer im Hauptraum). Der Raum steckt zusaetzlich im Key: `wiki:dju-imen` (Hauptraum) gegen `wiki:inoffiziell-dju-imen`
(ns 222) sind zwei Artikel. `ziel` behaelt das Praefix roh. Bei X2 ist `ns` `null`, wenn es keine
Wiki-Aventurica-Adresse gibt (nur ein gespeicherter Key): ein Namensraum wird nicht aus dem Slug geraten
(`elf-volk` kann „Elf (Volk)" im Hauptraum oder „Elf:Volk" in ns 220 sein).

Weiterleitungen: `weiterleitung_auf` steht nur, wenn `wiki_redirect_alias` den Key veraendert hat, mit Titel und
Namensraum der Zielseite (`null`, wo der Dump die Seite nicht kennt). Ueber Namensraeume hinweg liest man sie an
`ns` gegen `weiterleitung_auf.ns`. Im Dump vom 08.09.2026 zeigen **768** Alias-Zeilen auf `Inoffiziell:`-Keys; in den
Linkfeldern der 3.057 gelesenen Artikel kommt **keine** solche Weiterleitung vor.

## Was der Export NICHT leistet

- **Vorlagen sind keine Links.** `{Pol|Baronie Raulsmark}` im Feld Staat (873 Vorkommen) und `{Reg|…}` (18)
  fuehrt der Export nicht als Link -- ob die Vorlage auf die Seite verweist, steht nicht im Quelltext. Der Kopf
  nennt die Zahl (`vorlagen_in_feldern`). Soll das Ziel einer solchen Vorlage mit, ist das eine Owner-Entscheidung
  (das Wiki muesste einmal bestaetigen, dass `Pol`/`Reg` auf den genannten Titel verweisen).
- **`derographie` gibt es nicht**: kein Infobox-Parameter dieses Namens kommt im Dump vor. `lage` bei Siedlungen
  setzt der Legacy-Parser aus `region` und `staat` zusammen -- beide stehen einzeln da.
- **Verlauf**: das Feld nennt ALLE Links des Rohtexts in Quelltext-Reihenfolge, auch Abzweig-, Querungs- und
  Zuflussziele fremder Wege. Die Stationen „dieses" Weges rechnet nur `avesmapsWikiPathExtractVerlaufStations`
  (und die gibt Anzeigetexte, keine Ziele).
- **Gebiete** stehen nur in X2 (X1 fuehrt keine Gebiets-Infobox).
- Der Wikitext ist so alt wie der letzte „Dump holen"-Lauf (`dump.abgeschlossen`); Objekte, deren Seite der Lauf nicht
  hat, stehen in `ohne_wikitext` (`seite_nicht_im_dump`).

## Haeufigste Linkziele OHNE Kartenobjekt (Top 30, Dump 08.09.2026, je Artikel gezaehlt)

Kandidaten fuer eine **redaktionelle** Zuweisung -- nicht automatisch zu loesen. „Links" zaehlt Links aus
verschiedenen Artikeln (ein Weg mit 56 Abschnitten zaehlt einmal).

| # | ziel_key | Ziel | Links |
|---|---|---|---|
| 1 | `wiki:nordaventurien` | Nordaventurien | 112 |
| 2 | `wiki:kosch-region` | Kosch (Region) | 82 |
| 3 | `wiki:mittelaventurien` | Mittelaventurien | 46 |
| 4 | `wiki:baron` | Baronin | 39 |
| 5 | `wiki:elfenlande` | Elfenlande | 37 |
| 6 | `wiki:wildermark` | Wildermark (Region) | 35 |
| 7 | `wiki:schwarztobrien` | Schwarztobrien | 31 |
| 8 | `wiki:elburische-halbinsel` | Elburische Halbinsel | 28 |
| 9 | `wiki:schattenlande-region` | Schattenlande (Region) | 28 |
| 10 | `wiki:ewiges-eis` | Ewiges Eis | 25 |
| 11 | `wiki:mhanadistan-region` | Mhanadistan (Region) | 25 |
| 12 | `wiki:perricumer-land` | Perricum (Region) | 24 |
| 13 | `wiki:s-daventurien` | Südaventurien | 19 |
| 14 | `wiki:amhallassih-kuppen` | Amhallassih-Kuppen | 18 |
| 15 | `wiki:svelltscher-st-dtebund` | Svelltscher Städtebund | 18 |
| 16 | `wiki:greifenpass` | Greifenpass | 17 |
| 17 | `wiki:jarltum-sydlig-klipholm` | Jarltum Sydlig Klipholm | 15 |
| 18 | `wiki:perleninseln` | Perleninseln | 15 |
| 19 | `wiki:zentral-aranien` | Zentral-Aranien | 14 |
| 20 | `wiki:festung-cumrat` | Festung Cumrat | 13 |
| 21 | `wiki:landstadt` | Landstadt | 13 |
| 22 | `wiki:hetleute` | Hetmann | 12 |
| 23 | `wiki:kronstrasse-aranien` | Kronstraße (Aranien) | 12 |
| 24 | `wiki:vorderkosch` | Vorderkosch | 12 |
| 25 | `wiki:graf` | Graf | 11 |
| 26 | `wiki:jarltum-nordlig-stenklip` | Jarltum Nordlig Stenklip | 11 |
| 27 | `wiki:karawanenroute` | Karawanenroute | 11 |
| 28 | `wiki:tiefe-mark` | Tiefe Mark | 11 |
| 29 | `wiki:d-l-almada` | Dâl (Almada) | 10 |
| 30 | `wiki:khazarrach` | Khazarrach | 10 |
