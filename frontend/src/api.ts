import { Platform } from "react-native";
import { router } from "expo-router";

import { clearToken, getToken, setToken } from "@/src/auth";
import { queryClient } from "@/src/query-client";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export const API_BASE = `${BASE}/api`;

export type Registration = {
  id: string;
  name: string;
  phone: string;
  email: string;
  health_notes: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

async function errorDetail(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail)) return "Revisa los datos: email o teléfono no válidos";
  } catch {}
  return `Error ${res.status}`;
}

// Login y alta pública: no usan token ni redirigen en 401.
export async function adminLogin(pin: string): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) throw new Error(await errorDetail(res));
  const data = await res.json();
  await setToken(data.access_token);
}

export async function submitRegistration(input: {
  name: string;
  phone: string;
  email: string;
  health_notes: string;
}): Promise<void> {
  const res = await fetch(`${API_BASE}/registrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorDetail(res));
}

export async function logout(): Promise<void> {
  await clearToken();
  queryClient.clear();
}

export type DayStatus = "festivo" | "suspendida";

export type BonoPurchase = {
  id: string;
  student_id: string;
  student_name: string;
  bono_type: 5 | 10;
  amount: number;
  status: "active" | "cancelled";
  created_at: string;
};

// ---- Zona alumno (pública, con código personal) ----
export type StudentMe = {
  id: string;
  name: string;
  classes_remaining: number;
  money_remaining: number;
  attended_dates: string[];
  available_days: string[];
};

async function publicPost<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorDetail(res));
  return (await res.json()) as T;
}

export const studentApi = {
  search: async (q: string): Promise<{ id: string; name: string }[]> => {
    const res = await fetch(`${API_BASE}/public/students?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(await errorDetail(res));
    return res.json();
  },
  me: (student_id: string, code: string) => publicPost<StudentMe>("/public/me", { student_id, code }),
  register: (student_id: string, code: string, class_date: string) =>
    publicPost<{ class_date: string; classes_remaining: number; money_remaining: number }>("/public/attendance", {
      student_id,
      code,
      class_date,
    }),
};

export type Student = {
  id: string;
  name: string;
  bono_type: 5 | 10 | null;
  classes_remaining: number;
  money_remaining: number;
  phone?: string;
  email?: string;
  health_notes?: string;
  code?: string;
  created_at: string;
};

export type Attendance = {
  id: string;
  student_id: string;
  student_name: string;
  class_date: string;
  source?: "monitor" | "alumno";
  created_at: string;
};

export type MonthlySummaryItem = {
  student_id: string;
  student_name: string;
  classes_attended: number;
  student_paid: number;
  subsidy_paid: number;
  total_cost: number;
};

export type MonthlySummary = {
  year: number;
  month: number;
  total_classes: number;
  total_student_paid: number;
  total_subsidy_paid: number;
  total_cost: number;
  items: MonthlySummaryItem[];
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    await clearToken();
    queryClient.clear();
    router.replace("/bienvenida");
  }
  if (!res.ok) {
    throw new Error(await errorDetail(res));
  }
  return (await res.json()) as T;
}

export const api = {
  listStudents: () => request<Student[]>("/students"),
  createStudent: (name: string, bono_type: 5 | 10) =>
    request<Student>("/students", { method: "POST", body: JSON.stringify({ name, bono_type }) }),
  deleteStudent: (id: string) => request<{ ok: boolean }>(`/students/${id}`, { method: "DELETE" }),
  renewBono: (id: string, bono_type: 5 | 10) =>
    request<Student>(`/students/${id}/renew`, { method: "POST", body: JSON.stringify({ bono_type }) }),

  registerAttendance: (student_id: string, class_date?: string) =>
    request<Attendance>("/attendance", { method: "POST", body: JSON.stringify({ student_id, class_date }) }),
  deleteAttendance: (id: string) => request<{ ok: boolean }>(`/attendance/${id}`, { method: "DELETE" }),
  listAttendance: () => request<Attendance[]>("/attendance"),

  monthlySummary: (year: number, month: number) =>
    request<MonthlySummary>(`/summary/monthly?year=${year}&month=${month}`),

  classDays: () => request<{ days: string[]; count: number; cancelled: Record<string, DayStatus> }>("/class-days"),
  setDayStatus: (day: string, status: DayStatus | "normal") =>
    request<{ date: string; status: string }>(`/class-days/${day}`, { method: "PUT", body: JSON.stringify({ status }) }),

  listRegistrations: () => request<Registration[]>("/registrations"),
  listBonos: () => request<BonoPurchase[]>("/bonos"),
  updateBono: (id: string, student_id: string, bono_type: 5 | 10) =>
    request<BonoPurchase>(`/bonos/${id}`, { method: "PUT", body: JSON.stringify({ student_id, bono_type }) }),
  cancelBono: (id: string) => request<{ ok: boolean }>(`/bonos/${id}/cancel`, { method: "POST" }),
  approveRegistration: (id: string, bono_type: 5 | 10) =>
    request<Student>(`/registrations/${id}/approve`, { method: "POST", body: JSON.stringify({ bono_type }) }),
  rejectRegistration: (id: string) => request<{ ok: boolean }>(`/registrations/${id}/reject`, { method: "POST" }),
};

export const isWeb = Platform.OS === "web";
