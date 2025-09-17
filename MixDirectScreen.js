// MixDirectScreen.js — Direct mixer with g/kg toggle + EC, save/load, print
// - Units toggle for ingredient entry: grams or kilograms
// - Dose modes: total (in tank) or per L
// - Mg shown as ELEMENTAL (auto converts MgO% → Mg% if name contains "MgO")
// - EC estimate with adjustable scale; prints in Work Order
// - Saves recipes to Supabase (unchanged schema)

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

// EC coefficients (mS/cm from 1 g/L of salt) — simple approximations
function inferECk(name = "") {
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

  // Global units for ingredient inputs
  const [weightUnit, setWeightUnit] = useState("g"); // "g" | "kg"

  // Inputs
  const [volumeL, setVolumeL] = useState("100");
  const [doseMode, setDoseMode] = useState("total"); // "total" | "perL"
  const [ingredients, setIngredients] = useState([]); // [{key, fertId, name, gTotal, gPerL }]

  // Job details
  const [batchId, setBatchId] = useState(nowBatchId());
  const [notes, setNotes] = useState("");

  // EC fields
  const [ecScale, setEcScale] = useState("1.10");
  const [ecTarget, setEcTarget] = useState("");
  const [ecMeasured, setEcMeasured] = useState("");

  // Fertilizers
  const [loading, setLoading] = useState(true);
  const [ferts, setFerts] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState("");
  const [pickerIndex, setPickerIndex] = useState(null);

  // Load fertilizers
  const loadFerts = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("fertilizers")
        .select("id,name,bag_size_kg,price_per_bag,npk,micro,shared,owner")
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

  // Helpers
  const num = (s) => (Number.isFinite(Number(s)) ? Number(s) : 0);
  const vol = Math.max(0, num(volumeL));
  const getFert = (id) => ferts.find((f) => f.id === id);
  const unitFactor = weightUnit === "kg" ? 1000 : 1; // convert UI → grams

  // Ingredient rows UI
  const addRow = () => {
    setIngredients((prev) => [
      ...prev,
      { key: String(Date.now() + Math.random()), fertId: null, name: "", gTotal: "", gPerL: "" },
    ]);
  };
  const removeRow = (key) => setIngredients((prev) => prev.filter((r) => r.key !== key));
  const openPicker = (rowIdx) => { setPickerIndex(rowIdx); setPickerFilter(""); setPickerOpen(true); };
  const selectFert = (rowIdx, fert) => {
    setIngredients((prev) => prev.map((r, i) => (i === rowIdx ? { ...r, fertId: fert.id, name: fert.name } : r)));
    setPickerOpen(false);
  };

  // PPM, cost
  const results = useMemo(() => {
    let N=0,P2O5=0,K2O=0,Ca=0,Mg=0,S=0,Fe=0,Mn=0,Zn=0,Cu=0,B=0,Mo=0, cost=0;

    for (const row of ingredients) {
      const fert = getFert(row.fertId);
      if (!fert) continue;

      // Convert UI entry to grams
      const gramsTotal = doseMode === "total"
        ? num(row.gTotal) * unitFactor
        : num(row.gPerL) * unitFactor * vol; // total grams = (g/L or kg/L) * L

      const gPerL = vol > 0 ? gramsTotal / vol : 0;

      const npk = fert.npk || {}, micro = fert.micro || {};
      const pct = (v)=> (v==null || v==="" ? 0 : Number(v));
      let Mg_pct = pct(npk.Mg);
      if (Mg_pct>0 && /MgO/i.test(fert.name || "")) Mg_pct *= MgO_TO_Mg;

      N   += gPerL*pct(npk.N)   *10;
      P2O5+= gPerL*pct(npk.P2O5)*10;
      K2O += gPerL*pct(npk.K2O) *10;
      Ca  += gPerL*pct(npk.Ca)  *10;
      Mg  += gPerL*Mg_pct       *10;
      S   += gPerL*pct(npk.S)   *10;

      Fe  += gPerL*pct(micro.Fe)*10;
      Mn  += gPerL*pct(micro.Mn)*10;
      Zn  += gPerL*pct(micro.Zn)*10;
      Cu  += gPerL*pct(micro.Cu)*10;
      B   += gPerL*pct(micro.B) *10;
      Mo  += gPerL*pct(micro.Mo)*10;

      const price = Number(fert.price_per_bag)||0, bagKg=Number(fert.bag_size_kg)||0;
      if (price>0 && bagKg>0) cost += gramsTotal * (price/(bagKg*1000));
    }
    return { ppm:{N,P2O5,K2O,Ca,Mg,S,Fe,Mn,Zn,Cu,B,Mo}, costRM: cost };
  }, [ingredients, ferts, doseMode, vol, unitFactor]);

  // EC estimate
  const ecEstimate = useMemo(() => {
    const scale = num(ecScale) || 1;
    let sum = 0;
    for (const row of ingredients) {
      const fert = getFert(row.fertId);
      if (!fert) continue;
      const gramsTotal = doseMode === "total"
        ? num(row.gTotal) * unitFactor
        : num(row.gPerL) * unitFactor * vol;
      const gPerL = vol > 0 ? gramsTotal / vol : 0;
      sum += gPerL * inferECk(fert?.name || "");
    }
    return sum * scale;
  }, [ingredients, ferts, doseMode, vol, ecScale, unitFactor]);

  const ecDeltaToTarget = useMemo(() => {
    const t = num(ecTarget);
    return t ? t - ecEstimate : 0;
  }, [ecTarget, ecEstimate]);

  // Recipe summary (store grams in GRAMS regardless of UI unit)
  const recipeSummary = useMemo(() => {
    const items = ingredients.map((r) => {
      const fert = getFert(r.fertId);
      if (!fert) return null;
      const grams = doseMode === "total"
        ? num(r.gTotal) * unitFactor
        : num(r.gPerL) * unitFactor * vol;
      return { fert_id: fert.id, name: fert.name, grams };
    }).filter(Boolean);
    return {
      type: "direct",
      batchId,
      volumeL: vol,
      doseMode,
      unit: weightUnit,
      items,
      ppm: results.ppm,
      costRM: results.costRM,
      ec: { estimate: ecEstimate, target: num(ecTarget) || null, measured: num(ecMeasured) || null, scale: num(ecScale) || 1 },
      notes,
      ts: new Date().toISOString(),
    };
  }, [ingredients, doseMode, vol, batchId, notes, results, ecEstimate, ecTarget, ecMeasured, ecScale, weightUnit, unitFactor]);

  // Save to Supabase
  const saveRecipe = async () => {
    try {
      const { data: u } = await supabase.auth.getUser();
      const user = u?.user;
      if (!user) { Alert.alert("Not signed in", "Please sign in first."); return; }
      const payload = {
        owner: user.id,
        shared: true,
        batch_id: batchId,
        notes,
        dose_mode: doseMode,
        volume_l: vol,
        items: recipeSummary.items,
        ppm: recipeSummary.ppm,
        cost_rm: recipeSummary.costRM,
      };
      const { error } = await supabase.from("recipes").insert([payload]);
      if (error) throw error;
      Alert.alert("Saved", `Recipe saved as "${batchId}".`);
    } catch (e) {
      Alert.alert("Save error", e.message ?? String(e));
    }
  };

  // Load by id (from Saved tab)
  const loadRecipeById = useCallback(async (id) => {
    try {
      const { data, error } = await supabase.from("recipes").select("*").eq("id", id).single();
      if (error) throw error;
      setBatchId(data.batch_id || nowBatchId());
      setNotes(data.notes || "");
      setVolumeL(String(data.volume_l || 0));
      setDoseMode(data.dose_mode || "total");

      // populate rows in current UI unit (default 'g')
      const ing = (data.items || []).map((it) => {
        const grams = Number(it.grams || 0);         // stored in grams
        const perL = data.volume_l > 0 ? grams / Number(data.volume_l) : 0; // grams per L
        return {
          key: String(Math.random()),
          fertId: it.fert_id || null,
          name: it.name || "",
          gTotal: data.dose_mode === "total" ? String(grams / unitFactor) : "",
          gPerL:  data.dose_mode === "perL"   ? String(perL / unitFactor)  : "",
        };
      });
      setIngredients(ing);
      Alert.alert("Loaded", `Recipe "${data.batch_id || data.id}" loaded.`);
    } catch (e) {
      Alert.alert("Load error", e.message ?? String(e));
    }
  }, [unitFactor]);

  useFocusEffect(useCallback(() => {
    const id = route.params?.loadRecipeId;
    if (id) {
      loadRecipeById(id);
      navigation.setParams({ loadRecipeId: undefined });
    }
  }, [route.params?.loadRecipeId, loadRecipeById, navigation]));

  // Print Work Order (shows selected unit)
  const onPrintWorkOrder = () => {
    const round0 = (x) => (Number.isFinite(x) ? Math.round(x) : 0);
    const fx2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "0.00");
    const micro = (x) => (Number.isFinite(x) ? x.toFixed(2) : "0.00");

    const unitMass = weightUnit === "kg" ? "kg" : "g";
    const unitPerL = weightUnit === "kg" ? "kg/L" : "g/L";

    const html = `
<!doctype html><html><head><meta charset="utf-8"/><title>Work Order — Direct Mix</title>
<style>body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;padding:24px;color:#111;}
h1{margin:0 0 8px;}h2{margin:16px 0 8px;}table{border-collapse:collapse;width:100%;margin-top:8px}
th,td{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}th{background:#f7f7f7}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px}.muted{color:#666;font-size:12px}
</style></head><body>
<h1>Work Order — Direct Mix</h1>
<table>
  <tr><th style="width:160px">Batch ID</th><td>${batchId}</td></tr>
  <tr><th>Volume</th><td><b>${vol}</b> L</td></tr>
  <tr><th>Dose mode</th><td><b>${doseMode === "total" ? "Total in tank" : "per L"}</b> (${unitMass}${doseMode==="perL"?"/L":""})</td></tr>
  <tr><th>EC (est.)</th><td><b>${fx2(ecEstimate)}</b> mS/cm · scale ${fx2(Number(ecScale)||1)}</td></tr>
  ${num(ecTarget) ? `<tr><th>EC target</th><td>${fx2(num(ecTarget))} mS/cm (Δ ${fx2(ecDeltaToTarget)})</td></tr>` : ""}
  ${num(ecMeasured) ? `<tr><th>EC measured</th><td>${fx2(num(ecMeasured))} mS/cm</td></tr>` : ""}
  ${notes ? `<tr><th>Notes</th><td>${notes}</td></tr>` : ""}
</table>

<h2>Ingredients</h2>
<table><thead><tr><th>#</th><th>Fertilizer</th><th>${doseMode === "total" ? \`Weight (${unitMass})\` : \`\${unitPerL} × Volume = \${unitMass}\`}</th><th>Cost (RM)</th></tr></thead><tbody>
${ingredients.map((r,i)=>{const f=getFert(r.fertId); if(!f) return "";
const gramsTotal = doseMode==="total" ? num(r.gTotal)*unitFactor : num(r.gPerL)*unitFactor*vol;
const displayTotal = gramsTotal / (weightUnit==="kg"?1000:1);
const price=Number(f.price_per_bag)||0, bagKg=Number(f.bag_size_kg)||0;
const cost = price>0&&bagKg>0 ? gramsTotal*(price/(bagKg*1000)) : 0;
const rhs = doseMode==="total"
  ? `${displayTotal} ${unitMass}`
  : `${num(r.gPerL)} ${unitPerL} × ${vol} L = ${displayTotal} ${unitMass}`;
return `<tr><td>${i+1}</td><td>${f.name}</td><td>${rhs}</td><td>${fx2(cost)}</td></tr>`;}).join("")}
<tr><td colspan="3"><b>Total cost (RM)</b></td><td><b>${fx2(results.costRM)}</b></td></tr>
</tbody></table>

<h2>Totals at dripper (ppm)</h2>
<table><thead><tr><th>Target</th><th>ppm</th><th>Target</th><th>ppm</th></tr></thead><tbody>
<tr><td>N</td><td>${round0(results.ppm.N)}</td><td>P₂O₅</td><td>${round0(results.ppm.P2O5)}</td></tr>
<tr><td>K₂O</td><td>${round0(results.ppm.K2O)}</td><td>Ca</td><td>${round0(results.ppm.Ca)}</td></tr>
<tr><td>Mg (elemental)</td><td>${round0(results.ppm.Mg)}</td><td>S</td><td>${round0(results.ppm.S)}</td></tr>
<tr><td>Fe</td><td>${micro(results.ppm.Fe)}</td><td>Mn</td><td>${micro(results.ppm.Mn)}</td></tr>
<tr><td>Zn</td><td>${micro(results.ppm.Zn)}</td><td>Cu</td><td>${micro(results.ppm.Cu)}</td></tr>
<tr><td>B</td><td>${micro(results.ppm.B)}</td><td>Mo</td><td>${micro(results.ppm.Mo)}</td></tr>
</tbody></table>
<script>window.print();</script></body></html>`;
    const w = window.open("", "_blank"); w.document.write(html); w.document.close();
  };

  // UI
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
      <Text style={styles.title}>Direct Mix</Text>

      {/* Job details */}
      <View style={styles.card}>
        <Text style={styles.section}>Job details</Text>
        <View style={{ marginTop: 8, gap: 8 }}>
          <LabeledInput label="Batch ID" value={batchId} onChangeText={setBatchId} />
          <LabeledInput label="Notes" value={notes} onChangeText={setNotes} multiline numberOfLines={3} />
        </View>
      </View>

      {/* Volume + mode */}
      <View style={styles.card}>
        <Text style={styles.label}>Volume (L)</Text>
        <TextInput value={volumeL} onChangeText={setVolumeL} keyboardType="decimal-pad" placeholder="e.g. 100" style={styles.input} />
        <Text style={[styles.label, { marginTop: 10 }]}>Dose mode</Text>
        <View style={styles.segment}>
          <Pressable onPress={() => setDoseMode("total")} style={[styles.segBtn, doseMode === "total" && styles.segActive]}>
            <Text style={[styles.segText, doseMode === "total" && styles.segTextActive]}>Total in tank</Text>
          </Pressable>
          <Pressable onPress={() => setDoseMode("perL")} style={[styles.segBtn, doseMode === "perL" && styles.segActive]}>
            <Text style={[styles.segText, doseMode === "perL" && styles.segTextActive]}>per L</Text>
          </Pressable>
        </View>
      </View>

      {/* Ingredients */}
      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <Text style={styles.section}>Ingredients</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontWeight: "600" }}>Units:</Text>
            <View style={styles.segmentSm}>
              <Pressable onPress={() => setWeightUnit("g")}  style={[styles.segBtnSm, weightUnit==="g"  && styles.segActive]}>
                <Text style={[styles.segTextSm, weightUnit==="g"  && styles.segTextActive]}>g</Text>
              </Pressable>
              <Pressable onPress={() => setWeightUnit("kg")} style={[styles.segBtnSm, weightUnit==="kg" && styles.segActive]}>
                <Text style={[styles.segTextSm, weightUnit==="kg" && styles.segTextActive]}>kg</Text>
              </Pressable>
            </View>
            <Pressable onPress={addRow} style={styles.addBtn}>
              <Ionicons name="add" size={18} color="#fff" /><Text style={styles.addText}>Add</Text>
            </Pressable>
          </View>
        </View>

        {ingredients.length === 0 && <Text style={{ color: "#666" }}>Tap <Text style={{ fontWeight: "700" }}>Add</Text> to insert a fertilizer row.</Text>}
        {ingredients.map((r, idx) => {
          const fert = getFert(r.fertId);
          const label = doseMode === "total"
            ? `Weight (${weightUnit})`
            : `${weightUnit}/L`;
          return (
            <View key={r.key} style={styles.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.smallLabel}>Fertilizer</Text>
                <Pressable onPress={() => openPicker(idx)} style={[styles.input, { minHeight: 44, justifyContent: "center" }]}>
                  <Text numberOfLines={2}>{fert ? fert.name : "Select a fertilizer…"}</Text>
                </Pressable>
              </View>
              <View style={{ width: 10 }} />
              <View style={{ width: 160 }}>
                <Text style={styles.smallLabel}>{label}</Text>
                <TextInput
                  value={doseMode === "total" ? r.gTotal : r.gPerL}
                  onChangeText={(t) => setIngredients((prev) => prev.map((row, i) =>
                    i === idx ? (doseMode === "total" ? { ...row, gTotal: t } : { ...row, gPerL: t }) : row))}
                  keyboardType="decimal-pad" placeholder="0" style={styles.input}
                />
              </View>
              <Pressable onPress={() => removeRow(r.key)} style={styles.trashBtn}>
                <Ionicons name="trash-outline" size={18} color="#c00" />
              </Pressable>
            </View>
          );
        })}
      </View>

      {/* Totals + EC */}
      <View style={styles.card}>
        <Text style={styles.section}>Totals at dripper (ppm)</Text>
        {loading ? <ActivityIndicator /> : (
          <>
            <View className="macros" style={styles.grid}>
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
              <LabeledInput label="EC scale (multiplier)" value={ecScale} onChangeText={setEcScale} keyboardType="decimal-pad" />
              <LabeledInput label="Target EC (optional, mS/cm)" value={ecTarget} onChangeText={setEcTarget} keyboardType="decimal-pad" />
              <LabeledInput label="Measured EC (optional, mS/cm)" value={ecMeasured} onChangeText={setEcMeasured} keyboardType="decimal-pad" />
              {!!num(ecTarget) && (
                <Text>Δ to target: <Text style={{ fontWeight: "700" }}>{(ecDeltaToTarget).toFixed(2)}</Text> mS/cm</Text>
              )}
            </View>
          </>
        )}
      </View>

      {/* Actions */}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable onPress={saveRecipe} style={[styles.printBtn, { backgroundColor: "#2e7d32" }]}>
          <Ionicons name="save-outline" size={18} color="#fff" /><Text style={styles.printText}>Save</Text>
        </Pressable>
        <Pressable onPress={onPrintWorkOrder} style={styles.printBtn}>
          <Ionicons name="print-outline" size={18} color="#fff" /><Text style={styles.printText}>Print Work Order</Text>
        </Pressable>
      </View>

      {/* Picker modal */}
      <Modal visible={pickerOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Select fertilizer</Text>
            <TextInput value={pickerFilter} onChangeText={setPickerFilter} placeholder="Search…" style={styles.input} autoFocus />
            <ScrollView style={{ maxHeight: 360, marginTop: 8 }}>
              {ferts
                .filter((f) => (f.name || "").toLowerCase().includes(pickerFilter.trim().toLowerCase()))
                .map((f) => (
                  <Pressable key={f.id} onPress={() => selectFert(pickerIndex, f)} style={styles.pickRow}>
                    <Ionicons name="leaf-outline" size={18} style={{ marginRight: 8 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "600" }}>{f.name}</Text>
                      <Text style={{ color: "#666", fontSize: 12 }}>
                        {f.bag_size_kg ? `${f.bag_size_kg} kg` : "—"} · {f.price_per_bag ? `RM ${f.price_per_bag}` : "no price"}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              {ferts.length === 0 && <Text style={{ color: "#666" }}>No fertilizers. Add some in the Fertilizer List tab.</Text>}
            </ScrollView>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
              <Pressable onPress={() => setPickerOpen(false)} style={[styles.pillBtn, { backgroundColor: "#eee" }]}><Text>Close</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function LabeledInput({ label, style, ...rest }) {
  return (<View><Text style={styles.smallLabel}>{label}</Text><TextInput {...rest} style={[styles.input, style]} /></View>);
}

function Box({ label, value, dp = 0 }) {
  const v = Number(value);
  const text = Number.isFinite(v) ? v.toFixed(dp) : (0).toFixed(dp);
  return (<View style={styles.box}><Text style={styles.boxLabel}>{label}</Text><Text style={styles.boxValue}>{text}</Text></View>);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 16 },
  title: { fontSize: 22, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  card: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 12, marginBottom: 12, backgroundColor: "#fff" },
  label: { fontWeight: "600", marginBottom: 6 }, smallLabel: { color: "#555", marginBottom: 6, fontSize: 13 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 10, minHeight: 44, paddingHorizontal: 12, backgroundColor: "#fff" },
  segment: { flexDirection: "row", borderWidth: 1, borderColor: "#ddd", borderRadius: 10, overflow: "hidden", marginTop: 6 },
  segBtn: { paddingHorizontal: 12, height: 36, alignItems: "center", justifyContent: "center" },
  segActive: { backgroundColor: "#222" }, segText: { color: "#222", fontWeight: "600" }, segTextActive: { color: "#fff" },
  segmentSm: { flexDirection: "row", borderWidth: 1, borderColor: "#ddd", borderRadius: 10, overflow: "hidden" },
  segBtnSm: { paddingHorizontal: 12, height: 32, alignItems: "center", justifyContent: "center" },
  segTextSm: { color: "#222", fontWeight: "600" },
  section: { fontSize: 16, fontWeight: "700" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#222", paddingHorizontal: 12, height: 40, borderRadius: 10 },
  addText: { color: "#fff", fontWeight: "700" },
  rowCard: { marginTop: 10, borderWidth: 1, borderColor: "#eee", borderRadius: 10, padding: 10, flexDirection: "row", alignItems: "flex-end" },
  trashBtn: { marginLeft: 10, height: 40, width: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#eee" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  box: { width: "31%", minWidth: 150, borderWidth: 1, borderColor: "#eee", borderRadius: 10, padding: 10 },
  boxLabel: { color: "#666", fontSize: 12 }, boxValue: { fontSize: 18, fontWeight: "700" },
  printBtn: { marginTop: 8, backgroundColor: "#222", height: 46, borderRadius: 10, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  printText: { color: "#fff", fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  pickRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#eee" },
  pillBtn: { paddingHorizontal: 14, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 10 },
});