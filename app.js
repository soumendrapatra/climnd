/**
 * CLIMIND 2.0 — Historical Pattern Replay Engine
 * Core Application Logic
 * Odisha Climate Time Machine · 1994–2025
 */

'use strict';

// ════════════════════════════════════════════════════════
// 1. GLOBAL STATE
// ════════════════════════════════════════════════════════
const STATE = {
  fingerprints: [],       // All 11,682 climate fingerprints
  currentWeather: null,   // Live fetched current weather
  lastResults: null,      // Last match results
  charts: {},             // Chart.js instances
  dbLoaded: false,
};

// Current scenario deltas (applied on top of live weather)
const SCENARIO = {
  tempDelta:    0,
  humidityDelta:0,
  windDelta:    0,
  precipDelta:  0,
  duration:     7,
};

// ════════════════════════════════════════════════════════
// 2. INITIALIZATION
// ════════════════════════════════════════════════════════
async function init() {
  updateClock();
  setInterval(updateClock, 1000);

  // Load fingerprint DB and current weather in parallel
  const [fpResult, cwResult] = await Promise.allSettled([
    loadFingerprintDatabase(),
    fetchCurrentWeather(),
  ]);

  if (fpResult.status === 'fulfilled') {
    STATE.fingerprints = fpResult.value;
    STATE.dbLoaded = true;
    setEl('db-status', `✓ ${STATE.fingerprints.length.toLocaleString()} weeks`);
    removeClass('db-status', 'loading');
  } else {
    setEl('db-status', '✗ DB Error');
    console.error('Failed to load fingerprints:', fpResult.reason);
  }

  // Initialize UI and charts BEFORE running any auto-match
  wireSliders();
  wireButtons();
  wireLocationSelect();
  initMap();
  initCharts();

  if (cwResult.status === 'fulfilled') {
    STATE.currentWeather = cwResult.value;
    renderCurrentWeather(cwResult.value);
    // Immediately run auto-match using current conditions
    if (STATE.dbLoaded) {
      runAutoMatch();
    }
  } else {
    console.error('Weather fetch failed:', cwResult.reason);
    // Use fallback weather for Odisha in June
    STATE.currentWeather = { temp: 32, humidity: 74, precip: 2, wind: 18 };
    renderCurrentWeather(STATE.currentWeather);
    if (STATE.dbLoaded) runAutoMatch();
  }
}

// ════════════════════════════════════════════════════════
// 3. DATA LOADING
// ════════════════════════════════════════════════════════
async function loadFingerprintDatabase() {
  const response = await fetch('./data/climate_fingerprints.json');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchCurrentWeather(lat = 20.8, lon = 85.8) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m&timezone=Asia%2FKolkata`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Weather API HTTP ${response.status}`);
  const data = await response.json();

  return {
    temp:     data.current.temperature_2m,
    humidity: data.current.relative_humidity_2m,
    precip:   data.current.precipitation,
    wind:     data.current.wind_speed_10m,
  };
}

// ════════════════════════════════════════════════════════
// 4. SIMILARITY ENGINE (Cosine + Euclidean hybrid)
// ════════════════════════════════════════════════════════
/**
 * Given target climate parameters, find the N best-matching
 * historical 7-day fingerprints using a weighted hybrid metric.
 */
function findTopMatches(target, topN = 10) {
  if (!STATE.fingerprints.length) return [];

  // Feature weights: (temp is most important → crop/flood sensitivity)
  const WEIGHTS = {
    temp:     0.40,
    humidity: 0.25,
    precip:   0.25,
    wind:     0.10,
  };

  // Pre-compute target vector and normalization ranges
  const ranges = computeRanges();

  const scored = STATE.fingerprints.map(fp => {
    // Normalize each feature to [0, 1] range
    const tNorm = (target.temp    - ranges.temp.min)    / ranges.temp.range;
    const hNorm = (target.humidity- ranges.hum.min)     / ranges.hum.range;
    const pNorm = (target.precip  - ranges.prec.min)    / ranges.prec.range;
    const wNorm = (target.wind    - ranges.wind.min)    / ranges.wind.range;

    const fTNorm = (fp.temp_avg   - ranges.temp.min)    / ranges.temp.range;
    const fHNorm = (fp.humidity_avg - ranges.hum.min)   / ranges.hum.range;
    const fPNorm = (fp.precip_sum / 7 - ranges.prec.min)/ ranges.prec.range; // per-day avg
    const fWNorm = (fp.wind_avg   - ranges.wind.min)    / ranges.wind.range;

    // Weighted Euclidean distance in normalized space
    const dist = Math.sqrt(
      WEIGHTS.temp    * (tNorm - fTNorm) ** 2 +
      WEIGHTS.humidity* (hNorm - fHNorm) ** 2 +
      WEIGHTS.precip  * (pNorm - fPNorm) ** 2 +
      WEIGHTS.wind    * (wNorm - fWNorm) ** 2
    );

    // Convert distance to similarity score [0, 100]
    const similarity = 100 * Math.max(0, 1 - dist / Math.sqrt(
      WEIGHTS.temp + WEIGHTS.humidity + WEIGHTS.precip + WEIGHTS.wind
    ));

    return { ...fp, similarity: Math.round(similarity * 10) / 10 };
  });

  // Sort by descending similarity and return top N
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topN);
}

