// MixDirectScreen.js — DIRECT solution mixer (Supabase) with MACROS + MICROS
// Work Order print: batch details + QR code (encodes recipe JSON)
// - Reads fertilizers from DB (shared or owned via RLS)
// - Dose modes: "Total g in tank" (default) or "g/L"
// - Correct ppm math; Mg shown as ELEMENTAL (auto-converts MgO% → Mg% if name contains "MgO")
// - Micros (Fe, Mn, Zn, Cu, B, Mo) included
// - UI: 0 dp for macros, 2 dp for micros & cost

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

const MgO_TO_Mg = 0.603; // 24.305 / 40.304

// helper
const nowBatchId = () => {
  const d = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}`;
};

export default function MixDirectScreen() {
  // Inputs
  const [volumeL, setVolumeL] = useState("100");
  const [doseMode, setDoseMode] = useState("total"); // "total" | "perL"
  const [ingredients, setIngredients] = useState([]); // [{key, fertId, name, gTotal, gPerL }]

  // Job details (for work order)
  const [batchId, setBatchId] = useState(nowBatchId());
  const [houseZone, setHouseZone] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [notes, setNotes] = useState("");

  // Fertilizers from DB
  const [loading, setLoading] = useState(true);
  const [ferts, setFerts] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState("");
  const [pickerIndex, setPickerIndex] = useState(null); // which ingredient row is choosing

  // Load fertilizers (shared or owned)
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

    // micros
    let Fe_ppm = 0,
      Mn_ppm = 0,
      Zn_ppm = 0,
      Cu_ppm = 0,
      B_ppm = 0,
      Mo_ppm = 0;

    let costRM = 0;

    for (const row of ingredients) {
      const fert = getFert(row.fertId);
      if (!fert) continue;

      const npk = fert.npk || {};
      const micro = fert.micro || {};
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

      // Mg handling: store/show as ELEMENTAL Mg (convert if label is MgO%)
      let Mg_percent = pct(npk.Mg);
      if (Mg_percent > 0 && /MgO/i.test(name)) {
        Mg_percent = Mg_percent * MgO_TO_Mg;
      }

      // macros ppm
      N_ppm += gPerL * pct(npk.N) * 10;
      P2O5_ppm += gPerL * pct(npk.P2O5) * 10;
      K2O_ppm += gPerL * pct(npk.K2O) * 10;
      Ca_ppm += gPerL * pct(npk.Ca) * 10;
      Mg_ppm += gPerL * Mg_percent * 10;
      S_ppm += gPerL * pct(npk.S) * 10;

      // micros ppm
      Fe_ppm += gPerL * pct(micro.Fe) * 10;
      Mn_ppm += gPerL * pct(micro.Mn) * 10;
      Zn_ppm += gPerL * pct(micro.Zn) * 10;
      Cu_ppm += gPerL * pct(micro.Cu) * 10;
      B_ppm += gPerL * pct(micro.B) * 10;
      Mo_ppm += gPerL * pct(micro.Mo) * 10;

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
      ppm: {
        N: N_ppm,
        P2O5: P2O5_ppm,
        K2O: K2O_ppm,
        Ca: Ca_ppm,
        Mg: Mg_ppm,
        S: S_ppm,
        Fe: Fe_ppm,
        Mn: Mn_ppm,
        Zn: Zn_ppm,
        Cu: Cu_ppm,
        B: B_ppm,
        Mo: Mo_ppm,
      },
      costRM,
    };
  }, [ingredients, ferts, doseMode, vol]);

  // Compose a compact recipe summary (for QR)
  const recipeSummary = useMemo(() => {
    const items = ingredients
      .map((r) => {
        const fert = getFert(r.fertId);
        if (!fert) return null;
        return {
          name: fert.name,
          grams: doseMode === "total" ? num(r.gTotal) : num(r.gPerL) * vol,
          unit: "g",
        };
      })
      .filter(Boolean);
    return {
      type: "direct",
      batchId,
      houseZone,
      operator: operatorName,
      volumeL: vol,
      items,
      ppm: results.ppm,
      costRM: results.costRM,
      notes,
      ts: new Date().toISOString(),
    };
  }, [ingredients, doseMode, vol, batchId, houseZone, operatorName, results, notes]);

  // Print — Work Order (with QR)
  const onPrintWorkOrder = () => {
    const round0 = (x) => (Number.isFinite(x) ? Math.round(x) : 0);
    const fx2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "0.00");
    const micro = (x) => (Number.isFinite(x) ? x.toFixed(2) : "0.00");

    // Encode JSON in QR (use a public QR image service to avoid extra deps)
    const qrPayload = encodeURIComponent(JSON.stringify(recipeSummary));
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${qrPayload}`;

    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Work Order — Direct Mix</title>
  <style>
    body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;padding:24px;color:#111;}
    h1{margin:0 0 8px;}
    h2{margin:16px 0 8px;}
    table{border-collapse:collapse;width:100%;margin-top:8px}
    th,td{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}
    th{background:#f7f7f7}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px}
    .muted{color:#666;font-size:12px}
    .qr{border:1px solid #ddd;border-radius:8px;padding:8px;display:inline-block}
    .tot{font-weight:700}
  </style>
</head>
<body>
  <h1>Work Order — Direct Mix</h1>

  <div class="grid">
    <div>
      <table>
        <tr><th style="width:160px">Batch ID</th><td>${batchId}</td></tr>
        <tr><th>House / Zone</th><td>${houseZone || "—"}</td></tr>
        <tr><th>Operator</th><td>${operatorName || "—"}</td></tr>
        <tr><th>Volume</th><td><b>${vol}</b> L</td></tr>
        <tr><th>Dose mode</th><td><b>${
          doseMode === "total" ? "Total g in tank" : "g/L"
        }</b></td></tr>
      </table>
    </div>
    <div>
      <div class="qr">
        <img src="${qrUrl}" width="160" height="160" alt="QR Recipe"/>
      </div>
      <div class="muted">QR contains the full recipe JSON (batch, items, ppm, cost). Scan to view on phone.</div>
    </div>
  </div>

  <h2>Ingredients</h2>
  <table>
    <thead><tr><th>#</th><th>Fertilizer</th><th>${
      doseMode === "total" ? "Grams (total)" : "g/L × Volume"
    }</th><th>Cost (RM)</th></tr></thead>
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
            <td>${doseMode === "total" ? totalG : `${num(r.gPerL)} × ${vol} = ${totalG}`} g</td>
            <td>${fx2(cost)}</td>
          </tr>`;
        })
        .join("")}
      <tr class="tot"><td colspan="3">Total cost (RM)</td><td>${fx2(
        results.costRM
      )}</td></tr>
    </tbody>
  </table>

  <h2>Totals at dripper (ppm)</h2>
  <table>
    <thead><tr><th>Target</th><th>ppm</th><th>Target</th><th>ppm</th></tr></thead>
    <tbody>
      <tr><td>N</td><td>${round0(results.ppm.N)}</td><td>P₂O₅</td><td>${round0(
      results.ppm.P2O5
    )}</td></tr>
      <tr><td>K₂O</td><td>${round0(results.ppm.K2O)}</td><td>Ca</td><td>${round0(
      results.ppm.Ca
    )}</td></tr>
      <tr><td>Mg (elemental)</td><td>${round0(
        results.ppm.Mg
      )}</td><td>S</td><td>${round0(results.ppm.S)}</td></tr>
      <tr><td>Fe</td><td>${micro(results.ppm.Fe)}</td><td>Mn</td><td>${micro(
      results.ppm.Mn
    )}</td></tr>
      <tr><td>Zn</td><td>${micro(results.ppm.Zn)}</td><td>Cu</td><td>${micro(
      results.ppm.Cu
    )}</td></tr>
      <tr><td>B</td><td>${micro(results.ppm.B)}</td><td>Mo</td><td>${micro(
      results.ppm.Mo
    )}</td></tr>
    </tbody>
  </table>

  <h2>Notes</h2>
  <div style="min-height:64px;border:1px solid #ddd;border-radius:8px;padding:8px;">${
    notes || "—"
  }</div>

  <h2>Sign-off</h2>
  <table>
    <tr><th style="width:220px">Prepared by</th><td style="height:40px"></td></tr>
    <tr><th>Checked by</th><td style="height:40px"></td></tr>
  </table>

  <p class="muted">Safety: add incompatible salts to separate stock tanks (e.g., CaN vs phosphates/sulfates). Adjust pH last.</p>
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

      {/* Job details */}
      <View style={styles.card}>
        <Text style={styles.section}>Job details</Text>
        <View style={{ marginTop: 8, gap: 8 }}>
          <LabeledInput label="Batch ID" value={batchId} onChangeText={setBatchId} />
          <LabeledInput label="House / Zone" value={houseZone} onChangeText={setHouseZone} />
          <LabeledInput label="Operator" value={operatorName} onChangeText={setOperatorName} />
          <LabeledInput
            label="Notes"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
          />
        </View>
      </View>

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
          <Pressable onPress={addRow} style={styles.addBtn