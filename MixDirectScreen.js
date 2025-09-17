// MixDirectScreen.js — DIRECT mix with g/kg toggle, EC, micros, save & print

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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "./supabaseClient";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";

const MgO_TO_Mg = 0.603; // 24.305 / 40.304

const nowBatchId = () => {
  const d = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}`;
};

// Rough EC coefficients (mS/cm per 1 g/L at dripper)
function ecK(name = "") {
  const n = (name || "").toLowerCase();
  if (/calcinit|calcium nitrate|nitrabor/.test(n)) return 1.20;
  if (/krista k|potassium nitrate|kno3/.test(n)) return 1.10;
  if (/mkp|mono potassium phosphate|kh2po4/.test(n)) return 0.90;
  if (/sop|potassium sulph|potassium sulf/.test(n)) return 0.80;
  if (/magnesium|epsom|krista mgs|mgso4/.test(n)) return 1.00;
  if (/ferticare|kristalon|npk|complete/.test(n)) return 1.10;
  return 1.00;
}

export default function MixDirectScreen() {
  const route = useRoute();
  const navigation = useNavigation();

  // Tank + mode + unit
  const [volumeL, setVolumeL] = useState("100");
  const [doseMode, setDoseMode] = useState("total"); // "total" | "perL"
  const [weightUnit, setWeightUnit] = useState("g"); // "g" | "kg"

  // EC
  const [ecScale, setEcScale] = useState("1.10");
  const [ecTarget, setEcTarget] = useState("");
  const [ecMeasured, setEcMeasured] = useState("");

  // Job info
  const [batchId, setBatchId] = useState(nowBatchId());
  const [notes, setNotes] = useState("");

  // Data
  const [ferts, setFerts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Row editor
  const [rows, setRows] = useState([]); // { key, fertId, name, gTotal, gPerL }
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerIndex, setPickerIndex] = useState(null);
  const [pickerFilter, setPickerFilter] = useState("");

  // Helpers
  const num = (s) => (Number.isFinite(Number(s)) ? Number(s) : 0);
  const vol = Math.max(0, num(volumeL));
  const getFert = (id) => ferts.find((f) => f.id === id);
  const pct = (v) => (v == null || v === "" ? 0 : Number(v));

  // Unit helpers
  const toGrams = (v) => (weightUnit === "g" ? num(v) : num(v) * 1000);
  const fromGrams = (g) => (weightUnit === "g" ? g : g / 1000);

  const switchUnit = (next) => {
    if (next === weightUnit) return;
    setRows((prev) =>
      prev.map((r) => {
        const gTot = num(r.gTotal);
        const gPer = num(r.gPerL);
        return {
          ...r,
          gTotal: gTot ? String(next === "kg" ? gTot / 1000 : gTot * 1000) : r.gTotal,
          gPerL: gPer ? String(next === "kg" ? gPer / 1000 : gPer * 1000) : r.gPerL,
        };
      })
    );
    setWeightUnit(next);
  };

  // Load fertilizers (shared + mine)
  const loadFerts = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("fertilizers")
        .select("id,name,bag_size_kg,price_per_bag,npk,micro,owner,shared")
        .order("name", { ascending: true });
      if (error) throw error;
      setFerts(data ?? []);
    } catch (e) {
      Alert.alert("Load error", e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { loadFerts(); }, [loadFerts]);

  // Row ops
  const addRow = () =>
    setRows((p) => [
      ...p,
      { key: String(Date.now() + Math.random()), fertId: null, name: "", gTotal: "", gPerL: "" },
    ]);
  const removeRow = (key) => setRows((p) => p.filter((r) => r.key !== key));
  const openPicker = (idx) => {
    setPickerIndex(idx);
    setPickerFilter("");
    setPickerOpen(true);
  };
  const selectFert = (idx, f) => {
    setRows((p) => p.map((r, i) => (i === idx ? { ...r, fertId: f.id, name: f.name } : r)));
    setPickerOpen(false);
  };

  // Math
  const results = useMemo(() => {
    let N = 0, P2O5 = 0, K2O = 0, Ca = 0, Mg = 0, S = 0;
    let Fe = 0, Mn = 0, Zn = 0, Cu = 0, B = 0, Mo = 0;
    let cost = 0;

    for (const r of rows) {
      const f = getFert(r.fertId);
      if (!f) continue;

      const gPerL =
        doseMode === "total"
          ? (vol > 0 ? toGrams(r.gTotal) / vol : 0)
          : toGrams(r.gPerL);

      // macros
      const npk = f.npk || {};
      let Mg_pct = pct(npk.Mg);
      if (Mg_pct > 0 && /MgO/i.test(f.name || "")) {
        Mg_pct = Mg_pct * MgO_TO_Mg; // convert MgO% → Mg%
      }

      N   += gPerL * pct(npk.N)    * 10;
      P2O5+= gPerL * pct(npk.P2O5) * 10;
      K2O += gPerL * pct(npk.K2O)  * 10;
      Ca  += gPerL * pct(npk.Ca)   * 10;
      Mg  += gPerL * Mg_pct        * 10;
      S   += gPerL * pct(npk.S)    * 10;

      // micros
      const micro = f.micro || {};
      Fe  += gPerL * pct(micro.Fe) * 10;
      Mn  += gPerL * pct(micro.Mn) * 10;
      Zn  += gPerL * pct(micro.Zn) * 10;
      Cu  += gPerL * pct(micro.Cu) * 10;
      B   += gPerL * pct(micro.B)  * 10;
      Mo  += gPerL * pct(micro.Mo) * 10;

      // cost from total grams actually added
      const price = Number(f.price_per_bag) || 0;
      const bagKg = Number(f.bag_size_kg) || 0;
      const totalG = doseMode === "total" ? toGrams(r.gTotal) : toGrams(r.gPerL) * vol;
      if (price > 0 && bagKg > 0) cost += totalG * (price / (bagKg * 1000));
    }

    return { ppm: { N, P2O5, K2O, Ca, Mg, S, Fe, Mn, Zn, Cu, B, Mo }, costRM: cost };
  }, [rows, ferts, doseMode, vol, weightUnit]);

  // EC estimate
  const ecEstimate = useMemo(() => {
    const scale = num(ecScale) || 1;
    let sum = 0;
    for (const r of rows) {
      const f = getFert(r.fertId);
      if (!f) continue;
      const gPerL =
        doseMode === "total"
          ? (vol > 0 ? toGrams(r.gTotal) / vol : 0)
          : toGrams(r.gPerL);
      sum += gPerL * ecK(f.name || "");
    }
    return sum * scale;
  }, [rows, ferts, doseMode, vol, weightUnit, ecScale]);

  const ecDeltaToTarget = useMemo(() => {
    const t = num(ecTarget);
    return t ? t - ecEstimate : 0;
  }, [ecTarget, ecEstimate]);

  // Save recipe (store grams in DB)
  const saveRecipe = async () => {
    try {
      const { data: u } = await supabase.auth.getUser();
      const user = u?.user;
      if (!user) {
        Alert.alert("Not signed in", "Please sign in first.");
        return;
      }
      const items = rows
        .map((r) => {
          const f = getFert(r.fertId);
          if (!f) return null;
          const grams = doseMode === "total" ? toGrams(r.gTotal) : toGrams(r.gPerL) * vol;
          return { fert_id: f.id, name: f.name, grams };
        })
        .filter(Boolean);

      const { error } = await supabase.from("recipes").insert([
        {
          owner: user.id,
          shared: true,
          batch_id: batchId,
          notes,
          dose_mode: doseMode,
          volume_l: vol,
          items,
          ppm: results.ppm,
          cost_rm: results.costRM,
        },
      ]);
      if (error) throw error;
      Alert.alert("Saved", `Recipe saved as "${batchId}".`);
    } catch (e) {
      Alert.alert("Save error", e.message ?? String(e));
    }
  };

  // Load recipe by id (from Saved tab)
  const loadRecipeById = useCallback(
    async (id) => {
      try {
        const { data, error } = await supabase.from("recipes").select("*").eq("id", id).single();
        if (error) throw error;

        setBatchId(data.batch_id || nowBatchId());
        setNotes(data.notes || "");
        setVolumeL(String(data.volume_l || 0));
        setDoseMode(data.dose_mode || "total");

        const ing = (data.items || []).map((it) => {
          const g = Number(it.grams || 0);
          return {
            key: String(Math.random()),
            fertId: it.fert_id || null,
            name: it.name || "",
            gTotal: data.dose_mode === "total" ? String(fromGrams(g)) : "",
            gPerL:
              data.dose_mode === "perL" && Number(data.volume_l || 0) > 0
                ? String(fromGrams(g) / Number(data.volume_l))
                : "",
          };
        });
        setRows(ing);
        Alert.alert("Loaded", `Recipe "${data.batch_id || data.id}" loaded.`);
      } catch (e) {
        Alert.alert("Load error", e.message ?? String(e));
      }
    },
    [fromGrams]
  );

  useFocusEffect(
    useCallback(() => {
      const id = route.params?.loadRecipeId;
      if (id) {
        loadRecipeById(id);
        navigation.setParams({ loadRecipeId: undefined });
      }
    }, [route.params?.loadRecipeId, loadRecipeById, navigation])
  );

  // Print work order
  const onPrint = () => {
    const r0 = (x) => (Number.isFinite(x) ? Math.round(x) : 0);
    const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "0.00");
    const micro = (x) => (Number.isFinite(x) ? x.toFixed(2) : "0.00");
    const unitLabel =
      doseMode === "total"
        ? weightUnit === "g"
          ? "g (total)"
          : "kg (total)"
        : weightUnit === "g"
        ? "g/L"
        : "kg/L";

    const html = `
