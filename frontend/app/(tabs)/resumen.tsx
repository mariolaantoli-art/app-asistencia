import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/src/api";
import { makeStyles, useTheme, spacing, radius } from "@/src/theme";
import { COURSE_MONTHS, currentCourseMonth, monthLabel } from "@/src/utils/dates";

export default function ResumenScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();

  const [selected, setSelected] = useState(() => currentCourseMonth());

  const q = useQuery({
    queryKey: ["summary", selected.year, selected.month],
    queryFn: () => api.monthlySummary(selected.year, selected.month),
  });

  const data = q.data;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Resumen</Text>
        <Text style={styles.headerSubtitle}>Control económico del curso</Text>
      </View>

      <View style={styles.chipsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
        >
          {COURSE_MONTHS.map((m) => {
            const active = m.year === selected.year && m.month === selected.month;
            return (
              <Pressable
                key={`${m.year}-${m.month}`}
                onPress={() => setSelected(m)}
                style={[styles.chip, active && styles.chipActive]}
                testID={`month-chip-${m.year}-${m.month}`}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {monthLabel(m.year, m.month)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {q.isLoading || !data ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroCard} testID="summary-hero">
            <Text style={styles.heroLabel}>Total {monthLabel(data.year, data.month)}</Text>
            <Text style={styles.heroAmount} testID="summary-total-cost">{data.total_cost.toFixed(2)} €</Text>
            <Text style={styles.heroHint}>{data.total_classes} {data.total_classes === 1 ? "asistencia" : "asistencias"} · 4 €/clase</Text>

            <View style={styles.heroBreakdown}>
              <View style={styles.heroItem}>
                <Ionicons name="people" size={16} color={colors.onBrandPrimary} />
                <View>
                  <Text style={styles.heroItemLabel}>Alumnos</Text>
                  <Text style={styles.heroItemValue}>{data.total_student_paid.toFixed(2)} €</Text>
                </View>
              </View>
              <View style={styles.heroDivider} />
              <View style={styles.heroItem}>
                <Ionicons name="business" size={16} color={colors.onBrandPrimary} />
                <View>
                  <Text style={styles.heroItemLabel}>Ayuntamiento</Text>
                  <Text style={styles.heroItemValue}>{data.total_subsidy_paid.toFixed(2)} €</Text>
                </View>
              </View>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Por alumno</Text>

          {data.items.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="calendar-outline" size={32} color={colors.muted} />
              <Text style={styles.emptyText}>Sin asistencias este mes.</Text>
            </View>
          ) : (
            data.items.map((it) => (
              <View key={it.student_id} style={styles.itemCard} testID={`summary-item-${it.student_id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{it.student_name}</Text>
                  <Text style={styles.itemMeta}>
                    {it.classes_attended} {it.classes_attended === 1 ? "clase" : "clases"} · {it.student_paid.toFixed(2)} € alumno
                  </Text>
                </View>
                <View style={styles.itemRight}>
                  <Text style={styles.itemTotal}>{it.total_cost.toFixed(2)} €</Text>
                  <Text style={styles.itemSubsidy}>+{it.subsidy_paid.toFixed(2)} € subv.</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  headerTitle: { fontSize: 32, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  headerSubtitle: { marginTop: 4, fontSize: 14, color: colors.muted, fontWeight: "500" },

  chipsWrap: { paddingVertical: spacing.sm },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandSecondary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: colors.onBrandPrimary },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  heroCard: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },
  heroLabel: { color: colors.onBrandPrimary, opacity: 0.85, fontSize: 13, fontWeight: "600" },
  heroAmount: { color: colors.onBrandPrimary, fontSize: 42, fontWeight: "800", letterSpacing: -1, marginTop: 4 },
  heroHint: { color: colors.onBrandPrimary, opacity: 0.85, fontSize: 13, marginTop: 2 },
  heroBreakdown: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.2)",
  },
  heroItem: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  heroDivider: { width: 1, height: 32, backgroundColor: "rgba(255,255,255,0.2)" },
  heroItemLabel: { color: colors.onBrandPrimary, opacity: 0.8, fontSize: 11, fontWeight: "600" },
  heroItemValue: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "700" },

  sectionTitle: { fontSize: 14, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.xl, marginBottom: spacing.sm },

  emptyCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyText: { color: colors.muted, fontSize: 14 },

  itemCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  itemName: { fontSize: 15, fontWeight: "700", color: colors.onSurfaceSecondary },
  itemMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  itemRight: { alignItems: "flex-end" },
  itemTotal: { fontSize: 16, fontWeight: "800", color: colors.brandPrimary },
  itemSubsidy: { fontSize: 11, color: colors.muted, marginTop: 2 },
}));
