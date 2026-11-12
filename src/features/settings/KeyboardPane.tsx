import { useEffect, useState } from 'react';
import type { ActionId, BossKeyStatus, Chord } from '@contract/types';
import { isAppError } from '../../ipc/commands';
import { errorCopy } from '../../ipc/errorCopy';
import { Button, Switch } from '../../ui/kit';
import {
  MAX_CHORDS_PER_ACTION,
  chordFromEvent,
  findConflict,
  formatChord,
  isReserved,
  normalizeChord,
  sameChords,
  validateBossChord,
  type KeymapRow,
} from './chords';
import { Tooltip } from '../../ui/Tooltip';
import { Group, Row } from './controls';
import styles from './settings.module.css';

export interface KeymapEntry extends KeymapRow {
  actionId: ActionId;
}

export interface KeyboardPaneProps {
  keymap: KeymapEntry[];
  bossChord: Chord;
  bossEnabled: boolean;
  debugBuild?: boolean;
  bossStatus: BossKeyStatus | null;
  onBossShortcut: (chord: Chord) => Promise<void>;
  onBossEnabled: (b: boolean) => void;
  onRebind: (actionId: ActionId, chords: string[]) => void;
  onResetBinding: (actionId: ActionId) => void;
  onResetAllBindings: () => void;
}

type Target = 'boss' | ActionId;
interface Notice {
  target: Target;
  success?: boolean;
  text: string;
  /** Present for a same-scope conflict: offers Replace. */
  replace?: { actionId: ActionId; chord: string; other: KeymapEntry };
}

const SCOPE_TITLES: Record<string, string> = {
  reader: 'Reader',
  'reader.autoscroll': 'Reader while auto-scroll is running',
  library: 'Library',
  app: 'App',
};

