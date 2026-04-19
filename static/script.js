/* ============================================================
   SafeRoute AI — Professional Frontend v2
   Full rewrite with correct API response mapping,
   polyline rendering, district/trends, and polish.
   ============================================================ */

// ── MAP INIT ──
const map = L.map('map', { zoomControl: false, attributionControl: true })
    .setView([19.7515, 75.7139], 7);

L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
}).addTo(map);

// ── LAYER GROUPS ──
const layers = {
    accidents:    L.layerGroup().addTo(map),
    potholes:     L.layerGroup().addTo(map),
    intersections:L.layerGroup().addTo(map),
    hazards:      L.layerGroup().addTo(map),
    blackSpots:   L.layerGroup().addTo(map),
    routes:       L.layerGroup().addTo(map),
    cityLabels:   L.layerGroup().addTo(map),
};

let heat = { accidents: null, hazards: null, combined: null };
let lastHeatPts = { accidents: [], hazards: [] };

// ── STATE ──
let isReporting       = false;
let selectedHazardType = 'pothole';
let carMarker          = null;
let routePolylines     = [];
let routeLegendCtrl    = null;
let demoRunning        = false;
let demoIdx            = 0;
let demoTimer          = null;
let trendsChart        = null;
let liveInterval       = null;

// ── DEMO SEQUENCE ──
const DEMO_STEPS = [
    { name: 'Mumbai',     lat: 19.0760, lng: 72.8777, msg: 'Mumbai: Dense urban traffic with high accident history' },
    { name: 'Pune',       lat: 18.5204, lng: 73.8567, msg: 'Pune: IT corridor — moderate risk with peak-hour spikes' },
    { name: 'Nashik',     lat: 19.9975, lng: 73.7898, msg: 'Nashik: Highway junction — pothole risk after monsoon' },
    { name: 'Nagpur',     lat: 21.1458, lng: 79.0882, msg: 'Nagpur: Central India interchange — mixed road quality' },
    { name: 'Aurangabad', lat: 19.8762, lng: 75.3433, msg: 'Aurangabad: Heritage city with aging road infrastructure' },
];

const CITY_LIST = [
    { name: 'Mumbai',     lat: 19.0760, lng: 72.8777 },
    { name: 'Pune',       lat: 18.5204, lng: 73.8567 },
    { name: 'Thane',      lat: 19.2183, lng: 72.9781 },
    { name: 'Nashik',     lat: 19.9975, lng: 73.7898 },
    { name: 'Nagpur',     lat: 21.1458, lng: 79.0882 },
    { name: 'Aurangabad', lat: 19.8762, lng: 75.3433 },
    { name: 'Navi Mumbai',lat: 19.0330, lng: 73.0297 },
    { name: 'Kolhapur',   lat: 16.7050, lng: 74.2433 },
    { name: 'Solapur',    lat: 17.6599, lng: 75.9064 },
    { name: 'Vashi',      lat: 19.0771, lng: 72.9986 },
];

// ══════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════

function setLoading(on) {
    const el = document.getElementById('loading-indicator');
    if (el) el.style.display = on ? 'flex' : 'none';
}

function setText(id, val, fb = '--') {
    const el = document.getElementById(id);
    if (el) el.textContent = (val !== null && val !== undefined && val !== '') ? val : fb;
}

function show(id) { const e = document.getElementById(id); if (e) e.style.display = ''; }
function hide(id) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
function showBlock(id) { const e = document.getElementById(id); if (e) e.style.display = 'block'; }

function toast(msg, type = 'info', duration = 3000) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, duration);
}

function riskClass(level) {
    const l = (level || '').toLowerCase();
    if (l.includes('high'))   return 'high';
    if (l.includes('medium') || l.includes('med')) return 'medium';
    return 'low';
}

function riskColor(level) {
    const c = riskClass(level);
    return c === 'high' ? '#ef4444' : c === 'medium' ? '#eab308' : '#22c55e';
}

// ══════════════════════════════════════════════════════
//  RIBBON STATUS
// ══════════════════════════════════════════════════════

function setRibbon(type, text) {
    const ribbon = document.getElementById('alert-ribbon');
    const badge  = document.getElementById('ribbon-badge');
    const rtxt   = document.getElementById('ribbon-text');
    if (!ribbon || !badge || !rtxt) return;

    const styles = {
        critical: { bg: 'rgba(127,29,29,0.9)',   badgeCls: 'critical', label: 'CRITICAL' },
        warning:  { bg: 'rgba(120,53,15,0.9)',   badgeCls: 'warn',     label: 'WARNING'  },
        safe:     { bg: 'rgba(5,46,22,0.85)',    badgeCls: '',          label: 'SAFE'     },
        live:     { bg: 'rgba(10,22,40,0.9)',    badgeCls: '',          label: 'LIVE'     },
    };
    const s = styles[type] || styles.live;
    ribbon.style.background = s.bg;
    badge.className = 'ribbon-badge' + (s.badgeCls ? ' ' + s.badgeCls : '');
    badge.textContent = s.label;
    rtxt.textContent  = text || 'Live monitoring active.';
}

// ══════════════════════════════════════════════════════
//  SVG GAUGE
// ══════════════════════════════════════════════════════

function updateGauge(confidence, riskLevel) {
    const arc   = document.getElementById('gauge-arc');
    const label = document.getElementById('gauge-pct');
    if (!arc || !label) return;
    const TOTAL  = 157;
    const offset = TOTAL - ((Math.min(100, Math.max(0, confidence)) / 100) * TOTAL);
    const color  = riskColor(riskLevel);
    arc.style.strokeDashoffset = offset;
    arc.style.stroke           = color;
    label.textContent           = Math.round(confidence) + '%';
    label.setAttribute('fill', color);
}

