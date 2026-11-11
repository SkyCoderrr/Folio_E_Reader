import { useState } from 'react';
import type { Settings, SettingsPatch } from '@contract/types';
import { Button, Segmented, Select, Switch } from '../../ui/kit';
import defaultsJson from '../../../contract/settings.defaults.json';
import { Group, NumSetting, Row } from './controls';
import styles from './settings.module.css';

const D = defaultsJson as unknown as Settings;

type Section = 'layout' | 'chrome' | 'cursor' | 'scroll' | 'autoscroll' | 'txt' | 'stats';
export interface PaneProps {
  settings: Settings;
  onPatch: (patch: SettingsPatch) => void;
}

const patchOf = (section: string, key: string, v: unknown) =>
  ({ [section]: { [key]: v } }) as SettingsPatch;

/** A slider setting bound to settings[section][key]; the reset dot patches null (= default). */
function Num<S extends Section>(
  p: PaneProps & {
    section: S;
    k: keyof Settings[S] & string;
    label: string;
    unit: string;
    min: number;
    max: number;
    step?: number;
    hint?: string;
  },
) {
  const { section, k, settings, onPatch, ...rest } = p;
  return (
    <NumSetting
      {...rest}
      value={settings[section][k] as number}
      def={D[section][k] as number}
      onChange={(v) => onPatch(patchOf(section, k, v))}
      onReset={() => onPatch(patchOf(section, k, null))}
    />
  );
}

export function GeneralPane({ settings, onPatch }: PaneProps) {
  return (
    <>
      <Group title="Window">
        <Row
          title="Title bar"
          hint="Custom blends into the app; Windows uses the system frame. Applies after restart."
        >
          <Segmented
            label="Title bar"
            value={settings.window.titleBar}
            options={[
              { value: 'custom', label: 'Custom' },
              { value: 'native', label: 'Windows' },
            ]}
            onChange={(v) => onPatch({ window: { titleBar: v } })}
          />
        </Row>
      </Group>
    </>
  );
}

export function ReadingPane(p: PaneProps) {
  const { settings: s, onPatch } = p;
  const cursorOn = s.cursor.autoHideDelayMs !== 0;
  return (
    <>
      <Group title="Layout">
        <Row title="Reading flow" hint="Scroll keeps one continuous column; Paged turns pages.">
          <Segmented
            label="Reading flow"
            value={s.reader.flow}
            options={[
              { value: 'scroll', label: 'Scroll' },
              { value: 'paged', label: 'Paged' },
            ]}
            onChange={(v) => onPatch({ reader: { flow: v } })}
          />
        </Row>
        <Row
          title="Pages per view"
          hint="Two pages is opt-in; the app never switches to it on its own."
        >
          <Segmented
            label="Pages per view"
            value={String(s.reader.pagesPerView) as '1' | '2'}
            options={[
              { value: '1', label: 'One page' },
              { value: '2', label: 'Two pages' },
            ]}
            onChange={(v) => onPatch({ reader: { pagesPerView: v === '2' ? 2 : 1 } })}
          />
        </Row>
        <Num
          {...p}
          section="layout"
          k="minSpreadWidthPx"
          label="Minimum width for two pages"
          unit="px"
          min={600}
          max={3000}
          step={50}
          hint="Narrower windows fall back to one page."
        />
        <Row
          title="Publisher styles in EPUB"
          hint="Balanced keeps your font and colours but the publisher's headings, italics and images."
        >
          <Select
            label="Publisher styles in EPUB"
            value={s.epub.styleOverride}
            options={[
              { value: 'minimal', label: 'Minimal' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'full', label: 'Full override' },
            ]}
            onChange={(v) => onPatch({ epub: { styleOverride: v } })}
          />
        </Row>
      </Group>
      <Group title="Auto-hide">
        <Row
          title="Reading progress"
          hint="Small text in the page footer that stays visible while the toolbar is hidden."
        >
          <Segmented
            label="Reading progress"
            value={s.chrome.footerProgress}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'percent', label: 'Percentage' },
              { value: 'chapter', label: 'Chapter' },
              { value: 'both', label: 'Both' },
            ]}
            onChange={(v) => onPatch({ chrome: { footerProgress: v } })}
          />
        </Row>
        <Num
          {...p}
          section="chrome"
          k="autoHideDelayMs"
          label="Hide toolbar after"
          unit="ms"
          min={500}
          max={10000}
          step={100}
        />
        <Switch
          label="Hide the mouse cursor when idle"
          checked={cursorOn}
          onChange={(on) =>
            onPatch({ cursor: { autoHideDelayMs: on ? D.cursor.autoHideDelayMs || 1500 : 0 } })
          }
        />
        {cursorOn ? (
          <Num
            {...p}
            section="cursor"
            k="autoHideDelayMs"
            label="Hide cursor after"
            unit="ms"
            min={500}
            max={10000}
            step={100}
          />
        ) : null}
      </Group>
    </>
  );
}

