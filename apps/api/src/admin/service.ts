import type { AdministratorOverview } from '@lasuatos/contracts';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import type { AdministratorOverviewRepository } from './repository.js';

export class AdministratorOverviewService {
  readonly #repository: AdministratorOverviewRepository;

  constructor(options: { readonly repository: AdministratorOverviewRepository }) {
    this.#repository = options.repository;
  }

  getOverview(account: AdministratorSessionAccount): Promise<AdministratorOverview> {
    return this.#repository.getOverview(account);
  }
}
