const SAFE_ADO_ERROR = /(?:^|: )AdoRequestError: ((?:Azure DevOps |Could not reach Azure DevOps )[\w\W]*?)(?:\r?\n|$)/;
const REMOTE_ERROR = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/;

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = raw.replace(REMOTE_ERROR, '').split(/\r?\n/)[0]?.trim() ?? '';
  const safeAdoMessage = SAFE_ADO_ERROR.exec(message)?.[1]?.trim();
  if (safeAdoMessage) return safeAdoMessage.slice(0, 240);
  if (/AdoRequestError|Azure DevOps request failed/i.test(message)) {
    return 'Azure DevOps could not complete this request. Check your connection and organization access, then try again.';
  }
  return message.replace(/^Error:\s*/, '').slice(0, 500) || 'The requested operation could not be completed.';
}
