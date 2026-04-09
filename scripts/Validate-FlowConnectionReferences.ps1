<#
.SYNOPSIS
    Validates that all connection references used by Cloud Flows in a Dataverse
    unmanaged solution are configured in DeploymentSettings.json.

.DESCRIPTION
    Connects to a Dataverse environment, retrieves all Cloud Flows from the
    specified unmanaged solution, extracts their connection references, and
    validates each one is listed in the repository's DeploymentSettings.json.

    If missing connection references are found, a GitHub issue is created with
    the affected flows and their owners, and the script exits with code 1
    to fail the pipeline.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$EnvironmentUrl,
    [Parameter(Mandatory)][string]$TenantId,
    [Parameter(Mandatory)][string]$ClientId,
    [Parameter(Mandatory)][string]$ClientSecret,
    [Parameter(Mandatory)][string]$SolutionName,
    [Parameter(Mandatory)][string]$DeploymentSettingsPath,
    [Parameter(Mandatory)][string]$GitHubToken,
    [Parameter(Mandatory)][string]$GitHubRepo
)

$ErrorActionPreference = 'Stop'
$EnvironmentUrl = $EnvironmentUrl.TrimEnd('/')

#region Helper Functions

function Get-DataverseAccessToken {
    param(
        [string]$EnvironmentUrl,
        [string]$TenantId,
        [string]$ClientId,
        [string]$ClientSecret
    )

    $body = @{
        grant_type    = "client_credentials"
        client_id     = $ClientId
        client_secret = $ClientSecret
        scope         = "$EnvironmentUrl/.default"
    }

    $response = Invoke-RestMethod `
        -Uri "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token" `
        -Method Post `
        -Body $body `
        -ContentType "application/x-www-form-urlencoded"

    return $response.access_token
}

function Get-DataverseHeaders {
    param([string]$Token)
    return @{
        Authorization      = "Bearer $Token"
        "OData-MaxVersion" = "4.0"
        "OData-Version"    = "4.0"
        Accept             = "application/json"
        Prefer             = 'odata.include-annotations="*",odata.maxpagesize=500'
    }
}

function Invoke-DataverseCollectionQuery {
    param(
        [string]$Token,
        [string]$BaseUrl,
        [string]$Query
    )

    $headers = Get-DataverseHeaders -Token $Token
    $uri = "$BaseUrl/api/data/v9.2/$Query"
    $allRecords = @()

    do {
        $response = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
        if ($response.value) {
            $allRecords += $response.value
        }
        $uri = $response.'@odata.nextLink'
    } while ($uri)

    return $allRecords
}

function Invoke-DataverseSingleQuery {
    param(
        [string]$Token,
        [string]$BaseUrl,
        [string]$Path
    )

    $headers = Get-DataverseHeaders -Token $Token
    $uri = "$BaseUrl/api/data/v9.2/$Path"
    return Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
}

