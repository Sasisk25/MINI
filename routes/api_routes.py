from datetime import datetime
import pandas as pd
from flask import Blueprint, jsonify, render_template, request
from config import DATA_FILES, CITIES
from utils.io_utils import load_csv_safe
from utils.geo_utils import nearest_city, district_for_city, resolve_location
from services.data_service import get_state_data
from services.district_service import get_rankings, compare_districts
from services.prediction_service import get_prediction, get_prediction_history
from services.route_service import analyze_routes
from services.alert_service import get_alerts
from services.trend_service import get_trends
from services.emergency_service import nearest_emergency
from services.simulation_service import simulate_live_updates

bp = Blueprint("api", __name__)

@bp.route("/")
def index():
    return render_template("index.html")

@bp.route("/get_state_data")
def state_data():
    return jsonify(get_state_data())

@bp.route("/get_district_rankings")
def ranks():
    return jsonify(get_rankings())

@bp.route("/report_hazard", methods=["POST"])
def report_hazard():
    data = request.get_json()
    hazards = load_csv_safe(DATA_FILES["hazards"], columns=["id","hazard_type","city","district","latitude","longitude","description","timestamp"])
    lat, lng, htype = float(data["lat"]), float(data["lng"]), data["type"]
    city = nearest_city(lat, lng)
    district = district_for_city(city)
    new_row = pd.DataFrame([{"id": 1 if hazards.empty else int(hazards["id"].max())+1, "hazard_type": htype, "city": city, "district": district, "latitude": lat, "longitude": lng, "description": f"User reported {htype}", "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}])
    pd.concat([hazards, new_row], ignore_index=True).to_csv(DATA_FILES["hazards"], index=False)
    return jsonify({"status":"success","message":"Hazard reported successfully"})

@bp.route("/get_hazards")
def get_hazards():
    return jsonify(load_csv_safe(DATA_FILES["hazards"]).to_dict(orient="records"))

@bp.route("/predict", methods=["POST"])
def predict():
    d = request.get_json()
    return jsonify(get_prediction(float(d["lat"]), float(d["lng"]), d.get("weather","auto"), d.get("time_mode","auto")))

@bp.route("/route_risk", methods=["POST"])
def route_risk():
    d = request.get_json()
    s, e = d["start"], d["end"]
    return jsonify(analyze_routes((float(s["lat"]), float(s["lng"])), (float(e["lat"]), float(e["lng"])), d.get("weather","auto"), d.get("time_mode","auto")))

@bp.route("/search_location")
def search_location():
    q = request.args.get("query", "").strip().lower()
    result = resolve_location(q)
    if result:
        return jsonify({
            "status": "found",
            "coords": result["coords"],
            "name": result["name"],
            "matches": result["matches"]
        })
    return jsonify({"status":"not_found", "matches": []})


@bp.route("/location_suggestions")
def location_suggestions():
    q = request.args.get("query", "").strip().lower()
    if not q:
        all_locations = sorted([name.title() for name in CITIES.keys()])[:120]
        return jsonify({"suggestions": all_locations})
    starts = [name.title() for name in CITIES.keys() if name.startswith(q)]
    contains = [name.title() for name in CITIES.keys() if q in name and not name.startswith(q)]
    return jsonify({"suggestions": (starts + contains)[:20]})

@bp.route("/get_prediction_history")
def history():
    return jsonify(get_prediction_history())

@bp.route("/get_alerts")
def alerts():
    return jsonify(get_alerts())

@bp.route("/get_trends")
def trends():
    return jsonify(get_trends())

@bp.route("/compare_districts")
def compare():
    return jsonify(compare_districts(request.args.get("district1", ""), request.args.get("district2", "")))

@bp.route("/nearest_emergency")
def nearest_emergency_route():
    return jsonify(nearest_emergency(float(request.args.get("lat")), float(request.args.get("lng"))))


@bp.route("/simulate_live_updates", methods=["POST"])
def simulate_live_updates_route():
    return jsonify({"status": "ok", "result": simulate_live_updates()})
