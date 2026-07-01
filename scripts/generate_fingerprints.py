import os
import json
import pandas as pd
import numpy as np

def main():
    print("Loading 30-year Odisha climate baseline...")
    csv_path = os.path.join("data", "odisha_historical_30yr.csv")
    
    if not os.path.exists(csv_path):
        print(f"[ERROR] Baseline CSV not found at {csv_path}. Please run fetch_data.py first.")
        return
        
    df = pd.read_csv(csv_path)
    df["date"] = pd.to_datetime(df["date"])
    
    # 1. Compute basic daily indicators
    df["temp_mean"] = (df["temp_max"] + df["temp_min"]) / 2.0
    df["temp_range_daily"] = df["temp_max"] - df["temp_min"]
    
    # 2. Compute Antecedent Precipitation Index (API) for soil moisture proxy
    # API_t = precip_t + k * API_t-1 (k = 0.85 decay factor for soil moisture drying)
    precip = df["precip_sum"].values
    api = np.zeros(len(df))
    k = 0.85
    for t in range(len(df)):
        if t == 0:
            api[t] = precip[t]
        else:
            api[t] = precip[t] + k * api[t-1]
    df["api_soil_moisture"] = api

    # 3. Compute 30-day cumulative precipitation
    df["precip_30d"] = df["precip_sum"].rolling(window=30, min_periods=1).sum()
    
    # 4. Gather statistics for percentiles to perform anomaly analysis
    # Compute quantiles grouped by month of the year to account for monsoonal seasonality
    df["month"] = df["date"].dt.month
    
    # Compute 30-day precipitation percentiles per month
    precip_30d_pcts = df.groupby("month")["precip_30d"].quantile([0.10, 0.25, 0.50, 0.75, 0.90]).unstack()
    # Compute API percentiles per month
    api_pcts = df.groupby("month")["api_soil_moisture"].quantile([0.10, 0.25, 0.50, 0.75, 0.90]).unstack()
    # Compute 7-day precip max percentiles per month (for flooding threshold calibration)
    df["precip_7d"] = df["precip_sum"].rolling(window=7, min_periods=1).sum()
    precip_7d_pcts = df.groupby("month")["precip_7d"].quantile([0.50, 0.75, 0.90, 0.95]).unstack()
    
    print("Processing 7-day rolling climate fingerprints and outcomes...")
    fingerprints = []
    
    # Window size is 7 days
    window_size = 7
    total_rows = len(df)
    
    for i in range(window_size - 1, total_rows):
        window = df.iloc[i - window_size + 1 : i + 1]
        
        # End date of the window defines the fingerprint timestamp
        end_row = df.iloc[i]
        date_start = window["date"].iloc[0].strftime("%Y-%m-%d")
        date_end = end_row["date"].strftime("%Y-%m-%d")
        month = end_row["month"]
        
        # Fingerprint climate metrics
        temp_avg = float(window["temp_mean"].mean())
        temp_range = float(window["temp_max"].max() - window["temp_min"].min())
        humidity_avg = float(window["humidity"].mean())
        precip_sum = float(window["precip_sum"].sum())
        wind_avg = float(window["wind_speed_max"].mean())
        
        # Hydrological and agricultural outcomes
        api_val = float(end_row["api_soil_moisture"])
        precip_30d_val = float(end_row["precip_30d"])
        
        # Fetch month-specific percentiles
        p10_30d = precip_30d_pcts.loc[month, 0.10]
        p25_30d = precip_30d_pcts.loc[month, 0.25]
        p50_30d = precip_30d_pcts.loc[month, 0.50]
        p90_30d = precip_30d_pcts.loc[month, 0.90]
        
        p10_api = api_pcts.loc[month, 0.10]
        p50_api = api_pcts.loc[month, 0.50]
        
        p90_7d = precip_7d_pcts.loc[month, 0.90]
        p95_7d = precip_7d_pcts.loc[month, 0.95]
        
        # Outcome: Water Stress Score (0 to 100)
        # Higher stress when soil moisture (API) is below median for that month
        if api_val < p50_api:
            # Scale from 0 (at median) to 100 (at or below 10th percentile / near zero)
            div = (p50_api - p10_api) if (p50_api - p10_api) > 1.0 else 1.0
            water_stress = min(100.0, max(0.0, 100.0 * (p50_api - api_val) / div))
        else:
            water_stress = 0.0
            
        # Outcome: Flood Risk Score (0 to 100)
        # Higher risk when 7-day precipitation is high, calibrated by monthly thresholds
        if precip_sum > p90_7d:
            div = (p95_7d - p90_7d) if (p95_7d - p90_7d) > 10.0 else 10.0
            flood_risk = min(100.0, max(0.0, 50.0 + 50.0 * (precip_sum - p90_7d) / div))
        elif precip_sum > 10.0:
            flood_risk = min(50.0, max(0.0, 50.0 * precip_sum / p90_7d))
        else:
            flood_risk = 0.0
            
        # Outcome: Agricultural Damage Functions (simulating crop yield impacts)
        # 1. Drought damage (sensitive to 30-day precipitation deficit)
        drought_damage = 0.0
        if precip_30d_val < p25_30d:
            # Maximum of 45% loss if rainfall drops to 0
            drought_damage = 0.45 * (1.0 - (precip_30d_val / p25_30d))**2
            
        # 2. Flood damage (sensitive to excessive 7-day rainfall submergence)
        flood_damage = 0.0
        if precip_sum > 100.0:
            # Linear scale up to 40% crop loss at 250mm/week
            flood_damage = min(0.40, 0.40 * (precip_sum - 100.0) / 150.0)
            
        # 3. Heat damage (sensitive to spikelet sterility at temperatures > 36C)
        heat_days = int((window["temp_max"] > 36.0).sum())
        heat_damage = min(0.15, 0.03 * heat_days)
        
        # Combine independent yield damage factors
        net_damage = 1.0 - (1.0 - drought_damage) * (1.0 - flood_damage) * (1.0 - heat_damage)
        crop_impact = -100.0 * net_damage
        
        # If no damages, add a small positive boost (+1% to +6%) to represent healthy growing conditions
        if crop_impact == 0.0:
            # Good rainfall (between 25th and 75th percentiles) and mild temperatures
            if (precip_30d_val >= p25_30d) and (precip_30d_val <= p90_30d) and (temp_avg < 29.0):
                crop_impact = 4.5
            else:
                crop_impact = 1.5
                
        # Classify Disaster Types based on thresholds
        disaster = "None"
        if precip_sum > 200.0:
            disaster = "Severe Flood"
        elif precip_sum > p95_7d and precip_sum > 100.0:
            disaster = "Moderate Flood"
        elif water_stress > 80.0 and crop_impact < -20.0:
            disaster = "Severe Drought"
        elif water_stress > 60.0 and crop_impact < -10.0:
            disaster = "Moderate Drought"
        elif temp_avg > 33.0 and heat_days >= 4:
            disaster = "Extreme Heatwave"
            
        fp = {
            "date_start": date_start,
            "date_end": date_end,
            "temp_avg": round(temp_avg, 2),
            "temp_range": round(temp_range, 2),
            "humidity_avg": round(humidity_avg, 2),
            "precip_sum": round(precip_sum, 2),
            "wind_avg": round(wind_avg, 2),
            "outcomes": {
                "water_stress": round(water_stress, 1),
                "flood_risk": round(flood_risk, 1),
                "crop_impact": round(crop_impact, 1),
                "disaster_type": disaster
            }
        }
        fingerprints.append(fp)
        
    output_json_path = os.path.join("data", "climate_fingerprints.json")
    with open(output_json_path, "w") as f:
        json.dump(fingerprints, f, indent=2)
        
    print(f"\n[SUCCESS] Generated {len(fingerprints)} climate fingerprints.")
    print(f"Database saved to: {output_json_path}")
    print("\nSample Fingerprint Data:")
    print(json.dumps(fingerprints[0], indent=2))
    print(json.dumps(fingerprints[-1], indent=2))

if __name__ == "__main__":
    main()