// Lazy-compute and cache feature value ranges
let _rangesCache = null;
function computeRanges() {
  if (_rangesCache) return _rangesCache;

  const temps = STATE.fingerprints.map(f => f.temp_avg);
  const hums  = STATE.fingerprints.map(f => f.humidity_avg);
  const precs = STATE.fingerprints.map(f => f.precip_sum / 7);
  const winds = STATE.fingerprints.map(f => f.wind_avg);

  _rangesCache = {
    temp: { min: Math.min(...temps), range: Math.max(...temps) - Math.min(...temps) },
    hum:  { min: Math.min(...hums),  range: Math.max(...hums)  - Math.min(...hums)  },
    prec: { min: Math.min(...precs), range: Math.max(...precs) - Math.min(...precs) },
    wind: { min: Math.min(...winds), range: Math.max(...winds) - Math.min(...winds) },
  };
  return _rangesCache;
}

// ════════════════════════════════════════════════════════
// 5. CONFIDENCE SCORING
// ════════════════════════════════════════════════════════
/**
 * Compute confidence score for a match result.
 * Takes into account: parameter match quality, temporal recency, and sample size
 */
function computeConfidence(similarity, dateEnd, totalSimilarCount) {
  const year = parseInt(dateEnd.slice(0, 4), 10);
  const currentYear = new Date().getFullYear();
  const yearDist = Math.abs(currentYear - year);

  // Temporal weight: more recent = more confident (max 5% penalty per 10 yrs)
  const temporalScore = Math.max(0.70, 1 - (yearDist / 100) * 0.3);

  // Sample size weight: more similar windows = higher confidence
  const sampleScore = Math.min(1.0, totalSimilarCount / 50);

  // Combined confidence
  const confidence = (similarity / 100) * 0.5 + temporalScore * 0.2 + sampleScore * 0.3;
  return Math.round(confidence * 100);
}

// ════════════════════════════════════════════════════════
// 6. SECTOR RECOMMENDATIONS
// ════════════════════════════════════════════════════════
function generateAdvice(avgWaterStress, avgFloodRisk, avgCropImpact, dominantDisaster) {
  const agAdvice = (() => {
    if (avgCropImpact < -30) return '⚠ Severe yield loss expected. Switch to drought/flood-resistant varieties (HYV paddy, millets). Consider staggered planting or crop insurance.';
    if (avgCropImpact < -10) return '⚡ Moderate crop stress likely. Increase irrigation frequency, apply potash to improve stress resistance, monitor for fungal spread.';
    if (avgCropImpact > 0)   return '✓ Favorable conditions for crop growth. Historical periods like this showed above-average yields. Normal operations advised.';
    return '↔ Neutral conditions. Standard irrigation schedule applies. Watch for emerging weather shifts.';
  })();

  const waterAdvice = (() => {
    if (avgWaterStress > 70) return '⚠ Severe water stress. Historical analogs show reservoir drops of 2–3m. Begin water rationing, restrict non-essential water use.';
    if (avgWaterStress > 40) return '⚡ Moderate water stress. Groundwater recharge rate drops. Prioritize irrigation scheduling and avoid deep borings.';
    if (avgFloodRisk > 70)   return '⚠ High flood risk — historical matches show waterlogging and reservoir overflow. Open spillways early, deactivate low-lying tube wells.';
    return '✓ Water availability adequate. Monitor 7-day rolling precipitation for trend shifts.';
  })();

  const disasterAdvice = (() => {
    if (dominantDisaster === 'Severe Flood')    return '🚨 SEVERE FLOOD RISK: Historical analogs triggered major events. Alert all 30 coastal districts. Pre-deploy NDRF units.';
    if (dominantDisaster === 'Moderate Flood')  return '⚠ FLOOD WATCH: Similar past periods saw flash floods in Mahanadi basin. Evacuate low-lying settlements near river banks.';
    if (dominantDisaster === 'Severe Drought')  return '🚨 SEVERE DROUGHT RISK: Extended dry spells like this in history caused multi-district water crises. Activate MGNREGS water conservation projects.';
    if (dominantDisaster === 'Moderate Drought')return '⚠ DROUGHT WATCH: Below-normal rainfall is expected. Pre-position water tankers in Kalahandi, Nuapada, and Bolangir districts.';
    if (dominantDisaster === 'Extreme Heatwave')return '🌡 HEAT EMERGENCY: Similar heatwave conditions historically caused 15–30% excess mortality. Activate cooling centers and heat action plan.';
    return '✓ No major disaster events in historical analogs. Continue normal monitoring protocols.';
  })();

  return { agAdvice, waterAdvice, disasterAdvice };
}

