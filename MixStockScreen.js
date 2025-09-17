// MixStockScreen.js — STOCK solution mix (e.g., 1:200 injector)
// - User enters stock tank volume (L), injector ratio (default 200), and grams TOTAL per fertilizer (in stock tank)
// - g/L at stock = grams / stockVolume; g/L at dripper = (g/L stock) / ratio
// - ppm at dripper = g/L_dripper * % * 10  (since % given as e.g., 7 for 7%)
// - Mg shown as ELEMENTAL (auto-convert MgO% → Mg% if name contains "MgO")
// - Includes EC estimate (like Direct), Save to recipes (dose_mode='stock'), and Work Order print.

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
import { useNavigation } from "@react-navigation/native";
import { supabase } from "./supabaseClient";

const MgO_TO_Mg = 0.603; // 24.305 / 40.304

const nowBatchId = () => {
  const d = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}`;
};

// EC coefficients (mS/cm per 1 g/L at dripper) — rough but useful
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
  const navigation = useNavigation();

  // Stock tank & injector
  const [stockVolumeL, setStockVolumeL] = useState("100"); // stock tank volume
  const [ratio, setRatio] = useState("200");               // injector ratio (1:ratio)
  const [ecScale, setEcScale] = useState("1.10");
  const [ecTarget, setEcTarget] = useState("");
  const [ecMeasured, setEcMeasured] = useState("");

  // Job meta
  const [batchId, setBatchId] = useState(nowBatchId());
  const [notes, setNotes] = useState("");

  // Fertilizers & rows
  const [ferts, setFerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState("");
  const [pickerIndex, setPickerIndex] = useState(null);

  const [rows, setRows] = useState([]); // [{key, fertId, name, gramsTotal}]

  const num = (s) => (Number.isFinite(Number(s)) ? Number(s) : 0);
  const volStock = Math.max(0, num(stockVolumeL));
  const injRatio = Math.max(1, num(ratio) || 200);

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

  const addRow = () => {
    setRows((p) => [...p, { key: String(Date.now() + Math.random()), fertId: null, name: "", gramsTotal: "" }]);
  };
  const removeRow = (key) => setRows((p) => p.filter((r) => r.key !== key));
  const openPicker = (idx) => { setPickerIndex(idx); setPickerFilter(""); setPickerOpen(true); };
  const selectFert = (idx, f) => {
    setRows((p) => p.map((r, i) => (i === idx ? { ...r, fertId: f.id, name: f.name } : r)));
    setPickerOpen(false);
  };

  // ppm & cost at DRIPPER (after injection)
  const results = useMemo(() => {
    let N=0,P2O5=0,K2O=0,Ca=0,Mg=0,S=0,Fe=0,Mn=0,Zn=0,Cu=0,B=0,Mo=0, cost=0;

    for (const r of rows) {
      const f = getFert(r.fertId);
      if (!f || !volStock) continue;

      const gStockPerL = num(r.gramsTotal) / volStock;        // g/L in stock
      const gDripPerL  = gStockPerL / injRatio;               // g/L at dripper

      const npk = f.npk || {}; const micro = f.micro || {};
      const pct = (v) => (v==null || v==="" ? 0 : Number(v));
      let Mg_pct = pct(npk.Mg);
      if (Mg_pct>0 && /MgO/i.test(f.name || "")) Mg_pct *= MgO_TO_Mg;

      N   += gDripPerL * pct(npk.N)   * 10;
      P2O5+= gDripPerL * pct(npk.P2O5)* 10;
      K2O += gDripPerL * pct(npk.K2O) * 10;
      Ca  += gDripPerL * pct(npk.Ca)  * 10;
      Mg  += gDripPerL * Mg_pct       * 10;
      S   += gDripPerL * pct(npk.S)   * 10;

      Fe  += gDripPerL * pct(micro.Fe)* 10;
      Mn  += gDripPerL * pct(micro.Mn)* 10;
      Zn  += gDripPerL * pct(micro.Zn)* 10;
      Cu  += gDripPerL * pct(micro.Cu)* 10;
      B   += gDripPerL * pct(micro.B) * 10;
      Mo  += gDripPerL * pct(micro.Mo)* 10;

      const price = Number(f.price_per_bag)||0, bagKg = Number(f.bag_size_kg)||0;
      if (price>0 && bagKg>0) cost += num(r.gramsTotal) * (price/(bagKg*1000));
    }

    return { ppm:{N,P2O5,K2O,Ca,Mg,S,Fe,Mn,Zn,Cu,B,Mo}, costRM: cost };
  }, [rows, ferts, volStock, injRatio]);

  // EC at dripper
  const ecEstimate = useMemo(() => {
    const scale = num(ecScale) || 1;
    if (!volStock) return 0;
    let sum = 0;
    for (const r of rows) {
      const f = getFert(r.fertId);
      if (!f) continue;
      const gDripPerL = (num(r.gramsTotal)/volStock) / injRatio;
      sum += gDripPerL * inferECk(f.name || "");
    }
    return sum * scale;
  }, [rows, ferts, volStock, injRatio, ecScale]);

  const ecDeltaToTarget = useMemo(() => {
    const t = num(ecTarget);
    return t ? t - ecEstimate : 0;
  }, [ecTarget, ecEstimate]);

  // Save as recipe (dose_mode='stock', volume_l=stockVolume)
  const saveRecipe = async () => {
    try {
      const { data: a } = await supabase.auth.getUser();
      const user = a?.user;
      if (!user) { Alert.alert("Not signed in", "Please sign in first."); return; }

      const items = rows
        .map((r) => {
          const f = getFert(r.fertId);
          if (!f) return null;
          return { fert_id: f.id, name: f.name, grams: num(r.gramsTotal) };
        })
        .filter(Boolean);

      const { error } = await supabase.from("recipes").insert([{
        owner: user.id,
        shared: true,
        batch_id: batchId,
        notes: notes ? `${notes} | ratio=1:${injRatio}` : `ratio=1:${injRatio}`,
        dose_mode: "stock",
        volume_l: volStock,
        items,
        ppm: results.ppm,
        cost_rm: results.costRM
      }]);
      if (error) throw error;
      Alert.alert("Saved", `Stock recipe saved as "${batchId}".`);
    } catch (e) {
      Alert.alert("Save error", e.message ?? String(e));
    }
  };

  // Print Work Order — Stock
  const onPrint = () => {
    const fx2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "0.00");
    const r0  = (x) => (Number.isFinite(x) ? Math.round(x) : 0);
    const html = `
<!doctype html><html><head><meta charset="utf-8"/><title>Work Order — Stock Mix</title>
<style>body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;padding:24px;color:#111}
h1{margin:0 0 8px} h2{margin:16px 0 8px}
table{border-collapse:collapse;width:100%;margin-top:8px}
th,td{border:1px solid #ddd;padding:8px;text-align:left} th{background:#f7f7f7}
</style></head><body>
<h1>Work Order — Stock