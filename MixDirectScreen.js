import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, Modal, FlatList, ScrollView, Platform, Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { STORAGE_KEY } from "./FertilizerListScreen";

// ── helpers ───────────────────────────────────────────────────────────────────
const num = (v) => (v !== "" && isFinite(v) ? Number(v) : 0);

const MACROS = ["N", "P2O5", "K2O", "Ca", "Mg", "S"];
const MICROS = ["Fe", "Mn", "Zn", "Cu", "B", "Mo"];

// Mg (elemental) from MgO
const MG_FROM_MGO = 0.603; // 24.305 / 40.304

// Normalize percent for MACROS only (catch 0.14 → 14, 1.4 → 14)
const normalizePct = (key, raw) => {
  let v = num(raw);
  if (v <= 0) return 0;
  if (MACROS.includes(key)) {
    if (v > 0 && v < 1) v = v * 100;      // 0.14 → 14
    else if (v >= 1 && v < 3) v = v * 10; // 1.4 → 14
  }
  return v;
};

const ppmFrom = (key, percent, gPerL) =>
  num(gPerL) * (normalizePct(key, percent) / 100) * 1000; // mg/L (ppm)

const escapeHtml = (s = "") =>
  String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

// sanity threshold for direct-solution ppm (used for the banner)
const SUSPICIOUS_N_PPM = 1500;

// convert all rows from g/L → total grams (uses current volume)
function perLToTotal(rows, vol) {
  return rows.map(r => ({
    ...r,
    gTotal: String((Number(r.gPerL) || 0) * (Number(vol) || 0)),
  }));
}