// ════════════════════════════════════════════════════════
// 7. RENDERING
// ════════════════════════════════════════════════════════
function renderCurrentWeather(cw) {
  const sign = n => n > 0 ? `+${n}` : `${n}`;
  setEl('cw-temp',     `${cw.temp.toFixed(1)} °C`);
  setEl('cw-humidity', `${Math.round(cw.humidity)} %`);
  setEl('cw-precip',   `${cw.precip.toFixed(1)} mm`);
  setEl('cw-wind',     `${cw.wind.toFixed(1)} km/h`);

  ['cw-temp','cw-humidity','cw-precip','cw-wind'].forEach(id => removeClass(id, 'loading'));
}

function renderMatches(matches, topN) {
  const container = document.getElementById('matches-container');

  if (!matches || matches.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="es-icon">🔍</div>
      <h3>No Strong Matches Found</h3>
      <p>Try adjusting the sliders to find different historical analogues.</p>
    </div>`;
    return;
  }

  const top = matches.slice(0, topN);
  const totalSimilar = matches.filter(m => m.similarity >= 60).length;

  // Update summary stats
  const avgFlood   = avg(top, m => m.outcomes.flood_risk);
  const avgStress  = avg(top, m => m.outcomes.water_stress);
  const avgCrop    = avg(top, m => m.outcomes.crop_impact);
  const dominantDisaster = top[0]?.outcomes?.disaster_type ?? 'None';

  setEl('stat-matches', totalSimilar > 0 ? totalSimilar : top.length);
  setEl('stat-flood',   `${avgFlood.toFixed(0)}/100`);
  setEl('stat-drought', `${avgStress.toFixed(0)}/100`);
  setEl('stat-crop',    `${avgCrop >= 0 ? '+' : ''}${avgCrop.toFixed(1)}%`);

  document.getElementById('results-badge').textContent = `Top ${top.length} shown`;
  document.getElementById('results-badge').classList.add('active');

  // Render sector cards
  const advice = generateAdvice(avgStress, avgFlood, avgCrop, dominantDisaster);
  setEl('ag-yield-val',    `${avgCrop >= 0 ? '+' : ''}${avgCrop.toFixed(1)}%`);
  setEl('water-stress-val',`${avgStress.toFixed(0)}/100`);
  setEl('flood-risk-val',  `${avgFlood.toFixed(0)}/100`);

  const cropFillPct = Math.min(100, Math.max(0, avgCrop < 0 ? Math.abs(avgCrop) : avgCrop * 2));
  document.getElementById('ag-yield-bar').style.width    = `${cropFillPct}%`;
  document.getElementById('water-stress-bar').style.width = `${Math.min(100, avgStress)}%`;
  document.getElementById('flood-risk-bar').style.width   = `${Math.min(100, avgFlood)}%`;

  setEl('ag-advice',       advice.agAdvice);
  setEl('water-advice',    advice.waterAdvice);
  setEl('disaster-advice', advice.disasterAdvice);

  // Match list HTML
  const rankClass = i => ['r1','r2','r3','r4','r5'][Math.min(i, 4)];
  const sign = n => n > 0 ? `+${n}` : `${n}`;
  const fmtCrop = c => c >= 0 ? `+${c.toFixed(1)}%` : `${c.toFixed(1)}%`;

  const matchHTML = top.map((m, i) => {
    const confidence = computeConfidence(m.similarity, m.date_end, totalSimilar);
    const yearLabel = `${m.date_start.slice(0,4)} — ${m.date_end.slice(0,10)}`;
    const precipDaily = (m.precip_sum / 7).toFixed(1);
    const disasterLabel = m.outcomes.disaster_type !== 'None' ? m.outcomes.disaster_type : 'Normal';
    const animDelay = i * 60;

    return `<div class="match-item" style="animation-delay:${animDelay}ms">
      <div class="match-rank ${rankClass(i)}">#${i+1}</div>
      <div class="match-info">
        <div class="match-dates">${yearLabel} · ${m.similarity.toFixed(1)}% match</div>
        <div class="match-stats">
          <span class="match-stat temp">🌡 ${m.temp_avg.toFixed(1)}°C avg</span>
          <span class="match-stat rain">🌧 ${m.precip_sum.toFixed(0)}mm/wk</span>
          <span class="match-stat hum">💧 ${m.humidity_avg.toFixed(0)}%</span>
          <span class="match-stat wind">💨 ${m.wind_avg.toFixed(1)} km/h</span>
        </div>
        <div class="match-confidence">
          <div class="confidence-bar">
            <div class="confidence-bar-fill" style="width:${confidence}%"></div>
          </div>
          <span>${confidence}% confidence</span>
        </div>
      </div>
      <div class="match-outcomes">
        <div class="outcome-row flood">
          <span class="o-label">Flood risk</span>
          <span class="o-val">${m.outcomes.flood_risk}/100</span>
        </div>
        <div class="outcome-row drought">
          <span class="o-label">Water stress</span>
          <span class="o-val">${m.outcomes.water_stress}/100</span>
        </div>
        <div class="outcome-row crop">
          <span class="o-label">Crop impact</span>
          <span class="o-val">${fmtCrop(m.outcomes.crop_impact)}</span>
        </div>
        <div class="outcome-row disaster">
          <span class="o-val">${disasterLabel}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = `<div class="matches-list">${matchHTML}</div>`;

  STATE.lastResults = top;
  updateMap(top);
  updateCharts(top);
}

// ════════════════════════════════════════════════════════
// 8. GEOGRAPHIC MAP
// ════════════════════════════════════════════════════════
let impactMap = null;
let geojsonLayer = null;

async function initMap() {
  impactMap = L.map('impact-map').setView([20.9517, 85.0985], 6); // Odisha center
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
  }).addTo(impactMap);

  try {
    const res = await fetch('./data/odisha_districts.geojson');
    const geojsonData = await res.json();
    
    geojsonLayer = L.geoJSON(geojsonData, {
      style: {
        color: '#444',
        weight: 1,
        fillColor: '#222',
        fillOpacity: 0.7
      }
    }).addTo(impactMap);
  } catch (err) {
    console.error('Error loading geojson:', err);
  }
}

