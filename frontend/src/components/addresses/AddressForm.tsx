import { FormEvent, useEffect, useMemo, useState } from "react";
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

  useEffect(() => {
    setForm(stateFromAddress(initialAddress));
    setLocalError(null);
  }, [initialAddress?.id]);

  const location = useMemo(
    () => (form.lat !== null && form.lng !== null ? { lat: form.lat, lng: form.lng } : null),
    [form.lat, form.lng],
  );

  function setField<K extends keyof AddressFormState>(field: K, value: AddressFormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
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
            required
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

      <div className="address-map-block">
        <p className="address-section-title">Ubicacion exacta</p>
        <AddressMapPicker
          value={location}
          disabled={isSubmitting}
          onChange={(next) =>
            setForm((prev) => ({
              ...prev,
              lat: next.lat,
              lng: next.lng,
              provider: "manual",
              provider_place_id: "",
              provider_raw_json: null,
            }))
          }
        />
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
