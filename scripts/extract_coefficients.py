import json
import numpy as np

def main():
    print("Extracting region-specific climate sensitivity coefficients...")
    try:
        with open('data/climate_fingerprints.json', 'r') as f:
            data = json.load(f)
    except FileNotFoundError:
        print("Error: data/climate_fingerprints.json not found.")
        return
        
    temps = [d['temp_avg'] for d in data]
    crops = [d['outcomes']['crop_impact'] for d in data]
    precips = [d['precip_sum'] for d in data]
    floods = [d['outcomes']['flood_risk'] for d in data]
    
    # Simple linear regression proxy: correlation coefficient
    # Using np.cov safely
    if len(temps) > 1:
        crop_temp_cov = np.cov(temps, crops)[0][1]
        temp_var = np.var(temps)
        crop_sensitivity = crop_temp_cov / temp_var if temp_var > 0 else 0
        
        flood_precip_cov = np.cov(precips, floods)[0][1]
        precip_var = np.var(precips)
        flood_sensitivity = flood_precip_cov / precip_var if precip_var > 0 else 0
    else:
        crop_sensitivity = 0
        flood_sensitivity = 0

    coeffs = {
        "region": "Odisha",
        "crop_yield_per_degree_C": float(crop_sensitivity),
        "flood_risk_per_mm_rain": float(flood_sensitivity)
    }
    
    with open('data/odisha_coefficients.json', 'w') as f:
        json.dump(coeffs, f, indent=2)
        
    print("\nExtracted Coefficients:")
    print(f"- Crop Sensitivity: {coeffs['crop_yield_per_degree_C']:.2f}% yield change per +1°C")
    print(f"- Flood Risk Sensitivity: +{coeffs['flood_risk_per_mm_rain']:.2f} risk points per +1mm rain")
    print("\nSaved to data/odisha_coefficients.json")

if __name__ == "__main__":
    main()