function updateMap(matches) {
  if (!geojsonLayer || matches.length === 0) return;
  
  const avgFlood   = matches.reduce((acc, m) => acc + m.outcomes.flood_risk, 0) / matches.length;
  const avgStress  = matches.reduce((acc, m) => acc + m.outcomes.water_stress, 0) / matches.length;

  geojsonLayer.eachLayer(layer => {
    // Simulate region-specific impacts based on overall match averages
    const region = layer.feature.properties.region || 'unknown';
    let riskScore = 0;
    
    if (region === 'coastal') {
      riskScore = avgFlood * 1.2; // Coastal areas more prone to flood
    } else if (region === 'western') {
      riskScore = avgStress * 1.2; // Western areas more prone to drought
    } else {
      riskScore = (avgFlood + avgStress) / 2;
    }
    
    // Color scale: low (green/blue) -> high (red/orange)
    let color = '#222';
    if (riskScore > 70) color = '#ef4444';      // Red
    else if (riskScore > 40) color = '#f97316'; // Orange
    else if (riskScore > 20) color = '#eab308'; // Yellow
    else color = '#3b82f6';                     // Blue
    
    layer.setStyle({
      fillColor: color,
      fillOpacity: 0.7,
      color: '#ffffff',
      weight: 1
    });
    
    const riskType = (region === 'coastal') ? 'Flood Risk' : (region === 'western' ? 'Drought Risk' : 'Combined Risk');
    layer.bindTooltip(`<b>${layer.feature.properties.name}</b><br/>${riskType}: ${Math.min(100, riskScore).toFixed(0)}/100`);
  });
}

