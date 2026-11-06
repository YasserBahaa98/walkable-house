import { ProductImportError, type MessagesClient } from './product';

// The Anthropic SDK is only loaded when someone uses "Add from photo or link",
// so it adds nothing to the app's start-up download.

const KEY = 'walkable-house:anthropic-key';

/** The API key saved in this browser, if any. */
export function savedKey(): string {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}
export function saveKey(key: string) {
  try { localStorage.setItem(KEY, key); } catch { /* private mode: keep for this session only */ }
}
export function forgetKey() {
  try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
}

export async function makeClient(apiKey: string): Promise<MessagesClient> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // The key is the user's own, typed into their own browser, and only sent to Anthropic.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 }) as unknown as MessagesClient;
}

/** A user-facing error for anything the SDK throws. */
export async function explainError(e: unknown): Promise<ProductImportError> {
  if (e instanceof ProductImportError) return e;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  if (e instanceof Anthropic.AuthenticationError) return new ProductImportError('That API key was not accepted. Check it and try again.', 'auth');
  if (e instanceof Anthropic.PermissionDeniedError) return new ProductImportError('This API key cannot use the model or web fetch. Check its workspace settings in the Anthropic Console.', 'auth');
  if (e instanceof Anthropic.RateLimitError) return new ProductImportError('Too many requests right now. Wait a moment and try again.', 'rate');
  if (e instanceof Anthropic.APIUserAbortError) return new ProductImportError('Cancelled.');
  if (e instanceof Anthropic.APIConnectionError) return new ProductImportError('Could not reach Anthropic. Check your connection.', 'network');
  if (e instanceof Anthropic.BadRequestError) return new ProductImportError(`The request was rejected: ${e.message}`);
  if (e instanceof Anthropic.APIError) return new ProductImportError(`Anthropic returned an error (${e.status ?? 'unknown'}). Please try again.`);
  return new ProductImportError(e instanceof Error ? e.message : 'Something went wrong.');
}
