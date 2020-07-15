import { ApolloGateway, RemoteGraphQLDataSource, GatewayConfig, Experimental_UpdateServiceDefinitions } from "@apollo/gateway";
import { parse } from 'graphql';
import { readFileSync } from "fs";
import { resolve } from "path";
import { Headers } from "apollo-server-env";

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

async function overrideManagedServiceWithLocal(compositionResult, serviceNameToOverride: string, serviceURLOverride: string) {
    let serviceIndexToOverride = compositionResult.serviceDefinitions.findIndex(sd => sd.name == serviceNameToOverride) || -1;
    if (serviceURLOverride == undefined || serviceURLOverride == "") {
        console.log(`You must provide a URL to override the ${serviceNameToOverride} service. Either set the APOLLO_SERVICE_OVERRIDE_URL to your local running server or ensure the url is set in your local config file`);
    } else if (compositionResult.serviceDefinitions) {
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

            if (serviceIndexToOverride >= 0 && data) {
                //Service should be overriden in serviceDefinitions
                compositionResult.serviceDefinitions[serviceIndexToOverride].url = serviceURLOverride;
                compositionResult.serviceDefinitions[serviceIndexToOverride].typeDefs = typeDefs;
            } else if (data) {
                //Service should be added to serviceDefinitions
                compositionResult.serviceDefinitions.push({ name: serviceNameToOverride, typeDefs, url: serviceURLOverride });
            }
        } else if (errors) {
            errors.map(error => console.log(error));
        }
    }
}

export class LocalOverrideGateway extends ApolloGateway {
    protected async loadServiceDefinitions(config: GatewayConfig): ReturnType<Experimental_UpdateServiceDefinitions> {
        if (serviceOverrides) {
            let serviceDefinitions = await super.loadServiceDefinitions(config);

            if (serviceDefinitions.isNewSchema) {
                let serviceOverrideFetchPromises: Array<Promise<void>> = [];
                serviceOverrides.map(serviceToOverride => serviceOverrideFetchPromises.push(overrideManagedServiceWithLocal(serviceDefinitions, serviceToOverride.name, serviceToOverride.url)));

                await Promise.all(serviceOverrideFetchPromises);
            }

            return serviceDefinitions;
        } else {
            return super.loadServiceDefinitions(config);
        }
    }
}
