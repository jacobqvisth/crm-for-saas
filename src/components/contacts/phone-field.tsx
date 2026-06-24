"use client";

import { useState } from "react";
import PhoneInput, { formatPhoneNumberIntl, type Country } from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import "react-phone-number-input/style.css";
import { normalizePhone } from "@/lib/calls/phone";

// Phone field with a country flag + dial-code picker (à la the +44 🇬🇧 control).
// Stores the number in full international E.164 form so the dialer is never
// ambiguous. Auto-selects the country from: the number's own +code if present,
// else the contact's country, else Sweden. The user can always override via the
// flag dropdown.

const FALLBACK_COUNTRY: Country = "SE";

export function PhoneField({
  value,
  defaultCountry,
  onSave,
}: {
  value: string | null;
  /** ISO alpha-2 hint, e.g. the contact's country_code. */
  defaultCountry?: string | null;
  onSave: (e164: string | null) => void;
}) {
  // Seed the editor with the best E.164 we can derive from the stored value.
  const seed = normalizePhone(value, defaultCountry) ?? "";
  const country = ((defaultCountry?.trim().toUpperCase() as Country) || FALLBACK_COUNTRY);

  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState<string>(seed);

  const display = value ? formatPhoneNumberIntl(seed) || value : "";

  const save = () => {
    onSave(val ? val : null);
    setEditing(false);
  };

  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">Phone</label>
      {editing ? (
        <div className="space-y-2">
          <div className="wl-phone rounded-lg border border-indigo-300 px-2 py-1.5 focus-within:ring-2 focus-within:ring-indigo-500">
            <PhoneInput
              international
              defaultCountry={country}
              flags={flags}
              value={val}
              onChange={(v) => setVal(v ?? "")}
              placeholder="Enter phone number"
            />
          </div>
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
        <p
          onClick={() => {
            setVal(seed);
            setEditing(true);
          }}
          className="text-sm text-slate-900 cursor-pointer hover:bg-slate-50 px-2 py-1.5 rounded-lg border border-transparent hover:border-slate-200"
        >
          {display || <span className="text-slate-400">—</span>}
        </p>
      )}
    </div>
  );
}
