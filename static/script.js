let map = L.map("map").setView([19.7515, 75.7139], 7);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

let isReporting = false;
let carMarker = null;
let trendsChart = null;
let routeLines = [];
let liveRefreshInterval = null;
let cityLabelLayer = L.layerGroup().addTo(map);
let demoRunning = false;
let lastSelectedPoint = null;
let activeSuggestionInput = null;
let activeSuggestions = [];
let activeSuggestionIndex = -1;
let locationCarMarker = null;
let routeMetaLayer = L.layerGroup().addTo(map);
let routeLegendControl = null;
const listToggleState = {};
let pendingHazardType = null;

let accidentLayer = L.layerGroup().addTo(map);
let potholeLayer = L.layerGroup().addTo(map);
let intersectionLayer = L.layerGroup().addTo(map);
let hazardLayer = L.layerGroup().addTo(map);
let blackSpotLayer = L.layerGroup().addTo(map);
let heatAccidents = null;
let heatHazards = null;
let heatCombined = null;
let lastHeatAccidents = [];
let lastHeatHazards = [];


const MAHARASHTRA_CITIES = [
    { name: "Mumbai", lat: 19.0760, lng: 72.8777 },
    { name: "Pune", lat: 18.5204, lng: 73.8567 },
    { name: "Thane", lat: 19.2183, lng: 72.9781 },
    { name: "Vashi", lat: 19.0771, lng: 72.9986 },
    { name: "Nashik", lat: 19.9975, lng: 73.7898 },
    { name: "Nagpur", lat: 21.1458, lng: 79.0882 },
    { name: "Aurangabad", lat: 19.8762, lng: 75.3433 },
    { name: "Kolhapur", lat: 16.7050, lng: 74.2433 },
    { name: "Solapur", lat: 17.6599, lng: 75.9064 },
    { name: "Amravati", lat: 20.9374, lng: 77.7796 },
    { name: "Nanded", lat: 19.1383, lng: 77.3210 },
    { name: "Ratnagiri", lat: 16.9902, lng: 73.3120 }
];

function setLoading(isLoading) {
    document.getElementById("loading-indicator").style.display = isLoading ? "inline" : "none";
}

function setInfoBar(type = "live", message = "") {
    const banner = document.getElementById("alert-banner");
    const pill = document.getElementById("alert-pill");
    const text = document.getElementById("alert-text");
    if (!banner || !pill || !text) return;
    banner.classList.remove("info-neutral", "info-warning", "info-critical");
    if (type === "critical") {
        banner.classList.add("info-critical");
        pill.innerText = "CRITICAL";
    } else if (type === "warning") {
        banner.classList.add("info-warning");
        pill.innerText = "WARNING";
    } else {
        banner.classList.add("info-neutral");
        pill.innerText = "LIVE";
    }
    const fullMessage = message || "Live monitoring active. Select a location or route.";
    const trimmed = fullMessage.length > 88 ? `${fullMessage.slice(0, 85)}...` : fullMessage;
    text.innerText = trimmed;
    text.title = fullMessage;
    text.setAttribute("aria-label", fullMessage);
}

function textOf(id, fallback = "--") {
    const el = document.getElementById(id);
    const t = (el?.innerText || "").trim();
    return t || fallback;
}

function collectListItems(selector, limit = 6) {
    return Array.from(document.querySelectorAll(selector)).slice(0, limit).map(li => li.innerText.trim()).filter(Boolean);
}

function closeResultPop() {
    const modal = document.getElementById("result-pop-modal");
    if (modal) modal.style.display = "none";
}

function openResultPop(kind) {
    const modal = document.getElementById("result-pop-modal");
    const title = document.getElementById("result-pop-title");
    const list = document.getElementById("result-pop-list");
    if (!modal || !title || !list) return;

    let rows = [];
    if (kind === "overview") {
        title.innerText = "Live Overview - Quick Explain";
        rows = [
            `Current location: ${textOf("current-location")} | Risk: ${textOf("risk-val")} | Safety score: ${textOf("safety-score")}`,
            `Total accidents: ${textOf("stat-accidents")} | Potholes: ${textOf("stat-potholes")} | Hazards: ${textOf("stat-hazards")} | Black spots: ${textOf("stat-blackspots")}`,
            "What this means: This panel is the real-time snapshot before deeper AI and route decisions."
        ];
    } else if (kind === "ai") {
        title.innerText = "AI Insights - Quick Explain";
        rows = [
            `Risk: ${textOf("live-risk")} | Confidence: ${textOf("live-confidence")} | Probability: ${textOf("live-probability")}`,
            `Summary: ${textOf("user-summary")}`,
            `Recommended action: ${textOf("action-recommendation")}`,
            ...collectListItems("#top-reasons-list li", 4)
        ];
    } else if (kind === "community") {
        title.innerText = "Community & Alerts - Quick Explain";
        rows = [
            "What this means: Live alerts + recent reports help justify real-time risk changes.",
            ...collectListItems("#alerts-list li", 5),
            ...collectListItems("#history-list li", 4)
        ];
    } else {
        title.innerText = "Route Recommendation - Quick Explain";
        rows = [
            `Recommended route: ${textOf("route-recommendation")}`,
            `Safest: ${textOf("safest-route")} | Balanced: ${textOf("balanced-route")} | Fastest: ${textOf("fastest-route")}`,
            `Overall route risk: ${textOf("route-risk-result")} | Trip safety: ${textOf("trip-safety-score")}/100`,
            `Should avoid now?: ${textOf("avoid-message")}`,
            `Best time: ${textOf("best-time")} (${textOf("best-time-score")}/100)`,
            ...collectListItems("#route-explainability-list li", 4)
        ];
    }

    const cleaned = rows.filter(Boolean);
    list.innerHTML = cleaned.length ? cleaned.map(r => `<li>${r}</li>`).join("") : "<li>No result available yet. Run prediction/route first.</li>";
    modal.style.display = "flex";
}

