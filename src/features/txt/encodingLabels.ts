import type { TxtEncoding } from '@contract/types';

export const ENCODING_LABELS: Record<Exclude<TxtEncoding, 'auto'>, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  gb18030: 'GB18030 (简体)',
  big5: 'Big5 (繁體)',
  shift_jis: 'Shift_JIS',
  'euc-kr': 'EUC-KR',
  'windows-1252': 'Windows-1252',
};