// ══════════════════════════════════════════════════════
//  RISK CARD
// ══════════════════════════════════════════════════════

function updateRiskCard(data, locationName) {
    const level  = data.risk_level   || 'Unknown';
    const conf   = data.confidence   || data.probability || 0;
    const safety = data.safety_score || 0;
    const ctx    = data.context_used || {};
    const stats  = data.nearby_stats || {};

    // Badge
    const badge = document.getElementById('risk-level-badge');
    if (badge) { badge.textContent = level; badge.className = `risk-level-badge ${riskClass(level)}`; }

    // Location
    const loc = locationName || (stats.city ? `${stats.city}, ${stats.district}` : 'Unknown');
    setText('risk-location', loc);

    // Gauge
    updateGauge(conf, level);

    // Safety bar
    const bar = document.getElementById('safety-bar');
    if (bar) {
        const pct = Math.max(0, Math.min(100, safety));
        bar.style.width      = `${pct}%`;
        bar.style.background = pct >= 70 ? '#22c55e' : pct >= 45 ? '#eab308' : '#ef4444';
    }
    setText('safety-score-val', `${safety}/100`);

    // Model badge
    const mm = (ctx.model_mode || '').includes('ensemble') ? 'Ensemble ML' : 'Single Model';
    setText('model-badge', mm);

    // Weather + time in nav bar
    const weather = ctx.weather || 'clear';
    document.getElementById('weather-icon').textContent  = weather === 'rain' ? '🌧️' : '☀️';
    setText('weather-label', weather === 'rain' ? 'Raining' : 'Clear');
    const timeMap = { '1': 'Morning', '2': 'Afternoon', '3': 'Evening', '4': 'Night', 'auto': 'Day' };
    setText('time-label', timeMap[String(ctx.time_mode)] || 'Day');

    // Stats bar location
    const statLoc = stats.city ? `${stats.city}, ${stats.district}` : loc;
    setText('current-location', statLoc);

    // Nav status pulse colour
    const dot = document.getElementById('pulse-dot');
    if (dot) dot.style.background = riskColor(level);
}

// ══════════════════════════════════════════════════════
//  EXPLAINABLE AI REASONS
// ══════════════════════════════════════════════════════

const REASON_MAP = [
    { kw: ['accident', 'hotspot'],         icon: '🚨', cls: 'reason-high'    },
    { kw: ['black spot', 'blackspot'],     icon: '⛔', cls: 'reason-high'    },
    { kw: ['pothole', 'potholes'],         icon: '🕳️', cls: 'reason-medium'  },
    { kw: ['intersection'],                icon: '🔀', cls: 'reason-medium'  },
    { kw: ['traffic', 'density'],          icon: '🚦', cls: 'reason-medium'  },
    { kw: ['hazard', 'reported'],          icon: '⚠️', cls: 'reason-medium'  },
    { kw: ['rain', 'wet', 'braking'],      icon: '🌧️', cls: 'reason-medium'  },
    { kw: ['night', 'visibility'],         icon: '🌙', cls: 'reason-medium'  },
    { kw: ['stable', 'safe', 'relatively'],icon: '✅', cls: 'reason-low'     },
];

function classifyReason(text) {
    const t = text.toLowerCase();
    for (const { kw, icon, cls } of REASON_MAP) {
        if (kw.some(k => t.includes(k))) return { icon, cls };
    }
    return { icon: 'ℹ️', cls: 'reason-neutral' };
}

function updateReasons(data) {
    const list    = document.getElementById('reasons-list');
    const reasons = (data.reasons || data.top_reasons || []).filter(Boolean);
    if (!list) return;

    if (!reasons.length) {
        list.innerHTML = '<li class="reason-item reason-neutral"><span class="reason-icon">ℹ️</span>No specific risk factors identified at this location.</li>';
    } else {
        list.innerHTML = reasons.map(r => {
            const { icon, cls } = classifyReason(r);
            return `<li class="reason-item ${cls}"><span class="reason-icon">${icon}</span>${r}</li>`;
        }).join('');
    }

    // Action recommendation
    const abox = document.getElementById('action-box');
    const arec = document.getElementById('action-recommendation');
    if (data.action_recommendation && arec && abox) {
        arec.textContent    = data.action_recommendation;
        abox.style.display  = 'flex';
    } else if (abox) {
        abox.style.display = 'none';
    }

    // User summary
    const usum = document.getElementById('user-summary');
    if (usum) {
        if (data.user_summary) {
            usum.textContent    = data.user_summary;
            usum.style.display  = 'block';
        } else {
            usum.style.display = 'none';
        }
    }
}

// ══════════════════════════════════════════════════════
//  CONTRIBUTION BARS
// ══════════════════════════════════════════════════════

const CONTRIB_COLORS = {
    'Accident Density': '#ef4444',
    'Potholes':         '#f97316',
    'Traffic':          '#eab308',
    'Hazards':          '#a78bfa',
    'Black Spots':      '#dc2626',
    'Weather':          '#38bdf8',
    'Time':             '#64748b',
};

function updateContribBars(contributions) {
    const el    = document.getElementById('contrib-bars');
    const panel = document.getElementById('contrib-panel');
    if (!el || !contributions || !Object.keys(contributions).length) {
        if (panel) panel.style.display = 'none';
        return;
    }
    const sorted = Object.entries(contributions).sort((a, b) => b[1] - a[1]);
    el.innerHTML = sorted.map(([k, v]) => {
        const color = CONTRIB_COLORS[k] || '#3b82f6';
        return `<div class="contrib-row">
            <span class="contrib-label" title="${k}">${k}</span>
            <div class="contrib-track">
                <div class="contrib-fill" style="width:${Math.min(100,v)}%;background:${color}"></div>
            </div>
            <span class="contrib-pct">${v}%</span>
        </div>`;
    }).join('');
    if (panel) panel.style.display = 'block';
}

