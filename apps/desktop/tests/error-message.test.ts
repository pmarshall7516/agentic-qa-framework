import { describe, expect, it } from 'vitest';
import { errorMessage } from '../src/renderer/error-message.js';

describe('renderer error messages', () => {
  it('keeps safe operation-specific ADO errors from IPC rejections', () => {
    expect(errorMessage(new Error("Error invoking remote method 'qa:search-items': AdoRequestError: Azure DevOps rejected the work item query (HTTP 400). Check the project and filters.")))
      .toBe('Azure DevOps rejected the work item query (HTTP 400). Check the project and filters.');
  });

  it('does not show arbitrary remote error details', () => {
    expect(errorMessage(new Error("Error invoking remote method 'qa:search-items': AdoRequestError: body contains private payload")))
      .toBe('Azure DevOps could not complete this request. Check your connection and organization access, then try again.');
  });
});
