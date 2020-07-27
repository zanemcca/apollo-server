import { ApolloGateway, RemoteGraphQLDataSource, GatewayConfig, Experimental_UpdateServiceDefinitions } from "@apollo/gateway";
import { parse } from 'graphql';
import { readFileSync } from "fs";
import { resolve } from "path";
import { Headers } from "apollo-server-env";
import { ServiceDefinition } from "@apollo/federation";

let shouldOverrideServices = process.env.APOLLO_SERVICE_OVERRIDE;
let serviceOverrides = shouldOverrideServices ? setupServiceOverrides() : [];

function setupServiceOverrides() {
    let overrides: Array<{ name, url }> = [];
    if (shouldOverrideServices == 'true') {
        overrides.push({ name: process.env.APOLLO_SERVICE_OVERRIDE_NAME, url: process.env.APOLLO_SERVICE_OVERRIDE_URL });
    } else if (shouldOverrideServices) {
        let localOverrideConfigFile = JSON.parse(readFileSync(resolve(__dirname, shouldOverrideServices), { encoding: "utf8" }));
        localOverrideConfigFile.servicesToOverride.map(serviceOverride => overrides.push({ ...serviceOverride }));
    }

    return overrides;
}

export class LocalOverrideGateway extends ApolloGateway {
    protected async loadServiceDefinitions(config: GatewayConfig): ReturnType<Experimental_UpdateServiceDefinitions> {
        if (serviceOverrides) {
            let newDefinitions: Array<ServiceDefinition> = [];
            let fetchedServiceDefinitions;
            try {
                fetchedServiceDefinitions = await super.loadServiceDefinitions(config);
            } catch (err) {
                //Valid configuration doesn't exist yet
            }

            for (var i = 0; i < serviceOverrides.length; i++) {
                let name = serviceOverrides[i].name;
                let url = serviceOverrides[i].url;
                let typeDefs = await this.getRemoteTypeDefs(url);
                if (typeDefs)
                    newDefinitions.push({ name, url, typeDefs });
                else
                    console.log(`Unable to fetch schema from local service ${name} from ${url}`);
            }

            if (fetchedServiceDefinitions?.serviceDefinitions)
                for (var i = 0; i < fetchedServiceDefinitions.serviceDefinitions.length; i++) {
                    let originalService = fetchedServiceDefinitions.serviceDefinitions[i];
                    let alreadyDefined = fetchedServiceDefinitions.serviceDefinitions.findIndex(sd => sd.name == serviceOverrides[0].name) >= 0 ? true : false;
                    if (!alreadyDefined)
                        newDefinitions.push(originalService);
                }

            return {
                isNewSchema: true,
                compositionMetadata: fetchedServiceDefinitions?.compositionMetadata,
                serviceDefinitions: newDefinitions
            };
        } else {
            return super.loadServiceDefinitions(config);
        }
    }

    async getRemoteTypeDefs(serviceURLOverride: string) {
        try {
            const request = {
                query: 'query __ApolloGetServiceDefinition__ { _service { sdl } }',
                http: {
                    url: serviceURLOverride,
                    method: 'POST',
                    headers: new Headers()
                },
            };

            let source = new RemoteGraphQLDataSource({ url: serviceURLOverride, });

            let { data, errors } = await source.process({ request, context: {} });
            if (data && !errors) {
                const typeDefs = parse(data._service.sdl);

                return typeDefs;
            } else if (errors) {
                errors.map(error => console.log(error));
            }
        } catch (err) {
            switch (err.code) {
                case "ECONNREFUSED":
                    console.log(`Request to ${serviceURLOverride} failed. Make sure your local server is running`);
                    break;
                default:
                    console.log(err);
                    break;
            }
        }

        return;
    }
}
