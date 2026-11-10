import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { api, DayStatus, logout, Student } from "@/src/api";
import { makeStyles, useTheme, spacing, radius } from "@/src/theme";
import { defaultClassDay, formatLongDate, formatShortDate, todayYMD } from "@/src/utils/dates";

const DAY_CHIP_W = 96;

export default function AlumnosScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const sheetInsets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);
  const [showRenew, setShowRenew] = useState<Student | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Student | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);

  const studentsQuery = useQuery({
    queryKey: ["students"],
    queryFn: api.listStudents,
  });
  const daysQuery = useQuery({ queryKey: ["class-days"], queryFn: api.classDays });
  const regsQuery = useQuery({ queryKey: ["registrations"], queryFn: api.listRegistrations });
  const pendingCount = regsQuery.data?.length ?? 0;
  const [infoStudent, setInfoStudent] = useState<Student | null>(null);
  const router = useRouter();
  const attendanceQuery = useQuery({ queryKey: ["attendance"], queryFn: api.listAttendance });
  const days = useMemo(() => daysQuery.data?.days ?? [], [daysQuery.data]);
  const cancelled = daysQuery.data?.cancelled ?? {};
  const [showDayOptions, setShowDayOptions] = useState(false);
  const [pickedDay, setPickedDay] = useState<string | undefined>();
  const selectedDay = pickedDay ?? defaultClassDay(days);
  const selectedStatus = selectedDay ? cancelled[selectedDay] : undefined;

  const dayStatusMut = useMutation({
    mutationFn: ({ day, status }: { day: string; status: DayStatus | "normal" }) => api.setDayStatus(day, status),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["class-days"] });
      setShowDayOptions(false);
      showToast(
        r.status === "normal" ? "Día marcado con clase normal" : r.status === "festivo" ? "Día marcado como festivo" : "Clase marcada como suspendida",
        "ok",
      );
    },
    onError: (e: Error) => {
      setShowDayOptions(false);
      showToast(e.message, "err");
    },
  });

  const attendedIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of attendanceQuery.data ?? []) if (a.class_date === selectedDay) set.add(a.student_id);
    return set;
  }, [attendanceQuery.data, selectedDay]);

  const registerMut = useMutation({
    mutationFn: (studentId: string) => api.registerAttendance(studentId, selectedDay),
    onSuccess: (att) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      showToast(`Asistencia registrada: ${att.student_name}`, "ok");
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      showToast(e.message, "err");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteStudent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      showToast("Alumno eliminado", "ok");
    },
    onError: (e: Error) => showToast(e.message, "err"),
  });

  function showToast(msg: string, type: "ok" | "err") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2200);
  }

  const today = todayYMD();
  // Primero los que tienen bono con saldo, después los que no; dentro de cada grupo se mantiene el orden de la lista
  const students = useMemo(() => {
    const all = studentsQuery.data ?? [];
    return [...all.filter((s) => s.classes_remaining > 0), ...all.filter((s) => s.classes_remaining <= 0)];
  }, [studentsQuery.data]);
  const selectedIndex = selectedDay ? days.indexOf(selectedDay) : -1;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header} testID="alumnos-header">
        <View style={styles.headerTop}>
          <Text style={styles.headerTitle}>Alumnos</Text>
          <View style={{ flexDirection: "row" }}>
            <Pressable onPress={() => router.push("/bonos")} style={styles.logoutBtn} hitSlop={8} testID="open-bonos-btn">
              <Ionicons name="wallet-outline" size={22} color={colors.brandSecondary} />
            </Pressable>
          <Pressable
            onPress={async () => {
              await logout();
              router.replace("/bienvenida");
            }}
            style={styles.logoutBtn}
            hitSlop={8}
            testID="logout-btn"
          >
            <Ionicons name="log-out-outline" size={22} color={colors.muted} />
          </Pressable>
          </View>
        </View>
        <View style={styles.subtitleRow}>
          <Text style={[styles.headerSubtitle, { flex: 1 }]} testID="selected-class-day">
            {selectedDay ? `Clase: ${formatLongDate(selectedDay)}${selectedDay === today ? " (hoy)" : ""}` : "Cargando días de clase…"}
          </Text>
          {selectedDay && (
            <Pressable style={styles.dayOptionsBtn} onPress={() => setShowDayOptions(true)} testID="day-options-btn">
              <Ionicons name="calendar-outline" size={16} color={colors.brandSecondary} />
              <Text style={styles.dayOptionsText}>Estado del día</Text>
            </Pressable>
          )}
        </View>
        {selectedStatus && (
          <View style={styles.cancelBanner} testID="day-cancelled-banner">
            <Ionicons name={selectedStatus === "festivo" ? "sunny" : "close-circle"} size={18} color={colors.onSurfaceInverse} />
            <Text style={styles.cancelBannerText}>
              {selectedStatus === "festivo" ? "Festivo: no hay clase este día" : "Clase suspendida este día"}
            </Text>
          </View>
        )}
        {pendingCount > 0 && (
          <Pressable style={styles.pendingBanner} onPress={() => router.push("/solicitudes")} testID="pending-requests-banner">
            <Ionicons name="mail-unread" size={18} color={colors.onWarningSoft} />
            <Text style={styles.pendingText}>
              {pendingCount} {pendingCount === 1 ? "inscripción pendiente" : "inscripciones pendientes"}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.onWarningSoft} />
          </Pressable>
        )}
      </View>

      <View style={styles.daysRow}>
        {days.length > 0 && (
          <FlatList
            data={days}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(d) => d}
            initialScrollIndex={selectedIndex > 2 ? selectedIndex - 2 : 0}
            getItemLayout={(_, index) => ({ length: DAY_CHIP_W + spacing.sm, offset: (DAY_CHIP_W + spacing.sm) * index, index })}
            contentContainerStyle={{ paddingHorizontal: spacing.lg }}
            renderItem={({ item }) => {
              const active = item === selectedDay;
              const off = !!cancelled[item];
              return (
                <Pressable
                  onPress={() => setPickedDay(item)}
                  style={[styles.dayChip, off && styles.dayChipOff, active && styles.dayChipActive, active && off && styles.dayChipOffActive]}
                  testID={`class-day-${item}`}
                >
                  <Text
                    style={[
                      styles.dayChipText,
                      off && styles.dayChipTextOff,
                      active && styles.dayChipTextActive,
                    ]}
                  >
                    {formatShortDate(item)}
                  </Text>
                </Pressable>
              );
            }}
          />
        )}
      </View>

      {studentsQuery.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : students.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyWrap}
          refreshControl={
            <RefreshControl refreshing={studentsQuery.isFetching} onRefresh={() => studentsQuery.refetch()} />
          }
        >
          <View style={styles.emptyIcon}>
            <Ionicons name="clipboard-outline" size={56} color={colors.muted} />
          </View>
          <Text style={styles.emptyTitle}>No hay alumnos</Text>
          <Text style={styles.emptyText}>Añade uno para empezar a registrar asistencias.</Text>
        </ScrollView>
      ) : (
        <FlatList
          data={students}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 140 }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          refreshControl={
            <RefreshControl refreshing={studentsQuery.isFetching} onRefresh={() => studentsQuery.refetch()} />
          }
          renderItem={({ item }) => (
            <StudentRow
              student={item}
              onRegister={() => registerMut.mutate(item.id)}
              attended={attendedIds.has(item.id)}
              dayOff={!!selectedStatus}
              busy={registerMut.isPending && registerMut.variables === item.id}
              onDelete={() => setConfirmDelete(item)}
              onRenew={() => setShowRenew(item)}
              onInfo={() => setInfoStudent(item)}
            />
          )}
        />
      )}

      <Pressable
        style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}
        onPress={() => setShowAdd(true)}
        testID="add-student-fab"
      >
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
      </Pressable>

      <AddStudentModal visible={showAdd} onClose={() => setShowAdd(false)} onDone={() => showToast("Alumno añadido", "ok")} />
      <RenewBonoModal student={showRenew} onClose={() => setShowRenew(null)} onDone={() => showToast("Bono renovado", "ok")} />

      <Modal visible={showDayOptions} transparent animationType="slide" onRequestClose={() => setShowDayOptions(false)}>
        <View style={styles.modalWrap}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowDayOptions(false)} />
          <View style={[styles.modalSheet, { paddingBottom: sheetInsets.bottom + spacing.xl }]} testID="day-options-modal">
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{selectedDay ? formatLongDate(selectedDay) : ""}</Text>
            <Text style={styles.helper}>Los días festivos o suspendidos no cuentan como clase y no se puede registrar asistencia.</Text>
            {([
              { status: "normal", label: "Clase normal", icon: "checkmark-circle-outline" },
              { status: "festivo", label: "Festivo", icon: "sunny-outline" },
              { status: "suspendida", label: "Clase suspendida", icon: "close-circle-outline" },
            ] as const).map((o) => {
              const current = (selectedStatus ?? "normal") === o.status;
              return (
                <Pressable
                  key={o.status}
                  style={[styles.dayOption, current && styles.dayOptionActive]}
                  disabled={dayStatusMut.isPending || current}
                  onPress={() => selectedDay && dayStatusMut.mutate({ day: selectedDay, status: o.status })}
                  testID={`day-status-${o.status}`}
                >
                  <Ionicons name={o.icon} size={20} color={current ? colors.onBrandPrimary : colors.brandSecondary} />
                  <Text style={[styles.dayOptionText, current && { color: colors.onBrandPrimary }]}>{o.label}</Text>
                  {current && <Ionicons name="checkmark" size={20} color={colors.onBrandPrimary} />}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>

      <Modal visible={!!infoStudent} transparent animationType="slide" onRequestClose={() => setInfoStudent(null)}>
        <View style={styles.modalWrap}>
          <Pressable style={styles.modalBackdrop} onPress={() => setInfoStudent(null)} />
          <View style={[styles.modalSheet, { paddingBottom: sheetInsets.bottom + spacing.xl }]} testID="student-info-modal">
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{infoStudent?.name}</Text>
            <InfoLine icon="key-outline" label="Código personal (para registrar sus clases)" value={infoStudent?.code} testID="student-code-value" />
            <InfoLine icon="call-outline" label="Teléfono" value={infoStudent?.phone} />
            <InfoLine icon="mail-outline" label="Email" value={infoStudent?.email} />
            <InfoLine icon="medkit-outline" label="Salud / lesiones" value={infoStudent?.health_notes} />
            <Pressable style={[styles.secondaryBtn, { marginTop: spacing.lg }]} onPress={() => setInfoStudent(null)} testID="close-student-info">
              <Text style={styles.secondaryBtnText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!confirmDelete} transparent animationType="fade" onRequestClose={() => setConfirmDelete(null)}>
        <View style={styles.modalWrap}>
          <Pressable style={styles.modalBackdrop} onPress={() => setConfirmDelete(null)} />
          <View style={[styles.modalSheet, { paddingBottom: sheetInsets.bottom + spacing.xl }]} testID="confirm-delete-modal">
            <Text style={styles.sheetTitle}>¿Eliminar a {confirmDelete?.name}?</Text>
            <Text style={styles.helper}>Se borrará también todo su historial de asistencias.</Text>
            <View style={styles.sheetActions}>
              <Pressable style={styles.secondaryBtn} onPress={() => setConfirmDelete(null)} testID="cancel-delete-student">
                <Text style={styles.secondaryBtnText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: colors.error }]}
                onPress={() => {
                  if (confirmDelete) deleteMut.mutate(confirmDelete.id);
                  setConfirmDelete(null);
                }}
                testID="confirm-delete-student"
              >
                <Text style={styles.primaryBtnText}>Eliminar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {toast && (
        <View
          style={[
            styles.toast,
            { bottom: insets.bottom + 90, backgroundColor: toast.type === "ok" ? colors.brandSecondary : colors.error },
          ]}
          pointerEvents="none"
          testID="toast"
        >
          <Text style={styles.toastText}>{toast.msg}</Text>
        </View>
      )}
    </View>
  );
}