// ══════════════════════════════════════════════════════
//  NEARBY STATS PANEL
// ══════════════════════════════════════════════════════

function updateNearbyPanel(data) {
    const panel = document.getElementById('nearby-panel');
    const grid  = document.getElementById('nearby-stats-grid');
    if (!panel || !grid) return;
    const s = data.nearby_stats || {};

    const chips = [
        { val: s.nearby_accidents    ?? '—', lbl: 'Accidents'     },
        { val: s.nearby_potholes     ?? '—', lbl: 'Potholes'      },
        { val: s.nearby_intersections ?? '—', lbl: 'Intersections' },
        { val: s.nearby_hazards      ?? '—', lbl: 'Hazards'       },
        { val: s.traffic_density     ?? '—', lbl: 'Traffic %'     },
        { val: data.safety_score     ?? '—', lbl: 'Safety Score'  },
    ];

    grid.innerHTML = chips.map(({ val, lbl }) =>
        `<div class="stat-chip">
            <span class="stat-chip-val">${val}</span>
            <span class="stat-chip-label">${lbl}</span>
        </div>`
    ).join('');

    panel.style.display = 'block';

    // Safe zone suggestion
    const szBox  = document.getElementById('safe-zone-box');
    const szText = document.getElementById('safe-zone-text');
    if (data.safe_zone && szBox && szText) {
        szText.textContent  = `${data.safe_zone.city}, ${data.safe_zone.district} — Safety: ${data.safe_zone.safety_score}/100`;
        szBox.style.display = 'flex';
    } else if (szBox) {
        szBox.style.display = 'none';
    }
}

// ══════════════════════════════════════════════════════
//  EMERGENCY PANEL
// ══════════════════════════════════════════════════════

function updateEmergencyPanel(emg) {
    const panel = document.getElementById('emergency-panel');
    const list  = document.getElementById('emergency-list');
    if (!panel || !list) return;

    const items = [
        { key: 'hospital',       icon: '🏥', label: 'Hospital'       },
        { key: 'police_station', icon: '👮', label: 'Police Station' },
    ];

    let html = '';
    items.forEach(({ key, icon, label }) => {
        const e = emg[key];
        if (e && e.name && e.name !== 'N/A') {
            html += `<div class="emergency-item">
                <span class="emg-icon">${icon}</span>
                <div>
                    <div class="emg-name">${e.name}</div>
                    <div class="emg-dist">${e.distance_km ? e.distance_km.toFixed(1) + ' km away' : ''} ${e.eta_minutes ? '· ~' + e.eta_minutes + ' min' : ''}</div>
                </div>
            </div>`;
        }
    });

    if (html) { list.innerHTML = html; panel.style.display = 'block'; }
    else panel.style.display = 'none';
}

// ══════════════════════════════════════════════════════
//  MAIN PREDICTION
// ══════════════════════════════════════════════════════

