import React, { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, Attendance } from "@/src/api";
import { makeStyles, useTheme, spacing, radius } from "@/src/theme";
import { formatLongDate, formatTime } from "@/src/utils/dates";

type Section = { date: string; items: Attendance[] };

export default function HistorialScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["attendance"], queryFn: api.listAttendance });

  const [armedId, setArmedId] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  const undoMut = useMutation({
    mutationFn: (id: string) => api.deleteAttendance(id),
    onSuccess: () => {
      setArmedId(null);
      setUndoError(null);
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
    },
    onError: (e: Error) => {
      setArmedId(null);
      setUndoError(`No se pudo deshacer: ${e.message}`);
    },
  });

  function onUndoPress(id: string) {
    if (armedId === id) {
      undoMut.mutate(id);
    } else {
      setArmedId(id);
      setTimeout(() => setArmedId((cur) => (cur === id ? null : cur)), 3000);
    }
  }

  const sections: Section[] = useMemo(() => {
    const items = q.data ?? [];
    const byDate = new Map<string, Attendance[]>();
    for (const a of items) {
      if (!byDate.has(a.class_date)) byDate.set(a.class_date, []);
      byDate.get(a.class_date)!.push(a);
    }
    const sorted = [...byDate.entries()].sort(([a], [b]) => (a < b ? 1 : -1));
    return sorted.map(([date, items]) => ({
      date,
      items: items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    }));
  }, [q.data]);

  // Flatten rows with headers for FlatList
  type Row =
    | { kind: "header"; date: string; count: number }
    | { kind: "row"; item: Attendance };
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const s of sections) {
      out.push({ kind: "header", date: s.date, count: s.items.length });
      for (const it of s.items) out.push({ kind: "row", item: it });
    }
    return out;
  }, [sections]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Historial</Text>
        <Text style={styles.headerSubtitle}>
          {q.data?.length ?? 0} {q.data?.length === 1 ? "registro" : "registros"}
        </Text>
        {undoError && (
          <Text style={styles.errorText} testID="undo-error">
            {undoError}
          </Text>
        )}
      </View>

      {q.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <Ionicons name="time-outline" size={56} color={colors.muted} />
          </View>
          <Text style={styles.emptyTitle}>Sin registros</Text>
          <Text style={styles.emptyText}>Registra la primera asistencia desde la pestaña Alumnos.</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r, i) => (r.kind === "header" ? `h-${r.date}` : `i-${r.item.id}`)}
          refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} />}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + 100 }}
          renderItem={({ item }) => {
            if (item.kind === "header") {
              return (
                <View style={styles.sectionHeader} testID={`history-header-${item.date}`}>
                  <Text style={styles.sectionDate}>{formatLongDate(item.date)}</Text>
                  <Text style={styles.sectionCount}>{item.count}</Text>
                </View>
              );
            }
            const a = item.item;
            return (
              <View style={styles.row} testID={`attendance-${a.id}`}>
                <View style={styles.rowDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {a.student_name}
                  </Text>
                  <Text style={styles.rowTime}>{formatTime(a.created_at)}</Text>
                </View>
                <Pressable
                  onPress={() => onUndoPress(a.id)}
                  disabled={undoMut.isPending}
                  style={[styles.undoBtn, armedId === a.id && { backgroundColor: colors.error }]}
                  testID={`undo-attendance-${a.id}`}
                  hitSlop={6}
                >
                  <Ionicons name="arrow-undo" size={14} color={armedId === a.id ? colors.onError : colors.error} />
                  <Text style={[styles.undoText, armedId === a.id && { color: colors.onError }]}>
                    {armedId === a.id ? "¿Confirmar?" : "Deshacer"}
                  </Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md },
  headerTitle: { fontSize: 32, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  headerSubtitle: { marginTop: 4, fontSize: 14, color: colors.muted, fontWeight: "500" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { marginTop: 6, fontSize: 13, color: colors.error, fontWeight: "600" },

  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyIcon: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: colors.onSurface },
  emptyText: { marginTop: 6, fontSize: 14, color: colors.muted, textAlign: "center" },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.sm,
  },
  sectionDate: { fontSize: 14, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  sectionCount: { fontSize: 12, fontWeight: "700", color: colors.muted, backgroundColor: colors.surfaceTertiary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },

  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  rowDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary, marginRight: spacing.md },
  rowName: { fontSize: 15, fontWeight: "600", color: colors.onSurfaceSecondary },
  rowTime: { fontSize: 12, color: colors.muted, marginTop: 2 },
  undoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  undoText: { color: colors.error, fontSize: 12, fontWeight: "700" },
}));