// ════════════════════════════════════════════════════════
// 9. CHARTS
// ════════════════════════════════════════════════════════
function initCharts() {
  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: 'hsl(220, 15%, 65%)', font: { family: 'Outfit', size: 11 } }
      }
    },
  };

  // Outcomes bar chart
  const ctx1 = document.getElementById('chart-outcomes').getContext('2d');
  STATE.charts.outcomes = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: ['Flood Risk', 'Water Stress', 'Crop Loss'],
      datasets: [{
        label: 'Average Score',
        data: [0, 0, 0],
        backgroundColor: [
          'hsla(32, 95%, 58%, 0.75)',
          'hsla(210, 100%, 60%, 0.75)',
          'hsla(355, 90%, 58%, 0.75)',
        ],
        borderColor: [
          'hsl(32, 95%, 58%)',
          'hsl(210, 100%, 60%)',
          'hsl(355, 90%, 58%)',
        ],
        borderWidth: 1,
        borderRadius: 6,
      }],
    },
    options: {
      ...chartDefaults,
      scales: {
        x: {
          ticks: { color: 'hsl(220, 15%, 55%)', font: { family: 'Outfit' } },
          grid: { color: 'hsla(220, 20%, 100%, 0.05)' },
        },
        y: {
          min: 0, max: 100,
          ticks: { color: 'hsl(220, 15%, 55%)', font: { family: 'Outfit' } },
          grid: { color: 'hsla(220, 20%, 100%, 0.05)' },
        },
      },
    },
  });

  // Scatter: temp vs precip
  const ctx2 = document.getElementById('chart-scatter').getContext('2d');
  STATE.charts.scatter = new Chart(ctx2, {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Matched periods',
        data: [],
        backgroundColor: 'hsla(175, 80%, 50%, 0.5)',
        borderColor: 'hsl(175, 80%, 50%)',
        pointRadius: 7,
        pointHoverRadius: 10,
      }],
    },
    options: {
      ...chartDefaults,
      scales: {
        x: {
          title: { display: true, text: 'Avg Temperature (°C)', color: 'hsl(220, 15%, 55%)', font: { family: 'Outfit' } },
          ticks: { color: 'hsl(220, 15%, 55%)', font: { family: 'Outfit' } },
          grid: { color: 'hsla(220, 20%, 100%, 0.05)' },
        },
        y: {
          title: { display: true, text: 'Weekly Precipitation (mm)', color: 'hsl(220, 15%, 55%)', font: { family: 'Outfit' } },
          ticks: { color: 'hsl(220, 15%, 55%)', font: { family: 'Outfit' } },
          grid: { color: 'hsla(220, 20%, 100%, 0.05)' },
        },
      },
      plugins: {
        ...chartDefaults.plugins,
        tooltip: {
          callbacks: {
            label: ctx => {
              const m = ctx.raw;
              return `${m.dateLabel}: ${m.x.toFixed(1)}°C, ${m.y.toFixed(0)}mm`;
            },
          },
        },
      },
    },
  });

  // Timeline/Parallel Coordinate Chart
  const ctx3 = document.getElementById('chart-timeline').getContext('2d');
  STATE.charts.timeline = new Chart(ctx3, {
    type: 'line',
    data: {
      labels: ['Avg Temp', 'Humidity', 'Precipitation', 'Wind Speed'],
      datasets: []
    },
    options: {
      ...chartDefaults,
      scales: {
        y: {
          min: 0, max: 100,
          title: { display: true, text: 'Normalized Range (%)', color: 'hsl(220, 15%, 55%)' },
          ticks: { color: 'hsl(220, 15%, 55%)', font: { family: 'Outfit' } },
          grid: { color: 'hsla(220, 20%, 100%, 0.05)' },
        },
        x: {
          ticks: { color: 'hsl(220, 15%, 55%)', font: { family: 'Outfit' } },
          grid: { color: 'hsla(220, 20%, 100%, 0.05)' },
        }
      },
      elements: { line: { tension: 0.3 } },
    }
  });
}

