import axios, { AxiosInstance } from "axios";
import * as qs from "qs";

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface SolutionComponent {
  objectid: string;
  componenttype: number;
  componenttypename: string;
  solutioncomponentid: string;
}

export interface ComponentLayer {
  msdyn_componentlayerid: string;
  msdyn_solutionname: string;
  msdyn_name: string;
  msdyn_componentid: string;
  msdyn_order: number;
  msdyn_solutioncomponentname: string;
  "msdyn_solutionname@OData.Community.Display.V1.FormattedValue"?: string;
}

export interface UnmanagedLayerResult {
  componentId: string;
  componentName: string;
  componentType: string;
  solutionName: string;
  layerOrder: number;
}

// Component type codes from Dataverse metadata
const COMPONENT_TYPE_NAMES: Record<number, string> = {
  1: "Entity",
  2: "Attribute",
  3: "Relationship",
  4: "Attribute Picklist Value",
  5: "Attribute Lookup Value",
  6: "View Attribute",
  7: "Localized Label",
  8: "Relationship Extra Condition",
  9: "Option Set",
  10: "Entity Relationship",
  11: "Entity Relationship Role",
  12: "Entity Relationship Relationships",
  13: "Managed Property",
  14: "Entity Key",
  16: "Privilege",
  17: "PrivilegeObjectTypeCode",
  20: "Role",
  21: "Role Privilege",
  22: "Display String",
  23: "Display String Map",
  24: "Form",
  25: "Organization",
  26: "Saved Query",
  29: "Workflow",
  31: "Report",
  32: "Report Entity",
  33: "Report Category",
  34: "Report Visibility",
  35: "Attachment",
  36: "Email Template",
  37: "Contract Template",
  38: "KB Article Template",
  39: "Mail Merge Template",
  44: "Duplicate Rule",
  45: "Duplicate Rule Condition",
  46: "Entity Map",
  47: "Attribute Map",
  48: "Ribbon Command",
  49: "Ribbon Context Group",
  50: "Ribbon Customization",
  52: "Ribbon Rule",
  53: "Ribbon Tab To Command Map",
  55: "Ribbon Diff",
  59: "Saved Query Visualization",
  60: "System Form",
  61: "Web Resource",
  62: "Site Map",
  63: "Connection Role",
  64: "Complex Control",
  65: "Hierarchy Rule",
  66: "Custom Control",
  68: "Custom Control Default Config",
  70: "Field Security Profile",
  71: "Field Permission",
  90: "Plugin Type",
  91: "Plugin Assembly",
  92: "SDK Message Processing Step",
  93: "SDK Message Processing Step Image",
  95: "Service Endpoint",
  150: "Routing Rule",
  151: "Routing Rule Item",
  152: "SLA",
  153: "SLA Item",
  154: "Convert Rule",
  155: "Convert Rule Item",
  161: "Mobile Offline Profile",
  162: "Mobile Offline Profile Item",
  165: "Similarity Rule",
  166: "Data Source Mapping",
  201: "SDKMessage",
  202: "SDKMessageFilter",
  203: "SdkMessagePair",
  204: "SdkMessageRequest",
  205: "SdkMessageRequestField",
  206: "SdkMessageResponse",
  207: "SdkMessageResponseField",
  210: "WebWizard",
  300: "Canvas App",
  371: "Connector",
  372: "Connector",
  380: "Environment Variable Definition",
  381: "Environment Variable Value",
  400: "AI Project Type",
  401: "AI Project",
  402: "AI Configuration",
  430: "Entity Analytics Configuration",
  431: "Attribute Image Configuration",
  432: "Entity Image Configuration"
};

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

  static async getTokenWithClientCredentials(
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

  static async getTokenWithUsernamePassword(
    username: string,
    password: string,
    environmentUrl: string
  ): Promise<string> {
    const resource = environmentUrl.replace(/\/$/, "");
    const tokenUrl = `https://login.microsoftonline.com/common/oauth2/token`;

    const body = qs.stringify({
      grant_type: "password",
      client_id: "51f81489-12ee-4a9e-aaae-a2591f45987d", // Well-known public client ID for Dataverse
      username: username,
      password: password,
      resource: resource
    });

    const response = await axios.post<TokenResponse>(tokenUrl, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    return response.data.access_token;
  }

  async validateSolutionExists(solutionUniqueName: string): Promise<boolean> {
    const response = await this.httpClient.get<{ value: unknown[] }>(
      `/solutions?$filter=uniquename eq '${encodeURIComponent(solutionUniqueName)}'&$select=uniquename,friendlyname,version`
    );
    return response.data.value.length > 0;
  }

  async getSolutionComponents(solutionUniqueName: string): Promise<SolutionComponent[]> {
    const allComponents: SolutionComponent[] = [];
    let nextLink: string | undefined = `/solutioncomponents?$filter=solution_solutioncomponent/uniquename eq '${encodeURIComponent(solutionUniqueName)}'&$select=objectid,componenttype,solutioncomponentid`;

    while (nextLink) {
      const response = await this.httpClient.get<{
        value: SolutionComponent[];
        "@odata.nextLink"?: string;
      }>(nextLink);

      allComponents.push(...response.data.value);
      nextLink = response.data["@odata.nextLink"];

      // Strip base URL from nextLink if present
      if (nextLink && nextLink.startsWith(this.environmentUrl)) {
        nextLink = nextLink.substring(`${this.environmentUrl}/api/data/v9.2`.length);
      }
    }

    return allComponents;
  }

  async getUnmanagedLayersForSolution(solutionUniqueName: string): Promise<UnmanagedLayerResult[]> {
    // Query msdyn_componentlayers to find all layers for components in this solution
    // An unmanaged layer has solutionname = 'Active' or is not associated with any managed solution
    const allLayers: ComponentLayer[] = [];
    let nextLink: string | undefined =
      `/msdyn_componentlayers?$filter=msdyn_solutionname eq '${encodeURIComponent(solutionUniqueName)}'` +
      `&$select=msdyn_componentlayerid,msdyn_solutionname,msdyn_name,msdyn_componentid,msdyn_order,msdyn_solutioncomponentname` +
      `&$orderby=msdyn_name asc`;

    while (nextLink) {
      const response = await this.httpClient.get<{
        value: ComponentLayer[];
        "@odata.nextLink"?: string;
      }>(nextLink);

      allLayers.push(...response.data.value);
      nextLink = response.data["@odata.nextLink"];

      if (nextLink && nextLink.startsWith(this.environmentUrl)) {
        nextLink = nextLink.substring(`${this.environmentUrl}/api/data/v9.2`.length);
      }
    }

    // Find component IDs that belong to our solution
    const solutionComponentIds = new Set(allLayers.map(l => l.msdyn_componentid));

    // Now check for each component whether there is an unmanaged ('Active') layer on top
    const unmanagedResults: UnmanagedLayerResult[] = [];

    for (const componentId of solutionComponentIds) {
      // Get ALL layers for this component, ordered by layer order (ascending = bottom layer first)
      let layersForComponent: ComponentLayer[] = [];
      let layerLink: string | undefined =
        `/msdyn_componentlayers?$filter=msdyn_componentid eq '${encodeURIComponent(componentId)}'` +
        `&$select=msdyn_componentlayerid,msdyn_solutionname,msdyn_name,msdyn_componentid,msdyn_order,msdyn_solutioncomponentname` +
        `&$orderby=msdyn_order desc`;

      while (layerLink) {
        const resp = await this.httpClient.get<{
          value: ComponentLayer[];
          "@odata.nextLink"?: string;
        }>(layerLink);

        layersForComponent.push(...resp.data.value);
        layerLink = resp.data["@odata.nextLink"];

        if (layerLink && layerLink.startsWith(this.environmentUrl)) {
          layerLink = layerLink.substring(`${this.environmentUrl}/api/data/v9.2`.length);
        }
      }

      // The top layer (highest order = lowest number in Dataverse, order 0 = topmost) with solutionname 'Active' is an unmanaged layer
      const topLayer = layersForComponent[0]; // already sorted desc by msdyn_order
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
}
