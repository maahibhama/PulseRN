# Appearance

PulseRN Desktop includes Pulse Dark, Pulse Light, Midnight, Nord, Solarized Dark, and High
Contrast themes. Open **Settings → Appearance** to use one fixed theme or choose separate light and
dark themes that follow the operating system.

Built-in themes are immutable. Choose **Duplicate** to create an editable theme, then customize its
semantic colors, accent gradient, interface font, and code font. The editor reports contrast ratios
for important text combinations and provides an isolated preview before saving.

System fonts can be added by family name or selected from the permission-gated local font browser.
PulseRN can also import `.ttf`, `.otf`, `.woff`, and `.woff2` files up to 20 MiB. Imported files are
validated, copied into PulseRN-managed user storage, and never exposed to the renderer by path.
Make sure you have permission to use imported fonts.

Themes can be exported as versioned JSON and imported on another installation. Font binaries are
never included; unavailable font references use the default system sans-serif or monospace stack
until a matching font is installed.
