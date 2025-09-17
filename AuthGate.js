// AuthGate.js — Email+Password login with a working Supabase connection test (plain JS)

import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import Constants from "expo-constants";
import { supabase } from "./supabaseClient";

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Validate config on mount
  useEffect(() => {
    const ex = Constants.expoConfig?.extra ?? {};
    if (!ex.SUPABASE_URL || !ex.SUPABASE_ANON_KEY) {
      setMsg(
        "Missing Supabase config. Check app.config.js → extra.SUPABASE_URL and SUPABASE_ANON_KEY."
      );
    }
  }, []);

  // Watch auth state
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session) return children;

  const onSignIn = async () => {
    setMsg("");
    const e = email.trim();
    if (!e || !pw) {
      setMsg("Enter email and password.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: e, password: pw });
      if (error) throw error;
      // success -> AuthGate will render children because session updates
    } catch (err) {
      console.error("signIn error", err);
      setMsg(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  // Optional: create account from the app (works instantly if "Confirm email" is OFF)
  const onSignUp = async () => {
    setMsg("");
    const e = email.trim();
    if (!e || !pw) {
      setMsg("Enter email and password.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({ email: e, password: pw });
      if (error) throw error;
      setMsg("Sign up successful. If email confirmation is ON, check your inbox.");
    } catch (err) {
      console.error("signUp error", err);
      setMsg(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  // Network/keys test: calls /auth/v1/health with anon key headers
  const testConnection = async () => {
    setMsg("Testing connection…");
    try {
      const base = Constants.expoConfig?.extra?.SUPABASE_URL;
      const anon = Constants.expoConfig?.extra?.SUPABASE_ANON_KEY;
      if (!base || !anon) {
        setMsg("Missing SUPABASE_URL or SUPABASE_ANON_KEY in app.config.js");
        return;
      }
      const r = await fetch(`${base}/auth/v1/health`, {
        method: "GET",
        headers: {
          apikey: anon,
          Authorization: `Bearer ${anon}`,
        },
      });
      const t = await r.text();
      setMsg(`Health ${r.status}: ${t}`);
    } catch (e) {
      console.error(e);
      setMsg(`Health check failed: ${e?.message || String(e)}`);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Sign in</Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@company.com"
        keyboardType="email-address"
        autoCapitalize="none"
        style={styles.input}
      />
      <TextInput
        value={pw}
        onChangeText={setPw}
        placeholder="Password"
        secureTextEntry
        style={styles.input}
      />

      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <Pressable
          onPress={onSignIn}
          disabled={busy}
          style={[styles.btn, { backgroundColor: "#222", opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={styles.btnText}>Sign in</Text>
        </Pressable>
        <Pressable
          onPress={onSignUp}
          disabled={busy}
          style={[styles.btn, { backgroundColor: "#555", opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={styles.btnText}>Sign up</Text>
        </Pressable>
        <Pressable onPress={testConnection} style={[styles.btn, { backgroundColor: "#777" }]}>
          <Text style={styles.btnText}>Test connection</Text>
        </Pressable>
      </View>

      {!!msg && <Text style={styles.msg}>{msg}</Text>}

      <Text style={styles.note}>
        Tip: In Supabase → Authentication → URL Configuration, add your app origin
        (e.g. http://localhost:19006) to Site URL and Redirect URLs.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  input: {
    marginTop: 10,
    width: 320,
    maxWidth: "90%",
    height: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
  },
  btn: {
    paddingHorizontal: 16,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { color: "#fff", fontWeight: "700" },
  msg: { marginTop: 10, color: "#b00020", textAlign: "center" },
  note: { marginTop: 10, color: "#666", textAlign: "center", fontSize: 12, maxWidth: 360 },
});