function New-GitHubIssue {
    param(
        [string]$Token,
        [string]$Repo,
        [string]$Title,
        [string]$Body,
        [string[]]$Labels
    )

    $headers = @{
        Authorization          = "Bearer $Token"
        Accept                 = "application/vnd.github+json"
        "X-GitHub-Api-Version" = "2022-11-28"
    }

    $payload = @{
        title  = $Title
        body   = $Body
        labels = $Labels
    } | ConvertTo-Json -Depth 5

    $uri = "https://api.github.com/repos/$Repo/issues"
    return Invoke-RestMethod -Uri $uri -Headers $headers -Method Post `
        -Body $payload -ContentType "application/json; charset=utf-8"
}

#endregion

#region Main

Write-Host "=============================================="
Write-Host " Flow Connection Reference Validation"
Write-Host "=============================================="
Write-Host ""

# --- Step 1: Load DeploymentSettings.json ---
Write-Host ">> Loading DeploymentSettings.json from: $DeploymentSettingsPath"

if (-not (Test-Path $DeploymentSettingsPath)) {
    Write-Host "##vso[task.logissue type=error]DeploymentSettings.json not found at '$DeploymentSettingsPath'."
    exit 1
}

$deploymentSettings = Get-Content -Path $DeploymentSettingsPath -Raw | ConvertFrom-Json
$configuredConnRefs = @()

if ($deploymentSettings.ConnectionReferences) {
    $configuredConnRefs = @($deploymentSettings.ConnectionReferences | ForEach-Object { $_.LogicalName })
}

Write-Host "   Configured connection references: $($configuredConnRefs.Count)"
foreach ($cr in $configuredConnRefs) {
    Write-Host "   - $cr"
}
Write-Host ""

# --- Step 2: Authenticate to Dataverse ---
Write-Host ">> Authenticating to Dataverse..."
$token = Get-DataverseAccessToken `
    -EnvironmentUrl $EnvironmentUrl `
    -TenantId $TenantId `
    -ClientId $ClientId `
    -ClientSecret $ClientSecret
Write-Host "   Authentication successful."
Write-Host ""

# --- Step 3: Look up the unmanaged solution ---
Write-Host ">> Looking up unmanaged solution '$SolutionName'..."
$solutions = Invoke-DataverseCollectionQuery -Token $token -BaseUrl $EnvironmentUrl `
    -Query "solutions?`$filter=uniquename eq '$SolutionName' and ismanaged eq false&`$select=solutionid,friendlyname,uniquename"

if ($solutions.Count -eq 0) {
    Write-Host "##vso[task.logissue type=error]Unmanaged solution '$SolutionName' not found in '$EnvironmentUrl'."
    exit 1
}

$solution = $solutions[0]
$solutionId = $solution.solutionid
Write-Host "   Found: $($solution.friendlyname) (ID: $solutionId)"
Write-Host ""

# --- Step 4: Get workflow (flow) components in the solution ---
# componenttype 29 = Workflow
Write-Host ">> Retrieving workflow components from solution..."
$workflowComponents = Invoke-DataverseCollectionQuery -Token $token -BaseUrl $EnvironmentUrl `
    -Query "solutioncomponents?`$filter=_solutionid_value eq $solutionId and componenttype eq 29&`$select=objectid"

$workflowIds = @($workflowComponents | ForEach-Object { $_.objectid })
Write-Host "   Found $($workflowIds.Count) workflow component(s)."
Write-Host ""

if ($workflowIds.Count -eq 0) {
    Write-Host ">> No workflows in solution. Validation passed."
    exit 0
}

# --- Step 5: Retrieve each Cloud Flow and extract connection references ---
Write-Host ">> Analyzing Cloud Flows..."
$flowViolations = @()
$cloudFlowCount = 0

foreach ($wfId in $workflowIds) {
    try {
        $workflow = Invoke-DataverseSingleQuery -Token $token -BaseUrl $EnvironmentUrl `
            -Path "workflows($wfId)?`$select=name,category,clientdata,_ownerid_value,statecode"
    }
    catch {
        Write-Warning "   Could not retrieve workflow $wfId : $_"
        continue
    }

    # category 5 = Modern Flow (Cloud Flow), skip anything else
    if ($workflow.category -ne 5) {
        continue
    }

    $cloudFlowCount++
    $flowName = $workflow.name
    $ownerName = $workflow.'_ownerid_value@OData.Community.Display.V1.FormattedValue'
    if (-not $ownerName) { $ownerName = $workflow._ownerid_value }

    Write-Host "   Flow: '$flowName' (Owner: $ownerName)"

    if (-not $workflow.clientdata) {
        Write-Host "     No definition found, skipping."
        continue
    }

    try {
        $flowDefinition = $workflow.clientdata | ConvertFrom-Json
    }
    catch {
        Write-Warning "     Could not parse flow definition for '$flowName', skipping."
        continue
    }

    # Connection references live under properties.connectionReferences
    $connRefs = $flowDefinition.properties.connectionReferences
    if (-not $connRefs) {
        Write-Host "     No connection references used."
        continue
    }

    $missingConnRefs = @()
    $connRefMembers = $connRefs | Get-Member -MemberType NoteProperty

    foreach ($member in $connRefMembers) {
        $connRef = $connRefs.$($member.Name)
        $logicalName = $connRef.connectionReferenceLogicalName

        if (-not $logicalName) { continue }

        if ($logicalName -notin $configuredConnRefs) {
            $missingConnRefs += @{
                LogicalName = $logicalName
                ConnectorId = $connRef.id
            }
            Write-Host "     MISSING: $logicalName ($($connRef.id))" -ForegroundColor Red
        }
        else {
            Write-Host "     OK: $logicalName" -ForegroundColor Green
        }
    }

    if ($missingConnRefs.Count -gt 0) {
        $flowViolations += @{
            FlowName        = $flowName
            FlowId          = $wfId
            OwnerName       = $ownerName
            MissingConnRefs = $missingConnRefs
        }
    }
}

