import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api";

type EventBarResponse = {
  active: boolean;
  titulo?: string;
  subtitulo?: string;
  fecha_fin?: string;
  color_fondo?: string;
  color_texto?: string;
  descuento_especial_activo?: boolean;
  descuento_especial_tipo?: "2x1" | "3x2" | "4x3" | null;
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

function promoText(type: EventBarResponse["descuento_especial_tipo"]): string {
  if (type === "2x1" || type === "3x2" || type === "4x3") {
    return `${type.toUpperCase()} en productos seleccionados`;
  }
  return "Promos especiales en tienda online";
}

export function EventBar() {
  const location = useLocation();
  const isStoreEventbarPath = location.pathname === "/tienda";
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isCollapsedOnScroll, setIsCollapsedOnScroll] = useState(false);
  const eventbarQuery = useQuery({
    queryKey: ["layout", "eventbar"],
    queryFn: () => api.get<EventBarResponse>("/layout/eventbar"),
    enabled: isStoreEventbarPath,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  const targetMs = useMemo(() => {
    if (!isValidTargetDate(eventbarQuery.data?.fecha_fin)) return null;
    return new Date(eventbarQuery.data.fecha_fin).getTime();
  }, [eventbarQuery.data?.fecha_fin]);

  const eventbarIsActive = Boolean(eventbarQuery.data?.active && targetMs && targetMs > nowMs);
  const visible = isStoreEventbarPath && eventbarIsActive && !isCollapsedOnScroll;
  const countdown = targetMs ? formatCountdown(targetMs, nowMs) : null;

  useEffect(() => {
    if (!isStoreEventbarPath || !eventbarQuery.data?.active) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [eventbarQuery.data?.active, eventbarQuery.data?.fecha_fin, isStoreEventbarPath]);

  useEffect(() => {
    document.documentElement.classList.toggle("eventbar-visible", visible);
    return () => document.documentElement.classList.remove("eventbar-visible");
  }, [visible]);

  useEffect(() => {
    if (!isStoreEventbarPath || !eventbarIsActive) {
      setIsCollapsedOnScroll(false);
      return;
    }

    let ticking = false;
    let frameId: number | null = null;

    function syncCollapsedState() {
      const currentScrollY = window.scrollY;
      setIsCollapsedOnScroll(currentScrollY > 10);
      ticking = false;
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      frameId = window.requestAnimationFrame(syncCollapsedState);
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [eventbarIsActive, isStoreEventbarPath, location.pathname]);

  if (!visible || !countdown || !eventbarQuery.data) return null;

  const style = {
    "--eventbar-bg": eventbarQuery.data.color_fondo || "#2D1A0D",
    "--eventbar-fg": eventbarQuery.data.color_texto || "#F3C47B",
  } as CSSProperties & Record<"--eventbar-bg" | "--eventbar-fg", string>;
  const discountText = promoText(eventbarQuery.data.descuento_especial_tipo);

  return (
    <div className="eventbar" style={style} role="status" aria-live="polite">
      <span className="eventbar-ornament eventbar-ornament-left" aria-hidden="true" />
      <span className="eventbar-ornament eventbar-ornament-right" aria-hidden="true" />
      <div className="eventbar-inner">
        <div className="eventbar-copy" aria-label={`${eventbarQuery.data.titulo || ""} ${eventbarQuery.data.subtitulo || ""}`.trim()}>
          <span className="eventbar-main-icon" aria-hidden="true">
            <svg viewBox="0 0 28 28" focusable="false">
              <path d="M5.5 14.4 14.4 5.5h6.2v6.2l-8.9 8.9a2.2 2.2 0 0 1-3.1 0l-3.1-3.1a2.2 2.2 0 0 1 0-3.1Z" />
              <circle cx="18.2" cy="9.8" r="1.55" />
              <path d="m9.4 15.2 3.4 3.4" />
            </svg>
          </span>
          <span className="eventbar-copy-text">
            <p className="eventbar-title">{eventbarQuery.data.titulo}</p>
            {eventbarQuery.data.subtitulo ? (
              <p className="eventbar-subtitle">{eventbarQuery.data.subtitulo}</p>
            ) : null}
          </span>
        </div>
        <span className="eventbar-divider" aria-hidden="true" />
        <div className="eventbar-promo">
          <span className="eventbar-promo-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M7.2 8.8h9.6l-.8 10H8l-.8-10Z" />
              <path d="M9.2 8.8a2.8 2.8 0 0 1 5.6 0" />
            </svg>
          </span>
          <span>{discountText}</span>
        </div>
        <div className="eventbar-countdown" aria-label={countdown.ariaLabel}>
          <span className="eventbar-time-card">
            <strong>{countdown.days}</strong>
            <small>DIAS</small>
          </span>
          <span className="eventbar-count-separator" aria-hidden="true">:</span>
          <span className="eventbar-time-card">
            <strong>{countdown.hours}</strong>
            <small>HRS</small>
          </span>
          <span className="eventbar-count-separator" aria-hidden="true">:</span>
          <span className="eventbar-time-card">
            <strong>{countdown.minutes}</strong>
            <small>MIN</small>
          </span>
        </div>
        <Link className="eventbar-cta" to="/tienda">
          Ver promos
          <span aria-hidden="true">&gt;</span>
        </Link>
      </div>
    </div>
  );
}
