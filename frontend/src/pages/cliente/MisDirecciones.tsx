import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { AddressForm } from "../../components/addresses/AddressForm";
import type { UserAddress, UserAddressPayload } from "../../types";

type FormMode = "none" | "create" | "edit";

function addressTitle(address: UserAddress): string {
  return address.alias || address.direccion_formateada;
}

function addressDetails(address: UserAddress): string {
  return [
    address.calle && address.numero ? `${address.calle} ${address.numero}` : null,
    address.piso_departamento,
    address.barrio,
    address.localidad,
    address.provincia,
    address.codigo_postal,
  ]
    .filter(Boolean)
    .join(", ");
}

export function MisDirecciones() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<FormMode>("none");
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    document.body.classList.add("catalogo-background");
    return () => {
      document.body.classList.remove("catalogo-background");
    };
  }, []);

  const addressesQuery = useQuery({
    queryKey: ["me", "addresses"],
    queryFn: () => api.get<UserAddress[]>("/me/addresses"),
  });

  const addresses = addressesQuery.data ?? [];
  const editingAddress = useMemo(
    () => addresses.find((address) => Number(address.id) === Number(editingId)) ?? null,
    [addresses, editingId],
  );

  useEffect(() => {
    if (addressesQuery.data && addresses.length === 0) setMode("create");
  }, [addresses.length, addressesQuery.data]);

  const createMutation = useMutation({
    mutationFn: (payload: UserAddressPayload) => api.post<UserAddress>("/me/addresses", payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me", "addresses"] });
      setMode("none");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UserAddressPayload }) =>
      api.put<UserAddress>(`/me/addresses/${id}`, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me", "addresses"] });
      setMode("none");
      setEditingId(null);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/me/addresses/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me", "addresses"] });
      setEditingId(null);
      setMode("none");
    },
  });

  const defaultMutation = useMutation({
    mutationFn: (id: number) => api.post<UserAddress>(`/me/addresses/${id}/default`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me", "addresses"] }),
  });

  const formError =
    createMutation.error instanceof Error
      ? createMutation.error.message
      : updateMutation.error instanceof Error
        ? updateMutation.error.message
        : null;

  return (
    <section className="catalog-page catalog-canje-page address-page">
      <div className="catalog-products-shell">
        <div className="catalog-header">
          <h1 className="catalog-title">Mis direcciones</h1>
          <p className="catalog-subtitle">Administra tus direcciones de envio</p>
        </div>

        {addressesQuery.isLoading ? <div className="catalog-skeleton store-skeleton" /> : null}
        {addressesQuery.error instanceof Error ? <p className="address-error">{addressesQuery.error.message}</p> : null}

        {!addressesQuery.isLoading && addresses.length > 0 ? (
          <div className="address-page-actions">
            <button
              type="button"
              className="catalog-float-toast-btn-primary"
              onClick={() => {
                setEditingId(null);
                setMode("create");
              }}
            >
              Nueva direccion
            </button>
          </div>
        ) : null}

        {addresses.length > 0 ? (
          <div className="address-card-list">
            {addresses.map((address) => (
              <article key={address.id} className="address-card">
                <div className="address-card-main">
                  <div>
                    <p className="address-card-title">
                      {addressTitle(address)}
                      {address.es_predeterminada ? <span>Predeterminada</span> : null}
                    </p>
                    <p className="address-card-address">{address.direccion_formateada}</p>
                    {addressDetails(address) ? <p className="address-card-muted">{addressDetails(address)}</p> : null}
                    <p className="address-card-muted">
                      {address.lat.toFixed(6)}, {address.lng.toFixed(6)}
                    </p>
                  </div>
                </div>
                <div className="address-card-actions">
                  {!address.es_predeterminada ? (
                    <button
                      type="button"
                      className="catalog-float-toast-btn-secondary"
                      disabled={defaultMutation.isPending}
                      onClick={() => defaultMutation.mutate(address.id)}
                    >
                      Predeterminar
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="catalog-float-toast-btn-secondary"
                    onClick={() => {
                      setEditingId(address.id);
                      setMode("edit");
                    }}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="adm-btn-danger"
                    disabled={deactivateMutation.isPending}
                    onClick={() => {
                      if (window.confirm("Desactivar esta direccion?")) {
                        deactivateMutation.mutate(address.id);
                      }
                    }}
                  >
                    Desactivar
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {mode === "create" ? (
          <div className="address-form-panel">
            <h2>Nueva direccion</h2>
            <AddressForm
              submitLabel="Guardar direccion"
              isSubmitting={createMutation.isPending}
              error={formError}
              onCancel={addresses.length ? () => setMode("none") : undefined}
              onSubmit={(payload) => createMutation.mutate(payload)}
            />
          </div>
        ) : null}

        {mode === "edit" && editingAddress ? (
          <div className="address-form-panel">
            <h2>Editar direccion</h2>
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

        {deactivateMutation.error instanceof Error ? <p className="address-error">{deactivateMutation.error.message}</p> : null}
        {defaultMutation.error instanceof Error ? <p className="address-error">{defaultMutation.error.message}</p> : null}
      </div>
    </section>
  );
}
