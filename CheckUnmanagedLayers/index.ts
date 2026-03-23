import * as tl from "azure-pipelines-task-lib/task";
import { DataverseClient, UnmanagedLayerResult } from "./dataverse-client";

async function run(): Promise<void> {
  try {
    // Read inputs
    const authenticationType = tl.getInput("authenticationType", true)!;
    const dataverseUrl = tl.getInput("dataverseUrl", true)!;
    const solutionUniqueName = tl.getInput("solutionUniqueName", true)!;
    const failOnUnmanagedLayers = tl.getBoolInput("failOnUnmanagedLayers", false) ?? true;
    const outputFormat = tl.getInput("outputFormat", false) ?? "table";

    tl.debug(`Authentication type: ${authenticationType}`);
    tl.debug(`Dataverse URL: ${dataverseUrl}`);
    tl.debug(`Solution unique name: ${solutionUniqueName}`);

    console.log(`##[section]Connecting to Dataverse environment: ${dataverseUrl}`);

    // Acquire access token
    let accessToken: string;

    if (authenticationType === "ServicePrincipal") {
      const tenantId = tl.getInput("tenantId", true)!;
      const clientId = tl.getInput("clientId", true)!;
      const clientSecret = tl.getInput("clientSecret", true)!;

      console.log(`Authenticating as service principal (client ID: ${clientId})`);
      accessToken = await DataverseClient.getTokenWithClientCredentials(
        tenantId,
        clientId,
        clientSecret,
        dataverseUrl
      );
    } else {
      const username = tl.getInput("username", true)!;
      tl.getInput("password", true); // validate it exists
      const password = tl.getInput("password", true)!;

      console.log(`Authenticating as user: ${username}`);
      accessToken = await DataverseClient.getTokenWithUsernamePassword(
        username,
        password,
        dataverseUrl
      );
    }

    console.log("Authentication successful.");

    // Initialize Dataverse client
    const client = new DataverseClient(dataverseUrl, accessToken);

    // Validate the solution exists
    console.log(`\n##[section]Validating solution '${solutionUniqueName}'...`);
    const solutionExists = await client.validateSolutionExists(solutionUniqueName);

    if (!solutionExists) {
      tl.setResult(
        tl.TaskResult.Failed,
        `Solution '${solutionUniqueName}' was not found in the environment '${dataverseUrl}'. ` +
          "Please verify the solution unique name and ensure the authenticated user has access to it."
      );
      return;
    }

    console.log(`Solution '${solutionUniqueName}' found.`);

    // Check for unmanaged layers
    console.log(`\n##[section]Checking for unmanaged layers on solution components...`);
    const unmanagedLayers = await client.getUnmanagedLayersForSolution(solutionUniqueName);

    // Output results
    if (unmanagedLayers.length === 0) {
      console.log(
        `\n##[section]Result: No unmanaged layers detected for solution '${solutionUniqueName}'.`
      );
      console.log(
        "All solution components are clean. No unmanaged customizations were found on top of any component."
      );
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

    // Set pipeline variable with count for downstream tasks
    tl.setVariable("UnmanagedLayerCount", String(unmanagedLayers.length));

    if (failOnUnmanagedLayers) {
      tl.setResult(
        tl.TaskResult.Failed,
        `${unmanagedLayers.length} component(s) with unmanaged layers detected in solution '${solutionUniqueName}'. ` +
          "Remove unmanaged customizations before deploying."
      );
    } else {
      tl.warning(
        `${unmanagedLayers.length} component(s) with unmanaged layers detected. Pipeline continues because 'Fail on unmanaged layers' is disabled.`
      );
      tl.setResult(tl.TaskResult.Succeeded, `${unmanagedLayers.length} unmanaged layer(s) found (non-blocking).`);
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