function updateCharts(matches) {
  if (!matches || !matches.length) return;

  // Update bar chart
  const avgFlood  = avg(matches, m => m.outcomes.flood_risk);
  const avgStress = avg(matches, m => m.outcomes.water_stress);
  const avgCrop   = avg(matches, m => Math.abs(Math.min(0, m.outcomes.crop_impact) * (100/45)));

  const outChart = STATE.charts.outcomes;
  outChart.data.datasets[0].data = [avgFlood, avgStress, avgCrop];
  outChart.update({ duration: 600, easing: 'easeInOutQuart' });

  // Update scatter chart
  const scatterData = matches.map(m => ({
    x: m.temp_avg,
    y: m.precip_sum,
    dateLabel: m.date_start.slice(0, 7),
  }));
  const scChart = STATE.charts.scatter;
  scChart.data.datasets[0].data = scatterData;
  scChart.update({ duration: 600, easing: 'easeInOutQuart' });

  // Update timeline chart
  const cw = STATE.currentWeather;
  if (cw) {
    const ranges = computeRanges();
    const currentTarget = {
      temp: cw.temp + SCENARIO.tempDelta,
      humidity: cw.humidity + SCENARIO.humidityDelta,
      wind: cw.wind + SCENARIO.windDelta,
      precip: (cw.precip * 7) + SCENARIO.precipDelta
    };
    
    const datasets = [];
    
    datasets.push({
      label: 'Current Scenario',
      data: [
        ((currentTarget.temp - ranges.temp.min) / ranges.temp.range) * 100,
        ((currentTarget.humidity - ranges.hum.min) / ranges.hum.range) * 100,
        ((currentTarget.precip / 7 - ranges.prec.min) / ranges.prec.range) * 100,
        ((currentTarget.wind - ranges.wind.min) / ranges.wind.range) * 100
      ],
      borderColor: 'hsl(140, 100%, 60%)',
      backgroundColor: 'transparent',
      borderWidth: 3,
      borderDash: [5, 5]
    });
    
    const colors = ['hsl(210, 100%, 60%)', 'hsl(32, 95%, 58%)', 'hsl(280, 80%, 60%)'];
    matches.slice(0, 3).forEach((m, i) => {
      datasets.push({
        label: `Match #${i+1} (${m.date_start.slice(0,4)})`,
        data: [
          ((m.temp_avg - ranges.temp.min) / ranges.temp.range) * 100,
          ((m.humidity_avg - ranges.hum.min) / ranges.hum.range) * 100,
          (( (m.precip_sum/7) - ranges.prec.min) / ranges.prec.range) * 100,
          ((m.wind_avg - ranges.wind.min) / ranges.wind.range) * 100
        ],
        borderColor: colors[i],
        backgroundColor: 'transparent',
        borderWidth: 2
      });
    });

    STATE.charts.timeline.data.datasets = datasets;
    STATE.charts.timeline.update({ duration: 600, easing: 'easeInOutQuart' });
  }
}

// ════════════════════════════════════════════════════════
// 9. USER INTERACTIONS
// ════════════════════════════════════════════════════════
function wireSliders() {
  const sliders = [
    { id: 'slider-temp',     valId: 'val-temp',     key: 'tempDelta',     fmt: v => `${v > 0 ? '+' : ''}${parseFloat(v).toFixed(1)} °C` },
    { id: 'slider-humidity', valId: 'val-humidity', key: 'humidityDelta', fmt: v => `${v > 0 ? '+' : ''}${parseInt(v)} %` },
    { id: 'slider-wind',     valId: 'val-wind',     key: 'windDelta',     fmt: v => `${v > 0 ? '+' : ''}${parseFloat(v).toFixed(1)} km/h` },
    { id: 'slider-precip',   valId: 'val-precip',   key: 'precipDelta',   fmt: v => `${v > 0 ? '+' : ''}${parseInt(v)} mm` },
    { id: 'slider-duration', valId: 'val-duration', key: 'duration',      fmt: v => `${parseInt(v)} days` },
  ];

  sliders.forEach(({ id, valId, key, fmt }) => {
    const el = document.getElementById(id);
    const valEl = document.getElementById(valId);

    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      SCENARIO[key] = v;
      valEl.textContent = fmt(v);

      // Color-code value label
      valEl.classList.remove('positive', 'negative', 'neutral');
      if (key !== 'duration') {
        if (v > 0) valEl.classList.add('positive');
        else if (v < 0) valEl.classList.add('negative');
        else valEl.classList.add('neutral');
      }
    });
  });
}

