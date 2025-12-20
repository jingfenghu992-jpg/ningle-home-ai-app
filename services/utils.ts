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
        errorCode = errorBody.errorCode || errorBody.code;
        // Special handling for Vercel 500s which might be HTML
      } catch (e) {
        // If JSON parse fails, it might be Vercel's raw 500 HTML page
        // Try to get text to see if it contains useful info
        try {
            // We already consumed body in response.json(), but if it failed, 
            // actually we can't read it again easily unless we clone.
            // But usually response.json() fails because it is empty or HTML.
            errorMessage = `Server Error (${response.status}). Please try a smaller image or retry later.`;
        } catch (e2) {}
      }
      
      if (response.status === 504) {
          errorMessage = 'Gateway Timeout: The analysis took too long.';
          errorCode = 'TIMEOUT';
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
