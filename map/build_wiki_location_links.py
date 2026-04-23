#!/usr/bin/env python3
import argparse
import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


API_URL = "https://de.wiki-aventurica.de/de/api.php"
PAGE_BASE_URL = "https://de.wiki-aventurica.de/wiki/"
USER_AGENT = "Avesmaps wiki location link builder/1.0"
REQUEST_TIMEOUT_SECONDS = 30
REQUEST_DELAY_SECONDS = 0.05
TITLE_BATCH_SIZE = 20
SEARCH_RESULT_LIMIT = 5
PLACE_CATEGORY_PREFIXES = (
    "Siedlung",
    "Siedlungen-Index",
    "Bauwerk",
)
PLACE_CATEGORY_NAMES = {
    "Dorf",
    "Festung",
    "Gro\u00dfstadt",
    "Heiligtum",
    "Kleinstadt",
    "Kloster",
    "Metropole (Siedlungsgr\u00f6\u00dfe)",
    "Mittelgro\u00dfe Stadt",
    "Mythologischer Ort",
    "Ruine",
    "Stadt",
    "Tempel",
}
BLOCKED_CATEGORY_NAMES = {
    "Begriffskl\u00e4rung",
}
BLOCKED_CATEGORY_PREFIXES = (
    "Familienname",
    "Publikation",
    "Vorname",
)
SPECIAL_FOLD_REPLACEMENTS = {
    "\u00df": "ss",
    "\u00e6": "ae",
    "\u0153": "oe",
    "\u00f8": "o",
    "\u00f0": "d",
    "\u00fe": "th",
}


def wiki_api_request(params):
    query_params = {
        "format": "json",
        "formatversion": "2",
        **params,
    }
    url = f"{API_URL}?{urllib.parse.urlencode(query_params)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def read_location_records(geojson_path):
    with geojson_path.open("r", encoding="utf-8") as geojson_file:
        data = json.load(geojson_file)

    records = {}
    for feature in data.get("features", []):
        geometry = feature.get("geometry") or {}
        properties = feature.get("properties") or {}
        name = properties.get("name")

        if geometry.get("type") != "Point" or not name:
            continue

        if name.startswith("Kreuzung"):
            continue

        records[name] = {
            "locationTypeLabel": properties.get("settlement_class_label") or properties.get("data-place-category-label") or "Ort",
        }

    return dict(sorted(records.items(), key=lambda item: item[0].casefold()))


def read_location_names(geojson_path):
    return list(read_location_records(geojson_path))


def fetch_siedlungen_index_categories():
    categories = []
    continue_token = None

    while True:
        params = {
            "action": "query",
            "list": "allcategories",
            "acprefix": "Siedlungen-Index",
            "aclimit": "max",
        }

        if continue_token:
            params["accontinue"] = continue_token

        data = wiki_api_request(params)
        categories.extend(
            item.get("category") or item.get("*")
            for item in data.get("query", {}).get("allcategories", [])
            if item.get("category") or item.get("*")
        )
        continue_token = data.get("continue", {}).get("accontinue")

        if not continue_token:
            break

        time.sleep(REQUEST_DELAY_SECONDS)

    return sorted(categories)


def fetch_category_member_titles(category_name):
    titles = []
    continue_token = None

    while True:
        params = {
            "action": "query",
            "list": "categorymembers",
            "cmtitle": f"Kategorie:{category_name}",
            "cmnamespace": "0",
            "cmlimit": "max",
        }

        if continue_token:
            params["cmcontinue"] = continue_token

        data = wiki_api_request(params)
        titles.extend(item["title"] for item in data.get("query", {}).get("categorymembers", []))
        continue_token = data.get("continue", {}).get("cmcontinue")

        if not continue_token:
            break

        time.sleep(REQUEST_DELAY_SECONDS)

    return titles


def fetch_settlement_titles():
    categories = fetch_siedlungen_index_categories()
    settlement_titles = set()

    for category in categories:
        settlement_titles.update(fetch_category_member_titles(category))
        time.sleep(REQUEST_DELAY_SECONDS)

    return settlement_titles


def chunked(values, size):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def get_category_names(page):
    return [
        category.get("title", "").removeprefix("Kategorie:")
        for category in page.get("categories", [])
    ]


def is_blocked_page(page):
    category_names = get_category_names(page)

    if any(category_name in BLOCKED_CATEGORY_NAMES for category_name in category_names):
        return True

    return any(
        category_name.startswith(blocked_prefix)
        for category_name in category_names
        for blocked_prefix in BLOCKED_CATEGORY_PREFIXES
    )


def is_place_page(page):
    if is_blocked_page(page):
        return False

    category_names = get_category_names(page)

    if any(category_name in PLACE_CATEGORY_NAMES for category_name in category_names):
        return True

    return any(
        category_name.startswith(place_prefix)
        for category_name in category_names
        for place_prefix in PLACE_CATEGORY_PREFIXES
    )


