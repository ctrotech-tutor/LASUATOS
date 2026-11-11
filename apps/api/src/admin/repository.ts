import type { AdministratorOverview } from '@lasuatos/contracts';
import type { AdministratorSessionAccount } from '../auth/repository.js';

export interface AdministratorOverviewRepository {
  getOverview(account: AdministratorSessionAccount): Promise<AdministratorOverview>;
}
