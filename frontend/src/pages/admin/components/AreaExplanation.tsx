import { useState } from "react";

type AreaExplanationProps = {
  items: string[];
  defaultOpen?: boolean;
};

export function AreaExplanation({ items, defaultOpen = true }: AreaExplanationProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (!items.length) return null;

  return (
    <div className="admin-card admin-card-padded adm-area-explanation">
      <div className="adm-area-explanation-head">
        <h3 className="adm-area-explanation-title">Explicacion del area</h3>
        <button type="button" className="adm-btn-link" onClick={() => setOpen((prev) => !prev)}>
          {open ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      {open ? (
        <div className="adm-area-explanation-body">
          {items.map((item) => (
            <p key={item} className="adm-inline-tip">{item}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
