import nock from 'nock';
import { ApolloGateway } from '../..';
import {
  mockLocalhostSDLQuery,
  mockStorageSecretSuccess,
  mockCompositionConfigLinkSuccess,
  mockCompositionConfigsSuccess,
  mockImplementingServicesSuccess,
  mockRawPartialSchemaSuccess,
  apiKeyHash,
  graphId,
  mockImplementingServices,
  mockRawPartialSchema,
  mockCompositionConfigLink,
} from './nockMocks';

import loadServicesFromStorage = require("../../loadServicesFromStorage");

// This is a nice DX hack for GraphQL code highlighting and formatting within the file.
// Anything wrapped within the gql tag within this file is just a string, not an AST.
const gql = String.raw;

const service = {
  implementingServicePath: 'service-definition.json',
  partialSchemaPath: 'accounts-partial-schema.json',
  federatedServiceURL: 'http://localhost:4001',
  federatedServiceSchema: gql`
    extend type Query {
      me: User
      everyone: [User]
    }

    "This is my User"
    type User @key(fields: "id") {
      id: ID!
      name: String
      username: String
    }
  `
};

const updatedService = {
  implementingServicePath: 'updated-service-definition.json',
  partialSchemaPath: 'updated-accounts-partial-schema.json',
  federatedServiceURL: 'http://localhost:4002',
  federatedServiceSchema: gql`
    extend type Query {
      me: User
      everyone: [User]
    }

    "This is my updated User"
    type User @key(fields: "id") {
      id: ID!
      name: String
      username: String
    }
  `
}

beforeEach(() => {
  if (!nock.isActive()) nock.activate();
});

afterEach(() => {
  expect(nock.isDone()).toBeTruthy();
  nock.cleanAll();
  nock.restore();
  jest.useRealTimers();
});

it('Queries remote endpoints for their SDLs', async () => {
  mockLocalhostSDLQuery({ url: service.federatedServiceURL }).reply(200, {
    data: { _service: { sdl: service.federatedServiceSchema } },
  });

  const gateway = new ApolloGateway({
    serviceList: [
      { name: 'accounts', url: `${service.federatedServiceURL}/graphql` },
    ],
  });
  await gateway.load();
  expect(gateway.schema!.getType('User')!.description).toBe('This is my User');
});

// This test is maybe a bit terrible, but IDK a better way to mock all the requests
it('Extracts service definitions from remote storage', async () => {
  mockStorageSecretSuccess();
  mockCompositionConfigLinkSuccess();
  mockCompositionConfigsSuccess([service.implementingServicePath]);
  mockImplementingServicesSuccess(service);
  mockRawPartialSchemaSuccess(service);

  const gateway = new ApolloGateway({});

  await gateway.load({ engine: { apiKeyHash, graphId } });
  expect(gateway.schema!.getType('User')!.description).toBe('This is my User');
});

it('warns when a remote and local configuration is present', async () => {
  const spyConsoleWarn = jest.spyOn(console, 'warn');
  let blockerResolve: () => void;
  const blocker = new Promise(resolve => blockerResolve = resolve);
  const original = loadServicesFromStorage.getServiceDefinitionsFromStorage;
  const spyGetServiceDefinitionsFromStorage =
    jest.spyOn(loadServicesFromStorage, 'getServiceDefinitionsFromStorage')
    .mockImplementation(async (...args) => {
      const call = await original(...args);
      setImmediate(blockerResolve);
      return call;
    });

  mockStorageSecretSuccess();
  mockCompositionConfigLinkSuccess();
  mockCompositionConfigsSuccess([service.implementingServicePath]);
  mockImplementingServicesSuccess(service);
  mockRawPartialSchemaSuccess(service);

  mockLocalhostSDLQuery({ url: service.federatedServiceURL }).reply(200, {
    data: { _service: { sdl: service.federatedServiceSchema } },
  });

  const gateway = new ApolloGateway({
    serviceList: [
      { name: 'accounts', url: `${service.federatedServiceURL}/graphql` },
    ],
  });

  await gateway.load({ engine: { apiKeyHash, graphId } });
  await blocker; // Wait for the definitions to be "fetched".

  expect(spyConsoleWarn).toHaveBeenCalledWith(expect.stringMatching(/A local gateway/));
  spyGetServiceDefinitionsFromStorage.mockRestore();
});

