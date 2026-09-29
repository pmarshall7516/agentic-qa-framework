# Legacy Entra app-registration setup

> Superseded for the current v1 implementation. Agentic QA now uses the user's installed Azure CLI and does not require an app-owned registration or client ID. See [Azure DevOps integration](spec/02-azure-devops-integration.md) and the [README](../README.md). The material below is retained only as historical setup documentation.

Agentic QA uses a Microsoft Entra public client to obtain delegated Azure DevOps access. The app publisher or deployment owner registers and maintains this client once; the public client ID is injected into the desktop main-process bundle at build time. End users see **Sign in with Azure DevOps** and do not register an app or enter a client ID. Never create, package or enter a client secret or certificate.

## Register the public client

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), open **App registrations** and create a registration for **Accounts in any organizational directory**. The first release is for Entra-backed Azure DevOps organizations; personal Microsoft accounts are not supported for this ADO resource.
2. Open **Authentication** → **Add a platform** → **Mobile and desktop applications**. Add the redirect URI `http://localhost`. MSAL Node uses this loopback redirect for system-browser authorization-code sign-in with PKCE. See Microsoft's [MSAL Node Electron system-browser sample](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/samples/msal-node-samples/ElectronSystemBrowserTestApp/README.md).
3. Open **API permissions** → **Add a permission** → **APIs my organization uses** → **Azure DevOps** → **Delegated permissions**. Add these read permissions:

   - `vso.profile` — profile and account discovery.
   - `vso.project` — project and team reads.
   - `vso.work` — work-item reads, queries and process metadata.
   - `vso.code` — repository/ref/source reads when using an ADO Git target.

   The app requests `https://app.vssps.visualstudio.com/.default`, so Entra issues the permissions configured and consented for the Azure DevOps resource. Do not add `user_impersonation`, write/manage scopes, or application permissions. Microsoft's [Azure DevOps scope reference](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth?view=azure-devops) describes the read scopes and warns that `user_impersonation` grants full REST API access. An administrator may need to approve consent under your tenant policy.
4. Copy **Application (client) ID** from the registration overview and provide it to the desktop build as `AGENTIC_QA_ENTRA_CLIENT_ID`. The build validates and embeds only this public identifier in the main-process bundle; packaging fails if it is absent or malformed. Do not add this value to renderer state. No secret or certificate is required.
5. End users sign in with an Entra work/school account that already has read access to the target Azure DevOps organization/project. They can select a discovered organization or add a validated organization name/URL. Grant the requested delegated permissions if prompted. If sign-in succeeds but ADO calls return 403, ask the organization/project administrator to verify the user's access and the tenant's third-party OAuth policy.

## Pilot check

Use a non-production project and a least-privilege test account. Confirm the packaged app's public client ID can complete system-browser PKCE, discover organizations, validate a manually added organization, list projects and read one work item. Then sign out and verify the app returns to the disconnected state. Test Conditional Access on a policy-approved device/account before treating the integration as supported for that tenant.

The app currently limits its authority to the `organizations` Entra endpoint. ADO's Microsoft Entra integration does not support personal Microsoft accounts for the Azure DevOps resource; see [Microsoft's ADO Entra guidance](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth?view=azure-devops).
