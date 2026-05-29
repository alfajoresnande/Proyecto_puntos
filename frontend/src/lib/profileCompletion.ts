import type { User } from "../types";

export type ProfileCompletionUser = Pick<
  User,
  "nombre" | "email" | "dni" | "telefono" | "fecha_nacimiento" | "localidad" | "provincia"
>;

type ProfileField = {
  key: keyof ProfileCompletionUser;
  label: string;
  isComplete: (user: Partial<ProfileCompletionUser>) => boolean;
};

function cleanDigits(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

function hasText(value: string | null | undefined, minLength = 1): boolean {
  return String(value ?? "").trim().length >= minLength;
}

export const PROFILE_COMPLETION_FIELDS: ProfileField[] = [
  { key: "nombre", label: "Nombre", isComplete: (user) => hasText(user.nombre) },
  { key: "email", label: "Email", isComplete: (user) => String(user.email ?? "").includes("@") },
  { key: "dni", label: "DNI", isComplete: (user) => cleanDigits(user.dni).length >= 6 },
  { key: "fecha_nacimiento", label: "Fecha de nacimiento", isComplete: (user) => hasText(user.fecha_nacimiento) },
  { key: "provincia", label: "Provincia", isComplete: (user) => hasText(user.provincia, 2) },
  { key: "localidad", label: "Localidad", isComplete: (user) => hasText(user.localidad, 2) },
  { key: "telefono", label: "Telefono", isComplete: (user) => cleanDigits(user.telefono).length >= 6 },
];

export function getProfileCompletion(user: Partial<ProfileCompletionUser> | null | undefined) {
  const safeUser = user ?? {};
  const missing = PROFILE_COMPLETION_FIELDS.filter((field) => !field.isComplete(safeUser));
  const total = PROFILE_COMPLETION_FIELDS.length;
  const completed = total - missing.length;
  const completedPercent = total > 0 ? Math.round((completed / total) * 100) : 100;
  const missingPercent = 100 - completedPercent;

  return {
    total,
    completed,
    missing,
    completedPercent,
    missingPercent,
    isComplete: missing.length === 0,
  };
}