function renderCompactList(listId, items, fallbackText, defaultLimit = 3) {
    const listEl = document.getElementById(listId);
    const toggleBtn = document.getElementById(`${listId}-toggle`);
    if (!listEl) return;
    const rows = (items || []).filter(Boolean);
    if (!rows.length) {
        listEl.innerHTML = `<li>${fallbackText}</li>`;
        if (toggleBtn) toggleBtn.style.display = "none";
        listToggleState[listId] = false;
        return;
    }
    const expanded = !!listToggleState[listId];
    const visibleRows = expanded ? rows : rows.slice(0, defaultLimit);
    listEl.innerHTML = visibleRows.map(r => `<li>${r}</li>`).join("");
    if (toggleBtn) {
        if (rows.length > defaultLimit) {
            toggleBtn.style.display = "inline-block";
            toggleBtn.innerText = expanded ? "Show less" : `Show more (${rows.length - defaultLimit})`;
            toggleBtn.onclick = () => {
                listToggleState[listId] = !listToggleState[listId];
                renderCompactList(listId, rows, fallbackText, defaultLimit);
            };
        } else {
            toggleBtn.style.display = "none";
        }
    }
}

function simOptions() {
    return {
        weather: "auto",
        time_mode: "night"
    };
}

function applyModeFeedback() {
    document.body.classList.add("night-visual");
    document.body.classList.remove("rain-visual");
    document.getElementById("mode-feedback").innerText = "Mode: Night + Auto weather + Live updates";
}

function setDemoNarration(text) {
    const el = document.getElementById("demo-narration");
    if (el) el.innerText = text;
}

function focusWithCar(lat, lng, label = "Selected location", zoom = 13) {
    const icon = L.divIcon({
        html: "<span style='font-size:20px;'>🚗</span>",
        className: "",
        iconSize: [24, 24]
    });
    if (!locationCarMarker) {
        locationCarMarker = L.marker([lat, lng], { icon }).addTo(map);
    } else {
        locationCarMarker.setLatLng([lat, lng]);
    }
    locationCarMarker.bindPopup(`<b>${label}</b>`).openPopup();
    map.flyTo([lat, lng], zoom, { duration: 1.0 });
}

function buildRouteLegend(routeData) {
    if (routeLegendControl) {
        map.removeControl(routeLegendControl);
        routeLegendControl = null;
    }

    routeLegendControl = L.control({ position: "bottomleft" });
    routeLegendControl.onAdd = function () {
        const div = L.DomUtil.create("div", "route-legend-on-map");
        const safest = routeData.best_routes?.safest || "--";
        const fastest = routeData.best_routes?.fastest || "--";
        const balanced = routeData.best_routes?.balanced || "--";
        div.innerHTML = `
            <div><strong>Route Guide</strong></div>
            <div><span class="legend-line blue-line"></span> Fastest</div>
            <div><span class="legend-line green-line"></span> Balanced</div>
            <div><span class="legend-line teal-line"></span> Safest (Recommended)</div>
            <div class="legend-mini">Chosen safest: ${safest}</div>
            <div class="legend-mini">Fastest: ${fastest} | Balanced: ${balanced}</div>
        `;
        return div;
    };
    routeLegendControl.addTo(map);
}

function midpointOfPolyline(polyline) {
    if (!polyline || !polyline.length) return null;
    const mid = polyline[Math.floor(polyline.length / 2)];
    return [mid[0], mid[1]];
}

function toggleMapFocus(forceState = null) {
    const shouldMinimize = forceState === null
        ? !document.body.classList.contains("panels-minimized")
        : forceState;
    document.body.classList.toggle("panels-minimized", shouldMinimize);
    const btn = document.getElementById("map-focus-btn");
    if (btn) btn.innerText = shouldMinimize ? "Show Panels" : "Focus Map";
}

function applySimpleMode() {
    document.body.classList.add("simple-mode");
}

function toggleInfoBar(forceState = null) {
    const shouldHide = forceState === null
        ? !document.body.classList.contains("info-bar-hidden")
        : forceState;
    document.body.classList.toggle("info-bar-hidden", shouldHide);
    const btn = document.getElementById("info-bar-toggle-btn");
    if (btn) btn.innerText = shouldHide ? "Show Info Bar" : "Hide Info Bar";
}

async function updateLocationSuggestions(query = "") {
    try {
        const data = await fetch(`/location_suggestions?query=${encodeURIComponent(query)}`).then(r => r.json());
        const list = document.getElementById("location-options");
        if (!list) return;
        list.innerHTML = "";
        (data.suggestions || []).forEach(item => {
            const opt = document.createElement("option");
            opt.value = item;
            list.appendChild(opt);
        });
    } catch (err) {
        console.error("Failed to load location suggestions", err);
    }
}

function hideSuggestionBox() {
    const box = document.getElementById("location-suggest-box");
    box.style.display = "none";
    box.innerHTML = "";
    activeSuggestions = [];
    activeSuggestionIndex = -1;
}

function renderSuggestionBox(inputEl, suggestions) {
    const box = document.getElementById("location-suggest-box");
    if (!suggestions.length) {
        hideSuggestionBox();
        return;
    }

    const rect = inputEl.getBoundingClientRect();
    box.style.left = `${Math.round(rect.left)}px`;
    box.style.top = `${Math.round(rect.bottom + 4)}px`;
    box.style.width = `${Math.round(rect.width)}px`;
    box.innerHTML = "";
    box.style.display = "block";

    suggestions.forEach((s, idx) => {
        const item = document.createElement("div");
        item.className = "location-suggest-item";
        if (idx === activeSuggestionIndex) item.classList.add("active");
        item.innerText = s;
        item.addEventListener("mousedown", (e) => {
            e.preventDefault();
            inputEl.value = s;
            hideSuggestionBox();
        });
        box.appendChild(item);
    });
}

function moveSuggestionSelection(step) {
    if (!activeSuggestions.length) return;
    activeSuggestionIndex += step;
    if (activeSuggestionIndex < 0) activeSuggestionIndex = activeSuggestions.length - 1;
    if (activeSuggestionIndex >= activeSuggestions.length) activeSuggestionIndex = 0;
    renderSuggestionBox(activeSuggestionInput, activeSuggestions);
}