async function runPrediction(lat, lng, locationName) {
    setLoading(true);
    try {
        const res  = await fetch('/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lng, weather: 'auto', time_mode: 'auto' })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        updateRiskCard(data, locationName);
        updateReasons(data);
        updateContribBars(data.risk_contributions);
        updateNearbyPanel(data);
        placeRiskMarker(lat, lng, data, locationName);

        if (data.emergency) updateEmergencyPanel(data.emergency);

        // Alert ribbon
        const lvl  = data.risk_level || '';
        const conf = Math.round(data.confidence || 0);
        const r0   = (data.reasons || [])[0] || '';
        if (lvl.includes('High')) {
            setRibbon('critical', `HIGH RISK — ${locationName} · Confidence: ${conf}%${r0 ? ' · ' + r0 : ''}`);
        } else if (lvl.includes('Medium')) {
            setRibbon('warning', `MEDIUM RISK — ${locationName} · Confidence: ${conf}% · Proceed with caution.`);
        } else {
            setRibbon('safe', `LOW RISK — ${locationName} · Confidence: ${conf}% · Safe conditions detected.`);
        }

        await refreshStats();
    } catch (err) {
        toast('Prediction failed — check server is running.', 'error');
        console.error('Prediction error:', err);
    } finally {
        setLoading(false);
    }
}

// ══════════════════════════════════════════════════════
//  RISK MARKER
// ══════════════════════════════════════════════════════

function placeRiskMarker(lat, lng, data, locationName) {
    const level = data.risk_level || 'Low Risk';
    const conf  = Math.round(data.confidence || 0);
    const color = riskColor(level);
    const rc    = riskClass(level);

    const html = `<div style="position:relative;width:42px;height:42px;">
        <div style="position:absolute;inset:0;border-radius:50%;border:3px solid ${color};opacity:0.5;animation:ring-pulse 2s ease-out infinite;"></div>
        <div style="position:absolute;inset:5px;border-radius:50%;background:${color}20;border:2.5px solid ${color};display:flex;align-items:center;justify-content:center;">
            <span style="font-size:10px;font-weight:700;color:${color};font-family:monospace;line-height:1;">${conf}%</span>
        </div>
    </div>`;

    const icon = L.divIcon({ html, className: '', iconSize: [42, 42], iconAnchor: [21, 21] });
    if (carMarker) map.removeLayer(carMarker);
    carMarker = L.marker([lat, lng], { icon, zIndexOffset: 500 }).addTo(map);
    carMarker.bindPopup(
        `<b style="color:${color}">${level}</b><br>
        ${locationName || ''}<br>
        Confidence: ${conf}%<br>
        Safety: ${data.safety_score || '--'}/100`
    ).openPopup();
    map.flyTo([lat, lng], Math.max(map.getZoom(), 12), { duration: 1.1 });
}

// ══════════════════════════════════════════════════════
//  STATE DATA + HEATMAPS
// ══════════════════════════════════════════════════════

async function refreshStats() {
    try {
        const data = await fetch('/get_state_data').then(r => r.json());

        // Stats bar
        setText('stat-accidents',  data.total_accidents  ?? '—');
        setText('stat-potholes',   data.total_potholes   ?? '—');
        setText('stat-hazards',    data.total_hazards    ?? '—');
        setText('stat-blackspots', data.black_spots       ?? '—');

        // Map markers
        renderMarkers(data);

        // Heat points from structured data
        lastHeatPts.accidents = (data.accidents || []).map(a =>
            [a.latitude, a.longitude, Math.min((a.accident_count || 1) / 20, 1)]
        );
        lastHeatPts.hazards = (data.hazards || []).map(h => [h.latitude, h.longitude, 0.6]);

        renderHeatLayers();
    } catch (err) {
        console.error('Stats error:', err);
    }
}

function renderMarkers(data) {
    layers.accidents.clearLayers();
    layers.potholes.clearLayers();
    layers.intersections.clearLayers();
    layers.hazards.clearLayers();
    layers.blackSpots.clearLayers();

    (data.accidents || []).forEach(a => {
        const cnt = a.accident_count || 1;
        const r   = Math.min(4 + cnt * 0.45, 14);
        const isBS = cnt >= 12;
        const color = isBS ? '#7f1d1d' : '#ef4444';
        const m = L.circleMarker([a.latitude, a.longitude], {
            radius: r, fillColor: color, color, weight: 1.5, opacity: 0.8, fillOpacity: 0.45
        });
        m.bindPopup(`<b>${isBS ? '⛔ Black Spot' : '🚨 Accident Zone'}</b><br>Count: ${cnt}<br>City: ${a.city || ''}`);
        (isBS ? layers.blackSpots : layers.accidents).addLayer(m);
    });

    (data.potholes || []).forEach(p => {
        const m = L.circleMarker([p.latitude, p.longitude], {
            radius: 4, fillColor: '#f97316', color: '#f97316', weight: 1, opacity: 0.8, fillOpacity: 0.5
        });
        m.bindPopup(`<b>🕳️ Pothole Zone</b><br>Count: ${p.pothole_count || 1}<br>City: ${p.city || ''}`);
        layers.potholes.addLayer(m);
    });

    (data.intersections || []).forEach(i => {
        const m = L.circleMarker([i.latitude, i.longitude], {
            radius: 3.5, fillColor: '#eab308', color: '#eab308', weight: 1, opacity: 0.7, fillOpacity: 0.45
        });
        m.bindPopup(`<b>🔀 Intersection</b><br>Traffic: ${i.traffic_density || '--'}`);
        layers.intersections.addLayer(m);
    });

    (data.hazards || []).forEach(h => {
        const icon = L.divIcon({
            html: `<div style="width:8px;height:8px;border-radius:50%;background:#3b82f6;border:2px solid #93c5fd;box-shadow:0 0 0 3px rgba(59,130,246,0.2);"></div>`,
            className: '', iconSize: [8, 8], iconAnchor: [4, 4]
        });
        const m = L.marker([h.latitude, h.longitude], { icon });
        m.bindPopup(`<b>⚠️ ${h.hazard_type || 'Hazard'}</b><br>${h.city || ''}<br>${h.description || ''}`);
        layers.hazards.addLayer(m);
    });
}

function renderHeatLayers() {
    if (heat.accidents) { map.removeLayer(heat.accidents); heat.accidents = null; }
    if (heat.hazards)   { map.removeLayer(heat.hazards);   heat.hazards   = null; }
    if (heat.combined)  { map.removeLayer(heat.combined);  heat.combined  = null; }

    const accOn  = document.getElementById('acc-heat')?.checked;
    const hazOn  = document.getElementById('haz-heat')?.checked;
    const combOn = document.getElementById('comb-heat')?.checked;

    if (accOn && lastHeatPts.accidents.length) {
        heat.accidents = L.heatLayer(lastHeatPts.accidents, {
            radius: 30, blur: 20, maxZoom: 15,
            gradient: { 0.3: '#fbbf24', 0.6: '#f97316', 1.0: '#ef4444' }
        }).addTo(map);
    }
    if (hazOn && lastHeatPts.hazards.length) {
        heat.hazards = L.heatLayer(lastHeatPts.hazards, {
            radius: 26, blur: 18, maxZoom: 15,
            gradient: { 0.4: '#818cf8', 0.8: '#6366f1', 1.0: '#4f46e5' }
        }).addTo(map);
    }
    if (combOn) {
        const pts = [...lastHeatPts.accidents, ...lastHeatPts.hazards];
        if (pts.length) {
            heat.combined = L.heatLayer(pts, {
                radius: 32, blur: 22, maxZoom: 15,
                gradient: { 0.2: '#22c55e', 0.5: '#eab308', 0.8: '#f97316', 1.0: '#ef4444' }
            }).addTo(map);
        }
    }
}

function toggleHeatLayer() { renderHeatLayers(); }

// ══════════════════════════════════════════════════════
//  LOCATION SEARCH
// ══════════════════════════════════════════════════════

async function searchCity() {
    const input = document.getElementById('citySearch');
    const query = (input?.value || '').trim();
    if (!query) { toast('Enter a location name', 'info'); return; }

    setLoading(true);
    try {
        const data = await fetch(`/search_location?query=${encodeURIComponent(query)}`).then(r => r.json());
        if (data.status === 'found') {
            const [lat, lng] = data.coords;
            await runPrediction(lat, lng, data.name);
        } else {
            toast(`"${query}" not found — try a Maharashtra city name.`, 'error');
        }
    } catch (e) {
        toast('Search failed — server may be offline.', 'error');
    } finally {
        setLoading(false);
    }
}

async function resolveLocation(query) {
    if (!query) return null;
    const data = await fetch(`/search_location?query=${encodeURIComponent(query)}`).then(r => r.json());
    if (data.status === 'found') return { lat: data.coords[0], lng: data.coords[1], name: data.name };
    return null;
}

function useMyLocation() {
    if (!navigator.geolocation) { toast('Geolocation not supported by this browser.', 'error'); return; }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
        async ({ coords }) => {
            try { await runPrediction(coords.latitude, coords.longitude, 'Your Location'); }
            finally { setLoading(false); }
        },
        () => { setLoading(false); toast('Location access denied or unavailable.', 'error'); },
        { timeout: 8000 }
    );
}

