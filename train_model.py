import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, ExtraTreesClassifier
import joblib

def generate_training_data(n=1800, seed=42):
    np.random.seed(seed)

    accident_count = np.random.randint(0, 16, n)
    pothole_count = np.random.randint(0, 10, n)
    intersection_presence = np.random.randint(0, 2, n)
    traffic_density = np.random.randint(18, 96, n)
    reported_hazards = np.random.randint(0, 8, n)
    black_spot_nearby = np.random.randint(0, 2, n)
    district_risk_score = np.random.randint(28, 92, n)
    weather_factor = np.random.randint(1, 3, n)   # 1=Clear, 2=Rainy
    time_factor = np.random.randint(1, 5, n)      # 1=Morning, 2=Afternoon, 3=Evening, 4=Night

    X = pd.DataFrame({
        "accident_count": accident_count,
        "pothole_count": pothole_count,
        "intersection_presence": intersection_presence,
        "traffic_density": traffic_density,
        "reported_hazards": reported_hazards,
        "black_spot_nearby": black_spot_nearby,
        "district_risk_score": district_risk_score,
        "weather_factor": weather_factor,
        "time_factor": time_factor
    })

    risk_score = (
        accident_count * 2.0 +
        pothole_count * 1.5 +
        intersection_presence * 9 +
        traffic_density * 0.4 +
        reported_hazards * 2.2 +
        black_spot_nearby * 13 +
        district_risk_score * 0.45 +
        weather_factor * 5 +
        time_factor * 3.5
    )

    y = []
    for score in risk_score:
        if score >= 124:
            y.append("High Risk")
        elif score >= 86:
            y.append("Medium Risk")
        else:
            y.append("Low Risk")

    return X, y

def train():
    X, y = generate_training_data()

    rf_model = RandomForestClassifier(
        n_estimators=150,
        random_state=42,
        max_depth=10
    )
    rf_model.fit(X, y)

    et_model = ExtraTreesClassifier(
        n_estimators=220,
        random_state=43,
        max_depth=12,
        min_samples_leaf=2
    )
    et_model.fit(X, y)

    joblib.dump(rf_model, "risk_model.pkl")
    joblib.dump(et_model, "risk_model_extra_trees.pkl")
    print("Models trained and saved as risk_model.pkl + risk_model_extra_trees.pkl")

if __name__ == "__main__":
    train()