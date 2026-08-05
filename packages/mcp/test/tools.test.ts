import { describe, expect, it } from 'vitest';
import { PULSERN_MCP_TOOLS } from '../src/index.js';

describe('PulseRN MCP tool catalog', () => {
  it('publishes unique, namespaced tools with closed object schemas', () => {
    const names = PULSERN_MCP_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.startsWith('pulsern_'))).toBe(true);
    expect(PULSERN_MCP_TOOLS.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(
      true,
    );
  });

  it('includes diagnostic, debugger, and storage capabilities', () => {
    const names = new Set(PULSERN_MCP_TOOLS.map((tool) => tool.name));
    expect(names.has('pulsern_query_events')).toBe(true);
    expect(names.has('pulsern_evaluate')).toBe(true);
    expect(names.has('pulsern_set_storage')).toBe(true);
    expect(names.has('pulsern_inspect_animations_worklets')).toBe(true);
  });
});
