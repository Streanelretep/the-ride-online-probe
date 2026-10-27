import { ChatGptConnections } from "./chatgpt-connections";
import {
  listProbeModels,
  runProbe,
  ProbeError,
  probeErrorMessage,
} from "./chatgpt-probe";
import {
  SubscriptionError,
  subscriptionMessage,
  refreshCredential,
  revokeCredential,
} from "./chatgpt-oauth";
export function subscriptionActionError(error: unknown) {
  return error instanceof ProbeError
    ? probeErrorMessage(error)
    : subscriptionMessage(error);
}
export class ChatGptService {
  constructor(
    private repo: ChatGptConnections,
    private fetcher: typeof fetch = fetch,
  ) {}
  async models() {
    const { credential } = await this.repo.access((old) =>
      refreshCredential(old, this.fetcher),
    );
    return listProbeModels(credential, this.fetcher);
  }
  async test(model: string) {
    await this.repo.claimTest();
    const { credential, version } = await this.repo.access((old) =>
      refreshCredential(old, this.fetcher),
    );
    const models = await listProbeModels(credential, this.fetcher);
    if (!models.some((item) => item.slug === model))
      throw new SubscriptionError("INVALID_MODEL");
    await this.repo.assertCurrent(version);
    await runProbe(credential, model, this.fetcher);
    await this.repo.finishTest(version);
  }
  async disconnect() {
    return this.repo.disconnect((credential) =>
      revokeCredential(credential, this.fetcher),
    );
  }
}
