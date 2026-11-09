import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, Registration } from "@/src/api";
import { makeStyles, useTheme, spacing, radius } from "@/src/theme";

export default function Solicitudes() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["registrations"], queryFn: api.listRegistrations });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["registrations"] });
    qc.invalidateQueries({ queryKey: ["students"] });
  };

  const approve = useMutation({
    mutationFn: ({ id, bono }: { id: string; bono: 5 | 10 }) => api.approveRegistration(id, bono),
    onSuccess: () => {
      setErr(null);
      refresh();
    },
    onError: (e: Error) => {
      setErr(e.message);
      refresh();
    },
  });
  const reject = useMutation({
    mutationFn: (id: string) => api.rejectRegistration(id),
    onSuccess: () => {
      setErr(null);
      refresh();
    },
    onError: (e: Error) => {
      setErr(e.message);
      refresh();
    },
  });

  const busy = approve.isPending || reject.isPending;
  const items = q.data ?? [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={10} style={styles.backBtn} testID="requests-back-btn">
          <Ionicons name="chevron-back" size={24} color={colors.brandPrimary} />
          <Text style={styles.backText}>Alumnos</Text>
        </Pressable>
      </View>
      <View style={styles.header}>
        <Text style={styles.title}>Inscripciones</Text>
        <Text style={styles.subtitle}>Aprueba cuando el alumno haya pagado su bono</Text>
        {err && (
          <Text style={styles.errText} testID="requests-error">
            {err}
          </Text>
        )}
      </View>

      {q.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : q.isError ? (
        <View style={styles.center} testID="requests-load-error">
          <Text style={styles.errText}>Error al cargar inscripciones</Text>
          <Pressable style={styles.retryBtn} onPress={() => q.refetch()} testID="requests-retry-btn">
            <Text style={styles.approveText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} />}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl, flexGrow: 1 }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={
            <View style={styles.empty} testID="requests-empty">
              <Ionicons name="mail-open-outline" size={48} color={colors.muted} />
              <Text style={styles.emptyText}>No hay inscripciones pendientes.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <RequestCard
              reg={item}
              busy={busy}
              onApprove={(bono) => approve.mutate({ id: item.id, bono })}
              onReject={() => reject.mutate(item.id)}
            />
          )}
        />
      )}
    </View>
  );
}

function RequestCard({
  reg,
  busy,
  onApprove,
  onReject,
}: {
  reg: Registration;
  busy: boolean;
  onApprove: (bono: 5 | 10) => void;
  onReject: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [confirmReject, setConfirmReject] = useState(false);

  return (
    <View style={styles.card} testID={`request-card-${reg.id}`}>
      <Text style={styles.name}>{reg.name}</Text>
      <View style={styles.infoRow}>
        <Ionicons name="call-outline" size={14} color={colors.muted} />
        <Text style={styles.info}>{reg.phone}</Text>
      </View>
      <View style={styles.infoRow}>
        <Ionicons name="mail-outline" size={14} color={colors.muted} />
        <Text style={styles.info}>{reg.email}</Text>
      </View>
      {!!reg.health_notes && (
        <View style={styles.healthBox}>
          <Ionicons name="medkit-outline" size={14} color={colors.warning} />
          <Text style={styles.healthText}>{reg.health_notes}</Text>
        </View>
      )}

      <Text style={styles.approveLabel}>Aprobar con bono:</Text>
      <View style={styles.actions}>
        <Pressable
          style={[styles.approveBtn, busy && { opacity: 0.5 }]}
          disabled={busy}
          onPress={() => onApprove(5)}
          testID={`approve-5-${reg.id}`}
        >
          <Text style={styles.approveText}>10 € · 5 clases</Text>
        </Pressable>
        <Pressable
          style={[styles.approveBtn, busy && { opacity: 0.5 }]}
          disabled={busy}
          onPress={() => onApprove(10)}
          testID={`approve-10-${reg.id}`}
        >
          <Text style={styles.approveText}>20 € · 10 clases</Text>
        </Pressable>
      </View>
      <Pressable
        style={[styles.rejectBtn, confirmReject && { backgroundColor: colors.error }]}
        disabled={busy}
        onPress={() => (confirmReject ? onReject() : setConfirmReject(true))}
        testID={`reject-${reg.id}`}
      >
        <Text style={[styles.rejectText, confirmReject && { color: colors.onError }]}>
          {confirmReject ? "¿Seguro? Toca para rechazar" : "Rechazar"}
        </Text>
      </Pressable>
    </View>
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
  errText: { color: colors.error, fontSize: 13, marginTop: spacing.sm, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingTop: spacing["3xl"] },
  emptyText: { color: colors.muted, fontSize: 15 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg },
  name: { fontSize: 18, fontWeight: "700", color: colors.onSurfaceSecondary, marginBottom: spacing.xs },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  info: { fontSize: 14, color: colors.onSurfaceSecondary },
  healthBox: {
    flexDirection: "row",
    gap: 6,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary,
  },
  healthText: { flex: 1, fontSize: 13, color: colors.onSurfaceTertiary },
  approveLabel: { fontSize: 12, fontWeight: "600", color: colors.muted, marginTop: spacing.md, marginBottom: 6 },
  actions: { flexDirection: "row", gap: spacing.sm },
  approveBtn: {
    flex: 1,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  retryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    minHeight: 44,
    justifyContent: "center",
  },
  approveText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 14 },
  rejectBtn: { marginTop: spacing.sm, minHeight: 44, justifyContent: "center", alignItems: "center", borderRadius: radius.md },
  rejectText: { color: colors.error, fontWeight: "600", fontSize: 14 },
}));