async function openSuggestionsForInput(inputEl) {
    activeSuggestionInput = inputEl;
    const data = await fetch(`/location_suggestions?query=${encodeURIComponent(inputEl.value.trim())}`).then(r => r.json());
    activeSuggestions = data.suggestions || [];
    activeSuggestionIndex = -1;
    renderSuggestionBox(inputEl, activeSuggestions);
}

function clearDemoHighlights() {
    document.querySelectorAll(".demo-highlight").forEach(el => el.classList.remove("demo-highlight"));
}

function highlightDemoTargets(selectors) {
    clearDemoHighlights();
    selectors.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.classList.add("demo-highlight");
    });
}

function waitMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function distanceKm(aLat, aLng, bLat, bLng) {
    const toRad = d => d * (Math.PI / 180);
    const R = 6371;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const s1 = Math.sin(dLat / 2) ** 2;
    const s2 = Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * (Math.sin(dLng / 2) ** 2);
    return 2 * R * Math.asin(Math.sqrt(s1 + s2));
}

function nearestDemoCity(lat, lng) {
    let best = MAHARASHTRA_CITIES[0];
    let bestD = 1e9;
    MAHARASHTRA_CITIES.forEach(c => {
        const d = distanceKm(lat, lng, c.lat, c.lng);
        if (d < bestD) {
            best = c;
            bestD = d;
        }
    });
    return best?.name || "Mumbai";
}

function scoreBadgeClass(score) {
    if (score >= 70) return "score-good";
    if (score >= 45) return "score-medium";
    return "score-bad";
}

function updateRiskBar(riskLevel) {
    const fill = document.getElementById("risk-fill");
    if (riskLevel === "High Risk") {
        fill.style.width = "90%";
        fill.style.background = "#dc2626";
    } else if (riskLevel === "Medium Risk") {
        fill.style.width = "60%";
        fill.style.background = "#f59e0b";
    } else if (riskLevel === "Low Risk") {
        fill.style.width = "25%";
        fill.style.background = "#22c55e";
    } else {
        fill.style.width = "10%";
        fill.style.background = "#9ca3af";
    }
}

function rebuildHeatmaps(accPoints, hazPoints) {
    [heatAccidents, heatHazards, heatCombined].forEach(layer => {
        if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    });

    heatAccidents = L.heatLayer(accPoints, { radius: 24, blur: 18, maxZoom: 12 });
    heatHazards = L.heatLayer(hazPoints, { radius: 24, blur: 18, maxZoom: 12 });
    heatCombined = L.heatLayer([...accPoints, ...hazPoints], { radius: 24, blur: 18, maxZoom: 12 });

    if (document.getElementById("acc-heat").checked) heatAccidents.addTo(map);
    if (document.getElementById("haz-heat").checked) heatHazards.addTo(map);
    if (document.getElementById("comb-heat").checked) heatCombined.addTo(map);
}

async function loadData() {
    setLoading(true);
    try {
        const data = await fetch("/get_state_data").then(r => r.json());
        accidentLayer.clearLayers();
        potholeLayer.clearLayers();
        intersectionLayer.clearLayers();
        hazardLayer.clearLayers();
        blackSpotLayer.clearLayers();

        let blackSpotCount = 0;

        data.accidents.forEach(acc => {
            L.circleMarker([acc.latitude, acc.longitude], {
                radius: 6,
                color: "#dc2626",
                fillColor: "#dc2626",
                fillOpacity: 0.85
            }).bindPopup(`<b>Accident hotspot</b><br>${acc.city}<br>Count: ${acc.accident_count}`).addTo(accidentLayer);

            if (parseInt(acc.accident_count) >= 12) {
                L.circle([acc.latitude, acc.longitude], {
                    radius: 3200,
                    color: "#7f1d1d",
                    fillColor: "#7f1d1d",
                    fillOpacity: 0.15
                }).addTo(blackSpotLayer);
                blackSpotCount++;
            }
        });

        data.potholes.forEach(p => {
            L.circleMarker([p.latitude, p.longitude], {
                radius: 5,
                color: "#f59e0b",
                fillColor: "#f59e0b",
                fillOpacity: 0.9
            }).bindPopup(`<b>Pothole zone</b><br>${p.city}<br>Count: ${p.pothole_count}`).addTo(potholeLayer);
        });

        data.intersections.forEach(i => {
            L.circleMarker([i.latitude, i.longitude], {
                radius: 5,
                color: "#facc15",
                fillColor: "#facc15",
                fillOpacity: 0.85
            }).bindPopup(`<b>Intersection</b><br>${i.intersection_name}<br>Traffic: ${i.traffic_density}`).addTo(intersectionLayer);
        });

        data.hazards.forEach(h => {
            L.circleMarker([h.latitude, h.longitude], {
                radius: 5,
                color: "#3b82f6",
                fillColor: "#3b82f6",
                fillOpacity: 0.9
            }).bindPopup(`<b>User hazard</b><br>${h.hazard_type}<br>${h.city}`).addTo(hazardLayer);
        });

        lastHeatAccidents = data.heatmap?.accidents || [];
        lastHeatHazards = data.heatmap?.hazards || [];
        rebuildHeatmaps(lastHeatAccidents, lastHeatHazards);

        document.getElementById("stat-accidents").innerText = data.accidents.length;
        document.getElementById("stat-potholes").innerText = data.potholes.length;
        document.getElementById("stat-hazards").innerText = data.hazards.length;
        document.getElementById("stat-blackspots").innerText = blackSpotCount;
    } catch (err) {
        console.error("loadData failed", err);
    } finally {
        setLoading(false);
    }
}

async function loadDistrictRankings() {
    const data = await fetch("/get_district_rankings").then(r => r.json());
    document.getElementById("top-district").innerText = data.dangerous?.[0]?.district || "--";
    document.getElementById("district-ranking-list").innerHTML = (data.dangerous || [])
        .slice(0, 4)
        .map(d => `<li>${d.district}: risk score ${d.avg_risk_score}</li>`)
        .join("") || "<li>No district ranking data available.</li>";
}

