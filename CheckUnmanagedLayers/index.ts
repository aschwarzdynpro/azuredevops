import * as tl from "azure-pipelines-task-lib/task";
import { DataverseClient, UnmanagedLayerResult } from "./dataverse-client";

async function run(): Promise<void> {
  try {
    // Read the service connection input (same pattern as PowerPlatformExportSolution)
    const serviceConnectionId = tl.getInput("PowerPlatformSPN", true)!;
    const solutionUniqueName = tl.getInput("SolutionName", true)!;
    const failOnUnmanagedLayers = tl.getBoolInput("failOnUnmanagedLayers", false) ?? true;
    const outputFormat = tl.getInput("outputFormat", false) ?? "table";

    // Resolve environment URL and credentials from the service connection
    const dataverseUrl = tl.getEndpointUrl(serviceConnectionId, true)!;
    const tenantId = tl.getEndpointAuthorizationParameter(serviceConnectionId, "tenantId", false)!;
    const clientId = tl.getEndpointAuthorizationParameter(serviceConnectionId, "applicationId", false)!;
    const authScheme = tl.getEndpointAuthorizationScheme(serviceConnectionId, false) ?? "ServicePrincipal";

    tl.debug(`Environment URL: ${dataverseUrl}`);
    tl.debug(`Auth scheme: ${authScheme}`);
    tl.debug(`Tenant ID: ${tenantId}`);
    tl.debug(`Client ID: ${clientId}`);

    console.log(`##[section]Connecting to Dataverse environment: ${dataverseUrl}`);

    let accessToken: string;

    if (authScheme === "WorkloadIdentityFederation") {
      // Federated credential (OIDC) flow — no client secret stored in the service connection
      console.log(`Authenticating via Workload Identity Federation (service connection: ${serviceConnectionId})`);

      const oidcRequestUri = tl.getVariable("System.OidcRequestUri");
      const systemAccessToken = tl.getVariable("System.AccessToken");

      if (!oidcRequestUri || !systemAccessToken) {
        throw new Error(
          "System.OidcRequestUri or System.AccessToken is not available. " +
            "Ensure 'Allow scripts to access the OAuth token' is enabled for this pipeline job."
        );
      }

      const oidcToken = await DataverseClient.getOidcTokenFromAzureDevOps(
        serviceConnectionId,
        oidcRequestUri,
        systemAccessToken
      );

      accessToken = await DataverseClient.getTokenWithFederatedCredential(
        tenantId,
        clientId,
        oidcToken,
        dataverseUrl
      );
    } else {
      // ServicePrincipal (client secret) flow
      console.log(`Authenticating via Service Principal (client ID: ${clientId})`);
      const clientSecret = tl.getEndpointAuthorizationParameter(serviceConnectionId, "clientSecret", false)!;

      accessToken = await DataverseClient.getTokenWithClientSecret(
        tenantId,
        clientId,
        clientSecret,
        dataverseUrl
      );
    }

    console.log("Authentication successful.");

    const client = new DataverseClient(dataverseUrl, accessToken);

    // Validate the solution exists
    console.log(`\n##[section]Validating solution '${solutionUniqueName}'...`);
    const solutionExists = await client.validateSolutionExists(solutionUniqueName);

    if (!solutionExists) {
      tl.setResult(
        tl.TaskResult.Failed,
        `Solution '${solutionUniqueName}' was not found in the environment '${dataverseUrl}'. ` +
          "Please verify the solution unique name and ensure the service principal has access to it."
      );
      return;
    }

    console.log(`Solution '${solutionUniqueName}' found.`);

    // Check for unmanaged layers
    console.log(`\n##[section]Checking for unmanaged layers on solution components...`);
    const unmanagedLayers = await client.getUnmanagedLayersForSolution(solutionUniqueName);

    // Set output variable for downstream tasks
    tl.setVariable("UnmanagedLayerCount", String(unmanagedLayers.length), false, true);

    if (unmanagedLayers.length === 0) {
      console.log(
        `\n##[section]Result: No unmanaged layers detected for solution '${solutionUniqueName}'.`
      );
      console.log("All solution components are clean — no unmanaged customizations found.");
      tl.setResult(tl.TaskResult.Succeeded, "No unmanaged layers detected.");
      return;
    }

    // Unmanaged layers found — output them
    console.log(
      `\n##[warning]Found ${unmanagedLayers.length} component(s) with unmanaged layers in solution '${solutionUniqueName}':`
    );

    if (outputFormat === "json") {
      outputAsJson(unmanagedLayers);
    } else {
      outputAsTable(unmanagedLayers);
    }

    if (failOnUnmanagedLayers) {
      tl.setResult(
        tl.TaskResult.Failed,
        `${unmanagedLayers.length} component(s) with unmanaged layers detected in solution '${solutionUniqueName}'. ` +
          "Remove unmanaged customizations before deploying."
      );
    } else {
      tl.warning(
        `${unmanagedLayers.length} component(s) with unmanaged layers detected. ` +
          "Pipeline continues because 'Fail on unmanaged layers' is disabled."
      );
      tl.setResult(
        tl.TaskResult.Succeeded,
        `${unmanagedLayers.length} unmanaged layer(s) found (non-blocking).`
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    tl.setResult(tl.TaskResult.Failed, `Task failed with error: ${message}`);

    if (err instanceof Error && err.stack) {
      tl.debug(err.stack);
    }
  }
}

function outputAsTable(layers: UnmanagedLayerResult[]): void {
  const colWidths = {
    name: Math.max(14, ...layers.map(l => l.componentName.length)),
    type: Math.max(13, ...layers.map(l => l.componentType.length)),
    id: 36
  };

  const header =
    "  " +
    "Component Name".padEnd(colWidths.name) +
    "  " +
    "Component Type".padEnd(colWidths.type) +
    "  " +
    "Component ID".padEnd(colWidths.id);

  const separator =
    "  " +
    "-".repeat(colWidths.name) +
    "  " +
    "-".repeat(colWidths.type) +
    "  " +
    "-".repeat(colWidths.id);

  console.log(header);
  console.log(separator);

  for (const layer of layers) {
    const row =
      "  " +
      layer.componentName.padEnd(colWidths.name) +
      "  " +
      layer.componentType.padEnd(colWidths.type) +
      "  " +
      layer.componentId.padEnd(colWidths.id);
    console.log(row);
  }

  console.log("");
}

function outputAsJson(layers: UnmanagedLayerResult[]): void {
  console.log(JSON.stringify(layers, null, 2));
}

run();
