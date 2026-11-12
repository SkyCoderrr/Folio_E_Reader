import { errorCopy } from '../../ipc/errorCopy';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Preset } from '@contract/types';
import {
  Button,
  ColorField,
  Dialog,
  DialogClose,
  Menu,
  Segmented,
  Slider,
  Switch,
  toast,
} from '../../ui/kit';
import { useSettings } from '../../state/settingsStore';
import { FontPicker } from './FontPicker';
import { Field, StyleSlider } from './controls';
import { resetStyle, setStyle, useOverridden, useStyleValue } from './styleHooks';
import kit from '../../ui/kit.module.css';
import styles from './appearance.module.css';

interface Props {
  open: boolean;
  /** Opened with the keyboard: no slide animation (PRD 6.6). */
  instant?: boolean;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-label={title}>
      <h3 className={styles.heading}>{title}</h3>
      {children}
    </section>
  );
}

function ColorRow({ label, path }: { label: string; path: string }) {
  const value = useStyleValue<string>(path);
  return (
    <Field label={label} path={path}>
      <ColorField
        label={label}
        value={value.slice(0, 7)}
        onCommit={(hex) => setStyle(path, hex.toUpperCase())}
      />
    </Field>
  );
}

function SelectionRow() {
  const path = 'colors.selection';
  const value = useStyleValue<string>(path);
  const modified = useOverridden(path);
  const rgb = value.slice(0, 7);
  const alpha = value.length === 9 ? parseInt(value.slice(7), 16) : 255;
  const pct = Math.round((alpha / 255) * 100);
  const write = (hex: string, a: number) => {
    const aa = Math.round((a / 100) * 255)
      .toString(16)
      .padStart(2, '0');
    setStyle(path, `${hex}${aa}`.toUpperCase());
  };
  return (
    <>
      <Field label="Selection" path={path}>
        <ColorField label="Selection" value={rgb} onCommit={(hex) => write(hex, pct)} />
      </Field>
      <Slider
        label="Selection opacity"
        value={pct}
        min={0}
        max={100}
        step={1}
        modified={modified}
        onReset={() => resetStyle(path)}
        onChange={(v) => write(rgb, Math.min(100, Math.max(0, v)))}
      />
    </>
  );
}