export function ScrollingPane(p: PaneProps) {
  const { settings: s, onPatch } = p;
  return (
    <>
      <Group title="Arrow keys">
        <Num
          {...p}
          section="scroll"
          k="arrowSpeed"
          label="Speed"
          unit="px/s"
          min={60}
          max={4000}
          step={10}
        />
        <Num
          {...p}
          section="scroll"
          k="startRampMs"
          label="Start ramp"
          unit="ms"
          min={0}
          max={400}
          step={10}
        />
        <Num
          {...p}
          section="scroll"
          k="stopDecelMs"
          label="Stop easing"
          unit="ms"
          min={0}
          max={500}
          step={10}
        />
        <Num
          {...p}
          section="scroll"
          k="tapLines"
          label="Lines per tap"
          unit="lines"
          min={1}
          max={10}
        />
        <Num
          {...p}
          section="scroll"
          k="pageOverlapLines"
          label="Page overlap"
          unit="lines"
          min={0}
          max={10}
        />
      </Group>
      <Group title="Acceleration">
        <Switch
          label="Speed up while a key is held"
          checked={s.scroll.acceleration}
          onChange={(v) => onPatch({ scroll: { acceleration: v } })}
        />
        {s.scroll.acceleration ? (
          <>
            <Num
              {...p}
              section="scroll"
              k="accelMax"
              label="Top speed multiplier"
              unit="×"
              min={1}
              max={6}
              step={0.1}
            />
            <Num
              {...p}
              section="scroll"
              k="accelRampMs"
              label="Time to top speed"
              unit="ms"
              min={100}
              max={4000}
              step={50}
            />
          </>
        ) : null}
      </Group>
      <Group title="Auto-scroll">
        <Num {...p} section="autoscroll" k="speed" label="Speed" unit="px/s" min={5} max={400} />
        <Num
          {...p}
          section="autoscroll"
          k="step"
          label="Faster / slower step"
          unit="%"
          min={1}
          max={50}
        />
        <Switch
          label="Pause when the window loses focus"
          checked={s.autoscroll.pauseOnBlur}
          onChange={(v) => onPatch({ autoscroll: { pauseOnBlur: v } })}
        />
      </Group>
    </>
  );
}

const SORTS = [
  { value: 'lastRead', label: 'Last read' },
  { value: 'added', label: 'Date added' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'progress', label: 'Progress' },
] as const;

export function LibraryPane({
  settings: s,
  onPatch,
  libraryDir,
  onPickLibraryFolder,
  onResetLibraryFolder,
}: PaneProps & {
  libraryDir: string;
  onPickLibraryFolder: () => void;
  onResetLibraryFolder: () => void;
}) {
  return (
    <>
      <Group title="Library folder">
        <Row
          title="Imported books are copied to"
          hint="Copies stay here; reading progress and settings stay in the app profile."
        >
          {null}
        </Row>
        <div className={styles.mono} data-testid="library-dir">
          {libraryDir}
        </div>
        <div className={styles.rowControl}>
          <Button onClick={onPickLibraryFolder}>Change…</Button>
          <Button
            variant="ghost"
            disabled={s.library.folder === null}
            onClick={onResetLibraryFolder}
          >
            Reset to Default
          </Button>
        </div>
        <Row title="Storage" hint="Books are always copied into the library in this version.">
          <span className={styles.rowHint}>Copy</span>
        </Row>
      </Group>
      <Group title="Library view">
        <Row title="View">
          <Segmented
            label="Library view"
            value={s.library.view}
            options={[
              { value: 'grid', label: 'Grid' },
              { value: 'list', label: 'List' },
            ]}
            onChange={(v) => onPatch({ library: { view: v } })}
          />
        </Row>
        <Row title="Sort by">
          <Select
            label="Sort by"
            value={s.library.sort}
            options={[...SORTS]}
            onChange={(v) => onPatch({ library: { sort: v } })}
          />
        </Row>
        <Row title="Sort direction">
          <Segmented
            label="Sort direction"
            value={s.library.sortDir}
            options={[
              { value: 'asc', label: 'Ascending' },
              { value: 'desc', label: 'Descending' },
            ]}
            onChange={(v) => onPatch({ library: { sortDir: v } })}
          />
        </Row>
        <Row title="Show">
          <Select
            label="Show"
            value={s.library.filter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'reading', label: 'Reading' },
              { value: 'unread', label: 'Unread' },
              { value: 'finished', label: 'Finished' },
            ]}
            onChange={(v) => onPatch({ library: { filter: v } })}
          />
        </Row>
      </Group>
    </>
  );
}