it.each([
  ['warned', 'present'],
  ['not warned', 'absent'],
])('conflicting configurations are %s about when %s', async (_word, mode) => {
  const isConflict = mode === 'present';
  const spyConsoleWarn = jest.spyOn(console, 'warn');
  let blockerResolve: () => void;
  const blocker = new Promise(resolve => (blockerResolve = resolve));
  const original = loadServicesFromStorage.getServiceDefinitionsFromStorage;
  const spyGetServiceDefinitionsFromStorage = jest
    .spyOn(loadServicesFromStorage, 'getServiceDefinitionsFromStorage')
    .mockImplementationOnce(async (...args) => {
      try {
        return await original(...args);
      } catch (e) {
        throw e;
      } finally {
        setImmediate(blockerResolve);
      }
    });

  mockStorageSecretSuccess();
  if (isConflict) {
    mockCompositionConfigLinkSuccess();
    mockCompositionConfigsSuccess([service.implementingServicePath]);
    mockImplementingServicesSuccess(service);
    mockRawPartialSchemaSuccess(service);
  } else {
    mockCompositionConfigLink().reply(403);
  }

  mockLocalhostSDLQuery({ url: service.federatedServiceURL }).reply(200, {
    data: { _service: { sdl: service.federatedServiceSchema } },
  });

  const gateway = new ApolloGateway({
    serviceList: [
      { name: 'accounts', url: `${service.federatedServiceURL}/graphql` },
    ],
  });

  await gateway.load({ engine: { apiKeyHash, graphId } });
  await blocker; // Wait for the definitions to be "fetched".

  (isConflict
    ? expect(spyConsoleWarn)
    : expect(spyConsoleWarn).not
  ).toHaveBeenCalledWith(
    expect.stringContaining(
      'A local gateway service list is overriding an Apollo Graph',
    ),
  );
  spyGetServiceDefinitionsFromStorage.mockRestore();
  spyConsoleWarn.mockRestore();
});

it('Rollsback to a previous schema when triggered', async () => {
  // Init
  mockStorageSecretSuccess();
  mockCompositionConfigLinkSuccess();
  mockCompositionConfigsSuccess([service.implementingServicePath]);
  mockImplementingServicesSuccess(service);
  mockRawPartialSchemaSuccess(service);

  // Update 1
  mockStorageSecretSuccess();
  mockCompositionConfigLinkSuccess();
  mockCompositionConfigsSuccess([updatedService.implementingServicePath]);
  mockImplementingServicesSuccess(updatedService);
  mockRawPartialSchemaSuccess(updatedService);

  // Rollback
  mockStorageSecretSuccess();
  mockCompositionConfigLinkSuccess();
  mockCompositionConfigsSuccess([service.implementingServicePath]);
  mockImplementingServices(service).reply(304);
  mockRawPartialSchema(service).reply(304);

  jest.useFakeTimers();

  const onChange = jest.fn();
  const gateway = new ApolloGateway();
  await gateway.load({ engine: { apiKeyHash, graphId } });
  gateway.onSchemaChange(onChange);

  // 10000 ms is the default pollInterval
  jest.advanceTimersByTime(10000);

  // This useReal/useFake is challenging to explain the need for, and I probably
  // don't have the _correct_ answer here, but it seems that pushing this process
  // to the back of the task queue is insufficient.
  jest.useRealTimers();
  await new Promise(resolve => setTimeout(resolve, 100));
  jest.useFakeTimers();

  expect(onChange.mock.calls.length).toBe(1);

  jest.advanceTimersByTime(10000);

  jest.useRealTimers();
  await new Promise(resolve => setTimeout(resolve, 100));
  jest.useFakeTimers();

  expect(onChange.mock.calls.length).toBe(2);
});
