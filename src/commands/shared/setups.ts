import { openai, type OpenAIResponsesProviderOptions } from '@ai-sdk/openai';
import type {
  CustomModelConfig,
  ReviewCodeChangesConfig,
  SetupConfig,
} from '../../lib/config.ts';
import type { Model, ReviewSetup } from './types.ts';

const OPENAI_MEDIUM_PROVIDER_OPTIONS = {
  openai: {
    reasoningEffort: 'medium',
    reasoningSummary: 'auto',
  } satisfies OpenAIResponsesProviderOptions,
};

const OPENAI_XHIGH_PROVIDER_OPTIONS = {
  openai: {
    reasoningEffort: 'xhigh',
    reasoningSummary: 'auto',
  } satisfies OpenAIResponsesProviderOptions,
};

const OPENAI_LOW_PROVIDER_OPTIONS = {
  openai: {
    reasoningEffort: 'low',
    reasoningSummary: 'auto',
  } satisfies OpenAIResponsesProviderOptions,
};

export const gpt5Model: Model = {
  model: openai('gpt-5.2-codex'),
  config: {
    topP: false,
    providerOptions: OPENAI_MEDIUM_PROVIDER_OPTIONS,
  },
};

export const gpt5ModelHigh: Model = {
  model: openai('gpt-5.2-codex'),
  config: {
    topP: false,
    providerOptions: OPENAI_XHIGH_PROVIDER_OPTIONS,
  },
};

const gpt5ModelLow: Model = {
  model: openai('gpt-5.2-codex'),
  config: {
    topP: false,
    providerOptions: OPENAI_LOW_PROVIDER_OPTIONS,
  },
};

export type ReviewSetupConfig = {
  reviewers: Model[];
  validator: Model;
};

export const reviewSetupConfigs: Record<ReviewSetup, ReviewSetupConfig> = {
  light: {
    reviewers: [gpt5Model],
    validator: gpt5ModelLow,
  },
  medium: {
    reviewers: [gpt5Model, gpt5Model],
    validator: gpt5ModelLow,
  },
  heavy: {
    reviewers: [gpt5ModelHigh, gpt5ModelHigh],
    validator: gpt5ModelLow,
  },
};

export function isGoogleSetup(setup: ReviewSetup): boolean {
  return setup.endsWith('Google');
}

function toModel(cfg: CustomModelConfig): Model {
  return {
    model: cfg.model,
    label: cfg.label,
    config:
      cfg.providerOptions ?
        { providerOptions: cfg.providerOptions }
      : undefined,
  };
}

function convertCustomSetup(
  setup: SetupConfig,
  config: ReviewCodeChangesConfig,
): ReviewSetupConfig {
  const reviewers: Model[] = setup.reviewers.map(toModel);

  // Priority: setup.validator > config.defaultValidator > first reviewer
  const validator: Model =
    setup.validator ? toModel(setup.validator)
    : config.defaultValidator ? toModel(config.defaultValidator)
    : (reviewers[0] ?? gpt5ModelHigh);

  return { reviewers, validator };
}

/**
 * Resolves a setup by id. Checks custom setups first, then built-in presets.
 * Returns undefined if no setup is specified (to trigger interactive selection).
 */
export function resolveSetup(
  config: ReviewCodeChangesConfig,
  setupId?: string,
): ReviewSetupConfig | undefined {
  if (!setupId) {
    return undefined;
  }

  // First check custom setups by id
  const customSetup = config.setup?.find((s) => s.id === setupId);
  if (customSetup) {
    return convertCustomSetup(customSetup, config);
  }

  // Then check built-in presets
  if (setupId in reviewSetupConfigs) {
    return reviewSetupConfigs[setupId as ReviewSetup];
  }

  return undefined;
}

/**
 * Get all available setup ids (built-in + custom).
 */
export function getAvailableSetups(config: ReviewCodeChangesConfig): string[] {
  // If custom setups are configured, only show those
  if (config.setup && config.setup.length > 0) {
    return config.setup.map((s) => s.id);
  }
  // Otherwise show built-in presets
  return Object.keys(reviewSetupConfigs);
}

/**
 * Built-in setup options that users can include in their config.
 * When custom setups are configured, they replace built-in options.
 * Use this export to include built-in options alongside custom ones:
 *
 * @example
 * ```typescript
 * import { defineConfig, BUILT_IN_SETUP_OPTIONS } from 'ai-cmds';
 *
 * export default defineConfig({
 *   reviewCodeChanges: {
 *     setup: [
 *       ...BUILT_IN_SETUP_OPTIONS,
 *       { label: 'myCustomSetup', reviewers: [...] },
 *     ],
 *   },
 * });
 * ```
 */
export const DEFAULT_SETUPS = {
  light: {
    id: 'light',
    label: 'Light - 1 GPT-5 reviewer',
    reviewers: [{ model: gpt5Model.model }],
  },
  medium: {
    id: 'medium',
    label: 'Medium - 2 GPT-5 reviewers',
    reviewers: [
      {
        model: gpt5ModelHigh.model,
        providerOptions: OPENAI_XHIGH_PROVIDER_OPTIONS,
      },
      {
        model: gpt5ModelHigh.model,
        providerOptions: OPENAI_XHIGH_PROVIDER_OPTIONS,
      },
    ],
  },
  heavy: {
    id: 'heavy',
    label: 'Heavy - 4 GPT-5 reviewers',
    reviewers: [
      {
        model: gpt5ModelHigh.model,
        providerOptions: OPENAI_XHIGH_PROVIDER_OPTIONS,
      },
      {
        model: gpt5ModelHigh.model,
        providerOptions: OPENAI_XHIGH_PROVIDER_OPTIONS,
      },
      {
        model: gpt5ModelHigh.model,
        providerOptions: OPENAI_XHIGH_PROVIDER_OPTIONS,
      },
      {
        model: gpt5ModelHigh.model,
        providerOptions: OPENAI_XHIGH_PROVIDER_OPTIONS,
      },
    ],
  },
} as const satisfies Record<string, SetupConfig>;

export const BUILT_IN_SETUP_OPTIONS: SetupConfig[] =
  Object.values(DEFAULT_SETUPS);

/**
 * Converts setup configs to CLI select options.
 */
export function setupConfigsToOptions(
  setups: SetupConfig[],
): Array<{ value: string; label: string }> {
  return setups.map((s) => ({
    value: s.id,
    label: s.label,
  }));
}