function drawCityLabels() {
    cityLabelLayer.clearLayers();
    MAHARASHTRA_CITIES.forEach(city => {
        const marker = L.circleMarker([city.lat, city.lng], {
            radius: 3,
            color: "#94a3b8",
            fillColor: "#cbd5e1",
            fillOpacity: 0.9
        }).bindTooltip(city.name, {
            permanent: true,
            direction: "top",
            offset: [0, -6],
            className: "city-label"
        });
        marker.addTo(cityLabelLayer);
    });
}

async function runPrediction(lat, lng, label = "Selected Area") {
    setLoading(true);
    try {
        const pred = await fetch("/predict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat, lng, ...simOptions() })
        }).then(r => r.json());

        document.getElementById("sim-status").innerText = label;
        document.getElementById("live-risk").innerText = pred.risk_level;
        document.getElementById("live-confidence").innerText = `${pred.confidence}%`;
        document.getElementById("live-probability").innerText = `${pred.probability}%`;
        const mode = pred.context_used?.model_mode || "single-model";
        const modelsUsed = (pred.context_used?.models_used || []).join(" + ");
        document.getElementById("model-mode-badge").innerText =
            mode === "ensemble" ? `Ensemble (${modelsUsed || "RF + ET"})` : "Single Model";
        document.getElementById("risk-val").innerText = pred.risk_level;
        document.getElementById("current-location").innerText = pred.nearby_stats?.city || "Unknown";
        document.getElementById("safety-score").innerText = pred.safety_score;
        document.getElementById("user-summary").innerText = pred.user_summary || "--";
        document.getElementById("action-recommendation").innerText = pred.action_recommendation || "--";

        renderCompactList("top-reasons-list", pred.top_reasons || [], "No major risk reason currently.", 3);
        renderCompactList("nearby-stats-list", [
            `District: ${pred.nearby_stats?.district || "N/A"}`,
            `Nearby accidents: ${pred.nearby_stats?.nearby_accidents || 0}`,
            `Nearby potholes: ${pred.nearby_stats?.nearby_potholes || 0}`,
            `Nearby intersections: ${pred.nearby_stats?.nearby_intersections || 0}`,
            `Traffic density: ${pred.nearby_stats?.traffic_density || 0}`
        ], "No nearby road context available.", 3);

        document.getElementById("safe-zone-list").innerHTML = pred.safe_zone
            ? `<li>Try detour via ${pred.safe_zone.city} (${pred.safe_zone.district})</li>
               <li>Safety score: ${pred.safe_zone.safety_score}</li>
               <li>Coordinates: ${pred.safe_zone.lat}, ${pred.safe_zone.lng}</li>`
            : "<li>No safer detour needed for this location.</li>";

        const emergency = pred.emergency || {};
        document.getElementById("emergency-list").innerHTML = `
            <li>Nearest hospital: ${emergency.hospital?.name || "N/A"} (${emergency.hospital?.distance_km ?? "--"} km, ETA ${emergency.hospital?.eta_minutes ?? "--"} min)</li>
            <li>Nearest police: ${emergency.police_station?.name || "N/A"} (${emergency.police_station?.distance_km ?? "--"} km, ETA ${emergency.police_station?.eta_minutes ?? "--"} min)</li>
        `;

        if (pred.alert?.level === "CRITICAL") {
            setInfoBar("critical", pred.alert.reason || "Critical road safety alert in this area.");
        } else if (pred.alert?.level === "WARNING") {
            setInfoBar("warning", pred.alert.reason || "Warning: elevated local road risk.");
        } else {
            const weatherCtx = pred.context_used?.weather ? ` | Weather: ${pred.context_used.weather}` : "";
            setInfoBar("live", `${pred.risk_level} near ${pred.nearby_stats?.city || "selected area"}${weatherCtx}`);
        }

        updateRiskBar(pred.risk_level);
        await Promise.all([loadPredictionHistory(), loadAlerts()]);
    } catch (err) {
        console.error("runPrediction failed", err);
    } finally {
        setLoading(false);
    }
}