function PresetNameDialog({
  title,
  initial,
  onClose,
  onSubmit,
  exceptId,
}: {
  title: string;
  initial: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
  exceptId?: string;
}) {
  const presets = useSettings((s) => s.presetsList);
  const [name, setName] = useState(initial);
  const [error, setError] = useState('');
  const submit = () => {
    const value = name.trim();
    if (!value) return setError('Enter a name');
    if (presets.some((p) => p.id !== exceptId && p.name.toLowerCase() === value.toLowerCase()))
      return setError('A preset with this name already exists');
    try {
      onSubmit(value);
      onClose();
    } catch (e) {
      setError(errorCopy(e));
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={title}
      actions={
        <>
          <DialogClose>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <input
        className={kit.input}
        aria-label="Preset name"
        aria-invalid={error !== ''}
        autoFocus
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

function Presets() {
  const presets = useSettings((s) => s.presetsList);
  const activeId = useSettings((s) => s.settings.activePresetId);
  const modified = useSettings((s) => Object.keys(s.settings.styleOverrides).length > 0);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<Preset | null>(null);
  const active = presets.find((p) => p.id === activeId);
  const api = useSettings.getState;
  const remove = (p: Preset) => {
    const undo = api().deletePreset(p.id);
    toast(`Deleted "${p.name}"`, {
      duration: 6000,
      action: { label: 'Undo', onClick: undo },
    });
  };
  return (
    <Section title="Presets">
      <div className={styles.chips} role="group" aria-label="Presets">
        {presets.map((p) => (
          <span key={p.id} className={styles.chipWrap} data-active={p.id === activeId}>
            <button
              type="button"
              className={styles.chip}
              aria-pressed={p.id === activeId}
              onClick={() => api().selectPreset(p.id)}
            >
              {p.name}
            </button>
            {p.builtIn ? null : (
              <Menu
                trigger={
                  <button
                    type="button"
                    className={styles.chipMore}
                    aria-label={`${p.name} options`}
                  >
                    ⋯
                  </button>
                }
                items={[
                  { label: 'Rename…', onSelect: () => setRenaming(p) },
                  { label: 'Delete', danger: true, onSelect: () => remove(p) },
                ]}
              />
            )}
          </span>
        ))}
      </div>
      <div className={styles.presetActions}>
        <Button onClick={() => setSaving(true)}>Save as Preset…</Button>
        {modified ? (
          <div className={styles.modified}>
            <span>Modified</span>
            {active && !active.builtIn ? (
              <Button variant="ghost" onClick={() => api().updatePreset()}>
                Update
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => api().revertPreset()}>
              Revert
            </Button>
          </div>
        ) : null}
      </div>
      {saving ? (
        <PresetNameDialog
          title="Save as Preset"
          initial=""
          onClose={() => setSaving(false)}
          onSubmit={(n) => api().saveAsPreset(n)}
        />
      ) : null}
      {renaming ? (
        <PresetNameDialog
          title="Rename Preset"
          initial={renaming.name}
          exceptId={renaming.id}
          onClose={() => setRenaming(null)}
          onSubmit={(n) => api().renamePreset(renaming.id, n)}
        />
      ) : null}
    </Section>
  );
}

function Choice<T extends string>({
  label,
  path,
  options,
}: {
  label: string;
  path: string;
  options: { value: T; label: string }[];
}) {
  const value = useStyleValue<T>(path);
  return (
    <Field label={label} path={path}>
      <Segmented
        label={label}
        value={value}
        options={options}
        onChange={(v) => setStyle(path, v)}
      />
    </Field>
  );
}

function ToggleRow({ label, path }: { label: string; path: string }) {
  const value = useStyleValue<boolean>(path);
  const modified = useOverridden(path);
  return (
    <div className={styles.toggleRow}>
      <Switch label={label} checked={value} onChange={(v) => setStyle(path, v)} />
      <span className={kit.resetSlot}>
        {modified ? (
          <button
            type="button"
            className={kit.resetDot}
            aria-label={`Reset ${label}`}
            onClick={() => resetStyle(path)}
          />
        ) : null}
      </span>
    </div>
  );
}

function FontRow({ label, path, cjk }: { label: string; path: string; cjk?: boolean }) {
  const value = useStyleValue<string>(path);
  return (
    <Field label={label} path={path}>
      <FontPicker label={label} value={value} cjk={cjk} onChange={(f) => setStyle(path, f)} />
    </Field>
  );
}

/** 0 = fill; otherwise 15–120 em (a switch avoids a dead 1–14 range). */
function MaxWidth() {
  const path = 'layout.maxLineWidthEm';
  const fill = useStyleValue<number>(path) === 0;
  return (
    <>
      <Switch label="Fill width" checked={fill} onChange={(v) => setStyle(path, v ? 0 : 36)} />
      {fill ? null : <StyleSlider label="Max line width" path={path} min={15} max={120} step={1} />}
    </>
  );
}

/** Right-hand Appearance panel (PRD 6.7). Stays mounted so it can slide out. */
export function AppearancePanel({ open, instant = false, onClose }: Props) {
  const indentMode = useStyleValue<string>('text.indentMode');
  return (
    <aside
      className={styles.panel}
      data-open={open}
      data-instant={instant}
      aria-label="Appearance"
      aria-hidden={!open}
      inert={!open}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>Appearance</h2>
        <button
          type="button"
          className={styles.close}
          aria-label="Close Appearance"
          onClick={onClose}
        >
          <X size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </header>
      <div className={styles.scroll}>
        <Presets />
        <Section title="Colours">
          <ColorRow label="Background" path="colors.background" />
          <ColorRow label="Text" path="colors.text" />
          <ColorRow label="Accent / links" path="colors.accent" />
          <SelectionRow />
        </Section>
        <Section title="Fonts">
          <FontRow label="Latin font" path="font.latin" />
          <FontRow label="CJK font" path="font.cjk" cjk />
          <Choice
            label="Fallback"
            path="font.fallback"
            options={[
              { value: 'serif', label: 'Serif' },
              { value: 'sans-serif', label: 'Sans' },
            ]}
          />
          <StyleSlider label="Weight" path="font.weight" min={100} max={900} step={10} />
        </Section>
        <Section title="Size & Spacing">
          <StyleSlider label="Size" path="font.size" min={10} max={72} step={1} />
          <StyleSlider label="Line height" path="text.lineHeight" min={1} max={3} step={0.05} />
          <StyleSlider
            label="Letter spacing"
            path="text.letterSpacing"
            min={-0.05}
            max={0.3}
            step={0.005}
          />
          <StyleSlider
            label="Paragraph spacing"
            path="text.paragraphSpacing"
            min={0}
            max={3}
            step={0.1}
          />
          <Choice
            label="Indent"
            path="text.indentMode"
            options={[
              { value: 'publisher', label: 'Publisher' },
              { value: 'force', label: 'Force' },
              { value: 'none', label: 'None' },
            ]}
          />
          {indentMode !== 'none' ? (
            <StyleSlider label="Indent size" path="text.indentSize" min={0} max={4} step={0.5} />
          ) : null}
        </Section>
        <Section title="Layout">
          <Choice
            label="Alignment"
            path="text.align"
            options={[
              { value: 'publisher', label: 'Publisher' },
              { value: 'left', label: 'Left' },
              { value: 'justify', label: 'Justify' },
            ]}
          />
          <MaxWidth />
          <StyleSlider label="Margin X" path="layout.marginX" min={0} max={400} step={1} />
          <StyleSlider label="Margin Y" path="layout.marginY" min={0} max={200} step={1} />
          <StyleSlider label="Page gap" path="layout.pageGap" min={0} max={200} step={1} />
        </Section>
        <Section title="CJK">
          <ToggleRow label="Trim punctuation" path="cjk.punctuationTrim" />
          <ToggleRow label="Auto-space CJK and Latin" path="cjk.autospace" />
        </Section>
      </div>
    </aside>
  );
}
