import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { adminLogin } from "@/src/api";
import { makeStyles, useTheme, spacing, radius } from "@/src/theme";

export default function Acceso() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function enter() {
    setBusy(true);
    setErr(null);
    try {
      await adminLogin(pin);
      router.replace("/(tabs)");
    } catch (e) {
      setErr((e as Error).message);
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={10} style={styles.backBtn} testID="login-back-btn">
          <Ionicons name="chevron-back" size={24} color={colors.brandPrimary} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={spacing.lg}
      >
        <View style={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}>
          <View style={styles.lock}>
            <Ionicons name="lock-closed" size={32} color={colors.brandSecondary} />
          </View>
          <Text style={styles.title}>Acceso monitor</Text>
          <Text style={styles.subtitle}>Introduce tu PIN para gestionar alumnos y asistencias.</Text>

          <TextInput
            value={pin}
            onChangeText={(t) => setPin(t.replace(/\D/g, ""))}
            placeholder="PIN"
            placeholderTextColor={colors.muted}
            style={styles.input}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={12}
            autoFocus
            onSubmitEditing={() => pin.length >= 4 && enter()}
            testID="admin-pin-input"
          />
          {err && (
            <Text style={styles.errText} testID="login-error">
              {err}
            </Text>
          )}

          <Pressable
            style={[styles.primaryBtn, (pin.length < 4 || busy) && { opacity: 0.5 }]}
            disabled={pin.length < 4 || busy}
            onPress={enter}
            testID="admin-login-btn"
          >
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>Entrar</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  topBar: { height: 48, justifyContent: "center", paddingHorizontal: spacing.sm },
  backBtn: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  backText: { color: colors.brandPrimary, fontSize: 16, fontWeight: "500" },
  body: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  lock: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: { fontSize: 30, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: colors.muted, marginTop: spacing.xs, marginBottom: spacing.xl },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 24,
    letterSpacing: 8,
    textAlign: "center",
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  errText: { color: colors.error, fontSize: 14, marginTop: spacing.md, fontWeight: "500", textAlign: "center" },
  primaryBtn: {
    marginTop: spacing.xl,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryBtnText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "700" },
}));