async function analyzeRoute() {
    const startCity = document.getElementById("routeStart").value.trim();
    const endCity = document.getElementById("routeEnd").value.trim();

    if (!startCity || !endCity) {
        alert("Please enter both start and end cities.");
        return;
    }

    setLoading(true);
    try {
        const [startData, endData] = await Promise.all([
            fetch(`/search_location?query=${encodeURIComponent(startCity)}`).then(r => r.json()),
            fetch(`/search_location?query=${encodeURIComponent(endCity)}`).then(r => r.json())
        ]);

        if (startData.status !== "found" || endData.status !== "found") {
            alert("One or both cities were not found in local Maharashtra dataset.");
            return;
        }
        focusWithCar(startData.coords[0], startData.coords[1], `Start: ${startData.name || startCity}`, 12);

        const routeData = await fetch("/route_risk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                start: { lat: startData.coords[0], lng: startData.coords[1] },
                end: { lat: endData.coords[0], lng: endData.coords[1] },
                ...simOptions()
            })
        }).then(r => r.json());
        routeLines.forEach(line => map.removeLayer(line));
        routeLines = [];
        routeMetaLayer.clearLayers();

        const fastestForPopupName = routeData.best_routes?.fastest;
        const fastestForPopupObj = (routeData.routes || []).find(r => r.route_name === fastestForPopupName);
        (routeData.routes || []).forEach(route => {
            const isRecommended = route.route_name === routeData.best_routes?.safest;
            let popupWhyDifferent = "Baseline route.";
            if (fastestForPopupObj && route.route_name !== fastestForPopupObj.route_name) {
                const extraMins = route.estimated_time_minutes - fastestForPopupObj.estimated_time_minutes;
                const riskDelta = route.total_risk_score - fastestForPopupObj.total_risk_score;
                const riskText = riskDelta < 0
                    ? `${Math.abs(riskDelta).toFixed(1)} lower risk points`
                    : `${Math.abs(riskDelta).toFixed(1)} higher risk points`;
                popupWhyDifferent = `${extraMins > 0 ? `+${extraMins}` : extraMins} min vs fastest, ${riskText}`;
            }
            const line = L.polyline(route.polyline, {
                color: route.color,
                weight: isRecommended ? 8 : 5,
                opacity: isRecommended ? 0.95 : 0.72
            }).bindPopup(`
                <b>${route.route_name} route</b><br>
                Risk score: ${route.total_risk_score}<br>
                Risk level: ${route.overall_route_risk}<br>
                Time: ${route.estimated_time_minutes} min<br>
                Accident exposure: ${route.accident_exposure}<br>
                Pothole exposure: ${route.pothole_exposure}<br>
                Black spot exposure: ${route.black_spot_exposure}<br>
                Why different: ${popupWhyDifferent}<br>
                Route logic: ${route.selection_reason || "Route tradeoff computed from ETA and risk."}
            `);
            line.addTo(map);
            routeLines.push(line);

            if (isRecommended) {
                const halo = L.polyline(route.polyline, {
                    color: "#a7f3d0",
                    weight: 14,
                    opacity: 0.22,
                    interactive: false
                });
                halo.addTo(map);
                routeLines.push(halo);
            }

            const mid = midpointOfPolyline(route.polyline);
            if (mid) {
                const tag = route.route_name === routeData.best_routes?.safest ? "Recommended" : route.route_name;
                const summary = `${tag}: ${route.overall_route_risk} | ${route.estimated_time_minutes}m | Score ${route.trip_safety_score}/100`;
                L.marker(mid, {
                    icon: L.divIcon({
                        className: route.route_name === routeData.best_routes?.safest ? "route-inline-label recommended-label" : "route-inline-label",
                        html: `<div>${summary}</div>`,
                        iconSize: [270, 22]
                    })
                }).addTo(routeMetaLayer);
            }
        });
        buildRouteLegend(routeData);

        document.getElementById("route-recommendation").innerText = routeData.recommendation || "--";
        document.getElementById("trip-reco-text").innerText = routeData.recommendation || "Analyze a route to get your best travel action.";
        document.getElementById("route-risk-result").innerText = routeData.overall_route_risk || "--";
        document.getElementById("safest-route").innerText = routeData.best_routes?.safest || "--";
        document.getElementById("balanced-route").innerText = routeData.best_routes?.balanced || "--";
        document.getElementById("fastest-route").innerText = routeData.best_routes?.fastest || "--";
        document.getElementById("avoid-message").innerText = routeData.trip_summary?.avoid_message || "--";
        document.getElementById("best-time").innerText = routeData.trip_summary?.best_time_to_travel || "--";
        document.getElementById("best-time-score").innerText = routeData.trip_summary?.best_time_score ?? "--";
        document.getElementById("route-difficulty").innerText = routeData.trip_summary?.route_difficulty || "--";

        const safestRouteObj = (routeData.routes || []).find(r => r.route_name === routeData.best_routes?.safest);
        const tripScore = safestRouteObj?.trip_safety_score;
        const tripScoreEl = document.getElementById("trip-safety-score");
        tripScoreEl.innerText = tripScore ?? "--";
        tripScoreEl.className = "score-badge";
        if (typeof tripScore === "number") tripScoreEl.classList.add(scoreBadgeClass(tripScore));
        document.getElementById("time-advisor-list").innerHTML = (routeData.trip_summary?.time_windows || [])
            .map(w => `<li>${w.window}: safety score ${w.score}/100</li>`)
            .join("") || "<li>No time advisor available.</li>";
        document.getElementById("route-explainability-list").innerHTML = (routeData.explainability?.safest_vs_fastest || [])
            .map(x => `<li>${x}</li>`)
            .join("") || "<li>No route explainability insights.</li>";
        const routeCards = document.getElementById("route-cards");
        routeCards.innerHTML = "";
        const fastestRouteName = routeData.best_routes?.fastest;
        const fastestRouteObj = (routeData.routes || []).find(r => r.route_name === fastestRouteName);

        (routeData.routes || []).forEach(route => {
            const card = document.createElement("div");
            card.className = "route-card";
            if (route.route_name === routeData.best_routes?.safest) {
                card.classList.add("recommended");
            }
            card.style.borderLeftColor = route.color;
            let whyDifferent = "Baseline route.";
            if (fastestRouteObj && route.route_name !== fastestRouteObj.route_name) {
                const extraMins = route.estimated_time_minutes - fastestRouteObj.estimated_time_minutes;
                const riskDelta = route.total_risk_score - fastestRouteObj.total_risk_score;
                const riskText = riskDelta < 0
                    ? `${Math.abs(riskDelta).toFixed(1)} lower risk points`
                    : `${Math.abs(riskDelta).toFixed(1)} higher risk points`;
                const timeText = extraMins > 0
                    ? `+${extraMins} min`
                    : `${extraMins} min`;
                whyDifferent = `${timeText} vs fastest, ${riskText}.`;
            }
            card.innerHTML = `
                <strong>${route.route_name}${route.route_name === routeData.best_routes?.safest ? " (Recommended)" : ""}</strong><br>
                Risk: ${route.overall_route_risk} (score ${route.total_risk_score})<br>
                Trip Safety: <span class="score-badge ${scoreBadgeClass(route.trip_safety_score)}">${route.trip_safety_score}/100</span><br>
                ETA: ${route.estimated_time_minutes} min | Distance: ${route.distance_km} km<br>
                Accidents: ${route.accident_exposure} | Potholes: ${route.pothole_exposure} | Black spots: ${route.black_spot_exposure}<br>
                Advisory: ${route.travel_advisory}<br>
                <span class="route-why-different">Why different: ${whyDifferent}</span><br>
                <span class="route-why-different">Logic: ${route.selection_reason || "ETA-risk tradeoff route."}</span>
            `;
            routeCards.appendChild(card);
        });

        const warnings = [];
        (routeData.routes || []).forEach(route => {
            (route.checkpoint_warnings || []).forEach(w => warnings.push(`${route.route_name}: ${w}`));
        });

        renderCompactList("route-checkpoints", warnings, "No major warnings for current route comparison.", 3);

        const potholeInsights = [];
        (routeData.routes || []).forEach(route => {
            const samples = route.pothole_profile || [];
            if (!samples.length) {
                potholeInsights.push(`${route.route_name}: no mapped pothole clusters close to this route.`);
                return;
            }
            const formatted = samples.slice(0, 3).map(p => `${p.distance_from_start_km} km (${p.city})`).join(", ");
            potholeInsights.push(`${route.route_name}: ${samples.length} pothole zones; nearest at ${samples[0].distance_from_start_km} km; key points at ${formatted}.`);
        });
        renderCompactList("route-pothole-insights", potholeInsights, "No pothole profile available.", 3);

        if (routeLines.length > 0) {
            const group = L.featureGroup(routeLines);
            map.fitBounds(group.getBounds(), { padding: [20, 20] });
        }
    } catch (err) {
        console.error("analyzeRoute failed", err);
    } finally {
        setLoading(false);
    }
}

