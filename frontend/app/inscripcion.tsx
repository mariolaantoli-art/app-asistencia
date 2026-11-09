import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";

import { submitRegistration } from "@/src/api";
import { makeStyles, useTheme, spacing, radius } from "@/src/theme";

export default function Inscripcion() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [health, setHealth] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const valid = name.trim().length > 0 && phone.trim().length >= 6 && /\S+@\S+\.\S+/.test(email.trim());

  async function send() {
    setSending(true);
    setErr(null);
    try {
      await submitRegistration({ name: name.trim(), phone: phone.trim(), email: email.trim(), health_notes: health.trim() });
      setSent(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setName("");
    setPhone("");
    setEmail("");
    setHealth("");
    setSent(false);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={10} style={styles.backBtn} testID="registration-back-btn">
          <Ionicons name="chevron-back" size={24} color={colors.brandPrimary} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>
      </View>

      {sent ? (
        <View style={styles.successWrap} testID="registration-success">
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={44} color={colors.onBrandPrimary} />
          </View>
          <Text style={styles.title}>¡Datos enviados!</Text>
          <Text style={styles.successText}>
            El monitor revisará tu inscripción. Quedarás en la lista cuando hayas pagado tu bono (10 € = 5 clases o 20 € = 10 clases).
          </Text>
          <Pressable style={styles.secondaryBtn} onPress={reset} testID="registration-new-btn">
            <Text style={styles.secondaryBtnText}>Inscribir a otra persona</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAwareScrollView
          bottomOffset={spacing.lg}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Inscripción</Text>
          <Text style={styles.subtitle}>Clases funcionales · martes y jueves</Text>

          <Text style={styles.label}>Nombre y apellidos *</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Ej. María García"
            placeholderTextColor={colors.muted}
            style={styles.input}
            autoCapitalize="words"
            testID="registration-name-input"
          />

          <Text style={styles.label}>Teléfono *</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="Ej. 600 123 456"
            placeholderTextColor={colors.muted}
            style={styles.input}
            keyboardType="phone-pad"
            testID="registration-phone-input"
          />

          <Text style={styles.label}>Email *</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="tu@email.com"
            placeholderTextColor={colors.muted}
            style={styles.input}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            testID="registration-email-input"
          />

          <Text style={styles.label}>Observaciones de salud o lesiones</Text>
          <TextInput
            value={health}
            onChangeText={setHealth}
            placeholder="Ej. lesión de rodilla, hipertensión… (opcional)"
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.multiline]}
            multiline
            maxLength={1000}
            testID="registration-health-input"
          />
          <View style={styles.privacy}>
            <Ionicons name="shield-checkmark" size={16} color={colors.brandSecondary} />
            <Text style={styles.privacyText}>Solo el monitor podrá ver estos datos.</Text>
          </View>

          {err && (
            <Text style={styles.errText} testID="registration-error">
              {err}
            </Text>
          )}

          <Pressable
            style={[styles.primaryBtn, (!valid || sending) && { opacity: 0.5 }]}
            disabled={!valid || sending}
            onPress={send}
            testID="registration-submit-btn"
          >
            {sending ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>Enviar mis datos</Text>}
          </Pressable>
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  topBar: { height: 48, justifyContent: "center", paddingHorizontal: spacing.sm },
  backBtn: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  backText: { color: colors.brandPrimary, fontSize: 16, fontWeight: "500" },
  title: { fontSize: 30, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 4, marginBottom: spacing.sm },
  label: { fontSize: 13, fontWeight: "600", color: colors.muted, marginTop: spacing.lg, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  privacy: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  privacyText: { fontSize: 12, color: colors.muted },
  errText: { color: colors.error, fontSize: 14, marginTop: spacing.md, fontWeight: "500" },
  primaryBtn: {
    marginTop: spacing.xl,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryBtnText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "700" },
  successWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  successIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  successText: { fontSize: 15, color: colors.muted, textAlign: "center", marginTop: spacing.sm, lineHeight: 22 },
  secondaryBtn: {
    marginTop: spacing.xl,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
  },
  secondaryBtnText: { color: colors.onSurface, fontWeight: "600", fontSize: 15 },
}));
