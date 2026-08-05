import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const color = z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
const identifier = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9_-]+$/);
export const gradientSchema = z.object({
  enabled: z.boolean(),
  angle: z.number().finite().min(0).max(360),
  stops: z
    .array(z.object({ color, position: z.number().min(0).max(100) }))
    .min(2)
    .max(4),
});
export const themeDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  name: z.string().trim().min(1).max(80),
  colorScheme: z.enum(['dark', 'light']),
  builtin: z.boolean(),
  colors: z.object({
    accent: color,
    background: color,
    panel: color,
    panelSoft: color,
    border: color,
    text: color,
    muted: color,
    success: color,
    warning: color,
    danger: color,
    selection: color,
    codeBackground: color,
  }),
  gradient: gradientSchema,
  uiFontId: z.string().max(128).optional(),
  codeFontId: z.string().max(128).optional(),
});
export type ThemeDefinition = z.infer<typeof themeDefinitionSchema>;

export const fontDefinitionSchema = z.object({
  id: identifier,
  family: z.string().trim().min(1).max(256),
  style: z.string().max(64),
  weight: z.number().int().min(100).max(900),
  source: z.enum(['system', 'imported']),
  fileName: z
    .string()
    .regex(/^[a-f0-9]{64}\.(ttf|otf|woff|woff2)$/)
    .optional(),
  format: z.enum(['truetype', 'opentype', 'woff', 'woff2']).optional(),
});
export type FontDefinition = z.infer<typeof fontDefinitionSchema>;

export const appearanceStateSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(['system', 'fixed']),
  fixedThemeId: identifier,
  lightThemeId: identifier,
  darkThemeId: identifier,
  themes: z.array(themeDefinitionSchema).max(100),
  fonts: z.array(fontDefinitionSchema).max(200),
});
export type AppearanceState = z.infer<typeof appearanceStateSchema>;

const baseDark = {
  accent: '#a794ff',
  background: '#0b0d12',
  panel: '#11151c',
  panelSoft: '#171b24',
  border: '#292f3b',
  text: '#cbd1dc',
  muted: '#697285',
  success: '#42d392',
  warning: '#dbb760',
  danger: '#ed858d',
  selection: '#2b2348',
  codeBackground: '#0d1016',
};
const baseLight = {
  accent: '#6548d8',
  background: '#f5f7fb',
  panel: '#ffffff',
  panelSoft: '#eef1f7',
  border: '#dce2ec',
  text: '#172038',
  muted: '#68748a',
  success: '#16865e',
  warning: '#9a6a12',
  danger: '#c63f58',
  selection: '#ede9ff',
  codeBackground: '#f7f8fb',
};
const preset = (
  id: string,
  name: string,
  colorScheme: 'dark' | 'light',
  colors: ThemeDefinition['colors'],
  stops: [string, string],
): ThemeDefinition => ({
  schemaVersion: 1,
  id,
  name,
  colorScheme,
  builtin: true,
  colors,
  gradient: {
    enabled: true,
    angle: 135,
    stops: [
      { color: stops[0], position: 0 },
      { color: stops[1], position: 100 },
    ],
  },
});
export const BUILTIN_THEMES: ThemeDefinition[] = [
  preset('pulse-dark', 'Pulse Dark', 'dark', baseDark, ['#7b5cff', '#3fb8d7']),
  preset('pulse-light', 'Pulse Light', 'light', baseLight, ['#6548d8', '#2f9fbd']),
  preset(
    'midnight',
    'Midnight',
    'dark',
    {
      ...baseDark,
      background: '#070b16',
      panel: '#0d1424',
      panelSoft: '#141e31',
      accent: '#6ea8ff',
    },
    ['#4068d8', '#8d5bd7'],
  ),
  preset(
    'nord',
    'Nord',
    'dark',
    {
      ...baseDark,
      background: '#242933',
      panel: '#2e3440',
      panelSoft: '#3b4252',
      text: '#eceff4',
      muted: '#9aa6b8',
      accent: '#88c0d0',
    },
    ['#5e81ac', '#b48ead'],
  ),
  preset(
    'solarized-dark',
    'Solarized Dark',
    'dark',
    {
      ...baseDark,
      background: '#002b36',
      panel: '#073642',
      panelSoft: '#0b4552',
      text: '#eee8d5',
      muted: '#839496',
      accent: '#2aa198',
    },
    ['#268bd2', '#2aa198'],
  ),
  preset(
    'high-contrast',
    'High Contrast',
    'dark',
    {
      ...baseDark,
      background: '#000000',
      panel: '#080808',
      panelSoft: '#151515',
      border: '#ffffff',
      text: '#ffffff',
      muted: '#d0d0d0',
      accent: '#d6b4ff',
    },
    ['#9d5cff', '#00d9ff'],
  ),
];

