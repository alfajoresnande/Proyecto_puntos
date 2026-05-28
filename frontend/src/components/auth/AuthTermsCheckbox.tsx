import { Link } from "react-router-dom";

type AuthTermsCheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

export function AuthTermsCheckbox({ checked, onChange, disabled = false }: AuthTermsCheckboxProps) {
  return (
    <label className="login-remember login-terms-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span>
        Acepto los{" "}
        <Link
          to="/terminos"
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          Terminos y Condiciones
        </Link>
        .
      </span>
    </label>
  );
}