function resetView() {
    map.setView([19.7515, 75.7139], 7, { animate: true, duration: 1 });
    if (carMarker) { map.removeLayer(carMarker); carMarker = null; }
    clearRoutes();
    hide('route-results-panel');
    hide('trip-summary');
    hide('emergency-panel');
    setRibbon('live', 'AI road safety system online — click any location to analyze risk.');
    toast('View reset.', 'info');
}

// ══════════════════════════════════════════════════════
//  MAP CLICK
// ══════════════════════════════════════════════════════

map.on('click', async (e) => {
    if (isReporting) {
        await submitHazard(e.latlng.lat, e.latlng.lng, selectedHazardType);
        return;
    }
    const { lat, lng } = e.latlng;
    await runPrediction(lat, lng, `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E`);
});

// ══════════════════════════════════════════════════════
//  HAZARD REPORTING
// ══════════════════════════════════════════════════════

function selectHazardType(type, btn) {
    selectedHazardType = type;
    document.querySelectorAll('.hazard-chip').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
}

function toggleReporting() {
    isReporting = !isReporting;
    const btn = document.getElementById('reportBtn');
    if (!btn) return;
    if (isReporting) {
        btn.textContent = '✕ Cancel Reporting';
        btn.classList.add('active-report');
        map.getContainer().style.cursor = 'crosshair';
        toast(`Tap map to report a ${selectedHazardType}`, 'info');
    } else {
        btn.textContent = 'Enable Map Reporting';
        btn.classList.remove('active-report');
        map.getContainer().style.cursor = '';
    }
}

async function submitHazard(lat, lng, type) {
    try {
        const res  = await fetch('/report_hazard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lng, type })
        });
        const data = await res.json();
        if (data.status === 'success') {
            const sbox = document.getElementById('hazard-success');
            if (sbox) { sbox.style.display = 'block'; setTimeout(() => sbox.style.display = 'none', 3000); }
            toast(`${type.charAt(0).toUpperCase() + type.slice(1)} reported!`, 'success');

            // Immediate map pin
            const icon = L.divIcon({
                html: `<div style="width:12px;height:12px;border-radius:50%;background:#3b82f6;border:2px solid #93c5fd;box-shadow:0 0 0 5px rgba(59,130,246,0.25);"></div>`,
                className: '', iconSize: [12, 12], iconAnchor: [6, 6]
            });
            L.marker([lat, lng], { icon })
             .bindPopup(`<b>New ${type} report</b><br>Just submitted`)
             .addTo(layers.hazards).openPopup();

            toggleReporting();
            await refreshStats();
        } else {
            toast('Failed to submit hazard.', 'error');
        }
    } catch (e) {
        toast('Submission error.', 'error');
        console.error(e);
    }
}

// ══════════════════════════════════════════════════════
//  ROUTE PLANNING
// ══════════════════════════════════════════════════════

function clearRoutes() {
    routePolylines.forEach(l => map.removeLayer(l));
    routePolylines = [];
    layers.routes.clearLayers();
    if (routeLegendCtrl) { map.removeControl(routeLegendCtrl); routeLegendCtrl = null; }
}

async function planMyTrip() {
    const sv = document.getElementById('routeStart')?.value.trim();
    const ev = document.getElementById('routeEnd')?.value.trim();
    if (!sv || !ev) { toast('Enter both start and destination.', 'info'); return; }

    setLoading(true);
    try {
        const [startLoc, endLoc] = await Promise.all([resolveLocation(sv), resolveLocation(ev)]);
        if (!startLoc) { toast(`Start not found: "${sv}"`, 'error'); return; }
        if (!endLoc)   { toast(`Destination not found: "${ev}"`, 'error'); return; }
        await fetchAndRenderRoute(startLoc, endLoc);
    } finally {
        setLoading(false);
    }
}

async function analyzeRoute() { return planMyTrip(); }

async function fetchAndRenderRoute(start, end) {
    try {
        const data = await fetch('/route_risk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                start: { lat: start.lat, lng: start.lng },
                end:   { lat: end.lat,   lng: end.lng },
                weather: 'auto', time_mode: 'auto'
            })
        }).then(r => r.json());

        renderRouteResults(data, start, end);
    } catch (e) {
        toast('Route analysis failed.', 'error');
        console.error(e);
    }
}

