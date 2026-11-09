import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme, spacing, radius } from "@/src/theme";

export default function Bienvenida() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing["2xl"], paddingBottom: insets.bottom + spacing.xl }]}>
      <View style={styles.logo}>
        <Ionicons name="barbell" size={40} color={colors.onBrandPrimary} />
      </View>
      <Text style={styles.title}>Clases Funcionales</Text>
      <Text style={styles.subtitle}>Martes y jueves · Curso 2026–2027</Text>

      <View style={{ flex: 1 }} />

      <Pressable
        style={({ pressed }) => [styles.option, styles.optionPrimary, pressed && { opacity: 0.85 }]}
        onPress={() => router.push("/mi-clase")}
        testID="go-to-student-checkin-btn"
      >
        <Ionicons name="checkmark-circle" size={24} color={colors.onBrandPrimary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.optionTitle, { color: colors.onBrandPrimary }]}>Registrar mi clase</Text>
          <Text style={[styles.optionText, { color: colors.onBrandPrimary }]}>Con tu nombre y código personal</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.onBrandPrimary} />
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.option, pressed && { opacity: 0.85 }]}
        onPress={() => router.push("/inscripcion")}
        testID="go-to-registration-btn"
      >
        <Ionicons name="person-add" size={24} color={colors.brandSecondary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.optionTitle}>Soy alumno nuevo</Text>
          <Text style={styles.optionText}>Envía tus datos para apuntarte</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.option, pressed && { opacity: 0.85 }]}
        onPress={() => router.push("/acceso")}
        testID="go-to-admin-login-btn"
      >
        <Ionicons name="lock-closed" size={24} color={colors.brandSecondary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.optionTitle}>Soy el monitor</Text>
          <Text style={styles.optionText}>Entrar con PIN a la gestión</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.xl },
  logo: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: { fontSize: 32, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: colors.muted, marginTop: spacing.xs, fontWeight: "500" },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.md,
    minHeight: 72,
  },
  optionPrimary: { backgroundColor: colors.brandPrimary },
  optionTitle: { fontSize: 17, fontWeight: "700", color: colors.onSurfaceSecondary },
  optionText: { fontSize: 13, color: colors.muted, marginTop: 2 },
}));