async function planMyTrip() {
    const startCity = document.getElementById("routeStart").value.trim();
    const endCity = document.getElementById("routeEnd").value.trim();
    if (!startCity || !endCity) {
        alert("Enter start and end city, then click Plan My Trip.");
        return;
    }

    setInfoBar("live", "Analyzing route options and safety...");
    await analyzeRoute();

    const safest = document.getElementById("safest-route").innerText || "--";
    const avoidMessage = document.getElementById("avoid-message").innerText || "--";
    const bestTime = document.getElementById("best-time").innerText || "--";
    const warnings = Array.from(document.querySelectorAll("#route-checkpoints li"))
        .slice(0, 1)
        .map(li => li.innerText)[0] || "No major checkpoint warning";

    document.getElementById("quick-summary").innerText =
        `For ${startCity} to ${endCity}, use ${safest} route for safest daily commute.`;
    document.getElementById("quick-commute-list").innerHTML = `
        <li>Recommended route: ${safest}</li>
        <li>Should I avoid this trip?: ${avoidMessage}</li>
        <li>Best time to travel: ${bestTime}</li>
        <li>Main caution: ${warnings}</li>
    `;
}

async function loadPredictionHistory() {
    const rows = await fetch("/get_prediction_history").then(r => r.json());
    const items = rows.slice(0, 12).map(row => `${row.timestamp} | ${row.city} | ${row.risk_level} | safety ${row.safety_score}`);
    renderCompactList("history-list", items, "No history records yet.", 3);
}

async function loadAlerts() {
    const rows = await fetch("/get_alerts").then(r => r.json());
    const items = rows.slice(0, 12).map(row => `[${row.alert_level}] ${row.city}: ${row.reason}`);
    renderCompactList("alerts-list", items, "No live alerts at the moment.", 3);
}

async function loadTrends() {
    const data = await fetch("/get_trends").then(r => r.json());
    const labels = (data.monthly || []).map(x => x.month);
    const values = (data.monthly || []).map(x => x.accident_count);

    const ctx = document.getElementById("trendsChart");
    if (trendsChart) trendsChart.destroy();

    trendsChart = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "Monthly accidents (synthetic)",
                data: values,
                borderColor: "#ef4444",
                backgroundColor: "rgba(239,68,68,0.22)",
                fill: true,
                tension: 0.25
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { labels: { color: "#e5e7eb" } } },
            scales: {
                x: { ticks: { color: "#e5e7eb" } },
                y: { ticks: { color: "#e5e7eb" } }
            }
        }
    });
}

async function compareDistricts() {
    const d1 = document.getElementById("d1").value.trim();
    const d2 = document.getElementById("d2").value.trim();
    if (!d1 || !d2) return;

    const result = await fetch(`/compare_districts?district1=${encodeURIComponent(d1)}&district2=${encodeURIComponent(d2)}`).then(r => r.json());
    const a = result.district_1 || {};
    const b = result.district_2 || {};

    document.getElementById("district-compare-list").innerHTML = `
        <li>${a.district || d1}: risk ${a.avg_risk_score ?? '--'}, accidents ${a.total_accidents ?? '--'}, potholes ${a.total_potholes ?? '--'}, safety ${a.safety_score ?? '--'}</li>
        <li>${b.district || d2}: risk ${b.avg_risk_score ?? '--'}, accidents ${b.total_accidents ?? '--'}, potholes ${b.total_potholes ?? '--'}, safety ${b.safety_score ?? '--'}</li>
    `;
}

function resetView() {
    map.setView([19.7515, 75.7139], 7);
    setInfoBar("live", "Live monitoring active. Select a location or route.");
    document.getElementById("trip-reco-text").innerText = "Analyze a route to get your best travel action.";
}

async function submitHazardReport(lat, lng, type) {
    await fetch("/report_hazard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng, type })
    });
    await loadData();
    await loadAlerts();
}

async function toggleReporting() {
    if (isReporting) {
        // Explicit stop state
        isReporting = false;
        pendingHazardType = null;
        const btnStop = document.getElementById("reportBtn");
        btnStop.classList.remove("active");
        btnStop.innerText = "Report Hazard";
        map.getContainer().style.cursor = "";
        setInfoBar("live", "Community reporting off. Click 'Report Hazard' to report a road issue.");
        return;
    }

    const type = prompt("Enter hazard type (pothole / roadblock / waterlogging / accident)", "pothole");
    if (!type) {
        setInfoBar("warning", "Hazard reporting cancelled.");
        return;
    }

    isReporting = true;
    pendingHazardType = type;
    const btn = document.getElementById("reportBtn");
    btn.classList.add("active");
    btn.innerText = `Click map to report: ${type}`;
    map.getContainer().style.cursor = "crosshair";

    setInfoBar("warning", "Community reporting ON. Click any map point to report hazard.");

    // Fast path: if user already selected a point, report immediately.
    if (lastSelectedPoint) {
        await submitHazardReport(lastSelectedPoint[0], lastSelectedPoint[1], type);
        isReporting = false;
        pendingHazardType = null;
        btn.classList.remove("active");
        btn.innerText = "Report Hazard";
        map.getContainer().style.cursor = "";
        setInfoBar("live", `Hazard reported successfully (${type}) at selected location.`);
    }
}

