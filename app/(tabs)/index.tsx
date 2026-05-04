import { ThemedText } from "@/components/themed-text";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Camera from "expo-camera";
import React, { useEffect, useRef, useState } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

// Type definitions
interface Product {
  code?: string;
  product_name?: string;
  brands?: string;
  image?: string | null;
  nutriments?: Record<string, number | null>;
  nutrition_grade?: string | null;
  ingredients_text?: string;
  additives_tags?: string[];
  allergens_tags?: string[];
  additives?: string[];
  allergens?: string;
  ingredients_analysis_tags?: string[];
  quantity?: string;
  not_found?: boolean;
}

/*
  NutriScan - Single-file app component
  - Barcode scanning (BarcodeDetector) with manual lookup fallback
  - Open Food Facts lookup + caching
  - Nutri-Score gauge with animated needle
  - Macro bar chart + radar chart
  - Health score, traffic lights, additives, warnings, clean-scan
  Defensive: tolerates missing fields and missing APIs.
*/

const safeNum = (v: any): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const NUTRI_COLORS = {
  a: "#1FA260",
  b: "#85C742",
  c: "#F7D622",
  d: "#E98E2C",
  e: "#D72020",
};
const CACHE_KEY = "off_product_cache_v1";

// Traffic light small UI
function TrafficLight({
  label,
  value,
  thresholds,
}: {
  label: string;
  value: number | null;
  thresholds: { medium: number; high: number };
}) {
  if (value == null)
    return (
      <View style={styles.trafficLightContainer}>
        <ThemedText
          style={{ fontWeight: "700", color: "#d0d0d0", fontSize: 13 }}
        >
          {label}:
        </ThemedText>
        <ThemedText style={{ color: "#888", fontWeight: "600" }}>—</ThemedText>
      </View>
    );
  let color = "#00C853";
  if (value > thresholds.high) color = "#FF5252";
  else if (value > thresholds.medium) color = "#FFD600";
  return (
    <View style={styles.trafficLightContainer}>
      <ThemedText style={{ fontWeight: "700", color: "#d0d0d0", fontSize: 13 }}>
        {label}:
      </ThemedText>
      <View style={[styles.trafficLightBadge, { backgroundColor: color }]}>
        <ThemedText style={{ color: "#000", fontWeight: "800", fontSize: 13 }}>
          {value}
        </ThemedText>
      </View>
    </View>
  );
}

