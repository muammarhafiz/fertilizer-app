// FertilizerDetailScreen.js — Supabase version (drop-in)

import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  View, Text, TextInput, StyleSheet, ScrollView, ActivityIndicator, Alert, Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "./supabaseClient";

const MACROS = ["N", "P2O5", "K2O", "Ca", "Mg", "S"];
const MICROS = ["Fe", "Mn", "Zn", "Cu", "B", "Mo"];

const toStr = (v) => (v === null || v === undefined ? "" : String(v));
const numOrNull = (s) => {
  if (s === "" || s === null || s === undefined) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export default function FertilizerDetailScreen({ route, navigation }) {
  const id = route.params?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [bagSizeKg, setBagSizeKg] = useState("");
  const [pricePerBag, setPricePerBag] = useState("");

  const [npk, setNpk] = useState({ N: "", P2O5: "", K2O: "", Ca: "", Mg: "", S: "" });
  const [micro, setMicro] = useState({ Fe: "", Mn: "", Zn: "", Cu: "", B: "", Mo: "" });

  // Load record
  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("fertilizers")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;

      setName(data.name ?? "");
      setBagSizeKg(toStr(data.bag_size_kg));
      setPricePerBag(toStr(data.price_per_bag));

      const n = data.npk || {};
      const m = data.micro || {};
      setNpk({
        N: toStr(n.N), P2O5: toStr(n.P2O5), K2O: toStr(n.K2O),
        Ca: toStr(n.Ca), Mg: toStr(n.Mg), S: toStr(n.S),
      });
      setMicro({
        Fe: toStr(m.Fe), Mn: toStr(m.Mn), Zn: toStr(m.Zn),
        Cu: toStr(m.Cu), B: toStr(m.B), Mo: toStr(m.Mo),
      });

      navigation.setOptions({ title: data.name || "Fertilizer" });
    } catch (e) {
      console.warn("load error", e);
      Alert.alert("Load error", e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [id, navigation]);

  useEffect(() => {
    load();
  }, [load]);

  // Header Save button
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={onSave} disabled={saving} style={{ opacity: saving ? 0.5 : 1, paddingHorizontal: 8 }}>
          <Ionicons name="save-outline" size={22} />
        </Pressable>
      ),
    });
  }, [navigation, saving, name, bagSizeKg, pricePerBag, npk, micro]);

  const onSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert("Name required", "Please enter a fertilizer name.");
      return;
    }
    try {
      setSaving(true);

      // Build patch
      const npkPatch = Object.fromEntries(
        MACROS.map((k) => [k, numOrNull(npk[k])])
      );
      const microPatch = Object.fromEntries(
        MICROS.map((k) => [k, numOrNull(micro[k])])
      );

      const { data, error } = await supabase
        .from("fertilizers")
        .update({
          name: trimmed,
          bag_size_kg: numOrNull(bagSizeKg),
          price_per_bag: numOrNull(pricePerBag),
          npk: npkPatch,
          micro: microPatch,
        })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      navigation.setOptions({ title: data.name || "Fertilizer" });
      Alert.alert("Saved", "Fertilizer updated.");
    } catch (e) {
      console.warn("save error", e);
      Alert.alert("Save error", e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const setN = (k, v) => setNpk((prev) => ({ ...prev, [k]: v }));
  const setM = (k, v) => setMicro((prev) => ({ ...prev, [k]: v }));

  if (loading) {
    return (
      <View style={[styles.container, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
      <Text style={styles.title}>Details</Text>

      {/* Basic */}
      <View style={styles.card}>
        <Label>Fertilizer name</Label>
        <Input value={name} onChangeText={setName} placeholder="e.g. FertiCare Vegetables" />

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Label>Bag size (kg)</Label>
            <Input
              value={bagSizeKg}
              onChangeText={setBagSizeKg}
              keyboardType="decimal-pad"
              placeholder="e.g. 25"
            />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Label>Price per bag (RM)</Label>
            <Input
              value={pricePerBag}
              onChangeText={setPricePerBag}
              keyboardType="decimal-pad"
              placeholder="e.g. 55"
            />
          </View>
        </View>
        <Text style={styles.hint}>Used for cost per batch in the Mix tab.</Text>
      </View>

      {/* Macros */}
      <View style={styles.card}>
        <Text style={styles.section}>Macros (%)</Text>
        <Grid>
          {MACROS.map((k) => (
            <Field
              key={k}
              label={k}
              value={npk[k]}
              onChangeText={(t) => setN(k, t)}
            />
          ))}
        </Grid>
        <Text style={styles.hint}>
          Enter percentages by weight. Example: type <Text style={{fontWeight:"700"}}>14</Text> for 14%.
        </Text>
      </View>

      {/* Micros */}
      <View style={styles.card}>
        <Text style={styles.section}>Micros (%)</Text>
        <Grid>
          {MICROS.map((k) => (
            <Field
              key={k}
              label={k}
              value={micro[k]}
              onChangeText={(t) => setM(k, t)}
            />
          ))}
        </Grid>
        <Text style={styles.hint}>Micros are typically &lt; 1%.</Text>
      </View>

      {/* Save button (in case header button isn't visible on mobile) */}
      <Pressable onPress={onSave} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
        <Ionicons name="save-outline" size={18} color="#fff" />
        <Text style={styles.saveText}>Save</Text>
      </Pressable>
    </ScrollView>
  );
}

// — UI bits —
function Label({ children }) {
  return <Text style={styles.label}>{children}</Text>;
}
function Input(props) {
  return <TextInput {...props} style={[styles.input, props.style]} />;
}
function Grid({ children }) {
  return <View style={styles.grid}>{children}</View>;
}
function Field({ label, value, onChangeText }) {
  return (
    <View style={{ width: "31%", minWidth: 120 }}>
      <Text style={styles.smallLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        placeholder="0"
        style={styles.input}
      />
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
  row: { flexDirection: "row" },
  label: { fontWeight: "600", marginBottom: 6 },
  smallLabel: { marginBottom: 4, fontWeight: "600" },
  input: {
    borderWidth: 1, borderColor: "#ddd", borderRadius: 10,
    height: 44, paddingHorizontal: 12, marginBottom: 10,
  },
  section: { fontSize: 16, fontWeight: "700", marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hint: { color: "#666", fontSize: 12 },
  saveBtn: {
    marginTop: 8, backgroundColor: "#222", height: 46,
    borderRadius: 10, alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 8,
  },
  saveText: { color: "#fff", fontWeight: "700" },
});