async function copyVivaCalibrationNote() {
    const text = "We observed synthetic skew toward one risk class, so we calibrated final risk output using bounded local aggregation and threshold tuning. This ensures realistic Low/Medium/High distribution for decision support while preserving model-driven reasoning.";
    try {
        await navigator.clipboard.writeText(text);
        setInfoBar("live", "Viva calibration note copied to clipboard.");
    } catch (err) {
        console.error("Clipboard write failed", err);
        setInfoBar("warning", "Copy failed. You can read the calibration note in Advanced District Analytics.");
    }
}

async function searchCity() {
    const query = document.getElementById("citySearch").value.trim();
    if (!query) return;

    const data = await fetch(`/search_location?query=${encodeURIComponent(query)}`).then(r => r.json());
    if (data.status !== "found") {
        alert("Location not found in local dataset. Try nearby terms like Nerul, Seawoods, Belapur, Kharghar, Panvel.");
        return;
    }

    focusWithCar(data.coords[0], data.coords[1], data.name || query, 12);
    if (data.name && data.name.toLowerCase() !== query.toLowerCase()) {
        setInfoBar("live", `Using nearest match: ${data.name}`);
    }
    await runPrediction(data.coords[0], data.coords[1], data.name || query);
}

function useMyLocation() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported in this browser.");
        return;
    }

    setInfoBar("live", "Detecting your current location...");

    navigator.geolocation.getCurrentPosition(
        async position => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            lastSelectedPoint = [lat, lng];
            focusWithCar(lat, lng, "Current Location", 13);
            await runPrediction(lat, lng, "Current Location");
        },
        error => {
            console.error("Geolocation error", error);
            alert("Unable to fetch your location. Please allow location access.");
            setInfoBar("warning", "Unable to fetch your location. Allow location access and retry.");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

async function startGuidedDemo() {
    if (demoRunning) return;
    demoRunning = true;
    const btn = document.getElementById("guided-demo-btn");
    // Ensure demo steps are visible and not blocked by other UI states.
    toggleMapFocus(false);
    closeResultPop();
    hideSuggestionBox();
    if (isReporting) {
        isReporting = false;
        pendingHazardType = null;
        const reportBtn = document.getElementById("reportBtn");
        if (reportBtn) {
            reportBtn.classList.remove("active");
            reportBtn.innerText = "Report Hazard";
        }
        map.getContainer().style.cursor = "";
    }
    btn.disabled = true;
    btn.innerText = "Demo Running...";
    setInfoBar("live", "Guided demo started. Running walkthrough steps...");

    try {
        // Step 1: Search and AI risk prediction
        setDemoNarration("Step 1/4: We search a city and get AI-based local risk prediction.");
        highlightDemoTargets(["#citySearch", "#live-risk", "#user-summary"]);
        const cityInput = document.getElementById("citySearch");
        const routeStartInput = document.getElementById("routeStart");
        const routeEndInput = document.getElementById("routeEnd");
        // If city search is empty but route is selected, use route start for AI step.
        if (!cityInput.value.trim() && routeStartInput.value.trim()) {
            cityInput.value = routeStartInput.value.trim();
        }
        if (lastSelectedPoint && !cityInput.value.trim()) {
            cityInput.value = nearestDemoCity(lastSelectedPoint[0], lastSelectedPoint[1]);
        }
        if (!cityInput.value.trim()) {
            setDemoNarration("Nothing is selected. Select a city/location first, then run Guided Demo.");
            setInfoBar("warning", "Nothing is selected. Choose a location or use My Location first.");
            return;
        }
        await searchCity();
        await waitMs(1800);

        // Step 2: Route comparison
        setDemoNarration("Step 2/4: We compare fastest, balanced, and safest route options.");
        highlightDemoTargets(["#routeStart", "#routeEnd", "#route-cards"]);
        const routeStart = routeStartInput;
        const routeEnd = routeEndInput;
        if (!routeStart.value.trim() || !routeEnd.value.trim()) {
            setDemoNarration("Nothing is selected for route. Enter both start and end, then run Guided Demo.");
            setInfoBar("warning", "Nothing is selected for route. Enter start and end locations first.");
            return;
        }
        await planMyTrip();
        await waitMs(2200);

        // Step 3: Real-time overview and pothole intelligence
        setDemoNarration("Step 3/4: Live monitoring updates hazards and route pothole distances in real time.");
        highlightDemoTargets(["#alerts-list", "#history-list", "#route-pothole-insights"]);
        await waitMs(2600);

        // Step 4: Community and emergency
        setDemoNarration("Step 4/4: Community hazards and emergency support improve practical road safety decisions.");
        highlightDemoTargets(["#reportBtn", "#emergency-list", "#district-ranking-list"]);
        await waitMs(2500);

        setDemoNarration("Guided demo complete: AI risk prediction, route recommendation, pothole intelligence, and community safety all working together.");
        setInfoBar("live", "Guided demo completed successfully.");
    } catch (err) {
        console.error("Guided demo failed", err);
        setDemoNarration("Guided demo stopped due to an unexpected issue. You can run it again.");
        setInfoBar("warning", "Guided demo hit an issue. Check data inputs and run again.");
    } finally {
        demoRunning = false;
        btn.disabled = false;
        btn.innerText = "Guided Demo";
        clearDemoHighlights();
    }
}

function clearRouteVisuals() {
    routeLines.forEach(line => map.removeLayer(line));
    routeLines = [];
    document.getElementById("route-cards").innerHTML = "";
    document.getElementById("route-checkpoints").innerHTML = "<li>No route analyzed yet.</li>";
    document.getElementById("route-recommendation").innerText = "--";
    document.getElementById("trip-reco-text").innerText = "Analyze a route to get your best travel action.";
    document.getElementById("route-risk-result").innerText = "--";
    document.getElementById("safest-route").innerText = "--";
    document.getElementById("balanced-route").innerText = "--";
    document.getElementById("fastest-route").innerText = "--";
    document.getElementById("avoid-message").innerText = "--";
    document.getElementById("best-time").innerText = "--";
    document.getElementById("best-time-score").innerText = "--";
    const tripScoreEl = document.getElementById("trip-safety-score");
    tripScoreEl.innerText = "--";
    tripScoreEl.className = "";
    document.getElementById("route-difficulty").innerText = "--";
    document.getElementById("time-advisor-list").innerHTML = "";
    document.getElementById("route-explainability-list").innerHTML = "";
    document.getElementById("route-pothole-insights").innerHTML = "<li>No route analyzed yet.</li>";
}

function demoReset() {
    if (carMarker) {
        map.removeLayer(carMarker);
        carMarker = null;
    }
    if (locationCarMarker) {
        map.removeLayer(locationCarMarker);
        locationCarMarker = null;
    }

    clearDemoHighlights();
    clearRouteVisuals();

    document.getElementById("citySearch").value = "";
    document.getElementById("routeStart").value = "";
    document.getElementById("routeEnd").value = "";
    document.getElementById("d1").value = "";
    document.getElementById("d2").value = "";

    document.getElementById("sim-status").innerText = "Idle";
    document.getElementById("live-risk").innerText = "N/A";
    document.getElementById("live-confidence").innerText = "--";
    document.getElementById("live-probability").innerText = "--";
    document.getElementById("model-mode-badge").innerText = "--";
    document.getElementById("risk-val").innerText = "N/A";
    document.getElementById("current-location").innerText = "Maharashtra";
    document.getElementById("safety-score").innerText = "--";
    document.getElementById("user-summary").innerText = "Select any map point to get a user-friendly AI explanation.";
    document.getElementById("action-recommendation").innerText = "--";
    document.getElementById("top-reasons-list").innerHTML = "";
    document.getElementById("nearby-stats-list").innerHTML = "";
    ["top-reasons-toggle", "nearby-stats-toggle", "alerts-toggle", "history-toggle", "route-checkpoints-toggle", "route-pothole-insights-toggle"]
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = "none";
        });
    document.getElementById("safe-zone-list").innerHTML = "";
    document.getElementById("district-compare-list").innerHTML = "";
    document.getElementById("quick-summary").innerText = "Enter start/end and click Plan My Trip for one clear recommendation.";
    document.getElementById("quick-commute-list").innerHTML = `
        <li>Recommended route: --</li>
        <li>Should I avoid this trip?: --</li>
        <li>Best time to travel: --</li>
        <li>Main caution: --</li>
    `;

    updateRiskBar("Unknown");
    map.setView([19.7515, 75.7139], 7);
    setDemoNarration("Demo assistant reset complete. Click Guided Demo for a fresh walkthrough.");
    setInfoBar("live", "Live monitoring active. Select a location or route.");
    loadData();
    loadAlerts();
    loadPredictionHistory();
}

