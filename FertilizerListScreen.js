// FertilizerListScreen.js — Supabase + header Sign-out + Import JSON (drop-in)

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useLayoutEffect,
} from "react";
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "./supabaseClient";
import seeds from "./fertilizers.full.json"; // <-- your JSON

export default function FertilizerListScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");

  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState("");

  // Header buttons: Import + Sign-out
  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Fertilizer List",
      headerRight: () => (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={bulkImportFromJson}
            style={{ paddingHorizontal: 8 }}
            accessibilityLabel="Import from JSON"
            title="Import"
          >
            <Ionicons name="cloud-upload-outline" size={22} />
          </Pressable>
          <Pressable
            onPress={async () => {
              try {
                await supabase.auth.signOut();
              } catch {}
            }}
            style={{ paddingHorizontal: 8 }}
            accessibilityLabel="Sign out"
            title="Sign out"
          >
            <Ionicons name="log-out-outline" size={22} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation]);

  // Load list
  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("fertilizers")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      setItems(data ?? []);
    } catch (e) {
      console.warn("load error", e);
      Alert.alert("Load error", e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const onRefresh = useCallback(async () => {
    try {
      setRefreshing(true);
      await fetchList();
    } finally {
      setRefreshing(false);
    }
  }, [fetchList]);

  // Helpers
  const toNum = (v) =>
    v === null || v === undefined || v === "" ? null : Number(v);

  // Bulk import
  const bulkImportFromJson = async () => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) {
        Alert.alert("Not signed in", "Please sign in first.");
        return;
      }

      // Get existing names to avoid duplicates
      const { data: existing, error: selErr } = await supabase
        .from("fertilizers")
        .select("name");
      if (selErr) throw selErr;
      const existingNames = new Set((existing ?? []).map((x) => x.name?.trim()?.toLowerCase()));

      // Build rows to insert (skip names that already exist)
      const rows = [];
      for (const f of seeds) {
        const nm = (f.name ?? "").trim();
        if (!nm) continue;
        if (existingNames.has(nm.toLowerCase())) continue;

        const npk = f.npk || {};
        const micro = f.micro || {};
        rows.push({
          owner: user.id,
          name: nm,
          bag_size_kg: toNum(f.bagSizeKg),
          price_per_bag: toNum(f.pricePerBag),
          npk: {
            N: toNum(npk.N),
            P2O5: toNum(npk.P2O5),
            K2O: toNum(npk.K2O),
            Ca: toNum(npk.Ca),
            Mg: toNum(npk.Mg),
            S: toNum(npk.S),
          },
          micro: {
            Fe: toNum(micro.Fe),
            Mn: toNum(micro.Mn),
            Zn: toNum(micro.Zn),
            Cu: toNum(micro.Cu),
            B: toNum(micro.B),
            Mo: toNum(micro.Mo),
          },
        });
      }

      if (rows.length === 0) {
        Alert.alert("Import", "Nothing to import (all names already exist).");
        return;
      }

      const { error: insErr } = await supabase.from("fertilizers").insert(rows);
      if (insErr) throw insErr;

      Alert.alert("Import", `Imported ${rows.length} fertilizers.`);
      fetchList();
    } catch (e) {
      console.warn("import error", e);
      Alert.alert("Import error", e.message ?? String(e));
    }
  };

  // CRUD
  const addItem = async () => {
    const name = newName.trim();
    if (!name) return;

    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) {
        Alert.alert("Not signed in", "Please sign in first.");
        return;
      }

      const { data, error } = await supabase
        .from("fertilizers")
        .insert([
          {
            owner: user.id,
            name,
            bag_size_kg: null,
            price_per_bag: null,
            npk: { N: null, P2O5: null, K2O: null, Ca: null, Mg: null, S: null },
            micro: { Fe: null, Mn: null, Zn: null, Cu: null, B: null, Mo: null },
          },
        ])
        .select()
        .single();
      if (error) throw error;

      setItems((prev) => [data, ...prev]);
      setNewName("");
    } catch (e) {
      console.warn("create error", e);
      Alert.alert("Create error", e.message ?? String(e));
    }
  };

  const openEdit = (item) => {
    setEditing(item);
    setEditText(item.name ?? "");
  };

  const saveEdit = async () => {
    const name = editText.trim();
    if (!name) return;

    try {
      const { data, error } = await supabase
        .from("fertilizers")
        .update({ name })
        .eq("id", editing.id)
        .select()
        .single();
      if (error) throw error;

      setItems((prev) => prev.map((it) => (it.id === editing.id ? data : it)));
      setEditing(null);
    } catch (e) {
      console.warn("update error", e);
      Alert.alert("Update error", e.message ?? String(e));
    }
  };

  const removeItem = async (id) => {
    Alert.alert("Delete fertilizer", "Are you sure you want to delete this?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const { error } = await supabase.from("fertilizers").delete().eq("id", id);
            if (error) throw error;
            setItems((prev) => prev.filter((it) => it.id !== id));
          } catch (e) {
            console.warn("delete error", e);
            Alert.alert("Delete error", e.message ?? String(e));
          }
        },
      },
    ]);
  };

  // Filter
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => (it.name ?? "").toLowerCase().includes(q));
  }, [items, query]);

  // Row renderer
  const renderRow = ({ item }) => {
    const Right = () => (
      <View style={styles.actions}>
        <Pressable style={styles.actionBtn} onPress={() => openEdit(item)}>
          <Ionicons name="create-outline" size={20} />
          <Text style={styles.actionText}>Edit</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={() => removeItem(item.id)}>
          <Ionicons name="trash-outline" size={20} color="#c00" />
          <Text style={[styles.actionText, { color: "#c00" }]}>Delete</Text>
        </Pressable>
      </View>
    );

    return (
      <Swipeable renderRightActions={Right} overshootRight={false}>
        <Pressable
          onPress={() =>
            navigation.navigate("FertilizerDetail", {
              id: item.id,
              name: item.name,
            })
          }
        >
          <View style={styles.card}>
            <Ionicons name="leaf-outline" size={18} style={{ marginRight: 8 }} />
            <Text style={styles.name} numberOfLines={2}>
              {item.name || "(no name)"}
            </Text>
            <Ionicons name="chevron-forward" size={18} />
          </View>
        </Pressable>
      </Swipeable>
    );
  };

  // UI
  return (
    <View style={styles.container}>
      {/* search */}
      <View style={styles.row}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search..."
          style={[styles.input, { flex: 1 }]}
        />
      </View>

      {/* add */}
      <View style={styles.row}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          placeholder="Add a fertilizer name..."
          style={[styles.input, { flex: 1 }]}
          onSubmitEditing={addItem}
          returnKeyType="done"
        />
        <Pressable onPress={addItem} style={styles.addBtn}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.addText}>Add</Text>
        </Pressable>
      </View>

      {/* list */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={filtered}
          keyExtractor={(it) => it.id}
          renderItem={renderRow}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 24 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text>No items found.</Text>
            </View>
          }
          refreshing={refreshing}
          onRefresh={onRefresh}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {/* rename modal */}
      <Modal visible={!!editing} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename fertilizer</Text>
            <TextInput
              value={editText}
              onChangeText={setEditText}
              style={styles.input}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveEdit}
              placeholder="New name"
            />
            <View style={{ height: 12 }} />
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10 }}>
              <Pressable
                onPress={() => setEditing(null)}
                style={[styles.pillBtn, { backgroundColor: "#eee" }]}
              >
                <Text>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveEdit}
                style={[styles.pillBtn, { backgroundColor: "#222" }]}
              >
                <Text style={{ color: "#fff", fontWeight: "600" }}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#fff" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#222",
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 10,
  },
  addText: { color: "#fff", fontWeight: "600" },
  list: { flex: 1, marginTop: 8 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  name: { flex: 1, fontSize: 16 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    height: "100%",
    paddingRight: 8,
    gap: 8,
  },
  actionBtn: {
    height: "85%",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#eee",
    backgroundColor: "#fff",
  },
  actionText: { marginTop: 2, fontSize: 12 },
  empty: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: "600", marginBottom: 10 },
  pillBtn: {
    paddingHorizontal: 14,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
});
