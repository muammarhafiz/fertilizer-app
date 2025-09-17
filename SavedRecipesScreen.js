// SavedRecipesScreen.js — list + load + delete saved mixes from Supabase

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "./supabaseClient";
import { useFocusEffect, useNavigation } from "@react-navigation/native";

export default function SavedRecipesScreen() {
  const nav = useNavigation();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("recipes")
        .select("id, created_at, batch_id, house_zone, operator, volume_l, cost_rm, dose_mode")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRows(data ?? []);
    } catch (e) {
      console.warn(e);
      Alert.alert("Load error", e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(r =>
      (r.batch_id || "").toLowerCase().includes(s) ||
      (r.house_zone || "").toLowerCase().includes(s) ||
      (r.operator || "").toLowerCase().includes(s)
    );
  }, [rows, q]);

  const remove = async (id) => {
    const ok = globalThis.confirm ? globalThis.confirm("Delete this recipe?") : true;
    if (!ok) return;
    try {
      const { error } = await supabase.from("recipes").delete().eq("id", id);
      if (error) throw error;
      setRows(prev => prev.filter(x => x.id !== id));
    } catch (e) {
      Alert.alert("Delete error", e.message ?? String(e));
    }
  };

  const open = (id) => {
    // jump to Mix and ask it to load this recipe
    nav.navigate("Mix", { loadRecipeId: id });
  };

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{item.batch_id || "(no batch id)"}</Text>
        <Text style={styles.sub}>
          {new Date(item.created_at).toLocaleString()} · {item.house_zone || "—"} · {item.operator || "—"}
        </Text>
        <Text style={styles.sub}>
          {item.dose_mode === "total" ? "Total g in tank" : "g/L"} · {item.volume_l} L · RM {Number(item.cost_rm || 0).toFixed(2)}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable onPress={() => open(item.id)} style={styles.pill}>
          <Ionicons name="open-outline" size={16} />
          <Text style={styles.pillText}>Use</Text>
        </Pressable>
        <Pressable onPress={() => remove(item.id)} style={[styles.pill, { backgroundColor: "#fee" }]}>
          <Ionicons name="trash-outline" size={16} color="#c00" />
          <Text style={[styles.pillText, { color: "#c00" }]}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search batch, house/zone, operator"
          style={styles.input}
        />
        <Pressable onPress={load} style={styles.reload}>
          <Ionicons name="refresh" size={18} />
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingVertical: 12 }}
          ListEmptyComponent={<Text style={{ textAlign: "center", marginTop: 20 }}>No saved recipes yet.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 16 },
  input: { flex: 1, borderWidth: 1, borderColor: "#ddd", borderRadius: 10, height: 44, paddingHorizontal: 12 },
  reload: {
    width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: "#eee",
    alignItems: "center", justifyContent: "center",
  },
  card: {
    flexDirection: "row", gap: 12, alignItems: "center",
    borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 12, marginTop: 10,
    backgroundColor: "#fff",
  },
  title: { fontSize: 16, fontWeight: "700" },
  sub: { color: "#666", fontSize: 12, marginTop: 2 },
  actions: { gap: 6 },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderColor: "#eee", borderRadius: 10, paddingHorizontal: 12, height: 36,
    backgroundColor: "#fff",
  },
  pillText: { fontWeight: "600" },
});