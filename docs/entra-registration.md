# Entra app registration for Agentic QA

Agentic QA uses a Microsoft Entra public client. You enter only the application's client ID in the desktop app. Do not create or enter a client secret.

## Register the public client

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), open **App registrations** and create a registration for **Accounts in any organizational directory**. The first release is for Entra-backed Azure DevOps organizations; personal Microsoft accounts are not supported for this ADO resource.
2. Open **Authentication** → **Add a platform** → **Mobile and desktop applications**. Add the redirect URI `http://localhost`. MSAL Node uses this loopback redirect for system-browser authorization-code sign-in with PKCE. See Microsoft's [MSAL Node Electron system-browser sample](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/samples/msal-node-samples/ElectronSystemBrowserTestApp/README.md).
3. Open **API permissions** → **Add a permission** → **APIs my organization uses** → **Azure DevOps** → **Delegated permissions**. Add these read permissions:

   - `vso.profile` — profile and account discovery.
   - `vso.project` — project and team reads.
   - `vso.work` — work-item reads, queries and process metadata.
   - `vso.code` — repository/ref/source reads when using an ADO Git target.

   The app requests `https://app.vssps.visualstudio.com/.default`, so Entra issues the permissions configured and consented for the Azure DevOps resource. Do not add `user_impersonation`, write/manage scopes, or application permissions. Microsoft's [Azure DevOps scope reference](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth?view=azure-devops) describes the read scopes and warns that `user_impersonation` grants full REST API access. An administrator may need to approve consent under your tenant policy.
4. Copy **Application (client) ID** from the registration overview and enter it into Agentic QA. No secret or certificate is required.
5. Sign in with an Entra work/school account that already has read access to the target Azure DevOps organization/project. Grant the requested delegated permissions if prompted. If sign-in succeeds but ADO calls return 403, ask the organization/project administrator to verify the user's access and the tenant's third-party OAuth policy.

## Pilot check

Use a non-production project and a least-privilege test account. Confirm the app can list the organization/project and read one work item. Then sign out and verify the app returns to the disconnected state. Test Conditional Access on a policy-approved device/account before treating the integration as supported for that tenant.

The app currently limits its authority to the `organizations` Entra endpoint. ADO's Microsoft Entra integration does not support personal Microsoft accounts for the Azure DevOps resource; see [Microsoft's ADO Entra guidance](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth?view=azure-devops).
