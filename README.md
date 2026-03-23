# Dataverse Unmanaged Layer Check — Azure DevOps Extension

An Azure DevOps pipeline task that checks whether any components of a **managed Dataverse solution** have **unmanaged layers** on top of them.

Unmanaged layers (visible as the `Active` layer in the solution layer inspector) indicate that someone customized a component directly in the environment without using a proper solution. This can cause unexpected behavior during deployments and should be detected and cleaned up before releasing.

---

## How It Works

1. Authenticates to the Dataverse Web API using either a **Service Principal** (recommended) or **Username/Password**.
2. Validates that the specified solution unique name exists in the target environment.
3. Queries the `msdyn_componentlayers` table to retrieve all component layers for every component in the solution.
4. Identifies components where the **top-most layer** belongs to the `Active` (unmanaged) solution.
5. Reports the affected components and optionally **fails the pipeline** to block the deployment.

---

## Inputs

| Input | Required | Description |
|---|---|---|
| `authenticationType` | Yes | Must be `PowerPlatformSPN` |
| `PowerPlatformSPN` | Yes | Name of the **Power Platform service connection** pointing to the target environment |
| `SolutionName` | Yes | Unique name of the managed solution to inspect |
| `failOnUnmanagedLayers` | No | Fail the task when unmanaged layers are found (default: `true`) |
| `outputFormat` | No | `table` (default) or `json` |

The task uses the same **Power Platform service connection** (`connectedService:PowerPlatform`) as the official Microsoft Power Platform Build Tools tasks (`PowerPlatformExportSolution`, `PowerPlatformImportSolution`, etc.). Both **Service Principal / client secret** and **Workload Identity Federation** connection schemes are supported.

## Output Variables

| Variable | Description |
|---|---|
| `UnmanagedLayerCount` | Number of components with unmanaged layers detected |

---

## Usage Example

```yaml
- task: CheckUnmanagedLayers@1
  displayName: 'Check for Unmanaged Layers'
  inputs:
    authenticationType: 'PowerPlatformSPN'
    PowerPlatformSPN: '${{ parameters.SourceEnvironment }}'
    SolutionName: '${{ parameters.SolutionName }}'
    failOnUnmanagedLayers: true
    outputFormat: 'table'
```

See [pipeline-example.yml](./pipeline-example.yml) for a full pipeline configuration.

---

## Prerequisites

### Power Platform Service Connection Setup

1. In Azure DevOps, go to **Project Settings → Service Connections → New service connection → Power Platform**.
2. Enter the **Environment URL** (e.g. `https://yourorg.crm.dynamics.com`), **Tenant ID**, and **Application (Client) ID**.
3. Choose either:
   - **Client secret** — enter the secret value.
   - **Workload Identity Federation** — configure federated credentials in your Entra ID app registration.
4. In your Dataverse environment, create an **Application User** for the registered app and assign it a security role.

> When using **Workload Identity Federation**, enable **"Allow scripts to access the OAuth token"** in the pipeline job settings so that `System.AccessToken` is available.

### Required Dataverse Permissions

The Application User needs at least **read** access to:
- `solution` table
- `solutioncomponent` table
- `msdyn_componentlayer` table

---

## Building & Packaging

```bash
# Install dependencies and compile TypeScript
npm run build

# Package as a .vsix for upload to Azure DevOps Marketplace or your organization
npm run package
```

Requires [Node.js 16+](https://nodejs.org) and `tfx-cli` (installed automatically via `npm run package`).

---

## Project Structure

```
├── vss-extension.json          # Extension manifest
├── package.json                # Root build scripts
├── pipeline-example.yml        # Example pipeline usage
└── CheckUnmanagedLayers/
    ├── task.json               # Task definition (inputs, outputs, metadata)
    ├── index.ts                # Entry point — reads inputs, orchestrates checks
    ├── dataverse-client.ts     # Dataverse Web API client + auth helpers
    ├── package.json            # Task dependencies
    └── tsconfig.json           # TypeScript configuration
```