// route_service returns: routes[], best_routes{safest,balanced,fastest}, recommendation, trip_summary{}, explainability{}
function renderRouteResults(data, start, end) {
    clearRoutes();

    const routes   = data.routes       || [];
    const best     = data.best_routes  || {};
    const summary  = data.trip_summary || {};
    const explain  = data.explainability || {};

    // Route colors match backend
    const colorMap = { Fastest: '#60a5fa', Balanced: '#22c55e', Safest: '#2dd4bf' };
    const dashMap  = { Fastest: '8 5',     Balanced: null,        Safest: null    };
    const weightMap= { Fastest: 3,          Balanced: 4,           Safest: 5       };

    routes.forEach(r => {
        const pts   = (r.polyline || []).map(([a, b]) => [a, b]);
        // If no polyline from backend, generate synthetic one
        const usePts = pts.length >= 2 ? pts : syntheticRoute(start, end, r.route_name);
        const color  = colorMap[r.route_name] || '#94a3b8';
        const line   = L.polyline(usePts, {
            color,
            weight:    weightMap[r.route_name] || 3,
            opacity:   0.9,
            dashArray: dashMap[r.route_name],
        });
        line.bindPopup(
            `<b>${r.route_name} Route</b><br>
            Risk: <b style="color:${riskColor(r.overall_route_risk)}">${r.overall_route_risk}</b><br>
            Safety: ${r.trip_safety_score || r.safety_score || '--'}/100<br>
            ETA: ${r.estimated_time_minutes || '--'} min · ${r.distance_km || '--'} km`
        );
        line.addTo(map);
        routePolylines.push(line);
    });

    // Fit map to route
    const bounds = [[start.lat, start.lng], [end.lat, end.lng]];
    map.fitBounds(bounds, { padding: [60, 60], animate: true, duration: 1 });

    // Start/end markers
    L.circleMarker([start.lat, start.lng], { radius: 8, fillColor: '#22c55e', color: '#fff', weight: 2, fillOpacity: 1 })
     .bindPopup(`<b>Start:</b> ${start.name}`).addTo(layers.routes);
    L.circleMarker([end.lat, end.lng], { radius: 8, fillColor: '#ef4444', color: '#fff', weight: 2, fillOpacity: 1 })
     .bindPopup(`<b>Destination:</b> ${end.name}`).addTo(layers.routes);

    // Map legend
    routeLegendCtrl = L.control({ position: 'bottomleft' });
    routeLegendCtrl.onAdd = () => {
        const d = L.DomUtil.create('div', 'route-legend-on-map');
        d.innerHTML = `<strong>Route Guide</strong>
            <div><span class="legend-line teal-line"></span> Safest: ${best.safest || '--'}</div>
            <div><span class="legend-line green-line"></span> Balanced: ${best.balanced || '--'}</div>
            <div><span class="legend-line blue-line"></span> Fastest: ${best.fastest || '--'}</div>`;
        return d;
    };
    routeLegendCtrl.addTo(map);

    // Route result cards
    const cardsEl = document.getElementById('route-cards');
    if (cardsEl) {
        cardsEl.innerHTML = routes.map(r => {
            const rc    = riskClass(r.overall_route_risk);
            const isRec = r.route_name === best.safest;
            const color = colorMap[r.route_name] || '#94a3b8';
            return `<div class="route-card-item ${isRec ? 'recommended' : ''}" style="${isRec ? 'border-color:' + color + ';' : ''}">
                <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;">
                    <span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;"></span>
                    <span class="rcard-name">${r.route_name} Route</span>
                </div>
                <div class="rcard-meta">
                    ${r.estimated_time_minutes || '--'} min · ${r.distance_km || '--'} km · Safety: ${r.trip_safety_score || '--'}/100
                </div>
                <span class="rcard-risk ${rc}">${r.overall_route_risk}</span>
            </div>`;
        }).join('');
    }

    // Route meta
    const metaEl = document.getElementById('route-meta');
    if (metaEl) {
        const avoidMsg = summary.avoid_message || '';
        const bestTime = summary.best_time_to_travel || '';
        metaEl.innerHTML = `
            <b>From:</b> ${start.name} &rarr; <b>To:</b> ${end.name}<br>
            <b>Recommended:</b> ${best.safest || '--'} Route<br>
            ${summary.should_avoid ? '<span style="color:#fca5a5">⚠ High risk across all routes — consider delay.</span><br>' : ''}
            ${bestTime ? `<b>Best time to travel:</b> ${bestTime}` : ''}`;
    }

    // Explainability list
    const expEl = document.getElementById('route-explainability-list');
    if (expEl) {
        const items = explain.safest_vs_fastest || [];
        expEl.innerHTML = items.map(i => `<li>${i}</li>`).join('');
    }

    // Checkpoint warnings
    const cpEl = document.getElementById('route-checkpoints');
    if (cpEl) {
        const safestRoute = routes.find(r => r.route_name === best.safest) || routes[0];
        const warnings = safestRoute?.checkpoint_warnings || [];
        cpEl.innerHTML = warnings.length
            ? warnings.map(w => `<li>⚠ ${w}</li>`).join('')
            : '<li>No critical checkpoints on recommended route.</li>';
    }

    // Trip summary banner
    const tsumm = document.getElementById('trip-summary');
    const ttag  = document.getElementById('trip-tag');
    const ttxt  = document.getElementById('trip-reco-text');
    if (tsumm) {
        tsumm.style.display = 'block';
        if (ttag) {
            ttag.textContent = summary.should_avoid ? 'HIGH CAUTION' : 'RECOMMENDED';
            ttag.style.color = summary.should_avoid ? '#fca5a5' : '#60a5fa';
        }
        if (ttxt) ttxt.textContent = data.recommendation || `Take the ${best.safest || 'Safest'} route.`;
    }

    // Show panel
    showBlock('route-results-panel');
    setRibbon(
        summary.should_avoid ? 'critical' : 'warning',
        `${start.name} → ${end.name} · Best: ${best.safest || '--'} · ${data.recommendation || ''}`
    );
}

