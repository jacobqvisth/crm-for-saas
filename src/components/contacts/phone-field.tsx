"use client";

import { useState } from "react";
import PhoneInput, {
  formatPhoneNumberIntl,
  parsePhoneNumber,
  type Country,
} from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import "react-phone-number-input/style.css";
import { normalizePhone } from "@/lib/calls/phone";

// Phone field with a country flag + dial-code picker (à la the +44 🇬🇧 control).
// Stores the number in full international E.164 form so the dialer is never
// ambiguous. Auto-selects the country from: the number's own +code if present,
// else the contact's country, else Sweden. The flag is always shown — including
// in read-only display — so you can see which country you're calling at a glance.

const FALLBACK_COUNTRY: Country = "SE";

/** Detect the country for a stored phone value, falling back to a hint. */
export function countryFromPhone(
  value: string | null | undefined,
  fallback?: string | null,
): Country {
  if (value) {
    try {
      const c = parsePhoneNumber(value)?.country;
      if (c) return c;
    } catch {
      /* not parseable — fall through */
    }
  }
  return (fallback?.trim().toUpperCase() as Country) || FALLBACK_COUNTRY;
}

export function CountryFlag({ country, title }: { country: Country; title?: string }) {
  const F = flags[country];
  return (
    <span className="inline-flex h-[0.9rem] w-5 shrink-0 overflow-hidden rounded-[2px] align-middle">
      {F ? <F title={title ?? country} /> : null}
    </span>
  );
}

/** Read-only flag + internationally-formatted number. */
export function PhoneDisplay({
  value,
  defaultCountry,
  className,
}: {
  value: string | null | undefined;
  defaultCountry?: string | null;
  className?: string;
}) {
  if (!value) return null;
  const e164 = normalizePhone(value, defaultCountry) ?? value;
  const country = countryFromPhone(e164, defaultCountry);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
      <CountryFlag country={country} />
      <span>{formatPhoneNumberIntl(e164) || value}</span>
    </span>
  );
}

/** Bare controlled picker (flag + dial code + input) for use inside other forms. */
export function PhoneInputControl({
  value,
  defaultCountry,
  onChange,
  onCountryChange,
  placeholder,
}: {
  value: string | null;
  defaultCountry?: string | null;
  onChange: (e164: string | null) => void;
  onCountryChange?: (iso: string) => void;
  placeholder?: string;
}) {
  const country = ((defaultCountry?.trim().toUpperCase() as Country) || FALLBACK_COUNTRY);
  return (
    <div className="wl-phone rounded-lg border border-slate-300 px-2 py-1.5 focus-within:ring-2 focus-within:ring-indigo-500">
      <PhoneInput
        international
        defaultCountry={country}
        flags={flags}
        value={value ?? undefined}
        onChange={(v) => onChange(v ?? null)}
        onCountryChange={(c) => c && onCountryChange?.(c)}
        placeholder={placeholder ?? "Enter phone number"}
      />
    </div>
  );
}

export function PhoneField({
  value,
  defaultCountry,
  onSave,
  onCountryChange,
}: {
  value: string | null;
  /** ISO alpha-2 hint, e.g. the contact's country_code. */
  defaultCountry?: string | null;
  onSave: (e164: string | null) => void;
  /** Fires when the user picks a country in the dropdown (for field sync). */
  onCountryChange?: (iso: string) => void;
}) {
  // Seed the editor with the best E.164 we can derive from the stored value.
  const seed = normalizePhone(value, defaultCountry) ?? "";
  const editCountry = countryFromPhone(seed, defaultCountry);

  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState<string>(seed);

  const save = () => {
    onSave(val ? val : null);
    setEditing(false);
  };

  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">Phone</label>
      {editing ? (
        <div className="space-y-2">
          <PhoneInputControl
            value={val}
            defaultCountry={editCountry}
            onChange={(v) => setVal(v ?? "")}
            onCountryChange={onCountryChange}
          />
          <div className="flex gap-2">
            <button
              onClick={save}
              className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
            >
              Save
            </button>
            <button
              onClick={() => {
                setVal(seed);
                setEditing(false);
              }}
              className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => {
            setVal(seed);
            setEditing(true);
          }}
          className="text-sm text-slate-900 cursor-pointer hover:bg-slate-50 px-2 py-1.5 rounded-lg border border-transparent hover:border-slate-200"
        >
          {value ? (
            <PhoneDisplay value={value} defaultCountry={defaultCountry} />
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </div>
      )}
    </div>
  );
}
