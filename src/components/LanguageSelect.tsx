import type { Language } from '../types';

interface Props {
  languages: Language[];
  value: string;
  disabled: boolean;
  onChange: (code: string) => void;
}

/** Lets the user view questions, choices and explanations in another language. Hidden when only one language exists. */
export function LanguageSelect({ languages, value, disabled, onChange }: Props) {
  if (languages.length < 2) return null;
  return (
    <label className="lang">
      <span>Language</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {languages.map((l) => (
          <option key={l.code} value={l.code}>{l.name}</option>
        ))}
      </select>
    </label>
  );
}