def fetch_title_pages(titles):
    pages_by_requested_title = {}

    for batch in chunked(titles, TITLE_BATCH_SIZE):
        data = wiki_api_request({
            "action": "query",
            "titles": "|".join(batch),
            "redirects": "1",
            "prop": "categories",
            "cllimit": "max",
        })
        query = data.get("query", {})
        normalized_titles = {item["from"]: item["to"] for item in query.get("normalized", [])}
        redirect_titles = {item["from"]: item["to"] for item in query.get("redirects", [])}
        pages_by_title = {
            page["title"]: page
            for page in query.get("pages", [])
        }

        for title in batch:
            normalized_title = normalized_titles.get(title, title)
            target_title = redirect_titles.get(normalized_title, redirect_titles.get(title, normalized_title))
            page = pages_by_title.get(target_title)

            if page and not page.get("missing"):
                pages_by_requested_title[title] = page

        time.sleep(REQUEST_DELAY_SECONDS)

    return pages_by_requested_title


def fetch_direct_title_matches(names, settlement_titles):
    matches = {}
    pages_by_name = fetch_title_pages(names)

    for name, page in pages_by_name.items():
        title = page["title"]

        if title in settlement_titles:
            match_type = "exact" if title == name else "redirect"
        elif is_place_page(page):
            match_type = "place" if title == name else "place-redirect"
        else:
            continue

        matches[name] = (title, match_type)

    return matches


def strip_diacritics(value):
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(character for character in decomposed if not unicodedata.combining(character))


def fold_special_characters(value):
    folded = value.casefold()

    for source, replacement in SPECIAL_FOLD_REPLACEMENTS.items():
        folded = folded.replace(source, replacement)

    return folded


def create_match_key(value):
    value = strip_diacritics(value)
    value = fold_special_characters(value)
    value = re.sub(r"[\s_\-'\u2019\u02bc`\u00b4]+", "", value)
    return re.sub(r"[^a-z0-9]+", "", value)


def strip_parenthetical_suffix(title):
    return re.sub(r"\s+\([^)]*\)\s*$", "", title).strip()


def title_matches_location_name(location_name, title):
    if "/" in title:
        return False

    return create_match_key(strip_parenthetical_suffix(title)) == create_match_key(location_name)


def fetch_search_candidate_titles(names):
    candidate_titles_by_name = {}

    for name in names:
        data = wiki_api_request({
            "action": "query",
            "list": "search",
            "srsearch": name,
            "srlimit": str(SEARCH_RESULT_LIMIT),
        })
        candidate_titles = []

        for result in data.get("query", {}).get("search", []):
            title = result.get("title", "")

            if title_matches_location_name(name, title):
                candidate_titles.append(title)

        if candidate_titles:
            candidate_titles_by_name[name] = candidate_titles

        time.sleep(REQUEST_DELAY_SECONDS)

    return candidate_titles_by_name


def fetch_search_matches(names, settlement_titles):
    matches = {}
    candidate_titles_by_name = fetch_search_candidate_titles(names)
    candidate_titles = sorted({
        title
        for titles in candidate_titles_by_name.values()
        for title in titles
    }, key=str.casefold)
    pages_by_title = fetch_title_pages(candidate_titles)

    for name, candidate_titles_for_name in candidate_titles_by_name.items():
        ranked_matches = []

        for candidate_order, candidate_title in enumerate(candidate_titles_for_name):
            page = pages_by_title.get(candidate_title)

            if not page:
                continue

            title = page["title"]

            if title in settlement_titles:
                ranked_matches.append((0, candidate_order, title))
                continue

            if any(category_name.startswith("Siedlung") for category_name in get_category_names(page)):
                ranked_matches.append((1, candidate_order, title))
                continue

            if is_place_page(page):
                ranked_matches.append((2, candidate_order, title))

        if ranked_matches:
            matches[name] = (min(ranked_matches, key=lambda item: (item[0], item[1]))[2], "search")

    return matches


def create_unique_title_index(titles):
    titles_by_key = defaultdict(list)

    for title in titles:
        titles_by_key[create_match_key(title)].append(title)

    return {
        key: matching_titles[0]
        for key, matching_titles in titles_by_key.items()
        if key and len(matching_titles) == 1
    }, {
        key: sorted(matching_titles, key=str.casefold)
        for key, matching_titles in titles_by_key.items()
        if key and len(matching_titles) > 1
    }


def create_page_url(title):
    encoded_title = urllib.parse.quote(title.replace(" ", "_"), safe="_():")
    return f"{PAGE_BASE_URL}{encoded_title}"


def get_location_noun_phrase(location_type_label):
    noun_phrases = {
        "Dorf": "ein Dorf",
        "Gro\u00dfstadt": "eine Gro\u00dfstadt",
        "Kleinstadt": "eine Kleinstadt",
        "Metropole": "eine Metropole",
        "Stadt": "eine Stadt",
    }
    return noun_phrases.get(location_type_label, f"ein Ort des Typs {location_type_label}")