<!doctype html><html><head><meta charset="utf-8"/><title>Work Order — Direct Mix</title>
<style>
body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;padding:24px;color:#111}
h1{margin:0 0 8px}h2{margin:16px 0 8px}
table{border-collapse:collapse;width:100%;margin-top:8px}
th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f7f7f7}
</style></head><body>
<h1>Work Order — Direct Mix</h1>
<table>
  <tr><th style="width:160px">Batch ID</th><td>${batchId}</td></tr>
  <tr><th>Volume</th><td><b>${vol}</b> L</td></tr>
  <tr><th>Dose mode</th><td><b>${doseMode === "total" ? "Total in tank" : "per L"}</b> (${unitLabel})</td></tr>
  <tr><th>EC (est.)</th><td><b>${f2(ecEstimate)}</b> mS/cm · scale ${f2(Number(ecScale) || 1)}</td></tr>
  ${num(ecTarget) ? `<tr><th>EC target</th><td>${f2(num(ecTarget))} mS/cm (Δ ${(num(ecTarget) - ecEstimate).toFixed(2)})</td></tr>` : ""}
  ${num(ecMeasured) ? `<tr><th>EC measured</th><td>${f2(num(ecMeasured))} mS/cm</td></tr>` : ""}
  ${notes ? `<tr><th>Notes</th><td>${notes}</td></tr>` : ""}
