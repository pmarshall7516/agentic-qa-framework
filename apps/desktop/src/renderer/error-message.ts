const SAFE_ADO_ERROR = /(?:^|: )AdoRequestError: ((?:Azure DevOps |Could not reach Azure DevOps )[\w\W]*?)(?:\r?\n|$)/;

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const safeAdoMessage = SAFE_ADO_ERROR.exec(message)?.[1]?.trim();
  if (safeAdoMessage) return safeAdoMessage.slice(0, 240);
  if (/AdoRequestError|Azure DevOps request failed|Error invoking remote method/i.test(message)) {
    return 'Azure DevOps could not complete this request. Check your connection and organization access, then try again.';
  }
  return message || 'The requested operation could not be completed.';
}
