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
| `authenticationType` | Yes | `ServicePrincipal` or `UsernamePassword` |
| `dataverseUrl` | Yes | Environment URL, e.g. `https://yourorg.crm.dynamics.com` |
| `tenantId` | Conditional | Azure AD Tenant ID (Service Principal only) |
| `clientId` | Conditional | Application (Client) ID (Service Principal only) |
| `clientSecret` | Conditional | Client secret (Service Principal only) |
| `username` | Conditional | User UPN (Username/Password only) |
| `password` | Conditional | User password (Username/Password only) |
| `solutionUniqueName` | Yes | Unique name of the managed solution to inspect |
| `failOnUnmanagedLayers` | No | Fail the task when unmanaged layers are found (default: `true`) |
| `outputFormat` | No | `table` (default) or `json` |

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
    authenticationType: 'ServicePrincipal'
    dataverseUrl: 'https://yourorg.crm.dynamics.com'
    tenantId: '$(TENANT_ID)'
    clientId: '$(CLIENT_ID)'
    clientSecret: '$(CLIENT_SECRET)'
    solutionUniqueName: 'YourSolutionUniqueName'
    failOnUnmanagedLayers: true
    outputFormat: 'table'
```

See [pipeline-example.yml](./pipeline-example.yml) for a full pipeline configuration.

---

## Prerequisites

### Service Principal Setup

1. Register an application in **Azure Active Directory**.
2. Create a **client secret** for the application.
3. In your Dataverse environment, go to **Settings → Users** and create an **Application User** linked to the registered application.
4. Assign the Application User a security role with at least read access to the `msdyn_componentlayer` and `solution` tables.

### Required Permissions

The authenticated identity requires:
- Read access to `solutions`
- Read access to `solutioncomponents`
- Read access to `msdyn_componentlayers`

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
