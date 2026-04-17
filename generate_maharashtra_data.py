import argparse
import random
import numpy as np
import pandas as pd

np.random.seed(42)
random.seed(42)

CITIES = [
    {"city":"Mumbai","district":"Mumbai","lat":19.0760,"lng":72.8777,"density":1.0},
    {"city":"Navi Mumbai","district":"Thane","lat":19.0330,"lng":73.0297,"density":0.85},
    {"city":"Thane","district":"Thane","lat":19.2183,"lng":72.9781,"density":0.8},
    {"city":"Pune","district":"Pune","lat":18.5204,"lng":73.8567,"density":0.9},
    {"city":"Nashik","district":"Nashik","lat":19.9975,"lng":73.7898,"density":0.65},
    {"city":"Nagpur","district":"Nagpur","lat":21.1458,"lng":79.0882,"density":0.75},
    {"city":"Aurangabad","district":"Aurangabad","lat":19.8762,"lng":75.3433,"density":0.6},
    {"city":"Kolhapur","district":"Kolhapur","lat":16.7050,"lng":74.2433,"density":0.55},
    {"city":"Solapur","district":"Solapur","lat":17.6599,"lng":75.9064,"density":0.6},
    {"city":"Ahmednagar","district":"Ahmednagar","lat":19.0948,"lng":74.7480,"density":0.55}
]

# Add high-utility commuter localities (Navi Mumbai / Raigad belt).
CITIES.extend([
    {"city":"Nerul","district":"Thane","lat":19.0338,"lng":73.0199,"density":0.78},
    {"city":"Seawoods","district":"Thane","lat":19.0210,"lng":73.0177,"density":0.76},
    {"city":"Belapur","district":"Thane","lat":19.0156,"lng":73.0381,"density":0.72},
    {"city":"Kharghar","district":"Raigad","lat":19.0470,"lng":73.0698,"density":0.74},
    {"city":"Panvel","district":"Raigad","lat":18.9894,"lng":73.1175,"density":0.7},
    {"city":"Ulwe","district":"Raigad","lat":18.9994,"lng":73.0361,"density":0.68}
])


def _privacy_preserving_anchor(lat, lng):
    """
    Obfuscate exact user location before synthetic seeding.
    This keeps locality relevance without storing exact coordinates.
    """
    noisy_lat = round(float(lat) + np.random.uniform(-0.02, 0.02), 4)
    noisy_lng = round(float(lng) + np.random.uniform(-0.02, 0.02), 4)
    return noisy_lat, noisy_lng


def build_city_pool(current_lat=None, current_lng=None):
    city_pool = list(CITIES)
    if current_lat is not None and current_lng is not None:
        obf_lat, obf_lng = _privacy_preserving_anchor(current_lat, current_lng)
        city_pool.append({
            "city": "Local User Zone",
            "district": "User Region",
            "lat": obf_lat,
            "lng": obf_lng,
            "density": 0.9
        })
    return city_pool

def jitter(a, b, spread=0.08):
    return round(a + np.random.uniform(-spread, spread), 6), round(b + np.random.uniform(-spread, spread), 6)

def generate_accidents(city_pool):
    rows, idx = [], 1
    for c in city_pool:
        for _ in range(random.randint(2,4)):
            clat, clng = jitter(c["lat"], c["lng"], 0.03)
            for _ in range(random.randint(3,7)):
                lat, lng = jitter(clat, clng, 0.02)
                road = random.choice(["Highway","Urban Road","Intersection","Bypass"])
                mult = 1.35 if road=="Highway" else (1.15 if road=="Intersection" else 0.95)
                count = max(1, int(np.random.normal(8 + c["density"]*6, 3) * mult))
                sev = "High" if count >= 12 else ("Medium" if count >= 7 else "Low")
                rows.append({"id":idx,"city":c["city"],"district":c["district"],"latitude":lat,"longitude":lng,"accident_count":count,"severity":sev,"year":2025,"road_type":road}); idx += 1
    pd.DataFrame(rows).to_csv("accident_data.csv", index=False)

