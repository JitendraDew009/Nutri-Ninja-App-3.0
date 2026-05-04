# 🥷 Nutri Ninja – Smart Food Scanner App

Nutri Ninja is a React Native mobile application that helps users analyze packaged food products instantly by scanning barcodes or entering them manually. It provides detailed nutritional insights, health scores, ingredient analysis, and smart warnings to help users make better food choices.

---

##  Demo Video

🔗 Live Demo: *(https://www.linkedin.com/posts/jitendradewangan_ai-healthtech-startupjourney-activity-7434648226622013440--yk8?utm_source=share&utm_medium=member_desktop&rcm=ACoAAFmaX9wBTd0yGSkiUzk_lEUlFo2dzgAFxcE)*  

---

## 🚀 Features

### 📷 Barcode Scanning
- Scan product barcodes using camera (Expo Camera)
- Supports formats like EAN-13, UPC, Code128
- Manual barcode entry fallback

### 🌍 Open Food Facts Integration
- Fetches real-time product data from Open Food Facts API
- Includes caching for faster repeat lookups

### 🧠 Smart Health Analysis
- Health Score (1–100) based on:
  - Sugar, fat, salt
  - Fiber and protein
  - Additives impact

### 🚦 Traffic Light System
- Visual indicators for:
  - Sugar levels
  - Salt levels
- Easy red/yellow/green understanding

### 📊 Nutrition Visualization
- Macro Bar Chart (Fat, Carbs, Protein, etc.)
- Radar Chart for overall nutrient balance

### ⚠️ Smart Warnings
- Detects:
  - High sugar, salt, saturated fat
  - Allergens (milk, soy, gluten, etc.)
  - Suspicious additives

### 🧪 Ingredient Scanner
- Identifies harmful or artificial ingredients:
  - Preservatives
  - Artificial colors
  - MSG and sweeteners

### 🧾 Additives Risk Analysis
- Categorizes additives into:
  - High risk
  - Moderate risk
  - Low risk

### 💾 Offline Cache
- Stores previously scanned products locally
- Improves performance and reduces API calls

---

## 🛠️ Tech Stack

- React Native (Expo)
- TypeScript
- Expo Camera API
- AsyncStorage (local caching)
- Open Food Facts API

---

## 📱 App Flow

1. Launch app → Welcome screen  
2. Start camera or enter barcode manually  
3. Scan product  
4. Fetch product data  
5. Display:
   - Product details
   - Health score
   - Nutrition charts
   - Warnings & ingredient insights  

---

## 📦 Installation

```bash
git clone https://github.com/your-username/nutri-ninja.git
cd nutri-ninja

npm install
npx expo start
```

---

## 🔐 Permissions

- Camera access required for barcode scanning

---

## ⚙️ Key Functional Modules

### 1. Product Fetching
- API: Open Food Facts
- Normalization layer to handle missing data

### 2. Health Score Algorithm
- Penalizes:
  - Sugar
  - Saturated fat
  - Salt
- Rewards:
  - Fiber
  - Protein

### 3. Smart Warning Engine
- Rule-based detection system
- Allergen + additive scanning

### 4. Caching System
- Uses AsyncStorage
- Key: `off_product_cache_v1`

---

## ⚠️ Disclaimer

- This app is a prototype  
- Data is sourced from Open Food Facts  
- Always verify nutrition labels for medical or clinical use  

---

## 👨‍💻 Author

**Jitendra Dewangan**  
Creator of Nutri Ninja  

---

## 🌟 Future Improvements

- AI-based personalized health recommendations  
- User profile (diet preferences, allergies)  
- Offline scanning with ML models  
- Food comparison feature  
- Cloud sync & analytics dashboard  

---

## 🤝 Contributing

Contributions are welcome!  
Feel free to fork the repo and submit pull requests.