def get_settlement_regions(page):
    return [
        category_name.removeprefix("Siedlung in ").strip()
        for category_name in get_category_names(page)
        if category_name.startswith("Siedlung in ")
    ]


def get_primary_wiki_place_type(page):
    ignored_category_names = {
        "Aventurien-Artikel",
        "Indizierter Spielwelt-Artikel",
        "Ortsmarkierung fehlt",
    }

    for category_name in get_category_names(page):
        if category_name in ignored_category_names:
            continue

        if category_name in PLACE_CATEGORY_NAMES and not category_name.startswith("Siedlungen-Index"):
            return category_name

    return None


def create_location_description(name, location_record, page):
    location_type_label = location_record.get("locationTypeLabel") or "Ort"
    noun_phrase = get_location_noun_phrase(location_type_label)
    settlement_regions = get_settlement_regions(page)

    if settlement_regions:
        return f"{name} ist {noun_phrase} in der Region {settlement_regions[0]}."

    wiki_place_type = get_primary_wiki_place_type(page)

    if wiki_place_type and wiki_place_type != location_type_label:
        return f"{name} ist in Avesmaps als {location_type_label} erfasst; Wiki Aventurica führt den Ort als {wiki_place_type}."

    return f"{name} ist in Avesmaps als {location_type_label} erfasst."


def create_link_entry(title, match_type, description=None):
    entry = {
        "title": title,
        "url": create_page_url(title),
        "match": match_type,
    }

    if description:
        entry["description"] = description

    return entry


def add_link_descriptions(links, location_records):
    titles = sorted({
        link["title"]
        for link in links.values()
    }, key=str.casefold)
    pages_by_title = fetch_title_pages(titles)

    for name, link in links.items():
        page = pages_by_title.get(link["title"])

        if not page:
            continue

        link["description"] = create_location_description(name, location_records.get(name, {}), page)

    return links

def build_links(location_names, settlement_titles):
    links = {}
    match_counts = defaultdict(int)
    direct_matches = fetch_direct_title_matches(location_names, settlement_titles)
    unique_title_index, ambiguous_title_index = create_unique_title_index(settlement_titles)

    for name in location_names:
        if name in direct_matches:
            title, match_type = direct_matches[name]
        else:
            title = unique_title_index.get(create_match_key(name))
            match_type = "normalized" if title else None

        if not title:
            continue

        links[name] = create_link_entry(title, match_type)
        match_counts[match_type] += 1

    unmatched = [name for name in location_names if name not in links]
    search_matches = fetch_search_matches(unmatched, settlement_titles)

    for name, (title, match_type) in search_matches.items():
        links[name] = create_link_entry(title, match_type)
        match_counts[match_type] += 1

    unmatched = [name for name in location_names if name not in links]
    ambiguous = {
        name: ambiguous_title_index[create_match_key(name)]
        for name in unmatched
        if create_match_key(name) in ambiguous_title_index
    }

    return links, dict(sorted(match_counts.items())), unmatched, ambiguous


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", encoding="utf-8", newline="\n") as output_file:
        json.dump(data, output_file, ensure_ascii=False, indent=2)
        output_file.write("\n")


def parse_args():
    parser = argparse.ArgumentParser(description="Build the static Wiki Aventurica lookup table for Avesmaps locations.")
    parser.add_argument("geojson", nargs="?", default="map/Aventurien_routes.geojson", type=Path)
    parser.add_argument("--output", default="map/wiki_location_links.json", type=Path)
    parser.add_argument("--report", default="map/wiki_location_links_report.json", type=Path)
    return parser.parse_args()


def main():
    args = parse_args()
    location_records = read_location_records(args.geojson)
    location_names = list(location_records)
    settlement_titles = fetch_settlement_titles()
    links, match_counts, unmatched, ambiguous = build_links(location_names, settlement_titles)
    links = add_link_descriptions(links, location_records)
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    write_json(args.output, {
        "generatedAt": generated_at,
        "source": "Wiki Aventurica MediaWiki API (Siedlungen-Index, page categories, search fallback)",
        "sourceUrl": "https://de.wiki-aventurica.de/wiki/Kategorie:Siedlungen-Index",
        "links": dict(sorted(links.items(), key=lambda item: item[0].casefold())),
    })
    write_json(args.report, {
        "generatedAt": generated_at,
        "locationCount": len(location_names),
        "settlementTitleCount": len(settlement_titles),
        "matchedCount": len(links),
        "unmatchedCount": len(unmatched),
        "matchCounts": match_counts,
        "unmatched": unmatched,
        "ambiguous": ambiguous,
    })

    print(f"Locations: {len(location_names)}")
    print(f"Wiki settlement titles: {len(settlement_titles)}")
    print(f"Matched: {len(links)}")
    print(f"Unmatched: {len(unmatched)}")
    print(f"Match counts: {match_counts}")


if __name__ == "__main__":
    main()