// Synthetic route points when backend polyline is empty
function syntheticRoute(start, end, name) {
    const jitterMap = { Fastest: 0.003, Balanced: 0.012, Safest: 0.02 };
    const jitter = jitterMap[name] || 0.008;
    const pts = [];
    const STEPS = 20;
    for (let i = 0; i <= STEPS; i++) {
        const t   = i / STEPS;
        const lat = start.lat + (end.lat - start.lat) * t
            + jitter * Math.sin(t * Math.PI) * (Math.random() > 0.5 ? 1 : -1);
        const lng = start.lng + (end.lng - start.lng) * t
            + jitter * Math.sin(t * Math.PI) * (Math.random() > 0.5 ? 1 : -1);
        pts.push([lat, lng]);
    }
    return pts;
}

// ══════════════════════════════════════════════════════
//  FEED (ALERTS + HISTORY)
// ══════════════════════════════════════════════════════

function switchFeedTab(tab, btn) {
    document.querySelectorAll('.feed-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const alertsEl  = document.getElementById('alerts-list');
    const historyEl = document.getElementById('history-list');
    if (alertsEl)  alertsEl.style.display  = tab === 'alerts'  ? 'flex' : 'none';
    if (historyEl) historyEl.style.display = tab === 'history' ? 'flex' : 'none';
}

async function loadAlerts() {
    try {
        const data  = await fetch('/get_alerts').then(r => r.json());
        const list  = document.getElementById('alerts-list');
        if (!list) return;
        const items = Array.isArray(data) ? data : (data.alerts || []);
        if (!items.length) { list.innerHTML = '<li>No active alerts.</li>'; return; }
        list.innerHTML = items.slice(0, 12).map(a => {
            const sev = (a.alert_level || a.severity || '').toUpperCase();
            const cls = sev === 'CRITICAL' ? 'feed-item-critical' : sev === 'WARNING' ? 'feed-item-alert' : '';
            const msg = a.message || `[${sev}] ${a.city || ''}: ${a.reason || ''}`;
            return `<li class="${cls}">${msg}</li>`;
        }).join('');
    } catch (e) { console.error('Alerts error:', e); }
}

async function loadHistory() {
    try {
        const data  = await fetch('/get_prediction_history').then(r => r.json());
        const list  = document.getElementById('history-list');
        if (!list) return;
        const items = Array.isArray(data) ? data : [];
        if (!items.length) { list.innerHTML = '<li>No prediction history yet.</li>'; return; }
        list.innerHTML = items.slice(0, 12).map(h => {
            const color = riskColor(h.risk_level);
            const time  = (h.timestamp || '').slice(11, 16);
            return `<li>
                <span style="color:${color};font-weight:600;">${h.risk_level}</span>
                &nbsp;—&nbsp;${h.city || '?'}, ${h.district || '?'}
                <span style="color:#475569;font-size:10px;margin-left:4px;">${time}</span>
            </li>`;
        }).join('');
    } catch (e) { console.error('History error:', e); }
}

// ══════════════════════════════════════════════════════
//  DISTRICT RANKINGS
// ══════════════════════════════════════════════════════

async function loadDistrictRankings() {
    try {
        const data  = await fetch('/get_district_rankings').then(r => r.json());
        const list  = document.getElementById('district-ranking-list');
        const topEl = document.getElementById('top-district');

        // Backend returns { dangerous:[], safe:[] }
        const items = data.dangerous || (Array.isArray(data) ? data : []);
        if (!items.length) return;

        if (topEl) topEl.textContent = items[0]?.district || '—';
        if (list) {
            list.innerHTML = items.slice(0, 6).map((d, i) => {
                const risk = d.avg_risk_score ?? d.risk_score ?? '--';
                return `<li>${i + 1}. <b>${d.district}</b> — Risk: ${risk}</li>`;
            }).join('');
        }
    } catch (e) { console.error('Rankings error:', e); }
}

async function compareDistricts() {
    const d1 = document.getElementById('d1')?.value.trim();
    const d2 = document.getElementById('d2')?.value.trim();
    if (!d1 || !d2) { toast('Enter both district names.', 'info'); return; }
    try {
        const data = await fetch(`/compare_districts?district1=${encodeURIComponent(d1)}&district2=${encodeURIComponent(d2)}`).then(r => r.json());
        const list = document.getElementById('district-compare-list');
        if (!list) return;
        const rows = [];
        const d1d  = data.district_1 || {};
        const d2d  = data.district_2 || {};
        if (!Object.keys(d1d).length && !Object.keys(d2d).length) {
            list.innerHTML = '<li>No data found for these districts.</li>'; return;
        }
        const keys = new Set([...Object.keys(d1d), ...Object.keys(d2d)]);
        keys.forEach(k => {
            if (k === 'district') return;
            rows.push(`<li><b>${k}</b>: ${d1} = ${d1d[k] ?? '--'} | ${d2} = ${d2d[k] ?? '--'}</li>`);
        });
        list.innerHTML = rows.join('');
    } catch (e) { toast('Comparison failed.', 'error'); }
}

// ══════════════════════════════════════════════════════
//  TRENDS CHART
// ══════════════════════════════════════════════════════

async function loadTrendsChart() {
    try {
        const data   = await fetch('/get_trends').then(r => r.json());
        const canvas = document.getElementById('trendsChart');
        if (!canvas) return;

        // Backend returns { monthly:[{month,accident_count}], districts:{} }
        const monthly = data.monthly || [];
        const labels  = monthly.map(m => m.month);
        const values  = monthly.map(m => m.accident_count);

        if (!labels.length) return;

        if (trendsChart) trendsChart.destroy();
        trendsChart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Accidents',
                    data: values,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59,130,246,0.08)',
                    borderWidth: 2,
                    pointRadius: 2,
                    pointHoverRadius: 4,
                    tension: 0.35,
                    fill: true,
                }]
            },
            options: {
                responsive: true,
                animation: { duration: 600 },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#162240',
                        borderColor: '#3b82f6',
                        borderWidth: 1,
                        titleColor: '#f1f5f9',
                        bodyColor: '#94a3b8',
                    }
                },
                scales: {
                    x: { ticks: { color: '#475569', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                    y: { ticks: { color: '#475569', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
                }
            }
        });
    } catch (e) { console.error('Trends error:', e); }
}

