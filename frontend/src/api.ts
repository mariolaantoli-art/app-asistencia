import { Platform } from "react-native";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export const API_BASE = `${BASE}/api`;

export type Student = {
  id: string;
  name: string;
  bono_type: 5 | 10;
  classes_remaining: number;
  money_remaining: number;
  created_at: string;
};

export type Attendance = {
  id: string;
  student_id: string;
  student_name: string;
  class_date: string;
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
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.detail) msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {}
    throw new Error(msg);
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

  classDays: () => request<{ days: string[]; count: number }>("/class-days"),
};

export const isWeb = Platform.OS === "web";
