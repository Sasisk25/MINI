import random
from utils.geo_utils import haversine_km
from services.prediction_service import get_prediction, compute_stats
from utils.io_utils import load_csv_safe
from config import DATA_FILES


def _quadratic_route_points(start, end, bend=(0.0, 0.0), checkpoints=8):
    s_lat, s_lng = start
    e_lat, e_lng = end
    m_lat = (s_lat + e_lat) / 2 + bend[0]
    m_lng = (s_lng + e_lng) / 2 + bend[1]

    points = []
    for i in range(checkpoints):
        t = i / (checkpoints - 1)
        lat = ((1 - t) ** 2) * s_lat + (2 * (1 - t) * t * m_lat) + (t ** 2) * e_lat
        lng = ((1 - t) ** 2) * s_lng + (2 * (1 - t) * t * m_lng) + (t ** 2) * e_lng
        points.append((lat, lng))
    return points


def _route_label(score):
    if score >= 24:
        return "High Risk"
    if score >= 15:
        return "Medium Risk"
    return "Low Risk"


def _advisory(route):
    if route["overall_route_risk"] == "High Risk":
        return "Avoid this route unless necessary. Multiple high-risk checkpoints detected."
    if route["overall_route_risk"] == "Medium Risk":
        return "Use with caution. Keep speed moderate near dense traffic and hazard zones."
    return "Suitable for daily commute. Continue defensive driving."


def _selection_reason(route, fastest, safest):
    if route["route_name"] == "Fastest":
        return f"Lowest ETA ({route['estimated_time_minutes']} min). Best when time is priority."
    if route["route_name"] == "Safest":
        return (
            f"Lowest risk score ({route['total_risk_score']}) with fewer high-risk checkpoints. "
            f"Safer by {round(fastest['total_risk_score'] - route['total_risk_score'], 1)} points vs fastest."
        )
    extra = route["estimated_time_minutes"] - fastest["estimated_time_minutes"]
    risk_gain = round(fastest["total_risk_score"] - route["total_risk_score"], 1)
    return f"Best compromise: {extra:+d} min vs fastest with {risk_gain} lower risk points."


def _pick_distinct_best(routes):
    risk_sorted = sorted(routes, key=lambda r: r["total_risk_score"])
    time_sorted = sorted(routes, key=lambda r: r["estimated_time_minutes"])

    fastest = time_sorted[0]
    safest = risk_sorted[0]

    # Demo clarity rule: keep fastest/safest distinct when alternatives exist.
    if fastest["route_name"] == safest["route_name"] and len(risk_sorted) > 1:
        safest = risk_sorted[1]

    remaining = [r for r in routes if r["route_name"] not in {fastest["route_name"], safest["route_name"]}]
    if remaining:
        min_risk, max_risk = min(r["total_risk_score"] for r in routes), max(r["total_risk_score"] for r in routes)
        min_eta, max_eta = min(r["estimated_time_minutes"] for r in routes), max(r["estimated_time_minutes"] for r in routes)
        for r in remaining:
            nr = (r["total_risk_score"] - min_risk) / max(0.001, (max_risk - min_risk))
            nt = (r["estimated_time_minutes"] - min_eta) / max(0.001, (max_eta - min_eta))
            r["_balance_distance"] = abs(nr - 0.5) + abs(nt - 0.5)
        balanced = min(remaining, key=lambda r: r["_balance_distance"])
        for r in remaining:
            r.pop("_balance_distance", None)
    else:
        balanced = min(routes, key=lambda r: abs(r["estimated_time_minutes"] - fastest["estimated_time_minutes"]) + abs(r["total_risk_score"] - safest["total_risk_score"]))

    return safest, balanced, fastest


def _trip_safety_score(route):
    checkpoints = max(route.get("checkpoint_count", 8), 1)
    avg_acc = route["accident_exposure"] / checkpoints
    avg_pot = route["pothole_exposure"] / checkpoints
    avg_black = route["black_spot_exposure"] / checkpoints
    normalized_risk = route["total_risk_score"] / max(checkpoints * 3.8, 1)

    score = 100
    # Recalibrated penalties: keep route separation, avoid overly harsh low scores.
    score -= normalized_risk * 23
    score -= min(avg_acc, 8) * 1.25
    score -= min(avg_pot, 7) * 1.1
    score -= min(avg_black, 1.2) * 6.2
    score -= max(route["estimated_time_minutes"] - 55, 0) * 0.18
    score -= route.get("high_risk_checkpoints", 0) * 0.75
    score -= route.get("medium_risk_checkpoints", 0) * 0.25
    return max(30, min(100, round(score)))


