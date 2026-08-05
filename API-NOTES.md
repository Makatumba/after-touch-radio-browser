# AfterTouch Radio Browser — API notes

This document pins down the wire contracts this app depends on: how the Radio Browser API
matches filter parameters, and how the Bose SoundTouch Web API and its notification WebSocket
behave. "Verified" means the claim was checked with real requests: the Radio Browser sections
were verified against the `de1.api.radio-browser.info` mirror (server 0.7.44) in August 2026
by live requests; the SoundTouch section is documented from the Bose Web API documentation
and the AfterTouch project's implementation and integration tests (SoundTouch 10 and 20) —
its provenance and a live-verification checklist are at the end of that section.

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
| `order` / `reverse` | — | server-side sorting (see [Sorting](#sorting-order--reverse) below for the full criteria list and the app's mapping) |
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

## Sorting (`order` / `reverse`)

The search endpoint sorts server-side **before** `offset`/`limit` paging. `order` accepts
(default `name`): `name`, `url`, `homepage`, `favicon`, `tags`, `country`, `state`,
`language`, `votes`, `codec`, `bitrate`, `lastcheckok`, `lastchecktime`, `clicktimestamp`,
`clickcount`, `clicktrend`, `changetimestamp`, `random`. `reverse=true` flips the direction.
The dedicated `/stations/topvote` and `/stations/lastclick` endpoints are fixed-order — they
accept no `order` parameter.

The app maps five sort options onto the API (verified live against the 0.7.44 mirror):

| App option | `order` | `reverse` | Meaning (verified) |
|---|---|---|---|
| Name (A–Z) | `name` | — | alphabetical by station name |
| Name (Z–A) | `name` | `true` | reverse alphabetical |
| Popular (1 day) | `clickcount` | `true` | most clicks within the last 24 h — the app default |
| Trending (2 days) | `clicktrend` | `true` | biggest change in clickcount over the last 2 days |
| Top all time | `votes` | `true` | most votes ever (votes never reset) |

Notes: there is no "clicks in the last 2 days" field — `clicktrend` is the 2-day **change**, so
the "Trending (2 days)" option ranks by momentum; `clicktrend` and `clickcount` coincide for
stations whose click rate is steady. The same five options are applied client-side to the
favorites list (no API call), using the same field names on the saved station objects.

## List endpoints (dropdown data)

- `GET /json/languages` — canonical lowercase language names, `iso_639` code, `stationcount`.
- `GET /json/countries` — canonical English country names, `iso_3166_1` code, `stationcount`.
- Sort with `?hidebroken=true&order=stationcount&reverse=true` (most-populated first; the app
  re-sorts the dropdown options for display — alphabetically by the localized label in the
  active UI language, with "All" always first).
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
- Dropdown option labels are localized client-side to the active UI language: each option
  carries its ISO code (`iso_639` for languages, `iso_3166_1` for countries) and
  `Intl.DisplayNames` renders the localized name, with a per-language override map
  (`filterLabelOverrides` in `src/i18n.ts`) winning over `Intl.DisplayNames` and the canonical
  English label as fallback for unmappable codes. Sorting uses the active locale's collation.
  The values sent to the API are never localized (canonical lowercase names / ISO codes).
- Switching the UI language re-renders the dropdowns in the new locale immediately — no
  refetch of `/languages` or `/countries`.

## SoundTouch device wire contracts (remote control)

**Provenance**: shapes below come from the Bose SoundTouch Web API documentation and the
AfterTouch project's reference implementation (its POST `/key` and POST `/volume` bodies are
integration-tested against real SoundTouch 10 and 20 hardware). The `/key` values used by
this app and the press+release pattern were additionally verified by this app against a live
SoundTouch 10 speaker on 2026-08-04; `/volume` bodies remain AfterTouch/Bose-verified pending
the live checklist at the end of this section.

**CORS context**: the port-8090 HTTP API is CORS-blocked for the app's origin (stock Bose
firmware serves a fixed allowlist that never matches), so all HTTP commands are `no-cors`
and fire-and-forget — the app cannot read their responses. Confirmation arrives over the
port-8080 WebSocket, which is not subject to CORS. The only readable HTTP endpoint that
matters (`GET /info` for the reachability probe) is also `no-cors` and opaque.

