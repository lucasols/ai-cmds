import { openai, type OpenAIResponsesProviderOptions } from '@ai-sdk/openai';
import type {
  CustomModelConfig,
  ReviewCodeChangesConfig,
  SetupConfig,
} from '../../lib/config.ts';
import type { Model } from './types.ts';

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

const OPENAI_MINIMAL_PROVIDER_OPTIONS = {
  openai: {
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

const gpt5ModelMinimal: Model = {
  model: openai('gpt-5.2-codex'),
  config: {
    topP: false,
    providerOptions: OPENAI_MINIMAL_PROVIDER_OPTIONS,
  },
};

export type ReviewSetupConfig = {
  reviewers: Model[];
  validator: Model;
};

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
  if (setupId in DEFAULT_SETUPS) {
    const builtIn = DEFAULT_SETUPS[setupId as keyof typeof DEFAULT_SETUPS];
    return convertCustomSetup(builtIn, config);
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
  return Object.keys(DEFAULT_SETUPS);
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
const xhighModel: CustomModelConfig = {
  model: gpt5ModelHigh.model,
  providerOptions: OPENAI_XHIGH_PROVIDER_OPTIONS,
};

const minimalModel: CustomModelConfig = {
  model: gpt5ModelMinimal.model,
  providerOptions: OPENAI_MINIMAL_PROVIDER_OPTIONS,
};

const mediumModel: CustomModelConfig = {
  model: gpt5Model.model,
  providerOptions: OPENAI_MEDIUM_PROVIDER_OPTIONS,
};

export const DEFAULT_SETUPS = {
  light: {
    id: 'light',
    label: 'Light - 1 GPT-5 minimal reviewer',
    reviewers: [minimalModel],
    validator: minimalModel,
  },
  medium: {
    id: 'medium',
    label: 'Medium - 1 GPT-5 medium reviewer',
    reviewers: [mediumModel],
    validator: minimalModel,
  },
  heavy: {
    id: 'heavy',
    label: 'Heavy - 2 GPT-5 medium reviewers',
    reviewers: Array.from({ length: 2 }, () => mediumModel),
    validator: minimalModel,
  },
  xheavy: {
    id: 'xheavy',
    label: 'X-Heavy - 2 GPT-5 xhigh reviewers',
    reviewers: Array.from({ length: 2 }, () => xhighModel),
    validator: minimalModel,
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
