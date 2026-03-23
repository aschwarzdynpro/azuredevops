import axios, { AxiosInstance } from "axios";
import * as qs from "qs";

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface ComponentLayer {
  msdyn_componentlayerid: string;
  msdyn_solutionname: string;
  msdyn_name: string;
  msdyn_componentid: string;
  msdyn_order: number;
  msdyn_solutioncomponentname: string;
}

export interface UnmanagedLayerResult {
  componentId: string;
  componentName: string;
  componentType: string;
  solutionName: string;
  layerOrder: number;
}

export class DataverseClient {
  private httpClient: AxiosInstance;
  private environmentUrl: string;

  constructor(environmentUrl: string, accessToken: string) {
    this.environmentUrl = environmentUrl.replace(/\/$/, "");
    this.httpClient = axios.create({
      baseURL: `${this.environmentUrl}/api/data/v9.2`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    });
  }

  /**
   * Authenticate using a client secret (Service Principal scheme).
   */
  static async getTokenWithClientSecret(
    tenantId: string,
    clientId: string,
    clientSecret: string,
    environmentUrl: string
  ): Promise<string> {
    const resource = environmentUrl.replace(/\/$/, "");
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/token`;

    const body = qs.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      resource: resource
    });

    const response = await axios.post<TokenResponse>(tokenUrl, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    return response.data.access_token;
  }

  /**
   * Authenticate using a workload identity federation OIDC token (client_assertion flow).
   * The OIDC token is obtained from Azure DevOps by calling the OIDC request endpoint.
   */
  static async getTokenWithFederatedCredential(
    tenantId: string,
    clientId: string,
    oidcToken: string,
    environmentUrl: string
  ): Promise<string> {
    const resource = environmentUrl.replace(/\/$/, "");
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/token`;

    const body = qs.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      client_id: clientId,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: oidcToken,
      use: "sig",
      resource: resource
    });

    const response = await axios.post<TokenResponse>(tokenUrl, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    return response.data.access_token;
  }

  /**
   * Request an OIDC token from Azure DevOps for a given service connection.
   * Required for Workload Identity Federation auth scheme.
   */
  static async getOidcTokenFromAzureDevOps(
    serviceConnectionId: string,
    oidcRequestUri: string,
    systemAccessToken: string
  ): Promise<string> {
    const url = `${oidcRequestUri}?api-version=7.1&serviceConnectionId=${encodeURIComponent(serviceConnectionId)}`;

    const response = await axios.post<{ oidcToken: string }>(
      url,
      {},
      {
        headers: {
          Authorization: `Bearer ${systemAccessToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data.oidcToken;
  }

  async validateSolutionExists(solutionUniqueName: string): Promise<boolean> {
    const response = await this.httpClient.get<{ value: unknown[] }>(
      `/solutions?$filter=uniquename eq '${encodeURIComponent(solutionUniqueName)}'&$select=uniquename,friendlyname,version`
    );
    return response.data.value.length > 0;
  }

  async getUnmanagedLayersForSolution(solutionUniqueName: string): Promise<UnmanagedLayerResult[]> {
    // Step 1: get all component IDs that belong to the solution via msdyn_componentlayers
    const solutionLayers = await this.fetchAllPages<ComponentLayer>(
      `/msdyn_componentlayers?$filter=msdyn_solutionname eq '${encodeURIComponent(solutionUniqueName)}'` +
        `&$select=msdyn_componentid,msdyn_name,msdyn_solutioncomponentname`
    );

    const solutionComponentIds = [...new Set(solutionLayers.map(l => l.msdyn_componentid))];

    // Step 2: for each component, retrieve all layers ordered top-first and check if the top is 'Active'
    const unmanagedResults: UnmanagedLayerResult[] = [];

    for (const componentId of solutionComponentIds) {
      const componentLayers = await this.fetchAllPages<ComponentLayer>(
        `/msdyn_componentlayers?$filter=msdyn_componentid eq '${encodeURIComponent(componentId)}'` +
          `&$select=msdyn_componentlayerid,msdyn_solutionname,msdyn_name,msdyn_componentid,msdyn_order,msdyn_solutioncomponentname` +
          `&$orderby=msdyn_order desc`
      );

      // msdyn_order desc → first entry is the topmost layer
      const topLayer = componentLayers[0];
      if (topLayer && topLayer.msdyn_solutionname.toLowerCase() === "active") {
        unmanagedResults.push({
          componentId: topLayer.msdyn_componentid,
          componentName: topLayer.msdyn_name,
          componentType: topLayer.msdyn_solutioncomponentname,
          solutionName: topLayer.msdyn_solutionname,
          layerOrder: topLayer.msdyn_order
        });
      }
    }

    return unmanagedResults;
  }

  private async fetchAllPages<T>(initialPath: string): Promise<T[]> {
    const results: T[] = [];
    let nextLink: string | undefined = initialPath;

    while (nextLink) {
      const response = await this.httpClient.get<{
        value: T[];
        "@odata.nextLink"?: string;
      }>(nextLink);

      results.push(...response.data.value);
      nextLink = response.data["@odata.nextLink"];

      if (nextLink?.startsWith(this.environmentUrl)) {
        nextLink = nextLink.substring(`${this.environmentUrl}/api/data/v9.2`.length);
      }
    }

    return results;
  }
}
