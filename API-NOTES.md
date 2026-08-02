# Radio Browser API — filter matching notes

Verified against the `de1.api.radio-browser.info` mirror (server 0.7.44) in August 2026 by live
requests. These notes pin down how the API matches filter parameters so the app sends values
that actually work. "Verified" means the claim was checked with real requests against the API.

## Base URL

- `https://de1.api.radio-browser.info/json` — the mirror this app uses (see `src/api.ts`).

## Search endpoint (`/stations/search`) — parameter matching

| Parameter | Matches against | Semantics (verified) |
|---|---|---|
| `name` | station `name` | case-insensitive substring |
| `nameExact` | station `name` | exact (whole field) |
| `country` | station `country` (English name) | case-sensitive substring |
| `countryExact` | station `country` | exact (whole field) |
| `countrycode` | station `countrycode` | exact ISO 3166-1 alpha-2 code |
| `state` | station `state` | case-insensitive substring |
| `language` | station `language` (comma-separated English names) | case-sensitive substring over the whole field |
| `languageExact` | station `language` | per-token exact: query must equal one comma-separated token |
| `tag` | station `tags` | case-sensitive substring |
| `order` / `reverse` | — | sorting (`order=clickcount&reverse=true` is what the app uses) |
| `offset` / `limit` | — | paging |
| `hidebroken` | — | drops stations with failed checks |

### What "substring matching" means in practice

- Case-sensitivity is **not uniform**: `name` and `state` match case-insensitively, while
  `country`, `language`, and `tag` are case-sensitive.
- `country=germany` → `[]`; `country=Germany` → results.
- `language=English` → `[]`; `language=english` → results.
- `language=en` matches *names* containing "en" ("french", "español argentina") — codes are
  never matched by `language` or `country`, because those parameters match the English name
  fields, which hold names, not codes.
- `country=us` matches "The Russian Federation" (it contains "us").

### Exact matching

- `languageExact=true` matches one comma-separated token of the `language` field:
  `language=english&languageExact=true` matches stations with `language` "english" or
  "english,german", but not "american english", "english uk", or "engilsh" as standalone
  values.
- `countryExact=true` matches the whole country field exactly.
- `countrycode` is exact by definition — no flag needed.

## List endpoints (dropdown data)

- `GET /json/languages` — canonical lowercase language names, `iso_639` code, `stationcount`.
- `GET /json/countries` — canonical English country names, `iso_3166_1` code, `stationcount`.
- Sort with `?hidebroken=true&order=stationcount&reverse=true` (most-populated first; the app
  re-sorts the dropdown options alphabetically by label for display, with "All" always first).
- The path filters are NOT symmetric:
  - `/json/languages/<text>` — case-sensitive substring on the NAME
    (`/json/languages/ukrain` → "ukrainian" + "ukrainisch").
  - `/json/countries/<text>` — matches by ISO CODE, not name (`/json/countries/DE` →
    Germany; `/json/countries/Ukraine` and `/json/countries/ukr` → `[]`).
- The language list is noisy: entries without a valid `iso_639` code are junk or compound names
  ("engilsh", "english uk", "english/", "español argentina", "#english"). Filtering by
  `iso_639 != null` yields the canonical language set — junk has `iso_639: null`.

## Canonical values

Language names are all-lowercase English names; country names are Title Case with quirks.

| UI language (app) | API value for `language` | iso_639 |
|---|---|---|
| en | `english` | en |
| de | `german` | de |
| ru | `russian` | ru |
| ukr | `ukrainian` | uk |

Country examples (from `/json/countries`, hidebroken=true):

| country | countrycode |
|---|---|
| Germany | DE |
| Ukraine | UA |
| The Russian Federation | RU |
| The United States Of America | US |
| The United Kingdom Of Great Britain And Northern Ireland | GB |
| The Netherlands | NL |
| Czechia | CZ |
| Türkiye | TR |
| Taiwan, Republic Of China | TW |

Note the "The " prefixes, the "Of" in the US name, the comma in "Taiwan, Republic Of China",
and the umlaut in "Türkiye" — all must be typed exactly (case-sensitive substring). This is why
the app uses dropdowns instead of free text.

## App contract

- Language filter: send `language=<canonical lowercase name>` with `languageExact=true`.
- Country filter: send `countrycode=<ISO 3166-1 alpha-2 code>`.
- Both are omitted when "All" is selected. `name` and `tag` remain free-text substring filters.
- Dropdown options are sorted alphabetically by label client-side; the "All" option is always
  first.
