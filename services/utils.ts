export class APIError extends Error {
  constructor(public status: number, public message: string, public code?: string, public details?: any) {
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
      let errorDetails: any = undefined;
      try {
        const errorBody = await response.json();
        errorDetails = errorBody;
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
      
      throw new APIError(response.status, errorMessage, errorCode, errorDetails);
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

export async function compressImage(file: File, maxWidth = 1536, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxWidth) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxWidth) / height);
            height = maxWidth;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Canvas to Blob failed'));
            }, 'image/jpeg', quality);
        } else {
            reject(new Error('Canvas context failed'));
        }
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}
