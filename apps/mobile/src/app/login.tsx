import React, { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { configured, supabase } from "../lib/client";
import { useMill } from "../lib/session";
import { Button, ErrorBanner, Logo, colors, styles } from "../components/ui";

export default function Login() {
  const { session } = useMill();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const passwordRef = useRef<TextInput>(null);
  if (session) return <Redirect href="/inbox" />;
  async function login() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { error: failure } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (failure) throw failure;
    } catch {
      setError("Не удалось войти. Проверьте email, пароль и соединение.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <LinearGradient colors={["#EDF3FF", "#F9FBFF", "#FFFFFF"]} style={styles.screen}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1, padding: 28, justifyContent: "center", gap: 20 }}
          >
            <Logo />
            <View style={{ marginTop: 32, gap: 12 }}>
              <Text
                style={{ fontSize: 36, fontWeight: "700", letterSpacing: -1.3, color: colors.ink }}
              >
                Ближе к клиентам.{"\n"}Где бы вы ни были.
              </Text>
              <Text style={styles.caption}>
                Ваши разговоры, команда и клиенты —{"\n"}в одном спокойном рабочем пространстве.
              </Text>
            </View>
            <View style={{ gap: 12, marginTop: 20 }}>
              <TextInput
                accessibilityLabel="Email"
                placeholder="Рабочий email"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                value={email}
                onChangeText={setEmail}
                style={styles.input}
              />
              <TextInput
                ref={passwordRef}
                accessibilityLabel="Пароль"
                placeholder="Пароль"
                secureTextEntry
                textContentType="password"
                autoComplete="current-password"
                returnKeyType="go"
                onSubmitEditing={() => void login()}
                value={password}
                onChangeText={setPassword}
                style={styles.input}
              />
              <Button
                title={busy ? "Входим…" : "Войти в Mill"}
                onPress={() => void login()}
                disabled={!configured || !email.trim() || !password || busy}
              />
            </View>
            <ErrorBanner
              message={
                !configured
                  ? "Для подключения задайте публичный адрес Supabase и anon key в конфигурации приложения."
                  : error
              }
            />
            <Text
              onPress={() => void Linking.openURL("https://app.mill.chat/forgot-password")}
              style={{ color: colors.blue, textAlign: "center", padding: 10 }}
            >
              Забыли пароль?
            </Text>
            <Text style={[styles.caption, { textAlign: "center", fontSize: 12, marginTop: 22 }]}>
              Войдите под существующим аккаунтом Mill.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}
