import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api";

type EventBarResponse = {
  active: boolean;
  titulo?: string;
  subtitulo?: string;
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
  const location = useLocation();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isCollapsedOnScroll, setIsCollapsedOnScroll] = useState(false);
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

  const eventbarIsActive = Boolean(eventbarQuery.data?.active && targetMs && targetMs > nowMs);
  const collapsesOnScroll =
    location.pathname === "/catalogo" ||
    location.pathname.startsWith("/catalogo/") ||
    location.pathname === "/tienda" ||
    location.pathname.startsWith("/tienda/");
  const visible = eventbarIsActive && !isCollapsedOnScroll;
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

  useEffect(() => {
    if (!collapsesOnScroll || !eventbarIsActive) {
      setIsCollapsedOnScroll(false);
      return;
    }

    let lastScrollY = window.scrollY;
    let ticking = false;
    let frameId: number | null = null;

    function syncCollapsedState() {
      const currentScrollY = window.scrollY;
      const isScrollingDown = currentScrollY > lastScrollY + 6;
      const isScrollingUp = currentScrollY < lastScrollY - 10;

      if (currentScrollY <= 12) {
        setIsCollapsedOnScroll(false);
      } else if (isScrollingDown && currentScrollY > 32) {
        setIsCollapsedOnScroll(true);
      } else if (isScrollingUp) {
        setIsCollapsedOnScroll(false);
      }

      lastScrollY = currentScrollY;
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
  }, [collapsesOnScroll, eventbarIsActive, location.pathname]);

  if (!visible || !countdown || !eventbarQuery.data) return null;

  const style = {
    "--eventbar-bg": eventbarQuery.data.color_fondo || "#2D1A0D",
    "--eventbar-fg": eventbarQuery.data.color_texto || "#F3C47B",
  } as CSSProperties & Record<"--eventbar-bg" | "--eventbar-fg", string>;

  return (
    <div className="eventbar" style={style} role="status" aria-live="polite">
      <div className="eventbar-inner">
        <div className="eventbar-copy">
          <p className="eventbar-title">{eventbarQuery.data.titulo}</p>
          {eventbarQuery.data.subtitulo ? (
            <p className="eventbar-subtitle">{eventbarQuery.data.subtitulo}</p>
          ) : null}
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
      </div>
    </div>
  );
}
