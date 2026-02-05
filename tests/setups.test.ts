import { openai } from '@ai-sdk/openai';
import { describe, expect, it } from 'vitest';
import type { ReviewCodeChangesConfig } from '../src/lib/config.ts';
import {
  resolveSetup,
  reviewSetupConfigs,
} from '../src/commands/shared/setups.ts';

describe('resolveSetup', () => {
  it('returns built-in setup without formatter', () => {
    const setup = reviewSetupConfigs.light;
    expect(setup).toHaveProperty('validator');
    expect(setup).toHaveProperty('reviewers');
    expect('formatter' in setup).toBe(false);
  });

  it('resolves custom setup and applies defaultValidator fallback', () => {
    const config: ReviewCodeChangesConfig = {
      defaultValidator: { model: openai('gpt-5.2') },
      setup: [
        {
          id: 'custom',
          label: 'Custom',
          reviewers: [{ model: openai('gpt-5.2') }],
        },
      ],
    };

    const setup = resolveSetup(config, 'custom');
    expect(setup).toBeDefined();
    expect(setup?.reviewers).toHaveLength(1);
    expect(setup?.validator).toBeDefined();
    expect(setup && 'formatter' in setup).toBe(false);
  });
});