const defaults = (): AppearanceState => ({
  schemaVersion: 1,
  mode: 'system',
  fixedThemeId: 'pulse-dark',
  lightThemeId: 'pulse-light',
  darkThemeId: 'pulse-dark',
  themes: structuredClone(BUILTIN_THEMES),
  fonts: [],
});

export class AppearanceStore {
  private state: AppearanceState;
  constructor(
    private readonly filePath: string,
    legacyTheme?: 'system' | 'dark' | 'light',
  ) {
    this.state = this.read(legacyTheme);
  }
  get(): AppearanceState {
    return structuredClone(this.state);
  }
  updateSelection(value: unknown): AppearanceState {
    const patch = z
      .object({
        mode: z.enum(['system', 'fixed']).optional(),
        fixedThemeId: identifier.optional(),
        lightThemeId: identifier.optional(),
        darkThemeId: identifier.optional(),
      })
      .strict()
      .parse(value);
    const next = { ...this.state, ...patch };
    for (const id of [next.fixedThemeId, next.lightThemeId, next.darkThemeId]) {
      if (!next.themes.some((theme) => theme.id === id)) throw new Error(`Unknown theme: ${id}`);
    }
    this.state = appearanceStateSchema.parse(next);
    this.write();
    return this.get();
  }
  saveTheme(value: unknown): AppearanceState {
    const incoming = themeDefinitionSchema.omit({ builtin: true }).parse(value);
    const id = incoming.id || `theme-${randomUUID()}`;
    if (BUILTIN_THEMES.some((theme) => theme.id === id))
      throw new Error('Built-in themes are immutable.');
    const theme = themeDefinitionSchema.parse({ ...incoming, id, builtin: false });
    this.state.themes = [...this.state.themes.filter((entry) => entry.id !== id), theme];
    this.write();
    return this.get();
  }
  duplicateTheme(id: string): AppearanceState {
    const source = this.state.themes.find((theme) => theme.id === id);
    if (!source) throw new Error('Theme not found.');
    const copy = {
      ...structuredClone(source),
      id: `theme-${randomUUID()}`,
      name: `${source.name} Copy`,
      builtin: false,
    };
    this.state.themes.push(copy);
    this.write();
    return this.get();
  }
  deleteTheme(id: string): AppearanceState {
    const theme = this.state.themes.find((entry) => entry.id === id);
    if (!theme || theme.builtin) throw new Error('Built-in themes cannot be deleted.');
    this.state.themes = this.state.themes.filter((entry) => entry.id !== id);
    if (this.state.fixedThemeId === id) this.state.fixedThemeId = 'pulse-dark';
    if (this.state.lightThemeId === id) this.state.lightThemeId = 'pulse-light';
    if (this.state.darkThemeId === id) this.state.darkThemeId = 'pulse-dark';
    this.write();
    return this.get();
  }
  addFont(font: FontDefinition): AppearanceState {
    this.state.fonts = [
      ...this.state.fonts.filter((entry) => entry.id !== font.id),
      fontDefinitionSchema.parse(font),
    ];
    this.write();
    return this.get();
  }
  removeFont(id: string): AppearanceState {
    if (this.state.themes.some((theme) => theme.uiFontId === id || theme.codeFontId === id)) {
      throw new Error('This font is used by a theme. Replace it before deleting.');
    }
    this.state.fonts = this.state.fonts.filter((font) => font.id !== id);
    this.write();
    return this.get();
  }
  resolved(prefersDark: boolean): ThemeDefinition {
    const id =
      this.state.mode === 'fixed'
        ? this.state.fixedThemeId
        : prefersDark
          ? this.state.darkThemeId
          : this.state.lightThemeId;
    return (
      this.state.themes.find((theme) => theme.id === id) ?? BUILTIN_THEMES[prefersDark ? 0 : 1]!
    );
  }
  private read(legacy?: 'system' | 'dark' | 'light'): AppearanceState {
    try {
      const parsed = appearanceStateSchema.parse(JSON.parse(readFileSync(this.filePath, 'utf8')));
      return {
        ...parsed,
        themes: [
          ...structuredClone(BUILTIN_THEMES),
          ...parsed.themes.filter((theme) => !theme.builtin),
        ],
      };
    } catch {
      const value = defaults();
      if (legacy && legacy !== 'system') {
        value.mode = 'fixed';
        value.fixedThemeId = `pulse-${legacy}`;
      }
      return value;
    }
  }
  private write(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.filePath);
  }
}
