from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "risk_model.pkl"
ALT_MODEL_PATH = BASE_DIR / "risk_model_extra_trees.pkl"

DATA_FILES = {
    "accidents": BASE_DIR / "accident_data.csv",
    "potholes": BASE_DIR / "pothole_data.csv",
    "intersections": BASE_DIR / "intersection_data.csv",
    "hazards": BASE_DIR / "hazards.csv",
    "district_summary": BASE_DIR / "district_summary.csv",
    "prediction_history": BASE_DIR / "prediction_history.csv",
    "alerts": BASE_DIR / "alerts.csv",
    "hospitals": BASE_DIR / "hospitals.csv",
    "police_stations": BASE_DIR / "police_stations.csv",
    "accident_trends": BASE_DIR / "accident_trends.csv"
}

CITIES = {
    "mumbai": [19.0760, 72.8777], "navi mumbai": [19.0330, 73.0297], "thane": [19.2183, 72.9781],
    "pune": [18.5204, 73.8567], "nashik": [19.9975, 73.7898], "nagpur": [21.1458, 79.0882],
    "aurangabad": [19.8762, 75.3433], "kolhapur": [16.7050, 74.2433], "solapur": [17.6599, 75.9064],
    "ahmednagar": [19.0948, 74.7480], "amravati": [20.9374, 77.7796], "jalgaon": [21.0077, 75.5626],
    "latur": [18.4088, 76.5604], "nanded": [19.1383, 77.3210], "satara": [17.6805, 74.0183],
    "sangli": [16.8524, 74.5815], "ratnagiri": [16.9902, 73.3120], "chandrapur": [19.9615, 79.2961],
    "akola": [20.7002, 77.0082], "wardha": [20.7453, 78.6022], "vashi": [19.0771, 72.9986]
}

# Extra locality-level coverage for practical commuter routing.
CITIES.update({
    "nerul": [19.0338, 73.0199],
    "seawoods": [19.0210, 73.0177],
    "seawoods darave": [19.0227, 73.0170],
    "belapur": [19.0156, 73.0381],
    "cbd belapur": [19.0267, 73.0400],
    "kharghar": [19.0470, 73.0698],
    "sanpada": [19.0606, 73.0100],
    "juinagar": [19.0495, 73.0157],
    "koparkhairane": [19.1030, 73.0075],
    "ghansoli": [19.1147, 72.9981],
    "airoli": [19.1550, 72.9994],
    "ulwe": [18.9994, 73.0361],
    "panvel": [18.9894, 73.1175],
    "kamothe": [19.0160, 73.0960],
    "dronagiri": [18.9443, 72.9558],
    "turbhe": [19.0675, 73.0200],
})

CITY_TO_DISTRICT = {k.title(): k.title() for k in CITIES.keys()}
CITY_TO_DISTRICT.update({
    "Navi Mumbai": "Thane",
    "Vashi": "Thane",
    "Nerul": "Thane",
    "Seawoods": "Thane",
    "Seawoods Darave": "Thane",
    "Belapur": "Thane",
    "Cbd Belapur": "Thane",
    "Kharghar": "Raigad",
    "Sanpada": "Thane",
    "Juinagar": "Thane",
    "Koparkhairane": "Thane",
    "Ghansoli": "Thane",
    "Airoli": "Thane",
    "Ulwe": "Raigad",
    "Panvel": "Raigad",
    "Kamothe": "Raigad",
    "Dronagiri": "Raigad",
    "Turbhe": "Thane",
})
