import type { ReactNode } from 'react';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import styles from './kit.module.css';

export interface TabsProps {
  label: string;
  tabs: { value: string; label: string; content: ReactNode }[];
  defaultValue?: string;
}

export function Tabs({ label, tabs, defaultValue }: TabsProps) {
  return (
    <BaseTabs.Root defaultValue={defaultValue ?? tabs[0]?.value}>
      <BaseTabs.List className={styles.tabList} aria-label={label}>
        {tabs.map((t) => (
          <BaseTabs.Tab key={t.value} value={t.value} className={styles.tab}>
            {t.label}
          </BaseTabs.Tab>
        ))}
        <BaseTabs.Indicator className={styles.tabIndicator} />
      </BaseTabs.List>
      {tabs.map((t) => (
        <BaseTabs.Panel key={t.value} value={t.value} className={styles.tabPanel}>
          {t.content}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}
