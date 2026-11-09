import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, BonoPurchase } from "@/src/api";
import { makeStyles, useTheme, spacing, radius } from "@/src/theme";
import { formatTime } from "@/src/utils/dates";

function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

export default function Bonos() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  const [editing, setEditing] = useState<BonoPurchase | null>(null);

  const q = useQuery({ queryKey: ["bonos"], queryFn: api.listBonos });
  const items = q.data ?? [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={10}
          style={styles.backBtn}
          testID="bonos-back-btn"
        >
          <Ionicons name="chevron-back" size={24} color={colors.brandPrimary} />
          <Text style={styles.backText}>Alumnos</Text>
        </Pressable>
      </View>
      <View style={styles.header}>
        <Text style={styles.title}>Bonos pagados</Text>
        <Text style={styles.subtitle}>Toca un bono para corregir el importe, la persona o anularlo</Text>
      </View>

      {q.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : q.isError ? (
        <View style={styles.center} testID="bonos-load-error">
          <Text style={styles.errText}>Error al cargar los bonos</Text>
          <Pressable style={styles.primaryBtn} onPress={() => q.refetch()} testID="bonos-retry-btn">
            <Text style={styles.primaryBtnText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(b) => b.id}
          refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} />}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl, flexGrow: 1 }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
          ListEmptyComponent={
            <View style={styles.empty} testID="bonos-empty">
              <Ionicons name="wallet-outline" size={48} color={colors.muted} />
              <Text style={styles.emptyText}>Aún no hay bonos registrados.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => setEditing(item)} testID={`bono-row-${item.id}`}>
              <View style={styles.amountPill}>
                <Text style={styles.amountText}>{item.amount.toFixed(0)} €</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={2}>
                  {item.student_name}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.bono_type} clases · {formatDay(item.created_at)} {formatTime(item.created_at)}
                </Text>
              </View>
              <Ionicons name="create-outline" size={20} color={colors.brandSecondary} />
            </Pressable>
          )}
        />
      )}

      <EditBonoSheet bono={editing} onClose={() => setEditing(null)} />
    </View>
  );
}