function wireLocationSelect() {
  const select = document.getElementById('location-select');
  if (!select) return;
  select.addEventListener('change', async (e) => {
    const [lat, lon] = e.target.value.split(',');
    
    // Visual feedback
    setEl('cw-match', 'Loading...');
    document.getElementById('cw-match').classList.add('loading');
    
    try {
      const data = await fetchCurrentWeather(lat, lon);
      STATE.currentWeather = data;
      renderCurrentWeather(data);
      if (STATE.dbLoaded) runAutoMatch();
    } catch (err) {
      console.error('Failed to fetch new location weather:', err);
    }
  });
}

function wireButtons() {
  document.getElementById('btn-run').addEventListener('click', runScenario);
  document.getElementById('btn-reset').addEventListener('click', resetScenario);
}

function runScenario() {
  if (!STATE.dbLoaded || !STATE.currentWeather) return;

  const btn = document.getElementById('btn-run');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> <span>Searching 11,682 windows…</span>`;

  // Yield to browser for repaint
  requestAnimationFrame(() => setTimeout(() => {
    const cw = STATE.currentWeather;
    const target = {
      temp:     cw.temp     + SCENARIO.tempDelta,
      humidity: cw.humidity + SCENARIO.humidityDelta,
      wind:     cw.wind     + SCENARIO.windDelta,
      precip:   (cw.precip * 7) + SCENARIO.precipDelta, // Convert daily to weekly
    };

    const matches = findTopMatches(target, 10);
    renderMatches(matches, 5);

    const matchCount = matches.filter(m => m.similarity >= 60).length;
    setEl('match-count-badge', `${matchCount} matches`);
    document.getElementById('match-count-badge').classList.add('active');

    btn.disabled = false;
    btn.innerHTML = `<span>🔍</span> <span>Find Historical Matches</span>`;
  }, 50));
}

function resetScenario() {
  document.getElementById('slider-temp').value = 0;
  document.getElementById('slider-humidity').value = 0;
  document.getElementById('slider-wind').value = 0;
  document.getElementById('slider-precip').value = 0;
  document.getElementById('slider-duration').value = 7;

  setEl('val-temp',     '0.0 °C');
  setEl('val-humidity', '0 %');
  setEl('val-wind',     '0.0 km/h');
  setEl('val-precip',   '0 mm');
  setEl('val-duration', '7 days');

  ['val-temp','val-humidity','val-wind','val-precip'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.remove('positive','negative');
    el.classList.add('neutral');
  });

  Object.keys(SCENARIO).forEach(k => { SCENARIO[k] = k === 'duration' ? 7 : 0; });

  // Re-run auto-match with current conditions
  if (STATE.dbLoaded && STATE.currentWeather) runAutoMatch();
}

function runAutoMatch() {
  const cw = STATE.currentWeather;
  const target = {
    temp:     cw.temp,
    humidity: cw.humidity,
    wind:     cw.wind,
    precip:   cw.precip * 7,
  };

  const matches = findTopMatches(target, 10);

  // Show best match year in the weather bar
  if (matches.length > 0) {
    const best = matches[0];
    const year = best.date_start.slice(0, 4);
    setEl('cw-match', `≈ ${year} (${best.similarity.toFixed(0)}%)`);
    removeClass('cw-match', 'loading');
  }

  renderMatches(matches, 5);
  setEl('match-count-badge', 'Live Match');
}

// ════════════════════════════════════════════════════════
// 10. UTILITIES
// ════════════════════════════════════════════════════════
function updateClock() {
  const now = new Date();
  const options = { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' };
  document.getElementById('live-time').textContent = now.toLocaleTimeString('en-IN', options) + ' IST';
}

function setEl(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function removeClass(id, cls) {
  const el = document.getElementById(id);
  if (el) el.classList.remove(cls);
}

function avg(arr, fn) {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + fn(x), 0) / arr.length;
}

// ════════════════════════════════════════════════════════
// 11. BOOTSTRAP
// ════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', init);