// Additives list (simple risk bucketing)
function AdditivesList({ additives = [] }: { additives?: string[] }) {
  if (!additives || additives.length === 0)
    return (
      <ThemedText
        style={{ color: "#a0a0a0", marginVertical: 4, fontWeight: "600" }}
      >
        No additives listed
      </ThemedText>
    );
  const riskOf = (code: string): string => {
    const c = (code || "").toLowerCase();
    const match = c.match(/e(\d{2,3})/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!Number.isNaN(num)) {
        if (num >= 100 && num < 200) return "High";
        if (num >= 200 && num < 400) return "Moderate";
        return "Low";
      }
    }
    if (c.includes("color") || c.includes("tartrazine") || c.includes("allura"))
      return "High";
    if (c.includes("benzo") || c.includes("preserv")) return "Moderate";
    return "Low";
  };

  return (
    <View>
      {additives.map((a: string) => (
        <View key={a} style={{ marginBottom: 8 }}>
          <ThemedText
            style={{ fontWeight: "600", color: "#d0d0d0", fontSize: 13 }}
          >
            <ThemedText style={{ fontWeight: "800", color: "#76FF03" }}>
              {a}
            </ThemedText>{" "}
            —{" "}
            <ThemedText style={{ fontWeight: "700", color: "#b0b0b0" }}>
              {riskOf(a)}
            </ThemedText>
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

// Health score (1-100) — simple weighted heuristic
function getHealthScore(product: Product | null): number {
  if (!product || !product.nutriments) return 50;
  const n = product.nutriments;
  let score = 100;
  score -= (n.sugars_100g || n.sugars || 0) * 1.8;
  score -=
    (n["saturated-fat_100g"] || n["saturated-fat"] || n.saturated_fat || 0) *
    2.2;
  score -= (n.salt_100g || n.salt || 0) * 1.5;
  const additives = product.additives_tags || product.additives || [];
  const highRiskAdd = additives.filter((a: string) =>
    /e10|e1|e102|e129/i.test(a),
  ).length;
  score -= highRiskAdd * 6;
  score += (n.fiber_100g || n.fiber || 0) * 1.5;
  score += (n.proteins_100g || n.proteins || n.protein || 0) * 1.2;
  return Math.round(Math.max(1, Math.min(100, score)));
}

// Smart warnings
function getSmartWarnings(p: Product | null): string[] {
  if (!p) return [];
  const warnings: string[] = [];
  const n = p.nutriments || {};
  if ((n.sugars_100g || n.sugars || 0) > 22.5)
    warnings.push("High sugar content");
  if ((n["saturated-fat_100g"] || n.saturated_fat || 0) > 5)
    warnings.push("High saturated fat");
  if ((n.salt_100g || n.salt || 0) > 1.5) warnings.push("High salt content");
  const allergensText = (p.allergens || "").toLowerCase();
  const commonAllergens = [
    "milk",
    "soy",
    "egg",
    "peanut",
    "tree nut",
    "sesame",
    "fish",
    "shellfish",
    "gluten",
    "wheat",
    "mustard",
    "sulphite",
  ];
  const foundAll = commonAllergens.filter(
    (a: string) =>
      allergensText.includes(a) ||
      (p.allergens_tags || []).some((tag: string) =>
        tag.includes(a.replace(/ /g, "-")),
      ),
  );
  if (foundAll.length)
    warnings.push(`Contains allergens: ${foundAll.join(", ")}`);
  const additives = p.additives_tags || [];
  const suspicious = additives.filter((a: string) =>
    /e102|e110|e129|e211|e621/i.test(a),
  );
  if (suspicious.length)
    warnings.push(`Contains suspicious additives: ${suspicious.join(", ")}`);
  return warnings;
}

// Clean ingredient scan
function scanIngredientsForIssues(text: string): {
  clean: boolean;
  found: string[];
} {
  if (!text) return { clean: true, found: [] };
  const keywords = [
    "color",
    "colour",
    "tartrazine",
    "allura",
    "sunset yellow",
    "preservative",
    "benzo",
    "sorbate",
    "msg",
    "monosodium glutamate",
    "e621",
    "e951",
    "ace-k",
    "sucralose",
    "palm",
  ];
  const found = keywords.filter((k: string) => text.toLowerCase().includes(k));
  return { clean: found.length === 0, found };
}

// Welcome Screen Component
function WelcomeScreen() {
  return (
    <View style={styles.welcomeContainer}>
      <View style={styles.welcomeContent}>
        <Image
          source={require("@/assets/images/nutri-ninja-logo.png")}
          style={styles.welcomeLogo}
        />
      </View>
    </View>
  );
}

// Macro bar chart (simplified for React Native)
function MacroBarChart({
  nutriments = {},
}: {
  nutriments?: Record<string, number | null>;
}) {
  const bars = [
    { key: "fat", label: "Fat (g)" },
    { key: "saturated-fat", label: "Sat Fat (g)" },
    { key: "carbohydrates", label: "Carbs (g)" },
    { key: "sugars", label: "Sugars (g)" },
    { key: "proteins", label: "Protein (g)" },
    { key: "fiber", label: "Fiber (g)" },
    { key: "salt", label: "Salt (g)" },
  ];
  const values = bars.map(
    (b) =>
      (nutriments[b.key + "_100g"] as number) ??
      (nutriments[b.key] as number) ??
      0,
  );
  const maxVal = Math.max(...values, 10);

  return (
    <View>
      {bars.map((b, i) => {
        const v = values[i] || 0;
        const pct = Math.min(1, v / (maxVal || 1));
        return (
          <View key={b.key} style={styles.barRow}>
            <ThemedText style={styles.barLabel}>{b.label}</ThemedText>
            <View
              style={[styles.barBackground, { flex: 1, marginHorizontal: 8 }]}
            >
              <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
            </View>
            <ThemedText style={styles.barValue}>{v ?? "—"}</ThemedText>
          </View>
        );
      })}
    </View>
  );
}

// Radar chart (simplified for React Native)
function RadarChart({
  nutriments = {},
}: {
  nutriments?: Record<string, number | null>;
}) {
  const axes = [
    { key: "energy-kcal", label: "Energy" },
    { key: "fat", label: "Fat" },
    { key: "sugars", label: "Sugar" },
    { key: "proteins", label: "Protein" },
    { key: "fiber", label: "Fiber" },
  ];
  const caps: Record<string, number> = {
    "energy-kcal": 600,
    fat: 50,
    sugars: 60,
    proteins: 50,
    fiber: 20,
  };

  return (
    <View style={styles.radarContainer}>
      {axes.map((a) => {
        const key = a.key;
        const raw =
          (nutriments[key + "_100g"] as number) ??
          (nutriments[key] as number) ??
          0;
        const norm = Math.min(1, raw / (caps[key] || 1));
        return (
          <View key={a.key} style={styles.radarRow}>
            <ThemedText style={styles.radarLabel}>{a.label}</ThemedText>
            <View style={styles.radarBarBackground}>
              <View
                style={[styles.radarBarFill, { width: `${norm * 100}%` }]}
              />
            </View>
            <ThemedText style={styles.radarValue}>{raw.toFixed(1)}</ThemedText>
          </View>
        );
      })}
    </View>
  );
}

// Styles
const styles = StyleSheet.create({
  welcomeContainer: {
    flex: 1,
    backgroundColor: "#0D47A1",
    justifyContent: "center",
    alignItems: "center",
  },
  welcomeContent: {
    alignItems: "center",
    gap: 20,
  },
  welcomeLogo: {
    width: 280,
    height: 280,
    resizeMode: "contain",
  },
  container: { flex: 1, backgroundColor: "#0F1419" },
  contentContainer: { padding: 16, paddingBottom: 40 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: "#1a1f2e",
    borderRadius: 12,
  },
  headerLogo: { width: 50, height: 50, marginRight: 10 },
  headerTitle: { flexDirection: "row", alignItems: "center", flex: 1 },
  title: { fontSize: 28, fontWeight: "800", color: "#76FF03" },
  cacheHits: { fontSize: 14, fontWeight: "600", color: "#76FF03" },
  section: { marginBottom: 16 },
  controls: { flexDirection: "row", gap: 8, marginBottom: 8 },
  inputRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#76FF03",
    borderRadius: 8,
    justifyContent: "center",
  },
  buttonText: { color: "#0D47A1", fontWeight: "700", fontSize: 15 },
  input: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#76FF03",
    fontSize: 15,
    backgroundColor: "#1a1f2e",
    color: "#fff",
    fontWeight: "600",
  },
  videoContainer: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000",
    minHeight: 300,
  },
  camera: { flex: 1, width: "100%" },
  placeholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#1a1f2e",
  },
  statusText: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: "600",
    color: "#76FF03",
  },
  productCard: {
    backgroundColor: "#1a1f2e",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: "#76FF03",
  },
  productHeader: { flexDirection: "row", gap: 12, marginBottom: 16 },
  productImage: { width: 120, height: 120, borderRadius: 12 },
  productImagePlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 12,
    backgroundColor: "#0F1419",
  },
  productInfo: { flex: 1 },
  productName: {
    fontSize: 18,
    fontWeight: "800",
    color: "#76FF03",
    marginBottom: 4,
  },
  productMeta: {
    fontSize: 14,
    fontWeight: "600",
    color: "#b0b0b0",
    marginBottom: 8,
  },
  healthScoreContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  healthScore: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#76FF03",
  },
  healthScoreText: { color: "#0D47A1", fontWeight: "800", fontSize: 16 },
  healthScoreLabel: { fontSize: 13, fontWeight: "600", color: "#b0b0b0" },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#76FF03",
    marginBottom: 8,
  },
  sectionContent: { fontSize: 14, fontWeight: "600", color: "#d0d0d0" },
  trafficLights: { gap: 12, marginTop: 10 },
  trafficLightContainer: { flexDirection: "row", alignItems: "center", gap: 8 },
  trafficLightBadge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    fontWeight: "700",
  },
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  barLabel: { width: 80, fontSize: 13, fontWeight: "700", color: "#d0d0d0" },
  barBackground: {
    height: 18,
    borderRadius: 9,
    backgroundColor: "#2a3a4a",
    overflow: "hidden",
  },
  barFill: { height: 18, borderRadius: 9, backgroundColor: "#76FF03" },
  barValue: {
    width: 45,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "right",
    color: "#d0d0d0",
  },
  radarContainer: {
    marginTop: 8,
    backgroundColor: "#1a1f2e",
    padding: 12,
    borderRadius: 8,
  },
  radarRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  radarLabel: { width: 70, fontSize: 12, fontWeight: "700", color: "#d0d0d0" },
  radarBarBackground: {
    flex: 1,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#2a3a4a",
    overflow: "hidden",
    marginHorizontal: 8,
  },
  radarBarFill: { height: 14, borderRadius: 7, backgroundColor: "#76FF03" },
  radarValue: {
    width: 45,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
    color: "#d0d0d0",
  },
  divider: { height: 2, backgroundColor: "#76FF03", marginVertical: 12 },
  warning: {
    fontSize: 14,
    marginBottom: 6,
    color: "#FF6B6B",
    fontWeight: "700",
  },
  notFoundCard: {
    backgroundColor: "#1a1f2e",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: "#0D47A1",
  },
  nutriScoreCard: {
    backgroundColor: "#1a1f2e",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#76FF03",
  },
  scoreDisplay: { alignItems: "center", marginVertical: 16 },
  scoreGrade: { fontSize: 48, fontWeight: "900", color: "#76FF03" },
  actionsCard: {
    backgroundColor: "#1a1f2e",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: "#76FF03",
  },
  actionButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#76FF03",
    borderRadius: 8,
    marginTop: 8,
  },
  footer: {
    marginTop: 24,
    fontSize: 12,
    fontWeight: "600",
    color: "#b0b0b0",
    textAlign: "center",
    paddingHorizontal: 16,
  },
  footerText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#b0b0b0",
    textAlign: "center",
  },
});