function Chip({ chord, onRemove, label }: { chord: string; onRemove?: () => void; label: string }) {
  return (
    <span className={styles.chip}>
      {formatChord(chord)}
      {onRemove ? (
        <button
          type="button"
          className={styles.chipX}
          aria-label={`Remove ${formatChord(chord)} from ${label}`}
          onClick={onRemove}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

export function KeyboardPane(p: KeyboardPaneProps) {
  const [recording, setRecording] = useState<Target | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function commitBoss(chord: string) {
    const verdict = validateBossChord(chord, p.debugBuild);
    if (!verdict.ok) {
      setNotice({
        target: 'boss',
        text:
          verdict.reason === 'reserved'
            ? `${formatChord(chord)} is reserved by Windows. Pick another shortcut.`
            : `${formatChord(chord)} needs Ctrl, Alt or Shift. Pause, Scroll Lock and F13–F24 also work on their own.`,
      });
      return;
    }
    setNotice(null);
    try {
      await p.onBossShortcut(chord);
      setNotice({ target: 'boss', text: `${formatChord(chord)} is ready.`, success: true });
    } catch (e) {
      setNotice({
        target: 'boss',
        text: isAppError(e) && e.code === 'SHORTCUT_IN_USE'
          ? 'In use by another app. Try another shortcut.'
          : errorCopy(e),
      });
    }
  }

  function commitAction(actionId: ActionId, chord: string) {
    const row = p.keymap.find((r) => r.actionId === actionId);
    if (!row) return;
    if (isReserved(chord, p.debugBuild)) {
      setNotice({
        target: actionId,
        text: `${formatChord(chord)} is reserved by Windows and can't be used.`,
      });
      return;
    }
    if (row.chords.some((c) => normalizeChord(c) === chord)) {
      setNotice({
        target: actionId,
        text: `${formatChord(chord)} is already assigned to this action.`,
      });
      return;
    }
    const other = findConflict(p.keymap, actionId, chord);
    if (other) {
      setNotice({
        target: actionId,
        text: `${formatChord(chord)} is already used by “${other.label}”.`,
        replace: { actionId, chord, other },
      });
      return;
    }
    setNotice(null);
    p.onRebind(actionId, [...row.chords, chord]);
  }

  function replace(r: NonNullable<Notice['replace']>) {
    p.onRebind(
      r.other.actionId,
      r.other.chords.filter((c) => normalizeChord(c) !== r.chord),
    );
    const row = p.keymap.find((x) => x.actionId === r.actionId);
    p.onRebind(r.actionId, [...(row?.chords ?? []), r.chord]);
    setNotice(null);
  }

  // Capture the next chord. Esc cancels recording, so Esc is bound by Reset, not by recording.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        setRecording(null);
        return;
      }
      const chord = chordFromEvent(e);
      if (!chord) return;
      setRecording(null);
      if (recording === 'boss') void commitBoss(chord);
      else commitAction(recording, chord);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const bossNotice = notice?.target === 'boss' ? notice : null;
  const bossFailed = p.bossStatus?.enabled && !p.bossStatus.registered;
  const scopes = [...new Set(p.keymap.map((r) => r.scope))];
  const anyModified = p.keymap.some((r) => !sameChords(r.chords, r.defaults));

  return (
    <>
      <Group title="Boss key">
        {bossFailed ? (
          <div className={styles.banner} role="alert">
            <span>
              {p.bossStatus?.error?.code === 'SHORTCUT_IN_USE'
                ? `Another app is already using ${formatChord(p.bossStatus.shortcut)}. Pick a different shortcut.`
                : `The boss key couldn't be registered (${formatChord(p.bossStatus?.shortcut ?? p.bossChord)}). Pick a different shortcut.`}
            </span>
            <Button variant="secondary" onClick={() => setRecording('boss')}>
              Change…
            </Button>
          </div>
        ) : null}
        <Row
          title="Hide window instantly"
          hint="Hides the window and its taskbar button, from any app."
        >
          <Switch label="Enabled" checked={p.bossEnabled} onChange={p.onBossEnabled} />
        </Row>
        <div className={styles.keyTable}>
          <div className={styles.keyRow}>
            <div className={styles.keyLabel}>Shortcut</div>
            <div className={styles.chips}>
              <Chip chord={p.bossChord} label="Boss key" />
              {recording === 'boss' ? <Recording /> : null}
            </div>
            <div className={styles.keyAction}>
              {recording === 'boss' ? (
                <span className={styles.escHint}>Esc to cancel</span>
              ) : (
                <Button
                  variant="ghost"
                  className={styles.recordBtn}
                  onClick={() => setRecording('boss')}
                >
                  Record
                </Button>
              )}
            </div>
          </div>
        </div>
        {bossNotice ? (
          <div className={bossNotice.success ? undefined : styles.error} role={bossNotice.success ? "status" : "alert"}>
            {bossNotice.text}
          </div>
        ) : null}
      </Group>

      <section className={styles.group}>
        <div className={styles.groupHead}>
          <h3 className={styles.groupTitle}>Shortcuts</h3>
          {anyModified ? (
            <Button
              variant="ghost"
              className={styles.groupHeadAction}
              onClick={p.onResetAllBindings}
            >
              Reset all to defaults
            </Button>
          ) : null}
        </div>
        {scopes.map((scope) => (
          <div key={scope} className={styles.keyTable}>
            <h4 className={styles.scopeTitle}>{SCOPE_TITLES[scope] ?? scope}</h4>
            {p.keymap
              .filter((r) => r.scope === scope)
              .map((r) => {
                const n = notice?.target === r.actionId ? notice : null;
                const isRec = recording === r.actionId;
                const full = r.chords.length >= MAX_CHORDS_PER_ACTION;
                const modified = !sameChords(r.chords, r.defaults);
                return (
                  <div
                    key={r.actionId}
                    className={styles.keyRow}
                    data-recording={isRec || undefined}
                  >
                    <div className={styles.keyLabel}>
                      <span className={styles.keyLabelText}>{r.label}</span>
                      {modified ? (
                        <Tooltip label="Reset to default" align="start">
                          <button
                            type="button"
                            className={styles.resetDot}
                            aria-label={`Reset ${r.label}`}
                            onClick={() => {
                              setNotice(null);
                              p.onResetBinding(r.actionId);
                            }}
                          />
                        </Tooltip>
                      ) : null}
                    </div>
                    <div className={styles.chips}>
                      {r.chords.length === 0 && !isRec ? (
                        <span className={styles.unassigned}>Unassigned</span>
                      ) : null}
                      {r.chords.map((c) => (
                        <Chip
                          key={c}
                          chord={c}
                          label={r.label}
                          onRemove={() =>
                            p.onRebind(
                              r.actionId,
                              r.chords.filter((x) => x !== c),
                            )
                          }
                        />
                      ))}
                      {isRec ? <Recording /> : null}
                    </div>
                    <div className={styles.keyAction}>
                      {isRec ? (
                        <span className={styles.escHint}>Esc to cancel</span>
                      ) : (
                        <Button
                          variant="ghost"
                          className={styles.recordBtn}
                          aria-label={`Add shortcut for ${r.label}`}
                          disabled={full}
                          title={full ? 'Up to 3 shortcuts per action' : undefined}
                          onClick={() => {
                            setNotice(null);
                            setRecording(r.actionId);
                          }}
                        >
                          Record
                        </Button>
                      )}
                    </div>
                    {n ? (
                      <div className={styles.notice} role="alert">
                        <span>{n.text}</span>
                        {n.replace ? (
                          <>
                            <Button variant="secondary" onClick={() => replace(n.replace!)}>
                              Replace
                            </Button>
                            <Button variant="ghost" onClick={() => setNotice(null)}>
                              Cancel
                            </Button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
          </div>
        ))}
      </section>
    </>
  );
}

function Recording() {
  return (
    <span className={styles.recording} role="status">
      Press a shortcut…
    </span>
  );
}
