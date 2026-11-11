import clsx from 'clsx';
import type { TxtEncoding } from '@contract/types';
import kit from '../../ui/kit.module.css';
import { ENCODING_LABELS } from './encodingLabels';
import styles from './txt.module.css';

const ORDER = Object.keys(ENCODING_LABELS) as Exclude<TxtEncoding, 'auto'>[];

export interface EncodingMenuItemsProps {
  current: TxtEncoding;
  detected: TxtEncoding | null;
  onPick: (enc: TxtEncoding) => void;
}

/** Radio-style menu rows for a "Text Encoding" submenu (library context menu, reader menu). */
export function EncodingMenuItems({ current, detected, onPick }: EncodingMenuItemsProps) {
  const autoLabel =
    detected && detected !== 'auto' ? `Auto (detected: ${ENCODING_LABELS[detected]})` : 'Auto';
  const rows: { enc: TxtEncoding; label: string }[] = [
    { enc: 'auto', label: autoLabel },
    ...ORDER.map((enc) => ({ enc, label: ENCODING_LABELS[enc] })),
  ];
  return (
    <>
      {rows.map(({ enc, label }) => (
        <button
          key={enc}
          type="button"
          role="menuitemradio"
          aria-checked={enc === current}
          className={clsx(kit.item, styles.encItem)}
          onClick={() => onPick(enc)}
        >
          <span className={styles.check} aria-hidden="true">
            {enc === current ? '✓' : ''}
          </span>
          {label}
        </button>
      ))}
    </>
  );
}
