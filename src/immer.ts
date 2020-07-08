import { DocumentNode, FragmentDefinitionNode } from "graphql";
import { MutationUpdaterFn } from "apollo-client";
import { DataProxy } from "apollo-cache";
import { FetchResult } from "apollo-link";
import produce, { Draft } from "immer";

interface PatchQueryOptions {
  query: DocumentNode;
  variables?: {
    [key: string]: any;
  };
  /**
   * Query may not yet be in the Apollo Cache
   */
  isLazy?: boolean;
}

interface PatchFragmentOptions {
  fragment: DocumentNode;
  fragmentName?: string;
  id: string;
}

function patchQueryFactory(cache: DataProxy) {
  return function patchQuery<R>(
    { query, variables, isLazy }: PatchQueryOptions,
    patchFn: (data: Draft<R>) => void
  ): R {
    try {
      const options = { query, variables };
      const obj: any = cache.readQuery(options);
      const data = produce<R>(obj, patchFn);

      cache.writeQuery({
        ...options,
        data,
      });

      return data;
    } catch (error) {
      if (isLazy && error.message.indexOf("Can't find field") !== -1) {
        console.warn(error);
      } else {
        throw error;
      }
    }
  };
}

function patchFragmentFactory(cache: DataProxy) {
  return function patchFragment<R>(
    { id, fragment, fragmentName }: PatchFragmentOptions,
    patchFn: (data: Draft<R>) => void
  ): void {
    const typename = getFragmentTypename(fragment);

    const frgmt: any = cache.readFragment({
      fragment,
      fragmentName,
      id,
    });
    const data = produce<R>(frgmt, patchFn);

    cache.writeFragment({
      fragment,
      fragmentName,
      id,
      data: {
        ...data,
        __typename: typename,
      },
    });
  };
}

function getFragmentTypename(fragment: DocumentNode): string {
  const def = fragment.definitions.find(
    (d) => d.kind === "FragmentDefinition"
  ) as FragmentDefinitionNode;

  return def.typeCondition.name.value;
}

export interface DataProxyWithHelpers extends DataProxy {
  patchQuery: ReturnType<typeof patchQueryFactory>;
  patchFragment: ReturnType<typeof patchFragmentFactory>;
}

export type UpdaterFn<T = { [key: string]: any }> = (
  proxy: DataProxyWithHelpers,
  mutationResult: FetchResult<T>
) => void;

export function update<T>(updater: UpdaterFn<T>): MutationUpdaterFn<T> {
  return (proxy, mutationResult) => {
    const proxyWithHelpers: DataProxyWithHelpers = proxy as any;

    proxyWithHelpers.patchFragment = patchFragmentFactory(proxy);
    proxyWithHelpers.patchQuery = patchQueryFactory(proxy);

    updater(proxyWithHelpers, mutationResult);
  };
}
