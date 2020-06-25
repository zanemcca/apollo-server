import { KeyValueCache } from 'apollo-server-caching';
import { Logger } from 'apollo-server-types';

export interface DataSourceConfig<TContext> {
  // AS3 This can be made required in the next major.
  logger?: Logger;
  context: TContext;
  cache: KeyValueCache;
}

export abstract class DataSource<TContext = any> {
  initialize?(config: DataSourceConfig<TContext>): void | Promise<void>;
}
