// MixStockScreen.js — STOCK mix (1:ratio) with g/kg toggle, EC & print
// - Inputs are grams (or kilograms) TOTAL into the stock tank
// - NEW: Weight unit toggle (g ⇄ kg) with live conversion
// - ppm & EC are computed at the dripper after injection
// - Saves recipes in grams (DB unchanged)

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

const MgO_TO_Mg = 0.603;
const nowBatchId = () => {
  const d = new Date(); const pad = (n) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
};

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

export default function MixStockScreen() {
  const [stockVolumeL, setStockVolumeL] = useState("100");
  const [ratio, setRatio] = useState("200");
  const [weightUnit, setWeightUnit] = useState("g"); // "g" | "kg"

  const [ecScale, setEcScale] = useState("1.10");
  const [ecTarget, setEcTarget] = useState("");
  const [ecMeasured, setEcMeasured] = useState("");

  const [batchId, setBatchId] = useState(nowBatchId());
  const [notes, setNotes] = useState("");

  const [ferts, setFerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState("");
  const [pickerIndex, setPickerIndex] = useState(null);
  const [rows, setRows] = useState([]); // {key, fertId, name, gramsTotal}

  const num = (s) => (Number.isFinite(Number(s)) ? Number(s) : 0);
  const volStock = Math.max(0, num(stockVolumeL));
  const injRatio = Math.max(1, num(ratio) || 200);
  const toGrams = (v) => (weightUnit === "g" ? num(v) : num(v) * 1000);

  const loadFerts = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("fertilizers")
        .select("id,name,bag_size_kg,price_per_bag,npk,micro")
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

  const getFert = (id) => ferts.find((f) => f.id === id);
  const addRow = () => setRows((p) => [...p, { key: String(Date.now()+Math.random()), fertId: null, name: "", gramsTotal: "" }]);
  const removeRow = (key) => setRows((p) => p.filter((r) => r.key !== key));
  const openPicker = (idx) => { setPickerIndex(idx); setPickerFilter(""); setPickerOpen(true); };
  const selectFert = (idx, f) => { setRows((p) => p.map((r,i)=> i===idx ? {...r, fertId:f.id, name:f.name} : r)); setPickerOpen(false); };

  // Unit toggle + live conversion
  const switchUnit = (next) => {
    if (next === weightUnit) return;
    setRows((p) =>
      p.map((r) => {
        const val = num(r.gramsTotal);
        if (!val) return r;
        const newVal = next === "kg" ? val / 1000 : val * 1000;
        return { ...r, gramsTotal: String(newVal) };
      })
    );
    setWeightUnit(next);
  };

  // Results at dripper
  const results = useMemo(() => {
    let N=0,P2O5=0,K2O=0,Ca=0,Mg=0,S=0,Fe=0,Mn=0,Zn=0,Cu=0,B=0,Mo=0, cost=0;
    for (const r of rows) {
      const f = getFert(r.fertId);
      if (!f || !volStock) continue;

      const gStockPerL = toGrams(r.gramsTotal) / volStock; // g/L in stock
      const gDripPerL  = gStockPerL / injRatio;            // g/L at dripper

      const npk = f.npk || {}; const micro = f.micro || {};
      const pct = (v) => (v==null || v==="" ? 0 : Number(v));
      let Mg_pct = pct(npk.Mg); if (Mg_pct>0 && /MgO/i.test(f.name || "")) Mg_pct *= MgO_TO_Mg;

      N+=gDripPerL*pct(npk.N)*10; P2O5+=gDripPerL*pct(npk.P2O5)*10; K2O+=gDripPerL*pct(npk.K2O)*10;
      Ca+=gDripPerL*pct(npk.Ca)*10; Mg+=gDripPerL*Mg_pct*10; S+=gDripPerL*pct(npk.S)*10;

      Fe+=gDripPerL*pct(micro.Fe)*10; Mn+=gDripPerL*pct(micro.Mn)*10; Zn+=gDripPerL*pct(micro.Zn)*10;
      Cu+=gDripPerL*pct(micro.Cu)*10; B+=gDripPerL*pct(micro.B)*10; Mo+=gDripPerL*pct(micro.Mo)*10;

      const price=Number(f.price_per_bag)||0, bagKg=Number(f.bag_size_kg)||0;
      if (price>0 && bagKg>0) cost += toGrams(r.gramsTotal) * (price/(bagKg*1000));
    }
    return { ppm:{N,P2O5,K2O,Ca,Mg,S,Fe,Mn,Zn,Cu,B,Mo}, costRM: cost };
  }, [rows, ferts, volStock, injRatio, weightUnit]);

  const ecEstimate = useMemo(() => {
    const scale = Number(ecScale) || 1;
    if (!volStock) return 0;
    let sum = 0;
    for (const r of rows) {
      const f = getFert(r.fertId); if (!f) continue;
      const gDripPerL = (toGrams(r.gramsTotal)/volStock) / injRatio;
      sum += gDripPerL * inferECk(f.name || "");
    }
    return sum * scale;
  }, [rows, ferts, volStock, injRatio, weightUnit, ecScale]);

  const ecDeltaToTarget = useMemo(() => {
    const t = Number(ecTarget) || 0;
    return t ? t - ecEstimate : 0;
  }, [ecTarget, ecEstimate]);

  const saveRecipe = async () => {
    try {
      const { data: a } = await supabase.auth.getUser();
      const user = a?.user;
      if (!user) { Alert.alert("Not signed in", "Please sign in first."); return; }
      const items = rows.map((r)=>{
        const f = getFert(r.fertId); if (!f) return null;
        return { fert_id: f.id, name: f.name, grams: toGrams(r.gramsTotal) };
      }).filter(Boolean);
      const { error } = await supabase.from("recipes").insert([{
        owner: user.id, shared: true, batch_id: batchId,
        notes: notes ? `${notes} | ratio=1:${injRatio}` : `ratio=1:${injRatio}`,
        dose_mode: "stock", volume_l: volStock, items, ppm: results.ppm, cost_rm: results.costRM
      }]);
      if (error) throw error;
      Alert.alert("Saved", `Stock recipe saved as "${batchId}".`);
    } catch (e) {
      Alert.alert("Save error", e.message ?? String(e));
    }
  };

  const onPrint = () => {
    const fx2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "0.00");
    const r0  = (x) => (Number.isFinite(x) ? Math.round(x) : 0);
    const unitLabel = weightUnit === "g" ? "g (total)" : "kg (total)";
    const html = `
<!doctype html><html><head><meta charset="utf-8"/><title>Work Order — Stock Mix</title>
<style>body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;padding:24px;color:#111}
h1{margin:0 0 8px} h2{margin:16px 0 8px}
table{border-collapse:collapse;width:100%;margin-top:8px}
th,td{border:1px solid #ddd;padding:8px;text-align:left} th{background:#f7f7f7}
</style></head><body>
<h1>Work Order — Stock Mix (1:${injRatio})</h1>
<table>
  <tr><th style="width:160px">Batch ID</th><td>${batchId}</td></tr>
  <tr><th>Stock volume</th><td><b>${volStock}</b> L</td></tr>
  <tr><th>Injector ratio</th><td>1:<b>${injRatio}</b></td></tr>
  <tr><th>EC (est.)</th><td><b>${fx2(ecEstimate)}</b> mS/cm (scale ${fx2(Number(ecScale)||1)})</td></tr>
  ${Number(ecTarget)?`<tr><th>EC target</th><td>${fx2(Number(ecTarget))} mS/cm (Δ ${(Number(ecTarget)-ecEstimate).toFixed(2)})</td></tr>`:""}
  ${Number(ecMeasured)?`<tr><th>EC measured</th><td>${fx2(Number(ecMeasured))} mS/cm</td></tr>`:""}
  ${notes?`<tr><th>Notes</th><td>${notes}</td></tr>`:""}
</table>

<h2>Ingredients (input)</h2>
<table><thead><tr><th>#</th><th>Fertilizer</th><th>Value (${unitLabel})</th><th>Cost (RM)</th></tr></thead><tbody>
${rows.map((r,i)=>{const f=getFert(r.fertId); if(!f) return ""; const price=Number(f.price_per_bag)||0; const bagKg=Number(f.bag_size_kg)||0;
const cost= (price>0 && bagKg>0) ? toGrams(r.gramsTotal)*(price/(bagKg*1000)) : 0;
return `<tr><td>${i+1}</td><td>${f?.name||""}</td><td>${r.gramsTotal||"0"} ${unitLabel}</td><td>${fx2(cost)}</td></tr>`}).join("")}
<tr><td colspan="3"><b>Total cost (RM)</b></td><td><b>${fx2(results.costRM)}</b></td></tr>
</tbody></table>

<h2>Totals at dripper (ppm)</h2>
<table><thead><tr><th>Target</th><th>ppm</th><th>Target</th><th>ppm</th></tr></thead><tbody>
<tr><td>N</td><td>${r0(results.ppm.N)}</td><td>P₂O₅</td><td>${r0(results.ppm.P2O5)}</td></tr>
<tr><td>K₂O</td><td>${r0(results.ppm.K2O)}</td><td>Ca</td><td>${r0(results.ppm.Ca)}</td></tr>
<tr><td>Mg (elemental)</td><td>${r0(results.ppm.Mg)}</td><td>S</td><td>${r0(results.ppm.S)}</td></tr>
<tr><td>Fe</td><td>${fx2(results.ppm.Fe)}</td><td>Mn</td><td>${fx2(results.ppm.Mn)}</td></tr>
<tr><td>Zn</td><td>${fx2(results.ppm.Zn)}</td><td>Cu</td><td>${fx2(results.ppm.Cu)}</td></tr>
<tr><td>B</td><td>${fx2(results.ppm.B)}</td><td>Mo</td><td>${fx2(results.ppm.Mo)}</td></tr>
</tbody></table>
<script>window.print();</script></body></html>`;
    const w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
      <Text style={styles.title}>Stock Mix (Injector)</Text>

      <View style={styles.card}>
        <Text style={styles.section}>Job details</Text>
        <View style={{ gap: 8, marginTop: 8 }}>
          <L label="Batch ID" v={batchId} onChangeText={setBatchId} />
          <L label="Notes" v={notes} onChangeText={setNotes} multiline numberOfLines={3} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Stock volume (L)</Text>
        <TextInput value={stockVolumeL} onChangeText={setStockVolumeL} keyboardType="decimal-pad" style={styles.input} />
        <Text style={[styles.label, { marginTop: 10 }]}>Injector ratio (1:x)</Text>
        <TextInput value={ratio} onChangeText={setRatio} keyboardType="decimal-pad" style={styles.input} />
        <Text style={[styles.label, { marginTop: 10 }]}>Weight unit</Text>
        <View style={styles.segment}>
          <Pressable onPress={() => switchUnit("g")} style={[styles.segBtn, weightUnit === "g" && styles.segActive]}>
            <Text style={[styles.segText, weightUnit === "g" && styles.segTextActive]}>g</Text>
          </Pressable>
          <Pressable onPress={() => switchUnit("kg")} style={[styles.segBtn, weightUnit === "kg" && styles.segActive]}>
            <Text style={[styles.segText, weightUnit === "kg" && styles.segTextActive]}>kg</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text className="section" style={styles.section}>Ingredients (into stock)</Text>
          <Pressable onPress={addRow} style={styles.addBtn}>
            <Ionicons name="add" size={18} color="#fff" /><Text style={styles.addText}>Add</Text>
          </Pressable>
        </View>

        {rows.length === 0 && <Text style={{ color: "#666", marginTop: 8 }}>Tap <Text style={{ fontWeight: "700" }}>Add</Text> to insert a row.</Text>}

        {rows.map((r, idx) => {
          const f = getFert(r.fertId);
          const fieldLabel = weightUnit === "g" ? "Grams (total)" : "Kilograms (total)";
          return (
            <View key={r.key} style={styles.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.smallLabel}>Fertilizer</Text>
                <Pressable onPress={() => openPicker(idx)} style={[styles.input, { minHeight: 44, justifyContent: "center" }]}>
                  <Text numberOfLines={2}>{f ? f.name : "Select a fertilizer…"}</Text>
                </Pressable>
              </View>
              <View style={{ width: 10 }} />
              <View style={{ width: 170 }}>
                <Text style={styles.smallLabel}>{fieldLabel}</Text>
                <TextInput
                  value={r.gramsTotal}
                  onChangeText={(t) => setRows((p) => p.map((row, i) => (i === idx ? { ...row, gramsTotal: t } : row)))}
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

      <View style={styles.card}>
        <Text style={styles.section}>Totals at dripper (ppm)</Text>
        {loading ? <ActivityIndicator /> : (
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
              {!!Number(ecTarget) && (
                <Text style={{ color: "#333" }}>
                  Δ to target: <Text style={{ fontWeight: "700" }}>{(Number(ecTarget) - ecEstimate).toFixed(2)}</Text> mS/cm
                </Text>
              )}
            </View>
          </>
        )}
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable onPress={saveRecipe} style={[styles.printBtn, { backgroundColor: "#2e7d32" }]}>
          <Ionicons name="save-outline" size={18} color="#fff" /><Text style={styles.printText}>Save</Text>
        </Pressable>
        <Pressable onPress={onPrint} style={styles.printBtn}>
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
  return (<View style={styles.box}><Text style={styles.boxLabel}>{label}</Text><Text style={styles.boxValue}>{text}</Text></View>);
}

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
  segActive: { backgroundColor: "#222" }, segText: { color: "#222", fontWeight: "600" }, segTextActive: { color: "#fff" },
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