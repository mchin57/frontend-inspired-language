// Token counting via a real BPE tokenizer. We use o200k_base as a proxy: Anthropic's
// production tokenizer is not public, but BPE token counts correlate closely enough
// across modern tokenizers for A/B-testing syntax decisions.

import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';

export function tokenCount(text: string): number {
  return countTokens(text);
}