// ── screen ────────────────────────────────────────────────────────────────────
export default function MixDirectScreen() {
  const [allFerts, setAllFerts] = useState([]);
  const [volumeL, setVolumeL] = useState("100");
  const [doseMode, setDoseMode] = useState("total"); // "total" | "perL"
  const [rows, setRows] = useState([]); // {id, fertId, name, gPerL, gTotal}
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeRow, setActiveRow] = useState(null);
  const [search, setSearch] = useState("");
  const [warnHidden, setWarnHidden] = useState(false);

  // load fertilizers
  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      setAllFerts(list);
      setRows((r) =>
        r.length ? r : [{ id: String(Date.now()), fertId: null, name: "", gPerL: "", gTotal: "" }]
      );
    })();
  }, []);

  const vol = useMemo(() => num(volumeL), [volumeL]);

  const fertByRow = (row) => allFerts.find((f) => f.id === row.fertId || f.name === row.name);

  // derived helpers per row
  const effectiveGPerL = (row) =>
    doseMode === "perL" ? num(row.gPerL) : vol > 0 ? num(row.gTotal) / vol : 0;

  const totalGramsUsed = (row) =>
    doseMode === "perL" ? num(row.gPerL) * vol : num(row.gTotal);

  // totals (Mg shown as elemental)
  const totals = useMemo(() => {
    const sum = {
      macros: Object.fromEntries(MACROS.map((k) => [k, 0])),
      micros: Object.fromEntries(MICROS.map((k) => [k, 0])),
      cost: 0,
      costPerL: 0,
    };

    rows.forEach((row) => {
      const fert = fertByRow(row);
      const gpl = effectiveGPerL(row);
      if (!fert || !gpl) return;

      MACROS.forEach((k) => {
        let ppm = ppmFrom(k, fert.npk?.[k] ?? "", gpl);
        if (k === "Mg") ppm = ppm * MG_FROM_MGO; // convert MgO → Mg
        sum.macros[k] += ppm;
      });

      MICROS.forEach((k) => {
        const ppm = ppmFrom(k, fert.micro?.[k] ?? "", gpl);
        sum.micros[k] += ppm;
      });

      // cost from total grams actually added
      const grams = totalGramsUsed(row);
      const bagKg = num(fert.bagSizeKg);
      const price = num(fert.pricePerBag);
      if (grams && bagKg && price) {
        const costPerGram = price / (bagKg * 1000);
        sum.cost += grams * costPerGram;
      }
    });

    sum.costPerL = vol ? sum.cost / vol : 0;
    return sum;
  }, [rows, allFerts, vol, doseMode]);

  const chooseFertForRow = (rowId, fert) => {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, fertId: fert.id, name: fert.name } : r))
    );
    setPickerOpen(false);
    setSearch("");
  };

  const addRow = () =>
    setRows((prev) => [
      { id: String(Date.now()), fertId: null, name: "", gPerL: "", gTotal: "" },
      ...prev,
    ]);

  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));

  const updateRow = (id, patch) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const filteredForPicker = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allFerts;
    return allFerts.filter((f) => f.name.toLowerCase().includes(q));
  }, [search, allFerts]);

  // PRINT: clean summary (shows dose mode + Mg note)
  const onPrint = () => {
    if (Platform.OS !== "web") {
      Alert.alert("Print", "Please use the web version to print for now.");
      return;
    }

    const rowsHtml = rows
      .map((r) => {
        const fert = fertByRow(r);
        const nm = fert?.name || r.name || "";
        const dose =
          doseMode === "perL" ? (r.gPerL || 0) + " g/L" : (r.gTotal || 0) + " g (total)";
        return `<tr><td>${escapeHtml(nm)}</td><td style="text-align:right">${dose}</td></tr>`;
      })
      .join("");

    const macroHeads = MACROS.map((k) => `<th>${k}</th>`).join("");
    const microHeads = MICROS.map((k) => `<th>${k}</th>`).join("");
    const macroVals = MACROS.map((k) => `<td>${Number(totals.macros[k]).toFixed(1)}</td>`).join("");
    const microVals = MICROS.map((k) => `<td>${Number(totals.micros[k]).toFixed(1)}</td>`).join("");

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Mix — Direct Solution</title>
<style>
  *{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
  body{margin:14mm}
  h1{font-size:18px;margin:0 0 8px}
  h2{font-size:14px;margin:14px 0 6px}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #ddd;padding:8px;font-size:12px}
  .meta{margin:4px 0 12px;font-size:12px}
  .note{margin-top:6px;font-size:12px;color:#666}
</style></head>
<body>
  <h1>Mix — Direct Solution</h1>
  <div class="meta"><b>Volume:</b> ${vol} L &nbsp;|&nbsp; <b>Dose mode:</b> ${
      doseMode === "perL" ? "g/L" : "Total grams in tank"
    }</div>

  <h2>Ingredients</h2>
  <table>
    <thead><tr><th style="width:70%">Fertilizer</th><th style="width:30%;text-align:right">Dose</th></tr></thead>
    <tbody>${rowsHtml || `<tr><td colspan="2">—</td></tr>`}</tbody>
  </table>

  <h2>Totals (ppm)</h2>
  <table>
    <thead><tr>${macroHeads}${microHeads}</tr></thead>
    <tbody><tr>${macroVals}${microVals}</tr></tbody>
  </table>

  <h2>Cost</h2>
  <div>Total: <b>RM ${Number(totals.cost).toFixed(2)}</b></div>
  <div>Per liter: <b>RM ${Number(totals.costPerL).toFixed(4)}</b></div>
  <div class="note">Mg is shown as <b>elemental</b> (converted from MgO × 0.603). Items without price/bag size are excluded from cost.</div>
</body></html>`;

    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open(); w.document.write(html); w.document.close(); w.focus(); w.print(); w.close();
  };

  const renderRow = ({ item: row }) => {
    const fert = fertByRow(row);
    const doseLabel = doseMode === "perL" ? "Dose (g/L)" : "Dose (g total)";
    const doseValue = doseMode === "perL" ? row.gPerL : row.gTotal;
    const onDoseChange = (t) =>
      updateRow(row.id, doseMode === "perL" ? { gPerL: t } : { gTotal: t });

    return (
      <View style={styles.rowCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.small}>Fertilizer</Text>
          <Pressable
            onPress={() => { setActiveRow(row); setPickerOpen(true); }}
            style={[styles.input, { minHeight: 44, justifyContent: "center" }]}
          >
            <Text numberOfLines={1}>{fert?.name || row.name || "Pick fertilizer…"}</Text>
          </Pressable>
        </View>

        <View style={{ width: 140 }}>
          <Text style={styles.small}>{doseLabel}</Text>
          <TextInput
            keyboardType="decimal-pad"
            value={String(doseValue ?? "")}
            onChangeText={onDoseChange}
            style={styles.input}
            placeholder="0"
          />
        </View>

        <Pressable onPress={() => removeRow(row.id)} style={styles.iconBtn} accessibilityLabel="Remove row">
          <Ionicons name="trash-outline" size={18} color="#c00" />
        </Pressable>
      </View>
    );
  };

  const highStrength = doseMode === "perL" && totals.macros.N > SUSPICIOUS_N_PPM && !warnHidden;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mix — Direct Solution</Text>

      {/* Top actions */}
      <View style={styles.row}>
        <View style={{ width: 140 }}>
          <Text style={styles.small}>Volume (L)</Text>
          <TextInput
            keyboardType="decimal-pad"
            value={volumeL}
            onChangeText={setVolumeL}
            style={styles.input}
            placeholder="e.g. 100"
          />
        </View>

        {/* Dose mode toggle */}
        <View style={styles.segment}>
          <Pressable
            onPress={() => setDoseMode("total")}
            style={[styles.segBtn, doseMode === "total" && styles.segActive]}
          >
            <Text style={[styles.segText, doseMode === "total" && styles.segTextActive]}>Total g in tank</Text>
          </Pressable>
          <Pressable
            onPress={() => setDoseMode("perL")}
            style={[styles.segBtn, doseMode === "perL" && styles.segActive]}
          >
            <Text style={[styles.segText, doseMode === "perL" && styles.segTextActive]}>g/L</Text>
          </Pressable>
        </View>

        <Pressable onPress={addRow} style={[styles.pillBtn, { backgroundColor: "#222" }]}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={{ color: "#fff", fontWeight: "600", marginLeft: 6 }}>Add ingredient</Text>
        </Pressable>

        <Pressable onPress={onPrint} style={[styles.pillBtn, { backgroundColor: "#eee" }]}>
          <Ionicons name="print-outline" size={18} />
          <Text style={{ marginLeft: 6 }}>Print</Text>
        </Pressable>
      </View>

      {/* Unit guard */}
      {highStrength && (
        <View style={styles.warn}>
          <Ionicons name="alert-circle-outline" size={16} color="#8a6d3b" />
          <View style={{ flex: 1 }}>
            <Text style={styles.warnText}>
              N is {totals.macros.N.toFixed(0)} ppm in g/L mode — unusually high for a direct solution.
              Did you mean to enter <Text style={{fontWeight:"700"}}>total grams for the tank</Text>?
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Pressable
                onPress={() => {
                  setRows(prev => perLToTotal(prev, vol)); // convert g/L → total
                  setDoseMode("total");
                  setWarnHidden(true);
                }}
                style={[styles.pillBtn, { backgroundColor: "#222" }]}
              >
                <Text style={{ color: "#fff", fontWeight: "600" }}>Convert to total g</Text>
              </Pressable>
              <Pressable
                onPress={() => setWarnHidden(true)}
                style={[styles.pillBtn, { backgroundColor: "#eee" }]}
              >
                <Text>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Ingredients */}
      <FlatList
        style={{ flex: 1, marginTop: 10 }}
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={renderRow}
        contentContainerStyle={{ paddingBottom: 16 }}
        ListEmptyComponent={<Text>No ingredients yet.</Text>}
        keyboardShouldPersistTaps="handled"
      />

      {/* Totals */}
      <ScrollView style={styles.summary} contentContainerStyle={{ paddingVertical: 10 }}>
        <Text style={styles.section}>Totals (ppm)</Text>
        <View style={styles.grid}>
          {MACROS.map((k) => <Box key={k} label={k} value={totals.macros[k]} />)}
        </View>
        <View style={[styles.grid, { marginTop: 8 }]}>
          {MICROS.map((k) => <Box key={k} label={k} value={totals.micros[k]} />)}
        </View>

        <View style={{ height: 10 }} />
        <Text style={styles.section}>Cost</Text>
        <Text>Estimated total: <Text style={styles.bold}>RM {totals.cost.toFixed(3)}</Text></Text>
        <Text>Per liter: <Text style={styles.bold}>RM {totals.costPerL.toFixed(4)}</Text></Text>
        <Text style={styles.note}>
          Mg is shown as <Text style={{fontWeight:"700"}}>elemental</Text> (converted from MgO × 0.603).
          Cost uses total grams (or g/L × volume) based on the selected dose mode.
        </Text>
      </ScrollView>

      {/* Picker */}
      <Modal visible={pickerOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Choose fertilizer</Text>
            <TextInput value={search} onChangeText={setSearch} placeholder="Search…" style={styles.input} autoFocus />
            <FlatList
              data={filteredForPicker}
              keyExtractor={(f) => f.id}
              renderItem={({ item }) => (
                <Pressable onPress={() => chooseFertForRow(activeRow?.id, item)} style={styles.pickRow}>
                  <Text numberOfLines={2} style={{ flex: 1 }}>{item.name}</Text>
                  <Ionicons name="chevron-forward" size={16} />
                </Pressable>
              )}
              style={{ maxHeight: 300, marginTop: 8 }}
              keyboardShouldPersistTaps="handled"
            />
            <View style={{ height: 10 }} />
            <Pressable onPress={() => setPickerOpen(false)} style={[styles.pillBtn, { backgroundColor: "#eee", alignSelf: "flex-end" }]}>
              <Text>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Box({ label, value }) {
  const display = isFinite(value) ? Number(value).toFixed(1) : "-";
  return (
    <View style={styles.box}>
      <Text style={styles.boxLabel}>{label}</Text>
      <Text style={styles.boxValue}>{display}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 10, paddingHorizontal: 12, height: 44 },
  pillBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, height: 44, borderRadius: 10 },
  segment: { flexDirection: "row", borderWidth: 1, borderColor: "#ddd", borderRadius: 10, overflow: "hidden" },
  segBtn: { paddingHorizontal: 12, height: 44, alignItems: "center", justifyContent: "center" },
  segActive: { backgroundColor: "#222" },
  segText: { color: "#222", fontWeight: "600" },
  segTextActive: { color: "#fff" },
  rowCard: { flexDirection: "row", alignItems: "flex-end", gap: 10, borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 10, marginBottom: 8, backgroundColor: "#fff" },
  iconBtn: { height: 44, width: 44, borderRadius: 10, borderWidth: 1, borderColor: "#eee", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  summary: { borderTopWidth: 1, borderColor: "#eee", marginTop: 8, paddingTop: 4, maxHeight: 220 },
  section: { fontSize: 16, fontWeight: "700", marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  box: { width: "31%", minWidth: 100, borderWidth: 1, borderColor: "#eee", borderRadius: 10, padding: 10, alignItems: "center" },
  boxLabel: { fontWeight: "600", marginBottom: 4 },
  boxValue: { fontSize: 16 },
  bold: { fontWeight: "700" },
  note: { fontSize: 12, color: "#666", marginTop: 4 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: "600", marginBottom: 8 },
  pickRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#eee", borderRadius: 10, padding: 10, marginBottom: 6, backgroundColor: "#fff" },
  warn: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: "#fff7e6", borderWidth: 1, borderColor: "#ffe1a5", borderRadius: 10, marginTop: 10 },
  warnText: { color: "#8a6d3b", flex: 1 },
});