</table>

<h2>Ingredients</h2>
<table><thead><tr><th>#</th><th>Fertilizer</th><th>Input (${unitLabel})</th><th>Cost (RM)</th></tr></thead><tbody>
${rows
  .map((r, i) => {
    const f = getFert(r.fertId);
    if (!f) return "";
    const price = Number(f.price_per_bag) || 0;
    const bagKg = Number(f.bag_size_kg) || 0;
    const totalG = doseMode === "total" ? toGrams(r.gTotal) : toGrams(r.gPerL) * vol;
    const cost = price > 0 && bagKg > 0 ? totalG * (price / (bagKg * 1000)) : 0;
    const shown = doseMode === "total" ? r.gTotal || "0" : r.gPerL || "0";
    const extra = doseMode === "perL" ? ` × ${vol} L = ${Math.round(totalG)} g` : "";
    return `<tr><td>${i + 1}</td><td>${f.name}</td><td>${shown} ${unitLabel}${extra}</td><td>${f2(cost)}</td></tr>`;
  })
  .join("")}
<tr><td colspan="3"><b>Total cost (RM)</b></td><td><b>${f2(results.costRM)}</b></td></tr>
</tbody></table>

<h2>Totals at dripper (ppm)</h2>
<table><thead><tr><th>Target</th><th>ppm</th><th>Target</th><th>ppm</th></tr></thead><tbody>
<tr><td>N</td><td>${r0(results.ppm.N)}</td><td>P₂O₅</td><td>${r0(results.ppm.P2O5)}</td></tr>
<tr><td>K₂O</td><td>${r0(results.ppm.K2O)}</td><td>Ca</td><td>${r0(results.ppm.Ca)}</td></tr>
<tr><td>Mg (elemental)</td><td>${r0(results.ppm.Mg)}</td><td>S</td><td>${r0(results.ppm.S)}</td></tr>
<tr><td>Fe</td><td>${micro(results.ppm.Fe)}</td><td>Mn</td><td>${micro(results.ppm.Mn)}</td></tr>
<tr><td>Zn</td><td>${micro(results.ppm.Zn)}</td><td>Cu</td><td>${micro(results.ppm.Cu)}</td></tr>
<tr><td>B</td><td>${micro(results.ppm.B)}</td><td>Mo</td><td>${micro(results.ppm.Mo)}</td></tr>
</tbody></table>
<script>window.print();</script>
</body></html>`;
    const w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
  };

  // UI
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
      <Text style={styles.title}>Direct Mix</Text>

      {/* Job */}
      <View style={styles.card}>
        <Text style={styles.section}>Job details</Text>
        <View style={{ marginTop: 8, gap: 8 }}>
          <L label="Batch ID" v={batchId} onChangeText={setBatchId} />
          <L label="Notes" v={notes} onChangeText={setNotes} multiline numberOfLines={3} />
        </View>
      </View>

      {/* Tank / mode / unit */}
      <View style={styles.card}>
        <Text style={styles.label}>Volume (L)</Text>
        <TextInput value={volumeL} onChangeText={setVolumeL} keyboardType="decimal-pad" style={styles.input} />
        <Text style={[styles.label, { marginTop: 10 }]}>Dose mode</Text>
        <View style={styles.segment}>
          <Seg active={doseMode === "total"} onPress={() => setDoseMode("total")} label="Total in tank" />
          <Seg active={doseMode === "perL"} onPress={() => setDoseMode("perL")} label="per L" />
        </View>
        <Text style={[styles.label, { marginTop: 10 }]}>Weight unit</Text>
        <View style={styles.segment}>
          <Seg active={weightUnit === "g"} onPress={() => switchUnit("g")} label="g" />
          <Seg active={weightUnit === "kg"} onPress={() => switchUnit("kg")} label="kg" />
        </View>
      </View>

      {/* Ingredients */}
      <View style={styles.card}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={styles.section}>Ingredients</Text>
          <Pressable onPress={addRow} style={styles.addBtn}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.addText}>Add</Text>
          </Pressable>
        </View>

        {rows.length === 0 && (
          <Text style={{ color: "#666", marginTop: 8 }}>
            Tap <Text style={{ fontWeight: "700" }}>Add</Text> to insert a fertilizer row.
          </Text>
        )}

        {rows.map((r, idx) => {
          const f = getFert(r.fertId);
          const fieldLabel =
            doseMode === "total"
              ? weightUnit === "g"
                ? "Grams (total)"
                : "Kilograms (total)"
              : weightUnit === "g"
              ? "g/L"
              : "kg/L";
          const fieldValue = doseMode === "total" ? r.gTotal : r.gPerL;

          return (
            <View key={r.key} style={styles.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.smallLabel}>Fertilizer</Text>
                <Pressable
                  onPress={() => openPicker(idx)}
                  style={[styles.input, { minHeight: 44, justifyContent: "center" }]}
                >
                  <Text numberOfLines={2}>{f ? f.name : "Select a fertilizer…"}</Text>
                </Pressable>
              </View>
              <View style={{ width: 10 }} />
              <View style={{ width: 170 }}>
                <Text style={styles.smallLabel}>{fieldLabel}</Text>
                <TextInput
                  value={fieldValue}
                  onChangeText={(t) =>
                    setRows((p) =>
                      p.map((row, i) =>
                        i === idx ? (doseMode === "total" ? { ...row, gTotal: t } : { ...row, gPerL: t }) : row
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
          <>
            <View style={styles.grid}>
              <Box label="N" value={results.ppm.N} dp={0} />
              <Box label="P₂O₅" value={results.ppm.P2O5} dp={0} />
              <Box label="K₂O" value={results.ppm.K2O} dp={0} />
              <Box label="Ca" value={results.ppm.Ca} dp={0} />
              <Box label="Mg (elemental)" value={results.ppm.Mg} dp={0} />
              <Box label="S" value={results.ppm.S} dp={0} />
            </View>

            <Text style={[styles.section, { marginTop: 12 }]}>Micros (ppm)</Text>
            <View style={styles.grid}>
              <Box label="Fe" value={results.ppm.Fe} dp={2} />
              <Box label="Mn" value={results.ppm.Mn} dp={2} />
              <Box label="Zn" value={results.ppm.Zn} dp={2} />
              <Box label="Cu" value={results.ppm.Cu} dp={2} />
              <Box label="B" value={results.ppm.B} dp={2} />
              <Box label="Mo" value={results.ppm.Mo} dp={2} />
              <Box label="Total cost (RM)" value={results.costRM} dp={2} />
            </View>

            <Text style={[styles.section, { marginTop: 12 }]}>EC</Text>
            <View style={styles.grid}>
              <Box label="EC est. (mS/cm)" value={ecEstimate} dp={2} />
            </View>
            <View style={{ marginTop: 8, gap: 8 }}>
              <L label="EC scale (multiplier)" v={ecScale} onChangeText={setEcScale} keyboardType="decimal-pad" />
              <L label="Target EC (mS/cm) — optional" v={ecTarget} onChangeText={setEcTarget} keyboardType="decimal-pad" />
              <L label="Measured EC (mS/cm) — optional" v={ecMeasured} onChangeText={setEcMeasured} keyboardType="decimal-pad" />
              {!!num(ecTarget) && (
                <Text style={{ color: "#333" }}>
                  Δ to target: <Text style={{ fontWeight: "700" }}>{(num(ecTarget) - ecEstimate).toFixed(2)}</Text> mS/cm
                </Text>
              )}
            </View>
          </>
        )}
      </View>

      {/* Actions */}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable onPress={saveRecipe} style={[styles.printBtn, { backgroundColor: "#2e7d32" }]}>
          <Ionicons name="save-outline" size={18} color="#fff" />
          <Text style={styles.printText}>Save</Text>
        </Pressable>
        <Pressable onPress={onPrint} style={styles.printBtn}>
          <Ionicons name="print-outline" size={18} color="#fff" />
          <Text style={styles.printText}>Print Work Order</Text>
        </Pressable>
      </View>

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
                .filter((f) => (f.name || "").toLowerCase().includes(pickerFilter.trim().toLowerCase()))
                .map((f) => (
                  <Pressable key={f.id} onPress={() => selectFert(pickerIndex, f)} style={styles.pickRow}>
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
                <Text style={{ color: "#666" }}>No fertilizers. Add some in the Fertilizers tab.</Text>
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

/* ---------- small UI helpers ---------- */

function Seg({ active, onPress, label }) {
  return (
    <Pressable onPress={onPress} style={[styles.segBtn, active && styles.segActive]}>
      <Text style={[styles.segText, active && styles.segTextActive]}>{label}</Text>
    </Pressable>
  );
}

function L({ label, v, style, ...rest }) {
  return (
    <View>
      <Text style={styles.smallLabel}>{label}</Text>
      <TextInput value={v} {...rest} style={[styles.input, style]} />
    </View>
  );
}

function Box({ label, value, dp = 0 }) {
  const n = Number(value);
  const text = Number.isFinite(n) ? n.toFixed(dp) : (0).toFixed(dp);
  return (
    <View style={styles.box}>
      <Text style={styles.boxLabel}>{label}</Text>
      <Text style={styles.boxValue}>{text}</Text>
    </View>
  );
}

/* ---------- styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 16 },
  title: { fontSize: 22, fontWeight: "700", textAlign: "center", marginBottom: 8 },

  card: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 12, marginBottom: 12, backgroundColor: "#fff" },
  section: { fontSize: 16, fontWeight: "700" },

  label: { fontWeight: "600", marginBottom: 6 },
  smallLabel: { color: "#555", marginBottom: 6, fontSize: 13 },

  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 10, minHeight: 44, paddingHorizontal: 12, backgroundColor: "#fff" },

  segment: { flexDirection: "row", borderWidth: 1, borderColor: "#ddd", borderRadius: 10, overflow: "hidden", marginTop: 6 },
  segBtn: { paddingHorizontal: 12, height: 36, alignItems: "center", justifyContent: "center" },
  segActive: { backgroundColor: "#222" },
  segText: { color: "#222", fontWeight: "600" },
  segTextActive: { color: "#fff" },

  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#222", paddingHorizontal: 12, height: 40, borderRadius: 10 },
  addText: { color: "#fff", fontWeight: "700" },

  rowCard: { marginTop: 10, borderWidth: 1, borderColor: "#eee", borderRadius: 10, padding: 10, flexDirection: "row", alignItems: "flex-end" },
  trashBtn: { marginLeft: 10, height: 40, width: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#eee" },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  box: { width: "31%", minWidth: 150, borderWidth: 1, borderColor: "#eee", borderRadius: 10, padding: 10 },
  boxLabel: { color: "#666", fontSize: 12 },
  boxValue: { fontSize: 18, fontWeight: "700" },

  printBtn: { marginTop: 8, backgroundColor: "#222", height: 46, borderRadius: 10, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  printText: { color: "#fff", fontWeight: "700" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  pickRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#eee" },
  pillBtn: { paddingHorizontal: 14, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 10 },
});