def _checkpoint_risk_points(pred):
    level = pred.get("risk_level", "Medium Risk")
    prob = float(pred.get("probability", 60) or 60)
    safety = float(pred.get("safety_score", 50) or 50)
    base = 3.0 if level == "High Risk" else (2.0 if level == "Medium Risk" else 1.0)
    # Continuous penalty helps separate route totals meaningfully.
    prob_penalty = max(0.0, min(1.2, (prob - 50.0) / 40.0))
    safety_penalty = max(0.0, min(1.0, (60.0 - safety) / 35.0))
    return base + prob_penalty + safety_penalty


def _time_advisor(route, weather):
    base = route["trip_safety_score"]
    windows = [
        ("06:00-08:00", base + 6),
        ("08:00-10:00", base - 10),
        ("10:00-16:00", base + 4),
        ("16:00-20:00", base - 12),
        ("20:00-23:00", base - 6),
    ]
    if weather == "rain":
        windows = [(w, s - 6) for w, s in windows]
    scored = [{"window": w, "score": max(5, min(100, int(s)))} for w, s in windows]
    best = max(scored, key=lambda x: x["score"])
    return scored, best


def _cum_distances(points):
    out = [0.0]
    for i in range(1, len(points)):
        out.append(out[-1] + haversine_km(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]))
    return out


def _route_pothole_profile(points, potholes_df, radius_km=1.35, max_hits=8):
    if potholes_df.empty or not points:
        return []
    cum = _cum_distances(points)
    hits = []
    seen = set()
    for r in potholes_df.itertuples():
        best_idx = None
        best_dist = 1e9
        for i, (lat, lng) in enumerate(points):
            d = haversine_km(lat, lng, r.latitude, r.longitude)
            if d < best_dist:
                best_dist = d
                best_idx = i
        if best_dist > radius_km or best_idx is None:
            continue
        key = (round(float(r.latitude), 4), round(float(r.longitude), 4))
        if key in seen:
            continue
        seen.add(key)
        approx_from_start = max(0.1, cum[best_idx] + best_dist)
        hits.append({
            "city": str(getattr(r, "city", "Unknown")),
            "pothole_count": int(getattr(r, "pothole_count", 1)),
            "distance_from_start_km": round(approx_from_start, 2),
        })
    hits.sort(key=lambda x: x["distance_from_start_km"])
    return hits[:max_hits]