// ══════════════════════════════════════════════════════
//  GUIDED DEMO
// ══════════════════════════════════════════════════════

async function startGuidedDemo() {
    if (demoRunning) { toast('Demo already running.', 'info'); return; }
    demoRunning = true;
    demoIdx     = 0;
    const btn   = document.getElementById('guided-demo-btn');
    if (btn) btn.textContent = '⏸ Demo Running…';
    setDemoNarration('Guided demo started — scanning Maharashtra risk zones…');
    runNextDemoStep();
}

async function runNextDemoStep() {
    if (!demoRunning || demoIdx >= DEMO_STEPS.length) {
        endDemo('Demo complete. All zones scanned. Click any location to continue.');
        return;
    }
    const step = DEMO_STEPS[demoIdx++];
    setDemoNarration(`[${demoIdx}/${DEMO_STEPS.length}] ${step.msg}`);
    await runPrediction(step.lat, step.lng, step.name);
    demoTimer = setTimeout(runNextDemoStep, 4500);
}

function endDemo(msg) {
    demoRunning = false;
    clearTimeout(demoTimer);
    const btn = document.getElementById('guided-demo-btn');
    if (btn) btn.textContent = '▶ Guided Demo';
    setDemoNarration(msg);
}

function demoReset() {
    endDemo('Demo reset. Click "Guided Demo" to restart the walkthrough.');
    resetView();
}

function setDemoNarration(text) {
    const el = document.getElementById('demo-narration');
    if (el) el.textContent = text;
}

// ══════════════════════════════════════════════════════
//  AUTOCOMPLETE
// ══════════════════════════════════════════════════════

function setupAutocomplete(inputId) {
    const input = document.getElementById(inputId);
    const box   = document.getElementById('location-suggest-box');
    if (!input || !box) return;

    let debounce = null;

    input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(async () => {
            const q = input.value.trim();
            if (!q) { box.style.display = 'none'; return; }
            try {
                const data = await fetch(`/location_suggestions?query=${encodeURIComponent(q)}`).then(r => r.json());
                const sugs  = data.suggestions || [];
                if (!sugs.length) { box.style.display = 'none'; return; }
                box.innerHTML = sugs.slice(0, 8).map(s =>
                    `<div class="suggest-item">${s}</div>`
                ).join('');
                box.style.display = 'block';
                box.querySelectorAll('.suggest-item').forEach(item => {
                    item.addEventListener('mousedown', e => {
                        e.preventDefault();
                        input.value         = item.textContent;
                        box.style.display   = 'none';
                    });
                });
            } catch (_) { box.style.display = 'none'; }
        }, 220);
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { box.style.display = 'none'; searchCity(); }
        if (e.key === 'Escape') box.style.display = 'none';
    });

    input.addEventListener('blur', () => {
        setTimeout(() => { box.style.display = 'none'; }, 180);
    });
}

// ══════════════════════════════════════════════════════
//  CITY LABELS
// ══════════════════════════════════════════════════════

function renderCityLabels() {
    layers.cityLabels.clearLayers();
    if (map.getZoom() < 8) return;
    CITY_LIST.forEach(c => {
        const icon = L.divIcon({
            html: `<span style="font-size:10px;color:#94a3b8;background:rgba(6,11,20,0.75);padding:1px 5px;border-radius:3px;white-space:nowrap;font-family:'DM Sans',sans-serif;pointer-events:none;">${c.name}</span>`,
            className: '', iconSize: 'auto', iconAnchor: [20, 8]
        });
        L.marker([c.lat, c.lng], { icon, interactive: false }).addTo(layers.cityLabels);
    });
}

// ══════════════════════════════════════════════════════
//  LIVE SIMULATION
// ══════════════════════════════════════════════════════

async function triggerLiveUpdate() {
    try {
        await fetch('/simulate_live_updates', { method: 'POST' });
        await refreshStats();
        await loadAlerts();
        await loadHistory();
    } catch (_) {}
}

// ══════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════

async function init() {
    // Night-mode map filter
    document.body.classList.add('night-visual');

    // Setup autocomplete on city search
    setupAutocomplete('citySearch');

    // City labels on zoom
    map.on('zoomend', renderCityLabels);
    renderCityLabels();

    // Initial data load
    await refreshStats();
    await Promise.allSettled([
        loadAlerts(),
        loadHistory(),
        loadDistrictRankings(),
        loadTrendsChart(),
    ]);

    // Live refresh every 45 seconds
    liveInterval = setInterval(triggerLiveUpdate, 45000);

    // Ribbon default
    setRibbon('live', 'AI road safety system online — click any map location to analyze risk.');

    toast('SafeRoute AI ready — click the map to begin.', 'info', 4000);
}

document.addEventListener('DOMContentLoaded', init);
