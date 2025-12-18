export class APIError extends Error {
  constructor(public status: number, public message: string, public code?: string) {
    super(message);
    this.name = 'APIError';
  }
}

export async function fetchJSON<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    let errorMessage = `HTTP error! status: ${response.status}`;
    let errorCode;
    try {
      const errorBody = await response.json();
      errorMessage = errorBody.message || errorMessage;
      errorCode = errorBody.code;
    } catch (e) {
      // ignore json parse error
    }
    throw new APIError(response.status, errorMessage, errorCode);
  }

  return response.json();
}
