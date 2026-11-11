import { useMemo, useState } from 'react';
import { Popover } from '../../ui/kit';
import { useFonts } from '../../state/settingsStore';
import { filterFonts } from './fontFilter';
import styles from './appearance.module.css';

const ROW = 32;
const VIEW = 264;
const OVERSCAN = 6;

interface Props {
  label: string;
  value: string;
  onChange: (family: string) => void;
  /** CJK picker: the "CJK only" filter starts on. */
  cjk?: boolean;
}

/** Popover list; every family is rendered in its own typeface, windowed by row. */
export function FontPicker({ label, value, onChange, cjk = false }: Props) {
  const { fonts } = useFonts();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cjkOnly, setCjkOnly] = useState(cjk);
  const [top, setTop] = useState(0);
  const list = useMemo(() => filterFonts(fonts ?? [], query, cjkOnly), [fonts, query, cjkOnly]);
  /** RS-03.5: the saved family is gone (uninstalled); text falls back via the CSS stack. */
  const missing =
    fonts !== null &&
    fonts.length > 0 &&
    !fonts.some((f) => f.family === value || f.localizedFamilies.includes(value));
  const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
  const last = Math.min(list.length, Math.ceil((top + VIEW) / ROW) + OVERSCAN);
  return (
    <Popover
      label={label}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={styles.fontTrigger} aria-label={label}>
          <span style={{ fontFamily: `"${value}", serif` }}>{value}</span>
          {missing ? <span className={styles.notInstalled}>not installed</span> : null}
        </button>
      }
    >
      <div className={styles.fontPop}>
        <input
          className={styles.search}
          aria-label={`Search ${label}`}
          placeholder="Search fonts"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setTop(0);
          }}
        />
        <label className={styles.filter}>
          <input type="checkbox" checked={cjkOnly} onChange={(e) => setCjkOnly(e.target.checked)} />
          CJK only
        </label>
        <div
          className={styles.fontList}
          style={{ height: VIEW }}
          role="listbox"
          aria-label={label}
          onScroll={(e) => setTop(e.currentTarget.scrollTop)}
        >
          {fonts === null ? <p className={styles.empty}>Loading fonts…</p> : null}
          {fonts && list.length === 0 ? <p className={styles.empty}>No matching fonts</p> : null}
          <div style={{ height: list.length * ROW, position: 'relative' }}>
            {list.slice(first, last).map((f, i) => (
              <button
                key={f.family}
                type="button"
                role="option"
                aria-selected={f.family === value}
                className={styles.fontRow}
                style={{ top: (first + i) * ROW, height: ROW }}
                onClick={() => {
                  onChange(f.family);
                  setOpen(false);
                }}
              >
                <span style={{ fontFamily: `"${f.family}", serif` }}>{f.family}</span>
                {f.localizedFamilies[0] ? (
                  <span className={styles.localized} style={{ fontFamily: `"${f.family}", serif` }}>
                    {f.localizedFamilies[0]}
                  </span>
                ) : null}
                {f.cjk ? <span className={styles.cjkTag}>CJK</span> : null}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Popover>
  );
}
