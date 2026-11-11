import { Slider as BaseSlider } from '@base-ui/react/slider';
import { NumberField } from './NumberField';
import styles from './kit.module.css';

export interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Shows the reset dot (only when true). */
  modified?: boolean;
  onReset?: () => void;
}

/** Slider with a numeric field. The reset dot appears only when `modified`. */
export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  modified,
  onReset,
}: SliderProps) {
  return (
    <div className={styles.slider}>
      <div className={styles.sliderHead}>
        <span className={styles.label}>{label}</span>
        <span className={styles.resetSlot}>
          {modified && onReset ? (
            <button
              type="button"
              className={styles.resetDot}
              aria-label={`Reset ${label}`}
              onClick={onReset}
            />
          ) : null}
        </span>
      </div>
      <div className={styles.row}>
        <BaseSlider.Root
          value={value}
          min={min}
          max={max}
          step={step}
          onValueChange={(v) => onChange(v as number)}
          style={{ flex: 1 }}
        >
          <BaseSlider.Control className={styles.sliderControl}>
            <BaseSlider.Track className={styles.track}>
              <BaseSlider.Indicator className={styles.indicator} />
              <BaseSlider.Thumb aria-label={label} className={styles.thumb} />
            </BaseSlider.Track>
          </BaseSlider.Control>
        </BaseSlider.Root>
        <NumberField
          value={value}
          min={min}
          max={max}
          step={step}
          aria-label={`${label} value`}
          onCommit={(v) => v !== null && onChange(v)}
        />
      </div>
    </div>
  );
}