### Live state — WebSocket (port 8080)

- Endpoint: `ws://<host>:8080/` (path `/`), connected with the **"gabbo"** subprotocol per the
  Bose Web API documentation. An explicit port in the saved host is honored (no `:8080`
  appended).
- Messages are XML documents with one `<updates>` root per message, e.g.:

  ```xml
  <?xml version="1.0" encoding="UTF-8" ?>
  <updates deviceID="689E19B8BB8A">
      <nowPlayingUpdated deviceID="689E19B8BB8A">
          <nowPlaying deviceID="689E19B8BB8A" source="RADIO_BROWSER">
              <track>Station name</track>
              <artist>Artist name</artist>
              <album>Album name</album>
              <playStatus>PLAY_STATE</playStatus>
          </nowPlaying>
      </nowPlayingUpdated>
  </updates>
  ```

- The `deviceID` attribute (the speaker's MAC) appears on `<updates>` and on the event
  elements; the app uses it for the device-info widget.
- `nowPlayingUpdated` carries the full now-playing payload (track/artist/album, `source`
  e.g. `RADIO_BROWSER`, `playStatus` `PLAY_STATE`/`PAUSE_STATE`/`BUFFERING_STATE`/
  `STOP_STATE`, plus the verbose fields below), for example:

  ```xml
  <?xml version="1.0" encoding="UTF-8" ?>
  <updates deviceID="689E19B8BB8A">
      <nowPlayingUpdated deviceID="689E19B8BB8A">
          <nowPlaying deviceID="689E19B8BB8A" source="RADIO_BROWSER">
              <track>Station name</track>
              <artist>Artist name</artist>
              <album>Album name</album>
              <playStatus>PLAY_STATE</playStatus>
          </nowPlaying>
      </nowPlayingUpdated>
  </updates>
  ```

#### Full now-playing payload (verbose state, FR-3 extension)

The full payload the device sends — in pushed `nowPlayingUpdated` events and in snapshot
RESPONSE bodies alike — carries more fields than the app used before. Field names below
come from the Bose Web API documentation and the gesellix reference implementation; the
live-verification checklist at the end of this section pins them against a real speaker.

```xml
<nowPlaying deviceID="689E19B8BB8A" source="RADIO_BROWSER" sourceAccount="...">
    <track>Track title</track>
    <artist>Artist name</artist>
    <album>Album name</album>
    <stationName>Station name</stationName>
    <art artImageStatus="IMAGE_PRESENT">http://<host>/v1/.../art.png</art>
    <ContentItem source="RADIO_BROWSER" type="STATION" location="/v1/play/..." sourceAccount="...">
        <itemName>Station name</itemName>
        <containerArt>http://<host>/v1/.../art.png</containerArt>
    </ContentItem>
    <time total="0">0</time>
    <skipEnabled/>
    <skipPreviousEnabled/>
    <favoriteEnabled/>
    <seekSupported value="false"/>
    <shuffleSetting>SHUFFLE_OFF</shuffleSetting>
    <repeatSetting>REPEAT_OFF</repeatSetting>
    <streamType>RADIO</streamType>
    <trackID>...</trackID>
    <position>0</position>
    <description>Station description</description>
    <stationLocation>Berlin, Germany</stationLocation>
    <playStatus>PLAY_STATE</playStatus>
</nowPlaying>
```

The app reads the whole payload; the Remote panel uses the title fallback (`track` →
`stationName` → `ContentItem.itemName`), the artist fallback (`artist` → `description`),
and the artwork (`art`, falling back to `ContentItem.containerArt`). The skip flags are
presence-based per the reference: `skipEnabled` present → Next enabled, absent → disabled
(`skipPreviousEnabled` likewise for Prev); the checklist confirms the real speaker's
semantics. The remaining fields are stored for future features. Every element is optional
— a field that is absent stays absent, and a malformed or unknown payload is never fatal
(existing defensive parsing).

- `volumeUpdated` carries the volume payload:

  ```xml
  <volumeUpdated deviceID="689E19B8BB8A">
      <volume deviceID="689E19B8BB8A">
          <targetvolume>50</targetvolume>
          <actualvolume>50</actualvolume>
          <muteenabled>false</muteenabled>
      </volume>
  </volumeUpdated>
  ```

  In some cases the device sends a signal-only notification without the payload; the app
  keeps its last-known values then — the readable `GET /volume` is CORS-blocked, and the
  app never pulls volume mid-connection (the snapshot below runs on connection open and on
  successful (re)connection checks).
- Other event types (`connectionStateUpdated`, `infoUpdated`, preset/zone/bass events) are
  ignored by the app; unknown events are never fatal.
- The connection is kept alive by the server's WebSocket ping frames; the browser answers
  them automatically.

#### State snapshot — request/response over the same WebSocket

The device answers GET requests over the same "gabbo" WebSocket with a REST-proxy
envelope (documented in Bose Android app MITM captures and the gesellix reference
implementation; the request shape below was confirmed live against a SoundTouch 10 on
2026-08-04). The app uses this to fetch a state snapshot on every connection open and
again on every successful (re)connection check (startup for a saved address, address
save, successful drop-recovery probe) — the check-time re-request gives a missed or
unanswered first snapshot a fresh chance.

Request envelope — the `url` attribute has **no leading slash** (a `/` prefix is
rejected with error 2015 `NOT_REGISTERED`); the `deviceID` attribute is required but
not validated:

```xml
<msg>
    <header deviceID="304511B9B8BC" url="now_playing" method="GET">
        <request requestID="1"><info type="new"/></request>
    </header>
    <body/>
</msg>
```

The app sends three requests on each connection open and again on each successful
(re)connection check — `now_playing`, `volume`, and `info` — with a `requestID` that
increments per request and resets to 1 on every (re)connect. A check-triggered request is
only sent while the current socket for the current host is open; a failed check sends
nothing. The response carries `msgType="RESPONSE"` and a `<body>` whose payload
shapes are the same XML the `<updates>` events carry, so the app's defensive field
mapping applies 1:1:

```xml
<msg>
    <header deviceID="304511B9B8BC" url="now_playing" method="GET" msgType="RESPONSE">
        <request requestID="1"/>
    </header>
    <body>
        <nowPlaying source="RADIO_BROWSER">
            <track>Station name</track>
            <artist>Artist name</artist>
            <album>Album name</album>
            <playStatus>PLAY_STATE</playStatus>
        </nowPlaying>
    </body>
</msg>
```

- `GET now_playing` → `<body><nowPlaying …>` — the full now-playing payload above
  (same field mapping as `nowPlayingUpdated`).
- `GET volume` → `<body><volume …>` — `targetvolume`/`actualvolume`/`muteenabled`
  (same field mapping as `volumeUpdated`).
- `GET info` → `<body><info …>` — the full device metadata below. This is the app's only
  source for the device-info widget rows.
- Responses carry no client-side correlation beyond the socket itself: a message from
  a superseded connection is ignored, and unknown or malformed RESPONSE bodies are
  never fatal (the app treats them like any unknown `<updates>` message).

#### Device info payload (full info widget, FR-3 extension)

Field names come from the Bose Web API documentation and the gesellix reference
implementation (`pkg/models/device.go`); the live-verification checklist pins the exact
element names against a real speaker:

```xml
<info deviceID="689E19B8BB8A">
    <name>Bose SoundTouch B9B8BC</name>
    <type>SoundTouch 10</type>
    <moduleType>soundtouch</moduleType>
    <variant>...</variant>
    <variantMode>...</variantMode>
    <countryCode>DE</countryCode>
    <regionCode>EU</regionCode>
    <networkInfo type="WIRED">
        <macAddress>68:9E:19:B8:BB:8A</macAddress>
        <ipAddress>192.168.1.42</ipAddress>
    </networkInfo>
    <components>
        <component>
            <componentCategory>...</componentCategory>
            <softwareVersion>...</softwareVersion>
            <serialNumber>...</serialNumber>
        </component>
    </components>
    <margeURL>...</margeURL>
    <margeAccountUUID>...</margeAccountUUID>
</info>
```

The app renders the curated set — `deviceID`, `name`, `type`, `moduleType`, `variant`, the
`networkInfo` `ipAddress`, and the first component's `softwareVersion` — one widget row per
field, each row only when its data exists. The remaining fields (`variantMode`,
`countryCode`, `regionCode`, the `networkInfo` `type`, the component `componentCategory`,
`margeURL`, `margeAccountUUID`) are parsed for completeness and stored, not displayed. The
`networkInfo` `macAddress` and the component `serialNumber` are **not parsed at all**:
they uniquely identify the physical unit and are excluded for privacy (the wire shapes
above are documented for completeness and live verification, but the app never reads
them).

### Commands — HTTP API (port 8090)

Both endpoints are `no-cors` POSTs with `text/plain;charset=UTF-8` bodies, like `/select`.
The app sends them fire-and-forget and reconciles from WebSocket events (no echo loops).

- **POST `/key`** — transport commands. Each command is a press+release pair (two POSTs) with
  the `sender` attribute set to `"Gabbo"` — the standard sender from the Bose documentation,
  used by this app. `sender` is mandatory: non-standard senders (`GoClient`, `"SoundTouch
  app"`, empty) are rejected with `CLIENT_XML_ERROR` 1019 (verified by the AfterTouch
  integration tests); other standard sender values exist (e.g. `IrRemote`, `Console`,
  `LightswitchRemote`, `BoselinkRemote`, `Etap`):

  ```xml
  <key state="press" sender="Gabbo">PLAY</key>
  <key state="release" sender="Gabbo">PLAY</key>
  ```

  - Keys used by the app (unprefixed, case-sensitive — the canonical values per the Bose
    documentation and the hardware-verified AfterTouch implementation): `PLAY`, `PAUSE`,
    `NEXT_TRACK`, `PREV_TRACK`. A `KEY_`-prefixed value is rejected with HTTP 400
    `CLIENT_XML_ERROR` 1019 — verified against the live SoundTouch 10 speaker.
  - Response (unreadable in the browser): `<?xml version="1.0" encoding="UTF-8"?><status>/key</status>`.
- **POST `/volume`** — set volume: body `<volume>50</volume>` (0–100). The AfterTouch project
  verified this body against SoundTouch 10/20 hardware.
- **POST `/volume`** — mute toggle: body `<volume><muteenabled>true</muteenabled></volume>` or
  `<muteenabled>false</muteenabled>` (per the Bose Web API docs; the device also unmutes when
  a volume value higher than the current one is sent — confirm against the live speaker).

### Live-verification checklist (while testing the feature branch)

- [x] The WebSocket connects with the "gabbo" subprotocol and `nowPlayingUpdated` /
      `volumeUpdated` arrive in the minimal shapes shown above (the verbose fields remain
      pending the checklist below).
- [x] `PLAY`/`PAUSE`/`NEXT_TRACK`/`PREV_TRACK` execute on the speaker (verified 2026-08-04
      against a SoundTouch 10: `KEY_`-prefixed values are rejected with HTTP 400
      `CLIENT_XML_ERROR` 1019, unprefixed press+release returns `<status>/key</status>`).
- [ ] `POST /volume` with body `<volume>N</volume>` changes the volume, and the `muteenabled`
      body toggles mute.
- [ ] The `GET now_playing` / `GET volume` / `GET info` snapshot requests over the WebSocket
      answer with `msgType="RESPONSE"` envelopes carrying the documented payload shapes,
      including the exact `<info>` element names (`name`, `type`, `moduleType`, `variant`,
      `networkInfo` with `macAddress`/`ipAddress`, `components` with `serialNumber` /
      `softwareVersion`) and the full now-playing field names (`stationName`, `art` with
      `artImageStatus`, `ContentItem` with `itemName`/`containerArt`, `sourceAccount`,
      `time`, `skipEnabled`, `skipPreviousEnabled`, `favoriteEnabled`, `seekSupported`,
      `shuffleSetting`, `repeatSetting`, `streamType`, `trackID`, `position`,
      `description`, `stationLocation`).
- [ ] The pushed `nowPlayingUpdated` events carry the same verbose fields as the snapshot
      RESPONSE bodies (title fallback and skip-flag gating work from both paths).
- [ ] `skipEnabled` / `skipPreviousEnabled` semantics on a source where the speaker
      disables skipping: empty presence elements (absent → disabled) vs. any text value the
      firmware actually sends, and Next/Prev render accordingly.
- [ ] The `art` URL resolves (or degrades silently when unreachable or
      CORS/mixed-content-blocked on the HTTPS-hosted app).
