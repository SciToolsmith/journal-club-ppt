import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const PALETTE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/theme-palettes.json');
const REQUIRED = ['primary','light','rule','ink','gray','white','on_primary','muted_on_primary'];
export function getTheme(themeId) {
  if (typeof themeId !== 'string' || !themeId) throw new Error('An explicit supported theme_id is required');
  const registry = JSON.parse(fs.readFileSync(PALETTE_PATH, 'utf8'));
  const theme = registry.themes.find(item => item.theme_id === themeId);
  if (!theme) throw new Error(`Unknown theme_id: ${themeId}. Use a user-confirmed blue, teal, red or purple theme.`);
  if (REQUIRED.some(key => !/^#[0-9A-F]{6}$/.test(theme.colors?.[key] || ''))) throw new Error(`Invalid palette for ${themeId}`);
  const colors = Object.freeze({ ...theme.colors });
  // Matches workflow.get-theme: compact JSON, color keys sorted, SHA256.
  const serialized = JSON.stringify(Object.fromEntries(Object.keys(colors).sort().map(key => [key, colors[key]])));
  return { ...theme, colors, palette_sha256:createHash('sha256').update(serialized).digest('hex') };
}
