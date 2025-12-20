export class APIError extends Error {
  constructor(public status: number, public message: string, public code?: string) {
    super(message);
    this.name = 'APIError';
  }
}

export async function fetchJSON<T>(url: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 180s timeout

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = `HTTP error! status: ${response.status}`;
      let errorCode;
      try {
        const errorBody = await response.json();
        errorMessage = errorBody.message || errorMessage;
        errorCode = errorBody.errorCode || errorBody.code; // support errorCode prop
      } catch (e) {
        // ignore json parse error
      }
      throw new APIError(response.status, errorMessage, errorCode);
    }

    return response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new APIError(408, '伺服器響應超時，請稍後再試', 'TIMEOUT');
    }
    throw error;
  }
}
