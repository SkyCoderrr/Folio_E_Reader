import { useState } from 'react';
import {
  Button,
  ColorField,
  Dialog,
  DialogClose,
  Menu,
  NumberField,
  Popover,
  Segmented,
  Select,
  Slider,
  Switch,
  Tabs,
  Toaster,
  normalizeHex,
  toast,
} from '../ui/kit';

const section = { display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-4) 0' } as const;

/** Dev-only component gallery at #playground. Every control is keyboard reachable. */
export default function Playground() {
  const [size, setSize] = useState(18);
  const [on, setOn] = useState(true);
  const [seg, setSeg] = useState<'one' | 'two'>('one');
  const [font, setFont] = useState('serif');
  const [num, setNum] = useState<number | null>(40);
  const [color, setColor] = useState(normalizeHex('d9a55b') ?? '');

  return (
    <main
      style={{
        height: '100%',
        overflow: 'auto',
        padding: 'var(--space-6)',
        background: 'var(--surface-1)',
      }}
    >
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-title)',
            lineHeight: 'var(--lh-title)',
            letterSpacing: 'var(--tracking-title)',
            fontWeight: 'var(--fw-strong)',
            margin: 0,
          }}
        >
          UI kit playground
        </h1>

        <section style={section} aria-label="Buttons">
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Button variant="primary">Primary</Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Delete</Button>
            <Button disabled>Disabled</Button>
          </div>
        </section>

        <section style={section} aria-label="Fields">
          <Slider
            label="Font Size"
            value={size}
            min={12}
            max={40}
            modified={size !== 18}
            onReset={() => setSize(18)}
            onChange={setSize}
          />
          <NumberField value={num} min={0} max={100} aria-label="Number" onCommit={setNum} />
          <Switch label="Justify Text" checked={on} onChange={setOn} />
          <Segmented
            label="Pages"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'one', label: 'One Page' },
              { value: 'two', label: 'Two Pages' },
            ]}
          />
          <Select
            label="Font"
            value={font}
            onChange={setFont}
            options={[
              { value: 'serif', label: 'Serif' },
              { value: 'sans', label: 'Sans' },
              { value: 'mono', label: 'Monospace' },
            ]}
          />
          <ColorField label="Accent colour" value={color} onCommit={setColor} />
        </section>

        <section style={{ ...section, display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Popover label="Example popover" trigger={<Button>Popover</Button>}>
            <p style={{ margin: 0, padding: 'var(--space-2)' }}>Grows out of its trigger.</p>
          </Popover>
          <Menu
            trigger={<Button>Menu</Button>}
            items={[
              { label: 'Open', shortcut: 'Ctrl+O', onSelect: () => toast('Open') },
              { label: 'Rename', onSelect: () => toast('Rename') },
              { type: 'separator' },
              { label: 'Remove', danger: true, onSelect: () => toast.error('Removed') },
            ]}
          />
          <Dialog
            trigger={<Button>Dialog</Button>}
            title="Remove Book?"
            description="It will be removed from your library. The file stays on disk."
            actions={
              <>
                <DialogClose>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <DialogClose>
                  <Button variant="danger">Remove</Button>
                </DialogClose>
              </>
            }
          />
          <Button onClick={() => toast.success('Added 3 books')}>Toast</Button>
        </section>

        <Tabs
          label="Example tabs"
          tabs={[
            { value: 'a', label: 'General', content: 'General settings.' },
            { value: 'b', label: 'Keyboard', content: 'Keyboard settings.' },
          ]}
        />
      </div>
      <Toaster />
    </main>
  );
}
