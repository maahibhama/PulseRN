import { useMemo, useRef, useState } from 'react';
import type { AppearanceState, ThemeDefinition } from '../../preload/api.js';

function contrastRatio(left: string, right: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map(
      (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
    );
    const linear = channels.map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  };
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function AppearanceSettings({
  appearance,
  onChange,
}: {
  appearance?: AppearanceState;
  onChange(state: AppearanceState): void;
}) {
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<ThemeDefinition>();
  const [systemFamily, setSystemFamily] = useState('');
  const [localFonts, setLocalFonts] = useState<{ family: string; style: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const selectedId = appearance?.mode === 'fixed' ? appearance.fixedThemeId : undefined;
  const selected = useMemo(
    () => appearance?.themes.find((theme) => theme.id === editingId),
    [appearance, editingId],
  );
  if (!appearance)
    return (
      <section className="settings-card">
        <header>
          <strong>Appearance</strong>
          <small>Loading themes…</small>
        </header>
      </section>
    );

  const run = async (action: () => Promise<AppearanceState>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      onChange(await action());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Appearance update failed.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const edit = (theme: ThemeDefinition) => {
    if (theme.builtin) {
      void run(async () => {
        const state = await window.pulseRN.duplicateTheme(theme.id);
        const copy = state.themes.at(-1);
        if (copy) {
          setEditingId(copy.id);
          setDraft(copy);
        }
        return state;
      });
    } else {
      setEditingId(theme.id);
      setDraft(structuredClone(theme));
    }
  };
  const save = () =>
    draft &&
    void run(async () => {
      const theme: Omit<ThemeDefinition, 'builtin'> = {
        schemaVersion: draft.schemaVersion,
        id: draft.id,
        name: draft.name,
        colorScheme: draft.colorScheme,
        colors: draft.colors,
        gradient: draft.gradient,
        uiFontId: draft.uiFontId,
        codeFontId: draft.codeFontId,
      };
      const state = await window.pulseRN.saveTheme(theme);
      setDraft(state.themes.find((entry) => entry.id === draft.id));
      return state;
    });
  const fontOptions = [
    <option key="default" value="">
      Default
    </option>,
    ...appearance.fonts.map((font) => (
      <option key={font.id} value={font.id}>
        {font.family} · {font.source}
      </option>
    )),
  ];

  return (
    <section className="settings-card appearance-settings">
      <header>
        <strong>Appearance</strong>
        <small>Themes, gradients, and typography</small>
      </header>
      <div className="appearance-mode">
        <label>
          <span>Mode</span>
          <select
            value={appearance.mode}
            onChange={(event) =>
              void run(() =>
                window.pulseRN.updateAppearanceSelection({
                  mode: event.target.value as 'system' | 'fixed',
                }),
              )
            }
          >
            <option value="system">Follow system</option>
            <option value="fixed">Fixed theme</option>
          </select>
        </label>
        {appearance.mode === 'system' ? (
          <>
            <label>
              <span>Light theme</span>
              <select
                value={appearance.lightThemeId}
                onChange={(event) =>
                  void run(() =>
                    window.pulseRN.updateAppearanceSelection({ lightThemeId: event.target.value }),
                  )
                }
              >
                {appearance.themes
                  .filter((theme) => theme.colorScheme === 'light')
                  .map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {theme.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>Dark theme</span>
              <select
                value={appearance.darkThemeId}
                onChange={(event) =>
                  void run(() =>
                    window.pulseRN.updateAppearanceSelection({ darkThemeId: event.target.value }),
                  )
                }
              >
                {appearance.themes
                  .filter((theme) => theme.colorScheme === 'dark')
                  .map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {theme.name}
                    </option>
                  ))}
              </select>
            </label>
          </>
        ) : null}
      </div>
      <div className="theme-gallery">
        {appearance.themes.map((theme) => (
          <div
            key={theme.id}
            className={selectedId === theme.id ? 'theme-card active' : 'theme-card'}
          >
            <button
              className="theme-select"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  window.pulseRN.updateAppearanceSelection({
                    mode: 'fixed',
                    fixedThemeId: theme.id,
                  }),
                )
              }
            >
              <i
                style={{
                  background: theme.gradient.enabled
                    ? `linear-gradient(${theme.gradient.angle}deg, ${theme.gradient.stops.map((stop) => `${stop.color} ${stop.position}%`).join(',')})`
                    : theme.colors.accent,
                }}
              />
              <strong>{theme.name}</strong>
              <small>
                {theme.colorScheme}
                {theme.builtin ? ' · built-in' : ' · custom'}
              </small>
            </button>
            <button className="theme-card-action" disabled={busy} onClick={() => edit(theme)}>
              {theme.builtin ? 'Duplicate & edit' : 'Edit'}
            </button>
          </div>
        ))}
      </div>
      <div className="appearance-actions">
        <button onClick={() => void run(() => window.pulseRN.importTheme())}>Import theme</button>
        <button
          onClick={() => void window.pulseRN.exportTheme(selectedId ?? appearance.fixedThemeId)}
        >
          Export selected
        </button>
        <button onClick={() => void run(() => window.pulseRN.importFont())}>
          Import font file
        </button>
      </div>
      <div className="system-font-add">
        <input
          placeholder="Installed font family, e.g. Avenir"
          value={systemFamily}
          onChange={(event) => setSystemFamily(event.target.value)}
        />
        <button
          disabled={!systemFamily.trim()}
          onClick={() =>
            void run(async () => {
              const family = systemFamily.trim();
              if (!document.fonts.check(`12px "${family}"`))
                throw new Error(`${family} is not available on this system.`);
              setSystemFamily('');
              return window.pulseRN.registerSystemFont({ family, style: 'normal', weight: 400 });
            })
          }
        >
          Add system font
        </button>
        <button
          onClick={() =>
            void (async () => {
              setError('');
              try {
                const query = (
                  window as typeof window & {
                    queryLocalFonts?: () => Promise<{ family: string; style: string }[]>;
                  }
                ).queryLocalFonts;
                if (!query) throw new Error('System font browsing is unavailable in this build.');
                const fonts = await query();
                const unique = new Map(
                  fonts.map((font) => [`${font.family}:${font.style}`, font] as const),
                );
                setLocalFonts(
                  [...unique.values()].sort((left, right) =>
                    left.family.localeCompare(right.family),
                  ),
                );
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : 'Unable to enumerate system fonts.',
                );
              }
            })()
          }
        >
          Browse system fonts
        </button>
      </div>
      {localFonts.length > 0 && (
        <div className="local-font-browser">
          {localFonts.slice(0, 300).map((font) => (
            <button
              key={`${font.family}:${font.style}`}
              style={{ fontFamily: font.family }}
              onClick={() =>
                void run(() =>
                  window.pulseRN.registerSystemFont({
                    family: font.family,
                    style: font.style || 'normal',
                    weight: 400,
                  }),
                )
              }
            >
              <strong>{font.family}</strong>
              <small>{font.style || 'Regular'}</small>
            </button>
          ))}
        </div>
      )}
      {draft && selected && (
        <div className="theme-editor">
          <header>
            <div>
              <strong>Edit {draft.name}</strong>
              <small>Changes preview after saving</small>
            </div>
            <button
              onClick={() => {
                setDraft(undefined);
                setEditingId(undefined);
              }}
            >
              Close
            </button>
          </header>
          <label>
            <span>Name</span>
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            <span>Color scheme</span>
            <select
              value={draft.colorScheme}
              onChange={(event) =>
                setDraft({ ...draft, colorScheme: event.target.value as 'dark' | 'light' })
              }
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <div className="theme-colors">
            {Object.entries(draft.colors).map(([key, value]) => (
              <label key={key}>
                <span>{key}</span>
                <input
                  type="color"
                  value={value.slice(0, 7)}
                  onChange={(event) =>
                    setDraft({ ...draft, colors: { ...draft.colors, [key]: event.target.value } })
                  }
                />
                <code>{value}</code>
              </label>
            ))}
          </div>
          <div className="contrast-status">
            {[
              ['Primary text', draft.colors.text, draft.colors.background, 4.5],
              ['Muted text', draft.colors.muted, draft.colors.background, 3],
              ['Panel text', draft.colors.text, draft.colors.panel, 4.5],
            ].map(([label, foreground, background, minimum]) => {
              const ratio = contrastRatio(String(foreground), String(background));
              return (
                <span className={ratio >= Number(minimum) ? 'pass' : 'fail'} key={String(label)}>
                  {String(label)} {ratio.toFixed(1)}:1
                </span>
              );
            })}
          </div>
          <div className="gradient-editor">
            <label>
              <span>Accent gradient</span>
              <input
                type="checkbox"
                checked={draft.gradient.enabled}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    gradient: { ...draft.gradient, enabled: event.target.checked },
                  })
                }
              />
            </label>
            <label>
              <span>Angle</span>
              <input
                type="range"
                min="0"
                max="360"
                value={draft.gradient.angle}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    gradient: { ...draft.gradient, angle: Number(event.target.value) },
                  })
                }
              />
              <code>{draft.gradient.angle}°</code>
            </label>
            {draft.gradient.stops.map((stop, index) => (
              <label key={index}>
                <span>Stop {index + 1}</span>
                <input
                  type="color"
                  value={stop.color.slice(0, 7)}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      gradient: {
                        ...draft.gradient,
                        stops: draft.gradient.stops.map((entry, stopIndex) =>
                          stopIndex === index ? { ...entry, color: event.target.value } : entry,
                        ),
                      },
                    })
                  }
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={stop.position}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      gradient: {
                        ...draft.gradient,
                        stops: draft.gradient.stops.map((entry, stopIndex) =>
                          stopIndex === index
                            ? { ...entry, position: Number(event.target.value) }
                            : entry,
                        ),
                      },
                    })
                  }
                />
              </label>
            ))}
            <div className="gradient-actions">
              <button
                disabled={draft.gradient.stops.length >= 4}
                onClick={() =>
                  setDraft({
                    ...draft,
                    gradient: {
                      ...draft.gradient,
                      stops: [
                        ...draft.gradient.stops,
                        { color: draft.colors.accent, position: 50 },
                      ].sort((left, right) => left.position - right.position),
                    },
                  })
                }
              >
                Add stop
              </button>
              <button
                disabled={draft.gradient.stops.length <= 2}
                onClick={() =>
                  setDraft({
                    ...draft,
                    gradient: { ...draft.gradient, stops: draft.gradient.stops.slice(0, -1) },
                  })
                }
              >
                Remove stop
              </button>
              <button
                onClick={() =>
                  setDraft({
                    ...draft,
                    gradient: {
                      ...draft.gradient,
                      stops: draft.gradient.stops
                        .map((stop) => ({ ...stop, position: 100 - stop.position }))
                        .reverse(),
                    },
                  })
                }
              >
                Reverse
              </button>
            </div>
          </div>
          <label>
            <span>Interface font</span>
            <select
              value={draft.uiFontId ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, uiFontId: event.target.value || undefined })
              }
            >
              {fontOptions}
            </select>
          </label>
          <label>
            <span>Code font</span>
            <select
              value={draft.codeFontId ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, codeFontId: event.target.value || undefined })
              }
            >
              {fontOptions}
            </select>
          </label>
          <div
            className="theme-preview"
            style={{
              background: draft.colors.background,
              color: draft.colors.text,
              fontFamily: appearance.fonts.find((font) => font.id === draft.uiFontId)?.family,
            }}
          >
            <strong style={{ color: draft.colors.accent }}>PulseRN theme preview</strong>
            <span style={{ color: draft.colors.muted }}>
              Timeline text and supporting information
            </span>
            <button
              style={{
                background: draft.gradient.enabled
                  ? `linear-gradient(${draft.gradient.angle}deg, ${draft.gradient.stops.map((stop) => `${stop.color} ${stop.position}%`).join(',')})`
                  : draft.colors.accent,
              }}
            >
              Primary action
            </button>
          </div>
          <footer>
            <button onClick={save}>Save theme</button>
            <button
              className="danger-button"
              onClick={() =>
                void run(async () => {
                  const state = await window.pulseRN.deleteTheme(draft.id);
                  setDraft(undefined);
                  setEditingId(undefined);
                  return state;
                })
              }
            >
              Delete
            </button>
          </footer>
        </div>
      )}
      {appearance.fonts.length > 0 && (
        <div className="font-list">
          {appearance.fonts.map((font) => (
            <div key={font.id}>
              <span style={{ fontFamily: font.family }}>
                <strong>{font.family}</strong>
                <small>
                  {font.source} · {font.weight}
                </small>
              </span>
              <button onClick={() => void run(() => window.pulseRN.deleteFont(font.id))}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <small className="settings-error">{error}</small>}
    </section>
  );
}