Write-Host ""
Write-Host "   Cloud Flows analyzed: $cloudFlowCount"
Write-Host ""

# --- Step 6: Evaluate results ---
if ($flowViolations.Count -eq 0) {
    Write-Host "=============================================="
    Write-Host " VALIDATION PASSED"
    Write-Host " All flow connection references are configured"
    Write-Host " in DeploymentSettings.json."
    Write-Host "=============================================="
    exit 0
}

# --- Step 7: Validation failed - create GitHub Issue ---
Write-Host "=============================================="
Write-Host " VALIDATION FAILED" -ForegroundColor Red
Write-Host " $($flowViolations.Count) flow(s) with missing connection references"
Write-Host "=============================================="
Write-Host ""

# Build pipeline link for the issue body
$buildLink = ""
$pipelineUrl = $env:SYSTEM_TEAMFOUNDATIONCOLLECTIONURI
$pipelineProject = $env:SYSTEM_TEAMPROJECT
$buildId = $env:BUILD_BUILDID
if ($pipelineUrl -and $pipelineProject -and $buildId) {
    $encodedProject = [Uri]::EscapeDataString($pipelineProject)
    $buildLink = "`n**Pipeline Run:** [$pipelineProject Build #$buildId]($($pipelineUrl)$encodedProject/_build/results?buildId=$buildId)"
}

# Build the markdown table rows
$tableRows = ""
foreach ($v in $flowViolations) {
    $missingList = ($v.MissingConnRefs | ForEach-Object {
        "``$($_.LogicalName)`` ($($_.ConnectorId))"
    }) -join "<br>"
    $tableRows += "| $($v.FlowName) | $($v.OwnerName) | $missingList |`n"
}

# Build the list of currently configured refs
$configuredList = if ($configuredConnRefs.Count -gt 0) {
    ($configuredConnRefs | ForEach-Object { "- ``$_``" }) -join "`n"
}
else {
    "_None configured._"
}

$issueBody = @"
## Connection Reference Validation Failed

**Solution:** ``$SolutionName``
**Environment:** ``$EnvironmentUrl``
**Date:** $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss UTC' -AsUTC)$buildLink

The following Cloud Flows use connection references that are **not configured** in ``DeploymentSettings.json``.
Deployment cannot proceed until all connection references are registered.

### Affected Flows

| Flow | Owner | Missing Connection References |
|------|-------|-------------------------------|
$tableRows
### Required Actions

1. Open ``$DeploymentSettingsPath`` in the repository
2. Add the missing connection references to the ``ConnectionReferences`` array:
   ``````json
   {
     "LogicalName": "<logical-name-from-above>",
     "ConnectionId": "<guid-of-target-connection>",
     "ConnectorId": "<connector-id-from-above>"
   }
   ``````
3. Commit and push the changes
4. Re-run the validation pipeline

### Currently Configured Connection References

$configuredList
"@

$issueTitle = "Pipeline Failed: Missing Connection References in Solution '$SolutionName'"

Write-Host ">> Creating GitHub Issue in $GitHubRepo..."
try {
    $issue = New-GitHubIssue `
        -Token $GitHubToken `
        -Repo $GitHubRepo `
        -Title $issueTitle `
        -Body $issueBody `
        -Labels @("pipeline-failure", "connection-reference")

    Write-Host "   Issue created: $($issue.html_url)"
    Write-Host "##vso[task.logissue type=error]Connection reference validation failed. See GitHub Issue: $($issue.html_url)"
}
catch {
    Write-Warning "   Failed to create GitHub Issue: $_"
    Write-Host "##vso[task.logissue type=warning]Could not create GitHub Issue. Check GitHubToken permissions."

    # Log the violation details directly to pipeline output as fallback
    Write-Host "##vso[task.logissue type=error]Connection reference validation failed for solution '$SolutionName'."
    foreach ($v in $flowViolations) {
        $missing = ($v.MissingConnRefs | ForEach-Object { $_.LogicalName }) -join ", "
        Write-Host "##vso[task.logissue type=error]Flow '$($v.FlowName)' (Owner: $($v.OwnerName)) - Missing: $missing"
    }
}

Write-Host ""
Write-Host "##vso[task.complete result=Failed;]Validation failed - missing connection references in flows."
exit 1

#endregion