function EditBonoSheet({ bono, onClose }: { bono: BonoPurchase | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const qc = useQueryClient();
  const studentsQ = useQuery({ queryKey: ["students"], queryFn: api.listStudents, enabled: !!bono });

  const [bonoType, setBonoType] = useState<5 | 10>(10);
  const [studentId, setStudentId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);

  // Reinicia el formulario cada vez que se abre un bono distinto
  if (bono && bono.id !== lastId) {
    setLastId(bono.id);
    setBonoType(bono.bono_type);
    setStudentId(bono.student_id);
    setSearch("");
    setErr(null);
    setConfirmCancel(false);
  }

  const students = useMemo(() => studentsQ.data ?? [], [studentsQ.data]);
  const selectedName = students.find((s) => s.id === studentId)?.name ?? bono?.student_name ?? "";
  const matches = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (t.length < 2) return [];
    return students.filter((s) => s.name.toLowerCase().includes(t)).slice(0, 6);
  }, [search, students]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["bonos"] });
    qc.invalidateQueries({ queryKey: ["students"] });
  };

  const save = useMutation({
    mutationFn: () => api.updateBono(bono!.id, studentId, bonoType),
    onSuccess: () => {
      invalidate();
      close();
    },
    onError: (e: Error) => setErr(e.message),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelBono(bono!.id),
    onSuccess: () => {
      invalidate();
      close();
    },
    onError: (e: Error) => {
      setErr(e.message);
      setConfirmCancel(false);
    },
  });

  function close() {
    setLastId(null);
    onClose();
  }

  const changed = !!bono && (bono.bono_type !== bonoType || bono.student_id !== studentId);
  const busy = save.isPending || cancel.isPending;

  return (
    <Modal visible={!!bono} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]} testID="edit-bono-modal">
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Corregir bono</Text>

          <Text style={styles.label}>Importe</Text>
          <View style={styles.bonoRow}>
            {([5, 10] as const).map((v) => (
              <Pressable
                key={v}
                onPress={() => setBonoType(v)}
                style={[styles.bonoCard, bonoType === v && styles.bonoCardSelected]}
                testID={`edit-bono-type-${v}`}
              >
                <Text style={[styles.bonoAmount, bonoType === v && { color: colors.onBrandPrimary }]}>{v * 2} €</Text>
                <Text style={[styles.bonoClasses, bonoType === v && { color: colors.onBrandPrimary }]}>{v} clases</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Alumno</Text>
          <View style={styles.selectedStudent} testID="edit-bono-selected-student">
            <Ionicons name="person-circle" size={22} color={colors.brandPrimary} />
            <Text style={styles.selectedStudentText} numberOfLines={2}>
              {selectedName}
            </Text>
          </View>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="¿Otra persona? Busca su nombre"
            placeholderTextColor={colors.muted}
            style={styles.input}
            autoCorrect={false}
            testID="edit-bono-student-search"
          />
          {matches.map((s) => (
            <Pressable
              key={s.id}
              style={styles.match}
              onPress={() => {
                setStudentId(s.id);
                setSearch("");
              }}
              testID={`edit-bono-pick-${s.id}`}
            >
              <Text style={styles.matchText}>{s.name}</Text>
            </Pressable>
          ))}

          {err && (
            <Text style={styles.errText} testID="edit-bono-error">
              {err}
            </Text>
          )}

          <View style={styles.actions}>
            <Pressable style={styles.secondaryBtn} onPress={close} testID="edit-bono-close">
              <Text style={styles.secondaryBtnText}>Cerrar</Text>
            </Pressable>
            <Pressable
              style={[styles.saveBtn, (!changed || busy) && { opacity: 0.5 }]}
              disabled={!changed || busy}
              onPress={() => save.mutate()}
              testID="edit-bono-save"
            >
              {save.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>Guardar</Text>}
            </Pressable>
          </View>
          <Pressable
            style={[styles.cancelBtn, confirmCancel && { backgroundColor: colors.error }]}
            disabled={busy}
            onPress={() => (confirmCancel ? cancel.mutate() : setConfirmCancel(true))}
            testID="edit-bono-cancel"
          >
            <Text style={[styles.cancelText, confirmCancel && { color: colors.onError }]}>
              {confirmCancel ? "¿Seguro? Toca para anular el bono" : "Anular este bono"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  topBar: { height: 48, justifyContent: "center", paddingHorizontal: spacing.sm },
  backBtn: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  backText: { color: colors.brandPrimary, fontSize: 16, fontWeight: "500" },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { fontSize: 30, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingTop: spacing["3xl"] },
  emptyText: { color: colors.muted, fontSize: 15 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 60,
  },
  amountPill: {
    width: 56,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  amountText: { color: colors.onBrandTertiary, fontWeight: "800", fontSize: 15 },
  rowName: { fontSize: 15, fontWeight: "700", color: colors.onSurfaceSecondary },
  rowMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  errText: { color: colors.error, fontSize: 14, marginTop: spacing.md, fontWeight: "600" },
  modalWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
  },
  handle: { alignSelf: "center", width: 42, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: "700", color: colors.onSurface },
  label: { fontSize: 13, fontWeight: "600", color: colors.muted, marginTop: spacing.md, marginBottom: 6 },
  bonoRow: { flexDirection: "row", gap: spacing.sm },
  bonoCard: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  bonoCardSelected: { backgroundColor: colors.brandPrimary, borderColor: colors.brandSecondary },
  bonoAmount: { fontSize: 22, fontWeight: "800", color: colors.onSurface },
  bonoClasses: { fontSize: 13, fontWeight: "600", color: colors.muted, marginTop: 2 },
  selectedStudent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  selectedStudentText: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.onBrandTertiary },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.onSurface,
  },
  match: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  matchText: { fontSize: 15, color: colors.onSurface },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  secondaryBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { color: colors.onSurface, fontWeight: "600", fontSize: 15 },
  saveBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: {
    marginTop: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 15 },
  cancelBtn: { marginTop: spacing.sm, minHeight: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  cancelText: { color: colors.error, fontWeight: "600", fontSize: 14 },
}));
