import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
if (!['dev', 'build', 'test', 'check'].includes(mode))
  throw new Error('Expected dev, build, test or check');
const profile = resolve(root, '.test-profile', mode === 'dev' ? 'dev' : mode);
mkdirSync(profile, { recursive: true });
const env = { ...process.env, E_READER_PROFILE_DIR: profile };
const run = (command, args) => {
  const cli = {
    tauri: '@tauri-apps/cli/tauri.js',
    eslint: 'eslint/bin/eslint.js',
    tsc: 'typescript/bin/tsc',
    vitest: 'vitest/vitest.mjs',
  }[command];
  const result = spawnSync(
    cli ? process.execPath : command,
    cli ? [resolve(root, 'node_modules', cli), ...args] : args,
    {
      cwd: root,
      env,
      stdio: 'inherit',
      shell: false,
    },
  );
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
};
if (mode === 'dev' || mode === 'build')
  run('tauri', [mode, ...(mode === 'build' ? ['--no-bundle'] : [])]);
else if (mode === 'test') run('vitest', ['run']);
else if (mode === 'check') {
  run('eslint', ['src', 'vite.config.ts', 'eslint.config.mjs', 'scripts/test-profile.mjs']);
  run('tsc', ['--noEmit']);
  run('vitest', ['run']);
  const manifest = ['--manifest-path', 'src-tauri/Cargo.toml'];
  run('cargo', ['fmt', ...manifest, '--check']);
  run('cargo', ['clippy', ...manifest, '--all-targets', '--', '-D', 'warnings']);
  run('cargo', ['test', ...manifest]);
} else throw new Error('Expected dev, build, test or check');
