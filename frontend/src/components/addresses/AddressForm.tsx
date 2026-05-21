import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AddressProvider, UserAddress, UserAddressPayload } from "../../types";
import { AddressMapPicker } from "./AddressMapPicker";

type AddressFormProps = {
  initialAddress?: UserAddress | null;
  submitLabel?: string;
  isSubmitting?: boolean;
  error?: string | null;
  onSubmit: (payload: UserAddressPayload) => void;
  onCancel?: () => void;
};

type AddressFormState = {
  alias: string;
  receptor_nombre: string;
  receptor_telefono: string;
  direccion_formateada: string;
  calle: string;
  numero: string;
  piso_departamento: string;
  barrio: string;
  localidad: string;
  provincia: string;
  codigo_postal: string;
  pais: string;
  lat: number | null;
  lng: number | null;
  provider: AddressProvider;
  provider_place_id: string;
  provider_raw_json: unknown;
  instrucciones_entrega: string;
  es_predeterminada: boolean;
};

type GeoapifyReverseResult = {
  place_id?: string;
  formatted?: string;
  address_line1?: string;
  address_line2?: string;
  street?: string;
  housenumber?: string;
  suburb?: string;
  district?: string;
  neighbourhood?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  state?: string;
  postcode?: string;
  country?: string;
  lat?: number;
  lon?: number;
};

type ReverseStatus = "idle" | "loading" | "done" | "empty" | "error" | "missing-key";

const emptyState: AddressFormState = {
  alias: "",
  receptor_nombre: "",
  receptor_telefono: "",
  direccion_formateada: "",
  calle: "",
  numero: "",
  piso_departamento: "",
  barrio: "",
  localidad: "Corrientes",
  provincia: "Corrientes",
  codigo_postal: "",
  pais: "Argentina",
  lat: null,
  lng: null,
  provider: "manual",
  provider_place_id: "",
  provider_raw_json: null,
  instrucciones_entrega: "",
  es_predeterminada: false,
};

const GEOAPIFY_API_KEY = import.meta.env.VITE_GEOAPIFY_API_KEY?.trim() ?? "";

function text(value: string | null | undefined): string {
  return value ?? "";
}

