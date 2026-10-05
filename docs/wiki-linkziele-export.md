# Wiki-Linkziele und Wiki-Zuordnung (X1 / X2) -- Exporte fuer Avesmaps3D

Zwei lesende Endpunkte, gebaut am 05.10.2026 im Auftrag von Avesmaps3D. Ziel: jedes Kartenobjekt, das in einem
Wiki-Feld **genannt** wird, ueber seinen **Wiki-Key** verlinken -- nie ueber den Namen (Owner-Entscheid 08.09.2026
„Zuweisung im Wiki gewinnt", `docs/abenteuer-feature-design.md` §5).

| Export | Endpunkt | Inhalt |
|---|---|---|
| X1 | `GET /api/app/wiki-linkziele-export.php` | **je Artikel** (Wiki-Seite) und Wiki-Feld die Links `{anzeige, ziel, art, ziel_key, ns}` |
| X2 | `GET /api/app/wiki-zuordnung-export.php` | je zugewiesenem Objekt der kanonische `wiki_key` (`wiki_key -> public_id`) |

Beide werden ueber den Wiki-Key verbunden: `artikel[].wiki_key` und `felder.*[].ziel_key` (X1) gegen `objekte[].wiki_key` (X2).

Vertrag, Felder und Fallen: `api/README.md` (Abschnitt „wiki link targets"), Bibliothek
`api/_internal/app/wiki-linkziele-export.php`, Zerlegung `api/_internal/wiki/link-ziele.php`, Test
`api/_internal/app/__tests__/wiki-linkziele-export-test.php`.

## Entscheidungen des Owners (05.10.2026)

- **X1 ist je Artikel, nicht je Objekt** (Abweichung vom urspruenglichen Auftrag „je Objekt", gewollt). Ein Weg in
  56 Abschnitten (Reichsstraße 2) steht EINMAL da; welche Objekte an einem Artikel haengen, sagt X2. Die Antwort ist
  damit rund 4 MB statt rund 10 MB gross.
- **`{{Pol|X}}` im Feld Staat und `{{Reg|X}}` im Feld Region sind Links**: Ziel = X, kanonisiert wie jedes andere Ziel, mit
  `art: "vorlage"` und `vorlage: "Pol"` bzw. `"Reg"`. Beleg: Vorlage:Pol hat im Wiki genau einen Parameter, „Uebergeordnete
  politische Region" -- den Seitentitel der Region, aus der die Infobox die politische Zugehoerigkeit liest. **Mehr als
  „uebergeordnete politische Region" behauptet `ziel` damit nicht** (nicht „der Landesherr"). Wikilinks tragen
  `art: "wikilink"`. Alle anderen Vorlagen (`{{Reichsstadt|…}}`, `{{Pol|…}}` in einem anderen Feld) sind kein Link und werden nur
  gezaehlt (`kopf.vorlagen_in_feldern`).

## Beispielantworten (Stand: Datenbank-Dump vom 08.09.2026, Dump-Lauf 155 -- NICHT der Livebestand)

Gekuerzt (drei Links je Feld, vier Felder je Artikel). Die Zaehler im Kopf sind die des vollen Dumps.

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
  "objekte_ohne_schluessel": 0,
  "artikel": {
    "mit_wikitext": 3056,
    "felder_befuellt": 18666,
    "felder_mit_link": 17313,
    "links_gesamt": 26611,
    "links_pipe": 2620,
    "links_vorlage": 889,
    "ziele_verschieden": 4656,
    "ziele_mit_kartenobjekt": 3306,
    "ziele_ohne_kartenobjekt": 1350
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
      "links": 83
    },
    {
      "ziel_key": "wiki:mittelaventurien",
      "ziel": "Mittelaventurien",
      "links": 46
    }
  ],
  "vorlagen_in_feldern": {
    "Reichsstadt": 24,
    "Pol": 10
  },
  "seiten_schluesselkollision": 0
}
```

### X1 -- Gareth (Siedlung): `{{Pol|…}}` und `{{Reg|…}}` als `art: "vorlage"`

```json
{
  "wiki_key": "wiki:gareth",
  "ns": 0,
  "ns_name": "",
  "seite_art": "settlement",
  "seite_titel": "Gareth",
  "felder": {
    "region": [
      {
        "anzeige": "Herz des Kontinents",
        "ziel": "Herz des Kontinents",
        "art": "vorlage",
        "vorlage": "Reg",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:herz-des-kontinents"
      }
    ],
    "staat": [
      {
        "anzeige": "Baronie Raulsmark",
        "ziel": "Baronie Raulsmark",
        "art": "vorlage",
        "vorlage": "Pol",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:baronie-raulsmark"
      },
      {
        "anzeige": "Reichsstadt",
        "ziel": "Reichsstadt",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:reichsstadt"
      },
      {
        "anzeige": "Alt-Gareth",
        "ziel": "Alt-Gareth",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:alt-gareth"
      }
    ],
    "oberhaupt": [
      {
        "anzeige": "Kaiser",
        "ziel": "Kaiser",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:kaiser"
      },
      {
        "anzeige": "Rohaja von Gareth",
        "ziel": "Rohaja von Gareth",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:rohaja-von-gareth"
      },
      {
        "anzeige": "Thorn Eisinger",
        "ziel": "Thorn Eisinger",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:thorn-eisinger"
      }
    ],
    "verkehrswege": [
      {
        "anzeige": "Reichsstraßen 2",
        "ziel": "Reichsstraße 2",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:reichsstrasse-2"
      },
      {
        "anzeige": "3",
        "ziel": "Reichsstraße 3",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:reichsstrasse-3"
      },
      {
        "anzeige": "Gardel",
        "ziel": "Gardel",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:gardel"
      }
    ]
  }
}
```

`staat` und `region` zeigen die Vorlagen-Links, daneben die Wikilinks mit `art: "wikilink"`. Im Quelltext steht
`{{Pol|Baronie Raulsmark}}` vor `[[Reichsstadt]]`, und genau in dieser Reihenfolge stehen sie in der Liste.

### X1 -- Gareths `verkehrswege` (der Fall aus dem Auftrag)

```json
[
  {
    "anzeige": "Reichsstraßen 2",
    "ziel": "Reichsstraße 2",
    "art": "wikilink",
    "ns": 0,
    "ns_name": "",
    "ziel_key": "wiki:reichsstrasse-2"
  },
  {
    "anzeige": "3",
    "ziel": "Reichsstraße 3",
    "art": "wikilink",
    "ns": 0,
    "ns_name": "",
    "ziel_key": "wiki:reichsstrasse-3"
  },
  {
    "anzeige": "Gardel",
    "ziel": "Gardel",
    "art": "wikilink",
    "ns": 0,
    "ns_name": "",
    "ziel_key": "wiki:gardel"
  }
]
```

„Reichsstraßen 2" -> `Reichsstraße 2`, „3" -> `Reichsstraße 3`, „Gardel" -> `Gardel`, jeweils mit eigenem `ziel_key`.

### X1 -- Reichsstraße 2 (Weg; ein Artikel, an dem 56 Abschnitte hängen -- X2 nennt sie)

```json
{
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
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:weiden"
      },
      {
        "anzeige": "Darpatien",
        "ziel": "Darpatien",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:darpatien"
      },
      {
        "anzeige": "Garetien",
        "ziel": "Herz des Kontinents",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:herz-des-kontinents"
      }
    ],
    "verlauf": [
      {
        "anzeige": "Seeweg",
        "ziel": "Seeweg",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:seeweg"
      },
      {
        "anzeige": "Trallop",
        "ziel": "Trallop",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:trallop"
      },
      {
        "anzeige": "Alte Straße",
        "ziel": "Alte Straße",
        "art": "wikilink",
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
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:finsterkamm"
      }
    ],
    "staat": [
      {
        "anzeige": "Grafschaft Heldentrutz",
        "ziel": "Grafschaft Heldentrutz",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:grafschaft-heldentrutz"
      }
    ],
    "nachbar_n": [
      {
        "anzeige": "Gashoker Steppe",
        "ziel": "Gashoker Steppe",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:gashoker-steppe"
      }
    ],
    "nachbar_no": [
      {
        "anzeige": "Nebelmoor",
        "ziel": "Nebelmoor",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:nebelmoor"
      },
      {
        "anzeige": "Neunaugensee",
        "ziel": "Neunaugensee",
        "art": "wikilink",
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
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:finsterkamm"
      },
      {
        "anzeige": "Koschberge",
        "ziel": "Koschberge",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:koschberge"
      },
      {
        "anzeige": "Ambossberge",
        "ziel": "Ambossberge",
        "art": "wikilink",
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
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:unsichtbarer-turm"
      },
      {
        "anzeige": "Luft",
        "ziel": "Luft",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:luft"
      },
      {
        "anzeige": "Tarf El'Hazaqur Mor",
        "ziel": "Tarf El'Hazaqur Mor",
        "art": "wikilink",
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
  "wiki_key": "wiki:inoffiziell-ammernroden",
  "ns": 222,
  "ns_name": "Inoffiziell",
  "seite_art": "settlement",
  "seite_titel": "Inoffiziell:Ammernroden",
  "felder": {
    "region": [
      {
        "anzeige": "Weiden",
        "ziel": "Weiden",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:weiden"
      }
    ],
    "staat": [
      {
        "anzeige": "Herzogtum Weiden",
        "ziel": "Herzogtum Weiden",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:herzogtum-weiden"
      },
      {
        "anzeige": "Grafschaft Sichelwacht",
        "ziel": "Grafschaft Sichelwacht",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:grafschaft-sichelwacht"
      },
      {
        "anzeige": "Baronie Adlerflug",
        "ziel": "Baronie Adlerflug",
        "art": "wikilink",
        "ns": 0,
        "ns_name": "",
        "ziel_key": "wiki:baronie-adlerflug"
      }
    ],
    "nachbar_n": [
      {
        "anzeige": "Sinopje",
        "ziel": "Inoffiziell:Sinopje",
        "art": "wikilink",
        "ns": 222,
        "ns_name": "Inoffiziell",
        "ziel_key": "wiki:inoffiziell-sinopje"
      }
    ],
    "nachbar_nw": [
      {
        "anzeige": "Kuffertal",
        "ziel": "Inoffiziell:Kuffertal",
        "art": "wikilink",
        "ns": 222,
        "ns_name": "Inoffiziell",
        "ziel_key": "wiki:inoffiziell-kuffertal"
      }
    ]
  }
}
```

### X1 -- `ohne_wikitext` (je Schluessel)

```json
[
  {
    "wiki_key": "wiki:al-ghunar",
    "grund": "seite_nicht_im_dump",
    "objekte": 1
  },
  {
    "wiki_key": "wiki:ardism-r",
    "grund": "seite_nicht_im_dump",
    "objekte": 1
  }
]
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

### X2 -- Beispiele (Gareth, ein Abschnitt der Reichsstraße 2, eine Inoffiziell:-Siedlung, ein Inoffiziell:-Gebiet)

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
Linkfeldern der 3056 gelesenen Artikel kommt **keine** solche Weiterleitung vor.

## Was der Export NICHT leistet

- **Andere Vorlagen sind keine Links.** `{{Reichsstadt|…}}` und `{{Pol|…}}` ausserhalb des Feldes Staat zaehlt der Kopf
  (`vorlagen_in_feldern`: {"Reichsstadt": 24, "Pol": 10}), mehr nicht.
- **`derographie` gibt es nicht**: kein Infobox-Parameter dieses Namens kommt im Dump vor. `lage` bei Siedlungen
  setzt der Legacy-Parser aus `region` und `staat` zusammen -- beide stehen einzeln da.
- **Verlauf**: das Feld nennt ALLE Links des Rohtexts in Quelltext-Reihenfolge, auch Abzweig-, Querungs- und
  Zuflussziele fremder Wege. Die Stationen „dieses" Weges rechnet nur `avesmapsWikiPathExtractVerlaufStations`
  (und die gibt Anzeigetexte, keine Ziele).
- **Gebiete** stehen nur in X2 (X1 fuehrt keine Gebiets-Infobox).
- Der Wikitext ist so alt wie der letzte „Dump holen"-Lauf (`dump.abgeschlossen`); Schluessel, deren Seite der Lauf nicht
  hat, stehen in `ohne_wikitext` (`seite_nicht_im_dump`).

## Zaehler dieses Dumps (je Artikel)

3056 Artikel mit Wikitext, 26611 Links (2620 Pipe-Links, davon
889 Vorlagen-Links), 4656 verschiedene Ziele, davon 3306 mit und
1350 ohne Kartenobjekt.

## Haeufigste Linkziele OHNE Kartenobjekt (Top 30, Dump 08.09.2026, je Artikel gezaehlt)

Kandidaten fuer eine **redaktionelle** Zuweisung -- nicht automatisch zu loesen. „Links" zaehlt Links aus
verschiedenen Artikeln (ein Weg mit mehreren Abschnitten zaehlt einmal).

| # | ziel_key | Ziel | Links |
|---|---|---|---|
| 1 | `wiki:nordaventurien` | Nordaventurien | 112 |
| 2 | `wiki:kosch-region` | Kosch (Region) | 83 |
| 3 | `wiki:mittelaventurien` | Mittelaventurien | 46 |
| 4 | `wiki:baron` | Freiherr | 39 |
| 5 | `wiki:elfenlande` | Elfenlande | 37 |
| 6 | `wiki:wildermark` | Wildermark | 35 |
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
| 25 | `wiki:ferdoker-land` | Ferdoker Land | 11 |
| 26 | `wiki:graf` | Graf | 11 |
| 27 | `wiki:jarltum-nordlig-stenklip` | Jarltum Nordlig Stenklip | 11 |
| 28 | `wiki:karawanenroute` | Karawanenroute | 11 |
| 29 | `wiki:tiefe-mark` | Tiefe Mark | 11 |
| 30 | `wiki:d-l-almada` | Dâl (Almada) | 10 |