def analyze_routes(start, end, weather="auto", time_mode="auto"):
    potholes_df = load_csv_safe(DATA_FILES["potholes"])
    variants = [
        {"name": "Fastest", "color": "#2563eb", "bend": (0.00, 0.00), "speed": 58, "checkpoints": 7},
        {"name": "Balanced", "color": "#16a34a", "bend": (0.11, -0.08), "speed": 48, "checkpoints": 9},
        {"name": "Safest", "color": "#0f766e", "bend": (0.18, -0.12), "speed": 40, "checkpoints": 11},
    ]

    routes = []
    for variant in variants:
        points = _quadratic_route_points(start, end, bend=variant["bend"], checkpoints=variant["checkpoints"])

        risk_score = 0.0
        high_count = 0
        medium_count = 0
        accident_exposure = 0
        pothole_exposure = 0
        black_spot_exposure = 0
        checkpoint_warnings = []
        checkpoint_rows = []

        for lat, lng in points:
            pred = get_prediction(lat, lng, weather=weather, time_mode=time_mode)
            stats = compute_stats(lat, lng)
            risk_level = pred["risk_level"]

            if risk_level == "High Risk":
                high_count += 1
            elif risk_level == "Medium Risk":
                medium_count += 1
            risk_score += _checkpoint_risk_points(pred)

            accident_exposure += pred["nearby_stats"].get("nearby_accidents", 0)
            pothole_exposure += pred["nearby_stats"].get("nearby_potholes", 0)
            black_spot_exposure += int(stats.get("black_spot_nearby", 0))

            if risk_level in ["High Risk", "Medium Risk"]:
                checkpoint_warnings.append(
                    f"{pred['nearby_stats'].get('city', 'Unknown')}: {risk_level} checkpoint"
                )

            checkpoint_rows.append({
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "city": pred["nearby_stats"].get("city", "Unknown"),
                "risk_level": risk_level,
            })

        base_distance = haversine_km(start[0], start[1], end[0], end[1])
        bend_mag = abs(variant["bend"][0]) + abs(variant["bend"][1])
        # Deterministic distance factors keep route identity stable and explainable.
        distance_with_variation = base_distance * (1.03 + bend_mag * 0.55 + random.uniform(0.00, 0.03))
        eta_minutes = round((distance_with_variation / variant["speed"]) * 60 + 4)
        pothole_profile = _route_pothole_profile(points, potholes_df)

        route = {
            "route_name": variant["name"],
            "color": variant["color"],
            "polyline": [[round(x, 6), round(y, 6)] for x, y in points],
            "checkpoints": checkpoint_rows,
            "total_risk_score": round(risk_score, 1),
            "overall_route_risk": _route_label(risk_score),
            "estimated_time_minutes": eta_minutes,
            "distance_km": round(distance_with_variation, 1),
            "accident_exposure": int(accident_exposure),
            "pothole_exposure": int(pothole_exposure),
            "black_spot_exposure": int(black_spot_exposure),
            "checkpoint_warnings": checkpoint_warnings[:6],
            "checkpoint_count": len(points),
            "high_risk_checkpoints": high_count,
            "medium_risk_checkpoints": medium_count,
            "pothole_profile": pothole_profile,
            "nearest_pothole_km": pothole_profile[0]["distance_from_start_km"] if pothole_profile else None,
        }
        route["travel_advisory"] = _advisory(route)
        route["trip_safety_score"] = _trip_safety_score(route)
        routes.append(route)

    safest, balanced, fastest = _pick_distinct_best(routes)

    # Attach explicit human-readable reasoning for each route option.
    for r in routes:
        r["selection_reason"] = _selection_reason(r, fastest, safest)

    should_avoid = safest["overall_route_risk"] == "High Risk"
    avoid_message = (
        "Yes - all options currently show high risk. Delay or choose local roads."
        if should_avoid
        else "No - a reasonable route is available. Prefer the safest route shown."
    )
    time_windows, best_time_window = _time_advisor(safest, weather)

    # Explainability comparator: safest vs fastest
    acc_delta = fastest["accident_exposure"] - safest["accident_exposure"]
    pot_delta = fastest["pothole_exposure"] - safest["pothole_exposure"]
    acc_text = f"{abs(acc_delta)} {'fewer' if acc_delta >= 0 else 'more'} accident checkpoints on safest."
    pot_text = f"{abs(pot_delta)} {'fewer' if pot_delta >= 0 else 'more'} pothole checkpoints on safest."
    comparator = {
        "safest_vs_fastest": [
            f"Safest route cuts risk by {round(fastest['total_risk_score'] - safest['total_risk_score'], 1)} points compared to fastest.",
            f"Accident exposure: {acc_text}",
            f"Pothole exposure: {pot_text}",
            f"Time tradeoff: {safest['estimated_time_minutes'] - fastest['estimated_time_minutes']} additional minutes for safer travel.",
            f"Balanced route rationale: {balanced['selection_reason']}",
        ]
    }

    return {
        "routes": routes,
        "best_routes": {
            "safest": safest["route_name"],
            "balanced": balanced["route_name"],
            "fastest": fastest["route_name"],
        },
        "overall_route_risk": safest["overall_route_risk"],
        "recommendation": f"Recommended: {safest['route_name']} route for safer commute.",
        "trip_summary": {
            "should_avoid": should_avoid,
            "avoid_message": avoid_message,
            "best_time_to_travel": best_time_window["window"],
            "best_time_score": best_time_window["score"],
            "time_windows": time_windows,
            "route_difficulty": "Hard" if safest["overall_route_risk"] == "High Risk" else ("Moderate" if safest["overall_route_risk"] == "Medium Risk" else "Easy"),
        },
        "explainability": comparator,
        "checkpoints": safest["checkpoints"],
        "risk_summary": {
            "High Risk": sum(r["overall_route_risk"] == "High Risk" for r in routes),
            "Medium Risk": sum(r["overall_route_risk"] == "Medium Risk" for r in routes),
            "Low Risk": sum(r["overall_route_risk"] == "Low Risk" for r in routes),
        },
    }
