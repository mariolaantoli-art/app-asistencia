import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import * as Haptics from "expo-haptics";
import Ionicons from "@react-native-vector-icons/ionicons";

import { studentApi, StudentMe } from "@/src/api";
import { makeStyles, useTheme, spacing, radius } from "@/src/theme";
import { formatLongDate, formatShortDate, todayYMD } from "@/src/utils/dates";

type Found = { id: string; name: string };

export default function MiClase() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Found | null>(null);
  const [code, setCode] = useState("");
  const [me, setMe] = useState<StudentMe | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Búsqueda con pequeño retardo para no lanzar una petición por tecla
  useEffect(() => {
    if (picked) return;
    const term = query.trim();
    if (term.length < 3) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      studentApi
        .search(term)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query, picked]);

  const pendingDays = useMemo(() => {
    if (!me) return [];
    const attended = new Set(me.attended_dates);
    return [...me.available_days].reverse().filter((d) => !attended.has(d)).slice(0, 12);
  }, [me]);

  async function enter() {
    if (!picked) return;
    setBusy(true);
    setErr(null);
    try {
      const data = await studentApi.me(picked.id, code);
      setMe(data);
      const attended = new Set(data.attended_dates);
      const firstPending = [...data.available_days].reverse().find((d) => !attended.has(d));
      setDay(firstPending ?? null);
    } catch (e) {
      setErr((e as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    if (!me || !day) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await studentApi.register(me.id, code, day);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const updated = {
        ...me,
        classes_remaining: r.classes_remaining,
        money_remaining: r.money_remaining,
        attended_dates: [r.class_date, ...me.attended_dates],
      };
      setMe(updated);
      setDone(r.class_date);
      const attended = new Set(updated.attended_dates);
      setDay([...updated.available_days].reverse().find((d) => !attended.has(d)) ?? null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPicked(null);
    setQuery("");
    setResults([]);
    setCode("");
    setMe(null);
    setDay(null);
    setErr(null);
    setDone(null);
  }

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/"));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable onPress={me || picked ? reset : goBack} hitSlop={10} style={styles.backBtn} testID="checkin-back-btn">
          <Ionicons name="chevron-back" size={24} color={colors.brandPrimary} />
          <Text style={styles.backText}>{me || picked ? "Cambiar alumno" : "Atrás"}</Text>
        </Pressable>
      </View>

      {!me ? (
        <KeyboardAwareScrollView
          bottomOffset={spacing.lg}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
        >
          <Text style={styles.title}>Registrar mi clase</Text>
          <Text style={styles.subtitle}>Busca tu nombre y escribe tu código personal de 4 cifras.</Text>

          {!picked ? (
            <>
              <Text style={styles.label}>Tu nombre</Text>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Escribe al menos 3 letras"
                placeholderTextColor={colors.muted}
                style={styles.input}
                autoCorrect={false}
                testID="checkin-search-input"
              />
              {searching && <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.brandPrimary} />}
              {!searching && query.trim().length >= 3 && results.length === 0 && (
                <Text style={styles.helper} testID="checkin-no-results">
                  No encontramos ese nombre. Pregunta al monitor.
                </Text>
              )}
              <View style={{ marginTop: spacing.sm }}>
                {results.map((r) => (
                  <Pressable key={r.id} style={styles.resultRow} onPress={() => setPicked(r)} testID={`checkin-result-${r.id}`}>
                    <Ionicons name="person-circle-outline" size={22} color={colors.brandSecondary} />
                    <Text style={styles.resultText}>{r.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <>
              <View style={styles.pickedCard} testID="checkin-picked-name">
                <Ionicons name="person-circle" size={28} color={colors.brandPrimary} />
                <Text style={styles.pickedName}>{picked.name}</Text>
              </View>
              <Text style={styles.label}>Código personal</Text>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 4))}
                placeholder="••••"
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.codeInput]}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={4}
                autoFocus
                onSubmitEditing={() => code.length === 4 && enter()}
                testID="checkin-code-input"
              />
              <Text style={styles.helper}>¿No lo sabes? Pídeselo al monitor.</Text>
              {err && (
                <Text style={styles.errText} testID="checkin-error">
                  {err}
                </Text>
              )}
              <Pressable
                style={[styles.primaryBtn, (code.length !== 4 || busy) && { opacity: 0.5 }]}
                disabled={code.length !== 4 || busy}
                onPress={enter}
                testID="checkin-enter-btn"
              >
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>Entrar</Text>}
              </Pressable>
            </>
          )}
        </KeyboardAwareScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
          <Text style={styles.title} numberOfLines={2}>
            Hola, {me.name.split(" ")[0]}
          </Text>

          <View style={styles.balanceCard} testID="checkin-balance">
            <View style={{ flex: 1 }}>
              <Text style={styles.balanceLabel}>Clases restantes</Text>
              <Text style={styles.balanceValue} testID="checkin-classes-remaining">
                {me.classes_remaining}
              </Text>
            </View>
            <View style={styles.balanceDivider} />
            <View style={{ flex: 1 }}>
              <Text style={styles.balanceLabel}>Saldo del bono</Text>
              <Text style={styles.balanceValue} testID="checkin-money-remaining">
                {me.money_remaining.toFixed(0)} €
              </Text>
            </View>
          </View>

          {done && (
            <View style={styles.doneBox} testID="checkin-success">
              <Ionicons name="checkmark-circle" size={22} color={colors.brandSecondary} />
              <Text style={styles.doneText}>Asistencia registrada: {formatLongDate(done)}</Text>
            </View>
          )}

          {me.classes_remaining <= 0 ? (
            <View style={styles.warnBox} testID="checkin-no-bono">
              <Ionicons name="alert-circle" size={22} color={colors.onWarningSoft} />
              <Text style={styles.warnText}>No te quedan clases. Renueva tu bono con el monitor (10 € = 5 clases, 20 € = 10 clases).</Text>
            </View>
          ) : pendingDays.length === 0 ? (
            <Text style={styles.helper} testID="checkin-nothing-pending">
              No tienes clases pendientes de registrar. ¡Hasta el próximo martes o jueves!
            </Text>
          ) : (
            <>
              <Text style={styles.label}>¿Qué clase quieres registrar?</Text>
              <FlatList
                data={pendingDays}
                horizontal
                keyExtractor={(d) => d}
                showsHorizontalScrollIndicator={false}
                style={{ flexGrow: 0, height: 56 }}
                contentContainerStyle={{ gap: spacing.sm, alignItems: "center" }}
                renderItem={({ item }) => {
                  const active = item === day;
                  return (
                    <Pressable
                      onPress={() => setDay(item)}
                      style={[styles.dayChip, active && styles.dayChipActive]}
                      testID={`checkin-day-${item}`}
                    >
                      <Text style={[styles.dayChipText, active && { color: colors.onBrandPrimary }]}>
                        {item === todayYMD() ? "Hoy" : formatShortDate(item)}
                      </Text>
                    </Pressable>
                  );
                }}
              />
              {err && (
                <Text style={styles.errText} testID="checkin-error">
                  {err}
                </Text>
              )}
              <Pressable
                style={[styles.primaryBtn, (!day || busy) && { opacity: 0.5 }]}
                disabled={!day || busy}
                onPress={register}
                testID="checkin-register-btn"
              >
                {busy ? (
                  <ActivityIndicator color={colors.onBrandPrimary} />
                ) : (
                  <Text style={styles.primaryBtnText}>Registrar Asistencia{day ? ` · ${formatShortDate(day)}` : ""}</Text>
                )}
              </Pressable>
              <Text style={styles.helper}>Se descontará 1 clase (2 €) de tu bono.</Text>
            </>
          )}

          <Pressable style={styles.secondaryBtn} onPress={reset} testID="checkin-exit-btn">
            <Text style={styles.secondaryBtnText}>Salir</Text>
          </Pressable>
        </ScrollView>
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
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 4 },
  label: { fontSize: 13, fontWeight: "600", color: colors.muted, marginTop: spacing.lg, marginBottom: 6 },
  helper: { fontSize: 13, color: colors.muted, marginTop: spacing.sm },
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
  codeInput: { fontSize: 26, letterSpacing: 12, textAlign: "center" },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 52,
    marginBottom: spacing.xs,
  },
  resultText: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.onSurfaceSecondary },
  pickedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  pickedName: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.onBrandTertiary },
  errText: { color: colors.error, fontSize: 14, marginTop: spacing.md, fontWeight: "600" },
  primaryBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: "center",
    minHeight: 52,
    justifyContent: "center",
  },
  primaryBtnText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "700" },
  secondaryBtn: {
    marginTop: spacing.xl,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { color: colors.onSurface, fontWeight: "600", fontSize: 15 },
  balanceCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  balanceLabel: { color: colors.onBrandPrimary, opacity: 0.85, fontSize: 12, fontWeight: "600" },
  balanceValue: { color: colors.onBrandPrimary, fontSize: 34, fontWeight: "800", marginTop: 2 },
  balanceDivider: { width: 1, alignSelf: "stretch", backgroundColor: colors.onBrandPrimary, opacity: 0.25, marginHorizontal: spacing.lg },
  doneBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  doneText: { flex: 1, color: colors.onBrandTertiary, fontWeight: "700", fontSize: 14 },
  warnBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  warnText: { flex: 1, color: colors.onWarningSoft, fontWeight: "600", fontSize: 14 },
  dayChip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  dayChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandSecondary },
  dayChipText: { fontSize: 13, fontWeight: "600", color: colors.onSurfaceSecondary },
}));
