import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type { UserAddress, UserAddressPayload } from "../../types";
import { AddressForm } from "./AddressForm";

type AddressSelectorProps = {
  selectedId: number | null;
  onChange: (addressId: number | null, address?: UserAddress | null) => void;
  disabled?: boolean;
};

type FormMode = "none" | "create" | "edit";

function addressTitle(address: UserAddress): string {
  return address.alias || address.direccion_formateada;
}

function addressSubtitle(address: UserAddress): string {
  return [address.calle && address.numero ? `${address.calle} ${address.numero}` : null, address.localidad, address.provincia]
    .filter(Boolean)
    .join(", ");
}

export function AddressSelector({ selectedId, onChange, disabled = false }: AddressSelectorProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<FormMode>("none");
  const [editingId, setEditingId] = useState<number | null>(null);

  const addressesQuery = useQuery({
    queryKey: ["me", "addresses"],
    queryFn: () => api.get<UserAddress[]>("/me/addresses"),
    staleTime: 30000,
  });

  const addresses = addressesQuery.data ?? [];
  const selectedAddress = useMemo(
    () => addresses.find((address) => Number(address.id) === Number(selectedId)) ?? null,
    [addresses, selectedId],
  );
  const editingAddress = useMemo(
    () => addresses.find((address) => Number(address.id) === Number(editingId)) ?? null,
    [addresses, editingId],
  );

  useEffect(() => {
    if (!addressesQuery.data) return;
    if (!addresses.length) {
      if (selectedId !== null) onChange(null, null);
      setMode("create");
      return;
    }
    const current = addresses.find((address) => Number(address.id) === Number(selectedId));
    if (current) {
      onChange(current.id, current);
      return;
    }
    const fallback = addresses.find((address) => address.es_predeterminada) ?? addresses[0];
    onChange(fallback.id, fallback);
  }, [addresses, addressesQuery.data, onChange, selectedId]);

  const createMutation = useMutation({
    mutationFn: (payload: UserAddressPayload) => api.post<UserAddress>("/me/addresses", payload),
    onSuccess: async (address) => {
      await queryClient.invalidateQueries({ queryKey: ["me", "addresses"] });
      onChange(address.id, address);
      setMode("none");
      setEditingId(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UserAddressPayload }) =>
      api.put<UserAddress>(`/me/addresses/${id}`, payload),
    onSuccess: async (address) => {
      await queryClient.invalidateQueries({ queryKey: ["me", "addresses"] });
      onChange(address.id, address);
      setMode("none");
      setEditingId(null);
    },
  });

  const formError =
    createMutation.error instanceof Error
      ? createMutation.error.message
      : updateMutation.error instanceof Error
        ? updateMutation.error.message
        : null;

  return (
    <div className="address-selector">
      {addressesQuery.isLoading ? <p className="catalog-confirm-hint">Cargando direcciones...</p> : null}
      {addressesQuery.error instanceof Error ? (
        <p className="address-error">{addressesQuery.error.message}</p>
      ) : null}

      {addresses.length ? (
        <div className="address-selector-list">
          {addresses.map((address) => (
            <label key={address.id} className={`address-selector-card${selectedId === address.id ? " is-selected" : ""}`}>
              <input
                type="radio"
                name="checkout-address"
                checked={selectedId === address.id}
                disabled={disabled}
                onChange={() => onChange(address.id, address)}
              />
              <span className="address-selector-copy">
                <span className="address-selector-title">
                  {addressTitle(address)}
                  {address.es_predeterminada ? <strong>Predeterminada</strong> : null}
                </span>
                <span>{address.direccion_formateada}</span>
                {addressSubtitle(address) ? <small>{addressSubtitle(address)}</small> : null}
              </span>
              <button
                type="button"
                className="address-inline-btn"
                disabled={disabled}
                onClick={(event) => {
                  event.preventDefault();
                  setEditingId(address.id);
                  setMode("edit");
                }}
              >
                Editar
              </button>
            </label>
          ))}
        </div>
      ) : !addressesQuery.isLoading && mode !== "create" ? (
        <div className="address-empty">
          <p>No tenes direcciones guardadas.</p>
        </div>
      ) : null}

      {mode === "none" && addresses.length ? (
        <button
          type="button"
          className="catalog-float-toast-btn-secondary address-add-btn"
          disabled={disabled}
          onClick={() => {
            setEditingId(null);
            setMode("create");
          }}
        >
          Nueva direccion
        </button>
      ) : null}

      {mode === "create" ? (
        <div className="address-selector-form">
          <h3>Nueva direccion</h3>
          <AddressForm
            submitLabel="Guardar y usar"
            isSubmitting={createMutation.isPending}
            error={formError}
            onCancel={addresses.length ? () => setMode("none") : undefined}
            onSubmit={(payload) => createMutation.mutate(payload)}
          />
        </div>
      ) : null}

      {mode === "edit" && editingAddress ? (
        <div className="address-selector-form">
          <h3>Editar direccion</h3>
          <AddressForm
            initialAddress={editingAddress}
            submitLabel="Guardar cambios"
            isSubmitting={updateMutation.isPending}
            error={formError}
            onCancel={() => {
              setMode("none");
              setEditingId(null);
            }}
            onSubmit={(payload) => updateMutation.mutate({ id: editingAddress.id, payload })}
          />
        </div>
      ) : null}

      {selectedAddress ? (
        <p className="catalog-confirm-hint">
          Ubicacion seleccionada: {selectedAddress.lat.toFixed(6)}, {selectedAddress.lng.toFixed(6)}
        </p>
      ) : null}
    </div>
  );
}
