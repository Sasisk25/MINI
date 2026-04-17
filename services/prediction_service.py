from datetime import datetime
import json
from urllib.request import urlopen
import pandas as pd
import joblib
from config import DATA_FILES, MODEL_PATH, ALT_MODEL_PATH
from utils.io_utils import load_csv_safe, append_row
from utils.geo_utils import haversine_km, nearest_city, district_for_city
from services.emergency_service import nearest_emergency
from services.alert_service import evaluate_alert

HISTORY_COLS = ["timestamp", "lat", "lng", "city", "district", "risk_level", "safety_score"]
_WEATHER_CACHE = {}
_MODEL_CACHE = {}


def _weather_factor(weather):
    return 2 if weather == "rain" else 1


def _time_factor(mode):
    if mode == "night":
        return 4
    h = datetime.now().hour
    if 6 <= h < 12:
        return 1
    if 12 <= h < 17:
        return 2
    if 17 <= h < 21:
        return 3
    return 4


def _auto_weather_state(lat, lng):
    cache_key = (round(float(lat), 2), round(float(lng), 2), datetime.now().strftime("%Y-%m-%d %H:%M"))
    if cache_key in _WEATHER_CACHE:
        return _WEATHER_CACHE[cache_key]

    # Try free real-time weather first (no paid API key).
    try:
        url = (
            "https://api.open-meteo.com/v1/forecast"
            f"?latitude={float(lat):.5f}&longitude={float(lng):.5f}"
            "&current=rain,precipitation,weather_code"
        )
        with urlopen(url, timeout=1.5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        current = payload.get("current", {})
        rain_mm = float(current.get("rain", 0) or 0)
        precip_mm = float(current.get("precipitation", 0) or 0)
        weather_code = int(current.get("weather_code", 0) or 0)
        # Weather codes 51+ generally indicate drizzle/rain/snow families.
        resolved = "rain" if (rain_mm > 0 or precip_mm > 0 or weather_code >= 51) else "clear"
        _WEATHER_CACHE[cache_key] = resolved
        return resolved
    except Exception:
        pass

    # Fallback synthetic seasonality when network/weather fetch is unavailable.
    now = datetime.now()
    mon = now.month
    hour = now.hour
    rainy_season = mon in [6, 7, 8, 9]
    transition_season = mon in [5, 10]
    bucket = int(abs(lat * 100) + abs(lng * 100) + mon + hour) % 100
    if rainy_season and bucket < 58:
        _WEATHER_CACHE[cache_key] = "rain"
        return "rain"
    if transition_season and bucket < 28:
        _WEATHER_CACHE[cache_key] = "rain"
        return "rain"
    _WEATHER_CACHE[cache_key] = "clear"
    return "clear"


def _resolve_context(weather_mode, time_mode, lat, lng):
    resolved_weather = _auto_weather_state(lat, lng) if weather_mode == "auto" else weather_mode
    return resolved_weather, time_mode


def _traffic_adjustment(base_traffic, weather, time_mode):
    traffic = float(base_traffic)
    if weather == "rain":
        traffic *= 1.12
    tf = _time_factor(time_mode)
    if tf == 3:  # evening peak
        traffic *= 1.15
    elif tf == 4:  # night lower load
        traffic *= 0.9
    return int(max(20, min(98, traffic)))


def compute_stats(lat, lng):
    accidents = load_csv_safe(DATA_FILES["accidents"])
    potholes = load_csv_safe(DATA_FILES["potholes"])
    intersections = load_csv_safe(DATA_FILES["intersections"])
    hazards = load_csv_safe(DATA_FILES["hazards"])
    summary = load_csv_safe(DATA_FILES["district_summary"])

    acc_count = pot_count = hazard_count = 0
    inter_presence = black_spot = 0
    traffic, n_acc, n_pot, n_int, n_haz = 35, 0, 0, 0, 0
    # Slightly tighter neighborhood keeps local stats realistic.
    radius = 12

    for r in accidents.itertuples():
        if haversine_km(lat, lng, r.latitude, r.longitude) <= radius:
            n_acc += 1
            acc_count += int(r.accident_count)
            black_spot = max(black_spot, int(r.accident_count >= 12))
    for r in potholes.itertuples():
        if haversine_km(lat, lng, r.latitude, r.longitude) <= radius:
            n_pot += 1
            pot_count += int(r.pothole_count)

    tvals = []
    for r in intersections.itertuples():
        if haversine_km(lat, lng, r.latitude, r.longitude) <= radius:
            n_int += 1
            inter_presence = 1
            tvals.append(int(r.traffic_density))
    if tvals:
        traffic = int(sum(tvals) / len(tvals))

    for r in hazards.itertuples():
        if haversine_km(lat, lng, r.latitude, r.longitude) <= radius:
            n_haz += 1
            hazard_count += 1

    # Cap aggregate counts to avoid unrealistic feature inflation.
    acc_count = int(max(0, min(acc_count, 18)))
    pot_count = int(max(0, min(pot_count, 14)))
    hazard_count = int(max(0, min(hazard_count, 8)))

    city = nearest_city(lat, lng)
    district = district_for_city(city)
    district_risk, safety = 55, 60
    if not summary.empty and "district" in summary.columns:
        drow = summary[summary["district"].str.lower() == district.lower()]
        if not drow.empty:
            district_risk = int(drow.iloc[0]["avg_risk_score"])
            safety = int(drow.iloc[0]["safety_score"])

    return {
        "city": city,
        "district": district,
        "accident_count": acc_count,
        "pothole_count": pot_count,
        "intersection_presence": inter_presence,
        "traffic_density": traffic,
        "reported_hazards": hazard_count,
        "black_spot_nearby": black_spot,
        "district_risk_score": district_risk,
        "safety_score": safety,
        "nearby_accidents": n_acc,
        "nearby_potholes": n_pot,
        "nearby_intersections": n_int,
        "nearby_hazards": n_haz,
    }


def _make_user_summary(risk_level, reasons):
    top = reasons[:2] if reasons else ["stable road environment"]
    if risk_level == "High Risk":
        return f"This area is risky mainly due to {top[0].lower()} and {top[1].lower() if len(top) > 1 else 'local conditions'}."
    if risk_level == "Medium Risk":
        return f"Moderate risk detected due to {top[0].lower()} and {top[1].lower() if len(top) > 1 else 'traffic conditions'}."
    return "This area appears relatively safe for normal commute if basic caution is followed."


def _action_recommendation(risk_level):
    if risk_level == "High Risk":
        return "Reduce speed, avoid aggressive overtaking, and prefer alternate safer routes."
    if risk_level == "Medium Risk":
        return "Continue with caution, maintain braking distance, and watch for road defects."
    return "Proceed normally with defensive driving and lane discipline."


def _heuristic_risk_level(stats, weather, time_mode):
    score = (
        stats["accident_count"] * 0.7
        + stats["pothole_count"] * 0.5
        + stats["traffic_density"] * 0.08
        + stats["reported_hazards"] * 0.8
        + stats["black_spot_nearby"] * 5
        + (3 if weather == "rain" else 0)
        + (3 if time_mode == "night" else 0)
    )
    if score >= 34:
        return "High Risk"
    if score >= 18:
        return "Medium Risk"
    return "Low Risk"


def _blend_risk(model_risk, heuristic_risk):
    if model_risk == heuristic_risk:
        return model_risk
    # avoid extreme jumps from either source
    if "Medium Risk" in [model_risk, heuristic_risk]:
        return "Medium Risk"
    # model high + heuristic low or vice versa => middle ground
    return "Medium Risk"


def _load_models():
    if "models" in _MODEL_CACHE:
        return _MODEL_CACHE["models"]
    models = []
    if MODEL_PATH.exists():
        models.append(("rf", joblib.load(MODEL_PATH)))
    if ALT_MODEL_PATH.exists():
        models.append(("et", joblib.load(ALT_MODEL_PATH)))
    _MODEL_CACHE["models"] = models
    return models


def _ensemble_predict(models, X):
    # Combine class probabilities from all available models.
    combined = {}
    contributors = []
    for name, model in models:
        try:
            probs = model.predict_proba(X)[0]
            cls = model.classes_
            contributors.append(name)
            for c, p in zip(cls, probs):
                combined[c] = combined.get(c, 0.0) + float(p)
        except Exception:
            continue
    if not combined:
        # hard fallback when no probability APIs are available
        y = models[0][1].predict(X)[0]
        return y, 70.0, contributors
    total_models = max(1, len(contributors))
    averaged = {k: v / total_models for k, v in combined.items()}
    y = max(averaged.items(), key=lambda kv: kv[1])[0]
    prob = round(averaged[y] * 100, 2)
    return y, prob, contributors


def get_prediction(lat, lng, weather="auto", time_mode="auto"):
    models = _load_models()
    if not models:
        return {
            "risk_level": "Unknown",
            "confidence": 0,
            "probability": 0,
            "reasons": ["Model not found. Run train_model.py first."],
            "nearby_stats": {},
            "safety_score": 0,
            "risk_contributions": {},
            "safe_zone": None,
            "why_risky": [],
            "alert": {"level": "NORMAL", "reason": "N/A"},
            "emergency": {},
            "user_summary": "Prediction model unavailable.",
            "action_recommendation": "Run model training and retry.",
            "top_reasons": [],
        }

    s = compute_stats(lat, lng)
    resolved_weather, resolved_time_mode = _resolve_context(weather, time_mode, lat, lng)
    wf, tf = _weather_factor(resolved_weather), _time_factor(resolved_time_mode)

    effective_traffic = _traffic_adjustment(s["traffic_density"], resolved_weather, resolved_time_mode)

    X = pd.DataFrame([{
        "accident_count": s["accident_count"],
        "pothole_count": s["pothole_count"],
        "intersection_presence": s["intersection_presence"],
        "traffic_density": effective_traffic,
        "reported_hazards": s["reported_hazards"],
        "black_spot_nearby": s["black_spot_nearby"],
        "district_risk_score": s["district_risk_score"],
        "weather_factor": wf,
        "time_factor": tf,
    }])

    y, prob, model_contributors = _ensemble_predict(models, X)

    raw = {
        "Accident Density": min(s["accident_count"] / 40, 1),
        "Potholes": min(s["pothole_count"] / 20, 1),
        "Traffic": min(s["traffic_density"] / 100, 1),
        "Hazards": min(s["reported_hazards"] / 10, 1),
        "Black Spots": float(s["black_spot_nearby"]),
        "Weather": wf / 2,
        "Time": tf / 4,
    }
    total = sum(raw.values()) or 1
    contributions = {k: round(v * 100 / total, 1) for k, v in raw.items()}
    sorted_contrib = sorted(contributions.items(), key=lambda x: x[1], reverse=True)
    why = [f"{k} contributes {v}% to risk" for k, v in sorted_contrib[:3]]

    safety = max(
        10,
        min(
            100,
            int(
                s["safety_score"]
                - s["accident_count"] * 0.8
                - s["pothole_count"] * 0.5
                - s["reported_hazards"] * 2
                - (8 if resolved_weather == "rain" else 0)
                - (6 if resolved_time_mode == "night" else 0)
            ),
        ),
    )

    heuristic = _heuristic_risk_level(s, resolved_weather, resolved_time_mode)
    calibrated = _blend_risk(y, heuristic)
    if calibrated != y or calibrated != heuristic:
        prob = min(prob, 72)
    # Confidence is treated as reliability score, not just model class probability.
    if y == heuristic:
        prob = min(95, max(prob, 68))
    else:
        prob = max(52, min(prob, 74))

    reasons = [
        *(["Accident hotspot nearby"] if s["accident_count"] >= 15 else []),
        *(["Multiple potholes detected"] if s["pothole_count"] >= 5 else []),
        *(["Dangerous intersection ahead"] if s["intersection_presence"] == 1 else []),
        *(["Heavy traffic density"] if effective_traffic >= 70 else []),
        *(["Repeated user hazard reports"] if s["reported_hazards"] >= 2 else []),
        *(["Auto weather indicates wet-road braking risk"] if resolved_weather == "rain" else []),
        *(["Night-time visibility is lower"] if resolved_time_mode == "night" else []),
    ] or ["Road conditions appear relatively stable"]

    safe_zone = None
    if calibrated in ["High Risk", "Medium Risk"]:
        best_score = 1e18
        for dlat, dlng in [(0.05, 0), (-0.05, 0), (0, 0.05), (0, -0.05), (0.03, 0.03), (-0.03, -0.03)]:
            ts = compute_stats(lat + dlat, lng + dlng)
            score = ts["accident_count"] * 2 + ts["pothole_count"] * 1.5 + ts["traffic_density"] * 0.4 + ts["reported_hazards"] * 2
            if score < best_score:
                best_score = score
                safe_zone = {
                    "lat": round(lat + dlat, 6),
                    "lng": round(lng + dlng, 6),
                    "city": ts["city"],
                    "district": ts["district"],
                    "safety_score": ts["safety_score"],
                }

    append_row(
        DATA_FILES["prediction_history"],
        {
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "lat": lat,
            "lng": lng,
            "city": s["city"],
            "district": s["district"],
            "risk_level": calibrated,
            "safety_score": safety,
        },
        HISTORY_COLS,
    )

    return {
        "risk_level": calibrated,
        "confidence": prob,
        "probability": prob,
        "reasons": reasons,
        "top_reasons": reasons[:3],
        "user_summary": _make_user_summary(calibrated, reasons),
        "action_recommendation": _action_recommendation(calibrated),
        "context_used": {
            "weather": resolved_weather,
            "time_mode": resolved_time_mode if resolved_time_mode != "auto" else "system-time",
            "model_mode": "ensemble" if len(model_contributors) > 1 else "single-model",
            "models_used": model_contributors,
        },
        "nearby_stats": {
            "city": s["city"],
            "district": s["district"],
            "nearby_accidents": s["nearby_accidents"],
            "nearby_potholes": s["nearby_potholes"],
            "nearby_intersections": s["nearby_intersections"],
            "nearby_hazards": s["nearby_hazards"],
            "traffic_density": effective_traffic,
        },
        "safety_score": safety,
        "risk_contributions": contributions,
        "safe_zone": safe_zone,
        "why_risky": why,
        "alert": evaluate_alert(lat, lng, s),
        "emergency": nearest_emergency(lat, lng),
    }


def get_prediction_history(limit=30):
    df = load_csv_safe(DATA_FILES["prediction_history"], columns=HISTORY_COLS)
    return [] if df.empty else df.tail(limit).iloc[::-1].to_dict(orient="records")
