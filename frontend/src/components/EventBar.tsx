import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "../api";

type EventBarResponse = {
  active: boolean;
  titulo?: string;
  fecha_fin?: string;
  color_fondo?: string;
  color_texto?: string;
};

type CountdownParts = {
  days: string;
  hours: string;
  minutes: string;
  ariaLabel: string;
};

function formatCountdown(targetMs: number, nowMs: number): CountdownParts {
  const remainingMs = Math.max(0, targetMs - nowMs);
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  return {
    days: String(days).padStart(2, "0"),
    hours: String(hours).padStart(2, "0"),
    minutes: String(minutes).padStart(2, "0"),
    ariaLabel: `${days} dias, ${hours} horas y ${minutes} minutos restantes`,
  };
}

function isValidTargetDate(value: string | undefined): value is string {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp);
}

export function EventBar() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const eventbarQuery = useQuery({
    queryKey: ["layout", "eventbar"],
    queryFn: () => api.get<EventBarResponse>("/layout/eventbar"),
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  const targetMs = useMemo(() => {
    if (!isValidTargetDate(eventbarQuery.data?.fecha_fin)) return null;
    return new Date(eventbarQuery.data.fecha_fin).getTime();
  }, [eventbarQuery.data?.fecha_fin]);

  const visible = Boolean(eventbarQuery.data?.active && targetMs && targetMs > nowMs);
  const countdown = targetMs ? formatCountdown(targetMs, nowMs) : null;

  useEffect(() => {
    if (!eventbarQuery.data?.active) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [eventbarQuery.data?.active, eventbarQuery.data?.fecha_fin]);

  useEffect(() => {
    document.documentElement.classList.toggle("eventbar-visible", visible);
    return () => document.documentElement.classList.remove("eventbar-visible");
  }, [visible]);

  if (!visible || !countdown || !eventbarQuery.data) return null;

  const style = {
    "--eventbar-bg": eventbarQuery.data.color_fondo || "#6B3E26",
    "--eventbar-fg": eventbarQuery.data.color_texto || "#FFFFFF",
  } as CSSProperties & Record<"--eventbar-bg" | "--eventbar-fg", string>;

  return (
    <div className="eventbar" style={style} role="status" aria-live="polite">
      <div className="eventbar-inner">
        <p className="eventbar-title">{eventbarQuery.data.titulo}</p>
        <div className="eventbar-countdown" aria-label={countdown.ariaLabel}>
          <span className="eventbar-count-main">
            {countdown.days}/{countdown.hours}/{countdown.minutes}
          </span>
          <span className="eventbar-count-label">DD/HH/MM</span>
        </div>
      </div>
    </div>
  );
}