function stateFromAddress(address?: UserAddress | null): AddressFormState {
  if (!address) return emptyState;
  return {
    alias: text(address.alias),
    receptor_nombre: text(address.receptor_nombre),
    receptor_telefono: text(address.receptor_telefono),
    direccion_formateada: address.direccion_formateada,
    calle: text(address.calle),
    numero: text(address.numero),
    piso_departamento: text(address.piso_departamento),
    barrio: text(address.barrio),
    localidad: text(address.localidad),
    provincia: text(address.provincia),
    codigo_postal: text(address.codigo_postal),
    pais: address.pais || "Argentina",
    lat: Number.isFinite(Number(address.lat)) ? Number(address.lat) : null,
    lng: Number.isFinite(Number(address.lng)) ? Number(address.lng) : null,
    provider: address.provider ?? "manual",
    provider_place_id: text(address.provider_place_id),
    provider_raw_json: address.provider_raw_json ?? null,
    instrucciones_entrega: text(address.instrucciones_entrega),
    es_predeterminada: Boolean(address.es_predeterminada),
  };
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function compactAddress(parts: Array<string | null | undefined>): string {
  return parts.map((part) => part?.trim()).filter(Boolean).join(", ");
}

function pickLocality(result: GeoapifyReverseResult): string {
  return result.city || result.town || result.village || result.municipality || "";
}

function pickNeighbourhood(result: GeoapifyReverseResult): string {
  return result.suburb || result.district || result.neighbourhood || "";
}

function buildFormattedAddress(result: GeoapifyReverseResult): string {
  return (
    result.formatted ||
    compactAddress([
      compactAddress([result.street, result.housenumber]),
      pickNeighbourhood(result),
      pickLocality(result),
      result.state,
      result.country,
    ])
  );
}

async function reverseGeocodeAddress(lat: number, lng: number, signal: AbortSignal): Promise<GeoapifyReverseResult | null> {
  if (!GEOAPIFY_API_KEY) return null;
  const url = new URL("https://api.geoapify.com/v1/geocode/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("lang", "es");
  url.searchParams.set("format", "json");
  url.searchParams.set("apiKey", GEOAPIFY_API_KEY);

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    throw new Error("Geoapify no pudo completar la direccion.");
  }
  const body = (await response.json()) as { results?: GeoapifyReverseResult[] };
  return body.results?.[0] ?? null;
}

export function AddressForm({
  initialAddress,
  submitLabel = "Guardar direccion",
  isSubmitting = false,
  error,
  onSubmit,
  onCancel,
}: AddressFormProps) {
  const [form, setForm] = useState<AddressFormState>(() => stateFromAddress(initialAddress));
  const [localError, setLocalError] = useState<string | null>(null);
  const [reverseStatus, setReverseStatus] = useState<ReverseStatus>("idle");
  const reverseAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setForm(stateFromAddress(initialAddress));
    setLocalError(null);
    setReverseStatus("idle");
  }, [initialAddress?.id]);

  useEffect(() => () => reverseAbortRef.current?.abort(), []);

  const location = useMemo(
    () => (form.lat !== null && form.lng !== null ? { lat: form.lat, lng: form.lng } : null),
    [form.lat, form.lng],
  );

  function setField<K extends keyof AddressFormState>(field: K, value: AddressFormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleMapChange(next: { lat: number; lng: number }) {
    reverseAbortRef.current?.abort();
    setLocalError(null);
    setForm((prev) => ({
      ...prev,
      lat: next.lat,
      lng: next.lng,
      provider: "manual",
      provider_place_id: "",
      provider_raw_json: null,
    }));

    if (!GEOAPIFY_API_KEY) {
      setReverseStatus("missing-key");
      return;
    }

    const controller = new AbortController();
    reverseAbortRef.current = controller;
    setReverseStatus("loading");
    try {
      const result = await reverseGeocodeAddress(next.lat, next.lng, controller.signal);
      if (controller.signal.aborted) return;
      if (!result) {
        setReverseStatus("empty");
        return;
      }

      setForm((prev) => ({
        ...prev,
        direccion_formateada: buildFormattedAddress(result) || prev.direccion_formateada,
        calle: result.street || prev.calle,
        numero: result.housenumber || prev.numero,
        barrio: pickNeighbourhood(result) || prev.barrio,
        localidad: pickLocality(result) || prev.localidad,
        provincia: result.state || prev.provincia,
        codigo_postal: result.postcode || prev.codigo_postal,
        pais: result.country || prev.pais,
        provider: "geoapify",
        provider_place_id: result.place_id || "",
        provider_raw_json: {
          place_id: result.place_id,
          formatted: result.formatted,
          address_line1: result.address_line1,
          address_line2: result.address_line2,
          street: result.street,
          housenumber: result.housenumber,
          suburb: result.suburb,
          district: result.district,
          neighbourhood: result.neighbourhood,
          city: result.city,
          town: result.town,
          village: result.village,
          municipality: result.municipality,
          state: result.state,
          postcode: result.postcode,
          country: result.country,
          lat: result.lat,
          lon: result.lon,
        },
      }));
      setReverseStatus("done");
    } catch {
      if (!controller.signal.aborted) {
        setReverseStatus("error");
      }
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const formattedAddress = form.direccion_formateada.trim();
    if (!formattedAddress) {
      setLocalError("Completa la direccion formateada.");
      return;
    }
    if (form.lat === null || form.lng === null) {
      setLocalError("Marca la ubicacion exacta en el mapa.");
      return;
    }
    setLocalError(null);
    onSubmit({
      alias: nullableText(form.alias),
      receptor_nombre: nullableText(form.receptor_nombre),
      receptor_telefono: nullableText(form.receptor_telefono),
      direccion_formateada: formattedAddress,
      calle: nullableText(form.calle),
      numero: nullableText(form.numero),
      piso_departamento: nullableText(form.piso_departamento),
      barrio: nullableText(form.barrio),
      localidad: nullableText(form.localidad),
      provincia: nullableText(form.provincia),
      codigo_postal: nullableText(form.codigo_postal),
      pais: nullableText(form.pais) ?? "Argentina",
      lat: form.lat,
      lng: form.lng,
      provider: form.provider,
      provider_place_id: nullableText(form.provider_place_id),
      provider_raw_json: form.provider_raw_json,
      instrucciones_entrega: nullableText(form.instrucciones_entrega),
      es_predeterminada: form.es_predeterminada,
    });
  }

  return (
    <form className="address-form" onSubmit={submit}>
      <div className="address-map-block address-map-block-first">
        <div className="address-map-heading">
          <p className="address-section-title">Ubicacion exacta</p>
          <p>Hace click en el mapa donde esta tu domicilio. Podes mover el pin para ajustar la ubicacion.</p>
        </div>
        <AddressMapPicker
          value={location}
          disabled={isSubmitting}
          onChange={handleMapChange}
        />
        {reverseStatus === "loading" ? <p className="address-map-helper">Completando direccion desde el mapa...</p> : null}
        {reverseStatus === "done" ? <p className="address-map-helper success">Direccion detectada. Revisala abajo antes de guardar.</p> : null}
        {reverseStatus === "empty" ? <p className="address-map-helper">No encontramos datos suficientes para esa ubicacion. Completa la direccion manualmente.</p> : null}
        {reverseStatus === "error" ? <p className="address-map-helper warning">No se pudo autocompletar. Completa la direccion manualmente.</p> : null}
        {reverseStatus === "missing-key" ? <p className="address-map-helper warning">Falta VITE_GEOAPIFY_API_KEY para autocompletar desde el mapa.</p> : null}
      </div>

      <div className="address-form-grid">
        <label className="address-field">
          <span>Alias</span>
          <input
            className="ios-input"
            value={form.alias}
            onChange={(event) => setField("alias", event.target.value)}
            placeholder="Casa, trabajo"
            disabled={isSubmitting}
          />
        </label>

        <label className="address-field">
          <span>Nombre de quien recibe</span>
          <input
            className="ios-input"
            value={form.receptor_nombre}
            onChange={(event) => setField("receptor_nombre", event.target.value)}
            disabled={isSubmitting}
          />
        </label>

        <label className="address-field">
          <span>Telefono</span>
          <input
            className="ios-input"
            value={form.receptor_telefono}
            onChange={(event) => setField("receptor_telefono", event.target.value)}
            inputMode="tel"
            disabled={isSubmitting}
          />
        </label>

        <label className="address-field address-field-wide">
          <span>Direccion formateada</span>
          <input
            className="ios-input"
            value={form.direccion_formateada}
            onChange={(event) => setField("direccion_formateada", event.target.value)}
            placeholder="Calle, numero, localidad"
            disabled={isSubmitting}
            aria-required="true"
          />
        </label>

        <label className="address-field">
          <span>Calle</span>
          <input className="ios-input" value={form.calle} onChange={(event) => setField("calle", event.target.value)} disabled={isSubmitting} />
        </label>

        <label className="address-field">
          <span>Numero</span>
          <input className="ios-input" value={form.numero} onChange={(event) => setField("numero", event.target.value)} disabled={isSubmitting} />
        </label>

        <label className="address-field">
          <span>Piso/departamento</span>
          <input
            className="ios-input"
            value={form.piso_departamento}
            onChange={(event) => setField("piso_departamento", event.target.value)}
            disabled={isSubmitting}
          />
        </label>

        <label className="address-field">
          <span>Barrio</span>
          <input className="ios-input" value={form.barrio} onChange={(event) => setField("barrio", event.target.value)} disabled={isSubmitting} />
        </label>

        <label className="address-field">
          <span>Localidad</span>
          <input className="ios-input" value={form.localidad} onChange={(event) => setField("localidad", event.target.value)} disabled={isSubmitting} />
        </label>

        <label className="address-field">
          <span>Provincia</span>
          <input className="ios-input" value={form.provincia} onChange={(event) => setField("provincia", event.target.value)} disabled={isSubmitting} />
        </label>

        <label className="address-field">
          <span>Codigo postal</span>
          <input
            className="ios-input"
            value={form.codigo_postal}
            onChange={(event) => setField("codigo_postal", event.target.value)}
            disabled={isSubmitting}
          />
        </label>

        <label className="address-field">
          <span>Pais</span>
          <input className="ios-input" value={form.pais} onChange={(event) => setField("pais", event.target.value)} disabled={isSubmitting} />
        </label>

        <label className="address-field address-field-wide">
          <span>Instrucciones de entrega</span>
          <textarea
            className="ios-input address-textarea"
            value={form.instrucciones_entrega}
            onChange={(event) => setField("instrucciones_entrega", event.target.value)}
            disabled={isSubmitting}
          />
        </label>
      </div>

      <label className="address-default-check">
        <input
          type="checkbox"
          checked={form.es_predeterminada}
          onChange={(event) => setField("es_predeterminada", event.target.checked)}
          disabled={isSubmitting}
        />
        <span>Usar como direccion predeterminada</span>
      </label>

      {localError || error ? <p className="address-error">{localError || error}</p> : null}

      <div className="address-actions">
        {onCancel ? (
          <button type="button" className="catalog-float-toast-btn-secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancelar
          </button>
        ) : null}
        <button type="submit" className="catalog-float-toast-btn-primary" disabled={isSubmitting}>
          {isSubmitting ? "Guardando..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