// ------------ Main App
export default function App() {
  const cameraRef = useRef<Camera.CameraView>(null);
  const scanningRef = useRef(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [status, setStatus] = useState("Idle — press Start Camera");
  const [product, setProduct] = useState<Product | null>(null);
  const [manual, setManual] = useState("");
  const [needleRotation, setNeedleRotation] = useState(-60);
  const [cacheHits, setCacheHits] = useState(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [permission, requestPermission] = Camera.useCameraPermissions();

  useEffect(() => {
    // Show welcome screen for 2 seconds
    const timer = setTimeout(() => {
      setShowWelcome(false);
    }, 2000);

    (async () => {
      if (permission === null) {
        const result = await requestPermission();
        if (!result.granted) {
          setStatus("Camera permission required");
        }
      }
    })();

    return () => {
      clearTimeout(timer);
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Camera start/stop
  async function startCamera() {
    if (permission === null) {
      const result = await requestPermission();
      if (!result.granted) {
        setStatus("Camera permission denied");
        return;
      }
    }
    if (permission && !permission.granted) {
      setStatus(
        "Camera permission denied — please grant camera access in settings",
      );
      return;
    }

    setCameraActive(true);
    scanningRef.current = true;
    setStatus("Camera active — point at barcode");
  }

  function stopCamera() {
    scanningRef.current = false;
    setCameraActive(false);
    setStatus("Camera stopped");
  }

  // Handle barcode detection from camera
  const handleBarcodeScanned = async (result: Camera.BarcodeScanningResult) => {
    if (!scanningRef.current) return;

    const code = result.data;
    if (code) {
      // Pause scanning while processing
      scanningRef.current = false;
      await onDetected(code);
      // Resume scanning after a brief delay
      setTimeout(() => {
        scanningRef.current = true;
      }, 2000);
    }
  };

  // cache helpers
  async function getCache(): Promise<Record<string, Product>> {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  async function addToCache(code: string, p: Product) {
    try {
      const c = await getCache();
      c[code] = p;
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch (e) {
      console.warn(e);
    }
  }

  // normalize OFF product
  function normalizeProduct(raw: any): Product {
    const nutr = raw.nutriments || {};
    return {
      code: raw.code,
      product_name: raw.product_name || raw.generic_name || "",
      brands: raw.brands || "",
      image:
        raw.image_small_url ||
        raw.image_front_small_url ||
        raw.image_url ||
        null,
      nutriments: {
        "energy-kcal_100g": safeNum(
          nutr["energy-kcal_100g"] ||
            nutr["energy-kcal"] ||
            nutr.energy_kcal ||
            nutr.energy,
        ),
        fat_100g: safeNum(nutr["fat_100g"] || nutr.fat),
        "saturated-fat_100g": safeNum(
          nutr["saturated-fat_100g"] ||
            nutr["saturated-fat"] ||
            nutr.saturated_fat,
        ),
        carbohydrates_100g: safeNum(
          nutr["carbohydrates_100g"] || nutr.carbohydrates,
        ),
        sugars_100g: safeNum(nutr["sugars_100g"] || nutr.sugars),
        fiber_100g: safeNum(nutr["fiber_100g"] || nutr.fiber),
        proteins_100g: safeNum(
          nutr["proteins_100g"] || nutr.proteins || nutr.protein,
        ),
        salt_100g: safeNum(nutr["salt_100g"] || nutr.salt),
        sodium_100g: safeNum(nutr["sodium_100g"] || nutr.sodium),
        sugars: safeNum(nutr.sugars),
        fat: safeNum(nutr.fat),
        proteins: safeNum(nutr.proteins || nutr.protein),
        fiber: safeNum(nutr.fiber),
        salt: safeNum(nutr.salt),
        "saturated-fat": safeNum(nutr["saturated-fat"] || nutr.saturated_fat),
      },
      nutrition_grade: raw.nutrition_grade_fr || raw.nutrition_grade || null,
      ingredients_text: raw.ingredients_text || raw.ingredients_text_en || "",
      additives_tags: raw.additives_tags || [],
      additives: raw.additives || raw.additives_original_text || [],
      allergens:
        raw.allergens ||
        (raw.allergens_tags ? raw.allergens_tags.join(", ") : "") ||
        "",
      ingredients_analysis_tags: raw.ingredients_analysis_tags || [],
      quantity: raw.quantity || "",
    };
  }

  async function onDetected(code: string) {
    if (!code) return;
    setStatus(`Detected ${code} — fetching...`);
    const cache = await getCache();
    if (cache[code]) {
      setProduct(cache[code]);
      setCacheHits((h) => h + 1);
      setStatus("Loaded from cache");
      updateNeedle(cache[code]);
      return;
    }
    try {
      const url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data && data.status === 1) {
        const p = normalizeProduct(data.product);
        setProduct(p);
        await addToCache(code, p);
        setStatus("Product loaded");
        updateNeedle(p);
      } else {
        setProduct({ not_found: true, code });
        setStatus("Product not found in Open Food Facts");
      }
    } catch (e) {
      console.error(e);
      setStatus("Network error during product lookup");
    }
  }

  function updateNeedle(p: Product | null) {
    const grade = (p?.nutrition_grade || "c").toString().toLowerCase();
    const mapping: Record<string, number> = {
      a: -60,
      b: -30,
      c: 0,
      d: 30,
      e: 60,
    };
    const rot = mapping[grade] ?? 0;
    setNeedleRotation(rot);
  }

  // derived
  const healthScore = getHealthScore(product || {});
  const warnings = getSmartWarnings(product || {});
  const cleanScan = scanIngredientsForIssues(product?.ingredients_text || "");

  // smaller, safer render tree (avoids heavy DOM when product not present)
  if (showWelcome) {
    return <WelcomeScreen />;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <Image
            source={require("@/assets/images/nutri-ninja-logo.png")}
            style={styles.headerLogo}
          />
          <ThemedText style={styles.title}>Nutri Ninja</ThemedText>
        </View>
        <ThemedText style={styles.cacheHits}>
          Cache hits: {cacheHits}
        </ThemedText>
      </View>

      <View style={styles.section}>
        <View style={styles.controls}>
          <TouchableOpacity onPress={startCamera} style={styles.button}>
            <Text style={styles.buttonText}>Start Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={stopCamera} style={styles.button}>
            <Text style={styles.buttonText}>Stop Camera</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inputRow}>
          <TextInput
            placeholder="Enter barcode manually"
            value={manual}
            onChangeText={setManual}
            style={styles.input}
            placeholderTextColor="#999"
          />
          <TouchableOpacity
            onPress={() => onDetected(manual)}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Lookup</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.videoContainer}>
          {cameraActive && permission?.granted ? (
            <Camera.CameraView
              ref={cameraRef}
              style={styles.camera}
              facing="back"
              onBarcodeScanned={
                scanningRef.current ? handleBarcodeScanned : undefined
              }
              barcodeScannerSettings={{
                barcodeTypes: ["ean13", "ean8", "upc_a", "code128", "code39"],
              }}
            />
          ) : (
            <View style={styles.placeholder}>
              <ThemedText
                style={{
                  textAlign: "center",
                  color: "#d0d0d0",
                  fontWeight: "700",
                  fontSize: 15,
                }}
              >
                Camera:{" "}
                {permission === null
                  ? "Requesting permission..."
                  : permission?.granted
                    ? "Press Start Camera"
                    : "Permission denied"}
              </ThemedText>
              <ThemedText
                style={[
                  styles.statusText,
                  { color: "#76FF03", fontWeight: "700" },
                ]}
              >
                {status}
              </ThemedText>
            </View>
          )}
        </View>
      </View>

      {product && !product.not_found && (
        <View style={styles.section}>
          <View style={styles.productCard}>
            <View style={styles.productHeader}>
              {product.image ? (
                <Image
                  source={{ uri: product.image }}
                  style={styles.productImage}
                />
              ) : (
                <View style={styles.productImagePlaceholder} />
              )}

              <View style={styles.productInfo}>
                <ThemedText style={styles.productName}>
                  {product.product_name}
                </ThemedText>
                <ThemedText style={styles.productMeta}>
                  {product.brands} • {product.quantity}
                </ThemedText>

                <View style={styles.healthScoreContainer}>
                  <View
                    style={[
                      styles.healthScore,
                      {
                        backgroundColor:
                          healthScore >= 60
                            ? "#1FA260"
                            : healthScore >= 35
                              ? "#F7D622"
                              : "#D72020",
                      },
                    ]}
                  >
                    <ThemedText style={styles.healthScoreText}>
                      {healthScore}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.healthScoreLabel}>
                    Health score (1-100)
                  </ThemedText>
                </View>

                <ThemedText style={styles.sectionTitle}>
                  Nutrition (per 100g/ml)
                </ThemedText>
                <MacroBarChart nutriments={product.nutriments} />

                <View style={styles.trafficLights}>
                  <TrafficLight
                    label="Sugar (g)"
                    value={
                      (product.nutriments?.["sugars_100g"] ??
                        product.nutriments?.sugars) ||
                      null
                    }
                    thresholds={{ medium: 5, high: 22.5 }}
                  />
                  <TrafficLight
                    label="Salt (g)"
                    value={
                      (product.nutriments?.["salt_100g"] ??
                        product.nutriments?.salt) ||
                      null
                    }
                    thresholds={{ medium: 0.3, high: 1.5 }}
                  />
                </View>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>Ingredients</ThemedText>
              <ThemedText style={styles.sectionContent}>
                {product.ingredients_text || "—"}
              </ThemedText>
            </View>

            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>Additives</ThemedText>
              <AdditivesList
                additives={product.additives || product.additives_tags || []}
              />
            </View>

            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>
                Smart Warnings
              </ThemedText>
              {warnings.length ? (
                <View>
                  {warnings.map((w, i) => (
                    <ThemedText key={i} style={styles.warning}>
                      ⚠️ {w}
                    </ThemedText>
                  ))}
                </View>
              ) : (
                <ThemedText style={{ fontWeight: "600", color: "#a0a0a0" }}>
                  No warnings
                </ThemedText>
              )}
            </View>

            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>
                Clean Ingredients Scan
              </ThemedText>
              {cleanScan.clean ? (
                <ThemedText
                  style={{ fontWeight: "700", color: "#1FA260", fontSize: 14 }}
                >
                  ✔️ No obvious artificial ingredients found
                </ThemedText>
              ) : (
                <ThemedText
                  style={{ fontWeight: "700", color: "#FF6B6B", fontSize: 14 }}
                >
                  ⚠️ Found: {cleanScan.found.join(", ")}
                </ThemedText>
              )}
            </View>
          </View>

          <View style={styles.nutriScoreCard}>
            <ThemedText style={styles.sectionTitle}>Nutri-Score</ThemedText>
            <View style={styles.scoreDisplay}>
              <ThemedText style={styles.scoreGrade}>
                {product.nutrition_grade
                  ? product.nutrition_grade.toUpperCase()
                  : "—"}
              </ThemedText>
            </View>
            <RadarChart nutriments={product.nutriments} />
          </View>
        </View>
      )}

      {product && product.not_found && (
        <View style={styles.notFoundCard}>
          <ThemedText style={styles.sectionTitle}>Product not found</ThemedText>
          <ThemedText
            style={{ color: "#d0d0d0", fontWeight: "600", marginTop: 8 }}
          >
            Try manual entry or add the product to Open Food Facts.
          </ThemedText>
        </View>
      )}

      <View style={styles.actionsCard}>
        <ThemedText style={styles.sectionTitle}>Quick Actions</ThemedText>
        <TouchableOpacity
          onPress={async () => {
            await AsyncStorage.removeItem(CACHE_KEY);
            setCacheHits(0);
            setStatus("Cache cleared");
          }}
          style={styles.actionButton}
        >
          <Text style={styles.buttonText}>Clear cache</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <ThemedText style={styles.footerText}>
          Built with Open Food Facts • This is a prototype — verify nutrition
          labels for clinical use.
        </ThemedText>
        <ThemedText style={[styles.footerText, { color: "#d0d0d0", fontWeight: "600", marginTop: 8 }]}>
          Created By Jitendra Dewangan
        </ThemedText>
      </View>
    </ScrollView>
  );
}
