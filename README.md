# ws4kp-linhanced

`ws4kp-linhanced` is a Linux-focused fork of [`netbymatt/ws4kp`](https://github.com/netbymatt/ws4kp) by `markmental`.

It keeps the stronger, more stable foundation of the original `ws4kp` project while selectively incorporating international weather support and global map ideas from [`mwood77/ws4kp-international`](https://github.com/mwood77/ws4kp-international). The goal is not to become a kitchen-sink weather platform. The goal is a leaner, maintainable, Linux-oriented WeatherStar fork with a clear identity.

This fork also explicitly embraces Slackware Linux / `weatherstar4k` branding as part of its mission. Broad platform neutrality is not a design goal here.

## What This Fork Is

`ws4kp-linhanced` is a retro weather display project that preserves the classic WeatherStar-style feel while updating the data sources and map stack for modern use.

This fork is built around a few priorities:

* keep the classic WeatherStar presentation and pacing intact where practical
* support international locations without dragging in unnecessary feature creep
* prefer a stable, understandable codebase over maximum feature count
* lean into Linux-oriented branding and integrations where they add character and usefulness

It is not intended to be a perfect hardware emulation of the original WeatherStar 4000. If you want a project aimed more directly at hardware-faithful behavior, see the [WS4000 Simulator](http://www.taiganet.com/).

## Why This Fork Exists

This fork exists because the original `ws4kp` codebase provided the best overall base to keep working from, but it remained too tightly tied to US-only weather sources. At the same time, `ws4kp-international` proved that Open-Meteo and global map support were viable, but it grew in directions that felt heavier and harder to maintain.

This fork sits in the middle on purpose:

* more international than upstream `ws4kp`
* leaner and narrower in scope than `ws4kp-international`
* more explicitly Linux-focused than either

## Fork Lineage

This project builds on the work of:

* [`netbymatt/ws4kp`](https://github.com/netbymatt/ws4kp) for the core WeatherStar implementation and overall application structure
* [`mwood77/ws4kp-international`](https://github.com/mwood77/ws4kp-international) for Open-Meteo international weather direction and some global-map concepts

This fork intentionally diverges from `ws4kp-international`. It selectively adapts the parts that fit this project and leaves behind the parts that would make the codebase harder to keep stable.

## Current Features

Major features currently in this fork:

* Open-Meteo-based international weather for the core forecast screens
* ArcGIS-powered international location search and reverse geocoding
* global RainViewer radar on a cached world basemap
* global `Regional Observations` and nearby-city displays backed by expanded worldwide city coverage
* `Latest Observations` screen for nearby city temperatures, conditions, and wind
* `Ground View` screen powered by nearby Windy webcams (requires API key, see below)
* Travel Forecast rebuilt around region buckets with a global fallback
* optional screen-specific audio playback for supported displays
* wind/gust-based condition inference for better condition names and icon matches when upstream data is too generic
* live theme switching with auto-discovered theme folders
* Server Observations powered by [fastfetch](https://github.com/fastfetch-cli/fastfetch)
* server-side caching proxy for Open-Meteo, RainViewer metadata, and ArcGIS basemap tiles
* static-build path fixes for subdirectory deployment

Some NOAA-only products are still retained where they remain useful and there is no replacement yet:

* Hazards (US only)
* SPC Outlook (US only)

For locations outside the US, a derived alert system provides best-effort hazard warnings based on available meteorological data when official NOAA products do not apply.

## Themes

`ws4kp-linhanced` supports live asset theme swapping from the main page. Themes are discovered automatically from the `themes/` directory and can be changed from the `Theme` selector under the `More information` link without reloading the page.

Current themes include:

* `Default`
* `azazel`
* `debian`
* `linhanced`
* `linhanced-retro`
* `oceanview`
* `slackware`
* `twc-linhanced`
* `twc-classic`
* `twc-stockholm`

Currently supported themed assets include:

These filenames represent the standard override set used by the built-in themes.

* `logo-corner.png`
* `1.png`
* `1-chart.png`
* `2.png`
* `3.png`
* `4.png`
* `5.png`
* `6.png`

Additional themes can be added by creating a subdirectory under `themes/` with matching override filenames.

## Quick Start

Ensure you have Node installed.

```bash
git clone <repourlgoeshere>
cd ws4kp-linhanced
npm install
npm start
```

Then open:

```text
http://localhost:8080/
```

## API Keys

### Windy Webcams (Ground View)

The `Ground View` screen requires a Windy Webcams API key. Create a file named `windy-api-key.txt` in the project root and paste your API key as plain text. If this file is missing, the `Ground View` screen will not work.

You can obtain a free API key from [Windy Webcams API](https://api.windy.com/webcams).

## MySQL

`Hazard List` is now backed by MySQL in server mode. The UI only shows the latest 7 hazards, but the database retains full history.

Set these environment variables before starting the app:

```text
WS4KP_MYSQL_HOST=127.0.0.1
WS4KP_MYSQL_PORT=3306
WS4KP_MYSQL_SOCKET_PATH=/var/run/mysql/mysql.sock
WS4KP_MYSQL_USER=root
WS4KP_MYSQL_PASSWORD=your-password
WS4KP_MYSQL_DATABASE=ws4kp_linhanced
```

If your local MariaDB/MySQL instance is socket-only, set `WS4KP_MYSQL_SOCKET_PATH` and omit `WS4KP_MYSQL_HOST` / `WS4KP_MYSQL_PORT`.

Create the required table:

```sql
CREATE TABLE hazard_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    location_label VARCHAR(255) NOT NULL,
    location_key VARCHAR(128) NOT NULL,
    hazard_type VARCHAR(128) NOT NULL,
    source VARCHAR(64) NOT NULL,
    severity VARCHAR(64) DEFAULT NULL,
    latest_hazard_id VARCHAR(255) DEFAULT NULL,
    encountered_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL,
    ongoing TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_logical_hazard (location_key, hazard_type, source),
    KEY idx_last_seen_at (last_seen_at),
    KEY idx_location_key (location_key),
    KEY idx_ongoing (ongoing)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## Running Modes

This fork supports two main runtime styles.

### Server Mode

Recommended for normal use.

```bash
npm start
```

This mode includes:

* Express server entry point
* proxying and caching for weather/map requests
* Fastfetch-backed Server Observations
* MySQL-backed Hazard List history
* better shared performance when multiple clients use the same instance

### Static Mode

Useful if you want to serve the built files directly.

```bash
npm run build
STATIC=1 DIST=1 npm start
```

Or upload the generated `dist/` directory to your web server after running:

```bash
npm run build
```

The static build has been adjusted so frontend-generated paths no longer assume deployment at `/`, which makes subdirectory hosting more practical. **Also, features that require a backend server like the on-disk cache, Fastfetch-backed Server Observations, LWN Linux News, `Ground View`, and `Hazard List` will not work when running the static build by itself.**

The public demo at [https://mentalnet.xyz/ws4kp-linhanced-demo/](https://mentalnet.xyz/ws4kp-linhanced-demo/) is intentionally served as a static build, so the `Linux News`, `Server Observations`, `Ground View`, and `Hazard List` screens will not work there.

## International Support

Core forecast functionality works internationally.

That currently includes:

* Current Conditions
* Latest Observations
* Hourly Forecast
* Hourly Graph
* Local Forecast
* Extended Forecast
* Almanac
* Travel Forecast
* Local Radar
* Regional Observations

Legacy NOAA-only screens still remain US-specific where applicable.

## Settings And Customization

Important settings and customization features include:

* playback speed
* widescreen mode
* kiosk mode
* scan lines
* US vs metric units
* theme selection
* optional screen audio toggle
* custom bottom scroll text
* display enable/disable checkboxes

### Permalinks

Display selections, location, and major settings can be shared or bookmarked through the built-in permalink feature.

### Kiosk Mode

Kiosk mode hides the surrounding controls and maximizes the display area for dedicated setups. It can be triggered from the UI or via permalink parameters.

### Custom Scroll Text

The bottom text crawl can be customized using the built-in custom text setting.

Multiple messages can be separated with `|` to rotate randomly.

Example:

```text
Welcome to Weatherstar|Thanks for watching
```

### Custom Hook

A customization hook is available as:

```text
server/scripts/custom.js
```

A sample file exists at:

```text
server/scripts/custom.sample.js
```

## Audio

The original WeatherStar atmosphere depended heavily on background music. This repo includes a small set of WeatherStar-inspired tracks, while keeping the total size manageable.

If you want to use your own music, place `.mp3` files in:

```text
server/music/
```

The application will build or serve a playlist from those files depending on the runtime mode.

Alert and screen-specific audio clips live in:

```text
server/alert/
```

`tone.mp3` is used for alert playback, and supported displays can also use matching screen-specific audio clips from the same directory. Screen audio is optional and can be disabled from the Settings UI.

## Build And Maintenance Notes

This fork tries to stay practical not only at runtime, but also in how it is maintained.

That includes:

* keeping the codebase relatively small and understandable
* avoiding unnecessary build complexity where possible
* trimming or replacing dependencies when the benefit is low
* addressing build-step vulnerabilities instead of ignoring them

Recent cleanup includes removing vulnerable build-only sourcemap tooling from the main build pipeline.

## Motivation

Part of the motivation is simple nostalgia: old Weather Channel presentation still has a very distinct charm.

The other part is more practical. A Linux-friendly, self-hostable retro weather display is still a fun and useful thing to have around, especially when it stays light enough to keep hacking on without turning into an enormous platform project.

## Acknowledgements

This project builds on earlier work from the WeatherStar community and related forks.

Credits and thanks go to:

* [Mike Battaglia](https://github.com/vbguyny/ws4kp) for the original project lineage
* [`netbymatt/ws4kp`](https://github.com/netbymatt/ws4kp) for the upstream base this fork was built from
* [`mwood77/ws4kp-international`](https://github.com/mwood77/ws4kp-international) for proving out the Open-Meteo international direction
* [TWCClassics](https://twcclassics.com/) for WeatherStar reference material, fonts, and icon resources
* the broader WeatherStar community for reference material and ongoing experimentation

## Disclaimer

This project should **not** be relied upon in life-threatening weather situations or as a mission-critical public weather information source.

Internet services fail, upstream data can be delayed, and browser-based applications are not a substitute for dedicated alerting systems.

The WeatherSTAR 4000 name, Weather Channel logo and original technology belong to The Weather Channel. This project is a fan-made, non-commercial recreation and reinterpretation and is not affiliated with or run by the Weather Channel.
