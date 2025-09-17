// MixDirectScreen.js — DIRECT solution mixer connected to Supabase
// - Pulls fertilizers from DB (shared or owned)
// - Dose modes: "Total g in tank" (default) or "g/L"
// - Correct ppm math (Mg shown as ELEMENTAL; auto-convert MgO→Mg when name mentions "MgO")
// - Cost = total grams actually added × (price_per_bag / (bag_size_kg * 1000))
// - Simple searchable picker + printable summary

import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "./supabaseClient";

const MgO_TO_Mg = 0.603; // 24.305 / 40.304

export default function MixDirectScreen() {
  // Inputs
  const [volumeL, setVolumeL] = useState("100");
  const [doseMode, setDoseMode] = useState("total"); // "total" | "perL"
  const [ingredients, setIngredients] = useState([]); // [{key, fertId, name, gTotal, gPerL }]

  // Fertilizers from DB
  const [loading, setLoading] = useState(true);
  const [ferts, setFerts] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState("");
  const [pickerIndex, setPickerIndex] = useState(null); // which ingredient row is choosing

  // Load fertilizers (shared or own)
  const loadFerts = useCallback(async () => {
    try {
      setLoading(true);
      // Read rows visible via RLS (our policy allows shared=true or owner=me)
      const { data, error } = await supabase
        .from("fertilizers")
        .select("id,name,bag_size_kg,price_per_bag,npk,micro,shared,owner")
        .order("name", { ascending: true });
      if (error) throw error;
      setFerts(data ?? []);
    } catch (e) {
      console.warn("loadFerts error", e);
      Alert.alert("Load error", e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFerts();
  }, [loadFerts]);

  const addRow = () => {
    setIngredients((prev) => [
      ...prev,
      {
        key: String(Date.now() + Math.random()),
        fertId: null,
        name: "",
        gTotal: "",
        gPerL: "",
      },
    ]);
  };

  const removeRow = (key) => {
    setIngredients((prev) => prev.filter((r) => r.key !== key));
  };

  const openPicker = (rowIdx) => {
    setPickerIndex(rowIdx);
    setPickerFilter("");
    setPickerOpen(true);
  };

  const selectFert = (rowIdx, fert) => {
    setIngredients((prev) =>
      prev.map((r, i) =>
        i === rowIdx ? { ...r, fertId: fert.id, name: fert.name } : r
      )
    );
    setPickerOpen(false);
  };

  // Helpers
  const num = (s) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  };
  const vol = Math.max(0, num(volumeL));

  const getFert = (id) => ferts.find((f) => f.id === id);

  // Compute totals
  const results = useMemo(() => {
    let N_ppm = 0,
      P2O5_ppm = 0,
      K2O_ppm = 0,
      Ca_ppm = 0,
      Mg_ppm = 0, // ELEMENTAL Mg
      S_ppm = 0;

    let costRM = 0;

    for (const row of ingredients) {
      const fert = getFert(row.fertId);
      if (!fert) continue;

      const npk = fert.npk || {};
      const name = fert.name || "";

      // grams per liter from user entry + mode
      const gPerL =
        doseMode === "total"
          ? vol > 0
            ? num(row.gTotal) / vol
            : 0
          : num(row.gPerL);

      // Percent helpers (null/undefined => 0)
      const pct = (v) => (v == null || v === "" ? 0 : Number(v));

      // Mg handling: store as ELEMENTAL Mg if possible.
      // If the product name contains "MgO" and a Mg number is present,
      // we assume that number is MgO% and convert to Mg elemental.
      let Mg_percent = pct(npk.Mg);
      if (Mg_percent > 0 && /MgO/i.test(name)) {
        Mg_percent = Mg_percent * MgO_TO_Mg;
      }

      // ppm contribution from this ingredient
      N_ppm += gPerL * pct(npk.N) * 10; // g/L * % * 1000; (% = value/100, so 1000/100 = 10)
      P2O5_ppm += gPerL * pct(npk.P2O5) * 10;
      K2O_ppm += gPerL * pct(npk.K2O) * 10;
      Ca_ppm += gPerL * pct(npk.Ca) * 10;
      Mg_ppm += gPerL * Mg_percent * 10;
      S_ppm += gPerL * pct(npk.S) * 10;

      // Cost
      const price = Number(fert.price_per_bag) || 0;
      const bagKg = Number(fert.bag_size_kg) || 0;
      if (price > 0 && bagKg > 0) {
        const totalG =
          doseMode === "total" ? num(row.gTotal) : num(row.gPerL) * vol;
        costRM += totalG * (price / (bagKg * 1000));
      }
    }

    return {
      ppm: { N: N_ppm, P2O5: P2O5_ppm, K2O: K2O_ppm, Ca: Ca_ppm, Mg: Mg_ppm, S: S_ppm },
      costRM,
    };
  }, [ingredients, ferts, doseMode, vol]);

  // Simple validations/warnings
  const warnings = useMemo(() => {
    const w = [];
    if (doseMode === "total" && vol === 0) w.push("Volume is 0 — enter tank volume in liters.");
    if (results.ppm.N > 1500)
      w.push(
        "N > 1500 ppm — looks like a stock solution. Did you mean 'Total g in tank' rather than g/L?"
      );
    return w;
  }, [results, doseMode, vol]);

  // Print view
  const onPrint = () => {
    const fmt = (x) =>
      Number.isFinite(x) ? Math.round(x) : 0;
    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Mix — Print</title>
  <style>
    body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;padding:24px;}
    h1{margin:0 0 12px;}
    table{border-collapse:collapse;width:100%;margin-top:12px}
    th,td{border:1px solid #ddd;padding:8px;text-align:left}
    th{background:#f7f7f7}
    .muted{color:#666;font-size:12px}
    .tot{font-weight:700}
  </style>
</head>
<body>
  <h1>Direct Mix</h1>
  <div>Volume: <b>${vol}</b> L</div>
  <div>Dose mode: <b>${doseMode === "total" ? "Total g in tank" : "g/L"}</b></div>

  <table>
    <thead>
      <tr><th>#</th><th>Fertilizer</th><th>${doseMode === "total" ? "Grams (total)" : "g/L"}</th><th>Cost (RM)</th></tr>
    </thead>
    <tbody>
      ${ingredients
        .map((r, i) => {
          const fert = getFert(r.fertId);
          if (!fert) return "";
          const price = Number(fert.price_per_bag) || 0;
          const bagKg = Number(fert.bag_size_kg) || 0;
          const totalG =
            doseMode === "total" ? num(r.gTotal) : num(r.gPerL) * vol;
          const cost =
            price > 0 && bagKg > 0 ? totalG * (price / (bagKg * 1000)) : 0;
          return `<tr>
            <td>${i + 1}</td>
            <td>${fert.name}</td>
            <td>${doseMode === "total" ? (r.gTotal || 0) : (r.gPerL || 0)}</td>
            <td>${cost.toFixed(2)}</td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>

  <table>
    <thead><tr><th>Target</th><th>ppm</th></tr></thead>
    <tbody>
      <tr><td>N</td><td>${fmt(results.ppm.N)}</td></tr>
      <tr><td>P₂O₅</td><td>${fmt(results.ppm.P2O5)}</td></tr>
      <tr><td>K₂O</td><td>${fmt(results.ppm.K2O)}</td></tr>
      <tr><td>Ca</td><td>${fmt(results.ppm.Ca)}</td></tr>
      <tr><td>Mg (elemental)</td><td>${fmt(results.ppm.Mg)}</td></tr>
      <tr><td>S</td><td>${fmt(results.ppm.S)}</td></tr>
      <tr class="tot"><td>Total cost (RM)</td><td>${results.costRM.toFixed(2)}</td></tr>
    </tbody>
  </table>

  <p class="muted">Note: Mg shown as elemental. If a fertilizer name contains "MgO", its Mg% was converted using 0.603.</p>
  <script>window.print();</script>
</body>
</html>`;
    const w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
  };

  // UI
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
      <Text style={styles.title}>Direct Mix</Text>

      {/* Top inputs */}
      <View style={styles.card}>
        <Text style={styles.label}>Volume (L)</Text>
        <TextInput
          value={volumeL}
          onChangeText={setVolumeL}
          keyboardType="decimal-pad"
          placeholder="e.g. 100"
          style={styles.input}
        />

        <Text style={[styles.label, { marginTop: 10 }]}>Dose mode</Text>
        <View style={styles.segment}>
          <Pressable
            onPress={() => setDoseMode("total")}
            style={[styles.segBtn, doseMode === "total" && styles.segActive]}
          >
            <Text style={[styles.segText, doseMode === "total" && styles.segTextActive]}>
              Total g in tank
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setDoseMode("perL")}
            style={[styles.segBtn, doseMode === "perL" && styles.segActive]}
          >
            <Text style={[styles.segText, doseMode === "perL" && styles.segTextActive]}>
              g/L
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Ingredients */}
      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={styles.section}>Ingredients</Text>
          <Pressable onPress={addRow} style={styles.addBtn}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.addText}>Add</Text>
          </Pressable>
        </View>

        {ingredients.length === 0 && (
          <Text style={{ color: "#666", marginTop: 8 }}>
            Tap <Text style={{ fontWeight: "700" }}>Add</Text> to insert a fertilizer row.
          </Text>
        )}

        {ingredients.map((r, idx) => {
          const fert = getFert(r.fertId);
          return (
            <View key={r.key} style={styles.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.smallLabel}>Fertilizer</Text>
                <Pressable
                  onPress={() => openPicker(idx)}
                  style={[styles.input, { minHeight: 44, justifyContent: "center" }]}
                >
                  <Text numberOfLines={2}>
                    {fert ? fert.name : "Select a fertilizer…"}
                  </Text>
                </Pressable>
              </View>
              <View style={{ width: 10 }} />
              <View style={{ width: 160 }}>
                <Text style={styles.smallLabel}>
                  {doseMode === "total" ? "Grams (total)" : "g/L"}
                </Text>
                <TextInput
                  value={doseMode === "total" ? r.gTotal : r.gPerL}
                  onChangeText={(t) =>
                    setIngredients((prev) =>
                      prev.map((row, i) =>
                        i === idx
                          ? doseMode === "total"
                            ? { ...row, gTotal: t }
                            : { ...row, gPerL: t }
                          : row
                      )
                    )
                  }
                  keyboardType="decimal-pad"
                  placeholder="0"
                  style={styles.input}
                />
              </View>

              <Pressable onPress={() => removeRow(r.key)} style={styles.trashBtn}>
                <Ionicons name="trash-outline" size={18} color="#c00" />
              </Pressable>
            </View>
          );
        })}
      </View>

      {/* Totals */}
      <View style={styles.card}>
        <Text style={styles.section}>Totals at dripper (ppm)</Text>
        {loading ? (
          <ActivityIndicator />
        ) : (
          <View style={styles.grid}>
            <Box label="N" value={results.ppm.N} />
            <Box label="P₂O₅" value={results.ppm.P2O5} />
            <Box label="K₂O" value={results.ppm.K2O} />
            <Box label="Ca" value={results.ppm.Ca} />
            <Box label="Mg (elemental)" value={results.ppm.Mg} />
            <Box label="S" value={results.ppm.S} />
            <Box label="Total cost (RM)" value={results.costRM} fixed2 />
          </View>
        )}
        {warnings.map((w, i) => (
          <Text key={i} style={{ color: "#b00020", marginTop: 6 }}>
            {w}
          </Text>
        ))}
      </View>

      <Pressable onPress={onPrint} style={styles.printBtn}>
        <Ionicons name="print-outline" size={18} color="#fff" />
        <Text style={styles.printText}>Print</Text>
      </Pressable>

      {/* Picker modal */}
      <Modal visible={pickerOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Select fertilizer</Text>
            <TextInput
              value={pickerFilter}
              onChangeText={setPickerFilter}
              placeholder="Search…"
              style={styles.input}
              autoFocus
            />
            <ScrollView style={{ maxHeight: 360, marginTop: 8 }}>
              {ferts
                .filter((f) =>
                  (f.name || "")
                    .toLowerCase()
                    .includes(pickerFilter.trim().toLowerCase())
                )
                .map((f) => (
                  <Pressable
                    key={f.id}
                    onPress={() => selectFert(pickerIndex, f)}
                    style={styles.pickRow}
                  >
                    <Ionicons name="leaf-outline" size={18} style={{ marginRight: 8 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "600" }}>{f.name}</Text>
                      <Text style={{ color: "#666", fontSize: 12 }}>
                        {f.bag_size_kg ? `${f.bag_size_kg} kg` : "—"} ·{" "}
                        {f.price_per_bag ? `RM ${f.price_per_bag}` : "no price"}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              {ferts.length === 0 && (
                <Text style={{ color: "#666" }}>
                  No fertilizers. Add some in the Fertilizer List tab.
                </Text>
              )}
            </ScrollView>

            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
              <Pressable onPress={() => setPickerOpen(false)} style={[styles.pillBtn, { backgroundColor: "#eee" }]}>
                <Text>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// Small box UI
function Box({ label, value, fixed2 = false }) {
  const v = Number(value);
  const text =
    Number.isFinite(v) ? (fixed2 ? v.toFixed(2) : Math.round(v).toString()) : "0";
  return (
    <View style={styles.box}>
      <Text style={styles.boxLabel}>{label}</Text>
      <Text style={styles.boxValue}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 16 },
  title: { fontSize: 22, fontWeight: "700", textAlign: "center", marginBottom: 8 },

  card: {
    borderWidth: 1, borderColor: "#eee", borderRadius: 12,
    padding: 12, marginBottom: 12, backgroundColor: "#fff",
  },

  label: { fontWeight: "600", marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: "#ddd", borderRadius: 10,
    height: 44, paddingHorizontal: 12, backgroundColor: "#fff",
  },

  segment: {
    flexDirection: "row", borderWidth: 1, borderColor: "#ddd",
    borderRadius: 10, overflow: "hidden", marginTop: 6,
  },
  segBtn: { paddingHorizontal: 12, height: 36, alignItems: "center", justifyContent: "center" },
  segActive: { backgroundColor: "#222" },
  segText: { color: "#222", fontWeight: "600" },
  segTextActive: { color: "#fff" },

  section: { fontSize: 16, fontWeight: "700" },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#222", paddingHorizontal: 12, height: 40, borderRadius: 10,
  },
  addText: { color: "#fff", fontWeight: "700" },

  rowCard: {
    marginTop: 10, borderWidth: 1, borderColor: "#eee", borderRadius: 10, padding: 10,
    flexDirection: "row", alignItems: "flex-end",
  },
  trashBtn: {
    marginLeft: 10, height: 40, width: 40, borderRadius: 10,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#eee",
  },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  box: { width: "31%", minWidth: 150, borderWidth: 1, borderColor: "#eee", borderRadius: 10, padding: 10 },
  boxLabel: { color: "#666", fontSize: 12 },
  boxValue: { fontSize: 18, fontWeight: "700" },

  printBtn: {
    marginTop: 8, backgroundColor: "#222", height: 46,
    borderRadius: 10, alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 8,
  },
  printText: { color: "#fff", fontWeight: "700" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  pickRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 8, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#eee",
  },
});