export function TxtPane(p: PaneProps) {
  const { settings: s, onPatch } = p;
  const [edit, setEdit] = useState<string | null>(null);
  const draft = edit ?? s.txt.chapterRegex;
  const [err, setErr] = useState<string | null>(null);
  // Validate only when the user commits (blur). The engine validates the syntax itself.
  const commit = () => {
    if (draft === s.txt.chapterRegex) return;
    if (draft.trim().length === 0 || draft.length > 1000) {
      setErr('Use 1 to 1000 characters.');
      return;
    }
    setErr(null);
    setEdit(null);
    onPatch({ txt: { chapterRegex: draft } });
  };
  return (
    <>
      <Group title="Chapters">
        <div className={styles.rowTitle}>Chapter heading pattern</div>
        <textarea
          className={styles.textarea}
          aria-label="Chapter heading pattern"
          spellCheck={false}
          value={draft}
          onChange={(e) => setEdit(e.target.value)}
          onBlur={commit}
        />
        {err ? (
          <div className={styles.error} role="alert">
            {err}
          </div>
        ) : null}
        <div>
          <Button
            variant="ghost"
            disabled={s.txt.chapterRegex === D.txt.chapterRegex}
            onClick={() => {
              setErr(null);
              setEdit(null);
              onPatch({ txt: { chapterRegex: null } });
            }}
          >
            Reset to default
          </Button>
        </div>
        <Num
          {...p}
          section="txt"
          k="headingMaxChars"
          label="Longest heading"
          unit="characters"
          min={4}
          max={100}
        />
        <Num
          {...p}
          section="txt"
          k="fallbackChunkChars"
          label="Section size without chapters"
          unit="characters"
          min={2000}
          max={100000}
          step={1000}
        />
      </Group>
      <Group title="Paragraphs">
        <Row title="Paragraph breaks" hint="Auto picks lines or blank lines from the text.">
          <Select
            label="Paragraph breaks"
            value={s.txt.paragraphMode}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'line', label: 'Every line' },
              { value: 'blank', label: 'Blank lines' },
            ]}
            onChange={(v) => onPatch({ txt: { paragraphMode: v } })}
          />
        </Row>
      </Group>
    </>
  );
}

export function StatsPane(p: PaneProps) {
  const { settings: s, onPatch } = p;
  return (
    <Group>
      <Switch
        label="Track reading time"
        checked={s.stats.enabled}
        onChange={(v) => onPatch({ stats: { enabled: v } })}
      />
      {s.stats.enabled ? (
        <Num
          {...p}
          section="stats"
          k="idleTimeoutSec"
          label="Stop counting after idle"
          unit="s"
          min={30}
          max={900}
          step={10}
        />
      ) : null}
    </Group>
  );
}

export function AboutPane({
  appVersion,
  contractVersion,
}: {
  appVersion: string;
  contractVersion: string;
}) {
  return (
    <Group>
      <Row title="Folio">
        <span>Local e-book reader</span>
      </Row>
      <Row title="Version">
        <span className={styles.mono}>{appVersion}</span>
      </Row>
      <Row title="Contract version">
        <span className={styles.mono}>{contractVersion}</span>
      </Row>
    </Group>
  );
}
