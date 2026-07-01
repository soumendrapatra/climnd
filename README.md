<div align="center">

# 🌏 CLIMIND 2.0
### Historical Pattern Replay Engine — Odisha, India

*"What actually happened the last time conditions were like this?"*

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-black?style=for-the-badge&logo=vercel)](https://your-deployment.vercel.app)
[![Data Source](https://img.shields.io/badge/Data-Open--Meteo%20ERA5-blue?style=for-the-badge)](https://open-meteo.com/)
[![Coverage](https://img.shields.io/badge/Coverage-1994–2025%20·%2030%20Years-green?style=for-the-badge)]()
[![No ML](https://img.shields.io/badge/Engine-No%20ML%20·%20Pure%20Evidence-orange?style=for-the-badge)]()

</div>

---

## 🔍 What is CLIMIND?

**CLIMIND 2.0** is a climate intelligence dashboard that answers a deceptively simple question:

> *When current weather conditions in Odisha match a past period in history — what actually happened next?*

Instead of running machine learning forecasts, CLIMIND searches **11,682 historical weekly windows** spanning 30 years (1994–2025) and surfaces the real-world outcomes — floods, droughts, crop failures — from the periods that most closely match today's conditions.

**No predictions. No models. Just evidence.**

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔴 **Live Weather Matching** | Fetches real-time weather from Open-Meteo and instantly finds the closest historical analogs |
| 🧪 **Scenario Builder** | Adjust temperature, humidity, precipitation, and wind deltas with intuitive sliders |
| 📅 **11,682 Fingerprints** | Weekly climate fingerprints covering every 7-day window from Jan 1994 to Dec 2025 |
| 🌊 **Flood Risk Scoring** | Per-match flood risk scores derived from historical rainfall coefficients |
| 🏜️ **Water Stress Index** | Drought and water stress probability based on historical soil and rainfall patterns |
| 🌾 **Crop Impact Estimates** | Yield impact (%) calibrated to Odisha's regional crop sensitivity coefficients |
| 🗺️ **Interactive District Map** | Leaflet.js map showing simulated regional risk distribution across Odisha's districts |
| 📈 **3 Live Charts** | Outcome distribution, temperature vs precipitation scatter, and parallel coordinate timeline |
| 📍 **Multi-location Support** | Switch between Bhubaneswar, Cuttack, Rourkela, Sambalpur, Berhampur, or Odisha center |

---

## 🧠 How the Engine Works

```
Live Weather (Open-Meteo API)
         │
         ▼
  Apply Scenario Deltas (sliders)
         │
         ▼
  Build Target Vector [temp, humidity, precip, wind]
         │
         ▼
  Weighted Euclidean Distance vs 11,682 Fingerprints
  (weights: temp 40% · humidity 25% · precip 25% · wind 10%)
         │
         ▼
  Rank by Similarity Score [0–100%]
         │
         ▼
  Return Top Matches → Show Real Historical Outcomes
```

The similarity engine uses **normalized, weighted Euclidean distance** in 4-dimensional climate feature space. A temporal confidence score further weights more recent historical periods to reflect climate trend changes over decades.

---

## 🗃️ Data Sources

| Dataset | Source | Coverage |
|---|---|---|
| `climate_fingerprints.json` | Open-Meteo ERA5 Reanalysis | 11,682 weekly windows · 1994–2025 |
| `odisha_historical_30yr.csv` | Open-Meteo ERA5 Daily | 11,688 daily records · 1994–2025 |
| `odisha_districts.geojson` | District boundary data | 30 districts of Odisha |
| `odisha_coefficients.json` | Derived regional calibration | Crop yield & flood risk coefficients |

> 📡 **Live data** is fetched fresh on every page load from the [Open-Meteo free weather API](https://open-meteo.com/) — no API key required.

---

## 🛠️ Tech Stack

```
Frontend:   Vanilla HTML5 · CSS3 · JavaScript (ES2022)
Mapping:    Leaflet.js 1.9.4
Charting:   Chart.js 4.4.0
Tile Layer: CARTO Dark Matter
Weather:    Open-Meteo API (free, no key needed)
Deploy:     Vercel (static hosting)
```

Zero build tools. Zero frameworks. Zero dependencies to install.

---

## 📁 Project Structure

```
PROJECT CLIMIND/
│
├── index.html                      # Main app shell (semantic HTML5)
├── styles.css                      # Full design system — dark mode, glassmorphism
├── app.js                          # All app logic: engine, rendering, charts, map
│
├── data/
│   ├── climate_fingerprints.json   # 11,682 pre-computed weekly climate fingerprints
│   ├── odisha_historical_30yr.csv  # 30-year daily climate records
│   ├── odisha_districts.geojson    # Odisha district boundaries for the map
│   └── odisha_coefficients.json    # Calibrated crop & flood risk coefficients
│
├── scripts/                        # Local Python data-generation scripts (not deployed)
│   ├── fetch_data.py               # Fetches ERA5 data from Open-Meteo
│   ├── generate_fingerprints.py    # Builds the 11,682 fingerprint database
│   ├── extract_coefficients.py     # Derives regional calibration coefficients
│   ├── validate_correlations.py    # Validates fingerprint accuracy
│   └── mock_geojson.py             # Generates district GeoJSON
│
├── vercel.json                     # Vercel static deployment config
├── .gitignore
└── README.md
```

---

## 🚀 Deploy Your Own

### Option 1 — Vercel (Recommended, 1-click)

1. Fork this repo on GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import your fork
3. Framework Preset: **Other** · Leave all build settings blank → **Deploy**

### Option 2 — Run Locally

No installation required. Just open the file:

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

# Serve locally (required to avoid CORS issues with local JSON files)
npx serve .
# → Visit http://localhost:3000
```

> ⚠️ You must use a local server (e.g., `npx serve`, VS Code Live Server, or `python -m http.server`) because the app fetches local JSON files via `fetch()`, which browsers block for `file://` URLs.

---

## 📊 Outcome Scoring Methodology

| Metric | Derivation |
|---|---|
| **Flood Risk (0–100)** | Based on weekly precipitation sum × regional flood coefficient (0.475 per mm above baseline) |
| **Water Stress (0–100)** | Inverse of effective rainfall vs crop water demand in the historical matched period |
| **Crop Impact (%)** | Calibrated yield delta using Odisha coefficient: −1.23% per °C temperature anomaly |
| **Confidence Score (%)** | Weighted average: similarity (50%) + temporal recency (20%) + sample size (30%) |
| **Disaster Classification** | Rule-based: Severe/Moderate Flood · Severe/Moderate Drought · Extreme Heatwave · None |

---

## 🌐 Weather API

**Open-Meteo** — free, open-source weather API. No sign-up or API key required.

```
GET https://api.open-meteo.com/v1/forecast
  ?latitude=20.8
  &longitude=85.8
  &current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m
  &timezone=Asia/Kolkata
```

---

## 🤝 Contributing

Contributions are welcome! Ideas for future versions:

- [ ] Expand coverage to other Indian states (Andhra Pradesh, Chhattisgarh, Jharkhand)
- [ ] Add seasonal crop calendar overlays
- [ ] SMS/email alert system for high-risk pattern matches
- [ ] Historical cyclone track overlay on the map
- [ ] Export matched results as a PDF report

---

## 📄 License

MIT License © 2025

Data sourced from [Open-Meteo](https://open-meteo.com/) under the [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) license.

---

<div align="center">

Built with ❤️ for Odisha · Powered by 30 years of climate evidence

**[Live Demo](https://your-deployment.vercel.app)** · **[Report Bug](https://github.com/YOUR_USERNAME/YOUR_REPO/issues)** · **[Request Feature](https://github.com/YOUR_USERNAME/YOUR_REPO/issues)**

</div>