map.on("click", async e => {
    if (isReporting) {
        const type = pendingHazardType || "pothole";
        await submitHazardReport(e.latlng.lat, e.latlng.lng, type);
        pendingHazardType = null;
        await toggleReporting();
        setInfoBar("live", `Hazard reported successfully (${type}) near selected map point.`);
        return;
    }

    lastSelectedPoint = [e.latlng.lat, e.latlng.lng];
    focusWithCar(e.latlng.lat, e.latlng.lng, "Selected point", 13);
    await runPrediction(e.latlng.lat, e.latlng.lng, "Map selected area");
});

function setupHeatmapToggles() {
    ["acc-heat", "haz-heat", "comb-heat"].forEach(id => {
        document.getElementById(id).addEventListener("change", () => {
            rebuildHeatmaps(lastHeatAccidents, lastHeatHazards);
        });
    });
}

function startLiveMonitoringLoop() {
    if (liveRefreshInterval) clearInterval(liveRefreshInterval);

    liveRefreshInterval = setInterval(async () => {
        try {
            await fetch("/simulate_live_updates", { method: "POST" });
        } catch (err) {
            console.error("Synthetic live update failed", err);
        }
        await Promise.all([loadData(), loadAlerts(), loadPredictionHistory()]);
    }, 12000);
}

document.getElementById("citySearch").addEventListener("keypress", e => {
    if (e.key === "Enter") searchCity();
});
["citySearch", "routeStart", "routeEnd"].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener("input", async () => {
        await updateLocationSuggestions(el.value.trim());
        await openSuggestionsForInput(el);
    });
    el.addEventListener("focus", async () => {
        await updateLocationSuggestions(el.value.trim());
        await openSuggestionsForInput(el);
    });
    el.addEventListener("keydown", (e) => {
        if (document.getElementById("location-suggest-box").style.display === "none") return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            moveSuggestionSelection(1);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            moveSuggestionSelection(-1);
        } else if (e.key === "Enter") {
            if (activeSuggestionIndex >= 0 && activeSuggestionInput === el) {
                e.preventDefault();
                el.value = activeSuggestions[activeSuggestionIndex];
                hideSuggestionBox();
            }
        } else if (e.key === "Escape") {
            hideSuggestionBox();
        }
    });
});
document.addEventListener("click", (e) => {
    const box = document.getElementById("location-suggest-box");
    if (!box.contains(e.target) && !["citySearch", "routeStart", "routeEnd"].includes(e.target.id)) {
        hideSuggestionBox();
    }
    const modal = document.getElementById("result-pop-modal");
    if (modal && e.target === modal) closeResultPop();
});

// modes are fixed by product decision: Night + Auto weather + Live updates.

setupHeatmapToggles();
applyModeFeedback();
applySimpleMode();
toggleInfoBar(false);
setInfoBar("live", "Live monitoring active. Select a location or route.");
drawCityLabels();
toggleMapFocus(true);
loadData();
loadDistrictRankings();
loadPredictionHistory();
loadAlerts();
loadTrends();
updateLocationSuggestions();
startLiveMonitoringLoop();