def generate_potholes(city_pool):
    rows, idx = [], 1
    for c in city_pool:
        for _ in range(random.randint(3,6)):
            lat, lng = jitter(c["lat"], c["lng"], 0.05)
            p = max(1, int(np.random.normal(4 + c["density"]*3, 2)))
            sev = "High" if p >= 8 else ("Medium" if p >= 4 else "Low")
            rows.append({"id":idx,"city":c["city"],"district":c["district"],"latitude":lat,"longitude":lng,"pothole_count":p,"severity":sev}); idx += 1
    pd.DataFrame(rows).to_csv("pothole_data.csv", index=False)

def generate_intersections(city_pool):
    rows, idx = [], 1
    for c in city_pool:
        for n in range(random.randint(2,4)):
            lat, lng = jitter(c["lat"], c["lng"], 0.04)
            td = random.randint(35,96)
            rows.append({"id":idx,"city":c["city"],"district":c["district"],"latitude":lat,"longitude":lng,"intersection_name":f"{c['city']} Junction {n+1}","risk_level":"High" if td>=80 else ("Medium" if td>=60 else "Low"),"traffic_density":td}); idx += 1
    pd.DataFrame(rows).to_csv("intersection_data.csv", index=False)

def generate_hazards():
    pd.DataFrame(columns=["id","hazard_type","city","district","latitude","longitude","description","timestamp"]).to_csv("hazards.csv", index=False)

def generate_district_summary(city_pool):
    rows=[]
    for c in city_pool:
        rows.append({"district":c["district"],"total_accidents":random.randint(100,320),"total_potholes":random.randint(60,220),"total_reported_hazards":random.randint(15,90),"avg_risk_score":random.randint(45,92),"black_spot_count":random.randint(2,16),"safety_score":random.randint(30,78)})
    pd.DataFrame(rows).drop_duplicates(subset=["district"]).to_csv("district_summary.csv", index=False)

def generate_emergency_and_trends(city_pool):
    hosp, police, trends = [], [], []
    months = pd.date_range("2025-01-01", "2025-12-01", freq="MS").strftime("%Y-%m")
    for i, c in enumerate(city_pool, 1):
        hl, hg = jitter(c["lat"], c["lng"], 0.03)
        pl, pg = jitter(c["lat"], c["lng"], 0.03)
        hosp.append({"id":i,"name":f"{c['city']} General Hospital","district":c["district"],"latitude":hl,"longitude":hg})
        police.append({"id":i,"name":f"{c['city']} Police Station","district":c["district"],"latitude":pl,"longitude":pg})
        base = int(18 + c["density"]*25)
        for m in months:
            boost = 8 if m.endswith(("06","07","08","09")) else 0
            trends.append({"month":m,"district":c["district"],"accident_count":max(4, int(np.random.normal(base + boost, 6)))})
    pd.DataFrame(hosp).to_csv("hospitals.csv", index=False)
    pd.DataFrame(police).to_csv("police_stations.csv", index=False)
    pd.DataFrame(trends).to_csv("accident_trends.csv", index=False)
    pd.DataFrame(columns=["timestamp","lat","lng","city","district","risk_level","safety_score"]).to_csv("prediction_history.csv", index=False)
    pd.DataFrame(columns=["timestamp","lat","lng","city","district","alert_level","reason"]).to_csv("alerts.csv", index=False)

def main():
    parser = argparse.ArgumentParser(description="Generate enhanced synthetic Maharashtra road-safety dataset.")
    parser.add_argument("--current-lat", type=float, default=None, help="Optional current latitude for local synthetic seeding.")
    parser.add_argument("--current-lng", type=float, default=None, help="Optional current longitude for local synthetic seeding.")
    args = parser.parse_args()

    city_pool = build_city_pool(args.current_lat, args.current_lng)
    generate_accidents(city_pool)
    generate_potholes(city_pool)
    generate_intersections(city_pool)
    generate_hazards()
    generate_district_summary(city_pool)
    generate_emergency_and_trends(city_pool)

    if args.current_lat is not None and args.current_lng is not None:
        print("Dataset generated with privacy-preserving local-area synthetic context.")
    else:
        print("Enhanced synthetic Maharashtra smart-road dataset generated successfully.")

if __name__ == "__main__":
    main()
