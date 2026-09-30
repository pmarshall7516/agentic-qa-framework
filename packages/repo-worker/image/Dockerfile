FROM node:22.12-bookworm-slim@sha256:35531c52ce27b6575d69755c73e65d4468dba93a25644eed56dc12879cae9213 AS node-runtime
FROM mcr.microsoft.com/dotnet/sdk:10.0.100@sha256:c7445f141c04f1a6b454181bd098dcfa606c61ba0bd213d0a702489e5bd4cd71 AS repository-worker

# The context contains only this Dockerfile. Test snapshots and project files are never
# available during image construction. Runtime containers still receive --network=none.
COPY --from=node-runtime /usr/local/ /usr/local/

ENV PATH="/usr/local/bin:${PATH}" \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    NUGET_PACKAGES=/tmp/.nuget/packages

WORKDIR /workspace
RUN node --version && npm --version && dotnet --version