function InfoLine({ icon, label, value, testID }: { icon: string; label: string; value?: string; testID?: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.infoLine}>
      <Ionicons name={icon as any} size={18} color={colors.brandSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} testID={testID}>{value || "—"}</Text>
      </View>
    </View>
  );
}

function StudentRow({
  student,
  onRegister,
  attended,
  dayOff,
  busy,
  onDelete,
  onRenew,
  onInfo,
}: {
  student: Student;
  onRegister: () => void;
  attended: boolean;
  dayOff: boolean;
  busy: boolean;
  onDelete: () => void;
  onRenew: () => void;
  onInfo: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const low = student.classes_remaining <= 0;

  return (
    <View style={styles.card} testID={`student-row-${student.id}`}>
      <Pressable style={styles.cardLeft} onPress={onInfo} testID={`student-info-${student.id}`}>
        <View style={styles.nameRow}>
          <Text style={styles.studentName} numberOfLines={2}>
            {student.name}
          </Text>
          {!!student.health_notes && <Ionicons name="medkit" size={14} color={colors.warning} />}
        </View>
        <View style={styles.badgesRow}>
          <View style={[styles.badge, low ? styles.badgeDanger : styles.badgeInfo]}>
            <Ionicons name="ticket-outline" size={13} color={low ? colors.error : colors.brandSecondary} />
            <Text style={[styles.badgeText, { color: low ? colors.error : colors.brandSecondary }]}>
              {student.classes_remaining} {student.classes_remaining === 1 ? "clase" : "clases"}
            </Text>
          </View>
          <View style={[styles.badge, styles.badgeMoney]}>
            <Text style={[styles.badgeText, { color: colors.onSurfaceTertiary }]}>{student.money_remaining.toFixed(0)} €</Text>
          </View>
        </View>
      </Pressable>

      <View style={styles.cardActions}>
        <Pressable
          onPress={onRegister}
          disabled={busy || low || attended || dayOff}
          style={({ pressed }) => [
            styles.registerBtn,
            (low || attended || dayOff) && styles.registerBtnDisabled,
            pressed && !low && styles.registerBtnPressed,
          ]}
          testID={`register-attendance-${student.id}`}
        >
          {busy ? (
            <ActivityIndicator color={colors.onBrandPrimary} size="small" />
          ) : attended ? (
            <>
              <Ionicons name="checkmark-done" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.registerBtnText}>Asistió</Text>
            </>
          ) : dayOff ? (
            <Text style={[styles.registerBtnText, styles.registerBtnTextOff]}>Sin clase</Text>
          ) : low ? (
            <Text style={[styles.registerBtnText, styles.registerBtnTextOff]}>Sin bono</Text>
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.registerBtnText}>Registrar Asistencia</Text>
            </>
          )}
        </Pressable>
        <View style={styles.smallActionsRow}>
          <Pressable
            onPress={onRenew}
            style={styles.iconBtn}
            testID={`renew-bono-${student.id}`}
            hitSlop={8}
          >
            <Ionicons name="refresh" size={18} color={colors.brandSecondary} />
          </Pressable>
          <Pressable onPress={onDelete} style={styles.iconBtn} testID={`delete-student-${student.id}`} hitSlop={8}>
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function AddStudentModal({
  visible,
  onClose,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const sheetInsets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [bono, setBono] = useState<5 | 10>(10);
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => api.createStudent(name.trim(), bono),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students"] });
      setName("");
      setBono(10);
      setErr(null);
      onDone();
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalWrap}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.modalSheet, { paddingBottom: sheetInsets.bottom + spacing.xl }]} testID="add-student-modal">
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Nuevo alumno</Text>

          <Text style={styles.label}>Nombre</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Ej. María García"
            placeholderTextColor={colors.muted}
            style={styles.input}
            autoFocus
            testID="student-name-input"
          />

          <Text style={styles.label}>Bono inicial</Text>
          <View style={styles.bonoRow}>
            <BonoOption value={5} selected={bono === 5} onPress={() => setBono(5)} testID="bono-option-5" />
            <BonoOption value={10} selected={bono === 10} onPress={() => setBono(10)} testID="bono-option-10" />
          </View>

          {err && <Text style={styles.errText}>{err}</Text>}

          <View style={styles.sheetActions}>
            <Pressable style={styles.secondaryBtn} onPress={onClose} testID="cancel-add-student">
              <Text style={styles.secondaryBtnText}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, (!name.trim() || mut.isPending) && { opacity: 0.6 }]}
              disabled={!name.trim() || mut.isPending}
              onPress={() => mut.mutate()}
              testID="save-student-btn"
            >
              {mut.isPending ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <Text style={styles.primaryBtnText}>Añadir</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function RenewBonoModal({
  student,
  onClose,
  onDone,
}: {
  student: Student | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const sheetInsets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [bono, setBono] = useState<5 | 10>(10);
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => api.renewBono(student!.id, bono),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["bonos"] });
      setErr(null);
      onDone();
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Modal visible={!!student} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.modalSheet, { paddingBottom: sheetInsets.bottom + spacing.xl }]} testID="renew-bono-modal">
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Renovar bono</Text>
          <Text style={[styles.label, { marginTop: 0 }]}>{student?.name}</Text>
          <Text style={styles.helper}>Las clases se sumarán al saldo actual. Si te equivocas, corrígelo en Bonos pagados (icono de cartera).</Text>

          <View style={styles.bonoRow}>
            <BonoOption value={5} selected={bono === 5} onPress={() => setBono(5)} testID="renew-bono-5" />
            <BonoOption value={10} selected={bono === 10} onPress={() => setBono(10)} testID="renew-bono-10" />
          </View>

          {err && <Text style={styles.errText}>{err}</Text>}

          <View style={styles.sheetActions}>
            <Pressable style={styles.secondaryBtn} onPress={onClose} testID="cancel-renew">
              <Text style={styles.secondaryBtnText}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, mut.isPending && { opacity: 0.6 }]}
              disabled={mut.isPending}
              onPress={() => mut.mutate()}
              testID="confirm-renew"
            >
              {mut.isPending ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <Text style={styles.primaryBtnText}>Renovar</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function BonoOption({
  value,
  selected,
  onPress,
  testID,
}: {
  value: 5 | 10;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} testID={testID} style={[styles.bonoCard, selected && styles.bonoCardSelected]}>
      <Text style={[styles.bonoAmount, selected && { color: colors.onBrandPrimary }]}>{value === 5 ? "10 €" : "20 €"}</Text>
      <Text style={[styles.bonoClasses, selected && { color: colors.onBrandPrimary }]}>
        {value} clases
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTitle: { fontSize: 32, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  logoutBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  pendingBanner: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  pendingText: { flex: 1, color: colors.onWarningSoft, fontWeight: "700", fontSize: 14 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  infoLine: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.sm, alignItems: "flex-start" },
  infoLabel: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  infoValue: { fontSize: 15, color: colors.onSurface, marginTop: 2 },
  headerSubtitle: { marginTop: 4, fontSize: 14, color: colors.muted, fontWeight: "500" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  daysRow: { height: 56, justifyContent: "center" },
  dayChip: {
    width: DAY_CHIP_W,
    height: 36,
    marginRight: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  dayChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandSecondary },
  dayChipOff: { backgroundColor: colors.surfaceTertiary, borderColor: colors.surfaceTertiary },
  dayChipOffActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  dayChipTextOff: { color: colors.muted, textDecorationLine: "line-through" },
  subtitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dayOptionsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
  },
  dayOptionsText: { fontSize: 12, fontWeight: "700", color: colors.brandSecondary },
  cancelBanner: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceInverse,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 40,
  },
  cancelBannerText: { color: colors.onSurfaceInverse, fontWeight: "700", fontSize: 14 },
  dayOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    marginTop: spacing.sm,
  },
  dayOptionActive: { backgroundColor: colors.brandPrimary },
  dayOptionText: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.onSurface },
  dayChipText: { fontSize: 13, fontWeight: "600", color: colors.onSurfaceSecondary },
  dayChipTextActive: { color: colors.onBrandPrimary },
  emptyWrap: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: colors.onSurface },
  emptyText: { marginTop: 6, fontSize: 14, color: colors.muted, textAlign: "center" },

  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardLeft: { flex: 1, marginRight: spacing.md },
  studentName: { fontSize: 16, fontWeight: "700", color: colors.onSurfaceSecondary, flexShrink: 1 },
  badgesRow: { flexDirection: "row", marginTop: 6, gap: 6, flexWrap: "wrap" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badgeInfo: { backgroundColor: colors.brandTertiary },
  badgeDanger: { backgroundColor: "#FEE2E2" },
  badgeMoney: { backgroundColor: colors.surfaceTertiary },
  badgeText: { fontSize: 12, fontWeight: "600" },

  cardActions: { alignItems: "flex-end", gap: 6 },
  registerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: radius.md,
    minHeight: 44,
    maxWidth: 150,
    justifyContent: "center",
  },
  registerBtnPressed: { backgroundColor: colors.brandSecondary },
  registerBtnDisabled: { backgroundColor: colors.surfaceTertiary },
  registerBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 13, flexShrink: 1, textAlign: "center" },
  registerBtnTextOff: { color: colors.onSurfaceTertiary },
  smallActionsRow: { flexDirection: "row", gap: 2 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },

  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },

  toast: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.md,
    maxWidth: "90%",
  },
  toastText: { color: "#FFFFFF", fontWeight: "600", fontSize: 14 },

  // Modal
  modalWrap: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.md,
  },
  sheetTitle: { fontSize: 20, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: "600", color: colors.muted, marginTop: spacing.md, marginBottom: 6 },
  helper: { fontSize: 13, color: colors.muted, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.onSurface,
  },
  bonoRow: { flexDirection: "row", gap: spacing.sm, marginTop: 4 },
  bonoCard: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  bonoCardSelected: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandSecondary,
  },
  bonoAmount: { fontSize: 22, fontWeight: "800", color: colors.onSurface },
  bonoClasses: { fontSize: 13, fontWeight: "600", color: colors.muted, marginTop: 2 },

  errText: { color: colors.error, fontSize: 13, marginTop: spacing.sm, fontWeight: "500" },

  sheetActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
  },
  secondaryBtnText: { color: colors.onSurface, fontWeight: "600", fontSize: 15 },
  primaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
  },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 15 },
}));
